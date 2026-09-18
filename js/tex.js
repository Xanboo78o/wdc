// tex.js — the material library, and the sky that lights it.
//
// Everything painted in this sim comes from two piles of real CC0 data:
//
//   data/tex/   photoscanned PBR from ambientCG      (tools/gettex.mjs)
//   data/sky/   Poly Haven sky HDRIs, tone-mapped    (tools/getsky.mjs)
//
// Both are public domain, which matters because this ships on GitHub Pages.
// Neither is generated. See the SOURCE.md in each directory.
//
// ---------------------------------------------------------------------------
// The one idea in this file: UVs ARE METRES.
//
// Every surface in the world is UV-mapped in real-world metres — u and v run
// 0..1 per metre, not 0..1 per face. A material then just says how big its
// texture is on the ground ("this asphalt photo is 2 m across") and sets
// repeat = 1/2. The consequence is that a 5.8 m wide road and a 40 m wide
// gravel trap show aggregate at exactly the same physical size, without a
// single hand-tuned tiling number anywhere, and a texture can be swapped for
// one shot at a different scale by changing one figure.
//
// That is also the fix for the oldest complaint on this project — "makes
// 210=210 not 210=60". Speed is not a number, it is optical flow: things have
// to stream past. An untextured plane gives the eye nothing to measure, so
// 210 km/h over flat grey reads as walking pace no matter what the HUD says.
// Aggregate at its true size, sharpened to the horizon with anisotropic
// filtering, is most of the sensation.
import * as THREE from 'three';

const TEX = './data/tex/';
const SKY = './data/sky/';

// Which materials ship an opacity map. Only the debris fence has holes in it.
const HAS_ALPHA = new Set(['fence']);

const MATERIALS = [
  'tarmac', 'apron', 'gravel', 'grass', 'sand',
  'concrete', 'brick', 'plaster', 'metal', 'fence',
];

// ---------------------------------------------------------------------------
// three.js wants a SECOND uv set for ambient occlusion (`uv1`), even when it is
// identical to the first. Assign the material an aoMap without it and the AO
// silently does nothing — no warning, no error, just a flatter surface than the
// one you configured. Every geometry in this project goes through here.
// ---------------------------------------------------------------------------
export function uv1(geo) {
  if (geo.attributes.uv && !geo.attributes.uv1) geo.setAttribute('uv1', geo.attributes.uv);
  return geo;
}

export class Look {
  constructor(renderer) {
    this.renderer = renderer;
    // Anisotropy is the single highest-value line in this file. At a racing
    // camera's grazing angle the road runs to the horizon across a handful of
    // pixels; without it, mip selection collapses the asphalt to flat grey
    // about 40 m out and the optical flow it was there to give you dies with
    // it. 16x on any modern GPU, and it costs almost nothing at this texture
    // count.
    this.aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    this.maps = {};              // name -> { c, n, orm, a }  (shared originals)
    this.tiled = new Map();      // "name@size" -> cloned-and-configured set
    this.sky = null;             // the measured lighting for this circuit
    this.env = null;             // PMREM cube for image-based lighting
    this.on = false;             // false = textures unavailable, run flat
  }

  // Load everything, in parallel, and never throw: a missing texture directory
  // has to degrade to the old flat-colour look rather than a black screen. A
  // fresh clone that has not run tools/gettex.mjs still boots.
  static async load(renderer, trackKey, { textures = true } = {}) {
    const look = new Look(renderer);
    const loader = new THREE.TextureLoader();
    const get = async (url, srgb) => {
      const t = await loader.loadAsync(url);
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = look.aniso;
      return t;
    };

    const jobs = [];
    if (textures) {
      for (const name of MATERIALS) {
        jobs.push((async () => {
          const set = {};
          // Colour is sRGB; normal and ORM are DATA and must stay linear. Mark
          // an ORM map as sRGB and its roughness curve is silently gamma-bent,
          // which shows up as everything being too shiny in the mid-tones.
          set.c = await get(`${TEX}${name}-c.jpg`, true);
          set.n = await get(`${TEX}${name}-n.jpg`, false).catch(() => null);
          set.orm = await get(`${TEX}${name}-orm.jpg`, false).catch(() => null);
          if (HAS_ALPHA.has(name)) set.a = await get(`${TEX}${name}-a.jpg`, false).catch(() => null);
          look.maps[name] = set;
        })().catch(() => { /* this material simply will not be available */ }));
      }
    }

    // The sky, and the lighting measured out of it. Both come from the same
    // capture, so the shadows point where the clouds say they should.
    jobs.push((async () => {
      const meta = await (await fetch(`${SKY}skies.json`)).json();
      const name = meta.tracks?.[trackKey] || 'cloud';
      const spec = meta.skies?.[name];
      if (!spec) return;
      const tex = await loader.loadAsync(`${SKY}${name}.jpg`);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      look.sky = { ...spec, texture: tex };
    })().catch(() => { /* no sky baked: fall back to a flat background */ }));

    await Promise.all(jobs);
    look.on = MATERIALS.some(n => look.maps[n]);
    return look;
  }

