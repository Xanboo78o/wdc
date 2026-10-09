// fx.cpp — see fx.hpp. Ported from js/fx.js (what to watch for), js/smoke.js
// (puffs lit as soft spheres, sorted), js/sparks.js (streaks) and js/debris.js
// (the rigid-body solver: corner contacts, sequential impulses, the settle).
// New here: a wheel as a DISC that rolls, air drag from each piece's own mass,
// fire, and the explosion.
//
// GL space throughout: x = sim x, y = up, z = -sim y. A car's own frame is
// x forward, y up, z to its RIGHT.
//
// Four draws at most, each skipped when it has nothing: the pieces (instanced,
// one call a kind), the ground marks, the puffs (smoke AND flame in one sorted
// premultiplied batch, so smoke can stand in front of fire and fire can glow
// through smoke), the sparks.
#include "fx.hpp"

#include <epoxy/gl.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "carmesh.hpp"

namespace xbr {
namespace {

// ---------------------------------------------------------------------------
// what burns (energies in joules: 0.5 * mass * dv^2)
// ---------------------------------------------------------------------------
const float E_FIRE = 0.35e6f;        // taken within a few seconds, at damage >= DMG_FIRE
const float DMG_FIRE = 0.50f;
const float E_FIRE_HURT = 0.12e6f;   // enough for a car already at damage >= DMG_HURT
const float DMG_HURT = 0.85f;
const float E_BOOM = 1.60e6f;        // one blow
const float E_BOOM_SUM = 2.40e6f;    // or this much inside the memory below
const float HEAT_MEMORY = 4.0f;      // s: how long a blow is remembered (e-folding)
const float FUSE_MIN = 7.5f, FUSE_VAR = 2.5f;   // s a fire burns before the tank goes
const float DV_IMPACT = 12.0f;       // m/s in one frame: an impact whatever the damage says

const float G = 9.81f;
const float SUB = 1.0f / 120;        // rigid-body step
const float BARRIER_H = 1.0f;        // m: below this a piece bounces off the wall
const float SHARD_LIFE = 150, SHARD_FADE = 1.5f;
const float SHUTTER = 1.0f / 30;     // s: the streak a camera records of a spark
const int MAX_PUFF = 900, MAX_SPARK = 1600, MAX_DECAL = 256, MAX_SCORCH = 24;
const float EMIT_RANGE = 320;        // m from the camera: beyond it nothing continuous is emitted

// what a tyre throws up, by surface (js/fx.js)
const float RUBBER[3] = {0.88f, 0.89f, 0.92f}, GRAVEL[3] = {0.70f, 0.54f, 0.36f}, EARTH[3] = {0.55f, 0.45f, 0.30f};
const float CONCRETE[3] = {0.72f, 0.70f, 0.66f}, SOOT[3] = {0.050f, 0.046f, 0.044f}, CARBON[3] = {0.045f, 0.047f, 0.052f};
const float DUSTC[3] = {0.62f, 0.57f, 0.50f};

// ---------------------------------------------------------------------------
// small maths
// ---------------------------------------------------------------------------
struct V3 { float x = 0, y = 0, z = 0; };
inline V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline V3 operator*(V3 a, float s) { return {a.x * s, a.y * s, a.z * s}; }
inline float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
inline float len(V3 a) { return std::sqrt(dot(a, a)); }
inline V3 norm(V3 a) { const float l = len(a); return l > 1e-9f ? a * (1 / l) : V3{0, 1, 0}; }

struct Q { float x = 0, y = 0, z = 0, w = 1; };
inline V3 rot(const Q &q, V3 v) { const V3 u{q.x, q.y, q.z}; const V3 t = cross(u, v) * 2.0f; return v + t * q.w + cross(u, t); }
inline V3 irot(const Q &q, V3 v) { return rot(Q{-q.x, -q.y, -q.z, q.w}, v); }
inline Q qmul(const Q &a, const Q &b) {
  return {a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
          a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z};
}
inline void qnorm(Q &q) { const float l = std::sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w); if (l > 1e-9f) { q.x /= l; q.y /= l; q.z /= l; q.w /= l; } else q = Q{}; }
inline Q qFromTo(V3 a, V3 b) {          // unit vectors
  const float d = dot(a, b);
  if (d < -0.9999f) { V3 o = std::fabs(a.x) < 0.9f ? V3{1, 0, 0} : V3{0, 1, 0}; o = norm(cross(a, o)); return {o.x, o.y, o.z, 0}; }
  const V3 c = cross(a, b);
  Q q{c.x, c.y, c.z, 1 + d};
  qnorm(q);
  return q;
}
inline Q qAxis(V3 axis, float ang) { const float s = std::sin(ang * 0.5f); return {axis.x * s, axis.y * s, axis.z * s, std::cos(ang * 0.5f)}; }
inline Q qLerp(const Q &a, Q b, float t) {
  if (a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0) { b.x = -b.x; b.y = -b.y; b.z = -b.z; b.w = -b.w; }
  Q q{a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t, a.w + (b.w - a.w) * t};
  qnorm(q);
  return q;
}
Q qFromMat(const Mat4 &M) {              // the rotation part, taken as orthonormal
  const float m00 = M.m[0], m10 = M.m[1], m20 = M.m[2], m01 = M.m[4], m11 = M.m[5], m21 = M.m[6], m02 = M.m[8], m12 = M.m[9], m22 = M.m[10];
  const float tr = m00 + m11 + m22;
  Q q;
  if (tr > 0) { const float s = std::sqrt(tr + 1) * 2; q = {(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25f * s}; }
  else if (m00 > m11 && m00 > m22) { const float s = std::sqrt(1 + m00 - m11 - m22) * 2; q = {0.25f * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s}; }
  else if (m11 > m22) { const float s = std::sqrt(1 + m11 - m00 - m22) * 2; q = {(m01 + m10) / s, 0.25f * s, (m12 + m21) / s, (m02 - m20) / s}; }
  else { const float s = std::sqrt(1 + m22 - m00 - m11) * 2; q = {(m02 + m20) / s, (m12 + m21) / s, 0.25f * s, (m10 - m01) / s}; }
  qnorm(q);
  return q;
}
inline V3 xf(const Mat4 &M, float x, float y, float z) {
  return {M.m[0] * x + M.m[4] * y + M.m[8] * z + M.m[12], M.m[1] * x + M.m[5] * y + M.m[9] * z + M.m[13], M.m[2] * x + M.m[6] * y + M.m[10] * z + M.m[14]};
}
inline float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
inline float smooth(float a, float b, float x) { const float t = clampf((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

struct Rng {
  uint32_t s = 0x9e3779b9u;
  float f() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (float)(s >> 8) * (1.0f / 16777216.0f); }   // 0..1
  float c() { return f() - 0.5f; }                                                                         // -0.5..0.5
};
inline float hash1(float n) { const float s = std::sin(n * 91.345f + 17.17f) * 43758.5453f; return s - std::floor(s); }

// ---------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------
GLuint compileF(GLenum type, const char *src) {
  const GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[2048]; glGetShaderInfoLog(s, sizeof log, nullptr, log); std::fprintf(stderr, "fx: shader:\n%s\n", log); return 0; }
  return s;
}
GLuint linkF(const char *vs, const char *fs) {
  const GLuint v = compileF(GL_VERTEX_SHADER, vs), f = compileF(GL_FRAGMENT_SHADER, fs);
  if (!v || !f) return 0;
  const GLuint p = glCreateProgram();
  glAttachShader(p, v); glAttachShader(p, f);
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { char log[2048]; glGetProgramInfoLog(p, sizeof log, nullptr, log); std::fprintf(stderr, "fx: link:\n%s\n", log); return 0; }
  glDeleteShader(v); glDeleteShader(f);
  return p;
}

// ---- the pieces: the car's own meshes (render.cpp's vertex format), one instance a piece
const char *PART_VS = R"(#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec3 aCol; layout(location=3) in float aKind;
layout(location=4) in vec3 iPos; layout(location=5) in vec4 iQ; layout(location=6) in vec3 iScale; layout(location=7) in vec4 iCol;
uniform mat4 uVP;
out vec3 vW, vN, vC; out float vK, vBurn;
vec3 qrot(vec4 q, vec3 v){ vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
void main(){
  vec3 w = iPos + qrot(iQ, aPos * iScale);
  vN = qrot(iQ, aNrm / iScale);
  int k = int(aKind + 0.5);
  vC = k == 12 ? iCol.rgb * (aCol.r / 0.78) : k == 13 ? iCol.rgb : aCol;     // 12: the car's paint, 13: all of it the piece's colour
  vK = aKind; vBurn = iCol.a; vW = w;
  gl_Position = uVP * vec4(w, 1.0);
}
)";
const char *PART_FS = R"(#version 330 core
in vec3 vW, vN, vC; in float vK, vBurn;
uniform vec3 uEye, uSun, uSunCol, uSkyAmb, uGndAmb, uFog; uniform float uFogK;
out vec4 o;
void main(){
  vec3 V = uEye - vW; float dist = length(V); V /= dist;
  vec3 n = normalize(vN); if (dot(n, V) < 0.0) n = -n;
  vec3 c = mix(vC, vec3(0.030, 0.027, 0.025), vBurn);
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y * 0.5 + 0.5);
  vec3 lit = c * (amb + uSunCol * max(dot(n, uSun), 0.0) * 0.78);
  int k = int(vK + 0.5);
  if (k == 6 || k == 12 || k == 13) { vec3 h = normalize(uSun + V); lit += uSunCol * pow(max(dot(n, h), 0.0), 48.0) * 0.30 * (1.0 - vBurn); }
  o = vec4(mix(lit, uFog, 1.0 - exp(-dist * uFogK)), 1.0);
}
)";

// ---- puffs: smoke as a volume the sun goes through (js/smoke.js), and flame
const char *PUFF_VS = R"(#version 330 core
layout(location=0) in vec2 aC;
layout(location=1) in vec4 iPos;     // xyz centre, w the ground's height under it
layout(location=2) in vec4 iSRAT;    // size, rotation, alpha, tile
layout(location=3) in vec4 iCol;     // rgb, heat (0 smoke; flame 1 newborn .. 0 spent, offset by 1)
uniform mat4 uVP; uniform vec3 uEye, uR, uU, uF;
out vec2 vUv, vC, vL; out vec3 vCol, vDir; out float vA, vAbove, vW, vHeat;
void main(){
  float s = iSRAT.x, r = iSRAT.y;
  // a puff that has swallowed the lens is a screen of nearly clear air: shrink it as the camera gets inside
  float dist = dot(iPos.xyz - uEye, uF);
  s *= clamp(dist / (s * 1.2), 0.15, 1.0);
  vec2 rc = vec2(aC.x * cos(r) - aC.y * sin(r), aC.x * sin(r) + aC.y * cos(r));
  // a flame is taller than it is wide, whichever way its picture is turned
  if (iCol.a > 0.5) rc *= vec2(0.78, 1.38);
  vec3 wp = iPos.xyz + (uR * rc.x + uU * rc.y) * s;
  vAbove = (wp.y - iPos.w) / max(0.15, s * 0.45);
  vC = aC; vL = rc;
  float t = iSRAT.w;
  vUv = (aC * 0.5 + 0.5) * 0.5 + vec2(mod(t, 2.0), floor(t / 2.0)) * 0.5;
  vCol = iCol.rgb; vA = iSRAT.z; vHeat = iCol.a; vDir = wp - uEye;
  gl_Position = uVP * vec4(wp, 1.0);
  vW = gl_Position.w;
}
)";
const char *PUFF_FS = R"(#version 330 core
in vec2 vUv, vC, vL; in vec3 vCol, vDir; in float vA, vAbove, vW, vHeat;
uniform sampler2D uMap, uDepth;
uniform vec3 uSunV, uSunW, uSun, uAmb, uFog;
uniform float uFogK, uSoft, uZA, uZB, uFire;
uniform vec2 uRes;
out vec4 o;
void main(){
  vec4 t = texture(uMap, vUv);
  bool flame = vHeat > 0.5;
  // THE GROUND: a flat billboard crossing the road is cut off in a straight line, the tell of a sprite. Thin it out as it reaches it.
  float dens = t.a * vA * (flame ? smoothstep(-0.6, 0.5, vAbove) : smoothstep(0.0, 1.0, vAbove));
  if (dens < 0.004) discard;                            // most of a quad is clear air: leave before anything costs
  // SOFT PARTICLES: fade over the last stretch before anything solid (a car, a barrier, a board)
  if (uSoft > 0.5) {
    float d = texture(uDepth, gl_FragCoord.xy / uRes).r * 2.0 - 1.0;
    float zs = uZB / (d + uZA);
    dens *= clamp((zs - vW) / (flame ? 0.35 : 0.7), 0.0, 1.0);
  }
  // near the lens it thins out, rather than filling the screen with one texel
  dens *= flame ? smoothstep(0.20, 1.1, vW) : smoothstep(0.35, 2.2, vW);
  if (dens < 0.004) discard;
  float dist = length(vDir);
  float fog = 1.0 - exp(-dist * uFogK);
  if (flame) {
    float h = vHeat - 1.0;                              // 1 newborn .. 0 spent
    float temp = h * (0.50 + 1.05 * t.r) * (0.75 + 0.5 * t.a);
    vec3 c = mix(vec3(0.85, 0.09, 0.015), vec3(1.0, 0.36, 0.05), smoothstep(0.10, 0.42, temp));
    c = mix(c, vec3(1.0, 0.72, 0.22), smoothstep(0.42, 0.75, temp));
    c = mix(c, vec3(1.0, 0.94, 0.72), smoothstep(0.80, 1.15, temp));
    // A flame HIDES the flame behind it as well as adding to it: forty of them laid on top of one
    // another settle at glow / 0.42, a colour, where pure addition would be a white hole in the picture.
    float glow = uFire * (0.20 + 0.95 * temp * temp);
    // a dying flame is soot: it stops giving light and starts hiding what is behind it
    float soot = 1.0 - smoothstep(0.0, 0.40, h);
    vec3 sootC = vec3(0.035, 0.032, 0.030) * (uAmb + uSun * 0.35);
    vec3 rgb = c * glow * dens * (1.0 - 0.85 * soot) * vCol + sootC * dens * soot * 0.65;
    float a = dens * (0.42 + 0.23 * soot);
    o = vec4(mix(rgb, uFog * a, fog * 0.6), a);
    return;
  }
  // a soft sphere's normal, roughened by the puff's own noise
  float r2 = dot(vL, vL);
  vec3 n = normalize(vec3(vL * 0.95 + (t.r - 0.5) * 0.6, sqrt(max(0.0, 1.0 - r2)) + 0.25));
  float wrap = dot(n, uSunV) * 0.5 + 0.5;
  float fwd = pow(max(0.0, dot(vDir / dist, uSunW)), 5.0);          // the sun behind the smoke
  float thin = 1.0 - clamp(dens * 1.4, 0.0, 1.0);                   // thin edges let more light through
  // self-shadowing, faked: the underside and the side away from the sun sit in the puff's own shadow
  float shade = mix(0.42, 1.0, smoothstep(-0.4, 0.8, n.y));
  float sunLit = smoothstep(0.15, 0.95, wrap);
  vec3 light = uAmb * shade + uSun * (sunLit * 0.95 + fwd * (0.8 + 1.6 * thin));
  vec3 col = vCol * light * (0.66 + 0.68 * t.r) * mix(1.0, 0.70, clamp(dens * 1.2, 0.0, 1.0));
  col = mix(col, uFog, fog);
  o = vec4(col * dens, dens);
}
)";

