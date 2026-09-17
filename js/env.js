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
//
// Everything merges into a handful of draw calls: one mesh for all buildings,
// one per ground-cover type, one for the sea. 2,200 separate building meshes
// would cost more than the entire physics budget.
import * as THREE from 'three';

// Same handedness note as render.js: sim +y is the car's LEFT, three.js is the
// other handedness, so sim y maps to -z. Mirror this and the city renders
// backwards.
const Z = y => -y;

// Ground-cover colours. Deliberately desaturated and slightly varied — real
// land is never one flat hue, and a single flat green is most of what makes a
// track look like a toy.
// EVERY ground-cover layer sits BELOW the racing surface. The road is at y=0
// and the run-off at -0.03, so anything positive here paints over the track:
// Zandvoort has a single 4,886 m dune polygon in a 2,173 m world, and at
// y=+0.028 it blanketed the entire circuit in sand. Cover is scenery. It never
// competes with the surface you drive on.
const COVER = {
  forest: { col: 0x3a4a2a, y: -0.035 },
  rock:   { col: 0x6d6a63, y: -0.036 },
  scrub:  { col: 0x5a5a3c, y: -0.038 },
  park:   { col: 0x4e6336, y: -0.039 },
  grass:  { col: 0x55663a, y: -0.040 },
  pitch:  { col: 0x4a6b42, y: -0.041 },
  sand:   { col: 0xc2b083, y: -0.042 },
  farm:   { col: 0x6b6340, y: -0.044 },
  bare:   { col: 0x6a6357, y: -0.045 },
  urban:  { col: 0x54524e, y: -0.046 },
  water:  { col: 0x2b4a5e, y: -0.050 },
};

// Triangulate a flat polygon. three's ShapeUtils handles the concave footprints
// OSM is full of; a naive fan would fold them inside out.
function triangulate(p) {
  const contour = p.map(q => new THREE.Vector2(q[0], q[1]));
  try { return THREE.ShapeUtils.triangulateShape(contour, []); }
  catch { return []; }
}

function flatMesh(polys, colour, yLevel, opts = {}) {
  const pos = [], idx = [];
  let base = 0;
  for (const poly of polys) {
    const p = poly.p || poly;
    if (p.length < 3) continue;
    const tris = triangulate(p);
    if (!tris.length) continue;
    for (const q of p) { pos.push(q[0], yLevel, Z(q[1])); }
    // Z() mirrors the world, which reverses winding — so the triangle order
    // from a maths-convention triangulator has to be flipped to face up.
    for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
    base += p.length;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) nrm[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    color: colour, roughness: opts.roughness ?? 1, metalness: opts.metalness ?? 0,
    side: THREE.DoubleSide,
    // These layers are separated by millimetres so they stack without a step at
    // the track edge. Over a two-kilometre view that is far inside depth-buffer
    // precision, so push them back explicitly rather than let them flicker.
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
  }));
  m.receiveShadow = true;
  return m;
}

