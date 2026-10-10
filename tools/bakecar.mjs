// bakecar.mjs — turn a downloaded car model into a car the game can use.
//
//   node tools/bakecar.mjs <key> <folder with scene.gltf> [--out data/cars]
//   node tools/bakecar.mjs --list
//
// Adam, 2026-10-08: "lets js make acc models like acc as in actual". A model
// off the shelf is somebody's scene: any size, any axes, four wheels welded
// into one mesh or scattered over thirty nodes, an interior, a blur disc for
// a spinning rim. The game wants ONE thing: a car in its own frame.
//
// WHAT COMES OUT, in <out>/<key>/:
//   car.json   who made it and under what licence, its real dimensions, where
//              each wheel is and how big, its materials, and a list of groups
//   car.bin    Float32 vertices (position 3, normal 3, uv 2), then Uint32 indices
//   *.jpg/png  its textures, no larger than 2048
//
// THE FRAME (js/geom.js): +x forward, +y up, +z the car's RIGHT, metres, the
// origin on the ground midway between the axles. A group's `part` is 'body',
// or a wheel 'fl' 'fr' 'rl' 'rr' (it spins; its vertices are about the hub),
// or 'fl.hub' ... (it steers with the wheel but does not spin: a caliper).
//
// EACH CAR IS A RECIPE below: what its real length is, which pieces are
// wheels, which materials are paint and glass. Nothing is guessed silently —
// the bake prints what it decided and refuses a car it cannot find wheels on.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

