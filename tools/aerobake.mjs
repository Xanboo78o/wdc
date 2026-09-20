// aerobake.mjs — solve the aerodynamics of a shape, once, offline.
//
//   node tools/aerobake.mjs [f1|f4] [--mesh path.stl|path.obj] [--dump hull.obj]
//
// Writes data/aero/<car>.json: a MAP of coefficients against pitch, yaw and
// ride height, plus a variant for every piece of bodywork that can be torn off.
// The runtime (js/aero.js) interpolates that map. Nothing solves at 400 Hz.
//
// WHY A MAP AND NOT CONSTANTS. `ClA: 4.62` is one number for every situation a
// car can be in. It cannot know that downforce collapses when the floor is
// lifted, that a car at 20 degrees of yaw has lost most of its front grip and
// gained a pile of drag, or that a missing front wing changes the BALANCE and
// not just the total. Those are the things that decide whether a corner is
// catchable, and all of them are geometry.
//
// WHAT THIS IS NOT. It is not CFD. A panel method cannot produce a modern F1
// car's downforce from first principles — most of that comes from circulation
// around cambered wings and a venturi under the floor, neither of which is
// impact pressure. So the geometry decides how the aero CHANGES and the
// validated wind-tunnel-equivalent numbers decide how big it is. See CALIBRATE.
import fs from 'fs';
import path from 'path';
import { readSTL, readOBJ, writeOBJ, panels, bounds, frontalArea, dot, norm } from './aerolib.mjs';
import { CARS } from '../js/physics.js';

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const key = args.find(a => !a.startsWith('--') && CARS[a]) || 'f1';
const spec = CARS[key] || CARS.f1;

// ---------------------------------------------------------------------------
// THE HULL.
//
// Built from the car's REAL published dimensions — the same ones already in
// physics.js as bodyL/bodyW and in DESIGN.md. This is physics geometry, in the
// same category as the 5.63 m that already decides where the bodywork hits a
// barrier; it is not artwork and nothing draws it.
//
// Every surface that makes downforce is built at its real INCIDENCE, because a
// flat plate at zero incidence generates nothing in a panel method and a wing
// at eighteen degrees generates a lot. Getting the wings tilted is what makes
// the solver produce downforce at all rather than needing it bolted on.
// ---------------------------------------------------------------------------
const quad = (a, b, c, d) => [[a, b, c], [a, c, d]];

// A closed box from centre, half-extents, with an optional pitch about +y.
function box(cx, cy, cz, hx, hy, hz, inc = 0) {
  const ci = Math.cos(inc), si = Math.sin(inc);
  const P = [];
  for (const sz of [-1, 1]) for (const sy of [-1, 1]) for (const sx of [-1, 1]) {
    const x = sx * hx, z = sz * hz;
    P.push([cx + x * ci - z * si, cy + sy * hy, cz + x * si + z * ci]);
  }
  // index: bit0=x, bit1=y, bit2=z
  const V = i => P[i];
  return [].concat(
    quad(V(0), V(2), V(3), V(1)),   // bottom
    quad(V(4), V(5), V(7), V(6)),   // top
    quad(V(0), V(1), V(5), V(4)),   // -y side
    quad(V(2), V(6), V(7), V(3)),   // +y side
    quad(V(0), V(4), V(6), V(2)),   // -x end
    quad(V(1), V(3), V(7), V(5)),   // +x end
  );
}

// Loft a rectangular cross-section along x. Stations are {x, hy, z0, z1}.
function loftBody(st) {
  const tris = [];
  const ring = s => [[s.x, -s.hy, s.z0], [s.x, s.hy, s.z0], [s.x, s.hy, s.z1], [s.x, -s.hy, s.z1]];
  for (let i = 0; i + 1 < st.length; i++) {
    const a = ring(st[i]), b = ring(st[i + 1]);
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      tris.push(...quad(a[k], b[k], b[k2], a[k2]));
    }
  }
  const cap = (s, flip) => {
    const r = ring(s);
    return flip ? quad(r[0], r[1], r[2], r[3]) : quad(r[3], r[2], r[1], r[0]);
  };
  tris.push(...cap(st[0], false), ...cap(st[st.length - 1], true));
  return tris;
}

