// scview.js — the vehicles race control sends out, drawn.
//
// Adam, 2026-10-04: "when safety cars are out, make a actual safty car out"
// and "make actual safty vehicles come out and retrive me". The safety car
// has been SIMULATED since js/safetycar.js went in (race.rc.sc: a physics car
// record driven along the racing line, `out` while it is on the circuit or in
// the lane, `lights` while its roof bar is lit) and nothing ever drew it — the
// field queued up behind an empty piece of road. This draws it, and whatever
// race control lists in `race.rc.vehicles`:
//
//   { kind: 'truck' | 'medical', x, y, hdg, lights, towing }   (sim frame)
//
// Placed exactly as js/field.js places a rival: sim (x, y) is three (x, -y),
// heading is rotation.y on the yaw parent, and the height is the surveyed road
// under it plus the camber of the corner it is in. Each vehicle is a handful
// of merged meshes with emissive lamps — no real lights, no per-frame
// allocation — and the whole thing is a no-op in a hot lap.
import * as THREE from 'three';
import { Z, Builder } from './geom.js';
import { bankY } from './bank.js';

const MAX_TRUCKS = 3, MAX_MEDICAL = 1;
const FLASH_HZ = 3;

// ---- small kit -----------------------------------------------------------------
// Several plain geometries welded into one, each moved into place first.
function weld(parts) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (const [g, m] of parts) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (m) geo.applyMatrix4(m);
    const base = pos.length / 3;
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      idx.push(base + i);
    }
    if (geo !== g) geo.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// Four (or six) wheels as one mesh: a tyre is a short cylinder lying on its
// side across the car. Local frame: +x forward, +y up, z across.
function wheelsGeometry(spots, r, width) {
  const parts = [];
  for (const [x, z] of spots) {
    const tyre = new THREE.CylinderGeometry(r, r, width, 14);
    const hub = new THREE.CylinderGeometry(r * 0.56, r * 0.56, width * 1.04, 10);
    const m = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, r, z);
    parts.push([tyre, m], [hub, m.clone()]);
  }
  return weld(parts);
}

// A row of lamp boxes as one mesh.
function lampsGeometry(boxes) {
  return weld(boxes.map(([x, y, z, sx, sy, sz]) =>
    [new THREE.BoxGeometry(sx, sy, sz), new THREE.Matrix4().makeTranslation(x, y, z)]));
}

function lampMat(hex) {
  return new THREE.MeshStandardMaterial({ color: 0x1a1a1c, emissive: hex, emissiveIntensity: 0, roughness: 0.35, metalness: 0 });
}

const paint = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.35, envMapIntensity: 1.1 });
const GLASS = () => new THREE.MeshStandardMaterial({ color: 0x0e1218, roughness: 0.08, metalness: 0.7, envMapIntensity: 1.6 });
const RUBBER = () => new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.85, metalness: 0.05 });

// "SAFETY CAR" for the doors, drawn once.
function letteringTexture(text, fg, bg) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg; g.font = '900 64px "Arial Black", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52, 480);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// A decal on both flanks: two quads, the far one turned round so it reads
// the right way from outside.
function doorDecals(len, h, y, zHalf) {
  const a = new THREE.PlaneGeometry(len, h), b = new THREE.PlaneGeometry(len, h);
  return weld([
    [a, new THREE.Matrix4().makeTranslation(0, y, zHalf + 0.012)],
    [b, new THREE.Matrix4().makeRotationY(Math.PI).setPosition(0, y, -zHalf - 0.012)],
  ]);
}

function rig(group) {
  const yaw = new THREE.Group();
  yaw.add(group);
  yaw.visible = false;
  return yaw;
}

