// render.cpp — see render.hpp.
//
// WHAT THIS IS AND IS NOT. It draws the circuit from the same baked data the
// browser game uses — centreline, widths, run-off, the per-metre surface bake
// (data/surf), and the OSM surroundings (data/env) — as flat-shaded geometry
// with procedural grain. It does not yet draw elevation, banking, PBR textures,
// crowds, pit buildings, the downloaded car or bodywork damage. Those live in
// js/render.js and friends and have not been ported.
#include "render.hpp"
#include "carmesh.hpp"
#include "dress.hpp"

#include <ctime>
#include <epoxy/gl.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MULTIPLE_MASTERS_H

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>

namespace xbr {

// ---------------------------------------------------------------------------
// Mat4 (column-major, as GL wants it)
// ---------------------------------------------------------------------------
Mat4 Mat4::identity() {
  Mat4 r{};
  r.m[0] = r.m[5] = r.m[10] = r.m[15] = 1;
  return r;
}
Mat4 Mat4::operator*(const Mat4 &b) const {
  Mat4 r{};
  for (int c = 0; c < 4; c++)
    for (int rw = 0; rw < 4; rw++) {
      float s = 0;
      for (int k = 0; k < 4; k++) s += m[k * 4 + rw] * b.m[c * 4 + k];
      r.m[c * 4 + rw] = s;
    }
  return r;
}
Mat4 Mat4::perspective(float fovy, float aspect, float zn, float zf) {
  Mat4 r{};
  const float f = 1.0f / std::tan(fovy / 2);
  r.m[0] = f / aspect; r.m[5] = f;
  r.m[10] = (zf + zn) / (zn - zf); r.m[11] = -1;
  r.m[14] = (2 * zf * zn) / (zn - zf);
  return r;
}
Mat4 Mat4::lookAt(const float e[3], const float at[3], const float up[3]) {
  float f[3] = {at[0] - e[0], at[1] - e[1], at[2] - e[2]};
  float fl = std::sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]);
  for (float &x : f) x /= fl;
  float s[3] = {f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]};
  float sl = std::sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
  for (float &x : s) x /= sl;
  const float u[3] = {s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]};
  Mat4 r = identity();
  r.m[0] = s[0]; r.m[4] = s[1]; r.m[8] = s[2];
  r.m[1] = u[0]; r.m[5] = u[1]; r.m[9] = u[2];
  r.m[2] = -f[0]; r.m[6] = -f[1]; r.m[10] = -f[2];
  r.m[12] = -(s[0] * e[0] + s[1] * e[1] + s[2] * e[2]);
  r.m[13] = -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]);
  r.m[14] = f[0] * e[0] + f[1] * e[1] + f[2] * e[2];
  return r;
}
Mat4 Mat4::translate(float x, float y, float z) { Mat4 r = identity(); r.m[12] = x; r.m[13] = y; r.m[14] = z; return r; }
Mat4 Mat4::scale(float x, float y, float z) { Mat4 r = identity(); r.m[0] = x; r.m[5] = y; r.m[10] = z; return r; }
Mat4 Mat4::rotX(float a) { Mat4 r = identity(); const float c = std::cos(a), s = std::sin(a); r.m[5] = c; r.m[6] = s; r.m[9] = -s; r.m[10] = c; return r; }
Mat4 Mat4::rotY(float a) { Mat4 r = identity(); const float c = std::cos(a), s = std::sin(a); r.m[0] = c; r.m[2] = -s; r.m[8] = s; r.m[10] = c; return r; }
Mat4 Mat4::rotZ(float a) { Mat4 r = identity(); const float c = std::cos(a), s = std::sin(a); r.m[0] = c; r.m[1] = s; r.m[4] = -s; r.m[5] = c; return r; }

static void xform(const Mat4 &m, const float p[3], float w, float out[3]) {
  for (int r = 0; r < 3; r++) out[r] = m.m[r] * p[0] + m.m[4 + r] * p[1] + m.m[8 + r] * p[2] + m.m[12 + r] * w;
}

// ---------------------------------------------------------------------------
// MeshB
// ---------------------------------------------------------------------------
void MeshB::vert(double x, double y, double z, double nx, double ny, double nz, const float c[3], float kind) {
  const float a[10] = {(float)x, (float)z, (float)-y, (float)nx, (float)nz, (float)-ny, c[0], c[1], c[2], kind};
  v.insert(v.end(), a, a + 10);
}
void MeshB::tri(const double a[3], const double b[3], const double c[3], const float col[3], float kind) {
  const double u[3] = {b[0] - a[0], b[1] - a[1], b[2] - a[2]}, w[3] = {c[0] - a[0], c[1] - a[1], c[2] - a[2]};
  double n[3] = {u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]};
  const double l = std::sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
  if (l > 1e-12) { n[0] /= l; n[1] /= l; n[2] /= l; } else { n[0] = 0; n[1] = 0; n[2] = 1; }
  vert(a[0], a[1], a[2], n[0], n[1], n[2], col, kind);
  vert(b[0], b[1], b[2], n[0], n[1], n[2], col, kind);
  vert(c[0], c[1], c[2], n[0], n[1], n[2], col, kind);
}
void MeshB::quad(const double a[3], const double b[3], const double c[3], const double d[3], const float col[3], float kind) {
  tri(a, b, c, col, kind);
  tri(a, c, d, col, kind);
}
void MeshB::flat(const double a[3], const double b[3], const double c[3], const double d[3], const float col[3], float kind) {
  const double *p[6] = {a, b, c, a, c, d};
  for (const double *q : p) vert(q[0], q[1], q[2], 0, 0, 1, col, kind);
}
void MeshB::taper(double x0, double hw0, double z00, double z01, double x1, double hw1, double z10, double z11,
                  const float col[3], float kind, double yc) {
  const double A[4][3] = {{x0, yc - hw0, z00}, {x0, yc + hw0, z00}, {x0, yc + hw0, z01}, {x0, yc - hw0, z01}};
  const double B[4][3] = {{x1, yc - hw1, z10}, {x1, yc + hw1, z10}, {x1, yc + hw1, z11}, {x1, yc - hw1, z11}};
  quad(A[0], A[1], A[2], A[3], col, kind);
  quad(B[1], B[0], B[3], B[2], col, kind);
  for (int i = 0; i < 4; i++) {
    const int j = (i + 1) % 4;
    quad(A[j], A[i], B[i], B[j], col, kind);
  }
}
void MeshB::box(double x0, double x1, double y0, double y1, double z0, double z1, const float col[3], float kind) {
  taper(x0, (y1 - y0) / 2, z0, z1, x1, (y1 - y0) / 2, z0, z1, col, kind, (y0 + y1) / 2);
}
void MeshB::beam(const double p0[3], const double p1[3], double thick, const float col[3], float kind) {
  double d[3] = {p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]};
  const double l = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  if (l < 1e-9) return;
  for (double &x : d) x /= l;
  const double ref[3] = {std::fabs(d[2]) > 0.9 ? 1.0 : 0.0, 0, std::fabs(d[2]) > 0.9 ? 0.0 : 1.0};
  double u[3] = {d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]};
  const double ul = std::sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
  for (double &x : u) x /= ul;
  const double w[3] = {d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]};
  const double h = thick / 2;
  double A[4][3], B[4][3];
  const double sg[4][2] = {{-1, -1}, {1, -1}, {1, 1}, {-1, 1}};
  for (int i = 0; i < 4; i++)
    for (int k = 0; k < 3; k++) {
      A[i][k] = p0[k] + (u[k] * sg[i][0] + w[k] * sg[i][1]) * h;
      B[i][k] = p1[k] + (u[k] * sg[i][0] + w[k] * sg[i][1]) * h;
    }
  quad(A[0], A[1], A[2], A[3], col, kind);
  quad(B[1], B[0], B[3], B[2], col, kind);
  for (int i = 0; i < 4; i++) { const int j = (i + 1) % 4; quad(A[j], A[i], B[i], B[j], col, kind); }
}