// wheels: { by: 'node', fl, fr, rl, rr: RegExp on the node path, hub?: {…}, tyre: RegExp }
//      or { by: 'material', mats: [names], tyre: name, hub?: [names] }  (one mesh for all four: cut by quarter)
// role:  material name -> 'paint' | 'glass' | 'tyre' | 'rim' | 'lamp' | 'tail' | 'chrome' | 'trim'
const RECIPES = {
  p911: {
    title: 'Porsche 911 GT3 RS (991.1)', klass: '911', length: 4.545,
    wheels: { by: 'material', mats: ['Tyre1Mtl', 'Rim1Mtl', 'Rotor1Mtl', 'Caliper1Mtl'], tyre: 'Tyre1Mtl', hub: ['Caliper1Mtl'] },
    role: { Paint1Mtl: 'paint', Windows1Mtl: 'glass', Glass2Mtl: 'glass', Glass1Mtl: 'lamp', Tyre1Mtl: 'tyre', Rim1Mtl: 'rim', Lights1Mtl: 'chrome', Tex1Mtl: 'tail', Rotor1Mtl: 'trim', Black1Mtl: 'trim', BlackT1Mtl: 'trim', WhiteButLessWhite1Mtl: 'trim' },
  },
  a480: {
    // the driver's eyes, found from a section through the model: the automatic guess put them outside the bodywork
    eye: [0.15, 0.8, -0.25],
    title: 'Alpine A480', klass: 'hyper', length: 4.745,
    wheels: { by: 'node', fl: /_W_FL_Rotor/, fr: /_W_FR_Rotor/, rl: /_W_RL_Rotor/, rr: /_W_RR_Rotor/,
              hub: { fl: /_W_FL_Stator/, fr: /_W_FR_Stator/, rl: /_W_RL_Stator/, rr: /_W_RR_Stator/ }, tyre: /_Tire/ },
    role: { A480_Livery1: 'paint', A480_Ext_Glass: 'glass', A480_Ext_LGT_Brake: 'tail', A480_Ext_Mirror: 'chrome' },
    nodeRole: [[/_Tire/, 'tyre'], [/Rotor_LOD0_Details(?!Met)/, 'rim'], [/_Glass/, 'glass']],
  },
  m720: {
    title: 'McLaren 720S GT3', klass: 'gt3', length: null,      // already in metres
    // The driver's eyes, measured off the model's own seat (headrest top 0.955 m, seat 0.26 m left of centre).
    // The first guess, 80% of the roof height, put them at 0.93 m: above the seat. Adam: "the cam is too high in the mclaren".
    eye: [-0.02, 0.80, -0.26],
    // He drives with a real wheel in his hands: the model's own must not sit in front of it.
    skip: /Interior-SteeringWheel/,
    // The maker's name across the windscreen and the tyre maker's on the sidewalls are real marks: painted out.
    plain: /Glass-Black_|Tire-/,
    wheels: { by: 'node', fl: /(Wheel|Tire)-LF_/, fr: /Wheel-Front_|Tire-RF_/, rl: /(Wheel|Tire)-LR_/, rr: /Wheel-Rear_|Tire-RR_/,
              hub: { fl: /Wheel-LF_.*(Caliper|BrakePad|BrakeSteel)/, fr: /Wheel-Front_.*(Caliper|BrakePad|BrakeSteel)/, rl: /Wheel-LR_.*(Caliper|BrakePad|BrakeSteel)/, rr: /Wheel-Rear_.*(Caliper|BrakePad|BrakeSteel)/ },
              tyreMat: 'TIRE' },
    role: { BODY: 'paint', TIRE: 'tyre', WHEELFRONT: 'rim', WHEELREAR: 'rim' },
    nodeRole: [[/Glass-(Window|RearSideWindow|HeadLightCover|HeadLightGlass)/, 'glass'], [/Body-(PlasticBlack|PaintBlack|Grill|Steel|WingMountSteel|TowStrap|HoodPin|Camera|ExhaustGuard|Fuel)/, 'trim'],
               [/Caliper|BrakeDisc|BrakePad|BrakeSteel|Hub|Nut|ValveStem/, 'trim']],
  },
  g55: {
    title: 'Ginetta G55', klass: 'gt4', length: null,           // already in metres
    // the driver's eyes: the automatic guess sat 23 cm under the roof skin and the near plane cut the roof open (Adam, 2026-10-09)
    eye: [-0.26, 0.895, -0.34],
    skip: /RIM_BLUR/,
    plain: /ext_windows_banner/,
    skipMat: ['ext_stickers', 'stickers_g55'],     // a real tyre maker's windscreen banner, a flag and a number: the team's own stickers go on instead
    wheels: { by: 'node', fl: /WHEEL_LF/, fr: /WHEEL_RF/, rl: /WHEEL_LR/, rr: /WHEEL_RR/, tyre: /TYRE_/ },
    role: { car_paint_g55: 'paint', glass: 'glass', g55_tyre: 'tyre', rimm: 'rim', rear_lights_glass: 'tail', brake_light1: 'tail', ext_metals: 'chrome', aluminium_ext: 'chrome' },
  },
  // Adam, 2026-10-10: "i donwloaeded moree cars lets make teasms and liveriesssss". Three more GT3s.
  // Each came in somebody's real colours: the maker's banner and the tyre maker's sidewalls are painted
  // out, the badge sheets are left off, and the paint is the team's own (tools/livery).
  m4: {
    title: 'BMW M4 GT3', klass: 'gt3', length: 5.020,
    // one mesh for each material and no names: Object_51..54 are the steering wheel, 4 and 27 the banners, 17 the tyres
    skip: /Object_(51|52|53|54)$/,
    plain: /Object_(4|17|27)$/,
    // COCKPIT_LR is a second, rough cabin for the far-away car: it stands 11 cm proud of the door skin (a black blot on every door)
    skipMat: ['EXT_Decals', 'EXT_RIM_BLUR', 'EXT_RIM_BLUR_STATIC', 'NUMBERPLATE_2018_EMISSIVE_PRO', 'COCKPIT_LR'],
    wheels: { by: 'material', mats: ['EXT_Tyre.006', 'EXT_RIM', 'EXT_Disc'], tyre: 'EXT_Tyre.006' },
    role: { EXT_Carpaint_Inst: 'paint', EXT_Windows: 'glass', INT_Windows: 'glass', INT_Windshield: 'glass', 'EXT_Tyre.006': 'tyre', EXT_RIM: 'rim', EXT_Glass_Emissive_Front: 'glass',
            EXT_Glass_Emissive_Rear: 'tail', EXT_Emissive_Light_Rear: 'tail', EXT_Emissive_Light_Front: 'lamp', 'MIRROR.006': 'chrome', EXT_CHROME_LIGHTS: 'chrome' },
  },
  p992: {
    title: 'Porsche 911 GT3 R (992)', klass: 'gt3', length: 4.619,
    skip: /RIM_BLUR|STEER_HR|steer_hr/,
    plain: /GEO_TIRE_|EXT_Banner|INT_BANNER/,
    skipMat: ['EXT_Details', 'EXT_Details_0', 'EXT_Details_1'],     // the maker's crest
    wheels: { by: 'node', fl: /WHEEL_LF|DISC_LF/, fr: /WHEEL_RF|DISC_RF/, rl: /WHEEL_LR|DISC_LR/, rr: /WHEEL_RR|DISC_RR/,
              hub: { fl: /SUSP_LF/, fr: /SUSP_RF/, rl: /SUSP_LR/, rr: /SUSP_RR/ }, tyre: /GEO_TIRE_/ },
    role: {},
    nodeRole: [[/EXT_Carpaint_Inst/, 'paint'], [/GEO_TIRE_/, 'tyre'], [/GEO_RIM_/, 'rim'], [/EXT_Windows|INT_Windows|INT_Windshield|Glass_Emissive_Front/, 'glass'],
               [/Emissive_Light_Rear|Glass_Emissive_Rear/, 'tail'], [/Emissive_Light_Front|AUX_LIGHT/, 'lamp'], [/MIRROR/, 'chrome']],
  },
  hura: {
    title: 'Lamborghini Huracán GT3', klass: 'gt3', length: 4.458,
    skip: /STEERING_WHEEL/,
    plain: /_TYRE_/,
    noAerial: true,
    skipMat: ['BADGES'],
    wheels: { by: 'material', mats: ['NEUMA', 'material_11'], tyre: 'NEUMA' },      // four wheels named tyre, tyre1, tyre2 and tyre: cut by quarter
    role: { CAR_PAINT: 'paint', NEUMA: 'tyre', material_11: 'rim', phong1: 'glass', RED_GLASS: 'tail', LIGHTS: 'lamp' },
  },
  // 2026-10-10, later: "find me gt4 and hyper car models so we dont have the same gt4 and hypers but 4 diff gt3s".
  m4g4: {
    title: 'BMW M4 GT4 (F82)', klass: 'gt4', length: 4.80,
    skip: /STEERING_WHEEL/, plain: /_TYRE_/, noAerial: true,
    skipMat: ['badges'],
    wheels: { by: 'material', mats: ['tire', 'wheel', 'rotor'], tyre: 'tire' },
    nodeRole: [[/_mm_ext_carbon/, 'paint']],      // its bare carbon bonnet and roof: a team paints those
    role: { material: 'paint', material_6: 'paint', tire: 'tyre', wheel: 'rim', glass: 'glass', lights: 'lamp', emis: 'tail' },
  },
  amg4: {
    title: 'Mercedes-AMG GT4', klass: 'gt4', length: 4.619, reverse: true,
    plain: /Object_26$/,                                                   // the tyres
    // the star, and five see-through coloured blocks the model's author left on the suspension
    skipMat: ['Tex1Mtl', 'Upperarmb1Mtl', 'Cupper1Mtl', 'Springtop1Mtl', 'Upperarm1Mtl', 'Hub1Mtl'],
    wheels: { by: 'material', mats: ['Tyre1Mtl', 'Rim1Mtl', 'Rotor1Mtl', 'Caliper1Mtl'], tyre: 'Tyre1Mtl', hub: ['Caliper1Mtl'] },
    role: { Paint1Mtl: 'paint', Windows1Mtl: 'glass', Windows2Mtl: 'glass', Glass1Mtl: 'glass', Tyre1Mtl: 'tyre', Rim1Mtl: 'rim', Lights4Mtl: 'tail', Lights1Mtl: 'lamp', Lights3Mtl: 'chrome', Lights13Mtl: 'chrome' },
  },
  f499: {
    // the driver's eyes, found from a section through the model: the automatic guess put them outside the bodywork
    eye: [0.25, 0.8, -0.25],
    title: 'Ferrari 499P', klass: 'hyper', length: 5.10,
    skip: /STEER_HR|Rim_Blur|RIM_RR1_002/, plain: /EXT_Tyre/,          // (the right rear rim is in the file twice)
    skipMat: ['logo_cos'],
    wheels: { by: 'material', mats: ['EXT_Tyre', 'RIMS', 'brake_disk', 'Wheels', 'caliper'], tyre: 'EXT_Tyre', hub: ['caliper'] },
    role: { Body: 'paint', EXT_Tyre: 'tyre', RIMS: 'rim', Wheels: 'rim', Glass: 'glass', INT_Glass: 'glass', SM_Light_Front: 'lamp', MIRRORS: 'chrome', Mirrorsx: 'chrome' },
  },
  a110: {
    title: 'Alpine A110 GT4', klass: 'gt4', length: 4.26,
    skip: /_Int_Steer/, plain: /Rotor_LOD0_Tire/,
    wheels: { by: 'node', fl: /_W_FL_Rotor/, fr: /_W_FR_Rotor/, rl: /_W_RL_Rotor/, rr: /_W_RR_Rotor/,
              hub: { fl: /_W_FL_Stator/, fr: /_W_FR_Stator/, rl: /_W_RL_Stator/, rr: /_W_RR_Stator/ }, tyre: /_Tire/ },
    role: { A110_GT4_Ext_Paint_13: 'paint', A110_GT4_Ext_Paint: 'paint', A110_GT4_Ext_Glass: 'glass', A110_GT4_Ext_BrakeOn: 'tail', A110_GT4_Ext_Mirror: 'chrome' },
    nodeRole: [[/_Tire/, 'tyre'], [/Rotor_LOD0_Details(?!Met)/, 'rim'], [/_Glass/, 'glass']],
  },
  p9x8: {
    // the driver's eyes, found from a section through the model: the automatic guess put them outside the bodywork
    eye: [0.25, 0.78, -0.25],
    title: 'Peugeot 9X8', klass: 'hyper', length: 5.00,
    skip: /_Int_Steer|_LOD[12]_/, plain: /Rotor_LOD0_Tire/,
    wheels: { by: 'node', fl: /_W_FL_Rotor/, fr: /_W_FR_Rotor/, rl: /_W_RL_Rotor/, rr: /_W_RR_Rotor/,
              hub: { fl: /_W_FL_Stator/, fr: /_W_FR_Stator/, rl: /_W_RL_Stator/, rr: /_W_RR_Stator/ }, tyre: /_Tire/ },
    role: { '9X8_Ext_Paint': 'paint', '9X8_Ext_Glass': 'glass', '9X8_Ext_LightBrakes': 'tail', '9X8_Ext_Mirror': 'chrome' },
    nodeRole: [[/_Tire/, 'tyre'], [/Rotor_LOD0_Details(?!Met)/, 'rim'], [/_Glass/, 'glass']],
  },
  // "what abt the acura and 992" — two by the author of the McLaren, laid out the same way: one Body material,
  // and the name of each piece says what it is.
  nsx: {
    eye: [-0.05, 0.84, -0.42],          // the driver's eyes, from a section through the seat
    title: 'Acura NSX GT3', klass: 'gt3', length: 4.612,
    skip: /Interior-.*Steering/, plain: /Tire-|Glass-Black_/,
    wheels: { by: 'node', fl: /Wheel-LF_|Wheel-Rim-LF_/, fr: /Wheel-RF_|Wheel-Rim-RF_/, rl: /Wheel-LR_|Wheel-Rim-LR_/, rr: /Wheel-RR_|Wheel-Rim-RR_/,
              hub: { fl: /Wheel-Caliper(Steel)?-LF/, fr: /Wheel-Caliper(Steel)?-RF/, rl: /Wheel-Caliper(Steel)?-LR/, rr: /Wheel-Caliper(Steel)?-RR/ }, tyreMat: 'Tire' },
    role: { Body: 'paint', Tire: 'tyre', Wheel: 'rim' },
    nodeRole: [[/Glass-(Window|Windshield|HeadLightCover|ChismelGlass)/, 'glass'], [/Body-(BumperFCarbon|CarbonFiber|Grille|Hoodpin|PaintBlack|PlasticBlack|WingMount)/, 'trim'],
               [/Glass-(TailLightLens|ReflectorBrake|ReflectorRed|PlasticRed)/, 'tail'], [/Glass-HeadLight_/, 'lamp'], [/Caliper|Wheel-Disc|Wheel-Hub|Wheel-Nut/, 'trim']],
  },
  // a second 992, from another hand (the first is p992)
  p992b: {
    title: 'Porsche 911 GT3 R (992) Roxy', klass: 'gt3', length: 4.619,
    skip: /Interior-.*Steering|Chassis-Emblem/, plain: /Tire-|Glass-WindScreenBanner/,
    wheels: { by: 'node', fl: /Wheel_LF_|WheelAssembly_LF_/, fr: /Wheel_RF_|WheelAssembly_RF_/, rl: /Wheel_LR_|WheelAssembly_LR_/, rr: /Wheel_RR_|WheelAssembly_RR_/,
              hub: { fl: /Wheel-Caliper-LF/, fr: /Wheel-Caliper-RF/, rl: /Wheel-Caliper-LR/, rr: /Wheel-Caliper-RR/ }, tyreMat: 'Tire' },
    role: { Body: 'paint', Tire: 'tyre', Wheel: 'rim' },
    nodeRole: [[/Glass-(RearWindows|Glass_|HeadlightCover|HeadLightGlass|TailLightCover)/, 'glass'], [/Body-(Grill|PaintBlack|Fasteners)/, 'trim'],
               [/Glass-(TailLights|RedLightBar|RainLight)/, 'tail'], [/Glass-(Headlight_|LED)/, 'lamp'], [/Caliper|BrakeDisc|Wheel-..-Steel|ValveStem/, 'trim']],
  },
  // The 2022 grand prix car. A million triangles as it came, 726,000 of them one hidden lump the size of
  // a shoebox between the rear wheels ('material'): left off, with the steering wheel he holds himself.
  f122: {
    // the driver's eyes, found from a section through the model: the automatic guess put them outside the bodywork
    eye: [0.05, 0.74, 0],
    title: 'McLaren MCL36', klass: 'f1', length: 5.70,
    plain: /Object_4[01]$/,
    skipMat: ['material', 'Steer'],
    wheels: { by: 'material', mats: ['tyres', 'rims', 'Material'], tyre: 'tyres' },
    role: { Livery: 'paint', Livery_Wings: 'paint', 'Material.005': 'paint', 'Material.003': 'paint', tyres: 'tyre', rims: 'rim', Material: 'rim', mirror: 'chrome', chrome: 'chrome' },
  },
  // Two more GT3s by the 720's maker, laid out the same way: Body- / Chassis- / Glass- / Interior- / Wheel- nodes.
  nsx: {
    title: 'Acura NSX GT3', klass: 'gt3', length: null,          // already in metres
    plain: /Glass-Black_|Tire-/,
    wheels: { by: 'node', fl: /Wheel-LF_/, fr: /Wheel-RF_/, rl: /Wheel-LR_/, rr: /Wheel-RR_/,
              hub: { fl: /Wheel-Caliper(Steel)?-LF_/, fr: /Wheel-Caliper(Steel)?-RF_/, rl: /Wheel-Caliper(Steel)?-LR_/, rr: /Wheel-Caliper(Steel)?-RR_/ },
              tyreMat: 'Tire' },
    role: { Body: 'paint', Tire: 'tyre', Wheel: 'rim' },
    nodeRole: [[/Glass-(Window(Left|Right)|Windshield|HeadLightCover|ChismelGlass)/, 'glass'], [/Glass-(TailLightLens|ReflectorBrake|ReflectorRed)/, 'tail'], [/Glass-HeadLight_/, 'lamp'], [/Glass-Mirror/, 'chrome'],
               [/Body-(PaintBlack|PlasticBlack|CarbonFiber|BumperFCarbon|Grille|Hoodpin|WingMount)/, 'trim'], [/Caliper|Disc|Hub|Nut/, 'trim']],
  },
  p992r: {
    eye: [-0.22, 0.9, -0.4],          // the driver's eyes, from a section through the seat
    title: 'Porsche 911 GT3 R (992) Roxy', klass: 'gt3', length: null,   // already in metres
    // He drives with a real wheel in his hands: the model's own must not sit in front of it.
    skip: /Interior-x?Steering/,
    plain: /Glass-WindScreenBanner|Tire-|Chassis-Emblem/,
    wheels: { by: 'node', fl: /WheelAssembly_LF/, fr: /WheelAssembly_RF/, rl: /WheelAssembly_LR/, rr: /WheelAssembly_RR/,
              hub: { fl: /Wheel-Caliper-LF/, fr: /Wheel-Caliper-RF/, rl: /Wheel-Caliper-LR/, rr: /Wheel-Caliper-RR/ },
              tyreMat: 'Tire' },
    role: { Body: 'paint', Tire: 'tyre', Wheel: 'rim' },
    nodeRole: [[/Glass-(RearWindows|Glass_|HeadlightCover|HeadLightGlass|TailLightCover)|Interior-Glass/, 'glass'], [/Glass-(TailLights|RedLightBar|RainLight)/, 'tail'], [/Glass-(Headlight_|LED)/, 'lamp'],
               [/Glass-(Mirror|HeadLightChrome)/, 'chrome'], [/Body-(PaintBlack|Grill|Fasteners|GurneyFlap)/, 'trim'], [/Caliper|BrakeDisc|Steel|ValveStem/, 'trim']],
  },
  // NOT A CAR: the steering wheel in the driver's hands (Adam: "i downloaded that wheel put that in the game").
  // `prop` bakes it about its own hub instead of onto four tyres: the origin is the centre of the rim, its
  // face looks back at the driver (-x), and it is `diameter` metres across. The game turns it about x.
  wheel: {
    title: 'Steering wheel', klass: 'prop', prop: true, diameter: 0.30,
    role: {},
  },
};

