// dressspeedway.mjs — what stands round Xingus Speedway.
//
//   node tools/dressspeedway.mjs
//
// Adam, 2026-10-06: "add stands on every edge, i shoundle be able to see the
// outer horizon, i wanna feel like im in cars ... make it have a gap on one
// side reveaing a dock like miami circuit from cars 3. also add lights that be
// bright ... add other halloween decor".
//
// So, outside the wall, all the way round:
//   STANDS   a ring of grandstands 24 m high, closed except for
//   THE GAP  300 m in the middle of the back stretch, where the stands stop
//            and there is a quay, three piers, the boats, and water to the
//            horizon.
//   TOWERS   floodlight masts behind the stands, taller than they are.
//   PUMPKINS on the infield and the quay (js/landmarks.js shows them in
//            October, or with the Halloween theme on).
//
// Everything is placed from the lap's own geometry (data/tracks/speedway.json)
// by the numbers below; nothing is random. Writes data/env/speedway.json
// (buildings and areas: js/env.js, js/crowd.js) and
// data/landmarks/speedway.json (js/landmarks.js).
import fs from 'fs';
import { Track } from '../js/track.js';

const ROOT = new URL('../', import.meta.url).pathname;
const t = new Track(JSON.parse(fs.readFileSync(ROOT + 'data/tracks/speedway.json', 'utf8')));
const L = t.length, r1 = v => Math.round(v * 10) / 10;
const at = (s, lat) => { const p = t.point(((s % L) + L) % L, lat); return [r1(p.x), r1(p.y)]; };
const wallAt = s => { const i = t.idx(((s % L) + L) % L); return t.w[i] + t.runR[i]; };   // the outside is the car's right: -lat

// The back stretch is between the two corners; the gap is the middle of it.
const [c1, c2] = t.corners;
const backMid = (c1.s1 + c2.s0) / 2, GAP = 300, g0 = backMid - GAP / 2, g1 = backMid + GAP / 2;
const inGap = s => s > g0 - 2 && s < g1 + 2;

// ---- the stands ---------------------------------------------------------------
const STAND = { pitch: 50, len: 46, near: 5, depth: 26, h: 24 };
const buildings = [];
for (let s = 0; s + STAND.len <= L; s += STAND.pitch) {
  if (inGap(s) || inGap(s + STAND.len) || (s < g0 && s + STAND.len > g1)) continue;
  const a = -(wallAt(s) + STAND.near), b = a - STAND.depth;
  buildings.push({ k: 'grandstand', h: STAND.h, p: [at(s, a), at(s + STAND.len, a), at(s + STAND.len, b), at(s, b)] });
}

// ---- the dock, through the gap --------------------------------------------------
// The back stretch is straight, so the dock is laid out on its own two axes:
// d along the road, n straight out through the wall.
const iM = t.idx(backMid), hM = t.hdg[iM], d = [Math.cos(hM), Math.sin(hM)], n = [Math.sin(hM), -Math.cos(hM)];
const P0 = [t.x[iM], t.y[iM]];
const pt = (along, out) => [r1(P0[0] + d[0] * along + n[0] * out), r1(P0[1] + d[1] * along + n[1] * out)];
const edge = wallAt(backMid) + 2;                       // just behind the wall
const QUAY = 16;                                        // metres of quay before the water
const areas = [
  // water from the quay's edge out to the horizon, fanning wide behind the stands either side
  { k: 'water', p: [pt(-GAP / 2 - 6, edge + QUAY), pt(GAP / 2 + 6, edge + QUAY), pt(1900, 2600), pt(-1900, 2600)] },
];
const rings = [{ floating: false, ring: [pt(-GAP / 2, edge), pt(GAP / 2, edge), pt(GAP / 2, edge + QUAY + 1), pt(-GAP / 2, edge + QUAY + 1)] }];
const yachts = [];
const hOut = Math.atan2(n[1], n[0]);
[-100, 0, 100].forEach((along, k) => {
  const len = 110 + (k === 1 ? 40 : 0), w = 9;
  rings.push({ floating: false, ring: [pt(along - w / 2, edge + QUAY), pt(along + w / 2, edge + QUAY), pt(along + w / 2, edge + QUAY + len), pt(along - w / 2, edge + QUAY + len)] });
  // boats moored bow-out down both sides of each pier; every third one has a mast
  for (let j = 0; j < 3; j++) for (const sd of [-1, 1]) {
    const size = [22, 30, 38][(j + k + (sd > 0 ? 1 : 0)) % 3];
    const [x, y] = pt(along + sd * (w / 2 + 7 + size * 0.09), edge + QUAY + 26 + j * 32);
    yachts.push([x, y, +hOut.toFixed(3), size, (j + k) % 3 === 2 ? 1 : 0]);
  }
});

