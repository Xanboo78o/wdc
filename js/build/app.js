// app.js — the track builder page. Fly round the track like a Blender
// viewport; press Enter to drive the newest piece in the real car, on the real
// physics, with the real collision code.
import * as THREE from 'three';
import { buildPath, trackData, surfaceYAt, pointAt } from './path.js';
import { Ground } from './ground.js';
import { V, buildRoad, buildRunoff, buildLandmarks, buildGround, buildSky } from './meshes.js';
import { brandTexture, buildWalls, buildDetails, buildTunnels, buildViaducts, gantryBanner } from './dressing.js';
import { Track } from '../track.js';
import { CARS, makeCar, step, FIXED_DT, SURFACE, dragFor, registerAero, corneringSpeed, limitMu, topSpeed } from '../physics.js';
import { makeAero } from '../aero.js';
import { Hands, steerLock } from '../input.js';
import { resolveBarrier } from '../collide.js';
import { buildCar, buildGT3 } from '../car.js';
import { startDash, mountDashCard, onDash } from '../dash.js';
import { BuildLook, foldTerrainUVs, Horizon } from './look.js';
import { buildFlora } from './flora.js';
import { PropYard } from './propview.js';
import { Objects } from './objects.js';

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
// `q.has('flat')` is true for ?flat=0, so the obvious way to turn a flag OFF
// turned it ON. It cost the other session a screenshot of an empty world that
// looked perfectly plausible — "flora": null in the stats was the only tell.
// Every switch in this file goes through here now: present and not 0/false/off.
const on = (name) => {
  if (!q.has(name)) return false;
  const v = (q.get(name) || '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
};
const t0 = performance.now();

// The track file is imported fresh on every load, so a new piece shows up on
// a plain reload instead of hiding behind the browser's module cache.
const { TRACK, PIECES } = await import(`../../data/build/pieces.js?t=${Date.now()}`);
const path = buildPath(PIECES, { closed: !!TRACK.closed });
const ground = new Ground(path);
const chunks = ground.chunks();
const buildMs = performance.now() - t0;

// ---------------------------------------------------------------------------
// HOW HARD TO WORK THE GPU  —  ?q=low | med | high
//
// The look pass shipped at three frames a second on Adam's laptop and not one
// of my headless numbers had said so: swiftshader is frame-limited anyway, so
// every screenshot proved a thing RENDERS and nothing about whether it runs.
// These are the dials that actually cost, in the order they cost:
//
//   dpr        FRAGMENTS. devicePixelRatio 2 on a laptop screen is four times
//              the pixels of 1.0, and every one of them runs the terrain
//              shader and whatever alpha-tested leaves are in front of it.
//              This is the single biggest lever in the file.
//   aa         4x MSAA on top of that.
//   shadows    a shadow map is a second draw of everything that casts.
//   land       how many photographs the ground blends per pixel.
//   trees      how many are planted, and the fringe of grass at the verge.
//
// `med` is the default and is meant to hold 30 on a laptop; `high` is what
// screenshots are taken at.
// ---------------------------------------------------------------------------
const QUALITY = {
  low:  { dpr: 0.8,  aa: false, shadows: false, shadowMap: 1024, shadowBox: 60, land: 'simple', trees: 0.5, fringe: false, env: false, soft: 0, every: 1, far: 320 },
  med:  { dpr: 0.9,  aa: false, shadows: true,  shadowMap: 1024, shadowBox: 55, land: 'simple', trees: 0.8, fringe: true, env: true, soft: 1, every: 2, far: 400 },
  high: { dpr: 1.75, aa: true,  shadows: true,  shadowMap: 2048, shadowBox: 110, land: 'full', trees: 1.3, fringe: true, env: true, soft: 2, every: 1, far: 700 },
};
const QK = QUALITY[q.get('q')] ? q.get('q') : 'med';
const QN = QUALITY[QK];

// ---------------------------------------------------------------------------
// renderer, light, sky
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $('cv'), antialias: QN.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, QN.dpr));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !on('lo');
// PCFSoft takes many taps per pixel of every shadowed surface. It is the
// prettiest and it is not free, so it is the top setting only.
renderer.shadowMap.type = [THREE.BasicShadowMap, THREE.PCFShadowMap, THREE.PCFSoftShadowMap][QN.soft];
// The shadow pass is a second draw of every caster. The sun does not move and
// the world mostly does not either, so redrawing that map every OTHER frame is
// half the cost and nobody can see the difference at 30 fps.
if (QN.every > 1) renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.25, 12000);