// ---- the puffs are drawn at half size and laid over the picture: smoke has no detail a half-size
// buffer loses, and filling pixels is what a small GPU pays for
const char *COMP_VS = R"(#version 330 core
out vec2 vU;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vU = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }
)";
const char *COMP_FS = R"(#version 330 core
in vec2 vU; uniform sampler2D uTex; out vec4 o;
void main(){ o = texture(uTex, vU); }
)";

// ---- sparks: a streak from where it was a thirtieth of a second ago (js/sparks.js)
const char *SPARK_VS = R"(#version 330 core
layout(location=0) in vec2 aP;       // x 0 tail .. 1 head, y -1..1 across
layout(location=1) in vec3 iHead; layout(location=2) in vec3 iVel; layout(location=3) in vec2 iHeat;
uniform mat4 uVP; uniform vec2 uProj; uniform float uShutter, uWidth, uPx;
out float vU, vV, vHeat;
void main(){
  vec4 A = uVP * vec4(iHead - iVel * uShutter, 1.0);
  vec4 B = uVP * vec4(iHead, 1.0);
  vec2 a = A.xy / max(0.05, A.w) / uProj, b = B.xy / max(0.05, B.w) / uProj;
  vec2 d = b - a; float L = length(d);
  d = L > 1e-5 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  vec4 P = mix(A, B, aP.x);
  // never thinner than a pixel and a bit: a spark far off is a point of light, not a flicker
  float w = max(uWidth * iHeat.y * (0.5 + 0.5 * iHeat.x), uPx * max(P.w, 0.05));
  P.xy += (n * aP.y * w + d * (aP.x * 2.0 - 1.0) * w) * uProj;
  vU = aP.x; vV = aP.y; vHeat = iHeat.x;
  gl_Position = P;
}
)";
const char *SPARK_FS = R"(#version 330 core
in float vU, vV, vHeat; uniform float uGain; out vec4 o;
void main(){
  float across = 1.0 - vV * vV;
  float a = across * across * mix(0.25, 1.0, vU);     // the head burns brightest
  vec3 c = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.0, 0.45, vHeat));
  c = mix(c, vec3(1.0, 0.92, 0.7), smoothstep(0.55, 1.0, vHeat));
  o = vec4(c * uGain * (0.35 + 1.65 * vHeat * vHeat) * a, 1.0);
}
)";

// ---- marks on the ground: scorch, the glow of a fire on the road, the shock ring, a piece's shadow
const char *DECAL_VS = R"(#version 330 core
layout(location=0) in vec2 aC;
layout(location=1) in vec4 iPos;     // xyz, size
layout(location=2) in vec4 iCol;     // rgb, alpha
layout(location=3) in vec3 iRSE;     // rotation, shape (0 disc, 1 ring), emission
layout(location=4) in vec2 iSlope;   // the ground's rise per metre along x and z
uniform mat4 uVP; uniform vec3 uEye;
out vec2 vC; out vec4 vCol; out vec2 vSE; out float vDist;
void main(){
  float r = iRSE.x;
  vec2 rc = vec2(aC.x * cos(r) - aC.y * sin(r), aC.x * sin(r) + aC.y * cos(r));
  vec3 wp = iPos.xyz + vec3(rc.x, 0.0, rc.y) * iPos.w;
  wp.y += dot(iSlope, wp.xz - iPos.xz);
  vC = aC; vCol = iCol; vSE = iRSE.yz; vDist = distance(wp, uEye);
  // The road is not a plane and this is: pull it a hand's width toward the eye, along the line of
  // sight (so it does not move on the screen), or the road swallows the far half of it.
  wp += (uEye - wp) / max(vDist, 0.01) * min(0.30, vDist * 0.05);
  gl_Position = uVP * vec4(wp, 1.0);
}
)";
const char *DECAL_FS = R"(#version 330 core
in vec2 vC; in vec4 vCol; in vec2 vSE; in float vDist;
uniform vec3 uFog; uniform float uFogK;
out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  float r = length(vC);
  float f;
  if (vSE.x > 0.5) f = smoothstep(0.55, 0.86, r) * (1.0 - smoothstep(0.88, 1.0, r));
  else {
    // a blast leaves a star, not a circle: the edge is eaten by noise along the spokes
    float edge = vSE.y > 0.0 ? 0.80 : 0.52 + 0.48 * vnoise(vC / max(r, 0.001) * 2.6 + 7.0);
    // light falls away from its middle; a burn is black right across and ragged at the rim
    f = 1.0 - smoothstep((vSE.y > 0.0 ? 0.15 : 0.55) * edge, edge, r);
    if (vSE.y > 0.0) f *= f;
  }
  if (f < 0.003) discard;
  float fog = 1.0 - exp(-vDist * uFogK);
  float a = vCol.a * f * (1.0 - fog);
  o = vec4(vCol.rgb * (a + vSE.y * f * (1.0 - fog)), a);
}
)";

// ---------------------------------------------------------------------------
// what there is
// ---------------------------------------------------------------------------
struct Puff {
  bool on = false;
  float x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, age = 0, life = 1, s0 = 1, grow = 1, a = 1, rot = 0, spin = 0;
  float r = 1, g = 1, b = 1, rise = 0.5f, gy = 0, drag = 2.2f, key = 0;
  int tile = 0;
  bool flame = false;
};
struct PuffOpt {
  float size = 0.5f, grow = 1.4f, life = 3, alpha = 0.5f, rise = 0.45f, gy = 0, drag = 2.2f;
  const float *col = RUBBER;
  bool flame = false;
};
struct Spark { float x, y, z, vx, vy, vz, life, max, gy, w; };

enum Kind { K_FW, K_RW, K_WF, K_WR, K_SHARD, K_CHUNK, K_N };
const int KCAP[K_N] = {16, 16, 32, 32, 320, 96};

struct Body {
  bool on = false;
  int kind = 0;
  V3 pos, vel, w, half, inv, scale{1, 1, 1}, col, prevPos;
  Q q, prevQ;
  float burn = 0, e = 0.25f, mu = 0.55f, kAir = 0.02f, flutter = 0, mass = 1;
  bool wheel = false, small = false, asleep = false, slide = false, hasWall = false;
  float R = 0.3f, hw = 0.15f;
  int hint = -1, gtick = 0;
  float gy = 0, wnx = 0, wnz = 0, wout = 0, wbase = 0, sleep = 0, slowT = 0, flameT = 0;
  double born = 0;
};
struct KindGL {
  GLuint vao = 0, vbo = 0, ibo = 0;
  int verts = 0, live = 0;
  bool dirty = true;
  V3 c0, half;                        // the mesh's own centre in the car's frame, and its half-size
  std::vector<Body> pool;
};

struct Kick { float x, z, cs, sn, vx, vz, speed, mass; };
struct Timed { V3 p; float age = 0, life = 1, r0 = 1, r1 = 1, col[3] = {1, 1, 1}, alpha = 0, emis = 0, sx = 0, sz = 0; int shape = 0; };
struct Decal { float pos[3], size, col[3], alpha, rot, shape, emis, sx = 0, sz = 0; };

struct CarSt {
  const Car *car = nullptr;
  bool seen = false;
  float crush[4] = {0, 0, 0, 0};
  bool lostF = false, lostR = false, wl[4] = {false, false, false, false}, air = false;
  int bin = -1;
  float acc[16] = {0};
  V3 velPrev, posPrev;
  float speedPrev = 0;
  double dmg = 0;
  Gnd gnd;
  // the fire
  int phase = 0;                      // 0 sound, 1 burning, 2 a wreck that has exploded
  bool out = false;                   // put out: it stays the colour it burned to, and gives off nothing
  float heat = 0, burnT = 0, fuse = 9, wreckT = 0, burn = 0, flick = 0;
  V3 at;                              // where the fire is, for the glow on the road
  float gy = 0, sx = 0, sz = 0;       // the road's height there, and its slope along x and z
  uint32_t seed = 1;
  bool tested = false;
};

void puffAtlas(std::vector<unsigned char> &px, int S) {
  px.assign((size_t)S * 2 * S * 2 * 4, 0);
  auto hash = [](float x, float y, float s) { const float h = std::sin(x * 127.1f + y * 311.7f + s * 74.7f) * 43758.5453f; return h - std::floor(h); };
  auto noise = [&](float x, float y, float s) {
    const float xi = std::floor(x), yi = std::floor(y), xf = x - xi, yf = y - yi;
    const float u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const float a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (int t = 0; t < 4; t++) {
    const int ox = (t % 2) * S, oy = (t >> 1) * S;
    for (int y = 0; y < S; y++) for (int x = 0; x < S; x++) {
      const float u = (float)x / S * 2 - 1, v = (float)y / S * 2 - 1;
      const float r = std::hypot(u, v);
      float n = 0, amp = 0.5f, f = 3;
      for (int o = 0; o < 5; o++) { n += amp * noise(u * f + 9.0f * t, v * f + 5.0f * t, (float)t); amp *= 0.5f; f *= 2.03f; }
      // billows: the edge eaten by the noise
      const float edge = 1 - std::min(1.0f, std::max(0.0f, (r - 0.25f - 0.55f * n) / 0.35f));
      const float dens = std::max(0.0f, edge) * (0.55f + 0.45f * n);
      const size_t k = ((size_t)(oy + y) * S * 2 + ox + x) * 4;
      px[k] = (unsigned char)std::min(255.0f, n * 255);
      px[k + 1] = 255; px[k + 2] = 255;
      // nothing may reach the tile's edge: a neighbour's billow would bleed in under the mipmaps
      const float rim = 1 - smooth(0.86f, 0.98f, std::max(std::fabs(u), std::fabs(v)));
      px[k + 3] = (unsigned char)std::min(255.0f, dens * dens * 255 * 1.3f * rim);
    }
  }
}

// a vertex in render.cpp's format: pos3 nrm3 col3 kind1
void pushV(std::vector<float> &v, V3 p, V3 n, const float c[3], float kind) {
  const float a[10] = {p.x, p.y, p.z, n.x, n.y, n.z, c[0], c[1], c[2], kind};
  v.insert(v.end(), a, a + 10);
}
void pushTri(std::vector<float> &v, V3 a, V3 b, V3 c, const float col[3], float kind) {
  const V3 n = norm(cross(b - a, c - a));
  pushV(v, a, n, col, kind); pushV(v, b, n, col, kind); pushV(v, c, n, col, kind);
}
// js/debris.js shardGeometry: an irregular flat polygon, painted on top and bare carbon underneath and round its torn edge
std::vector<float> shardMesh() {
  std::vector<float> v;
  const int N = 7;
  const float T = 0.06f;
  float px[N], pz[N];
  for (int i = 0; i < N; i++) {
    const float a = (float)i / N * 6.2831853f;
    const float r = 0.35f + 0.65f * std::fabs(std::sin(i * 12.9898f + 1.7f) * 0.9f + (i % 2 ? 0.1f : 0.0f));
    px[i] = std::cos(a) * r * 0.5f; pz[i] = std::sin(a) * r * 0.5f;
  }
  const float W[3] = {1, 1, 1};
  for (int i = 0; i < N; i++) {
    const int j = (i + 1) % N;
    pushTri(v, {0, T, 0}, {px[j], T, pz[j]}, {px[i], T, pz[i]}, W, 13);
    pushTri(v, {0, -T, 0}, {px[i], -T, pz[i]}, {px[j], -T, pz[j]}, CARBON, 0);
    pushTri(v, {px[i], T, pz[i]}, {px[j], T, pz[j]}, {px[j], -T, pz[j]}, CARBON, 0);
    pushTri(v, {px[i], T, pz[i]}, {px[j], -T, pz[j]}, {px[i], -T, pz[i]}, CARBON, 0);
  }
  return v;
}
// a torn lump: an icosahedron with its corners pushed about
std::vector<float> chunkMesh() {
  std::vector<float> v;
  const float t = 1.618034f;
  V3 P[12] = {{-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0}, {0, -1, t}, {0, 1, t}, {0, -1, -t}, {0, 1, -t}, {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1}};
  for (int i = 0; i < 12; i++) { const float k = 0.5f / 1.902f * (0.72f + 0.5f * hash1((float)i * 3.7f)); P[i] = P[i] * k; }
  const int F[20][3] = {{0, 11, 5}, {0, 5, 1}, {0, 1, 7}, {0, 7, 10}, {0, 10, 11}, {1, 5, 9}, {5, 11, 4}, {11, 10, 2}, {10, 7, 6}, {7, 1, 8},
                        {3, 9, 4}, {3, 4, 2}, {3, 2, 6}, {3, 6, 8}, {3, 8, 9}, {4, 9, 5}, {2, 4, 11}, {6, 2, 10}, {8, 6, 7}, {9, 8, 1}};
  const float W[3] = {1, 1, 1};
  for (const auto &f : F) pushTri(v, P[f[0]], P[f[1]], P[f[2]], W, 13);
  return v;
}

}  // namespace

// ---------------------------------------------------------------------------
struct Fx::Impl {
  bool glReady = false, glTried = false;
  GLuint partProg = 0, puffProg = 0, sparkProg = 0, decalProg = 0, compProg = 0;
  GLuint lowTex = 0, lowFbo = 0;
  int lowW = 0, lowH = 0;
  bool half = true;                   // puffs at half size (needs the depth copy); XBR_FXHALF=0 draws them straight in
  GLuint quadVbo = 0, stripVbo = 0;
  GLuint puffVao = 0, puffIbo = 0, sparkVao = 0, sparkIbo = 0, decalVao = 0, decalIbo = 0;
  GLuint atlas = 0, depthTex = 0, depthFbo = 0;
  int depthW = 0, depthH = 0;
  bool soft = true, softChecked = false;
  KindGL kinds[K_N];
  std::string meshKey;                // the car the wing and wheel meshes were cut from
  bool meshDirty = false;
  std::vector<float> meshV[4];

  const void *session = nullptr;
  const Track *track = nullptr;
  const World *world = nullptr;
  const Terrain *terrain = nullptr;
  const Spec *spec = nullptr;

  std::vector<Puff> puffs = std::vector<Puff>(MAX_PUFF);
  int puffNext = 0;
  std::vector<Spark> sparks;
  std::vector<CarSt> cars;
  std::vector<Kick> kicks;
  std::vector<Timed> timed;
  std::vector<Decal> scorch, decals;
  int scorchNext = 0;
  std::vector<float> buf, pbuf;
  std::vector<int> order;
  Rng rng;
  double t = 0;
  float eye[3] = {0, 0, 0};
  bool haveEye = false;
  float wet = 0;
  double boom = 0;
  // unseen checks
  unsigned test = 0;
  int testCar = -1, callIx = 0;
  int spawnHint = -1;                 // the track sample of the car being watched: where its pieces start looking for the ground
  bool timing = false;
  double cpuMs = 0;
  enum { T_FIRE = 1, T_EXPLODE = 2, T_WHEEL = 4, T_WING = 8, T_SPARKS = 16, T_SMOKE = 32, T_DUST = 64, T_WRECK = 128 };

