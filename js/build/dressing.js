// dressing.js — everything beside the road: the walls and their banner, the
// catch fence, braking boards, corner numbers, marshal posts and a grandstand.
//
// One sponsor, on purpose: XB STUDIOS, repeated along every wall with no gap.
// The banner is a single texture tiled in METRES along the wall (the same rule
// as the rest of the game — UVs are metres), so it runs unbroken through every
// corner and never stretches.
//
// Nothing here changes the driving. The walls stand exactly where the physics
// already puts the barrier (road edge + run-off), and everything else is behind
// them or on top of them.
import * as THREE from 'three';
import { pointAt } from './path.js';
import { V } from './meshes.js';

export const BRAND = {
  ink: '#0f1217', white: '#f4f6f8', mint: '#35d6a0',
  TILE: 7.0,           // m of wall per banner tile (two logos)
  H: 1.1,              // m, wall height — the banner covers the whole face
};
const WALL_T = 0.5;    // m thick
const FENCE_H = 2.8;   // m of catch fence above the wall

// ---------------------------------------------------------------------------
// The logo. "XB" drawn as shapes, not typed in a font, so it looks the same on
// every machine; "STUDIOS" small beside it. Heavy, slanted forward, white on
// near-black with a mint accent — readable at 250 km/h, which is the job.
// ---------------------------------------------------------------------------
function drawXB(c, x, base, h) {
  // X: two bars with horizontal ends
  const w = 0.92 * h, t = 0.27 * h;
  c.beginPath();
  c.moveTo(x, base); c.lineTo(x + t, base); c.lineTo(x + w, base - h); c.lineTo(x + w - t, base - h); c.closePath();
  c.moveTo(x + w - t, base); c.lineTo(x + w, base); c.lineTo(x + t, base - h); c.lineTo(x, base - h); c.closePath();
  c.fill();
  // B: stem and two bowls, counters punched out in the background colour
  const bx = x + w + 0.12 * h, s = 0.24 * h, mid = base - 0.5 * h;
  const upW = 0.66 * h, loW = 0.74 * h, upH = 0.5 * h + s / 2, loH = 0.5 * h + s / 2;
  const fill = c.fillStyle;
  c.beginPath();
  c.roundRect(bx, base - h, upW, upH, [0, upH / 2, upH / 2, 0]);
  c.roundRect(bx, mid - s / 2, loW, loH, [0, loH / 2, loH / 2, 0]);
  c.fill();
  c.fillStyle = BRAND.ink;
  const ch = upH - 2 * s, lh = loH - 2 * s;
  c.beginPath();
  c.roundRect(bx + s, base - h + s, upW - 2 * s - 0.02 * h, ch, [0, ch / 2, ch / 2, 0]);
  c.roundRect(bx + s, mid - s / 2 + s, loW - 2 * s - 0.02 * h, lh, [0, lh / 2, lh / 2, 0]);
  c.fill();
  c.fillStyle = fill;
  return bx + loW - x;                               // width drawn
}