// The builder started life as Blender's solid viewport — flat colours, a
// gradient dome, one light — and ?flat still is exactly that, byte for byte,
// because every screenshot taken before the look pass was taken that way.
// Everything else is photographed: real asphalt, real grass, and a real sky
// that the sun direction, sun colour and fog were MEASURED out of rather than
// picked to match it.
const FLAT = on('flat');
const LOOK = await BuildLook.load(renderer, { flat: FLAT, sky: q.get('sky') });
let follow;
if (LOOK.on) {
  LOOK.install(scene, { shadows: QN.shadows && !on('lo'), shadowMap: QN.shadowMap, shadowBox: QN.shadowBox, env: QN.env });
  follow = f => LOOK.follow(f);
} else {
  follow = flatViewport();
}

function flatViewport() {
  const sunDir = new THREE.Vector3(-0.55, 0.62, 0.42).normalize();
  scene.add(buildSky(sunDir));
  scene.fog = new THREE.FogExp2(0xc6d2dc, 0.00021);
  {
    // light the world with the sky itself: one PMREM render of the dome
    const skyScene = new THREE.Scene();
    skyScene.add(buildSky(sunDir));
    const pmrem = new THREE.PMREMGenerator(renderer);
    // far = 20000: the dome is 9000 m out, and fromScene's default far plane of
    // 100 m clips it away and hands back a black environment — which looks like
    // "everything in shadow is black", not like an error.
    scene.environment = pmrem.fromScene(skyScene, 0.04, 0.1, 20000).texture;
    scene.environmentIntensity = 0.32;
  }
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const SH = 160;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 1600 });
  sun.shadow.normalBias = 0.06;
  sun.shadow.bias = -0.0002;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xdbe6f2, 0x5d5a48, 0.12));
  return (focus) => {
    sun.position.copy(focus).addScaledVector(sunDir, 700);
    sun.target.position.copy(focus);
  };
}

const TERRAIN = LOOK.terrain({ land: QN.land });
const LAND = buildGround(chunks, TERRAIN);
// Fold the land's UVs into one tile-period block. Terrain UVs are world metres
// and run to +-5,400 here; folding them per vertex (the grid lines up exactly
// with the period, so it stays continuous) means the shader can sample with a
// plain texture read instead of mod + textureGrad, which is three fewer
// instructions on every pixel of the ground — and the ground is most of the
// screen.
foldTerrainUVs(LAND);
scene.add(LAND);
// How far you can see FROM THE CAR. Flying keeps the whole circuit, because
// from the air seeing the shape of it is the entire point; driving clips hard
// and hides the cut behind a horizon wall (js/build/look.js). ?far=0 turns it
// off, ?far=600 sets it by hand.
const horizon = new Horizon(LOOK, scene);
const FAR = q.has('far') ? Number(q.get('far')) : QN.far;

const ROADMATS = LOOK.road();
scene.add(buildRoad(path, ROADMATS));
// The band the physics calls run-off, drawn as run-off. Nothing without
// textures, so ?flat is unchanged.
scene.add(buildRunoff(path, ROADMATS?.apron));
const brand = brandTexture(renderer.capabilities.getMaxAnisotropy());
scene.add(buildWalls(path, ground, brand));
scene.add(buildDetails(path, ground, brand));
scene.add(buildTunnels(path));
scene.add(buildViaducts(path, ground));
const landmarks = buildLandmarks(path, ground);
scene.add(landmarks);
if (landmarks.userData.beam) scene.add(gantryBanner(brand, landmarks.userData.beam));

// Grass, and a forest planted from data/build/scenery.js. ?flat skips it so a
// screenshot stays comparable with the ones taken before any of this existed.
const tFlora = performance.now();
const flora = FLAT || on('noflora') ? null
  : await buildFlora(renderer, path, ground, LOOK, { trees: QN.trees, fringe: QN.fringe, shadows: QN.shadows });
if (flora) scene.add(flora.group);
const floraMs = performance.now() - tFlora;