void GLMesh::upload(const MeshB &b) {
  if (!vao) { glGenVertexArrays(1, &vao); glGenBuffers(1, &vbo); }
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(b.v.size() * sizeof(float)), b.v.data(), GL_STATIC_DRAW);
  const GLsizei st = 10 * sizeof(float);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, st, (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, st, (void *)(3 * sizeof(float)));
  glEnableVertexAttribArray(2); glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, st, (void *)(6 * sizeof(float)));
  glEnableVertexAttribArray(3); glVertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, st, (void *)(9 * sizeof(float)));
  glBindVertexArray(0);
  count = (int)b.count();
}
void GLMesh::draw() const {
  if (!count) return;
  glBindVertexArray(vao);
  glDrawArrays(GL_TRIANGLES, 0, count);
}
void GLMesh::free() {
  if (vbo) glDeleteBuffers(1, &vbo);
  if (vao) glDeleteVertexArrays(1, &vao);
  vao = vbo = 0; count = 0;
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
// kind: 0 plain  1 asphalt  2 grass  3 gravel  4 concrete  5 plaster  6 paint (specular)
//       7 water  8 unlit  9 sky  10 apron (paved run-off)  11 sand
static const char *VS = R"(#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol; layout(location=3) in float aKind;
uniform mat4 uVP, uModel; uniform vec3 uOrigin;
// DAMAGE: a dent is where the car was hit, which way the blow went, how deep
// and how wide (physics Car::dents). The bodywork is pushed in THERE, in the
// vertex shader, so every car on the grid crumples for nothing.
uniform int uNDent; uniform vec4 uDent[8]; uniform vec2 uDentN[8];
out vec3 vW, vN, vC, vT; out float vK;
void main(){
  vec3 p = aPos; float hurt = 0.0;
  for (int i = 0; i < uNDent; i++) {
    float t = distance(vec2(p.x, -p.z), uDent[i].xy) / uDent[i].w;
    if (t < 1.0) {
      float f = (1.0 - t * t); f *= f;
      float d = uDent[i].z * f;
      p.x += uDentN[i].x * d * 0.42; p.z -= uDentN[i].y * d * 0.42;
      p.y -= d * 0.10 * clamp(p.y * 2.0, 0.0, 1.0);
      hurt += d;
    }
  }
  vec4 w = uModel * vec4(p, 1.0); vC = aCol * (1.0 - 0.55 * clamp(hurt * 1.6, 0.0, 1.0)); vW = w.xyz; vT = w.xyz - uOrigin; vN = mat3(uModel) * aNrm; vK = aKind; gl_Position = uVP * w; }
)";
static const char *FS = R"(#version 330 core
in vec3 vW, vN, vC, vT; in float vK;
uniform vec3 uEye, uSun; uniform float uAlpha;
uniform sampler2DArray uCol, uNrm; uniform int uHasTex;
uniform vec3 uSunCol, uSkyAmb, uGndAmb, uFog, uSkyTop, uPaint; uniform float uFogK, uWet;
uniform sampler2DShadow uShadow; uniform mat4 uShVP; uniform float uShOn, uHdr; uniform int uPass;
uniform vec3 uLampPos, uLampDir; uniform float uLampOn, uTime, uCloud, uNight;
out vec4 o;
// how much of the sun reaches this point: four soft looks at the shadow map
float sunVis(vec3 p, vec3 n){
  if (uShOn < 0.5) return 1.0;
  vec4 q = uShVP * vec4(p + n * 0.12, 1.0);
  float edge = max(abs(q.x), abs(q.y));
  if (edge >= 1.0 || abs(q.z) >= 1.0) return 1.0;
  vec3 s = q.xyz * 0.5 + 0.5; s.z -= 0.0006;
  float t = 0.85 / 2048.0;
  float v = texture(uShadow, s + vec3(-t, -t, 0.0)) + texture(uShadow, s + vec3(t, -t, 0.0))
          + texture(uShadow, s + vec3(-t, t, 0.0)) + texture(uShadow, s + vec3(t, t, 0.0));
  return mix(v * 0.25, 1.0, smoothstep(0.82, 1.0, edge));
}
#define FOG uFog
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  if (uPass == 1) { o = vec4(0.0); return; }      // the shadow map wants depth and nothing else
  int k = int(vK + 0.5);
  if (k == 9) {
    vec3 sky = mix(uFog, uSkyTop, vC.r);
    if (uHdr > 0.5) {
      vec3 d = normalize(vW - uEye);
      // stars, where the sky is dark enough to have them
      if (uNight > 0.5 && d.y > 0.02) {
        vec2 sp = d.xz / (d.y + 0.35) * 190.0;
        float st = hash(floor(sp));
        float tw = 0.75 + 0.25 * sin(uTime * 2.0 + st * 80.0);
        sky += vec3(0.85, 0.9, 1.0) * step(0.9925, st) * smoothstep(0.75, 0.2, length(fract(sp) - 0.5) * 2.0) * tw * 1.6 * (1.0 - uCloud);
      }
      // the sun itself (at night, the moon), and the glare round it: brighter than white, so the film blooms
      float sd = max(dot(d, uSun), 0.0);
      sky += uSunCol * (pow(sd, 2200.0) * 14.0 + pow(sd, 90.0) * 0.55 + pow(sd, 9.0) * 0.16) * (1.0 - 0.8 * uCloud);
      // CLOUDS: a layer overhead, drifting, lit from the sun's side and grey underneath
      if (d.y > 0.0) {
        vec2 uv = d.xz / (d.y + 0.12) * 1.15 + vec2(uTime * 0.006, uTime * 0.0025);
        float f = vnoise(uv) * 0.5 + vnoise(uv * 2.03 + 7.1) * 0.25 + vnoise(uv * 4.01 + 3.7) * 0.125 + vnoise(uv * 8.1) * 0.0625;
        float cov = mix(0.56, 0.16, uCloud);
        float a = smoothstep(cov, cov + 0.26, f) * smoothstep(0.0, 0.16, d.y);
        float thick = smoothstep(cov + 0.10, cov + 0.55, f);
        vec3 lit = uSunCol * (0.42 + 0.30 * pow(sd, 4.0)) + uSkyAmb * 0.95;
        vec3 shade = uSkyAmb * 0.70 + uFog * 0.18;
        sky = mix(sky, mix(lit, shade, thick * (0.55 + 0.4 * uCloud)), a * 0.94);
      }
    }
    o = vec4(sky, 1.0); return;
  }
  if (k == 8) { o = vec4(vC * (uHdr > 0.5 ? 1.0 + (0.35 + 1.5 * uNight) * max(max(vC.r, vC.g), vC.b) : 1.0), uAlpha); return; }      // a lamp: bright enough to bloom
  vec3 V = uEye - vW; float dist = length(V); V /= dist;
  vec3 n = normalize(vN); if (dot(n, V) < 0.0) n = -n;
  vec3 c = vC;
  if (k == 12) c = uPaint * (vC.r / 0.78);      // the car's paint: whichever team's
  // Grain you can see moving is most of what makes 210 km/h feel like 210.
  // The fine layer fades with distance, or it turns to shimmer.
  float near = clamp(1.0 - dist / 140.0, 0.0, 1.0);
  // The photographs, at their true size: UVs are METRES, measured from an
  // origin that follows the camera so they stay small numbers on a long lap.
  float layer = -1.0, size = 1.0; vec3 ref = vec3(1.0);
  // `ref` is each photograph's own mean colour (measured): the picture gives
  // the grain, the vertex colour gives the shade.
  if (k == 1) { layer = 0.0; size = 4.0; ref = vec3(0.446, 0.448, 0.454); }
  else if (k == 2) { layer = 1.0; size = 3.0; ref = vec3(0.397, 0.517, 0.171); }
  else if (k == 3) { layer = 2.0; size = 2.0; ref = vec3(0.854, 0.840, 0.810); }
  else if (k == 4) { layer = 3.0; size = 3.0; ref = vec3(0.634, 0.596, 0.529); }
  else if (k == 5) { layer = 4.0; size = 4.0; ref = vec3(0.745, 0.749, 0.729); }
  else if (k == 10) { layer = 5.0; size = 4.0; ref = vec3(0.471); }
  else if (k == 11) { layer = 6.0; size = 2.0; ref = vec3(0.801, 0.728, 0.584); }
  if (uHasTex == 1 && layer >= 0.0) {
    bool flat_ = abs(n.y) > 0.5;
    vec2 uv = (flat_ ? vT.xz : vec2(vT.x + vT.z, vT.y)) / size;
    vec3 t = texture(uCol, vec3(uv, layer)).rgb;
    // a second look at the same photograph, much larger, breaks up the tiling
    vec3 big = texture(uCol, vec3(uv * 0.125 + 0.31, layer)).rgb;
    t *= 0.6 + 0.4 * dot(big, vec3(0.333)) / dot(ref, vec3(0.333));
    c = vC * t / ref;
    vec3 nm = texture(uNrm, vec3(uv, layer)).xyz * 2.0 - 1.0;
    if (flat_) n = normalize(n + vec3(nm.x, 0.0, -nm.y) * 0.7 * near);
  } else if (k == 1 || k == 10) {
    float g = vnoise(vW.xz * 0.35) * 0.45 + vnoise(vW.xz * 3.1) * 0.30 + hash(floor(vW.xz * 45.0)) * 0.25 * near;
    c *= 0.84 + 0.30 * g;
  } else if (k == 2 && uHasTex == 0) {
    float g = vnoise(vW.xz * 0.05) * 0.40 + vnoise(vW.xz * 0.7) * 0.35 + hash(floor(vW.xz * 18.0)) * 0.25 * near;
    c *= 0.74 + 0.48 * g;
  } else if (k == 7) {
    c *= 0.86 + 0.22 * vnoise(vW.xz * 0.08) + 0.08 * vnoise(vW.xz * 0.9);
  } else if ((k == 3 || k == 11) && uHasTex == 0) {
    float g = vnoise(vW.xz * 1.2) * 0.4 + hash(floor(vW.xz * 22.0)) * 0.6 * near + 0.3 * (1.0 - near);
    c *= 0.80 + 0.36 * g;
  }
  float ndl = max(dot(n, uSun), 0.0);
  // WET: tarmac darkens as it soaks and starts to mirror the sky at a glance
  float shine = 0.0;
  if (uWet > 0.0 && (k == 1 || k == 10 || k == 4) && n.y > 0.5) {
    c *= 1.0 - 0.38 * uWet;
    shine = uWet * pow(1.0 - max(dot(n, V), 0.0), 4.0);
  }
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y * 0.5 + 0.5);
  float vis = sunVis(vW, normalize(vN) * (dot(normalize(vN), uSun) < 0.0 ? -1.0 : 1.0));
  vec3 lit = c * (amb + uSunCol * ndl * 0.78 * vis);
  if (uHdr > 1.5) { o = vec4(vec3(vis * 0.5), 1.0); return; }
  // YOUR HEADLIGHTS: a cone from the nose, falling off with distance
  if (uLampOn > 0.0) {
    vec3 ld = vW - uLampPos; float d2 = dot(ld, ld); vec3 ln = ld * inversesqrt(max(d2, 1e-4));
    float ca = dot(ln, uLampDir);
    // a bright core down the road, and a wide soft pool that reaches the verges
    float cone = smoothstep(0.86, 0.985, ca) + 0.38 * smoothstep(0.35, 0.92, ca);
    if (cone > 0.0) lit += c * vec3(1.0, 0.95, 0.84) * cone * (0.34 + 0.66 * max(dot(n, -ln), 0.0)) * 4.6 / (1.0 + d2 * 0.0026) * uLampOn;
  }
  lit = mix(lit, uFog * 1.05, shine * 0.75);
  if (uWet > 0.0 && shine > 0.0) { vec3 hw = normalize(uSun + V); lit += uSunCol * pow(max(dot(n, hw), 0.0), 90.0) * uWet * 0.9 * vis; }
  if (k == 6 || k == 12) {
    vec3 h = normalize(uSun + V);
    if (uHdr > 0.5) {
      // PAINT UNDER LACQUER: the sky mirrored more the flatter you look along
      // the panel, and the sun as a hard point far brighter than white
      float ndv = max(dot(n, V), 0.0);
      vec3 R = reflect(-V, n);
      vec3 sky = mix(uFog, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.6)) * (R.y < 0.0 ? 0.35 : 1.0);
      float fr = 0.05 + 0.95 * pow(1.0 - ndv, 5.0);
      lit = mix(lit, sky * 1.15, fr * 0.6);
      lit += uSunCol * (pow(max(dot(n, h), 0.0), 320.0) * 5.0 + pow(max(dot(n, h), 0.0), 40.0) * 0.25) * vis;
    } else {
      lit += vec3(1.0) * pow(max(dot(n, h), 0.0), 48.0) * 0.55;
      lit += FOG * 0.10 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
    }
  } else if (uHdr > 0.5 && (k == 1 || k == 10) && n.y > 0.5) {
    // worn tarmac glares back at a low sun, when you look along it
    vec3 h = normalize(uSun + V);
    lit += uSunCol * pow(max(dot(n, h), 0.0), 55.0) * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 1.6 * vis;
  }
  float f = 1.0 - exp(-dist * uFogK);
  o = vec4(mix(lit, FOG, f), uAlpha);
}
)";
// ---- the look: developing the picture -----------------------------------------------
// One triangle over the whole screen. The scene's numbers are display values
// (the colours were authored by eye); they are squared-up to light here, the
// film curve is applied to light, and the result goes back to display values.
static const char *PVS = R"(#version 330 core
out vec2 vU;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vU = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }
)";
// what is brighter than paper white, at a quarter of the size: the source of the bloom
static const char *BRIGHT_FS = R"(#version 330 core
in vec2 vU; uniform sampler2D uTex; uniform vec2 uPx, uK; uniform float uExp; out vec4 o;
vec3 lin(vec2 u){ vec3 c = max(texture(uTex, min(u * uK, uK - uPx * 0.5)).rgb, 0.0); return min(pow(c, vec3(2.2)) * uExp, vec3(12.0)); }
void main(){
  vec3 c = (lin(vU + uPx * vec2(-1, -1)) + lin(vU + uPx * vec2(1, -1)) + lin(vU + uPx * vec2(-1, 1)) + lin(vU + uPx * vec2(1, 1))) * 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(c * smoothstep(0.85, 1.6, l), 1.0);
}
)";
static const char *BLUR_FS = R"(#version 330 core
in vec2 vU; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec3 c = texture(uTex, vU).rgb * 0.227027;
  c += (texture(uTex, vU + uDir * 1.384615).rgb + texture(uTex, vU - uDir * 1.384615).rgb) * 0.316216;
  c += (texture(uTex, vU + uDir * 3.230769).rgb + texture(uTex, vU - uDir * 3.230769).rgb) * 0.070270;
  o = vec4(c, 1.0);
}
)";
static const char *COMP_FS = R"(#version 330 core
in vec2 vU; uniform sampler2D uTex, uBloom; uniform float uExp, uSharp; uniform vec2 uK, uPx; out vec4 o;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 u = min(vU * uK, uK - uPx * 0.5);
  vec3 c = max(texture(uTex, u).rgb, 0.0);
  if (uSharp > 0.0) {
    // drawn smaller than the window: give back the edge the enlargement softened
    vec3 n = texture(uTex, u + vec2(uPx.x, 0.0)).rgb + texture(uTex, u - vec2(uPx.x, 0.0)).rgb
           + texture(uTex, u + vec2(0.0, uPx.y)).rgb + texture(uTex, u - vec2(0.0, uPx.y)).rgb;
    c = max(c + (c - n * 0.25) * uSharp, 0.0);
  }
  c = pow(c, vec3(2.2)) * uExp;                       // display value -> light
  c += texture(uBloom, vU).rgb * 0.20;
  c = aces(c * 1.05);
  // the grade: shadows a little cool, highlights a little warm, colour a little richer
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.96);
  c *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.96), smoothstep(0.0, 0.7, l));
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  c = c * 0.975 + 0.012;                              // film never quite reaches black
  o = vec4(c, dot(c, vec3(0.299, 0.587, 0.114)));     // luma rides in alpha for the anti-aliasing
}
)";
// FXAA (the short form), then the lens: a vignette and a grain you only notice if it is missing
static const char *FXAA_FS = R"(#version 330 core
in vec2 vU; uniform sampler2D uTex; uniform vec2 uPx; uniform float uTime; out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec4 m = texture(uTex, vU);
  float lNW = texture(uTex, vU + uPx * vec2(-1, -1)).a, lNE = texture(uTex, vU + uPx * vec2(1, -1)).a;
  float lSW = texture(uTex, vU + uPx * vec2(-1, 1)).a, lSE = texture(uTex, vU + uPx * vec2(1, 1)).a, lM = m.a;
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec3 c = m.rgb;
  if (lMax - lMin > max(0.03, lMax * 0.10)) {
    vec2 d = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
    d = clamp(d / (min(abs(d.x), abs(d.y)) + red), vec2(-8.0), vec2(8.0)) * uPx;
    vec4 a = 0.5 * (texture(uTex, vU + d * (1.0 / 3.0 - 0.5)) + texture(uTex, vU + d * (2.0 / 3.0 - 0.5)));
    vec4 b = a * 0.5 + 0.25 * (texture(uTex, vU + d * -0.5) + texture(uTex, vU + d * 0.5));
    c = (b.a < lMin || b.a > lMax) ? a.rgb : b.rgb;
  }
  vec2 v = vU - 0.5;
  c *= 1.0 - 0.34 * smoothstep(0.30, 0.95, length(v * vec2(1.0, 0.82)) * 1.35);
  c += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * 0.012;
  o = vec4(c, 1.0);
}
)";
static const char *HVS = R"(#version 330 core
layout(location=0) in vec2 aPos; layout(location=1) in vec2 aUv; layout(location=2) in vec4 aCol;
uniform vec2 uSize; out vec4 vC; out vec2 vU;
void main(){ vC = aCol; vU = aUv; gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0); }
)";
static const char *HFS = R"(#version 330 core
in vec4 vC; in vec2 vU; uniform sampler2D uTex; out vec4 o; void main(){ o = vec4(vC.rgb, vC.a * texture(uTex, vU).r); }
)";

static GLuint compile(GLenum type, const char *src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[2048];
    glGetShaderInfoLog(s, sizeof log, nullptr, log);
    std::fprintf(stderr, "shader compile failed:\n%s\n", log);
    return 0;
  }
  return s;
}
static GLuint link(const char *vs, const char *fs) {
  const GLuint v = compile(GL_VERTEX_SHADER, vs), f = compile(GL_FRAGMENT_SHADER, fs);
  if (!v || !f) return 0;
  GLuint p = glCreateProgram();
  glAttachShader(p, v); glAttachShader(p, f);
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) {
    char log[2048];
    glGetProgramInfoLog(p, sizeof log, nullptr, log);
    std::fprintf(stderr, "shader link failed:\n%s\n", log);
    return 0;
  }
  glDeleteShader(v); glDeleteShader(f);
  return p;
}

bool Renderer::init(const std::string &dataDir, const std::string &texDir) {
  loadFonts(dataDir);
  hasTex = loadTextures(texDir);
  if (!hasTex) std::fprintf(stderr, "xbr: no textures in %s (run make) — drawing procedural surfaces\n", texDir.c_str());
  prog = link(VS, FS);
  hudProg = link(HVS, HFS);
  if (!prog || !hudProg) return false;
  uVP = glGetUniformLocation(prog, "uVP");
  uModel = glGetUniformLocation(prog, "uModel");
  uEye = glGetUniformLocation(prog, "uEye");
  uSun = glGetUniformLocation(prog, "uSun");
  uAlpha = glGetUniformLocation(prog, "uAlpha");
  uHasTex = glGetUniformLocation(prog, "uHasTex");
  uSunCol = glGetUniformLocation(prog, "uSunCol"); uSkyAmb = glGetUniformLocation(prog, "uSkyAmb");
  uGndAmb = glGetUniformLocation(prog, "uGndAmb"); uFog = glGetUniformLocation(prog, "uFog");
  uSkyTop = glGetUniformLocation(prog, "uSkyTop"); uFogK = glGetUniformLocation(prog, "uFogK");
  uWet = glGetUniformLocation(prog, "uWet"); uNDent = glGetUniformLocation(prog, "uNDent");
  uDent = glGetUniformLocation(prog, "uDent"); uDentN = glGetUniformLocation(prog, "uDentN");
  uPaint = glGetUniformLocation(prog, "uPaint");
  uOrigin = glGetUniformLocation(prog, "uOrigin");
  uShVP = glGetUniformLocation(prog, "uShVP"); uShOn = glGetUniformLocation(prog, "uShOn");
  uPass = glGetUniformLocation(prog, "uPass"); uHdr = glGetUniformLocation(prog, "uHdr");
  uLampPos = glGetUniformLocation(prog, "uLampPos"); uLampDir = glGetUniformLocation(prog, "uLampDir"); uLampOn = glGetUniformLocation(prog, "uLampOn");
  uTime = glGetUniformLocation(prog, "uTime"); uCloud = glGetUniformLocation(prog, "uCloud"); uNight = glGetUniformLocation(prog, "uNight");
  brightProg = link(PVS, BRIGHT_FS); blurProg = link(PVS, BLUR_FS); compProg = link(PVS, COMP_FS); fxaaProg = link(PVS, FXAA_FS);
  if (!brightProg || !blurProg || !compProg || !fxaaProg) { std::fprintf(stderr, "xbr: the look's shaders did not build - plain picture\n"); post = postOk = false; }
  // the shadow map exists always: the sampler must have something to look at
  glGenTextures(1, &shTex);
  glBindTexture(GL_TEXTURE_2D, shTex);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, 2048, 2048, 0, GL_DEPTH_COMPONENT, GL_FLOAT, nullptr);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_MODE, GL_COMPARE_REF_TO_TEXTURE); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_FUNC, GL_LEQUAL);
  glGenFramebuffers(1, &shFbo);
  glBindFramebuffer(GL_FRAMEBUFFER, shFbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, shTex, 0);
  glDrawBuffer(GL_NONE); glReadBuffer(GL_NONE);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glGenVertexArrays(1, &fsVao);
  glUseProgram(prog);
  glUniform1i(glGetUniformLocation(prog, "uShadow"), 3);
  glUniform1i(glGetUniformLocation(prog, "uCol"), 1);
  glUniform1i(glGetUniformLocation(prog, "uNrm"), 2);
  uHudSize = glGetUniformLocation(hudProg, "uSize");

  glGenVertexArrays(1, &hudVao);
  glGenBuffers(1, &hudVbo);
  glBindVertexArray(hudVao);
  glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void *)(2 * sizeof(float)));
  glEnableVertexAttribArray(2); glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void *)(4 * sizeof(float)));
  glBindVertexArray(0);

  // The sky: a dome that travels with the camera. Its horizon band is the fog
  // colour, so the far ground dissolves into it and there is no edge of the
  // world to see.
  MeshB b;
  const int RINGS = 10, SEG = 24;
  auto pt = [&](int ring, int seg, double p[3], float c[3]) {
    const double el = -0.12 + (PI / 2 + 0.12) * ring / RINGS, az = 2 * PI * seg / SEG;
    p[0] = std::cos(el) * std::cos(az); p[1] = std::cos(el) * std::sin(az); p[2] = std::sin(el);
    const float t = (float)std::pow(std::max(0.0, std::sin(el)), 0.55);
    c[0] = c[1] = c[2] = t;            // the shader mixes horizon and zenith by this
  };
  for (int r = 0; r < RINGS; r++)
    for (int s = 0; s < SEG; s++) {
      double p[4][3]; float c[4][3];
      pt(r, s, p[0], c[0]); pt(r, s + 1, p[1], c[1]); pt(r + 1, s + 1, p[2], c[2]); pt(r + 1, s, p[3], c[3]);
      const int order[6] = {0, 1, 2, 0, 2, 3};
      for (int i : order) b.vert(p[i][0], p[i][1], p[i][2], 0, 0, 1, c[i], 9);
    }
  sky.upload(b);
  dress = new Dress();
  if (!dress->init(dataDir, texDir)) std::fprintf(stderr, "xbr: the photograph shaders did not build — no downloaded cars, no woods\n");
  // XBR_PACK=p911 native/play ...  puts a downloaded car on the grid before there is a menu row for it
  if (const char *pk = std::getenv("XBR_PACK")) if (*pk) setCarPack(pk);
  return true;
}