// ---- the floodlight towers ------------------------------------------------------
// [x, y, the lap's heading there, height]
const towers = [];
const towerAt = s => { const [x, y] = at(s, -(wallAt(s) + STAND.near + STAND.depth + 8)); towers.push([x, y, +t.hdg[t.idx(((s % L) + L) % L)].toFixed(3), 52]); };
for (let s = 60; s < L; s += 180) if (!(s > g0 - 40 && s < g1 + 40)) towerAt(s);
towerAt(g0 - 14); towerAt(g1 + 14);                      // two more at the mouth of the gap, lighting the quay

// ---- the pumpkins ----------------------------------------------------------------
// [x, y, radius, the way its face looks]. Faces look at the road.
const pumpkins = [];
const toRoad = s => +(t.hdg[t.idx(((s % L) + L) % L)] - Math.PI / 2).toFixed(3);    // from the infield, toward the road
for (const c of [c1, c2]) for (let s = c.s0 + 40, k = 0; s < c.s1 - 20; s += 70, k++) {
  const i = t.idx(s), [x, y] = at(s, t.w[i] + t.runL[i] + 8 + (k % 2) * 9);
  pumpkins.push([x, y, [2.4, 3.6, 1.8][k % 3], toRoad(s)]);
}
// a row of big ones along the quay, looking in at the back stretch...
for (let a = -GAP / 2 + 25, k = 0; a <= GAP / 2 - 20; a += 50, k++) { const [x, y] = pt(a, edge + 8); pumpkins.push([x, y, k === 2 ? 5.5 : 3.2, +(hOut + Math.PI).toFixed(3)]); }
// ...and one giant in the infield opposite the gap, looking out at them
{ const [x, y] = pt(0, -110); pumpkins.push([x, y, 9, +hOut.toFixed(3)]); }

let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.x[i]); x1 = Math.max(x1, t.x[i]); y0 = Math.min(y0, t.y[i]); y1 = Math.max(y1, t.y[i]); }
const env = {
  key: 'speedway', full: 'Xingus Speedway', lat0: 25.96, lon0: -80.24, pad: 500,
  made: 'tools/dressspeedway.mjs from data/tracks/speedway.json — dressed, not surveyed',
  bbox: { x0: Math.floor(x0 - 500), y0: Math.floor(y0 - 500), x1: Math.ceil(x1 + 500), y1: Math.ceil(y1 + 500) },
  buildings, areas,
};
const landmarks = {
  key: 'speedway', note: 'tools/dressspeedway.mjs: the dock through the gap in the stands, the floodlights, and the pumpkins',
  items: [
    { type: 'piers', src: 'dressspeedway', rings },
    { type: 'yachts', src: 'dressspeedway', list: yachts },
    { type: 'floodtowers', src: 'dressspeedway', list: towers },
    { type: 'pumpkins', src: 'dressspeedway', list: pumpkins },
  ],
};
fs.writeFileSync(ROOT + 'data/env/speedway.json', JSON.stringify(env));
fs.writeFileSync(ROOT + 'data/landmarks/speedway.json', JSON.stringify(landmarks));
console.log(`speedway: ${buildings.length} stands (gap s ${g0 | 0}-${g1 | 0}), ${rings.length} quays, ${yachts.length} boats, ${towers.length} towers, ${pumpkins.length} pumpkins`);
console.log(`  outward from the back stretch is (${n[0].toFixed(2)}, ${n[1].toFixed(2)}); the lap's own y runs ${y0 | 0} to ${y1 | 0}, the middle of the back stretch is at y ${P0[1] | 0}`);
