// getsky.mjs — real photographic skies, and the lighting that matches them.
//
//   node tools/getsky.mjs [name|all] [--force]
//
// Poly Haven's "puresky" HDRIs are CC0 360° captures of nothing but sky, which
// is exactly right here: this sim already has its own ground, so a dome with a
// photographed horizon baked into it would fight the circuit.
//
// Three things come out of each capture, and the last two are the point:
//
//   data/sky/<name>.jpg    2048x1024 equirectangular, tone-mapped to sRGB
//   data/sky/skies.json    sun direction, sun colour, sky colour, horizon colour
//
// A sky image on its own is wallpaper. What makes a scene look photographed is
// that the DIRECTIONAL LIGHT points where the sun actually is in that photo and
// carries its colour, and that the fog matches the horizon you can see behind
// it. All three are measured out of the HDR here rather than eyeballed, so the
// shadows fall the way the clouds say they should.
//
// The HDR is decoded in Node rather than handed to ImageMagick, because the
// float pixels are needed anyway to find the sun and to choose an exposure.
// Only the finished JPG reaches the repo; the 5 MB source stays in scratch.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import os from 'os';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = ROOT + 'data/sky/';
const CACHE = path.join(os.tmpdir(), 'wdc-sky-cache');
const UA = 'wdc-racing-sim/0.1 (hobby racing sim; contact adamcoll.ac@gmail.com)';

// Three skies, and which circuit gets which. Not decoration — these are the
// conditions each of these races is actually run in. Zandvoort in late summer
// sits under North Sea overcast; Baku and Monaco are dry and clear; Monza and
// Suzuka get the broken cloud that every onboard from either place is shot in.
const SKIES = {
  clear:    { slug: 'kloofendal_43d_clear_puresky',       why: 'dry, high sun, hard shadows' },
  cloud:    { slug: 'kloofendal_48d_partly_cloudy_puresky', why: 'broken cloud, the default racing sky' },
  overcast: { slug: 'overcast_soil_puresky',                why: 'flat North Sea light, almost no shadow' },
};
const TRACK_SKY = {
  monza: 'cloud', suzuka: 'cloud', zandvoort: 'overcast', monaco: 'clear', baku: 'clear',
  nurburgring: 'overcast',   // the Eifel: grey and changeable, famously
};

// ---------------------------------------------------------------------------
// Radiance .hdr (RGBE) decoder. The format is a text header, a resolution
// line, then scanlines that are usually adaptive-RLE: a 4-byte marker
// (2, 2, width>>8, width&255) followed by four separately run-length-encoded
// component planes. Old-style flat scanlines still turn up in the wild, so
// both paths are here.
// ---------------------------------------------------------------------------
function decodeHDR(buf) {
  let p = 0;
  const line = () => {
    let s = '';
    while (p < buf.length && buf[p] !== 0x0a) s += String.fromCharCode(buf[p++]);
    p++;
    return s;
  };
  if (!line().startsWith('#?')) throw new Error('not a Radiance file');
  let l;
  while ((l = line()) !== '') { /* header lines: FORMAT=, EXPOSURE=, … */ }
  const res = line().trim().match(/-Y\s+(\d+)\s+\+X\s+(\d+)/);
  if (!res) throw new Error('unsupported scanline order: ' + l);
  const H = +res[1], W = +res[2];
  const out = new Float32Array(W * H * 3);
  const row = new Uint8Array(W * 4);

  for (let y = 0; y < H; y++) {
    if (W >= 8 && W < 32768 && buf[p] === 2 && buf[p + 1] === 2 &&
        ((buf[p + 2] << 8) | buf[p + 3]) === W) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < W) {
          let n = buf[p++];
          if (n > 128) {                       // a run of one repeated value
            const v = buf[p++];
            n -= 128;
            while (n-- > 0) row[(x++) * 4 + c] = v;
          } else {                             // a literal stretch
            while (n-- > 0) row[(x++) * 4 + c] = buf[p++];
          }
        }
      }
    } else {
      for (let x = 0; x < W; x++) {
        row[x * 4] = buf[p++]; row[x * 4 + 1] = buf[p++];
        row[x * 4 + 2] = buf[p++]; row[x * 4 + 3] = buf[p++];
      }
    }
    for (let x = 0; x < W; x++) {
      const e = row[x * 4 + 3];
      // RGBE: a shared exponent with a 128 bias, and e == 0 means black.
      const f = e ? Math.pow(2, e - 136) : 0;   // 2^(e-128) / 256
      const i = (y * W + x) * 3;
      out[i] = row[x * 4] * f;
      out[i + 1] = row[x * 4 + 1] * f;
      out[i + 2] = row[x * 4 + 2] * f;
    }
  }
  return { W, H, data: out };
}

