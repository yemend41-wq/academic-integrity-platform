const encoder = new TextEncoder();
const builtinRoles = {
  evaluator: ["instructor", "committee"],
  registrar: ["admin", "committee"],
  candidate: ["student", "committee"],
  "qa-affiliate": ["student", "other-course"],
};
const hex = (b) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join(
    "",
  );
export const hash = async (s) =>
  hex(await crypto.subtle.digest("SHA-256", encoder.encode(s)));
export const token = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export class Fault extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}
export const now = () => Math.floor(Date.now() / 1000);
export const json = (data, status = 200, headers = {}) =>
  Response.json(data, { status, headers });
export const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
export async function bounded(request, limit) {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new Fault(413, "size_limit");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    parts = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new Fault(413, "size_limit");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let pos = 0;
  for (const chunk of parts) {
    bytes.set(chunk, pos);
    pos += chunk.length;
  }
  return bytes;
}
export async function readJSON(request, limit = 8192) {
  try {
    return JSON.parse(new TextDecoder().decode(await bounded(request, limit)));
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault(400, "invalid_json");
  }
}
export async function openSession(env, principal, redirect = false) {
  const raw = token();
  await stmt(
    env,
    "INSERT INTO sessions(token,principal,expires) VALUES(?,?,?)",
    await hash(raw),
    JSON.stringify(principal),
    now() + 28800,
  ).run();
  const headers = {
    "Set-Cookie":
      "__Host-mizan=" +
      raw +
      "; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax",
  };
  return redirect
    ? new Response(null, {
        status: 303,
        headers: { ...headers, Location: "/" },
      })
    : json(principal, 200, headers);
}
function cookie(req) {
  return (req.headers.get("cookie") || "").match(
    /(?:^|;\s*)__Host-mizan=([a-f\d]{64})(?:;|$)/,
  )?.[1];
}
export async function who(env, req) {
  const key = cookie(req);
  if (!key) throw new Fault(401, "login_required");
  const rec = await stmt(
    env,
    "SELECT principal FROM sessions WHERE token=? AND expires>?",
    await hash(key),
    now(),
  ).first();
  if (!rec) throw new Fault(401, "login_required");
  return JSON.parse(rec.principal);
}
export async function logout(env, req) {
  const raw = cookie(req);
  if (raw)
    await stmt(
      env,
      "DELETE FROM sessions WHERE token=?",
      await hash(raw),
    ).run();
  return json({ ok: true }, 200, {
    "Set-Cookie":
      "__Host-mizan=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
  });
}
function eq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++)
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
async function derive(p, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(p),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: encoder.encode(salt),
        iterations: 100000,
      },
      key,
      256,
    ),
  );
}
export async function addMember(env, req, actor) {
  if (actor.role !== "admin") throw new Fault(403, "forbidden");
  const { username, role, testRun } = await readJSON(req);
  if (
    testRun !== undefined &&
    (!/^[a-z0-9]{8,20}$/.test(testRun) || role !== "student")
  )
    throw new Fault(400, "invalid_test_run");
  if (
    typeof username !== "string" ||
    !/^[a-z][a-z\d-]{3,31}$/.test(username) ||
    Object.hasOwn(builtinRoles, username) ||
    !["student", "instructor"].includes(role)
  )
    throw new Fault(400, "invalid_member");
  const password = token().slice(0, 32),
    salt = token().slice(0, 24);
  const result = await stmt(
    env,
    "INSERT OR IGNORE INTO members(username,identity,cohort,role,verifier,expires) VALUES(?,?,?,?,?,?)",
    username,
    crypto.randomUUID(),
    testRun ? "bench-" + testRun : actor.cohort,
    role,
    salt + ":" + (await derive(password, salt)),
    testRun ? now() + 86400 : 0,
  ).run();
  if (!result.meta.changes) throw new Fault(409, "username_taken");
  return json({ username, password, role }, 201);
}
export async function login(env, req) {
  const { username, password } = await readJSON(req, 4096);
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 64 ||
    password.length > 256
  )
    throw new Fault(400, "invalid_login");
  const bucket = await hash(
    (req.headers.get("cf-connecting-ip") || "local") +
      "|" +
      Math.floor(now() / 300),
  );
  const hit = await stmt(
    env,
    "INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
    bucket,
    now() + 600,
  ).first();
  if (hit.attempts > 80) throw new Fault(429, "too_many_logins");
  let principal,
    ok = false;
  if (Object.hasOwn(builtinRoles, username)) {
    const verifiers = JSON.parse(env.ACCOUNT_VERIFIERS || "{}");
    ok = eq(await hash(password), verifiers[username]);
    const [role, cohort] = builtinRoles[username];
    principal = { id: username, role, cohort, source: "workspace" };
  } else {
    const user = await stmt(
      env,
      "SELECT * FROM members WHERE username=? AND (expires=0 OR expires>?)",
      username,
      now(),
    ).first();
    const [salt, digest] = (user?.verifier || "constant-nonmember:").split(":");
    ok = eq(await derive(password, salt), digest);
    if (user)
      principal = {
        id: user.identity,
        role: user.role,
        cohort: user.cohort,
        source: "workspace",
      };
  }
  if (!principal || !ok) throw new Fault(401, "invalid_login");
  return openSession(env, principal);
}
export async function purge(env) {
  const t = now();
  await env.DB.batch(
    ["sessions", "rate_limits", "documents", "drafts"].map((table) =>
      stmt(env, "DELETE FROM " + table + " WHERE expires<=?", t),
    ),
  );
  await stmt(
    env,
    "DELETE FROM members WHERE expires>0 AND expires<=?",
    t,
  ).run();
  await stmt(env, "DELETE FROM lti_handshakes WHERE expires_at<=?", t).run();
  return { ok: true };
}
