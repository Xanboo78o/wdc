// Spa DLC — the two pit buildings, each on its surveyed OSM footprint.
//
// Read off the Walloon aerial photograph (IMAGERIE/ORTHO_2023_ETE) with the
// footprints drawn over it, 2026-10-06:
//   THE F1 PITS   inside the loop of La Source, on the right of the start
//                 straight: one white-roofed building about 330 m long, with
//                 the pit lane between it and the road. The control tower
//                 stands at its La Source end.
//   THE ENDURANCE PITS  on the right of the run down to Eau Rouge: a long,
//                 narrow, lower building — the old pits, used by the 24 Hours.
// ESTIMATED, not published and not seen from the side: every height (three
// storeys for the F1 building, two for the endurance one), the glazing, the
// tower. They are drawn as what the photograph shows from above and no more:
// a dark garage floor, glazed floors above, a white roof slab oversailing.
//
// pit.js still builds its open garages with the crews in them, in the pit
// lane's own frame, exactly as on every circuit; this only replaces the plain
// 8.5 m box the city bake would otherwise stand on the same footprint.
import * as THREE from 'three';
import { Z, Builder } from '../../geom.js';

const OWN = [
  { id: 'f1', c: [-230, 1101], floors: [4.4, 4.0, 4.0], tower: true },
  { id: 'endurance', c: [-14, 1003], floors: [4.2, 3.6], tower: false },
];
let rings = [];

export const replaces = [];
const centroid = p => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];

export function prepareEnv(env) {
  rings = [];
  if (!env || !env.buildings) return;
  env.buildings = env.buildings.filter(b => {
    if (b.k === 'grandstand') return true;
    const c = centroid(b.p);
    const spec = OWN.find(s => Math.hypot(s.c[0] - c[0], s.c[1] - c[1]) < 25 && b.p.length > 20);
    if (!spec) return true;
    rings.push({ spec, ring: b.p });
    return false;
  });
}

// A footprint grown outward by `d` metres about its centre: good enough for
// a roof slab's overhang on a long thin building, and it cannot self-cross.
const grow = (ring, d) => { const c = centroid(ring); return ring.map(p => { const v = [p[0] - c[0], p[1] - c[1]], l = Math.hypot(v[0], v[1]) || 1; return [p[0] + v[0] / l * d, p[1] + v[1] / l * d]; }); };

export function build(view, ctx) {
  const { S, t, look, world } = ctx;
  const groundY = p => (world ? world.groundY(p[0], Z(p[1])) : 0);
  const B = { base: new Builder({ color: true }), glass: new Builder(), slab: new Builder({ color: true }) };
  const DARKC = [0.42, 0.43, 0.45], WHITE = [0.93, 0.93, 0.91];
  for (const { spec, ring } of rings) {
    const r3 = ring.map(p => [p[0], Z(p[1])]);
    // It stands level on the LOW side of its plot and is as tall as that makes it.
    const gs = ring.map(groundY), g0 = Math.min(...gs), g1 = Math.max(...gs);
    let y = g1;
    B.base.prism(r3, g0 - 0.6, y + spec.floors[0], DARKC, false);
    y += spec.floors[0];
    for (let k = 1; k < spec.floors.length; k++) {
      B.slab.prism(grow(ring, 0.6).map(p => [p[0], Z(p[1])]), y, y + 0.35, WHITE, true);
      B.glass.prism(r3, y + 0.35, y + spec.floors[k], 0xffffff, false);
      y += spec.floors[k];
    }
    // The roof oversails the pit lane side and everything else by two metres.
    B.slab.prism(grow(ring, 2.2).map(p => [p[0], Z(p[1])]), y, y + 0.6, WHITE, true);
    if (spec.tower) {
      // At the end of the building nearest La Source, the first corner.
      const c1 = t.corners[0], apex = t.point(c1.s, 0);
      let far = ring[0], bd = Infinity;
      for (const p of ring) { const d = Math.hypot(p[0] - apex.x, p[1] - apex.y); if (d < bd) { bd = d; far = p; } }
      const c = centroid(ring), v = [c[0] - far[0], c[1] - far[1]], l = Math.hypot(v[0], v[1]) || 1;
      const at = [far[0] + v[0] / l * 14, far[1] + v[1] / l * 14], hd = Math.atan2(v[1], v[0]);
      B.base.box(at[0], y + 0.6 + 2.0, Z(at[1]), 9, 4.0, 9, hd, DARKC);
      B.glass.prism([[-5, -5], [5, -5], [5, 5], [-5, 5]].map(([a, b]) => [at[0] + a * Math.cos(hd) - b * Math.sin(hd), Z(at[1] + a * Math.sin(hd) + b * Math.cos(hd))]), y + 4.6, y + 7.8, 0xffffff, false);
      B.slab.box(at[0], y + 7.8 + 0.25, Z(at[1]), 12.5, 0.5, 12.5, hd, WHITE);
    }
  }
  const G = new THREE.Group();
  G.name = 'spa.pits';
  const add = (bld, mat, opts) => { const m = bld.mesh(mat, opts); if (m) G.add(m); return m; };
  const DS = THREE.DoubleSide;
  add(B.base, look.mat('concrete', { size: 3.4, tint: 0x8c8f94, roughness: 0.9, metalness: 0, side: DS, vertexColors: true }));
  add(B.slab, look.mat('concrete', { size: 3.4, tint: 0xf0efea, roughness: 0.9, metalness: 0, side: DS, vertexColors: true }));
  add(B.glass, new THREE.MeshStandardMaterial({ color: 0x2b3742, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.6, side: DS }), { shadow: false });
  S.add(G);
  let meshes = 0;
  G.traverse(o => { if (o.isMesh) meshes++; });
  return { buildings: rings.length, meshes };
}
