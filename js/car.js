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
import { drawBrand, brandNamed } from './brands.js';
import { applyLivery } from './livery.js';

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
  // UVs in METRES — u along the car, v round the section — so a carbon weave
  // is the same size on the nose as on the sidepod.
  const uv = [];
  for (let k = 0; k < stations.length; k++) {
    const s = stations[k];
    let arc = 0;
    rings[k].forEach(([z, y], i) => {
      if (i) { const [pz, py] = rings[k][i - 1]; arc += Math.hypot(z - pz, y - py); }
      pos.push(s.x, s.y + y, (s.z || 0) + z);
      uv.push(s.x, arc);
    });
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
      uv.push(s.x, 0);
      for (let i = 0; i < segs; i++) {
        const a = k * segs + i, b = k * segs + ((i + 1) % segs);
        if (flip) idx.push(c, b, a); else idx.push(c, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A wing element: a cambered aerofoil swept across the span, with the tips
// curled up the way a real front wing is. Chord and angle vary across the span
// because a flat plank is the thing that makes a wing look like a placeholder.
function wing(span, chord, thick, camber, twistTip, rise, segs = 18) {
  const pos = [], idx = [], wuv = [];
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
      wuv.push(z, (j / sec) * c * 2);
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
  g.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A tyre, turned from a real cross-section: tread, shoulder, sidewall bulge,
// bead. A plain cylinder is the single most obvious thing about a toy car —
// real tyres are fatter in the middle of the sidewall than at the rim.
function tyre(radius, width, rimK = 0.58) {
  const r = radius, hw = width / 2, rim = radius * rimK;
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

// The same eight cells in the same order whoever draws them, so a TEAM's
// livery (js/field.js) is a different texture on the SAME geometry — the UVs
// are fixed by cell index. `team` is { fg, sp: [brand names] } from
// js/drivers.js; without one this is the player's own car, as it always was.
// `scale` halves a team atlas to 512 px: eleven of them at full size would be
// 44 MB of video memory for stickers.
export function liveryAtlas(primary, team = null, scale = 1) {
  const A = new Atlas(2, 8, 512 * scale, 128 * scale);
  const cells = {};
  const put = (key, text, fg) => {
    cells[key] = A.cell((g, w, h) => {
      g.clearRect(0, 0, w, h);
      const b = team && brandNamed(text);
      if (b) drawBrand(g, w, h, b, { bare: true, colour: team.fg });
      else fitText(g, text, w / 2, h / 2, w * 0.9, h * 0.78, { colour: fg, weight: '900' });
    });
  };
  // Title sponsor where it is seen most — sidepods, engine cover, rear wing —
  // the way a real title sponsor buys the car.
  const sp = team ? team.sp : SPONSORS;
  const T = sp[0], S1 = sp[1] || T, S2 = sp[2] || S1, S3 = sp[3] || S2;
  const order = team
    ? [['title', S1], ['podL', T], ['podR', T], ['cover', T], ['wing', T], ['epL', S2], ['epR', S3], ['nose', S1]]
    : [['title', SPONSORS[0]], ['podL', SPONSORS[1]], ['podR', SPONSORS[2]], ['cover', SPONSORS[3]],
       ['wing', SPONSORS[4]], ['epL', SPONSORS[5]], ['epR', SPONSORS[6]], ['nose', SPONSORS[7]]];
  const fgs = { cover: '#f2f2f2', epL: '#e9e9e9', epR: '#e9e9e9' };
  for (const [k, text] of order) put(k, text, fgs[k] || '#ffffff');
  const tex = A.texture();
  tex.premultiplyAlpha = false;
  return { atlas: A, cells, texture: tex };
}

// The race number: its own tiny texture, because it is the one thing on a car
// that differs between team-mates. A roundel on the nose; the number alone,
// outlined, on the endplates.
export function numberTexture(num, primary = '#d8352a', fg = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const txt = String(num);
  // left half: the nose roundel
  g.fillStyle = fg === '#ffffff' || fg === '#e8eaee' ? '#101014' : '#ffffff';
  g.beginPath(); g.arc(64, 64, 60, 0, 6.2832); g.fill();
  fitText(g, txt, 64, 66, 96, 80, { colour: fg === '#ffffff' || fg === '#e8eaee' ? '#ffffff' : '#101014' });
  // right half: the bare number
  g.lineWidth = 7; g.strokeStyle = '#101014'; g.lineJoin = 'round';
  g.font = 'italic 900 96px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.strokeText(txt, 192, 68); g.fillStyle = fg; g.fillText(txt, 192, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
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
// SURFACE DETAIL, drawn rather than photographed.
//
// Carbon: `look.mat('carbon')` asked the game's texture set for a photograph
// that was never in it (tex.js MATERIALS has no carbon), so every carbon part
// was flat blue-grey. A 2x2 twill is a regular weave, so it is drawn here —
// alternating tows, each shaded across its width the way a real tow catches
// light — and used as colour and bump. One canvas, shared by every car.
// ---------------------------------------------------------------------------
let _carbon = null;
function carbonTexture() {
  if (_carbon) return _carbon;
  const N = 256, T = 8, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const s = N / T;
  for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
    // 2x2 twill: the over/under pattern steps one tow per row.
    const warp = ((i + j) >> 1) % 2 === 0;
    const grd = warp ? g.createLinearGradient(i * s, 0, (i + 1) * s, 0) : g.createLinearGradient(0, j * s, 0, (j + 1) * s);
    grd.addColorStop(0, '#15161a'); grd.addColorStop(0.5, warp ? '#3a3d44' : '#2c2f35'); grd.addColorStop(1, '#15161a');
    g.fillStyle = grd;
    g.fillRect(i * s, j * s, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // UVs are metres: one tile of eight tows is 3 cm, near a real 3K twill.
  t.repeat.set(1 / 0.03, 1 / 0.03);
  _carbon = t;
  return t;
}

// The tyre wall. The Lathe's v runs across the profile (0 = the rim on one
// side, 1 = the rim on the other, the tread in the middle) and u runs round
// the wheel, so text drawn left-to-right is lettering round the sidewall. The
// coloured band is the compound, which is the first thing anyone reads on an
// F1 tyre from the grandstand. GRIPMAX is one of js/brands.js's invented names.
const COMPOUND = { soft: '#e3261c', medium: '#ffd21f', hard: '#f1f1f1', inter: '#2fb34a', wet: '#2a6fe0' };
const _tyreTex = new Map();
function tyreTexture(compound = 'medium') {
  if (_tyreTex.has(compound)) return _tyreTex.get(compound);
  const W = 2048, H = 128, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1b1e'; g.fillRect(0, 0, W, H);
  // tread: slightly lighter and smoother-looking, scrubbed
  g.fillStyle = '#26272b'; g.fillRect(0, H * 0.36, W, H * 0.28);
  const col = COMPOUND[compound] || COMPOUND.medium;
  // v=0 is the BOTTOM of the canvas (flipY). Each wall: stripe, then lettering.
  for (const [band, flip] of [[[0.14, 0.20], false], [[0.80, 0.86], true]]) {
    const y0 = H * (1 - band[1]), y1 = H * (1 - band[0]);
    g.fillStyle = col; g.fillRect(0, y0, W, y1 - y0);
    const ty = flip ? H * (1 - 0.73) : H * (1 - 0.27);
    g.save();
    g.translate(0, ty);
    if (flip) g.scale(-1, -1);
    g.font = 'italic 900 13px sans-serif'; g.textBaseline = 'middle';
    g.fillStyle = '#e9e9e9';
    for (let k = 0; k < 4; k++) {
      const x = (flip ? -1 : 1) * (k * W / 4 + 60);
      g.fillText('GRIPMAX', x, 0);
      g.fillStyle = col; g.fillText('P  RACE', x + 110 * (flip ? 1 : 1), 0); g.fillStyle = '#e9e9e9';
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _tyreTex.set(compound, t);
  return t;
}

// A rod between two points: a flattened cylinder, which is what a carbon
// wishbone is — an aerofoil section, thin edge-on.
function rod(a, b, r = 0.018, flat = 0.45) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r, r, len, 10);
  g.scale(1, 1, flat);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
// A tube through points (the halo).
function tube(points, r, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, 64, r, 10, closed);
}
// A flat plate cut to an outline in the car's side view (x, y), `thick` wide,
// centred on z. Endplates are shaped, not rectangles.
function plate(pts, thick, z) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.3, bevelSize: thick * 0.3, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, z - thick / 2);
  return g;
}

// ---------------------------------------------------------------------------
// THE SINGLE-SEATER (F1, and F4 on the same body).
//
// Adam, 2026-09-25: "make cars look so much better". The shapes below are a
// 2022-regulation car at real size: a nose that runs down onto a four-element
// wing whose flaps sweep up into shaped endplates, letterbox sidepod inlets
// with an undercut beneath and a ramp down the top, a proper halo, wishbones
// that actually join the chassis to the hubs, 18-inch wheels with covers, a
// swoop-top rear wing with a beam wing under it, and a rain light.
//
// `opts.livery` (js/livery.js) paints the team's colours in zones; its
// `second` colour is the helmet, a wing flap, the T-cam and the wheel-cover
// rings, handed back as `paint2` so js/field.js can repaint both per team.
// `opts.compound` colours the tyre walls.
// ---------------------------------------------------------------------------
export function buildCar(look, colour = 0xd8352a, chassis = null, opts = {}) {
  const g = new THREE.Group();
  const primary = '#' + new THREE.Color(colour).getHexString();

  const weave = carbonTexture();
  const carbon = new THREE.MeshPhysicalMaterial({
    map: weave, bumpMap: weave, bumpScale: 0.6, color: 0x70747c,
    roughness: 0.32, metalness: 0.1, clearcoat: 0.9, clearcoatRoughness: 0.12, envMapIntensity: 0.75,
    side: THREE.DoubleSide,
  });
  const carbonMatt = new THREE.MeshStandardMaterial({
    map: weave, color: 0x676b72, roughness: 0.6, metalness: 0.1, envMapIntensity: 0.55,
    side: THREE.DoubleSide,
  });
  // DoubleSide, all the bodywork: from the driver's eyes you are INSIDE the
  // tub looking at the back of its skin, and a one-sided skin seen from
  // behind is a window (Adam: "i can see through the car").
  const paint = new THREE.MeshPhysicalMaterial({
    color: colour, roughness: 0.3, metalness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.35,
    side: THREE.DoubleSide,
  });
  const paint2 = new THREE.MeshPhysicalMaterial({
    color: (opts.livery && opts.livery.second) || 0xf2f2f2, roughness: 0.3, metalness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.06, envMapIntensity: 1.35,
  });
  if (opts.livery) applyLivery(paint, opts.livery);
  // DoubleSide: from the cockpit you look DOWN the inside of the front tyres,
  // and a single-sided wall there is a window (Adam: "i can see through my
  // tires").
  const rubber = new THREE.MeshStandardMaterial({
    map: tyreTexture(opts.compound), roughness: 0.82, metalness: 0.0, envMapIntensity: 0.45,
    side: THREE.DoubleSide,
  });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.34, metalness: 0.75, envMapIntensity: 1.1 });
  const hubMat = new THREE.MeshStandardMaterial({
    color: 0x15161a, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.9, side: THREE.DoubleSide,
  });
  const nutMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.25, metalness: 0.95 });
  const black = new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0.7, envMapIntensity: 1.8 });
  const rainLight = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1a0a, emissiveIntensity: 1.4 });
  const mirrorMat = new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.02, metalness: 1, envMapIntensity: 2 });

  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    g.add(m);
    return m;
  };
  const at = (geo, x, y, z) => { geo.translate(x, y, z); return geo; };
  const mirrors = [];

  // --- the body ------------------------------------------------------------
  // The nose now runs all the way down to the wing (2022 rules), low and wide.
  const body = loft([
    { x: 2.66, y: 0.165, w: 0.090, h: 0.048, n: 2.6 },
    { x: 2.30, y: 0.190, w: 0.118, h: 0.068, n: 2.8 },
    { x: 1.90, y: 0.215, w: 0.145, h: 0.098, n: 3.0 },
    { x: 1.45, y: 0.250, w: 0.185, h: 0.140, n: 3.3 },
    { x: 0.90, y: 0.295, w: 0.250, h: 0.190, n: 3.5 },
    // THE COCKPIT DIP. The tub's skin drops to 0.44 m between the dash and the
    // seat back, so from the driver's eyes you look DOWN INTO a cockpit rather
    // than across the top of a closed tube (Adam: "make the car deeper so i
    // see the inside"). The walls, floor, dash and seat inside are below.
    { x: 0.42, y: 0.320, w: 0.300, h: 0.220, n: 3.7 },
    { x: 0.22, y: 0.270, w: 0.310, h: 0.170, n: 3.8 },
    { x: -0.60, y: 0.270, w: 0.330, h: 0.170, n: 3.8 },
    { x: -0.80, y: 0.378, w: 0.320, h: 0.290, n: 3.4 },
  ], 32);
  add(body, paint);
  // Engine cover: livery on top, the shape dropping away hard behind the pods.
  const bodyRear = loft([
    { x: -0.80, y: 0.378, w: 0.322, h: 0.292, n: 3.4 },
    { x: -1.30, y: 0.370, w: 0.270, h: 0.262, n: 3.2 },
    { x: -1.85, y: 0.345, w: 0.170, h: 0.180, n: 3.0 },
    { x: -2.30, y: 0.325, w: 0.080, h: 0.085, n: 2.5 },
  ], 32);
  add(bodyRear, paint);

  // Airbox over the driver's head, its intake a black hole rather than paint,
  // the shark fin behind it, and the T-cam on top in the second colour.
  add(loft([
    { x: -0.50, y: 0.62, w: 0.140, h: 0.120, n: 2.8 },
    { x: -0.78, y: 0.65, w: 0.170, h: 0.145, n: 3.0 },
    { x: -1.12, y: 0.60, w: 0.145, h: 0.115, n: 2.9 },
    { x: -1.60, y: 0.50, w: 0.070, h: 0.060, n: 2.6 },
  ], 24), paint);
  const intake = new THREE.CircleGeometry(1, 20);
  intake.rotateY(Math.PI / 2); intake.scale(1, 0.095, 0.105);
  add(at(intake, -0.495, 0.625, 0), black, false);
  add(plate([[-0.95, 0.66], [-1.20, 0.80], [-1.95, 0.78], [-2.20, 0.52], [-1.60, 0.46]], 0.012, 0), carbon);
  add(at(new THREE.BoxGeometry(0.10, 0.05, 0.075), -0.62, 0.795, 0), paint2);

  // SIDEPODS. Letterbox inlet high up, flat top ramping down to the floor at
  // the back, and daylight under the front of it — the undercut, which is the
  // shape every 2022+ car is recognised by.
  for (const side of [1, -1]) {
    add(loft([
      { x: 0.64, y: 0.455, z: side * 0.585, w: 0.150, h: 0.090, n: 5.0 },
      { x: 0.35, y: 0.420, z: side * 0.660, w: 0.225, h: 0.140, n: 4.6 },
      { x: -0.15, y: 0.405, z: side * 0.680, w: 0.235, h: 0.155, n: 4.2 },
      { x: -0.65, y: 0.360, z: side * 0.610, w: 0.205, h: 0.140, n: 3.8 },
      { x: -1.15, y: 0.300, z: side * 0.470, w: 0.125, h: 0.105, n: 3.2 },
      { x: -1.62, y: 0.255, z: side * 0.335, w: 0.050, h: 0.060, n: 2.6 },
    ], 28), paint);
    // the inlet mouth
    add(at(new THREE.BoxGeometry(0.012, 0.15, 0.27), 0.640, 0.455, side * 0.585), black, false);
    // MIRRORS, where a driver can see them: either side of the cockpit, just
    // inside the field of view from the driver's eyes. The glass is its own
    // mesh, facing back at the driver, so the renderer can put a real
    // reflection in it (render.js, _carMirrors).
    add(rod([0.46, 0.55, side * 0.28], [0.36, 0.625, side * 0.41], 0.010, 0.6), carbon);
    add(at(new THREE.BoxGeometry(0.06, 0.065, 0.15), 0.37, 0.635, side * 0.44), paint);
    const glass = new THREE.PlaneGeometry(0.13, 0.05);
    glass.rotateY(-Math.PI / 2 - side * 0.28);   // faces back, turned in toward the driver
    const gm = add(at(glass, 0.338, 0.635, side * 0.44), mirrorMat, false);
    gm.name = side > 0 ? 'mirror.R' : 'mirror.L';
    gm.userData.mirror = side;
    mirrors.push(gm);
  }

  // Floor: the whole underside, with its edge wing and a fence line.
  const floor = new THREE.Shape();
  floor.moveTo(1.55, 0.30); floor.lineTo(0.55, 0.80); floor.lineTo(-1.10, 0.88);
  floor.lineTo(-1.95, 0.64); floor.lineTo(-2.10, 0.0);
  floor.lineTo(-1.95, -0.64); floor.lineTo(-1.10, -0.88); floor.lineTo(0.55, -0.80);
  floor.lineTo(1.55, -0.30); floor.lineTo(1.55, 0.30);
  const floorGeo = new THREE.ExtrudeGeometry(floor, { depth: 0.03, bevelEnabled: false });
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.translate(0, 0.05, 0);
  add(floorGeo, carbon);
  for (const side of [1, -1]) {
    // the edge wing curling up at the floor's outer lip
    add(rod([0.40, 0.10, side * 0.80], [-1.05, 0.10, side * 0.88], 0.022, 0.35), carbon);
  }

  // --- wings ---------------------------------------------------------------
  const wings = { front: [], rear: [] };
  // Four elements. The flaps rise outboard and meet the endplate high; that
  // sweep is the one line on a modern front wing everyone recognises.
  wings.front.push(
    add(at(wing(0.99, 0.46, 0.034, 0.030, -0.10, 0.030), 2.53, 0.085, 0), carbon),
    add(at(wing(0.97, 0.26, 0.030, 0.030, -0.30, 0.100), 2.40, 0.140, 0), paint),
    add(at(wing(0.95, 0.20, 0.026, 0.025, -0.40, 0.150), 2.31, 0.185, 0), carbon),
    add(at(wing(0.92, 0.15, 0.022, 0.020, -0.50, 0.185), 2.23, 0.225, 0), paint2));
  for (const side of [1, -1]) {
    wings.front.push(add(plate([[2.82, 0.05], [2.22, 0.05], [2.16, 0.16], [2.24, 0.40],
      [2.44, 0.44], [2.64, 0.31], [2.80, 0.18]], 0.014, side * 0.985), paint));
  }

  // Rear: main plane and a DRS flap that really opens, endplates that roll
  // over into the wing tips, a beam wing below, swan necks, a rain light.
  const drs = add(at(wing(0.50, 0.19, 0.028, 0.045, 0, 0), -2.60, 0.945, 0), carbon);
  wings.rear.push(add(at(wing(0.52, 0.30, 0.036, 0.05, 0, 0), -2.44, 0.845, 0), paint), drs);
  for (const side of [1, -1]) {
    wings.rear.push(add(plate([[-2.22, 0.58], [-2.25, 0.92], [-2.34, 1.01], [-2.62, 1.03],
      [-2.77, 0.97], [-2.81, 0.70], [-2.70, 0.56]], 0.018, side * 0.53), paint));
    add(rod([-2.10, 0.40, side * 0.07], [-2.40, 0.80, side * 0.07], 0.016, 0.5), carbon);
  }
  add(at(wing(0.42, 0.18, 0.028, 0.035, 0, 0.02), -2.30, 0.380, 0), carbon);
  add(at(wing(0.40, 0.13, 0.022, 0.030, 0, 0.02), -2.42, 0.445, 0), carbon);
  add(at(new THREE.BoxGeometry(0.03, 0.05, 0.12), -2.335, 0.33, 0), rainLight, false);

  // --- halo, cockpit, driver ----------------------------------------------
  // THE HALO, OVER THE DRIVER'S HEAD. Adam, 2026-09-25, after two wrong
  // tries (it sat on the horizon, then I ghosted it): "I WANT IT TO EXIST AND
  // BE FULL OPACITY BUT I WANT THE DRIVERS VIEW, LOOKING THROUGH THE SIDES,
  // LIKE THE TOP IS AT THE TOP OF MY SIGHT". So the loop is high enough to
  // clear the eyes (car.js eye) by 14 cm and frames the top of the view, the
  // centre pillar splits the windscreen, and the road is through either side.
  const haloMat = carbon;
  const halo = [
    add(tube([[-0.58, 0.58, 0.26], [-0.40, 0.77, 0.30], [-0.05, 0.815, 0.26], [0.20, 0.82, 0.10],
      [0.23, 0.82, 0], [0.20, 0.82, -0.10], [-0.05, 0.815, -0.26], [-0.40, 0.77, -0.30], [-0.58, 0.58, -0.26]], 0.026), haloMat),
    add(tube([[0.23, 0.82, 0], [0.33, 0.67, 0], [0.43, 0.52, 0]], 0.028), haloMat),
  ];

  // THE TUB, inside. Carbon walls with painted outer skins, a carbon floor,
  // the dash bulkhead in front of the driver, and a seat. "just make like a
  // seat and the rest js carbon".
  const fabric = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.95, metalness: 0 });
  for (const side of [1, -1]) {
    const wall = [[0.24, 0.40], [0.24, 0.58], [-0.10, 0.60], [-0.62, 0.62], [-0.62, 0.40]];
    add(plate(wall, 0.012, side * 0.305), paint);
    add(plate(wall, 0.012, side * 0.285), carbon);
  }
  add(at(new THREE.BoxGeometry(0.86, 0.012, 0.58), -0.19, 0.445, 0), carbon, false);        // floor
  add(at(new THREE.BoxGeometry(0.03, 0.15, 0.58), 0.225, 0.515, 0), carbon);               // dash
  add(at(new THREE.BoxGeometry(0.03, 0.22, 0.58), -0.625, 0.51, 0), carbon);               // rear bulkhead
  add(at(new THREE.BoxGeometry(0.30, 0.05, 0.44), -0.42, 0.475, 0), fabric, false);          // seat base
  const back = new THREE.BoxGeometry(0.06, 0.24, 0.44);
  back.rotateZ(-0.25);
  add(at(back, -0.56, 0.60, 0), fabric, false);                                               // seat back
  // (A black ring round the cockpit opening used to sit here. From the
  // driver's eyes it read as a steering wheel in front of Adam's real one, and
  // the tub walls are the cockpit's edge now.)
  const cockpitRim = null;

  const headGeo = new THREE.SphereGeometry(0.135, 20, 14);
  headGeo.scale(1.12, 1, 0.94);
  const head = [add(at(headGeo, -0.30, 0.56, 0), paint2)];
  const visGeo = new THREE.SphereGeometry(0.137, 16, 10, -0.6, 1.2, 0.9, 0.7);
  visGeo.rotateY(Math.PI / 2);
  visGeo.scale(1.12, 1, 0.94);
  head.push(add(at(visGeo, -0.30, 0.56, 0), visor));

  // --- suspension ----------------------------------------------------------
  // Real geometry: each wishbone runs from two pick-ups on the chassis to one
  // on the upright, plus a pushrod. They used to be free-floating sticks.
  const R = 0.36;
  for (const side of [1, -1]) {
    for (const [ax, hubZ, chZ, chY0] of [[1.80, 0.80, 0.16, 0.20], [-1.80, 0.72, 0.26, 0.20]]) {
      const hz = side * (hubZ - 0.08);
      // lower wishbone (two legs), upper wishbone (two legs), pushrod
      add(rod([ax + 0.24, chY0, side * chZ], [ax, R - 0.10, hz]), carbonMatt);
      add(rod([ax - 0.24, chY0, side * chZ], [ax, R - 0.10, hz]), carbonMatt);
      add(rod([ax + 0.20, chY0 + 0.15, side * (chZ + 0.02)], [ax - 0.02, R + 0.10, hz]), carbonMatt);
      add(rod([ax - 0.22, chY0 + 0.15, side * (chZ + 0.02)], [ax - 0.02, R + 0.10, hz]), carbonMatt);
      add(rod([ax - 0.05, R - 0.08, hz], [ax - 0.40 * Math.sign(ax), chY0 + 0.26, side * (chZ - 0.04)], 0.014, 0.9), carbonMatt);
    }
  }

  // --- wheels --------------------------------------------------------------
  // 18-inch rims since 2022: the tyre wall is far shallower than it was. A
  // wheel COVER on the outside, a ring of paint on it, and the wheel nut.
  const RIMK = 0.64;
  const tyreF = tyre(R, 0.305, RIMK), tyreR = tyre(R, 0.405, RIMK);
  const BORE = R * (RIMK + 0.005);
  const rimGeo = (width) => {
    const gg = new THREE.CylinderGeometry(BORE, BORE, width * 0.55, 28, 1, true);
    gg.rotateX(Math.PI / 2);
    return gg;
  };
  const faceGeo = (width, side) => {
    const gg = new THREE.CircleGeometry(BORE, 28);
    gg.rotateY(side > 0 ? 0 : Math.PI);
    gg.translate(0, 0, side * width * 0.275);
    return gg;
  };
  const ringGeo = (width, side) => {
    const gg = new THREE.RingGeometry(BORE * 0.70, BORE * 0.80, 28);
    gg.rotateY(side > 0 ? 0 : Math.PI);
    gg.translate(0, 0, side * (width * 0.275 + 0.002));
    return gg;
  };
  const nutGeo = (width, side) => {
    const gg = new THREE.CylinderGeometry(0.035, 0.04, 0.03, 12);
    gg.rotateX(Math.PI / 2);
    gg.translate(0, 0, side * (width * 0.275 + 0.012));
    return gg;
  };
  const rimF = rimGeo(0.305), rimR = rimGeo(0.405);

  const wheels = {}, steer = {}, hubs = {};
  // +Z is the car's RIGHT — see the handedness note in geom.js.
  for (const [key, ax, zo, tg, rg] of [
    ['fr', 1.80, 0.85, tyreF, rimF], ['fl', 1.80, -0.85, tyreF, rimF],
    ['rr', -1.80, 0.80, tyreR, rimR], ['rl', -1.80, -0.80, tyreR, rimR],
  ]) {
    const hub = new THREE.Object3D();
    hub.position.set(ax, R, zo);
    const w = new THREE.Mesh(tg, rubber);
    w.castShadow = true;
    w.add(new THREE.Mesh(rg, rimMat));
    const width = key[0] === 'f' ? 0.305 : 0.405;
    for (const sd of [1, -1]) {
      w.add(new THREE.Mesh(faceGeo(width, sd), hubMat));
      w.add(new THREE.Mesh(ringGeo(width, sd), paint2));
      w.add(new THREE.Mesh(nutGeo(width, sd), nutMat));
    }
    hub.add(w);
    g.add(hub);
    wheels[key] = w; hubs[key] = hub;
    if (key[0] === 'f') steer[key] = hub;
  }

  // --- stickers ------------------------------------------------------------
  const livery = liveryAtlas(primary);
  // The number has its own material so js/field.js can give every rival its
  // own number without a per-car sticker atlas.
  const numMat = new THREE.MeshStandardMaterial({
    map: numberTexture(78, primary), transparent: true, roughness: 0.22, metalness: 0.1,
    // FrontSide: a sticker on the far side of the car faces away from you and
    // must not be drawn. DoubleSide plus the polygon offset let it punch
    // through thin bodywork, mirror-written (VELOCITA read ATICOLEV).
    envMapIntensity: 1.1, side: THREE.FrontSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6,
  });
  // UV halves of the number texture: [0] the roundel, [1] the bare number.
  const half = (k, flip) => {
    const u0 = k * 0.5 + 0.002, u1 = k * 0.5 + 0.498, a = flip ? u1 : u0, b = flip ? u0 : u1;
    return [[a, 0.01], [b, 0.01], [b, 0.99], [a, 0.99]];
  };
  const decalMat = new THREE.MeshStandardMaterial({
    map: livery.texture, transparent: true, roughness: 0.22, metalness: 0.1,
    // FrontSide: a sticker on the far side of the car faces away from you and
    // must not be drawn. DoubleSide plus the polygon offset let it punch
    // through thin bodywork, mirror-written (VELOCITA read ATICOLEV).
    envMapIntensity: 1.1, side: THREE.FrontSide, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6,
  });
  const stickers = [
    // sidepod flanks — the biggest flat panel on the car
    [livery.cells.podL, [-0.18, 0.40, 0.915], [0.80, 0.16], [0, 0.10, 1], [1, 0, 0]],
    [livery.cells.podR, [-0.18, 0.40, -0.915], [0.80, 0.16], [0, 0.10, -1], [-1, 0, 0]],
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
  ];
  for (const [cell, at, size, n, along] of stickers) {
    const m = new THREE.Mesh(decal(livery, cell, at, size, n, along, false), decalMat);
    m.renderOrder = 2;
    g.add(m);
  }
  // Numbers: the roundel lying on the nose, read from in front, and the bare
  // number low on each rear-wing endplate, where a real car carries it.
  const numbers = [
    [0, [2.02, 0.262, 0], [0.22, 0.22], [0.25, 1, 0], [0, 0, -1]],
    [1, [-2.50, 0.66, 0.545], [0.34, 0.17], [0, 0.05, 1], [1, 0, 0]],
    [1, [-2.50, 0.66, -0.545], [0.34, 0.17], [0, 0.05, -1], [-1, 0, 0]],
  ];
  for (const [k, at, size, n, along] of numbers) {
    const geo = decal({ atlas: { uv: () => half(k, false) } }, 0, at, size, n, along, false);
    const m = new THREE.Mesh(geo, numMat);
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

  // Where the driver's eyes are, for the first-person camera. A single-seater
  // sits low and far back, behind the halo.
  return { group: g, wheels, steer, hubs, drs, R, wings, eye: [-0.22, 0.68, 0], decalMat, numMat, paint2, paint, mirrors, head, cockpitRim, haloMat };
}