const argv = process.argv.slice(2);
if (argv[0] === '--list') { for (const [k, r] of Object.entries(RECIPES)) console.log(k.padEnd(8), r.klass.padEnd(8), r.title); process.exit(0); }
const [key, src] = argv;
let outRoot = 'data/cars';
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--out') outRoot = argv[++i];
  else { console.error(`bakecar: unknown option ${argv[i]}`); process.exit(2); }
}
const R = RECIPES[key];
if (!R || !src) { console.error('bakecar: node tools/bakecar.mjs <key> <folder>   (keys: ' + Object.keys(RECIPES).join(', ') + ')'); process.exit(2); }

// ---- read the glTF ------------------------------------------------------------------
const g = JSON.parse(fs.readFileSync(path.join(src, 'scene.gltf'), 'utf8'));
const buffers = g.buffers.map(b => fs.readFileSync(path.join(src, b.uri)));
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const CT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
function accessor(i) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView], n = NCOMP[a.type], [T, sz] = CT[a.componentType];
  if (a.sparse) throw new Error('sparse accessors are not handled');
  const buf = buffers[bv.buffer], base = buf.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * sz;
  const out = new Float64Array(a.count * n), dv = new DataView(buf.buffer);
  const norm = a.normalized ? (T === Uint8Array ? 255 : T === Uint16Array ? 65535 : T === Int8Array ? 127 : T === Int16Array ? 32767 : 1) : 1;
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = base + k * stride + c * sz;
    const v = T === Float32Array ? dv.getFloat32(o, true) : T === Uint32Array ? dv.getUint32(o, true) : T === Uint16Array ? dv.getUint16(o, true)
      : T === Int16Array ? dv.getInt16(o, true) : T === Uint8Array ? dv.getUint8(o) : dv.getInt8(o);
    out[k * n + c] = v / norm;
  }
  return { data: out, n, count: a.count };
}
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1], t = n.translation || [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0, t[0], t[1], t[2], 1];
}

