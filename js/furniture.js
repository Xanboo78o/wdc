// furniture.js — everything that stands BESIDE the track.
//
// This module exists for two complaints at once.
//
// The obvious one is that a circuit with nothing beside it looks like a
// racetrack-shaped carpet. The less obvious one is "makes 210=210 not 210=60":
// speed is read from things streaming past at the edge of vision, and an empty
// verge gives the eye nothing to stream. Guard rail posts every 4 m, hoardings
// every 8, braking boards at 50 m intervals and marshal posts every 300 are
// not decoration — they are a RULER laid along the lap, and the reason a real
// onboard feels fast.
//
// Everything in here merges into a handful of draw calls. A circuit's worth of
// hoardings is ONE mesh; every tyre in every tyre wall is ONE instanced mesh.
// That is what makes it affordable to furnish all 5.8 km of Monza instead of
// dressing the bit by the pits and hoping nobody drives round the back.
import * as THREE from 'three';
import { Z, Builder, Atlas, fitText } from './geom.js';

// Real-world dimensions, because guessing them is what makes a scene read as a
// video game. A W-beam guard rail is 310 mm deep with its top edge at 750 mm;
// an F1 braking board is about 1.2 m square on legs; a concrete block on a
// street circuit stands just over a metre.
const RAIL_TOP = 0.87, RAIL_BOT = 0.44, RAIL_DEPTH = 0.10;
const WALL_H = 1.05;
const FENCE_H = 3.6;
const BOARD_STEP = 8.4;      // hoarding pitch along the barrier

// The W-beam's cross section, as (lateral inset, height) pairs. The two
// grooves are what makes a guard rail recognisable at 200 km/h — a flat strip
// of the same size just reads as a low wall.
const W_PROFILE = [
  [0, RAIL_BOT], [-RAIL_DEPTH, RAIL_BOT + 0.11], [-RAIL_DEPTH, RAIL_BOT + 0.18],
  [0, RAIL_BOT + 0.215], [-RAIL_DEPTH, RAIL_BOT + 0.25], [-RAIL_DEPTH, RAIL_BOT + 0.32],
  [0, RAIL_TOP],
];

// A point `lat` metres to the left of centreline sample i, in three-space.
// Negative lat is the car's right. This is the sim->three reflection and every
// placement in this file goes through it.
const at = (t, i, lat) => {
  const h = t.hdg[i];
  return [t.x[i] - Math.sin(h) * lat, Z(t.y[i] + Math.cos(h) * lat)];
};
const barrierLat = (t, i, side) => side > 0 ? t.w[i] + t.runL[i] : -(t.w[i] + t.runR[i]);

