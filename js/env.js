// env.js — the world around the circuit, built from real survey geometry.
//
// This exists for one complaint: "NEVER let me see the baseplate horizon" and
// "make it so it actually looks like the area". A flat green plane meeting the
// sky reads as a video game in about a second. Monza is inside a walled royal
// park full of trees; Zandvoort is in sand dunes with the North Sea behind;
// Monaco is a wall of apartment blocks with the Mediterranean at the bottom.
//
// None of that is invented here. `tools/bakeenv.mjs` pulls it from
// OpenStreetMap using the SAME projection the circuit was baked with, which is
// why the facades line up with the barriers instead of floating 40 m away.
// Each building carries what the survey actually knows about it: `k` its kind,
// `lv` its storeys, `c` and `rc` its facade and roof colour where somebody has
// stood in front of it and written them down.
//
// ---------------------------------------------------------------------------
// DEPTH, AND WHERE THE BUDGET GOES
//
// A city of flat-shaded extrusions is the thing that makes a racing game look
// like a racing game. What fixes it is windows, a cornice at the roofline, a
// different ground floor, and colours that vary the way a real street varies.
// What you cannot do is give all 2,278 buildings at Monaco all of that: the
// windows alone would be a quarter of a million quads.
//
// So the spend is by DISTANCE. Buildings within ~260 m of the racing line —
// the only ones you will ever look at properly — get windows, a ground floor,
// a cornice and a roof. Everything beyond that is a tinted, textured
// extrusion, which at 300 m is indistinguishable and costs a twentieth as
// much. The near set is capped and sorted, so a dense city spends its budget
// on the buildings lining the track rather than on a suburb behind a hill.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { Z, Builder } from './geom.js';
import { plantWoods } from './woods.js';

const NEAR = 340;            // metres: inside this a building gets detailed
const MAX_WINDOWS = 26000;   // hard ceiling on window quads per circuit
const STOREY = 3.2;
const BAY = 3.6;             // metres between windows along a facade

// Ground-cover colours. Deliberately desaturated and slightly varied — real
// land is never one flat hue, and a single flat green is most of what makes a
// track look like a toy. `tex` names the PBR set each one is painted with.
//
// EVERY ground-cover layer sits BELOW the racing surface. The road is at y=0
// and the run-off at -0.03, so anything positive here paints over the track:
// Zandvoort has a single 4,886 m dune polygon in a 2,173 m world, and at
// y=+0.028 it blanketed the entire circuit in sand. Cover is scenery. It never
// competes with the surface you drive on.
const COVER = {
  forest: { col: 0x46552f, y: -0.035, tex: 'grass', size: 6 },
  rock:   { col: 0x7d7a72, y: -0.036, tex: 'gravel', size: 5 },
  scrub:  { col: 0x6c6c4a, y: -0.038, tex: 'grass', size: 7 },
  park:   { col: 0x5a7040, y: -0.039, tex: 'grass', size: 4 },
  grass:  { col: 0x62733f, y: -0.040, tex: 'grass', size: 4 },
  pitch:  { col: 0x527a46, y: -0.041, tex: 'grass', size: 3 },
  sand:   { col: 0xcbba8d, y: -0.042, tex: 'sand', size: 5 },
  farm:   { col: 0x7a7247, y: -0.044, tex: 'grass', size: 9 },
  bare:   { col: 0x7a7261, y: -0.045, tex: 'gravel', size: 5 },
  urban:  { col: 0x63615c, y: -0.046, tex: 'concrete', size: 6 },
  water:  { col: 0x2b4a5e, y: -0.050, tex: null, size: 8 },
};