  Impl() {
    sparks.reserve(MAX_SPARK);
    for (int k = 0; k < K_N; k++) kinds[k].pool.resize((size_t)KCAP[k]);
    if (const char *e = std::getenv("XBR_FXTEST")) {
      const std::string s = std::string(",") + e + ",";
      auto has = [&](const char *w) { return s.find(std::string(",") + w + ",") != std::string::npos; };
      const bool all = has("all");
      if (all || has("fire")) test |= T_FIRE;
      if (has("explode")) test |= T_EXPLODE;
      if (has("wreck")) test |= T_WRECK;
      if (all || has("wheel")) test |= T_WHEEL;
      if (all || has("wing")) test |= T_WING;
      if (all || has("sparks")) test |= T_SPARKS;
      if (all || has("smoke")) test |= T_SMOKE;
      if (has("dust")) test |= T_DUST;
      if (!test) std::fprintf(stderr, "fx: XBR_FXTEST=%s names no effect (fire, explode, wreck, wheel, wing, sparks, smoke, dust, all)\n", e);
    }
    timing = std::getenv("XBR_FXTIME") != nullptr;
    if (const char *e = std::getenv("XBR_FXCAR")) testCar = std::atoi(e);
    if (const char *e = std::getenv("XBR_FXSOFT")) soft = std::atoi(e) != 0;
    if (const char *e = std::getenv("XBR_FXHALF")) half = std::atoi(e) != 0;
  }

  // ---- emitters -------------------------------------------------------------
  float wetK(float a) const { return a * (1 - 0.8f * wet); }
  bool nearEye(V3 p, float range = EMIT_RANGE) const {
    if (!haveEye) return true;
    const float dx = p.x - eye[0], dz = p.z - eye[2];
    return dx * dx + dz * dz < range * range;
  }
  void puff(V3 p, V3 v, const PuffOpt &o) {
    Puff &q = puffs[(size_t)puffNext];
    puffNext = (puffNext + 1) % MAX_PUFF;
    q.on = true;
    q.x = p.x; q.y = p.y; q.z = p.z; q.vx = v.x; q.vy = v.y; q.vz = v.z;
    q.age = 0; q.life = o.life * (0.75f + rng.f() * 0.5f);
    q.s0 = o.size * (0.8f + rng.f() * 0.4f); q.grow = o.grow * (0.8f + rng.f() * 0.4f);
    q.a = o.alpha; q.rot = rng.f() * 6.283f; q.spin = rng.c() * (o.flame ? 2.4f : 0.6f);
    const float sh = 0.94f + rng.f() * 0.08f;
    q.r = o.col[0] * sh; q.g = o.col[1] * sh; q.b = o.col[2] * sh;
    q.tile = (int)(rng.f() * 4) & 3; q.rise = o.rise; q.gy = o.gy; q.drag = o.drag; q.flame = o.flame;
  }
  void spark(int count, V3 p, V3 v, float gy, float spread = 2.5f, float up = 2, float life = 0.55f, float width = 1) {
    for (int k = 0; k < count; k++) {
      Spark s;
      s.x = p.x + rng.c() * 0.12f; s.y = p.y + rng.f() * 0.03f; s.z = p.z + rng.c() * 0.12f;
      // a spark leaves the contact at most of the rubbing speed, scattered in a cone
      const float m = 0.55f + rng.f() * 0.5f;
      s.vx = v.x * m + rng.c() * spread; s.vy = v.y * m + rng.f() * up; s.vz = v.z * m + rng.c() * spread;
      s.life = s.max = life * (0.35f + rng.f() * 0.9f);
      s.gy = gy; s.w = width * (0.6f + rng.f() * 0.8f);
      if ((int)sparks.size() < MAX_SPARK) sparks.push_back(s);
      else sparks[(size_t)(rng.f() * (MAX_SPARK - 1))] = s;          // full: overwrite anything
    }
  }

  // ---- the ground under a point ----------------------------------------------
  // Inside the barriers the height is the ROAD's (profile + camber); beyond, the land's.
  float ground(float x, float z, int &hint, Body *b = nullptr) const {
    const Proj pr = track->project(x, -z, hint, 8);
    hint = pr.i;
    const double out = std::fabs(pr.lat) - (pr.w + pr.run);
    const double road = terrain->h(pr.s, pr.lat);
    if (b) {
      b->hasWall = out > -0.05;
      if (b->hasWall) {
        const double sgn = pr.lat < 0 ? -1 : 1;
        b->wnx = (float)(sgn * std::sin(pr.hdg)); b->wnz = (float)(sgn * std::cos(pr.hdg));     // back into the track (GL z = -sim y)
        b->wout = (float)out; b->wbase = (float)road;
      }
    }
    if (out <= 0 || !world) return (float)road;
    return (float)world->groundY(x, -z);
  }

  // ---- bodies ----------------------------------------------------------------
  Body &alloc(int kind) {
    KindGL &K = kinds[kind];
    Body *slot = nullptr;
    for (Body &b : K.pool) if (!b.on) { slot = &b; break; }
    if (!slot) { slot = &K.pool[0]; for (Body &b : K.pool) if (b.born < slot->born) slot = &b; }      // full: the oldest goes
    *slot = Body{};
    slot->on = true; slot->kind = kind; slot->born = t; slot->hint = spawnHint;
    K.dirty = true;
    return *slot;
  }
  // A box of the piece's own size: inertia for a unit mass, and what the air does to it.
  void shape(Body &b, V3 half, float mass, float cd) {
    b.half = {std::max(0.008f, half.x * b.scale.x), std::max(0.008f, half.y * b.scale.y), std::max(0.008f, half.z * b.scale.z)};
    const V3 h = b.half;
    // from a slightly ROUNDER box than the piece: a splinter has almost no inertia about its long
    // axis, and every friction impulse spun it up again for ever (js/debris.js)
    const float ix = std::max(h.x, 0.03f), iy = std::max(h.y, 0.03f), iz = std::max(h.z, 0.03f);
    b.inv = {3 / (iy * iy + iz * iz), 3 / (ix * ix + iz * iz), 3 / (ix * ix + iy * iy)};
    const float lo = std::min({h.x, h.y, h.z}), hi = std::max({h.x, h.y, h.z});
    const float flat = lo / hi;
    b.flutter = (1 - flat) * 5;
    b.mass = mass;
    // WEIGHT: the air takes the same force off a wing and a wheel of the same face, and the wing has a
    // third of the mass to resist it with. deceleration = (0.5 rho Cd A / m) v^2, A = its two largest sides, tumbling.
    const float mid = h.x + h.y + h.z - lo - hi;
    b.kAir = 0.5f * 1.2f * cd * (4 * hi * mid) * 0.55f / std::max(0.02f, mass);
  }
  void wheelShape(Body &b, float R, float hw, float mass) {
    b.wheel = true; b.R = R; b.hw = hw; b.half = {R, R, hw}; b.mass = mass;
    b.inv = {12 / (3 * R * R + 4 * hw * hw), 12 / (3 * R * R + 4 * hw * hw), 2 / (R * R)};      // a solid cylinder, axle on z
    b.flutter = 0;
    b.kAir = 0.5f * 1.2f * 0.55f * (2 * R * 2 * hw) / mass;
    b.e = 0.56f; b.mu = 0.9f;
  }
  void shards(int n, V3 at, V3 vel, const float col[3], float size = 0.09f, float spread = 3, float up = 2.5f, float painted = 0.45f, float burn = 0) {
    for (int i = 0; i < n; i++) {
      Body &b = alloc(K_SHARD);
      b.small = true;
      b.pos = at + V3{rng.c() * 0.4f, rng.f() * 0.2f, rng.c() * 0.4f};
      b.q = qmul(qAxis({0, 1, 0}, rng.f() * 6.3f), qAxis(norm({rng.c(), rng.c(), rng.c() + 0.01f}), rng.f() * 6.3f));
      const float s = size * (0.35f + rng.f() * rng.f() * 1.6f);
      const float lng = rng.f() < 0.5f ? 1.5f + rng.f() * 2.5f : 1;      // splinters: long and narrow as often as not
      b.scale = {s * lng, s * (0.25f + rng.f() * 0.4f), s / std::sqrt(lng)};
      shape(b, {0.5f, 0.06f, 0.5f}, 0.04f + 9.0f * s * s * lng, 1.0f);
      b.vel = vel * (0.5f + rng.f() * 0.5f) + V3{rng.c() * spread, rng.f() * up, rng.c() * spread};
      b.w = {rng.c() * 40, rng.c() * 40, rng.c() * 40};
      const bool paint = rng.f() < painted;
      b.col = paint ? V3{col[0], col[1], col[2]} : V3{CARBON[0], CARBON[1], CARBON[2]};
      b.burn = burn;
      b.e = 0.3f; b.mu = 0.45f;
    }
  }

  // An impulse along unit n at offset r (unit mass, inertia in the piece's own axes) that changes that
  // point's velocity along n by dv, capped. Returns the impulse applied.
  static float impulse(Body &b, V3 r, V3 n, float dv, float cap = 1e30f) {
    V3 tq = irot(b.q, cross(r, n));
    tq = rot(b.q, V3{tq.x * b.inv.x, tq.y * b.inv.y, tq.z * b.inv.z});
    const float k = 1 + dot(n, cross(tq, r));
    const float j = std::min(cap, dv / std::max(1e-6f, k));
    b.vel = b.vel + n * j;
    b.w = b.w + tq * j;
    return j;
  }
  static V3 thinAxis(const Body &b) {
    const V3 h = b.half;
    const V3 ax = h.y <= h.x && h.y <= h.z ? V3{0, 1, 0} : h.x <= h.z ? V3{1, 0, 0} : V3{0, 0, 1};
    return rot(b.q, ax);
  }
  // The points of a piece that can touch the ground. A box: its eight corners. A wheel: the lowest
  // point of each rim, which slides round the rim as it rolls — so it ROLLS, where corners would hop.
  static int contacts(const Body &b, V3 out[10]) {
    int n = 0;
    if (!b.wheel) {
      for (int i = 0; i < 8; i++) out[n++] = rot(b.q, V3{(i & 1 ? 1 : -1) * b.half.x, (i & 2 ? 1 : -1) * b.half.y, (i & 4 ? 1 : -1) * b.half.z});
      return n;
    }
    const V3 a = rot(b.q, V3{0, 0, 1});
    const float l = std::sqrt(std::max(0.0f, 1 - a.y * a.y));
    if (l > 0.04f) {
      const V3 down = (V3{0, -1, 0} + a * a.y) * (b.R / l);
      out[n++] = a * b.hw + down; out[n++] = a * -b.hw + down;
    }
    if (std::fabs(a.y) > 0.5f) {                 // going over, or lying on its side: the rim all round
      const float s = a.y > 0 ? -b.hw : b.hw;
      for (int i = 0; i < 4; i++) { const float an = i * 1.5708f; out[n++] = rot(b.q, V3{std::cos(an) * b.R, std::sin(an) * b.R, s}); }
    }
    return n;
  }