// Every triangle of the scene, in the scene's own space, tagged with where it came from.
// tri = { p: [9], n: [9], uv: [6], mat, path }
const tris = [];
let skipped = 0;
function walk(i, M, p) {
  const n = g.nodes[i], W = mul(M, local(n)), here = p + '/' + (n.name || '?');
  if (n.mesh !== undefined && !(R.skip && R.skip.test(here))) {
    for (const pr of g.meshes[n.mesh].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue;
      const P = accessor(pr.attributes.POSITION);
      const N = pr.attributes.NORMAL !== undefined ? accessor(pr.attributes.NORMAL) : null;
      const U = pr.attributes.TEXCOORD_0 !== undefined ? accessor(pr.attributes.TEXCOORD_0) : null;
      const idx = pr.indices !== undefined ? accessor(pr.indices).data : Float64Array.from({ length: P.count }, (_, k) => k);
      const mat = pr.material !== undefined ? g.materials[pr.material].name || ('mat' + pr.material) : 'none';
      if (R.skipMat && R.skipMat.includes(mat)) { skipped++; continue; }
      // a mirrored node turns its triangles inside out; put them back
      const det = W[0] * (W[5] * W[10] - W[6] * W[9]) - W[4] * (W[1] * W[10] - W[2] * W[9]) + W[8] * (W[1] * W[6] - W[2] * W[5]);
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const order = det < 0 ? [idx[t], idx[t + 2], idx[t + 1]] : [idx[t], idx[t + 1], idx[t + 2]];
        const tr = { p: [], n: [], uv: [], mat, path: here };
        for (const v of order) {
          const x = P.data[v * 3], y = P.data[v * 3 + 1], z = P.data[v * 3 + 2];
          tr.p.push(W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]);
          if (N) {
            const a = N.data[v * 3], b = N.data[v * 3 + 1], c = N.data[v * 3 + 2];
            let nx = W[0] * a + W[4] * b + W[8] * c, ny = W[1] * a + W[5] * b + W[9] * c, nz = W[2] * a + W[6] * b + W[10] * c;
            const l = Math.hypot(nx, ny, nz) || 1;
            tr.n.push(nx / l, ny / l, nz / l);
          }
          tr.uv.push(U ? U.data[v * 2] : 0, U ? U.data[v * 2 + 1] : 0);
        }
        if (!N) {
          const [ax, ay, az, bx, by, bz, cx, cy, cz] = tr.p;
          let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          const l = Math.hypot(nx, ny, nz) || 1;
          for (let k = 0; k < 3; k++) tr.n.push(nx / l, ny / l, nz / l);
        }
        tris.push(tr);
      }
    }
  } else if (n.mesh !== undefined) skipped++;
  for (const c of n.children || []) walk(c, W, here);
}
for (const r of g.scenes[g.scene || 0].nodes) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], '');
if (!tris.length) { console.error('bakecar: no triangles in ' + src); process.exit(1); }

