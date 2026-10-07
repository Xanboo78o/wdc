// xcar.js — the cars that are Xingus mode's own, and what they wear.
//
// Adam, 2026-10-06, driving the mode on the GT car's body: "a non proper rally
// car, or a messed up pov, i want real insdie car pov". Then, of the name I
// gave the first one: "not braewickkkk no i want a subaru wrx", and "make 3
// more rally cars and rlly rlly cool liveries so my opps have variations".
//
// So: FIVE BODIES from one kit, and EIGHT LIVERIES.
//   wrx     HIS car: the compact four-door saloon, scoop on the bonnet, lamp
//           pod, wing on stays. Blue and gold, as he asked for it by name.
//           (A real marque's NAME is his call for his own game; no badge or
//           logo is drawn here, and it would have to go before this is sold.)
//   hatch   a modern five-door hot hatch: short, tall tail, roof spoiler
//   wedge   a 1970s mid-engined wedge: low, short, wide, a ducktail
//   boxy    an old square saloon: long bonnet, upright glass, round lamps
//   gt      the low wide coupe for the GT styles, wing on stays
//
// WHY THEY ARE BUILT THIS WAY. The GT3 body in js/car.js is a sealed shell
// with dark glass and nothing inside, so its "onboard" was a camera on the
// roof. Every car here is built to be SAT IN: the glasshouse is a frame —
// pillars, roof, a roll cage — with see-through panes, and there is a
// dashboard, two seats and a bonnet in front of you. `eye` is the driver's
// own eyes, on the left; `cabin: true` tells the renderer to put ONBOARD there.
//
// Axes as car.js: +x forward, +y up, +z the car's RIGHT. Same bundle out as
// buildGT3, so the renderer and the field treat these as any other car.
// tools/svgshot.mjs draws any of them in Node (`showXCar` takes the body and
// livery from XCAR_BODY / XCAR_LIVERY in the environment), which is how they
// were looked at while Adam was driving and no browser could be opened.
import * as THREE from 'three';

// ---- the kit ------------------------------------------------------------------
function bar(p, q, tw, th = tw) {              // a box between two points
  const d = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), L = d.length();
  const g = new THREE.BoxGeometry(L, th, tw);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize())));
  g.translate((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
  return g;
}
function slab(profile, half, z0 = 0) {         // a side profile pushed out to z0 +- half
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y))), { depth: half * 2, bevelEnabled: false });
  g.translate(0, 0, z0 - half);
  return g;
}
function pane(a, b, c, d) {                    // a flat four-cornered sheet
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
  g.computeVertexNormals();
  return g;
}
const box = (sx, sy, sz, x, y, z) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g; };