// A wheel as a prism — a cylinder about the y axis, which is what a wheel is
// aerodynamically: a bluff rotating drum that costs a lot of drag. Open-wheel
// cars spend roughly 40% of their drag on these, so leaving them out would
// make the whole solve wrong.
function wheel(cx, cy, cz, r, halfW, seg = 12) {
  const tris = [], ring = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg, p = ring[i], q = ring[j];
    tris.push(...quad([p[0], cy - halfW, p[1]], [q[0], cy - halfW, q[1]],
                      [q[0], cy + halfW, q[1]], [p[0], cy + halfW, p[1]]));
    tris.push([[cx, cy + halfW, cz], [p[0], cy + halfW, p[1]], [q[0], cy + halfW, q[1]]]);
    tris.push([[cx, cy - halfW, cz], [q[0], cy - halfW, q[1]], [p[0], cy - halfW, p[1]]]);
  }
  return tris;
}

// Body frame: +x forward, +y left, +z up, z=0 at the road. Matches physics.js.
// A CLOSED CAR. Same job as buildHull, different shape: a splitter instead of
// a front wing, a roof, wheels inside arches (so they are part of the body and
// not four bluff bodies in clean air), a flat floor with a small diffuser, and
// a swan-neck wing on the deck. Its group NAMES match the open-wheeler's, so
// damage ("lost the front wing") and js/aero.js need no special case.
function buildHullGT(S) {
  const L = S.bodyL, W = S.bodyW;
  const nose = L * 0.5, tail = -L * 0.5;
  const G = {};
  const add = (g, t) => { (G[g] = G[g] || []).push(...t); };

  // Splitter: a flat plate under the nose, barely inclined. On a GT car this
  // is the front downforce, and it is why kerbs eat them.
  add('frontWing', box(nose - 0.18, 0, 0.055, 0.30, W * 0.47, 0.014, -0.06));
  add('frontWing', box(nose - 0.30, W * 0.44, 0.13, 0.26, 0.02, 0.07));    // dive plane L
  add('frontWing', box(nose - 0.30, -W * 0.44, 0.13, 0.26, 0.02, 0.07));   // dive plane R

  // The body: nose, arches, screen, roof, tail. Sections are real proportions
  // for a 4.60 x 2.05 m GT3 with a 1.28 m roof.
  add('body', loftBody([
    { x: nose - 0.08, hy: 0.52, z0: 0.13, z1: 0.56 },
    { x: nose - 0.85, hy: W * 0.50, z0: 0.11, z1: 0.82 },   // front arches
    { x: nose - 1.65, hy: W * 0.46, z0: 0.11, z1: 1.06 },   // screen base
    { x: nose - 2.45, hy: W * 0.41, z0: 0.13, z1: 1.28 },   // roof
    { x: nose - 3.25, hy: W * 0.44, z0: 0.13, z1: 1.22 },
    { x: nose - 4.00, hy: W * 0.50, z0: 0.13, z1: 0.98 },   // rear arches
    { x: tail + 0.12, hy: W * 0.46, z0: 0.17, z1: 0.90 },
  ]));

  // Flat floor and a small diffuser — a GT3 has both, and neither is an F1
  // car's floor. ClFloor on the spec is what keeps it on the ground spun
  // backwards, and it is a third of the single-seater's for the same reason.
  add('floor', box(-0.15, 0, 0.055, 1.70, W * 0.42, 0.012));
  add('floor', box(tail + 0.55, 0, 0.17, 0.55, W * 0.38, 0.012, 0.26));

  // The wing: wide, high, on swan necks above the deck.
  add('rearWing', box(tail + 0.16, 0, 1.24, 0.24, W * 0.46, 0.020, -0.38));
  add('rearWing', box(tail + 0.16, W * 0.46, 1.16, 0.22, 0.02, 0.16));
  add('rearWing', box(tail + 0.16, -W * 0.46, 1.16, 0.22, 0.02, 0.16));
  add('rearWing', box(tail + 0.30, 0, 1.05, 0.03, 0.30, 0.16));

  // Wheels sit inside the arches: they are not in clean air, so they go in as
  // part of the body's frontal area rather than as four exposed cylinders.
  return G;
}

