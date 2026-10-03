// Sepang DLC — the trackside dressing: the start line and grid, the start
// gantry, the braking boards and the corner signs.
//
// WHAT IS SURVEYED AND WHAT IS NOT. Checked 2026-10-03:
//   - The track is 16 m wide on the straights, up to 20-22 m in places
//     (racingcircuits.info/asia/malaysia/sepang.html; en.wikipedia.org/wiki/
//     Sepang_International_Circuit). The bake carries a flat 16 m.
//   - The start/finish straight and the back straight run side by side with
//     the double-fronted Main Grandstand between them (sepangcircuit.com/
//     main-grandstand; tracksideseats.com/f1/circuits/sepang). grandstand.js
//     builds that; this file only dresses the road in front of it.
//   - Kerbs and run-off carry a coloured acrylic coating (Mapei, via
//     seab.tradelinkmedia.biz/publications/7/news/5352) — the COLOURS are not
//     published there. KERB_PAINT stays the red and white every onboard shows.
// NOT found in any source I could read: the gantry's dimensions, the board
// styling, the corner-sign styling. Those below are DESIGN, made in Malaysia's
// colours (the Jalur Gemilang's red, white, royal blue and yellow) to real
// F1 proportions, and say so where they are chosen.
//
// Run-off paint was NOT added: data/surf/sepang.json says the run-off is
// gravel and grass, and physics reads that file. Painting a tarmac apron the
// car would then bog down on would make the picture lie about the grip.
import * as THREE from 'three';
import { Z, Builder, Atlas, fitText } from '../../geom.js';
import { gridSlots } from '../../grid.js';
import { printMat } from '../../furniture.js';

export const replaces = ['startFinish', 'boards'];
export function prepareEnv(env, track) {}

// Same placement helpers as js/furniture.js, so a board here stands exactly
// where a board there would.
const at = (t, i, lat) => {
  const h = t.hdg[i];
  return [t.x[i] - Math.sin(h) * lat, Z(t.y[i] + Math.cos(h) * lat)];
};
const barrierLat = (t, i, side) => side > 0 ? t.w[i] + t.runL[i] : -(t.w[i] + t.runR[i]);

const RED = '#cc0001', BLUE = '#010066', GOLD = '#ffcc00', WHITE = '#f4f4f0', INK = '#0c0d10';

// ---------------------------------------------------------------------------
// Sepang's own sign atlas: the gantry fascia, the boards, the corner signs.
// ---------------------------------------------------------------------------
function sepangAtlas(track) {
  const A = new Atlas(4, 8, 512, 128);
  const cells = { boards: {}, names: new Map(), fascia: 0, fasciaSub: 0 };

  // The gantry fascia. Design: the circuit's name in white on royal blue, a
  // red-and-white Jalur Gemilang band along the foot, a gold rule on top.
  cells.fascia = A.cell((g, w, h) => {
    g.fillStyle = BLUE; g.fillRect(0, 0, w, h);
    g.fillStyle = GOLD; g.fillRect(0, 0, w, 7);
    for (let k = 0; k < 32; k++) { g.fillStyle = k % 2 ? WHITE : RED; g.fillRect(k * w / 32, h - 16, w / 32 + 1, 16); }
    fitText(g, 'SEPANG INTERNATIONAL CIRCUIT', w / 2, h / 2 - 5, w * 0.9, h * 0.46, { colour: '#ffffff', weight: 900 });
  });
  cells.fasciaSub = A.cell((g, w, h) => {
    g.fillStyle = BLUE; g.fillRect(0, 0, w, h);
    g.fillStyle = RED; g.fillRect(0, h - 10, w, 10);
    fitText(g, 'SELAMAT DATANG  ·  MALAYSIA', w / 2, h / 2 - 3, w * 0.86, h * 0.5, { colour: GOLD, weight: 800 });
  });

  // Braking boards. The number on white, as big as the panel allows. Design:
  // a royal-blue cap, red on the last one — the board you brake AT.
  for (const n of [50, 100, 150, 200, 250, 300]) {
    cells.boards[n] = A.cell((g, w, h) => {
      g.fillStyle = INK; g.fillRect(0, 0, w, h);
      const s = h, x0 = (w - s) / 2;
      g.fillStyle = WHITE; g.fillRect(x0, 0, s, s);
      g.fillStyle = n === 50 ? RED : BLUE; g.fillRect(x0, 0, s, 14);
      fitText(g, String(n), x0 + s / 2, s / 2 + 7, s * 0.9, s * 0.7, { colour: INK, weight: 900 });
    });
  }

  // Corner signs. Only for a corner the survey names or numbers: a number the
  // bake invented ("Turn 13" for what may be the real 14) is not printed on a
  // sign at the real place. Design: royal blue, gold turn number, red rule.
  for (const c of track.corners || []) {
    if (!c.name && !c.num) continue;
    const key = c.name || `T${c.num}`;
    if (cells.names.has(key)) continue;
    cells.names.set(key, A.cell((g, w, h) => {
      g.fillStyle = BLUE; g.fillRect(0, 0, w, h);
      g.fillStyle = RED; g.fillRect(0, h - 12, w, 12);
      const tag = c.num ? `T${c.num}` : `T${c.n}`;
      g.fillStyle = GOLD; g.fillRect(0, 0, 112, h - 12);
      fitText(g, c.num ? tag : '★', 56, (h - 12) / 2, 96, (h - 12) * 0.6, { colour: BLUE, weight: 900 });
      fitText(g, (c.name || `TURN ${c.num}`).toUpperCase(), 112 + (w - 112) / 2, (h - 12) / 2, (w - 112) * 0.88, (h - 12) * 0.52, { colour: '#ffffff' });
    }));
  }
  return { atlas: A, cells, texture: A.texture() };
}

function chequerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e9e6'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#17181c';
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 32, y * 32, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------
// The line and the grid: the same paint as furniture.js, because a grid box
// is a grid box everywhere, and gridSlots is the one geometry race.js spawns
// cars on.
// ---------------------------------------------------------------------------
function lineAndGrid(S, t, world, out) {
  const roadPaint = { roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 };
  const strip = new Builder();
  const i0 = t.idx(0), i1 = t.idx(0.7);
  strip.quadUp([at(t, i0, -t.w[i0]), at(t, i1, -t.w[i1]), at(t, i1, t.w[i1]), at(t, i0, t.w[i0])], 0.014);
  const chq = chequerTexture();
  chq.repeat.set(1 / 0.35, 1 / 0.35);
  const sm = strip.mesh(new THREE.MeshStandardMaterial({ map: chq, ...roadPaint }), { shadow: false });
  if (sm) { if (world) world.lift(sm.geometry); sm.name = 'sepang.line'; S.add(sm); out.push(sm); }

  const grid = new Builder();
  for (const slot of gridSlots(t)) {
    const i = slot.i, j = t.idx(slot.s + 4.2), c = slot.lat;
    const box = (a, b) => grid.quadUp([at(t, i, c + a), at(t, j, c + a), at(t, j, c + b), at(t, i, c + b)], 0.012);
    box(-1.45, -1.30); box(1.30, 1.45);
    const iF = t.idx(slot.s + 4.05), jF = t.idx(slot.s + 4.2);
    grid.quadUp([at(t, iF, c - 1.45), at(t, jF, c - 1.45), at(t, jF, c + 1.45), at(t, iF, c + 1.45)], 0.012);
  }
  const gm = grid.mesh(new THREE.MeshStandardMaterial({ color: 0xe8e8e4, ...roadPaint, roughness: 0.78 }), { shadow: false });
  if (gm) { if (world) world.lift(gm.geometry); gm.name = 'sepang.grid'; S.add(gm); out.push(gm); }
}

