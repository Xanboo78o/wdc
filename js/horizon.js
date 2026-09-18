// horizon.js — the air, and what is in the distance.
//
// Adam, looking at the finished look pass: *"it doesnt capture the feel tho,
// like i dont want a clear horizon"*.
//
// He is right, and the screenshot that proved it is the one down the back
// straight at Monza: a razor line where flat green meets sky, a hoarding 300 m
// away as sharp as one at 20 m, and then nothing at all beyond about two
// kilometres. Every material in that frame was a photograph and it still read
// as a diorama, because what separates a photograph of a place from a render
// of one is not the surfaces. It is the AIR between you and them.
//
// Three things do that work, and none of them is a texture or a shader:
//
//   1. AERIAL PERSPECTIVE. Distance has to cost contrast. Exponential-squared
//      fog, tuned so a ridge at 2.5 km is half washed out and one at 6 km is
//      barely a shade against the sky.
//
//   2. SOMETHING TO BE FAR AWAY. Fog acting on an empty plane produces a flat
//      band and a hard line, which is precisely what the screenshot showed.
//      The layers have to exist before the air can act on them — three rings
//      of land at 2.6, 4.8 and 7.6 km, each further into the haze than the
//      last. That is where depth actually comes from.
//
//   3. A HAZE BAND AT THE JOIN. Real horizons are never an edge. A band of
//      light sitting low in the sky, denser at the bottom, is what turns the
//      meeting of ground and sky from a line into a gradient.
//
// The distant rings are lit by nothing — MeshBasicMaterial with fog left ON,
// so the ONLY thing that shades them is the air. That is physically what
// happens: at six kilometres you are not seeing a hillside, you are seeing the
// atmosphere in front of it.
import * as THREE from 'three';
import { Z } from './geom.js';

// What the land does beyond the survey, per circuit. None of this is in
// OpenStreetMap — the bake stops 600 m past the track — but all of it is true
// of the place. Monza sits on the Lombardy plain with wooded parkland and the
// foothills a long way north; Suzuka is in hill country; Zandvoort is dunes
// with the North Sea behind; Monaco has the Alps coming down to the water;
// Baku is dry low hills on the Caspian.
const LAND = {
  monza:     { lo: 18, hi: 55,  col: 0x53613a, rough: 0.55, sea: null,     trees: 0x3d4d2c },
  suzuka:    { lo: 45, hi: 190, col: 0x4a5a3c, rough: 0.8,  sea: null,     trees: 0x394a2e },
  zandvoort: { lo: 10, hi: 34,  col: 0x9c9070, rough: 0.5,  sea: 0x33566b, trees: null },
  monaco:    { lo: 90, hi: 360, col: 0x5c5f4e, rough: 0.9,  sea: 0x2f5368, trees: null },
  baku:      { lo: 25, hi: 110, col: 0x7a7256, rough: 0.6,  sea: 0x2e5064, trees: null },
  _:         { lo: 20, hi: 70,  col: 0x5a6340, rough: 0.6,  sea: null,     trees: 0x3d4d2c },
};

/**
 * How far a thing at distance `d` has already been eaten by haze, BEFORE fog
 * gets to it.
 *
 * This exists because the ground carries baked aerial perspective in its
 * vertex colours (see buildGround) and the distant rings do not. Hazing one
 * and not the other inverts the depth cue: the ground went pale faster than
 * the ridge standing on it, so a ridge at 2.6 km read as a DARKER, greener
 * band floating above washed-out ground, with a hard line between them. That
 * is the opposite of aerial perspective and it looked like a seam.
 *
 * Everything that is far away now goes through this one function.
 */
function hazeAt(d, span) {
  const t = Math.min(1, Math.max(0, d / (span * 1.1)));
  return Math.pow(t, 0.7) * 0.96;
}

/**
 * Distance from a point to the nearest part of the CIRCUIT, not to the middle
 * of it.
 *
 * Measuring from the centre is the obvious thing and it is wrong on any track
 * bigger than a car park: Monza is 2.1 km across, so a field right beside the
 * back straight is a kilometre from the centre and would be hazed as though it
 * were a kilometre away — while you are standing next to it. The player is
 * always ON the circuit, so distance to the circuit is distance to the camera,
 * near enough, and it costs nothing per frame because it is baked once.
 */