// ---- the three vehicles ----------------------------------------------------------
// THE SAFETY CAR: a long-bonnet GT coupe, silver over a dark sill, the light
// bar on the roof. 4.6 m by 1.95 m by 1.28 m.
function buildSafetyCar() {
  const g = new THREE.Group();
  const b = new Builder({ color: true });
  const SILVER = 0xc9ced4, DARK = 0x23272d, RED = 0xb3121d;
  b.box(0.00, 0.33, 0, 4.50, 0.26, 1.90, 0, DARK);          // sill and floor
  b.box(0.05, 0.60, 0, 4.60, 0.34, 1.95, 0, SILVER);        // the body, nose to tail
  b.box(1.45, 0.80, 0, 1.70, 0.12, 1.80, 0, SILVER);        // bonnet
  b.box(-0.45, 1.02, 0, 1.85, 0.44, 1.62, 0, SILVER);       // cabin
  b.box(-1.85, 0.84, 0, 0.90, 0.16, 1.80, 0, SILVER);       // boot deck
  b.box(-2.22, 1.02, 0, 0.14, 0.05, 1.70, 0, DARK);         // wing blade
  b.box(-2.18, 0.94, 0.72, 0.08, 0.14, 0.06, 0, DARK);
  b.box(-2.18, 0.94, -0.72, 0.08, 0.14, 0.06, 0, DARK);
  b.box(2.34, 0.50, 0, 0.06, 0.18, 1.50, 0, DARK);          // grille
  b.box(-2.26, 0.62, 0.70, 0.04, 0.10, 0.40, 0, RED);       // tail lamps
  b.box(-2.26, 0.62, -0.70, 0.04, 0.10, 0.40, 0, RED);
  b.box(-0.45, 1.27, 0, 0.26, 0.06, 1.16, 0, DARK);         // the light bar's base
  const body = b.mesh(paint());
  g.add(body);

  const gl = new Builder();
  gl.box(0.52, 1.02, 0, 0.10, 0.36, 1.50, 0);               // screen
  gl.box(-1.40, 1.02, 0, 0.10, 0.32, 1.40, 0);              // rear glass
  gl.box(-0.45, 1.06, 0.815, 1.50, 0.26, 0.02, 0);          // side glass
  gl.box(-0.45, 1.06, -0.815, 1.50, 0.26, 0.02, 0);
  g.add(gl.mesh(GLASS(), { shadow: false }));

  const wheels = new THREE.Mesh(wheelsGeometry([[1.42, 0.86], [1.42, -0.86], [-1.36, 0.86], [-1.36, -0.86]], 0.34, 0.30), RUBBER());
  g.add(wheels);

  const tex = letteringTexture('SAFETY CAR', '#111418', '#e9ecef');
  if (tex) {
    const decal = new THREE.Mesh(doorDecals(1.45, 0.27, 0.62, 0.975),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.1 }));
    g.add(decal);
  }

  const A = lampMat(0xffa200), B = lampMat(0xffa200);
  g.add(new THREE.Mesh(lampsGeometry([[-0.45, 1.34, 0.36, 0.20, 0.09, 0.40]]), A));
  g.add(new THREE.Mesh(lampsGeometry([[-0.45, 1.34, -0.36, 0.20, 0.09, 0.40]]), B));
  body.castShadow = true; wheels.castShadow = false;
  return { yaw: rig(g), A, B };
}

