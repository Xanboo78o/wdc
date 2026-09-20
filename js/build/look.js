// look.js — what the hand-built track is made OF.
//
// meshes.js decides SHAPE; this file decides SURFACE. It is the Blender
// material tab for the builder: the same photoscanned CC0 piles the race game
// already paints with (data/tex/ from ambientCG, data/sky/ from Poly Haven),
// plus the plants in data/flora/, handed out as ready materials.
//
// Three rules carried over from the game's js/tex.js, because they are what
// make a surface read as photographed rather than as coloured plastic:
//
//   UVs ARE METRES. Every UV in this project is real-world metres, so a
//   material only has to say how big its photograph is and set repeat = 1/size.
//   No tiling constants anywhere, and a 5.8 m road and a 4 km valley show
//   aggregate and blades at the same physical size.
//
//   ANISOTROPY IS NOT OPTIONAL. At a racing camera's grazing angle the road
//   runs to the horizon across a handful of pixels. Without 16x filtering the
//   asphalt collapses to flat grey 40 m out and takes the sensation of speed
//   with it.
//
//   MEASURE THE SKY, DON'T PICK THE LIGHT. The sun direction, sun colour,
//   shadow hardness and horizon colour all come out of the HDRI itself
//   (data/sky/skies.json, measured by tools/getsky.mjs). A hand-picked light
//   over a photographed sky is the thing that makes a scene look like a
//   videogame.
//
// URL knobs, because art direction is something you try rather than derive:
//   ?flat          no textures at all — the old solid-colour viewport
//   ?sky=clear|cloud|overcast    which sky lights the track
//   ?lo            no shadows
import * as THREE from 'three';
import { Look } from '../tex.js';

const FLORA = './data/flora/';

// How many metres across each photograph is. Physical sizes, not taste: the
// asphalt scan is a 2 m square of road, the bark is a 1.2 m wrap of trunk.
const SIZE = { tarmac: 3, apron: 2.4, concrete: 2, metal: 1.2, grass: 1.6, gravel: 1.4, sand: 2, bark: 1.2 };

// The land's surfaces and the scale each is photographed at, in metres.
//
// `far` is the SAME grass sampled much bigger and averaged back in: one 1.5 m
// photograph tiled over four kilometres of valley is a visible grid from the
// air, and two scales of the same image destroy that grid for one extra
// texture read.
//
// `block` is the fix for a bug that made the whole valley one flat green.
// Terrain UVs are world metres and this track's land runs to ±5376 m, so at a
// 1.5 m photograph that is 3,584 repeats — and a GPU's texture sampler keeps
// only a few fractional bits, so past a few hundred repeats every pixel of a
// tile samples the SAME texel. Measured: at 1.5 m the land rendered flat, at
// 40 m the texture appeared. So the coordinate is wrapped into a 96 m block
// before it is sampled, and 96 is an exact multiple of every scale below —
// which is what makes the wrap invisible instead of a seam every 96 m.
const LAND = { block: 96, near: 1.5, far: 24, dirt: 3, rock: 4, macro: 48 };

export class BuildLook {
  constructor(renderer, look, flora, opts) {
    this.renderer = renderer;
    this.look = look;              // the game's Look (data/tex + data/sky)
    this.flora = flora;            // { atlas, tex: { grass, seed, needle, leaf, bark } }
    this.on = look.on && !opts.flat;
    this.wind = { value: 0 };      // seconds, shared by every plant material
    this.materials = [];
  }

  static async load(renderer, { flat = false, sky = null } = {}) {
    // Never throw: a fresh clone that has not run tools/gettex.mjs or
    // tools/getflora.mjs must still boot, flat-shaded, rather than show a
    // black screen.
    const look = await Look.load(renderer, 'build', { textures: !flat });
    if (sky) await swapSky(look, sky);
    const flora = flat ? null : await loadFlora(renderer);
    return new BuildLook(renderer, look, flora, { flat });
  }