bool Renderer::setCarPack(const std::string &key) {
  if (key.empty()) { packCar = nullptr; packKey.clear(); return true; }
  const PackCar *pc = dress ? dress->pack(key) : nullptr;
  if (!pc) return false;
  packCar = pc; packKey = key;
  return true;
}

// PPM (P6, 8 bit), as the Makefile writes them.
static bool readPPM(const std::string &path, int &w, int &h, std::vector<unsigned char> &px) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  std::string magic;
  int maxv = 0;
  f >> magic >> w >> h >> maxv;
  if (magic != "P6" || maxv != 255 || w <= 0 || h <= 0) return false;
  f.get();
  px.resize((size_t)w * h * 3);
  f.read((char *)px.data(), (std::streamsize)px.size());
  return (bool)f;
}

bool Renderer::loadTextures(const std::string &texDir) {
  static const char *NAMES[] = {"tarmac", "grass", "gravel", "concrete", "plaster", "apron", "sand"};
  const int N = 7, SZ = 1024;
  unsigned *ids[2] = {&texCol, &texNrm};
  const char *suffix[2] = {"-c.ppm", "-n.ppm"};
  for (int m = 0; m < 2; m++) {
    std::vector<unsigned char> all((size_t)SZ * SZ * 3 * N);
    for (int i = 0; i < N; i++) {
      int w, h;
      std::vector<unsigned char> px;
      if (!readPPM(texDir + "/" + NAMES[i] + suffix[m], w, h, px) || w != SZ || h != SZ) return false;
      std::memcpy(&all[(size_t)i * SZ * SZ * 3], px.data(), px.size());
    }
    glGenTextures(1, ids[m]);
    glActiveTexture(GL_TEXTURE1 + m);
    glBindTexture(GL_TEXTURE_2D_ARRAY, *ids[m]);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage3D(GL_TEXTURE_2D_ARRAY, 0, GL_RGB8, SZ, SZ, N, 0, GL_RGB, GL_UNSIGNED_BYTE, all.data());
    glGenerateMipmap(GL_TEXTURE_2D_ARRAY);
    glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
    glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_S, GL_REPEAT);
    glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_T, GL_REPEAT);
    // sharp to the horizon: this, with metre UVs, is what makes speed readable
    if (epoxy_has_gl_extension("GL_EXT_texture_filter_anisotropic") || epoxy_gl_version() >= 46)
      glTexParameterf(GL_TEXTURE_2D_ARRAY, 0x84FE /* TEXTURE_MAX_ANISOTROPY */, 6.0f);
  }
  glActiveTexture(GL_TEXTURE0);
  return true;
}