// Facade palettes by what the building IS. Two or three plausible colours each
// rather than one, because a street of identical houses is its own kind of
// wrong. A surveyed `building:colour` always wins over these.
const PALETTE = {
  apartments: ['#d9cfbc', '#cbbfa8', '#e0d6c4', '#c4b9a6', '#d7c6ad'],
  house:      ['#d8d2c6', '#c8b9a4', '#b9a389', '#e2ddd2', '#a98f73'],
  retail:     ['#e4ded2', '#d2cdc2', '#cfc2ae'],
  office:     ['#c9ccd0', '#b9bfc6', '#d4d7db'],
  hotel:      ['#e6dccb', '#d8cdb8', '#efe7d8'],
  industrial: ['#b0b4b8', '#9ea3a8', '#c0c3c6', '#a8a094'],
  garage:     ['#b4b0a8', '#a6a29a', '#c2beb6'],
  shed:       ['#a8a49c', '#b6b2aa'],
  church:     ['#ded6c4', '#cfc5b0'],
  roof:       ['#c6c9cd', '#b4b8bc'],
  stadium:    ['#c4c8cc', '#b2b6ba'],
  grandstand: ['#c4c8cc'],
  _:          ['#cfc9bd', '#c2bcb0', '#d8d2c6', '#b9b3a7'],
};
const ROOFS = {
  house:      ['#9d5b3f', '#8a4f38', '#7c4a36'],
  apartments: ['#8f8b82', '#9d5b3f', '#7d7a72'],
  industrial: ['#8a8f94', '#7c8288'],
  garage:     ['#8a8f94'],
  church:     ['#7a6a58'],
  _:          ['#8d8a82', '#7f7c75'],
};

// How likely a building is to be brick rather than painted render, per
// circuit. Zandvoort is a Dutch seaside town and is mostly brick; Monaco is a
// Mediterranean city and is almost entirely render. This one number per track
// does more for "it actually looks like the area" than any amount of geometry.
const BRICKINESS = { zandvoort: 0.78, monza: 0.42, suzuka: 0.2, monaco: 0.1, baku: 0.16, nurburgring: 0.25,
  // Pembroke, NH: painted clapboard houses, the odd brick mill building.
  street: 0.12 };

// A stable pseudo-random in [0,1) from a position, so a building looks the
// same every time the page loads instead of re-rolling its colour on reload.
function seeded(x, y, salt = 0) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + salt * 43.7585) * 43758.5453;
  return s - Math.floor(s);
}
const pick = (list, r) => list[Math.floor(r * list.length) % list.length];