  // Integrate one piece by dt: gravity, air, flutter, then contacts. Returns how many points touched.
  int step(Body &b, float dt) {
    b.vel.y -= G * dt;
    const float sp = len(b.vel);
    b.vel = b.vel * (1 / (1 + b.kAir * sp * dt));
    b.w = b.w * std::max(0.0f, 1 - (b.wheel ? 0.05f : 0.25f) * dt);
    if (b.flutter > 0 && sp > 4) { b.w.x += rng.c() * b.flutter * sp * dt; b.w.z += rng.c() * b.flutter * sp * dt; }   // a flat piece in the air catches it, and wobbles
    b.pos = b.pos + b.vel * dt;
    const Q dq = qmul(Q{b.w.x, b.w.y, b.w.z, 0}, b.q);
    b.q.x += 0.5f * dq.x * dt; b.q.y += 0.5f * dq.y * dt; b.q.z += 0.5f * dq.z * dt; b.q.w += 0.5f * dq.w * dt;
    qnorm(b.q);

    // the barrier: a piece low enough bounces off it
    if (b.hasWall && b.wout > 0 && b.pos.y < b.wbase + BARRIER_H) {
      b.pos.x += b.wnx * b.wout; b.pos.z += b.wnz * b.wout;
      const float vn = b.vel.x * b.wnx + b.vel.z * b.wnz;
      if (vn < 0) {
        b.vel.x -= 1.35f * vn * b.wnx; b.vel.z -= 1.35f * vn * b.wnz;
        b.vel = b.vel * 0.7f;
        b.w = b.w * 0.6f + V3{rng.c(), rng.c(), rng.c()} * 6.0f;
      }
      b.wout = 0;
    }

    const float reach = b.wheel ? b.R + b.hw : b.half.x + b.half.y + b.half.z;
    if (b.pos.y - reach > b.gy) return 0;        // clearly in the air: most of a flight is this
    int touching = 0;
    const V3 up{0, 1, 0};
    const int passes = b.small ? 2 : 4;
    for (int pass = 0; pass < passes; pass++) {
      V3 pts[10];
      const int n = contacts(b, pts);
      for (int i = 0; i < n; i++) {
        const V3 r = pts[i];
        const float depth = b.gy - (b.pos.y + r.y);
        if (depth <= 0) continue;
        touching++;
        if (pass == 0) b.pos.y += depth * 0.8f;
        V3 v = cross(b.w, r) + b.vel;
        const float vn = v.y;
        if (vn >= 0) continue;
        const float jn = impulse(b, r, up, -(1 + (vn < -1 ? b.e : 0)) * vn);
        // friction, along the point's sliding direction
        v = cross(b.w, r) + b.vel;
        const float tl = std::hypot(v.x, v.z);
        if (tl > 1e-4f) impulse(b, r, V3{-v.x / tl, 0, -v.z / tl}, tl, b.mu * jn);
      }
    }
    if (!touching) return 0;
    const float rr = std::max({b.half.x, b.half.y, b.half.z});
    const bool slow = dot(b.vel, b.vel) < 0.6f && dot(b.w, b.w) * rr * rr < 0.64f;
    if (b.wheel && !slow) {
      // A ROLLING WHEEL STAYS UP. What holds a real one upright is its spin (a gyroscope), which this
      // solver does not carry; so while the rim is moving the axle is held level and the fall-over is
      // damped, in proportion to that speed. It slows, the hold lets go, it wobbles and goes over.
      const V3 a = rot(b.q, V3{0, 0, 1});
      const float rim = std::fabs(dot(b.w, a)) * b.R;
      const float k = clampf((rim - 0.9f) / 5.0f, 0, 1);
      if (k > 0 && std::fabs(a.y) < 0.7f) {
        const V3 f = norm(cross(a, up));
        b.w = b.w - f * (dot(b.w, f) * std::min(1.0f, 9 * k * dt));
        const V3 a2 = norm(a - up * (a.y * std::min(1.0f, 6 * k * dt)));
        b.q = qmul(qFromTo(a, a2), b.q);
        qnorm(b.q);
      }
      // rolling resistance: about 2% of its weight
      const float h = std::hypot(b.vel.x, b.vel.z);
      if (h > 0.05f) { const float kk = std::max(0.0f, 1 - 0.02f * G * dt / h); b.vel.x *= kk; b.vel.z *= kk; b.w = b.w * kk; }
    } else {
      // scrub: a piece lying on the road loses its spin, or a flat plate at rest trades a few mm/s between its corners for ever
      b.w = b.w * std::max(0.0f, 1 - 6 * dt);
    }
    if (slow) {
      // THE SETTLE (js/debris.js): once slow and down, ease it onto its biggest face, the way a real one flops over
      V3 ax = thinAxis(b);
      if (ax.y < 0) ax = ax * -1.0f;
      b.q = qLerp(b.q, qmul(qFromTo(ax, up), b.q), std::min(1.0f, 5 * dt));
      b.w = b.w * std::max(0.0f, 1 - 10 * dt);
      const float kk = std::max(0.0f, 1 - 3 * dt);
      b.vel.x *= kk; b.vel.z *= kk;
    }
    return touching;
  }
  // a flat piece skating on the road: Coulomb friction in the plane, a yaw spin that dies away. No corners.
  int slideStep(Body &b, float dt) {
    const float sp = std::hypot(b.vel.x, b.vel.z), dec = b.mu * G * dt;
    const float k = sp > dec ? (sp - dec) / sp : 0;
    b.vel.x *= k; b.vel.z *= k; b.vel.y = 0;
    b.w.x = 0; b.w.z = 0; b.w.y *= std::max(0.0f, 1 - 3 * dt);
    b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt;
    b.q = qmul(qAxis({0, 1, 0}, b.w.y * dt), b.q);
    V3 ax = thinAxis(b);
    if (ax.y < 0) ax = ax * -1.0f;
    b.q = qLerp(b.q, qmul(qFromTo(ax, V3{0, 1, 0}), b.q), std::min(1.0f, 4 * dt));
    b.pos.y = b.gy + std::min({b.half.x, b.half.y, b.half.z});
    if (b.hasWall && b.wout > 0 && b.pos.y < b.wbase + BARRIER_H) b.slide = false;       // back to the full solver for the hit
    return 1;
  }
  void bodies(float dt) {
    for (int kd = 0; kd < K_N; kd++) {
      KindGL &K = kinds[kd];
      K.live = 0;
      for (Body &b : K.pool) {
        if (!b.on) continue;
        if (b.small && t - b.born > SHARD_LIFE) { b.on = false; K.dirty = true; continue; }
        K.live++;
        if (b.small && t - b.born > SHARD_LIFE - SHARD_FADE) K.dirty = true;
        // cars kick what they run over. Only the PIECE moves: a car's physics never hears of it.
        if (b.asleep) {
          for (const Kick &c : kicks) {
            if (c.speed < 4) continue;
            const float dx = b.pos.x - c.x, dz = b.pos.z - c.z;
            if (dx * dx + dz * dz > 9) continue;
            const float lx = dx * c.cs - dz * c.sn, ly = dx * c.sn + dz * c.cs;
            if (std::fabs(lx) > 2.9f || std::fabs(ly) > 1.05f) continue;
            b.asleep = false; b.sleep = 0; b.slide = false;
            // the heavier the piece, the less of the car's speed it leaves with
            const float share = c.mass / (c.mass + b.mass * 12);
            b.vel = V3{c.vx * (0.5f + rng.f() * 0.5f), 0.8f + rng.f() * 2.5f * std::min(1.0f, c.speed / 30), c.vz * (0.5f + rng.f() * 0.5f)} * share;
            b.vel.x += rng.c() * 3; b.vel.z += rng.c() * 3;
            b.w = V3{rng.c(), rng.c(), rng.c()} * 25.0f;
            break;
          }
        }
        if (b.asleep) continue;
        K.dirty = true;
        if (!b.slide || (++b.gtick % 3) == 0) b.gy = ground(b.pos.x, b.pos.z, b.hint, &b);
        int touch = 0;
        if (b.slide) touch = slideStep(b, dt);
        else {
          const float sub = b.small ? SUB * 2 : SUB;
          for (float s = 0; s < dt - 1e-6f; s += sub) touch = step(b, std::min(sub, dt - s));
          if (!b.wheel && touch && std::fabs(b.vel.y) < 0.6f && b.w.x * b.w.x + b.w.z * b.w.z < 4 && std::fabs(thinAxis(b).y) > 0.985f) b.slide = true;
        }
        // a piece that left the blast alight trails it
        if (b.flameT > 0) {
          b.flameT -= dt;
          if (rng.f() < 14 * dt && nearEye(b.pos)) {
            PuffOpt o; o.flame = true; o.size = 0.14f; o.grow = 0.5f; o.life = 0.5f; o.alpha = 0.85f; o.rise = 2.0f; o.gy = b.gy; o.drag = 2.5f;
            static const float W[3] = {1, 1, 1};
            o.col = W;
            puff(b.pos, b.vel * 0.3f, o);
          }
        }
        // Settled? By what it DID this frame, not by its velocity: a plate at rest carries a residue that never reaches zero.
        const float rim = std::max({b.half.x, b.half.y, b.half.z});
        const float qd = std::min(1.0f, std::fabs(b.q.x * b.prevQ.x + b.q.y * b.prevQ.y + b.q.z * b.prevQ.z + b.q.w * b.prevQ.w));
        const float moved = len(b.pos - b.prevPos) + rim * 2 * std::acos(qd);
        b.prevPos = b.pos; b.prevQ = b.q;
        if (touch && dot(b.vel, b.vel) < 0.6f && dot(b.w, b.w) * rim * rim < 0.64f) b.slowT += dt; else b.slowT = 0;
        const bool flat = !b.wheel || std::fabs(thinAxis(b).y) > 0.97f;           // a wheel does not go to sleep standing up
        if (touch && flat && (moved < 0.25f * dt || b.slowT > 1.2f)) {
          b.sleep += dt;
          if (b.sleep > 0.4f) { b.asleep = true; b.vel = {}; b.w = {}; }
        } else b.sleep = 0;
        if (b.pos.y < b.gy - 3) b.pos.y = b.gy;                                    // never lost under the world
      }
    }
  }

  // ---- the meshes the pieces are drawn with -------------------------------------
  // The wings and the wheels are the CAR'S OWN (carmesh.cpp), recentred on themselves.
  void cutMeshes(const Spec &S) {
    if (meshKey == S.key) return;
    meshKey = S.key;
    const CarMeshes cm = buildCarMeshes(S);
    const MeshB *src[4] = {&cm.frontWing, &cm.rearWing, &cm.wheelF, &cm.wheelR};
    for (int k = 0; k < 4; k++) {
      std::vector<float> v = src[k]->v;
      V3 lo{1e9f, 1e9f, 1e9f}, hi{-1e9f, -1e9f, -1e9f};
      for (size_t i = 0; i + 9 < v.size(); i += 10) {
        lo = {std::min(lo.x, v[i]), std::min(lo.y, v[i + 1]), std::min(lo.z, v[i + 2])};
        hi = {std::max(hi.x, v[i]), std::max(hi.y, v[i + 1]), std::max(hi.z, v[i + 2])};
      }
      KindGL &K = kinds[k];
      if (v.empty()) { K.c0 = {}; K.half = {0.3f, 0.05f, 0.5f}; }
      else {
        // a wheel is already centred on its axle; a wing is wherever it sat on the car
        K.c0 = k >= K_WF ? V3{} : (lo + hi) * 0.5f;
        K.half = (hi - lo) * 0.5f;
        for (size_t i = 0; i + 9 < v.size(); i += 10) { v[i] -= K.c0.x; v[i + 1] -= K.c0.y; v[i + 2] -= K.c0.z; }
      }
      meshV[k] = std::move(v);
    }
    meshDirty = true;
  }
  void uploadMesh(int k, const std::vector<float> &v) {
    KindGL &K = kinds[k];
    if (!K.vao) { glGenVertexArrays(1, &K.vao); glGenBuffers(1, &K.vbo); glGenBuffers(1, &K.ibo); }
    glBindVertexArray(K.vao);
    glBindBuffer(GL_ARRAY_BUFFER, K.vbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * sizeof(float)), v.data(), GL_STATIC_DRAW);
    const GLsizei st = 10 * sizeof(float);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, st, (void *)0);
    glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, st, (void *)(3 * sizeof(float)));
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, st, (void *)(6 * sizeof(float)));
    glEnableVertexAttribArray(3); glVertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, st, (void *)(9 * sizeof(float)));
    glBindBuffer(GL_ARRAY_BUFFER, K.ibo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)((size_t)KCAP[k] * 14 * sizeof(float)), nullptr, GL_DYNAMIC_DRAW);
    const GLsizei si = 14 * sizeof(float);
    const int off[4] = {0, 3, 7, 10}, cnt[4] = {3, 4, 3, 4};
    for (int a = 0; a < 4; a++) {
      glEnableVertexAttribArray(4 + (GLuint)a);
      glVertexAttribPointer(4 + (GLuint)a, cnt[a], GL_FLOAT, GL_FALSE, si, (void *)(off[a] * sizeof(float)));
      glVertexAttribDivisor(4 + (GLuint)a, 1);
    }
    glBindVertexArray(0);
    K.verts = (int)(v.size() / 10);
    K.dirty = true;
  }
  GLuint instVao(GLuint &ibo, const float *corner, int nCorner, const int *cnt, int nAttr, int cap, GLuint &cvbo) {
    GLuint vao = 0;
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    if (!cvbo) {
      glGenBuffers(1, &cvbo);
      glBindBuffer(GL_ARRAY_BUFFER, cvbo);
      glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)((size_t)nCorner * 2 * sizeof(float)), corner, GL_STATIC_DRAW);
    } else glBindBuffer(GL_ARRAY_BUFFER, cvbo);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, (void *)0);
    int stride = 0;
    for (int a = 0; a < nAttr; a++) stride += cnt[a];
    glGenBuffers(1, &ibo);
    glBindBuffer(GL_ARRAY_BUFFER, ibo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)((size_t)cap * (size_t)stride * sizeof(float)), nullptr, GL_DYNAMIC_DRAW);
    int off = 0;
    for (int a = 0; a < nAttr; a++) {
      glEnableVertexAttribArray(1 + (GLuint)a);
      glVertexAttribPointer(1 + (GLuint)a, cnt[a], GL_FLOAT, GL_FALSE, (GLsizei)(stride * sizeof(float)), (void *)(off * sizeof(float)));
      glVertexAttribDivisor(1 + (GLuint)a, 1);
      off += cnt[a];
    }
    glBindVertexArray(0);
    return vao;
  }
  bool initGL() {
    glTried = true;
    partProg = linkF(PART_VS, PART_FS); puffProg = linkF(PUFF_VS, PUFF_FS);
    sparkProg = linkF(SPARK_VS, SPARK_FS); decalProg = linkF(DECAL_VS, DECAL_FS); compProg = linkF(COMP_VS, COMP_FS);
    if (!partProg || !puffProg || !sparkProg || !decalProg || !compProg) { std::fprintf(stderr, "fx: a shader did not build — no crash effects this run\n"); return false; }
    const float quad[12] = {-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1}, strip[12] = {0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1};
    const int pc[3] = {4, 4, 4}, sc[3] = {3, 3, 2}, dc[4] = {4, 4, 3, 2};
    puffVao = instVao(puffIbo, quad, 6, pc, 3, MAX_PUFF, quadVbo);
    decalVao = instVao(decalIbo, quad, 6, dc, 4, MAX_DECAL, quadVbo);
    sparkVao = instVao(sparkIbo, strip, 6, sc, 3, MAX_SPARK, stripVbo);
    uploadMesh(K_SHARD, shardMesh());
    uploadMesh(K_CHUNK, chunkMesh());
    kinds[K_SHARD].half = {0.5f, 0.06f, 0.5f};
    kinds[K_CHUNK].half = {0.36f, 0.36f, 0.36f};
    std::vector<unsigned char> px;
    const int S = 128;
    puffAtlas(px, S);
    glActiveTexture(GL_TEXTURE5);
    glGenTextures(1, &atlas);
    glBindTexture(GL_TEXTURE_2D, atlas);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, S * 2, S * 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
    glGenerateMipmap(GL_TEXTURE_2D);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 4);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glActiveTexture(GL_TEXTURE0);
    glReady = true;
    return true;
  }
  // This frame's scene depth, copied where the puffs can read it (sampling the buffer being drawn into would be a feedback loop).
  bool grabDepth(int W, int H) {
    if (!soft) return false;
    GLint cur = 0;
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &cur);
    if (cur == 0) return false;                  // the window itself (multisampled): hard edges there
    if (!depthTex || depthW != W || depthH != H) {
      if (!depthTex) { glGenTextures(1, &depthTex); glGenFramebuffers(1, &depthFbo); }
      glActiveTexture(GL_TEXTURE6);
      glBindTexture(GL_TEXTURE_2D, depthTex);
      glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, W, H, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, nullptr);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_MODE, GL_NONE);
      glActiveTexture(GL_TEXTURE0);
      glBindFramebuffer(GL_FRAMEBUFFER, depthFbo);
      glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, depthTex, 0);
      glDrawBuffer(GL_NONE); glReadBuffer(GL_NONE);
      const bool ok = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
      glBindFramebuffer(GL_FRAMEBUFFER, (GLuint)cur);
      if (!ok) { soft = false; return false; }
      depthW = W; depthH = H; softChecked = false;
    }
    if (!softChecked) while (glGetError() != GL_NO_ERROR) {}        // someone else's
    glBindFramebuffer(GL_READ_FRAMEBUFFER, (GLuint)cur);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, depthFbo);
    glBlitFramebuffer(0, 0, W, H, 0, 0, W, H, GL_DEPTH_BUFFER_BIT, GL_NEAREST);
    glBindFramebuffer(GL_FRAMEBUFFER, (GLuint)cur);
    if (!softChecked) {
      softChecked = true;
      if (glGetError() != GL_NO_ERROR) { soft = false; return false; }   // formats refused: stay hard, never broken
    }
    return true;
  }

  // The half-size picture the puffs are drawn into. `cur` is the framebuffer to go back to.
  bool lowTarget(int W, int H, GLuint cur) {
    const int w = (W + 1) / 2, h = (H + 1) / 2;
    if (lowTex && lowW == w && lowH == h) return true;
    if (!lowTex) { glGenTextures(1, &lowTex); glGenFramebuffers(1, &lowFbo); }
    glActiveTexture(GL_TEXTURE7);
    glBindTexture(GL_TEXTURE_2D, lowTex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA16F, w, h, 0, GL_RGBA, GL_HALF_FLOAT, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glActiveTexture(GL_TEXTURE0);
    glBindFramebuffer(GL_FRAMEBUFFER, lowFbo);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, lowTex, 0);
    const bool ok = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
    glBindFramebuffer(GL_FRAMEBUFFER, cur);
    if (!ok) { half = false; return false; }
    glBindFramebuffer(GL_FRAMEBUFFER, lowFbo);
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT);
    glBindFramebuffer(GL_FRAMEBUFFER, cur);
    lowW = w; lowH = h;
    return true;
  }

  // ---- a session ------------------------------------------------------------------
  void clear() {
    for (Puff &p : puffs) p.on = false;
    sparks.clear(); cars.clear(); kicks.clear(); timed.clear(); scorch.clear(); decals.clear();
    for (int k = 0; k < K_N; k++) { for (Body &b : kinds[k].pool) b.on = false; kinds[k].dirty = true; kinds[k].live = 0; }
    boom = 0; scorchNext = 0;
  }
  CarSt &stateFor(const Car *c) {
    for (CarSt &s : cars) if (s.car == c) return s;
    cars.emplace_back();
    cars.back().car = c;
    cars.back().seed = (uint32_t)(cars.size() * 2654435761u) | 1u;
    return cars.back();
  }
  const CarSt *find(const Car *c) const {
    for (const CarSt &s : cars) if (s.car == c) return &s;
    return nullptr;
  }

  void addScorch(V3 p, float size, float sx, float sz) {
    Decal d{{p.x, p.y + 0.035f, p.z}, size, {0.012f, 0.011f, 0.010f}, 0.78f, rng.f() * 6.28f, 0, 0, sx, sz};
    if ((int)scorch.size() < MAX_SCORCH) scorch.push_back(d);
    else { scorch[(size_t)scorchNext] = d; scorchNext = (scorchNext + 1) % MAX_SCORCH; }
  }

  // THE EXPLOSION: a flash, a fireball that goes to soot, a ring of dust along the ground, burning
  // pieces, and a black star on the road. Seen and heard; the car's physics is not told.
  void explode(CarSt &st, V3 c, V3 vel, float gy, const float paint[3], float mass) {
    st.phase = 2; st.wreckT = 0; st.burn = 1;
    const V3 drift = vel * 0.25f;
    static const float W[3] = {1, 1, 1}, HOT[3] = {1.25f, 1.15f, 1.0f};
    PuffOpt f;
    f.flame = true; f.gy = gy; f.col = HOT;
    // the flash: one frame of white, far bigger than the car
    f.size = 3.2f; f.grow = 9; f.life = 0.16f; f.alpha = 1.0f; f.rise = 0; f.drag = 0;
    puff(c + V3{0, 0.6f, 0}, drift, f);
    // the fireball
    f.col = W;
    for (int i = 0; i < 24; i++) {
      const float a = rng.f() * 6.283f, el = rng.f() * 1.35f, sp = 4 + rng.f() * 9;
      f.size = 0.7f + rng.f() * 0.5f; f.grow = 2.6f; f.life = 1.0f + rng.f() * 0.7f; f.alpha = 0.95f; f.rise = 3.5f; f.drag = 3.0f;
      puff(c + V3{rng.c() * 1.2f, 0.3f + rng.f() * 0.8f, rng.c() * 1.2f}, drift + V3{std::cos(a) * std::cos(el) * sp, std::sin(el) * sp + 2, std::sin(a) * std::cos(el) * sp}, f);
    }
    // what the fireball leaves: the black cloud that climbs after it
    PuffOpt s;
    s.col = SOOT; s.gy = gy;
    for (int i = 0; i < 16; i++) {
      const float a = rng.f() * 6.283f, sp = 1 + rng.f() * 4;
      s.size = 1.0f + rng.f() * 0.6f; s.grow = 2.2f; s.life = 5.5f + rng.f() * 2; s.alpha = 0.62f; s.rise = 1.5f; s.drag = 1.6f;
      puff(c + V3{rng.c() * 1.5f, 0.8f + rng.f() * 1.2f, rng.c() * 1.5f}, drift + V3{std::cos(a) * sp, 4 + rng.f() * 5, std::sin(a) * sp}, s);
    }
    // the shock, where it can be seen: dust thrown outward along the ground
    PuffOpt du;
    du.col = DUSTC; du.gy = gy; du.size = 0.7f; du.grow = 2.2f; du.life = 1.7f; du.alpha = 0.34f; du.rise = 0.25f; du.drag = 2.4f;
    for (int i = 0; i < 26; i++) {
      const float a = (i + rng.f()) / 26.0f * 6.283f, sp = 20 + rng.f() * 8;
      puff(V3{c.x + std::cos(a) * 1.6f, gy + 0.3f, c.z + std::sin(a) * 1.6f}, V3{std::cos(a) * sp, 0.6f, std::sin(a) * sp}, du);
    }
    Timed ring; ring.p = {c.x, gy + 0.05f, c.z}; ring.life = 0.5f; ring.r0 = 2; ring.r1 = 19; ring.shape = 1; ring.alpha = 0.34f;
    ring.col[0] = 0.80f; ring.col[1] = 0.76f; ring.col[2] = 0.70f;
    ring.sx = st.sx; ring.sz = st.sz;
    timed.push_back(ring);
    Timed glow; glow.p = {c.x, gy + 0.06f, c.z}; glow.life = 0.7f; glow.r0 = 16; glow.r1 = 22; glow.shape = 0; glow.emis = 2.6f;
    glow.col[0] = 1.0f; glow.col[1] = 0.62f; glow.col[2] = 0.28f;
    glow.sx = st.sx; glow.sz = st.sz;
    timed.push_back(glow);
    spark(300, c + V3{0, 0.4f, 0}, drift + V3{0, 3, 0}, gy, 26, 16, 1.3f, 1.4f);
    // pieces. One impulse, shared out by weight: the light ones go furthest.
    for (int i = 0; i < 14; i++) {
      Body &b = alloc(K_CHUNK);
      const float sz = 0.10f + rng.f() * rng.f() * 0.34f;
      b.scale = {sz * (0.8f + rng.f() * 1.4f), sz * (0.5f + rng.f() * 0.6f), sz * (0.8f + rng.f() * 0.9f)};
      const float m = 0.3f + 90 * sz * sz * sz * 8;                    // 0.4 kg .. about 7
      shape(b, kinds[K_CHUNK].half, m, 0.9f);
      b.pos = c + V3{rng.c() * 1.6f, 0.3f + rng.f() * 0.6f, rng.c() * 1.0f};
      b.q = qAxis(norm({rng.c(), rng.c(), rng.c() + 0.01f}), rng.f() * 6.3f);
      const float a = rng.f() * 6.283f, el = 0.25f + rng.f() * 1.0f;
      const float sp = std::min(30.0f, (28 + rng.f() * 40) / m + 5);   // 28-68 N s each
      b.vel = drift + V3{std::cos(a) * std::cos(el), std::sin(el), std::sin(a) * std::cos(el)} * sp;
      b.w = V3{rng.c(), rng.c(), rng.c()} * 30.0f;
      const bool paintOn = rng.f() < 0.35f;
      b.col = paintOn ? V3{paint[0], paint[1], paint[2]} : V3{0.05f, 0.05f, 0.055f};
      b.burn = 0.55f + rng.f() * 0.45f;
      b.e = 0.25f; b.mu = 0.6f;
      b.flameT = rng.f() < 0.6f ? 1.2f + rng.f() * 2.5f : 0;
    }
    shards(30, c + V3{0, 0.4f, 0}, drift + V3{0, 4, 0}, paint, 0.13f, 22, 12, 0.3f, 0.7f);
    addScorch(V3{c.x, gy, c.z}, 5.2f, st.sx, st.sz);
    // how loud, by how far (EngineAudio::hit takes a closing speed; 14 m/s is its loudest)
    float fade = 1;
    if (haveEye) fade = clampf(1 - std::hypot(c.x - eye[0], c.z - eye[2]) / 260.0f, 0, 1);
    boom = std::max(boom, (double)(8 + 34 * fade * fade) * (fade > 0.02f ? 1 : 0));
    (void)mass;
  }
};