// ---- into the car's frame -------------------------------------------------------------
// glTF: +y up, and these models face +z with their left at +x. Ours: x forward,
// y up, z right. (z, y, -x) is a pure turn: nothing is mirrored.
for (const t of tris) for (const arr of [t.p, t.n]) for (let k = 0; k < 9; k += 3) {
  const x = arr[k], z = arr[k + 2];
  arr[k] = z; arr[k + 2] = -x;
}
// ...and one that came facing backwards (its recipe says so) is turned round
if (R.reverse) for (const t of tris) for (const arr of [t.p, t.n]) for (let k = 0; k < 9; k += 3) { arr[k] = -arr[k]; arr[k + 2] = -arr[k + 2]; }
const box = list => {
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const t of list) for (let k = 0; k < 9; k++) { lo[k % 3] = Math.min(lo[k % 3], t.p[k]); hi[k % 3] = Math.max(hi[k % 3], t.p[k]); }
  return { lo, hi, mid: lo.map((l, k) => (l + hi[k]) / 2), size: hi.map((h, k) => h - lo[k]) };
};
let all = box(tris);
if (R.prop) {
  // turned to face the driver (the model's face looks along its own +x, which the turn above made -z)
  for (const t of tris) for (const arr of [t.p, t.n]) for (let k = 0; k < 9; k += 3) { const x = arr[k], z = arr[k + 2]; arr[k] = z; arr[k + 2] = -x; }
  all = box(tris);
}
const scale = R.prop ? R.diameter / Math.max(all.size[1], all.size[2]) : R.length ? R.length / all.size[0] : 1;
for (const t of tris) for (let k = 0; k < 9; k++) t.p[k] *= scale;
all = box(tris);
if (!R.prop && (all.size[0] < 2.5 || all.size[0] > 7 || all.size[2] < 1.2 || all.size[2] > 2.8)) {
  console.error(`bakecar: ${key} comes out ${all.size.map(v => v.toFixed(2)).join(' x ')} m — not a car. Give the recipe a real length.`);
  process.exit(1);
}