void Renderer::shutdown() {
  for (GLMesh *m : {&ground, &sea, &corridor, &decals, &lineMesh, &scenery, &sky, &shadow, &carBody, &carFrontWing,
                    &carRearWing, &carHelmet, &wheelF, &wheelR}) m->free();
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------
static double hash2(double x, double y) {
  const double h = std::sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - std::floor(h);
}

typedef std::array<double, 2> P2;

static double polyArea(const std::vector<P2> &p) {
  double a = 0;
  for (size_t i = 0; i < p.size(); i++) { const P2 &u = p[i], &w = p[(i + 1) % p.size()]; a += u[0] * w[1] - w[0] * u[1]; }
  return a / 2;
}
static bool inPoly(const std::vector<P2> &p, double x, double y) {
  bool in = false;
  for (size_t i = 0, j = p.size() - 1; i < p.size(); j = i++) {
    if ((p[i][1] > y) != (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) in = !in;
  }
  return in;
}
// Ear clipping. OSM footprints are small and often concave; a fan would draw
// roofs over courtyards.
static std::vector<int> earclip(const std::vector<P2> &p) {
  std::vector<int> idx, out;
  const int n = (int)p.size();
  if (n < 3) return out;
  if (polyArea(p) >= 0) for (int i = 0; i < n; i++) idx.push_back(i);
  else for (int i = n - 1; i >= 0; i--) idx.push_back(i);
  auto cross = [&](int a, int b, int c) {
    return (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]);
  };
  int guard = 0;
  while (idx.size() > 3 && guard++ < 8000) {
    bool clipped = false;
    const int m = (int)idx.size();
    for (int i = 0; i < m; i++) {
      const int a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      if (cross(a, b, c) <= 1e-9) continue;
      // STRICTLY inside. A coastline that touches itself has vertices lying on
      // other edges, and counting those as inside leaves no ear to cut.
      bool inside = false;
      for (int k : idx) {
        if (k == a || k == b || k == c) continue;
        if (cross(a, b, k) > 1e-9 && cross(b, c, k) > 1e-9 && cross(c, a, k) > 1e-9) { inside = true; break; }
      }
      if (inside) continue;
      out.insert(out.end(), {a, b, c});
      idx.erase(idx.begin() + i);
      clipped = true;
      break;
    }
    if (clipped) continue;
    // No ear: drop one flat or doubled-back vertex and try again. If there is
    // not even that, stop — a fan over what is left would paint outside the
    // outline, which is how Monaco's harbour once flooded the town.
    for (int i = 0; i < m && !clipped; i++) {
      const int a = idx[(i + m - 1) % m], b = idx[i], c = idx[(i + 1) % m];
      if (std::fabs(cross(a, b, c)) <= 1e-9) { idx.erase(idx.begin() + i); clipped = true; }
    }
    if (!clipped) return out;
  }
  if (idx.size() == 3 && cross(idx[0], idx[1], idx[2]) > 1e-9) out.insert(out.end(), {idx[0], idx[1], idx[2]});
  return out;
}
static std::vector<P2> polyOf(const Json &pts) {
  std::vector<P2> p;
  for (const auto &q : pts.arr) p.push_back({q[(size_t)0].n(), q[(size_t)1].n()});
  // no doubled points: they are zero-length edges and the clipper stalls on them
  std::vector<P2> q;
  for (const auto &v : p)
    if (q.empty() || std::hypot(v[0] - q.back()[0], v[1] - q.back()[1]) > 1e-6) q.push_back(v);
  while (q.size() > 1 && std::hypot(q.front()[0] - q.back()[0], q.front()[1] - q.back()[1]) <= 1e-6) q.pop_back();
  return q;
}

void Renderer::buildWorld(const Track &track, const World &world, const Json &surf, const Json &env, const Line &raceLine) {
  susp.clear();        // a new session: the cars are new cars
  const int n = track.n;
  const int segs = track.open ? n - 1 : n;

  // Is a point on the circuit's own ground (road, run-off, barrier)? Scenery
  // that lands there is left out: nothing may stand where you can drive.
  auto distToTrack = [&](double px, double py, int &best) {
    double bd = 1e300;
    best = 0;
    for (int i = 0; i < n; i += 6) {
      const double d = (track.x[i] - px) * (track.x[i] - px) + (track.y[i] - py) * (track.y[i] - py);
      if (d < bd) { bd = d; best = i; }
    }
    const int c = best;
    for (int k = c - 6; k <= c + 6; k++) {
      const int i = ((k % n) + n) % n;
      const double d = (track.x[i] - px) * (track.x[i] - px) + (track.y[i] - py) * (track.y[i] - py);
      if (d < bd) { bd = d; best = i; }
    }
    return std::sqrt(bd);
  };
  auto onCircuit = [&](double px, double py, double margin) {
    int i;
    const double d = distToTrack(px, py, i);
    return d < track.w[i] + std::max(track.runL[i], track.runR[i]) + margin;
  };

  // ---- surface bake (data/surf), or the same fallback the browser uses
  std::vector<int> runL(n), runR(n), kerb(n, 0);
  const int dfltRun = track.wall == "gravel" ? 0 : 1;
  const bool haveSurf = surf.isObj() && (int)surf["runL"].size() == n;
  for (int i = 0; i < n; i++) {
    runL[i] = haveSurf ? (int)surf["runL"][(size_t)i].n() : dfltRun;
    runR[i] = haveSurf ? (int)surf["runR"][(size_t)i].n() : dfltRun;
    if (haveSurf) kerb[i] = (int)surf["kerb"][(size_t)i].n();
  }
  if (!haveSurf)
    for (const auto &c : track.corners)
      for (double s = c.s0; s <= c.s1; s += track.ds) kerb[track.idx(s)] = 2;

  const float ASPHALT[3] = {0.215f, 0.215f, 0.225f}, WHITE[3] = {0.90f, 0.90f, 0.88f};
  const float GRASS[3] = {0.27f, 0.43f, 0.17f}, VERGE[3] = {0.24f, 0.46f, 0.19f};
  const float RUNCOL[4][3] = {{0.70f, 0.64f, 0.50f}, {0.31f, 0.31f, 0.33f}, {0.27f, 0.43f, 0.17f}, {0.60f, 0.60f, 0.57f}};
  const float RUNKIND[4] = {3, 10, 2, 4};
  const float KRED[3] = {0.78f, 0.15f, 0.17f};
  const float KALT_DEF[3] = {0.93f, 0.93f, 0.92f}, KALT_SPA[3] = {0.90f, 0.75f, 0.12f};
  const float *KALT = track.key == "spa" ? KALT_SPA : KALT_DEF;

  // A point of the circuit: sample i, `lat` metres left of the centreline, z
  // above the SURFACE there — the surveyed height of the road at that sample
  // plus the banking's own shape across it. Each leg is lifted by its own
  // sample, so at a crossover the bridge stays up and the road under it down.
  auto P = [&](int i, double lat, double z, double out[3]) {
    const double h = track.hdg[i];
    out[0] = track.x[i] - std::sin(h) * lat; out[1] = track.y[i] + std::cos(h) * lat;
    out[2] = z + world.trackY(i) + (world.bank.empty() ? 0 : bankY(world.bank, track, i, lat));
  };

  // ---- the ground: the height field as a mesh. Fine cells round the circuit,
  // coarse ones out to the horizon, stitched along the seam. Inside the
  // circuit's own corridor it is pushed well under the road: the corridor mesh
  // is the surface there, and a 16 m chord must never come up through tarmac
  // surveyed at 2 m. Landcover from OSM colours it.
  MeshB g;
  {
    double x0 = 1e300, x1 = -1e300, y0 = 1e300, y1 = -1e300;
    for (int i = 0; i < n; i++) {
      x0 = std::min(x0, track.x[i]); x1 = std::max(x1, track.x[i]);
      y0 = std::min(y0, track.y[i]); y1 = std::max(y1, track.y[i]);
    }
    struct Cover { const char *k; float c[3]; float kind; };
    static const Cover COVER[] = {
      {"water", {0.22f, 0.38f, 0.52f}, 0}, {"farm", {0.52f, 0.50f, 0.28f}, 2}, {"urban", {0.47f, 0.46f, 0.44f}, 1},
      {"forest", {0.17f, 0.31f, 0.14f}, 2}, {"scrub", {0.33f, 0.40f, 0.20f}, 2}, {"park", {0.30f, 0.48f, 0.20f}, 2},
      {"pitch", {0.25f, 0.52f, 0.22f}, 2}, {"sand", {0.76f, 0.70f, 0.52f}, 3}, {"bare", {0.50f, 0.46f, 0.38f}, 3},
      {"rock", {0.46f, 0.45f, 0.43f}, 3}, {"grass", {0.30f, 0.46f, 0.19f}, 2},
    };
    struct Area { std::vector<P2> p; const Cover *cv; double bx0, bx1, by0, by1; };
    std::vector<Area> areas;
    for (const auto &ar : env["areas"].arr) {
      const std::string k = ar["k"].s();
      for (const auto &cv : COVER)
        if (k == cv.k) {
          Area A{polyOf(ar["p"]), &cv, 1e300, -1e300, 1e300, -1e300};
          for (const auto &q : A.p) { A.bx0 = std::min(A.bx0, q[0]); A.bx1 = std::max(A.bx1, q[0]); A.by0 = std::min(A.by0, q[1]); A.by1 = std::max(A.by1, q[1]); }
          if (A.p.size() >= 3) areas.push_back(std::move(A));
          break;
        }
    }
    struct GV { double z; float c[3]; float kind; };
    auto sample = [&](double x, double y) {
      GV v;
      const Near nr = world.near(x, y);
      v.z = world.groundY(x, y, &nr);
      if (nr.i >= 0 && nr.d < track.w[nr.i] + std::min(track.runL[nr.i], track.runR[nr.i]) - 1.0) v.z -= 1.6;
      const Cover *cv = nullptr;
      for (const auto &A : areas)
        if (x >= A.bx0 && x <= A.bx1 && y >= A.by0 && y <= A.by1 && inPoly(A.p, x, y)) { cv = A.cv; break; }
      if (cv) { std::memcpy(v.c, cv->c, sizeof v.c); v.kind = cv->kind; }
      else { std::memcpy(v.c, GRASS, sizeof v.c); v.kind = 2; }
      // below the water line the bed shows through as sand
      if (world.hasSea && v.z < world.seaY + 0.3) { v.c[0] = 0.62f; v.c[1] = 0.58f; v.c[2] = 0.44f; v.kind = 3; }
      return v;
    };
    const double C = 256, F = 16;
    const double fx0 = std::floor((x0 - 320) / C) * C, fx1 = std::ceil((x1 + 320) / C) * C;
    const double fy0 = std::floor((y0 - 320) / C) * C, fy1 = std::ceil((y1 + 320) / C) * C;
    const int nx = (int)std::round((fx1 - fx0) / F), ny = (int)std::round((fy1 - fy0) / F), per = (int)(C / F);
    std::vector<GV> fv((size_t)(nx + 1) * (ny + 1));
    for (int j = 0; j <= ny; j++) for (int i = 0; i <= nx; i++) fv[(size_t)j * (nx + 1) + i] = sample(fx0 + i * F, fy0 + j * F);
    // the seam: a fine vertex on the edge takes the height of the coarse chord
    // it sits on, so the two meshes meet without a crack
    auto stitch = [&](int i, int j, bool alongX) {
      const int a = alongX ? (i / per) * per : (j / per) * per, b = a + per, at = alongX ? i : j;
      if (at == a) return;
      const GV &A = alongX ? fv[(size_t)j * (nx + 1) + a] : fv[(size_t)a * (nx + 1) + i];
      const GV &B = alongX ? fv[(size_t)j * (nx + 1) + b] : fv[(size_t)b * (nx + 1) + i];
      const double u = (double)(at - a) / per;
      fv[(size_t)j * (nx + 1) + i].z = A.z + (B.z - A.z) * u;
    };
    for (int i = 0; i <= nx; i++) { stitch(i, 0, true); stitch(i, ny, true); }
    for (int j = 0; j <= ny; j++) { stitch(0, j, false); stitch(nx, j, false); }
    auto cell = [&](double ax, double ay, double bx, double by, const GV &v00, const GV &v10, const GV &v11, const GV &v01) {
      const double p[4][3] = {{ax, ay, v00.z}, {bx, ay, v10.z}, {bx, by, v11.z}, {ax, by, v01.z}};
      const GV *gv[4] = {&v00, &v10, &v11, &v01};
      const int order[6] = {0, 1, 2, 0, 2, 3};
      // one normal a triangle, from the heights: the hills take the light
      for (int tI = 0; tI < 2; tI++) {
        const int *o = order + tI * 3;
        const double ux = p[o[1]][0] - p[o[0]][0], uy = p[o[1]][1] - p[o[0]][1], uz = p[o[1]][2] - p[o[0]][2];
        const double wx = p[o[2]][0] - p[o[0]][0], wy = p[o[2]][1] - p[o[0]][1], wz = p[o[2]][2] - p[o[0]][2];
        double nx_ = uy * wz - uz * wy, ny_ = uz * wx - ux * wz, nz_ = ux * wy - uy * wx;
        const double l = std::sqrt(nx_ * nx_ + ny_ * ny_ + nz_ * nz_);
        if (l > 0) { nx_ /= l; ny_ /= l; nz_ /= l; }
        if (nz_ < 0) { nx_ = -nx_; ny_ = -ny_; nz_ = -nz_; }
        for (int k = 0; k < 3; k++) g.vert(p[o[k]][0], p[o[k]][1], p[o[k]][2], nx_, ny_, nz_, gv[o[k]]->c, gv[o[k]]->kind);
      }
    };
    for (int j = 0; j < ny; j++) for (int i = 0; i < nx; i++)
      cell(fx0 + i * F, fy0 + j * F, fx0 + (i + 1) * F, fy0 + (j + 1) * F, fv[(size_t)j * (nx + 1) + i], fv[(size_t)j * (nx + 1) + i + 1],
           fv[(size_t)(j + 1) * (nx + 1) + i + 1], fv[(size_t)(j + 1) * (nx + 1) + i]);
    // the coarse ring, out to where the fog has taken everything
    const int ring = 28;
    const int cnx = (int)std::round((fx1 - fx0) / C) + 2 * ring, cny = (int)std::round((fy1 - fy0) / C) + 2 * ring;
    const double cx0 = fx0 - ring * C, cy0 = fy0 - ring * C;
    std::vector<GV> cvs((size_t)(cnx + 1) * (cny + 1));
    for (int j = 0; j <= cny; j++) for (int i = 0; i <= cnx; i++) {
      const double x = cx0 + i * C, y = cy0 + j * C;
      const bool inFine = x >= fx0 - 1 && x <= fx1 + 1 && y >= fy0 - 1 && y <= fy1 + 1;
      cvs[(size_t)j * (cnx + 1) + i] = inFine ? fv[(size_t)std::lround((y - fy0) / F) * (nx + 1) + std::lround((x - fx0) / F)] : sample(x, y);
    }
    for (int j = 0; j < cny; j++) for (int i = 0; i < cnx; i++) {
      const double ax = cx0 + i * C, ay = cy0 + j * C;
      if (ax >= fx0 - 1 && ax + C <= fx1 + 1 && ay >= fy0 - 1 && ay + C <= fy1 + 1) continue;
      cell(ax, ay, ax + C, ay + C, cvs[(size_t)j * (cnx + 1) + i], cvs[(size_t)j * (cnx + 1) + i + 1], cvs[(size_t)(j + 1) * (cnx + 1) + i + 1],
           cvs[(size_t)(j + 1) * (cnx + 1) + i]);
    }
    // the sea: one sheet at the water line. The land's own height hides it,
    // which is the only reason it does not flood Monaco.
    MeshB sm;
    if (world.hasSea) {
      const float SEA[3] = {0.14f, 0.34f, 0.52f};
      const double M = 9000;
      const double a[3] = {x0 - M, y0 - M, world.seaY}, b[3] = {x1 + M, y0 - M, world.seaY}, c[3] = {x1 + M, y1 + M, world.seaY}, d[3] = {x0 - M, y1 + M, world.seaY};
      sm.flat(a, b, c, d, SEA, 7);
    }
    sea.upload(sm);
  }
  ground.upload(g);

  // ---- the corridor: road, lines, kerbs, run-off and barriers, in strips that
  // never overlap one another.
  MeshB m;
  const double KW = 1.2;
  const double hWall = track.wall == "wall" ? 1.10 : track.wall == "gravel" ? 1.00 : 0.90;
  for (int i = 0; i < segs; i++) {
    const int j = (i + 1) % n;
    auto lats = [&](int s, double L[5], double R[5]) {
      const double w = track.w[s];
      L[0] = w + std::max(0.05, track.runL[s]); L[1] = w + std::min(KW, std::max(0.05, track.runL[s]));
      L[2] = w; L[3] = w - 0.20; L[4] = w - 0.35;
      R[0] = -(w + std::max(0.05, track.runR[s])); R[1] = -(w + std::min(KW, std::max(0.05, track.runR[s])));
      R[2] = -w; R[3] = -(w - 0.20); R[4] = -(w - 0.35);
    };
    double Li[5], Ri[5], Lj[5], Rj[5];
    lats(i, Li, Ri); lats(j, Lj, Rj);
    auto strip = [&](double ai, double bi, double aj, double bj, const float col[3], float kind, double za = 0, double zb = 0) {
      double a[3], b[3], c[3], d[3];
      P(i, ai, za, a); P(i, bi, zb, b); P(j, bj, zb, c); P(j, aj, za, d);
      m.flat(a, b, c, d, col, kind);
    };
    strip(Li[4], Ri[4], Lj[4], Rj[4], ASPHALT, 1);
    strip(Li[2], Li[3], Lj[2], Lj[3], ASPHALT, 1);
    strip(Li[3], Li[4], Lj[3], Lj[4], WHITE, 0);
    strip(Ri[4], Ri[3], Rj[4], Rj[3], WHITE, 0);
    strip(Ri[3], Ri[2], Rj[3], Rj[2], ASPHALT, 1);
    for (int side : {1, -1}) {
      const double *A = side > 0 ? Li : Ri, *B = side > 0 ? Lj : Rj;
      const int rt = std::max(0, std::min(3, side > 0 ? runL[i] : runR[i]));
      strip(A[0], A[1], B[0], B[1], RUNCOL[rt], RUNKIND[rt]);
      if (kerb[i] > 0) {
        // 1 m stripes: each 2 m sample is two blocks.
        const double kh = kerb[i] == 1 ? 0.030 : kerb[i] == 3 ? 0.085 : 0.055;
        double a[3], b[3], c[3], d[3], mo[3], mi[3];
        P(i, A[1], kh, a); P(i, A[2], 0, b); P(j, B[2], 0, c); P(j, B[1], kh, d);
        for (int k = 0; k < 3; k++) { mo[k] = (a[k] + d[k]) / 2; mi[k] = (b[k] + c[k]) / 2; }
        m.flat(a, b, mi, mo, KRED, 0);
        m.flat(mo, mi, c, d, KALT, 0);
      } else if (rt == 0) strip(A[1], A[2], B[1], B[2], VERGE, 2);   // a strip of grass before the gravel
      else strip(A[1], A[2], B[1], B[2], RUNCOL[rt], RUNKIND[rt]);

      // the barrier: face, top, back
      const bool alt = ((i / 2) & 1) != 0;
      float face[3], top[3];
      if (track.wall == "wall") { const float c0 = alt ? 0.70f : 0.63f; face[0] = c0; face[1] = c0; face[2] = c0 - 0.02f; std::memcpy(top, face, sizeof top); }
      else if (track.wall == "gravel") {
        face[0] = face[1] = 0.09f; face[2] = 0.10f;
        if (alt) { top[0] = 0.80f; top[1] = 0.14f; top[2] = 0.15f; } else { top[0] = top[1] = top[2] = 0.90f; }
      } else { const float c0 = alt ? 0.74f : 0.66f; face[0] = c0; face[1] = c0 + 0.01f; face[2] = c0 + 0.04f; std::memcpy(top, face, sizeof top); }
      const double out = side * 0.35;
      double a[3], b[3], c[3], d[3], e[3], f[3], gq[3], hq[3];
      // the foot goes well into the ground, so a chord of terrain can never show a gap under it
      P(i, A[0], -1.5, a); P(j, B[0], -1.5, b); P(j, B[0], hWall, c); P(i, A[0], hWall, d);
      P(i, A[0] + out, hWall, e); P(j, B[0] + out, hWall, f); P(j, B[0] + out, -2.5, gq); P(i, A[0] + out, -2.5, hq);
      const float wk = track.wall == "wall" ? 4.0f : 0.0f;
      m.quad(a, b, c, d, face, wk);
      m.quad(d, c, f, e, top, wk);
      m.quad(e, f, gq, hq, face, wk);
    }
  }
  // the gantry over the line
  {
    const int i0 = track.idx(0);
    const float STEEL[3] = {0.16f, 0.17f, 0.19f}, LAMP[3] = {0.55f, 0.05f, 0.05f};
    const double w = track.w[i0] + 1.6;
    double a[3], b[3], c[3], d[3];
    P(i0, w, 0, a); P(i0, w, 6.6, b); P(i0, -w, 0, c); P(i0, -w, 6.6, d);
    m.beam(a, b, 0.45, STEEL, 0);
    m.beam(c, d, 0.45, STEEL, 0);
    double e[3], f[3];
    P(i0, w, 6.3, e); P(i0, -w, 6.3, f);
    m.beam(e, f, 0.7, STEEL, 0);
    for (int k = -2; k <= 2; k++) {
      double p0[3], p1[3];
      P(i0, k * 0.9 - 0.3, 5.7, p0); P(i0, k * 0.9 + 0.3, 5.7, p1);
      m.beam(p0, p1, 0.5, LAMP, 0);
    }
  }
  // The woods and the numbered braking boards (dress.cpp). If its photographs
  // are missing, the plain bars and cone trees below stand in.
  if (dress) dress->buildWorld(track, world, env, raceLine);
  const bool dressed = dress && dress->hasWoods();
  // braking boards: three, two, one bar at 150, 100 and 50 m before a real
  // corner, on the outside, where the eye already is
  if (!dressed) {
    const float BOARD[3] = {0.93f, 0.93f, 0.90f}, BAR[3] = {0.06f, 0.06f, 0.07f}, POST[3] = {0.20f, 0.20f, 0.22f};
    for (const auto &c : track.corners) {
      if (c.R <= 0 || c.R > 160 || c.dir == 0) continue;
      for (int b = 0; b < 3; b++) {
        const int i = track.idx(c.s0 - 150 + b * 50);
        const double side = -c.dir, run = side > 0 ? track.runL[i] : track.runR[i];
        const double lat = side * (track.w[i] + std::min(1.6, std::max(0.3, run - 0.4)));
        double p0[3], p1[3], q0[3], q1[3];
        P(i, lat, 0, p0); P(i, lat, 1.9, p1);
        m.beam(p0, p1, 0.07, POST, 0);
        (void)q0; (void)q1;
        // a flat panel facing the oncoming car, and the bars a hair in front of it
        const double h = track.hdg[i];
        auto panel = [&](double l0, double l1, double z0, double z1, double fwd, const float *col) {
          double a[3], bq[3], cq[3], d[3];
          P(i, l0, z0, a); P(i, l1, z0, bq); P(i, l1, z1, cq); P(i, l0, z1, d);
          for (double *r : {a, bq, cq, d}) { r[0] -= std::cos(h) * fwd; r[1] -= std::sin(h) * fwd; }
          m.quad(a, bq, cq, d, col, 8);
        };
        panel(lat - 0.5, lat + 0.5, 1.0, 1.9, 0.04, BOARD);
        const int bars = 3 - b;
        for (int k = 0; k < bars; k++) {
          const double o = (k - (bars - 1) / 2.0) * 0.26;
          panel(lat + o - 0.07, lat + o + 0.07, 1.12, 1.78, 0.06, BAR);
        }
      }
    }
  }
  corridor.upload(m);

  // ---- decals: the chequered line, drawn with a depth offset
  MeshB dm;
  {
    const int i0 = track.idx(0);
    const double h = track.hdg[i0], w = track.w[i0] - 0.35;
    const float BLK[3] = {0.05f, 0.05f, 0.05f}, WHT[3] = {0.95f, 0.95f, 0.95f};
    const int cols = std::max(2, (int)std::round(2 * w / 0.5));
    const double cw = 2 * w / cols;
    for (int r = 0; r < 2; r++)
      for (int c = 0; c < cols; c++) {
        const double l0 = -w + c * cw, l1 = l0 + cw, s0 = r * 0.5, s1 = s0 + 0.5;
        auto Q = [&](double lat, double al, double o[3]) {
          o[0] = track.x[i0] - std::sin(h) * lat + std::cos(h) * al;
          o[1] = track.y[i0] + std::cos(h) * lat + std::sin(h) * al;
          o[2] = 0.006 + world.trackYAt(al) + (world.bank.empty() ? 0 : bankY(world.bank, track, i0, lat));
        };
        double a[3], b[3], cc[3], d[3];
        Q(l0, s0, a); Q(l1, s0, b); Q(l1, s1, cc); Q(l0, s1, d);
        dm.flat(a, b, cc, d, ((r + c) & 1) ? BLK : WHT, 0);
      }
  }
  decals.upload(dm);

  // ---- the racing line (L): green where you are on the power, red where the
  // profile says you are slowing down.
  MeshB lm;
  for (int i = 0; i < segs; i++) {
    const int j = (i + 1) % n;
    const bool slowing = raceLine.v[j] < raceLine.v[i] - 0.02;
    const float GO[3] = {0.20f, 0.85f, 0.35f}, STOP[3] = {0.92f, 0.20f, 0.18f};
    double a[3], b[3], c[3], d[3];
    P(i, raceLine.off[i] + 0.14, 0.008, a); P(i, raceLine.off[i] - 0.14, 0.008, b);
    P(j, raceLine.off[j] - 0.14, 0.008, c); P(j, raceLine.off[j] + 0.14, 0.008, d);
    lm.flat(a, b, c, d, slowing ? STOP : GO, 8);
  }
  lineMesh.upload(lm);

  // ---- scenery from the OSM bake: buildings at their surveyed footprints and
  // heights, trees where the survey has them, woods filled in where it says
  // "forest". None of it is placed by hand or by dice on the circuit's ground.
  MeshB sc;
  auto tree = [&](double x, double y, double hgt) {
    const double r = hgt * 0.22, tr = hgt * 0.035, z0g = world.groundY(x, y) - 0.3;
    const float TRUNK[3] = {0.26f, 0.19f, 0.13f};
    const float tone = (float)(0.75 + 0.5 * hash2(x * 0.37, y * 0.91));
    const float LEAF[3] = {0.13f * tone, 0.30f * tone, 0.12f * tone}, LEAF2[3] = {0.16f * tone, 0.35f * tone, 0.14f * tone};
    sc.box(x - tr, x + tr, y - tr, y + tr, z0g, z0g + hgt * 0.4, TRUNK, 0);
    const int S = 6;
    for (int lvl = 0; lvl < 2; lvl++) {
      const double z0 = z0g + hgt * (lvl ? 0.55 : 0.25), z1 = z0g + hgt * (lvl ? 1.0 : 0.80), rr = r * (lvl ? 0.72 : 1.0);
      const double apex[3] = {x, y, z1};
      for (int s = 0; s < S; s++) {
        const double a0 = 2 * PI * s / S, a1 = 2 * PI * (s + 1) / S;
        const double p0[3] = {x + std::cos(a0) * rr, y + std::sin(a0) * rr, z0}, p1[3] = {x + std::cos(a1) * rr, y + std::sin(a1) * rr, z0};
        sc.tri(p0, p1, apex, lvl ? LEAF2 : LEAF, 0);
      }
    }
  };
  size_t nBuild = 0, nTree = 0;
  for (const auto &bd : env["buildings"].arr) {
    const std::vector<P2> p = polyOf(bd["p"]);
    if (p.size() < 3) continue;
    bool clash = false;
    double cx = 0, cy = 0;
    for (const auto &q : p) { cx += q[0]; cy += q[1]; if (onCircuit(q[0], q[1], 1.5)) { clash = true; break; } }
    if (clash) continue;
    cx /= p.size(); cy /= p.size();
    if (onCircuit(cx, cy, 1.5)) continue;
    const double hgt = std::max(3.0, bd["h"].n(7));
    const double t = hash2(cx * 0.13, cy * 0.29);
    const float wall[3] = {(float)(0.58 + 0.26 * t), (float)(0.55 + 0.22 * t), (float)(0.50 + 0.18 * hash2(cy, cx))};
    const float roof[3] = {(float)(0.34 + 0.20 * t), (float)(0.28 + 0.10 * t), (float)(0.26 + 0.08 * t)};
    // a building stands on its own ground: walls from below the lowest corner
    // of its footprint to a level roof above the highest
    double gLo = 1e300, gHi = -1e300;
    for (const auto &q : p) { const double gz = world.groundY(q[0], q[1]); gLo = std::min(gLo, gz); gHi = std::max(gHi, gz); }
    const double top = gHi + hgt;
    for (size_t i = 0; i < p.size(); i++) {
      const P2 &u = p[i], &w = p[(i + 1) % p.size()];
      const double a[3] = {u[0], u[1], gLo - 1}, b[3] = {w[0], w[1], gLo - 1}, c[3] = {w[0], w[1], top}, d[3] = {u[0], u[1], top};
      sc.quad(a, b, c, d, wall, 5);
    }
    for (int i : earclip(p)) sc.vert(p[(size_t)i][0], p[(size_t)i][1], top, 0, 0, 1, roof, 0);
    nBuild++;
  }
  if (!dressed) for (const auto &t : env["trees"].arr) {
    const double x = t[(size_t)0].n(), y = t[(size_t)1].n();
    if (onCircuit(x, y, 2.5)) continue;
    tree(x, y, 7 + 6 * hash2(x, y));
    nTree++;
  }
  if (!dressed) {
    // woods: one tree per cell of a jittered grid inside each forest polygon,
    // the spacing chosen so the whole map stays inside a fixed budget.
    std::vector<std::vector<P2>> woods;
    double area = 0;
    for (const auto &ar : env["areas"].arr)
      if (ar["k"].s() == "forest") { woods.push_back(polyOf(ar["p"])); area += std::fabs(polyArea(woods.back())); }
    const double BUDGET = 9000;
    const double sp = std::max(13.0, std::sqrt(area / BUDGET));
    for (const auto &p : woods) {
      if (p.size() < 3) continue;
      double x0 = 1e300, x1 = -1e300, y0 = 1e300, y1 = -1e300;
      for (const auto &q : p) { x0 = std::min(x0, q[0]); x1 = std::max(x1, q[0]); y0 = std::min(y0, q[1]); y1 = std::max(y1, q[1]); }
      for (double gx = std::floor(x0 / sp) * sp; gx < x1; gx += sp)
        for (double gy = std::floor(y0 / sp) * sp; gy < y1; gy += sp) {
          const double x = gx + hash2(gx, gy) * sp, y = gy + hash2(gy + 7.1, gx - 3.3) * sp;
          if (!inPoly(p, x, y) || onCircuit(x, y, 3.0)) continue;
          tree(x, y, 9 + 9 * hash2(x * 1.7, y * 0.6));
          nTree++;
        }
    }
  }
  // Grandstands along the start straight, both sides, wherever the ground
  // behind the barrier is free: stepped terraces with a crowd in them. (The
  // browser game dresses every circuit by hand — stands, paddock, hoardings;
  // this is the one piece of that drawn here so far.)
  {
    const float STEEL[3] = {0.30f, 0.31f, 0.34f}, ROOF[3] = {0.82f, 0.82f, 0.80f};
    const int from = track.idx(-140), count = (int)(420 / track.ds);
    for (int side : {1, -1}) {
      for (int k = 0; k < count; k++) {
        const int i = (from + k) % n, j = (i + 1) % n;
        if (std::fabs(track.curv[i]) > 0.004 || (track.open && j == 0)) continue;
        const double base = track.w[i] + (side > 0 ? track.runL[i] : track.runR[i]) + 3.0;
        const double baseJ = track.w[j] + (side > 0 ? track.runL[j] : track.runR[j]) + 3.0;
        double far[3];
        P(i, side * (base + 9), 0, far);
        int ni;
        if (distToTrack(far[0], far[1], ni) < base + 5) continue;          // another leg of the lap is in the way
        const int ROWS = 8;
        for (int r = 0; r < ROWS; r++) {
          const double l0 = r * 1.05, l1 = l0 + 1.05, z = 1.2 + r * 0.55;
          double a[3], b[3], c[3], d[3], e[3], f[3];
          P(i, side * (base + l0), z, a); P(j, side * (baseJ + l0), z, b); P(j, side * (baseJ + l1), z, c); P(i, side * (base + l1), z, d);
          P(i, side * (base + l0), z - 0.55, e); P(j, side * (baseJ + l0), z - 0.55, f);
          sc.quad(e, f, b, a, STEEL, 0);
          // the people: one colour a seat, from a hash, so the stand reads as a crowd
          const double hq = hash2(i * 3.1 + r * 17.0, side * 5.0 + r);
          const float crowd[3] = {(float)(0.34 + 0.38 * hash2(hq, 1.0)), (float)(0.32 + 0.34 * hash2(hq, 2.0)), (float)(0.33 + 0.36 * hash2(hq, 3.0))};
          double a2[3], b2[3];
          for (int q = 0; q < 3; q++) { a2[q] = a[q]; b2[q] = b[q]; }
          a2[2] += 0.75; b2[2] += 0.75;
          sc.quad(a, b, c, d, STEEL, 0);
          sc.quad(d, c, b2, a2, crowd, 0);          // lit like anything else: unlit, a crowd glowed in the dark
        }
        if (k % 6 == 0) {
          double p0[3], p1[3];
          P(i, side * (base + ROWS * 1.05), -1, p0); P(i, side * (base + ROWS * 1.05), 8.6, p1);
          sc.beam(p0, p1, 0.3, STEEL, 0);
        }
        double r0[3], r1[3], r2[3], r3[3];
        P(i, side * (base + 1.5), 8.2, r0); P(j, side * (baseJ + 1.5), 8.2, r1); P(j, side * (baseJ + ROWS * 1.05 + 0.4), 8.7, r2); P(i, side * (base + ROWS * 1.05 + 0.4), 8.7, r3);
        sc.quad(r0, r1, r2, r3, ROOF, 0);
      }
    }
  }
  scenery.upload(sc);
  worldTris = (g.count() + m.count() + dm.count() + sc.count()) / 3;
  std::fprintf(stderr, "world: %zu triangles  (%zu buildings, %zu trees, surface bake %s)\n", worldTris, nBuild, nTree,
               haveSurf ? "yes" : "no — fallback");
  camReady = false;
}

// ---------------------------------------------------------------------------
// The car — drawn from the spec's real dimensions. Not the downloaded model.
// ---------------------------------------------------------------------------
void Renderer::buildCar(const Spec &S) {
  // the game's real bodies (js/car.js), ported in carmesh.cpp
  const CarMeshes cm = buildCarMeshes(S);
  carBody.upload(cm.body); carFrontWing.upload(cm.frontWing); carRearWing.upload(cm.rearWing); carHelmet.upload(cm.helmet);
  wheelF.upload(cm.wheelF); wheelR.upload(cm.wheelR);
  wheelR_f = cm.wheelRadF; wheelR_r = cm.wheelRadR;
  carCabin = cm.cabin;
  if (std::getenv("XBR_PROF")) std::fprintf(stderr, "car: body %zu tris, wings %zu + %zu, helmet %zu, wheels %zu + %zu each\n", cm.body.count() / 3,
                                            cm.frontWing.count() / 3, cm.rearWing.count() / 3, cm.helmet.count() / 3, cm.wheelF.count() / 3, cm.wheelR.count() / 3);
  for (int k = 0; k < 3; k++) carEye[k] = cm.eye[k];
  // A BOLTED CAMERA MUST BE OUTSIDE THE CAR. The mounts are the single-seater's
  // (js/render.js); on the coupe the roof and the bonnet are higher than they
  // are, and the faces here are two-sided, so the view was the inside of a box.
  // Find the top of the bodywork under each mount and sit 9 cm above it.
  {
    onboardX = S.key == "gt3" ? 0.62f : -0.34f;        // a car with a roof: the camera goes to the foot of the windscreen
    const float sh = (float)(S.a - S.L / 2), mx[3] = {onboardX + sh, 1.62f + sh, -0.62f + sh};
    for (int c = 0; c < 3; c++) {
      float top = 0;
      for (size_t i = 0; i + 9 < cm.body.v.size(); i += 10) {
        const float x = cm.body.v[i], y = cm.body.v[i + 1], z = cm.body.v[i + 2];
        if (x > mx[c] - 0.45f && x < mx[c] + 0.75f && std::fabs(z) < 0.45f) top = std::max(top, y);
      }
      camFloor[c] = top + 0.09f;
    }
  }
  const double hw = S.bodyW / 2;

  MeshB sh;
  const float BLK[3] = {0, 0, 0};
  const double a[3] = {-S.bodyL / 2 - 0.1, -hw - 0.08, 0}, b[3] = {S.bodyL / 2 + 0.1, -hw - 0.08, 0};
  const double c[3] = {S.bodyL / 2 + 0.1, hw + 0.08, 0}, d[3] = {-S.bodyL / 2 - 0.1, hw + 0.08, 0};
  sh.flat(a, b, c, d, BLK, 8);
  shadow.upload(sh);
}

void Renderer::setDents(const Car *car) {
  if (!car || car->dents.empty()) { glUniform1i(uNDent, 0); return; }
  float d[32], nn[16];
  const int n = (int)std::min<size_t>(8, car->dents.size());
  for (int i = 0; i < n; i++) {
    const Dent &D = car->dents[(size_t)i];
    d[i * 4] = (float)D.lx; d[i * 4 + 1] = (float)D.ly; d[i * 4 + 2] = (float)D.depth; d[i * 4 + 3] = (float)std::max(0.2, D.r);
    nn[i * 2] = (float)D.nx; nn[i * 2 + 1] = (float)D.ny;
  }
  glUniform1i(uNDent, n);
  glUniform4fv(uDent, n, d);
  glUniform2fv(uDentN, n, nn);
}

// One car: body, wings unless they have been knocked off, wheels unless lost.
// One step of a car's body on its springs, once a frame however often it is asked for.
const Renderer::Susp &Renderer::suspOf(const Car &car, const Spec &S) {
  Susp &q = susp[&car];
  if (q.at == frameT) return q;
  const bool fresh = q.at < 0;
  q.at = frameT;
  // how the car is sprung: a single-seater barely moves and moves fast; a car with a roof rides
  const bool gt = S.key == "gt3";
  const float travel = S.key == "f1" ? 0.034f : gt ? 0.085f : 0.045f, hz = S.key == "f1" ? 4.6f : gt ? 2.1f : 3.6f, zeta = gt ? 0.34f : 0.48f;
  q.travel = travel;
  const float w = 2 * (float)PI * hz;
  const float speed = (float)car.speed;
  if (fresh) { q.air = car.airborne; q.s = 0; q.v = 0; return q; }
  // the landing: what it was falling at goes into the springs
  if (car.airborne) q.vzAir = (float)car.vz;
  if (q.air && !car.airborne) q.v += std::max(-3.2f, std::min(0.0f, q.vzAir)) * 0.85f;
  q.air = car.airborne;
  // where it rests: pressed down by its wings, more the faster it goes
  const float press = 0.5f * 1.225f * (float)S.ClA * speed * speed / (float)S.m;
  const float rest = car.airborne ? travel * 0.55f : -std::min(travel * 0.62f, press / (w * w));
  // what the road does to it
  const double sf = car.surface;
  const float rough = car.airborne ? 0 : sf < 0.5 ? 1.0f : sf < 0.7 ? 0.8f : sf < 0.999 ? 0.5f : 0.03f;
  float dt = std::min(0.05f, frameDt);
  while (dt > 1e-5f) {
    const float h = std::min(dt, 1.0f / 240);
    dt -= h;
    q.rng = q.rng * 1664525u + 1013904223u;
    const float kick = ((float)(q.rng >> 8) / 16777216.0f - 0.5f) * rough * std::min(1.0f, speed / 18) * 34.0f * travel / 0.05f;
    q.v += (-w * w * (q.s - rest) - 2 * zeta * w * q.v + kick) * h;
    q.s += q.v * h;
    if (q.s < -travel) { q.s = -travel; if (q.v < 0) q.v *= -0.22f; }            // the bump stop
    if (q.s > travel * 0.7f) { q.s = travel * 0.7f; if (q.v > 0) q.v *= -0.1f; }  // the droop limit
  }
  q.droop += ((car.airborne ? 1.0f : 0.0f) - q.droop) * std::min(1.0f, frameDt * 14);
  return q;
}

void Renderer::drawCar(const Car &car, const Spec &S, double groundH, double gPitch, double gRoll, const float paint[3], double rolled,
                       bool helmet) {
  const float gain = car.airborne ? 1.0f : 3.0f;
  const float gp = car.airborne ? 0.0f : (float)gPitch, gr = car.airborne ? 0.0f : (float)gRoll;
  const Mat4 wheelsM = Mat4::translate((float)car.x, (float)(groundH + std::max(0.0, car.z)), (float)-car.y)
                     * Mat4::rotY((float)car.hdg) * Mat4::rotZ(gp + (float)car.pitch * gain) * Mat4::rotX(gr + (float)car.roll * gain);
  // the body rides on its springs; the wheels stay on the road, and hang when there is none
  const Susp &sp = suspOf(car, S);
  const float hang = -sp.droop * sp.travel * 0.9f;
  const Mat4 carM = wheelsM * Mat4::translate(0, sp.s, 0);
  if (packCar) {
    // The model stands on the road at mid-wheelbase; the sim's origin is the CG.
    const Mat4 M = carM * Mat4::translate((float)(S.a - S.L / 2), 0, 0);
    bool lost[4]; double sag[4];
    for (int i = 0; i < 4; i++) { lost[i] = car.wheelLost[i]; sag[i] = (car.hasSag ? car.sag[i] : 0) - sp.s + hang; }
    dress->drawPack(*packCar, M, car.steerEff, rolled, paint, lost, sag, false);
    dress->drawPack(*packCar, M, car.steerEff, rolled, paint, lost, sag, true);
    return;
  }
  glUniform3f(uPaint, paint[0], paint[1], paint[2]);
  setDents(&car);
  // A car is skins inside skins (tub, halo, floor, wings), all two-sided: left
  // alone, each pixel of it is lit four or five times over. So its depth goes
  // down first, for nothing, and the lighting is then done once a pixel.
  for (int pass = 0; pass < 2; pass++) {
    if (pass == 0) { glColorMask(GL_FALSE, GL_FALSE, GL_FALSE, GL_FALSE); glUniform1i(uPass, 1); }
    else { glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE); glUniform1i(uPass, 0); }
    drawMesh(carBody, carM);
    if (!(car.hasLost && car.lostFrontWing)) drawMesh(carFrontWing, carM);
    if (!(car.hasLost && car.lostRearWing)) drawMesh(carRearWing, carM);
    if (helmet) drawMesh(carHelmet, carM);
  }
  setDents(nullptr);
  double Wp[4][2];
  wheelPos(S, Wp);
  for (int i = 0; i < 4; i++) {
    if (car.wheelLost[i]) continue;
    const double r = i < 2 ? wheelR_f : wheelR_r;
    // a flat tyre sits on its rim
    const float sag = car.hasSag ? (float)car.sag[i] : 0.0f;
    Mat4 wm = wheelsM * Mat4::translate((float)Wp[i][0], (float)r + sag + hang, (float)-Wp[i][1]);
    if (i < 2) wm = wm * Mat4::rotY((float)car.steerEff);
    wm = wm * Mat4::rotZ((float)(-rolled / r));
    drawMesh(i < 2 ? wheelF : wheelR, wm);
  }
}