function distToTrack(track, x, z) {
  let best = Infinity;
  for (let i = 0; i < track.n; i += 6) {
    const dx = track.x[i] - x, dz = Z(track.y[i]) - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Stable pseudo-random, so a skyline does not reshuffle itself on reload.
function seeded(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// A ridge profile around the full circle: smooth large-scale swells with
// smaller bumps on top, which is what a treed skyline does. Interpolated
// smoothly rather than sampled per-vertex, or the silhouette comes out as
// noise instead of as land.
function profile(n, seed, lo, hi, rough) {
  const coarse = 14, mid = 41;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const sample = (bands) => {
      const x = a * bands;
      const i0 = Math.floor(x), f = x - i0;
      const g0 = seeded(i0 % bands, seed), g1 = seeded((i0 + 1) % bands, seed);
      const t = f * f * (3 - 2 * f);
      return g0 + (g1 - g0) * t;
    };
    const h = sample(coarse) * (1 - rough * 0.45) + sample(mid) * rough * 0.45;
    out[i] = lo + (hi - lo) * h;
  }
  return out;
}

/**
 * One ring of distant land: a closed silhouette standing on the ground at
 * radius `r`, seen from inside.
 */
function ridge(cx, cz, r, heights, colour, seaDir, seaSpan) {
  const n = heights.length;
  const pos = new Float32Array(n * 2 * 3);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // Over open water there is no land to see. Flatten the ring to sea level
    // across that arc rather than deleting it, so the silhouette closes.
    let h = heights[i];
    if (seaDir != null) {
      let d = Math.abs(((a - seaDir + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d < seaSpan) h *= Math.max(0, (d / seaSpan) ** 2);
    }
    pos[i * 6 + 0] = x; pos[i * 6 + 1] = -40; pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x; pos[i * 6 + 4] = h;   pos[i * 6 + 5] = z;
    const j = (i + 1) % n;
    // Wound to face INWARD, at the middle of the ring.
    idx.push(i * 2, j * 2, j * 2 + 1, i * 2, j * 2 + 1, i * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Unlit ON PURPOSE. At six kilometres the only thing between you and a
  // hillside is air, so air is the only thing allowed to shade it. Fog stays
  // enabled; that is the entire material.
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: colour, side: THREE.DoubleSide, fog: true, depthWrite: true,
  }));
  m.frustumCulled = false;
  m.renderOrder = -2;
  return m;
}

/**
 * The haze band: a low cylinder of light standing in the sky, opaque along the
 * bottom and fading out above. This is what stops the ground meeting the sky
 * at an edge — a real horizon is a gradient, and without one every distant
 * object sits on a drawn line.
 */
function hazeBand(cx, cz, r, colour) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  // Canvas y runs down and the texture is flipped, so stop 0 is the TOP of the
  // band. Most of the density sits in the bottom quarter, the way haze does.
  grd.addColorStop(0.00, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.10)');
  grd.addColorStop(0.80, 'rgba(255,255,255,0.46)');
  grd.addColorStop(0.94, 'rgba(255,255,255,0.86)');
  grd.addColorStop(1.00, 'rgba(255,255,255,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.CylinderGeometry(r, r, 1700, 64, 1, true);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, color: colour, side: THREE.BackSide,
    transparent: true, depthWrite: false, fog: false,
  }));
  m.position.set(cx, 640, cz);
  m.frustumCulled = false;
  m.renderOrder = -1;          // after the distant land, before everything near
  return m;
}

/**
 * Woodland in the middle distance — a mass, not individual trees. Each is two
 * flat-shaded cones and nobody will ever be closer than 400 m to one, so the
 * budget goes entirely into HOW MANY.
 */