// ---- which triangles are which wheel ----------------------------------------------------
const WHEELS = ['fl', 'fr', 'rl', 'rr'];
const wheels = {};
let isTyre = () => false;
for (const t of tris) t.part = 'body';
if (R.prop) {
  // about its own middle: nothing to stand it on
  for (const t of tris) for (let k = 0; k < 9; k++) t.p[k] -= all.mid[k % 3];
  for (const w of WHEELS) wheels[w] = { c: [0, 0, 0], r: 0.33, w: 0.3 };
  all = box(tris);
} else {
const cen = t => [(t.p[0] + t.p[3] + t.p[6]) / 3, (t.p[1] + t.p[4] + t.p[7]) / 3, (t.p[2] + t.p[5] + t.p[8]) / 3];
for (const t of tris) t.part = 'body';
isTyre = t => R.wheels.tyreMat ? t.mat === R.wheels.tyreMat : R.wheels.by === 'node' ? R.wheels.tyre.test(t.path) : t.mat === R.wheels.tyre;
if (R.wheels.by === 'node') {
  for (const t of tris) for (const w of WHEELS) {
    if (R.wheels.hub && R.wheels.hub[w].test(t.path)) t.part = w + '.hub';       // a caliper sits inside the wheel's own node
    else if (R.wheels[w].test(t.path)) t.part = w;
  }
} else {
  // one mesh for all four: a wheel triangle belongs to the corner it is in
  const tyres = box(tris.filter(isTyre));
  for (const t of tris) {
    if (!R.wheels.mats.includes(t.mat)) continue;
    const c = cen(t);
    const w = (c[0] > tyres.mid[0] ? 'f' : 'r') + (c[2] > tyres.mid[2] ? 'r' : 'l');
    t.part = (R.wheels.hub || []).includes(t.mat) ? w + '.hub' : w;
  }
}

for (const w of WHEELS) {
  const ty = tris.filter(t => t.part === w && isTyre(t));
  if (!ty.length) { console.error(`bakecar: ${key} has no tyre for wheel ${w} — the recipe's wheel rule matched nothing`); process.exit(1); }
  // A model posed with its front wheels turned (the M4 came 13 degrees into a left-hander) would be
  // steered twice. The tyre is a ring: seen from above its long axis is the way it points. Turn the
  // wheel, and the caliper with it, about its own middle until that is straight ahead.
  let b = box(ty), sxx = 0, sxz = 0, szz = 0, n = 0;
  for (const t of ty) for (let k = 0; k < 9; k += 3) { const x = t.p[k] - b.mid[0], z = t.p[k + 2] - b.mid[2]; sxx += x * x; sxz += x * z; szz += z * z; n++; }
  const turned = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  if (Math.abs(turned) > 0.009 && Math.abs(turned) < 0.6) {
    const c = Math.cos(-turned), s = Math.sin(-turned);
    for (const t of tris) if (t.part.slice(0, 2) === w) for (let k = 0; k < 9; k += 3) {
      const x = t.p[k] - b.mid[0], z = t.p[k + 2] - b.mid[2], nx = t.n[k], nz = t.n[k + 2];
      t.p[k] = b.mid[0] + x * c - z * s; t.p[k + 2] = b.mid[2] + x * s + z * c;
      t.n[k] = nx * c - nz * s; t.n[k + 2] = nx * s + nz * c;
    }
    console.log(`  wheel ${w} came turned ${(turned * 180 / Math.PI).toFixed(1)} degrees: straightened`);
    b = box(ty);
  }
  wheels[w] = { c: b.mid, r: Math.max(b.size[0], b.size[1]) / 2, w: b.size[2] };
}
// the side a wheel says it is on must be the side it is on
for (const w of WHEELS) {
  const front = wheels[w].c[0] > (wheels.fl.c[0] + wheels.rl.c[0]) / 2, right = wheels[w].c[2] > 0.5 * (wheels.fl.c[2] + wheels.fr.c[2]);
  if (front !== (w[0] === 'f') || right !== (w[1] === 'r')) {
    console.error(`bakecar: ${key}'s wheel ${w} is at x ${wheels[w].c[0].toFixed(2)}, z ${wheels[w].c[2].toFixed(2)} — the model is not facing the way the recipe assumes`);
    process.exit(1);
  }
}

// ---- sit it on the ground, midway between the axles, on the centreline -----------------
const ground = Math.min(...WHEELS.map(w => wheels[w].c[1] - wheels[w].r));
const ox = (wheels.fl.c[0] + wheels.fr.c[0] + wheels.rl.c[0] + wheels.rr.c[0]) / 4;
const oz = (wheels.fl.c[2] + wheels.fr.c[2] + wheels.rl.c[2] + wheels.rr.c[2]) / 4;
for (const t of tris) for (let k = 0; k < 9; k += 3) { t.p[k] -= ox; t.p[k + 1] -= ground; t.p[k + 2] -= oz; }
for (const w of WHEELS) { wheels[w].c[0] -= ox; wheels[w].c[1] -= ground; wheels[w].c[2] -= oz; }
// a wheel's own triangles are kept about its hub, so it can be spun and steered in place
for (const t of tris) {
  const w = wheels[t.part.slice(0, 2)];
  if (t.part !== 'body' && w) for (let k = 0; k < 9; k++) t.p[k] -= w.c[k % 3];
}
// a radio aerial stands half a metre over the roof, and the car's height is what its paint is fitted to
if (R.noAerial) {
  const roof = box(tris.filter(t => t.part === 'body' && roleOf(t) === 'paint')).hi[1] + 0.02;
  const n0 = tris.length;
  for (let k = tris.length - 1; k >= 0; k--) { const t = tris[k]; if (t.part === 'body' && Math.min(t.p[1], t.p[4], t.p[7]) > roof) tris.splice(k, 1); }
  console.log(`  ${n0 - tris.length} triangles above the roof (an aerial) left off`);
}
all = box(tris.filter(t => t.part === 'body'));
}