// Distance from a footprint to the nearest centreline sample. Coarse on
// purpose: it only decides how much detail to spend, so 16 m of error is free.
//
// Every vertex of the ring, not just the first one. Testing ring[0] alone is
// almost right and fails on exactly the buildings that matter: a 200 m
// warehouse whose footprint happens to start at the far end measures as 200 m
// away and loses its windows, so the largest wall on the Baku street canyon
// came out as an unbroken sheet of brick six storeys high.
function distToTrack(track, ring) {
  let best = Infinity;
  for (const p of ring) {
    for (let i = 0; i < track.n; i += 8) {
      const d = (track.x[i] - p[0]) ** 2 + (track.y[i] - p[1]) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

// A surveyed colour is whatever somebody typed into OpenStreetMap, and what
// they typed at Baku was "navy blue" — which THREE.Color cannot parse, and
// which it complains about once per building rather than throwing. Validate
// here and fall back to the palette, so a bad tag costs one building its
// surveyed colour instead of filling the console.
function safeColour(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(t)) return t;
  if (/^rgb\(/.test(t)) return t;
  return (THREE.Color.NAMES && t.replace(/\s+/g, '') in THREE.Color.NAMES)
    ? t.replace(/\s+/g, '') : null;
}

// ---------------------------------------------------------------------------
// One building. `detail` decides whether it gets windows, a ground floor and a
// cornice, or whether it is a plain extrusion.
// ---------------------------------------------------------------------------
function building(wall, glass, roofB, b, detail, trackKey, y0 = 0) {
  let p = b.p;
  if (p.length < 3) return 0;
  // OSM does not guarantee which way round a footprint is wound. Builder
  // normalises it, but the window loop below walks the ring itself and needs
  // the same orientation to get its outward normals right.
  let sa = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i], r = p[(i + 1) % p.length];
    sa += q[0] * r[1] - r[0] * q[1];
  }
  // In three's x/z plane after the sim->three reflection an up-facing ring has
  // NEGATIVE shoelace, and the ring here is still in sim coordinates where the
  // sense is the other way round. Force anticlockwise-in-sim.
  if (sa < 0) p = p.slice().reverse();

  const kind = b.k || '_';
  const h = b.h;
  const r1 = seeded(p[0][0], p[0][1], 1);
  const r2 = seeded(p[0][0], p[0][1], 2);
  const base = safeColour(b.c) || pick(PALETTE[kind] || PALETTE._, r1);
  const roofCol = safeColour(b.rc) || pick(ROOFS[kind] || ROOFS._, r2);

  // Three-space ring. `y0` is ONE height for the whole building, taken at its
  // footprint — a building is rigid, and letting each vertex follow the
  // terrain under it would shear a 30 m block on Monaco's hillside by metres.
  const ring = p.map(q => [q[0], Z(q[1])]);
  const storeys = b.lv || Math.max(1, Math.round((h - 1) / STOREY));

  // --- `building=roof` is a ROOF, with nothing under it ---------------------
  // OSM uses it for a structure that is a roof on supports and open at the
  // sides: canopies, covered parking, and at a circuit the roofed viewing
  // structures. Suzuka has 31 of them and Monaco 22, and extruded as solid
  // prisms they are the blank grey slabs that made Suzuka look unfinished.
  // A slab on columns is barely more geometry and reads completely differently,
  // because you can see daylight under it.
  if (kind === 'roof') {
    const top = y0 + Math.max(2.6, h);
    wall.fan(ring, top, roofCol);                      // the roof itself
    wall.fan(ring.slice().reverse(), top - 0.35, roofCol);  // and its underside
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const m = Math.hypot(dx, dz);
      if (m < 0.4) continue;
      // a fascia round the edge, so the roof has a thickness
      wall.quadN([a[0], top - 0.35, a[1]], [c[0], top - 0.35, c[1]],
        [c[0], top, c[1]], [a[0], top, a[1]],
        [[0, 0], [m, 0], [m, 0.35], [0, 0.35]], roofCol);
      // columns along the edge, roughly every 6 m and at least at the corners
      const cols = Math.max(1, Math.round(m / 6));
      for (let k = 0; k < cols; k++) {
        const f = (k + 0.5) / cols;
        wall.box(a[0] + dx * f, (top - 0.35 + y0) / 2, a[1] + dz * f,
          0.3, top - 0.35 - y0, 0.3, 0, base, 1);
      }
    }
    return 0;
  }

  if (!detail) {
    wall.prism(ring, y0, y0 + h, base, true, 1, roofCol);
    return 0;
  }

  // --- a ground floor that is not the same as the rest --------------------
  // Shops, garage doors, stone plinths. Whatever it is, the bottom 3.2 m of a
  // real building is never the same as the seventh floor, and breaking the
  // wall there is the cheapest depth cue on the list.
  const gh = Math.min(STOREY, h * 0.5);
  const groundCol = new THREE.Color(base).multiplyScalar(0.82).getHex();
  let windows = 0;

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const m = Math.hypot(dx, dz);
    if (m < 0.4) continue;
    const ux = dx / m, uz = dz / m;
    const n = [-uz, 0, ux];                       // outward, for this winding

    const face = (y0, y1, colour) => wall.quad(
      [a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], n,
      [[0, y0], [m, y0], [m, y1], [0, y1]], colour);

    face(y0, y0 + gh, groundCol);
    face(y0 + gh, y0 + h, base);

    // --- the cornice ------------------------------------------------------
    // A band that steps 0.22 m PROUD for the top 0.5 m. It is a tiny amount of
    // geometry and it is what stops a roofline being a cut edge: it catches
    // the sun and throws a line of shadow down the facade.
    if (h > 5.5) {
      const top = y0 + h, o = 0.22;
      const a2 = [a[0] + n[0] * o, a[1] + n[2] * o], c2 = [c[0] + n[0] * o, c[1] + n[2] * o];
      wall.quad([a2[0], top - 0.5, a2[1]], [c2[0], top - 0.5, c2[1]], [c2[0], top, c2[1]], [a2[0], top, a2[1]],
        n, [[0, 0], [m, 0], [m, 0.5], [0, 0.5]], base);
      wall.quadN([a[0], top - 0.5, a[1]], [c[0], top - 0.5, c[1]], [c2[0], top - 0.5, c2[1]], [a2[0], top - 0.5, a2[1]],
        [[0, 0], [m, 0], [m, o], [0, o]], base);
      wall.quadN([a2[0], top, a2[1]], [c2[0], top, c2[1]], [c[0], top, c[1]], [a[0], top, a[1]],
        [[0, 0], [m, 0], [m, o], [0, o]], base);
    }

    // --- windows ----------------------------------------------------------
    // Laid out on a real grid: one bay every 3.6 m, one row per storey, and
    // the glass sits 2 cm proud of the wall so the frame around it reads as a
    // reveal. Proud, not recessed — an inset pane would be hidden BEHIND a
    // solid wall with no hole in it, which is a lot of work for nothing.
    const bays = Math.floor(m / BAY);
    if (bays >= 1 && h > 3.4 && kind !== 'roof') {
      const pad = (m - bays * BAY) / 2;
      for (let s = 0; s < storeys; s++) {
        const cy = y0 + gh + (s + 0.5) * ((h - gh - (h > 5.5 ? 0.6 : 0)) / Math.max(1, storeys));
        if (cy < y0 + gh + 0.7 || cy > y0 + h - 0.8) continue;
        const wh = kind === 'industrial' || kind === 'garage' ? 0.9 : 1.45;
        for (let k = 0; k < bays; k++) {
          const t0 = pad + k * BAY + BAY / 2 - 0.62, t1 = pad + k * BAY + BAY / 2 + 0.62;
          const g0 = [a[0] + ux * t0 + n[0] * 0.02, a[1] + uz * t0 + n[2] * 0.02];
          const g1 = [a[0] + ux * t1 + n[0] * 0.02, a[1] + uz * t1 + n[2] * 0.02];
          glass.quad([g0[0], cy - wh / 2, g0[1]], [g1[0], cy - wh / 2, g1[1]],
            [g1[0], cy + wh / 2, g1[1]], [g0[0], cy + wh / 2, g0[1]], n,
            [[0, 0], [1.24, 0], [1.24, wh], [0, wh]]);
          // a sill, standing proud under the pane
          const s0 = [a[0] + ux * (t0 - 0.08) + n[0] * 0.10, a[1] + uz * (t0 - 0.08) + n[2] * 0.10];
          const s1 = [a[0] + ux * (t1 + 0.08) + n[0] * 0.10, a[1] + uz * (t1 + 0.08) + n[2] * 0.10];
          wall.quadN([s0[0], cy - wh / 2, s0[1]], [s1[0], cy - wh / 2, s1[1]],
            [g1[0], cy - wh / 2 - 0.02, g1[1]], [g0[0], cy - wh / 2 - 0.02, g0[1]],
            [[0, 0], [1.4, 0], [1.4, 0.12], [0, 0.12]], base);
          windows++;
        }
      }
    }
  }
  roofB.fan(ring, y0 + h, roofCol);
  void trackKey;
  return windows;
}

