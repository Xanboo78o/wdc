// packcar.js — the DOWNLOADED cars (data/cars/<key>/: car.json + car.bin +
// textures, baked by tools/bakecar.mjs) as film actors.
//
// The loader is garage.html's, copied so that page is left alone: one
// interleaved buffer, a material per ROLE, wheels as groups about their hubs.
// Frame: x forward, y up, z right, metres, origin on the ground mid-wheelbase.
//
// What the film adds:
//   recolour   the paint's own texture with its near-white turned to a colour,
//              so a white car becomes a red one and keeps every sticker
//   lamps      the packs have no lamp role; the film draws its own (gt.js)
//   brakes     tail-role materials brighten, the disc material glows
//   headliner  a panel under the roof skin, in case the skin has a gap in it
import * as THREE from 'three';

const tl = new THREE.TextureLoader();

async function texture(url, recolour = null) {
  const t = await tl.loadAsync(url);
  let out = t;
  if (recolour) {
    // Near-white paint becomes the colour, scaled by how bright it was, so the
    // shading and the scuffs painted into the texture survive. Anything with a
    // colour of its own — stripes, roundels, sponsors — is left exactly as it is.
    const im = t.image, c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    const [R, G, B] = recolour;
    const ss = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      const w = ss(120, 190, mx) * (1 - ss(0.1, 0.28, (mx - mn) / Math.max(1, mx)));
      if (w <= 0) continue;
      const v = mx / 255;
      d[i] = r + (R * v - r) * w; d[i + 1] = gg + (G * v - gg) * w; d[i + 2] = b + (B * v - b) * w;
    }
    g.putImageData(id, 0, 0);
    out = new THREE.CanvasTexture(c);
  }
  out.colorSpace = THREE.SRGBColorSpace; out.flipY = false; out.wrapS = out.wrapT = THREE.RepeatWrapping; out.anisotropy = 8;
  return out;
}

function makeMaterial(m, map, o) {
  const col = new THREE.Color().setRGB(m.color[0], m.color[1], m.color[2]);
  let mat;
  switch (m.role) {
    case 'paint': mat = new THREE.MeshPhysicalMaterial({ color: col, map, roughness: o.gloss ?? 0.34, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 }); break;
    case 'glass': mat = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.55, envMapIntensity: 1.6, depthWrite: false }); break;
    case 'tyre': mat = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : 0x111214, map, roughness: 0.9, metalness: 0 }); break;
    case 'rim': mat = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : (col.getHSL({}).l < 0.02 ? new THREE.Color(0x2a2c30) : col), map, roughness: 0.32, metalness: 0.85 }); break;
    case 'chrome': mat = new THREE.MeshStandardMaterial({ color: 0xd6d8dc, map, roughness: 0.12, metalness: 1 }); break;
    case 'tail': mat = new THREE.MeshStandardMaterial({ color: map ? 0xffffff : 0x8a0a08, map, emissive: 0xff1408, emissiveIntensity: 0.9, emissiveMap: map, roughness: 0.25 }); break;
    case 'lamp': mat = new THREE.MeshStandardMaterial({ color: 0xe8eef5, emissive: 0xbfd4ee, emissiveIntensity: 0.6, roughness: 0.15, metalness: 0.3 }); break;
    default: mat = new THREE.MeshStandardMaterial({ color: col, map, roughness: Math.max(0.42, m.rough), metalness: Math.min(0.6, m.metal) * (map ? 0 : 1) });
  }
  if (m.alpha !== undefined && m.role !== 'glass') { mat.transparent = true; mat.opacity = Math.max(0.35, m.alpha); mat.depthWrite = false; }
  if (m.cutout) mat.alphaTest = 0.5;
  mat.side = THREE.DoubleSide;      // downloaded bodywork is often one skin thick: BOTH faces, always
  mat.userData.role = m.role; mat.userData.name = m.name;
  return mat;
}

/**
 * Load a pack. opts: { recolour: [r,g,b] 0-255 for the paint's white, tint: hex multiplied over the paint,
 * gloss: paint roughness, headliner: { x0, x1, z, y, colour } }.
 */