// ---- materials ----------------------------------------------------------------------------
const outDir = path.join(outRoot, key);
fs.mkdirSync(outDir, { recursive: true });
function roleOf(t) {
  for (const [re, role] of R.nodeRole || []) if (re.test(t.path)) return role;
  return R.role[t.mat] || 'trim';
}
const mats = [], matIx = new Map();
function material(t) {
  const plain = !!(R.plain && R.plain.test(t.path));
  const role = roleOf(t), id = t.mat + '|' + role + (plain ? '|plain' : '');
  if (matIx.has(id)) return matIx.get(id);
  const m = (g.materials || []).find(x => (x.name || '') === t.mat) || {}, pbr = m.pbrMetallicRoughness || {};
  const out = { name: t.mat, role, color: (pbr.baseColorFactor || [1, 1, 1, 1]).slice(0, 3).map(v => +v.toFixed(4)),
    metal: pbr.metallicFactor ?? 1, rough: +(pbr.roughnessFactor ?? 1).toFixed(3) };
  const a = (pbr.baseColorFactor || [1, 1, 1, 1])[3];
  if (m.alphaMode === 'BLEND' && a > 0.02 && a < 0.98) out.alpha = +a.toFixed(3);
  if (plain) out.color = [0.004, 0.004, 0.005];
  if (pbr.baseColorTexture && !plain) {
    const uri = decodeURIComponent(g.images[g.textures[pbr.baseColorTexture.index].source].uri);
    const from = path.join(src, uri);
    const info = execFileSync('magick', ['identify', '-format', '%w %h %[channels]', from]).toString().split(' ');
    const hasAlpha = /a/.test(info[2] || '') && +execFileSync('magick', [from, '-alpha', 'extract', '-format', '%[fx:minima]', 'info:']).toString() < 0.98;
    const keepAlpha = hasAlpha && m.alphaMode && m.alphaMode !== 'OPAQUE';
    const name = path.basename(uri).replace(/_baseColor/, '').replace(/\.[^.]+$/, '') + (keepAlpha ? '.png' : '.jpg');
    execFileSync('magick', [from, '-resize', '2048x2048>', ...(keepAlpha ? [] : ['-background', 'black', '-alpha', 'remove', '-quality', '90']), path.join(outDir, name)]);
    out.map = name;
    // the native game has no picture decoder: the same picture again as a plain PAM (RGBA, 8 bit)
    const pam = name.replace(/\.[^.]+$/, '') + '.pam';
    execFileSync('magick', [from, '-resize', role === 'paint' ? '2048x2048>' : '1024x1024>', '-depth', '8', '-alpha', keepAlpha ? 'on' : 'off', '-define', 'pam:tupletype=RGB_ALPHA', ...(keepAlpha ? [] : ['-alpha', 'opaque']), '-colorspace', 'sRGB', '-type', 'TrueColorAlpha', 'pam:' + path.join(outDir, pam)]);   // (a grey picture would come out two channels wide, and the game reads four)
    out.pam = pam;
    if (keepAlpha && m.alphaMode === 'MASK') out.cutout = true;
  }
  matIx.set(id, mats.length);
  mats.push(out);
  return mats.length - 1;
}