// ---- the bodies -----------------------------------------------------------------
// nose/tail: x of the two ends. half: half width. axF/axR: the axles. R: tyre radius.
// The profile heights: bumper top, bonnet front, scuttle (bonnet rear), boot deck.
// Glass corners [x, y]: sb screen base, st screen top, rr roof rear, rb rear-glass base.
export const BODIES = {
  wrx:   { name: 'Subaru WRX', nose: 2.20, tail: -2.20, half: 0.90, axF: 1.28, axR: -1.28, R: 0.33, sill: 0.19,
           bump: 0.62, hood: 0.80, scut: 0.93, deck: 0.97, deckX: -1.42,
           sb: [0.88, 0.94], st: [0.26, 1.40], rr: [-0.92, 1.42], rb: [-1.44, 0.98], zb: 0.74, zt: 0.66,
           scoop: 1, pod: 1, wing: 'stays', flaps: 1, eye: [-0.02, 1.17, -0.36] },
  hatch: { name: 'Hot hatch', nose: 2.00, tail: -1.98, half: 0.88, axF: 1.22, axR: -1.30, R: 0.33, sill: 0.19,
           bump: 0.64, hood: 0.84, scut: 0.97, deck: 1.00, deckX: -1.86,
           sb: [0.90, 0.98], st: [0.36, 1.46], rr: [-1.42, 1.44], rb: [-1.86, 1.02], zb: 0.74, zt: 0.64,
           scoop: 0, pod: 0, wing: 'roof', flaps: 1, eye: [0.02, 1.21, -0.35] },
  wedge: { name: 'Wedge', nose: 1.92, tail: -1.86, half: 0.92, axF: 1.14, axR: -1.08, R: 0.32, sill: 0.16,
           bump: 0.42, hood: 0.54, scut: 0.80, deck: 0.92, deckX: -1.10,
           sb: [0.72, 0.81], st: [0.04, 1.18], rr: [-0.52, 1.19], rb: [-1.08, 0.93], zb: 0.72, zt: 0.58,
           scoop: 0, pod: 1, wing: 'duck', flaps: 1, eye: [-0.18, 1.0, -0.33] },
  boxy:  { name: 'Square saloon', nose: 2.12, tail: -2.10, half: 0.84, axF: 1.26, axR: -1.22, R: 0.31, sill: 0.20,
           bump: 0.66, hood: 0.86, scut: 0.92, deck: 0.95, deckX: -1.30,
           sb: [0.70, 0.93], st: [0.36, 1.39], rr: [-0.80, 1.40], rb: [-1.12, 0.96], zb: 0.72, zt: 0.66,
           scoop: 0, pod: 1, wing: 'lip', flaps: 1, eye: [-0.10, 1.15, -0.34], round: 1 },
  gt:    { name: 'GT coupe', nose: 2.30, tail: -2.28, half: 1.00, axF: 1.46, axR: -1.42, R: 0.34, sill: 0.11,
           bump: 0.46, hood: 0.60, scut: 0.80, deck: 0.92, deckX: -1.30,
           sb: [0.86, 0.81], st: [0.16, 1.20], rr: [-0.72, 1.21], rb: [-1.34, 0.93], zb: 0.80, zt: 0.64,
           scoop: 0, pod: 0, wing: 'stays', flaps: 0, splitter: 1, eye: [-0.10, 1.0, -0.37] },
};

// ---- the liveries -----------------------------------------------------------------
// base / second / third: the body colours. roof, wheels, flaps: what it says.
// art: the graphics, each a few flat pieces laid just proud of the bodywork:
//   'sweep'   a band rising along each side, front low to rear high
//   'twin'    two stripes nose to tail over the bonnet, roof and boot
//   'triple'  three thin stripes along the waist
//   'claws'   three slashes down each door
//   'hazard'  diagonal warning bars round the tail, and a black bonnet
//   'split'   the rear half of the car in the second colour
//   'pumpkin' a jack-o'-lantern's face cut into the bonnet
export const LIVERIES = [
  { name: 'Blue and gold', base: 0x1d4fb5, second: 0xf2c417, roof: 0x1d4fb5, wheels: 0xc8a02c, flaps: 0x1d4fb5, art: ['sweep'], num: 78 },
  { name: 'Jack-o-lantern', base: 0x16110f, second: 0xff7a14, roof: 0xff7a14, wheels: 0xff7a14, flaps: 0x7b2fbf, art: ['split', 'pumpkin'], num: 31 },
  { name: 'Three stripes', base: 0xf1f0ea, second: 0xc8202a, third: 0x1b2f6b, roof: 0xf1f0ea, wheels: 0xe9e9e4, flaps: 0xc8202a, art: ['triple', 'twin'], num: 4 },
  { name: 'Slasher', base: 0x101214, second: 0x9bea1e, roof: 0x101214, wheels: 0x9bea1e, flaps: 0x9bea1e, art: ['claws'], num: 13 },
  { name: 'Chevron', base: 0xd0222b, second: 0xf3f3ee, roof: 0x111214, wheels: 0xf3f3ee, flaps: 0xd0222b, art: ['split'], num: 7 },
  { name: 'Powder and orange', base: 0x8ec6e6, second: 0xf06a12, roof: 0x8ec6e6, wheels: 0xf06a12, flaps: 0x1b2f6b, art: ['twin'], num: 20 },
  { name: 'Jazz cup', base: 0x6a2fb0, second: 0x19c7b8, third: 0xf2d21b, roof: 0x19c7b8, wheels: 0xf2d21b, flaps: 0x19c7b8, art: ['sweep', 'triple'], num: 96 },
  { name: 'Hazard', base: 0xf2c417, second: 0x121212, roof: 0x121212, wheels: 0x121212, flaps: 0xf2c417, art: ['hazard'], num: 66 },
];