export async function loadPack(key, opts = {}) {
  const dir = `./data/cars/${key}/`;
  const car = await (await fetch(dir + 'car.json')).json();
  const buf = await (await fetch(dir + 'car.bin')).arrayBuffer();
  const V = new Float32Array(buf, 0, car.verts * 8), I = new Uint32Array(buf, car.indexAt, car.tris * 3);
  const maps = await Promise.all(car.materials.map(m => m.map ? texture(dir + m.map, m.role === 'paint' ? opts.recolour : null).catch(() => null) : null));
  const mats = car.materials.map((m, i) => makeMaterial(m, maps[i], opts));
  for (const m of mats) if (m.userData.role === 'paint' && opts.tint != null) m.color.set(opts.tint);
  const root = new THREE.Group();
  const hubs = {}, spins = {};
  for (const w of ['fl', 'fr', 'rl', 'rr']) {
    hubs[w] = new THREE.Group(); hubs[w].position.fromArray(car.wheels[w].c);
    spins[w] = new THREE.Group(); hubs[w].add(spins[w]); root.add(hubs[w]);
  }
  for (const G of car.groups) {
    const geo = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(V.subarray(G.v0 * 8, (G.v0 + G.vn) * 8), 8);
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    geo.setAttribute('uv', new THREE.InterleavedBufferAttribute(ib, 2, 6));
    geo.setIndex(new THREE.BufferAttribute(I.subarray(G.i0, G.i0 + G.in), 1));
    const mesh = new THREE.Mesh(geo, mats[G.mat]);
    mesh.castShadow = false; mesh.receiveShadow = false;
    if (mats[G.mat].transparent) mesh.renderOrder = 2;
    const w = G.part.slice(0, 2);
    (G.part === 'body' ? root : G.part.endsWith('.hub') ? hubs[w] : spins[w]).add(mesh);
  }
  if (opts.headliner) {
    // A plain panel a couple of centimetres under the roof skin. If the skin is
    // whole it is never seen; if a piece of it is missing, this is what shows.
    const h = opts.headliner, g = new THREE.PlaneGeometry(h.x1 - h.x0, 2 * h.z, 6, 6);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, h.y(p.getX(i) + (h.x0 + h.x1) / 2, p.getZ(i)));
    g.translate((h.x0 + h.x1) / 2, 0, 0); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: h.colour, roughness: 0.5, side: THREE.DoubleSide }));
    m.name = 'headliner'; root.add(m);
  }
  return { car, root, hubs, spins, mats };
}

const _v = new THREE.Vector3();
export class PackCar {
  constructor(stage, pack, name, opts = {}) {
    this.stage = stage; this.pack = pack; this.car = pack.car;
    this.root = new THREE.Group(); this.body = new THREE.Group();
    this.body.add(pack.root); this.root.add(this.body);
    this.root.name = 'car.' + name; this.root.visible = false;
    stage.scene.add(this.root);
    this.pos = this.root.position;
    this.tails = pack.mats.filter(m => m.userData.role === 'tail');
    this.discs = pack.mats.filter(m => /brake_disc/i.test(m.userData.name));
    for (const d of this.discs) { d.color.setScalar(0.32); d.emissive = new THREE.Color(1, 0.3, 0.05); d.emissiveMap = d.map; d.emissiveIntensity = 0; d.roughness = 0.6; }
    for (const m of pack.mats) if (m.userData.role === 'tyre') m.color.setScalar(opts.tyre ?? 1);   // a wet tyre is a dark one, and its lettering goes with it
    this.pose = null;
  }
  /** Stand it where js/ads/gt-plan.js pose() says. */
  place(p, { heat = 0, bodyVisible = true } = {}) {
    this.pose = p;
    this.root.visible = true; this.pack.root.visible = bodyVisible;
    this.root.position.copy(p.pos); this.root.quaternion.copy(p.quat);
    // on the brakes the nose goes down a centimetre
    this.body.rotation.z = -p.dive * 0.011; this.body.position.y = -p.dive * 0.012;
    const k = this.pack, W = this.car.wheels;
    for (const w in k.spins) k.spins[w].rotation.z = -p.dist / W[w].r;
    k.hubs.fl.rotation.y = p.steer; k.hubs.fr.rotation.y = p.steer;
    for (const m of this.tails) m.emissiveIntensity = 1.1 + 7 * p.brake;
    for (const m of this.discs) m.emissiveIntensity = 5.5 * heat * heat;
    return this;
  }
  hide() { this.root.visible = false; this.pose = null; }
  local(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyQuaternion(this.root.quaternion).add(this.root.position); }
}
void _v;