// Loose objects: cones, tyre stacks, boards. Real bodies (js/props.js), so
// what happens to them when you arrive is not decided here.
const tProps = performance.now();
const yard = on('noprops') ? null : new PropYard(path, ground, LOOK, brand);
if (yard) { yard.populate(); scene.add(yard.group); }
const propMs = performance.now() - tProps;

// The world's THINGS: model files from data/kit, standing where
// data/build/objects.js says, each solid one handing the physics world a wall
// to collide with. Nothing here is worked out from the track at run time.
const tObj = performance.now();
const objects = FLAT || on('noobjects') ? null
  : await new Objects(scene, (x, y) => ground.height(x, y), yard ? yard.world : null).build();
const objMs = performance.now() - tObj;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// the piece list
// ---------------------------------------------------------------------------
const F1 = CARS.f1, MU = limitMu(F1);
function pieceLine(p) {
  const climb = p.climb ? ` · ${p.climb > 0 ? '+' : ''}${p.climb} m` : '';
  if (p.kind === 'straight') return `<b>${p.n}</b> STRAIGHT ${Math.round(p.len)} m${climb}`;
  const v = corneringSpeed(F1, p.radius, MU, p.bank) * 3.6;
  const fast = v >= topSpeed(F1) * 3.6 - 1 ? 'FLAT' : `${Math.round(v)} km/h`;
  return `<b>${p.n}</b> ${p.dir.toUpperCase()} ${p.angle}° · R${p.radius}${climb}${p.bank ? ` · bank ${p.bank}°` : ''} <i>${fast}</i>`;
}
$('trackName').textContent = TRACK.name || 'UNTITLED';
$('trackLen').textContent = `${(path.length / 1000).toFixed(2)} km · ${PIECES.length} piece${PIECES.length === 1 ? '' : 's'}`;
const newestN = ([...path.pieces].reverse().find(p => p.part) || path.pieces[path.pieces.length - 1]).n;
$('pieces').innerHTML = path.pieces.map(p =>
  `${p.part ? `<li class="part">${p.part.toUpperCase()}</li>` : ''}<li${p.n >= newestN ? ' class="new"' : ''}>${pieceLine(p)}${p.note ? `<small>${p.note}</small>` : ''}</li>`).join('');

// ---------------------------------------------------------------------------
// FLY — a Blender-style orbit camera
// ---------------------------------------------------------------------------
const fly = { target: new THREE.Vector3(), dist: 220, yaw: 0, pitch: 0.42, want: null };
function frameRange(s0, s1) {
  const i0 = Math.max(0, Math.floor(s0 / path.ds)), i1 = Math.min(path.n - 1, Math.ceil(s1 / path.ds));
  const box = new THREE.Box3();
  for (let i = i0; i <= i1; i++) box.expandByPoint(V(path.x[i], path.y[i], path.z[i]));
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  fly.target.copy(c);
  fly.dist = Math.max(90, Math.max(size.x, size.z) * 1.15);
  const mid = Math.floor((i0 + i1) / 2);
  // camera offset direction is (sin yaw, cos yaw) in three's x/z; straight
  // behind a car heading h is yaw = h - 90deg. This is behind and to the left.
  fly.yaw = path.hdg[mid] - Math.PI / 2 - 0.6;
  fly.pitch = 0.5;
}
// The newest PART: from the last piece that starts a named part (`part:` in
// pieces.js) to the end. One piece on its own is a part of one.
const last = path.pieces[path.pieces.length - 1];
const partStart = [...path.pieces].reverse().find(p => p.part) || last;
const newest = { n: partStart.n, s0: partStart.s0, s1: last.s1, name: partStart.part };
frameRange(Math.max(0, newest.s0 - 150), newest.s1 + 40);
if (q.has('cam')) {
  // ?cam=s,dist,yawDeg,pitchDeg  — yaw 0 = from behind, 90 = from the left
  const [s, d, yw, pt] = q.get('cam').split(',').map(Number);
  const i = Math.max(0, Math.min(path.n - 1, Math.round(s / path.ds)));
  fly.target.copy(V(path.x[i], path.y[i], path.z[i]));
  fly.dist = d || 60; fly.yaw = path.hdg[i] - Math.PI / 2 + (yw || 0) * Math.PI / 180; fly.pitch = (pt ?? 20) * Math.PI / 180;
}

