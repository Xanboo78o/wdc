// dent.js — bodywork that is bent where it was actually hit.
//
// `applyCrush` in render.js folds the car by REGION: the whole nose swings back
// and droops, the whole sidepod caves in. That reads well for a big shunt and
// it is transform-only, which is what lets twenty-two cars share one geometry.
// But it can only ever make four shapes. Kiss a barrier with the right-hand
// endplate and the entire front of the car folds identically to a head-on
// impact at 200 km/h.
//
// collide.js already records the real thing: `car.dents`, a list of impacts in
// the car's OWN coordinates — where it was hit, which way the blow went, how
// deep, and how far the damage spread. This turns that into moved vertices.
//
// THE CONSTRAINT THAT SHAPES THIS FILE: `Object3D.clone(true)` SHARES GEOMETRY.
// The field builds one reference car and clones it twenty-two times, so any
// mutation of a shared BufferGeometry would dent every car on the grid in
// exactly the same place. A deformer therefore takes its own copy of every
// geometry it touches, which costs memory per car and is why this is applied
// to the player's car rather than to all of them. Rivals keep the region fold,
// which is still transform-only and still shared.

import * as THREE from 'three';

// Smooth, round, and exactly zero at the rim — so a dent blends into the panel
// instead of leaving a crease where the falloff is clipped.
const falloff = t => { const u = 1 - t * t; return u * u; };

