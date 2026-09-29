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
  // The Nürburgring sits at ~620 m on the Eifel plateau: rolling wooded hills,
  // spruce forest right up to the fences, Hohe Acht (747 m) on the skyline.
  nurburgring: { lo: 40, hi: 150, col: 0x4b5a3a, rough: 0.7, sea: null,     trees: 0x2f4128 },
  // Pembroke, NH: watered lawns and a golf course, wooded hills beyond.
  street:    { lo: 20, hi: 60,  col: 0x4f6d34, rough: 0.6,  sea: null,     trees: 0x2f4a26 },
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
// Height of the drawn plate at (x, z): the same grid and the same two
// triangles per cell that buildGround builds, (a, c, b) and (b, c, d), with
// its corners read from the same groundY. Computed rather than read back,
// because the horizon is built before the plate is.
function plateY(x, z, world, track) {
  const bb = track.bbox;
  const cx = (bb.x0 + bb.x1) / 2, cz = Z((bb.y0 + bb.y1) / 2);
  const reach = Math.max(24000, Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 8), N = 108;
  const step = (2 * reach) / N, x0 = cx - reach, z0 = cz - reach;
  const fx = (x - x0) / step, fz = (z - z0) / step;
  const i = Math.max(0, Math.min(N - 1, Math.floor(fx))), j = Math.max(0, Math.min(N - 1, Math.floor(fz)));
  const u = fx - i, v = fz - j;
  const Y = (a, b) => world.groundY(x0 + a * step, z0 + b * step);
  const ya = Y(i, j), yb = Y(i + 1, j), yc = Y(i, j + 1), yd = Y(i + 1, j + 1);
  const y = u + v <= 1 ? ya + (yb - ya) * u + (yc - ya) * v : yd + (yc - yd) * (1 - u) + (yb - yd) * (1 - v);
  return y - 0.06;
}

// The satellite ground cover as a test: true = tree cover, false = measured
// and not a tree, null = outside the survey (or no survey at all).
function coverTest(c) {
  if (!c) return () => null;
  const cls = new Uint8Array(c.nx * c.ny);
  let k = 0;
  for (const run of c.rle.split(';')) { const [v, n] = run.split(','); cls.fill(+v, k, k + +n); k += +n; }
  return (x, y) => {
    const i = Math.floor((x - c.x0) / c.cell), j = Math.floor((y - c.y0) / c.cell);
    if (i < 0 || j < 0 || i >= c.nx || j >= c.ny) return null;
    return cls[j * c.nx + i] === 10;
  };
}