let drag = null;
$('cv').addEventListener('contextmenu', e => e.preventDefault());
$('cv').addEventListener('pointerdown', e => {
  if (mode !== 'fly') return;
  drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
  $('cv').setPointerCapture(e.pointerId);
});
$('cv').addEventListener('pointerup', () => drag = null);
$('cv').addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (drag.pan) {
    const k = fly.dist * 0.0016;
    const cy = Math.cos(fly.yaw), sy = Math.sin(fly.yaw);
    fly.target.x -= (dx * cy + dy * sy) * k;
    fly.target.z -= (-dx * sy + dy * cy) * k;
  } else {
    fly.yaw -= dx * 0.005;
    fly.pitch = Math.max(0.03, Math.min(1.5, fly.pitch + dy * 0.004));
  }
});
$('cv').addEventListener('wheel', e => {
  if (mode !== 'fly') return;
  fly.dist = Math.max(4, Math.min(6000, fly.dist * Math.exp(e.deltaY * 0.0012)));
}, { passive: true });

const keys = new Set();
addEventListener('keydown', e => keys.add(e.code));
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function updateFly(dt) {
  const sp = fly.dist * 0.9 * dt * (keys.has('ShiftLeft') ? 3 : 1);
  const cy = Math.cos(fly.yaw), sy = Math.sin(fly.yaw);
  // camera looks along -(sin yaw, 0, cos yaw)
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  if (keys.has('KeyW')) { fly.target.x += fx * sp; fly.target.z += fz * sp; }
  if (keys.has('KeyS')) { fly.target.x -= fx * sp; fly.target.z -= fz * sp; }
  if (keys.has('KeyD')) { fly.target.x += rx * sp; fly.target.z += rz * sp; }
  if (keys.has('KeyA')) { fly.target.x -= rx * sp; fly.target.z -= rz * sp; }
  if (keys.has('KeyE')) fly.dist = Math.max(4, fly.dist * (1 - dt * 1.5));
  if (keys.has('KeyQ')) fly.dist = Math.min(6000, fly.dist * (1 + dt * 1.5));
  // the orbit point rides on the ground
  const gy = ground.cameraFloor(fly.target.x, -fly.target.z);
  fly.target.y += (gy - fly.target.y) * Math.min(1, dt * 6);
  const cp = Math.cos(fly.pitch);
  camera.position.set(
    fly.target.x + Math.sin(fly.yaw) * cp * fly.dist,
    fly.target.y + Math.sin(fly.pitch) * fly.dist,
    fly.target.z + Math.cos(fly.yaw) * cp * fly.dist);
  const floor = ground.cameraFloor(camera.position.x, -camera.position.z) + 1.5;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(fly.target);
}

// ---------------------------------------------------------------------------
// DRIVE — the game's own car, physics, input and barriers on this road
// ---------------------------------------------------------------------------
let mode = 'fly';
const hands = new Hands();
hands.attach();
// The phone stopped being the wheel when the iPad became the dash (js/dash.js,
// "The iPad is the dash"); js/main.js moved over and the builder did not, so it
// was still importing the deleted js/phonewheel.js and build.html would not
// load at all. Same move as main.js: no phone wheel source, just the dash.
startDash();
mountDashCard($('info'), { compact: true });
let track = null, car = null, carView = null, hint = 0, spawnS = 0, lastSpeedProfile = null;
const CAMS = ['FIRST PERSON', 'CHASE', 'FAR CHASE'];
// ?view=chase|far picks the drive camera without pressing C (headless shots)
let driveCam = Math.max(0, CAMS.indexOf({ chase: 'CHASE', far: 'FAR CHASE', first: 'FIRST PERSON' }[q.get('view')] || 'FIRST PERSON'));

async function loadAero() {
  for (const k of ['f1', 'f4', 'gt3']) {
    try {
      const r = await fetch(`./data/aero/${k}.json`);
      if (r.ok) registerAero(k, makeAero(await r.json()));
    } catch { /* the constants still drive */ }
  }
}
const aeroReady = loadAero();