// A deterministic wrinkle from the vertex's own position. Crumpled carbon
// shatters and buckles; it does not dimple smoothly like a car door. Seeded by
// position so a given car always crumples the same way and nothing shimmers
// between frames.
function wrinkle(x, y, z) {
  const s = Math.sin(x * 41.3 + y * 27.7 + z * 33.1) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Give one car its own deformable bodywork. Call once, after buildCar.
 * Returns { apply(dents), reset() } — or null if there is nothing to deform.
 */
export function makeDeformer(group, wheels) {
  const skip = new Set(Object.values(wheels || {}));
  const parts = [];
  group.traverse(m => {
    if (!m.isMesh || skip.has(m) || !m.geometry?.attributes?.position) return;
    // Its own copy. See the note above about clone(true) sharing geometry.
    const own = m.geometry.clone();
    m.geometry = own;
    const attr = own.attributes.position;
    parts.push({
      m, attr,
      base: Float32Array.from(attr.array),
      // The normals car.js built, kept: some are deliberately NOT the ones
      // computeVertexNormals would give (endplates bend theirs away from the
      // sky), and recomputing on reset silently undid that on your car only.
      baseN: own.attributes.normal ? Float32Array.from(own.attributes.normal.array) : null,
      // Dents are addressed in CAR space, but a vertex is in its mesh's space.
      // The HOME offset is the bridge, and it has to be the home one: applyCrush
      // moves these meshes around, and deforming against a moved mesh would
      // make the dent crawl across the bodywork as the car folded.
      ox: m.position.x, oy: m.position.y, oz: m.position.z,
    });
  });
  if (!parts.length) return null;

  let stamp = '-';

  function restoreNormals(p) {
    const n = p.m.geometry.attributes.normal;
    if (p.baseN && n) { n.array.set(p.baseN); n.needsUpdate = true; }
    else p.m.geometry.computeVertexNormals();
  }

  function reset() {
    for (const p of parts) {
      p.attr.array.set(p.base);
      p.attr.needsUpdate = true;
      restoreNormals(p);
    }
  }

  function apply(dents) {
    // Deforming every frame would be pure waste: dents only change when
    // something hits you, which is rare and sudden. A cheap signature over the
    // set is enough to know whether anything moved.
    let sig = '';
    if (dents) for (let i = 0; i < dents.length; i++) {
      const d = dents[i];
      sig += ((d.lx * 8) | 0) + ',' + ((d.ly * 8) | 0) + ',' + ((d.depth * 60) | 0) + ';';
    }
    if (sig === stamp) return false;
    stamp = sig;
    if (!dents || !dents.length) { reset(); return true; }

    for (const p of parts) {
      const a = p.attr.array, b = p.base;
      let touched = false;
      for (let k = 0; k < a.length; k += 3) {
        // vertex in car space: the mesh's home offset plus its own position.
        // Mesh X is forward and mesh Z is the car's RIGHT (geom.js: left(h) is
        // (-sin h, 0, -cos h), which is -Z turned by the heading), while
        // collide.js's ly is positive to the LEFT. So ly lands on -z. This
        // said "mesh Z is left" and every dent was mirrored across the car: a
        // left-hand hit bent the right-hand sidepod.
        const cx = b[k] + p.ox, cy = b[k + 1] + p.oy, cz = b[k + 2] + p.oz;
        // ONE dent wins per vertex — the deepest — never the sum. Carbon that
        // has already been pushed in 0.8 m does not get pushed in twice, and
        // summing two overlapping dents on a car 2 m wide turns it inside out.
        let best = 0, bnx = 0, bny = 0, bdep = 0;
        for (let i = 0; i < dents.length; i++) {
          const d = dents[i];
          const dx = cx - d.lx, dz = cz + d.ly;
          const r2 = dx * dx + dz * dz;
          if (r2 >= d.r * d.r) continue;
          const w = falloff(Math.sqrt(r2) / d.r);
          const push = d.depth * w;
          if (push > best) { best = push; bnx = d.nx; bny = d.ny; bdep = d.depth; }
        }
        if (best <= 0.0005) {
          a[k] = b[k]; a[k + 1] = b[k + 1]; a[k + 2] = b[k + 2];
          continue;
        }
        touched = true;
        // Buckling, on top of the push. Scaled by how deep the dent is here,
        // so the middle of an impact is torn and its edges are merely bent.
        const wr = wrinkle(cx, cy, cz) * best * 0.28 * bdep;
        a[k] = b[k] + bnx * best + wr;
        a[k + 1] = b[k + 1] + wrinkle(cz, cx, cy) * best * 0.20 * bdep;
        a[k + 2] = b[k + 2] - bny * best + wr * 0.6;
      }
      if (touched) {
        p.attr.needsUpdate = true;
        // Without this the dent is invisible: the panel is bent but still lit
        // as though it were flat, so it reads as a texture glitch rather than
        // as damage. Only runs when the dents actually changed.
        p.m.geometry.computeVertexNormals();
        p.dented = true;
      } else if (p.dented) {
        p.attr.needsUpdate = true;
        restoreNormals(p);
        p.dented = false;
      }
    }
    return true;
  }

  return { apply, reset, parts: parts.length };
}

// ---------------------------------------------------------------------------
// THE REGION FOLD — the whole end of the car giving way, transform-only, so
// the twenty-two clones that share one geometry can each fold differently.
//
// This lived in render.js and binned parts by `m.position`. Every mesh on the
// 2022 car sits AT the origin (car.js translates each shape into its geometry),
// so every part fell in no bin and the fold had silently stopped folding
// anything: nose, wing, pods all stayed pristine while the dent deformer did
// the only visible damage, and only on the player's car. Two fixes:
//
//   1. WHAT a part is comes from car.js (`userData.dmg` = bin, role, side),
//      and only a body without tags (the GT3) falls back to guessing from the
//      geometry's centre — its centre, not its position.
//   2. Each part folds about a PIVOT in car space. Rotating a mesh whose
//      origin is the car's centre swings a front wing through the cockpit;
//      rotating it about the wing's own middle bends the wing.
//
// It NEVER writes `visible`. render.js and field.js set wing visibility from
// `car.lost` every frame, and the old fold re-showed a lost wing whenever the
// crush was below its threshold ("anything that writes `visible` every frame
// owns it"). A part that has come off is scaled to nothing instead.

const GONE = 1e-4;   // not 0: a singular matrix makes a NaN normal matrix

function hash3(x, y, z) {
  const s = Math.sin(x * 37.13 + y * 71.7 + z * 13.9) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

export function crushParts(group, wheels) {
  // Everything that hangs off a wheel spins with it and is not bodywork.
  const skip = new Set();
  for (const w of Object.values(wheels || {})) if (w) w.traverse(o => skip.add(o));
  const out = { front: [], rear: [], left: [], right: [] };
  const box = new THREE.Box3(), c = new THREE.Vector3();
  // A car whose parts are named folds ONLY its named parts. Guessing the rest
  // from where they sit put the front suspension in the 'front' bin and
  // folded it back through the tyres.
  let named = false;
  group.traverse(m => { if (m.isMesh && m.userData.dmg) named = true; });
  group.traverse(m => {
    if (!m.isMesh || skip.has(m) || !m.geometry) return;
    if (named && !m.userData.dmg) return;
    if (m.userData.imported) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox);
    box.getCenter(c).add(m.position);
    const tag = m.userData.dmg;
    let bin = tag && tag.bin, role = tag ? tag.role : null, side = tag ? (tag.side || 0) : 0;
    if (!tag) {
      if (c.x > 1.45) bin = 'front';
      else if (c.x < -1.45) bin = 'rear';
      else if (Math.abs(c.z) > 0.40 && Math.abs(c.x) < 1.25) bin = c.z > 0 ? 'right' : 'left';
      role = bin === 'front' || bin === 'rear' ? 'end' : 'pod';
      side = Math.sign(c.z);
      // the old rule, kept for the GT3: wide things at the very front are
      // the splitter's endplates
      if (bin === 'front' && Math.abs(c.z) > 0.70) role = 'fep';
    }
    if (!bin || !out[bin]) return;
    // The pivot each part bends about. Shared by everything that must stay
    // joined: the tip and its torn stub fold as one piece, and a sidepod, its
    // inlet, its sticker and the floor edge below all cave about one line.
    let pivot, wob = hash3(c.x, c.y, c.z), wob2 = hash3(c.z, c.x, c.y);
    if (role === 'tip' || role === 'stub') { pivot = new THREE.Vector3(2.30, 0.19, 0); wob = 0.6; wob2 = -0.4; }
    else if (role === 'pod' || role === 'edge') {
      const sd = side || Math.sign(c.z) || 1;
      pivot = new THREE.Vector3(0, 0.40, sd * 0.30);
      wob = hash3(sd, 1, 2); wob2 = hash3(2, sd, 1);
    } else pivot = c.clone();
    out[bin].push({
      m, role, side, wob, wob2, pivot,
      home: { p: m.position.clone(), q: m.quaternion.clone(), s: m.scale.clone() },
    });
  });
  return out;
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

// Place one part: rotated by (rx, ry, rz), scaled by (sx, sy, sz) about its
// pivot, then moved by (ox, oy, oz). All in car space.
function pose(it, rx, ry, rz, sx, sy, sz, ox, oy, oz) {
  const h = it.home, m = it.m;
  _q.setFromEuler(_e.set(rx, ry, rz));
  _s.set(sx, sy, sz);
  _v.copy(h.p).sub(it.pivot).multiply(_s).applyQuaternion(_q).add(it.pivot);
  m.position.set(_v.x + ox, _v.y + oy, _v.z + oz);
  m.quaternion.copy(_q).multiply(h.q);
  m.scale.copy(h.s).multiply(_s);
}

export function applyCrush(parts, crush) {
  if (!parts) return;
  for (const key of ['front', 'rear', 'left', 'right']) {
    const c = Math.min(1, (crush && crush[key]) || 0);
    for (const it of parts[key]) {
      const h = it.home, m = it.m;
      if (c < 0.001) {
        m.position.copy(h.p); m.quaternion.copy(h.q); m.scale.copy(h.s);
        continue;
      }
      const w = it.wob, w2 = it.wob2;
      if (key === 'front') {
        if (it.role === 'tip' || it.role === 'stub') {
          // the nose box crumples back on itself and drops at the tip
          pose(it, 0, w2 * 0.20 * c, -0.26 * c, 1 - 0.38 * c, 1, 1, -0.02 * c, -0.02 * c, 0);
        } else if (it.role === 'fep') {
          // an endplate is the first thing to leave an F1 car
          if (c > 0.55) pose(it, 0, 0, 0, GONE, GONE, GONE, 0, 0, 0);
          else pose(it, w * 0.20 * c, (it.side || 1) * 0.30 * c, w2 * 0.2 * c, 1, 1, 1, -0.12 * c, -0.01 * c, 0);
        } else {
          // wing elements: shoved back, one end down, twisted along the span.
          // The roll is small on purpose: a 0.99 m half-span turns a tenth of
          // a radian into a wingtip ten centimetres lower — into the road.
          pose(it, w * 0.07 * c, w2 * 0.14 * c, w * 0.16 * c, 1, 1, 1, -0.15 * c, -0.02 * c, w2 * 0.04 * c);
        }
      } else if (key === 'rear') {
        if (it.role === 'rep' && c > 0.55) pose(it, 0, 0, 0, GONE, GONE, GONE, 0, 0, 0);
        else pose(it, w2 * 0.12 * c, w * 0.10 * c, w * 0.35 * c, 1, 1, 1, 0.12 * c, -0.09 * c, w * 0.05 * c);
      } else {
        if (it.role === 'mirror') {
          if (c > 0.5) pose(it, 0, 0, 0, GONE, GONE, GONE, 0, 0, 0);
          else pose(it, w * 0.7 * c, w2 * 0.4 * c, 0, 1, 1, 1, 0, -0.02 * c, 0);
        } else {
          // a side impact pushes the pod in against the tub and down
          pose(it, w * 0.10 * c, w2 * 0.05 * c, 0, 1, 1 - 0.18 * c, 1 - 0.50 * c, 0, -0.03 * c, 0);
        }
      }
    }
  }
}
