// mesh.js — load a chassis baked by tools/chassis.mjs.
//
// The bake does the hard parts offline, where they can be checked: reading
// STL or OBJ, recovering the orientation from the bounding box, scaling to the
// car's real length, standing it on the road, and decimating a 200k-triangle
// print mesh down to something a browser can draw twenty-two of.
//
// All that is left here is the axis remap and a BufferGeometry.
export async function loadChassis(name) {
  try {
    const r = await fetch(`./data/chassis/${name}.json`);
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.pos || !j.pos.length) return null;
    return j;
  } catch { return null; }
}

/**
 * Baked space is x=length, y=width, z=height with z=0 on the road — which is
 * how physics.js and tools/aerolib.mjs think, so one mesh can feed both the
 * aerodynamics and the renderer. car.js is three.js space: x forward, y UP,
 * z lateral. This is the one line between them.
 */
export function chassisGeometry(THREE, j) {
  const src = j.pos;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];          // length  -> forward
    out[i + 1] = src[i + 2];  // height  -> up
    out[i + 2] = src[i + 1];  // width   -> lateral
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}