// ---------------------------------------------------------------------------
Fx::Fx() : d(new Impl) {}
Fx::~Fx() { delete d; }

double Fx::testSeconds() {
  if (!std::getenv("XBR_FXTEST") && !std::getenv("XBR_FXCRASH")) return 0;
  const char *t = std::getenv("XBR_FXT");
  const double v = t ? std::atof(t) : 2.0;
  return v > 0 ? std::min(v, 120.0) : 0.02;
}

double Fx::takeBoom() { const double b = d->boom; d->boom = 0; return b; }

void Fx::forget(const Car &car) {
  for (size_t i = 0; i < d->cars.size(); i++) if (d->cars[i].car == &car) { d->cars.erase(d->cars.begin() + (long)i); break; }
}

int Fx::phaseOf(const Car &car) const {
  const CarSt *st = d->find(&car);
  return st ? st->phase : 0;
}

void Fx::tint(const Car &car, float paint[3]) const {
  const CarSt *st = d->find(&car);
  if (!st || st->burn <= 0) return;
  if (paint[0] < 0) { paint[0] = 0.78f; paint[1] = 0.06f; paint[2] = 0.08f; }      // the house red (render.cpp)
  const float k = std::min(1.0f, st->burn) * 0.94f;
  const float soot[3] = {0.030f, 0.027f, 0.025f};
  for (int i = 0; i < 3; i++) paint[i] += (soot[i] - paint[i]) * k;
}

void Fx::begin(const void *session, const Track &track, const World *world, const Terrain *terrain, const Spec &spec) {
  Impl &I = *d;
  if (session != I.session) { I.clear(); I.session = session; }
  I.track = &track; I.world = world; I.terrain = terrain; I.spec = &spec;
  I.cutMeshes(spec);
  I.kicks.clear();
  I.callIx = 0;
}