// THE RECOVERY TRUCK: cab forward, a flat bed behind, two amber beacons on
// the cab roof. 7.4 m by 2.4 m.
function buildTruck() {
  const g = new THREE.Group();
  const b = new Builder({ color: true });
  const YEL = 0xe0a012, DARK = 0x2a2d31, STEEL = 0x8b9198, WHITE = 0xe9e9e6;
  b.box(0.0, 0.72, 0, 7.20, 0.26, 1.00, 0, DARK);           // chassis rails
  b.box(2.60, 1.72, 0, 1.90, 1.76, 2.36, 0, YEL);           // cab
  b.box(3.62, 1.02, 0, 0.16, 0.50, 2.30, 0, DARK);          // bumper
  b.box(-1.15, 1.02, 0, 5.30, 0.16, 2.40, 0, STEEL);        // the bed
  b.box(1.42, 1.50, 0, 0.14, 0.86, 2.30, 0, STEEL);         // headboard
  b.box(-1.15, 1.16, 1.17, 5.30, 0.14, 0.06, 0, YEL);       // bed rails
  b.box(-1.15, 1.16, -1.17, 5.30, 0.14, 0.06, 0, YEL);
  b.box(-3.92, 0.86, 0, 0.26, 0.10, 2.36, 0, WHITE);        // tail board, chevrons' place
  b.box(0.90, 1.80, 0, 0.22, 1.40, 0.22, 0, DARK);          // crane post
  b.box(0.10, 2.44, 0, 1.80, 0.16, 0.18, 0, DARK);          // jib
  b.box(2.60, 2.64, 0, 0.30, 0.08, 1.50, 0, DARK);          // beacon bar
  const body = b.mesh(paint());
  g.add(body);

  const gl = new Builder();
  gl.box(3.56, 2.02, 0, 0.04, 0.72, 2.00, 0);               // screen
  gl.box(2.80, 2.06, 1.19, 1.10, 0.62, 0.02, 0);            // door glass
  gl.box(2.80, 2.06, -1.19, 1.10, 0.62, 0.02, 0);
  g.add(gl.mesh(GLASS(), { shadow: false }));

  const wheels = new THREE.Mesh(wheelsGeometry(
    [[2.55, 1.02], [2.55, -1.02], [-1.60, 1.02], [-1.60, -1.02], [-2.75, 1.02], [-2.75, -1.02]], 0.50, 0.34), RUBBER());
  g.add(wheels);

  const A = lampMat(0xffa200), B = lampMat(0xffa200);
  g.add(new THREE.Mesh(lampsGeometry([[2.60, 2.76, 0.56, 0.22, 0.16, 0.22], [-3.90, 1.14, -1.00, 0.10, 0.14, 0.24]]), A));
  g.add(new THREE.Mesh(lampsGeometry([[2.60, 2.76, -0.56, 0.22, 0.16, 0.22], [-3.90, 1.14, 1.00, 0.10, 0.14, 0.24]]), B));
  body.castShadow = true;
  return { yaw: rig(g), A, B };
}

// THE MEDICAL CAR: a white estate with a red stripe down each flank — a
// stripe, not a red cross, which is a protected emblem — and a blue and an
// amber beacon. 4.8 m by 1.95 m by 1.6 m.
function buildMedical() {
  const g = new THREE.Group();
  const b = new Builder({ color: true });
  const WHITE = 0xf1f1ee, RED = 0xc8141f, DARK = 0x24272b;
  b.box(0.00, 0.40, 0, 4.60, 0.30, 1.88, 0, DARK);          // sill
  b.box(0.00, 0.78, 0, 4.80, 0.50, 1.94, 0, WHITE);         // body
  b.box(-0.55, 1.28, 0, 3.10, 0.56, 1.78, 0, WHITE);        // the long roof of an estate
  b.box(0.00, 0.86, 0.975, 4.60, 0.16, 0.02, 0, RED);       // the stripe
  b.box(0.00, 0.86, -0.975, 4.60, 0.16, 0.02, 0, RED);
  b.box(2.41, 0.66, 0, 0.04, 0.20, 1.40, 0, DARK);          // grille
  b.box(-2.41, 0.86, 0.72, 0.04, 0.12, 0.40, 0, RED);       // tail lamps
  b.box(-2.41, 0.86, -0.72, 0.04, 0.12, 0.40, 0, RED);
  b.box(-0.30, 1.59, 0, 0.26, 0.06, 1.20, 0, DARK);         // beacon bar
  const body = b.mesh(paint());
  g.add(body);

  const gl = new Builder();
  gl.box(1.02, 1.28, 0, 0.08, 0.44, 1.66, 0);               // screen
  gl.box(-2.12, 1.28, 0, 0.08, 0.40, 1.60, 0);              // tailgate glass
  gl.box(-0.55, 1.30, 0.895, 2.70, 0.34, 0.02, 0);          // side glass
  gl.box(-0.55, 1.30, -0.895, 2.70, 0.34, 0.02, 0);
  g.add(gl.mesh(GLASS(), { shadow: false }));

  const wheels = new THREE.Mesh(wheelsGeometry([[1.50, 0.86], [1.50, -0.86], [-1.45, 0.86], [-1.45, -0.86]], 0.36, 0.28), RUBBER());
  g.add(wheels);

  const A = lampMat(0x2a6bff), B = lampMat(0xffa200);
  g.add(new THREE.Mesh(lampsGeometry([[-0.30, 1.67, 0.38, 0.20, 0.10, 0.40]]), A));
  g.add(new THREE.Mesh(lampsGeometry([[-0.30, 1.67, -0.38, 0.20, 0.10, 0.40]]), B));
  body.castShadow = true;
  return { yaw: rig(g), A, B };
}