function buildHull(S) {
  if (S.shape === 'gt') return buildHullGT(S);
  const L = S.bodyL, W = S.bodyW;
  const nose = L * 0.5, tail = -L * 0.5;
  const G = { };
  const add = (g, t) => { (G[g] = G[g] || []).push(...t); };

  // Front wing: a wide, low, strongly inclined plane. ~18 deg is a real
  // high-downforce setting, and the incidence is why it makes anything at all.
  add('frontWing', box(nose - 0.26, 0, 0.11, 0.26, W * 0.50, 0.020, -0.31));
  add('frontWing', box(nose - 0.30, W * 0.46, 0.20, 0.22, 0.02, 0.13));   // endplate L
  add('frontWing', box(nose - 0.30, -W * 0.46, 0.20, 0.22, 0.02, 0.13));  // endplate R

  // Nose, tub, sidepods, engine cover — one lofted body, real proportions.
  // NOTE the z0 values: the bodywork sits ON the floor, it is not the floor.
  // With its underside down at 0.07 the loft was inside the ground-effect
  // band and took 23.5% of the downforce that belongs to the floor group —
  // which then made "lose the floor" and "lose the body" both wrong.
  add('body', loftBody([
    { x: nose - 0.45, hy: 0.10, z0: 0.26, z1: 0.38 },
    { x: nose - 1.10, hy: 0.22, z0: 0.22, z1: 0.54 },
    { x: nose - 1.90, hy: 0.45, z0: 0.19, z1: 0.68 },   // cockpit
    { x: nose - 2.55, hy: 0.72, z0: 0.17, z1: 0.80 },   // sidepod mouth + airbox
    { x: nose - 3.45, hy: 0.70, z0: 0.17, z1: 0.72 },
    { x: nose - 4.40, hy: 0.42, z0: 0.18, z1: 0.52 },   // coke bottle
    { x: tail + 0.30, hy: 0.26, z0: 0.22, z1: 0.40 },
  ]));

  // The floor. Flat, and the single biggest downforce device on a modern car —
  // but only because of the ground-effect term in solve(), which is where its
  // suction actually comes from. As a bare panel it does almost nothing.
  add('floor', box(nose - 2.9, 0, 0.055, 1.55, W * 0.40, 0.012));
  // Diffuser: the floor kicking up at the back. Its rake is what makes a car
  // travelling backwards take off, which physics.js models separately.
  add('floor', box(tail + 0.62, 0, 0.16, 0.62, W * 0.34, 0.012, 0.22));

  // Rear wing: narrower than the front, higher, and steeper.
  add('rearWing', box(tail + 0.36, 0, 0.88, 0.30, 0.52, 0.018, -0.52));
  add('rearWing', box(tail + 0.36, 0.52, 0.80, 0.20, 0.02, 0.17));
  add('rearWing', box(tail + 0.36, -0.52, 0.80, 0.20, 0.02, 0.17));
  add('rearWing', box(tail + 0.50, 0, 0.55, 0.03, 0.06, 0.28));    // swan neck

  // Wheels. Real F1 rubber: 0.72 m tall, 305 front / 405 rear.
  const rw = 0.36;
  add('wheels', wheel(S.a, S.trackF / 2, rw, rw, 0.1525));
  add('wheels', wheel(S.a, -S.trackF / 2, rw, rw, 0.1525));
  add('wheels', wheel(-S.b, S.trackR / 2, rw, rw, 0.2025));
  add('wheels', wheel(-S.b, -S.trackR / 2, rw, rw, 0.2025));
  return G;
}