// Rain you drive through: streaks across the view, more and faster with speed.
void Renderer::drawRain(const FrameIn &f) {
  if (f.look.rain <= 0.01f) return;
  const float W_ = (float)W, H_ = (float)H;
  const int n = (int)(260 * f.look.rain);
  const float sp = (float)std::min(1.0, f.car->speed / 70.0);
  const float col[4] = {0.82f, 0.86f, 0.92f, 0.16f + 0.10f * sp};
  for (int i = 0; i < n; i++) {
    const double a = hash2(i * 1.7, 3.1), b = hash2(i * 0.37, 9.2);
    const float len = H_ * (0.05f + 0.10f * sp) * (0.6f + (float)b);
    const double fall = std::fmod(f.time * (1.3 + 1.4 * b) + a * 7.0, 1.0);
    rect((float)(std::fmod(a * 977.0 + b * 131.0, 1.0)) * W_, (float)fall * (H_ + len) - len, std::max(1.0f, H_ / 700.0f), len, col);
  }
}

Look makeLook(const std::string &phase, double cloud, double wet, double rain) {
  Look L;
  auto set = [](float *d, float r, float g, float b) { d[0] = r; d[1] = g; d[2] = b; };
  if (phase == "dawn") {
    set(L.sun, 0.80f, 0.22f, 0.40f); set(L.sunCol, 1.05f, 0.72f, 0.48f);
    set(L.skyAmb, 0.46f, 0.46f, 0.56f); set(L.gndAmb, 0.30f, 0.27f, 0.27f);
    set(L.fog, 0.90f, 0.74f, 0.62f); set(L.skyTop, 0.30f, 0.42f, 0.70f);
  } else if (phase == "dusk") {
    set(L.sun, -0.82f, 0.16f, -0.30f); set(L.sunCol, 1.05f, 0.58f, 0.34f);
    set(L.skyAmb, 0.42f, 0.38f, 0.50f); set(L.gndAmb, 0.28f, 0.24f, 0.24f);
    set(L.fog, 0.92f, 0.62f, 0.46f); set(L.skyTop, 0.22f, 0.26f, 0.52f);
  } else if (phase == "night") {
    set(L.sun, 0.30f, 0.80f, -0.40f); set(L.sunCol, 0.20f, 0.24f, 0.36f);        // the moon, and the floodlights it stands in for
    set(L.skyAmb, 0.16f, 0.18f, 0.26f); set(L.gndAmb, 0.10f, 0.10f, 0.12f);
    set(L.fog, 0.05f, 0.06f, 0.10f); set(L.skyTop, 0.01f, 0.02f, 0.06f);
  }
  // cloud takes the colour out of everything and the edge off the sun
  const float c = (float)clampd(cloud, 0, 1);
  const float night = phase == "night" ? 0.25f : 1.0f;
  const float grey[3] = {0.62f * night, 0.64f * night, 0.66f * night};
  for (int k = 0; k < 3; k++) {
    L.sunCol[k] *= 1.0f - 0.78f * c;
    L.skyAmb[k] = L.skyAmb[k] * (1 - c) + grey[k] * 0.95f * c;
    L.fog[k] = L.fog[k] * (1 - c) + grey[k] * c;
    L.skyTop[k] = L.skyTop[k] * (1 - c) + grey[k] * 0.78f * c;
  }
  L.fogK = 0.00055f + 0.0012f * (float)clampd(rain, 0, 1) + 0.0003f * c;
  L.wet = (float)clampd(wet, 0, 1);
  L.rain = (float)clampd(rain, 0, 1);
  L.cloud = c;
  L.night = phase == "night" ? 1.0f : phase == "dusk" || phase == "dawn" ? 0.35f : 0.0f;
  return L;
}

