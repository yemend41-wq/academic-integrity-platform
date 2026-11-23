"""Measure indexed uploads and durable, isolated report retrieval on the authorized Mizan origin.

Use --prompt for hidden credential entry or pass one credential line on standard input.
--preflight-only reads public health/retention and never creates users or uploads.
"""
import argparse
import asyncio
import collections
import getpass
import hashlib
import json
import math
import platform
import re
import secrets
import ssl
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "research" / "bench"))
import benchmark as fixture

WIDTH = 50
EXPECTED_HTTP = 201


class GateFailure(Exception):
    """Non-sensitive reason that a measured acceptance condition failed."""


def require(condition, reason):
    if not condition:
        raise GateFailure(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_result(response, expected, step):
    require(response.status_code == expected, f"{step}_http_{response.status_code}")
    return response.json()


def reason(exc):
    return str(exc) if isinstance(exc, GateFailure) else type(exc).__name__


def elapsed(start):
    return round((time.perf_counter() - start) * 1000, 2)


def summarize(observations):
    verified = [r for r in observations if r.get("verified")]
    times = sorted(r["uploadToCompleteReportMs"] for r in verified)
    return {
        "requested": len(observations),
        "verifiedReports": len({r["reportId"] for r in verified}),
        "errors": len(observations) - len(verified),
        "under15Seconds": sum(ms < 15000 for ms in times),
        "p95Ms": times[math.ceil(0.95 * len(times)) - 1] if times else None,
        "maxMs": max(times, default=None),
        "formats": dict(collections.Counter(r["format"] for r in observations)),
    }


async def exercise(args, result, client_args, credential):
    health = {}
    async with httpx.AsyncClient(**client_args) as admin:
        for path, key in [("/api/health", "service"), ("/api/retention", "retention")]:
            response = await admin.get(path)
            health[key] = read_result(response, 200, "preflight")
        result["health"] = health
        require(health["service"].get("status") == "online" and health["service"].get("database") == "reachable", "unhealthy")
        if args.preflight_only:
            result.update(status="unverified", reason="public_preflight_only_no_authenticated_uploads")
            return
        require(bool(credential), "no_provisioning_credential")
        profile = read_result(await admin.post("/api/login", json={"username":args.provisioner,"password":credential}), 200, "provisioner_login")
        identity = read_result(await admin.get("/api/me"), 200, "provisioner_identity")
        require(profile == identity and isinstance(profile.get("role"), str), "provisioner_identity")
        result["provisionerRole"] = profile["role"]

        key = secrets.token_hex(6)
        cohort = "bench-" + key
        gate = asyncio.Semaphore(5)
        clients = []

        async def student(i):
            async with gate:
                username = f"load-{key}-{i}"
                member = read_result(await admin.post("/api/members", json={"username": username, "role": "student", "testRun": key}), 201, "create_student")
                client = httpx.AsyncClient(**client_args)
                clients.append(client)
                user = read_result(await client.post("/api/login", json={"username": username, "password": member["password"]}), 200, "student_login")
                me = read_result(await client.get("/api/me"), 200, "student_identity")
                require(user == me and me["cohort"] == cohort and me["role"] == "student", "student_identity_or_isolation")
                return client, me["id"]

        try:
            setup = await asyncio.gather(*(student(i) for i in range(WIDTH)), return_exceptions=True)
            for item in setup:
                if isinstance(item, BaseException):
                    raise item
            distinct = len({principal for _, principal in setup})
            result["distinctAuthenticatedStudents"] = distinct
            require(distinct == WIDTH, "duplicate_principal")
            first = setup[0][0]
            seed_body = " ".join(fixture.WORD_SOURCE[50:350]).encode()
            headers = {"content-type": "application/octet-stream", "x-format": "txt", "x-index": "yes"}
            seed = read_result(await first.post("/api/analyze", content=seed_body, headers=headers), EXPECTED_HTTP, "seed")
            require(seed.get("words") == 300 and seed.get("indexed") and seed["similarity"]["cohortCompared"] == 0, "seed_preconditions")
            result["indexSeed"] = {"words": 300, "sha256": digest(seed_body), "cohortFilesBeforeSeed": 0, "preexistingPublishedSources": len(seed["similarity"]["sources"])}
            blobs = [(fixture.ROOT / "fixtures" / f["file"]).read_bytes() for f in fixture.INPUTS]
            require(all(digest(b) == f["sha256"] for b, f in zip(blobs, fixture.INPUTS)), "fixture_sha256")

            async def upload(i, client, epoch):
                start = time.perf_counter()
                item, raw = fixture.INPUTS[i % len(blobs)], blobs[i % len(blobs)]
                row = {"number": i + 1, "format": item["format"], "inputSha256": item["sha256"], "startedUTC": fixture.now(), "startOffsetMs": round((start-epoch)*1000, 2)}
                try:
                    r = await client.post("/api/analyze", content=raw, headers={**headers, "x-format": item["format"]})
                    row.update(uploadToCompleteReportMs=elapsed(start), uploadHttp=r.status_code, responseSha256=digest(r.content))
                    data = read_result(r, EXPECTED_HTTP, "upload")
                    require(fixture.report_valid(data, item) and data.get("indexed") and data.get("text", "").split() == fixture.WORD_SOURCE, "report_content")
                    require(data["detector"].get("model") == args.model, "model_identity")
                    sim = data["similarity"]
                    require(isinstance(sim.get("matches"), list) and sim["cohortCompared"] >= 1 and sim["matchedWords"] >= 250, "indexed_source_comparison")
                    row.update(cohortCompared=sim["cohortCompared"], reportedSources=len(sim["sources"]), cohortWindowLimited=sim["cohortWindowLimited"], model=data["detector"]["model"], reportId=data["id"])
                    saved = await client.get("/api/reports/" + data["id"])
                    row.update(readbackHttp=saved.status_code, throughReadbackMs=elapsed(start), readbackSha256=digest(saved.content))
                    require(read_result(saved, 200, "readback") == data, "stored_report_mismatch")
                    row["verified"] = True
                except Exception as exc:
                    row.update(verified=False, reason=reason(exc))
                return row

            # Singles and load both index files. Include the resulting index sizes in each observation.
            singles = []
            result["singles"] = singles
            for i in range(len(blobs)):
                singles.append(await upload(i, setup[i][0], time.perf_counter()))
            result["singlesSummary"] = summarize(singles)
            require(all(r["verified"] for r in singles), "single_upload_failed")
            result["indexBeforeLoad"] = {"cohortDocuments": 1 + len(singles), "publishedSources": len(seed["similarity"]["sources"])}
            barrier = asyncio.Event()
            epoch = time.perf_counter()

            async def scheduled(i, client):
                await barrier.wait()
                return await upload(i, client, epoch)

            tasks = [asyncio.create_task(scheduled(i, client)) for i, (client, _) in enumerate(setup)]
            await asyncio.sleep(0)
            epoch = time.perf_counter()
            barrier.set()
            observations = await asyncio.gather(*tasks)
            result.update(observations=observations, concurrentBatchThroughFinalReadbackMs=elapsed(epoch), loadSummary=summarize(observations))
            offsets = [r["startOffsetMs"] for r in observations]
            result["clientStartSpreadMs"] = round(max(offsets) - min(offsets), 2)
            # Each principal must be denied access to another student's report in the same cohort.
            async def denied(i):
                peer = observations[(i + 1) % WIDTH]
                return (await setup[i][0].get("/api/reports/" + peer["reportId"])).status_code if peer.get("verified") else None
            isolation = await asyncio.gather(*(denied(i) for i in range(WIDTH)))
            result["crossStudentReadbackHttp"] = dict(collections.Counter(str(code) for code in isolation))
            gates = (result["loadSummary"]["verifiedReports"] == WIDTH, isolation.count(404) == WIDTH,
                     result["loadSummary"]["under15Seconds"] == WIDTH, result["singlesSummary"]["under15Seconds"] == len(singles))
            result["status"] = "passed" if all(gates) else "failed"
        finally:
            await asyncio.gather(*(c.aclose() for c in clients))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default=fixture.PRODUCTION)
    parser.add_argument("--model", required=True)
    parser.add_argument("--release", required=True, help="Version under test (deployment ID or source revision)")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--provisioner", default="registrar")
    parser.add_argument("--worker-sha256", help="Known digest of the local Worker bundle, verified by the local runner")
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--prompt", action="store_true")
    parser.add_argument("--local-ca", type=Path)
    args = parser.parse_args()
    if not fixture.origin_allowed(args.origin) or urlsplit(args.origin).scheme != "https":
        parser.error("Use the project's HTTPS origin or an explicitly ported HTTPS loopback.")
    if args.worker_sha256 and (args.origin == fixture.PRODUCTION or not re.fullmatch(r"[0-9a-f]{64}", args.worker_sha256)):
        parser.error("Bundle digest can only be asserted by the local harness.")
    if args.local_ca and args.origin == fixture.PRODUCTION:
        parser.error("Custom CA is only supported on loopback.")
    verify = ssl.create_default_context(cafile=str(args.local_ca)) if args.local_ca else True
    client_args = {"base_url":args.origin, "verify":verify, "follow_redirects":False, "timeout":httpx.Timeout(65, connect=15), "trust_env":args.origin == fixture.PRODUCTION}
    credential = ""
    if not args.preflight_only:
        credential = getpass.getpass("Benchmark provisioner credential: ") if args.prompt else sys.stdin.readline().strip()
    result = {"origin":args.origin, "releaseUnderTest":args.release, "requiredModel":args.model, "startedUTC":fixture.now(),
              "client":{"httpx":httpx.__version__, "python":platform.python_version(), "httpVersion":"HTTP/1.1", "hardwareOrServerRegion":"not independently measured"},
              "workload":"One 300-word indexed excerpt; sequential indexed DOCX/PDF followed by 50 synchronized uploads, 25 per format, same published 3000-word excerpt. Concurrent readback uses the owner session."}
    if args.worker_sha256:
        result["localWorkerSha256"] = args.worker_sha256
    with args.out.open("x",encoding="utf8") as out:
        try:
            asyncio.run(exercise(args, result, client_args, credential))
        except Exception as exc:
            result.update(status="unverified" if not result.get("singles") else "failed", reason=reason(exc))
        result["finishedUTC"] = fixture.now()
        json.dump(result, out, indent=2, ensure_ascii=False)
        out.write("\n")
    print(json.dumps({k:result[k] for k in ("status","reason","singlesSummary","loadSummary") if k in result}))
    return 0 if result["status"] == "passed" or args.preflight_only and "health" in result else 1


if __name__ == "__main__":
    sys.exit(main())