// ---------------------------------------------------------------------------
// THE SOLVE.
// ---------------------------------------------------------------------------
const CP_STAG = 1.0;        // stagnation pressure on a panel square to the flow
const CP_BASE = -0.15;      // mild suction on anything facing away
const GE_GAIN = 2.6;        // how hard the floor sucks when it is sealed
const GE_H0 = 0.075;        // ride height at which that suction has half gone
const GE_YAW = 3.5;         // how fast that seal breaks as the car goes sideways
// A flat-plate panel method badly UNDERSTATES a cambered wing: most of a
// wing's load is circulation, which is not impact pressure and does not appear
// in cos^2(theta) at all. Left uncorrected the solve said losing the rear wing
// costs 1% of downforce, when the real answer is about a quarter. This
// multiplier is tuned so the front/floor/rear split lands on the published F1
// balance of roughly 25/50/25 — see the group table aerobake prints.
const WING_CIRC = 9.5;
// A car at yaw presents its FLANK, and most of what that costs is separated
// flow off the sidepods and the exposed wheels — none of which is impact
// pressure, so the panel integral cannot see it. Left to the panel solve alone
// drag FELL as the car went sideways (1.28 -> 1.20 at 30 deg) because the
// suction terms died faster than form drag grew, which is backwards: a car
// sideways is a brick. Scaled by sin^2(yaw), so it is exactly zero at the
// reference attitude and cannot disturb the calibration.
const YAW_DRAG = 0.72;

// Forces and moments on a set of panels for one freestream direction and one
// ride height. `v` is the direction the AIR travels relative to the car.
function solve(P, v, rideH, byGroup = null) {
  let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0;
  // How much the flow is still running down the length of the car. At yaw the
  // floor's edge seal spills sideways and the underbody stops working — which
  // is most of why a car that steps out mid-corner keeps going.
  const along = Math.max(0, -v[0]);
  for (const p of P) {
    const cosT = -dot(p.n, v);
    let Cp = cosT > 0 ? CP_STAG * cosT * cosT : CP_BASE;
    // GROUND EFFECT. A downward-facing surface close to the road accelerates
    // the air through the gap and the pressure there collapses. This one term
    // is where a modern car's downforce lives, and it is why the number
    // depends so violently on ride height — which a constant ClA cannot say.
    if (p.n[2] < -0.25) {
      const h = Math.max(0.004, rideH + p.c[2] - 0.055);
      const seal = 1 / (1 + h / GE_H0) ** 2;
      Cp -= GE_GAIN * seal * Math.pow(along, GE_YAW) * p.n[2] * p.n[2];
    }
    // A WING IS NOT A FLAT PLATE. Circulation around a cambered section is
    // most of its load and none of it is impact pressure. Applied only to the
    // wing groups, only on the suction side, and it falls away with sideslip
    // the way a real wing does.
    // An F1 wing is INVERTED, so its suction side is the UNDERSIDE. Applying
    // the circulation to the upward-facing panels instead made both wings
    // generate LIFT — the group table read frontWing -9.9%, and removing a
    // wing then INCREASED downforce, which is how the sign error announced
    // itself rather than hiding in a plausible-looking number.
    if ((p.g === 'frontWing' || p.g === 'rearWing') && p.n[2] < -0.15) {
      Cp -= WING_CIRC * -p.n[2] * Math.abs(p.n[0]) * along * along;
    }
    const f = -Cp * p.A;                       // pressure acts along -n
    Fx += f * p.n[0]; Fy += f * p.n[1]; Fz += f * p.n[2];
    // moments about the car's origin, for the centre of pressure
    My += f * (p.n[2] * p.c[0] - p.n[0] * p.c[2]);
    Mx += f * (p.n[1] * p.c[2] - p.n[2] * p.c[1]);
    if (byGroup) byGroup[p.g] = (byGroup[p.g] || 0) - f * p.n[2];   // downforce per group
  }
  return { Fx, Fy, Fz, Mx, My, drag: Fx * v[0] + Fy * v[1] + Fz * v[2], lift: Fz };
}

const dirFor = (pitchDeg, yawDeg) => {
  const p = pitchDeg * Math.PI / 180, y = yawDeg * Math.PI / 180;
  // air travelling toward -x, tilted by the car's attitude
  return norm([-Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)]);
};

// ---------------------------------------------------------------------------
// BAKE
// ---------------------------------------------------------------------------
const PITCH = [-4, -2, 0, 2, 4, 7, 10];
const YAW = [0, 5, 10, 20, 30];
const RIDE = [0.015, 0.030, 0.050, 0.090, 0.160, 0.300];