// ---------------------------------------------------------------------------
// Equirectangular pixel <-> direction, matching three.js's `equirectUv`:
//   u = atan2(z, x) / 2pi + 0.5,  v = asin(y) / pi + 0.5
// and three flips textures vertically by default, so image row 0 is v = 1,
// which is straight up. Get that upside down and the sun lights the world from
// underneath, which looks like a broken shadow camera rather than a wrong sky.
// ---------------------------------------------------------------------------
function dirOf(px, py, W, H) {
  const u = (px + 0.5) / W, v = 1 - (py + 0.5) / H;
  const phi = (u - 0.5) * 2 * Math.PI;
  const elev = (v - 0.5) * Math.PI;
  const ce = Math.cos(elev);
  return [Math.cos(phi) * ce, Math.sin(elev), Math.sin(phi) * ce];
}

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// The sun is not one pixel — it is a disc smeared over a few dozen, and on an
// overcast capture it is a bright patch of cloud with no disc at all. So take
// the luminance-weighted centroid of everything above 60% of the peak, which
// degrades gracefully into "where the light is coming from" when there is no
// sun to find.
function findSun(img) {
  const { W, H, data } = img;
  let peak = 0;
  for (let i = 0; i < W * H; i++) {
    const L = lum(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]);
    if (L > peak) peak = L;
  }
  const cut = peak * 0.6;
  let sx = 0, sy = 0, sz = 0, wsum = 0, r = 0, g = 0, b = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const L = lum(data[i], data[i + 1], data[i + 2]);
      if (L < cut) continue;
      const d = dirOf(x, y, W, H);
      sx += d[0] * L; sy += d[1] * L; sz += d[2] * L; wsum += L;
      r += data[i]; g += data[i + 1]; b += data[i + 2];
    }
  }
  if (!wsum) return { dir: [0.4, 0.8, 0.45], colour: [1, 0.96, 0.9], peak };
  const m = Math.hypot(sx, sy, sz) || 1;
  const dir = [sx / m, sy / m, sz / m];
  // A sun below the horizon means the capture is a sunset; clamp it just above
  // so shadows still land on the ground instead of being cast from underneath.
  if (dir[1] < 0.12) {
    dir[1] = 0.12;
    const hm = Math.hypot(dir[0], dir[2]) || 1, want = Math.sqrt(1 - 0.12 * 0.12);
    dir[0] = dir[0] / hm * want; dir[2] = dir[2] / hm * want;
  }
  const mx = Math.max(r, g, b) || 1;
  return { dir: dir.map(v => +v.toFixed(4)), colour: [r / mx, g / mx, b / mx].map(v => +v.toFixed(3)), peak };
}

