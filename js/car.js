// car.js — the car, built out of surfaces instead of boxes.
//
// It used to be sixteen cuboids. That was a deliberate trade early on — the
// budget went into the tyre model and a clean silhouette reads better at speed
// than a detailed model you never see — but the ONBOARD camera changed the
// deal. The nose and the front wheels are now in frame every single frame, so
// the car is no longer something you glance at. It is the thing you look at.
//
// Adam: *"make it look like carbon n such, smooth the car out, to look like a
// real f1 car, and add sponsor stickers"*, and *"make the wheels turn
// animation correct (currently the axle turns, the wheels should [be] at the
// ends of [the] axle)"*.
//
// ---------------------------------------------------------------------------
// THE STEERING BUG HE SPOTTED, because it is worth writing down
//
// Both front wheels were children of ONE group whose origin sat at the middle
// of the car, and steering rotated that group. So the wheels swung through an
// arc around the car's centre — translating sideways and forwards — instead of
// each pivoting in place at its own end of the axle. At small angles it looks
// like steering. At full lock it looks like the axle is turning, which is
// exactly what he said. Each wheel has its own pivot now, at its own hub, and
// they take slightly different angles because the inside wheel on a real car
// turns further than the outside one.
//
// ---------------------------------------------------------------------------
// HOW THE SHAPES ARE MADE
//
// One idea, used for the whole body: a LOFT. Give it a list of cross-sections
// along the car — each a superellipse with its own width, height, centre and
// squareness — and it sweeps a smooth skin through them. A nose that starts as
// a 7 cm round tip and becomes a 70 cm squared-off monocoque is four numbers
// per station, and it comes out looking like it was moulded rather than
// stacked. Real dimensions throughout: 5.63 m long, 2.0 m across, 3.6 m
// wheelbase, 720 mm tyres.
import * as THREE from 'three';
import { Atlas, fitText } from './geom.js';

// A superellipse: exponent 2 is an ellipse, 4 is a rounded rectangle, and the
// stations below walk from one to the other as the nose becomes a chassis.
function ring(w, h, n, segs) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const p = 2 / n;
    pts.push([
      Math.sign(ca) * Math.pow(Math.abs(ca), p) * w,
      Math.sign(sa) * Math.pow(Math.abs(sa), p) * h,
    ]);
  }
  return pts;
}

/**
 * Sweep a skin through a list of cross-sections.
 *
 * Stations run nose-to-tail along +X. Each is { x, y, z, w, h, n } — where it
 * sits, how wide and tall it is, and how square. Ends are capped so the shape
 * is closed and lights correctly.
 */