void Fx::car(const Car &car, const Proj &proj, const float paint[3], bool mine, double dtd) {
  Impl &I = *d;
  if (!I.track || !I.terrain || !car.spec) return;
  const auto c0 = std::chrono::steady_clock::now();
  const float dt = (float)std::min(dtd, 0.05);
  const Spec &S = *car.spec;
  Rng &rng = I.rng;
  CarSt &st = I.stateFor(&car);

  const float sy = (float)I.terrain->h(proj.s, proj.lat);
  I.terrain->under(car, proj, st.gnd);
  const float gp = car.airborne ? 0.0f : (float)st.gnd.pitch, gr = car.airborne ? 0.0f : (float)st.gnd.roll;
  const Mat4 M = Mat4::translate((float)car.x, sy + (float)std::max(0.0, car.z), (float)-car.y) * Mat4::rotY((float)car.hdg)
               * Mat4::rotZ(gp + (float)car.pitch) * Mat4::rotX(gr + (float)car.roll);
  auto at = [&](float lx, float up, float lz) { return xf(M, lx, up, lz); };
  const float cs = (float)std::cos(car.hdg), sn = (float)std::sin(car.hdg);
  const float vwx = (float)(car.vx * cs - car.vy * sn), vwy = (float)(car.vx * sn + car.vy * cs);
  const V3 vel{vwx, (float)car.vz, -vwy};
  const V3 pos = at(0, 0, 0);
  const float speed = (float)car.speed;
  const float hl = (float)S.bodyL * 0.5f, hw = (float)S.bodyW * 0.5f;
  const float crush[4] = {(float)car.crushFront, (float)car.crushRear, (float)car.crushLeft, (float)car.crushRight};
  const bool lostF = car.hasLost && car.lostFrontWing, lostR = car.hasLost && car.lostRearWing;
  const float col[3] = {paint[0] < 0 ? 0.78f : paint[0], paint[0] < 0 ? 0.06f : paint[1], paint[0] < 0 ? 0.08f : paint[2]};
  const bool gt = S.gt || S.key == "gt3";
  double Wp[4][2];
  wheelPos(S, Wp);

  if (!st.seen) {
    // FIRST SIGHT: whatever state the car is in is not news. A car that joins already hurt must not explode at load.
    st.seen = true;
    for (int k = 0; k < 4; k++) { st.crush[k] = crush[k]; st.wl[k] = car.wheelLost[k]; }
    st.lostF = lostF; st.lostR = lostR; st.air = car.airborne;
    st.velPrev = vel; st.posPrev = pos; st.speedPrev = speed; st.dmg = car.damage;
    Rng r2; r2.s = st.seed * 747796405u + 2891336453u; r2.f();
    st.fuse = FUSE_MIN + r2.f() * FUSE_VAR;
  }
  I.kicks.push_back({(float)car.x, (float)-car.y, cs, sn, vel.x, vel.z, speed, (float)S.m});
  // the staged effects go to your car, or (XBR_FXCAR=n) to the n-th car of the field
  I.spawnHint = proj.i;
  const bool tMe = I.test && (I.testCar >= 0 ? I.callIx == I.testCar : mine);
  I.callIx++;
  const bool near = mine || tMe || I.nearEye(pos);
  {
    // the road's slope under the car, in the world's axes: what lies flat on it has to lie along it
    const float gs = ((float)I.terrain->h(proj.s + 2, proj.lat) - sy) * 0.5f, gl = ((float)I.terrain->h(proj.s, proj.lat + 2) - sy) * 0.5f;
    const float ch = (float)std::cos(proj.hdg), sh = (float)std::sin(proj.hdg);
    st.sx = gs * ch - gl * sh; st.sz = -(gs * sh + gl * ch); st.gy = sy;
  }

  // ---- was that an impact, and how much of one -------------------------------------
  // A teleport (a reset, a rejoin, a pit-lane release) changes the velocity too: it is one if the car is
  // not where its own speed could have taken it.
  const bool teleport = len(pos - st.posPrev) > std::max(st.speedPrev, speed) * dt * 1.6f + 2.0f;
  const float dv = teleport ? 0 : len(vel - st.velPrev);
  bool crushUp = false;
  for (int k = 0; k < 4; k++) if (crush[k] > st.crush[k] + 0.004f) crushUp = true;
  // (a car being PLACED - on the grid, in its garage, at rest - also loses its speed in one frame, but
  // ends with none at all; a car that has hit something is still moving)
  const bool impact = !teleport && (car.damage > st.dmg + 1e-6 || crushUp || (dv > DV_IMPACT && len(vel) > 1.0f));
  const float E = impact ? 0.5f * (float)S.m * dv * dv : 0;
  // repaired (a pit stop, a reset): the fire is out, the paint is paint again
  if ((car.damage < st.dmg - 0.05 || (st.phase && car.damage < 0.02)) && !tMe) { st.phase = 0; st.heat = 0; st.burnT = 0; st.burn = 0; st.wreckT = 0; st.out = false; }
  // moved by hand (craned away, wheeled into its garage, put back on the road): the marshals have put it out
  if (teleport && st.phase) { st.out = true; if (st.phase == 1) { st.phase = 2; st.wreckT = 99; } }
  st.heat = st.heat * std::exp(-dt / HEAT_MEMORY) + E;
  st.dmg = car.damage; st.velPrev = vel; st.posPrev = pos; st.speedPrev = speed;

  // ---- impacts: the crush went up somewhere (js/fx.js) -------------------------------
  for (int k = 0; k < 4; k++) {
    const float was = st.crush[k], now = crush[k], dc = now - was;
    if (dc <= 0.012f) { if (dc < 0) st.crush[k] = now; continue; }
    st.crush[k] = now;
    const float side = rng.f() < 0.5f ? -1.0f : 1.0f;
    const V3 p = k == 0 ? at(hl * 0.87f, 0.2f, side * 0.5f * rng.f()) : k == 1 ? at(-hl * 0.85f, 0.45f, side * 0.4f * rng.f())
                        : at(rng.c(), 0.35f, k == 2 ? -hw * 0.85f : hw * 0.85f);
    I.shards(std::min(36, (int)std::lround(4 + dc * 70)), p, vel, col, 0.07f + dc * 0.1f, 2 + dc * 8, 1.5f + dc * 5);
    if (speed > 3 || dc > 0.1f) I.spark(std::min(160, (int)std::lround(dc * 320)), p, V3{vel.x * 0.6f, 0.5f, vel.z * 0.6f}, sy, 4 + dc * 12, 2 + dc * 6, 0.6f);
    // a big hit throws up a cloud: concrete dust, tyre-wall rubber, carbon
    if (dc > 0.1f && near) {
      PuffOpt o; o.size = 0.4f; o.grow = 1.8f; o.life = 2.8f; o.alpha = 0.22f; o.col = CONCRETE; o.rise = 0.3f; o.gy = sy;
      for (int i = 0; i < std::min(14, (int)(3 + dc * 30)); i++) I.puff(p, V3{vel.x * 0.2f + rng.c() * 4, 0.5f + rng.f() * 1.5f, vel.z * 0.2f + rng.c() * 4}, o);
    }
  }

  // ---- whole wings: they LEAVE, as the meshes they were --------------------------------
  auto wing = [&](int kind, float kick) {
    KindGL &K = I.kinds[kind];
    if (I.meshV[kind].empty()) return;
    Body &b = I.alloc(kind);
    b.pos = at(K.c0.x, K.c0.y, K.c0.z);
    b.q = qFromMat(M);
    // what a wing weighs: the front of a single-seater 9 kg (5 on the small car), its rear wing 8 (5); the coupe's splitter 6, its wing 9
    const float m = kind == K_FW ? (gt ? 6.0f : S.key == "f4" ? 5.0f : 9.0f) : (gt ? 9.0f : S.key == "f4" ? 5.0f : 8.0f);
    I.shape(b, K.half, m, 1.0f);
    // most of the car's speed, some of it lost in the breaking; the tearing is an impulse, so a lighter wing leaves faster
    const float side = rng.f() < 0.5f ? -1.0f : 1.0f;
    const V3 right = rot(b.q, V3{0, 0, 1});
    b.vel = vel * (0.55f + rng.f() * 0.35f) + right * (side * (8 + rng.f() * 20) / m * kick);
    b.vel.y += (12 + rng.f() * 26) / m * kick;
    b.w = V3{rng.c() * 14, rng.c() * 9, rng.c() * 14} * kick;
    b.col = {col[0], col[1], col[2]};
    b.e = 0.22f; b.mu = 0.5f;
  };
  if (lostF && !st.lostF) {
    wing(K_FW, 1);
    const V3 p = at(hl * 0.85f, 0.15f, 0);
    I.shards(26, p, vel, col, 0.1f, 5, 3);
    I.spark(60, p, V3{vel.x * 0.6f, 0.5f, vel.z * 0.6f}, sy, 6, 3);
  }
  st.lostF = lostF;                                   // a new nose, at the pit stop
  if (lostR && !st.lostR) {
    wing(K_RW, 1.1f);
    I.shards(18, at(-hl * 0.87f, 0.8f, 0), vel, col, 0.09f, 4, 3);
  }
  st.lostR = lostR;

  // ---- a wheel comes off: 11 kg of it (22 on the coupe), bouncing and rolling as far as its speed takes it
  auto wheel = [&](int i, V3 extra) {
    const int kind = i < 2 ? K_WF : K_WR;
    KindGL &K = I.kinds[kind];
    if (I.meshV[kind].empty()) return;
    Body &b = I.alloc(kind);
    const float R = std::max(0.15f, K.half.y), whw = std::max(0.06f, K.half.z);
    b.pos = at((float)Wp[i][0], R, (float)-Wp[i][1]);
    b.q = qFromMat(M);
    const float m = (gt ? 22.0f : S.key == "f4" ? 9.0f : 11.0f) + (i < 2 ? 0.0f : 1.5f);
    I.wheelShape(b, R, whw, m);
    const float out = Wp[i][1] > 0 ? -1.0f : 1.0f;    // away from the car: its left is -z here
    const V3 axle = rot(b.q, V3{0, 0, 1}), fwd = rot(b.q, V3{1, 0, 0});
    // THE SEPARATION KICK: 55-90 N s outward and half of it up, whatever the wheel weighs
    const float J = 55 + rng.f() * 35;
    b.vel = vel + axle * (out * J / m) + V3{0, J * 0.55f / m, 0} + extra;
    // it leaves still turning at the speed it was rolling
    b.w = axle * (-dot(vel, fwd) / R) + V3{rng.c() * 2.5f, rng.c() * 2.5f, rng.c() * 2.5f};
    b.col = {col[0], col[1], col[2]};
    I.spark(40, b.pos, V3{vel.x * 0.6f, 0.5f, vel.z * 0.6f}, sy, 5, 3);
    I.shards(8, b.pos, vel, col, 0.06f, 3, 2.5f, 0.1f);
  };
  for (int i = 0; i < 4; i++) {
    if (car.wheelLost[i] && !st.wl[i]) wheel(i, V3{});
    st.wl[i] = car.wheelLost[i];
    // the corner it left is on the road: the upright and the brake disc, ground away
    if (car.wheelLost[i] && speed > 2 && !car.airborne && near) {
      st.acc[8 + i] += speed * 9 * dt;
      const int n = (int)st.acc[8 + i]; st.acc[8 + i] -= (float)n;
      if (n) I.spark(n, at((float)Wp[i][0], 0.04f, (float)-Wp[i][1]), vel * 0.8f, sy, 2.2f, 1.8f, 0.5f);
    }
  }

  // ---- sparks: bodywork on a wall ------------------------------------------------------
  const bool tSparks = tMe && (I.test & Impl::T_SPARKS);
  if ((car.wallTouch || tSparks) && (speed > 4 || tSparks) && near) {
    const float sgn = proj.lat < 0 ? -1.0f : 1.0f;
    // which end of that side is in the wall: the one further out
    float best = hl * 0.9f, bl = -1;
    for (const float lx : {hl * 0.9f, -hl * 0.9f}) {
      const float ly = sgn * hw;
      const double x = car.x + lx * cs - ly * sn, y = car.y + lx * sn + ly * cs;
      const float l = (float)std::fabs(I.track->project(x, y, proj.i, 8).lat);
      if (l > bl) { bl = l; best = lx; }
    }
    const V3 p = at(best, 0.25f, -sgn * hw);
    const float nx = (float)(sgn * std::sin(proj.hdg)), nz = (float)(sgn * std::cos(proj.hdg));          // off the wall
    const float rub = tSparks ? std::max(speed, 30.0f) : speed;
    st.acc[0] += rub * 7 * dt;
    const int n = (int)st.acc[0]; st.acc[0] -= (float)n;
    const V3 v = tSparks && speed < 4 ? V3{-cs * 25, 0, sn * 25} : vel;
    if (n) I.spark(n, p, V3{v.x * 0.75f + nx * 1.5f, 0.6f, v.z * 0.75f + nz * 1.5f}, sy, 2.5f, 2.2f, 0.5f);
  }

  // ---- sparks: the plank and skid blocks -------------------------------------------------
  // Bumps are properties of PLACES, so the same patch sparks every lap: a bin of track every 6 m is
  // either a bump or not, fixed by a hash. Single-seaters only: a coupe has no titanium under it.
  if (!gt && !car.airborne && (speed > 42 || tSparks)) {
    const int bin = (int)std::floor(proj.s / 6);
    if (bin != st.bin || tSparks) {
      st.bin = bin;
      const float h = hash1((float)bin);
      const bool brake = car.brake > 0.4 && speed > 55, kerb = car.surface > 0.9 && car.surface < 0.95;
      if ((h > 0.9f || (brake && h > 0.55f) || (kerb && h > 0.3f) || (tSparks && rng.f() < 0.5f)) && near) {
        const int n = (int)std::lround(6 + (std::max(speed, 42.0f) - 40) * 0.35f + (kerb ? 8 : 0));
        const V3 v = tSparks && speed < 4 ? V3{-cs * 30, 0, sn * 30} : vel;
        for (const float lx : {-1.5f, -0.6f, 0.3f}) {
          if (rng.f() < 0.35f) continue;
          V3 p = at(lx, 0.02f, rng.c() * 0.4f);
          p.y = sy + 0.02f;
          I.spark((n + 2) / 3, p, V3{v.x * 0.72f, 0.3f, v.z * 0.72f}, sy, 1.8f, 1.1f + speed * 0.012f, 0.45f, 0.9f);
        }
      }
    }
  }
  // ---- sparks: a landing, a car on its roof, a broken nose on the road ---------------------
  if (st.air && !car.airborne && speed > 3) {
    V3 p = at(-0.5f, 0.02f, 0);
    p.y = sy + 0.02f;
    I.spark(50, p, V3{vel.x * 0.7f, 0.5f, vel.z * 0.7f}, sy, 5, 3, 0.6f);
    I.shards(6, p, vel, col, 0.06f, 3, 2);
  }
  st.air = car.airborne;
  if (car.onRoof && speed > 1.5f && near) {
    V3 p = at(-0.2f, 0.84f, 0);
    p.y = sy + 0.03f;
    st.acc[1] += speed * 12 * dt;
    const int n = (int)st.acc[1]; st.acc[1] -= (float)n;
    if (n) I.spark(n, p, V3{vel.x * 0.8f, 0.5f, vel.z * 0.8f}, sy, 3, 2.5f, 0.55f);
  }
  if (lostF && crush[0] > 0.78f && speed > 12 && !car.airborne && rng.f() < 0.25f && near) {
    V3 p = at(hl * 0.8f, 0.05f, 0);
    p.y = sy + 0.02f;
    I.spark(2, p, V3{vel.x * 0.8f, 0.2f, vel.z * 0.8f}, sy, 1.5f, 1, 0.35f);
  }

  // ---- what burns ---------------------------------------------------------------------
  if (tMe && !st.tested) {
    st.tested = true;
    if (I.test & Impl::T_FIRE) { st.phase = 1; st.burnT = 0; st.fuse = 1e9f; }
    if (I.test & Impl::T_EXPLODE) I.explode(st, at(0, 0.5f, 0), vel, sy, col, (float)S.m);
    if (I.test & Impl::T_WRECK) { st.phase = 2; st.wreckT = 9; st.burn = 1; I.addScorch(V3{pos.x, sy, pos.z}, 5.2f, st.sx, st.sz); }
    if (I.test & Impl::T_WHEEL) { const V3 f = at(1, 0, 0) - pos; wheel(0, f * 7.0f); wheel(3, f * 11.0f); }
    if (I.test & Impl::T_WING) {
      const V3 f = at(1, 0, 0) - pos;
      const size_t a = I.kinds[K_FW].pool.size(), b = I.kinds[K_RW].pool.size();
      wing(K_FW, 1); wing(K_RW, 1.1f);
      for (size_t i = 0; i < a; i++) if (I.kinds[K_FW].pool[i].on && I.kinds[K_FW].pool[i].born == I.t) I.kinds[K_FW].pool[i].vel = I.kinds[K_FW].pool[i].vel + f * 9.0f;
      for (size_t i = 0; i < b; i++) if (I.kinds[K_RW].pool[i].on && I.kinds[K_RW].pool[i].born == I.t) I.kinds[K_RW].pool[i].vel = I.kinds[K_RW].pool[i].vel + f * 13.0f;
      I.shards(26, at(hl * 0.85f, 0.3f, 0), vel + f * 8.0f, col, 0.1f, 5, 3);
    }
  }
  if (st.phase == 0) {
    if (E >= E_BOOM || st.heat >= E_BOOM_SUM) {
      std::fprintf(stderr, "fx: EXPLOSION - a %.0f kg car took %.2f MJ (%.0f m/s in one frame, %.2f MJ within %.0f s)\n", S.m, E / 1e6, dv, st.heat / 1e6, HEAT_MEMORY);
      I.explode(st, at(0, 0.5f, 0), vel, sy, col, (float)S.m);
    } else if ((car.damage >= DMG_FIRE && st.heat >= E_FIRE) || (car.damage >= DMG_HURT && st.heat >= E_FIRE_HURT)) {
      st.phase = 1; st.burnT = 0;
      std::fprintf(stderr, "fx: FIRE - a %.0f kg car took %.2f MJ (%.0f m/s in one frame, %.2f MJ within %.0f s), damage %.2f\n", S.m, E / 1e6, dv, st.heat / 1e6, HEAT_MEMORY, car.damage);
    }
  } else if (st.phase == 1) {
    st.burnT += dt;
    st.burn = std::min(0.8f, st.burnT / 9.0f);
    if (st.burnT > st.fuse || E >= E_BOOM || st.heat >= E_BOOM_SUM) {
      std::fprintf(stderr, "fx: EXPLOSION - after %.1f s alight (%.2f MJ within %.0f s)\n", st.burnT, st.heat / 1e6, HEAT_MEMORY);
      I.explode(st, at(0, 0.5f, 0), vel, sy, col, (float)S.m);
    }
  } else st.wreckT += dt;

  // the engine: behind the driver of a single-seater, under the bonnet of the coupe
  const float engX = gt ? hl * 0.56f : -hl * 0.44f, engY = gt ? 0.86f : 0.66f;
  float fire = 0;                                     // 0..1: how much of the car is alight
  if (st.out) fire = 0;
  else if (st.phase == 1) fire = 0.3f + 0.7f * std::min(1.0f, st.burnT / 3.5f);
  else if (st.phase == 2) fire = st.wreckT < 6 ? 1.0f : std::max(0.0f, 1 - (st.wreckT - 6) / 26.0f);
  st.at = at(engX * 0.5f, 0.4f, 0); st.gy = sy;
  st.flick = fire;
  if (fire > 0 && near) {
    static const float W[3] = {1, 1, 1};
    // where it burns: the engine first, then along the flanks, then all of it
    const float seat[4][3] = {{engX, engY, 0}, {gt ? 0.1f : -0.25f, gt ? 0.95f : 0.50f, -hw * 0.72f}, {gt ? 0.1f : -0.25f, gt ? 0.95f : 0.50f, hw * 0.72f},
                              {gt ? -hl * 0.6f : hl * 0.42f, gt ? 0.8f : 0.36f, 0}};
    const float from[4] = {0.0f, 0.42f, 0.42f, 0.72f}, share[4] = {1.0f, 0.55f, 0.55f, 0.6f};
    // AT SPEED the air tears a flame off almost as it forms: short, small, streaming back along the
    // car. (Left as they are, they hang in the wake and the chase camera drives through a wall of fire.)
    const float wind = 1 / (1 + speed / 22.0f), carry = 0.75f + 0.17f * (1 - wind);
    for (int k = 0; k < 4; k++) {
      if (fire <= from[k]) continue;
      const float lvl = std::min(1.0f, (fire - from[k]) / 0.3f) * share[k];
      st.acc[4 + k] += 30 * lvl * dt;
      int n = (int)st.acc[4 + k]; st.acc[4 + k] -= (float)n;
      while (n-- > 0) {
        PuffOpt o;
        o.flame = true; o.col = W; o.gy = sy - 0.3f;
        o.size = (0.22f + 0.14f * lvl) * (0.6f + 0.4f * wind); o.grow = (0.85f + 0.5f * lvl) * (0.5f + 0.5f * wind); o.life = (0.55f + 0.3f * lvl) * (0.3f + 0.7f * wind);
        o.alpha = 0.95f; o.rise = 4.2f * wind; o.drag = 2.0f;
        const V3 p = at(seat[k][0] + rng.c() * 0.7f, seat[k][1] + rng.c() * 0.15f, seat[k][2] + rng.c() * 0.35f);
        I.puff(p, V3{vel.x * carry + rng.c() * 0.9f, (1.4f + rng.f() * 1.6f) * wind, vel.z * carry + rng.c() * 0.9f}, o);
      }
    }
    // the column: black, thick at the root, leaning with what little wind there is
    st.acc[12] += (5 + 7 * fire) * dt;
    int n = (int)st.acc[12]; st.acc[12] -= (float)n;
    while (n-- > 0) {
      PuffOpt o;
      o.col = SOOT; o.gy = sy; o.size = 0.45f; o.grow = 1.25f; o.life = 5.5f; o.alpha = (0.50f + 0.14f * fire) * (0.45f + 0.55f * wind); o.rise = 1.7f; o.drag = 1.8f;
      I.puff(at(engX + rng.c() * 0.8f, engY + 0.7f + rng.f() * 0.5f, rng.c() * 0.5f), V3{vel.x * 0.5f + rng.c() * 0.6f, 2.2f + rng.f() * 1.2f, vel.z * 0.5f + rng.c() * 0.6f}, o);
    }
    // embers
    if (speed < 15 && rng.f() < 7 * fire * dt) I.spark(1 + (int)(rng.f() * 2), at(engX + rng.c(), engY + 0.3f, rng.c() * 0.6f), V3{vel.x * 0.5f, 3.5f + rng.f() * 3, vel.z * 0.5f}, sy, 2.2f, 2.5f, 1.3f, 0.8f);
  }
  // a wreck goes on smoking for as long as it sits there
  if (st.phase == 2 && !st.out && near) {
    const float thick = st.wreckT < 30 ? 1.0f : std::max(0.45f, 1 - (st.wreckT - 30) / 120.0f);
    st.acc[13] += 3.2f * thick * dt;
    int n = (int)st.acc[13]; st.acc[13] -= (float)n;
    const float grey = smooth(20, 90, st.wreckT) * 0.16f;
    const float c2[3] = {SOOT[0] + grey, SOOT[1] + grey, SOOT[2] + grey};
    while (n-- > 0) {
      PuffOpt o;
      o.col = c2; o.gy = sy; o.size = 0.5f; o.grow = 1.2f; o.life = 6.0f; o.alpha = 0.34f + 0.16f * thick; o.rise = 1.3f; o.drag = 1.8f;
      I.puff(at(rng.c() * hl * 1.1f, 0.7f + rng.f() * 0.4f, rng.c() * 0.6f), V3{vel.x * 0.5f + rng.c() * 0.5f, 1.3f + rng.f(), vel.z * 0.5f + rng.c() * 0.5f}, o);
    }
  }

  // ---- a wounded car smokes: oil on hot metal, thicker and darker with the damage -------------
  if (car.damage > 0.5 && !car.airborne && st.phase == 0 && near) {
    const float dmg = (float)car.damage;
    st.acc[7] += (dmg - 0.5f) * 60 * dt;
    int n = (int)st.acc[7]; st.acc[7] -= (float)n;
    const float dk = 0.34f - 0.24f * smooth(0.6f, 1.0f, dmg);
    const float oil[3] = {dk, dk, dk + 0.02f};
    while (n-- > 0) {
      PuffOpt o;
      o.col = oil; o.gy = sy; o.size = 0.25f; o.grow = 1.1f; o.life = 2.5f; o.alpha = 0.10f + 0.25f * (dmg - 0.5f) + 0.25f * smooth(0.75f, 1.0f, dmg); o.rise = 0.7f;
      I.puff(at(engX, engY - 0.04f, rng.c() * 0.3f), V3{vel.x * 0.35f, 0.6f + rng.f() * 0.4f, vel.z * 0.35f}, o);
    }
  }

  // ---- tyre smoke and dust ------------------------------------------------------------------
  const unsigned tSm = tMe ? (I.test & (Impl::T_SMOKE | Impl::T_DUST)) : 0;
  if ((car.airborne && !tSm) || !near) { I.cpuMs += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - c0).count(); return; }
  const float pk = S.pk > 0 ? (float)S.pk : 0.13f;
  const float surf = (tSm & Impl::T_DUST) ? 0.58f : (float)car.surface;
  const bool off = surf < 0.9f;
  struct TyreSmoke { float size, grow, life, alpha, carry, rise; const float *col; };
  auto emit = [&](int slot, float rate, int wi, const TyreSmoke &o) {
    if (car.wheelLost[wi]) return;                   // no tyre, no tyre smoke
    // HALF the browser game's puffs, each a little bigger and thicker: the same cloud, and half the
    // pixels to fill on a small GPU
    st.acc[slot] += rate * 0.5f * dt;
    int n = (int)st.acc[slot]; st.acc[slot] -= (float)n;
    while (n-- > 0) {
      V3 p = at((float)Wp[wi][0], 0.12f, (float)-Wp[wi][1]);
      p.y = sy + 0.18f + rng.f() * 0.1f;
      PuffOpt q; q.size = o.size * 1.15f; q.grow = o.grow * 1.1f; q.life = o.life; q.alpha = std::min(0.6f, o.alpha * 1.55f); q.col = o.col; q.rise = o.rise; q.gy = sy;
      I.puff(p, V3{vel.x * o.carry + rng.c() * 1.6f, 0.25f + rng.f() * 0.6f, vel.z * o.carry + rng.c() * 1.6f}, q);
    }
  };
  // rubber: sliding past the peak, a locked front, a spinning rear
  const float overR = (float)std::fabs(car.slipR) / pk - 1, overF = (float)std::fabs(car.slipF) / pk - 1;
  if (!off) {
    if (overR > 0 && speed > 6) {
      const float r = std::min(40.0f, overR * 30);
      const TyreSmoke o{0.35f, 1.5f, 3, I.wetK(0.12f + 0.2f * std::min(1.0f, overR)), 0.12f, 0.45f, RUBBER};
      emit(2, r, 2, o); emit(3, r, 3, o);
    }
    if (car.lock && speed > 4) {
      const TyreSmoke o{0.3f, 1.4f, 2.6f, I.wetK(0.28f), 0.1f, 0.45f, RUBBER};
      emit(14, 26, 0, o); emit(15, 26, 1, o);
    } else if (overF > 0.4f && speed > 8) {
      const TyreSmoke o{0.3f, 1.3f, 2.2f, I.wetK(0.1f), 0.12f, 0.45f, RUBBER};
      emit(14, overF * 12, 0, o); emit(15, overF * 12, 1, o);
    }
    if ((car.wheelspin && car.throttle > 0.3) || (tSm & Impl::T_SMOKE)) {
      const TyreSmoke o{0.4f, 1.7f, 3.2f, I.wetK(0.32f), 0.05f, 0.45f, RUBBER};
      emit(2, 30, 2, o); emit(3, 30, 3, o);
      if (tSm & Impl::T_SMOKE) { emit(14, 26, 0, o); emit(15, 26, 1, o); }
    }
  } else if (speed > 5 || tSm) {
    // dust off the gravel and the grass, from every wheel, more the faster
    const bool gravel = surf > 0.5f;
    const TyreSmoke o{gravel ? 0.45f : 0.35f, gravel ? 2.0f : 1.4f, gravel ? 3.5f : 2.2f, (gravel ? 0.26f : 0.13f) * (1 - 0.85f * I.wet), 0.25f, 0.25f,
                      gravel ? GRAVEL : EARTH};
    const float r = std::min(26.0f, std::max(speed, tSm ? 30.0f : 0.0f) * (gravel ? 0.6f : 0.3f));
    emit(14, r, 0, o); emit(15, r, 1, o); emit(2, r, 2, o); emit(3, r, 3, o);
  }
  I.cpuMs += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - c0).count();
}