  // Turn the loaded equirect into image-based lighting. This is what makes a
  // PBR material read as photographed rather than as a lit plastic toy: the
  // sky is what every horizontal surface is actually reflecting.
  install(scene) {
    if (!this.sky) return null;
    scene.background = this.sky.texture;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.env = pmrem.fromEquirectangular(this.sky.texture).texture;
    scene.environment = this.env;
    pmrem.dispose();
    return this.sky;
  }

  // A texture set scaled so its photograph covers `size` metres of world.
  // Cached, because two materials asking for 2 m asphalt should share one
  // upload rather than two.
  set(name, size) {
    const key = `${name}@${size}`;
    if (this.tiled.has(key)) return this.tiled.get(key);
    const src = this.maps[name];
    if (!src) return null;
    const out = {};
    for (const k of ['c', 'n', 'orm', 'a']) {
      if (!src[k]) continue;
      const t = src[k].clone();
      t.needsUpdate = true;
      // UVs are metres, so a photo covering `size` metres repeats 1/size times
      // per metre. Nothing downstream ever computes a tiling factor again.
      t.repeat.set(1 / size, 1 / size);
      out[k] = t;
    }
    this.tiled.set(key, out);
    return out;
  }

  // The workhorse. `size` is how many metres across the photograph is; `tint`
  // multiplies the albedo, which is how one plaster scan becomes a whole
  // Mediterranean street.
  mat(name, {
    size = 2, tint = 0xffffff, roughness = null, metalness = null,
    side = THREE.FrontSide, env = 1, transparent = false, alphaTest = 0,
    normalScale = 1,
    ...rest
  } = {}) {
    const t = this.set(name, size);
    const m = new THREE.MeshStandardMaterial({
      color: tint, side, envMapIntensity: env, transparent, alphaTest, ...rest,
    });
    if (!t) {
      // No texture: keep the material legible rather than leaving it default
      // shiny white. This is the path a fresh clone takes.
      m.roughness = roughness ?? 0.9;
      m.metalness = metalness ?? 0.0;
      return m;
    }
    m.map = t.c;
    if (t.n) {
      m.normalMap = t.n;
      // Scanned normals are calibrated for a close-up render. On a surface
      // seen at a grazing angle from a moving camera the relief has to be
      // pushed harder or the sun never catches it and the material flattens
      // out about forty metres away.
      m.normalScale = new THREE.Vector2(normalScale, normalScale);
    }
    if (t.orm) {
      // One image, three channels, the glTF convention: R ambient occlusion,
      // G roughness, B metalness. three reads each channel from whichever slot
      // it is assigned to, so pointing all three at the same texture is not a
      // trick, it is the intended use.
      m.aoMap = t.orm; m.roughnessMap = t.orm; m.metalnessMap = t.orm;
      m.aoMapIntensity = 0.85;
    }
    if (t.a) { m.alphaMap = t.a; m.transparent = true; }
    // These multiply the map rather than replacing it, so 1.0 means "as
    // scanned" and anything less dials the scan down.
    m.roughness = roughness ?? 1.0;
    m.metalness = metalness ?? (t.orm ? 1.0 : 0.0);
    return m;
  }
}

// ---------------------------------------------------------------------------
// Sky-derived lighting. Everything here is read from skies.json, which was
// measured off the HDR's float pixels — the sun's direction and colour, the
// sky colour overhead, the horizon colour, and how hard the shadows should be.
// Hand-picking any of these is how you get a scene whose light disagrees with
// its own backdrop.
// ---------------------------------------------------------------------------
export function sunRig(scene, sky, { shadows = true } = {}) {
  const dir = sky?.sun || [0.55, 0.74, 0.38];
  const punch = sky?.punch ?? 0.8;

  // Sky above, ground bounce below. The bounce colour is deliberately warm and
  // dark: it stands in for light coming back off tarmac and grass, and it is
  // the only thing filling the shadows besides the environment map.
  // Under overcast there is barely a sun, so almost all the light has to come
  // from the dome. Get this balance wrong and Zandvoort reads as dusk.
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(sky?.sky || '#93a8ce'), new THREE.Color(0x4a4438),
    0.55 + (1 - punch) * 1.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(sky?.sunColour || '#fff4e0'),
    0.55 + punch * 2.2);
  sun.castShadow = shadows && punch > 0.25;   // overcast casts no real shadow
  sun.shadow.mapSize.set(2048, 2048);
  const d = 55;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  // The light is parked ~340 m from its target, so a 1..600 range would spend
  // nearly all its depth precision on empty air. Bracket the useful slice.
  sun.shadow.camera.near = 180; sun.shadow.camera.far = 520;
  // One enormous unbroken flat plane is the worst case for shadow acne, and
  // the track is nothing but that. normalBias offsets along the surface
  // normal, which is what actually fixes acne on flat ground — a depth bias
  // alone left the whole road self-shadowing and rendering near-black.
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.30;
  scene.add(sun, sun.target);

  return {
    sun, hemi, dir,
    // The sun follows the car so its 110 m shadow box always contains it.
    // Direction never changes — only the origin does.
    follow(x, z) {
      sun.position.set(x + dir[0] * 340, dir[1] * 340, z + dir[2] * 340);
      sun.target.position.set(x, 0, z);
    },
  };
}