  // Sky, image-based lighting, sun and fog, all from the one measured capture.
  install(scene, { shadows = true, shadowMap = 2048, shadowBox = 90, env = true } = {}) {
    const sky = this.look.sky;
    if (this.on && sky) {
      this.look.install(scene);                       // background + PMREM environment
      scene.environmentIntensity = 0.85;
      // Image-based lighting is a cube lookup on EVERY pixel of every PBR
      // surface. Dropping it is worth real frames on a weak GPU, and the
      // hemisphere light below stands in for it — so the lowest setting keeps
      // the photographed sky as a backdrop and stops lighting with it.
      if (!env) { scene.environment = null; scene.environmentIntensity = 1; }
    }
    const horizon = new THREE.Color(sky?.horizon || 0xc6d2dc);
    scene.fog = new THREE.FogExp2(horizon.getHex(), 0.00021);

    const dir = sky?.sun || [-0.55, 0.62, 0.42];
    const punch = sky?.punch ?? 0.85;
    const sun = new THREE.DirectionalLight(new THREE.Color(sky?.sunColour || 0xfff1dc), 0.6 + punch * 2.6);
    sun.castShadow = shadows && punch > 0.25;
    // A shadow map is a SECOND DRAW of everything that casts into it, at this
    // resolution, every frame. 4096 over a 160 m box was a quarter of the
    // frame on its own — measured the hard way, on Adam's laptop, at one frame
    // a second. 2048 over 90 m is the same picture from a car.
    sun.shadow.mapSize.set(shadowMap, shadowMap);
    // The builder's camera flies: the box has to cover what you are LOOKING
    // at, not what the car is on, so `follow` moves it and nothing else.
    const SH = shadowBox;
    Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 1600 });
    // Flat ground is the worst case for shadow acne and this track is nothing
    // but that. normalBias offsets along the surface normal, which is the one
    // that actually fixes it; a depth bias alone leaves the road self-shadowed
    // and near-black.
    sun.shadow.normalBias = 0.06;
    sun.shadow.bias = -0.0002;
    scene.add(sun, sun.target);
    // Sky above, warm bounce below. Under an overcast sky there is barely a
    // sun and nearly all the light has to come from the dome instead.
    scene.add(new THREE.HemisphereLight(new THREE.Color(sky?.sky || 0xdbe6f2), 0x5d5a48,
      (this.on && sky ? 0.18 + (1 - punch) * 0.9 : 0.55) + (env ? 0 : 0.5)));
    this.sun = sun;
    this.sunDir = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    return this;
  }

  /** Point the shadow box at whatever the camera is looking at. */
  follow(focus) {
    if (!this.sun) return;
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 700);
    this.sun.target.position.copy(focus);
  }

  /** One clock for every plant, so a gust crosses the grass and the trees together. */
  tick(t) { this.wind.value = t; }

  // -------------------------------------------------------------------------
  // the road surface
  // -------------------------------------------------------------------------
  road() {
    if (!this.on) return null;
    return {
      // Asphalt016 measures a colour standard deviation of 15/255 — real,
      // visible aggregate. (Asphalt033, the obvious-looking choice, measures 4
      // and reads as painted cardboard: all its detail is in the normal map.)
      // size 3.0 and normalScale 1.05 are the race game's own numbers for this
      // same scan (js/render.js): one road surface across the project, so a
      // corner built here and a corner at Monza are made of the same asphalt.
      road: this.look.mat('tarmac', { size: SIZE.tarmac, roughness: 0.94, normalScale: 1.05, env: 0.8 }),
      // Paint sits ON the asphalt: same aggregate under it, near-white on top,
      // and smoother, which is why a wet line is the slippery part.
      paint: this.look.mat('tarmac', {
        size: SIZE.tarmac, tint: 0xf6f6f2, roughness: 0.55, normalScale: 0.6, env: 0.9,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }),
      // Kerbs are cast concrete painted red and white; the paint is the mesh's
      // vertex colour and the concrete is the photograph under it.
      kerb: this.look.mat('concrete', {
        size: SIZE.concrete, roughness: 0.8, normalScale: 0.8, env: 0.6,
        vertexColors: true, side: THREE.DoubleSide,
      }),
      // The chequered band: same idea, flat black and white squares over cast
      // concrete rather than over nothing.
      grid: this.look.mat('concrete', {
        size: SIZE.concrete, roughness: 0.7, normalScale: 0.5, vertexColors: true,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      }),
      apron: this.look.mat('apron', { size: SIZE.apron, roughness: 0.96, normalScale: 1.1, env: 0.7 }),
    };
  }

  metal(tint = 0x2a2d33) {
    if (!this.on) return null;
    return this.look.mat('metal', { size: SIZE.metal, tint, roughness: 0.55, metalness: 1, env: 1 });
  }

  // -------------------------------------------------------------------------
  // the land
  //
  // One material, three photographs, chosen by how steep the ground is — which
  // is the same rule ground.js already uses for its vertex colours (level is
  // grass, a cut face is earth, anything steeper than scree is rock). The
  // vertex colour is kept as a HUE-ONLY tint so the dry/green patchwork it
  // paints survives without multiplying green into green and turning the
  // valley black.
  //
  // No aoMap here on purpose: three.js reads AO from a second UV set (`uv1`)
  // and silently does nothing without one. Terrain has no uv1, and a missing
  // AO that looks like a flat-lit hill is exactly the kind of bug that hides
  // for a week.
  // -------------------------------------------------------------------------
  terrain({ land = 'full' } = {}) {
    if (!this.on) return null;
    // ?land=<m> still overrides the scale, for looking at it.
    const qp = new URLSearchParams(location.search);
    const near = Number(qp.get('land')) || LAND.near;
    const g = qp.get('base') === 'dirt' && this.flora?.tex?.dirt
      ? this.flora.tex.dirt : this.look.set('grass', near);
    const r = this.flora?.tex?.rock, d = this.flora?.tex?.dirt;
    if (!g) return null;
    const simple = land !== 'full';
    const mat = new THREE.MeshStandardMaterial({
      map: g.c, vertexColors: true, roughness: 0.94, metalness: 0,
      envMapIntensity: 0.55,
      // Relief on the ground only when we can afford it. It costs a sample
      // and a tangent frame per pixel, and the ground is most of the screen.
      normalMap: simple ? null : (g.n || null),
      normalScale: new THREE.Vector2(0.7, 0.7),
    });
    const U = {
      uRock: { value: r?.c || g.c }, uDirt: { value: d?.c || g.c },
      uNear: { value: near }, uFar: { value: LAND.far },
      uRockSize: { value: LAND.rock }, uDirtSize: { value: LAND.dirt },
      uMacro: { value: LAND.macro },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying float vUpness;
          varying vec2 vLand;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // The terrain group is never rotated or scaled, so the object-space
          // normal IS the world normal, and its y IS the slope.
          vUpness = normal.y;
          vLand = uv;`);
      // The UVs arrive already FOLDED into a 96 m block by foldTerrainUVs, so
      // these are plain texture reads. They used to be mod() + textureGrad,
      // which is correct and costs three extra instructions on every pixel of
      // the ground; folding the geometry once at load buys the same thing for
      // nothing. (Unfolded, a coordinate 5,400 m from the origin loses its
      // sub-texel precision and the whole valley smears — measured.)
      const body = simple ? `
          vec3 grass = texture2D(map, vLand / uNear).rgb;
          vec3 dirt = texture2D(uDirt, vLand / uDirtSize).rgb;
          float up = clamp(vUpness, 0.0, 1.0);
          // One blend, not three: bare earth on anything steeper than a
          // hillside, and the same photograph doubles as the macro variation.
          float wEarth = smoothstep(0.945, 0.74, up);
          vec3 ground = mix(grass * mix(0.74, 1.16, texture2D(uDirt, vLand / uMacro).g), dirt, wEarth);
          diffuseColor.rgb *= ground;` : `
          vec3 grass = mix(texture2D(map, vLand / uNear).rgb,
                           texture2D(map, vLand / uFar).rgb, 0.45);
          // MACRO VARIATION. Measured: the grass scan has a colour standard
          // deviation of 5/255 — a lawn close up, a flat green sheet at forty
          // metres, the same trap gettex.mjs documents for Asphalt033. Real
          // country is patchy at the scale of a field, so the dirt scan is
          // sampled enormous and used as a brightness map: still a
          // photograph, not a noise function.
          grass *= mix(0.74, 1.16, texture2D(uDirt, vLand / uMacro).g);
          vec3 rock = texture2D(uRock, vLand / uRockSize).rgb;
          vec3 dirt = texture2D(uDirt, vLand / uDirtSize).rgb;
          // up is the COSINE of the slope: 1.0 flat, 0.87 is 30 degrees. The
          // first version had earth starting at 14 degrees, which is every
          // graded embankment on the track — the whole circuit sat in sand.
          float up = clamp(vUpness, 0.0, 1.0);
          float wRock = smoothstep(0.80, 0.62, up);
          float wDirt = smoothstep(0.945, 0.82, up) * (1.0 - wRock);
          vec3 ground = mix(mix(grass, dirt, wDirt), rock, wRock);
          diffuseColor.rgb *= ground;`;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uRock; uniform sampler2D uDirt;
          uniform float uNear, uFar, uRockSize, uDirtSize, uMacro;
          varying float vUpness;
          varying vec2 vLand;`)
        .replace('#include <map_fragment>', body)
        .replace('#include <color_fragment>', `
          #ifdef USE_COLOR
            // Hue only. ground.js's vertex colour says WHAT the land is doing;
            // the photograph says what it looks like. Multiplying the two
            // outright is how a green texture under a green colour becomes
            // black mud.
            //
            // .rgb, not vColor bare: three declares that varying as a vec4
            // when the colour attribute carries alpha and as a vec3 when it
            // does not, and the mismatch is "no matching overloaded function"
            // — a material that never compiles, which looks like the land
            // failing to draw at all.
            float lum = max(dot(vColor.rgb, vec3(0.299, 0.587, 0.114)), 1e-3);
            diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb / lum, 0.32);
          #endif`);
    };
    // Two materials whose onBeforeCompile bodies differ must not share a
    // program; three keys the cache on this string.
    mat.customProgramCacheKey = () => `wdc-terrain-v3-${simple ? 's' : 'f'}`;
    this.materials.push(mat);
    return mat;
  }

  // -------------------------------------------------------------------------
  // plants (used by flora.js)
  // -------------------------------------------------------------------------

  /** A cut-out material: alpha-tested, double-sided, lit through, and it sways. */
  cardMaterial(name, { alphaTest = 0.42, sway = 1, roughness = 0.82, glow = 0.5, tint = 0xffffff } = {}) {
    const t = this.flora?.tex?.[name];
    if (!t) return null;
    const mat = new THREE.MeshStandardMaterial({
      map: t.c, alphaMap: t.a, alphaTest, transparent: false, color: tint,
      side: THREE.DoubleSide, roughness, metalness: 0, envMapIntensity: 0.9,
    });
    // An alpha-tested cut-out must cast an alpha-tested SHADOW, or every leaf
    // throws the shadow of its whole rectangle and a wood turns into a stack
    // of dark playing cards.
    mat.shadowSide = THREE.DoubleSide;
    mat.alphaHash = false;
    this.patchPlant(mat, { sway, glow });
    this.materials.push(mat);
    return mat;
  }

  bark() {
    const t = this.flora?.tex?.bark;
    if (!t) return new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 });
    const mat = new THREE.MeshStandardMaterial({
      map: t.c, normalMap: t.n || null, roughnessMap: t.orm || null, metalnessMap: t.orm || null,
      roughness: 1, metalness: 0, envMapIntensity: 0.5,
      normalScale: new THREE.Vector2(1.2, 1.2),
    });
    return mat;
  }

  // Wind, and light coming THROUGH a leaf.
  //
  // The sway is weighted by the vertex's own height above its instance origin
  // (attribute `aSway`, written by flora.js) so a blade bends at the tip and
  // stays put at the root — a whole plant sliding sideways reads as a bug, not
  // as wind. One clock for every plant, so a gust crosses the field together.
  //
  // The glow is the other half: a leaf is a slab of chlorophyll one cell thick
  // and it lights up when the sun is behind it. Without that, foliage lit from
  // behind is a black cardboard cut-out, which is the single biggest tell in
  // game trees.
  patchPlant(mat, { sway = 1, glow = 0 } = {}) {
    const U = { uWind: this.wind, uSway: { value: sway }, uGlow: { value: glow } };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      if (glow > 0) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform float uGlow;`)
          .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            #if ( NUM_DIR_LIGHTS > 0 )
              // How much this fragment is looking INTO the sun: the light's
              // own direction against the direction we are looking. Both are
              // view space, which is why no world matrices appear here.
              vec3 toEye = normalize(vViewPosition);
              float through = max(0.0, dot(-toEye, directionalLights[0].direction));
              reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color
                * pow(through, 3.0) * uGlow;
            #endif`);
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uWind, uSway;
          attribute float aSway;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            // Two waves that never line up, so the field never pulses in time.
            vec3 root = vec3(0.0);
            #ifdef USE_INSTANCING
              root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            #endif
            float phase = root.x * 0.11 + root.z * 0.07;
            float gust = sin(uWind * 1.3 + phase) * 0.65 + sin(uWind * 2.7 + phase * 1.7) * 0.35;
            float bend = aSway * aSway * uSway * gust;
            transformed.x += bend * 0.22;
            transformed.z += bend * 0.13;
            transformed.y -= abs(bend) * 0.05;   // bending shortens the plant
          }`);
    };
    mat.customProgramCacheKey = () => `wdc-plant-${sway}-${glow}`;
  }

  /** The measured UV rectangles for a cut-out set, biggest-first. */
  cutouts(name) {
    const a = this.flora?.atlas?.[name];
    if (!a) return [];
    return a.items;
  }
}

// ---------------------------------------------------------------------------
// Which sky. `skies.json` maps circuits to skies and the hand-built track is
// not a circuit, so the builder picks one by name instead and defaults to the
// broken cloud that is the game's default racing sky.
async function swapSky(look, name) {
  try {
    const meta = await (await fetch('./data/sky/skies.json')).json();
    const spec = meta.skies?.[name];
    if (!spec) return;
    const tex = await new THREE.TextureLoader().loadAsync(`./data/sky/${name}.jpg`);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    look.sky = { ...spec, texture: tex };
  } catch { /* keep whatever Look.load found */ }
}

// ---------------------------------------------------------------------------
// The plants. Colour is sRGB, opacity is DATA and must stay linear — marking an
// alpha map as sRGB bends its cutoff and eats the thin end of every blade.
async function loadFlora(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const get = async (url, srgb) => {
    const t = await loader.loadAsync(url);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  };
  try {
    const atlas = await (await fetch(`${FLORA}atlas.json`)).json();
    const tex = {};
    await Promise.all(['grass', 'seed', 'needle', 'leaf'].map(async (n) => {
      tex[n] = { c: await get(`${FLORA}${n}-c.jpg`, true), a: await get(`${FLORA}${n}-a.png`, false) };
    }).concat(['bark', 'dirt', 'rock'].map(async (n) => {
      const b = { c: await get(`${FLORA}${n}-c.jpg`, true) };
      b.n = await get(`${FLORA}${n}-n.jpg`, false).catch(() => null);
      b.orm = await get(`${FLORA}${n}-orm.jpg`, false).catch(() => null);
      for (const k of ['c', 'n', 'orm']) if (b[k]) b[k].wrapS = b[k].wrapT = THREE.RepeatWrapping;
      tex[n] = b;
    })));
    return { atlas, tex };
  } catch {
    return null;   // no data/flora/: the track simply has no plants on it
  }
}

// ---------------------------------------------------------------------------
// Fold a terrain group's UVs into one LAND.block-wide tile, with a TRIANGLE
// wave so the seam is a mirror rather than a jump.
//
// Terrain UVs are world metres and this track's land runs to +-5,400: at a
// 1.5 m photograph that is 3,600 repeats, and a GPU sampler keeps only a few
// fractional bits of a texture coordinate, so past a few hundred repeats every
// pixel of a tile samples the same texel and the ground goes flat. (Measured
// side by side with the fold off: real dirt against vertical smears.)
//
// This can be done per VERTEX only because the terrain grid lines up with the
// period — cells are 3, 12, 24 and 48 m and tiles start on multiples of 48, so
// every fold point at a multiple of 96 lands exactly on a vertex and the wave
// stays piecewise-linear between them. On a mesh whose vertices did not line
// up, this same trick would tear.
// ---------------------------------------------------------------------------
export function foldTerrainUVs(group, period = LAND.block) {
  const fold = (v) => {
    const m = ((v % (2 * period)) + 2 * period) % (2 * period);
    return period - Math.abs(m - period);
  };
  group.traverse((o) => {
    const uv = o.isMesh && o.geometry?.attributes?.uv;
    if (!uv) return;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, fold(uv.getX(i)), fold(uv.getY(i)));
    uv.needsUpdate = true;
  });
  return group;
}