// A door number: a white square with the number on it, drawn once per number.
const _num = new Map();
function numberMat(n) {
  if (_num.has(n)) return _num.get(n);
  let mat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6, metalness: 0 });
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = '#f4f4f0'; c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#101010'; c.font = '900 92px Helvetica, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(n), 64, 70);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0 });
  } catch { /* no canvas: a plain white plate */ }
  _num.set(n, mat);
  return mat;
}

export function buildXCar(look, body = 'wrx', livery = 0) {
  const P = BODIES[body] || BODIES.wrx, L = typeof livery === 'number' ? LIVERIES[((livery % LIVERIES.length) + LIVERIES.length) % LIVERIES.length] : livery;
  const g = new THREE.Group();
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; g.add(m); return m; };
  const tag = (m, bin, role, side = 0) => { m.userData.dmg = { bin, role, side }; return m; };
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.22, envMapIntensity: 1.3, ...o });

  const paint = std(L.base), paint2 = std(L.second), paint3 = std(L.third ?? L.second), roofMat = std(L.roof);
  const black = look.mat('carbon', { size: 0.3, tint: 0x16171a, roughness: 0.8, metalness: 0.05, env: 0.5 });
  const trim = look.mat('carbon', { size: 0.3, tint: 0x2a2c30, roughness: 0.6, metalness: 0.2, env: 0.8 });
  const cage = std(0xd9d9d6, { roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb6c4, roughness: 0.05, metalness: 0.4, envMapIntensity: 2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const rubber = look.mat('carbon', { size: 0.5, tint: 0x141518, roughness: 0.95, metalness: 0, env: 0.3 });
  const rim = std(L.wheels, { roughness: 0.4, metalness: 0.75 });
  const lamp = std(0xf2f0e2, { emissive: 0xe6dfc2, emissiveIntensity: 0.7, roughness: 0.2 });
  const flap = std(L.flaps, { roughness: 0.7, metalness: 0 });
  const tail = std(0x9c1410, { emissive: 0x5a0c08, emissiveIntensity: 0.6, roughness: 0.3 });
  const split = L.art.includes('split');
  const rearPaint = split ? paint2 : paint;

  const { nose: N, tail: T, half: HW, axF, axR, R, sill, bump, hood, scut, deck, deckX, sb: SB, st: ST, rr: RR, rb: RB, zb: ZB, zt: ZT } = P;
  const core = HW - 0.30, wz = HW - 0.15, track = HW - 0.13;
  // The top of the body at x: bonnet, then the waist, then the boot deck.
  const yAt = x => (x >= SB[0] ? scut + (hood - scut) * (x - SB[0]) / (N - 0.18 - SB[0]) : x >= deckX ? scut + (deck - scut) * (SB[0] - x) / (SB[0] - deckX) : deck);
  // ---- the body: a narrow core the wheels sit beside, full-width panels where
  // a wheel is not. The arches are the gaps between them. --------------------------
  add(slab([[0.0, 0.30], [N, 0.30], [N + 0.01, bump], [N - 0.18, hood], [SB[0], scut], [0.0, yAt(0)]], core), paint);
  add(slab([[T, 0.30], [0.0, 0.30], [0.0, yAt(0)], [deckX, deck], [T + 0.04, deck - 0.01], [T - 0.01, bump]], core), rearPaint);
  const dF = axF - 0.56, dR = axR + 0.56;                 // the doors run between the arches
  tag(add(slab([[0, sill], [dF, sill], [dF, yAt(dF) + 0.01], [0, yAt(0) + 0.01]], HW), paint), 'left', 'pod');
  add(slab([[dR, sill], [0, sill], [0, yAt(0) + 0.01], [dR, yAt(dR) + 0.01]], HW), rearPaint);
  const archF = Math.min(yAt(axF) - 0.06, R * 2 + 0.07), archR = Math.min(yAt(axR) - 0.06, R * 2 + 0.11);
  for (const side of [1, -1]) {
    const z = side * wz, bin = side > 0 ? 'right' : 'left';
    tag(add(box(1.14, yAt(axF) - archF + 0.02, 0.30, axF, (yAt(axF) + archF) / 2, z), paint), 'front', 'end', side);     // wing over the front wheel
    tag(add(box(1.14, yAt(axR) - archR + 0.02, 0.30, axR, (yAt(axR) + archR) / 2, z), rearPaint), 'rear', 'end', side);  // and the rear
    tag(add(slab([[axF + 0.56, 0.30], [N, 0.30], [N + 0.01, bump], [N - 0.18, hood], [axF + 0.56, yAt(axF + 0.56)]], 0.15, z), paint), 'front', 'end', side);
    tag(add(slab([[T, 0.30], [axR - 0.56, 0.30], [axR - 0.56, yAt(axR - 0.56)], [T + 0.04, deck - 0.01], [T - 0.01, bump]], 0.15, z), rearPaint), 'rear', 'end', side);
    add(box(1.20, 0.05, 0.05, axF, archF - 0.02, side * (HW + 0.005)), black);                         // arch lips
    add(box(1.20, 0.05, 0.05, axR, archR - 0.02, side * (HW + 0.005)), black);
    if (P.flaps) { add(box(0.03, 0.32, 0.26, axF - 0.50, 0.31, side * (HW - 0.14)), flap); add(box(0.03, 0.32, 0.26, axR - 0.50, 0.31, side * (HW - 0.14)), flap); }
    if (P.round) { for (const dz of [0.50, 0.70]) { const l = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 14); l.rotateZ(Math.PI / 2); l.translate(N, bump - 0.02, side * dz); add(l, lamp, false); } }
    else add(box(0.06, 0.12, 0.34, N - 0.01, bump + 0.03, side * (HW - 0.28)), lamp, false);
    add(box(0.05, 0.12, 0.36, T, deck - 0.16, side * (HW - 0.28)), tail, false);
    tag(add(box(0.10, 0.11, 0.20, SB[0] - 0.06, SB[1] + 0.08, side * (HW + 0.10)), black), bin, 'mirror', side);
    // the door plate and its number
    const dx = dF / 2 - 0.05, dy = (sill + yAt(dx)) / 2 + 0.06, zp = side * (HW + 0.004);
    add(pane([dx + 0.24 * side, dy - 0.22, zp], [dx - 0.24 * side, dy - 0.22, zp], [dx - 0.24 * side, dy + 0.22, zp], [dx + 0.24 * side, dy + 0.22, zp]), numberMat(L.num), false);
  }
  const bumper = tag(add(box(0.16, 0.20, HW * 2, N, 0.40, 0), black), 'front', 'fw');
  tag(add(box(0.14, 0.20, HW * 2 - 0.02, T, 0.42, 0), black), 'rear', 'end');
  add(box(0.04, 0.11, HW * 0.95, N + 0.015, bump, 0), black, false);                                  // grille
  if (P.splitter) tag(add(box(0.30, 0.03, HW * 2 - 0.04, N - 0.04, 0.10, 0), black), 'front', 'fw');
  else add(box(0.9, 0.03, 1.2, N - 0.45, 0.21, 0), cage);                                             // sump guard
  if (P.scoop) {
    const x0 = SB[0] + 0.14, x1 = SB[0] + 0.70;
    add(slab([[x0, yAt(x0) - 0.01], [x1, yAt(x1) - 0.01], [x1, yAt(x1) + 0.075], [x0 + 0.04, yAt(x0) + 0.07]], 0.24), paint);
    add(box(0.03, 0.06, 0.40, x1 + 0.005, yAt(x1) + 0.035, 0), black, false);
  }
  if (P.pod) {                                             // four lamps for the night stages, carried low
    add(box(0.16, 0.19, 1.02, N - 0.12, hood - 0.045, 0), black);
    for (const z of [-0.37, -0.125, 0.125, 0.37]) { const l = new THREE.CylinderGeometry(0.095, 0.095, 0.04, 14); l.rotateZ(Math.PI / 2); l.translate(N - 0.025, hood - 0.045, z); add(l, lamp, false); }
  }

  // ---- the glasshouse: a frame you can see out of ------------------------------------
  const bx = (ST[0] + RR[0]) / 2 - 0.05;
  tag(add(box(ST[0] - RR[0] + 0.04, 0.05, ZT * 2 + 0.06, (ST[0] + RR[0]) / 2, ST[1] + 0.035, 0), roofMat), 'left', 'pod');
  add(box(0.30, 0.05, 0.36, (ST[0] + RR[0]) / 2 + 0.1, ST[1] + 0.075, 0), black);                     // roof vent
  for (const side of [1, -1]) {
    add(bar([SB[0], SB[1], side * ZB], [ST[0], ST[1], side * ZT], 0.07, 0.06), paint);              // A pillar
    add(bar([RR[0], RR[1], side * ZT], [RB[0], RB[1], side * ZB], 0.09, 0.06), rearPaint);          // C pillar
    add(bar([bx + 0.02, yAt(bx) + 0.01, side * ZB], [bx, ST[1] + 0.01, side * ZT], 0.07, 0.07), paint);   // B pillar
    add(bar([ST[0], ST[1] + 0.005, side * ZT], [RR[0], RR[1] + 0.005, side * ZT], 0.06, 0.05), roofMat);  // cant rail
    add(pane([SB[0], SB[1], side * ZB], [ST[0], ST[1], side * ZT], [bx, ST[1] + 0.01, side * ZT], [bx + 0.02, yAt(bx) + 0.01, side * ZB]), glass, false);
    add(pane([bx + 0.02, yAt(bx) + 0.01, side * ZB], [bx, ST[1] + 0.01, side * ZT], [RR[0], RR[1], side * ZT], [RB[0], RB[1], side * ZB]), glass, false);
  }
  add(bar([ST[0], ST[1], -ZT], [ST[0], ST[1], ZT], 0.06, 0.05), roofMat);                             // header rail
  add(pane([SB[0], SB[1], -ZB], [SB[0], SB[1], ZB], [ST[0], ST[1], ZT], [ST[0], ST[1], -ZT]), glass, false);   // windscreen
  add(pane([RB[0], RB[1], -ZB], [RB[0], RB[1], ZB], [RR[0], RR[1], ZT], [RR[0], RR[1], -ZT]), glass, false);   // rear screen

  // ---- inside ----------------------------------------------------------------------------
  const E = P.eye, dash = SB[0] - 0.48;
  add(slab([[dash, sill + 0.5], [SB[0] + 0.02, sill + 0.5], [SB[0] + 0.02, SB[1] + 0.01], [dash + 0.12, SB[1] + 0.045], [dash, SB[1] - 0.01]], ZB - 0.04), black);   // the dashboard
  add(box(0.10, 0.045, 0.24, dash + 0.10, SB[1] + 0.06, E[2]), black);                               // the binnacle: low, so the road is over it
  add(box(0.03, 0.10, 0.16, dash + 0.055, SB[1] + 0.02, 0.02), trim);                                // the co-driver's trip meter
  // A little jack-o'-lantern on the dash, on the co-driver's side. It is October.
  { const s = new THREE.SphereGeometry(0.075, 12, 8); s.scale(1, 0.85, 1); s.translate(dash + 0.20, SB[1] + 0.10, 0.36);
    add(s, std(0xff7a14, { emissive: 0xb34700, emissiveIntensity: 0.5, roughness: 0.6, metalness: 0 }), false);
    add(box(0.02, 0.035, 0.02, dash + 0.20, SB[1] + 0.175, 0.36), std(0x3d6b1f, { roughness: 0.8, metalness: 0 }), false); }
  add(box(Math.abs(dash - RB[0]) + 0.5, 0.04, (ZB - 0.08) * 2, (dash + RB[0]) / 2 + 0.2, sill + 0.11, 0), black);    // the floor
  const seatX = E[0] - 0.28, seatY = E[1] - 0.75;
  for (const z of [E[2], -E[2]]) {                                                                    // two buckets
    add(box(0.46, 0.10, 0.44, seatX, seatY, z), trim);
    add(slab([[seatX - 0.26, seatY - 0.02], [seatX - 0.16, seatY - 0.02], [seatX - 0.26, seatY + 0.74], [seatX - 0.36, seatY + 0.74]], 0.22, z), trim);
    add(box(0.10, 0.20, 0.30, seatX - 0.33, seatY + 0.76, z), trim);
  }
  // the cage: a hoop behind the seats, a tube up each A pillar, a bar over the screen, a diagonal, door bars
  const C = 0.045, hx = seatX - 0.44, zc = ZT - 0.06;
  for (const side of [1, -1]) {
    add(bar([hx + 0.02, sill + 0.13, side * (ZB - 0.14)], [hx, ST[1] - 0.04, side * zc], C), cage);
    add(bar([SB[0] - 0.06, SB[1] - 0.01, side * (ZB - 0.05)], [ST[0] - 0.01, ST[1] - 0.03, side * (ZT - 0.04)], C), cage);
    add(bar([ST[0] - 0.01, ST[1] - 0.03, side * (ZT - 0.04)], [hx, ST[1] - 0.04, side * zc], C), cage);
    add(bar([hx + 0.02, seatY + 0.2, side * (ZB - 0.14)], [dash + 0.1, seatY + 0.08, side * (ZB - 0.08)], C), cage);
  }
  add(bar([hx, ST[1] - 0.04, -zc], [hx, ST[1] - 0.04, zc], C), cage);
  add(bar([ST[0] - 0.01, ST[1] - 0.03, -(ZT - 0.04)], [ST[0] - 0.01, ST[1] - 0.03, ZT - 0.04], C), cage);
  add(bar([hx + 0.02, sill + 0.15, -(ZB - 0.14)], [hx, ST[1] - 0.06, zc - 0.02], C), cage);

  // ---- the wing ------------------------------------------------------------------------------
  const wings = { front: [bumper], rear: [] };
  const wingMat = split ? paint : black;
  if (P.wing === 'stays') {
    const wy = ST[1] - 0.10, wx = T + 0.28;
    wings.rear.push(tag(add(box(0.30, 0.035, HW * 2 - 0.24, wx, wy, 0), wingMat), 'rear', 'rw'));
    for (const side of [1, -1]) {
      wings.rear.push(tag(add(bar([wx + 0.12, deck, side * 0.50], [wx, wy - 0.01, side * 0.50], 0.03, 0.10), black), 'rear', 'rw'));
      wings.rear.push(tag(add(box(0.34, 0.16, 0.025, wx, wy - 0.03, side * (HW - 0.12)), wingMat), 'rear', 'rep', side));
    }
  } else if (P.wing === 'roof') {
    wings.rear.push(tag(add(bar([RR[0] + 0.05, RR[1] + 0.05, 0], [RR[0] - 0.32, RR[1] + 0.01, 0], ZT * 2 + 0.04, 0.035), wingMat), 'rear', 'rw'));
  } else if (P.wing === 'duck') {
    wings.rear.push(tag(add(bar([T + 0.42, deck, 0], [T + 0.02, deck + 0.14, 0], HW * 2 - 0.3, 0.035), wingMat), 'rear', 'rw'));
  } else if (P.wing === 'lip') {
    wings.rear.push(tag(add(box(0.10, 0.07, HW * 2 - 0.2, T + 0.10, deck + 0.03, 0), wingMat), 'rear', 'rw'));
  }

  // ---- the graphics -----------------------------------------------------------------------------
  const P1 = 0.006;                                        // how far a graphic stands off the panel
  for (const art of L.art) {
    if (art === 'sweep') for (const side of [1, -1]) {
      add(bar([N - 0.5, sill + 0.20, side * (HW + P1)], [T + 0.5, deck - 0.12, side * (HW + P1)], 0.012, 0.20), paint2, false);
      add(bar([N - 0.9, sill + 0.08, side * (HW + P1)], [T + 0.9, deck - 0.30, side * (HW + P1)], 0.012, 0.07), paint3, false);
    }
    if (art === 'triple') for (const side of [1, -1]) [paint2, paint3, paint2].forEach((m, k) =>
      add(bar([dF + 0.1, yAt(0) - 0.16 - k * 0.075, side * (HW + P1)], [dR - 0.1, yAt(0) - 0.16 - k * 0.075, side * (HW + P1)], 0.012, 0.05), m, false));
    if (art === 'claws') for (const side of [1, -1]) for (let k = 0; k < 3; k++)
      add(bar([0.55 - k * 0.42, yAt(0) - 0.06, side * (HW + P1)], [0.15 - k * 0.42, sill + 0.10, side * (HW + P1)], 0.012, 0.10), paint2, false);
    if (art === 'hazard') {
      for (const side of [1, -1]) for (let k = 0; k < 4; k++)
        add(bar([dR - 0.15 - k * 0.34, sill + 0.05, side * (HW + P1)], [dR + 0.15 - k * 0.34, yAt(dR) - 0.04, side * (HW + P1)], 0.012, 0.14), paint2, false);
      add(bar([N - 0.2, hood + 0.012, 0], [SB[0] + 0.02, scut + 0.012, 0], HW * 1.1, 0.012), paint2, false);        // a black bonnet
    }
    if (art === 'twin') for (const z of [-0.16, 0.16]) {
      const m = L.third != null ? (z < 0 ? paint2 : paint3) : paint2;
      add(bar([N - 0.19, hood + 0.012, z], [SB[0], scut + 0.012, z], 0.17, 0.012), m, false);
      add(box(ST[0] - RR[0], 0.012, 0.17, (ST[0] + RR[0]) / 2, ST[1] + 0.066, z), m, false);
      add(bar([deckX, deck + 0.012, z], [T + 0.05, deck + 0.002, z], 0.17, 0.012), m, false);
    }
    if (art === 'pumpkin') {
      // A face on the bonnet, looking up at the sky: two triangle eyes, a nose, a jagged grin.
      const y = x => hood + (scut - hood) * (N - 0.18 - x) / (N - 0.18 - SB[0]) + 0.013, xm = (N - 0.18 + SB[0]) / 2;
      const tri = (cx, cz, s, up = 1) => { const a = [cx + s * up, y(cx + s * up), cz], b = [cx - s * up, y(cx - s * up), cz - s], c = [cx - s * up, y(cx - s * up), cz + s]; add(pane(a, b, c, c), paint2, false); };
      tri(xm - 0.12, -0.26, 0.13, -1); tri(xm - 0.12, 0.26, 0.13, -1); tri(xm + 0.06, 0, 0.07, -1);
      for (let k = -2; k <= 2; k++) tri(xm + 0.30, k * 0.14, 0.075, k % 2 ? 1 : -1);
      add(bar([xm + 0.26, y(xm + 0.26), -0.36], [xm + 0.26, y(xm + 0.26), 0.36], 0.05, 0.004), paint2, false);
    }
  }

  // ---- wheels ---------------------------------------------------------------------------------
  const tyreGeo = new THREE.CylinderGeometry(R, R, 0.215, 26); tyreGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(R * 0.66, R * 0.66, 0.225, 20); rimGeo.rotateX(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(R * 1.2, 0.05, 0.232);
  const wheels = {}, steer = {}, hubs = {};
  for (const [key, ax, zo] of [['fr', axF, track], ['fl', axF, -track], ['rr', axR, track], ['rl', axR, -track]]) {
    const hub = new THREE.Object3D();
    hub.position.set(ax, R, zo);
    const w = new THREE.Mesh(tyreGeo, rubber);
    w.castShadow = true;
    w.add(new THREE.Mesh(rimGeo, rim));
    for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(spokeGeo, rim); b.rotation.z = k * Math.PI / 6; w.add(b); }
    hub.add(w);
    g.add(hub);
    wheels[key] = w; hubs[key] = hub;
    if (key[0] === 'f') steer[key] = hub;
  }
  return { group: g, wheels, steer, hubs, drs: null, R, wings, eye: P.eye.slice(), paint, cabin: true, name: P.name, livery: L.name };
}

// HIS car: the WRX in blue and gold. (Kept under the first export's name for the renderer.)
export const buildRally = look => buildXCar(look, 'wrx', 0);
// The GT styles' car, sat in the same way.
export const buildXGT = look => buildXCar(look, 'gt', 0);
// What a rival wears: every body in turn, every livery in turn, never his.
export const RALLY_BODIES = ['hatch', 'wedge', 'boxy', 'wrx'];
export function rivalCar(look, k, gt = false) {
  return buildXCar(look, gt ? 'gt' : RALLY_BODIES[k % RALLY_BODIES.length], 1 + (k % (LIVERIES.length - 1)));
}
// tools/svgshot.mjs: XCAR_BODY=hatch XCAR_LIVERY=3 node tools/svgshot.mjs js/xcar.js showXCar out.svg
export const showXCar = look => buildXCar(look, (typeof process !== 'undefined' && process.env.XCAR_BODY) || 'wrx', +((typeof process !== 'undefined' && process.env.XCAR_LIVERY) || 0));