void Renderer::drawMesh(const GLMesh &m, const Mat4 &model, float alpha) {
  glUniformMatrix4fv(uModel, 1, GL_FALSE, model.m);
  glUniform1f(uAlpha, alpha);
  m.draw();
}

// ---------------------------------------------------------------------------
// The look
// ---------------------------------------------------------------------------
// XBR_PROF=1: where a frame's milliseconds go. glFinish between sections, so
// the total is slower than a real frame; the SHARES are what to read.
namespace {
struct Prof {
  bool on = std::getenv("XBR_PROF") != nullptr;
  double acc[8] = {0}, t0 = 0; long frames = 0;
  static double now() { timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts); return ts.tv_sec * 1e3 + ts.tv_nsec / 1e6; }
  void begin() { if (on) { glFinish(); t0 = now(); } }
  void mark(int i) { if (on) { glFinish(); const double t = now(); acc[i] += t - t0; t0 = t; } }
  ~Prof() {
    if (!on || !frames) return;
    static const char *N[8] = {"shadow map", "ground+sky", "corridor+scenery", "woods", "your car", "decals+blob", "develop", "field (rivals)"};
    for (int i = 0; i < 8; i++) std::fprintf(stderr, "prof: %-18s %6.2f ms\n", N[i], acc[i] / frames);
  }
} PROF;
}
static float sl0(const float v[3]) { return std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }

static void colourTarget(unsigned &fb, unsigned &tex, int w, int h, GLenum fmt, GLenum base, GLenum type) {
  if (!tex) glGenTextures(1, &tex);
  glBindTexture(GL_TEXTURE_2D, tex);
  glTexImage2D(GL_TEXTURE_2D, 0, (GLint)fmt, w, h, 0, base, type, nullptr);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  if (!fb) glGenFramebuffers(1, &fb);
  glBindFramebuffer(GL_FRAMEBUFFER, fb);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
}

void Renderer::ensurePost() {
  if (postW == W && postH == H && sceneFbo) return;
  postW = W; postH = H;
  colourTarget(sceneFbo, sceneCol, W, H, GL_R11F_G11F_B10F, GL_RGB, GL_FLOAT);
  if (!sceneDepth) glGenRenderbuffers(1, &sceneDepth);
  glBindRenderbuffer(GL_RENDERBUFFER, sceneDepth);
  glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, W, H);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, sceneDepth);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) { std::fprintf(stderr, "xbr: no float picture on this GPU - plain picture\n"); post = postOk = false; }
  for (int i = 0; i < 2; i++) colourTarget(bloomFbo[i], bloomTex[i], std::max(1, W / 4), std::max(1, H / 4), GL_R11F_G11F_B10F, GL_RGB, GL_FLOAT);
  colourTarget(ldrFbo, ldrTex, W, H, GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE);
  glBindFramebuffer(GL_FRAMEBUFFER, post ? sceneFbo : fbo);
}

// THE SUN'S SHADOWS. One map, 256 m square, laid ahead of the camera. The world
// does not move, so the map is only redrawn when the camera has gone a step of
// 16 m (which is a whole number of its texels: nothing shimmers when it is).
void Renderer::renderShadow(const Look &L, const float eye[3], const float fwd[3], double time) {
  const float n = sl0(L.sun), sun[3] = {L.sun[0] / n, L.sun[1] / n, L.sun[2] / n};
  const float R = 128, STEP = 16;
  float r[3] = {sun[2], 0, -sun[0]};                       // up x sun
  const float rl = std::sqrt(r[0] * r[0] + r[2] * r[2]) + 1e-6f;
  r[0] /= rl; r[2] /= rl;
  const float u[3] = {sun[1] * r[2] - sun[2] * r[1], sun[2] * r[0] - sun[0] * r[2], sun[0] * r[1] - sun[1] * r[0]};
  const float F[3] = {eye[0] + fwd[0] * 72, eye[1], eye[2] + fwd[2] * 72};
  auto snap = [&](const float a[3]) { return std::floor((F[0] * a[0] + F[1] * a[1] + F[2] * a[2]) / STEP + 0.5f) * STEP; };
  const float ka = snap(r), kb = snap(u), kc = snap(sun);
  if (shKey[0] == ka && shKey[1] == kb && shKey[2] == kc && shKey[3] == sun[0] && shKey[4] == sun[1] && shKey[5] == sun[2]) return;
  shKey[0] = ka; shKey[1] = kb; shKey[2] = kc; shKey[3] = sun[0]; shKey[4] = sun[1]; shKey[5] = sun[2];
  const float C[3] = {r[0] * ka + u[0] * kb + sun[0] * kc, r[1] * ka + u[1] * kb + sun[1] * kc, r[2] * ka + u[2] * kb + sun[2] * kc};
  const float from[3] = {C[0] + sun[0] * 500, C[1] + sun[1] * 500, C[2] + sun[2] * 500}, up[3] = {0, 1, 0};
  Mat4 P = Mat4::identity();
  const float zn = 1, zf = 1000;
  P.m[0] = 1 / R; P.m[5] = 1 / R; P.m[10] = -2 / (zf - zn); P.m[14] = -(zf + zn) / (zf - zn);
  shVP = P * Mat4::lookAt(from, C, up);
  GLint was = 0;
  glGetIntegerv(GL_FRAMEBUFFER_BINDING, &was);
  glBindFramebuffer(GL_FRAMEBUFFER, shFbo);
  glViewport(0, 0, 2048, 2048);
  glClear(GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST); glDepthFunc(GL_LEQUAL); glDepthMask(GL_TRUE);
  glEnable(GL_POLYGON_OFFSET_FILL);
  glPolygonOffset(2.0f, 4.0f);
  glUniform1i(uPass, 1);
  glUniformMatrix4fv(uVP, 1, GL_FALSE, shVP.m);
  setDents(nullptr);
  drawMesh(corridor, Mat4::identity());
  drawMesh(scenery, Mat4::identity());
  // the woods cast too: the same draw, seen from the sun
  if (dress && treeShadows) { dress->frame(shVP, eye, L, time); dress->drawShadow(); glUseProgram(prog); }
  glDisable(GL_POLYGON_OFFSET_FILL);
  glUniform1i(uPass, 0);
  glBindFramebuffer(GL_FRAMEBUFFER, (GLuint)was);
  glViewport(0, 0, post ? sw() : W, post ? sh() : H);
}

