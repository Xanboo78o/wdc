// synthpit.mjs — a pit lane for a circuit that was drawn without one.
//
//   node tools/synthpit.mjs <key> [--side L|R] [--len 420] [--offset 16] [--at <s>] [--dry]
//
// Adam, 2026-10-04: "make pit lanes". His own circuits (adam1, kate, kate2,
// street) come out of tools/importtrack.mjs with `pit: null`, which is honest
// — nobody surveyed a lane — and means no garages, no stops, no safety car
// (race control needs a lane to send it out of). The real circuits carry the
// lane OpenStreetMap has; Monaco's, where OSM has none, was synthesised by
// DIRTY AIR's bake alongside the start straight. This does the same for any
// circuit, by the same rule, and says so in the data: `pit.synth: true`.
//
// WHERE. The straight that contains the start/finish line, or the nearest one
// long enough to hold a row of garages; the lane runs parallel to it on the
// INSIDE of the circuit (--side overrides), `offset` metres from the
// centreline, and straddles the line the way a real pit straight does.
//
// WHAT THE RACE NEEDS (js/pitstop.js). A lane there is an entry and an exit
// distance along the lap plus ONE lateral offset, eased in over the first 10%
// and out over the last 12% (laneLat). So the polyline written here is the
// centreline pushed sideways by exactly that profile from the edge of the
// road outward — the garages js/pit.js draws on it and the marks the race
// stops cars at (garageLayout) are then the same places.
//
// IT REFUSES rather than guess: if the lane, or the garages behind it, would
// sit on ground another stretch of the lap drives over (Track.shareWalls has
// already narrowed overlapping run-offs at load, and this honours it), it
// tries the other side, then the next straight, and exits non-zero with the
// reason if nothing fits.
//
// THE ONE OTHER THING IT CHANGES: the barrier stands at w + run, and a lane
// further out than that is sealed behind a wall. So `runL`/`runR` are widened
// ON THE PIT SIDE, ALONG THE LANE ONLY, to lane + 4.5 m — the rule
// tools/bakereal.mjs uses. Everything else in the file is left byte for byte.
import fs from 'fs';
import { Track } from '../js/track.js';
import { makeLane, garageLayout, BOX_PITCH } from '../js/pitstop.js';

const ROOT = new URL('../', import.meta.url).pathname;
const args = process.argv.slice(2);
const VALUE = new Set(['side', 'len', 'offset', 'at']), BOOL = new Set(['dry']);
const opt = {}; let key = null;
for (let k = 0; k < args.length; k++) {
  const a = args[k];
  if (a.startsWith('--')) {
    const n = a.slice(2);
    if (BOOL.has(n)) { opt[n] = true; continue; }
    if (!VALUE.has(n) || args[k + 1] == null) { console.error(`synthpit: unknown or incomplete flag ${a} (know --side L|R --len m --offset m --at s --dry)`); process.exit(2); }
    if (n in opt) { console.error(`synthpit: ${a} given twice`); process.exit(2); }
    opt[n] = args[++k];
  } else if (key == null) key = a;
  else { console.error(`synthpit: stray argument ${a}`); process.exit(2); }
}
if (!key) { console.error('usage: node tools/synthpit.mjs <key> [--side L|R] [--len 420] [--offset 16] [--at s] [--dry]'); process.exit(2); }
if (opt.side != null && !/^[LR]$/i.test(opt.side)) { console.error('synthpit: --side is L or R'); process.exit(2); }
const file = `${ROOT}data/tracks/${key}.json`;
if (!fs.existsSync(file)) { console.error(`synthpit: no ${file}`); process.exit(2); }

const text = fs.readFileSync(file, 'utf8');
const raw = JSON.parse(text);
if (raw.pit && !raw.pit.synth) { console.error(`synthpit: ${key} has a SURVEYED pit lane; this tool only writes synthetic ones`); process.exit(1); }
if (raw.open) { console.error(`synthpit: ${key} is an open stage, it has no lap to pit on`); process.exit(1); }
// Judge the ground WITHOUT any lane this tool wrote earlier, so a re-run is
// the same decision as the first run.
const t = new Track({ ...JSON.parse(text), pit: null });
const n = t.n, ds = t.ds, L = t.length;
const wrapI = i => ((i % n) + n) % n;

const LEN = Math.max(200, +(opt.len ?? 420));
const LANE_TRACK = 5.6, LANE_BOX = 6.6, GARAGE_DEPTH = 13.0;      // js/pit.js
const wMax = Math.max(...t.w);
// Far enough out that the lane's own track-side edge and a pit wall clear the
// road: Monza's surveyed lane is 11.5 m beyond the edge of the asphalt.
const OFFSET = Math.max(+(opt.offset ?? 16), wMax + LANE_TRACK + 2);
const IN = 0.10, OUT = 0.88, ease = u => u * u * (3 - 2 * u);
const profile = p => p < IN ? ease(Math.max(0, p) / IN) : p > OUT ? ease(Math.max(0, (1 - p) / (1 - OUT))) : 1;

