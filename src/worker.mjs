import {
  Fault,
  now,
  json,
  stmt,
  login,
  logout,
  who,
  openSession,
  bounded,
  readJSON,
  addMember,
  purge,
} from "./auth.mjs";
import { analyze, getReport, similarity } from "./analysis.mjs";
import { getDraft, saveDraft } from "./drafts.mjs";
import { pdfAudit } from "./report.mjs";
import { handleLti } from "../research/lti/lti.mjs";
import modelEvidence from "../research/detector/card.json";
import ltiEvidence from "../research/lti/evidence.json";
import baseline from "../evidence/initial.json";
import { asset } from "./web-assets.mjs";
const allowed = ["docx", "pdf", "png", "jpg", "jpeg", "txt"];
const visible =
  "cohort=? AND (owner=? OR ? IN ('instructor','admin')) AND expires>?";
export async function route(req, env, ctx = {}) {
  const u = new URL(req.url),
    path = u.pathname,
    m = req.method;
  if (path.startsWith("/lti/"))
    return (
      (await handleLti(req, env, {
        onLaunch: (p) => openSession(env, p, true),
      })) || json({ error: "not_found" }, 404)
    );
  if (!path.startsWith("/api/"))
    return m === "GET"
      ? asset(path)
      : json({ error: "method_not_allowed" }, 405);
  if (
    !["GET", "HEAD"].includes(m) &&
    req.headers.get("origin") &&
    req.headers.get("origin") !== u.origin
  )
    throw new Fault(403, "wrong_origin");
  if (path === "/api/health" && m === "GET") {
    const start = Date.now();
    await stmt(env, "SELECT id FROM documents LIMIT 1").first();
    return json({
      service: "Mizan",
      status: "online",
      database: "reachable",
      dbMs: Date.now() - start,
      at: new Date().toISOString(),
    });
  }
  if (path === "/api/retention" && m === "GET") {
    const row = await stmt(
      env,
      "SELECT last_success FROM housekeeping WHERE id=1",
    ).first();
    return json({ lastSuccess: row?.last_success || null, retentionDays: 7 });
  }
  if (path === "/api/retention/tick" && m === "POST") {
    // Public heartbeat may only run the fixed server retention policy. A DB lease bounds work.
    const ts = now(),
      claim = await stmt(
        env,
        "INSERT INTO housekeeping VALUES(1,?,0) ON CONFLICT(id) DO UPDATE SET last_attempt=excluded.last_attempt WHERE housekeeping.last_attempt<=? AND housekeeping.last_success<=?",
        ts,
        ts - 120,
        ts - 3600,
      ).run();
    if (claim.meta.changes) {
      await purge(env);
      await stmt(
        env,
        "UPDATE housekeeping SET last_success=? WHERE id=1",
        ts,
      ).run();
    }
    return json({ ok: true, executed: Boolean(claim.meta.changes) });
  }
  if (path === "/api/login" && m === "POST") return login(env, req);
  if (path === "/api/logout" && m === "POST") return logout(env, req);
  if (path === "/api/maintenance" && m === "POST") {
    if (
      !env.MAINTENANCE_KEY ||
      req.headers.get("authorization") !== "Bearer " + env.MAINTENANCE_KEY
    )
      throw new Fault(403, "forbidden");
    return json(await purge(env));
  }
  const p = await who(env, req);
  if (path === "/api/me" && m === "GET") return json(p);
  if (path === "/api/members" && m === "POST") return addMember(env, req, p);
  if (path === "/api/health/details" && m === "GET") {
    const row = await stmt(
      env,
      "SELECT COUNT(*) AS documents, COALESCE(SUM(words),0) AS words FROM documents WHERE " +
        visible,
      p.cohort,
      p.id,
      p.role,
      now(),
    ).first();
    return json({
      ...row,
      retentionDays: 7,
      model: modelEvidence,
      lti: ltiEvidence,
      baseline,
      runs: (
        await stmt(
          env,
          "SELECT data FROM evidence_runs ORDER BY id DESC LIMIT 12",
        ).all()
      ).results.map((x) => JSON.parse(x.data)),
    });
  }
  if (path === "/api/evidence" && m === "POST") {
    if (p.role !== "admin") throw new Fault(403, "forbidden");
    const r = await readJSON(req, 500000);
    if (
      typeof r.id !== "string" ||
      !/^[-a-zA-Z\d_]{1,64}$/.test(r.id) ||
      !Array.isArray(r.checks)
    )
      throw new Fault(400, "invalid_run");
    await stmt(
      env,
      "INSERT OR REPLACE INTO evidence_runs VALUES(?,?)",
      r.id,
      JSON.stringify(r),
    ).run();
    return json({ ok: true });
  }
  if (path === "/api/draft" && m === "GET") return json(await getDraft(env, p));
  if (path === "/api/draft" && m === "POST") return saveDraft(env, p, req);
  if (path === "/api/draft/submit" && m === "POST") {
    const b = await readJSON(req),
      d = await getDraft(env, p);
    if (b.revision !== d.revision) throw new Fault(409, "draft_conflict");
    return json(
      await analyze(env, p, {
        kind: "clarity",
        edited: d.text,
        indexed: b.index !== false,
        options: { excludeQuotes: true, excludeReferences: true },
        telemetry: {
          activeMs: d.activeMs,
          edits: d.events.length,
          bulkPastes: d.events.filter((e) => e.bulk).length,
        },
      }),
      201,
    );
  }
  if (path === "/api/analyze" && m === "POST") {
    const kind = (req.headers.get("x-format") || "").toLowerCase();
    if (!allowed.includes(kind)) throw new Fault(415, "unsupported_document");
    const bytes = await bounded(req, 8 * 1024 * 1024);
    if (!bytes.length) throw new Fault(422, "empty_document");
    return json(
      await analyze(env, p, {
        bytes,
        kind,
        indexed: req.headers.get("x-index") !== "no",
        options: {
          excludeQuotes: req.headers.get("x-quotes") !== "include",
          excludeReferences: req.headers.get("x-references") !== "include",
        },
      }),
      201,
    );
  }
  if (path === "/api/reports" && m === "GET") {
    const before = Number(u.searchParams.get("before") || now() + 1),
      last = u.searchParams.get("last") || "~";
    const rows = await stmt(
      env,
      "SELECT id,created,kind,words FROM documents WHERE " +
        visible +
        " AND (created<? OR (created=? AND id<?)) ORDER BY created DESC,id DESC LIMIT 41",
      p.cohort,
      p.id,
      p.role,
      now(),
      before,
      before,
      last,
    ).all();
    return json({
      reports: rows.results.slice(0, 40),
      more: rows.results.length > 40,
    });
  }
  const report = path.match(
    /^\/api\/reports\/([a-f\d-]{36})(?:\/(json|pdf|similarity))?$/,
  );
  if (report && m === "GET") {
    const r = await getReport(env, p, report[1]);
    if (report[2] === "pdf")
      return new Response(
        pdfAudit(r, u.searchParams.get("lang") === "ar" ? "ar" : "en"),
        {
          headers: {
            "content-type": "application/pdf",
            "content-disposition":
              'attachment; filename="Mizan-' + r.id + '.pdf"',
          },
        },
      );
    if (report[2] === "similarity")
      return json(
        await similarity(
          env,
          p,
          r.text,
          {
            excludeQuotes: u.searchParams.get("quotes") !== "include",
            excludeReferences: u.searchParams.get("references") !== "include",
          },
          r.id,
        ),
      );
    return json(
      r,
      200,
      report[2] === "json"
        ? {
            "Content-Disposition":
              'attachment; filename="Mizan-' + r.id + '.json"',
          }
        : {},
    );
  }
  throw new Fault(404, "not_found");
}
export default {
  async fetch(req, env, ctx) {
    let r;
    try {
      r = await route(req, env, ctx);
    } catch (e) {
      if (!(e instanceof Fault))
        console.error(
          "Workspace request failed",
          e.name,
          String(e.message).slice(0, 160),
        );
      r = json(
        { error: e instanceof Fault ? e.message : "service_error" },
        e.status || 503,
      );
    }
    const out = new Response(r.body, r);
    Object.entries({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
    }).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(purge(env));
  },
};