function farTrees(track, cx, cz, span, reach, land, horizonCol, world, cover = null) {
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
  // Where the satellite measured the ground (tools/getcover.mjs), a cone
  // stands only where it saw tree cover, so the woodland mass behind the
  // treeline is the real park and the fields stay fields. Past that survey the
  // old clumped scatter carries on. Candidates are drawn until the budget is
  // spent, because most of a measured landscape is not trees.
  const isTree = coverTest(cover);
  let n = 0;
  for (let i = 0; i < count * 4 && n < count; i++) {
    const a = seeded(i, 5) * Math.PI * 2;
    let r, x, z;
    if (cover) {
      r = inner + (outer - inner) * Math.sqrt(seeded(i, 13));
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
      const t = isTree(x, Z(z));
      if (t === false) continue;
      if (t == null) {
        // Outside the survey: the clumped scatter.
        const clump = seeded(Math.floor(a * 26), 9);
        if (clump < 0.24) continue;
      }
    } else {
      // Clumped rather than evenly sprinkled — woodland has edges and clearings,
      // and an even scatter reads as a pattern from a distance.
      const clump = seeded(Math.floor(a * 26), 9);
      if (clump < 0.24 || i >= count) continue;
      r = inner + (outer - inner) * Math.sqrt(seeded(i, 13)) * (0.5 + clump * 0.7);
      x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
    }
    // Radius from the middle of the circuit is NOT distance from the driver.
    // At Monza, 430 m from the centre can be right beside the back straight,
    // and a 20 m cone standing next to the road was the result. Measure to the
    // track and keep well clear of it — the real trees near the circuit come
    // from the OSM survey in env.js, and this band is the mass behind them.
    const dt = distToTrack(track, x, z);
    if (dt < 260) continue;
    // On the skirt the ground is groundY; past it, the plate's own 440 m
    // chords, which groundcheck measured up to 9.6 m off the survey — a cone
    // on the survey there floats or sinks by that much.
    const skirtReach = 260 + (2 * Math.max(24000, span * 8) / 108) * Math.SQRT2 + 40;
    const gy = !world ? 0 : dt < skirtReach ? world.groundY(x, z) : plateY(x, z, world, track);
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
      pos[k * 3] = x; pos[k * 3 + 1] = world ? world.groundY(x, z) : 0; pos[k * 3 + 2] = z;
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
  // The plate's cell size, published for the same reason the hole is. A cell
  // is dropped when ANY of its corners is inside the hole, so the ground
  // actually removed reaches a cell DIAGONAL further out than HOLE — at these
  // cell sizes most of a kilometre. The skirt has to be told, or the
  // difference is a ring of missing world with the void visible through it.
  buildGround.cell = (2 * reach) / N;
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
export function buildSkirt(track, look, sky, world, hole, plateCell = 0) {
  const t = track, bb = t.bbox;
  const land = LAND[t.key] || LAND._;
  const span = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
  const horizon = new THREE.Color(sky?.horizon || '#a7aabb');
  const base = new THREE.Color(land.col);
  const c = new THREE.Color();

  // THE CELL IS SET BY HOW MUCH THE LAND MOVES, not by a constant.
  //
  // Between two grid points this mesh is a flat CHORD, and where that chord
  // runs above the road the grass wins the depth test and stands over the
  // tarmac. 26 m was chosen when every circuit was flat and the only elevation
  // came from a 30 m DEM. A circuit modelled with thirty metres of elevation
  // is a different problem: measured on Street, 24 of 2,325 points on the
  // racing surface had grass at or above the road, worst +0.387 m — and the
  // 0.35 m sink in World.groundY cannot cover a chord error twice its size.
  //
  // The error falls with the SQUARE of the cell, so this is a square root.
  // Below about ten metres of rise nothing changes and the surveyed circuits
  // that were always fine stay byte-identical.
  const rise = world?.elev?.range ? world.elev.range[1] - world.elev.range[0] : 0;
  const CELL = rise > 10 ? Math.max(9, Math.min(26, 26 * Math.sqrt(10 / rise))) : 26;
  // How far out this grid has to go, measured off the plate instead of
  // guessed. A fixed hole+60 left ground missing from about 300 m to 700 m
  // out — 230 of 3523 sampled points with nothing under them at all.
  const REACH = hole + plateCell * Math.SQRT2 + 40;
  const PAD = Math.max(420, REACH + 2 * CELL);
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
      // The sink that keeps this grid's 26 m chords from surfacing through the
      // road lives in World.groundY, because everything STANDING on the ground
      // has to be placed on the same surface or it floats. See js/world.js.
      pos[k * 3] = x; pos[k * 3 + 1] = world ? world.groundY(x, z) : 0; pos[k * 3 + 2] = z;
      uv[u] = x; uv[u + 1] = z;
      const big = seeded(Math.floor(x / 700), Math.floor(z / 700));
      const small = seeded(Math.floor(x / 190) + 41, Math.floor(z / 190) + 17);
      c.copy(base).multiplyScalar(0.74 + big * 0.42 + (small - 0.5) * 0.17)
        .lerp(horizon, hazeAt(d, span));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      k++; u += 2;
    }
  }

  // ---- THE FINE LAYER NEXT TO THE CIRCUIT --------------------------------
  //
  // The coarse cells above are what groundcheck.mjs had been reporting as a
  // KNOWN defect since 2026-09-19: a flat chord across 9-26 m, over a road
  // surveyed every 2 m, stood grass up through the tarmac wherever the road
  // dipped (Monaco 9.4 m, 20% of its racing surface). The fix it asked for is
  // finer cells near the track, so near the track the grid IS fine: FINE-metre
  // cells out to FINE_R, where the chord error (h²/8 × curvature) is a few
  // centimetres on the steepest circuit we have. The coarse grid keeps the
  // rest, and the two overlap by two coarse cells so there is never a crack;
  // in that overlap the coarse grid is dropped a hand's breadth so the fine
  // one — the one that agrees with groundY — is the surface you see.
  const FINE = 6;
  const FINE_R = world ? Math.max(50, (world.sinkTo || 0) + 20) : 50;
  const BAND = FINE_R + 2 * CELL;
  const m = Math.max(1, Math.round(dx / FINE)), mz = Math.max(1, Math.round(dz / FINE));
  const fdx = dx / m, fdz = dz / mz, FW = nx * m + 1;
  const fpos = [], fuv = [], fcol = [], fidx = [];
  const fv = new Map(), fd = new Map();
  const fdist = (gi, gj, obj = false) => {
    const key = gj * FW + gi;
    let d = fd.get(key);
    if (d === undefined) {
      const x = x0 + gi * fdx, z = z0 + gj * fdz;
      d = world ? world.near(x, z) : { d: distToTrack(t, x, z) };
      fd.set(key, d);
    }
    return obj ? d : d.d;
  };
  const vbase = (nx + 1) * (nz + 1);
  const fvert = (gi, gj) => {
    const key = gj * FW + gi;
    let v = fv.get(key);
    if (v !== undefined) return v;
    const x = x0 + gi * fdx, z = z0 + gj * fdz;
    v = vbase + fpos.length / 3;
    fpos.push(x, world ? world.groundY(x, z, fdist(gi, gj, true)) : 0, z);
    fuv.push(x, z);
    const big = seeded(Math.floor(x / 700), Math.floor(z / 700));
    const small = seeded(Math.floor(x / 190) + 41, Math.floor(z / 190) + 17);
    c.copy(base).multiplyScalar(0.74 + big * 0.42 + (small - 0.5) * 0.17)
      .lerp(horizon, hazeAt(fdist(gi, gj), span));
    fcol.push(c.r, c.g, c.b);
    fv.set(key, v);
    return v;
  };
  // ---- A STEP BETWEEN TWO LEGS, drawn as a wall -------------------------
  // Where two stretches of lap run side by side at different heights (the
  // Fairmont hairpin: 13 m apart, 8 m apart vertically) each road keeps its
  // own height up to the halfway line, so the ground there is a vertical
  // step. A grid chords across a step and stood grass 4 m over the lower
  // road. So a cell whose corners belong to two legs is cut along the
  // halfway line (where the distances to the two legs are equal): each side
  // is drawn at its own leg's ground, and the cut is a wall between them.
  // 24 m of lap apart is "another leg" here — the two sides of a hairpin
  // are only ~60 m of lap apart at Monaco — as long as the heights differ
  // (the 25 cm test below): round an ordinary corner they never do.
  const gapK = Math.ceil(24 / t.ds);
  const legOf = (gi, gj) => fdist(gi, gj, true).i;
  const apart = (a, b) => { const g = Math.abs(a - b); return Math.min(g, t.n - g) > gapK; };
  const vx = (gi) => x0 + gi * fdx, vz = (gj) => z0 + gj * fdz;
  const fAdd = (x, y, z, shade) => {
    const v = vbase + fpos.length / 3;
    fpos.push(x, y, z); fuv.push(x, z);
    const big = seeded(Math.floor(x / 700), Math.floor(z / 700));
    const small = seeded(Math.floor(x / 190) + 41, Math.floor(z / 190) + 17);
    c.copy(base).multiplyScalar((0.74 + big * 0.42 + (small - 0.5) * 0.17) * shade);
    fcol.push(c.r, c.g, c.b);
    return v;
  };
  let steps = 0;
  const drawn = new Map(), plain = [];
  const stepCell = (gi, gj) => {
    const L = [legOf(gi, gj), legOf(gi + 1, gj), legOf(gi, gj + 1), legOf(gi + 1, gj + 1)];
    if (L.some(k => k < 0)) return false;
    const A = L[0], B = L.find(k => apart(k, A));
    if (B === undefined) return false;
    // Only where the field itself steps: inside the corridor it is the
    // nearest leg's height, exactly; past it World.heightAt blends the legs
    // continuously, and a wall there would disagree with everything standing
    // on the ground beside it.
    const corrMax = world.sinkTo - 12;
    if (Math.min(...[[gi, gj], [gi + 1, gj], [gi, gj + 1], [gi + 1, gj + 1]].map(([a, b]) => fdist(a, b))) > corrMax) return false;
    // Search each leg only up to halfway to the other, or a hairpin's two
    // sides find each other.
    const gAB = Math.min(Math.abs(A - B), t.n - Math.abs(A - B));
    const span = Math.max(4, Math.min(60, Math.floor(gAB / 2)));
    // Signed: negative on A's side.
    const P = [[gi, gj], [gi + 1, gj], [gi, gj + 1], [gi + 1, gj + 1]].map(([a, b]) => {
      const x = vx(a), z = vz(b);
      const na = world.nearestOnLeg(x, z, A, span), nb = world.nearestOnLeg(x, z, B, span);
      // A real corner keeps the height the field gives it (fvert's), so the
      // cell still meets its neighbours exactly.
      return { x, z, phi: na.d - nb.d, na, nb, y: fpos[(fvert(a, b) - vbase) * 3 + 1] };
    });
    // A corner: its own height. A point on the cut: that leg's own ground,
    // the profile across (no blending), less the sink — what the field is on
    // that side of the halfway line inside the corridor.
    const legY = (p, n) => p.y !== undefined ? p.y
      : world.trackY(n.i) - world.sinkAt(n.d);
    const hA = p => legY(p, p.na), hB = p => legY(p, p.nb);
    // A flat step (< 25 cm) is just ground: draw it whole.
    if (P.every(p => Math.abs(world.trackY(p.na.i) - world.trackY(p.nb.i)) < 0.25)) return false;
    steps++;
    for (const tri of [[0, 2, 1], [1, 2, 3]]) {
      const polyA = [], polyB = [], cut = [];
      for (let e = 0; e < 3; e++) {
        const p = P[tri[e]], q = P[tri[(e + 1) % 3]];
        (p.phi <= 0 ? polyA : polyB).push(p);
        if ((p.phi <= 0) !== (q.phi <= 0)) {
          const u = p.phi / (p.phi - q.phi);
          const x = p.x + (q.x - p.x) * u, z = p.z + (q.z - p.z) * u;
          const r = { x, z, na: world.nearestOnLeg(x, z, A, span), nb: world.nearestOnLeg(x, z, B, span), phi: 0 };
          polyA.push(r); polyB.push(r); cut.push(r);
        }
      }
      for (const [poly, h] of [[polyA, hA], [polyB, hB]]) {
        if (poly.length < 3) continue;
        const ids = poly.map(p => fAdd(p.x, h(p), p.z, 1));
        for (let k = 1; k + 1 < ids.length; k++) fidx.push(ids[0], ids[k], ids[k + 1]);
      }
      if (cut.length === 2) {
        // The wall, darker (earth, not lawn), both faces.
        const [r1, r2] = cut;
        const a1 = fAdd(r1.x, hA(r1), r1.z, 0.5), a2 = fAdd(r2.x, hA(r2), r2.z, 0.5);
        const b1 = fAdd(r1.x, hB(r1), r1.z, 0.5), b2 = fAdd(r2.x, hB(r2), r2.z, 0.5);
        fidx.push(a1, a2, b1, b1, a2, b2, a1, b1, a2, a2, b1, b2);
      }
    }
    return true;
  };

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      // Only coarse cells that can hold a fine one: a corner within reach.
      const near = Math.min(dist[a], dist[a + 1], dist[a + nx + 1], dist[a + nx + 2]);
      if (near > BAND + CELL * 1.5) continue;
      for (let b = 0; b < mz; b++) {
        for (let q = 0; q < m; q++) {
          const gi = i * m + q, gj = j * mz + b;
          if (fdist(gi, gj) > BAND && fdist(gi + 1, gj) > BAND &&
              fdist(gi, gj + 1) > BAND && fdist(gi + 1, gj + 1) > BAND) continue;
          const p00 = fvert(gi, gj), p10 = fvert(gi + 1, gj);
          const p01 = fvert(gi, gj + 1), p11 = fvert(gi + 1, gj + 1);
          if (world && stepCell(gi, gj)) { drawn.set(gj * FW + gi, 2); continue; }
          drawn.set(gj * FW + gi, 1);
          plain.push(gi, gj, p00, p01, p10, p11);
        }
      }
    }
  }
  // ---- WHERE THE FIELD BENDS FASTER THAN 6 m CAN FOLLOW, 2 m ------------
  // A bank between a road in a cutting and the hillside above it (Suzuka,
  // Monaco) curves hard over a few metres, and a 6 m chord missed it by up
  // to 2.9 m — a tree on it hangs that far off the grass. Each plain fine
  // cell is measured against the field; one that misses by more than FMISS
  // is drawn as SUB x SUB cells. An edge shared with a cell that is NOT
  // split is pinned to that cell's chord, so the two meet without a crack.
  const FMISS = 0.08, SUB = 3;
  const Yv = v => fpos[(v - vbase) * 3 + 1];
  const fsplit = new Set();
  if (world) {
    for (let q = 0; q < plain.length; q += 6) {
      const gi = plain[q], gj = plain[q + 1];
      const y00 = Yv(plain[q + 2]), y01 = Yv(plain[q + 3]), y10 = Yv(plain[q + 4]), y11 = Yv(plain[q + 5]);
      let worst = 0;
      for (const [u, v] of [[0.3, 0.3], [0.7, 0.7], [0.5, 0.5]]) {
        const ch = u + v <= 1 ? y00 + (y10 - y00) * u + (y01 - y00) * v : y11 + (y01 - y11) * (1 - u) + (y10 - y11) * (1 - v);
        worst = Math.max(worst, Math.abs(ch - world.groundY(vx(gi + u), vz(gj + v))));
      }
      if (worst > FMISS) fsplit.add(gj * FW + gi);
    }
  }
  for (let q = 0; q < plain.length; q += 6) {
    const gi = plain[q], gj = plain[q + 1];
    const p00 = plain[q + 2], p01 = plain[q + 3], p10 = plain[q + 4], p11 = plain[q + 5];
    if (!fsplit.has(gj * FW + gi)) { fidx.push(p00, p01, p10, p10, p01, p11); continue; }
    const y00 = Yv(p00), y01 = Yv(p01), y10 = Yv(p10), y11 = Yv(p11);
    const pinned = (di, dj) => { const k = (gj + dj) * FW + gi + di; return drawn.has(k) && !fsplit.has(k); };
    const W = pinned(-1, 0), E = pinned(1, 0), Sd = pinned(0, -1), N = pinned(0, 1);
    const ids = [];
    for (let b = 0; b <= SUB; b++) {
      for (let a = 0; a <= SUB; a++) {
        const u = a / SUB, v = b / SUB;
        let id;
        if (a === 0 && b === 0) id = p00; else if (a === SUB && b === 0) id = p10;
        else if (a === 0 && b === SUB) id = p01; else if (a === SUB && b === SUB) id = p11;
        else {
          const x = vx(gi + u), z = vz(gj + v);
          let y;
          if (a === 0 && W) y = y00 + (y01 - y00) * v;
          else if (a === SUB && E) y = y10 + (y11 - y10) * v;
          else if (b === 0 && Sd) y = y00 + (y10 - y00) * u;
          else if (b === SUB && N) y = y01 + (y11 - y01) * u;
          else y = world.groundY(x, z);
          id = fAdd(x, y, z, 1);
        }
        ids.push(id);
      }
    }
    for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) {
      const v00 = ids[b * (SUB + 1) + a], v10 = ids[b * (SUB + 1) + a + 1];
      const v01 = ids[(b + 1) * (SUB + 1) + a], v11 = ids[(b + 1) * (SUB + 1) + a + 1];
      fidx.push(v00, v01, v10, v10, v01, v11);
    }
  }

  // Keep only what fills the plate's hole, with a margin of overlap so there
  // is never a seam of sky between the two — and none of what the fine layer
  // already covers.
  const keep = REACH;
  const idx = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, cc = a + nx + 1, d = cc + 1;
      if (dist[a] > keep && dist[b] > keep && dist[cc] > keep && dist[d] > keep) continue;
      if (dist[a] < FINE_R || dist[b] < FINE_R || dist[cc] < FINE_R || dist[d] < FINE_R) continue;
      // Wholly under the fine layer (it reaches BAND): drawing it as well only
      // lets its chord poke up through the fine one.
      if (Math.max(dist[a], dist[b], dist[cc], dist[d]) < BAND - 2 * FINE) continue;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  if (!idx.length && !fidx.length) return null;
  // Under the fine layer where they overlap, so the fine one is what shows.
  const UNDER = BAND + FINE * 1.5;      // past this the fine layer never reaches
  for (let k = 0; k < dist.length; k++) if (dist[k] < UNDER) pos[k * 3 + 1] -= 0.12;

  // ---- WHERE THE LAND ITSELF IS CURVY, SUBDIVIDE ------------------------
  // Away from the road a coarse chord is fine on a plain and wrong on a real
  // bank — Monza's old Sopraelevata falls ten metres in sixty, and a 22 m
  // chord over it missed by 0.86 m, which is a tree floating by that much.
  // So every coarse cell is measured against the field it is drawn over, and
  // one that misses by more than MISS is split into ~5 m sub-cells. Where a
  // split cell meets an unsplit one, the shared edge's vertices are put ON
  // the unsplit cell's chord, so the two meet exactly and no sky shows
  // through the seam (the usual T-junction rule).
  const MISS = 0.1;
  const keepQ = [];
  for (let q = 0; q < idx.length; q += 6) keepQ.push(idx[q]);   // corner a of each coarse cell
  const coarseCell = new Set(keepQ);
  const split = new Set();
  if (world) {
    for (const a of keepQ) {
      const i = a % (nx + 1), j = (a / (nx + 1)) | 0;
      const Y = k => pos[k * 3 + 1];
      const ya = Y(a), yb = Y(a + 1), yc = Y(a + nx + 1), yd = Y(a + nx + 2);
      let worst = 0;
      const drop = Math.min(dist[a], dist[a + 1], dist[a + nx + 1], dist[a + nx + 2]) < UNDER ? 0.12 : 0;
      for (const [u, v] of [[0.3, 0.3], [0.7, 0.7], [0.5, 0.5], [0.2, 0.6], [0.6, 0.2]]) {
        const ch = u + v <= 1 ? ya + (yb - ya) * u + (yc - ya) * v : yd + (yc - yd) * (1 - u) + (yb - yd) * (1 - v);
        const px = x0 + (i + u) * dx, pz = z0 + (j + v) * dz;
        const real = world.groundY(px, pz) - drop;
        worst = Math.max(worst, Math.abs(ch - real));
      }
      if (worst > MISS) split.add(a);
    }
  }
  if (split.size) {
    const s = Math.max(2, Math.ceil(Math.max(dx, dz) / 7.5));
    const cidx = [];
    // Drop the split cells from the coarse index.
    for (let q = 0; q < idx.length; q += 6) if (!split.has(idx[q])) for (let r = 0; r < 6; r++) cidx.push(idx[q + r]);
    const addV = (x, y, z, d) => {
      const v = vbase + fpos.length / 3;
      fpos.push(x, y, z); fuv.push(x, z);
      const big = seeded(Math.floor(x / 700), Math.floor(z / 700));
      const small = seeded(Math.floor(x / 190) + 41, Math.floor(z / 190) + 17);
      c.copy(base).multiplyScalar(0.74 + big * 0.42 + (small - 0.5) * 0.17).lerp(horizon, hazeAt(d, span));
      fcol.push(c.r, c.g, c.b);
      return v;
    };
    const sidx = [];
    for (const a of split) {
      const i = a % (nx + 1), j = (a / (nx + 1)) | 0;
      const Y = k => pos[k * 3 + 1];
      const ya = Y(a), yb = Y(a + 1), yc = Y(a + nx + 1), yd = Y(a + nx + 2);
      // Is the neighbour across each edge also split (then share real heights)?
      // Pinned to the chord only where the neighbour IS that chord: a drawn,
      // unsplit coarse cell. A neighbour that is not drawn at all (under the
      // fine layer) has no edge to meet, and pinning to it stood a 1.6 m
      // chord up through the fine ground at Suzuka.
      const nb = (di, dj) => { const q = a + di + dj * (nx + 1); return coarseCell.has(q) && !split.has(q); };
      const loose = { w: nb(-1, 0), e: nb(1, 0), s: nb(0, -1), n: nb(0, 1) };
      const ids = [];
      for (let b = 0; b <= s; b++) {
        for (let q = 0; q <= s; q++) {
          const u = q / s, v = b / s;
          const x = x0 + (i + u) * dx, z = z0 + (j + v) * dz;
          let y;
          if ((q === 0 || q === s) && (b === 0 || b === s)) y = q === 0 ? (b === 0 ? ya : yc) : (b === 0 ? yb : yd);
          else if (q === 0 && loose.w) y = ya + (yc - ya) * v;
          else if (q === s && loose.e) y = yb + (yd - yb) * v;
          else if (b === 0 && loose.s) y = ya + (yb - ya) * u;
          else if (b === s && loose.n) y = yc + (yd - yc) * u;
          // Interior: the real ground — dropped under the fine layer where
          // the two overlap, exactly as the coarse vertices are.
          else { const nr = world.near(x, z); y = world.groundY(x, z, nr) - (nr.d < UNDER ? 0.12 : 0); }
          ids.push(addV(x, y, z, dist[a]));
        }
      }
      for (let b = 0; b < s; b++) for (let q = 0; q < s; q++) {
        const p00 = ids[b * (s + 1) + q], p10 = p00 + 1, p01 = ids[(b + 1) * (s + 1) + q], p11 = p01 + 1;
        sidx.push(p00, p01, p10, p10, p01, p11);
      }
    }
    idx.length = 0;
    for (const v of cidx) idx.push(v);
    for (const v of sidx) idx.push(v);
  }
  const coarseTris = idx.length / 3;
  for (let k = 0; k < fidx.length; k++) idx.push(fidx[k]);

  const g = new THREE.BufferGeometry();
  const cat = (A, B) => { const o = new Float32Array(A.length + B.length); o.set(A); o.set(B, A.length); return o; };
  const allUv = cat(uv, fuv);
  g.setAttribute('position', new THREE.BufferAttribute(cat(pos, fpos), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(allUv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(allUv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(cat(col, fcol), 3));
  buildSkirt.stats = { coarse: CELL, fine: FINE, fineR: FINE_R, fineTris: fidx.length / 3, coarseTris, split: split.size, steps, fsplit: fsplit.size };
  g.setIndex(idx);
  g.computeVertexNormals();

  const mesh = new THREE.Mesh(g, look.mat(
    t.key === 'zandvoort' ? 'sand' : 'grass',
    { size: 6, roughness: 1, vertexColors: true, env: 0.55 }));
  mesh.position.y = -0.05;
  mesh.receiveShadow = true;
  mesh.userData.stats = buildSkirt.stats;
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
    const tm = farTrees(track, cx, cz, span, reach, land, horizon, world, env && env.cover);
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
