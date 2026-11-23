"""Compare 14 immutable public/artificial TXT cases with the private committee panel.

Use --local-only to verify the frozen local scores without HTTP or credentials.
To exercise the hosted panel, supply only the committee password on standard input.
"""
import argparse
import hashlib
import getpass
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "https://mizan-integrity-studio.yemend41.chatgpt.site"
FROZEN = "a8bfbc6cedd3004f7f901dea370e34c932a68fcda0d7c90c925fa1630c458954"
SAFE_SCORE = {"sha256", "model", "status", "display", "eligibleWords"}
HEALTH = "/api/health"
PANEL = "/api/panel/score"


class VerificationError(Exception):
    """Only a non-sensitive category is ever printed or persisted."""


def utc():
    return datetime.now(timezone.utc).isoformat()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fixtures():
    local = subprocess.run(["node", "research/bench/open-panel-fixtures.mjs", "--payload"], cwd=ROOT,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    data = json.loads(local.stdout)
    rows = data["entries"]
    if data["commitment"] != FROZEN or len(rows) != 14:
        raise VerificationError("frozen_local_results_changed")
    ids = set()
    for row in rows:
        payload = row["text"].encode()
        expected = row["expected"]
        if (row["id"] in ids or row["bytes"] != len(payload) or sha(payload) != row["sha256"]
                or expected["sha256"] != row["sha256"] or set(expected) != SAFE_SCORE):
            raise VerificationError("fixture_integrity")
        ids.add(row["id"])
    return rows


def check_public_response(body, row, fingerprint):
    if not isinstance(body, dict):
        return False, "response_shape"
    if set(body) != SAFE_SCORE | {"analysisFingerprint"}:
        return False, "unexpected_or_missing_response_field"
    if body["analysisFingerprint"] != fingerprint:
        return False, "analysis_fingerprint_changed"
    if any(body[field] != row["expected"][field] for field in SAFE_SCORE):
        return False, "public_score_differs_from_frozen_local"
    return True, None


def run_public(rows, password, evidence):
    logged_in = False
    with httpx.Client(base_url=ORIGIN, timeout=40, follow_redirects=False) as client:
        health = client.get(HEALTH)
        evidence["healthHTTP"] = health.status_code
        if health.status_code != 200:
            raise VerificationError("health_not_available")
        fingerprint = health.json().get("analysisFingerprint")
        if not isinstance(fingerprint, str) or not re.fullmatch("[0-9a-f]{64}", fingerprint):
            raise VerificationError("invalid_health_fingerprint")
        evidence["analysisFingerprint"] = fingerprint
        try:
            auth = client.post("/api/login", json={"username": "review-panel", "password": password})
            evidence["loginHTTP"] = auth.status_code
            if auth.status_code != 200:
                raise VerificationError("committee_login_unsuccessful")
            logged_in = True
            profile = client.get("/api/me")
            actor = profile.json() if profile.status_code == 200 else {}
            if actor.get("role") != "instructor" or actor.get("cohort") != "committee-review":
                raise VerificationError("unexpected_committee_identity")
            for row, result in zip(rows, evidence["fixtures"], strict=True):
                try:
                    reply = client.post(PANEL, headers={"content-type":"application/octet-stream", "x-format":"txt"},
                                        content=row["text"].encode("utf-8"))
                    result["http"] = reply.status_code
                    if reply.status_code != 200:
                        result.update(status="failed", reason="public_score_http")
                        continue
                    ok, why = check_public_response(reply.json(), row, fingerprint)
                    result["status"] = "passed" if ok else "failed"
                    if why:
                        result["reason"] = why
                except (httpx.HTTPError, ValueError):
                    result.update(status="failed", reason="transport_or_response_decode")
        finally:
            if logged_in:
                evidence["logoutHTTP"] = client.post("/api/logout").status_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--local-only", action="store_true")
    args = parser.parse_args()
    rows = fixtures()
    evidence = {"startedUTC":utc(), "mode":"local-only" if args.local_only else "public-HTTPS",
                "origin":None if args.local_only else ORIGIN, "commitment":FROZEN,
                "scope":"Fixed open and originally authored artificial TXT cases; functional display parity only. No research corpus or student document is an input.",
                "fixtures":[]}
    for row in rows:
        result = {k:v for k,v in row.items() if k != "text"}
        result["status"] = "local-verified" if args.local_only else "unverified"
        evidence["fixtures"].append(result)
    result_status = 0
    with args.out.open("x", encoding="utf-8") as out:
        try:
            if not args.local_only:
                password = getpass.getpass("Committee password: ") if sys.stdin.isatty() else sys.stdin.readline().rstrip("\r\n")
                if not password or not 1 <= len(password) <= 256:
                    raise VerificationError("missing_or_invalid_secret_input")
                run_public(rows, password, evidence)
                if evidence.get("logoutHTTP") != 200 or any(r["status"] != "passed" for r in evidence["fixtures"]):
                    raise VerificationError("public_parity_not_verified")
            evidence["status"] = "local-controls-passed" if args.local_only else "passed"
        except VerificationError as exc:
            evidence.update(status="failed", reason=str(exc))
            result_status = 1
        except (httpx.HTTPError, ValueError):
            evidence.update(status="failed", reason="transport_or_response_decode")
            result_status = 1
        finally:
            evidence["completedUTC"] = utc()
            evidence["counts"] = dict(Counter(r["status"] for r in evidence["fixtures"]))
            out.write(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status":evidence["status"], "counts":evidence["counts"], "commitment":FROZEN}))
    return result_status


if __name__ == "__main__":
    sys.exit(main())
