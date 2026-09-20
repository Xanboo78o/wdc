// serve.mjs — a static server that never lets the browser cache anything.
//
//   node tools/serve.mjs [port]      (default 8176)  ->  /build.html
//
// python's http.server sends Last-Modified with no Cache-Control, and browsers
// are then free to reuse a module "heuristically" — which after an edit looks
// exactly like "you said you added the corner and it isn't there". Every
// response here is no-store, so a plain reload is always the current file.
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = new URL('../', import.meta.url).pathname;
const port = +(process.argv[2] || 8176);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  // gameshow.html posts its marks out of ten here. A rating that only lives in
  // the browser's localStorage is a rating the next session cannot read, and
  // the whole point of asking Adam to mark the trees is to act on the marks.
  if (req.method === 'POST' && p === '/rate') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const file = path.join(root, 'data/show/ratings.json');
        const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
        all.push(JSON.parse(body));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(all, null, 1));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400); res.end(String(e.message));
      }
    });
    return;
  }
  if (p.endsWith('/')) p += 'build.html';
  const f = path.join(root, path.normalize(p));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '0.0.0.0', () => console.log(`track builder: http://localhost:${port}/build.html`));
