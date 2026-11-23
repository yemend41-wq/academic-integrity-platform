import { Fault, json, now, readJSON, stmt } from "./auth.mjs";
import { writer, upgradeHistory, PRIVACY_VERSION } from "../research/clarity/redaction.mjs";
export const blank = () => ({
  revision: 0,
  text: "",
  events: [],
  activeMs: 0,
  privacyVersion: PRIVACY_VERSION,
});
// Preserve long redacted histories below the database row budget. A mask occupies
// one UTF-16 unit but three UTF-8 bytes. Highly repetitive masks compress well.
const enc = new TextEncoder();
async function storedState(state) {
  const raw = JSON.stringify(state),
    bytes = enc.encode(raw);
  if (bytes.length <= 950000) return raw;
  let masks = 0;
  for (let i = 0; i < raw.length; i++)
    if (raw.charCodeAt(i) === 0x2588) masks++;
  if (bytes.length - 2 * masks > 950000)
    throw new Fault(413, "draft_history_limit");
  const packed = new Uint8Array(
    await new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  let binary = "";
  for (let i = 0; i < packed.length; i += 8192)
    binary += String.fromCharCode(...packed.subarray(i, i + 8192));
  const value = "gz1:" + btoa(binary);
  if (value.length > 950000) throw new Fault(413, "draft_history_limit");
  return value;
}
async function readState(value) {
  if (!value.startsWith("gz1:")) return JSON.parse(value);
  const packed = Uint8Array.from(atob(value.slice(4)), (c) => c.charCodeAt(0));
  return new Response(
    new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).json();
}
export async function getDraft(env, p) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const rec = await stmt(
      env,
      "SELECT state FROM drafts WHERE owner=? AND expires>?",
      p.id,
      now(),
    ).first();
    if (!rec) return blank();
    const old = await readState(rec.state),
      upgraded = upgradeHistory(old);
    if (!upgraded) return old;
    upgraded.revision++;
    const saved = await stmt(
      env,
      "UPDATE drafts SET state=?,revision=? WHERE owner=? AND revision=?",
      await storedState(upgraded),
      upgraded.revision,
      p.id,
      old.revision,
    ).run();
    if (saved.meta.changes) return upgraded;
  }
  throw new Fault(409, "draft_conflict");
}
export async function saveDraft(env, p, req) {
  const body = await readJSON(req, 950000),
    old = await getDraft(env, p);
  if (!Number.isInteger(body.revision) || body.revision !== old.revision)
    throw new Fault(409, "draft_conflict");
  if (
    !Array.isArray(body.events) ||
    !body.events.length ||
    body.events.length > 60
  )
    throw new Fault(400, "invalid_edits");
  if (
    body.editId !== undefined &&
    (typeof body.editId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.editId))
  )
    throw new Fault(400, "invalid_edit_id");
  if (old.events.length + body.events.length > 1800)
    throw new Fault(413, "draft_history_limit");
  const edits = writer(old);
  for (const edit of body.events) {
    if (
      typeof edit.text !== "string" ||
      edit.text.length > 90000 ||
      !["type", "paste", "delete", "replace"].includes(edit.type)
    )
      throw new Fault(400, "invalid_edits");
    const activeMs = Math.round(
      Math.min(15000, Math.max(0, Number(edit.activeMs) || 0)),
    );
    edits.append(edit.text, { kind: edit.type, at: Date.now(), activeMs });
  }
  old.revision++;
  old.privacyVersion = PRIVACY_VERSION;
  old.lastEditId = body.editId || null;
  const value = await storedState(old);
  const saved = await stmt(
    env,
    "INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,state=excluded.state,expires=excluded.expires WHERE drafts.revision=? OR drafts.expires<=?",
    p.id,
    old.revision,
    value,
    now() + 7 * 86400,
    body.revision,
    now(),
  ).run();
  if (!saved.meta.changes) throw new Fault(409, "draft_conflict");
  return json({
    revision: old.revision,
    events: old.events.length,
    activeMs: old.activeMs,
    historyRewritten: edits.requiresCanonical(),
  });
}
