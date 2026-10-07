// xcar.js — the cars that are Xingus mode's own.
//
// Adam, 2026-10-06, driving the mode on the GT car's body: "a non proper rally
// car, or a messed up pov, i want real insdie car pov". He had asked for "a
// subaru wrx on a mega rally circuit"; a real marque's badge cannot go on a
// game that is sold, so this is one of his: the BRAEWICK TORR. Braewick are
// Valcorsa's highland blacksmiths — proud boxes — and the Torr is a compact
// four-door saloon on gravel tyres: turbo, four driven wheels, a scoop on the
// bonnet, a lamp pod, mud flaps and a wing on stays.
//
// WHAT IT IS MADE OF, and why that way. The GT3 body (js/car.js) is a sealed
// shell with dark glass and no inside, which is why its "onboard" was a
// camera on the roof. This one is built to be SAT IN: the glasshouse is a
// frame — pillars, roof, a roll cage — with see-through panes, and there is a
// dashboard, two seats and a bonnet in front of you. `eye` is the driver's
// own eyes, on the left, and `cabin: true` tells the renderer to put the
// ONBOARD camera there.
//
// Dimensions are a compact rally saloon's: 4.42 x 1.80 x 1.44 m, 2.56 m
// wheelbase, 1.54 m track, 0.66 m tyres with 19 cm under the sills. Same
// bundle out as buildGT3, so the renderer treats it as any other car.
// Axes as car.js: +x forward, +y up, +z the car's RIGHT.
//
// No renderer state lives here; tools/svgshot.mjs draws it in Node from four
// sides and from the driver's seat, which is how it was looked at while Adam
// was driving and no browser could be opened.
import * as THREE from 'three';

const PAINT = 0x1d4fb5, GOLD = 0xc8a02c;

// A box between two points: a pillar, a cage tube, a stay.
function bar(p, q, tw, th = tw) {
  const d = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), L = d.length();
  const g = new THREE.BoxGeometry(L, th, tw);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize()));
  g.applyMatrix4(m);
  g.translate((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2);
  return g;
}
// A side profile (points [x, y], going round) pushed out to z = +-half.
function slab(profile, half, z0 = 0) {
  const s = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: half * 2, bevelEnabled: false });
  g.translate(0, 0, z0 - half);
  return g;
}
// A flat four-cornered pane.
function pane(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.computeVertexNormals();
  return g;
}
const box = (sx, sy, sz, x, y, z) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); return g; };

