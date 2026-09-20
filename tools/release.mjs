// release.mjs — make the site installable, and make it know when it is stale.
//
//   node tools/release.mjs [--no-icons]
//
// Adam: "alr make it a app i can downlaod and updates automatically". This is
// that, without a 150 MB Electron bundle and without a download at all: the
// site on GitHub Pages declares itself an app (manifest.webmanifest), Chromium
// offers to install it, and it gets a window and a desktop entry of its own.
// An installed page is still a page, so a push to master IS the update — there
// is no store, no installer and nothing for him to click twice.
//
// What this tool writes:
//   version.json   the build id (git sha + date) and the list of files the
//                  service worker should have offline. The app polls it, and
//                  a change is what "there is a new version" MEANS.
//   icon-*.png     the app icon, drawn from the ACTUAL track — the outline of
//                  data/build/pieces.js as it stands at this commit. The icon
//                  changes shape as he builds the circuit, which is the best
//                  argument for generating it rather than drawing one.
//
// Not included in the offline set: data/env (12 MB of OSM buildings for the
// five real circuits). It is fetched on demand and cached when it is used —
// an app you install should not cost twelve megabytes of someone else's city
// before it will open.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
for (const a of args) if (a !== '--no-icons') { console.error(`unknown flag ${a}`); process.exit(2); }

const sh = (cmd, a) => execFileSync(cmd, a, { cwd: ROOT }).toString().trim();
const sha = sh('git', ['rev-parse', '--short', 'HEAD']);
// The version is the COMMIT, not the working tree. Two releases cut from the
// same commit are the same release, and a `+` that is always there (this is a
// shared checkout — something is always dirty) says nothing.
const dirty = sh('git', ['status', '--porcelain']).split('\n').filter(Boolean);
const version = sha;
// What changed, in the words of whoever changed it. A version string nobody
// can read is a version string nobody checks.
const note = sh('git', ['log', '-1', '--pretty=%s']);

// --- what the app needs to run with the network off ------------------------
const PRECACHE_DIRS = ['js', 'data/tex', 'data/flora', 'data/sky', 'data/build', 'data/aero', 'data/surf', 'data/audio', 'data/elev', 'data/chassis'];
const PRECACHE_FILES = ['app.html', 'build.html', 'gameshow.html', 'index.html', 'style.css', 'manifest.webmanifest'];
const SKIP = /\.(md|mjs)$|^tools\//;

function walk(dir, into = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return into;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, into);
    else if (!SKIP.test(rel)) into.push(rel);
  }
  return into;
}

const files = [...PRECACHE_FILES.filter(f => fs.existsSync(path.join(ROOT, f)))];
for (const d of PRECACHE_DIRS) walk(d, files);
// data/tracks is the five real circuits; the game needs them, and they are
// 400 KB between them.
walk('data/tracks', files);

const bytes = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);

fs.writeFileSync(path.join(ROOT, 'version.json'), JSON.stringify({
  version, note, built: new Date().toISOString(), files,
}, null, 1) + '\n');

// --- the icon: this track, at this commit ----------------------------------
async function icons() {
  const { buildPath } = await import(path.join(ROOT, 'js/build/path.js'));
  const { PIECES, TRACK } = await import(path.join(ROOT, 'data/build/pieces.js'));
  const p = buildPath(PIECES, { closed: !!TRACK.closed });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.n; i++) {
    x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]);
    y0 = Math.min(y0, p.y[i]); y1 = Math.max(y1, p.y[i]);
  }
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const pts = (size, pad) => {
    const s = (size - pad * 2) / span;
    const ox = pad + ((span - (x1 - x0)) * s) / 2, oy = pad + ((span - (y1 - y0)) * s) / 2;
    const out = [];
    for (let i = 0; i < p.n; i += 2) {
      // sim y is LEFT, and an image's y runs down: one flip, in one place.
      out.push(`${(ox + (p.x[i] - x0) * s).toFixed(1)},${(size - oy - (p.y[i] - y0) * s).toFixed(1)}`);
    }
    return out.join(' ');
  };
  for (const [size, pad, name] of [[512, 96, 'icon-512.png'], [192, 36, 'icon-192.png'], [512, 130, 'icon-maskable.png']]) {
    execFileSync('magick', ['-size', `${size}x${size}`, 'xc:#0b0d10',
      '-stroke', '#e8eaee', '-strokewidth', String(Math.max(3, size / 42)), '-fill', 'none',
      '-draw', `polyline ${pts(size, pad)}`,
      '-stroke', '#35d6a0', '-strokewidth', String(Math.max(2, size / 64)),
      '-draw', `polyline ${pts(size, pad)}`,
      path.join(ROOT, name)], { cwd: ROOT });
  }
  return `${p.pieces.length} pieces, ${(p.length / 1000).toFixed(2)} km`;
}

let shape = 'skipped';
if (!args.includes('--no-icons')) {
  try { shape = await icons(); } catch (e) { shape = `FAILED: ${e.message}`; }
}

console.log(`version   ${version}${dirty.length ? `   (${dirty.length} files dirty — this names HEAD, not them)` : ''}`);
console.log(`offline   ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
console.log(`icon      ${shape}`);
const auto = fs.existsSync(path.join(ROOT, '.github/workflows/stamp.yml'));
console.log(`\nversion.json written — COMMIT IT WITH THE RELEASE, or the installed app`);
console.log(`will run your new code without ever saying anything changed.`);
if (!auto) {
  console.log(`\nThis is still a manual step: tools/ci/stamp.yml would do it on every`);
  console.log(`push, but it is NOT installed — pushing a workflow file needs a scope`);
  console.log(`this machine's gh login does not have:`);
  console.log(`    gh auth refresh -h github.com -s workflow`);
  console.log(`    mkdir -p .github/workflows && cp tools/ci/stamp.yml .github/workflows/`);
}
