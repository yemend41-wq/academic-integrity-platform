import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { database } from "./sqlite.mjs";
import { openSession } from "../src/auth.mjs";
import worker from "../dist/server/index.js";
const env = {
  DB: database(process.env.TEST_DB || ":memory:"),
  ACCOUNT_VERIFIERS: process.env.ACCOUNT_VERIFIERS || "{}",
};
const server = createServer(async (req, res) => {
  try {
    const url = "http://" + (req.headers.host || "localhost") + req.url;
    if (!process.env.TEST_DB && req.url.startsWith('/__qa/')) {
      if(req.url==='/__qa/start'){
        const session=await openSession(env,{id:crypto.randomUUID(),cohort:'dev-only',role:'instructor',source:'ui-test'});
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Set-Cookie':session.headers.get('Set-Cookie')});
        res.end('<!doctype html><meta charset=utf-8><title>Browser integration checks</title><h1>Browser integration checks</h1><button>Run both viewports</button><pre></pre><iframe title="Application under test"></iframe><script src="/__qa/runner.js"></script>');return;
      }
      if(req.url==='/__qa/runner.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(readFileSync('test/browser-runner.js'));return;}
      if(req.url==='/__qa/passage'){res.writeHead(200,{'Content-Type':'text/plain'});res.end(readFileSync('research/bench/source/melville-excerpt.txt','utf8').split(/\s+/).slice(12,42).join(' '));return;}
      if(req.url==='/__qa/fixture'){res.writeHead(200,{'Content-Type':'application/octet-stream'});res.end(readFileSync('research/bench/fixtures/melville-3000.docx'));return;}
      if(req.url==='/__qa/results'&&req.method==='POST'){let raw='';for await(const b of req){raw+=b;if(raw.length>15000)throw Error('Result too large');}const checks=JSON.parse(raw);writeFileSync(process.env.MIZAN_BROWSER_EVIDENCE || '/tmp/mizan-r6-browser.json',JSON.stringify({at:new Date().toISOString(),environment:'Chrome via managed local preview; actual SQLite workspace and ephemeral test principal',checks},null,2));res.writeHead(204);res.end();return;}
    }
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      ...(!["GET", "HEAD"].includes(req.method)
        ? { duplex: "half", body: req }
        : {}),
    });
    const result = await worker.fetch(request, env, {
      waitUntil: (p) => p.catch(() => {}),
    });
    const headers=Object.fromEntries(result.headers);
    if (!process.env.TEST_DB) headers['content-security-policy']=headers['content-security-policy']?.replace("frame-ancestors 'none'","frame-ancestors 'self'");
    res.writeHead(result.status,headers);
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
const arg = (k) =>
  process.argv.includes(k)
    ? process.argv[process.argv.indexOf(k) + 1]
    : undefined;
server.listen(
  Number(arg("--port") || process.env.PORT || 5173),
  arg("--host") || "127.0.0.1",
);