function farTrees(track, cx, cz, span, reach, land, horizonCol, world) {
  const geo = new THREE.ConeGeometry(4.2, 13, 5);
  geo.translate(0, 6.5, 0);
  // WHITE, not the tree colour. An InstancedMesh multiplies the material
  // colour by the per-instance colour, so setting both to the same green
  // squares it — and a green squared is black. The whole near band of woodland
  // came out as black cones.
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const count = 11000;
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  const c = new THREE.Color(), tint = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  // From a camera a metre off the ground, everything past about 500 m is
  // squeezed into a few pixels above the horizon. Woodland at 1.1 km was
  // therefore invisible. This band starts at 320 m, which is where the eye can
  // still read one tree from the next.
  const inner = 430, outer = Math.max(2200, span * 1.4);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const a = seeded(i, 5) * Math.PI * 2;
    // Clumped rather than evenly sprinkled — woodland has edges and clearings,
    // and an even scatter reads as a pattern from a distance.
    const clump = seeded(Math.floor(a * 26), 9);
    if (clump < 0.24) continue;
    const r = inner + (outer - inner) * Math.sqrt(seeded(i, 13)) * (0.5 + clump * 0.7);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    // Radius from the middle of the circuit is NOT distance from the driver.
    // At Monza, 430 m from the centre can be right beside the back straight,
    // and a 20 m cone standing next to the road was the result. Measure to the
    // track and keep well clear of it — the real trees near the circuit come
    // from the OSM survey in env.js, and this band is the mass behind them.
    const dt = distToTrack(track, x, z);
    if (dt < 260) continue;
    const gy = world ? world.heightAt(x, z) : 0;
    const s = 0.8 + seeded(i, 21) * 0.9;
    q.setFromAxisAngle(up, seeded(i, 29) * 6.283);
    sc.set(s, s * (0.85 + seeded(i, 31) * 0.5), s);
    v.set(x, gy, z);
    m.compose(v, q, sc);
    inst.setMatrixAt(n, m);
    tint.set(land.trees);
    c.copy(tint).multiplyScalar(0.78 + seeded(i, 37) * 0.44)
      .lerp(horizonCol, hazeAt(dt, span) * 0.8);
    inst.setColorAt(n, c);
    n++;
  }
  inst.count = n;
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.frustumCulled = false;
  return n ? inst : null;
}

/**
 * Water to the horizon, for the three circuits that are on a coast. The bake
 * gives the real shoreline out to 600 m; past that it simply stopped, so
 * Monaco's Mediterranean ended in mid-air.
 */
function openWater(cx, cz, r, colour, y) {
  const g = new THREE.CircleGeometry(r, 72);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colour, fog: true }));
  // At SEA LEVEL, which is not zero. Heights are relative to the mean height
  // of the racing line, and at Monaco that is twenty metres up a hillside —
  // so a sea at y = 0 sits twenty metres above the water it is meant to be.
  m.position.set(cx, y, cz);
  m.frustumCulled = false;
  m.renderOrder = -3;
  return m;
}

/**
 * The ground the whole world sits on — and the single worst offender in the
 * frame Adam objected to.
 *
 * It used to be ONE quad with a grass texture on it. Two things went wrong
 * with that, and neither is fixable with a better texture. A single flat tint
 * over eighteen kilometres reads as felt, because real land is a patchwork of
 * fields and woodland and scrub at wildly different tones. And it kept its
 * full saturation all the way to the horizon, because the only thing dimming
 * it was fog, and fog at a kilometre barely touches anything.
 *
 * So the ground is a grid now, and it carries its own aerial perspective in
 * vertex colour: patchwork near the circuit, trending toward the colour of the
 * horizon as it goes away from you. That is what height fog would do, without
 * a shader to do it with — and the ground is the only surface big enough for
 * the difference to matter.
 */