// ---- the straights ----------------------------------------------------------
const straight = j => Math.abs(t.curv[wrapI(j)]) < 0.002;
const runs = [];
{
  let s0 = 0; while (s0 < n && straight(s0)) s0++;
  if (s0 >= n) s0 = 0;
  for (let c = 0; c < n;) {
    const j = wrapI(s0 + c);
    if (!straight(j)) { c++; continue; }
    let k = 0; while (k < n && straight(j + k)) k++;
    runs.push({ i0: j, len: k * ds });
    c += k;
  }
}
const distTo0 = r => {               // metres from the start/finish line to this straight (0 if it is on it)
  const a = r.i0 * ds, b = a + r.len;
  if (b >= L || a === 0) return 0;
  return Math.min(a, L - b);
};
const MINLEN = 12 * BOX_PITCH + 20;
let cands = runs.filter(r => r.len >= MINLEN);
if (!cands.length) cands = runs.slice().sort((a, b) => b.len - a.len).slice(0, 3);
cands.sort((a, b) => (distTo0(a) - distTo0(b)) || (b.len - a.len));
// ...and, only if none of those has room, the shorter straights with a
// shorter lane and fewer garages (a small circuit folded tightly on itself).
const shorter = runs.filter(r => r.len >= 80 && !cands.includes(r)).sort((a, b) => b.len - a.len);

// The inside of the circuit, seen from a place on it: the side its middle is on.
const cx = t.x.reduce((a, v) => a + v, 0) / n, cy = t.y.reduce((a, v) => a + v, 0) / n;
const insideAt = i => { const h = t.hdg[i]; return Math.sign(-Math.sin(h) * (cx - t.x[i]) + Math.cos(h) * (cy - t.y[i])) || 1; };

// ---- one candidate lane -----------------------------------------------------
function build(run, side, atS) {
  const len = Math.min(LEN, Math.max(200, run.len + 160));
  const a = run.i0 * ds, b = a + run.len;
  // Centred on the start/finish line if the straight holds it, else on the
  // straight's own middle; --at puts the middle where you say.
  let mid = atS != null ? atS : (distTo0(run) === 0 ? (b >= L ? L : 0) : (a + b) / 2);
  if (atS == null && run.len > len) mid = Math.max(a + len / 2, Math.min(b - len / 2, mid < a ? mid + L : mid));
  const entry = mid - len / 2;
  const pts = [], lats = [];
  for (let u = 0; u <= len + 1e-6; u += 4) {
    const s = entry + u, i = wrapI(Math.round(s / ds)), h = t.hdg[i];
    const lat = t.w[i] + (OFFSET - t.w[i]) * profile(u / len);
    pts.push([+(t.x[i] - Math.sin(h) * side * lat).toFixed(2), +(t.y[i] + Math.cos(h) * side * lat).toFixed(2)]);
    lats.push({ i, lat, u });
  }
  return { run, side, len, entryS: Math.round(t.wrap(entry)), exitS: Math.round(t.wrap(entry + len)), pts, lats };
}

// Is this lane on ground another stretch of the lap uses? Tested at the lane
// centre and, along the garages, at the back wall of the garage block.
function conflict(c) {
  const far = Math.round(150 / ds);
  for (const { i, lat, u } of c.lats) {
    const p = u / c.len, mid = p > 0.2 && p < 0.8;
    const reach = [lat, lat + LANE_BOX].concat(mid ? [lat + LANE_BOX + GARAGE_DEPTH + 1.2] : []);
    for (const r of reach) {
      const h = t.hdg[i], x = t.x[i] - Math.sin(h) * c.side * r, y = t.y[i] + Math.cos(h) * c.side * r;
      for (let j = 0; j < n; j += 2) {
        const along = Math.abs(j - i);
        if (Math.min(along, n - along) < far) continue;
        const dx = x - t.x[j], dy = y - t.y[j];
        if (dx * dx + dy * dy > 70 * 70) continue;
        const hj = t.hdg[j], al = Math.cos(hj) * dx + Math.sin(hj) * dy;
        if (Math.abs(al) > 3) continue;
        const l = -Math.sin(hj) * dx + Math.cos(hj) * dy;
        const lim = t.w[j] + (l > 0 ? t.runL[j] : t.runR[j]);
        if (Math.abs(l) < lim + 1) {
          return `${r === lat ? 'the lane' : r === lat + LANE_BOX ? 'the working lane' : 'the garages'} at s ${Math.round(i * ds)} would stand ${(lim - Math.abs(l)).toFixed(0)} m inside the ground of the stretch at s ${Math.round(j * ds)}${Math.abs(l) < t.w[j] ? ' (on its road)' : ''}`;
        }
      }
    }
  }
  return null;
}