function makeTrack() {
  const t = new Track(trackData(path, TRACK.name));
  // Track works out heading and curvature from each sample's neighbours and
  // wraps the ends round to meet — right for a finished circuit, wrong for
  // one that is still being built. The path knows them exactly: use those.
  t.hdg.set(path.hdg);
  t.curv.set(path.k);
  // bank in degrees, magnitude; the sign comes from curvature, as in the game
  t.bank = Float32Array.from(path.bank);
  return t;
}

// What speed would you be doing here, on a lap from the start? Grip-limited
// corner speeds, braked back from and accelerated forward to — coarse, but it
// means "drive the newest piece" starts you at a speed that means something.
function speedProfile(spec) {
  const n = path.n, v = new Float64Array(n), top = topSpeed(spec), mu = limitMu(spec);
  for (let i = 0; i < n; i++) v[i] = Math.abs(path.k[i]) > 1e-4 ? Math.min(top, corneringSpeed(spec, 1 / Math.abs(path.k[i]), mu, path.bank[i])) : top;
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * 26 * path.ds));
  v[0] = 0;
  for (let i = 1; i < n; i++) {
    const a = Math.max(0.5, 11 * (1 - v[i - 1] / top));
    v[i] = Math.min(v[i], Math.sqrt(v[i - 1] ** 2 + 2 * a * path.ds));
  }
  return v;
}

function spawn(s) {
  const i = Math.max(0, Math.min(path.n - 2, Math.round(s / path.ds)));
  const v = s <= 12 ? 0 : lastSpeedProfile[i] * 0.94;   // at the line: a standing start
  const p = pointAt(path, i, 0);
  Object.assign(car, {
    x: p.x, y: p.y, hdg: path.hdg[i], vx: Math.max(0.001, v), vy: 0, r: 0, ax: 0, ay: 0,
    delta: 0, throttle: 0, brake: 0, drsOpen: false, damage: 0,
    crush: { front: 0, rear: 0, left: 0, right: 0 }, dents: [], lost: null,
    z: 0, vz: 0, pitch: 0, roll: 0, pRate: 0, rRate: 0, airborne: false, onRoof: false,
    inContact: false, wheelZ: [0, 0, 0, 0], gripF: 1, gripR: 1,
  });
  car.tyre.Tf = 85; car.tyre.Tr = 85;
  hint = i;
  hands.wheel = 0;
  camSmooth = null;
}

const look = {
  // buildCar asks for photographed materials; this builder is untextured, so
  // every "texture" is its tint.
  mat: (_name, o = {}) => new THREE.MeshStandardMaterial({
    color: o.tint ?? 0x333333, roughness: o.roughness ?? 0.6, metalness: o.metalness ?? 0,
    envMapIntensity: o.env ?? 1,
  }),
};

async function startDrive() {
  await aeroReady;
  const cls = CARS[q.get('car')] ? q.get('car') : 'f1';       // ?car=gt3|f4|f1
  if (!track) track = makeTrack();
  if (!car) {
    car = makeCar({ cls });
    lastSpeedProfile = speedProfile(car.spec);
    const built = cls === 'gt3' ? buildGT3(look, 0x2f6fe0) : buildCar(look, 0xd8352a);
    const yaw = new THREE.Group(), att = new THREE.Group();
    yaw.add(att); att.add(built.group);
    built.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(yaw);
    carView = { yaw, att, body: built.group, wheels: built.wheels, steer: built.steer, R: built.R, spin: 0,
      eye: built.eye || [-0.22, 0.95, 0] };
  }
  // 12 m in, so the car is on the road rather than half on the grass before it
  // THE START LINE, not the newest piece. The builder began as "drive into
  // the corner you just laid", which is right while you are laying one and
  // wrong once there is a track: you want to arrive at it the way you will in
  // the game, from the straight. ?spawn=newest is the old behaviour, and
  // ?spawn=<metres> starts anywhere.
  const want = q.get('spawn');
  spawnS = want === 'newest' ? Math.max(12, newest.s0 - 350)
    : Number.isFinite(+want) && want !== null && want !== '' ? Math.max(0, +want)
    : 12;
  // ...and never inside a tunnel: starting in the dark, mid-corner, with no
  // idea which way the road goes is not a run-up to anything. Back out to
  // 60 m before the portal.
  if (path.tunIn) {
    let i = Math.round(spawnS / path.ds);
    while (i > 6 && path.tunIn[i] > 0) i--;
    if (i !== Math.round(spawnS / path.ds)) spawnS = Math.max(12, (i - 30) * path.ds);
  }
  spawn(spawnS);
  mode = 'drive';
  acc = 0;
  document.body.classList.add('driving');
  // Say where you ARE, not where the newest piece is. It announced "DRIVING
  // INTO THE SNAIL" while sitting on the start line, which is the kind of
  // small lie that makes you doubt the rest of the screen.
  const from = [...path.pieces].reverse().find(p2 => p2.part && p2.s0 <= spawnS);
  toast((spawnS <= 40 ? 'FROM THE LINE'
    : from ? `DRIVING INTO ${from.part.toUpperCase()}`
    : `DRIVING FROM ${Math.round(spawnS)} m`) + ' — C FOR CAMERA');
}
function stopDrive() {
  mode = 'fly';
  document.body.classList.remove('driving');
  if (carView) {
    fly.target.copy(carView.yaw.position);
    fly.yaw = Math.atan2(camera.position.x - fly.target.x, camera.position.z - fly.target.z);
    fly.dist = 40; fly.pitch = 0.35;
  }
}

