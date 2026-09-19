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
      // Dents are addressed in CAR space, but a vertex is in its mesh's space.
      // The HOME offset is the bridge, and it has to be the home one: applyCrush
      // moves these meshes around, and deforming against a moved mesh would
      // make the dent crawl across the bodywork as the car folded.
      ox: m.position.x, oy: m.position.y, oz: m.position.z,
    });
  });
  if (!parts.length) return null;

  let stamp = '-';

  function reset() {
    for (const p of parts) {
      p.attr.array.set(p.base);
      p.attr.needsUpdate = true;
      p.m.geometry.computeVertexNormals();
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
        // Mesh X is forward and mesh Z is left, which is exactly how
        // collide.js stores lx and ly — no axis juggling, and crushParts bins
        // on p.z > 0 === left for the same reason.
        const cx = b[k] + p.ox, cy = b[k + 1] + p.oy, cz = b[k + 2] + p.oz;
        // ONE dent wins per vertex — the deepest — never the sum. Carbon that
        // has already been pushed in 0.8 m does not get pushed in twice, and
        // summing two overlapping dents on a car 2 m wide turns it inside out.
        let best = 0, bnx = 0, bny = 0, bdep = 0;
        for (let i = 0; i < dents.length; i++) {
          const d = dents[i];
          const dx = cx - d.lx, dz = cz - d.ly;
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
        a[k + 2] = b[k + 2] + bny * best + wr * 0.6;
      }
      if (touched || sig === '') {
        p.attr.needsUpdate = true;
        // Without this the dent is invisible: the panel is bent but still lit
        // as though it were flat, so it reads as a texture glitch rather than
        // as damage. Only runs when the dents actually changed.
        p.m.geometry.computeVertexNormals();
      }
    }
    return true;
  }

  return { apply, reset, parts: parts.length };
}