export function buildGround(track, look, sky, world = null) {
  const bb = track.bbox;
  const cx = (bb.x0 + bb.x1) / 2, cz = Z((bb.y0 + bb.y1) / 2);
  const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
  const land = LAND[track.key] || LAND._;
  // 24 km, not 9. The haze saturates at about 2.4 km, so everything past that
  // is already pure horizon colour — but the PLATE still has to end somewhere,
  // and at 9 km its edge fell inside the visible horizon and showed as a tonal
  // step under the haze band. Past 24 km the edge is below the horizon from
  // any camera you can get to, and the extra size costs nothing: it is the
  // same 108x108 grid either way.
  const reach = Math.max(24000, span * 8);
  const N = 108;                       // grid resolution across the whole plate
  const horizon = new THREE.Color(sky?.horizon || '#a7aabb');

  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  const uv = new Float32Array((N + 1) * (N + 1) * 2);
  const col = new Float32Array((N + 1) * (N + 1) * 3);
  const base = new THREE.Color(land.col);
  const c = new THREE.Color();
  let k = 0, u = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const fx = (i / N) * 2 - 1, fz = (j / N) * 2 - 1;
      const x = cx + fx * reach, z = cz + fz * reach;
      pos[k * 3] = x; pos[k * 3 + 1] = world ? world.heightAt(x, z) : 0; pos[k * 3 + 2] = z;
      // UVs are metres, as everywhere else, so the grass lands at true scale.
      uv[u] = x; uv[u + 1] = z;

      // Patchwork: two scales of smooth noise, so it reads as fields rather
      // than as static.
      const big = seeded(Math.floor(x / 700), Math.floor(z / 700));
      const small = seeded(Math.floor(x / 190) + 41, Math.floor(z / 190) + 17);
      const tone = 0.74 + big * 0.42 + (small - 0.5) * 0.17;
      c.copy(base).multiplyScalar(tone);

      // Baked aerial perspective. Distance from the CIRCUIT, not from the
      // camera, because this is geometry — but the player is always near the
      // circuit, so it comes to the same thing and costs nothing per frame.
      c.lerp(horizon, hazeAt(distToTrack(track, x, z), span));

      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      k++; u += 2;
    }
  }
  // LEAVE A HOLE WHERE THE CIRCUIT IS.
  //
  // The plate's cells are a couple of hundred metres across, so a single
  // triangle can span the whole track corridor — and its flat chord cuts
  // straight through a road that is following a fine surveyed profile
  // underneath it. Where the circuit sits in a dip, the terrain closed over
  // the track. `buildSkirt` fills this hole at track resolution, where the
  // ground and the road are guaranteed to agree because they read the same
  // profile at the same spacing.
  const HOLE = 260;
  buildGround.hole = HOLE;
  const near = (k) => distToTrack(track, pos[k * 3], pos[k * 3 + 2]) < HOLE;
  const idx = [];
  let dropped = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, cc = a + N + 1, d = cc + 1;
      if (near(a) || near(b) || near(cc) || near(d)) { dropped++; continue; }
      idx.push(a, cc, b, b, cc, d);
    }
  }
  void dropped;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const mesh = new THREE.Mesh(g, look.mat(
    track.key === 'zandvoort' ? 'sand' : 'grass',
    { size: 6, roughness: 1, vertexColors: true, env: 0.55 }));
  mesh.position.y = -0.06;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The skirt: the ground immediately around the circuit, at a resolution the
 * road can live with.
 *
 * It exists because of the hole buildGround leaves. A 24 km plate cannot be
 * fine enough near the road without being enormous, and one of its 220 m
 * triangles chording across the corridor closes the terrain over a track that
 * is following a fine surveyed profile underneath it.
 *
 * ---------------------------------------------------------------------------
 * THE FIRST VERSION OF THIS WAS A RIBBON SWEPT ALONG THE TRACK, and it was a
 * disaster for a reason worth writing down. It had only 58,000 triangles — but
 * they were 2 m along the track by up to 94 m across, a 47:1 aspect ratio, and
 * on the inside of every corner the ribbon folded back through itself and
 * stacked layer on layer of the same ground. Long thin overlapping triangles
 * covering most of the lower screen took a single frame from milliseconds to
 * over a minute. Triangle COUNT was never the problem; shape and overdraw
 * were.
 *
 * A plain square grid has neither problem: 26 m cells, no folds, nothing drawn
 * twice, and only the cells near the circuit are kept.
 */
export function buildSkirt(track, look, sky, world, hole) {
  const t = track, bb = t.bbox;
  const land = LAND[t.key] || LAND._;
  const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
  const horizon = new THREE.Color(sky?.horizon || '#a7aabb');
  const base = new THREE.Color(land.col);
  const c = new THREE.Color();

  const PAD = 420, CELL = 26;
  const x0 = bb.x0 - PAD, x1 = bb.x1 + PAD;
  const z0 = Z(bb.y1) - PAD, z1 = Z(bb.y0) + PAD;
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const dx = (x1 - x0) / nx, dz = (z1 - z0) / nz;

  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const dist = new Float32Array((nx + 1) * (nz + 1));
  let k = 0, u = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * dx, z = z0 + j * dz;
      const d = distToTrack(t, x, z);
      dist[k] = d;
      pos[k * 3] = x; pos[k * 3 + 1] = world ? world.heightAt(x, z) : 0; pos[k * 3 + 2] = z;
      uv[u] = x; uv[u + 1] = z;
      const big = seeded(Math.floor(x / 700), Math.floor(z / 700));
      const small = seeded(Math.floor(x / 190) + 41, Math.floor(z / 190) + 17);
      c.copy(base).multiplyScalar(0.74 + big * 0.42 + (small - 0.5) * 0.17)
        .lerp(horizon, hazeAt(d, span));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      k++; u += 2;
    }
  }

  // Keep only what fills the plate's hole, with a margin of overlap so there
  // is never a seam of sky between the two.
  const keep = hole + 60;
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, d = cc + 1;
      if (dist[a] > keep && dist[b] > keep && dist[cc] > keep && dist[d] > keep) continue;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  if (!idx.length) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const mesh = new THREE.Mesh(g, look.mat(
    t.key === 'zandvoort' ? 'sand' : 'grass',
    { size: 6, roughness: 1, vertexColors: true, env: 0.55 }));
  mesh.position.y = -0.05;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