let acc = 0, camSmooth = null, msgT = 0;
function toast(m) { $('msg').textContent = m; msgT = 2.4; }
{
  let was = false;
  onDash(d => { if (d.connected !== was) toast(d.connected ? 'DASH CONNECTED' : 'DASH LOST'); was = d.connected; });
}

function driveStep(frame) {
  acc += frame;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 240) {
    acc -= FIXED_DT; steps++;
    const inp = hands.update(FIXED_DT);
    car.throttle = inp.throttle; car.brake = inp.brake;
    car.delta = inp.wheel * steerLock(car.speed);
    const proj = track.project(car.x, car.y, hint);
    hint = proj.i;
    const al = Math.abs(proj.lat);
    let surface = SURFACE.track;
    if (al > proj.w + proj.run) surface = SURFACE.grass;
    else if (al > proj.w + 1.2) surface = SURFACE.runoff;
    else if (al > proj.w) surface = SURFACE.kerb;
    step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv), rollMul: dragFor(surface) });
    const hit = resolveBarrier(car, track, hint);
    // Loose objects are resolved in the same substep as the barriers, at 400
    // Hz. At frame rate a cone is 2 m further on between tests, which is more
    // than its own diameter: it would be hit while already behind the car.
    if (yard) yard.step(FIXED_DT, car);
    if (hit && hit.closing > 3.5) {
      hands.rumble(Math.min(1, hit.closing / 14), 0.5, 160);
      toast(hit.harm > 0.12 ? `HEAVY CONTACT — ${hit.part.toUpperCase()}` : 'CONTACT');
    }
    if (!path.closed && proj.i >= path.n - 3) {
      toast('END OF THE TRACK SO FAR');
      spawn(spawnS);
      break;
    }
  }
  hands.endFrame();
}

function placeCar(dt) {
  const proj = track.project(car.x, car.y, hint);
  const s = proj.i * path.ds;
  const lat = proj.lat;
  const hy = surfaceYAt(path, s, lat);
  const { yaw, att, wheels, steer } = carView;
  yaw.position.copy(V(car.x, car.y, hy + (car.z > 0 ? car.z : 0)));
  yaw.rotation.y = car.hdg;
  // lie on the road: pitch along the car, roll across it
  const c = Math.cos(car.hdg), sn = Math.sin(car.hdg);
  const ahead = surfaceYAt(path, s + 1.5 * (Math.cos(car.hdg - proj.hdg)), lat + 1.5 * Math.sin(car.hdg - proj.hdg));
  const behind = surfaceYAt(path, s - 1.5 * (Math.cos(car.hdg - proj.hdg)), lat - 1.5 * Math.sin(car.hdg - proj.hdg));
  const left = surfaceYAt(path, s - 0.8 * Math.sin(car.hdg - proj.hdg), lat + 0.8 * Math.cos(car.hdg - proj.hdg));
  const right = surfaceYAt(path, s + 0.8 * Math.sin(car.hdg - proj.hdg), lat - 0.8 * Math.cos(car.hdg - proj.hdg));
  const pitch = Math.atan2(ahead - behind, 3);
  const roll = Math.atan2(left - right, 1.6);
  att.rotation.z = pitch + (car.pitch || 0);
  // three's local +z is the car's RIGHT, so a left-side-high road rolls +x
  att.rotation.x = roll + (car.roll || 0) + Math.max(-0.05, Math.min(0.05, car.vx * car.r / 9.81 * 0.012));
  void c; void sn;
  carView.spin -= car.speed * dt / carView.R;
  for (const k in wheels) wheels[k].rotation.z = carView.spin;
  if (steer) { steer.fl.rotation.y = car.delta; steer.fr.rotation.y = car.delta; }
}

