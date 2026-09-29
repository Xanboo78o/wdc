// sky.js — a sky with the sun in the right place.
//
// The photographs in data/sky are beautiful and they have a sun baked into
// them, which was fine while the sun never moved. js/weather.js now says where
// the sun really is at the real time, and a directional light pointing
// somewhere the photograph does not agree with puts your shadows and your sun
// in different parts of the sky. So: draw it instead.
//
// This has to serve TWO jobs, and forgetting the second is the classic mistake:
//
//   THE BACKGROUND — what you see above the horizon.
//   THE ENVIRONMENT — what every polished surface is REFLECTING. A PBR
//   material with no environment reads as lit plastic. The photograph was
//   doing both; so does this, by rendering itself into a cube once and letting
//   PMREM turn that into the roughness pyramid three wants.
//
// HDR THROUGHOUT. The sun disc is thousands of times brighter than the zenith,
// which is what makes js/post.js's adaptation and bloom work at all. Clamp
// this to 1.0 anywhere and the sun becomes a white circle that nothing can
// bloom and no eye can be dazzled by.
import * as THREE from 'three';

const FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun;          // direction TO the sun, normalised
uniform float uTurb;        // 1 clean .. 8 thick
uniform float uCloud;       // 0..1, flattens and greys everything
uniform float uNight;       // 0 day .. 1 night
uniform float uExposure;    // scales the whole thing into HDR

// Rayleigh scattering is why the sky is blue and why sunsets are red: short
// wavelengths scatter far more, so looking away from the sun you see blue
// that has bounced, and looking THROUGH a long slice of atmosphere at sunset
// the blue has scattered away before it reaches you and only red is left.
const vec3 RAY = vec3(5.8e-3, 13.5e-3, 33.1e-3);
const vec3 MIE = vec3(8.0e-3);

// Value noise for the cloud deck. Hash, bilinear, five octaves: enough for
// cumulus edges at the cube's resolution and nothing more.
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  // each octave turned ~37 degrees so the lattice never lines up into steps
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

float rayleighPhase(float c) { return 3.0 / (16.0 * 3.14159265) * (1.0 + c * c); }
float miePhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