// ---------------------------------------------------------------------------
// THE GANTRY. Design, at real F1 proportions: two white lattice pylons well
// outside the 16 m road, a 1.8 m deep box truss across the top carrying a
// blue fascia on both faces, and the start lights hung under its middle —
// five columns, four lamps each, the way a modern grid is started.
// ---------------------------------------------------------------------------
function gantry(S, t, look, A, world, out) {
  const iG = t.idx(18);
  const h = t.hdg[iG];
  const f = [Math.cos(h), -Math.sin(h)];                 // down-track, in (x, z)
  const wG = t.w[iG] + 2.6;
  const L = at(t, iG, wG), R = at(t, iG, -wG);
  const span = Math.hypot(R[0] - L[0], R[1] - L[1]);
  const ax = [(R[0] - L[0]) / span, (R[1] - L[1]) / span]; // across, left -> right
  const H = 8.6, D = 1.8, DEP = 1.3;                        // beam underside, depth, front-to-back
  const steel = new Builder(), white = new Builder({ color: true });
  const P = (p, df, da) => [p[0] + f[0] * df + ax[0] * da, p[1] + f[1] * df + ax[1] * da];
  const strut = (b, a, c, wdt) => {
    // A flat strut between two 3-D points, drawn as a crossed pair so it reads
    // from any side; members this thin are never seen end-on for long.
    const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    // Two strips, each across the member and square to the other.
    const hx = Math.abs(dy) > 0.9 * len ? 1 : 0, hy = 1 - hx;
    const c1 = [dy * 0 - dz * hy, dz * hx - dx * 0, dx * hy - dy * hx];
    const c2 = [dy * c1[2] - dz * c1[1], dz * c1[0] - dx * c1[2], dx * c1[1] - dy * c1[0]];
    for (const n of [c1, c2]) {
      let [px, py, pz] = n;
      const pl = Math.hypot(px, py, pz) || 1; px *= wdt / 2 / pl; py *= wdt / 2 / pl; pz *= wdt / 2 / pl;
      b.quadN([a[0] - px, a[1] - py, a[2] - pz], [c[0] - px, c[1] - py, c[2] - pz],
        [c[0] + px, c[1] + py, c[2] + pz], [a[0] + px, a[1] + py, a[2] + pz], [[0, 0], [len, 0], [len, wdt], [0, wdt]]);
    }
  };

  // The pylons: four corner legs 1.4 m apart, rungs every 1.6 m, a diagonal
  // in every bay on all four faces. Painted white, as gantry steel is.
  for (const base of [L, R]) {
    const o = 0.7, top = H + D + 0.6;
    const legs = [[-o, -o], [o, -o], [o, o], [-o, o]].map(([df, da]) => P(base, df, da));
    for (const q of legs) white.box(q[0], top / 2, q[1], 0.22, top, 0.22, h, 0xf0f0ee, 1);
    for (let y = 0; y + 1.6 <= top + 0.01; y += 1.6) {
      for (let k = 0; k < 4; k++) {
        const a = legs[k], c = legs[(k + 1) % 4];
        strut(steel, [a[0], y + 1.6, a[1]], [c[0], y + 1.6, c[1]], 0.12);
        strut(steel, [a[0], y, a[1]], [c[0], y + 1.6, c[1]], 0.08);
      }
    }
    white.box(base[0], 0.15, base[1], 2.0, 0.3, 2.0, h, 0xc9c9c4, 1);      // the plinth
  }

  // The truss: four chords, verticals and diagonals every 1.5 m on the front
  // and back faces, plus top and bottom lacing.
  const y0 = H, y1 = H + D;
  const chord = (df, y) => [P(L, df, 0), P(R, df, 0)].map(q => [q[0], y, q[1]]);
  for (const df of [-DEP / 2, DEP / 2]) for (const y of [y0, y1]) {
    const [a, c] = chord(df, y);
    const mid = [(a[0] + c[0]) / 2, y, (a[2] + c[2]) / 2];
    white.box(mid[0], y, mid[2], 0.22, 0.22, span + 1.6, h, 0xf0f0ee, 1);
  }
  const bays = Math.round(span / 1.5);
  for (let k = 0; k <= bays; k++) {
    const u = k / bays * span, u2 = Math.min(span, (k + 1) / bays * span);
    for (const df of [-DEP / 2, DEP / 2]) {
      const a = P(L, df, u), c = P(L, df, u2);
      strut(steel, [a[0], y0, a[1]], [a[0], y1, a[1]], 0.1);
      if (k < bays) strut(steel, [a[0], y0, a[1]], [c[0], y1, c[1]], 0.08);
    }
    if (k < bays) {
      const a = P(L, -DEP / 2, u), c = P(L, DEP / 2, u2);
      strut(steel, [a[0], y1, a[1]], [c[0], y1, c[1]], 0.08);
      strut(steel, [a[0], y0, a[1]], [c[0], y0, c[1]], 0.08);
    }
  }

  // The start-light pod hung under the middle of the truss: a black frame,
  // five columns of four lamp housings, each with its red lens. Dark: the race
  // start is drawn by the HUD; these are where the real ones hang.
  const pod = new Builder();
  const lens = new Builder();
  const M = P(L, 0, span / 2);
  pod.box(M[0], H - 0.15, M[1], 0.5, 0.3, 4.4, h, 0x1a1b1e, 1);       // hanger beam
  for (let c = 0; c < 5; c++) {
    const da = (c - 2) * 0.82;
    const q = P(L, 0, span / 2 + da);
    pod.box(q[0], H - 1.35, q[1], 0.42, 2.1, 0.62, h, 0x1a1b1e, 1);
    for (let r = 0; r < 4; r++) {
      const ly = H - 0.62 - r * 0.48;
      const fq = [q[0] - f[0] * 0.215, q[1] - f[1] * 0.215];      // the face toward the grid
      const rr = 0.17;
      lens.quadN([fq[0] - ax[0] * rr, ly - rr, fq[1] - ax[1] * rr], [fq[0] + ax[0] * rr, ly - rr, fq[1] + ax[1] * rr],
        [fq[0] + ax[0] * rr, ly + rr, fq[1] + ax[1] * rr], [fq[0] - ax[0] * rr, ly + rr, fq[1] - ax[1] * rr],
        [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }

  // The fascia: 2.0 m of printed panel on each face of the truss, the
  // circuit's name toward the grid, the welcome toward the pit exit side.
  const fas = new Builder();
  const yA = y0 + 0.0, yB = y1 + 0.2;
  {
    const o = DEP / 2 + 0.13;
    const Rf = P(R, -o, 0), Lf = P(L, -o, 0);
    fas.quadN([Rf[0], yA, Rf[1]], [Lf[0], yA, Lf[1]], [Lf[0], yB, Lf[1]], [Rf[0], yB, Rf[1]], A.atlas.uv(A.cells.fascia, true));
    const Rb = P(R, o, 0), Lb = P(L, o, 0);
    fas.quadN([Lb[0], yA, Lb[1]], [Rb[0], yA, Rb[1]], [Rb[0], yB, Rb[1]], [Lb[0], yB, Lb[1]], A.atlas.uv(A.cells.fasciaSub, true));
  }

  const add = (b, mat, opts) => {
    const m = b.mesh(mat, opts);
    if (m) { if (world) world.lift(m.geometry); S.add(m); out.push(m); }
    return m;
  };
  const wm = add(white, look.mat('metal', { size: 2.0, tint: 0xffffff, roughness: 0.45, metalness: 0.35, vertexColors: true }));
  if (wm) wm.name = 'sepang.gantry';
  add(steel, look.mat('metal', { size: 1.5, tint: 0xe6e7e8, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }), { shadow: true });
  add(pod, new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6, metalness: 0.3 }));
  add(lens, new THREE.MeshStandardMaterial({ color: 0x3a0606, emissive: 0xff1a12, emissiveIntensity: 0.08, roughness: 0.2, side: THREE.DoubleSide }), { shadow: false });
  const fm = add(fas, printMat(A.texture, { roughness: 0.6, back: 0x0a0c2a }), { shadow: false });
  if (fm) fm.name = 'sepang.fascia';
}

// ---------------------------------------------------------------------------
// Braking boards and corner signs. Placement is furniture.js's own rule —
// only real braking zones, read off the solved speed profile; boards on the
// verge on the outside of the coming corner, turned toward the racing line.
// ---------------------------------------------------------------------------
function boards(S, t, line, look, A, world, out) {
  const b = new Builder(), legs = new Builder();
  let lastEnd = -1e9;
  for (const c of t.corners || []) {
    const iApex = t.idx(c.s);
    const vApex = line.v[iApex];
    let vMax = vApex;
    for (let s = c.s0 - 380; s < c.s0; s += t.ds) vMax = Math.max(vMax, line.v[t.idx(s)]);
    const side = c.dir < 0 ? -1 : 1;
    const braking = vMax - vApex >= 22 && !(c.s0 - lastEnd < 160);
    lastEnd = c.s1;
    if (braking) {
      const marks = vMax > 78 ? [300, 250, 200, 150, 100, 50] : [200, 150, 100, 50];
      for (const d of marks) {
        const i = t.idx(c.s0 - d);
        b.setHint(i); legs.setHint(i);
        const run = side > 0 ? t.runL[i] : t.runR[i];
        const lat = run > 5
          ? side * (t.w[i] + Math.max(2.6, Math.min(5.5, run * 0.35)))
          : barrierLat(t, i, side) - side * Math.min(1.6, run * 0.25);
        const p = at(t, i, lat);
        const h = t.hdg[i];
        const lx = -Math.sin(h), lz = -Math.cos(h);
        const tw = -side * 0.35;
        const qx = lx + Math.cos(h) * tw, qz = lz - Math.sin(h) * tw;
        const qn = Math.hypot(qx, qz), ux = qx / qn, uz = qz / qn;
        const half = 0.8;
        const a = [p[0] + ux * half, p[1] + uz * half], e = [p[0] - ux * half, p[1] - uz * half];
        const y0 = 0.7, y1 = y0 + 1.6;
        const full = A.atlas.uv(A.cells.boards[d], false);
        const u0 = full[0][0] + (full[1][0] - full[0][0]) * 0.375, u1 = full[0][0] + (full[1][0] - full[0][0]) * 0.625;
        b.quadN([a[0], y0, a[1]], [e[0], y0, e[1]], [e[0], y1, e[1]], [a[0], y1, a[1]],
          [[u0, full[0][1]], [u1, full[1][1]], [u1, full[2][1]], [u0, full[3][1]]]);
        const lh = Math.atan2(-uz, ux);
        legs.box(p[0] + ux * 0.55, y0 / 2, p[1] + uz * 0.55, 0.1, y0, 0.1, lh, 0x2a2e34, 1);
        legs.box(p[0] - ux * 0.55, y0 / 2, p[1] - uz * 0.55, 0.1, y0, 0.1, lh, 0x2a2e34, 1);
      }
    }
    // The corner sign at the entry, on legs, on the verge beside the boards —
    // not on the barrier line, which at Sepang is 40 m away across the
    // run-off, where a sign shrinks to nothing. Braking zone or not, a named
    // corner is signed.
    const cell = A.cells.names.get(c.name || (c.num ? `T${c.num}` : ''));
    if (cell !== undefined) {
      const sIn = c.s0 - 22;
      const i = t.idx(sIn), k = t.idx(sIn + 8);
      b.setHint(i); legs.setHint(i);
      const off = (j) => {
        const run = side > 0 ? t.runL[j] : t.runR[j];
        return run > 9 ? side * (t.w[j] + 7.5) : barrierLat(t, j, side) - side * 0.4;
      };
      const lat = off(i), latK = off(k);
      const p = at(t, i, lat), e = at(t, k, latK);
      const y0 = 1.3, y1 = 3.3;
      b.quadN([p[0], y0, p[1]], [e[0], y0, e[1]], [e[0], y1, e[1]], [p[0], y1, p[1]], A.atlas.uv(cell, side < 0));
      for (const q of [p, e]) legs.box(q[0], y0 / 2, q[1], 0.12, y0, 0.12, t.hdg[i], 0x2a2e34, 1);
    }
  }
  const mat = printMat(A.texture, { roughness: 0.66 });
  const m1 = b.mesh(mat, { shadow: false });
  const m2 = legs.mesh(look.mat('metal', { size: 1.2, tint: 0x2a2e34, roughness: 0.8, metalness: 0.7 }));
  for (const m of [m1, m2]) if (m) { if (world) world.liftGround(m.geometry); S.add(m); out.push(m); }
  if (m1) m1.name = 'sepang.boards';
}

export function build(view, ctx) {
  const { S, t, look, world, line } = ctx;
  const A = sepangAtlas(t);
  const out = [];
  lineAndGrid(S, t, world, out);
  gantry(S, t, look, A, world, out);
  if (line) boards(S, t, line, look, A, world, out);
  return { meshes: out.length, signs: A.atlas.n };
}