/**
 * Build the air and the distance. Returns what it added and the fog it chose,
 * so the caller can report it rather than guess.
 */
export function buildHorizon(scene, track, env, sky, world = null) {
  const bb = track.bbox;
  const cx = (bb.x0 + bb.x1) / 2, cz = Z((bb.y0 + bb.y1) / 2);
  const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
  const land = LAND[track.key] || LAND._;
  const horizon = new THREE.Color(sky?.horizon || '#a7aabb');

  // Which way is the open water? Taken from where the baked coastline actually
  // is rather than assumed, so the sea arc lines up with the shoreline you can
  // see from the track.
  let seaDir = null, seaSpan = 0;
  if (land.sea && env?.sea?.length) {
    let sx = 0, sz = 0, n = 0;
    for (const poly of env.sea) {
      for (const p of (poly.p || poly)) { sx += p[0]; sz += Z(p[1]); n++; }
    }
    if (n) {
      seaDir = Math.atan2(sz / n - cz, sx / n - cx);
      seaSpan = 1.5;                        // about 170 degrees of open water
      scene.add(openWater(cx, cz, 14000, land.sea, (world && world.on ? world.seaY : 0) + 0.25));
    }
  }

  // ---- the layers ---------------------------------------------------------
  // Three of them, because two reads as a backdrop and four is not worth the
  // draw call. The heights grow with distance so each ring clears the one in
  // front, which is what makes them read as depth rather than as a fence.
  const rings = [
    { r: Math.max(2600, span * 1.3), k: 1.0, seed: 3 },
    { r: Math.max(4800, span * 2.3), k: 1.9, seed: 7 },
    { r: Math.max(7600, span * 3.6), k: 3.2, seed: 11 },
  ];
  const reach = Math.max(9000, span * 4.2);
  for (const ring of rings) {
    const h = profile(180, ring.seed, land.lo * ring.k, land.hi * ring.k, land.rough);
    // Pre-hazed by the SAME curve the ground uses, so a ridge and the land in
    // front of it agree about how far away they are.
    // Only 55% of the ground's haze: these are hilltops, and the air near the
    // ground is always thicker than the air fifty metres up. That difference
    // IS height fog, baked in — a ridge staying a shade darker than the land
    // in front of it is the cue, not a mistake.
    const tint = new THREE.Color(land.col).lerp(horizon, hazeAt(ring.r, span) * 0.55);
    scene.add(ridge(cx, cz, ring.r, h, tint.getHex(), seaDir, seaSpan));
  }

  // ---- the middle distance ------------------------------------------------
  // Rings of land at 2.6 km and beyond give the far horizon depth, but the
  // band from about 400 m to 2 km was still empty, and that is the range the
  // eye actually reads distance in. Monza is inside a walled royal park and
  // Suzuka sits in woodland; filling that band with trees is both true and the
  // single biggest change to how far away the horizon feels.
  if (land.trees) {
    const tm = farTrees(track, cx, cz, span, reach, land, horizon, world);
    if (tm) scene.add(tm);
  }

  scene.add(hazeBand(cx, cz, Math.max(9000, span * 4.4), horizon));

  // ---- the air itself -----------------------------------------------------
  // Exponential-squared, not linear. Linear fog has a NEAR plane, so
  // everything closer than it is perfectly crisp and everything past the far
  // plane is perfectly flat — which is how you get a sharp hoarding at 300 m
  // and a solid band at the horizon in the same frame. Exponential falls off
  // from the first metre, the way air does.
  //
  // Tuned against the rings: at 2.6 km the first ridge keeps about half its
  // contrast, at 4.8 km a fifth, at 7.6 km it is a breath against the sky.
  // Scaled by circuit size, but capped: a small circuit does not have thicker
  // air. At 1.6x Monaco's density hid the mountains behind it entirely, and
  // the mountains coming down to the water ARE Monaco.
  const density = 0.00042 * Math.max(0.6, Math.min(1.15, 2100 / Math.max(900, span)));
  scene.fog = new THREE.FogExp2(horizon, density);

  return {
    rings: rings.length,
    sea: seaDir != null,
    fog: +density.toFixed(6),
    // How much of a thing survives at each distance — the number to look at
    // when the horizon is wrong, rather than the screenshot alone.
    visible: [1000, 2600, 4800, 7600].map(d => +Math.exp(-((density * d) ** 2)).toFixed(3)),
    groundHaze: [200, 600, 1500, 3000].map(d => +hazeAt(d, span).toFixed(2)),
  };
}