void Fx::end(double dtd) {
  Impl &I = *d;
  if (!I.track) return;
  const auto c0 = std::chrono::steady_clock::now();
  const float dt = (float)std::min(dtd, 0.05);
  I.t += dt;
  I.bodies(dt);

  // ---- puffs (js/smoke.js): the air takes the speed off quickly, then it drifts up and spreads
  const float windX = 0.55f, windZ = 0.30f;           // m/s: enough that a column leans
  for (Puff &p : I.puffs) {
    if (!p.on) continue;
    p.age += dt;
    if (p.age >= p.life) { p.on = false; continue; }
    const float k = std::max(0.0f, 1 - p.drag * dt);
    p.vx *= k; p.vz *= k;
    p.vy = p.vy * std::max(0.0f, 1 - 1.5f * dt) + p.rise * dt;
    const float w = p.flame ? 0.3f : std::min(1.0f, p.age * 0.5f);
    p.x += (p.vx + windX * w) * dt; p.y += p.vy * dt; p.z += (p.vz + windZ * w) * dt;
    p.rot += p.spin * dt;
  }
  // ---- sparks (js/sparks.js)
  size_t j = 0;
  for (size_t i = 0; i < I.sparks.size(); i++) {
    Spark s = I.sparks[i];
    s.life -= dt;
    if (s.life <= 0) continue;
    s.vy -= G * dt;
    const float drag = std::max(0.0f, 1 - 1.1f * dt);
    s.vx *= drag; s.vy *= drag; s.vz *= drag;
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    if (s.y < s.gy && s.vy < 0) {                     // it skips off the road, losing most of its bounce and some life
      s.y = s.gy; s.vy = -s.vy * (0.25f + I.rng.f() * 0.2f); s.vx *= 0.7f; s.vz *= 0.7f; s.life *= 0.8f;
    }
    I.sparks[j++] = s;
  }
  I.sparks.resize(j);

  // ---- what lies on the ground this frame
  I.decals.clear();
  for (const Decal &s : I.scorch) I.decals.push_back(s);
  for (size_t i = 0; i < I.timed.size();) {
    Timed &m = I.timed[i];
    m.age += dt;
    if (m.age >= m.life) { I.timed[i] = I.timed.back(); I.timed.pop_back(); continue; }
    const float k = m.age / m.life, e = 1 - (1 - k) * (1 - k);
    Decal dc{{m.p.x, m.p.y, m.p.z}, m.r0 + (m.r1 - m.r0) * e, {m.col[0], m.col[1], m.col[2]}, m.alpha * (1 - k), 0, (float)m.shape, m.emis * (1 - k) * (1 - k), m.sx, m.sz};
    I.decals.push_back(dc);
    i++;
  }
  // the light of a fire on the road under it, flickering
  for (CarSt &s : I.cars) {
    if (s.flick <= 0.01f || (int)I.decals.size() >= MAX_DECAL) continue;
    const float ph = (float)I.t * 11.0f + (float)(s.seed % 97);
    const float fl = 0.72f + 0.16f * std::sin(ph) + 0.12f * std::sin(ph * 2.7f + 1.3f) + 0.08f * (I.rng.f() - 0.5f);
    I.decals.push_back(Decal{{s.at.x, s.gy + 0.04f, s.at.z}, 3.2f + 3.6f * s.flick, {1.0f, 0.50f, 0.16f}, 0, 0, 0, 0.55f * s.flick * fl, s.sx, s.sz});
  }
  // a piece off the ground has a shadow under it: the cheapest thing that says how high it is
  for (int kd = 0; kd < K_N; kd++) {
    if (kd == K_SHARD) continue;
    for (const Body &b : I.kinds[kd].pool) {
      if (!b.on || (int)I.decals.size() >= MAX_DECAL - 8 || !I.nearEye(b.pos, 140)) continue;
      const float lo = b.wheel ? (b.asleep ? b.hw : b.R) : std::min({b.half.x, b.half.y, b.half.z});
      const float hgt = std::max(0.0f, b.pos.y - b.gy - lo);
      const float sz = (b.wheel ? b.R * 1.25f : std::max(b.half.x, b.half.z) * 1.15f) * (1 + 0.35f * hgt);
      if (sz < 0.08f) continue;
      I.decals.push_back(Decal{{b.pos.x, b.gy + 0.02f, b.pos.z}, sz, {0, 0, 0}, 0.46f / (1 + 1.6f * hgt), 0, 0, 0.0001f, 0, 0});
    }
  }
  I.cpuMs += std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - c0).count();
  if (I.timing) {
    int np = 0, nb = 0;
    for (const Puff &p : I.puffs) np += p.on;
    for (int k = 0; k < K_N; k++) nb += I.kinds[k].live;
    static int said = 0;
    if ((said++ % 30) == 0) std::fprintf(stderr, "fx: update %.3f ms  (%d puffs, %zu sparks, %d pieces, %zu marks)\n", I.cpuMs, np, I.sparks.size(), nb, I.decals.size());
  }
  I.cpuMs = 0;
}