// ---- groups: one mesh for each (part, material), welded -------------------------------------
const groups = new Map();
for (const t of tris) {
  const mi = material(t), id = t.part + '#' + mi;
  if (!groups.has(id)) groups.set(id, { part: t.part, mat: mi, verts: [], index: [], seen: new Map() });
  const G = groups.get(id);
  for (let v = 0; v < 3; v++) {
    const rec = [t.p[v * 3], t.p[v * 3 + 1], t.p[v * 3 + 2], t.n[v * 3], t.n[v * 3 + 1], t.n[v * 3 + 2], t.uv[v * 2], t.uv[v * 2 + 1]];
    const k = rec.map(x => Math.round(x * 1e4)).join(',');
    let ix = G.seen.get(k);
    if (ix === undefined) { ix = G.verts.length / 8; G.verts.push(...rec); G.seen.set(k, ix); }
    G.index.push(ix);
  }
}
const list = [...groups.values()].sort((a, b) => a.part.localeCompare(b.part) || a.mat - b.mat);
let vTotal = 0, iTotal = 0;
for (const G of list) { vTotal += G.verts.length / 8; iTotal += G.index.length; }
const bin = Buffer.alloc(vTotal * 32 + iTotal * 4);
let vo = 0, io = 0;
const outGroups = [];
for (const G of list) {
  outGroups.push({ part: G.part, mat: G.mat, v0: vo, vn: G.verts.length / 8, i0: io, in: G.index.length });
  for (let k = 0; k < G.verts.length; k++) bin.writeFloatLE(G.verts[k], vo * 32 + k * 4);
  vo += G.verts.length / 8;
  for (let k = 0; k < G.index.length; k++) bin.writeUInt32LE(G.index[k], vTotal * 32 + (io + k) * 4);
  io += G.index.length;
}
fs.writeFileSync(path.join(outDir, 'car.bin'), bin);

let licence = '';
try { licence = fs.readFileSync(path.join(src, 'license.txt'), 'utf8'); } catch { /* none came with it */ }
const pick = re => (licence.match(re) || [])[1]?.trim() || null;
const r3 = v => v.map(x => +x.toFixed(4));
const car = {
  v: 1, key, title: R.title, klass: R.klass,
  credit: { author: pick(/\* author:\s*(.+)/), source: pick(/\* source:\s*(.+)/), licence: pick(/\* license type:\s*(.+)/) },
  size: r3([all.size[0], all.size[1] + all.lo[1], all.size[2]]),
  lo: r3(all.lo), hi: r3(all.hi),
  eye: R.eye || [+(-0.02 * all.size[0]).toFixed(3), +(0.80 * (all.size[1] + all.lo[1])).toFixed(3), +(-0.19 * all.size[2]).toFixed(3)],
  wheelbase: +(((wheels.fl.c[0] + wheels.fr.c[0]) - (wheels.rl.c[0] + wheels.rr.c[0])) / 2).toFixed(4),
  trackF: +(wheels.fr.c[2] - wheels.fl.c[2]).toFixed(4), trackR: +(wheels.rr.c[2] - wheels.rl.c[2]).toFixed(4),
  wheels: Object.fromEntries(WHEELS.map(w => [w, { c: r3(wheels[w].c), r: +wheels[w].r.toFixed(4), w: +wheels[w].w.toFixed(4) }])),
  verts: vTotal, tris: iTotal / 3, stride: 32, indexAt: vTotal * 32,
  materials: mats, groups: outGroups,
};
fs.writeFileSync(path.join(outDir, 'car.json'), JSON.stringify(car, null, 1));
if (licence) fs.writeFileSync(path.join(outDir, 'LICENSE.txt'), licence);
// the list the showroom and the game read
const ixPath = path.join(outRoot, 'index.json');
let ix = [];
try { ix = JSON.parse(fs.readFileSync(ixPath, 'utf8')); } catch { /* the first car */ }
if (!R.prop) ix = ix.filter(c => c.key !== key).concat([{ key, title: R.title, klass: R.klass, tris: car.tris }]).sort((a, b) => a.klass.localeCompare(b.klass) || a.key.localeCompare(b.key));
if (!R.prop) fs.writeFileSync(ixPath, JSON.stringify(ix, null, 1));

// ---- say what was decided ---------------------------------------------------------------------
const parts = {};
for (const G of outGroups) parts[G.part] = (parts[G.part] || 0) + G.in / 3;
console.log(`${key}: ${R.title}`);
console.log(`  scale x${scale.toFixed(4)}   ${car.size.map(v => v.toFixed(2)).join(' x ')} m (long, high, wide)   ${car.tris} triangles in ${outGroups.length} groups` + (skipped ? `   (${skipped} meshes skipped)` : ''));
console.log(`  wheelbase ${car.wheelbase.toFixed(3)}   track ${car.trackF.toFixed(3)} / ${car.trackR.toFixed(3)}   tyre radius ${WHEELS.map(w => wheels[w].r.toFixed(3)).join(' ')}   width ${WHEELS.map(w => wheels[w].w.toFixed(2)).join(' ')}`);
console.log('  parts: ' + Object.entries(parts).map(([k, v]) => `${k} ${v}`).join('   '));
console.log('  materials: ' + mats.map(m => `${m.name}=${m.role}${m.map ? '[' + m.map + ']' : ''}`).join('  '));
console.log(`  -> ${outDir}/  car.bin ${(bin.length / 1e6).toFixed(1)} MB`);