void main() {
  vec3 dir = normalize(vDir);
  float up = max(dir.y, -0.08);
  float cosT = clamp(dot(dir, uSun), -1.0, 1.0);

  // How much air you are looking through. Straight up is one atmosphere; at
  // the horizon it is nearly forty, which is the whole reason the horizon is
  // pale and the zenith is deep.
  float air = 1.0 / (up + 0.15 * pow(93.885 - degrees(acos(clamp(up, 0.0, 1.0))), -1.253));
  air = clamp(air, 1.0, 38.0);

  float sunUp = clamp(uSun.y, -0.2, 1.0);
  // Light reaching this patch of sky has already crossed the atmosphere once.
  vec3 through = exp(-(RAY * uTurb + MIE) * air * 12.0);
  vec3 sunTint = exp(-(RAY * (1.0 + uTurb * 0.35) + MIE * 0.6) * (1.0 / max(sunUp + 0.08, 0.02)) * 9.0);

  // IN-SCATTER THAT SATURATES (2026-09-28). The old sky summed scattering
  // linearly in air mass, so the horizon (38 atmospheres) came out ~38x the
  // zenith and the zenith sat a dead slate-navy at two in the afternoon —
  // the "stormy noon" every clear-day screenshot showed. Real air also
  // EXTINGUISHES along the view ray, so each colour's in-scatter climbs as
  // 1 - exp(-depth) and stops: the horizon whitens because red finally
  // saturates too, and the zenith keeps a deep but LIT blue. The +0.6 on the
  // air mass stands in for multiple scattering, which is what lifts a real
  // zenith to a third or so of the horizon rather than a fortieth; more
  // than that and the zenith greys out, because red saturates as well.
  // OZONE. Without it a low sun's light, stripped of blue by Rayleigh, turns
  // the whole blue dome GREEN-yellow (the "dark green sky at Suzuka" and a
  // pea-soup dusk at Monza, 2026-09-28). The Chappuis band of ozone absorbs
  // orange-to-green far more than blue along the same long path, which is
  // precisely why a real twilight zenith stays blue and the clouds go pink.
  const vec3 OZONE = vec3(0.012, 0.034, 0.0016);
  vec3 skyTint = exp(-(RAY * (1.0 + uTurb * 0.35) + MIE * 0.6 + OZONE) * (1.0 / max(sunUp + 0.08, 0.02)) * 2.0);
  vec3 mieB = MIE * (0.10 + uTurb * 0.09);
  vec3 beta = RAY * (1.0 + uTurb * 0.12) + mieB;
  vec3 ins = 1.0 - exp(-beta * (air + 0.6) * 9.0);
  vec3 phase = (RAY * (1.0 + uTurb * 0.12) * rayleighPhase(cosT) + mieB * miePhase(cosT, 0.82) * 0.9) / beta;
  vec3 col = ins * phase * skyTint * 15.0;
  col += through * 0.02;                       // a floor, so the zenith is never black by day

  // THE SUN ITSELF. A hard disc with a soft limb, and brighter than anything
  // else here by three orders of magnitude — which is what the eye adapts to
  // and what blooms. 0.9996 is about a quarter of a degree, the real size.
  float disc = smoothstep(0.99955, 0.99985, cosT);
  float glow = pow(max(cosT, 0.0), 900.0);
  col += sunTint * (disc * 900.0 + glow * 22.0);

  // FAIR-WEATHER CUMULUS (2026-09-28). A clear afternoon over a circuit is
  // rarely an empty dome — a scatter of flat-bottomed cumulus is the
  // broadcast sky, and the Mario Kart half of the brief (soft, warm, rich)
  // wants it too. A cloud deck at a fixed height, value noise in five
  // octaves, cover from the weather's cloud fraction. Lit from the sun's
  // side with a darker belly, fading into the horizon haze with distance.
  // It is drawn into the cube, which only re-renders when the sun moves, so
  // it costs nothing per frame.
  if (dir.y > 0.0) {
    vec2 pl = dir.xz / (dir.y + 0.06) * 1.6;
    float n = fbm(pl + vec2(3.1, 7.7));
    float cover = mix(0.72, 0.34, clamp(uCloud * 1.4, 0.0, 1.0));
    float dens = smoothstep(cover, cover + 0.16, n);
    // light: step toward the sun and see how much cloud is in the way
    vec2 toSun = normalize(uSun.xz + 1e-4) * 0.06;
    float shade = smoothstep(cover - 0.05, cover + 0.3, fbm(pl + vec2(3.1, 7.7) + toSun));
    float lit = 1.0 - 0.5 * shade;
    vec3 cloudCol = skyTint * (0.55 + 0.75 * lit) * 1.15 * (0.35 + 0.65 * smoothstep(-0.05, 0.3, uSun.y));
    cloudCol += sunTint * pow(max(cosT, 0.0), 8.0) * 0.6 * (1.0 - shade);   // silver lining toward the sun
    float far = smoothstep(0.0, 0.16, dir.y);              // melt into the haze at the horizon
    col = mix(col, mix(col, cloudCol, 0.85), dens * far * (1.0 - uNight));
  }

  // CLOUD flattens everything toward a grey lid and kills the sun's edge —
  // the sky stops having a direction, which is exactly what overcast is.
  // Only once the cumulus has run out of sky to cover: below half cover the
  // clouds above do the work and a grey wash would only dull the blue.
  vec3 grey = vec3(0.70, 0.74, 0.80) * (0.20 + sunUp * 0.55);
  col = mix(col, grey * (0.85 + 0.35 * up), smoothstep(0.35, 0.95, uCloud) * 0.88);

  // NIGHT. Not black: a real night sky is deep blue with the horizon lit by
  // whatever is over it, and going fully black makes adaptation useless
  // because there is nothing left to adapt to.
  vec3 night = vec3(0.010, 0.016, 0.034) + vec3(0.012, 0.014, 0.020) * pow(1.0 - up, 6.0);
  col = mix(col, night, uNight);

  gl_FragColor = vec4(max(col, 0.0) * uExposure, 1.0);
}`;

const VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export class ProcSky {
  // 512 a face, not 256: the cube IS the background, and at 256 the clouds
  // were smeared over three screen pixels a texel.
  constructor(renderer, { size = 512 } = {}) {
    this.renderer = renderer;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: {
        uSun: { value: new THREE.Vector3(0.55, 0.74, 0.38).normalize() },
        uTurb: { value: 2.6 },
        uCloud: { value: 0.2 },
        uNight: { value: 0 },
        uExposure: { value: 1 },
      },
    });
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.mat));

    // Rendered into a cube so it can be BOTH the background and the thing
    // every chrome surface reflects.
    this.cube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    this.cam = new THREE.CubeCamera(0.1, 100, this.cube);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.env = null;
    this._key = '';
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('envi') : null;
    this.envIntensity = q != null && Number.isFinite(+q) ? +q : 0.5;
  }

  /**
   * Point it at a sun and a sky. Rebuilds the cube and the environment only
   * when something has actually moved — this is six renders and a PMREM, so
   * doing it every frame would be absurd, and doing it never means the sky
   * never changes. A tenth of a degree of sun is the threshold.
   */
  update(scene, sunDir, { turbidity = 2.6, cloud = 0.2, elevation = 45 } = {}) {
    const u = this.mat.uniforms;
    u.uSun.value.set(sunDir[0], sunDir[1], sunDir[2]).normalize();
    u.uTurb.value = turbidity;
    u.uCloud.value = cloud;
    // Civil twilight is 6 degrees below the horizon; by 12 it is properly
    // dark. Crossfading over that band is what gives dusk its length.
    u.uNight.value = Math.max(0, Math.min(1, (-elevation - 1) / 11));

    const key = [
      u.uSun.value.toArray().map(n => n.toFixed(3)).join(','),
      turbidity.toFixed(2), cloud.toFixed(2), u.uNight.value.toFixed(2),
    ].join('|');
    if (key === this._key) return false;
    this._key = key;

    const prevTone = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;   // the cube must stay linear HDR
    this.cam.update(this.renderer, this.scene);
    this.renderer.toneMapping = prevTone;

    scene.background = this.cube.texture;
    const old = this.env;
    this.env = this.pmrem.fromCubemap(this.cube.texture).texture;
    scene.environment = this.env;
    // The drawn sky is brighter overhead than it used to be (the saturating
    // in-scatter above), and all of that light arrives in every reflection.
    // At full strength this cube lit dark carbon and the tub a pale blue.
    // ?envi= overrides.
    //
    // NOTE, measured 2026-09-28: in this three build, whenever a material has
    // no envMap of its own and the scene has an environment, the renderer
    // WRITES scene.environmentIntensity over the material's envMapIntensity
    // on every draw. So every per-material envMapIntensity in this repo (car
    // paint 1.35, carbon 0.55, the road's rain boost in render.js) is
    // silently ignored and THIS is the one knob. ?envi=0 vs ?envi=3 on the
    // chase camera proves it: the whole car, road and tub move together.
    scene.environmentIntensity = this.envIntensity;
    if (old) old.dispose();
    return true;
  }

  dispose() {
    this.cube.dispose(); this.pmrem.dispose();
    if (this.env) this.env.dispose();
  }
}
