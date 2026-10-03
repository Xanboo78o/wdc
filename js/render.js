// render.js — everything the simulation does NOT need to know about.
//
// The whole graphics layer lives behind this one class so that physics.js
// never imports three.js. That is what makes "browser now, native later"
// actually true rather than a nice intention.
//
// Axis convention, once, here: the sim works in flat (x, y) metres with a
// heading in radians. Three.js is Y-up. So sim x -> three x, sim y -> three -z
// (see geom.js for why the negation is not optional), and a sim heading of h
// becomes rotation.y = h on a mesh built pointing along +X. Nothing outside
// this file should ever have to know that.
import * as THREE from 'three';
import { Z, Builder } from './geom.js';
import { Look, sunRig } from './tex.js';
import { Post } from './post.js';
/**
 * The road's GRADIENT under a car, as a pitch angle in the car's own frame.
 * Adam, 2026-09-29: "when i go down hills and on banked turns, my car doesnt
 * tilt, it stays flat and follows the height". The car was lifted to the
 * surveyed height and never tipped to its slope. Radians, + = nose up; the
 * slope is taken over 8 m of the lap and projected on the car's heading, so a
 * car pointing back down a hill tips the other way.
 */
export function slopePitch(world, track, proj, car) {
  if (!world || !world.on) return 0;
  const g = (world.trackYAt(proj.s + 4) - world.trackYAt(proj.s - 4)) / 8;
  return Math.atan(g) * Math.cos((car.hdg || 0) - track.hdg[proj.i]);
}

let RIGS_NAMES = ['ONBOARD', 'CHASE', 'NOSE', 'TV', 'T-CAM'];
import { SpeedShake, SpeedBlur, SFX } from './speedfx.js';
import { ProcSky } from './sky.js';
import { solarPosition, sunVector, fetchWeather, readWeather, guessLocation, dayPhase, WeatherDirector } from './weather.js';
import { Rain } from './rain.js';
import { bankTable, bankY, bankRoll } from './bank.js';
import { buildEnv } from './env.js';
import { signAtlas, buildBarriers, buildTyreWalls, buildBoards, buildStartFinish, buildMarshalPosts, buildFlagpoles } from './furniture.js';
import { carLamps, buildCourseLights, LightTrails } from './lamps.js';
import { buildGrandstands } from './crowd.js';
import { placeLandmarks } from './landmarks.js';
import { buildPitLane, pitCorridor } from './pit.js';
import { buildHorizon, buildGround, buildSkirt } from './horizon.js';
import { buildCar, buildGT3, liveryAtlas } from './car.js';
import { makeDeformer, crushParts, applyCrush } from './dent.js';
import { Fx } from './fx.js';
import { loadChassis, chassisGeometry } from './mesh.js';
import { World, loadElev } from './world.js';
import { loadSurface, defaultSurface, KERB_SHAPE, KERB_PAINT } from './surface.js';
import { buildPath } from './build/path.js';
import { Ground } from './build/ground.js';
import { buildRoad, buildRunoff, buildLandmarks, buildGround as buildBuiltGround } from './build/meshes.js';
import { brandTexture, buildWalls, buildDetails, buildTunnels, buildViaducts, gantryBanner } from './build/dressing.js';
import { BuildLook, loadFlora, foldTerrainUVs } from './build/look.js';
import { buildFlora } from './build/flora.js';

// HAND-BUILT CIRCUITS ARE DRAWN BY THE BUILDER (Adam, 2026-09-24: "make the
// hand-built mega track the version from the builder"). The game's own world
// is made for surveyed circuits — a flat plate, a city from OpenStreetMap,
// barriers on the survey line — and the test map came out of it as a road on
// a plate, with no tunnel, no bridge over the hairpins and none of the land
// shaped to the road. So for a track made in build.html the world is built by
// the SAME functions build.html uses, from the same pieces file. The car
// still rides the baked track (same path, same numbers), so what you see and
// what you drive cannot drift apart.
const BUILT = { test: '../data/build/pieces.js' };

const ROAD_STRIPS = 11;      // lateral divisions of the racing surface

// ---------------------------------------------------------------------------
// The racing surface.
//
// Eleven strips across rather than two, for one reason: the RUBBER. A real
// circuit is not one shade of grey — there is a dark, polished band a couple
// of metres wide where every car has driven, and pale dusty tarmac either side
// of it that has not been cleaned by a tyre in a year. That band IS the racing
// line, and seeing it is how a driver reads a track they have never been to.
//
// It is drawn as vertex colour on the road itself, positioned from the solved
// minimum-curvature line, so it cannot drift out of agreement with the line
// the sim actually thinks is fastest. Vertex colour also means no second
// surface, no transparency and no sorting.
//
// UVs are metres (u across, v along), so the asphalt scan lands at true size
// whether the road is 7.6 m wide at Monaco or 11.5 m at Monza.
// ---------------------------------------------------------------------------
function roadSurface(track, line, bank) {
  const t = track, n = t.n;
  const b = new Builder({ color: true });
  const c = new THREE.Color();

  // Returned as a float triple, NOT a hex: a hex quantises to 0-255 and caps
  // the value at 1.0, which is exactly the albedo as scanned. The clean tarmac
  // either side of the line has to be able to go ABOVE that, or the only thing
  // the racing line can do is make the road darker and the whole surface ends
  // up black.
  const colourAt = (i, lat) => {
    const d = Math.abs(lat - line.off[i]);
    // rubbered band, a transition, then pale tarmac nobody has cleaned. The
    // scan under it (Asphalt015) is a clean grey race surface at 0.45, so the
    // clean side sits just above as-scanned and the line is a polished darker
    // band — no longer a black stripe across a whitewashed road.
    let k = d < 1.1 ? 0.66 : d < 2.8 ? 0.66 + (d - 1.1) * 0.2 : 1.0;
    // slow variation along the lap: real asphalt is patched and re-laid in
    // sections, and a perfectly uniform road is the tell that it is not one.
    k *= 0.95 + 0.1 * Math.sin(i * t.ds * 0.0037) + 0.04 * Math.sin(i * t.ds * 0.031);
    return [k, k, k];
  };

  // BRAKING MARKS. Every braking zone on a real circuit is written on the
  // road in black: streaks of rubber laid by locked and nearly-locked fronts,
  // densest just before the turn-in and sitting on the racing line. They are
  // the most readable thing on a circuit you have never seen — a driver finds
  // the braking point by the marks before he finds the board. Where they go
  // is read off the solved speed profile (deceleration above ~0.8 g), never
  // placed by hand, so they cannot disagree with where the car really brakes.
  // Carried to the shader as one float per vertex; the streaks themselves
  // are drawn there (macroTarmac).
  const brake = new Float32Array(n);
  if (line.v) {
    for (let i = 0; i < n; i++) {
      const v0 = line.v[i], v1 = line.v[(i + 1) % n];
      const dec = (v0 * v0 - v1 * v1) / (2 * t.ds);
      brake[i] = Math.max(0, Math.min(1, (dec - 7) / 14));
    }
    // smear forward and back a few metres: marks start a touch early and
    // run on to the turn-in
    const sm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = -4; k <= 8; k++) m = Math.max(m, brake[(i + k + n) % n] * (1 - Math.abs(k) / 10));
      sm[i] = m;
    }
    brake.set(sm);
  }
  const skidAt = (i, lat) => {
    const d = (lat - line.off[i]) / 1.5;
    return brake[i] * Math.exp(-d * d);
  };
  b.skid = [];

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const hi = t.hdg[i], hj = t.hdg[j];
    const pi = (lat) => [t.x[i] - Math.sin(hi) * lat, Z(t.y[i] + Math.cos(hi) * lat)];
    const pj = (lat) => [t.x[j] - Math.sin(hj) * lat, Z(t.y[j] + Math.cos(hj) * lat)];
    b.setHint(i);
    for (let s = 0; s < ROAD_STRIPS; s++) {
      const f0 = s / ROAD_STRIPS, f1 = (s + 1) / ROAD_STRIPS;
      const li0 = -t.w[i] + 2 * t.w[i] * f0, li1 = -t.w[i] + 2 * t.w[i] * f1;
      const lj0 = -t.w[j] + 2 * t.w[j] * f0, lj1 = -t.w[j] + 2 * t.w[j] * f1;
      const a = pi(li0), d = pi(li1), e = pj(lj0), g = pj(lj1);
      // Height comes from the banking model. It is zero everywhere except
      // Zandvoort's two banked corners, so this costs one array lookup a
      // vertex on every other circuit.
      const ya0 = bankY(bank, t, i, li0), ya1 = bankY(bank, t, i, li1);
      const yb0 = bankY(bank, t, j, lj0), yb1 = bankY(bank, t, j, lj1);
      // Wound so the face normal comes out +Y after the reflection. Get this
      // backwards and, because the material is DoubleSide, three does not cull
      // it — it lights the tarmac from underneath and the whole road renders
      // near-black beside a run-off that looks perfect.
      const cols = [colourAt(i, li0), colourAt(i, li1), colourAt(j, lj1), colourAt(j, lj0)];
      b.quad([a[0], ya0, a[1]], [d[0], ya1, d[1]], [g[0], yb1, g[1]], [e[0], yb0, e[1]],
        [0, 1, 0],
        [[li0, foldV(i * t.ds)], [li1, foldV(i * t.ds)], [lj1, foldV(j * t.ds)], [lj0, foldV(j * t.ds)]],
        cols);
      b.skid.push(skidAt(i, li0), skidAt(i, li1), skidAt(j, lj1), skidAt(j, lj0));
    }
  }
  return b;
}

// A ribbon between two lateral offsets, UV'd in metres. Flat, except where the
// circuit is banked — `bank` may be null for anything that should stay level.
// UVs are metres along the track, and a lap is thousands of them: at Monza
// that is 1,931 repeats of a 3 m photograph, and a GPU sampler keeps only a
// few fractional bits of a texture coordinate, so past a few hundred repeats
// every pixel of a tile samples nearly the same texel and the surface smears
// into streaks. Measured on the builder's terrain with a high-contrast scan by
// the parallel look-pass session; NOT visible on this road today, because the
// game's asphalt map is nearly featureless (stddev 4/255 — DESIGN.md says so),
// and the photographs before and after this change are identical within noise.
//
// The fold is insurance for the day a road carries a texture with something in
// it. A TRIANGLE wave, not a saw-tooth: continuous across every quad, so there
// is no seam case, and it mirrors the texture at each fold, which on asphalt
// and on kerb blocks is invisible. FOLD must be an exact multiple of every
// material size that uses these UVs — 96 covers 2, 2.4, 3, 4, 6, 8, 12, 16,
// 24, 32 and 48.
const FOLD = 96;
const foldV = s => FOLD - Math.abs((s % (2 * FOLD)) - FOLD);