void Fx::draw(const Renderer &R, double time) {
  Impl &I = *d;
  for (int k = 0; k < 3; k++) I.eye[k] = R.curEye[k];
  I.haveEye = true;
  I.wet = R.curLook.wet;
  if (!I.track) return;
  // nothing alive: nothing bound, nothing drawn
  int nPuff = 0, nBody = 0;
  for (const Puff &p : I.puffs) nPuff += p.on;
  for (int k = 0; k < K_N; k++) nBody += I.kinds[k].live;
  if (!nPuff && !nBody && I.sparks.empty() && I.decals.empty()) return;
  if (!I.glReady) { if (I.glTried || !I.initGL()) return; }

  GLint prevProg = 0, prevVao = 0, prevTex = 0;
  glGetIntegerv(GL_CURRENT_PROGRAM, &prevProg);
  glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &prevVao);
  glGetIntegerv(GL_ACTIVE_TEXTURE, &prevTex);
  if (I.meshDirty) { for (int k = 0; k < 4; k++) I.uploadMesh(k, I.meshV[k]); I.meshDirty = false; }

  const Mat4 &VP = R.curVP;
  const Look &L = R.curLook;
  // the camera's own axes, out of the matrix: its rows are right, up and (the fourth) forward
  V3 cr = norm({VP.m[0], VP.m[4], VP.m[8]}), cu = norm({VP.m[1], VP.m[5], VP.m[9]});
  const V3 cf{VP.m[3], VP.m[7], VP.m[11]};
  const float projX = len(V3{VP.m[0], VP.m[4], VP.m[8]}), projY = len(V3{VP.m[1], VP.m[5], VP.m[9]});
  const float zA = -(VP.m[2] * cf.x + VP.m[6] * cf.y + VP.m[10] * cf.z), zB = VP.m[14] + zA * VP.m[15];
  const V3 sun = norm({L.sun[0], L.sun[1], L.sun[2]});
  const V3 eye{R.curEye[0], R.curEye[1], R.curEye[2]};

  // ---- the puffs, sorted back to front (alpha smoke drawn in the wrong order shows hard dark edges
  // where one cuts another), and the box on the screen that holds all of them
  float bx0 = 1, by0 = 1, bx1 = -1, by1 = -1;
  if (nPuff) {
    I.order.clear();
    for (int i = 0; i < MAX_PUFF; i++) {
      Puff &p = I.puffs[(size_t)i];
      if (!p.on) continue;
      p.key = (p.x - eye.x) * cf.x + (p.y - eye.y) * cf.y + (p.z - eye.z) * cf.z;
      I.order.push_back(i);
    }
    std::sort(I.order.begin(), I.order.end(), [&](int a, int b) { return I.puffs[(size_t)a].key > I.puffs[(size_t)b].key; });
    I.pbuf.clear();
    // where on the screen they are, all of them together: nothing outside it is cleared or laid over
    bx0 = 1; by0 = 1; bx1 = -1; by1 = -1;
    for (const int i : I.order) {
      const Puff &p = I.puffs[(size_t)i];
      const float tt = p.age / p.life;
      const float size = p.s0 + p.grow * std::pow(p.age, 0.65f);
      {
        const float cw = VP.m[3] * p.x + VP.m[7] * p.y + VP.m[11] * p.z + VP.m[15];
        if (cw < size * 1.5f + 0.2f) { if (cw > -size * 1.5f) { bx0 = by0 = -1; bx1 = by1 = 1; } }
        else {
          const float cx = (VP.m[0] * p.x + VP.m[4] * p.y + VP.m[8] * p.z + VP.m[12]) / cw, cy = (VP.m[1] * p.x + VP.m[5] * p.y + VP.m[9] * p.z + VP.m[13]) / cw;
          const float rx = size * 1.42f * projX / cw, ry = size * 2.0f * projY / cw;      // (a flame is drawn taller than its size)
          bx0 = std::min(bx0, cx - rx); bx1 = std::max(bx1, cx + rx); by0 = std::min(by0, cy - ry); by1 = std::max(by1, cy + ry);
        }
      }
      // in fast, a long thinning tail
      const float a = p.flame ? p.a * std::min(1.0f, p.age / 0.04f) * std::pow(1 - tt, 0.7f) : p.a * std::min(1.0f, p.age / 0.08f) * std::pow(1 - tt, 1.6f);
      const float v[12] = {p.x, p.y, p.z, p.gy, size, p.rot, a, (float)p.tile, p.r, p.g, p.b, p.flame ? 2 - tt : 0.0f};
      I.pbuf.insert(I.pbuf.end(), v, v + 12);
    }
  }
  // none of them in the picture (a lock-up three corners back): no depth copy, no draw
  const bool puffVis = nPuff && bx1 > bx0 && by1 > by0 && bx0 < 1 && bx1 > -1 && by0 < 1 && by1 > -1;

  const int reps = I.timing ? 12 : 1;
  std::chrono::steady_clock::time_point g0;
  for (int rep = 0; rep < reps; rep++) {
    if (I.timing && rep == 2) { glFinish(); g0 = std::chrono::steady_clock::now(); }

    glEnable(GL_DEPTH_TEST); glDepthFunc(GL_LEQUAL); glDepthMask(GL_TRUE);
    glDisable(GL_BLEND); glDisable(GL_CULL_FACE);

    // ---- the pieces
    if (nBody) {
      glUseProgram(I.partProg);
      glUniformMatrix4fv(glGetUniformLocation(I.partProg, "uVP"), 1, GL_FALSE, VP.m);
      glUniform3f(glGetUniformLocation(I.partProg, "uEye"), eye.x, eye.y, eye.z);
      glUniform3f(glGetUniformLocation(I.partProg, "uSun"), sun.x, sun.y, sun.z);
      glUniform3fv(glGetUniformLocation(I.partProg, "uSunCol"), 1, L.sunCol);
      glUniform3fv(glGetUniformLocation(I.partProg, "uSkyAmb"), 1, L.skyAmb);
      glUniform3fv(glGetUniformLocation(I.partProg, "uGndAmb"), 1, L.gndAmb);
      glUniform3fv(glGetUniformLocation(I.partProg, "uFog"), 1, L.fog);
      glUniform1f(glGetUniformLocation(I.partProg, "uFogK"), L.fogK);
      for (int kd = 0; kd < K_N; kd++) {
        KindGL &K = I.kinds[kd];
        if (!K.live || !K.verts) continue;
        glBindVertexArray(K.vao);
        if (K.dirty) {
          K.dirty = false;
          I.buf.clear();
          K.live = 0;
          for (const Body &b : K.pool) {
            if (!b.on) continue;
            K.live++;
            const float fade = b.small ? clampf((SHARD_LIFE - (float)(I.t - b.born)) / SHARD_FADE, 1e-4f, 1) : 1;
            const float v[14] = {b.pos.x, b.pos.y, b.pos.z, b.q.x, b.q.y, b.q.z, b.q.w, b.scale.x * fade, b.scale.y * fade, b.scale.z * fade,
                                 b.col.x, b.col.y, b.col.z, b.burn};
            I.buf.insert(I.buf.end(), v, v + 14);
          }
          glBindBuffer(GL_ARRAY_BUFFER, K.ibo);
          glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(I.buf.size() * sizeof(float)), I.buf.data());
        }
        glDrawArraysInstanced(GL_TRIANGLES, 0, K.verts, K.live);
      }
    }

    const bool softNow = puffVis && I.grabDepth(R.W, R.H);

    glDepthMask(GL_FALSE);
    glEnable(GL_BLEND);
    glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);         // premultiplied: alpha hides, colour adds

    // ---- marks on the ground
    if (!I.decals.empty()) {
      glUseProgram(I.decalProg);
      glUniformMatrix4fv(glGetUniformLocation(I.decalProg, "uVP"), 1, GL_FALSE, VP.m);
      glUniform3f(glGetUniformLocation(I.decalProg, "uEye"), eye.x, eye.y, eye.z);
      glUniform3fv(glGetUniformLocation(I.decalProg, "uFog"), 1, L.fog);
      glUniform1f(glGetUniformLocation(I.decalProg, "uFogK"), L.fogK);
      I.buf.clear();
      const size_t n = std::min<size_t>(I.decals.size(), MAX_DECAL);
      for (size_t i = 0; i < n; i++) {
        const Decal &dc = I.decals[i];
        const float v[13] = {dc.pos[0], dc.pos[1], dc.pos[2], dc.size, dc.col[0], dc.col[1], dc.col[2], dc.alpha, dc.rot, dc.shape, dc.emis, dc.sx, dc.sz};
        I.buf.insert(I.buf.end(), v, v + 13);
      }
      glBindVertexArray(I.decalVao);
      glBindBuffer(GL_ARRAY_BUFFER, I.decalIbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(I.buf.size() * sizeof(float)), I.buf.data());
      glEnable(GL_POLYGON_OFFSET_FILL);
      glPolygonOffset(-2.0f, -6.0f);
      glDrawArraysInstanced(GL_TRIANGLES, 0, 6, (GLsizei)n);
      glDisable(GL_POLYGON_OFFSET_FILL);
    }

    // ---- puffs: at half size where the depth copy allows, and laid over the picture
    if (puffVis) {
      glUseProgram(I.puffProg);
      glUniformMatrix4fv(glGetUniformLocation(I.puffProg, "uVP"), 1, GL_FALSE, VP.m);
      glUniform3f(glGetUniformLocation(I.puffProg, "uEye"), eye.x, eye.y, eye.z);
      glUniform3f(glGetUniformLocation(I.puffProg, "uR"), cr.x, cr.y, cr.z);
      glUniform3f(glGetUniformLocation(I.puffProg, "uU"), cu.x, cu.y, cu.z);
      glUniform3f(glGetUniformLocation(I.puffProg, "uF"), cf.x, cf.y, cf.z);
      glUniform3f(glGetUniformLocation(I.puffProg, "uSunV"), dot(sun, cr), dot(sun, cu), -dot(sun, cf));
      glUniform3f(glGetUniformLocation(I.puffProg, "uSunW"), sun.x, sun.y, sun.z);
      // the scene's numbers are display values: a puff lit at the full sun would be paper white and bloom
      glUniform3f(glGetUniformLocation(I.puffProg, "uSun"), L.sunCol[0] * 0.50f, L.sunCol[1] * 0.50f, L.sunCol[2] * 0.50f);
      glUniform3f(glGetUniformLocation(I.puffProg, "uAmb"), (L.skyAmb[0] + L.gndAmb[0]) * 0.5f, (L.skyAmb[1] + L.gndAmb[1]) * 0.5f, (L.skyAmb[2] + L.gndAmb[2]) * 0.5f);
      glUniform3fv(glGetUniformLocation(I.puffProg, "uFog"), 1, L.fog);
      glUniform1f(glGetUniformLocation(I.puffProg, "uFogK"), L.fogK);
      GLint cur = 0;
      glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &cur);
      const bool low = softNow && I.half && I.lowTarget(R.W, R.H, (GLuint)cur);
      const int tw = low ? I.lowW : R.W, th = low ? I.lowH : R.H;
      // the box in pixels of the target, a pixel wider all round for the filter
      const int sx0 = std::max(0, (int)std::floor((clampf(bx0, -1, 1) * 0.5f + 0.5f) * tw) - 1), sy0 = std::max(0, (int)std::floor((clampf(by0, -1, 1) * 0.5f + 0.5f) * th) - 1);
      const int sx1 = std::min(tw, (int)std::ceil((clampf(bx1, -1, 1) * 0.5f + 0.5f) * tw) + 1), sy1 = std::min(th, (int)std::ceil((clampf(by1, -1, 1) * 0.5f + 0.5f) * th) + 1);
      if (low) {
        glBindFramebuffer(GL_FRAMEBUFFER, I.lowFbo);
        glViewport(0, 0, tw, th);
        glEnable(GL_SCISSOR_TEST);
        // cleared two texels wider than what is drawn and laid over: the filter reads one past the edge,
        // and what is there is whatever the last frame (or nobody) left
        glScissor(sx0 - 2, sy0 - 2, std::max(0, sx1 - sx0) + 4, std::max(0, sy1 - sy0) + 4);
        glClearColor(0, 0, 0, 0);
        glClear(GL_COLOR_BUFFER_BIT);
        glScissor(sx0, sy0, std::max(0, sx1 - sx0), std::max(0, sy1 - sy0));
        glDisable(GL_DEPTH_TEST);                        // there is no depth buffer here: the shader asks the copy
      }
      glUniform1f(glGetUniformLocation(I.puffProg, "uSoft"), softNow ? 1.0f : 0.0f);
      glUniform1f(glGetUniformLocation(I.puffProg, "uZA"), zA);
      glUniform1f(glGetUniformLocation(I.puffProg, "uZB"), zB);
      glUniform1f(glGetUniformLocation(I.puffProg, "uFire"), R.post ? 1.0f : 0.62f);
      glUniform2f(glGetUniformLocation(I.puffProg, "uRes"), (float)tw, (float)th);
      glUniform1i(glGetUniformLocation(I.puffProg, "uMap"), 5);
      glUniform1i(glGetUniformLocation(I.puffProg, "uDepth"), 6);
      glActiveTexture(GL_TEXTURE5); glBindTexture(GL_TEXTURE_2D, I.atlas);
      glActiveTexture(GL_TEXTURE6); glBindTexture(GL_TEXTURE_2D, softNow ? I.depthTex : I.atlas);
      glBindVertexArray(I.puffVao);
      glBindBuffer(GL_ARRAY_BUFFER, I.puffIbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(I.pbuf.size() * sizeof(float)), I.pbuf.data());
      glDrawArraysInstanced(GL_TRIANGLES, 0, 6, (GLsizei)I.order.size());
      if (low) {
        // and over the picture, stretched back to its size
        glBindFramebuffer(GL_FRAMEBUFFER, (GLuint)cur);
        glViewport(0, 0, R.W, R.H);
        glScissor(sx0 * 2, sy0 * 2, std::max(0, sx1 - sx0) * 2, std::max(0, sy1 - sy0) * 2);
        glUseProgram(I.compProg);
        glUniform1i(glGetUniformLocation(I.compProg, "uTex"), 7);
        glActiveTexture(GL_TEXTURE7); glBindTexture(GL_TEXTURE_2D, I.lowTex);
        glDrawArrays(GL_TRIANGLES, 0, 3);
        glDisable(GL_SCISSOR_TEST);
        glEnable(GL_DEPTH_TEST);
      }
    }

    // ---- sparks: brighter than anything else in the picture, so the film blooms on them
    if (!I.sparks.empty()) {
      glBlendFunc(GL_ONE, GL_ONE);
      glUseProgram(I.sparkProg);
      glUniformMatrix4fv(glGetUniformLocation(I.sparkProg, "uVP"), 1, GL_FALSE, VP.m);
      glUniform2f(glGetUniformLocation(I.sparkProg, "uProj"), projX, projY);
      glUniform1f(glGetUniformLocation(I.sparkProg, "uShutter"), SHUTTER);
      glUniform1f(glGetUniformLocation(I.sparkProg, "uWidth"), 0.012f);
      glUniform1f(glGetUniformLocation(I.sparkProg, "uPx"), 1.3f * 2.0f / ((float)std::max(1, R.H) * projY));
      glUniform1f(glGetUniformLocation(I.sparkProg, "uGain"), R.post ? 3.4f : 1.6f);
      I.buf.clear();
      for (const Spark &s : I.sparks) {
        const float v[8] = {s.x, s.y, s.z, s.vx, s.vy, s.vz, s.life / s.max, s.w};
        I.buf.insert(I.buf.end(), v, v + 8);
      }
      glBindVertexArray(I.sparkVao);
      glBindBuffer(GL_ARRAY_BUFFER, I.sparkIbo);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(I.buf.size() * sizeof(float)), I.buf.data());
      glDrawArraysInstanced(GL_TRIANGLES, 0, 6, (GLsizei)I.sparks.size());
    }
  }
  if (I.timing) {
    glFinish();
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - g0).count() / (reps - 2);
    std::fprintf(stderr, "fx: draw %.3f ms a frame at %dx%d (%d puffs, %zu sparks, %d pieces, %zu marks; soft %s, half %s) [drawn %d times over: the picture is brighter than the game's]\n",
                 ms, R.W, R.H, nPuff, I.sparks.size(), nBody, I.decals.size(), I.soft ? "on" : "off", I.half && I.lowTex ? "on" : "off", reps);
  }

  // as it was found: blend off, depth test and writes on
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glDisable(GL_BLEND);
  glDepthMask(GL_TRUE);
  glEnable(GL_DEPTH_TEST);
  glBindBuffer(GL_ARRAY_BUFFER, 0);
  glActiveTexture((GLenum)prevTex);
  glBindVertexArray((GLuint)prevVao);
  glUseProgram((GLuint)prevProg);
  (void)time;
}

}  // namespace xbr
