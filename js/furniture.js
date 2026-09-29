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
import { BRANDS, brandAt, drawBrand } from './brands.js';
import { Z, Builder, Atlas, fitText } from './geom.js';
// The grid lives in a module that imports NOTHING, so the headless race gate
// can call the same function this file paints from. See js/grid.js.
import { gridSlots } from './grid.js';
import { KERB_PAINT } from './surface.js';
// Circular with crowd.js (which takes printMat from here); both sides only use
// the other's function declarations at build time, so it resolves.
import { peopleMesh } from './crowd.js';

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
// PRINT ON ONE FACE ONLY.
//
// Every sign in this world is a single DoubleSide quad, which is right for
// geometry (a board seen from behind must not vanish) and wrong for ink: from
// behind, the print showed through reversed, so a trackside TV camera read
// GNIDNARB off every hoarding on the lap. A real board has a plain back.
//
// Which face is the printed one cannot be read off the winding — the barrier
// ads are laid the same way along the lap on both sides and the text is made
// legible by flipping the UVs on one of them. So the shader asks the only
// question that is always right: is the print being seen the right way round?
// The sign of the UV Jacobian on screen answers it. Upright, unmirrored text
// has u growing rightwards and v growing upwards, a positive determinant; the
// same quad seen from behind mirrors u, and the determinant goes negative.
// Where it is negative the fragment is the back of the board: painted plain.
// ---------------------------------------------------------------------------
export function printMat(map, { back = 0x2c2f34, ...opts } = {}) {
  const m = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, ...opts });
  const backCol = new THREE.Color(back);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uBack = { value: backCol };
    sh.fragmentShader = 'uniform vec3 uBack;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec2 pdx = dFdx(vMapUv), pdy = dFdy(vMapUv);
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  if (pdx.x * pdy.y - pdx.y * pdy.x < 0.0) sampledDiffuseColor = vec4(uBack, 1.0);
  diffuseColor *= sampledDiffuseColor;