// ---------------------------------------------------------------------------
// A GT3 CAR.
//
// Closed cockpit, 4.60 x 2.05 m, wheels inside arches, a wing on swan necks —
// the shape the aero map in tools/aerobake.mjs (buildHullGT) is solved from,
// and nothing like the single-seater above. Same bundle out, so the renderer,
// the field and the builder treat both cars identically.
//
// The lofts run nose-to-tail like buildCar's, for the same winding reason.
// ---------------------------------------------------------------------------
export function buildGT3(look, colour = 0x2f6fe0) {
  const g = new THREE.Group();
  const add = (geo, mat, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    g.add(m);
    return m;
  };
  const at = (geo, x, y, z) => { geo.translate(x, y, z); return geo; };

  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.18, metalness: 0.2, envMapIntensity: 1.5 });
  const carbon = look.mat('carbon', { size: 0.26, tint: 0x24262b, roughness: 0.38, metalness: 0.2, env: 1.2 });
  const matt = look.mat('carbon', { size: 0.22, tint: 0x15171a, roughness: 0.7, metalness: 0.1, env: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1116, roughness: 0.08, metalness: 0.5, envMapIntensity: 2.0 });
  const rubber = look.mat('carbon', { size: 0.5, tint: 0x15161a, roughness: 0.93, metalness: 0, env: 0.35 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x74787e, roughness: 0.36, metalness: 0.9, envMapIntensity: 1.1 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.42, metalness: 0.7, side: THREE.DoubleSide });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xdfe8f2, emissive: 0xbfd4ee, emissiveIntensity: 0.8, roughness: 0.15 });

  // --- the tub: the body between the arches --------------------------------
  add(loft([
    { x: 2.30, y: 0.38, w: 0.62, h: 0.20, n: 3.0 },     // nose
    { x: 1.70, y: 0.44, w: 0.76, h: 0.30, n: 3.2 },
    { x: 0.95, y: 0.50, w: 0.80, h: 0.39, n: 3.4 },     // scuttle
    { x: 0.10, y: 0.54, w: 0.82, h: 0.44, n: 3.5 },
    { x: -0.85, y: 0.54, w: 0.82, h: 0.44, n: 3.5 },
    { x: -1.65, y: 0.50, w: 0.80, h: 0.38, n: 3.4 },
    { x: -2.20, y: 0.46, w: 0.70, h: 0.30, n: 3.2 },    // tail
    { x: -2.30, y: 0.44, w: 0.60, h: 0.24, n: 3.0 },
  ]), paint);

  // --- greenhouse: screen, roof, rear screen -------------------------------
  add(loft([
    { x: 1.05, y: 0.74, w: 0.66, h: 0.16, n: 3.6 },
    { x: 0.45, y: 0.94, w: 0.62, h: 0.30, n: 4.0 },     // screen top
    { x: -0.35, y: 1.02, w: 0.60, h: 0.30, n: 4.4 },    // roof
    { x: -1.00, y: 0.96, w: 0.60, h: 0.28, n: 4.0 },
    { x: -1.55, y: 0.74, w: 0.62, h: 0.16, n: 3.6 },
  ]), glass);
  // the roof panel itself is painted, not glass
  add(at(new THREE.BoxGeometry(1.5, 0.05, 1.12), -0.25, 1.30, 0), paint);

  // --- four arches ---------------------------------------------------------
  for (const [ax, zo, big] of [[1.50, 0.86, 0], [1.50, -0.86, 0], [-1.45, 0.88, 1], [-1.45, -0.88, 1]]) {
    const w = big ? 0.26 : 0.24;
    add(at(loft([
      { x: ax + 0.72, y: 0.42, w, h: 0.22, n: 3.2 },
      { x: ax + 0.20, y: 0.60, w: w + 0.02, h: 0.42, n: 3.4 },
      { x: ax - 0.25, y: 0.60, w: w + 0.02, h: 0.42, n: 3.4 },
      { x: ax - 0.78, y: 0.44, w, h: 0.24, n: 3.2 },
    ]), 0, 0, zo), paint);
  }

  // --- splitter, diffuser, sills -------------------------------------------
  add(at(new THREE.BoxGeometry(0.62, 0.035, 1.98), 2.06, 0.075, 0), carbon);
  add(at(new THREE.BoxGeometry(0.30, 0.16, 1.90), 2.33, 0.30, 0), carbon);       // bumper
  add(at(new THREE.BoxGeometry(1.05, 0.05, 1.70), -1.90, 0.20, 0), carbon);      // diffuser roof
  for (const side of [1, -1]) {
    add(at(new THREE.BoxGeometry(2.2, 0.10, 0.18), 0, 0.22, side * 1.00), carbon);   // sill
    add(at(new THREE.BoxGeometry(0.34, 0.16, 0.06), 1.05, 0.92, side * 0.98), matt); // mirror stalk
    add(at(new THREE.BoxGeometry(0.10, 0.16, 0.28), 1.22, 0.95, side * 1.08), matt); // mirror
    add(at(new THREE.BoxGeometry(0.10, 0.16, 0.42), 2.24, 0.52, side * 0.52), lamp, false);
  }

  // --- the wing, on swan necks ---------------------------------------------
  const wings = { front: [], rear: [] };
  const wg = wing(0.98, 0.34, 0.035, 0.10, -0.18, 0.0);
  wings.rear.push(add(at(wg, -2.12, 1.26, 0), carbon));
  for (const side of [1, -1]) {
    wings.rear.push(add(at(new THREE.BoxGeometry(0.34, 0.30, 0.04), -2.02, 1.10, side * 0.62), carbon));
    wings.rear.push(add(at(new THREE.BoxGeometry(0.40, 0.30, 0.03), -2.12, 1.30, side * 0.98), carbon));  // endplate
  }
  // a splitter is bodywork that can be torn off, like a front wing
  wings.front.push(...g.children.slice(-0));

  // --- wheels --------------------------------------------------------------
  // 0.34 m: GT3 rubber is shorter and much wider than an F1 tyre, and it sits
  // inside the arches rather than in clean air.
  const R = 0.34;
  const tyreF = tyre(R, 0.30), tyreR = tyre(R, 0.33);
  const BORE = R * 0.62;
  const rimGeo = width => {
    const gg = new THREE.CylinderGeometry(BORE, BORE, width * 0.55, 22);
    gg.rotateX(Math.PI / 2);
    return gg;
  };
  const faceGeo = (width, side) => {
    const gg = new THREE.CircleGeometry(BORE, 22);
    gg.rotateY(side > 0 ? 0 : Math.PI);
    gg.translate(0, 0, side * width * 0.275);
    return gg;
  };
  const rimF = rimGeo(0.30), rimR = rimGeo(0.33);
  const wheels = {}, steer = {}, hubs = {};
  for (const [key, ax, zo, tg, rg, width] of [
    ['fr', 1.50, 0.84, tyreF, rimF, 0.30], ['fl', 1.50, -0.84, tyreF, rimF, 0.30],
    ['rr', -1.45, 0.86, tyreR, rimR, 0.33], ['rl', -1.45, -0.86, tyreR, rimR, 0.33],
  ]) {
    const hub = new THREE.Object3D();
    hub.position.set(ax, R, zo);
    const w = new THREE.Mesh(tg, rubber);
    w.castShadow = true;
    w.add(new THREE.Mesh(rg, rimMat));
    for (const sd of [1, -1]) w.add(new THREE.Mesh(faceGeo(width, sd), hubMat));
    hub.add(w);
    g.add(hub);
    wheels[key] = w; hubs[key] = hub;
    if (key[0] === 'f') steer[key] = hub;
  }

  // A GT3 driver sits further forward, higher, and on the left.
  return { group: g, wheels, steer, hubs, drs: null, R, wings, eye: [0.28, 0.88, -0.34] };
}