// Develop the picture: bloom from what is brighter than white, the film curve
// and the grade, then anti-aliasing and the lens, onto the screen.
void Renderer::endScene(double time) {
  PROF.mark(7);
  if (!sceneOpen) return;
  sceneOpen = false;
  glDisable(GL_DEPTH_TEST); glDisable(GL_BLEND); glDepthMask(GL_FALSE);
  glBindVertexArray(fsVao);
  glActiveTexture(GL_TEXTURE0);
  const int bw = std::max(1, W / 4), bh = std::max(1, H / 4);
  const float EXPOSURE = 1.0f;
  const float kx = (float)sw() / (float)W, ky = (float)sh() / (float)H;
  glViewport(0, 0, bw, bh);
  glBindFramebuffer(GL_FRAMEBUFFER, bloomFbo[0]);
  glUseProgram(brightProg);
  glBindTexture(GL_TEXTURE_2D, sceneCol);
  glUniform2f(glGetUniformLocation(brightProg, "uPx"), 1.0f / (float)W, 1.0f / (float)H);
  glUniform1f(glGetUniformLocation(brightProg, "uExp"), EXPOSURE);
  glUniform2f(glGetUniformLocation(brightProg, "uK"), kx, ky);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glUseProgram(blurProg);
  const GLint uDir = glGetUniformLocation(blurProg, "uDir");
  for (int it = 0; it < 2; it++) {
    const float sp = it == 0 ? 1.0f : 2.2f;                // the second round is wider: a core and a glow
    glBindFramebuffer(GL_FRAMEBUFFER, bloomFbo[1]); glBindTexture(GL_TEXTURE_2D, bloomTex[0]);
    glUniform2f(uDir, sp / (float)bw, 0); glDrawArrays(GL_TRIANGLES, 0, 3);
    glBindFramebuffer(GL_FRAMEBUFFER, bloomFbo[0]); glBindTexture(GL_TEXTURE_2D, bloomTex[1]);
    glUniform2f(uDir, 0, sp / (float)bh); glDrawArrays(GL_TRIANGLES, 0, 3);
  }
  glViewport(0, 0, W, H);
  glBindFramebuffer(GL_FRAMEBUFFER, ldrFbo);
  glUseProgram(compProg);
  glUniform1i(glGetUniformLocation(compProg, "uTex"), 0); glUniform1i(glGetUniformLocation(compProg, "uBloom"), 1);
  glUniform1f(glGetUniformLocation(compProg, "uExp"), EXPOSURE);
  glUniform2f(glGetUniformLocation(compProg, "uK"), kx, ky);
  glUniform2f(glGetUniformLocation(compProg, "uPx"), 1.0f / (float)W, 1.0f / (float)H);
  glUniform1f(glGetUniformLocation(compProg, "uSharp"), scale < 0.999f ? (1.0f - scale) * 1.6f : 0.0f);
  glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D, bloomTex[0]);
  glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, sceneCol);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);                  // the screen, or the photograph being taken
  glUseProgram(fxaaProg);
  glBindTexture(GL_TEXTURE_2D, ldrTex);
  glUniform2f(glGetUniformLocation(fxaaProg, "uPx"), 1.0f / (float)W, 1.0f / (float)H);
  glUniform1f(glGetUniformLocation(fxaaProg, "uTime"), (float)time);
  glDrawArrays(GL_TRIANGLES, 0, 3);
  glBindVertexArray(0);
  glDepthMask(GL_TRUE); glEnable(GL_DEPTH_TEST);
  glUseProgram(prog);
  glEndQuery(GL_TIME_ELAPSED);
  gpuAt ^= 1;
  if (PROF.on && PROF.frames % 100 == 0) std::fprintf(stderr, "governor: GPU %.1f ms a frame, drawing at %.0f%%\n", gpuMs, scale * 100);
  PROF.mark(6);
}

void Renderer::drawWorld(const FrameIn &f) {
  const Car &car = *f.car;
  const Spec &S = *f.spec;
  Look L = f.look;
  PROF.frames++; PROF.begin();
  if (post) {
    // A HARDER SUN. With a film curve behind it the sun can be what it is —
    // well over paper white — and the shade can be shade.
    ensurePost();
    for (int k = 0; k < 3; k++) { L.sunCol[k] *= 1.50f; L.skyAmb[k] *= 0.95f; L.gndAmb[k] *= 0.92f; }
    glBindFramebuffer(GL_FRAMEBUFFER, sceneFbo);
    sceneOpen = true;
    // what the last frames cost the GPU decides how large this one is drawn
    if (!gpuQ[0]) glGenQueries(2, gpuQ);
    if (gpuN > 0 || gpuAt > 0) {
      GLuint64 ns = 0; GLint ok = 0;
      glGetQueryObjectiv(gpuQ[gpuAt ^ 1], GL_QUERY_RESULT_AVAILABLE, &ok);
      if (ok) { glGetQueryObjectui64v(gpuQ[gpuAt ^ 1], GL_QUERY_RESULT, &ns); gpuSum += ns / 1e6; gpuN++; }
    }
    if (gpuN >= 20) {
      gpuMs = gpuSum / gpuN; gpuSum = 0; gpuN = 0;
      if (scalePin > 0) scale = scalePin;
      else if (gpuMs > 14.5) scale = std::max(0.75f, scale - (gpuMs > 19 ? 0.10f : 0.05f));
      else if (gpuMs < 10.5) scale = std::min(1.0f, scale + 0.05f);
    }
    if (scalePin > 0) scale = scalePin;
    glBeginQuery(GL_TIME_ELAPSED, gpuQ[gpuAt]);
    glViewport(0, 0, sw(), sh());
  } else
  glViewport(0, 0, W, H);
  glClearColor(L.fog[0], L.fog[1], L.fog[2], 1);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glDisable(GL_CULL_FACE);
  glDisable(GL_BLEND);
  glUseProgram(prog);
  glUniform1i(uPass, 0);
  glUniform1f(uHdr, post ? (std::getenv("XBR_SHDEBUG") ? 2.0f : 1.0f) : 0.0f);
  glUniform1f(uShOn, 0.0f);

  // ---- where the car is, in GL space
  // A grounded single-seater pitches and rolls by fractions of a degree. That
  // is real, and invisible; scale it so the eye can read weight moving — from
  // OUTSIDE. From the seat the horizon tips by what the car really does.
  const float gain = (car.airborne || f.camMode == 0) ? 1.0f : 3.0f;
  const float carY = (float)(f.groundH + std::max(0.0, car.z));
  const float gp = car.airborne ? 0.0f : (float)f.gPitch, gr = car.airborne ? 0.0f : (float)f.gRoll;
  frameT = f.time; frameDt = (float)f.dt;
  // a camera bolted to the car rides on its springs with it: a landing is felt in the picture
  const Mat4 carM = Mat4::translate((float)car.x, carY + suspOf(car, S).s, (float)-car.y)
                  * Mat4::rotY((float)car.hdg) * Mat4::rotZ(gp + (float)car.pitch * gain) * Mat4::rotX(gr + (float)car.roll * gain);

  // ---- camera: the browser game's own rigs (js/render.js), each with its one
  // fixed lens — "no fov resizing, this is for a simrig".
  //   0 ONBOARD  the driver's eyes      1 CHASE   4.9 m back, 1.28 up
  //   2 NOSE     on the nose cone       3 T-CAM   the broadcast onboard
  float eye[3], at[3], up[3] = {0, 1, 0}, fov = 62;
  const float shift = (float)(S.a - S.L / 2);        // car.js measures from mid-wheelbase, the sim from the CG
  if (f.camMode != 1) {
    float e[3], aim = 24, drop = 0.22f;
    if (f.camMode == 0) {
      if (packCar) { const PackInfo pi = packInfo(*packCar); e[0] = pi.eye[0] + shift; e[1] = pi.eye[1]; e[2] = pi.eye[2]; drop = 1.1f; }
      else if (carCabin) { e[0] = carEye[0]; e[1] = carEye[1]; e[2] = carEye[2]; drop = 1.1f; }
      else { e[0] = onboardX + shift; e[1] = onboardX > 0 ? camFloor[0] + 0.06f : std::max(1.19f, camFloor[0]); e[2] = 0; }        // no cabin to sit in: above the airbox, as the JS does
    } else if (f.camMode == 2) { e[0] = 1.62f + shift; e[1] = packCar ? 0.46f : std::max(0.46f, camFloor[1]); e[2] = 0; aim = 26; }
    else { e[0] = -0.62f + shift; e[1] = packCar ? 0.93f : std::max(0.93f, camFloor[2]); e[2] = 0; drop = 1.0f; fov = 50; }
    const float t[3] = {e[0] + aim, e[1] - drop, 0};
    const float u[3] = {0, 1, 0};
    xform(carM, e, 1, eye); xform(carM, t, 1, at); xform(carM, u, 0, up);
  } else {
    fov = 55;
    double d = car.hdg - camYaw;
    while (d > PI) d -= 2 * PI;
    while (d < -PI) d += 2 * PI;
    if (!camReady) { camYaw = car.hdg; camReady = true; }
    else camYaw += d * std::min(1.0, f.dt * 7.0);
    const double cx = std::cos(camYaw), cy = std::sin(camYaw);
    eye[0] = (float)(car.x - cx * 4.9); eye[1] = carY + 1.28f; eye[2] = (float)-(car.y - cy * 4.9);
    at[0] = (float)(car.x + cx * 15); at[1] = carY + 0.62f; at[2] = (float)-(car.y + cy * 15);
  }
  const Mat4 proj = Mat4::perspective(fov * (float)PI / 180, (float)W / (float)std::max(1, H), 0.12f, 12000.0f);
  const Mat4 view = Mat4::lookAt(eye, at, up);
  const Mat4 VP = proj * view;
  static const bool noSh = std::getenv("XBR_NOSH") != nullptr;
  if (std::getenv("XBR_NOTREESH")) treeShadows = false;
  if (post && !noSh && L.sun[1] / sl0(L.sun) > 0.10f && L.sunCol[0] + L.sunCol[1] + L.sunCol[2] > 0.9f) {
    const float fl = std::sqrt((at[0] - eye[0]) * (at[0] - eye[0]) + (at[2] - eye[2]) * (at[2] - eye[2])) + 1e-6f;
    const float fwd[3] = {(at[0] - eye[0]) / fl, 0, (at[2] - eye[2]) / fl};
    renderShadow(L, eye, fwd, f.time);
    glUniform1f(uShOn, 1.0f);
    glUniformMatrix4fv(uShVP, 1, GL_FALSE, shVP.m);
  }
  PROF.mark(0);
  glActiveTexture(GL_TEXTURE3); glBindTexture(GL_TEXTURE_2D, shTex); glActiveTexture(GL_TEXTURE0);
  if (dress) dress->frame(VP, eye, L, f.time);
  // lamps on when it is dark, or raining hard enough that you would
  {
    const float on = std::max(L.night, L.rain > 0.3f ? 0.6f : 0.0f);
    const float hx = (float)std::cos(car.hdg), hz = (float)-std::sin(car.hdg);
    glUniform3f(uLampPos, (float)car.x + hx * 1.4f, carY + 0.55f, (float)-car.y + hz * 1.4f);
    const float dl = std::sqrt(1.0f + 0.045f * 0.045f);
    glUniform3f(uLampDir, hx / dl, -0.045f / dl, hz / dl);
    glUniform1f(uLampOn, on);
    glUniform1f(uTime, (float)std::fmod(f.time, 10000.0));
    glUniform1f(uCloud, L.cloud); glUniform1f(uNight, L.night);
  }
  curVP = VP; curLook = L;
  for (int k = 0; k < 3; k++) curEye[k] = eye[k];
  glUniformMatrix4fv(uVP, 1, GL_FALSE, VP.m);
  glUniform3f(uEye, eye[0], eye[1], eye[2]);
  glUniform1i(uHasTex, hasTex ? 1 : 0);
  glUniform3f(uOrigin, std::floor(eye[0] / 96.0f) * 96.0f, 0.0f, std::floor(eye[2] / 96.0f) * 96.0f);
  if (hasTex) {
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D_ARRAY, texCol);
    glActiveTexture(GL_TEXTURE2); glBindTexture(GL_TEXTURE_2D_ARRAY, texNrm);
    glActiveTexture(GL_TEXTURE0);
  }
  const float sl = std::sqrt(L.sun[0] * L.sun[0] + L.sun[1] * L.sun[1] + L.sun[2] * L.sun[2]);
  glUniform3f(uSun, L.sun[0] / sl, L.sun[1] / sl, L.sun[2] / sl);
  glUniform3fv(uSunCol, 1, L.sunCol); glUniform3fv(uSkyAmb, 1, L.skyAmb); glUniform3fv(uGndAmb, 1, L.gndAmb);
  glUniform3fv(uFog, 1, L.fog); glUniform3fv(uSkyTop, 1, L.skyTop);
  glUniform1f(uFogK, L.fogK); glUniform1f(uWet, L.wet);
  glUniform3f(uPaint, 0.78f, 0.06f, 0.08f);
  setDents(nullptr);

  // NEAREST FIRST. Whatever is drawn early hides what is drawn later before
  // its pixels are worked out, and the pixels are what this GPU pays for: the
  // car, then the circuit, the scenery, the woods, the land, and the sky last.
  glEnable(GL_DEPTH_TEST);
  glDepthMask(GL_TRUE);
  glDepthFunc(GL_LEQUAL);
  const float RED[3] = {0.78f, 0.06f, 0.08f};
  drawCar(car, S, f.groundH, f.gPitch, f.gRoll, f.paint[0] < 0 ? RED : f.paint, f.wheelAngle, f.camMode != 0);
  glBindVertexArray(0);
  glUseProgram(prog);
  glUniform3f(uPaint, 0.78f, 0.06f, 0.08f);
  setDents(nullptr);
  PROF.mark(4);

  drawMesh(corridor, Mat4::identity());
  drawMesh(scenery, Mat4::identity());
  PROF.mark(2);
  if (dress) dress->drawWorld();
  PROF.mark(3);

  // The land, pushed a little AWAY in depth: where it runs level with the
  // circuit the circuit wins, and a hill that is really in the way still hides
  // what is behind it.
  glEnable(GL_POLYGON_OFFSET_FILL);
  glPolygonOffset(1.5f, 6.0f);
  drawMesh(sea, Mat4::identity());
  drawMesh(ground, Mat4::identity());
  glDisable(GL_POLYGON_OFFSET_FILL);
  // the sky: behind everything, and it writes no depth
  glDepthMask(GL_FALSE);
  drawMesh(sky, Mat4::translate(eye[0], eye[1], eye[2]) * Mat4::scale(5000, 5000, 5000));
  PROF.mark(1);

  glEnable(GL_POLYGON_OFFSET_FILL);
  glPolygonOffset(-2.0f, -6.0f);
  drawMesh(decals, Mat4::identity());
  if (f.showLine) drawMesh(lineMesh, Mat4::identity());
  // a soft dark patch under the car: the cheapest thing that glues it down
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  const float lift = (float)std::max(0.0, car.z);
  drawMesh(shadow, Mat4::translate((float)car.x, (float)f.groundH + 0.004f, (float)-car.y) * Mat4::rotY((float)car.hdg) * Mat4::rotZ((float)f.gPitch) * Mat4::rotX((float)f.gRoll),
           0.42f / (1.0f + lift * 1.5f));
  glDepthMask(GL_TRUE);
  glDisable(GL_BLEND);
  glDisable(GL_POLYGON_OFFSET_FILL);
  PROF.mark(5);
}

