import { inspectFile } from "../research/media/index.mjs";
import { verifyReferences } from "../research/media/citations.mjs";
import { analyzeWriting } from "./writing-analysis.mjs";
import { compareDocument, PUBLIC_SOURCES } from "../research/similarity/engine.mjs";
import { maskPII, cleanEvidence } from "./privacy.mjs";
import {encodeReport, decodeReport} from "./report-storage.mjs";
import { Fault, now, stmt } from "./auth.mjs";
export const wordCount = (s) =>
  (s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
export async function getReport(env, p, id) {
  const row = await stmt(
    env,
    "SELECT * FROM documents WHERE id=? AND expires>? AND cohort=? AND (owner=? OR ? IN ('instructor','admin'))",
    id,
    now(),
    p.cohort,
    p.id,
    p.role,
  ).first();
  if (!row) throw new Fault(404, "not_found");
  const report = await decodeReport(row.audit);
  if (report.privacyVersion !== 4) {
    report.text = maskPII(report.text);
    report.forensics = cleanEvidence(report.forensics);
    report.provenance = cleanEvidence(report.provenance);
    report.citations = cleanEvidence(report.citations);
    for (const match of report.similarity?.matches || []) {
      if (match.sourceExcerpt) match.sourceExcerpt = maskPII(match.sourceExcerpt);
    }
    report.privacyVersion = 4;
    await stmt(env,
      "UPDATE documents SET body=?,audit=? WHERE id=? AND expires>? AND COALESCE(json_extract(audit,'$.privacyVersion'),0)<4",
      report.text, JSON.stringify(report), id, now()
    ).run();
  }
  return report;
}
export async function sources(env, p, omit = "") {
  const { results } = await stmt(
    env,
    "SELECT id,kind,body AS text FROM documents WHERE cohort=? AND indexed=1 AND expires>? AND id<>? ORDER BY created DESC,id DESC LIMIT 101",
    p.cohort,
    now(),
    omit,
  ).all();
  let chars = 0;
  const members = [];
  for (const row of results.slice(0, 100)) {
    if (chars + row.text.length > 700000) break;
    chars += row.text.length;
    members.push({
      id: row.id,
      title: "Submission " + row.id.slice(0, 8),
      kind: "cohort",
      text: maskPII(row.text),
    });
  }
  return { members, limited: members.length < results.length };
}
export async function similarity(env, p, body, options, id) {
  const corpus = await sources(env, p, id);
  const out = compareDocument(body, corpus.members, options);
  const sourceById = new Map([...PUBLIC_SOURCES, ...corpus.members].map((m) => [m.id, m.text]));
  const matches = out.matches.map((m) => {
    if (!sourceById.has(m.sourceId)) return m;
    const source = sourceById.get(m.sourceId);
    // Disclose only the matched redacted passage, up to 400 characters.
    return {
      ...m,
      sourceExcerpt: source.slice(
        m.sourceStart,
        Math.min(m.sourceEnd, m.sourceStart + 400),
      ),
    };
  });
  return {
    ...out,
    matches,
    cohortCompared: corpus.members.length,
    cohortWindowLimited: corpus.limited,
  };
}
async function readSubmission({bytes, kind, edited}) {
  let inspection;
  if (edited !== undefined)
    inspection = {
      text: edited,
      format: "clarity",
      forensics: { origin: "editor" },
      provenance: { status: "not_applicable" },
    };
  else if (kind === "txt") {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Fault(422, "invalid_text");
    }
    if (text.includes("\0")) throw new Fault(422, "invalid_text");
    inspection = {
      text,
      format: "txt",
      forensics: { encoding: "UTF-8", bytes: bytes.length },
      provenance: { status: "not_applicable" },
    };
  } else {
    try {
      inspection = await inspectFile(bytes, "submission." + kind);
    } catch (e) {
      console.warn(
        "Document parse rejected",
        String(e.message)
          .slice(0, 90)
          .replace(/[^a-z0-9 _-]/gi, ""),
      );
      throw new Fault(422, "unsupported_document");
    }
  }
  const text = maskPII(inspection.text || "");
  if (text.length > 100000) throw new Fault(413, "text_limit");
  if (!text.trim() && ["txt", "clarity"].includes(kind))
    throw new Fault(422, "empty_text");
  const fmt = String(inspection.format || kind).toLowerCase();
  if (
    kind !== "clarity" &&
    !(
      fmt === kind ||
      (kind === "jpg" && fmt === "jpeg") ||
      (kind === "jpeg" && fmt === "jpg")
    )
  )
    throw new Fault(422, "format_mismatch");
  const writingText = inspection.writingText == null ? text : maskPII(inspection.writingText);
  return {text, writingText, fmt, inspection};
}

export async function blindWritingScore(bytes, kind) {
  const {writingText, fmt, inspection} = await readSubmission({bytes, kind});
  const {model, status, display, eligibleWords} = analyzeWriting(writingText, fmt, inspection.forensics);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  return {sha256, model, status, display, eligibleWords};
}

export async function analyze(
  env,
  p,
  {bytes, kind, edited, indexed, options, telemetry},
) {
  const start = Date.now();
  const {text, writingText, fmt, inspection} = await readSubmission({bytes, kind, edited});
  const [sim, refs] = await Promise.all([
    similarity(env, p, text, options, ""),
    verifyReferences(text),
  ]);
  const detection = analyzeWriting(writingText, fmt, inspection.forensics);
  const id = crypto.randomUUID(),
    created = now(),
    words = wordCount(text);
  const audit = {
    id,
    privacyVersion: 4,
    created,
    expires: created + 7 * 86400,
    format: fmt,
    words,
    text,
    indexed,
    similarity: sim,
    detector: detection,
    ...(writingText !== text && writingText.length <= 100000 ? {writingText} : {}),
    forensics: cleanEvidence(inspection.forensics),
    provenance: cleanEvidence(inspection.provenance),
    citations: cleanEvidence(refs),
    telemetry: telemetry || null,
    options,
    elapsedMs: Date.now() - start,
  };
  const encoded = await encodeReport(audit);
  if (encoded === null)
    throw new Fault(413, "report_limit");
  await stmt(
    env,
    "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)",
    id,
    p.id,
    p.cohort,
    created,
    audit.expires,
    indexed ? 1 : 0,
    fmt,
    words,
    text,
    encoded,
  ).run();
  return audit;
}