// Extrude every footprint into one merged prism soup. Walls get slightly
// darker vertex colour toward the ground, which reads as ambient occlusion for
// free and stops a city looking like flat cardboard.
function buildings(list) {
  const pos = [], col = [], nrm = [], idx = [];
  const c = new THREE.Color();
  let base = 0;
  for (const b of list) {
    let p = b.p;
    const h = b.h;
    if (p.length < 3) continue;
    // OSM does not guarantee which way round a footprint is wound, and the
    // extrusion's facing follows that winding — so roughly half of every city
    // came out with its walls facing INWARD, got backface-culled, and you could
    // see straight through the building. Force every footprint anticlockwise
    // (positive signed area) before extruding.
    let sa = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i], r = p[(i + 1) % p.length];
      sa += q[0] * r[1] - r[0] * q[1];
    }
    if (sa < 0) p = p.slice().reverse();
    // A little hue variation per building, seeded off position so it is stable
    const seed = (Math.abs(p[0][0] * 7.3 + p[0][1] * 3.1) % 1);
    const tint = 0.62 + seed * 0.30;
    // walls
    for (let i = 0; i < p.length; i++) {
      const a = p[i], d = p[(i + 1) % p.length];
      const dx = d[0] - a[0], dy = d[1] - a[1];
      const m = Math.hypot(dx, dy) || 1;
      // Outward normal. In sim space that is (dy, -dx) for an anticlockwise
      // ring; Z() maps sim y to -z, so it becomes (dy, 0, +dx). The + matters —
      // it was negated, which lit every wall from the inside.
      const nx = dy / m, nz = dx / m;
      const quad = [[a[0], 0, Z(a[1])], [d[0], 0, Z(d[1])], [d[0], h, Z(d[1])], [a[0], h, Z(a[1])]];
      for (let k = 0; k < 4; k++) {
        pos.push(quad[k][0], quad[k][1], quad[k][2]);
        nrm.push(nx, 0, nz);
        // Vertex colour is multiplied by the lighting, so a value that looks
        // reasonable in isolation comes out near-black on a shaded wall — the
        // first pass turned Monaco into a row of black slabs. Keep the base
        // bright and the street-level darkening subtle.
        const up = k >= 2 ? 1 : 0.72;
        c.setRGB(0.78 * tint * up, 0.76 * tint * up, 0.73 * tint * up);
        col.push(c.r, c.g, c.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }
    // roof
    const tris = triangulate(p);
    if (tris.length) {
      for (const q of p) {
        pos.push(q[0], h, Z(q[1]));
        nrm.push(0, 1, 0);
        c.setRGB(0.62 * tint, 0.61 * tint, 0.59 * tint);
        col.push(c.r, c.g, c.b);
      }
      for (const t of tris) idx.push(base + t[0], base + t[2], base + t[1]);
      base += p.length;
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.88, metalness: 0.02,
    // Belt and braces after the see-through-buildings bug: with the winding
    // normalised this should never be needed, but a degenerate footprint that
    // slips through should look slightly odd, not become a hole in the city.
    side: THREE.DoubleSide,
  }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Trees, as cheap instanced cones scattered inside forest polygons. Without
// something with HEIGHT out there, a forest is just a green patch on a plane
// and the horizon still reads as flat.
function trees(areas, limit = 2600) {
  const pts = [];
  for (const a of areas) {
    if (a.k !== 'forest' && a.k !== 'park' && a.k !== 'scrub') continue;
    const xs = a.p.map(q => q[0]), ys = a.p.map(q => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = (x1 - x0) * (y1 - y0);
    if (span < 400) continue;
    const want = Math.min(140, Math.max(3, Math.round(span / 900)));
    const tall = a.k === 'scrub' ? 0.45 : 1;
    for (let i = 0; i < want * 3 && pts.length < limit; i++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      // point-in-polygon, so trees do not spill into the road
      let inside = false;
      for (let j = 0, k = a.p.length - 1; j < a.p.length; k = j++) {
        const pj = a.p[j], pk = a.p[k];
        if ((pj[1] > y) !== (pk[1] > y) &&
            x < (pk[0] - pj[0]) * (y - pj[1]) / (pk[1] - pj[1]) + pj[0]) inside = !inside;
      }
      if (inside) pts.push([x, y, tall * (0.75 + Math.random() * 0.6)]);
    }
  }
  if (!pts.length) return null;
  const geo = new THREE.ConeGeometry(2.4, 9, 6);
  geo.translate(0, 4.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x33421f, roughness: 1, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, pts.length);
  const m = new THREE.Matrix4();
  for (let i = 0; i < pts.length; i++) {
    const [x, y, s] = pts[i];
    m.makeScale(s, s, s);
    m.setPosition(x, 0, Z(y));
    inst.setMatrixAt(i, m);
  }
  inst.castShadow = true;
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

// Build the whole environment into `scene`. Returns what it added, so the
// caller can report it rather than guess.
export function buildEnv(scene, env) {
  const added = { buildings: 0, areas: 0, sea: 0, trees: 0 };
  if (!env) return added;

  if (env.sea && env.sea.length) {
    const m = flatMesh(env.sea, COVER.water.col, -0.055, { roughness: 0.25, metalness: 0.35 });
    if (m) { scene.add(m); added.sea = env.sea.length; }
  }

  const byKind = {};
  for (const a of env.areas || []) (byKind[a.k] ||= []).push(a);
  for (const kind in byKind) {
    const spec = COVER[kind];
    if (!spec) continue;
    const m = flatMesh(byKind[kind], spec.col, spec.y);
    if (m) { scene.add(m); added.areas += byKind[kind].length; }
  }

  const bm = buildings(env.buildings || []);
  if (bm) { scene.add(bm); added.buildings = (env.buildings || []).length; }

  const tm = trees(env.areas || []);
  if (tm) { scene.add(tm); added.trees = tm.count; }

  return added;
}

export async function loadEnv(key) {
  try {
    const r = await fetch(`./data/env/${key}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