// ---- choose -----------------------------------------------------------------
const forced = opt.side ? (opt.side.toUpperCase() === 'L' ? 1 : -1) : 0;
const atS = opt.at != null ? +opt.at : null;
let chosen = null; const refusals = [];
const tryRuns = atS != null ? [runs.slice().sort((a, b) => {
  const d = r => { const a0 = r.i0 * ds, m = a0 + r.len / 2; return Math.abs(t.gap(t.wrap(m), t.wrap(atS))); };
  return d(a) - d(b);
})[0]] : cands.concat(shorter);
for (const run of tryRuns) {
  const inside = insideAt(wrapI(run.i0 + Math.round(run.len / ds / 2)));
  for (const side of forced ? [forced] : [inside, -inside]) {
    const c = build(run, side, atS);
    const why = conflict(c);
    if (!why) { chosen = c; chosen.inside = side === inside; break; }
    refusals.push(`  straight s ${Math.round(run.i0 * ds)} (+${run.len} m), ${side > 0 ? 'left' : 'right'}: ${why}`);
  }
  if (chosen) break;
}
if (!chosen) {
  console.error(`synthpit: no pit lane fits ${key}. Tried:\n${refusals.join('\n')}\nGive it a place with --at <s> --side L|R, or a shorter --len / smaller --offset.`);
  process.exit(1);
}

// ---- the barrier, on the pit side, along the lane ---------------------------
const need = Math.min(40, OFFSET + 4.5);
const runKey = chosen.side > 0 ? 'runL' : 'runR';
const runArr = raw[runKey].slice();
let widened = 0, widest = 0;
for (let u = 0; u <= chosen.len; u += ds) {
  const i = wrapI(Math.round((chosen.entryS + u) / ds));
  const v = +(need - raw.w[i]).toFixed(1);
  if (v > runArr[i]) { widest = Math.max(widest, v - runArr[i]); runArr[i] = v; widened++; }
}

const pit = { entryS: chosen.entryS, exitS: chosen.exitS, side: chosen.side, synth: true, pts: chosen.pts };

// ---- write: only `pit` and the one run array, everything else untouched -----
function replaceValue(src, name, json) {
  const at = src.indexOf(`"${name}":`);
  if (at < 0) throw new Error(`no "${name}" in ${file}`);
  let k = at + name.length + 3, depth = 0, inStr = false;
  const start = k;
  for (; k < src.length; k++) {
    const ch = src[k];
    if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { if (depth === 0) break; depth--; if (depth === 0) { k++; break; } }
    else if (ch === ',' && depth === 0) break;
  }
  return src.slice(0, start) + json + src.slice(k);
}
let out = replaceValue(text, 'pit', JSON.stringify(pit));
if (widened) out = replaceValue(out, runKey, JSON.stringify(runArr));

// ---- check what the game will make of it, before writing --------------------
const made = new Track(JSON.parse(out));
const lane = makeLane(made, 22), G = garageLayout(made);
const sideName = chosen.side > 0 ? 'LEFT' : 'RIGHT';
console.log(`${key}: pit lane on the ${sideName} (${chosen.inside ? 'inside' : 'OUTSIDE'} of the circuit), beside the straight at s ${Math.round(chosen.run.i0 * ds)} (+${chosen.run.len} m)`);
console.log(`  entry s ${pit.entryS} -> exit s ${pit.exitS}, ${chosen.len} m, ${OFFSET.toFixed(1)} m from the centreline (road half-width ${wMax}), ${pit.pts.length} points`);
console.log(`  the game derives: side ${made.pit.side > 0 ? 'LEFT' : 'RIGHT'}, offset ${made.pit.offset.toFixed(1)} m, lane ${lane.len.toFixed(0)} m, ${G ? G.n : 0} garages (${lane.garages} with stop marks)`);
console.log(`  ${runKey} widened at ${widened} samples along the lane (by up to ${widest.toFixed(1)} m, to ${need.toFixed(1)} m from the centreline); nothing else changed`);
if (Math.sign(made.pit.offset) !== chosen.side) { console.error('synthpit: the game reads the lane on the other side — not written'); process.exit(1); }
if (!G || G.n < 3 || !lane.garages) { console.error('synthpit: fewer than 3 garages fit — not written'); process.exit(1); }
if (made.sharedWalls) {
  // shareWalls may have pulled the widened wall back in; say so if it cut into the lane.
  let cut = 0;
  for (let u = chosen.len * 0.1; u <= chosen.len * 0.88; u += ds) {
    const i = wrapI(Math.round((chosen.entryS + u) / ds));
    if (made.w[i] + made[runKey][i] < OFFSET - 0.5) cut++;
  }
  if (cut) console.log(`  NOTE: the shared-wall rule brings the barrier inside the lane at ${cut} samples (another stretch is close); cars in the lane are not tested against it`);
}
if (opt.dry) { console.log('  --dry: not written'); process.exit(0); }
fs.writeFileSync(file, out);
console.log(`  -> data/tracks/${key}.json`);