// ---------------------------------------------------------------------------
// Trees. Two sources, and the real one wins.
//
// `env.trees` is every `natural=tree` NODE the survey has — 1,386 of them at
// Monza, which is the avenue of planes along the main straight, standing where
// they stand. Forest polygons are then filled with scattered trees to make up
// the mass behind them. Scattering alone put a random wood where an avenue is.
// ---------------------------------------------------------------------------
// A tree is about 9 m tall, not 14. The first pass scaled up to 1.35 on top of
// a 10.6 m model and put 19 m Christmas trees against a Monaco apartment
// block, which made the whole scene read as a toy.
//
// TWO SPECIES, because one was wrong everywhere. A stack of cones is a
// conifer, which is right for the woods around Monza and Suzuka and absurd
// beside the Mediterranean; the plane trees along Monza's straight and the
// palms and limes in Monaco's gardens are round. So `natural=tree` nodes and
// park scatter get a broadleaf crown, forest and scrub get conifers, and the
// two ship as two instanced meshes — two draw calls for the whole circuit.
function trunk(h, r) {
  const b = new Builder({ uv: false });
  b.box(0, h / 2, 0, r, h, r, 0, 0xffffff, 1);
  const g = b.geometry();
  g.deleteAttribute('uv'); g.deleteAttribute('uv1');
  return g;
}