// The colour of the band just above the horizon: that is what the fog has to
// be, because fog is literally the sky seen through air. Picking it by hand is
// how you end up with grey haze in front of a blue sky.
//
// Per-channel MEDIAN, not mean. The mean is dragged white by the sun's glow —
// on the clear capture, whose sun sits 29 degrees up and so lights the horizon
// band it is standing in, the mean came back #ffffff, i.e. the fog would have
// been pure white in front of a blue sky. A median ignores the glow because
// most of the band is nowhere near the sun.
function bandColour(img, elev0, elev1) {
  const { W, H, data } = img;
  const y0 = Math.round((0.5 - elev1 / Math.PI) * H), y1 = Math.round((0.5 - elev0 / Math.PI) * H);
  const ch = [[], [], []];
  for (let y = Math.max(0, Math.min(y0, y1)); y < Math.min(H, Math.max(y0, y1)); y++) {
    for (let x = 0; x < W; x += 4) {
      const i = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) ch[c].push(data[i + c]);
    }
  }
  if (!ch[0].length) return [0.5, 0.6, 0.7];
  return ch.map(a => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)]; });
}

// ---------------------------------------------------------------------------
// Tone map to sRGB. Deliberately GENTLE: three.js applies ACES filmic to the
// background as well as the scene, so baking a filmic curve in here would tone
// map the sky twice and flatten it to grey mush. This does exposure plus a
// soft shoulder that only touches values heading for a clip, and leaves the
// look to the renderer.
// ---------------------------------------------------------------------------
const shoulder = v => v > 0.8 ? 0.8 + (v - 0.8) / (1 + (v - 0.8) * 1.6) : v;
const encSRGB = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const byteOf = (v, exposure) => Math.round(Math.max(0, Math.min(1, encSRGB(shoulder(v * exposure)))) * 255);
const hexOf = (rgb, exposure) =>
  '#' + rgb.map(v => byteOf(v, exposure).toString(16).padStart(2, '0')).join('');

function toneMap(img, exposure) {
  const { W, H, data } = img;
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) out[i * 3 + c] = byteOf(data[i * 3 + c], exposure);
  }
  return out;
}

// Exposure, from the median luminance of the whole sphere.
//
// Median, not mean: the mean lets one sun disc set the exposure for an entire
// photograph. Whole sphere, not upper hemisphere: metering on the zenith alone
// deepened the blue of the clear sky, which sounds like an improvement, but it
// also dropped the overcast capture to a dark charcoal, because the bright
// cloud deck IS its zenith. The renderer applies ACES on top of this, so the
// source wants to sit slightly bright and let the filmic curve take it down.
function medianLum(img) {
  const s = [];
  for (let i = 0; i < img.W * img.H; i += 17) s.push(lum(img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]));
  s.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 0.2;
}