function loft(stations, segs = 24, close = true) {
  const rings = stations.map(s => ring(s.w, s.h, s.n, segs));
  const pos = [], idx = [];
  // WHICH WAY DO THE STATIONS RUN?
  //
  // The winding of the skin depends on it, and getting it wrong does not make
  // the shape wrong — it makes it INSIDE OUT. The faces nearest you are culled
  // and you see the inner surface of the far side, which keeps the silhouette
  // and most of the colour, so it survives a screenshot and only shows up when
  // you look at the car properly. Adam: "i can see throught the layer facing
  // me."
  //
  // The comment above this function used to say stations run "nose-to-tail
  // along +X" and every caller in this file writes them nose FIRST, which is x
  // DECREASING. Measured: 3.3% of the body's faces pointed outward. Rather
  // than reverse ten call sites and hope nobody adds an eleventh the other way
  // round, derive it.
  const rev = stations[stations.length - 1].x < stations[0].x;
  for (let k = 0; k < stations.length; k++) {
    const s = stations[k];
    for (const [z, y] of rings[k]) pos.push(s.x, s.y + y, (s.z || 0) + z);
  }
  for (let k = 0; k < stations.length - 1; k++) {
    const a = k * segs, b = (k + 1) * segs;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      if (rev) idx.push(a + i, b + j, b + i, a + i, a + j, b + j);
      else idx.push(a + i, b + i, b + j, a + i, b + j, a + j);
    }
  }
  if (close) {
    // Cap both ends with a fan to a centre vertex.
    for (const [k, flip] of (rev ? [[0, false], [stations.length - 1, true]]
                                  : [[0, true], [stations.length - 1, false]])) {
      const s = stations[k];
      const c = pos.length / 3;
      pos.push(s.x, s.y, s.z || 0);
      for (let i = 0; i < segs; i++) {
        const a = k * segs + i, b = k * segs + ((i + 1) % segs);
        if (flip) idx.push(c, b, a); else idx.push(c, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A wing element: a cambered aerofoil swept across the span, with the tips
// curled up the way a real front wing is. Chord and angle vary across the span
// because a flat plank is the thing that makes a wing look like a placeholder.
function wing(span, chord, thick, camber, twistTip, rise, segs = 18) {
  const pos = [], idx = [];
  const sec = 10;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, u = t * 2 - 1;           // -1..1 across the span
    const z = u * span;
    const k = Math.abs(u);
    const c = chord * (1 - 0.22 * k * k);
    const ang = twistTip * k * k;
    const y = rise * k * k * k;
    for (let j = 0; j < sec; j++) {
      const a = (j / sec) * Math.PI * 2;
      // Aerofoil-ish: a thin ellipse with the trailing edge pulled down.
      const cx = Math.cos(a) * c * 0.5;
      const cy = Math.sin(a) * thick * 0.5 - camber * (1 - (Math.cos(a) ** 2));
      pos.push(
        cx * Math.cos(ang) - cy * Math.sin(ang),
        y + cx * Math.sin(ang) + cy * Math.cos(ang),
        z);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * sec, b = (i + 1) * sec;
    for (let j = 0; j < sec; j++) {
      const n = (j + 1) % sec;
      // Same inversion as loft() had: the span runs -1 to +1 and this winding
      // was written for the other direction, so both wings were inside out.
      idx.push(a + j, b + n, b + j, a + j, a + n, b + n);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A tyre, turned from a real cross-section: tread, shoulder, sidewall bulge,
// bead. A plain cylinder is the single most obvious thing about a toy car —
// real tyres are fatter in the middle of the sidewall than at the rim.
function tyre(radius, width) {
  const r = radius, hw = width / 2, rim = radius * 0.58;
  const profile = [
    [rim, hw * 0.55], [r * 0.80, hw * 0.92], [r * 0.93, hw * 1.0],
    [r * 0.995, hw * 0.93], [r, hw * 0.58], [r, 0],
    [r, -hw * 0.58], [r * 0.995, -hw * 0.93], [r * 0.93, -hw * 1.0],
    [r * 0.80, -hw * 0.92], [rim, -hw * 0.55],
  ].map(([y, x]) => new THREE.Vector2(y, x));
  const g = new THREE.LatheGeometry(profile, 30);
  // Lathe spins around Y. One rotation about X puts the axle on +Z, which is
  // the car's lateral axis — and the axis the wheel must spin about.
  g.rotateX(Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------------------
// The livery. Sponsor names are drawn once into one atlas and applied as flat
// decals sitting a centimetre proud of the bodywork — which is what a sticker
// is. They are placed only on the panels that are nearly flat (sidepod flanks,
// endplates, engine cover, rear wing), because a flat decal on a curved nose
// cuts through it.
// ---------------------------------------------------------------------------
const SPONSORS = ['XANBOO78O', 'FOGLAST', 'VROOM', 'CRITTERS', 'ORBIX', 'XANCOIN',
  'TERMINAL TYCOON', 'MOLT', 'OMMOR', 'EVERYDEATH', 'DEEPWALK', 'CORN'];

function liveryAtlas(primary) {
  const A = new Atlas(2, 8, 512, 128);
  const cells = {};
  const put = (key, text, bg, fg, weight) => {
    cells[key] = A.cell((g, w, h) => {
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      else { g.clearRect(0, 0, w, h); }
      fitText(g, text, w / 2, h / 2, w * 0.9, h * 0.78, { colour: fg, weight: weight || '900' });
    });
  };
  put('title', SPONSORS[0], null, '#ffffff');
  put('podL', SPONSORS[1], null, '#ffffff');
  put('podR', SPONSORS[2], null, '#ffffff');
  put('cover', SPONSORS[3], null, '#f2f2f2');
  put('wing', SPONSORS[4], null, '#ffffff');
  put('epL', SPONSORS[5], null, '#e9e9e9');
  put('epR', SPONSORS[6], null, '#e9e9e9');
  put('nose', SPONSORS[7], null, '#ffffff');
  // A number board, because a racing car has a number on it.
  cells.number = A.cell((g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = primary;
    g.beginPath(); g.ellipse(w / 2, h / 2, h * 0.46, h * 0.46, 0, 0, 6.3); g.fill();
    fitText(g, '78', w / 2, h / 2, h * 0.7, h * 0.62, { colour: '#ffffff' });
  });
  const tex = A.texture();
  tex.premultiplyAlpha = false;
  return { atlas: A, cells, texture: tex };
}

// A decal: a flat quad lying on a panel, pushed out along its normal.
function decal(livery, cell, at, size, normal, along, flip) {
  const uv = livery.atlas.uv(cell, flip);
  const n = new THREE.Vector3(...normal).normalize();
  const u = new THREE.Vector3(...along).normalize();
  // v = n x u. Together with `along` pointing along SCREEN-RIGHT as seen from
  // outside that panel, this puts the decal's up axis at +Y.
  //
  // Getting `along` wrong is what made FOGLAST read as TSALGOF. Standing to
  // the car's right — the +Z side — and looking back at it, screen-right is
  // the direction the NOSE points, +X. Standing on the left it is -X. The two
  // sides therefore take OPPOSITE `along` vectors, and the first version gave
  // them the same one, so exactly one side of the car was readable.
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const c = new THREE.Vector3(...at).addScaledVector(n, 0.012);
  const pos = [], idx = [0, 1, 2, 0, 2, 3];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const uvs = [];
  for (let i = 0; i < 4; i++) {
    const [su, sv] = corners[i];
    const p = c.clone().addScaledVector(u, su * size[0] / 2).addScaledVector(v, sv * size[1] / 2);
    pos.push(p.x, p.y, p.z);
    uvs.push(uv[i][0], uv[i][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(
    [n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z], 3));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------
export function buildCar(look, colour = 0xd8352a, chassis = null) {
  const g = new THREE.Group();
  const primary = '#' + new THREE.Color(colour).getHexString();

  // Materials. Carbon is a real photographed weave rather than a dark grey,
  // and the paint is a clearcoat — low roughness and a strong environment, so
  // it picks up the sky the way a polished panel does.
  const carbon = look.mat('carbon', {
    size: 0.26, tint: 0x2c2e33, roughness: 0.34, metalness: 0.22, env: 1.35,
  });
  const carbonMatt = look.mat('carbon', {
    size: 0.22, tint: 0x1c1e22, roughness: 0.62, metalness: 0.12, env: 0.8,
  });
  const paint = new THREE.MeshStandardMaterial({
    color: colour, roughness: 0.16, metalness: 0.22, envMapIntensity: 1.5,
  });
  const rubber = look.mat('carbon', {
    size: 0.5, tint: 0x15161a, roughness: 0.93, metalness: 0.0, env: 0.35,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x6e7278, roughness: 0.38, metalness: 0.9, envMapIntensity: 1.1,
  });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d33, roughness: 0.42, metalness: 0.7, envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  const visor = new THREE.MeshStandardMaterial({
    color: 0x0a0c10, roughness: 0.05, metalness: 0.7, envMapIntensity: 1.8,
  });
  const helmetMat = new THREE.MeshStandardMaterial({
    color: 0xe8eaee, roughness: 0.14, metalness: 0.08, envMapIntensity: 1.3,
  });

  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    g.add(m);
    return m;
  };

  // --- the body ------------------------------------------------------------
  // Nose tip to tail in one skin: 7 cm round at the front, squared off through
  // the monocoque, swelling over the engine and tapering to the exhaust.
  const bodyRear = loft([
    { x: -0.80, y: 0.378, w: 0.332, h: 0.292, n: 3.4 },
    { x: -1.30, y: 0.378, w: 0.290, h: 0.274, n: 3.2 },
    { x: -1.92, y: 0.358, w: 0.192, h: 0.192, n: 3.0 },
    { x: -2.30, y: 0.330, w: 0.094, h: 0.094, n: 2.5 },
  ], 26);
  const body = loft([
    { x: 2.30, y: 0.190, w: 0.070, h: 0.052, n: 2.4 },
    { x: 2.02, y: 0.200, w: 0.105, h: 0.078, n: 2.7 },
    { x: 1.62, y: 0.225, w: 0.150, h: 0.115, n: 3.0 },
    { x: 1.15, y: 0.265, w: 0.205, h: 0.160, n: 3.2 },
    { x: 0.62, y: 0.305, w: 0.270, h: 0.205, n: 3.4 },
    { x: 0.18, y: 0.330, w: 0.320, h: 0.232, n: 3.6 },
    { x: -0.32, y: 0.342, w: 0.338, h: 0.245, n: 3.6 },
    { x: -0.80, y: 0.378, w: 0.330, h: 0.290, n: 3.4 },
  ], 26);
  add(body, paint);
  // Behind the driver it is bare carbon, the way a real engine cover is under
  // the livery. One gloss colour from nose to exhaust is what makes a model
  // read as a toy.
  add(bodyRear, carbon);

  // The airbox over the driver's head, and the fin behind it.
  add(loft([
    { x: -0.52, y: 0.60, w: 0.150, h: 0.125, n: 2.6 },
    { x: -0.78, y: 0.64, w: 0.175, h: 0.150, n: 2.8 },
    { x: -1.10, y: 0.60, w: 0.150, h: 0.120, n: 2.8 },
    { x: -1.55, y: 0.52, w: 0.080, h: 0.065, n: 2.6 },
  ], 18), paint);
  const finGeo = new THREE.BoxGeometry(0.90, 0.30, 0.018);
  finGeo.translate(-1.72, 0.50, 0);
  add(finGeo, carbon);

  // Sidepods: wide at the inlet, drawn in hard at the back. The "coke bottle"
  // is the most recognisable curve on the car.
  for (const side of [1, -1]) {
    add(loft([
      { x: 0.52, y: 0.300, z: side * 0.60, w: 0.085, h: 0.170, n: 2.8 },
      { x: 0.20, y: 0.315, z: side * 0.70, w: 0.190, h: 0.225, n: 3.2 },
      { x: -0.30, y: 0.325, z: side * 0.735, w: 0.235, h: 0.250, n: 3.4 },
      { x: -0.85, y: 0.315, z: side * 0.680, w: 0.205, h: 0.230, n: 3.2 },
      { x: -1.35, y: 0.295, z: side * 0.520, w: 0.120, h: 0.165, n: 3.0 },
      { x: -1.78, y: 0.280, z: side * 0.390, w: 0.045, h: 0.085, n: 2.6 },
    ], 20), paint);
    // The inlet itself, dark and recessed.
    const inletGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.05, 14);
    inletGeo.rotateZ(Math.PI / 2);
    inletGeo.translate(0.54, 0.305, side * 0.60);
    add(inletGeo, carbonMatt);
  }

  // Floor and the edge wing along it.
  const floor = new THREE.Shape();
  floor.moveTo(1.55, 0.30); floor.lineTo(0.55, 0.78); floor.lineTo(-1.10, 0.86);
  floor.lineTo(-1.95, 0.62); floor.lineTo(-2.10, 0.0);
  floor.lineTo(-1.95, -0.62); floor.lineTo(-1.10, -0.86); floor.lineTo(0.55, -0.78);
  floor.lineTo(1.55, -0.30); floor.lineTo(1.55, 0.30);
  const floorGeo = new THREE.ExtrudeGeometry(floor, { depth: 0.035, bevelEnabled: false });
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, 0.055, 0);
  add(floorGeo, carbon);

  // --- wings ---------------------------------------------------------------
  // Front: two elements, tips curled up, on endplates.
  const at = (geo, x, y, z) => { geo.translate(x, y, z); return geo; };
  // Collected so the renderer can stop drawing a wing the car has lost.
  const wings = { front: [], rear: [] };
  // Four elements, stacked and stepped back, which is what a modern front wing
  // is. Two thin blades read as a placeholder from any angle that matters.
  wings.front.push(
    add(at(wing(0.96, 0.40, 0.055, 0.060, -0.16, 0.080), 2.50, 0.100, 0), carbon),
    add(at(wing(0.95, 0.30, 0.048, 0.055, -0.22, 0.082), 2.34, 0.160, 0), carbon),
    add(at(wing(0.93, 0.24, 0.042, 0.050, -0.28, 0.080), 2.22, 0.215, 0), paint),
    add(at(wing(0.90, 0.18, 0.036, 0.045, -0.34, 0.076), 2.12, 0.262, 0), carbon));
  // the two pylons hanging the nose off the wing
  for (const side of [1, -1]) {
    add(at(new THREE.BoxGeometry(0.34, 0.20, 0.030), 2.18, 0.20, side * 0.11), carbon);
  }
  for (const side of [1, -1]) {
    // Aligned with the wing it is bolted to, not floating behind it.
    wings.front.push(
      add(at(new THREE.BoxGeometry(0.68, 0.34, 0.024), 2.34, 0.185, side * 0.975), paint),
      add(at(new THREE.BoxGeometry(0.26, 0.11, 0.02), 2.56, 0.335, side * 0.935), carbon));
  }

  // Rear: main plane and a DRS flap that really opens, on a swan neck.
  const drs = add(at(wing(0.50, 0.19, 0.028, 0.045, 0, 0), -2.60, 0.945, 0), carbon);
  wings.rear.push(add(at(wing(0.52, 0.30, 0.036, 0.05, 0, 0), -2.44, 0.845, 0), carbon), drs);
  for (const side of [1, -1]) {
    wings.rear.push(add(at(new THREE.BoxGeometry(0.58, 0.44, 0.02), -2.50, 0.83, side * 0.53), paint));
  }
  add(loft([
    { x: -1.95, y: 0.44, w: 0.045, h: 0.085, n: 2.6 },
    { x: -2.25, y: 0.66, w: 0.040, h: 0.075, n: 2.6 },
    { x: -2.44, y: 0.80, w: 0.035, h: 0.060, n: 2.6 },
  ], 12), carbon);
  add(at(wing(0.42, 0.20, 0.03, 0.04, 0, 0), -2.30, 0.38, 0), carbon);

  // --- halo, cockpit, driver ----------------------------------------------
  const halo = new THREE.TorusGeometry(0.40, 0.032, 10, 26, Math.PI * 1.08);
  halo.rotateY(Math.PI / 2);
  halo.rotateZ(-Math.PI / 2 - 0.54);
  add(at(halo, -0.22, 0.60, 0), carbonMatt);
  add(at(new THREE.CylinderGeometry(0.030, 0.038, 0.30, 8), 0.36, 0.50, 0), carbonMatt);
  // roll hoop behind the airbox intake
  add(at(new THREE.TorusGeometry(0.16, 0.028, 8, 16, Math.PI), -0.56, 0.60, 0), carbonMatt);

  const headGeo = new THREE.SphereGeometry(0.135, 16, 12);
  headGeo.scale(1.12, 1, 0.94);
  add(at(headGeo, -0.30, 0.575, 0), helmetMat);
  const visGeo = new THREE.SphereGeometry(0.137, 16, 10, -0.6, 1.2, 0.9, 0.7);
  visGeo.rotateY(Math.PI / 2);
  visGeo.scale(1.12, 1, 0.94);
  add(at(visGeo, -0.30, 0.575, 0), visor);

  // --- suspension ----------------------------------------------------------
  // Aerofoil-section wishbones, which is what they really are.
  const armGeo = new THREE.BoxGeometry(0.78, 0.022, 0.055);
  for (const side of [1, -1]) {
    for (const [ax, zo] of [[1.80, 0.85], [-1.80, 0.80]]) {
      for (const [dy, tilt] of [[0.12, 0.10], [0.30, -0.08]]) {
        const arm = armGeo.clone();
        arm.rotateZ(tilt);
        arm.rotateY(side * 0.30);
        add(at(arm, ax - 0.42, 0.20 + dy, side * (zo - 0.30)), carbonMatt);
      }
    }
  }

  // --- wheels --------------------------------------------------------------
  // EACH FRONT WHEEL GETS ITS OWN PIVOT, at its own hub. See the note at the
  // top: one shared group rotating about the car's centre is what made the
  // whole axle appear to swing.
  const R = 0.36;
  const tyreF = tyre(R, 0.305), tyreR = tyre(R, 0.405);
  // The rim has to fit inside the tyre's BEAD, not inside its tread. The tyre
  // profile pinches to 55% of its width at the bore, so a rim as wide as the
  // tread pokes straight out through the sidewall — which is what the first
  // render showed, a bright cylinder sticking out of each wheel.
  // R * 0.585, not R * 0.545. The tyre's bore is at R * 0.58, so a rim any
  // narrower leaves a 13 mm annular gap all the way round the bead — and you
  // can see straight through the wheel. It has to overlap the bead, not meet
  // it.
  const BORE = R * 0.585;
  const rimGeo = (width) => {
    const w = width * 0.55;
    const g = new THREE.CylinderGeometry(BORE, BORE, w, 22);
    g.rotateX(Math.PI / 2);
    return g;
  };
  const faceGeo = (width, side) => {
    const g = new THREE.CircleGeometry(BORE, 22);
    g.rotateY(side > 0 ? 0 : Math.PI);
    g.translate(0, 0, side * width * 0.275);
    return g;
  };
  const rimF = rimGeo(0.305), rimR = rimGeo(0.405);

  const wheels = {}, steer = {};
  // +Z is the car's RIGHT — see the handedness note in geom.js. The old model
  // called the wheel at +Z "fl", which was harmless while they were identical
  // cylinders and is not once they steer by different amounts.
  for (const [key, ax, zo, tg, rg] of [
    ['fr', 1.80, 0.85, tyreF, rimF], ['fl', 1.80, -0.85, tyreF, rimF],
    ['rr', -1.80, 0.80, tyreR, rimR], ['rl', -1.80, -0.80, tyreR, rimR],
  ]) {
    const hub = new THREE.Object3D();
    hub.position.set(ax, R, zo);
    const w = new THREE.Mesh(tg, rubber);
    w.castShadow = true;
    w.add(new THREE.Mesh(rg, rimMat));
    // A wheel face each side, or you look straight through the hub.
    const width = key[0] === 'f' ? 0.305 : 0.405;
    for (const sd of [1, -1]) w.add(new THREE.Mesh(faceGeo(width, sd), hubMat));
    hub.add(w);
    g.add(hub);
    wheels[key] = w;
    if (key[0] === 'f') steer[key] = hub;
  }

  // --- stickers ------------------------------------------------------------
  const livery = liveryAtlas(primary);
  const decalMat = new THREE.MeshStandardMaterial({
    map: livery.texture, transparent: true, roughness: 0.22, metalness: 0.1,
    envMapIntensity: 1.1, side: THREE.DoubleSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6,
  });
  const stickers = [
    // sidepod flanks — the biggest flat panel on the car
    [livery.cells.podL, [-0.30, 0.36, 0.985], [0.95, 0.20], [0, 0.12, 1], [1, 0, 0]],
    [livery.cells.podR, [-0.30, 0.36, -0.985], [0.95, 0.20], [0, 0.12, -1], [-1, 0, 0]],
    // engine cover, read from behind
    [livery.cells.cover, [-1.05, 0.655, 0], [0.80, 0.17], [0, 1, 0], [0, 0, 1]],
    // rear wing, also read from behind
    [livery.cells.wing, [-2.47, 0.845, 0], [0.88, 0.14], [-1, 0, 0.1], [0, 0, 1]],
    // rear wing endplates
    [livery.cells.epL, [-2.50, 0.84, 0.545], [0.50, 0.13], [0, 0.05, 1], [1, 0, 0]],
    [livery.cells.epR, [-2.50, 0.84, -0.545], [0.50, 0.13], [0, 0.05, -1], [-1, 0, 0]],
    // nose flanks
    // ON the nose, not in it. At x = 1.45 the monocoque is 0.19 m half-width,
    // so a decal at z = 0.15 sat inside the solid body and the only thing
    // visible was the far-side one bleeding through.
    [livery.cells.title, [1.24, 0.258, 0.198], [0.52, 0.09], [0, 0.22, 1], [1, 0, 0]],
    [livery.cells.nose, [1.24, 0.258, -0.198], [0.52, 0.09], [0, 0.22, -1], [-1, 0, 0]],
    // the number, lying on the nose and read from in front
    [livery.cells.number, [2.02, 0.262, 0], [0.22, 0.22], [0.25, 1, 0], [0, 0, -1]],
  ];
  for (const [cell, at, size, n, along] of stickers) {
    const m = new THREE.Mesh(decal(livery, cell, at, size, n, along, false), decalMat);
    m.renderOrder = 2;
    g.add(m);
  }

  // ---- an imported chassis ------------------------------------------------
  //
  // A model downloaded from a 3D printing site replaces the BODYWORK and
  // nothing else. The wheels stay procedural because they have to turn and
  // spin, and a print model is one solid lump with the wheels welded on — so
  // an imported car keeps these wheels and hides its own.
  //
  // What you lose, stated plainly rather than discovered later: no livery, no
  // decals, no separate wings, and flat shading, because an STL carries
  // geometry and nothing else. No UVs means nothing can be painted on it. That
  // is a property of the format, not of this loader.
  if (chassis) {
    const keep = new Set(Object.values(wheels));
    g.traverse(m => { if (m.isMesh && !keep.has(m)) m.visible = false; });
    const mesh = new THREE.Mesh(chassis, paint);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.imported = true;
    g.add(mesh);
  }

  return { group: g, wheels, steer, drs, R, wings };
}