export function buildRally(look, colour = PAINT) {
  const g = new THREE.Group();
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; g.add(m); return m; };
  const tag = (m, bin, role, side = 0) => { m.userData.dmg = { bin, role, side }; return m; };

  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.3, metalness: 0.25, envMapIntensity: 1.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.4, metalness: 0.1 });
  const black = look.mat('carbon', { size: 0.3, tint: 0x16171a, roughness: 0.8, metalness: 0.05, env: 0.5 });
  const trim = look.mat('carbon', { size: 0.3, tint: 0x2a2c30, roughness: 0.6, metalness: 0.2, env: 0.8 });
  const cage = new THREE.MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb6c4, roughness: 0.05, metalness: 0.4, envMapIntensity: 2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const rubber = look.mat('carbon', { size: 0.5, tint: 0x141518, roughness: 0.95, metalness: 0, env: 0.3 });
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.4, metalness: 0.8, envMapIntensity: 1.1 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xf2f0e2, emissive: 0xe6dfc2, emissiveIntensity: 0.7, roughness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.7, metalness: 0 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x9c1410, emissive: 0x5a0c08, emissiveIntensity: 0.6, roughness: 0.3 });

  const AX_F = 1.28, AX_R = -1.28, TRACK = 0.77, R = 0.33, SILL = 0.19;
  // ---- the body: a narrow core the wheels sit beside, and full-width panels
  // everywhere a wheel is not. The arches are the gaps. -------------------------
  // The core's side profile: bumper, bonnet rising to the scuttle, the waist,
  // the boot deck, the tail.
  const BODY = [[-2.2, 0.30], [2.2, 0.30], [2.21, 0.62], [2.02, 0.80], [0.88, 0.93], [-1.42, 0.97], [-2.16, 0.96], [-2.21, 0.6]];
  add(slab(BODY, 0.60), paint);
  // doors and sills, full width between the arches
  tag(add(slab([[-0.72, SILL], [0.72, SILL], [0.72, 0.945], [-0.72, 0.965]], 0.90), paint), 'left', 'pod');
  // wings over each wheel, and the corners ahead of and behind them
  for (const side of [1, -1]) {
    const z = side * 0.75, bin = side > 0 ? 'right' : 'left';
    tag(add(box(1.14, 0.20, 0.30, AX_F, 0.83, z), paint), 'front', 'end', side);            // front wing top
    tag(add(box(1.14, 0.20, 0.30, AX_R, 0.87, z), paint), 'rear', 'end', side);             // rear wing top
    tag(add(slab([[1.85, 0.30], [2.2, 0.30], [2.21, 0.62], [2.02, 0.80], [1.85, 0.82]], 0.15, z), paint), 'front', 'end', side);
    tag(add(slab([[-2.2, 0.30], [-1.85, 0.30], [-1.85, 0.97], [-2.16, 0.96], [-2.21, 0.6]], 0.15, z), paint), 'rear', 'end', side);
    add(box(0.50, 0.46, 0.30, 0.47, 0.50 + SILL / 2, z), paint);                            // behind the front wheel
    add(box(0.50, 0.50, 0.30, -0.47, 0.52 + SILL / 2, z), paint);                           // ahead of the rear wheel
    // arch lips, black, and the mud flaps a gravel car wears
    add(box(1.20, 0.05, 0.05, AX_F, 0.725, side * 0.905), black);
    add(box(1.20, 0.05, 0.05, AX_R, 0.765, side * 0.905), black);
    add(box(0.03, 0.34, 0.26, AX_F - 0.50, 0.32, side * 0.76), red);
    add(box(0.03, 0.34, 0.26, AX_R - 0.50, 0.32, side * 0.76), red);
    // lamps
    add(box(0.06, 0.13, 0.36, 2.19, 0.66, side * 0.62), lamp, false);
    add(box(0.05, 0.13, 0.40, -2.20, 0.80, side * 0.62), tail, false);
    // door mirror
    tag(add(box(0.10, 0.11, 0.20, 0.82, 1.02, side * 1.0), black), bin, 'mirror', side);
  }
  // bumpers, the grille, a sump guard
  const bumper = tag(add(box(0.16, 0.20, 1.80, 2.20, 0.40, 0), black), 'front', 'fw');
  tag(add(box(0.14, 0.20, 1.78, -2.20, 0.42, 0), black), 'rear', 'end');
  add(box(0.04, 0.12, 0.86, 2.215, 0.64, 0), black, false);
  add(box(0.9, 0.03, 1.2, 1.75, 0.21, 0), cage);
  // the bonnet scoop, and the four-lamp pod a night stage needs
  add(slab([[1.02, 0.92], [1.58, 0.875], [1.58, 0.955], [1.06, 1.0]], 0.24), paint);
  add(box(0.03, 0.06, 0.40, 1.585, 0.915, 0), black, false);
  // (carried low on the nose: at bonnet height it stood across the horizon from the seat)
  add(box(0.16, 0.19, 1.02, 2.08, 0.755, 0), black);
  for (const z of [-0.37, -0.125, 0.125, 0.37]) {
    const l = new THREE.CylinderGeometry(0.095, 0.095, 0.04, 14); l.rotateZ(Math.PI / 2); l.translate(2.175, 0.755, z);
    add(l, lamp, false);
  }

  // ---- the glasshouse: a frame you can see out of --------------------------------
  // Corners: screen base, screen top, roof rear, rear-screen base; narrower at the top.
  const SB = [0.88, 0.94], ST = [0.26, 1.40], RR = [-0.92, 1.42], RB = [-1.44, 0.98], ZB = 0.74, ZT = 0.66;
  tag(add(box(ST[0] - RR[0] + 0.04, 0.05, ZT * 2 + 0.06, (ST[0] + RR[0]) / 2, 1.435, 0), white), 'left', 'pod');   // the roof
  add(box(0.30, 0.05, 0.36, -0.2, 1.475, 0), black);                                                // roof vent
  for (const side of [1, -1]) {
    add(bar([SB[0], SB[1], side * ZB], [ST[0], ST[1], side * ZT], 0.07, 0.06), paint);              // A pillar
    add(bar([RR[0], RR[1], side * ZT], [RB[0], RB[1], side * ZB], 0.09, 0.06), paint);              // C pillar
    add(bar([-0.34, 0.96, side * ZB], [-0.36, 1.41, side * ZT], 0.07, 0.07), paint);                // B pillar
    add(bar([ST[0], ST[1] + 0.005, side * ZT], [RR[0], RR[1] + 0.005, side * ZT], 0.06, 0.05), paint); // cant rail
    // side glass, front and rear door
    add(pane([SB[0], SB[1], side * ZB], [ST[0], ST[1], side * ZT], [-0.36, 1.41, side * ZT], [-0.34, 0.96, side * ZB]), glass, false);
    add(pane([-0.34, 0.96, side * ZB], [-0.36, 1.41, side * ZT], [RR[0], RR[1], side * ZT], [RB[0], RB[1], side * ZB]), glass, false);
  }
  add(bar([ST[0], ST[1], -ZT], [ST[0], ST[1], ZT], 0.06, 0.05), paint);                              // header rail
  add(pane([SB[0], SB[1], -ZB], [SB[0], SB[1], ZB], [ST[0], ST[1], ZT], [ST[0], ST[1], -ZT]), glass, false);   // windscreen
  add(pane([RB[0], RB[1], -ZB], [RB[0], RB[1], ZB], [RR[0], RR[1], ZT], [RR[0], RR[1], -ZT]), glass, false);   // rear screen

  // ---- inside --------------------------------------------------------------------------
  add(slab([[0.40, 0.72], [0.90, 0.72], [0.90, 0.95], [0.52, 0.985], [0.40, 0.93]], 0.70), black);  // the dashboard
  add(box(0.10, 0.045, 0.24, 0.50, 1.0, -0.36), black);                                             // the binnacle, driver's side: low, so the road is over it
  add(box(0.03, 0.10, 0.16, 0.455, 0.96, 0.02), trim);                                              // the co-driver's trip meter
  add(box(1.9, 0.04, 1.30, -0.25, 0.30, 0), black);                                                 // the floor
  for (const z of [-0.36, 0.36]) {                                                                   // two buckets
    add(box(0.46, 0.10, 0.44, -0.30, 0.42, z), trim);
    add(slab([[-0.56, 0.40], [-0.46, 0.40], [-0.56, 1.16], [-0.66, 1.16]], 0.22, z), trim);
    add(box(0.10, 0.20, 0.30, -0.63, 1.18, z), trim);
  }
  // the cage: a hoop behind the seats, one along each A pillar, a bar over the screen, a diagonal
  const C = 0.045;
  for (const side of [1, -1]) {
    const z = side * 0.60;
    add(bar([-0.72, 0.32, z], [-0.74, 1.38, z * 0.98], C), cage);
    add(bar([0.82, 0.93, side * 0.69], [0.25, 1.37, side * 0.62], C), cage);
    add(bar([0.25, 1.37, side * 0.62], [-0.74, 1.38, z * 0.98], C), cage);
    add(bar([-0.72, 0.62, z], [0.55, 0.50, side * 0.66], C), cage);                                  // door bar
  }
  add(bar([-0.74, 1.38, -0.59], [-0.74, 1.38, 0.59], C), cage);
  add(bar([0.25, 1.37, -0.62], [0.25, 1.37, 0.62], C), cage);
  add(bar([-0.72, 0.34, -0.60], [-0.74, 1.36, 0.58], C), cage);

  // ---- the wing, on two stays over the boot ---------------------------------------------
  const wings = { front: [bumper], rear: [] };
  wings.rear.push(tag(add(box(0.30, 0.035, 1.56, -1.92, 1.30, 0), black), 'rear', 'rw'));
  for (const side of [1, -1]) {
    wings.rear.push(tag(add(bar([-1.80, 0.97, side * 0.50], [-1.92, 1.29, side * 0.50], 0.03, 0.10), black), 'rear', 'rw'));
    wings.rear.push(tag(add(box(0.34, 0.16, 0.025, -1.92, 1.27, side * 0.78), black), 'rear', 'rep', side));
  }

  // ---- wheels: gravel tyres on gold rims -------------------------------------------------
  const tyreGeo = new THREE.CylinderGeometry(R, R, 0.215, 26); tyreGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(R * 0.66, R * 0.66, 0.225, 20); rimGeo.rotateX(Math.PI / 2);
  const spoke = () => { const s = new THREE.Group(); for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(R * 1.2, 0.05, 0.232), gold); b.rotation.z = k * Math.PI / 6; s.add(b); } return s; };
  const wheels = {}, steer = {}, hubs = {};
  for (const [key, ax, zo] of [['fr', AX_F, TRACK], ['fl', AX_F, -TRACK], ['rr', AX_R, TRACK], ['rl', AX_R, -TRACK]]) {
    const hub = new THREE.Object3D();
    hub.position.set(ax, R, zo);
    const w = new THREE.Mesh(tyreGeo, rubber);
    w.castShadow = true;
    w.add(new THREE.Mesh(rimGeo, gold));
    w.add(spoke());
    hub.add(w);
    g.add(hub);
    wheels[key] = w; hubs[key] = hub;
    if (key[0] === 'f') steer[key] = hub;
  }
  // The driver sits on the left, eyes 1.17 m up and half a metre back from the dash.
  return { group: g, wheels, steer, hubs, drs: null, R, wings, eye: [-0.02, 1.17, -0.36], paint, cabin: true, name: 'Braewick Torr' };
}
