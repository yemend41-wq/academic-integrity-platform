/** Run the same authenticated HTTPS benchmark on a disposable local Worker and D1 database. */
import { Miniflare } from "miniflare";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [output, release, model, archive = join(root, "dist/server/index.js")] = process.argv.slice(2);
if (!(output && release && model)) throw new Error("Usage: node scripts/release4-bench-local.mjs OUTPUT RELEASE MODEL [WORKER]");
const temp = await mkdtemp(join(tmpdir(), "mizan-local-load-"));
const key = join(temp, "loopback.key"), cert = join(temp, "loopback.pem");
let mf;
try {
  execFileSync("openssl", ["req", "-x509", "-nodes", "-newkey", "rsa:2048", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-keyout", key, "-out", cert], {stdio: "ignore"});
  const credential = randomBytes(32).toString("hex");
  const worker = await readFile(resolve(archive));
  const workerDigest = createHash("sha256").update(worker).digest("hex");
  mf = new Miniflare({
    host: "127.0.0.1", port: 0, https: true, httpsKeyPath: key, httpsCertPath: cert,
    modules: [{type: "ESModule", path: join(root, "dist/server/index.js"), contents: worker.toString("utf8")}], d1Databases: {DB: "release-assessment"},
    compatibilityDate: "2025-11-15", bindings: {
      ACCOUNT_VERIFIERS: JSON.stringify({registrar: createHash("sha256").update(credential).digest("hex")}),
    },
  });
  const db = await mf.getD1Database("DB");
  const migrations = join(root, "drizzle");
  for (const file of (await readdir(migrations)).filter(f => f.endsWith(".sql")).sort()) {
    const sql = await readFile(join(migrations, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.prepare(statement.trim()).run();
    }
  }
  const probe = spawn("python", [join(root, "scripts/release4-bench.py"),
    "--origin", (await mf.ready).origin, "--local-ca", cert, "--out", resolve(output),
    "--model", model, "--release", release, "--worker-sha256", workerDigest], {stdio: ["pipe", "inherit", "inherit"]});
  probe.stdin.end(credential + "\n");
  const exitCode = await new Promise((resolve, reject) => {probe.once("error", reject); probe.once("exit", resolve);});
  process.exitCode = exitCode === 0 ? 0 : 1;
} finally {
  if (mf) await mf.dispose();
  await rm(temp, {recursive: true, force: true});
}