// ---------------------------------------------------------------------------
// Real-scale grain needs a second scale on top of it, or it tiles.
//
// A one-metre asphalt photograph is right up close and wrong at 30 m, where
// the eye stops seeing stones and starts seeing a one-metre wallpaper. Real
// tarmac is patched, re-laid and weathered in lanes and blotches metres
// across, so the pale-asphalt scan (apron) is sampled at 23 m and at 7.3 m —
// two sizes that share no factor, so their repeats never line up — and used
// as a gentle brightness map around its own mean. No new texture, no new
// draw: two extra samples in the road's fragment shader.
// ---------------------------------------------------------------------------
//
// The same pass draws two more things a real circuit has written on it:
//   * braking marks, from the per-vertex `skid` roadSurface() computes —
//     thin black streaks a few centimetres wide, laid along the lap in
//     lanes, broken up along their length the way rubber really goes down;
//   * paving joints, the faint seams a paver leaves every ~4.5 m across the
//     road, antialiased by their own screen footprint so they fade to
//     nothing rather than crawl at distance.
// ---------------------------------------------------------------------------
// The same idea for the run-off. `amp` is the metre-scale patchiness; for
// grass, `stripes` is the mown banding every televised circuit has: 6 m bands
// ACROSS the lap, alternately lighter and darker as the mower went out and
// back. From the cockpit they strobe past at speed, which is one more rung on
// the speed ruler; from a TV tower they are the broadcast look itself.
function groundDetail(mat, look, size, { amp = 0.35, stripes = 0 } = {}) {
  const src = look.maps.apron && look.maps.apron.c;
  if (!mat.map || !src) return mat;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: src };
    sh.uniforms.uGSize = { value: size };
    sh.uniforms.uGAmp = { value: amp };
    sh.uniforms.uStripe = { value: stripes };
    sh.fragmentShader = 'uniform sampler2D uMacro;\nuniform float uGSize, uGAmp, uStripe;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec2 mw = vMapUv * uGSize;
    float a = texture2D(uMacro, mw / 19.0 + vec2(0.21, 0.07)).r;
    float b = texture2D(uMacro, mw / 6.1 + vec2(0.53, 0.29)).r;
    float f = 1.0 + uGAmp * ((a * 0.6 + b * 0.4) / 0.19 - 1.0);
    if (uStripe > 0.0) {
      float ph = mw.y / 12.0;
      float w = fwidth(ph) * 1.5 + 0.02;
      float band = smoothstep(0.5 - w, 0.5 + w, abs(fract(ph) - 0.5) * 2.0);
      f *= 1.0 + uStripe * (band * 2.0 - 1.0);
    }
    diffuseColor.rgb *= clamp(f, 0.55, 1.5);
  }`);
  };
  mat.customProgramCacheKey = () => 'ground-detail-' + (stripes > 0 ? 's' : 'p');
  return mat;
}

function macroTarmac(mat, look, size, amp = 0.55) {
  const src = look.maps.apron && look.maps.apron.c;
  if (!mat.map || !src) return mat;
  // Wetness, 0..1, written by View._weather. Water collects where the road
  // is lowest and most worn — here, the darker patches of the macro map and
  // the rubbered line — as near-mirror puddles, while the rest goes merely
  // dark and glossy.
  const wetU = { value: 0 };
  mat.userData.wetU = wetU;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWet = wetU;
    sh.fragmentShader = 'uniform float uWet;\nfloat gPuddle = 0.0;\n' + sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, mix(0.32, 0.04, gPuddle), uWet);`);
    sh.uniforms.uMacro = { value: src };
    sh.uniforms.uMacroSize = { value: size };
    sh.uniforms.uMacroAmp = { value: amp };
    sh.vertexShader = 'attribute float skid;\nvarying float vSkid;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSkid = skid;');
    sh.fragmentShader = 'uniform sampler2D uMacro;\nuniform float uMacroSize;\nuniform float uMacroAmp;\nvarying float vSkid;\n' +
      sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    vec2 mw = vMapUv * uMacroSize;
    float a = texture2D(uMacro, mw / 23.0).r;
    float b = texture2D(uMacro, mw / 7.3 + vec2(0.37, 0.61)).r;
    // the scan's linear mean is ~0.19; express both as a ratio to it
    float f = 1.0 + uMacroAmp * ((a * 0.6 + b * 0.4) / 0.19 - 1.0);
    diffuseColor.rgb *= clamp(f, 0.6, 1.45);
    // standing water in the low, dark patches; a wet road is darker overall
    gPuddle = smoothstep(0.17, 0.12, a * 0.7 + b * 0.3) * smoothstep(0.3, 0.9, uWet);
    diffuseColor.rgb *= 1.0 - uWet * (0.28 + 0.3 * gPuddle);

    // braking marks: lanes 9 cm wide, one in three carrying rubber, each
    // broken along its length by a slow noise so it reads as streaks
    if (vSkid > 0.01) {
      // two lane grids of unrelated pitch (7.7 cm and 13.7 cm), so the
      // marks never line up into a comb; each lane's rubber is switched on
      // and off along its length by a slow noise, so they run in dashes
      float l1 = floor(mw.x * 13.0), l2 = floor(mw.x * 7.3 + 0.4);
      float h1 = fract(sin(l1 * 12.9898) * 43758.5453);
      float h2 = fract(sin(l2 * 78.233 + 4.1) * 43758.5453);
      float a1 = texture2D(uMacro, vec2(l1 * 0.1375, mw.y / (14.0 + 9.0 * h1))).r;
      float a2 = texture2D(uMacro, vec2(l2 * 0.2113 + 0.5, mw.y / (19.0 + 7.0 * h2))).r;
      float streak = max(step(0.66, h1) * smoothstep(0.18, 0.24, a1),
                         step(0.72, h2) * smoothstep(0.19, 0.25, a2) * 0.8);
      float wide = fwidth(mw.x) * 13.0;        // fade when a lane is under a pixel
      float k = vSkid * (0.22 + 0.78 * mix(streak, 0.3, clamp(wide, 0.0, 1.0)));
      diffuseColor.rgb *= 1.0 - 0.7 * k;
    }

    // paving joints every 4.5 m across, 3 cm wide, antialiased
    float jx = abs(fract(mw.x / 4.5 + 0.5) - 0.5) * 4.5;
    float jw = fwidth(mw.x) + 0.015;
    float joint = 1.0 - smoothstep(0.0, jw, jx);
    diffuseColor.rgb *= 1.0 - 0.10 * joint * clamp(0.03 / jw, 0.0, 1.0);
  }`);
  };
  mat.customProgramCacheKey = () => 'macro-tarmac';
  return mat;
}

function ribbon(track, innerAt, outerAt, y, bank = null) {
  const t = track, n = t.n;
  const b = new Builder();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const hi = t.hdg[i], hj = t.hdg[j];
    let ai = innerAt(i), bi = outerAt(i);
    let aj = innerAt(j), bj = outerAt(j);
    if (ai === bi) continue;
    if (ai > bi) { const s = ai; ai = bi; bi = s; }
    if (aj > bj) { const s = aj; aj = bj; bj = s; }
    const P = (h, x, yy, lat) => [x - Math.sin(h) * lat, Z(yy + Math.cos(h) * lat)];
    const p0 = P(hi, t.x[i], t.y[i], ai), p1 = P(hi, t.x[i], t.y[i], bi);
    const q0 = P(hj, t.x[j], t.y[j], aj), q1 = P(hj, t.x[j], t.y[j], bj);
    const yi0 = y + (bank ? bankY(bank, t, i, ai) : 0);
    const yi1 = y + (bank ? bankY(bank, t, i, bi) : 0);
    const yj0 = y + (bank ? bankY(bank, t, j, aj) : 0);
    const yj1 = y + (bank ? bankY(bank, t, j, bj) : 0);
    b.setHint(i);
    b.quad([p0[0], yi0, p0[1]], [p1[0], yi1, p1[1]], [q1[0], yj1, q1[1]], [q0[0], yj0, q0[1]],
      [0, 1, 0],
      [[ai, foldV(i * t.ds)], [bi, foldV(i * t.ds)], [bj, foldV(j * t.ds)], [aj, foldV(j * t.ds)]]);
  }
  return b;
}

// A ribbon cut into one piece per surface material, so a lap can change from
// grass to gravel to asphalt where it really does. Returns { material: Builder }
// and only for the materials that actually occur.
function split(track, innerAt, outerAt, y, bank, matAt) {
  const t = track, out = {};
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n;
    const m = matAt(i);
    (out[m] ||= new Builder());
    const b = out[m];
    const hi = t.hdg[i], hj = t.hdg[j];
    let ai = innerAt(i), bi = outerAt(i), aj = innerAt(j), bj = outerAt(j);
    if (ai === bi) continue;
    if (ai > bi) { const q = ai; ai = bi; bi = q; }
    if (aj > bj) { const q = aj; aj = bj; bj = q; }
    const P = (h, x, yy, lat) => [x - Math.sin(h) * lat, Z(yy + Math.cos(h) * lat)];
    const p0 = P(hi, t.x[i], t.y[i], ai), p1 = P(hi, t.x[i], t.y[i], bi);
    const q0 = P(hj, t.x[j], t.y[j], aj), q1 = P(hj, t.x[j], t.y[j], bj);
    const yi0 = y + (bank ? bankY(bank, t, i, ai) : 0);
    const yi1 = y + (bank ? bankY(bank, t, i, bi) : 0);
    const yj0 = y + (bank ? bankY(bank, t, j, aj) : 0);
    const yj1 = y + (bank ? bankY(bank, t, j, bj) : 0);
    b.setHint(i);
    b.quad([p0[0], yi0, p0[1]], [p1[0], yi1, p1[1]], [q1[0], yj1, q1[1]], [q0[0], yj0, q0[1]],
      [0, 1, 0],
      [[ai, foldV(i * t.ds)], [bi, foldV(i * t.ds)], [bj, foldV(j * t.ds)], [aj, foldV(j * t.ds)]]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kerbs, with a PROFILE rather than a painted stripe on the floor.
//
// A real kerb stands 5 cm proud with a chamfer on each side, and that 5 cm is
// most of what you see: it catches the sun along its top edge and throws a
// shadow line down its face. Painted flat, a kerb is a red-and-white rug.
//
// Each block gets its own four vertices and one flat colour. Sharing vertices
// between segments — which is what a continuous ribbon does — makes the GPU
// interpolate red into white across every quad, and the alternating blocks
// come out as a smooth pink gradient. That was reported as a bug once already.
// ---------------------------------------------------------------------------
function kerbs(track, bank, surf) {
  const t = track;
  const b = new Builder({ color: true });
  const turfB = new Builder();
  // WHERE: the OUTSIDE of every corner, from the tagged data (entry to exit,
  // where a car runs wide) — and, new, the INSIDE at the apex, which is the
  // kerb a driver actually aims at and the single most readable thing in a
  // corner. The physics already treats the 1.2 m past either white line as
  // kerb (main.js), so the inside kerb is drawn where it is already driven.
  const side = new Int8Array(t.n), inside = new Int8Array(t.n), inType = new Uint8Array(t.n);
  for (const c of t.corners || []) {
    const out = c.dir < 0 ? 1 : -1;
    for (let s = c.s0 - 6; s <= c.s1 + 6; s += t.ds) side[t.idx(s)] = out;
    // the apex kerb: the middle of the corner, a little either side of the
    // geometric apex, and never on a kink too gentle to have one
    if ((c.turn || 0) < 12) continue;
    const len = c.s1 - c.s0;
    const a0 = Math.min(c.s, c.s0 + len * 0.25) - 8, a1 = Math.max(c.s, c.s1 - len * 0.2) + 6;
    const typ = c.R < 30 ? 3 : c.R < 90 ? 2 : 1;
    for (let s = a0; s <= a1; s += t.ds) { const k = t.idx(s); inside[k] = -out; inType[k] = typ; }
  }
  const paint = KERB_PAINT[t.key] || KERB_PAINT.default;

  // One kerb run between samples i and j on side sg, cut into real-length
  // blocks. The colour flips on the DISTANCE ROUND THE LAP, so the stripes
  // run continuously through sample boundaries at their true length (about a
  // metre; the old 2.0-3.1 m blocks were twice the size of any real kerb).
  const lay = (i, j, sg, K, withTurf) => {
    const hi = t.hdg[i], hj = t.hdg[j];
    const P = (h, x, y, lat) => [x - Math.sin(h) * lat, Z(y + Math.cos(h) * lat)];
    const w0 = t.w[i] - 0.10, w1 = t.w[i], w2 = t.w[i] + K.w, w3 = t.w[i] + K.w + 0.14;
    const m = Math.max(1, Math.round(t.ds / K.block));
    const sub = t.ds / m;
    for (let q = 0; q < m; q++) {
      const f0 = q / m, f1 = (q + 1) / m;
      const L = (lat, f) => {
        const a = P(hi, t.x[i], t.y[i], sg * lat), c = P(hj, t.x[j], t.y[j], sg * lat);
        return [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f];
      };
      const Y = (lat, f) => bankY(bank, t, i, sg * lat) * (1 - f) + bankY(bank, t, j, sg * lat) * f;
      const sAt = i * t.ds + (f0 + 0.5 / m) * t.ds;
      const col = (Math.floor(sAt / K.block) % 2) ? paint[0] : paint[1];
      const pts = [w0, w1, w2, w3].map(w => [L(w, f0), L(w, f1)]);
      const V = (k, e, up) => { const p = pts[k][e]; return [p[0], Y([w0, w1, w2, w3][k], e ? f1 : f0) + up, p[1]]; };
      // inner chamfer, flat top, outer chamfer
      b.quadN(V(0, 0, 0), V(0, 1, 0), V(1, 1, K.h), V(1, 0, K.h),
        [[0, 0], [sub, 0], [sub, 0.12], [0, 0.12]], col);
      b.quadN(V(1, 0, K.h), V(1, 1, K.h), V(2, 1, K.h), V(2, 0, K.h),
        [[0, 0], [sub, 0], [sub, K.w], [0, K.w]], col);
      b.quadN(V(2, 0, K.h), V(2, 1, K.h), V(3, 1, 0), V(3, 0, 0),
        [[0, 0], [sub, 0], [sub, 0.15], [0, 0.15]], col);
    }
    // Astroturf outside the kerb on corner EXITS, which is where cars run
    // wide — and which is the strip that actually decides whether running wide
    // costs you anything.
    if (withTurf) {
      const Lw = (lat) => [P(hi, t.x[i], t.y[i], sg * lat), P(hj, t.x[j], t.y[j], sg * lat)];
      const Yw = (lat, k) => bankY(bank, t, k ? j : i, sg * lat);
      const w4 = w3 + 1.25;
      const [i3, j3] = Lw(w3), [i4, j4] = Lw(w4);
      turfB.quadN([i3[0], Yw(w3, 0) + 0.012, i3[1]], [j3[0], Yw(w3, 1) + 0.012, j3[1]],
        [j4[0], Yw(w4, 1) + 0.012, j4[1]], [i4[0], Yw(w4, 0) + 0.012, i4[1]],
        [[0, i * t.ds], [t.ds, i * t.ds], [t.ds, 1.25], [0, 1.25]]);
    }
  };

  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n;
    if (t.open && j === 0) continue;
    // Shape comes from the TYPE, which comes from the corner's radius. A
    // hairpin kerb and a fast-corner kerb are not the same object: one is
    // there to punish you, one is there to be used every lap.
    const type = surf.kerb[i];
    b.setHint(i); turfB.setHint(i);
    if (type && surf.kerb[j] === type && side[i] && side[i] === side[j]) {
      lay(i, j, side[i], KERB_SHAPE[type] || KERB_SHAPE[2], surf.turf[i] && surf.turf[j]);
    }
    if (inside[i] && inside[i] === inside[j] && inside[i] !== (type ? side[i] : 0)) {
      lay(i, j, inside[i], KERB_SHAPE[inType[i]] || KERB_SHAPE[2], false);
    }
  }
  return { kerb: b, turf: turfB };
}

// The region fold (crushParts/applyCrush) lives in dent.js with the rest of
// the damage; re-exported here because field.js imports it from this file.
export { crushParts, applyCrush };

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rad.addColorStop(0, 'rgba(255,255,255,0.85)');
  rad.addColorStop(0.45, 'rgba(230,230,235,0.35)');
  rad.addColorStop(1, 'rgba(210,210,215,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
export class View {
  /**
   * Building a circuit now needs textures and a sky off the network, so
   * construction is asynchronous. `View.create` loads them and hands a ready
   * View back; the constructor never does I/O.
   */
  static async create(canvas, track, line, opts = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // Textures, sky and terrain all come off the network; fetch them together.
    // ?chassis=<name> swaps the bodywork for a model imported by
    // tools/chassis.mjs. It loads here, with the rest of the network work,
    // because buildCar is synchronous and the geometry has to exist first.
    const want = new URLSearchParams(location.search).get('chassis');
    const builtP = BUILT[track.key] && !new URLSearchParams(location.search).has('notbuilt')
      ? import(BUILT[track.key]).then(m => {
        const path = buildPath(m.PIECES, { closed: !!m.TRACK.closed });
        return { path, ground: new Ground(path) };
      }).catch(e => { console.error('built world:', e); return null; })
      : null;
    const [look, elev, surf, chassis, built] = await Promise.all([
      Look.load(renderer, track.key, { textures: opts.textures !== false }),
      opts.flat ? null : loadElev(track.key),
      loadSurface(track.key),
      want ? loadChassis(want) : null,
      builtP,
    ]);
    if (built) {
      // The baked elevation is relative to the mean height of the path; the
      // builder's land is absolute. One offset puts them on the same datum.
      built.mean = (elev && elev.mean) || 0;
      built.flora = await loadFlora(renderer).catch(() => null);
    }
    return new View(renderer, look, track, line, { ...opts, elev, surf, chassis, built });
  }

  constructor(renderer, look, track, line, opts = {}) {
    this.track = track; this.line = line; this.look = look;
    // Shadows off is both a real setting for a weak machine and the fastest
    // way to tell whether a lighting problem is the shadow map or the material.
    this.shadows = opts.shadows !== false;
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = this.shadows;
    // PCFSoftShadowMap is deprecated in this three build and silently falls
    // back to PCFShadowMap anyway — ask for what we actually get.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    const sky = look.install(this.scene);
    if (!sky) this.scene.background = new THREE.Color(0x8fa9c4);
    this.sky = sky;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.2, 4200);
    this.camPos = new THREE.Vector3();
    this.camAim = new THREE.Vector3();
    this.camH = 0;
    this.mode = 0;
    this.shake = 0;

    // Real surveyed elevation, from NASA SRTM. Null on a fresh clone that has
    // not run tools/getelev.mjs, and the world is simply flat then.
    this.world = new World(track, opts.elev);
    // A hand-built circuit's ground is the builder's, exactly — so anything
    // the game stands on the ground (trees, objects, the camera floor) stands
    // on the land you can see. The ROAD height stays the baked profile.
    this.built = opts.built || null;
    if (this.built) {
      const { ground, mean } = this.built;
      this.world.groundY = (x, z) => ground.height(x, -z) - mean;
    }
    // What every metre of the circuit is made of — baked by tools/baksurf.mjs.
    // The fallback reproduces exactly what the renderer did before there were
    // tags, so a fresh clone still draws a circuit.
    this.surf = opts.surf || defaultSurface(track);
    this.rig = sunRig(this.scene, sky, { shadows: this.shadows });
    // Where the sun IS, for the god rays. sky.sun is a direction; the rays
    // want a point, so push it five kilometres that way and keep it relative
    // to the camera, or a sun at the world origin sits behind you at Monza.
    this.sunDir = new THREE.Vector3(...(sky?.sun || [0.55, 0.74, 0.38])).normalize();

    // QUALITY IS DETECTED, NOT CHOSEN (LOOK.md). Ask the chip what it is.
    // SwiftShader draws Monza at a frame every seven seconds and the Intel
    // UHD 620 at 112 ms; neither gets a post chain. ?post= overrides.
    const pq = new URLSearchParams(location.search).get('post');
    let quality = pq || 'high';
    if (!pq) {
      try {
        const gl = this.renderer.getContext();
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
        if (/swiftshader|software|llvmpipe/i.test(name)) quality = 'off';
        else if (/intel|uhd|iris/i.test(name)) quality = 'off';
      } catch { /* no extension, assume it can cope */ }
    }
    this.post = new Post(this.renderer, { quality });

    // THE REAL SKY. ?sky=photo keeps the baked photographs; anything else
    // draws it, so the sun can be where the sun actually is.
    const skyQ = new URLSearchParams(location.search).get('sky');
    // NOT gated on the post chain. A drawn sky costs one cube render when the
    // sun moves and nothing at all when it does not, so it is affordable on
    // the Intel chip — and tying them together meant ?post=off silently took
    // the sky with it, which made the one diagnostic I needed impossible.
    if (skyQ !== 'photo') {
      this.proc = new ProcSky(this.renderer);
      // Where "here" is. ?at=lat,lon overrides; the default is Adam's, because
      // LOOK.md 13 says the sky is HIS everywhere rather than the circuit's.
      const atQ = new URLSearchParams(location.search).get('at');
      this.at = atQ
        ? { lat: +atQ.split(',')[0] || 40, lon: +atQ.split(',')[1] || 0, from: 'url' }
        : guessLocation();
      // ?time=2026-06-21T19:30 freezes it. Tedious on purpose: the default is
      // reality, and the override is for looking at a sunset deliberately.
      const tq = new URLSearchParams(location.search).get('time');
      this.fixedTime = tq ? new Date(tq.length <= 5 ? `${new Date().toISOString().slice(0, 10)}T${tq}` : tq) : null;
      if (this.fixedTime && isNaN(+this.fixedTime)) this.fixedTime = null;
      this.wx = readWeather({ rain: 0, cloud: 0.2, wind: 6, temp: 18, kind: 'clear' });
      this._wxAt = 0;
      this._skyAt = -99;
    }
    // Tuning knobs, because every number in post.js is a judgement about
    // light and I cannot see the screen. ?key=0.12&bloom=0.85&rays=0.75
    const qp = new URLSearchParams(location.search);
    for (const [k, f] of [['key', 'exposureKey'], ['bloom', 'bloom'], ['rays', 'rays'], ['thresh', 'threshold'], ['lumfloor', 'lumFloor'], ['sat', 'sat'], ['warm', 'warm'], ['lift', 'lift']]) {
      if (qp.has(k) && this.post.on) this.post[f] = +qp.get(k);
    }
    if (typeof window !== 'undefined') window.__wdcPost = this.post;
    this._lastT = 0;
    const t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    this.stats = this.built ? this._builtWorld() : this._world(opts.env);
    if (typeof window !== 'undefined') window.__wdcBuildMs = Math.round(performance.now() - t0);
    // Publish what actually got built. `tools/shot.mjs` polls for this rather
    // than sleeping for a guessed number of seconds, and a screenshot of a
    // circuit with 0 buildings and 0 people in it is then obviously a failure
    // instead of a mystery.
    if (typeof window !== 'undefined') {
      // renderer.info is only populated after a render, so the draw-call and
      // triangle counts are filled in by the first frame rather than here.
      window.__wdc = { track: track.key, sky: sky ? sky.name : 'none', tex: look.on, ...this.stats };
      // The sky is now a FUNCTION of time and weather, so a screenshot alone
      // cannot tell a working overcast from a broken shader. Publish what it
      // was asked for, or every sky bug costs an afternoon of squinting.
      Object.defineProperty(window.__wdc, 'sun', {
        get: () => this.proc ? {
          elevation: +(this.sunElevation ?? 0).toFixed(2),
          dir: this.rig.dir.map(n => +n.toFixed(3)),
          at: this.at, time: (this.fixedTime || new Date()).toISOString(),
          wx: { cloud: +this.wx.cloud.toFixed(2), wet: +this.wx.wetness.toFixed(2), haze: +this.wx.haze.toFixed(2), kind: this.wx.kind },
          live: this.weatherRaw ? this.weatherRaw.ok : null,
        } : 'photo sky',
        enumerable: true, configurable: true,
      });
      // A debug handle, so tools/shot.mjs can raycast through the scene and
      // say what a mystery object actually is. Cheaper than another screenshot
      // and a guess.
      window.__wdcView = this;
      // Raycast through a point on screen and name what is there. Every mesh
      // this project builds is given a name at creation, so the answer is
      // "pit.shell at 21 m" rather than "Mesh".
      window.__wdcProbe = (u = 0, v = 0) => {
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(u, v), this.camera);
        return rc.intersectObjects(this.scene.children, true).slice(0, 5)
          .map(h => `${h.object.name || h.object.type} @ ${h.distance.toFixed(1)}m`);
      };
      // The same, but naming the MATERIAL — for "what is this lilac thing"
      // questions, where the mesh has no name and the answer is in how it is
      // shaded. shot.mjs --eval "__wdcProbeMat(u, v)".
      window.__wdcProbeMat = (u = 0, v = 0) => {
        const rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(u, v), this.camera);
        return rc.intersectObjects(this.scene.children, true).slice(0, 4).map(h => {
          const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
          return {
            d: +h.distance.toFixed(2), name: h.object.name, type: m.type,
            col: m.color && m.color.getHexString(), tr: m.transparent, op: m.opacity,
            map: !!m.map, side: m.side, cc: m.clearcoat, rough: m.roughness, metal: m.metalness,
            key: m.customProgramCacheKey ? m.customProgramCacheKey() : '',
            n: h.face ? h.face.normal.toArray().map(x => +x.toFixed(2)) : null,
          };
        });
      };
      this._published = true;
    }

    // Photo mode: park the camera at a point on the circuit and look down the
    // track from it. ?photo=s,lat,height,lead — purely a way to inspect the
    // far side of a world without driving there, so it lives in the renderer.
    // ?cam=0..3 picks a rig at load, so the harness can photograph one
    // without a human pressing C.
    const camQ = new URLSearchParams(location.search).get('cam');
    if (camQ != null) this.mode = Math.max(0, Math.min(RIGS_NAMES.length - 1, parseInt(camQ, 10) || 0));

    const ph = new URLSearchParams(location.search).get('photo');
    if (ph) {
      const [s0, lat, y, lead, aimLat] = ph.split(',').map(Number);
      this.photo = {
        s: s0 || 0, lat: lat || 0, y: y || 3, lead: lead || 40,
        // The fifth number aims the camera SIDEWAYS, which is the only way to
        // look into a pit garage without driving a car into one.
        aimLat: Number.isFinite(aimLat) ? aimLat : 0,
      };
    }

    // A GT3 is a different car, not a repainted single-seater.
    const car = opts.cls === 'gt3'
      ? buildGT3(look, 0x2f6fe0)
      : buildCar(look, 0xd8352a, opts.chassis ? chassisGeometry(THREE, opts.chassis) : null, { livery: opts.livery });
    // Your team's sponsors on your car, the way a rival wears theirs.
    if (opts.team && car.decalMat) car.decalMat.map = liveryAtlas(opts.team.col, opts.team).texture;
    this.car = car.group; this.wheels = car.wheels; this.steer = car.steer;
    // The driver's own eyes, for ONBOARD, on a car that has a cockpit to sit
    // in. The GT3 body is a shell with no interior, so it keeps the roof cam.
    this.carEye = car.mirrors && car.mirrors.length ? car.eye : null;
    this.carMirrorGlass = car.mirrors || [];
    // What first person hides: your own head, and the cockpit rim that read
    // as a steering wheel in front of Adam's real one.
    this.fpHide = [...(car.head || []), ...(car.cockpitRim ? [car.cockpitRim] : [])];
    this.drs = car.drs; this.wheelR = car.R; this.spin = 0;
    // HEADLIGHTS (Adam: "gimme headlights"). The sky runs on the real clock, so
    // an evening session is a night race. Two spotlights from the nose, aimed a
    // few metres down the road, plus a glowing lamp face so other cars and the
    // mirror can see you. On by themselves once the sun is under 4 degrees,
    // H forces them on or off. No shadows: two more shadow maps would cost more
    // than the whole field does.
    {
      const box = new THREE.Box3().setFromObject(this.car);
      const nose = box.max.x - 0.15, h = Math.max(0.35, box.min.y + 0.45);
      this.lamps = [];
      const face = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
      for (const side of [-1, 1]) {
        const L = new THREE.SpotLight(0xfff2d8, 0, 260, 0.34, 0.6, 2);
        L.position.set(nose, h, side * 0.55);
        L.target.position.set(nose + 45, 0, side * 1.2);
        L.castShadow = false;
        const glow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), face);
        glow.position.set(nose + 0.01, h, side * 0.55); glow.rotation.y = Math.PI / 2;
        glow.visible = false;
        this.car.add(L, L.target, glow);
        this.lamps.push({ L, glow });
      }
      this.lampsForced = null;          // null = automatic, true/false = H
      // tail and brake lights on your own car (the spotlights are its heads)
      this.ownLamps = carLamps(this.car, box, { heads: false, pool: false });
    }
    // The car's attitude now comes from four real spring deflections in
    // physics.js instead of a multiplier on a g-number. Measured over a hot
    // lap that is +-1.4 deg of roll and +-0.18 deg of pitch — which is exactly
    // right for a car this stiff, and completely invisible on a screen.
    //
    // SOFTEN is the camera's one lie, and it is deliberately the ONLY one: it
    // scales the deflections, not the angles, so roll and pitch keep the ratio
    // the real car has (it rolls about eight times more than it pitches) and a
    // single wheel dropping off a kerb still tips the car the way it really
    // would. ?soften=1 shows the true attitude; 0 pins it flat.
    const sf = new URLSearchParams(location.search).get('soften');
    this.soften = sf == null ? 6 : Math.max(0, +sf || 0);
    this.leanK = this.soften;
    // Wheel pivots in physics.js's corner order: FL, FR, RL, RR. A chassis
    // model loaded with ?chassis= has no hubs, hence the guard.
    const hb = car.hubs || null;
    this.susp = hb ? [hb.fl, hb.fr, hb.rl, hb.rr] : null;
    this.suspY = this.susp ? this.susp.map(h => h ? h.position.y : 0) : null;
    this.suspZ0 = null;   // static deflection, captured on the first frame
    // An imported chassis carries its own wings in its geometry, so the
    // procedural ones must stay hidden. They cannot just be set invisible at
    // build time: the frame loop below sets `m.visible = !lost.frontWing`
    // every frame, which turned them straight back on and the car had two rear
    // wings, one inside the other. Same shape of bug as applyCrush re-showing
    // the bodywork — anything that writes `visible` every frame owns it.
    this.wingParts = opts.chassis ? null : car.wings;
    // An imported chassis gets NO region fold. applyCrush re-shows every mesh
    // it owns on any frame where that region is undamaged (`m.visible = true`
    // in its c < 0.001 branch), which silently undid hiding the procedural
    // bodywork — the old rear wing reappeared through the imported body and
    // the car had two. An imported body cannot fold by region anyway; its
    // damage comes from the deformer below.
    this.crushParts = opts.chassis ? null : crushParts(car.group, car.wheels);
    // Bodywork bent where it was actually hit, on top of the region fold.
    // PLAYER ONLY: this takes its own copy of every geometry it touches,
    // because the field clones one reference car twenty-two times and
    // clone(true) SHARES geometry — denting a shared buffer would put the
    // same dent on the whole grid. Rivals keep the region fold, which is
    // transform-only and safe to share.
    this.deformer = makeDeformer(car.group, car.wheels);

    // ?dents=lx:ly:depth:r,...  — preset impacts in the car's own metres, so
    // the crumple can be photographed without arranging a crash first. Sits
    // here rather than in main.js for the same reason ?cam and ?photo do: it
    // is a renderer debug hook and it needs nothing from the game loop.
    // The push direction defaults to INWARD, toward the car's centreline,
    // which is the direction a real impact moves bodywork.
    // NOTE the target: `car` in THIS scope is buildCar's mesh bundle
    // ({group, wheels, steer, drs, R, wings}), not the physics car. Writing
    // dents onto it put them somewhere nothing reads, and the first
    // screenshots came back clean with no error to say why.
    const dq = new URLSearchParams(location.search).get('dents');
    if (dq) {
      this.presetDents = dq.split(',').map(bit => {
        const [lx, ly, depth, r] = bit.split(':').map(Number);
        const m = Math.hypot(lx || 0, ly || 0) || 1;
        return {
          lx: lx || 0, ly: ly || 0,
          nx: -(lx || 0) / m, ny: -(ly || 0) / m,
          depth: Math.max(0, Math.min(0.85, depth || 0.4)),
          r: Math.max(0.2, r || 0.9),
        };
      });
    }
    // YAW ON THE PARENT, ROLL AND PITCH ON THE CHILD.
    //
    // All three used to live on one object, and with three's default XYZ Euler
    // order that is wrong: the Z rotation is applied to the UN-yawed car, so
    // what was labelled body roll came out as pitch and what was labelled
    // pitch came out as roll, and both were only correct at heading zero. At
    // 0.03 rad nobody would ever see it. At 18 degrees of banking they would.
    // Splitting the two puts roll and pitch in the car's own frame.
    //
    // The crush parts are captured off `car.group` and deform in their own
    // local space, so reparenting the group leaves them untouched.
    this.carYaw = new THREE.Group();
    this.carYaw.add(this.car);
    this.scene.add(this.carYaw);
    this.hint = 0;

    // Where a bolted camera sits, and what it looks at, both children of the
    // car so they inherit its yaw, pitch, roll and banked height for nothing.
    this.camMount = new THREE.Object3D();
    this.camTarget = new THREE.Object3D();
    this.car.add(this.camMount, this.camTarget);
    this._mirror();
    this._carMirrors();
    // Scratch, so a 400 Hz-adjacent loop allocates nothing.
    this._v0 = new THREE.Vector3(); this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._up = new THREE.Vector3(0, 1, 0);
    this.tvI = 0;
    this._smoke();
    this.fx = new Fx(this, car);   // debris, sparks, tyre smoke (js/fx.js)

    addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Every frame goes through here, so the post chain can never be skipped. */
  /**
   * Put the sun where the sun is, and the weather where the weather is.
   *
   * Called every frame and does almost nothing most of them: ProcSky only
   * rebuilds its cube when the sun has actually moved, and the weather is
   * fetched every ten minutes rather than every sixteen milliseconds.
   */
  // ---- the car's own mirrors ----------------------------------------------
  // Adam, 2026-09-25: "my mirrors should be actual parts of the car ... on
  // either side ... they reflect, i can see my car in them too".
  //
  // Each glass gets its own small camera, placed at the glass and aimed along
  // the REFLECTION of the line from the driver's eye to it — which is what a
  // mirror shows, so looking at it from the cockpit you see behind and a
  // little outboard, and the edge of your own sidepod and rear tyre. Drawn
  // into a small target, flipped left for right, on the glass.
  //
  // Cost is the thing: each is a whole extra render of the scene. So they are
  // small (320x120), they take turns (each updates at half the frame rate),
  // shadows are not redrawn for them, and they are only drawn when you can
  // see them — onboard and on the nose cam. ?carmirrors=0 turns them off.
  _carMirrors() {
    this.carMirrors = [];
    if (new URLSearchParams(location.search).get('carmirrors') === '0') return;
    for (const glass of this.carMirrorGlass || []) {
      const rt = new THREE.WebGLRenderTarget(320, 120, { samples: 2 });
      rt.texture.wrapS = THREE.RepeatWrapping;
      rt.texture.repeat.set(-1, 1);
      rt.texture.offset.set(1, 0);
      glass.material = new THREE.MeshBasicMaterial({ map: rt.texture, color: new THREE.Color(1.5, 1.5, 1.5) });
      // the glass geometry is baked in car space: find its centre and normal once
      const geo = glass.geometry;
      geo.computeBoundingBox();
      const c = geo.boundingBox.getCenter(new THREE.Vector3());
      const n = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, 0).normalize();
      // 220 m: past that a car is two pixels tall on a 320-wide glass, and
      // every metre of far plane is scenery drawn a second time for nothing.
      const cam = new THREE.PerspectiveCamera(16, 320 / 120, 0.05, 220);
      this.carMirrors.push({ glass, rt, cam, c, n });
    }
    this._mi = 0;
    this._mE = new THREE.Vector3(); this._mM = new THREE.Vector3(); this._mN = new THREE.Vector3();
  }

  _drawCarMirrors() {
    if (!this.carMirrors || !this.carMirrors.length || this.photo) return;
    const rig = RIGS_NAMES[this.mode];
    if (rig !== 'ONBOARD' && rig !== 'NOSE') return;
    // FRAME BUDGET (2026-09-28, 50 fps floor): the extra scene renders take
    // turns — virtual mirror on one frame, one car mirror on the next — so a
    // frame never pays for more than ONE of them. Measured at Monaco with 22
    // cars before this: 1494 draw calls a frame, 734 with mirrors off.
    if (this.mirrorOn && (this._mFrame & 1) === 0) return;
    const m = this.carMirrors[this._mi++ % this.carMirrors.length];
    const car = this.car;
    car.updateWorldMatrix(true, false);
    const eye = this.carEye || [-0.2, 0.65, 0];
    const E = this._mE.set(eye[0], eye[1], eye[2]).applyMatrix4(car.matrixWorld);
    const M = this._mM.copy(m.c).applyMatrix4(car.matrixWorld);
    const N = this._mN.copy(m.n).transformDirection(car.matrixWorld);
    // The glass must face the EYE. Its first vertex normal can point into the
    // housing, which parked the mirror's camera inside the mirror and drew
    // the glass solid black.
    if (N.dot(this._v2.copy(E).sub(M)) < 0) N.negate();
    // the reflected sight line: V - 2(V.N)N
    const V = M.clone().sub(E).normalize();
    const R = V.sub(N.clone().multiplyScalar(2 * V.dot(N)));
    m.cam.position.copy(M).addScaledVector(N, 0.015);
    m.cam.up.set(0, 1, 0).applyQuaternion(car.getWorldQuaternion(this._q));
    m.cam.lookAt(M.clone().add(R));
    const r = this.renderer;
    const sm = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    m.glass.visible = false;
    r.setRenderTarget(m.rt);
    r.clear();
    r.render(this.scene, m.cam);
    r.setRenderTarget(null);
    m.glass.visible = true;
    r.shadowMap.autoUpdate = sm;
  }

  // ---- the mirror ---------------------------------------------------------
  // Adam: "also add mirrors". A race you cannot see behind is a race where the
  // car that passes you arrives from nowhere — which is exactly how a field of
  // real rivals ends up feeling like ghosts. One wide virtual mirror across the
  // top of the screen, the way ACC and iRacing do it: the scene from just behind
  // the rear wing, looking back, drawn into a small target and flipped left for
  // right as a mirror is.
  //
  // Cheap on purpose, because draw calls are this game's budget: a 700 m far
  // plane (everything behind that is scenery nobody is racing), the shadow map
  // reused from the main pass rather than re-rendered, and no post chain.
  _mirror() {
    const box = new THREE.Box3().setFromObject(this.car);
    const rear = Number.isFinite(box.min.x) ? box.min.x : -2.6;
    this.mirMount = new THREE.Object3D();
    this.mirTarget = new THREE.Object3D();
    this.mirMount.position.set(rear - 0.55, 0.98, 0);
    this.mirTarget.position.set(rear - 60, 0.55, 0);
    this.car.add(this.mirMount, this.mirTarget);
    this.mirCam = new THREE.PerspectiveCamera(34, 4.2, 0.4, 320);
    this.mirRT = new THREE.WebGLRenderTarget(640, 152, { samples: 2 });
    // Brightened: the main view goes through post.js's eye adaptation and this
    // does not, so at dusk the raw pass came out a stop and a half darker than
    // the windscreen it sits on top of.
    const mat = new THREE.MeshBasicMaterial({ map: this.mirRT.texture, depthTest: false, depthWrite: false,
                                              color: new THREE.Color(1.9, 1.9, 1.9) });
    this.mirRT.texture.wrapS = THREE.RepeatWrapping;
    this.mirRT.texture.repeat.set(-1, 1);          // a mirror swaps left and right
    this.mirQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mirQuad.frustumCulled = false;
    this.mirScene = new THREE.Scene();
    this.mirScene.add(this.mirQuad);
    this.mirFlat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mirrorOn = false;
  }

  setMirror(on) {
    this.mirrorOn = !!on;
    // The start lights and the message line live where the mirror is drawn.
    if (typeof document !== 'undefined') document.body.classList.toggle('mirror', this.mirrorOn);
    return this.mirrorOn;
  }

  _drawMirror() {
    if (!this.mirrorOn || this.photo || RIGS_NAMES[this.mode] === 'TV') return;
    const r = this.renderer;
    // Redraw the reflection on even frames only (see _drawCarMirrors); the
    // quad is still composited EVERY frame from the last reflection, so the
    // mirror never flickers — it just updates at half rate, as ACC's does.
    const fresh = (this._mFrame & 1) === 0 || !this._mirFresh;
    this._mirFresh = true;
    this.car.updateWorldMatrix(true, false);
    this.mirMount.getWorldPosition(this._v0);
    this.mirTarget.getWorldPosition(this._v1);
    this.mirCam.up.set(0, 1, 0);
    this.mirCam.position.copy(this._v0);
    this.mirCam.lookAt(this._v1);
    if (fresh) {
      const sm = r.shadowMap.autoUpdate;
      r.shadowMap.autoUpdate = false;
      r.setRenderTarget(this.mirRT);
      r.clear();
      r.render(this.scene, this.mirCam);
      r.shadowMap.autoUpdate = sm;
      r.setRenderTarget(null);
    }
    // Top centre, a third of the screen wide, with a dark frame round it.
    const size = r.getSize(this._mirSize || (this._mirSize = new THREE.Vector2()));
    const w = Math.round(Math.min(size.x * 0.34, 560)), h = Math.round(w / 4.2);
    const x = Math.round((size.x - w) / 2), y = Math.round(size.y - h - 10);
    const auto = r.autoClear;
    r.autoClear = false;
    r.setScissorTest(true);
    r.setViewport(x - 3, y - 3, w + 6, h + 6); r.setScissor(x - 3, y - 3, w + 6, h + 6);
    r.setClearColor(0x0a0a0c, 1); r.clear(true, false, false);
    r.setViewport(x, y, w, h); r.setScissor(x, y, w, h);
    r.render(this.mirScene, this.mirFlat);
    r.setScissorTest(false);
    r.setViewport(0, 0, size.x, size.y);
    r.autoClear = auto;
  }

  /** WEATHER menu: 'live', a kind, or 'changing' (weather.js). */
  setWeather(mode, seed = 1) { this.wxDir = new WeatherDirector(mode, seed); }

  // Every frame: the sky's weather, the road's wetness, the rain in the air.
  // The live Open-Meteo reading (fetched below, every ten minutes) is only the
  // input in LIVE mode; a chosen or changing weather ignores it.
  _weather(dt) {
    if (!this.wxDir) this.wxDir = new WeatherDirector('live', 1);
    const raw = this.wxDir.step(dt, this.weatherRaw || null);
    const wx = readWeather(raw);
    wx.wetness = raw.road; wx.rain = raw.rain || 0;
    this.wx = wx;
    const ch = this.wxDir.takeChange();
    if (ch) this.weatherChange = ch;
    // A wet road is darker and a mirror for the sky: less rough, more
    // reflection. Stored dry values, so it dries back to exactly what it was.
    const m = this.road && this.road.material;
    if (m) {
      const d = m.userData.dry || (m.userData.dry = { r: m.roughness, c: m.color.clone(), e: m.envMapIntensity ?? 1 });
      const w = raw.road;
      m.roughness = d.r * (1 - 0.6 * w);
      m.color.copy(d.c).multiplyScalar(1 - 0.35 * w);
      m.envMapIntensity = d.e * (1 + 1.3 * w);
      if (m.userData.wetU) {
        m.userData.wetU.value = w;
        // The renderer writes scene.environmentIntensity over any material
        // WITHOUT its own envMap (see sky.js), so the boost above never
        // applied. Giving the wet road the scene's own cube as its envMap is
        // what lets it reflect the sky at its own, stronger intensity.
        const want = w > 0.02 ? this.scene.environment : null;
        if (m.envMap !== want) { m.envMap = want; m.envMapIntensity = 1.6; m.needsUpdate = true; }
      }
    }
    if (wx.rain > 0.05 && !this.rain) this.rain = new Rain(this.scene);
    if (this.rain) this.rain.update(wx.rain, this.camera, dt);
  }

  _sky(now) {
    if (!this.proc) return;
    const when = this.fixedTime || new Date();
    const sol = solarPosition(when, this.at.lat, this.at.lon);
    const v = sunVector(sol.elevation, sol.azimuth);

    // The rig closes over its own `dir` array, so writing into it steers the
    // light and its shadow box without rebuilding anything.
    this.rig.dir[0] = v[0]; this.rig.dir[1] = v[1]; this.rig.dir[2] = v[2];

    // A low sun is dim and orange because its light has crossed forty times
    // as much air — the same reason the sky goes red, seen from the other end.
    const up = Math.max(0, Math.min(1, sol.elevation / 45));
    const warm = Math.pow(1 - up, 2.2);
    // THE PHASES (weather.js dayPhase). The sun no longer switches off at the
    // horizon: it fades in over the first six degrees, so a sunrise has light
    // in it, and below the horizon the SKY still lights the world — blue and
    // dimming through dawn and dusk, dark blue at night — instead of the day's
    // ambient left on all night (0.55..1.0 regardless).
    const ph = dayPhase(sol.elevation, sol.azimuth);
    this.phase = ph;
    const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const rise = sm(-1.5, 6, sol.elevation);
    this.rig.sun.intensity = 3.1 * Math.max(up, 0.10 * rise) * rise * this.wx.punch;
    this.rig.sun.color.setRGB(1, 1 - warm * 0.30, 1 - warm * 0.62);
    this.rig.sun.castShadow = this.shadows && sol.elevation > 3 && this.wx.punch > 0.25;
    // Ambient still RISES as the sun falls (or dusk is black), but only while
    // there is a lit sky to give it: from 2 degrees down to -12 it thins out
    // and turns blue.
    const lit = sm(-12, 2, sol.elevation);
    const hemi = this.rig.hemi;
    if (!hemi.userData.base) hemi.userData.base = hemi.color.clone();
    hemi.intensity = (0.55 + (1 - up) * 0.45 + this.wx.cloud * 0.5) * (0.30 + 0.70 * lit);
    hemi.color.setRGB(0.36, 0.46, 0.85).lerp(hemi.userData.base, lit);

    if (now - this._skyAt > 0.25) {
      this._skyAt = now;
      this.proc.update(this.scene, v, {
        turbidity: 1.8 + this.wx.haze * 5.5,
        cloud: this.wx.cloud,
        elevation: sol.elevation,
      });
    }
    this.sunElevation = sol.elevation;
    if (this.lamps) {
      // 420 whitewashed the road into a glare that the exposure then fought
      // (road white, everything else black). They fade in with the dark now.
      const on = this.lampsForced ?? ph.dark > 0.2;
      const k = this.lampsForced ? 1 : ph.dark;
      for (const { L, glow } of this.lamps) { L.intensity = on ? 16 * Math.max(0.35, k) : 0; glow.visible = on; }
    }
    if (this.courseLights) this.courseLights.setNight(ph.dark);
    // Heat shimmer over the far tarmac: a high sun on a clear, dry, warm day.
    if (this.post && this.post.on) {
      if (this._heatQ === undefined) {
        const hq = new URLSearchParams(location.search).get('heat');
        this._heatQ = hq != null && Number.isFinite(+hq) ? +hq : null;
      }
      const warmth = Math.max(0, Math.min(1, ((this.wx.temp ?? 20) - 12) / 16));
      this.post.heat = this._heatQ ?? (sm(18, 50, sol.elevation) * (1 - this.wx.cloud) *
        (1 - (this.wx.wetness || 0)) * (0.35 + 0.65 * warmth));
    }

    // Weather, every ten minutes, and never blocking a frame.
    if (now - this._wxAt > 600 || !this._wxAt) {
      this._wxAt = now || 1;
      fetchWeather(this.at.lat, this.at.lon)
        .then(w => { this.wx = readWeather(w); this.weatherRaw = w; })
        .catch(() => { /* a nice day, then */ });
    }
  }

  _draw() {
    // renderer.info RESETS on every render() call, and the post chain ends
    // with a full-screen quad — so main.js's telemetry started reporting
    // "draws: 1, tris: 2" for a circuit with two thousand buildings in it.
    // Held across the whole frame instead, so the numbers now include the
    // post passes, which is what a frame actually costs anyway.
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
    const dt = this._lastT ? Math.min(0.1, now - this._lastT) : 0.016;
    this._lastT = now;
    this._weather(dt);
    this._sky(now);
    this._mFrame = (this._mFrame || 0) + 1;
    this._drawCarMirrors();
    if (this.built) {
      this.built.look.tick(now);
      if (this.built.plants) this.built.plants.update(this.camera);
    }
    if (this.post && this.post.on) {
      const d = this.proc ? this.rig.dir : this.sunDir.toArray();
      this.post.setSun(
        new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(5000).add(this.camera.position),
        this.camera);
      this.post.render(this.scene, this.camera, dt);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
    // Light trails, over the finished frame, at night. ?trails=0 turns them off.
    if (this.trailsOn === undefined) this.trailsOn = new URLSearchParams(location.search).get('trails') !== '0';
    if (this.trailsOn && this.nightOn()) {
      if (!this.trails) this.trails = new LightTrails(this.renderer);
      this.trails.render(this.scene, this.camera, { speed: this._spd || 0, night: 1, dt, boost: this.trailBoost ?? 1 });
    }
    this._drawMirror();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
  }

  // The builder's world, for a hand-built circuit. Same calls, same order,
  // as js/build/app.js; what is left out is what the game already has — its
  // own sky, sun and weather — and the builder's cones (off there too).
  _builtWorld() {
    const t = this.track, S = this.scene, { path, ground, mean, flora } = this.built;
    const stats = { built: true };
    this.bank = bankTable(t);
    const look = new BuildLook(this.renderer, this.look, flora, {});
    this.built.look = look;
    const G = new THREE.Group();
    G.name = 'built';
    G.position.y = -mean;
    const land = buildBuiltGround(ground.chunks(), look.terrain({ land: 'simple' }));
    foldTerrainUVs(land);
    land.name = 'ground.plate';
    G.add(land);
    const mats = look.road();
    const road = buildRoad(path, mats);
    G.add(road);
    G.add(buildRunoff(path, mats?.apron));
    const brand = brandTexture(this.renderer.capabilities.getMaxAnisotropy());
    G.add(buildWalls(path, ground, brand));
    G.add(buildDetails(path, ground, brand));
    G.add(buildTunnels(path));
    G.add(buildViaducts(path, ground));
    const landmarks = buildLandmarks(path, ground);
    G.add(landmarks);
    if (landmarks.userData.beam) G.add(gantryBanner(brand, landmarks.userData.beam));
    G.updateMatrixWorld(true);
    S.add(G);
    // The rain darkens whatever `this.road` is.
    this.road = road.children.find(m => m.isMesh) || null;
    // Grass and the forest from data/build/scenery.js arrive when they are
    // ready; the circuit is drivable before the last tree is planted.
    if (flora) {
      buildFlora(this.renderer, path, ground, look, { trees: 0.8, fringe: true, shadows: this.shadows })
        .then(f => { if (f && f.group) { f.group.position.y = -mean; S.add(f.group); this.built.plants = f; } })
        .catch(e => console.error('built flora:', e));
    }
    this.courseLights = buildCourseLights(S, t, this.world);
    this.tvCams = this._tvCameras();
    stats.tvCams = this.tvCams.length;
    const lg = this.world.lift(
      ribbon(t, i => this.line.off[i] - 0.10, i => this.line.off[i] + 0.10, 0.02, this.bank).geometry());
    this.lineMesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({
      color: 0x35d6a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    this.lineMesh.visible = false;
    S.add(this.lineMesh);
    return stats;
  }

  _world(env) {
    const t = this.track;
    const S = this.scene;
    const look = this.look;
    const stats = {};
    // The air, and what is in the distance. First, because everything else is
    // judged against it: without layered distance and real aerial perspective
    // a circuit reads as a diorama however good its surfaces are.
    stats.horizon = buildHorizon(S, t, env, this.sky, this.world);
    stats.elev = this.world.on
      ? { rise: +(Math.max(...this.world.elev.s) - Math.min(...this.world.elev.s)).toFixed(1), set: this.world.elev.dataset }
      : null;
    // Zandvoort banks 18 degrees at Tarzanbocht and Arie Luyendyk. Everywhere
    // else this table is all zeroes and costs one lookup per vertex.
    this.bank = bankTable(t);
    const bank = this.bank;

    // The ground the whole circuit sits on. Big, textured, and the colour of
    // the region rather than a default green — it is what fills every gap the
    // survey does not cover.
    const plate = buildGround(t, look, this.sky, this.world);
    // Named, like the pit meshes, so tools/groundcheck.mjs can raycast at the
    // GROUND and nothing else. Without a name it has to guess from a hit list,
    // and a tree standing on a hole in the world looks exactly like ground.
    plate.name = 'ground.plate';
    S.add(plate);
    // Fills the hole buildGround leaves around the circuit, at track
    // resolution, so the terrain can never close over the road.
    const skirt = buildSkirt(t, look, this.sky, this.world, buildGround.hole || 260, buildGround.cell || 0);
    if (skirt) { skirt.name = 'ground.skirt'; S.add(skirt); }

    // RUN-OFF, BY MATERIAL.
    //
    // It used to be one material for a whole circuit, which is wrong in a way
    // you notice without being able to name it: Monza does not have a gravel
    // trap running the length of the main straight, it has mown grass, and
    // gravel only where a car leaving the road would actually land. The tags
    // come from data/surf/, so the rules live in one readable place rather
    // than as conditionals in here.
    // REAL-SCALE DETAIL (2026-09-28, "make details smaller"). Each scan is
    // laid at the size its grains really are: Gravel023's pebbles measure
    // 10-20 px of 512, so at the old 2.4 m they were fist-sized cobbles and a
    // trap is 1-3 cm stone -> 0.9 m. Grass005's blades were 13 cm long at
    // 3.4 m -> 1.7 m. Asphalt031 -> 1.6 m, matching the racing surface's
    // grain. What the smaller tile loses — variation at the scale of metres —
    // groundDetail() puts back, and the grass gets its mowing stripes.
    const RUNMAT = [
      groundDetail(look.mat('gravel', { size: 0.9, tint: 0xb9aa8e, roughness: 1, side: THREE.DoubleSide, normalScale: 1.5 }), look, 0.9, { amp: 0.45 }),
      groundDetail(look.mat('apron', { size: 1.6, tint: 0x8a8b8e, roughness: 0.97, side: THREE.DoubleSide, normalScale: 1.2 }), look, 1.6, { amp: 0.4 }),
      groundDetail(look.mat('grass', { size: 1.7, tint: 0x7c9450, roughness: 1, side: THREE.DoubleSide, normalScale: 1.2 }), look, 1.7, { amp: 0.35, stripes: 0.13 }),
      look.mat('concrete', { size: 3.0, tint: 0xb8b6b0, roughness: 0.95, side: THREE.DoubleSide }),
    ];
    for (const [side, tag] of [[1, this.surf.runL], [-1, this.surf.runR]]) {
      const parts = split(t, i => side * t.w[i],
        i => side * (t.w[i] + (side > 0 ? t.runL[i] : t.runR[i])), -0.03, bank, i => tag[i]);
      for (const m in parts) {
        const mesh = parts[m].mesh(RUNMAT[m] || RUNMAT[1], { shadow: false });
        if (mesh) { this.world.lift(mesh.geometry); S.add(mesh); }
      }
    }

    // Asphalt015 (tools/gettex.mjs says why) laid at 1.4 m, not the 1.0 its
    // stones measure: at a driver's eye a true-size stone is under a pixel
    // from three metres out and the road averages to a flat grey sheet; 1.4
    // keeps the grain alive to ~15 m while still reading as fine aggregate
    // rather than the old half-metre blotches. The tint brings the scan (0.45
    // sRGB, pale for a race surface) down to charcoal, and macroTarmac() lays
    // metre-scale patching, braking marks and paving joints over it.
    const roadB = roadSurface(t, this.line, bank);
    const road = roadB.mesh(macroTarmac(look.mat('tarmac', {
      size: 1.4, tint: 0xc8c4bd, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
      vertexColors: true, env: 0.4, normalScale: 0.9,
    }), look, 1.4), { shadow: false });
    {
      const nv = road.geometry.attributes.position.count;
      const sk = new Float32Array(nv);
      if (roadB.skid && roadB.skid.length === nv) sk.set(roadB.skid);
      road.geometry.setAttribute('skid', new THREE.BufferAttribute(sk, 1));
    }
    this.world.lift(road.geometry);
    S.add(road);
    this.road = road;

    // The white lines that define the track limits. They sit a centimetre up
    // and are pulled forward in the depth buffer, because over a 2 km view
    // that centimetre is well inside the precision available.
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xeeeeea, roughness: 0.74, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3,
    });
    for (const b of [ribbon(t, i => t.w[i] - 0.14, i => t.w[i], 0.006, bank),
      ribbon(t, i => -(t.w[i] - 0.14), i => -t.w[i], 0.006, bank)]) {
      const m = b.mesh(lineMat, { shadow: false });
      if (m) { this.world.lift(m.geometry); S.add(m); }
    }

    const kp = kerbs(t, bank, this.surf);
    // PAINT, not tinted concrete. The concrete scan's albedo (0.32 linear)
    // multiplied under the paint turned red into brick and white into grey;
    // a kerb is painted, so the paint IS the albedo and the scan contributes
    // only its relief (normal map) and its wear (roughness).
    const kerbMat = look.mat('concrete', {
      size: 1.4, roughness: 0.55, side: THREE.DoubleSide, vertexColors: true, normalScale: 0.7,
    });
    kerbMat.map = null;
    const kb = kp.kerb.mesh(kerbMat);
    if (kb) { this.world.lift(kb.geometry); S.add(kb); }
    const tf = kp.turf.mesh(look.mat('grass', {
      size: 1.1, tint: 0x3f6b34, roughness: 1, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    }), { shadow: false });
    if (tf) { this.world.lift(tf.geometry); S.add(tf); }

    // The real surroundings, if they have been baked. Without these the world
    // ends in a flat plane against the sky, which reads as a video game
    // instantly — and gives the eye nothing to measure speed against.
    // The pit complex is laid out BEFORE the city so the city can be told to
    // keep out of its way.
    const corridor = pitCorridor(t);
    stats.landmarks = placeLandmarks(this, env);   // js/landmarks.js: before the city, which it may clear over a tunnel
    stats.env = buildEnv(S, env, t, look, corridor, this.world);
    this.corridor = corridor;

    const sign = signAtlas(t);
    this.sign = sign;
    buildBarriers(S, t, look, sign, corridor, this.world);
    buildTyreWalls(S, t, look, this.world);
    buildBoards(S, t, this.line, look, sign, this.world);
    buildStartFinish(S, t, look, sign, this.world);
    buildMarshalPosts(S, t, look, this.world);
    buildFlagpoles(S, t, this.world);
    this.courseLights = buildCourseLights(S, t, this.world);
    stats.stands = buildGrandstands(S, t, env, look, this.world, sign);
    stats.pit = buildPitLane(S, t, look, sign, this.world);
    this.tvCams = this._tvCameras();
    stats.tvCams = this.tvCams.length;

    // The ideal line, toggled with L — a reference, not a rail.
    const lg = this.world.lift(
      ribbon(t, i => this.line.off[i] - 0.10, i => this.line.off[i] + 0.10, 0.02, bank).geometry());
    this.lineMesh = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({
      color: 0x35d6a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    this.lineMesh.visible = false;
    S.add(this.lineMesh);

    return stats;
  }

  // ---------------------------------------------------------------------------
  // Broadcast cameras: fixed positions beside the circuit that hand the car off
  // to each other as it comes past. Placed on whichever side has room for a
  // tower, which is the same rule a real outside broadcast follows.
  // ---------------------------------------------------------------------------
  _tvCameras() {
    const t = this.track;
    const cams = [];
    const corridor = this.corridor;
    // Nothing may stand in the pit complex. The first version put the camera
    // for the start line inside the pit lane, so the opening broadcast shot
    // was half pit wall.
    const inPit = (x, y) => {
      if (!corridor) return false;
      const r2 = (corridor.radius + 12) ** 2;
      for (const q of corridor.pts) if ((q[0] - x) ** 2 + (q[1] - y) ** 2 < r2) return true;
      return false;
    };
    for (let s = 0; s < t.length; s += 255) {
      const i = t.idx(s);
      let placed = null;
      // Prefer the side with more room, but take the other one rather than
      // stand in the pits.
      const order = t.runL[i] > t.runR[i] ? [1, -1] : [-1, 1];
      for (const side of order) {
        const run = side > 0 ? t.runL[i] : t.runR[i];
        const lat = side * (t.w[i] + run + Math.min(14, 4 + run * 0.5));
        const p = t.point(s, lat);
        if (inPit(p.x, p.y)) continue;
        // 6-8 m, not 12. A camera twelve metres up at thirty looks DOWN at
        // twenty degrees and the shot becomes mostly tarmac; real trackside
        // towers sit low enough to shoot nearly along the track surface.
        // ABOVE THE GROUND IT STANDS ON. This was 6.2 m above sea level, so
        // on any circuit with real elevation the tower was buried and the
        // broadcast shot was taken from inside the grass (Monza, found by the
        // first replay photograph).
        const w = this.world;
        const base = w ? Math.max(w.trackYAt(s), w.groundY(p.x, Z(p.y))) : 0;
        placed = { s, x: p.x, y: base + 6.2 + (run > 14 ? 1.6 : 0), z: Z(p.y) };
        break;
      }
      if (placed) cams.push(placed);
    }
    return cams;
  }

  // Hold a camera until the car is well past it, then take the next one. Real
  // directors cut late rather than early, and switching on nearest-distance
  // alone produces a shot that changes every two seconds.
  _pickTvCamera(carS) {
    const cams = this.tvCams;
    if (!cams || !cams.length) return null;
    const t = this.track;
    const cur = cams[this.tvI % cams.length];
    const gap = t.gap(cur.s, carS);       // positive = the camera is ahead
    if (gap < -170 || gap > 620) {
      let best = this.tvI, bestGap = Infinity;
      for (let k = 0; k < cams.length; k++) {
        const g = t.gap(cams[k].s, carS);
        if (g > 40 && g < bestGap) { bestGap = g; best = k; }
      }
      this.tvI = best;
    }
    return cams[this.tvI % cams.length];
  }

  _smoke() {
    this.smokeMax = 260;
    this.smoke = [];
    const pos = new Float32Array(this.smokeMax * 3);
    const size = new Float32Array(this.smokeMax);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const m = new THREE.PointsMaterial({
      map: puffTexture(), size: 1.4, sizeAttenuation: true,
      transparent: true, depthWrite: false, opacity: 0.5,
    });
    this.smokePts = new THREE.Points(g, m);
    this.smokePts.frustumCulled = false;
    this.scene.add(this.smokePts);
    for (let i = 0; i < this.smokeMax; i++) this.smoke.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0 });
    this.smokeI = 0;
  }

  puff(x, z, vx, vz, force, baseY = 0) {
    if (this.fx && this.fx.on) return this.fx.puff(x, z, vx, vz, force, baseY);   // js/smoke.js
    const p = this.smoke[this.smokeI];
    this.smokeI = (this.smokeI + 1) % this.smokeMax;
    p.life = 1;
    p.x = x; p.y = baseY + 0.12; p.z = z;
    p.vx = -vx * 0.06 + (Math.random() - 0.5) * 1.6;
    p.vz = -vz * 0.06 + (Math.random() - 0.5) * 1.6;
    p.vy = 0.5 + Math.random() * 0.9 * force;
  }

  setMode(m) { const n = RIGS_NAMES.length; this.mode = ((m % n) + n) % n; }
  /** Is it dark enough for lamps? The sun, not the H key: that is yours alone. */
  // How dark it is, 0..1 — or 0 until it is dark enough for lamps (truthy = on).
  nightOn() { const d = this.phase ? this.phase.dark : 0; return d > 0.2 ? d : 0; }

  toggleHeadlights() {
    const now = this.lampsForced ?? !!this.nightOn();
    this.lampsForced = !now;
    return this.lampsForced;
  }
  toggleLine() { this.lineMesh.visible = !this.lineMesh.visible; return this.lineMesh.visible; }

  // dt here is a REAL frame time — camera smoothing is allowed to be
  // frame-rate dependent, the simulation is not.
  frame(car, dt, hud = {}) {
    // Where the car is on the circuit, for the banked height and lean. The
    // renderer keeps its own hint so it needs nothing from main.js; searching
    // 90 samples once a FRAME is free next to doing it every physics substep.
    const proj = this.track.project(car.x, car.y, this.hint);
    this.hint = proj.i;
    if (this.ownLamps) this.ownLamps.update(this.nightOn(), car.brake || 0);
    this._spd = car.speed || 0;
    // Where the ground is under the car: the surveyed profile along the racing
    // line, plus whatever camber the corner has. The same two numbers the road
    // geometry was built from, so the car cannot float or sink.
    const surfaceY = this.world.trackYAt(proj.s) + bankY(this.bank, this.track, proj.i, proj.lat);

    // car.z is height above the LOCAL road surface, so surfaceY already being
    // the real surveyed height of that road means the two compose with nothing
    // to reconcile.
    this.carYaw.position.set(car.x, surfaceY + (car.z || 0), Z(car.y));
    this.carYaw.rotation.y = car.hdg;
    // STEERING. Each front wheel pivots at its OWN hub — see js/car.js for
    // what happened when they shared one group at the car's centre.
    //
    // The sign is +delta, not -delta. A positive delta steers LEFT, and a mesh
    // built along +X needs rotation.y = +delta to point its nose that way once
    // the sim->three reflection is accounted for. It had been negated since
    // day one, so the front wheels pointed the wrong way in every corner —
    // invisible from a chase camera, and the first thing you see from onboard.
    //
    // Ackermann: the inside wheel takes more angle than the outside one,
    // because they are tracing circles of different radius about the same
    // centre. It is a few degrees and it is very visible at full lock.
    const ACK = 0.13;
    const dl = car.delta * (car.delta > 0 ? 1 + ACK : 1 - ACK);
    const dr = car.delta * (car.delta > 0 ? 1 - ACK : 1 + ACK);
    this.steer.fl.rotation.y = dl;
    this.steer.fr.rotation.y = dr;
    // Wheel rotation is ACCUMULATED, not read back off the mesh, so it cannot
    // drift when a wheel is reparented or reset.
    this.spin -= car.speed * dt / this.wheelR;
    for (const k in this.wheels) this.wheels[k].rotation.z = this.spin;

    // Body roll and pitch, in the car's own frame now.
    //
    // Roll is driven by the CENTRIPETAL acceleration, `vx * r`, not by
    // `car.gLat`. gLat is `Fy/m - vx*r`, which is the rate of change of
    // lateral velocity — and in a steady corner that is approximately zero,
    // however hard the car is cornering. Rolling the body off it meant the car
    // never visibly leaned in a long corner at all.
    const latG = Math.max(-5, Math.min(5, (car.vx * car.r) / 9.81));
    // car.roll and car.pitch are the REAL attitude out of physics.js and are
    // exactly zero unless the car has left the ground — so adding them keeps
    // the cosmetic cornering lean while driving and hands the whole attitude
    // over to the simulation the moment it flies.
    //
    // The camber term is gated on being airborne. Unlike latG, which falls to
    // nothing on its own once the tyres are unloaded, bankRoll is a function
    // of where the car is on the TRACK — so a car flying over Zandvoort's
    // banking would keep leaning eighteen degrees at it for no reason.
    const grounded = car.airborne ? 0 : 1;
    // Airborne, car.roll/car.pitch are the TRUE attitude — a car on its roof is
    // at pi — so the exaggeration has to go away, and it has to go away
    // smoothly or the car snaps upright the instant it takes off.
    this.leanK += ((car.airborne ? 1 : this.soften) - this.leanK) * Math.min(1, dt * 6);
    // NO CORNERING LEAN (Adam, 2026-10-03: "the car doesnt lean in turns, only
    // my pov should and just a teeny"). On the ground the body takes only the
    // camber of the road; the spring roll goes to the driver's eye instead
    // (`this.headLean`, used by the bolted cameras below). Airborne, the true
    // attitude is handed back in full, as before.
    this.headLean = (car.roll || 0) * this.leanK * grounded;
    this.car.rotation.z = (car.pitch || 0) * this.leanK + slopePitch(this.world, this.track, proj, car) * grounded;
    // The wheels move in their arches. 60 mm of travel is a lot of visible
    // movement at this scale, and it is the cue that reads as "this is a
    // machine with springs" from the chase camera and from onboard.
    if (car.wheelZ && this.susp) {
      // Show the CHANGE from the car's resting deflection, not the absolute
      // compression — otherwise every wheel starts 12 mm into its arch.
      // The baseline is taken ON THE GROUND. It used to be the first drawn
      // frame, and with ?launch (or any load that starts mid-air) that frame
      // caught the car in flight — a 5.26 m "rest" — so after landing every
      // wheel was drawn metres from its hub, for good. And a wheel travels a
      // few centimetres, never metres: airborne heights are clamped to droop.
      if (!this.suspZ0 && !car.airborne) this.suspZ0 = car.wheelZ.slice();
      const z0 = this.suspZ0 || [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) {
        const h = this.susp[i];
        const d = Math.max(-0.09, Math.min(0.06, car.wheelZ[i] - z0[i]));
        if (h) h.position.y = this.suspY[i] - d * this.leanK;
      }
    }

    // Bodywork that is no longer attached should not be drawn. physics.js
    // already reads `car.lost` — losing the front wing costs 56% of front
    // downforce — so hiding it is honest rather than decorative.
    if (this.wingParts) {
      const lost = car.lost || {};
      for (const m of this.wingParts.front) m.visible = !lost.frontWing;
      for (const m of this.wingParts.rear) m.visible = !lost.rearWing;
    }
    // Bodywork damage, straight off the contact impulses in collide.js.
    applyCrush(this.crushParts, car.crush);
    // Cheap: returns immediately unless the dent set actually changed, which
    // only happens on contact.
    if (this.deformer) this.deformer.apply(this.presetDents || car.dents);
    // The DRS flap is a real flap: it opens when the wing is stalled, because
    // that is the only reason the car is faster on the straight.
    if (this.drs) this.drs.rotation.z = car.drsOpen ? -1.0 : 0;

    // Debris, sparks and lit tyre smoke for every car (js/fx.js); the old
    // point-sprite puffs below remain only for ?fx=0.
    if (this.fx) this.fx.update(car, dt, surfaceY);   // (also the cars' own env maps, even with ?fx=0)
    if (this.fx && this.fx.on) { this.smokePts.visible = false; } else {
    // smoke, fired by REAL slip past the tyre's peak, never by "a key is held"
    const over = hud.slipOver || 0;
    if (over > 0 && car.speed > 6) {
      const cs = Math.cos(car.hdg), sn = Math.sin(car.hdg);
      const vwx = car.vx * cs - car.vy * sn, vwy = car.vx * sn + car.vy * cs;
      for (const sd of [0.76, -0.76]) {
        // rear axle, then out to each rear tyre along the car's left vector
        const px = car.x - cs * 1.30 - sn * sd;
        const py = car.y - sn * 1.30 + cs * sd;
        if (Math.random() < Math.min(1, over * 2.2)) this.puff(px, Z(py), vwx, Z(vwy), Math.min(2, over * 3), surfaceY);
      }
    }
    const pa = this.smokePts.geometry.attributes.position;
    for (let i = 0; i < this.smokeMax; i++) {
      const p = this.smoke[i];
      if (p.life > 0) {
        p.life -= dt * 0.75;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.vy += 1.1 * dt; p.vx *= 1 - dt * 1.2; p.vz *= 1 - dt * 1.2;
        pa.setXYZ(i, p.x, p.life > 0 ? p.y : -999, p.z);
      } else pa.setXYZ(i, p.x, -999, p.z);
    }
    pa.needsUpdate = true;
    this.smokePts.material.opacity = 0.45;
    }

    // ---- camera -------------------------------------------------------------
    //
    // "ALL U GOT INTO MAKING THESE IRACING QUALITY (not textures and shaders)".
    //
    // Half of that is the air, which is js/horizon.js. The other half is this,
    // and it is the cheaper half: a sim looks like a sim because of where the
    // camera is and what it is bolted to, not because of what the surfaces are
    // made of. Four rigs, and the default is the one every real onboard is
    // shot from.
    //
    // ONBOARD is BOLTED TO THE CAR — above the airbox, looking down the nose.
    // It pitches when you brake and leans when you turn, because it is
    // attached to a thing that is pitching and leaning. That single fact does
    // more for how violent a braking zone feels than any amount of material
    // work, and it is why a chase camera can never feel like a car. The roll
    // is damped to 55% of the real thing, the way a broadcast onboard is
    // part-stabilised — full roll is accurate and makes people ill.
    //
    // TV is a real broadcast rig: fixed cameras standing beside the circuit,
    // handing the car off to each other as it comes past, ZOOMING to hold it
    // at a constant size in frame. The zoom is the tell — it is what makes
    // footage read as televised rather than as a game replay.
    //
    // SPEED (Adam, 2026-09-28: "make 350 kmh feel like 350 kmh not 40 mph").
    // Measured with tools/speedflow.mjs, not guessed — see js/speedfx.js for
    // the numbers. What changed here:
    //   - every rig SHAKES now, angularly, per mount (speedfx.js SpeedShake):
    //     the old centimetre of positional jitter moved the halo and left the
    //     world where it was;
    //   - the lens STILL widens with speed, because it was measured: I
    //     expected a wider lens to push the world away and read slower, and
    //     the numbers said the opposite: the edges of a wider frame see
    //     nearer ground, and at 350 the chase camera's edges stream at 87
    //     screen heights/s wide against 55 without the kick. On top of
    //     that it now also breathes with ACCELERATION (g, not v), briefly;
    //   - the chase camera no longer falls behind at top speed (a lerp toward
    //     a target running at 97 m/s lags by ~v/k: measured 11.7 m from the
    //     car at 350 against a 5.6 m setting; 4.9 m now), and sits lower and
    //     tighter so the road rushes under it;
    //   - T-CAM, the real one: on the stalk above the airbox, behind the
    //     driver's head, looking over the halo.
    // ?fovkick=0 takes the speed-widening lens away for an A/B.
    RIGS_NAMES = ['ONBOARD', 'CHASE', 'NOSE', 'TV', 'T-CAM'];
    if (typeof window !== 'undefined') window.__wdcRigs = RIGS_NAMES;
    const RIGS = [
      // ONBOARD is the DRIVER'S EYES (Adam, 2026-09-25: "first person is like on
      // top of my halo"). It sat at 1.19 m, T-cam height above the airbox. Then
      // "i need to sit higher bc thats how my rig is": his rig seats him
      // upright with the wheel in front of him, so the eye is at the halo's
      // height (car.js eye), not slumped under it.
      { name: 'ONBOARD', kind: 'bolted', at: this.carEye || [-0.34, 1.19, 0], aim: 24, drop: this.carEye ? 1.1 : 0.22, fov: 62, kick: 0.55, roll: 1.0, mount: 'onboard' },
      // Lower (1.66 -> 1.28 m) and tighter (5.6 -> 4.9 m): the ground in the
      // bottom of the frame is nearer, so it streams past faster.
      { name: 'CHASE', kind: 'chase', dist: 4.9, height: 1.28, lead: 15, aimY: 0.62, fov: 55, kick: 1, mount: 'chase' },
      { name: 'NOSE', kind: 'bolted', at: [1.62, 0.46, 0], aim: 26, fov: 62, kick: 0.8, roll: 1.0, mount: 'nose' },
      { name: 'TV', kind: 'tv', fov: 40, kick: 0 },
      // T-CAM. The broadcast onboard: the camera on the T-bar on top of the
      // airbox (car.js puts the pod at x -0.62, top 0.82 m), BEHIND the
      // driver's head, so it looks over the helmet and the halo loop at the
      // road. A longer lens than the eye (50 vs 62 deg) and the chassis's
      // full roll — it is a camera bolted to a car, not a person's head.
      { name: 'T-CAM', kind: 'bolted', at: [-0.62, 0.93, 0], aim: 24, drop: 1.0, fov: 50, kick: 0.3, roll: 1.0, mount: 'tcam' },
    ];
    if (this.photo) {
      const t = this.track;
      const a = t.point(this.photo.s, this.photo.lat);
      const b = t.point(this.photo.s + this.photo.lead, this.photo.aimLat);
      // Heights are ABOVE THE TRACK, not above sea level. Taken as absolute,
      // a 1.3 m camera at Monaco ends up twenty metres underground and you
      // photograph the underside of the city.
      const ay = this.world.trackYAt(this.photo.s);
      const by = this.world.trackYAt(this.photo.s + this.photo.lead);
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(a.x, ay + this.photo.y, Z(a.y));
      this.camera.lookAt(new THREE.Vector3(b.x, by + 0.9, Z(b.y)));
      if (this.camera.fov !== 55) { this.camera.fov = 55; this.camera.updateProjectionMatrix(); }
      this.rig.follow(a.x, Z(a.y));
      this._draw();
      return;
    }
    const rig = RIGS[this.mode];

    // Vibration. A car at speed is never still, and a perfectly steady frame
    // is the other reason 210 km/h used to read as 60 — there was nothing
    // shaking. High frequency and TINY: this is felt rather than seen, and the
    // moment you can see it, it is a gimmick.
    //
    // With speedfx on, the per-frame buzz is ANGULAR (SpeedShake, below) and
    // this positional term keeps only the hits — kerbs, grass, big lateral g —
    // at a third of its old size, because the angular kick now carries them.
    // Adam, 2026-10-03, on the rig: on gravel "my car is just teleporting top
    // to bottom ... scale shake like WAYYYYYYYY down ... only shake on grass and
    // crash". So: grass is the only surface that shakes (gravel, run-off and
    // kerbs do not), the g term starts at 7 g — an impact, not a fast corner,
    // which an F1 car pulls 5 g through — everything is about a tenth of what it
    // was, and the jitter is smoothed into a rumble instead of a new random
    // position every frame (that was the teleporting).
    const sfxOn = SFX.on && SFX.shake > 0;
    const buzz = sfxOn ? 0 : (0.0016 + car.speed * 0.00017) * (rig.kick || 0);
    const grassRough = (car.surface ?? 1) < 0.5 ? (hud.rough || 0) : 0;
    // A crash is a sudden loss of speed far past anything the brakes can do
    // (an F1 car brakes at ~6 g; a wall is tens of g). latG above is clamped
    // to 5 g, so it can never say "crash" on its own.
    // Only a LOSS of speed, only from real speed (over 30 km/h), and only over
    // a real frame: standing still, the speed wobbles by hair-widths and a
    // tiny dt turned that into a fake 50 g "crash" — the car had a seizure
    // parked on the track (Adam, 2026-10-03).
    const spdNow = Math.abs(car.speed || 0), spdWas = this._crSpd;
    const dvG = dt >= 0.008 && spdWas != null && spdWas > 8 ? Math.max(0, spdWas - spdNow) / dt / 9.81 : 0;
    this._crSpd = spdNow;
    const crash = dvG > 12 ? Math.min(0.06, 0.015 + (dvG - 12) * 0.0015) : 0;
    this.shake = Math.max(this.shake * (1 - dt * 6), grassRough * 0.05 + crash);
    const ja = Math.min(1, dt * 18), J = this._jit || (this._jit = { x: 0, y: 0, z: 0 });
    J.x += (Math.random() - 0.5 - J.x) * ja; J.y += (Math.random() - 0.5 - J.y) * ja; J.z += (Math.random() - 0.5 - J.z) * ja;
    const jx = J.x, jy = J.y, jz = J.z;
    const amp = this.shake * (sfxOn ? 0.35 : 1);   // no idle buzz: only grass and crashes move the camera
    if (!this.speedShake) this.speedShake = new SpeedShake();
    // Acceleration, smoothed, from the speed alone (a replay sets only that).
    // Measured over a 0.1 s WINDOW, not one frame, and zero below 11 km/h.
    // Per frame, a hair of speed wobble (parked, on a slope or a kerb) over a
    // short frame read as +-6 g flipping every frame, and the dive spring and
    // seat sink bounced the camera up and down — Adam, parked at the second
    // chicane: "the car is having a seizure ... photosensitive ppl".
    const spdA = car.speed || 0;
    if (this._accT == null || this._lastSpd == null) { this._accT = 0; this._lastSpd = spdA; }
    this._accT += Math.max(0, dt);
    let acc = this._accHeld || 0;
    if (this._accT >= 0.1) { acc = (spdA - this._lastSpd) / this._accT; this._lastSpd = spdA; this._accT = 0; }
    if (Math.abs(spdA) < 3) acc = 0;
    this._accHeld = acc;
    this._acc = (this._acc || 0) + (Math.max(-60, Math.min(60, acc)) - (this._acc || 0)) * Math.min(1, dt * 4);
    // Which kerb the wheels are on (surface.js KERB: 1 flat, 2 standard,
    // 3 high), and the extra load of a banked corner: |lateral g| times the
    // sine of the bank, which is how hard the banking presses you down.
    // kerbs no longer shake (Adam: only grass and crashes)
    const kType = 0;
    const bankA = Math.abs(bankRoll(this.bank, this.track, proj.i, 0) || 0);
    // Adam, 2026-10-03: "random shake when im on the track ... unplayable".
    // The camera moves ONLY on grass or in a crash. Everywhere else every
    // shake, buzz, dive and bob is zero.
    const shakeOn = grassRough > 0 || this.shake > 0.003;
    if (!this._skZero) this._skZero = { p: 0, y: 0, r: 0, h: 0, x: 0 };
    const sk = !shakeOn ? this._skZero : this.speedShake.step(dt, car.speed || 0, rig.mount, {
      rough: grassRough * 0.12, kerb: kType, gLong: this._acc / 9.81,
      gVert: Math.abs(latG) * Math.sin(bankA), gLat: latG });
    // FIXED LENS. Adam, 2026-09-29: "no fov resizing, this is for a simrig".
    // On a rig the screen is a window at a real distance from your eyes; a lens
    // that widens with speed or breathes with acceleration is a camera doing
    // something your eyes never do. Off by default; ?fovkick=1 brings back the
    // old speed-widening and breathing for comparison.
    if (this._fovKick === undefined) {
      const fq = new URLSearchParams(location.search).get('fovkick');
      this._fovKick = fq != null && fq !== '' && Number.isFinite(+fq) ? +fq : 0;
    }
    // ...and the new one breathes with ACCELERATION: a couple of degrees wider
    // while it is pulling hard, tighter under braking, back to rest at a
    // steady 350. A change of lens you feel as the car shoving you.
    const gKick = Math.max(-3, Math.min(3.5, this._acc * 0.28)) * (rig.kick || 0) * (sfxOn ? 1 : 0) * this._fovKick;

    let fov = rig.fov;
    const fp = rig.name === 'ONBOARD' && !!this.carEye;
    if (this.fpHide) for (const m of this.fpHide) m.visible = !fp;
    if (rig.kind === 'bolted') {
      // Read the camera's world placement off the car itself, so it inherits
      // yaw, pitch, roll and the banked height for free.
      this.camMount.position.set(rig.at[0], rig.at[1], rig.at[2]);
      this.camTarget.position.set(rig.at[0] + rig.aim, rig.at[1] - (rig.drop ?? 0.22), 0);
      this.car.updateWorldMatrix(true, false);
      this.camMount.getWorldPosition(this._v0);
      this.camTarget.getWorldPosition(this._v1);
      // Part-stabilised roll: blend the car's own up vector back toward the
      // world's. At 1.0 the horizon tips with the chassis and it is unpleasant;
      // at 0 it is a chase camera that happens to be close.
      this._v2.set(0, 1, 0).applyQuaternion(this.car.getWorldQuaternion(this._q))
        .lerp(this._up, 1 - (rig.roll ?? 0.6)).normalize();
      // The body no longer leans in a corner; the eye does, a TEENY bit —
      // 12% of what the chassis used to show, about 1 deg at full load.
      // Rotated about the car's own nose axis, so it is the same lean the
      // body had, only smaller. ?headlean=0 removes it, ?headlean=0.3 more.
      if (this._headK === undefined) { const hq = new URLSearchParams(location.search).get('headlean'); this._headK = hq != null && hq !== '' && Number.isFinite(+hq) ? +hq : 0.12; }
      if (this.headLean && this._headK) {
        this._v3 = this._v3 || new THREE.Vector3();
        this._v3.set(1, 0, 0).applyQuaternion(this._q);
        this._v2.applyAxisAngle(this._v3, this.headLean * this._headK);
      }
      this.camera.up.copy(this._v2);
      this.camera.position.copy(this._v0).addScaledVector(this._v2, 0);
      this.camera.position.x += jx * amp; this.camera.position.y += jy * amp; this.camera.position.z += jz * amp;
      this.camera.position.addScaledVector(this._v2, sk.h);
      this.camera.lookAt(this._v1);
      this.camera.rotateX(sk.p); this.camera.rotateY(sk.y); this.camera.rotateZ(sk.r);
      this.camera.translateX(sk.x || 0);   // the head pushed to the outside of a corner
      fov = rig.fov + Math.min(16, car.speed * 0.17) * rig.kick * this._fovKick + gKick;
    } else if (rig.kind === 'tv') {
      const cam = this._pickTvCamera(proj.s);
      if (cam) {
        this.camera.up.copy(this._up);
        this.camera.position.set(cam.x, cam.y, cam.z);
        // Above the ROAD, not above sea level: Monza rises 20 m, and an
        // absolute 0.6 aimed the broadcast camera into the ground there.
        this._v1.set(car.x, surfaceY + 0.6, Z(car.y));
        this.camera.lookAt(this._v1);
        // Hold the car at a constant size in frame. A broadcast camera zooms;
        // a game camera does not, and that is most of the difference.
        const dist = this.camera.position.distanceTo(this._v1);
        // Hold the car at roughly a quarter of the frame. The first attempt
        // aimed for a twelfth, which is technically a constant size and reads
        // as a security camera.
        fov = Math.max(7, Math.min(38, 2 * Math.atan(9 / Math.max(18, dist)) * 180 / Math.PI));
      }
    } else {
      // Chase. Aim between where the nose points and where the car is actually
      // GOING, so a slide reads on screen instead of the camera hiding it.
      const beta = Math.atan2(car.vy, Math.max(car.vx, 3));
      let want = car.hdg + beta * 0.5;
      let d = want - this.camH;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      this.camH += d * Math.min(1, dt * 7);
      const ch = Math.cos(this.camH), sh = Math.sin(this.camH);
      // NO LAG ALONG THE ROAD. This was camPos.lerp(target, dt*9) — and a
      // lerp chasing a target that moves at v settles v/9 behind it: at 350
      // km/h the camera sat ~9 m further back than at 50, so the car shrank
      // and the road under the lens got further away exactly as you went
      // faster. Now the camera is placed exactly behind the car along the
      // (smoothed) heading, and only a small spring on the car's
      // ACCELERATION moves it: pushed back a touch when it pulls, drawn in
      // when it brakes. Height is still smoothed so bumps do not jar it.
      const pull = Math.max(-0.7, Math.min(0.9, this._acc * 0.07));
      this._chaseG = (this._chaseG || 0) + (pull - (this._chaseG || 0)) * Math.min(1, dt * 5);
      const dd = rig.dist + this._chaseG;
      this._v0.set(car.x - ch * dd, surfaceY + rig.height, Z(car.y - sh * dd));
      if (!this._chaseInit || this.camPos.distanceToSquared(this._v0) > 400) { this.camPos.copy(this._v0); this._chaseInit = true; }
      this.camPos.x = this._v0.x; this.camPos.z = this._v0.z;
      this.camPos.y += (this._v0.y - this.camPos.y) * Math.min(1, dt * 9);
      this.camera.up.copy(this._up);
      this.camera.position.set(this.camPos.x + jx * amp, this.camPos.y + jy * amp + sk.h, this.camPos.z + jz * amp);
      this._v1.set(car.x + ch * rig.lead, surfaceY + (rig.aimY ?? 0.75), Z(car.y + sh * rig.lead));
      if (this.camAim.distanceToSquared(this._v1) > 400) this.camAim.copy(this._v1);
      // The aim point already rides the smoothed heading, so it needs no lag
      // of its own along the road; only its height is eased.
      this.camAim.set(this._v1.x, this.camAim.y + (this._v1.y - this.camAim.y) * Math.min(1, dt * 10), this._v1.z);
      this.camera.lookAt(this.camAim);
      this.camera.rotateX(sk.p); this.camera.rotateY(sk.y); this.camera.rotateZ(sk.r);
      fov = rig.fov + Math.min(20, car.speed * 0.22) * rig.kick * this._fovKick + gKick;
    }
    if (this.fx && this.fx.orbit) fov = this.fx.orbit(this.camera, this.car, fov);   // ?fxcam=
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // The sun's DIRECTION never changes — it is wherever it is in the sky
    // photograph. Only the origin follows the car, so the 110 m shadow box
    // always contains it.
    this.rig.follow(car.x, Z(car.y));

    this._draw();

    // Motion blur at the edges (speedfx.js SpeedBlur), after the frame is on
    // the canvas. Fades in from 110 to 260 km/h; never on the broadcast rig,
    // whose long lens pans rather than travels. ?blur=0 / ?speedfx=0.
    if (SFX.on && SFX.blur > 0 && rig.kind !== 'tv' && car.speed > 30) {
      if (!this.speedBlur) { this.speedBlur = new SpeedBlur(this.renderer); this._sfxVel = new THREE.Vector3(); }
      const kmh = car.speed * 3.6;
      const amt = Math.min(1, Math.max(0, (kmh - 110) / 150));
      const bt = Math.atan2(car.vy || 0, Math.max(Math.abs(car.vx || 0), 1));
      const dir = car.hdg + bt;
      this._sfxVel.set(Math.cos(dir) * car.speed, 0, Z(Math.sin(dir) * car.speed));
      let hole = null;
      if (this.mirrorOn) {
        const r = this.renderer, pr = r.getPixelRatio();
        const size = r.getSize(this._mirSize || (this._mirSize = new THREE.Vector2()));
        const w = Math.round(Math.min(size.x * 0.34, 560)), h = Math.round(w / 4.2);
        const x = Math.round((size.x - w) / 2), y = Math.round(size.y - h - 10);
        hole = [(x - 4) * pr, (y - 4) * pr, (x + w + 4) * pr, (y + h + 4) * pr];
      }
      this.speedBlur.render(this.scene, this.camera, this.car, this._sfxVel,
        this.camera.position.y - surfaceY, hole, amt,
        this.post && this.post.on && this.post.sceneRT ? this.post.sceneRT.depthTexture : null);
    }

    // Publish the real cost of a frame once, after there is one to measure.
    // Guessing at triangle counts from source is how a scene quietly ends up
    // three times heavier than anybody intended.
    if (this._published && typeof window !== 'undefined') {
      this._published = false;
      const info = this.renderer.info.render;
      window.__wdc.draws = info.calls;
      window.__wdc.tris = info.triangles;
    }
  }
}
