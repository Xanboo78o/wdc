// livery.glsl — a livery, painted onto ANY car by where each bit of bodywork is.
//
// One source for both games: garage.html splices it into three's paint shader,
// native/src/dress.cpp into its own. A livery (data/livery/<car>.json, written
// by tools/livery/bake.mjs) is a base colour, up to eight LAYERS of shape laid
// one over the last, and up to twenty-four STICKERS off the sheet
// data/livery/atlas.png.
//
// p is the point on the car, the same on every model whatever its size:
//   p.x  -1 at the tail .. +1 at the nose
//   p.y   0 on the road .. 1 at the roof
//   p.z  -1 at the left flank .. +1 at the right; shapes use |p.z| unless the
//        layer is for one side only, so the two sides match
//
// SHAPES (q = a layer's four numbers)
//    1 STRIPE   along the car: half-width q.x, centred q.y out from the middle
//    2 SKIRT    everything below a line: height q.x at mid-car, rising q.y toward the nose
//    3 CUT      one side of a slanted plane: q.z*x + q.y*y + q.w*|z| > q.x
//    4 SWEEP    a band along the flanks: centre height q.x + q.y*x, half-thickness q.z, only where |z| > q.w
//    5 SLASH    repeated diagonal bars: q.x along, q.y up, duty q.z, only where |z| > q.w
//    6 CAP      the nose (q.y = 1) or the tail (q.y = -1) beyond q.x
//    7 ROOF     above height q.x, within q.y of the middle
//    8 HOOP     rings round the body: q.x of them along the car, phase q.y, duty q.z
//    9 FADE     a soft blend along the car from q.x to q.y (times q.z: -1 fades toward the tail)
//   10 ARROW    a chevron on the top: point at x = q.x, opening q.y, above height q.z
//   11 DOTS     a halftone: q.x dots along the car, biggest radius q.y, growing toward the nose (q.z = 1) or tail (-1)
//   12 CAMO     blotches: scale q.x, how much of the car q.y, seed q.z
//   13 ROUNDEL  a disc on each door: centre (q.x, q.y), radius q.z, q.w squashes it to a circle
//   14 CHECK    chequers behind x = q.z: q.x squares along, q.y up
//   15 ZEBRA    wavy stripes: q.x of them along the car, wobble q.z at pitch q.y, duty q.w
//   16 TEETH    a skirt with a saw edge: height q.x, tooth depth q.y, q.z teeth along the car
//   17 WAVE     a band that rolls along the flanks: height q.x, swell q.y, q.z waves, half-thickness q.w
//   18 BURST    rays from a point on the flank (q.x, q.y): q.z rays, duty q.w
//   19 PIXEL    squares dissolving along the car: q.x squares, gone by x = q.z, direction q.w (1 thins toward the nose)
//   20 DRIP     paint running down from the roof line q.x, tongues q.y long, q.z of them
uniform int uLivN;
uniform int uLivType[8];
uniform vec3 uLivCol[8];
uniform vec4 uLivP[8];
uniform float uLivSide[8];          // 0 both sides, 1 the right only, -1 the left only
uniform int uStkN;
uniform vec4 uStkRect[24];          // centre (along, up), half-width, half-height — in p's units
uniform vec4 uStkUv[24];            // where on the sheet: u0, v0, du, dv
uniform vec4 uStkTint[24];          // rgb, and a: 0 = the sticker's own colours, 1 = cut vinyl in rgb
uniform float uStkPlane[24];        // 0 both flanks, 1 right flank, 2 left flank, 3 the top (read from behind), 4 the top (read from in front)
float livHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float livNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(livHash(i), livHash(i + vec2(1.0, 0.0)), f.x), mix(livHash(i + vec2(0.0, 1.0)), livHash(i + vec2(1.0, 1.0)), f.x), f.y); }
vec3 livery(vec3 p, vec3 base) {
  vec3 c = base;
  float az = abs(p.z);
  for (int i = 0; i < 8; i++) {
    if (i >= uLivN) break;
    int t = uLivType[i]; vec4 q = uLivP[i]; float m = 0.0;
    if (uLivSide[i] * p.z < -0.0001) continue;
    if (t == 1) m = step(abs(az - q.y), q.x);
    else if (t == 2) m = step(p.y, q.x + q.y * p.x);
    else if (t == 3) m = step(q.x, p.x * q.z + p.y * q.y + az * q.w);
    else if (t == 4) m = step(abs(p.y - (q.x + q.y * p.x)), q.z) * step(q.w, az);
    else if (t == 5) m = step(fract(p.x * q.x + p.y * q.y), q.z) * step(q.w, az);
    else if (t == 6) m = step(q.x, p.x * q.y);
    else if (t == 7) m = step(q.x, p.y) * step(az, q.y);
    else if (t == 8) m = step(fract(p.x * q.x + q.y), q.z);
    else if (t == 9) m = smoothstep(q.x, q.y, p.x * q.z);
    else if (t == 10) m = step(az, (q.x - p.x) * q.y) * step(q.z, p.y);
    else if (t == 11) { vec2 g = fract(vec2(p.x * q.x, (p.y + az * 0.5) * q.x * 0.45)) - 0.5; m = step(length(g), q.y * clamp((p.x * q.z + 1.0) * 0.5, 0.0, 1.0)); }
    else if (t == 12) m = step(1.0 - q.y, livNoise(vec2(p.x * 2.2, p.y + az * 0.9) * q.x + q.z) * 0.6 + livNoise(vec2(p.x * 2.2, p.y + az * 0.9) * q.x * 2.3 + q.z * 1.7) * 0.4);
    else if (t == 13) m = step(length(vec2((p.x - q.x) * q.w, p.y - q.y)), q.z) * step(0.62, az);
    else if (t == 14) m = step(p.x, q.z) * abs(step(0.5, fract(p.x * q.x)) - step(0.5, fract((p.y + az * 0.6) * q.y)));
    else if (t == 15) m = step(fract(p.x * q.x + sin((p.y + az * 0.7) * q.y) * q.z), q.w);
    else if (t == 16) m = step(p.y, q.x + q.y * abs(fract(p.x * q.z) - 0.5) * 2.0);
    else if (t == 17) m = step(abs(p.y - (q.x + q.y * sin(p.x * q.z * 3.14159))), q.w) * step(0.45, az);
    else if (t == 18) m = step(fract(atan(p.y - q.y, (p.x - q.x) * 1.8) * q.z / 6.28318), q.w) * step(0.45, az);
    else if (t == 19) { vec2 g = floor(vec2(p.x * q.x * 2.2, (p.y + az * 0.6) * q.x)); m = step(livHash(g), clamp((q.z - p.x * q.w) * 0.9, 0.0, 1.0)); }
    else if (t == 20) { float k = 0.5 + 0.5 * sin(p.x * q.z + 1.7 * sin(p.x * q.z * 0.37)); m = step(q.x - q.y * k * k * k, p.y); }
    c = mix(c, uLivCol[i], m);
  }
  return c;
}
// n is the surface's own normal in the car's frame: a flank takes the side
// stickers, anything facing the sky takes the top ones.
vec3 stickers(vec3 c, vec3 p, vec3 n, sampler2D sheet) {
  bool flank = abs(n.z) > 0.55, top = n.y > 0.6;
  if (!flank && !top) return c;
  for (int i = 0; i < 24; i++) {
    if (i >= uStkN) break;
    vec4 r = uStkRect[i]; float pl = uStkPlane[i]; vec2 d;
    if (pl > 2.5) { if (!top) continue; d = vec2(p.z - r.x, p.x - r.y); if (pl > 3.5) d = -d; }      // 4: turned to be read from in front of the car
    else {
      if (!flank || (pl > 0.5 && pl < 1.5 && p.z < 0.0) || (pl > 1.5 && p.z > 0.0)) continue;
      d = vec2((p.x - r.x) * (p.z > 0.0 ? 1.0 : -1.0), p.y - r.y);      // read the right way round from either side
    }
    d = d / (2.0 * r.zw) + 0.5;
    if (d.x < 0.0 || d.x > 1.0 || d.y < 0.0 || d.y > 1.0) continue;
    vec4 t = textureLod(sheet, uStkUv[i].xy + vec2(d.x, 1.0 - d.y) * uStkUv[i].zw, 0.0);
    c = mix(c, uStkTint[i].a < 0.5 ? t.rgb : uStkTint[i].rgb, t.a);
  }
  return c;
}