// ---------------------------------------------------------------------------
// The sign atlas. Everything in this world with WORDS on it draws into one
// canvas, so the whole circuit's signage is a single texture and a single
// draw call. Cells are 4:1, which suits a hoarding; square signs use a
// letterboxed cell and their quad is sized to match.
// ---------------------------------------------------------------------------
export function signAtlas(track) {
  // 48 cells, not 32: the worst case is 20 sponsors + 6 braking boards + 12
  // corner names + the banner + the pit sign, and Monaco really does have 12
  // named corners. See Atlas.cell for what happened when it did not fit.
  const A = new Atlas(4, 12, 512, 128);
  const cells = { sponsors: [], boards: {}, names: new Map(), banner: 0, pit: 0 };

  // Advertising hoardings, in the sponsor colours of a paddock that does not
  // exist. The names come from the circuit data — they are Adam's own games.
  const PALETTE = [
    ['#d8352a', '#ffffff'], ['#0b0d10', '#35d6a0'], ['#1b4fd8', '#ffffff'],
    ['#f5c518', '#101014'], ['#0f8f6b', '#ffffff'], ['#e8eaee', '#101014'],
    ['#7b2fd8', '#ffffff'], ['#ff6b1a', '#101014'],
  ];
  const sponsors = track.sponsors && track.sponsors.length ? track.sponsors : ['CHASING WDC'];
  for (let i = 0; i < Math.min(sponsors.length, 20); i++) {
    const [bg, fg] = PALETTE[i % PALETTE.length];
    cells.sponsors.push(A.cell((g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      // A thin band of the text colour along the bottom: real trackside boards
      // are printed edge to edge and the band is what stops this reading as a
      // flat rectangle when it is 200 m away and four pixels tall.
      g.fillStyle = fg; g.globalAlpha = 0.85; g.fillRect(0, h - 10, w, 10); g.globalAlpha = 1;
      fitText(g, sponsors[i], w / 2, h / 2 - 4, w * 0.88, h * 0.62, { colour: fg });
    }));
  }

  // Braking boards. Drawn letterboxed into the middle of a 4:1 cell so they
  // can share the atlas; the quad that uses them is square.
  for (const n of [50, 100, 150, 200, 250, 300]) {
    cells.boards[n] = A.cell((g, w, h) => {
      g.fillStyle = '#0b0d10'; g.fillRect(0, 0, w, h);
      const s = h, x0 = (w - s) / 2;
      g.fillStyle = '#e8e8e6'; g.fillRect(x0, 0, s, s);
      g.fillStyle = '#101014';
      g.font = '900 78px Inter, Helvetica, Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), x0 + s / 2, s / 2 - 6);
      g.font = '700 22px Inter, Helvetica, Arial, sans-serif';
      g.fillText('METRES', x0 + s / 2, s - 22);
    });
  }

  // Corner names, straight off the OSM survey. Zandvoort's Tarzanbocht is
  // called Tarzanbocht on the sign because that is what the map says it is.
  const named = [...new Set((track.corners || []).map(c => c.name).filter(Boolean))].slice(0, 12);
  for (const name of named) {
    cells.names.set(name, A.cell((g, w, h) => {
      g.fillStyle = '#12161c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#35d6a0'; g.fillRect(0, 0, 12, h);
      fitText(g, name.toUpperCase(), w / 2 + 6, h / 2, w * 0.84, h * 0.6, { colour: '#e8eaee' });
    }));
  }

  cells.banner = A.cell((g, w, h) => {
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d8352a'; g.fillRect(0, h - 14, w, 14);
    g.fillStyle = '#35d6a0'; g.fillRect(0, 0, w, 8);
    fitText(g, (track.full || 'CHASING WDC').toUpperCase(), w / 2, h / 2 - 2, w * 0.9, h * 0.55, { colour: '#ffffff' });
  });

  cells.pit = A.cell((g, w, h) => {
    g.fillStyle = '#f5c518'; g.fillRect(0, 0, w, h);
    fitText(g, 'PIT LANE', w / 2, h / 2, w * 0.7, h * 0.7, { colour: '#101014' });
  });

  return { atlas: A, cells, texture: A.texture() };
}

