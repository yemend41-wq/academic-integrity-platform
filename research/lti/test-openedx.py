"""Run a real Open edX LTI Consumer XBlock and the compiled Mizan Worker on two local TLS origins."""
import argparse
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
from io import BytesIO
import json
import os
from pathlib import Path
import secrets
import ssl
import subprocess
import tempfile
from threading import Thread
from urllib.parse import parse_qs, urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings
import django
import httpx
from lxml import etree, html
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
CLAIM = "https://purl.imsglobal.org/spec/lti/claim/"
settings.configure(
    SECRET_KEY=secrets.token_hex(32), PLATFORM_NAME="Open edX interoperability lab",
    INSTALLED_APPS=[], USE_I18N=False,
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
django.setup()
from lti_consumer.data import Lti1p3LaunchData
from lti_consumer.lti_1p3.consumer import LtiConsumer1p3
from lti_consumer.utils import get_data_from_cache


@dataclass(frozen=True)
class User:
    handle: str
    role: str
    course: str
    language: str


USERS = (
    User("student-a", "student", "course-a", "ar"),
    User("student-b", "student", "course-a", "en"),
    User("staff-a", "instructor", "course-a", "ar"),
    User("staff-b", "instructor", "course-b", "en"),
)


class Lab:
    """A small HTTP boundary around the upstream launch builder and its actual Django cache."""

    def __init__(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.signing_pem = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
        self.key_requests = 0

    def consumer(self):
        return LtiConsumer1p3(
            iss=self.issuer, lti_oidc_url=self.tool + "/lti/login",
            lti_launch_url=self.tool + "/lti/launch", client_id="mizan-test",
            deployment_id="sandbox-course-tool", rsa_key=self.signing_pem,
            rsa_key_id="ephemeral-class-key", redirect_uris=[self.tool + "/lti/launch"],
        )

    def initiation_url(self, user):
        data = Lti1p3LaunchData(
            user_id=user.handle, user_role=user.role, config_id="local-config",
            resource_link_id=user.course + "-assignment", context_id=user.course,
            launch_presentation_document_target="window",
        )
        return self.consumer().prepare_preflight_url(data)

    def authorization_form(self, query):
        fields = {k: values[0] for k, values in parse_qs(query).items() if len(values) == 1}
        data = get_data_from_cache(fields["lti_message_hint"])
        if data is None or fields.get("login_hint") != data.user_id:
            raise ValueError("Launch not associated with this fixture")
        assert (fields["scope"], fields["response_type"], fields["response_mode"], fields["prompt"]) == (
            "openid", "id_token", "form_post", "none",
        )
        user = next(u for u in USERS if u.handle == data.user_id)
        consumer = self.consumer()
        consumer.set_user_data(data.user_id, data.user_role, full_name="Private Fixture", email_address="fixture@example.invalid")
        consumer.set_context_claim(data.context_id)
        consumer.set_resource_link_claim(data.resource_link_id)
        consumer.set_launch_presentation_claim("window")
        # Optional language is a signed claim. The Open edX extension hook composes it here.
        consumer.set_extra_claim({CLAIM + "launch_presentation": {
            "document_target": "window", "locale": "ar-OM" if user.language == "ar" else "en-GB"
        }})
        message = consumer.generate_launch_request(fields)
        form = etree.Element("form", method="post", action=fields["redirect_uri"])
        for name, value in message.items():
            etree.SubElement(form, "input", type="hidden", name=name, value=value)
        return etree.tostring(form, method="html")


def platform_http(lab):
    class Endpoint(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log a state, a nonce, an opaque hint or an assertion.

        def do_GET(self):
            path = urlsplit(self.path)
            if path.path == "/keys":
                lab.key_requests += 1
                data = json.dumps(lab.consumer().get_public_keyset()).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
            elif path.path.startswith("/links/"):
                user = next((u for u in USERS if path.path == "/links/" + u.handle), None)
                if user is None:
                    self.send_error(404)
                    return
                data = b""
                self.send_response(303)
                self.send_header("Location", lab.initiation_url(user))
            elif path.path == "/authorize":
                data = lab.authorization_form(path.query)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
            else:
                self.send_error(404)
                return
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return Endpoint


def certificate(directory):
    cert, key = Path(directory) / "tls.crt", Path(directory) / "tls.key"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj",
         "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
         "-keyout", str(key), "-out", str(cert)],
        check=True, capture_output=True,
    )
    return cert, key


def launch(client, lab, user):
    link = client.get(lab.issuer + "/links/" + user.handle)
    assert link.status_code == 303 and link.headers["location"].startswith(lab.tool + "/lti/login?")
    start = client.get(link.headers["location"])
    assert start.status_code == 303 and start.headers["location"].startswith(lab.issuer + "/authorize?")
    authorization = client.get(start.headers["location"])
    assert authorization.status_code == 200
    form = html.fromstring(authorization.content)
    assert form.get("action") == lab.tool + "/lti/launch" and form.get("method") == "post"
    fields = {el.get("name"): el.get("value") for el in form.iter("input")}
    assert set(fields) == {"id_token", "state"}
    finish = client.post(form.get("action"), data=fields, headers={"Origin": lab.issuer})
    assert finish.status_code == 303 and finish.headers["location"] == "/"
    assert any(c.name == "__Host-mizan" for c in client.cookies.jar)
    assert not any(c.name.startswith("__Host-lti-") for c in client.cookies.jar)
    studio = client.get(lab.tool + "/")
    assert studio.status_code == 200 and "/studio.js" in studio.text
    me = client.get(lab.tool + "/api/me")
    assert me.status_code == 200
    actor = me.json()
    assert actor["role"] == user.role and actor["source"] == "lti" and actor["locale"] == user.language
    assert actor["id"].startswith("lti-") and actor["cohort"].startswith("lti-")
    assert "fixture@example.invalid" not in me.text and "Private Fixture" not in me.text
    return actor


def exercise(check, result):
    with tempfile.TemporaryDirectory(prefix="mizan-lti-local-") as tmp, ExitStack() as stack:
        cert, key = certificate(tmp)
        lab = Lab()
        server = ThreadingHTTPServer(("127.0.0.1", 0), platform_http(lab))
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(cert, key)
        server.socket = server_context.wrap_socket(server.socket, server_side=True)
        lab.issuer = f"https://127.0.0.1:{server.server_port}"
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        stack.callback(server.server_close)
        stack.callback(server.shutdown)
        with subprocess.Popen(
            ["node", "research/lti/serve-worker.mjs", str(cert), str(key), lab.issuer], cwd=ROOT,
            env=dict(os.environ, NODE_EXTRA_CA_CERTS=str(cert)), stdout=subprocess.PIPE, text=True,
        ) as worker:
            with ExitStack() as active:
                active.callback(worker.terminate)
                lab.tool = json.loads(worker.stdout.readline())["origin"]
                client_tls = ssl.create_default_context(cafile=str(cert))
                clients = {
                    u: active.enter_context(httpx.Client(trust_env=False, verify=client_tls, timeout=25))
                    for u in USERS
                }
                first = clients[USERS[0]]
                meta = first.get(lab.tool + "/lti/config").json()
                check("Manual registration exposes the local tool endpoints",
                      meta["registered_platforms"] == 1 and meta["registration_mode"] == "manual" and
                      meta["target_link_uri"] == lab.tool + "/lti/launch" and meta["document_target"] == "window")
                actors = {}
                for user, client in clients.items():
                    actors[user] = launch(client, lab, user)
                    check("Open edX signed " + user.handle + " launch reaches the studio",
                          True, role=user.role, fixtureCourse=user.course, language=user.language)
                check("The tool retrieved actual Open edX public keys over TLS", lab.key_requests >= len(USERS),
                      requests=lab.key_requests)
                learner, peer, teacher, other_teacher = USERS
                check("Four pseudonymous users receive two course scopes",
                      len({a["id"] for a in actors.values()}) == 4 and
                      actors[learner]["cohort"] == actors[peer]["cohort"] == actors[teacher]["cohort"] and
                      actors[learner]["cohort"] != actors[other_teacher]["cohort"])
                raw = (ROOT / "research/bench/fixtures/melville-3000.docx").read_bytes()
                analysis = first.post(lab.tool + "/api/analyze", content=raw, headers={
                    "x-format": "docx", "x-index": "yes", "content-type": "application/octet-stream"
                })
                report = analysis.json()
                check("LTI learner submits a 3,000-word indexed DOCX",
                      analysis.status_code == 201 and report["words"] == 3000 and report["indexed"] is True,
                      fixtureSHA256=sha256(raw).hexdigest())
                path = lab.tool + "/api/reports/" + report["id"]
                for user in [learner, teacher]:
                    saved = clients[user].get(path + "/json")
                    check("Owner and course instructor retrieve identical JSON: " + user.role,
                          saved.status_code == 200 and saved.json() == report)
                for user in [peer, other_teacher]:
                    response = clients[user].get(path + "/json")
                    listing = clients[user].get(lab.tool + "/api/reports").json()["reports"]
                    check("Peer and other-course lecturer have isolated reports: " + user.role,
                          response.status_code == 404 and not listing, readHttp=response.status_code)
                for locale in ["ar", "en"]:
                    pdf = clients[teacher].get(path + "/pdf", params={"lang": locale})
                    pages = PdfReader(BytesIO(pdf.content)).pages
                    check("LTI instructor opens the " + locale + " PDF",
                          pdf.status_code == 200 and report["id"] in "".join(p.extract_text() for p in pages),
                          pages=len(pages))
                for client in clients.values():
                    assert client.post(lab.tool + "/api/logout").status_code == 200
                    assert client.get(lab.tool + "/api/me").status_code == 401
                check("Four independent LTI sessions signed out", True)
                result["courseScopes"] = 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path)
    out = parser.parse_args().out
    result = {
        "startedUTC": datetime.now(timezone.utc).isoformat(),
        "scope": "Local integration of the actual Open edX LTI Consumer XBlock and compiled Mizan Worker. "
                 "Two TLS origins, real signed launches, cookie jars and SQLite. No institutional tenant or physical device.",
        "versions": {p: version(p) for p in ["lti-consumer-xblock", "django", "PyJWT", "httpx", "pypdf"]},
        "workerSHA256": sha256((ROOT / "dist/server/index.js").read_bytes()).hexdigest(),
        "checks": [],
    }

    def check(name, success, **details):
        result["checks"].append({"name": name, "status": "passed" if success else "failed", **details})
        if not success:
            raise AssertionError(name)

    with out.open("x", encoding="utf-8") as record:
        try:
            exercise(check, result)
            result["status"] = "passed"
        except Exception as e:
            result["status"] = "failed"
            result["errorType"] = type(e).__name__
            raise
        finally:
            result["finishedUTC"] = datetime.now(timezone.utc).isoformat()
            record.write(json.dumps(result, indent=2) + "\n")
    print(len(result["checks"]), "Open edX integration checks passed")


if __name__ == "__main__":
    main()