// Merge by hand — BufferGeometryUtils is in the addons bundle this project
// does not vendor.
function mergeParts(parts) {
  // Not every three primitive is indexed: ConeGeometry is, IcosahedronGeometry
  // is not. Reading `g.index.array` blind threw on the first broadleaf tree.
  const count = g => g.index ? g.index.count : g.attributes.position.count;
  let np = 0, ni = 0;
  for (const g of parts) { np += g.attributes.position.count; ni += count(g); }
  const pos = new Float32Array(np * 3), nrm = new Float32Array(np * 3), idx = new Uint32Array(ni);
  let po = 0, io = 0, vo = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, po * 3);
    nrm.set(g.attributes.normal.array, po * 3);
    const n = count(g);
    for (let i = 0; i < n; i++) idx[io + i] = (g.index ? g.index.array[i] : i) + vo;
    po += g.attributes.position.count; io += n; vo = po;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function coniferGeometry() {
  const g1 = new THREE.ConeGeometry(1.85, 4.1, 8); g1.translate(0, 3.6, 0);
  const g2 = new THREE.ConeGeometry(1.45, 3.4, 8); g2.translate(0.22, 5.2, -0.14);
  const g3 = new THREE.ConeGeometry(0.95, 2.4, 8); g3.translate(-0.1, 6.8, 0.1);
  return mergeParts([trunk(1.9, 0.32), g1, g2, g3]);
}

// A broadleaf crown: three offset low-poly spheres. Low detail on purpose —
// an icosahedron at detail 0 is 20 faces, and three of them overlapping give a
// lumpy round mass that reads as foliage from ten metres and as a green blob
// from two hundred, which is the whole range that matters.
function broadleafGeometry() {
  // Detail 1, not 0. A 20-face icosahedron at two hundred metres is a green
  // blob and at fifteen metres — which is where Monaco's plane trees stand —
  // it is an obvious faceted lump. 80 faces is still nothing and it rounds off.
  // Crowns are smaller too: the first pass put 8 m wide canopies beside a
  // street where the real trees are slim.
  const c1 = new THREE.IcosahedronGeometry(1.75, 1); c1.translate(0, 4.6, 0);
  const c2 = new THREE.IcosahedronGeometry(1.25, 1); c2.translate(0.95, 4.0, 0.4);
  const c3 = new THREE.IcosahedronGeometry(1.1, 1); c3.translate(-0.8, 4.15, -0.55);
  // A short, thick trunk. Tall and thin turned every tree into a lollipop.
  return mergeParts([trunk(3.6, 0.44), c1, c2, c3]);
}

/**
 * Is this point on the circuit itself?
 *
 * `corridor` in this file is the PIT corridor — it keeps buildings out of the
 * garages, and knows nothing about the racing surface. So a forest or park
 * polygon that overlaps the track scattered trees onto the run-off and, at
 * Monza, onto the road: 15 of them standing in the racing line.
 */
function onCircuit(track, x, y) {
  if (!track) return false;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < track.n; i += 2) {
    const dx = track.x[i] - x, dy = track.y[i] - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; bi = i; }
  }
  // Track plus its run-off, and a metre for the trunk. Deliberately NOT more:
  // the avenue of plane trees down the Monza straight stands just outside the
  // run-off and is the one piece of scenery that circuit is known for.
  const clear = track.w[bi] + Math.max(track.runL[bi], track.runR[bi]) + 1;
  return bd < clear * clear;
}

function scatter(env, limit, track) {
  const round = [], conifer = [];
  // Surveyed trees first: 1,386 of them at Monza, which is the avenue of plane
  // trees along the main straight, standing where they stand.
  for (const t of env.trees || []) {
    if (onCircuit(track, t[0], t[1])) continue;
    round.push([t[0], t[1], 0.72 + seeded(t[0], t[1], 3) * 0.34]);
    if (round.length >= limit * 0.5) break;
  }
  for (const a of env.areas || []) {
    if (round.length + conifer.length >= limit) break;
    if (a.k !== 'forest' && a.k !== 'park' && a.k !== 'scrub') continue;
    const into = a.k === 'park' ? round : conifer;
    const xs = a.p.map(q => q[0]), ys = a.p.map(q => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = (x1 - x0) * (y1 - y0);
    if (span < 400) continue;
    const want = Math.min(140, Math.max(3, Math.round(span / 900)));
    const tall = a.k === 'scrub' ? 0.42 : 1;
    for (let i = 0; i < want * 3 && round.length + conifer.length < limit; i++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      // point-in-polygon, so trees do not spill into the road
      let inside = false;
      for (let j = 0, k = a.p.length - 1; j < a.p.length; k = j++) {
        const pj = a.p[j], pk = a.p[k];
        if ((pj[1] > y) !== (pk[1] > y) &&
            x < (pk[0] - pj[0]) * (y - pj[1]) / (pk[1] - pj[1]) + pj[0]) inside = !inside;
      }
      if (inside && !onCircuit(track, x, y)) into.push([x, y, tall * (0.66 + Math.random() * 0.44)]);
    }
  }
  return { round, conifer };
}

function treeMesh(pts, geo, world) {
  if (!pts.length) return null;
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true, metalness: 0 });
  const inst = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length; i++) {
    const [x, y, k] = pts[i];
    q.setFromAxisAngle(up, seeded(x, y, 4) * Math.PI * 2);
    s.set(k, k * (0.88 + seeded(x, y, 5) * 0.3), k);
    v.set(x, world ? world.groundY(x, Z(y)) : 0, Z(y));
    m.compose(v, q, s);
    inst.setMatrixAt(i, m);
    // Real foliage is a spread of greens, not one. This is the difference
    // between a wood and a bag of identical Christmas trees.
    const g = 0.20 + seeded(x, y, 6) * 0.16;
    c.setRGB(g * 0.78, g * 1.22, g * 0.45);
    inst.setColorAt(i, c);
  }
  inst.castShadow = true;
  // Named so tools/groundcheck.mjs can walk the instances and count how many
  // trees ended up on the racing surface. `onCircuit` above is the filter;
  // this is what checks the filter actually ran.
  inst.name = 'env.trees';
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  return inst;
}