let groups;
const meshArg = flag('mesh');
if (meshArg) {
  const buf = fs.readFileSync(meshArg);
  const tris = meshArg.toLowerCase().endsWith('.obj') ? readOBJ(buf.toString('utf8')) : readSTL(buf);
  if (!tris.length) { console.error(`no triangles read from ${meshArg}`); process.exit(1); }
  // A downloaded model arrives in whatever units and orientation its author
  // used. Normalise it onto the car's real length and put it on the road.
  const b = bounds(tris);
  const axis = b.size.indexOf(Math.max(...b.size));       // longest axis is the car's length
  const k = spec.bodyL / b.size[axis];
  const mid = [0, 1, 2].map(i => (b.lo[i] + b.hi[i]) / 2);
  const remap = p => {
    const q = [0, 1, 2].map(i => (p[i] - mid[i]) * k);
    // longest axis -> x, shortest -> z (a car is longer than it is wide than tall)
    const order = [0, 1, 2].sort((i, j) => b.size[j] - b.size[i]);
    return [q[order[0]], q[order[1]], q[order[2]]];
  };
  const moved = tris.map(t => t.map(remap));
  const mb = bounds(moved);
  groups = { body: moved.map(t => t.map(p => [p[0], p[1], p[2] - mb.lo[2]])) };
  console.log(`mesh ${path.basename(meshArg)}: ${tris.length} triangles, scaled x${k.toFixed(4)} to ${spec.bodyL} m`);
} else {
  groups = buildHull(spec);
}

const all = [].concat(...Object.values(groups));
console.log(`${spec.full} hull: ${all.length} triangles in ${Object.keys(groups).length} groups`);
for (const [g, t] of Object.entries(groups)) console.log(`   ${g.padEnd(11)} ${String(t.length).padStart(5)} tris`);

if (flag('dump')) { fs.writeFileSync(flag('dump'), writeOBJ(all)); console.log(`wrote ${flag('dump')}`); }

// Variants: the whole car, and the car with each losable piece gone. Losing a
// front wing is then a DIFFERENT SOLVE rather than a fudge factor — the panels
// are simply not there, and both the total and the balance move on their own.
const VARIANTS = {
  full: Object.keys(groups),
  noFrontWing: Object.keys(groups).filter(g => g !== 'frontWing'),
  noRearWing: Object.keys(groups).filter(g => g !== 'rearWing'),
};

const REF = { pitch: 0, yaw: 0, ride: 0.030 };
const Pfull = [].concat(...Object.entries(groups).map(([g, t]) => panels(t, g)));
const refSolve = solve(Pfull, dirFor(REF.pitch, REF.yaw), REF.ride);
const area = frontalArea(Pfull, [1, 0, 0]);

// CALIBRATE. Scale the raw solve so the reference attitude reproduces the
// numbers DIRTY AIR validated against real F1 data. Everything else in the map
// is then a RATIO to that point, which is the part geometry is actually good
// at. Skipping this would hand the car a third of its real downforce and throw
// away every validated lap time and the whole difficulty ladder with it.
const calCl = spec.ClA / -refSolve.lift;
const calCd = spec.CdA / refSolve.drag;
// Balance is calibrated the same way the magnitudes are. The hull's raw centre
// of pressure sits wherever its boxes happen to put it; aeroBal is a measured
// property of a real car. Offset the CoP so the reference attitude reproduces
// it, and everything else in the map is then a real geometric SHIFT from a
// correct starting point.
const refBal = 0.5 + (refSolve.My / refSolve.lift) / (spec.a + spec.b);
const copOff = (spec.aeroBal - 0.5) * (spec.a + spec.b) - (refSolve.My / refSolve.lift);
const sideArea = frontalArea(Pfull, [0, 1, 0]);
console.log(`\nfrontal area ${area.toFixed(3)} m^2   raw ClA ${(-refSolve.lift).toFixed(3)}  raw CdA ${refSolve.drag.toFixed(3)}`);
console.log(`calibration  x${calCl.toFixed(4)} lift   x${calCd.toFixed(4)} drag   -> ClA ${spec.ClA}  CdA ${spec.CdA}`);
console.log(`side area ${sideArea.toFixed(3)} m^2   raw balance ${(refBal * 100).toFixed(1)}% front -> calibrated to ${(spec.aeroBal * 100).toFixed(1)}% (CoP offset ${copOff.toFixed(3)} m)`);