// ---------------------------------------------------------------------------
// HUD: the game's own typefaces (data/fonts — Anton for the big figures, Rubik
// for the small print), rasterised once into an atlas with FreeType. If a font
// cannot be read the built-in 5x7 face below is drawn into the same atlas, so
// the HUD never goes blank.
// ---------------------------------------------------------------------------
static const unsigned char *glyph(char ch) {
  static const unsigned char D[][7] = {
    {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E}, {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E}, {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
    {0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E}, {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02}, {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
    {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E}, {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}, {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
    {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C}};
  static const unsigned char A[][7] = {
    {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}, {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E}, {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E},
    {0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C}, {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F}, {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10},
    {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F}, {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}, {0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E},
    {0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C}, {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11}, {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F},
    {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11}, {0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11}, {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
    {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10}, {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D}, {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11},
    {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E}, {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04}, {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
    {0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04}, {0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A}, {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11},
    {0x11, 0x11, 0x11, 0x0A, 0x04, 0x04, 0x04}, {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F}};
  static const unsigned char DOT[7] = {0, 0, 0, 0, 0, 0x0C, 0x0C}, COLON[7] = {0, 0x0C, 0x0C, 0, 0x0C, 0x0C, 0};
  static const unsigned char DASH[7] = {0, 0, 0, 0x1F, 0, 0, 0}, SLASH[7] = {0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10};
  static const unsigned char PCT[7] = {0x19, 0x1A, 0x02, 0x04, 0x08, 0x0B, 0x13}, PLUS[7] = {0, 0x04, 0x04, 0x1F, 0x04, 0x04, 0};
  static const unsigned char BANG[7] = {0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04}, COMMA[7] = {0, 0, 0, 0, 0x0C, 0x04, 0x08};
  static const unsigned char NONE[7] = {0, 0, 0, 0, 0, 0, 0};
  if (ch >= '0' && ch <= '9') return D[ch - '0'];
  if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 'a' + 'A');
  if (ch >= 'A' && ch <= 'Z') return A[ch - 'A'];
  switch (ch) {
    case '.': return DOT; case ':': return COLON; case '-': return DASH; case '/': return SLASH;
    case '%': return PCT; case '+': return PLUS; case '!': return BANG; case ',': return COMMA;
  }
  return NONE;
}


static const int ATLAS_W = 2048, ATLAS_H = 1024, FONT_PX = 64, N_FONTS = 5;

bool Renderer::loadFonts(const std::string &dataDir) {
  std::vector<unsigned char> px((size_t)ATLAS_W * ATLAS_H, 0);
  // a block of solid texels for rectangles
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) px[(size_t)y * ATLAS_W + x] = 255;
  int penX = 8, penY = 0, rowH = 0;
  FT_Library ft = nullptr;
  if (FT_Init_FreeType(&ft)) ft = nullptr;
  // 0 Anton (the loud capitals), 1 Rubik (reading), 2 Knewave (the marker pen),
  // 3 and 4 the race HUD's face: the browser game asks for the system sans in
  // italic 900, which on this machine is Liberation Sans Bold Italic.
  const std::string files[N_FONTS] = {dataDir + "/fonts/anton.woff2", dataDir + "/fonts/rubik.woff2", dataDir + "/fonts/knewave.woff2",
                                      "/usr/share/fonts/liberation/LiberationSans-BoldItalic.ttf",
                                      "/usr/share/fonts/liberation/LiberationSans-Bold.ttf"};
  bool allOk = true;
  for (int f = 0; f < N_FONTS; f++) {
    Font &F = fonts[f];
    FT_Face face = nullptr;
    bool ok = ft && !FT_New_Face(ft, files[f].c_str(), 0, &face);
    if (!ok && f >= 3) ok = ft && !FT_New_Face(ft, files[1].c_str(), 0, &face);     // no Liberation: Rubik stands in
    if (ok && (f == 1)) {
      // Rubik is a variable font: ask for the semi-bold the HUD is set in
      FT_MM_Var *mm = nullptr;
      if (!FT_Get_MM_Var(face, &mm) && mm) {
        std::vector<FT_Fixed> co(mm->num_axis);
        for (unsigned i = 0; i < mm->num_axis; i++) co[i] = mm->axis[i].tag == FT_MAKE_TAG('w', 'g', 'h', 't') ? 700 * 65536 : mm->axis[i].def;
        FT_Set_Var_Design_Coordinates(face, mm->num_axis, co.data());
        FT_Done_MM_Var(ft, mm);
      }
    }
    if (ok) ok = !FT_Set_Pixel_Sizes(face, 0, FONT_PX);
    if (!ok) { allOk = false; std::fprintf(stderr, "xbr: cannot read %s — using the built-in face\n", files[f].c_str()); }
    F.asc = ok ? (float)(face->size->metrics.ascender / 64.0) : FONT_PX * 0.8f;
    F.desc = ok ? (float)(-face->size->metrics.descender / 64.0) : FONT_PX * 0.2f;
    for (int c = 32; c < 127; c++) {
      Glyph &G = F.g[c - 32];
      int w = 0, h = 0;
      std::vector<unsigned char> bm;
      if (ok && !FT_Load_Char(face, (FT_ULong)c, FT_LOAD_RENDER)) {
        const FT_GlyphSlot sl = face->glyph;
        w = (int)sl->bitmap.width; h = (int)sl->bitmap.rows;
        bm.resize((size_t)w * h);
        for (int y = 0; y < h; y++) std::memcpy(&bm[(size_t)y * w], sl->bitmap.buffer + y * sl->bitmap.pitch, (size_t)w);
        G.bx = (float)sl->bitmap_left; G.by = (float)sl->bitmap_top; G.adv = (float)(sl->advance.x / 64.0);
      } else {
        const int K = 8;                         // each 5x7 dot is 8 texels
        const unsigned char *g = glyph((char)c);
        w = 5 * K; h = 7 * K;
        bm.assign((size_t)w * h, 0);
        for (int r = 0; r < 7; r++) for (int col = 0; col < 5; col++) if (g[r] & (0x10 >> col))
          for (int y = 0; y < K; y++) for (int x = 0; x < K; x++) bm[(size_t)(r * K + y) * w + col * K + x] = 255;
        G.bx = 0; G.by = (float)h; G.adv = (float)(6 * K);
      }
      if (penX + w + 2 > ATLAS_W) { penX = 0; penY += rowH + 2; rowH = 0; }
      if (penY + h + 2 > ATLAS_H) { w = h = 0; }
      for (int y = 0; y < h; y++) std::memcpy(&px[(size_t)(penY + y) * ATLAS_W + penX], &bm[(size_t)y * w], (size_t)w);
      G.x = (float)penX; G.y = (float)penY; G.w = (float)w; G.h = (float)h;
      penX += w + 2; rowH = std::max(rowH, h);
    }
    F.cap = F.g['H' - 32].h > 0 ? F.g['H' - 32].h : FONT_PX * 0.7f;
    if (face) FT_Done_Face(face);
  }
  if (ft) FT_Done_FreeType(ft);
  glGenTextures(1, &fontTex);
  glBindTexture(GL_TEXTURE_2D, fontTex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, ATLAS_W, ATLAS_H, 0, GL_RED, GL_UNSIGNED_BYTE, px.data());
  glGenerateMipmap(GL_TEXTURE_2D);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  return allOk;
}

void Renderer::hudBegin() { hud.clear(); rotOn = false; hudAlpha = 1; }
void Renderer::hudVert(float x, float y, float u, float v, const float c[4]) {
  if (rotOn) { const float dx = x - rotCx, dy = y - rotCy; x = rotCx + dx * rotC - dy * rotS; y = rotCy + dx * rotS + dy * rotC; }
  hud.insert(hud.end(), {x, y, u / ATLAS_W, v / ATLAS_H, c[0], c[1], c[2], c[3] * hudAlpha});
}
void Renderer::hudRot(float cx, float cy, float deg) {
  rotOn = deg != 0; rotCx = cx; rotCy = cy;
  rotC = std::cos(deg * (float)PI / 180); rotS = std::sin(deg * (float)PI / 180);
}
void Renderer::hudQuad(float x, float y, float w, float h, float u0, float v0, float u1, float v1, const float c[4], float skew) {
  // skew: how far the TOP edge leans right of the bottom, in pixels (italics, slanted plates)
  const float p[6][4] = {{x + skew, y, u0, v0}, {x + w + skew, y, u1, v0}, {x + w, y + h, u1, v1}, {x + skew, y, u0, v0}, {x + w, y + h, u1, v1}, {x, y + h, u0, v1}};
  for (const auto &q : p) hudVert(q[0], q[1], q[2], q[3], c);
}
// a convex polygon, as a fan
void Renderer::poly(const float *xy, int n, const float c[4]) {
  for (int i = 1; i + 1 < n; i++) {
    hudVert(xy[0], xy[1], 2, 2, c); hudVert(xy[i * 2], xy[i * 2 + 1], 2, 2, c); hudVert(xy[i * 2 + 2], xy[i * 2 + 3], 2, 2, c);
  }
}
void Renderer::rrect(float x, float y, float w, float h, float r, const float c[4]) {
  r = std::max(0.0f, std::min(r, std::min(w, h) / 2));
  if (r < 0.5f) { rect(x, y, w, h, c); return; }
  std::vector<float> pts;
  const int S = 6;
  const float cxs[4] = {x + w - r, x + r, x + r, x + w - r}, cys[4] = {y + r, y + r, y + h - r, y + h - r};
  for (int k = 0; k < 4; k++)
    for (int i = 0; i <= S; i++) {
      const float a = -(float)PI / 2 * 0 - (float)(k * PI / 2) - (float)(i * PI / 2 / S);     // from the right, anticlockwise on screen
      pts.push_back(cxs[k] + r * std::cos(a)); pts.push_back(cys[k] + r * std::sin(a));
    }
  poly(pts.data(), (int)pts.size() / 2, c);
}
// a card: a line round a fill
void Renderer::card(float x, float y, float w, float h, float r, float bw, const float fill[4], const float line[4]) {
  rrect(x, y, w, h, r, line);
  rrect(x + bw, y + bw, w - 2 * bw, h - 2 * bw, std::max(0.0f, r - bw), fill);
}
void Renderer::circle(float cx, float cy, float r, const float c[4]) {
  float pts[2 * 28];
  for (int i = 0; i < 28; i++) { const float a = (float)(i * 2 * PI / 28); pts[i * 2] = cx + r * std::cos(a); pts[i * 2 + 1] = cy + r * std::sin(a); }
  poly(pts, 28, c);
}
// a stroked path with round joins and ends
void Renderer::path(const float *xy, int n, float width, const float c[4], bool closed) {
  const int m = closed ? n : n - 1;
  for (int i = 0; i < m; i++) {
    const float *a = xy + i * 2, *b = xy + ((i + 1) % n) * 2;
    float dx = b[0] - a[0], dy = b[1] - a[1];
    const float l = std::sqrt(dx * dx + dy * dy);
    if (l < 1e-4f) continue;
    dx *= width / 2 / l; dy *= width / 2 / l;
    const float q[8] = {a[0] - dy, a[1] + dx, b[0] - dy, b[1] + dx, b[0] + dy, b[1] - dx, a[0] + dy, a[1] - dx};
    poly(q, 4, c);
    if (width > 3) { float o[2 * 8]; for (int k = 0; k < 8; k++) { const float t = (float)(k * PI / 4); o[k * 2] = b[0] + width / 2 * std::cos(t); o[k * 2 + 1] = b[1] + width / 2 * std::sin(t); } poly(o, 8, c); }
  }
}
// CSS-shaped text: `size` is the font-size in pixels, y the top of a line box
// one `size` tall, `track` the letter-spacing in em. Returns the width drawn.
float Renderer::widthPx(float size, const std::string &s, int font, float track) const {
  const Font &F = fonts[font];
  const float k = size / FONT_PX;
  float w = 0;
  for (char ch : s) { const int c = (unsigned char)ch; w += (c >= 32 && c < 127 ? F.g[c - 32].adv : F.g[0].adv) * k + track * size; }
  return s.empty() ? 0 : w - track * size;
}
float Renderer::textPx(float x, float y, float size, const std::string &s, const float c[4], Align al, int font, float track) {
  const Font &F = fonts[font];
  const float k = size / FONT_PX, w = widthPx(size, s, font, track);
  if (al == CENTRE) x -= w / 2; else if (al == RIGHT) x -= w;
  const float base = y + (size - (F.asc + F.desc) * k) / 2 + F.asc * k;
  for (char ch : s) {
    const int ci = (unsigned char)ch;
    const Glyph &G = F.g[ci >= 32 && ci < 127 ? ci - 32 : 0];
    if (G.w > 0) hudQuad(x + G.bx * k, base - G.by * k, G.w * k, G.h * k, G.x, G.y, G.x + G.w, G.y + G.h, c);
    x += G.adv * k + track * size;
  }
  return w;
}
void Renderer::rect(float x, float y, float w, float h, const float c[4]) { hudQuad(x, y, w, h, 1, 1, 3, 3, c); }
// `px` is a seventh of the capital height, as it was when the face was 5x7:
// every call site's sizes and positions still mean what they meant.
int Renderer::fontFor(float px, int font) const { return font >= 0 ? font : (7 * px >= 30 ? 0 : 1); }
float Renderer::textWidth(float px, const std::string &s, int font) const {
  const Font &F = fonts[fontFor(px, font)];
  const float k = 7 * px / F.cap;
  float w = 0;
  for (char ch : s) { const int c = (unsigned char)ch; w += (c >= 32 && c < 127 ? F.g[c - 32].adv : F.g[0].adv) * k; }
  return w;
}
void Renderer::text(float x, float y, float px, const std::string &s, const float c[4], Align al, int font) {
  const Font &F = fonts[fontFor(px, font)];
  const float k = 7 * px / F.cap;
  if (al == CENTRE) x -= textWidth(px, s, font) / 2;
  else if (al == RIGHT) x -= textWidth(px, s, font);
  const float base = y + 7 * px;
  for (char ch : s) {
    const int ci = (unsigned char)ch;
    const Glyph &G = F.g[ci >= 32 && ci < 127 ? ci - 32 : 0];
    if (G.w > 0) hudQuad(x + G.bx * k, base - G.by * k, G.w * k, G.h * k, G.x, G.y, G.x + G.w, G.y + G.h, c);
    x += G.adv * k;
  }
}
void Renderer::hudEnd() {
  if (hud.empty()) return;
  glDisable(GL_DEPTH_TEST);
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glUseProgram(hudProg);
  glUniform2f(uHudSize, (float)W, (float)H);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, fontTex);
  glBindVertexArray(hudVao);
  glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(hud.size() * sizeof(float)), hud.data(), GL_STREAM_DRAW);
  glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(hud.size() / 8));
  glBindVertexArray(0);
  glDisable(GL_BLEND);
}

// ---------------------------------------------------------------------------
// Offscreen
// ---------------------------------------------------------------------------
bool Renderer::beginOffscreen(int w, int h) {
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glGenRenderbuffers(1, &fboCol);
  glBindRenderbuffer(GL_RENDERBUFFER, fboCol);
  glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, w, h);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, fboCol);
  glGenRenderbuffers(1, &fboDepth);
  glBindRenderbuffer(GL_RENDERBUFFER, fboDepth);
  glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, w, h);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, fboDepth);
  W = w; H = h;
  return glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
}
bool Renderer::writePPM(const std::string &path) {
  std::vector<unsigned char> px((size_t)W * H * 3);
  glPixelStorei(GL_PACK_ALIGNMENT, 1);
  glReadPixels(0, 0, W, H, GL_RGB, GL_UNSIGNED_BYTE, px.data());
  std::ofstream f(path, std::ios::binary);
  if (!f) return false;
  f << "P6\n" << W << " " << H << "\n255\n";
  for (int y = H - 1; y >= 0; y--) f.write((const char *)&px[(size_t)y * W * 3], W * 3);
  return (bool)f;
}

}  // namespace xbr