function logo(c, cx, base, h) {
  // measure first so the pair is centred on cx
  const hS = 0.36 * h;
  c.font = `700 ${hS}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  c.letterSpacing = `${0.2 * hS}px`;
  const wS = c.measureText('STUDIOS').width;
  const wXB = 0.92 * h + 0.12 * h + 0.74 * h, gap = 0.22 * h;
  const total = wXB + gap + wS + 0.2 * h;             // + the slant's overhang
  const x0 = cx - total / 2;
  c.save();
  c.translate(x0, base);
  c.transform(1, 0, -0.2, 1, 0, 0);                   // lean forward
  c.fillStyle = BRAND.white;
  drawXB(c, 0, 0, h);
  c.fillStyle = BRAND.mint;
  c.textBaseline = 'alphabetic';
  c.fillText('STUDIOS', wXB + gap, 0);
  c.restore();
}

export function brandTexture(aniso = 8) {
  const W = 2048, H = 320;                            // 7.0 m x 1.1 m, square pixels
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = BRAND.ink; c.fillRect(0, 0, W, H);
  c.fillStyle = BRAND.mint; c.fillRect(0, 0, W, 9);   // accent along the top edge
  c.fillStyle = '#23272e'; c.fillRect(0, H - 22, W, 22);
  const capH = 0.52 * H;
  for (const cx of [W / 4, 3 * W / 4]) logo(c, cx, H * 0.74, capH);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = aniso;
  return tex;
}

function boardTexture(text, { bg = '#f4f6f8', ink = BRAND.ink, sub = true, w = 512, h = 384 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = bg; c.fillRect(0, 0, w, h);
  c.fillStyle = ink;
  c.font = `800 ${h * 0.5}px "Inter", "Helvetica Neue", Arial, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(text, w / 2, h * (sub ? 0.42 : 0.5));
  if (sub) {
    c.fillStyle = BRAND.ink; c.fillRect(0, h * 0.78, w, h * 0.22);
    c.save(); c.translate(0, h * 0.965);
    logo(c, w / 2, 0, h * 0.14);
    c.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Where the walls are: the physics barrier line, w + run from the centreline,
// minus the stretches on the inside of a corner so tight the offset line folds
// back through itself (it would draw a knot there).
// ---------------------------------------------------------------------------
function wallLine(path, ground, side) {
  const pts = [];
  let arc = 0, prev = null;
  for (let i = 0; i < path.n; i++) {
    const off = path.w[i] + (side > 0 ? path.runL[i] : path.runR[i]);
    const inside = Math.sign(path.k[i]) === side;
    const ok = !inside || (off + WALL_T) * Math.abs(path.k[i]) < 0.8;
    const f = pointAt(path, i, side * off), b = pointAt(path, i, side * (off + WALL_T));
    if (prev) arc += Math.hypot(f.x - prev.x, f.y - prev.y);
    prev = f;
    pts.push({ i, ok, f, b, g: ground.height(f.x, f.y), arc, h: path.hdg[i] });
  }
  return pts;
}

export function buildWalls(path, ground, brand) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa9adb2, roughness: 0.85 });
  const banner = new THREE.MeshStandardMaterial({ map: brand, roughness: 0.55, metalness: 0.05 });
  const H = BRAND.H, SINK = 0.35;
  const posts = [];

  for (const side of [1, -1]) {
    const L = wallLine(path, ground, side);
    const fp = [], fn = [], fu = [], fi = [];           // banner face
    const cp = [], cn = [], ci = [];                    // top + back, concrete
    const normalIn = p => {                             // horizontal, toward the road
      const nx = Math.sin(p.h) * side, ny = -Math.cos(p.h) * side;
      return [nx, 0, -ny];
    };
    L.forEach((p, k) => {
      const [nx, , nz] = normalIn(p);
      const u = side * p.arc / BRAND.TILE;
      // face: bottom (sunk into the ground), top
      fp.push(p.f.x, p.g - SINK, -p.f.y, p.f.x, p.g + H, -p.f.y);
      fn.push(nx, 0, nz, nx, 0, nz);
      fu.push(u, -SINK / H, u, 1);
      // concrete: face-top, back-top (up), back-top, back-bottom (out)
      cp.push(p.f.x, p.g + H, -p.f.y, p.b.x, p.g + H, -p.b.y, p.b.x, p.g + H, -p.b.y, p.b.x, p.g - SINK, -p.b.y);
      cn.push(0, 1, 0, 0, 1, 0, -nx, 0, -nz, -nx, 0, -nz);
      if (k === 0) return;
      const q = L[k - 1];
      if (!p.ok || !q.ok) return;
      const a = (k - 1) * 2, b = k * 2;                 // face: a=bottom i-1, a+1=top i-1
      if (side > 0) fi.push(a, b, b + 1, a, b + 1, a + 1);
      else fi.push(a, b + 1, b, a, a + 1, b + 1);
      const A = (k - 1) * 4, B = k * 4;
      if (side > 0) {
        ci.push(A, B, B + 1, A, B + 1, A + 1);                     // top
        ci.push(B + 3, A + 3, A + 2, B + 3, A + 2, B + 2);         // back
      } else {
        ci.push(A, B + 1, B, A, A + 1, B + 1);
        ci.push(B + 3, A + 2, A + 3, B + 3, B + 2, A + 2);
      }
      if (k % 2 === 0) posts.push({ x: p.b.x, y: p.b.y, g: p.g + H, h: p.h });
    });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    fg.setIndex(fi);
    const face = new THREE.Mesh(fg, banner);
    face.castShadow = true; face.receiveShadow = true;
    group.add(face);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
    cg.setIndex(ci);
    const cm = new THREE.Mesh(cg, concrete);
    cm.castShadow = true; cm.receiveShadow = true;
    group.add(cm);

    // Catch fence along the back edge of the wall. Blended, never
    // alpha-tested: an alpha-tested mesh speckles into black dots in the
    // distance as its mips average away (DESIGN.md, the pit-lane fence).
    const wp = [], wu = [], wi = [];
    L.forEach((p, k) => {
      wp.push(p.b.x, p.g + H, -p.b.y, p.b.x, p.g + H + FENCE_H, -p.b.y);
      wu.push(p.arc / 0.5, 0, p.arc / 0.5, FENCE_H / 0.5);
      if (k && p.ok && L[k - 1].ok) { const a = (k - 1) * 2, b = k * 2; wi.push(a, b, b + 1, a, b + 1, a + 1); }
    });
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    wg.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
    wg.setIndex(wi);
    wg.computeVertexNormals();
    group.add(new THREE.Mesh(wg, fenceMaterial()));
  }

  const pg = new THREE.CylinderGeometry(0.045, 0.045, FENCE_H + 0.1, 6);
  pg.translate(0, (FENCE_H + 0.1) / 2, 0);
  const inst = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.5, metalness: 0.6 }), posts.length);
  const M = new THREE.Matrix4();
  posts.forEach((p, n) => { M.makeTranslation(p.x, p.g, -p.y); inst.setMatrixAt(n, M); });
  inst.castShadow = true;
  group.add(inst);
  return group;
}