// ---------------------------------------------------------------------------
function flatMesh(polys, look, spec, world) {
  const b = new Builder();
  for (const poly of polys) {
    const p = poly.p || poly;
    if (p.length < 3) continue;
    b.fan(p.map(q => [q[0], Z(q[1])]), spec.y, null);
  }
  const g = b.geometry();
  if (!g) return null;
  const mat = spec.tex
    ? look.mat(spec.tex, {
      size: spec.size, tint: spec.col, roughness: 1, metalness: 0,
      side: THREE.DoubleSide,
      // These layers are separated by millimetres so they stack without a step
      // at the track edge. Over a two-kilometre view that is far inside
      // depth-buffer precision, so push them back explicitly rather than let
      // them flicker.
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
    })
    : new THREE.MeshStandardMaterial({
      color: spec.col, roughness: 0.22, metalness: 0.4, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
    });
  if (world) world.liftGround(g);
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// The town's streets, on a circuit that has them (tools/bakeenv.mjs FITTED —
// Adam's street circuit in Pembroke). A quad per segment, the real width,
// tarmac at true scale, draped on the land like the ground cover. It sits
// above every cover layer and below the run-off (-0.03), so a street that
// reaches the circuit's edge meets it without either painting over the other.
function roadMesh(roads, look, world) {
  const b = new Builder();
  for (const r of roads) {
    const p = r.p, hw = r.w / 2;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      const dx = bx - ax, dy = by - ay, m = Math.hypot(dx, dy);
      if (m < 0.01) continue;
      // Half a width of overlap at each end fills the wedge at every bend.
      const ux = dx / m, uy = dy / m, nx = -uy * hw, ny = ux * hw;
      const ex = ux * Math.min(hw, m / 2) * (i ? 1 : 0), ey = uy * Math.min(hw, m / 2) * (i ? 1 : 0);
      b.quadUp([
        [ax - ex + nx, Z(ay - ey + ny)], [bx + nx, Z(by + ny)],
        [bx - nx, Z(by - ny)], [ax - ex - nx, Z(ay - ey - ny)],
      ], -0.032, null);
    }
  }
  const g = b.geometry();
  if (!g) return null;
  if (world) world.liftGround(g);
  const m = new THREE.Mesh(g, look.mat('tarmac', {
    size: 6, tint: 0x8a8a88, roughness: 0.92, metalness: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2,
  }));
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// True if a footprint sits inside the corridor the pit complex occupies.
// Monza tags 81 real buildings `garage` along its pit straight and Zandvoort
// 50 more; built as well as the synthetic garages they interpenetrate, and you
// end up looking out of a pit box through somebody's brick wall.
function inCorridor(ring, corridor) {
  if (!corridor) return false;
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; }
  cx /= ring.length; cy /= ring.length;
  const r2 = corridor.radius * corridor.radius;
  for (const q of corridor.pts) {
    if ((q[0] - cx) ** 2 + (q[1] - cy) ** 2 < r2) return true;
  }
  return false;
}

