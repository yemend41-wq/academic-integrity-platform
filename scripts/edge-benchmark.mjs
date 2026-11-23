import { Miniflare } from "miniflare";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const password = randomBytes(32).toString("hex");
const mf = new Miniflare({
  modules: [{ type: "ESModule", path: "dist/server/index.js" }],
  compatibilityDate: "2025-11-15",
  d1Databases: { DB: "mizan-edge-benchmark" },
  bindings: { ACCOUNT_VERIFIERS: JSON.stringify({ evaluator: sha(password) }) },
});
const origin = "http://mizan.local";
const checks = [],
  runs = [];
const start = new Date().toISOString();
try {
  const db = await mf.getD1Database("DB");
  for (const f of (await readdir("drizzle"))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    for (const s of (await readFile("drizzle/" + f, "utf8")).split(
      "--> statement-breakpoint",
    ))
      if (s.trim()) await db.prepare(s.trim()).run();
  const log = await mf.dispatchFetch(origin + "/api/login", {
    method: "POST",
    body: JSON.stringify({ username: "evaluator", password }),
  });
  assert.equal(log.status, 200);
  const cookie = log.headers.get("set-cookie").split(";")[0];
  const req = (path, opts = {}) =>
    mf.dispatchFetch(origin + path, {
      ...opts,
      headers: { cookie, ...opts.headers },
    });
  const fs = await Promise.all(
    ["docx", "pdf"].map(async (kind) => ({
      kind,
      bytes: await readFile("research/bench/fixtures/melville-3000." + kind),
    })),
  );
  let tick = 0;
  const normalize = (s) => s.trim().split(/\s+/).join(" "),
    expected = normalize(
      await readFile("research/bench/source/melville-excerpt.txt", "utf8"),
    );
  async function one(file) {
    const record = {
      kind: file.kind,
      sha256: sha(file.bytes),
      startMs: performance.now() - tick,
    };
    try {
      const before = performance.now(),
        r = await req("/api/analyze", {
          method: "POST",
          headers: {
            "x-format": file.kind,
            "x-index": "no",
            "content-type": "application/octet-stream",
          },
          body: file.bytes,
        });
      record.http = r.status;
      const a = await r.json();
      record.ms = performance.now() - before;
      assert.equal(r.status, 201, JSON.stringify(a).slice(0, 120));
      assert.equal(a.words, 3000);
      assert.equal(normalize(a.text), expected);
      assert.ok(a.detector.model);
      assert.ok(Array.isArray(a.similarity.matches));
      const back = await req("/api/reports/" + a.id),
        b = await back.json();
      assert.deepEqual(a, b);
      record.readback = back.status;
      record.id = a.id;
      record.ok = true;
    } catch (e) {
      record.error = e.message.slice(0, 280);
      record.ok = false;
    }
    return record;
  }
  tick = performance.now();
  for (const f of fs) {
    const r = await one(f);
    runs.push(r);
    console.log("Single", f.kind, r.ok, r.http, r.ms, r.error || "");
  }
  checks.push({
    name: "3000-word DOCX and PDF",
    status: runs.every((x) => x.ok && x.ms < 15000) ? "passed" : "failed",
    detail: runs.map((x) => x.kind + " " + Math.round(x.ms) + " ms").join(", "),
  });
  if (runs.every((x) => x.ok)) {
    tick = performance.now();
    const out = await Promise.all(
      Array.from({ length: 50 }, (_, i) => one(fs[i % 2])),
    );
    runs.push(...out);
    const ok = out.filter((x) => x.ok),
      n = new Set(ok.map((x) => x.id)).size,
      times = ok.map((x) => x.ms).sort((a, b) => a - b);
    checks.push({
      name: "50 simultaneous uploads with persisted readback",
      status: n === 50 ? "passed" : "failed",
      detail:
        n +
        "/50 distinct reports; p95 " +
        Math.round(times[Math.ceil(times.length * 0.95) - 1] || 0) +
        " ms",
      evidence: {
        accounts: 1,
        distinct: n,
        p95: times[Math.ceil(times.length * 0.95) - 1],
        max: times.at(-1),
      },
    });
  }
} catch (e) {
  checks.push({
    name: "Worker runtime",
    status: "failed",
    detail: e.message.slice(0, 500),
  });
  console.error(e.message.slice(0, 900));
} finally {
  await mf.dispose();
}
await writeFile(
  "evidence/edge-benchmark.json",
  JSON.stringify(
    {
      id: "edge-runtime",
      title: "Local Cloudflare Worker runtime",
      titleAr: "اختبار محلي بمحرك الاستضافة",
      start,
      checks,
      runs,
    },
    null,
    2,
  ),
);
console.log(checks);
