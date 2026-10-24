// Minimal static server for local previews: `npm run serve` (port 4280).
// Resolves extensionless URLs to folder index files like Azure Static Web
// Apps does and serves site/404.html for unknown paths. POST /api/contact is
// answered by a mock (default), by the real handler in api/ with --api=real
// (configure it with the same environment variables as in Azure), or by
// another server with --proxy-api=<url>.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const PORT = Number(args.port || process.env.PORT || 4280);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

async function resolve(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidates = [clean, path.join(clean, 'index.html'), `${clean}.html`];
  for (const c of candidates) {
    const file = path.join(ROOT, c);
    if (!file.startsWith(ROOT)) continue;
    try {
      if ((await fs.stat(file)).isFile()) return file;
    } catch { /* try next */ }
  }
  return null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/contact') {
    let body = '';
    for await (const chunk of req) body += chunk;
    console.log('[api/contact]', req.method, body);
    if (args.api === 'real') {
      const { respond } = createRequire(import.meta.url)('../api/src/lib/contact.js');
      const out = await respond({
        method: req.method, origin: req.headers.origin, referer: req.headers.referer,
        contentType: req.headers['content-type'], client: req.socket.remoteAddress, body,
      }, process.env, undefined, console);
      res.writeHead(out.status, out.headers || { 'content-type': 'application/json' });
      res.end(out.jsonBody ? JSON.stringify(out.jsonBody) : '');
      return;
    }
    if (args['proxy-api']) {
      const r = await fetch(args['proxy-api'], { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? body : undefined });
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(await r.text());
      return;
    }
    const fail = args['api-fail'] !== undefined;
    res.writeHead(req.method !== 'POST' ? 405 : fail ? 500 : 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: !fail && req.method === 'POST' }));
    return;
  }
  const file = await resolve(url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    res.end(await fs.readFile(path.join(ROOT, '404.html')).catch(() => 'Not found'));
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(await fs.readFile(file));
}).listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
