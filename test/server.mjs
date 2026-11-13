// Local fixture server for tests: serves the fingerprint page, echoes request headers,
// and records reports. Never talks to anything outside this machine.
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.pdf': 'application/pdf' };

// QM and QN are user-assigned ISO region codes, used here as synthetic exits.
export function startFixtureServer({ port = 0, host = '127.0.0.1', country = 'QM', tls } = {}) {
  const reports = [];
  const requests = [];
  let waiters = [];
  const handler = async (req, res) => {
    requests.push({ url: req.url, host: req.headers.host, headers: req.headers });
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/favicon-page') return send(res, 200, '<!doctype html><title>Favicon fixture</title><link rel="icon" href="http://icon.cave.test/icon.png">', TYPES['.html']);
    if (path === '/speech-frame') {
      return send(res, 200, `<!doctype html><script>
const has = 'speechSynthesis' in window;
const initial = has ? speechSynthesis.getVoices().length : null;
setTimeout(() => {
  const afterWait = has ? speechSynthesis.getVoices().length : null;
  parent.postMessage({ type: 'speech-frame', has, initial, afterWait }, '*');
}, 800);
</script>`, TYPES['.html']);
    }
    if (path === '/icon.png') return send(res, 200, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGPQmt32nxLMMGrAqAGjBgwXAwBku0of30Lv1QAAAABJRU5ErkJggg==', 'base64'), 'image/png');
    if (path === '/slow-download') {
      const chunk = Buffer.alloc(16384, 97); let sent = 0;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="slow.bin"', 'Content-Length': chunk.length * 40, 'Cache-Control': 'no-store' });
      const timer = setInterval(() => { if (++sent === 40) { clearInterval(timer); res.end(chunk); } else res.write(chunk); }, 100);
      res.on('close', () => clearInterval(timer));
      return;
    }
    if (path === '/long-realm') {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="<b>' + 'x'.repeat(500) + '</b>"', 'Cache-Control': 'no-store' });
      return res.end('Authentication required');
    }
    if (path === '/basic') {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('cave-user:cave-secret').toString('base64')) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Cave test"', 'Cache-Control': 'no-store' }); return res.end('Authentication required'); }
      return send(res, 200, '<!doctype html><title>Authenticated</title>Authenticated', TYPES['.html']);
    }
    if (path === '/auth-subresources') return send(res, 200, '<!doctype html><title>Subresources</title><iframe src="/basic"></iframe><img src="/basic">', TYPES['.html']);
    if (path === '/headers') return send(res, 200, JSON.stringify(req.headers), 'application/json');
    if (path === '/cdn-cgi/trace') return send(res, 200, `fl=1\nh=${req.headers.host}\nip=203.0.113.7\nts=0\nloc=${server.country}\n${server.colo ? `colo=${server.colo}\n` : ''}`, 'text/plain');
    if (path === '/report' && req.method === 'POST') {
      let body = '';
      for await (const c of req) body += c;
      const r = JSON.parse(body);
      reports.push(r);
      waiters.forEach((w) => w(r));
      waiters = [];
      return send(res, 204, '');
    }
    if (path === '/setcookie') {
      // Leaves a cookie and a localStorage entry for this site, then lands on its front page.
      const [name, value] = [...new URL(req.url, 'http://x').searchParams][0];
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Set-Cookie': `${name}=${value}; Path=/; Max-Age=3600` });
      return res.end(`<script>localStorage.setItem('k', '${value}'); location.replace('/')</script>`);
    }
    if (path === '/sub.yaml') return send(res, 200, server.subscription ?? '', 'text/yaml');
    if (path === '/' ) return send(res, 200, '<!doctype html><title>Example Domain</title><h1>Example Domain</h1>', TYPES['.html']);
    try {
      const body = await readFile(join(dir, path.replace(/^\/+/, '')));
      send(res, 200, body, TYPES[extname(path)] ?? 'application/octet-stream');
    } catch {
      send(res, 404, 'not found');
    }
  };
  const server = tls ? createHttpsServer(tls, handler) : createServer(handler);
  server.country = country;
  return new Promise((resolve) =>
    server.listen(port, host, () =>
      resolve({
        server,
        port: server.address().port,
        reports,
        requests,
        nextReport: (ms = 30000) => new Promise((r, j) => { waiters.push(r); setTimeout(() => j(new Error('no report')), ms).unref(); }),
        close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }),
      }),
    ),
  );
}

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
