"""Exercise normal committee access and confirm the load credential was revoked on the live site."""
import argparse
import getpass
import hashlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from pypdf import PdfReader

ORIGIN = "https://mizan-integrity-studio.yemend41.chatgpt.site"
PROJECT = Path(__file__).resolve().parents[1]


def verify(checks, name, passed, **fields):
    checks.append({"name": name, "status": "passed" if passed else "failed", **fields})
    if not passed:
        raise RuntimeError(name)


def check_access(client, credentials, checks, reference):
    def login(username, key):
        return client.post("/api/login", json={"username": username, "password": credentials[key]})

    response = login("benchmark-provisioner", "qa")
    verify(checks, "Temporary provisioner disabled", response.status_code == 401, http=response.status_code)
    response = login("review-panel", "panel")
    profile = client.get("/api/me")
    actor = profile.json()
    correct_actor = actor.get("role") == "instructor" and actor.get("cohort") == "committee-review"
    verify(checks, "Committee private login", response.status_code == profile.status_code == 200 and correct_actor,
           http=response.status_code, profileHttp=profile.status_code)
    benchmark = json.loads(reference.read_text())
    expected_hash = benchmark.get("analysisFingerprint") or benchmark["health"]["service"]["analysisFingerprint"]
    health = client.get("/api/health").json()
    verify(checks, "Published analyzer matches measured analyzer", health.get("analysisFingerprint") == expected_hash,
           analysisFingerprint=health.get("analysisFingerprint"), model=health.get("model"))


def check_report(client, fmt, checks):
    raw = (PROJECT / "research/bench/fixtures" / f"melville-3000.{fmt}").read_bytes()
    headers = {"x-index": "no", "x-format": fmt, "content-type": "application/octet-stream"}
    response = client.post("/api/analyze", headers=headers, content=raw)
    response.raise_for_status()
    report = response.json()
    report_path = "/api/reports/" + report["id"]
    stored = client.get(report_path + "/json")
    passed = response.status_code == 201 and report["words"] == 3000 and stored.status_code == 200 and stored.json() == report
    verify(checks, f"3,000-word {fmt.upper()} upload and saved JSON", passed,
           sha256=hashlib.sha256(raw).hexdigest(), uploadHttp=response.status_code, readbackHttp=stored.status_code)
    if fmt == "docx":
        for language in ("ar", "en"):
            export = client.get(report_path + "/pdf", params={"lang": language})
            export.raise_for_status()
            reader = PdfReader(io.BytesIO(export.content))
            text = "".join(page.extract_text() for page in reader.pages)
            verify(checks, language + " PDF export", report["id"] in text, pages=len(reader.pages),
                   responseSha256=hashlib.sha256(export.content).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--reference", type=Path, default=PROJECT / "evidence/release4-authenticated-public-load.json")
    args = parser.parse_args()
    credentials = json.loads(getpass.getpass("Closeout credentials: ") if sys.stdin.isatty() else sys.stdin.readline())
    checks = []
    record = {"at": datetime.now(timezone.utc).isoformat(), "origin": ORIGIN, "checks": checks}
    with args.out.open("x", encoding="utf-8") as destination:
        try:
            with httpx.Client(base_url=ORIGIN, timeout=45) as client:
                check_access(client, credentials, checks,args.reference)
                for fmt in ("docx", "pdf"):
                    check_report(client, fmt, checks)
                logout = client.post("/api/logout")
                verify(checks, "Committee logout", logout.status_code == 200 and client.get("/api/me").status_code == 401)
        finally:
            record["completedUTC"] = datetime.now(timezone.utc).isoformat()
            destination.write(json.dumps(record, indent=2) + "\n")
    print(len(checks), "checks passed")


if __name__ == "__main__":
    main()
