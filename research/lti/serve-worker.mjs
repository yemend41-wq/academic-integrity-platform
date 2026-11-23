// Loopback-only adapter for the compiled Worker. The Open edX test starts this process.
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { database } from '../../scripts/sqlite.mjs';
import worker from '../../dist/server/index.js';

const [cert, key, issuer] = process.argv.slice(2);
if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(issuer)) throw new Error('Expected a loopback platform origin');
const env = {
  DB: database(),
  LTI_SUBJECT_KEY: randomBytes(32).toString('hex'),
  LTI_PLATFORMS: JSON.stringify([{
    issuer, clientId: 'mizan-test', deploymentIds: ['sandbox-course-tool'],
    authUrl: issuer + '/authorize', jwksUrl: issuer + '/keys',
  }]),
};
const server = createServer({cert: readFileSync(cert), key: readFileSync(key)}, async (req, res) => {
  try {
    const origin = 'https://localhost:' + server.address().port;
    const data = {method: req.method, headers: req.headers};
    if (req.method !== 'GET' && req.method !== 'HEAD') Object.assign(data, {duplex: 'half', body: req});
    const result = await worker.fetch(new Request(new URL(req.url, origin), data), env, {});
    const headers = Object.fromEntries(result.headers);
    const cookies = result.headers.getSetCookie();
    if (cookies.length) headers['set-cookie'] = cookies;
    res.writeHead(result.status, headers);
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    res.writeHead(500).end();
  }
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({origin: 'https://localhost:' + server.address().port}) + '\n');
});
process.once('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => {env.DB.close();});
});