const map = {};
for (const [vname, gnames] of Object.entries(VARIANTS)) {
  const P = [].concat(...gnames.map(g => panels(groups[g] || [], g)));
  const cl = [], cd = [], cop = [], cy = [];
  for (const pi of PITCH) for (const yi of YAW) for (const ri of RIDE) {
    const r = solve(P, dirFor(pi, yi), ri);
    cl.push(+(-r.lift * calCl).toFixed(4));
    const s2 = Math.sin(yi * Math.PI / 180) ** 2;
    cd.push(+(r.drag * calCd + YAW_DRAG * s2 * sideArea).toFixed(4));
    // Centre of pressure along x, in metres from the origin. This is the
    // AERO BALANCE, and it moving is the thing a driver actually feels.
    cop.push(+((Math.abs(r.lift) > 1e-6 ? (r.My / r.lift) : 0) + copOff).toFixed(4));
    cy.push(+(r.Fy * calCd).toFixed(4));
  }
  map[vname] = { cl, cd, cop, cy };
}

const out = {
  car: spec.key, generated: new Date().toISOString().slice(0, 10),
  source: meshArg ? path.basename(meshArg) : 'parametric hull from published dimensions',
  tris: all.length, frontalArea: +area.toFixed(4),
  calCl: +calCl.toFixed(6), calCd: +calCd.toFixed(6),
  ref: REF, pitch: PITCH, yaw: YAW, ride: RIDE,
  sideArea: +sideArea.toFixed(4), copOff: +copOff.toFixed(5), aeroBal: spec.aeroBal,
  note: 'panel method + ground effect, calibrated at ref to the validated ClA/CdA. ' +
        'Geometry sets how the numbers CHANGE; measurement sets how big they are.',
  map,
};
const dest = `data/aero/${spec.key}.json`;
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`\nwrote ${dest}  (${(fs.statSync(dest).size / 1024).toFixed(1)} KB)`);

// A readable sanity table, because a JSON blob proves nothing.
const at = (v, p, y, r) => map[v].cl[(PITCH.indexOf(p) * YAW.length + YAW.indexOf(y)) * RIDE.length + RIDE.indexOf(r)];
const atd = (v, p, y, r) => map[v].cd[(PITCH.indexOf(p) * YAW.length + YAW.indexOf(y)) * RIDE.length + RIDE.indexOf(r)];
// WHERE THE DOWNFORCE COMES FROM. Published F1 balance is roughly 25% front
// wing, 50% floor, 25% rear wing; if this table is far off that, the variants
// below will lie about what losing a wing costs.
const share = {};
solve(Pfull, dirFor(REF.pitch, REF.yaw), REF.ride, share);
const tot = Object.values(share).reduce((a, b) => a + b, 0);
console.log('\nwhere the downforce comes from (should be ~25 front / ~50 floor / ~25 rear):');
for (const [g, v] of Object.entries(share).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${g.padEnd(11)} ${(v / tot * 100).toFixed(1).padStart(6)} %`);
}

console.log('\nClA by ride height (pitch 0, yaw 0) — the floor sealing and unsealing:');
for (const r of RIDE) console.log(`   ${(r * 1000).toFixed(0).padStart(4)} mm   ClA ${at('full', 0, 0, r).toFixed(2)}   CdA ${atd('full', 0, 0, r).toFixed(2)}`);
console.log('\nClA by yaw (pitch 0, ride 30 mm) — a car sideways is not a car:');
for (const y of YAW) console.log(`   ${String(y).padStart(3)} deg   ClA ${at('full', 0, y, 0.030).toFixed(2)}   CdA ${atd('full', 0, y, 0.030).toFixed(2)}`);
console.log('\nbodywork lost (pitch 0, yaw 0, ride 30 mm):');
for (const v of Object.keys(VARIANTS)) {
  const i = (PITCH.indexOf(0) * YAW.length + 0) * RIDE.length + RIDE.indexOf(0.030);
  console.log(`   ${v.padEnd(12)} ClA ${map[v].cl[i].toFixed(2)}  CdA ${map[v].cd[i].toFixed(2)}  CoP ${map[v].cop[i].toFixed(3)} m`);
}