export function buildEnv(scene, env, track, look, corridor = null, world = null) {
  const added = { buildings: 0, detailed: 0, windows: 0, areas: 0, sea: 0, trees: 0, cleared: 0 };
  if (!env) return added;

  if (env.sea && env.sea.length) {
    const m = flatMesh(env.sea, look, { col: COVER.water.col, y: -0.055, tex: null, size: 8 }, null);
    if (m) { scene.add(m); added.sea = env.sea.length; }
  }

  const byKind = {};
  for (const a of env.areas || []) (byKind[a.k] ||= []).push(a);
  for (const kind in byKind) {
    const spec = COVER[kind];
    if (!spec) continue;
    const m = flatMesh(byKind[kind], look, spec, world);
    if (m) { scene.add(m); added.areas += byKind[kind].length; }
  }
  if (env.roads && env.roads.length) {
    const m = roadMesh(env.roads, look, world);
    if (m) { scene.add(m); added.roads = env.roads.length; }
  }

  // --- buildings ------------------------------------------------------------
  // Grandstands are pulled out and handed to crowd.js, which builds them as
  // raked seating rather than as a box.
  const all = (env.buildings || []).filter(b => b.k !== 'grandstand' && !inCorridor(b.p, corridor));
  added.cleared = (env.buildings || []).length - all.length;
  const withDist = all.map(b => ({ b, d: distToTrack(track, b.p) }));
  withDist.sort((x, y) => x.d - y.d);

  const brickP = BRICKINESS[env.key] ?? 0.35;
  const brick = { wall: new Builder({ color: true }), glass: new Builder(), roof: new Builder({ color: true }) };
  const rendr = { wall: new Builder({ color: true }), glass: new Builder(), roof: new Builder({ color: true }) };
  let windows = 0, detailed = 0;

  for (const { b, d } of withDist) {
    const isBrick = seeded(b.p[0][0], b.p[0][1], 7) < brickP && b.k !== 'office' && b.k !== 'stadium';
    const pile = isBrick ? brick : rendr;
    const detail = d < NEAR && windows < MAX_WINDOWS;
    const y0 = world ? world.groundY(b.p[0][0], Z(b.p[0][1])) : 0;
    windows += building(pile.wall, pile.glass, pile.roof, b, detail, env.key, y0);
    if (detail) detailed++;
    added.buildings++;
  }
  added.windows = windows;
  added.detailed = detailed;

  const put = (bld, mat, opts) => { const m = bld.mesh(mat, opts); if (m) scene.add(m); };
  // vertexColors carries the per-building tint; the map carries the material.
  // The two multiply, which is how one brick scan becomes a whole town.
  put(brick.wall, look.mat('brick', { size: 2.4, vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  put(rendr.wall, look.mat('plaster', { size: 3.0, vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  put(brick.roof, look.mat('concrete', { size: 3.0, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  put(rendr.roof, look.mat('concrete', { size: 3.0, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));

  // Glass is the one material here that is NOT a photograph: it is a mirror.
  // Low roughness and a full-strength environment map means every pane picks
  // up the actual sky above the circuit, which is what makes a window read as
  // a window from 200 m rather than as a dark rectangle.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2b3742, roughness: 0.09, metalness: 0.55, envMapIntensity: 1.6, side: THREE.DoubleSide,
  });
  put(brick.glass, glassMat, { shadow: false });
  put(rendr.glass, glassMat, { shadow: false });

  // Adam's forest (js/woods.js, 2026-09-23). It needs the plant photographs,
  // which load asynchronously, so the wood arrives a moment after the world
  // does; without them, the old cones and spheres go in instead.
  const oldTrees = () => {
    const { round, conifer } = scatter(env, 4200, track);
    for (const [pts, geo] of [[round, broadleafGeometry()], [conifer, coniferGeometry()]]) {
      const tm = treeMesh(pts, geo, world);
      if (tm) { scene.add(tm); added.trees += tm.count; }
    }
  };
  plantWoods(scene, env, track, look, corridor, world)
    .then(n => { if (n == null) oldTrees(); else added.trees = n; return n; })
    .catch(e => { console.error('woods:', e); oldTrees(); return null; });

  return added;
}

export async function loadEnv(key) {
  try {
    const r = await fetch(`./data/env/${key}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