// ---------------------------------------------------------------------------
// Barriers. Three families, chosen by what the circuit actually has:
//
//   gravel   Monza, Suzuka     — gravel trap, guard rail, tyre packs at apexes
//   barrier  Zandvoort         — guard rail the whole way round
//   wall     Baku, Monaco      — concrete blocks and a debris fence, no run-off
//
// The debris fence only goes up where it belongs: over a street circuit's
// walls everywhere, and on a permanent circuit only where the run-off is short
// enough that a car could reach the crowd. Fencing a 28 m gravel trap at Monza
// would be both wrong and a wall of alpha-tested pixels across the view.
// ---------------------------------------------------------------------------
export function buildBarriers(scene, track, look, sign, corridor = null) {
  const t = track;
  const street = t.wall === 'wall';
  // Along the pit straight the PIT WALL is the barrier. Without this the
  // circuit's own guard rail and its advertising get built straight through
  // the pit lane: at Monza the right-hand barrier lands 4.7 m from the pit
  // centreline, so the view down the lane came back with hoardings standing in
  // it, mirrored, because you were reading their backs.
  const nearPit = (x, z) => {
    if (!corridor) return false;
    const r2 = corridor.wallClear * corridor.wallClear;
    for (const q of corridor.pts) if ((q[0] - x) ** 2 + (-q[1] - z) ** 2 < r2) return true;
    return false;
  };
  const rail = new Builder();
  const posts = new Builder();
  const conc = new Builder();
  const fence = new Builder();
  const ads = new Builder();
  const out = [];

  for (const side of [1, -1]) {
    let adRun = 0, adIdx = (side > 0 ? 0 : 3);
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      const li = barrierLat(t, i, side), lj = barrierLat(t, j, side);
      const p = at(t, i, li), q = at(t, j, lj);
      if (nearPit(p[0], p[1])) continue;
      const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
      // `inward` points from the barrier back across the track, which is the
      // side every face here has to look at.
      const hx = t.hdg[i];
      const inw = side > 0 ? [Math.sin(hx), 0, Math.cos(hx)] : [-Math.sin(hx), 0, -Math.cos(hx)];

      if (street) {
        // Jersey profile: a wide sloped foot rising to a near-vertical face.
        // The slope is the whole reason a concrete block reads as concrete and
        // not as a painted plank.
        const off = k => [
          [p[0] + inw[0] * k, p[1] + inw[2] * k],
          [q[0] + inw[0] * k, q[1] + inw[2] * k],
        ];
        const steps = [[0.34, 0], [0.20, 0.30], [0.12, 0.62], [0.10, WALL_H]];
        for (let s = 0; s < steps.length - 1; s++) {
          const [k0, y0] = steps[s], [k1, y1] = steps[s + 1];
          const [a0, b0] = off(k0), [a1, b1] = off(k1);
          rail.quadN([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]],
            [[0, y0], [seg, y0], [seg, y1], [0, y1]]);
        }
        // top cap, so you never look down onto an infinitely thin wall
        const [a1, b1] = off(0.10), [a2, b2] = off(-0.16);
        conc.quadN([a1[0], WALL_H, a1[1]], [b1[0], WALL_H, b1[1]], [b2[0], WALL_H, b2[1]], [a2[0], WALL_H, a2[1]],
          [[0, 0], [seg, 0], [seg, 0.26], [0, 0.26]]);
      } else if (i % 3 === 0) {
        // Guard rail, every third sample = about 6 m of beam per segment.
        const j3 = (i + 3) % t.n;
        const l3 = barrierLat(t, j3, side);
        const q3 = at(t, j3, l3);
        const len = Math.hypot(q3[0] - p[0], q3[1] - p[1]);
        for (let s = 0; s < W_PROFILE.length - 1; s++) {
          const [k0, y0] = W_PROFILE[s], [k1, y1] = W_PROFILE[s + 1];
          const a0 = [p[0] + inw[0] * -k0, p[1] + inw[2] * -k0];
          const b0 = [q3[0] + inw[0] * -k0, q3[1] + inw[2] * -k0];
          const a1 = [p[0] + inw[0] * -k1, p[1] + inw[2] * -k1];
          const b1 = [q3[0] + inw[0] * -k1, q3[1] + inw[2] * -k1];
          rail.quadN([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]],
            [[0, y0], [len, y0], [len, y1], [0, y1]]);
        }
        // one post per beam, set back behind it
        const px = p[0] - inw[0] * 0.14, pz = p[1] - inw[2] * 0.14;
        posts.box(px, RAIL_TOP / 2, pz, 0.14, RAIL_TOP, 0.14, hx, 0x8f959c, 1);
      }

      // Debris fence. Leans back over the run-off at the top, the way a real
      // one does, which is why it reads as a fence and not as a glass pane.
      const runW = side > 0 ? t.runL[i] : t.runR[i];
      if ((street || runW < 7) && i % 3 === 0) {
        const j3 = (i + 3) % t.n;
        const q3 = at(t, j3, barrierLat(t, j3, side));
        const len = Math.hypot(q3[0] - p[0], q3[1] - p[1]);
        const y0 = street ? WALL_H : RAIL_TOP;
        const lean = 0.55;
        const a0 = [p[0], p[1]], b0 = [q3[0], q3[1]];
        const a1 = [p[0] - inw[0] * lean, p[1] - inw[2] * lean];
        const b1 = [q3[0] - inw[0] * lean, q3[1] - inw[2] * lean];
        fence.quadN([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], FENCE_H, b1[1]], [a1[0], FENCE_H, a1[1]],
          [[0, 0], [len, 0], [len, FENCE_H - y0], [0, FENCE_H - y0]]);
      }

      // Advertising, laid along the barrier in fixed-length boards with a gap
      // between them. The pitch is what makes them a ruler.
      adRun += seg;
      if (adRun >= BOARD_STEP && sign) {
        adRun = 0;
        const k = 0.34;
        const j4 = (i + Math.max(1, Math.round((BOARD_STEP - 0.8) / t.ds))) % t.n;
        const e = at(t, j4, barrierLat(t, j4, side));
        const a = [p[0] + inw[0] * k, p[1] + inw[2] * k];
        const b = [e[0] + inw[0] * k, e[1] + inw[2] * k];
        const cell = sign.cells.sponsors[adIdx % sign.cells.sponsors.length];
        adIdx += 1;
        // Boards on the two sides of the circuit are laid out in the same
        // direction along the track, so one of them is inevitably being read
        // from behind: at Monaco every hoarding on the right-hand wall came
        // out as HTAEDYREVE. Flipping the UVs on that side is the fix — the
        // geometry is right, it is the text that has a front and a back.
        const uv = sign.atlas.uv(cell, side < 0);
        const y0 = 0.10, y1 = street ? 1.02 : 1.0;
        ads.quadN([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], uv);
      }
    }
  }

  const push = (b, mat, opts) => { const m = b.mesh(mat, opts); if (m) { scene.add(m); out.push(m); } };

  push(rail, street
    ? look.mat('concrete', { size: 3.2, tint: 0xd8d5cf, roughness: 0.95, side: THREE.DoubleSide })
    : look.mat('metal', { size: 2.4, tint: 0xa9b0b7, roughness: 0.62, metalness: 0.85, side: THREE.DoubleSide }));
  push(conc, look.mat('concrete', { size: 3.2, tint: 0xcfccc5, roughness: 0.95, side: THREE.DoubleSide }));
  push(posts, look.mat('metal', { size: 1.4, tint: 0x8f959c, roughness: 0.7, metalness: 0.8 }));
  // BLENDED, not alpha-tested.
  //
  // A cutout was the obvious choice — it sorts like solid geometry and costs
  // nothing. It also looks terrible. A wire mesh is mostly holes, so once the
  // fence is far enough away for mipmapping to average whole squares together,
  // the alpha lands either side of the threshold at random and the fence turns
  // into a field of black specks hanging in the sky. That is exactly what the
  // first screenshot of the first chicane showed, and it looked like a
  // particle bug rather than a material one.
  //
  // Blending degrades the right way instead: at distance the mesh averages
  // down to the faint grey haze a real catch fence actually becomes. depthWrite
  // is off so the two fence layers in one merged mesh do not punch holes in
  // each other.
  push(fence, look.mat('fence', {
    size: 2.0, tint: 0x9aa0a6, roughness: 0.75, metalness: 0.6,
    side: THREE.DoubleSide, transparent: true, depthWrite: false, env: 0.6,
  }), { shadow: false });

  if (sign) {
    const adMat = new THREE.MeshStandardMaterial({
      map: sign.texture, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
    });
    push(ads, adMat, { shadow: false });
    out.adMat = adMat;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tyre walls. Stacked at the OUTSIDE of every corner that has a short enough
// run-off for one to matter, which is where they are in real life: they are
// there to be hit, so they go where cars leave the road.
// ---------------------------------------------------------------------------
export function buildTyreWalls(scene, track, look) {
  const t = track;
  const stacks = [];
  for (const c of t.corners || []) {
    const side = c.dir < 0 ? -1 : 1;              // a left-hander runs wide right
    for (let s = c.s0 - 12; s <= c.s1 + 12; s += 0.95) {
      const i = t.idx(s);
      const run = side > 0 ? t.runL[i] : t.runR[i];
      if (run > 16) continue;                     // a big gravel trap needs none
      const lat = barrierLat(t, i, side) - side * 0.55;
      stacks.push({ p: at(t, i, lat), h: t.hdg[i] });
    }
  }
  if (!stacks.length) return null;

  const geo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12, 1, true);
  const mat = look.mat('metal', { size: 0.9, tint: 0x16171a, roughness: 1, metalness: 0.0, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, stacks.length * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (const st of stacks) {
    for (let level = 0; level < 3; level++) {
      // A real tyre wall is bolted but not surveyed — the slight stagger is
      // what stops 2,000 identical cylinders reading as a machine part.
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.h + level * 0.4);
      m.compose(new THREE.Vector3(st.p[0] + (Math.random() - 0.5) * 0.06, 0.13 + level * 0.25,
        st.p[1] + (Math.random() - 0.5) * 0.06), q, sc);
      mesh.setMatrixAt(k++, m);
    }
  }
  mesh.count = k;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Braking boards and corner names.
//
// The distances are not decoration either: this sim exists to be practised on,
// and a braking marker is the thing you actually aim at. They go only where
// there is a braking zone to mark, found by reading the solved speed profile
// rather than by assuming every corner has one — Suzuka's 130R does not.
// ---------------------------------------------------------------------------
export function buildBoards(scene, track, line, look, sign) {
  const t = track;
  const b = new Builder();
  const legs = new Builder();
  let any = false;

  for (const c of t.corners || []) {
    const iApex = t.idx(c.s);
    const vApex = line.v[iApex];
    let vMax = vApex;
    for (let s = c.s0 - 380; s < c.s0; s += t.ds) vMax = Math.max(vMax, line.v[t.idx(s)]);
    if (vMax - vApex < 22) continue;              // not a braking zone
    any = true;

    // Boards stand on the OUTSIDE of the coming corner, where a driver is
    // already looking, and far enough back from the barrier not to be clipped.
    const side = c.dir < 0 ? -1 : 1;
    const marks = vMax > 78 ? [300, 250, 200, 150, 100, 50] : [200, 150, 100, 50];
    for (const d of marks) {
      const i = t.idx(c.s0 - d);
      const run = side > 0 ? t.runL[i] : t.runR[i];
      const lat = barrierLat(t, i, side) - side * Math.min(1.6, run * 0.25);
      const p = at(t, i, lat);
      const h = t.hdg[i];
      const inw = side > 0 ? [Math.sin(h), 0, Math.cos(h)] : [-Math.sin(h), 0, -Math.cos(h)];
      // The panel faces back down the track at the oncoming car, not across it.
      const fx = Math.cos(h), fz = -Math.sin(h);
      const half = 0.62;
      const a = [p[0] - fx * half, p[1] - fz * half];
      const e = [p[0] + fx * half, p[1] + fz * half];
      const y0 = 0.95, y1 = y0 + 1.24;
      const uv = sign.atlas.uv(sign.cells.boards[d], true);
      b.quadN([e[0], y0, e[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [e[0], y1, e[1]], uv);
      void inw;
      legs.box(p[0] - fx * 0.42, y0 / 2, p[1] - fz * 0.42, 0.09, y0, 0.09, h, 0x2a2e34, 1);
      legs.box(p[0] + fx * 0.42, y0 / 2, p[1] + fz * 0.42, 0.09, y0, 0.09, h, 0x2a2e34, 1);
    }

    // The corner's real name, on the barrier at its entry.
    const cell = c.name ? sign.cells.names.get(c.name) : undefined;
    if (cell !== undefined) {
      const i = t.idx(c.s0 - 26);
      const lat = barrierLat(t, i, side) - side * 0.30;
      const h = t.hdg[i];
      const inw = side > 0 ? [Math.sin(h), 0, Math.cos(h)] : [-Math.sin(h), 0, -Math.cos(h)];
      const p = at(t, i, lat), e = at(t, t.idx(c.s0 - 26 + 9), lat);
      b.quadN([p[0], 1.16, p[1]], [e[0], 1.16, e[1]], [e[0], 1.98, e[1]], [p[0], 1.98, p[1]],
        sign.atlas.uv(cell, side < 0));
      void inw;
    }
  }
  if (!any) return null;

  const mat = new THREE.MeshStandardMaterial({ map: sign.texture, roughness: 0.68, side: THREE.DoubleSide });
  const m1 = b.mesh(mat, { shadow: false });
  const m2 = legs.mesh(look.mat('metal', { size: 1.2, tint: 0x2a2e34, roughness: 0.8, metalness: 0.7 }));
  if (m1) scene.add(m1);
  if (m2) scene.add(m2);
  return [m1, m2];
}

// ---------------------------------------------------------------------------
// THE STARTING GRID, as data.
//
// This is exported rather than computed inside the mesh builder for one
// reason: the race layer has to put twenty-two cars on these slots, and if it
// works out where they are a second time then there are two implementations of
// the same geometry that can silently drift apart. That is exactly how
// `track.pit.side` came to say "left" about a pit lane that is 17 m to the
// right. One derivation, one consumer list.
//
// Positions come back in SIM coordinates — metres along the centreline, metres
// to the left of it, and the heading in radians — because that is the frame
// the simulation spawns cars in. The renderer converts; nothing else has to.
//
// Slot 0 is pole. Pole sits on the side the FIRST CORNER turns away from,
// which is the real convention and worth about half a car's length into turn
// one; the rest alternate at 8 m intervals down the straight behind the line.
// ---------------------------------------------------------------------------
export function gridSlots(track, count = 22) {
  const t = track;
  const first = (t.corners || [])[0];
  // corner.dir < 0 is a right-hander, so pole goes left of the centreline.
  const poleSide = first && first.dir < 0 ? 1 : -1;
  const slots = [];
  for (let k = 0; k < count; k++) {
    const s = -6 - k * 8;
    const i = t.idx(s);
    slots.push({
      n: k + 1,
      s: t.wrap(s),
      lat: (k % 2 ? -poleSide : poleSide) * t.w[i] * 0.46,
      hdg: t.hdg[i],
      i,
    });
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Start / finish: a real chequered strip, and a gantry over it.
//
// DESIGN.md has carried "the start/finish marking is a plain white slab, and
// it is the first thing you see on load" as an open item since day one. It is
// also the one piece of a circuit that tells you instantly which circuit you
// are looking at, so it gets the track's own name across the beam.
// ---------------------------------------------------------------------------
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

export function buildStartFinish(scene, track, look, sign) {
  const t = track;
  const out = [];

  // The line itself: 0.7 m of chequer across the full width of the road.
  const strip = new Builder();
  const i0 = t.idx(0), i1 = t.idx(0.7);
  const w0 = t.w[i0], w1 = t.w[i1];
  strip.quadUp([
    at(t, i0, -w0), at(t, i1, -w1), at(t, i1, w1), at(t, i0, w0),
  ], 0.014);
  const chq = chequerTexture();
  chq.repeat.set(1 / 0.35, 1 / 0.35);      // 35 cm squares, UVs are metres
  const sm = strip.mesh(new THREE.MeshStandardMaterial({
    map: chq, roughness: 0.75, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
  }), { shadow: false });
  if (sm) { scene.add(sm); out.push(sm); }

  // The grid, painted on the road behind the line: twenty-two staggered boxes,
  // pole on the side the first corner turns away from. It is the first thing
  // on screen when a session loads, and a bare chequered strip on an empty
  // straight reads as an unfinished level rather than as a starting grid. It is
  // also where twenty-two cars are going to have to be put.
  const grid = new Builder();
  for (const slot of gridSlots(t)) {
    const i = slot.i, j = t.idx(slot.s + 4.2);
    // Boxes sit about half a track-width off centre, alternating sides.
    const c = slot.lat;
    const box = (a, b) => grid.quadUp([
      at(t, i, c + a), at(t, j, c + a), at(t, j, c + b), at(t, i, c + b),
    ], 0.012);
    box(-1.45, -1.30);          // the two side lines of the slot
    box(1.30, 1.45);
    // and the line across its front, which is the one a driver lines up on
    const iF = t.idx(slot.s + 4.05), jF = t.idx(slot.s + 4.2);
    grid.quadUp([
      at(t, iF, c - 1.45), at(t, jF, c - 1.45), at(t, jF, c + 1.45), at(t, iF, c + 1.45),
    ], 0.012);
  }
  const gridMesh = grid.mesh(new THREE.MeshStandardMaterial({
    color: 0xe8e8e4, roughness: 0.78, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
  }), { shadow: false });
  if (gridMesh) { scene.add(gridMesh); out.push(gridMesh); }

  // The gantry. Two towers, a beam, a banner and five lights.
  const st = new Builder();
  // Far enough ahead that the whole thing is in frame from the grid: parked
  // over the line itself, the beam sits above the top of the screen and only
  // the two towers show, which reads as scaffolding rather than as a gantry.
  const iG = t.idx(15);
  const wG = t.w[iG] + 1.4;
  const h = t.hdg[iG];
  const L = at(t, iG, wG), R = at(t, iG, -wG);
  const H = 7.4;
  st.box(L[0], H / 2, L[1], 0.7, H, 0.7, h, 0xd8dade, 1);
  st.box(R[0], H / 2, R[1], 0.7, H, 0.7, h, 0xd8dade, 1);
  const span = Math.hypot(R[0] - L[0], R[1] - L[1]);
  st.box((L[0] + R[0]) / 2, H + 0.55, (L[1] + R[1]) / 2, 0.9, 1.1, span, h, 0xd8dade, 1);
  const gm = st.mesh(look.mat('metal', { size: 2.0, tint: 0xcfd3d8, roughness: 0.5, metalness: 0.75 }));
  if (gm) { scene.add(gm); out.push(gm); }

  // The banner across the beam, facing back down the track at the oncoming
  // car. It has to sit ON the beam's front face, not on its centreline: the
  // beam is 0.9 m thick, so a banner at the middle of it is INSIDE the box and
  // comes back as a dark rectangle z-fighting through one half of the span.
  const ban = new Builder();
  const f = [Math.cos(h), 0, -Math.sin(h)];        // down-track
  const o = 0.47;
  const uv = sign.atlas.uv(sign.cells.banner, true);
  const Rf = [R[0] - f[0] * o, R[1] - f[2] * o], Lf = [L[0] - f[0] * o, L[1] - f[2] * o];
  ban.quadN([Rf[0], H + 0.08, Rf[1]], [Lf[0], H + 0.08, Lf[1]],
    [Lf[0], H + 1.02, Lf[1]], [Rf[0], H + 1.02, Rf[1]], uv);
  const bm = ban.mesh(new THREE.MeshStandardMaterial({ map: sign.texture, roughness: 0.7, side: THREE.DoubleSide }), { shadow: false });
  if (bm) { scene.add(bm); out.push(bm); }

  // Five start lights, dark. They are props for now; when there is a race
  // start to run they are already in the right place.
  const lights = new THREE.Group();
  const lg = new THREE.BoxGeometry(0.7, 0.62, 0.34);
  const lm = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.6 });
  for (let k = 0; k < 5; k++) {
    const f = (k + 0.5) / 5;
    const x = L[0] + (R[0] - L[0]) * f, z = L[1] + (R[1] - L[1]) * f;
    const mesh = new THREE.Mesh(lg, lm);
    mesh.position.set(x, H - 0.35, z);
    mesh.rotation.y = h;
    mesh.castShadow = true;
    lights.add(mesh);
  }
  scene.add(lights);
  out.push(lights);
  return out;
}

// ---------------------------------------------------------------------------
// Marshal posts, roughly every 300 m, in the run-off. A hut, a roof, a flag
// panel. They are small, but they are the thing that tells you a circuit is
// STAFFED, and at 300 m intervals they are another rung on the speed ruler.
// ---------------------------------------------------------------------------
export function buildMarshalPosts(scene, track, look) {
  const t = track;
  const hut = new Builder();
  const roof = new Builder();
  const flag = new Builder();
  let placed = 0;

  for (let s = 40; s < t.length; s += 300) {
    const i = t.idx(s);
    // Put it on whichever side has room for it to stand.
    const side = t.runL[i] > t.runR[i] ? 1 : -1;
    const run = side > 0 ? t.runL[i] : t.runR[i];
    if (run < 3.5) continue;
    const lat = barrierLat(t, i, side) + side * 1.7;
    const p = at(t, i, lat);
    const h = t.hdg[i];
    hut.box(p[0], 1.15, p[1], 2.2, 2.3, 1.8, h, 0xcfd3d8, 1);
    roof.box(p[0], 2.42, p[1], 2.6, 0.16, 2.2, h, 0xd8352a, 1);
    // The flag panel faces the track, which is the whole point of the post.
    const inw = side > 0 ? [Math.sin(h), 0, Math.cos(h)] : [-Math.sin(h), 0, -Math.cos(h)];
    const fx = Math.cos(h), fz = -Math.sin(h);
    const a = [p[0] + inw[0] * 1.0 - fx * 0.5, p[1] + inw[2] * 1.0 - fz * 0.5];
    const e = [p[0] + inw[0] * 1.0 + fx * 0.5, p[1] + inw[2] * 1.0 + fz * 0.5];
    flag.quadN([a[0], 1.3, a[1]], [e[0], 1.3, e[1]], [e[0], 2.1, e[1]], [a[0], 2.1, a[1]],
      [[0, 0], [1, 0], [1, 1], [0, 1]]);
    placed++;
  }
  if (!placed) return null;

  const out = [];
  const add = (b, m, o) => { const x = b.mesh(m, o); if (x) { scene.add(x); out.push(x); } };
  add(hut, look.mat('concrete', { size: 2.4, tint: 0xd6d9dd, roughness: 0.92 }));
  add(roof, look.mat('metal', { size: 2.0, tint: 0xd8352a, roughness: 0.55, metalness: 0.4 }));
  add(flag, new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.6, side: THREE.DoubleSide }), { shadow: false });
  return out;
}