// Which of the two lamps is lit at time t: they alternate, FLASH_HZ times a
// second each. Exported because it is the one piece of this that Node can test.
export function flashPhase(t) { return Math.floor(t * FLASH_HZ * 2) % 2 === 0; }

// ---- the class ------------------------------------------------------------------
export class RaceVehicles {
  constructor(view, cls) {
    this.view = view; this.cls = cls;
    this.group = new THREE.Group();
    this.group.name = 'raceVehicles';
    this.sc = null; this.trucks = []; this.medical = [];
    this.hints = new Map();
    this.ok = false;
    try {
      this.sc = buildSafetyCar();
      for (let k = 0; k < MAX_TRUCKS; k++) this.trucks.push(buildTruck());
      for (let k = 0; k < MAX_MEDICAL; k++) this.medical.push(buildMedical());
      for (const v of [this.sc, ...this.trucks, ...this.medical]) this.group.add(v.yaw);
      if (view && view.scene) { view.scene.add(this.group); this.ok = true; }
    } catch (e) { console.error('scview:', e); }
  }

  // Put one vehicle on the road at sim (x, y), facing `hdg`.
  place(v, key, x, y, hdg, z = 0) {
    const view = this.view, t = view.track;
    let surfaceY = 0;
    if (t && view.world) {
      const proj = t.project(x, y, this.hints.get(key) ?? null);
      this.hints.set(key, proj.i);
      surfaceY = view.world.trackYAt(proj.s) + (view.bank ? bankY(view.bank, t, proj.i, proj.lat) : 0);
    }
    v.yaw.position.set(x, surfaceY + z, Z(y));
    v.yaw.rotation.y = hdg;
    v.yaw.visible = true;
  }

  lamps(v, on, phase) {
    v.A.emissiveIntensity = on && phase ? 3.2 : 0;
    v.B.emissiveIntensity = on && !phase ? 3.2 : 0;
  }

  frame(race /* , frame */) {
    if (!this.ok) return;
    try {
      const rc = race && race.rc;
      const sc = rc && rc.sc;
      const phase = flashPhase(race ? race.time || 0 : 0);
      // The safety car: wherever race control is driving it.
      if (sc && sc.out && sc.car && Number.isFinite(sc.car.x) && Number.isFinite(sc.car.y)) {
        this.place(this.sc, 'sc', sc.car.x, sc.car.y, sc.car.hdg || 0, sc.car.z || 0);
        this.lamps(this.sc, !!sc.lights, phase);
      } else if (this.sc.yaw.visible) { this.sc.yaw.visible = false; this.hints.delete('sc'); }

      // Trucks and the medical car, from the list; the rest of each pool hides.
      const list = rc && Array.isArray(rc.vehicles) ? rc.vehicles : null;
      let nt = 0, nm = 0;
      if (list) {
        for (const it of list) {
          if (!it || !Number.isFinite(it.x) || !Number.isFinite(it.y)) continue;
          const med = it.kind === 'medical';
          const pool = med ? this.medical : this.trucks;
          const k = med ? nm : nt;
          if (k >= pool.length) continue;
          const v = pool[k];
          this.place(v, (med ? 'm' : 't') + k, it.x, it.y, it.hdg || 0);
          this.lamps(v, !!it.lights, phase);
          if (med) nm++; else nt++;
        }
      }
      for (let k = nt; k < this.trucks.length; k++) if (this.trucks[k].yaw.visible) { this.trucks[k].yaw.visible = false; this.hints.delete('t' + k); }
      for (let k = nm; k < this.medical.length; k++) if (this.medical[k].yaw.visible) { this.medical[k].yaw.visible = false; this.hints.delete('m' + k); }
    } catch (e) {
      // Never take the frame down for a truck.
      if (!this.warned) { this.warned = true; console.error('scview frame:', e); }
    }
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    });
    this.ok = false;
  }
}