function resample(img, W2, H2) {
  const { W, H, data } = img;
  const out = new Float32Array(W2 * H2 * 3);
  const bx = W / W2, by = H / H2;
  for (let y = 0; y < H2; y++) {
    const y0 = Math.floor(y * by), y1 = Math.max(y0 + 1, Math.floor((y + 1) * by));
    for (let x = 0; x < W2; x++) {
      const x0 = Math.floor(x * bx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * bx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 3;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      const o = (y * W2 + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { W: W2, H: H2, data: out };
}

// ---------------------------------------------------------------------------
async function grab(name, spec, force) {
  fs.mkdirSync(CACHE, { recursive: true });
  const hdr = path.join(CACHE, `${spec.slug}_2k.hdr`);
  if (force || !fs.existsSync(hdr) || fs.statSync(hdr).size < 100000) {
    const files = await (await fetch(`https://api.polyhaven.com/files/${spec.slug}`, { headers: { 'User-Agent': UA } })).json();
    const url = files?.hdri?.['2k']?.hdr?.url;
    if (!url) throw new Error(`${spec.slug}: no 2k .hdr on Poly Haven`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} downloading ${spec.slug}`);
    fs.writeFileSync(hdr, Buffer.from(await res.arrayBuffer()));
  }

  const img = decodeHDR(fs.readFileSync(hdr));
  const sun = findSun(img);
  const med = medianLum(img);
  const exposure = 0.24 / med;
  // Measured off the capture, not chosen: sky is the dome overhead, horizon is
  // the band the fog has to match. Both come back through the SAME tone map the
  // image gets, as hex, because their job is to agree with the pixels the eye
  // sees rather than with the float values behind them. Without the shoulder a
  // bright horizon lands at 1.9 and every consumer has to clamp it itself.
  const skyC = hexOf(bandColour(img, 0.6, 1.4), exposure);
  const horC = hexOf(bandColour(img, -0.02, 0.10), exposure);
  // How hard are the shadows? The sun's peak against the median sky, which is
  // ~1 under flat overcast and hundreds under a clear sky. This is what stops
  // Zandvoort casting Baku's shadows.
  const punch = +Math.min(1, Math.log10(Math.max(1, sun.peak / med)) / 2.6).toFixed(3);

  const small = resample(img, 2048, 1024);
  const rgb = toneMap(small, exposure);
  const ppm = path.join(CACHE, `${name}.ppm`);
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n2048 1024\n255\n`), rgb]));
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync('magick', [ppm, '-quality', '84', '-sampling-factor', '4:2:0', '-strip', `${OUT}${name}.jpg`]);

  const kb = Math.round(fs.statSync(`${OUT}${name}.jpg`).size / 1024);
  const elev = (Math.asin(sun.dir[1]) * 180 / Math.PI).toFixed(0);
  console.log(`  ${name.padEnd(9)} ${spec.slug.padEnd(38)} ${String(kb).padStart(4)}K  sun ${elev}° up  punch ${punch}  sky ${skyC}  horizon ${horC}`);
  return {
    name, slug: spec.slug, why: spec.why,
    sun: sun.dir,                                    // unit vector, three.js axes
    sunColour: '#' + sun.colour.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''),
    punch,                                           // 0 = flat overcast, 1 = hard sun
    sky: skyC, horizon: horC,                        // tone-mapped sRGB hex
  };
}

const want = (process.argv[2] && process.argv[2] !== 'all') ? [process.argv[2]] : Object.keys(SKIES);
const force = process.argv.includes('--force');

const meta = { tracks: TRACK_SKY, skies: {} };
const prev = fs.existsSync(OUT + 'skies.json') ? JSON.parse(fs.readFileSync(OUT + 'skies.json', 'utf8')) : null;
if (prev) meta.skies = prev.skies || {};
for (const name of want) {
  if (!SKIES[name]) { console.error(`no sky called ${name} — have: ${Object.keys(SKIES).join(', ')}`); process.exit(1); }
  process.stdout.write(`${name}… \r`);
  meta.skies[name] = await grab(name, SKIES[name], force);
}
fs.writeFileSync(OUT + 'skies.json', JSON.stringify(meta, null, 1));

fs.writeFileSync(OUT + 'SOURCE.md', `# Where these skies came from

Every \`.jpg\` here is a tone-mapped 2048x1024 equirectangular crop of a
**CC0 1.0** HDRI from **Poly Haven** — https://polyhaven.com/hdris. Public
domain, no attribution required, safe on public GitHub Pages.

| file | Poly Haven HDRI | used for |
|---|---|---|
${Object.entries(SKIES).map(([n, s]) => `| \`${n}.jpg\` | [${s.slug}](https://polyhaven.com/a/${s.slug}) | ${s.why} |`).join('\n')}

\`skies.json\` is the part that matters. For each sky it stores the **measured**
sun direction and colour, the overhead sky colour and the horizon colour, all
read out of the original HDR's float pixels by \`tools/getsky.mjs\`. The
renderer points its directional light along that vector and tints the fog with
that horizon, so the shadows agree with the clouds you can see and the haze
agrees with the sky behind it.

Refetch with \`node tools/getsky.mjs [name|all] [--force]\`.
`);
console.log(`\n${want.length} skies in data/sky/ (sun vectors and fog colours in skies.json)`);