function driveCamera(dt) {
  const b = carView.yaw.position;
  const fwd = new THREE.Vector3(Math.cos(car.hdg), 0, -Math.sin(car.hdg));
  if (driveCam === 0) {
    // FIRST PERSON: out of the driver's own head. The view is built from the
    // car's attitude rather than its heading, so the horizon tilts with body
    // roll and with the banking under the wheels — and it looks where the
    // front wheels point, which is what a driver does.
    const m = carView.att.matrixWorld;
    const head = new THREE.Vector3(...carView.eye).applyMatrix4(m);
    const fwdL = new THREE.Vector3(1, 0, 0).transformDirection(m);
    const upL = new THREE.Vector3(0, 1, 0).transformDirection(m);
    camera.position.copy(head);
    camera.up.copy(upL);
    camera.lookAt(head.clone().addScaledVector(fwdL.applyAxisAngle(upL, car.delta * 0.55), 30));
    camera.fov = 78; camera.updateProjectionMatrix();
    return;
  }
  camera.up.set(0, 1, 0);
  const back = driveCam === 2 ? 14 : 6.8, up = driveCam === 2 ? 4.2 : 2.1;
  const want = b.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, up, 0));
  if (!camSmooth) camSmooth = want.clone();
  camSmooth.lerp(want, Math.min(1, dt * 9));
  camera.position.copy(camSmooth);
  const floor = ground.cameraFloor(camera.position.x, -camera.position.z) + 0.8;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(b.clone().addScaledVector(fwd, 5).add(new THREE.Vector3(0, 0.9, 0)));
  camera.fov = 62; camera.updateProjectionMatrix();
}

addEventListener('keydown', e => {
  if (e.code === 'Enter') { mode === 'fly' ? startDrive() : stopDrive(); }
  if (mode === 'fly' && e.code === 'KeyF') frameRange(Math.max(0, newest.s0 - 150), newest.s1 + 40);
  if (mode === 'fly' && e.code === 'KeyH') frameRange(0, path.length);
  if (mode === 'drive' && e.code === 'Escape') stopDrive();
  if (mode === 'drive' && e.code === 'KeyC') { driveCam = (driveCam + 1) % CAMS.length; camSmooth = null; toast('CAMERA ' + CAMS[driveCam]); }
  if (mode === 'drive' && e.code === 'KeyR') { spawn(spawnS); toast('RESTART'); }
  // a pedal pressed while flying does nothing, which reads as "the pedals are
  // broken" — say what to do instead
  if (mode === 'fly' && /^Digit[1-3890]$/.test(e.code)) toast('PEDAL SEEN — PRESS ENTER TO DRIVE');
});

// ---------------------------------------------------------------------------
// The measurement this project could not take headless, put where the person
// with the actual GPU can read it. The renderer STRING is there for a reason:
// if a browser has quietly fallen back to SwiftShader or llvmpipe then the
// scene is being drawn by the CPU and no amount of cutting will reach 24 fps.
const GPU = (() => {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  } catch { return 'unknown'; }
})();
const SOFT = /swiftshader|llvmpipe|software|microsoft basic/i.test(GPU);
let fpsT = performance.now(), fpsN = 0, fpsNow = 0;
function meter(now) {
  fpsN++;
  if (now - fpsT < 500) return;
  fpsNow = Math.round(fpsN * 1000 / (now - fpsT));
  const r = renderer.info.render;
  const link = k => `<a href="?${new URLSearchParams({ ...Object.fromEntries(q), q: k })}" ` +
    `style="color:${k === QK ? '#35d6a0' : '#8b949c'};text-decoration:none">${k}</a>`;
  $('fps').innerHTML = `<b>${fpsNow} fps</b> ${r.calls} draws · ${(r.triangles / 1000).toFixed(0)}k tris · ` +
    `${renderer.getPixelRatio().toFixed(2)}x<br>${['low', 'med', 'high'].map(link).join(' · ')}` +
    `<span>${SOFT ? 'SOFTWARE RENDERING — ' : ''}${GPU}</span>`;
  fpsT = now; fpsN = 0;
  // Published so a headless run can read the frame rate back out. Everything
  // else in this file can be measured from a screenshot; this cannot.
  window.__perf = { fps: fpsNow, draws: r.calls, tris: r.triangles, quality: QK, gpu: GPU, software: SOFT, dpr: renderer.getPixelRatio() };
}