#endif
`);
  };
  m.customProgramCacheKey = () => 'print-one-face';
  return m;
}

// ---------------------------------------------------------------------------
// The sign atlas. Everything in this world with WORDS on it draws into one
// canvas, so the whole circuit's signage is a single texture and a single
// draw call. Cells are 4:1, which suits a hoarding; square signs use a
// letterboxed cell and their quad is sized to match.
// ---------------------------------------------------------------------------
// Sponsors come from js/brands.js now. Every one is invented — Adam's call,
// and the right one: a repo with no real marks in it can be copied, shipped
// and screenshotted by anyone, forever, with nobody's lawyer involved.
//
// The reason it is a module and not a list of strings is his actual note:
// "all the current sponsors are just the name in the same font, no logos, no
// typography". A brand there is a name, a palette, a TYPEFACE and a MARK,
// because the thing that makes a paddock look like a paddock is that no two
// sponsors agree about anything.
export function signAtlas(track) {
  // 64 cells now, not 48: the worst case was 20 sponsors + 6 braking boards +
  // 12 corner names + the banner + the pit sign, and Monaco really does have
  // 12 named corners. Eight big-format names go on top of that and 48 left no
  // room for them. See Atlas.cell for what happened when it did not fit.
  const A = new Atlas(4, 16, 512, 128);
  const cells = { sponsors: [], boards: {}, names: new Map(), banner: 0, pit: 0, big: [] };
  // The circuit's own list decides WHICH brands and in what order, so a track
  // keeps its character; everything about how they LOOK lives in brands.js.
  const own = track.sponsors && track.sponsors.length ? track.sponsors : [];
  const pick = i => {
    const named = own[i] && BRANDS.find(b => b.n === own[i]);
    return named || brandAt(i * 7 + (own.length || 3));
  };

  // Advertising hoardings.
  for (let i = 0; i < 20; i++) {
    const b = pick(i);
    cells.sponsors.push(A.cell((g, w, h) => drawBrand(g, w, h, b)));
  }

  // BIG FORMAT — the read-it-from-three-hundred-metres version, for the
  // grandstand fascias. Same brands, drawn flat and edge to edge: at that
  // range the bottom rule and the drop shadow are noise, and the mark plus
  // the word is all that survives.
  for (let i = 0; i < 8; i++) {
    const b = pick(i * 3 + 1);
    cells.big.push(A.cell((g, w, h) => drawBrand(g, w, h, b, { flat: true })));
  }

  // Braking boards. Drawn letterboxed into the middle of a 4:1 cell so they
  // can share the atlas; the quad that uses them is square.
  for (const n of [50, 100, 150, 200, 250, 300]) {
    cells.boards[n] = A.cell((g, w, h) => {
      g.fillStyle = '#0b0d10'; g.fillRect(0, 0, w, h);
      const s = h, x0 = (w - s) / 2;
      // The number IS the board: black on white, as big as the panel allows,
      // nothing else on it. "METRES" underneath was unreadable at any speed
      // a board is read at, and a real board does not say it either. A
      // yellow cap on the last one (50) — the board you brake AT.
      g.fillStyle = '#f2f2ee'; g.fillRect(x0, 0, s, s);
      g.fillStyle = n === 50 ? '#f5c518' : '#101014'; g.fillRect(x0, 0, s, 12);
      g.fillStyle = '#0c0d10';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      fitText(g, String(n), x0 + s / 2, s / 2 + 7, s * 0.9, s * 0.72, { colour: '#0c0d10', weight: 900 });
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
export function buildBarriers(scene, track, look, sign, corridor = null, world = null) {
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
      // Which track sample these vertices belong to, so World.liftGround
      // stands them on THIS leg's ground where the circuit crosses itself
      // (Suzuka's upper leg no longer drops its rail into the underpass).
      for (const bb of [rail, posts, conc, fence, ads]) bb.setHint(i);
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

  // Every finished geometry is displaced onto the ground by the same one
  // function. A vertical surface keeps its top and bottom vertices at the same
  // (x, z), so a guard rail post moves as a unit and stays upright with its
  // foot on the hill. See js/world.js.
  const push = (b, mat, opts) => {
    const m = b.mesh(mat, opts);
    if (m) { if (world) world.liftGround(m.geometry); scene.add(m); out.push(m); }
  };

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
    const adMat = printMat(sign.texture, { roughness: 0.7, metalness: 0.0 });
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
export function buildTyreWalls(scene, track, look, world = null) {
  const t = track;
  const stacks = [];
  for (const c of t.corners || []) {
    const side = c.dir < 0 ? -1 : 1;              // a left-hander runs wide right
    for (let s = c.s0 - 12; s <= c.s1 + 12; s += 0.95) {
      const i = t.idx(s);
      const run = side > 0 ? t.runL[i] : t.runR[i];
      if (run > 16) continue;                     // a big gravel trap needs none
      const lat = barrierLat(t, i, side) - side * 0.55;
      const q = at(t, i, lat);
      stacks.push({ p: q, h: t.hdg[i], y: world ? world.groundY(q[0], q[1]) : 0, s, side, i, c });
    }
  }
  if (!stacks.length) return null;

  // THE BELT. A modern tyre barrier is not bare tyres: the stacks are bolted
  // together and faced with a rubber conveyor belt, and the belt is painted in
  // bold alternating blocks so a driver can read the barrier at the end of a
  // braking zone from 200 m. Bare black tyres read as a dark smudge. The
  // belt stands 0.4 m in front of the stacks, 1.1 m tall, in the circuit's
  // kerb colours (surface.js KERB_PAINT), 1.9 m blocks.
  const belt = new Builder({ color: true });
  const paint = KERB_PAINT[t.key] || KERB_PAINT.default;
  for (let n = 0; n + 1 < stacks.length; n++) {
    const A = stacks[n], B = stacks[n + 1];
    if (A.c !== B.c || B.s - A.s > 1.5) continue;       // one run per corner
    const sd = A.side;
    const la = barrierLat(t, A.i, sd) - sd * 0.97, lb = barrierLat(t, B.i, sd) - sd * 0.97;
    const pa = at(t, A.i, la), pb = at(t, B.i, lb);
    const h = t.hdg[A.i];
    const inw = sd > 0 ? [Math.sin(h), 0, Math.cos(h)] : [-Math.sin(h), 0, -Math.cos(h)];
    const col = (Math.floor(A.s / 1.9) % 2) ? paint[0] : paint[1];
    const ya = A.y, yb = B.y;
    belt.quad([pa[0], ya + 0.04, pa[1]], [pb[0], yb + 0.04, pb[1]], [pb[0], yb + 1.12, pb[1]], [pa[0], ya + 1.12, pa[1]],
      inw, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
    // a dark cap along the top edge, so it reads as a thick belt, not a card
    belt.quad([pa[0], ya + 1.12, pa[1]], [pb[0], yb + 1.12, pb[1]],
      [pb[0] - inw[0] * 0.4, yb + 1.1, pb[1] - inw[2] * 0.4], [pa[0] - inw[0] * 0.4, ya + 1.1, pa[1] - inw[2] * 0.4],
      [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], 0x1a1b1e);
  }
  const bm = belt.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide }));
  if (bm) { bm.name = 'tyres.belt'; bm.castShadow = true; scene.add(bm); }

  const geo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 12, 1, true);
  const mat = look.mat('metal', { size: 0.9, tint: 0x16171a, roughness: 1, metalness: 0.0, side: THREE.DoubleSide });
  // Four high, not three: a real stack comes up to about a metre, which is
  // what the belt in front of it is sized to.
  const mesh = new THREE.InstancedMesh(geo, mat, stacks.length * 4);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
  let k = 0;
  for (const st of stacks) {
    for (let level = 0; level < 4; level++) {
      // A real tyre wall is bolted but not surveyed — the slight stagger is
      // what stops 2,000 identical cylinders reading as a machine part.
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.h + level * 0.4);
      m.compose(new THREE.Vector3(st.p[0] + (Math.random() - 0.5) * 0.06,
        st.y + 0.13 + level * 0.25,
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
export function buildBoards(scene, track, line, look, sign, world = null) {
  const t = track;
  const b = new Builder();
  const legs = new Builder();
  let any = false;

  let lastEnd = -1e9;
  for (const c of t.corners || []) {
    const iApex = t.idx(c.s);
    const vApex = line.v[iApex];
    let vMax = vApex;
    for (let s = c.s0 - 380; s < c.s0; s += t.ds) vMax = Math.max(vMax, line.v[t.idx(s)]);
    if (vMax - vApex < 22) continue;              // not a braking zone
    // The second half of a chicane is not a braking zone of its own: its
    // 380 m look-back finds the first half's straight. Without this every
    // chicane had two sets of boards, one on each side of the road.
    const boarded = c.s0 - lastEnd < 160;
    lastEnd = c.s1;
    if (boarded) continue;
    any = true;

    // Boards stand on the OUTSIDE of the coming corner, where a driver is
    // already looking, and far enough back from the barrier not to be clipped.
    const side = c.dir < 0 ? -1 : 1;
    const marks = vMax > 78 ? [300, 250, 200, 150, 100, 50] : [200, 150, 100, 50];
    for (const d of marks) {
      const i = t.idx(c.s0 - d);
      b.setHint(i); legs.setHint(i);
      const run = side > 0 ? t.runL[i] : t.runR[i];
      // ON THE VERGE, a few metres off the white line, where a real board
      // stands — not against a barrier that is 20 m away across Monza's
      // run-off, where it had shrunk to a dozen pixels and nobody could find
      // it. Only where there is no room (a street circuit) does it go back
      // against the wall.
      const w = side > 0 ? t.w[i] : t.w[i];
      const lat = run > 5
        ? side * (w + Math.max(2.6, Math.min(5.5, run * 0.35)))
        : barrierLat(t, i, side) - side * Math.min(1.6, run * 0.25);
      const p = at(t, i, lat);
      const h = t.hdg[i];
      const inw = side > 0 ? [Math.sin(h), 0, Math.cos(h)] : [-Math.sin(h), 0, -Math.cos(h)];
      // The panel faces back down the track at the oncoming car, not across it.
      // It used to span ALONG the track (fwd), i.e. face across it, and
      // carried the whole 4:1 atlas cell squashed onto a square — a board seen
      // edge-on with its number crushed to a quarter width. It spans ACROSS
      // the track now, square to the oncoming car, turned 20 degrees toward
      // the racing line, and samples only the square middle of its cell.
      const lx = -Math.sin(h), lz = -Math.cos(h);            // the car's left
      const tw = -side * 0.35;                               // toe toward the road
      const qx = lx + Math.cos(h) * tw, qz = lz - Math.sin(h) * tw;
      const qn = Math.hypot(qx, qz), ux = qx / qn, uz = qz / qn;
      const half = 0.75;
      const a = [p[0] + ux * half, p[1] + uz * half];         // left end, seen from the car
      const e = [p[0] - ux * half, p[1] - uz * half];
      const y0 = 0.62, y1 = y0 + 1.5;
      const full = sign.atlas.uv(sign.cells.boards[d], false);
      const u0 = full[0][0] + (full[1][0] - full[0][0]) * 0.375, u1 = full[0][0] + (full[1][0] - full[0][0]) * 0.625;
      const uv = [[u0, full[0][1]], [u1, full[1][1]], [u1, full[2][1]], [u0, full[3][1]]];
      b.quadN([a[0], y0, a[1]], [e[0], y0, e[1]], [e[0], y1, e[1]], [a[0], y1, a[1]], uv);
      void inw;
      const lh = Math.atan2(-uz, ux);
      legs.box(p[0] + ux * 0.5, y0 / 2, p[1] + uz * 0.5, 0.09, y0, 0.09, lh, 0x2a2e34, 1);
      legs.box(p[0] - ux * 0.5, y0 / 2, p[1] - uz * 0.5, 0.09, y0, 0.09, lh, 0x2a2e34, 1);
    }

    // The corner's real name, on the barrier at its entry.
    const cell = c.name ? sign.cells.names.get(c.name) : undefined;
    if (cell !== undefined) {
      const i = t.idx(c.s0 - 26);
      b.setHint(i);
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

  const mat = printMat(sign.texture, { roughness: 0.68 });
  const m1 = b.mesh(mat, { shadow: false });
  const m2 = legs.mesh(look.mat('metal', { size: 1.2, tint: 0x2a2e34, roughness: 0.8, metalness: 0.7 }));
  for (const m of [m1, m2]) if (m) { if (world) world.liftGround(m.geometry); scene.add(m); }
  return [m1, m2];
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

export function buildStartFinish(scene, track, look, sign, world = null) {
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
  // PAINT ON THE ROAD, so it goes on the height field the road uses and NOT
  // on the sunk ground. Lifting a road marking onto the grass drops it the
  // full sink UNDER the tarmac, where it is either invisible or a chequered
  // rectangle z-fighting through it.
  if (sm) { if (world) world.lift(sm.geometry); sm.name = 'mark.line'; scene.add(sm); out.push(sm); }

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
  if (gridMesh) { if (world) world.lift(gridMesh.geometry); gridMesh.name = 'mark.grid'; scene.add(gridMesh); out.push(gridMesh); }

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
  // The towers stand 1.4 m outside the white line — on the run-off, which is
  // drawn on the height field. The skirt beneath them is sunk and hidden, so
  // standing them on it would bury their feet.
  if (gm) { if (world) world.lift(gm.geometry); scene.add(gm); out.push(gm); }

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
  const bm = ban.mesh(printMat(sign.texture, { roughness: 0.7 }), { shadow: false });
  // Same lift as the gantry, or the banner parts company with the beam.
  if (bm) { if (world) world.lift(bm.geometry); scene.add(bm); out.push(bm); }

  // Five start lights, dark. They are props for now; when there is a race
  // start to run they are already in the right place.
  const lights = new THREE.Group();
  const lg = new THREE.BoxGeometry(0.7, 0.62, 0.34);
  const lm = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.6 });
  for (let k = 0; k < 5; k++) {
    const f = (k + 0.5) / 5;
    const x = L[0] + (R[0] - L[0]) * f, z = L[1] + (R[1] - L[1]) * f;
    const mesh = new THREE.Mesh(lg, lm);
    mesh.position.set(x, H - 0.35 + (world ? world.heightAt(x, z) : 0), z);
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
export function buildMarshalPosts(scene, track, look, world = null) {
  const t = track;
  const hut = new Builder();
  const roof = new Builder();
  const flag = new Builder();
  const crew = [];
  let placed = 0;

  // Every 200 m, not 300: a Grade 1 circuit is manned at roughly that
  // spacing, so that every metre of the lap is in sight of a flag.
  for (let s = 40; s < t.length; s += 200) {
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
    // THE MARSHALS. A post is two people in orange overalls standing at the
    // front of it, facing the track, one of them with a flag ready — that is
    // what tells you a circuit is staffed, far more than the hut does.
    const face = Math.atan2(inw[0], inw[2]);
    for (const k of [-0.7, 0.7]) {
      const q = [p[0] + inw[0] * 1.35 + fx * k, p[1] + inw[2] * 1.35 + fz * k];
      crew.push({ x: q[0], z: q[1], y: world ? world.groundY(q[0], q[1]) : 0, ry: face + (Math.random() - 0.5) * 0.4, seated: false });
    }
    placed++;
  }
  if (!placed) return null;

  const out = [];
  const add = (b, m, o) => {
    const x = b.mesh(m, o);
    if (x) { if (world) world.liftGround(x.geometry); scene.add(x); out.push(x); }
  };
  add(hut, look.mat('concrete', { size: 2.4, tint: 0xd6d9dd, roughness: 0.92 }));
  add(roof, look.mat('metal', { size: 2.0, tint: 0xd8352a, roughness: 0.55, metalness: 0.4 }));
  add(flag, new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.6, side: THREE.DoubleSide }), { shadow: false });
  // Overalls orange; the flags they hold are the working set — yellow, blue,
  // green, white — so a post reads as a post from 300 m.
  const pm = peopleMesh(crew, { palette: [0xf26a1b, 0xe85d10, 0xff7a24], flags: [0xf5c518, 0xf5c518, 0x1b4fd8, 0x1d8f3c, 0xeeeeea], flagRate: 0.5 });
  if (pm) { pm.name = 'marshals'; scene.add(pm); out.push(pm); }
  return out;
}

// ---------------------------------------------------------------------------
// Flagpoles along the start/finish straight, opposite the pits.
//
// The one thing every broadcast of a grid shows and this world did not have:
// a row of tall poles behind the barrier with the host nation's flag and the
// flags of the travelling circus snapping in the wind. Trackside life that
// moves, which is what makes a still frame read as a place and not a model.
// One merged mesh for the poles, one for the cloth; the cloth waves in the
// vertex shader from the pole outward, so the flags cost nothing per frame.
// Flags are drawn, like signs are drawn: a flag is a flat graphic, and there
// is no photograph of one lying flat to use instead.
// ---------------------------------------------------------------------------
const FLAG_ART = {
  ITALY: g => stripesV(g, ['#009246', '#f1f2f1', '#ce2b37']),
  NETHERLANDS: g => stripesH(g, ['#ae1c28', '#ffffff', '#21468b']),
  MONACO: g => stripesH(g, ['#ce1126', '#ffffff']),
  GERMANY: g => stripesH(g, ['#000000', '#dd0000', '#ffce00']),
  AZERBAIJAN: g => { stripesH(g, ['#0092bc', '#e4002b', '#00af66']); disc(g, 0.47, 0.5, 0.11, '#ffffff'); disc(g, 0.5, 0.5, 0.09, '#e4002b'); },
  JAPAN: g => { stripesH(g, ['#ffffff']); disc(g, 0.5, 0.5, 0.3, '#bc002d'); },
  'UNITED STATES': g => {
    const w = g.canvas.width, h = g.canvas.height, c = h / 13;
    for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#b22234'; g.fillRect(0, i * c, w, c + 1); }
    g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, w * 0.4, c * 7);
  },
  FRANCE: g => stripesV(g, ['#0055a4', '#ffffff', '#ef4135']),
  AUSTRIA: g => stripesH(g, ['#ed2939', '#ffffff', '#ed2939']),
  BELGIUM: g => stripesV(g, ['#000000', '#fdda24', '#ef3340']),
};
function stripesH(g, cols) {
  const w = g.canvas.width, h = g.canvas.height;
  cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, (i * h) / cols.length, w, h / cols.length + 1); });
}
function stripesV(g, cols) {
  const w = g.canvas.width, h = g.canvas.height;
  cols.forEach((c, i) => { g.fillStyle = c; g.fillRect((i * w) / cols.length, 0, w / cols.length + 1, h); });
}
function disc(g, x, y, r, col) {
  const w = g.canvas.width, h = g.canvas.height;
  g.fillStyle = col; g.beginPath(); g.arc(x * w, y * h, r * h, 0, Math.PI * 2); g.fill();
}

export function buildFlagpoles(scene, track, world = null) {
  const t = track;
  const host = FLAG_ART[t.country] ? t.country : null;
  const names = Object.keys(FLAG_ART);
  // host every other pole, the rest of the circus in between
  const order = [];
  for (let k = 0; k < 16; k++) order.push(host && k % 2 === 0 ? host : names[(k * 3 + 1) % names.length]);
  const kinds = [...new Set(order)];
  const cw = 96, ch = 64;
  const cv = document.createElement('canvas');
  cv.width = cw * kinds.length; cv.height = ch;
  const g = cv.getContext('2d');
  kinds.forEach((k, i) => {
    const sub = document.createElement('canvas'); sub.width = cw; sub.height = ch;
    FLAG_ART[k](sub.getContext('2d'));
    g.drawImage(sub, i * cw, 0);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const side = t.pit && t.pit.side ? -t.pit.side : 1;     // opposite the pit lane
  const poles = new Builder();
  const pos = [], uv = [], fu = [], fn = [], idx = [];
  const SEG = 8, FW = 1.8, FH = 1.2, POLE = 9.0;
  let n = 0;
  for (let k = 0; k < order.length; k++) {
    const s = -70 + k * 10;
    const i = t.idx(((s % t.length) + t.length) % t.length);
    const lat = barrierLat(t, i, side) + side * 2.6;
    const p = at(t, i, lat);
    const y0 = world ? world.groundY(p[0], p[1]) : 0;
    const h = t.hdg[i];
    poles.box(p[0], y0 + POLE / 2, p[1], 0.12, POLE, 0.12, h, 0xd8dadd, 1);
    poles.box(p[0], y0 + POLE + 0.05, p[1], 0.2, 0.1, 0.2, h, 0xd8dadd, 1);
    // the cloth streams downwind along the track, from the pole
    const fx = Math.cos(h), fz = -Math.sin(h);
    const nx = -fz, nz = fx;                     // the cloth's face normal
    const cell = kinds.indexOf(order[k]);
    const u0 = cell / kinds.length, u1 = (cell + 1) / kinds.length;
    const base = n;
    for (let a = 0; a <= SEG; a++) {
      const f = a / SEG;
      for (const [yy, vv] of [[POLE - FH, 0], [POLE, 1]]) {
        pos.push(p[0] + fx * FW * f, y0 + yy - 0.05, p[1] + fz * FW * f);
        uv.push(u0 + (u1 - u0) * f, vv);
        fu.push(f);
        fn.push(nx, 0, nz);
        n++;
      }
    }
    for (let a = 0; a < SEG; a++) {
      const q = base + a * 2;
      idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
  }
  const pm = poles.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 }));
  if (pm) { pm.name = 'flagpoles'; scene.add(pm); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('fu', new THREE.Float32BufferAttribute(fu, 1));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide });
  const T = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlagT = T;
    sh.vertexShader = 'uniform float uFlagT;\nattribute float fu;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    float ph = position.x * 0.37 + position.z * 0.23;
    float wv = sin(uFlagT * 5.5 - fu * 7.0 + ph) * 0.16 + sin(uFlagT * 8.3 - fu * 11.0 + ph * 1.7) * 0.05;
    transformed += normal * wv * fu;
    transformed.y -= fu * fu * 0.12;
  }`);
  };
  mat.customProgramCacheKey = () => 'flag-cloth';
  const cloth = new THREE.Mesh(geo, mat);
  cloth.name = 'flags';
  cloth.onBeforeRender = () => { T.value = performance.now() / 1000; };
  scene.add(cloth);
  return [pm, cloth];
}