let _fence = null;
function fenceMaterial() {
  if (_fence) return _fence;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.strokeStyle = 'rgba(70, 76, 84, 0.9)'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, 0); c.lineTo(64, 64); c.moveTo(64, 0); c.lineTo(0, 64); c.stroke();
  c.fillStyle = 'rgba(70, 76, 84, 0.9)'; c.fillRect(0, 0, 64, 4);   // a horizontal cable per tile row
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  _fence = new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4,
  });
  return _fence;
}

// ---------------------------------------------------------------------------
// Boards on the fence, marshal posts behind the wall, a grandstand.
// ---------------------------------------------------------------------------
export function buildDetails(path, ground, brand) {
  const group = new THREE.Group();
  const H = BRAND.H;
  const wallAt = (i, side) => {
    const off = path.w[i] + (side > 0 ? path.runL[i] : path.runR[i]);
    const f = pointAt(path, i, side * off);
    return { off, f, g: ground.height(f.x, f.y) };
  };
  const idx = s => Math.max(0, Math.min(path.n - 1, Math.round(s / path.ds)));

  // a board facing the oncoming car, fixed to the fence above the wall
  const board = (tex, i, side, w, h, lift) => {
    const { off, g } = wallAt(i, side);
    const p = pointAt(path, i, side * (off + 0.1));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    m.position.copy(V(p.x, p.y, g + H + lift));
    // plane faces +z; turn it to face back down the road, toward the car
    m.rotation.y = path.hdg[i] - Math.PI / 2;
    m.castShadow = true;
    group.add(m);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, h + 0.1, w + 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.6 }));
    back.position.copy(m.position).add(new THREE.Vector3(Math.cos(path.hdg[i]) * 0.05, 0, -Math.sin(path.hdg[i]) * 0.05));
    back.rotation.y = path.hdg[i];
    group.add(back);
  };

  // Braking boards: 300 / 200 / 100 before every corner that has a straight
  // long enough in front of it to need them, on the OUTSIDE of that corner.
  // Corner numbers: T1, T2 ... at each corner's apex, also outside.
  const texCache = {};
  const tx = (k, o) => texCache[k] || (texCache[k] = boardTexture(k, o));
  let corner = 0;
  path.pieces.forEach((pc, n) => {
    if (pc.kind !== 'turn') return;
    corner++;
    const outside = pc.dir === 'left' ? -1 : 1;
    const before = path.pieces[n - 1];
    if (before && before.kind === 'straight' && before.len >= 150) {
      for (const d of [300, 200, 100]) {
        if (d > before.len - 20) continue;
        board(tx(String(d)), idx(pc.s0 - d), outside, 1.5, 1.125, 0.75);
      }
    }
    board(tx('T' + corner, { bg: BRAND.ink, ink: BRAND.white, sub: false, w: 256, h: 256 }),
      idx((pc.s0 + pc.s1) / 2), outside, 1.4, 1.4, 0.9);
  });

  // Marshal posts every 400 m, alternating sides, just behind the wall.
  const hut = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xf07a1a, roughness: 0.6 });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xf2d21b, roughness: 0.8, side: THREE.DoubleSide });
  for (let s = 200, side = 1; s < path.length - 40; s += 400, side = -side) {
    const i = idx(s), { off } = wallAt(i, side);
    const p = pointAt(path, i, side * (off + WALL_T + 2.0));
    const g = ground.height(p.x, p.y), h = path.hdg[i];
    const box = (sx, sy, sz, y, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.copy(V(p.x, p.y, g + y)); m.rotation.y = h;
      m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
    };
    box(2.2, 2.6, 1.8, 1.3 - 0.3, hut);
    box(2.3, 0.35, 1.9, 2.45, orange);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4.2, 6), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.4 }));
    pole.position.copy(V(p.x, p.y, g + 2.1)).add(new THREE.Vector3(Math.cos(h) * 1.3, 0, -Math.sin(h) * 1.3));
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), flagMat);
    flag.position.copy(pole.position).add(new THREE.Vector3(Math.cos(h) * 0.45, 1.75, -Math.sin(h) * 0.45));
    flag.rotation.y = h;
    group.add(flag);
  }

  // Grandstand facing the start straight, on the right. Its foundation goes
  // down to the LOWEST ground under it, so no slope can leave it floating.
  {
    const side = -1, s0 = 30, s1 = Math.min(160, path.pieces[0].s1 - 20);
    if (s1 - s0 > 40) {
      const i0 = idx(s0), i1 = idx(s1), im = idx((s0 + s1) / 2);
      const h = path.hdg[im], len = (i1 - i0) * path.ds;
      const { off } = wallAt(im, side);
      const front = off + WALL_T + 6;
      const ROWS = 14, DEPTH = 0.85, RISE = 0.48, PODIUM = 2.6;
      let gMin = Infinity;
      for (let i = i0; i <= i1; i += 4) for (let l = front; l <= front + ROWS * DEPTH + 3; l += 3) {
        const q = pointAt(path, i, side * l); gMin = Math.min(gMin, ground.height(q.x, q.y));
      }
      const gFront = ground.height(pointAt(path, im, side * front).x, pointAt(path, im, side * front).y);
      const base = gMin - 1;
      const mid = pointAt(path, im, 0);
      const at = (lat, y) => { const q = { x: mid.x - Math.sin(h) * side * lat, y: mid.y + Math.cos(h) * side * lat }; return V(q.x, q.y, y); };
      const stand = new THREE.Group();
      const grey = new THREE.MeshStandardMaterial({ color: 0x8f949b, roughness: 0.8 });
      const seatA = new THREE.MeshStandardMaterial({ color: 0x4a515c, roughness: 0.7 });
      const seatB = new THREE.MeshStandardMaterial({ color: 0x2aa37c, roughness: 0.7 });
      const add = (sx, sy, sz, pos, mat, shadow = true) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
        m.position.copy(pos); m.rotation.y = h; m.castShadow = shadow; m.receiveShadow = true;
        stand.add(m); return m;
      };
      // podium (front wall carries the banner) and the stepped rows
      const topFront = gFront + PODIUM;
      add(len, topFront - base, 1.2, at(front + 0.6, (topFront + base) / 2), grey);
      const bannerMat = new THREE.MeshStandardMaterial({ map: brand.clone(), roughness: 0.55 });
      bannerMat.map.repeat.set(len / BRAND.TILE, 1); bannerMat.map.needsUpdate = true;
      const podBanner = new THREE.Mesh(new THREE.PlaneGeometry(len, BRAND.H), bannerMat);
      podBanner.position.copy(at(front - 0.01, topFront - BRAND.H / 2 - 0.3));
      podBanner.rotation.y = h + (side < 0 ? Math.PI : 0);   // face the road
      stand.add(podBanner);
      for (let r = 0; r < ROWS; r++) {
        const top = topFront + (r + 1) * RISE;
        add(len, top - base, DEPTH, at(front + 1.2 + (r + 0.5) * DEPTH, (top + base) / 2), grey, r === ROWS - 1);
        add(len - 1, 0.42, DEPTH * 0.45, at(front + 1.2 + (r + 0.62) * DEPTH, top + 0.21), r % 5 === 2 ? seatB : seatA, false);
      }
      // back wall, columns, roof with a banner fascia
      const back = front + 1.2 + ROWS * DEPTH;
      const roofY = topFront + ROWS * RISE + 4.2;
      add(len, roofY - base, 0.4, at(back + 0.2, (roofY + base) / 2), grey);
      for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 12) {
        const c = add(0.35, roofY - topFront, 0.35, at(front + 1.0, (roofY + topFront) / 2), grey);
        c.position.add(new THREE.Vector3(Math.cos(h) * x, 0, -Math.sin(h) * x));
      }
      add(len + 2, 0.35, back - front + 3, at((front + back) / 2 - 1, roofY + 0.4), new THREE.MeshStandardMaterial({ color: 0xdfe3e7, roughness: 0.6, metalness: 0.2 }));
      const fasciaMat = new THREE.MeshStandardMaterial({ map: brand.clone(), roughness: 0.55 });
      fasciaMat.map.repeat.set((len + 2) / BRAND.TILE, 1); fasciaMat.map.needsUpdate = true;
      const fascia = new THREE.Mesh(new THREE.PlaneGeometry(len + 2, BRAND.H), fasciaMat);
      fascia.position.copy(at(front - 2.52, roofY + 0.4));
      fascia.rotation.y = h + (side < 0 ? Math.PI : 0);
      stand.add(fascia);
      group.add(stand);
    }
  }
  return group;
}

// A banner across the start gantry's beam, both faces.
export function gantryBanner(brand, beam) {
  const { x, y, z, span, hdg } = beam;
  const group = new THREE.Group();
  for (const face of [1, -1]) {
    const mat = new THREE.MeshStandardMaterial({ map: brand.clone(), roughness: 0.55 });
    mat.map.repeat.set(span / BRAND.TILE * (BRAND.H / 1.3), 1); mat.map.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(span, 1.3), mat);
    m.position.set(x + Math.cos(hdg) * 0.46 * face, y, z - Math.sin(hdg) * 0.46 * face);
    m.rotation.y = hdg + (face > 0 ? Math.PI / 2 : -Math.PI / 2);
    group.add(m);
  }
  return group;
}