let prev = performance.now(), frames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - prev) / 1000);
  prev = now;
  if (mode === 'fly') { camera.up.set(0, 1, 0); updateFly(dt); hands.endFrame(); }
  else {
    driveStep(dt);
    placeCar(dt);
    driveCamera(dt);
    $('speed').textContent = Math.round(car.speed * 3.6);
    $('pedT').style.width = (car.throttle * 100).toFixed(0) + '%';
    $('pedB').style.width = (car.brake * 100).toFixed(0) + '%';
  }
  if (mode === 'fly' && camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
  // Drive mode clips by default; ?far= also applies while FLYING, which is
  // the only way to photograph it or to time it without the physics loop
  // (which runs up to 240 substeps a frame headless) dominating the number.
  horizon.set(camera, (mode === 'drive' || q.has('far')) && FAR > 0 ? FAR : null);
  horizon.follow(camera);
  // the shadow box follows whatever you are looking at
  const focus = mode === 'fly' ? fly.target : carView.yaw.position;
  follow(focus);
  // One clock for every plant, so a gust crosses the grass and the trees
  // together instead of each of them waving on its own.
  LOOK.tick(now / 1000);
  if (flora) flora.update(camera);
  if (yard) { if (mode !== 'drive') yard.settle(dt); yard.sync(); }
  msgT -= dt;
  $('msg').style.opacity = msgT > 0 ? 1 : 0;
  // handles for headless probes (tools/*.mjs). Every frame, not once: the car
  // does not exist yet on the frame __build is published.
  window.__cam = camera; window.__car = car; window.__hands = hands;
  // Step the simulation without waiting for frames. A headless browser draws
  // this page seconds apart, and the sim only advances inside a frame — so a
  // gate that presses a key and then reads the car was reading a snapshot from
  // before the press. tools/pedalcheck.mjs drives this instead.
  window.__step = secs => { if (mode === 'drive') driveStep(Math.max(0, Math.min(5, secs))); };
  if (QN.every > 1) renderer.shadowMap.needsUpdate = (frames % QN.every) === 0;
  renderer.render(scene, camera);
  meter(now);
  frames++;
  if (frames === 2) {
    let tris = 0;
    scene.traverse(o => { if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3; });
    // What was ACTUALLY submitted this frame, instances and shadow pass
    // included. `tris` above counts each base geometry ONCE, so a forest of
    // 9,266 instanced trees reads the same as one tree — which is how a scene
    // that draws twelve million triangles a frame can report 473k and look
    // cheap. renderer.info is the honest number.
    const R = renderer.info.render;
    window.__build = {
      ready: true, buildMs: Math.round(buildMs), n: path.n, length: path.length,
      pieces: PIECES.length, chunks: chunks.length, tris: Math.round(tris),
      draws: R.calls, frameTris: R.triangles,
      textured: LOOK.on, sky: LOOK.look?.sky?.name || null, quality: QK, gpu: GPU, software: SOFT,
      maps: Object.keys(LOOK.look?.maps || {}).length,
      land: TERRAIN ? [!!TERRAIN.map, !!TERRAIN.normalMap, !!TERRAIN.roughnessMap] : null,
      floraMs: Math.round(floraMs), propMs: Math.round(propMs),
      flora: flora ? flora.stats() : null,
      props: yard ? yard.stats() : null,
      objects: objects ? objects.stats() : null, objMs: Math.round(objMs),
    };
  }
}
if (q.has('drive')) startDrive();
requestAnimationFrame(loop);
