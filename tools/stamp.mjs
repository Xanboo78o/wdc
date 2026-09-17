// stamp.mjs — cache-bust every local module on the way into a commit.
//
// The problem this solves is specific and has bitten this laptop before: after
// a push, a plain reload of a GitHub Pages site fetches the new index.html but
// serves JS from a ~10-minute cache. You then get new HTML running old modules,
// which presents as "you didn't add the thing you said you added" — and sends
// you hunting a bug that does not exist.
//
// Import maps remap URL-like specifiers against the DOCUMENT base, so mapping
// "./js/foo.js" -> "./js/foo.js?v=N" versions the entire module graph without
// touching a single import statement in a single source file. Vendored three is
// included because three.module.min.js pulls three.core.min.js by relative path,
// and that resolves to the same URL the map keys on.
import fs from 'fs';

const root = new URL('../', import.meta.url).pathname;
const v = process.argv[2] || String(Date.now());

const mods = fs.readdirSync(root + 'js').filter(f => f.endsWith('.js')).map(f => `./js/${f}`);
const vendor = fs.readdirSync(root + 'js/vendor').filter(f => f.endsWith('.js')).map(f => `./js/vendor/${f}`);

const imports = { three: `./js/vendor/three.module.min.js?v=${v}` };
for (const m of [...mods, ...vendor]) imports[m] = `${m}?v=${v}`;
const map = `<script type="importmap">\n${JSON.stringify({ imports }, null, 1)}\n</script>`;

let html = fs.readFileSync(root + 'index.html', 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, map);
html = html.replace(/<script type="module" src="\.\/js\/main\.js[^"]*"><\/script>/,
  `<script type="module" src="./js/main.js?v=${v}"></script>`);
fs.writeFileSync(root + 'index.html', html);
console.log(`stamped v=${v} across ${mods.length + vendor.length} modules`);
