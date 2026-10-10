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
#include "props.hpp"
#include "collide.hpp"

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
uniform vec3 uLampPos, uLampDir; uniform float uLampOn, uTime, uCloud, uNight, uGhost;
uniform sampler2D uMirror; uniform float uMirOn;
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
  if (k == 13) {
    // A MIRROR ON THE CAR: the picture taken looking back (Renderer::mirrorBegin),
    // the left third of it in the left glass and the right third in the right.
    if (uMirOn > 0.5) {
      vec2 mu = vec2(mix(0.03, 0.57, vC.b) + vC.r * 0.40, 0.15 + vC.g * 0.70);
      o = vec4(texture(uMirror, vec2(1.0 - mu.x, mu.y)).rgb * 0.92 + 0.015, uAlpha); return;
    }
    c = vec3(0.72, 0.77, 0.82); k = 6;          // no picture (the chase view, the mirror's own pass): plain glass
  }
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
  float pool = 0.0;
  if (uWet > 0.0 && (k == 1 || k == 10 || k == 4) && n.y > 0.5) {
    // (Adam: "the pavement should get wet and reflective") The water does not
    // lie evenly: it stands in the low places, and those are the mirrors.
    pool = smoothstep(0.42, 0.68, vnoise(vW.xz * 0.23) * 0.65 + vnoise(vW.xz * 0.9 + 3.7) * 0.35) * smoothstep(0.35, 1.0, uWet);
    c *= 1.0 - (0.46 + 0.14 * pool) * uWet;
    shine = uWet * (0.10 + 0.90 * pow(1.0 - max(dot(n, V), 0.0), 3.2)) * (0.55 + 0.45 * pool);
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
  if (shine > 0.0) {
    // what a wet road mirrors: the sky where you are looking along it, lighter at the horizon
    vec3 Rw = reflect(-V, mix(n, vec3(0.0, 1.0, 0.0), 0.6 + 0.4 * pool));
    vec3 skyR = mix(uFog * 1.08, uSkyTop, pow(clamp(Rw.y, 0.0, 1.0), 0.55));
    lit = mix(lit, skyR, clamp(shine * 0.95, 0.0, 0.88));
    vec3 hw = normalize(uSun + V);
    lit += uSunCol * (pow(max(dot(n, hw), 0.0), 90.0) * 0.9 + pow(max(dot(n, hw), 0.0), 700.0) * 3.0 * pool) * uWet * vis;
    // your own lamps come back off the water as a long smear toward you
    if (uLampOn > 0.0) {
      vec3 ld = vW - uLampPos; float dl = length(ld);
      float ahead = max(dot(ld / max(dl, 0.01), uLampDir), 0.0);
      lit += vec3(0.80, 0.86, 0.92) * uLampOn * pow(ahead, 30.0) * shine * 1.6 / (1.0 + dl * 0.03);
    }
  }
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
  if (uGhost > 0.0) {
    // A GHOST: nothing of it is lit by the world. It is its own light, thin where
    // you look through it and bright where you look along it; the fog takes it late.
    float fr = pow(1.0 - max(dot(n, V), 0.0), 1.6);
    float fl = 0.85 + 0.15 * sin(uTime * 9.0 + vW.y * 7.0);
    o = vec4(vec3(0.42, 1.0, 0.86) * (0.35 + 2.6 * fr) * fl, uGhost * (0.16 + 0.84 * fr) * (1.0 - 0.6 * f));
    return;
  }
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
in vec2 vU; uniform sampler2D uTex, uBloom, uDepth; uniform float uExp, uSharp, uFar; uniform vec2 uK, uPx; out vec4 o;
// RAIN (Adam: "the rain overlay is also in my car", "i want the raindrops on my windshield"):
// uRain how hard it is falling; uGlass 1 when you are looking through a screen or a visor;
// uDrops how much water stands on it; uWipe where the blade is across its sweep (-1: parked)
// and uWiped 1 while it is on its way out (what is behind it is clear).
uniform float uRain, uGlass, uDrops, uWipe, uWiped, uRainT, uRainV;
float rhash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// THE GLASS, as one block of constants (render.hpp RainSystemCB, five vec4s, filled every frame from the physics):
//   [0] xyz the air over the glass, m/s, in the glass's own axes (x to the right, y up the glass, z off it)   w the car's speed
//   [1] x lateral g (+ = a left-hander)   y longitudinal g (+ = accelerating)   z the screen's rake, radians from flat   w the wiper's angle, radians from upright
//   [2] x water on the glass before the last sweep (0..1)   y how fast it gathers, per second   z seconds of rain since that sweep began   w how long the sweep takes
//   [3] xy how far the running drops have travelled (integrated on the CPU, so a change of wind never makes them jump)   z time   w 1 = you are looking through glass
//   [4] xyz the brightest light, in view space   w how bright it is
uniform vec4 uRainCB[5];
// VORONOI. For a point p: the nearest of the jittered feature points of the 3x3 cells round it.
// Returns xy = the vector from that feature point to p, z = a random number of its own (which drop it is).
vec3 voronoi(vec2 p){
  vec2 ip = floor(p), fp = fract(p);
  vec3 best = vec3(0.0, 0.0, 0.0); float bd = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)), id = ip + g;
    vec2 o = vec2(rhash(id + 3.1), rhash(id + 7.7)) * 0.72 + 0.14;
    vec2 r = fp - g - o;
    float d = dot(r, r);
    float take = step(d, bd);                       // no branch: keep the nearer of the two
    bd = mix(bd, d, take); best = mix(best, vec3(r, rhash(id + 1.3)), take);
  }
  return best;
}
// A DROP IS A CAP OF A SPHERE. With r the vector from its centre (in units of its radius R) and
// q = |r| / R, its height is h(q) = sqrt(1 - q^2) inside the rim and 0 outside. The surface normal
// is (-dh/dx, -dh/dy, 1) normalised, and dh/dx = -(r.x / R^2) / h — so the normal leans OUTWARD,
// gently at the crown and steeply at the rim, which is exactly how a drop bends what is behind it.
// Returns xy = the normal's lean (0 at the crown, up to `bulge` at the rim), z = the drop's cover (0 or 1, soft).
vec3 dropNormal(vec2 r, float R, float bulge){
  float q2 = dot(r, r) / (R * R);
  float inside = smoothstep(1.0, 0.86, q2);
  float h = sqrt(max(1.0 - q2, 0.02));
  return vec3(r / (R * h) * bulge * inside, inside);
}
// MOTION BLUR (js/speedfx.js SpeedBlur): the camera's own travel, known, and every pixel's real distance
uniform vec3 uMbVel; uniform float uMbTan, uMbAsp, uMbAmt, uMbShutter, uMbMax; uniform vec4 uMbCar[8]; uniform int uMbN; uniform vec4 uMbHole;
vec3 viewAt(vec2 v01, vec2 us){
  float z = texture(uDepth, us).r * 2.0 - 1.0;
  float d = z >= 0.99999 ? 3000.0 : 2.0 * 0.12 * 12000.0 / (12000.0 + 0.12 - z * (12000.0 - 0.12));
  vec2 n = v01 * 2.0 - 1.0;
  return vec3(n.x * uMbTan * uMbAsp * d, n.y * uMbTan * d, -d);
}
// a car travels WITH the camera (yours) or nearly (a rival beside you): a real lens does not smear it
bool inCar(vec3 P){ for (int i = 0; i < uMbN; i++) if (distance(P, uMbCar[i].xyz) < uMbCar[i].w) return true; return false; }
// ...and the road right round it comes back into the blur gradually, not at a line
float nearCar(vec3 P){ float k = 1.0; for (int i = 0; i < uMbN; i++) k = min(k, smoothstep(uMbCar[i].w, uMbCar[i].w * 2.2, distance(P, uMbCar[i].xyz))); return k; }
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 u = min(vU * uK, uK - uPx * 0.5);
  // ---- WATER ON THE GLASS, in three layers (Adam's sheet, 2026-10-09):
  //   A  standing drops: surface tension holds them where they landed; as the air
  //      over the glass rises they flatten, and past a speed they are gone
  //   B  running drops: the ones the air has torn free, drawn out into streaks along
  //      V = gravity down the rake + the air over the glass + what the g-forces add
  //   C  the wiper: a fan, by angle; whatever the blade has passed starts again from dry
  float wet0 = 0.0, blade = 0.0, dz = 0.0, spec0 = 0.0;
  if (uRain > 0.01 || uRainCB[2].x > 0.01 || uRainCB[2].z > 0.01 || uWipe >= 0.0) dz = viewAt(vU, u).z * -1.0;
  if (uRainCB[3].w > 0.5 && dz > 1.15) {
    float speed = uRainCB[0].w, rake = uRainCB[1].z;
    vec2 P = vU * vec2(uMbAsp, 1.0);
    // ---- C: the fan. Pivot under the middle of the screen; a01 runs 0..1 across the sweep.
    vec2 pv = (vU - vec2(0.5, -0.32)) * vec2(uMbAsp, 1.0);
    float ang = atan(pv.x, pv.y), a01 = ang / 1.9 + 0.5, rad = length(pv);
    float inFan = step(0.42, rad) * step(rad, 1.42) * step(0.0, a01) * step(a01, 1.0);
    float bladeA01 = uRainCB[1].w / 1.9 + 0.5;
    // has the blade been over this pixel on this sweep? on the way out: only behind it. After: everywhere in the fan.
    float passed = inFan * max(step(a01, bladeA01), 1.0 - uWiped) * step(0.0, uRainCB[2].z);
    // water here = what has gathered since the blade passed (it reached a01 that far into the sweep), or what was there before
    float since = max(uRainCB[2].z - a01 * uRainCB[2].w, 0.0);
    float water = mix(clamp(uRainCB[2].x + uRainCB[2].y * uRainCB[2].z, 0.0, 1.0), clamp(uRainCB[2].y * since, 0.0, 1.0), passed);
    blade = (uWipe >= 0.0 ? 1.0 : 0.0) * inFan * smoothstep(0.011, 0.004, abs(a01 - bladeA01));
    // ---- how hard the air is pulling at the drops: 0 parked, 1 by about 150 km/h
    float pull = clamp(speed * 0.024, 0.0, 1.0);
    // ---- the composite velocity over the glass, in screen axes (x right, y up) — what every drop answers to:
    //   gravity pulls down the rake      (0, -9.81 * sin(rake))
    //   the air pushes up and across      uRainCB[0].xy   (already the air RELATIVE to the car: speed AND wind)
    //   lateral g throws them sideways, braking throws them forward — which on a raked screen is UP
    // (Adam: "react to gs and wind": a corner or a gust is seen in the water at once)
    vec2 Vf = vec2(0.0, -9.81 * sin(rake)) * 0.35 + uRainCB[0].xy * vec2(0.42, 0.20) + vec2(-uRainCB[1].x, -uRainCB[1].y * cos(rake)) * 5.2;
    float vlen = length(Vf);
    vec2 dir = Vf / max(vlen, 0.001), across = vec2(-dir.y, dir.x);
    float drive = clamp(vlen * 0.055, 0.0, 1.0);                     // how hard the water is being pushed, 0..1
    // ---- A: standing drops (Adam: "too big, they need to be more blobby, diff sizes").
    // Small, and many: most of them specks, a few of them beads (the radius is a random
    // number raised to a power). None is a circle: its rim is pushed in and out round
    // its edge by two slow waves of its own, and it sags the way it is being pushed.
    vec2 PA = vec2(dot(P, dir) / (1.0 + 0.9 * drive), dot(P, across)) * 38.0;
    vec3 va = voronoi(PA);
    float keepA = step(va.z, water * 0.86 * (1.0 - smoothstep(0.45, 0.95, pull)));
    float sizeA = fract(va.z * 7.31);
    float RA = (0.07 + 0.34 * sizeA * sizeA * sizeA) * (1.0 + 0.35 * pull);
    float angA = atan(va.y, va.x), phA = va.z * 43.0;
    float rimA = 1.0 + 0.24 * sin(angA * 2.0 + phA) + 0.15 * sin(angA * 3.0 - phA * 1.7) + 0.08 * sin(angA * 5.0 + phA * 0.6);
    // sagging: the side the push comes from is flattened, the lee side bulges (va.x runs along the push)
    vec2 rA = va.xy + vec2(-0.22 * drive * RA, 0.0);
    vec3 nA = dropNormal(rA, RA * rimA, 1.0 - 0.6 * pull) * keepA;
    vec2 leanA = dir * nA.x / (1.0 + 0.9 * drive) + across * nA.y;
    // ---- B: running drops (Adam: "streak not just move"). A drop that has broken free is a
    // head with a tail: the head a blob, the tail the water it has left behind it, thinning
    // to nothing. The harder it is driven the longer the tail, and it does not run straight:
    // it wanders from side to side as it finds its way across the glass.
    float broken = smoothstep(0.10, 0.50, pull + abs(uRainCB[1].x) * 0.20 + abs(uRainCB[1].y) * 0.10);   // free once the push beats surface tension
    float tail = 1.6 + 7.0 * drive;                                // how many head-lengths of tail
    vec2 PB = vec2(dot(P, dir), dot(P, across));
    vec2 FB = vec2(dot(uRainCB[3].xy, dir), dot(uRainCB[3].xy, across));
    // lanes across the flow, cells along it; each lane runs at its own pace, and meanders
    float lane = floor(PB.y * 34.0), lh = rhash(vec2(lane, 4.7));
    float alongU = (PB.x - FB.x * (0.55 + 0.9 * lh)) * 34.0 / (tail + 1.6) + lh * 9.0;
    float cellB = floor(alongU), hb = rhash(vec2(lane, cellB));
    float fx = (fract(alongU) - 0.5) * (tail + 1.6);               // along the flow, in head radii: + is the head end
    float fy = (fract(PB.y * 34.0) - 0.5) * 2.0 + 0.30 * sin(PB.x * 21.0 + lh * 40.0 + cellB);   // across, -1..1, with the wander in it
    float keepB = step(hb, water * 0.40 * broken);
    float RBh = 0.40 + 0.45 * fract(hb * 5.17);                    // the head's radius, in lane half-widths: all sizes
    float headX = 0.5 * (tail + 1.6) - 1.2;                        // the head sits at the front of its cell
    float back = max(headX - fx, 0.0);                             // how far behind the head this pixel is
    // the tail's half-width: the head's at the head, nothing at the end, and beaded along the way
    float tw = RBh * mix(0.62, 0.0, clamp(back / tail, 0.0, 1.0)) * (0.80 + 0.20 * sin(back * 5.0 + hb * 30.0));
    float inTail = step(0.0, headX - fx) * smoothstep(tw, tw * 0.55, abs(fy)) * step(0.02, tw);
    vec3 nH = dropNormal(vec2(fx - headX, fy), RBh, 0.95);
    // the tail's surface is a ridge: it leans away from its centre line, across the flow only
    vec2 nT = vec2(0.0, clamp(fy / max(tw, 0.02), -1.0, 1.0) * 0.55) * inTail * (1.0 - nH.z);
    vec3 nB = vec3(nH.xy + nT, max(nH.z, inTail * 0.8)) * keepB;
    vec2 leanB = dir * nB.x + across * nB.y;
    vec2 lean = leanA + leanB;
    float cover = clamp(nA.z + nB.z, 0.0, 1.0);
    // ---- together: the normal of the water, and what it does to the picture behind it
    vec3 N = normalize(vec3(lean, 1.0));
    // REFRACTION: the scene is looked up where the bent ray lands. A drop is a strong
    // little lens, so the picture inside it is the world upside down and small: the
    // offset is against the lean, and large (0.055 of the screen at the rim).
    u = clamp(u - lean * 0.030 * uK * vec2(1.0 / uMbAsp, 1.0), vec2(0.0), uK - uPx * 0.5);
    // SPECULAR: the light (the sun; at night, the lamps) glancing off the water, Blinn-Phong on the drop's normal
    vec3 Ld = normalize(uRainCB[4].xyz), Hh = normalize(Ld + vec3(0.0, 0.0, 1.0));
    spec0 = pow(max(dot(N, Hh), 0.0), 60.0) * uRainCB[4].w * cover;
    wet0 = 0.08 * cover + 0.16 * cover * smoothstep(0.2, 0.9, length(lean));       // the rim of a drop gathers light
  }
  vec3 c = max(texture(uTex, u).rgb, 0.0) * (1.0 + wet0) + vec3(1.0, 0.98, 0.94) * spec0;
  // ---- rain falling in the air: only on what is out there, never on the inside of your own car
  if (uRain > 0.01 && dz > 2.6) {
    float sx = (vU.x + (1.0 - vU.y) * 0.05 * uRainV) * uMbAsp;
    float col = floor(sx * 190.0), hx = rhash(vec2(col, 1.7)), hz = rhash(vec2(col, 9.2));
    float len = (0.05 + 0.10 * uRainV) * (0.6 + hz);
    float fall = fract(uRainT * (1.3 + 1.4 * hz) + hx * 7.0) * (1.0 + len) - len;
    float yy = 1.0 - vU.y;
    float on = step(hx, 0.34 * uRain) * step(fall, yy) * step(yy, fall + len) * smoothstep(0.0, 0.25, fract(sx * 190.0)) * smoothstep(1.0, 0.75, fract(sx * 190.0));
    c = mix(c, vec3(0.82, 0.86, 0.92), on * (0.16 + 0.10 * uRainV) * (uGlass > 0.5 ? 0.6 : 1.0));
  }
  c = mix(c, vec3(0.015), blade * 0.9);
  // 350 km/h, as a camera records it: each pixel streaked along the way the
  // world went past it during the shutter. Nothing at the point you are driving
  // towards, longest in the lower corners; the centre of the frame — where you
  // are looking — stays sharp whatever the numbers say, and so do the cars.
  if (uMbAmt > 0.01 && !(vU.x > uMbHole.x && vU.x < uMbHole.z && vU.y > uMbHole.y && vU.y < uMbHole.w)) {
    vec2 q = (vU - 0.5) * vec2(uMbAsp, 1.0);
    float edge = smoothstep(0.22, 0.78, length(q) / length(vec2(uMbAsp, 1.0) * 0.5)) * uMbAmt;
    if (edge > 0.01) {
      vec3 P0 = viewAt(vU, u);
      if (!inCar(P0)) {
        vec3 P = P0 - uMbVel * uMbShutter;
        if (-P.z > 0.05) {
          vec2 d = vec2(P.x / (-P.z) / (uMbTan * uMbAsp), P.y / (-P.z) / uMbTan) * 0.5 + 0.5 - vU;
          float L = length(d * vec2(uMbAsp, 1.0));
          if (L > uMbMax) d *= uMbMax / L;
          d *= edge * nearCar(P0);
          if (length(d / uPx) > 1.2) {
            vec3 acc = c; float wsum = 1.0;
            for (int i = 0; i < 10; i++) {
              vec2 t = vU + d * ((float(i) + 0.5) / 10.0 - 0.5);
              if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) continue;
              vec2 ts = min(t * uK, uK - uPx * 0.5);
              if (inCar(viewAt(t, ts))) continue;                 // do not smear a car in
              acc += max(texture(uTex, ts).rgb, 0.0); wsum += 1.0;
            }
            c = acc / wsum;
          }
        }
      }
    }
  }
  // THE DISTANCE GOES SOFT (Adam: "add the blur effect at long distance to keep it
  // clean"). A fence four hundred metres off is wires thinner than a pixel, and
  // drawn sharp it crawls. So the far part of the picture is averaged over a
  // small ring, growing from nothing at 140 m to its full width by 650 m. The
  // near field, where you are looking for your braking point, is untouched.
  float soft = 0.0;
  if (uFar > 0.0) {
    float z = texture(uDepth, u).r * 2.0 - 1.0;
    float dist = 2.0 * 0.12 * 12000.0 / (12000.0 + 0.12 - z * (12000.0 - 0.12));    // the projection's near and far
    soft = smoothstep(140.0, 650.0, dist) * step(z, 0.99999);                       // the sky is already as soft as it gets
    if (soft > 0.01) {
      vec2 r = uPx * uFar * soft;
      vec3 a = texture(uTex, u + r * vec2(1.0, 0.0)).rgb + texture(uTex, u + r * vec2(-1.0, 0.0)).rgb
             + texture(uTex, u + r * vec2(0.0, 1.0)).rgb + texture(uTex, u + r * vec2(0.0, -1.0)).rgb
             + texture(uTex, u + r * vec2(0.7, 0.7)).rgb + texture(uTex, u + r * vec2(-0.7, 0.7)).rgb
             + texture(uTex, u + r * vec2(0.7, -0.7)).rgb + texture(uTex, u + r * vec2(-0.7, -0.7)).rgb;
      c = mix(c, max((c + a) / 9.0, 0.0), soft);
    }
  }
  if (uSharp > 0.0 && soft < 0.5) {
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
  dataRoot = dataDir;
  loadFonts(dataDir);
  texDirKept = texDir;
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
  uGhost = glGetUniformLocation(prog, "uGhost");
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
  props = new Props();
  if (!props->init(dataDir, texDir)) std::fprintf(stderr, "xbr: the trackside shader did not build — plain barriers\n");
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
                    &carRearWing, &carHelmet, &wheelF, &wheelR, &spinF, &spinR}) m->free();
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
  // The downloaded barrier (props.cpp), if it is there: then the plain one below is left out.
  // XBR_PROPS=off puts the plain one back.
  const char *propsEnv = std::getenv("XBR_PROPS");
  const bool modelWall = props && !(propsEnv && std::string(propsEnv) == "off") && props->canBarrier(track.wall);
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
    // THE ROAD MAY BE DIRT (track.road: 1 gravel, 2 snow — what the tyres already feel, now what you see):
    // packed earth or snow from edge to edge, and no painted lines on either.
    const int roadCode = track.road.empty() ? 0 : (int)track.road[(size_t)i];
    static const float DIRT[3] = {0.47f, 0.37f, 0.26f}, SNOW[3] = {0.86f, 0.88f, 0.92f};
    const float *RC = roadCode == 1 ? DIRT : roadCode == 2 ? SNOW : ASPHALT, *LC = roadCode ? RC : WHITE;
    const float rk = roadCode == 1 ? 3 : roadCode == 2 ? 0 : 1, lk = roadCode ? rk : 0;
    strip(Li[4], Ri[4], Lj[4], Rj[4], RC, rk);
    strip(Li[2], Li[3], Lj[2], Lj[3], RC, rk);
    strip(Li[3], Li[4], Lj[3], Lj[4], LC, lk);
    strip(Ri[4], Ri[3], Rj[4], Rj[3], LC, lk);
    strip(Ri[3], Ri[2], Rj[3], Rj[2], RC, rk);
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
      if (modelWall) {
        // A rail on posts hides nothing: the ground carries on behind it for a
        // couple of metres and then turns down, so no chord of terrain shows a gap.
        const double back = side * 2.2;
        double a[3], b[3], c[3], d[3], e[3], f[3];
        P(i, A[0], 0, a); P(j, B[0], 0, b); P(j, B[0] + back, 0, c); P(i, A[0] + back, 0, d);
        P(j, B[0] + back, -2.5, e); P(i, A[0] + back, -2.5, f);
        const bool paved = track.wall == "wall";
        m.flat(a, b, c, d, paved ? RUNCOL[rt] : VERGE, paved ? RUNKIND[rt] : 2);
        m.quad(d, c, e, f, paved ? RUNCOL[rt] : VERGE, paved ? RUNKIND[rt] : 2);
        continue;
      }
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
  // The downloaded barrier and fence: the foot of the wall on each side, sample by sample.
  if (props) {
    std::vector<Props::Edge> edges;
    int folded = 0;
    if (modelWall) for (int side : {1, -1}) {
      Props::Edge e;
      e.rightSide = side < 0; e.closed = !track.open;
      // Only where the run-off's edge is a real wall (collide.hpp wallFeet): not
      // inside a corner tighter than its own run-off, where the edge drawn sample
      // by sample folds back through itself and runs out into open ground. That
      // was the tangle, and the rail you could drive through, at Monza's Rettifilo.
      const std::vector<char> real = wallFeet(track, side);
      auto foot = [&](int i, double lat, int sample) {
        double q[3];
        P(i, lat, 0, q);
        return std::array<float, 3>{(float)q[0], (float)q[2], (float)-q[1]};
      };
      auto latOf = [&](int i) { return side * (track.w[i] + std::max(0.05, side > 0 ? track.runL[i] : track.runR[i])); };
      auto push = [&](const std::array<float, 3> &p, int i) {
        e.sample.push_back(i);
        e.p.push_back(p[0]); e.p.push_back(p[1]); e.p.push_back(p[2]);
        // a catch fence: all the way round a street circuit, and along the start straight of any other
        const double s = i * track.ds, fromLine = std::min(s, track.length - s);
        e.fenced.push_back(track.wall == "wall" || fromLine < 320 ? 1 : 0);
      };
      // Start just after a stretch with no wall, if there is one, so that a run
      // of rail which crosses the start line is laid as one run.
      int i0 = 0;
      for (int i = 0; i < n; i++) if (!real[(size_t)i]) { i0 = i; break; }
      const bool whole = real[(size_t)i0] != 0;            // wall all the way round: one closed loop
      e.closed = whole && !track.open;
      int last = -2;
      for (int k = 0; k < n; k++) {
        const int i = (i0 + k) % n;
        if (!real[(size_t)i] || (track.open && i == 0 && k > 0)) {
          folded += !real[(size_t)i];
          // the wall stops here: so does this run of rail. The next starts where the wall does.
          if (e.sample.size() >= 2) { edges.push_back(e); }
          e.p.clear(); e.sample.clear(); e.fenced.clear();
          last = -2;
          if (!real[(size_t)i]) continue;
        }
        const double lat = latOf(i);
        // Where the run-off steps by a lot (28 m to 10 m between two samples) the rule's
        // wall turns square across the road half way between them: so does the rail.
        // A small step is a taper, and the rail simply runs across it.
        if (last == i - 1 && std::fabs(lat - latOf(last)) > 6) {
          const double lp = latOf(last);
          const auto a0 = foot(last, lp, last), a1 = foot(i, lp, i), b0 = foot(last, lat, last), b1 = foot(i, lat, i);
          push({(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2}, last);
          push({(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2, (b0[2] + b1[2]) / 2}, i);
        }
        push(foot(i, lat, i), i);
        last = i;
      }
      if (e.sample.size() < 2) continue;
      edges.push_back(std::move(e));
    }
    props->buildWorld(track.wall, edges);
    if (folded) std::fprintf(stderr, "props: %s — %d m of run-off edge is not a wall (inside corners tighter than their run-off): no rail there\n", track.key.c_str(), folded * 2);
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
  std::vector<std::array<double, 3>> gateposts;
  const bool livedIn = env["key"].s("") == "gravenmoor";
  for (const auto &bd : env["buildings"].arr) {
    const std::vector<P2> p = polyOf(bd["p"]);
    if (p.size() < 3) continue;
    bool clash = false;
    double cx = 0, cy = 0;
    for (const auto &q : p) { cx += q[0]; cy += q[1]; if (onCircuit(q[0], q[1], 1.5)) { clash = true; break; } }
    if (clash) continue;
    cx /= p.size(); cy /= p.size();
    if (onCircuit(cx, cy, 1.5)) continue;
    // An authored world says what a thing is (`k`) and may give its colours:
    // a headstone is as tall as it is, a gatepost keeps its stone, and the
    // hanging tree is drawn as a tree.
    const std::string kind = bd["k"].s("");
    const bool small = kind == "grave" || kind == "gatepost";
    const double hgt = small ? std::max(0.3, bd["h"].n(1)) : std::max(3.0, bd["h"].n(7));
    const double t = hash2(cx * 0.13, cy * 0.29);
    float wall[3] = {(float)(0.58 + 0.26 * t), (float)(0.55 + 0.22 * t), (float)(0.50 + 0.18 * hash2(cy, cx))};
    float roof[3] = {(float)(0.34 + 0.20 * t), (float)(0.28 + 0.10 * t), (float)(0.26 + 0.08 * t)};
    auto hexTo = [](const std::string &h, float *o) {
      if (h.size() != 7 || h[0] != '#') return;
      for (int q = 0; q < 3; q++) o[q] = (float)std::strtol(h.substr(1 + 2 * (size_t)q, 2).c_str(), nullptr, 16) / 255.0f;
    };
    hexTo(bd["c"].s(""), wall); hexTo(bd["rc"].s(""), roof);
    if (kind == "grave") { const float g = (float)(0.80 + 0.35 * t); for (float &v : wall) v *= g; roof[0] = wall[0] * 0.9f; roof[1] = wall[1] * 0.9f; roof[2] = wall[2] * 0.9f; }
    if (kind == "gatepost") gateposts.push_back({cx, cy, hgt});
    if (kind == "deadtree") {
      // THE HANGING TREE: one enormous dead tree, every branch put there by hand.
      const double g0 = world.groundY(cx, cy) - 0.5, H = bd["h"].n(21);
      const float BARK[3] = {0.075f, 0.065f, 0.06f};
      const double base[3] = {cx, cy, g0}, fork[3] = {cx + 0.5, cy - 0.3, g0 + H * 0.46}, crown[3] = {cx - 0.9, cy + 0.6, g0 + H * 0.80};
      sc.beam(base, fork, 2.3, BARK, 0); sc.beam(fork, crown, 1.5, BARK, 0);
      // {from height (share of H), bearing, reach out, rise, thickness}
      static const double LIMB[11][5] = {{0.40, 0.3, 9.5, 1.5, 0.95}, {0.46, 2.5, 8.0, 4.5, 0.85}, {0.50, 4.3, 10.5, 2.0, 0.80}, {0.58, 1.3, 7.0, 5.5, 0.62},
                                         {0.62, 5.5, 6.5, 5.0, 0.60}, {0.68, 3.4, 6.0, 6.0, 0.50}, {0.74, 0.9, 4.8, 5.2, 0.42}, {0.78, 4.9, 4.4, 4.6, 0.40},
                                         {0.80, 2.2, 3.6, 5.6, 0.36}, {0.80, 6.0, 3.0, 6.4, 0.32}, {0.33, 3.9, 6.5, -0.4, 0.70}};
      for (const auto &L : LIMB) {
        const double zf = g0 + H * L[0], ca = std::cos(L[1]), sa = std::sin(L[1]);
        const double a[3] = {cx + ca * 0.4, cy + sa * 0.4, zf}, b[3] = {cx + ca * L[2] * 0.55, cy + sa * L[2] * 0.55, zf + L[3] * 0.35};
        const double c[3] = {cx + ca * L[2] + sa * 1.2, cy + sa * L[2] - ca * 1.2, zf + L[3]};
        sc.beam(a, b, L[4], BARK, 0); sc.beam(b, c, L[4] * 0.55, BARK, 0);
        // and the twigs at the end of it
        const double d[3] = {c[0] + ca * 1.6 - sa * 1.4, c[1] + sa * 1.6 + ca * 1.4, c[2] + 1.5}, e[3] = {c[0] + ca * 1.9 + sa * 1.1, c[1] + sa * 1.9 - ca * 1.1, c[2] - 0.5};
        sc.beam(c, d, L[4] * 0.25, BARK, 0); sc.beam(c, e, L[4] * 0.22, BARK, 0);
      }
      // the rope. Nobody is on it.
      const double r0[3] = {cx + std::cos(0.3) * 6.2, cy + std::sin(0.3) * 6.2, g0 + H * 0.40 + 0.9}, r1[3] = {r0[0], r0[1], r0[2] - 3.4};
      const float ROPE[3] = {0.42f, 0.36f, 0.24f};
      sc.beam(r0, r1, 0.07, ROPE, 0);
      nBuild++;
      continue;
    }
    // a building stands on its own ground: walls from below the lowest corner
    // of its footprint to a level roof above the highest
    double gLo = 1e300, gHi = -1e300;
    for (const auto &q : p) { const double gz = world.groundY(q[0], q[1]); gLo = std::min(gLo, gz); gHi = std::max(gHi, gz); }
    const double top = gHi + hgt;
    for (size_t i = 0; i < p.size(); i++) {
      const P2 &u = p[i], &w = p[(i + 1) % p.size()];
      const double a[3] = {u[0], u[1], gLo - 1}, b[3] = {w[0], w[1], gLo - 1}, c[3] = {w[0], w[1], top}, d[3] = {u[0], u[1], top};
      sc.quad(a, b, c, d, wall, 5);
      // A VILLAGE THAT IS AWAKE: some of the windows are lit. Only where somebody lives.
      if (livedIn && (kind == "house" || kind == "church")) {
        const double L = std::hypot(w[0] - u[0], w[1] - u[1]);
        if (L < 4.5) continue;
        const double ex = (w[0] - u[0]) / L, ey = (w[1] - u[1]) / L, nx = -ey, ny = ex;
        const int nW = (int)(L / 3.6), floors = hgt > 6.5 ? 2 : 1;
        const float WARM[3] = {1.0f, 0.74f, 0.32f}, COLD[3] = {0.55f, 0.75f, 0.70f};
        for (int fl = 0; fl < floors; fl++) for (int q = 0; q < nW; q++) {
          const double hsh = hash2(u[0] * 0.7 + q * 3.1 + fl * 9.7, u[1] * 0.9 + i * 5.3);
          if (hsh > 0.42) continue;
          const double m = (q + 0.5) * L / nW, z0 = gHi + 1.3 + fl * 3.0, hw = 0.55;
          for (int side = -1; side <= 1; side += 2) {
            const double ox = nx * 0.05 * side, oy = ny * 0.05 * side;
            const double qa[3] = {u[0] + ex * (m - hw) + ox, u[1] + ey * (m - hw) + oy, z0}, qb[3] = {u[0] + ex * (m + hw) + ox, u[1] + ey * (m + hw) + oy, z0};
            const double qc[3] = {qb[0], qb[1], z0 + 1.25}, qd[3] = {qa[0], qa[1], z0 + 1.25};
            sc.quad(qa, qb, qc, qd, hsh < 0.05 ? COLD : WARM, 8);
          }
        }
      }
    }
    for (int i : earclip(p)) sc.vert(p[(size_t)i][0], p[(size_t)i][1], top, 0, 0, 1, roof, 0);
    nBuild++;
  }
  // A LYCHGATE: two stone posts with a pitched roof across the road between them
  if (gateposts.size() == 2) {
    const auto &A = gateposts[0], &B = gateposts[1];
    const double g = std::max(world.groundY(A[0], A[1]), world.groundY(B[0], B[1])), eave = g + std::max(A[2], B[2]), ridge = eave + 2.1;
    const double dx = B[0] - A[0], dy = B[1] - A[1], l = std::hypot(dx, dy) + 1e-9, nx = -dy / l, ny = dx / l, over = 1.9;
    const float SLATE[3] = {0.20f, 0.21f, 0.24f}, BEAM[3] = {0.16f, 0.11f, 0.08f};
    for (int side = -1; side <= 1; side += 2) {
      const double a[3] = {A[0] + nx * over * side, A[1] + ny * over * side, eave}, b[3] = {B[0] + nx * over * side, B[1] + ny * over * side, eave};
      const double c[3] = {B[0], B[1], ridge}, d[3] = {A[0], A[1], ridge};
      sc.quad(a, b, c, d, SLATE, 0);
    }
    const double e0[3] = {A[0], A[1], eave}, e1[3] = {B[0], B[1], eave};
    sc.beam(e0, e1, 0.45, BEAM, 0);
  }
  // WHAT AN AUTHORED WORLD LEAVES ABOUT (data/landmarks/<key>.json): jack-o'-lanterns
  // with a light inside, and lamp masts. Everything else in that file is the browser's.
  {
    const Json lm = Json::loadOpt(dataRoot + "/landmarks/" + env["key"].s("") + ".json");
    for (const auto &it : lm["items"].arr) {
      const std::string ty = it["type"].s("");
      if (ty == "pumpkins") for (const auto &q : it["list"].arr) {
        const double x = q[(size_t)0].n(), y = q[(size_t)1].n(), r = q[(size_t)2].n(0.5), fa = q[(size_t)3].n(0);
        { int ti; if (distToTrack(x, y, ti) < track.w[ti] + r + 0.5) continue; }      // never on the tarmac; the verge is where they live
        // on a fence post, so it looks over the barrier at the road
        const double g0p = world.groundY(x, y) - 0.3, g = g0p + 1.55;
        { const float WOOD[3] = {0.20f, 0.14f, 0.09f}; sc.box(x - 0.16, x + 0.16, y - 0.16, y + 0.16, g0p, g + 0.02, WOOD, 0); sc.box(x - r * 0.6, x + r * 0.6, y - r * 0.6, y + r * 0.6, g - 0.08, g, WOOD, 0); }
        const float ORANGE[3] = {0.95f, 0.42f, 0.06f}, DARK[3] = {0.62f, 0.24f, 0.03f}, STEM[3] = {0.20f, 0.33f, 0.10f}, FIRE[3] = {1.0f, 0.82f, 0.25f};
        // eight ribs round a squashed ball
        const int N = 8;
        for (int s8 = 0; s8 < N; s8++) {
          const double a0 = 2 * PI * s8 / N, a1 = 2 * PI * (s8 + 1) / N;
          const double ring[4][2] = {{0.55, 0.0}, {1.0, 0.42}, {0.92, 0.95}, {0.35, 1.28}};
          for (int v = 0; v < 3; v++) {
            const double p0[3] = {x + std::cos(a0) * r * ring[v][0], y + std::sin(a0) * r * ring[v][0], g + r * ring[v][1]};
            const double p1[3] = {x + std::cos(a1) * r * ring[v][0], y + std::sin(a1) * r * ring[v][0], g + r * ring[v][1]};
            const double p2[3] = {x + std::cos(a1) * r * ring[v + 1][0], y + std::sin(a1) * r * ring[v + 1][0], g + r * ring[v + 1][1]};
            const double p3[3] = {x + std::cos(a0) * r * ring[v + 1][0], y + std::sin(a0) * r * ring[v + 1][0], g + r * ring[v + 1][1]};
            sc.quad(p0, p1, p2, p3, (s8 & 1) ? ORANGE : DARK, 0);
          }
        }
        sc.box(x - r * 0.08, x + r * 0.08, y - r * 0.08, y + r * 0.08, g + r * 1.2, g + r * 1.5, STEM, 0);
        // the face: two eyes and a grin, lit from inside, a little proud of the skin
        const double fx = std::cos(fa), fy = std::sin(fa), sx = -fy, sy = fx, out = r * 1.03;
        auto glow = [&](double u0, double u1, double z0, double z1, double zt) {
          const double a[3] = {x + fx * out + sx * u0 * r, y + fy * out + sy * u0 * r, g + z0 * r}, b[3] = {x + fx * out + sx * u1 * r, y + fy * out + sy * u1 * r, g + z0 * r};
          const double c[3] = {x + fx * out * 0.97 + sx * (u0 + u1) / 2 * r, y + fy * out * 0.97 + sy * (u0 + u1) / 2 * r, g + zt * r};
          sc.tri(a, b, c, FIRE, 8);
          if (z1 > z0) { const double d[3] = {b[0], b[1], g + z1 * r}, e[3] = {a[0], a[1], g + z1 * r}; sc.quad(a, b, d, e, FIRE, 8); }
        };
        glow(-0.46, -0.14, 0.72, 0.72, 0.98); glow(0.14, 0.46, 0.72, 0.72, 0.98);
        glow(-0.42, 0.42, 0.34, 0.47, 0.34);
      }
      else if (ty == "floodtowers") for (const auto &q : it["list"].arr) {
        const double x = q[(size_t)0].n(), y = q[(size_t)1].n(), H = q[(size_t)3].n(28);
        if (onCircuit(x, y, 2.0)) continue;
        const double g = world.groundY(x, y) - 0.5;
        const float STEEL[3] = {0.30f, 0.31f, 0.33f}, LAMP[3] = {1.0f, 0.96f, 0.86f};
        const double a[3] = {x, y, g}, b[3] = {x, y, g + H};
        sc.beam(a, b, 0.5, STEEL, 0);
        sc.box(x - 1.6, x + 1.6, y - 1.6, y + 1.6, g + H, g + H + 0.5, STEEL, 0);
        sc.box(x - 1.3, x + 1.3, y - 1.3, y + 1.3, g + H - 0.22, g + H - 0.02, LAMP, 8);
      }
    }
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
  spinF.upload(cm.spinF); spinR.upload(cm.spinR);
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
  // (a GT4 is a road car with a cage: it rides softer and further than a GT3, and you see its weight move)
  const bool gt = S.gt, g4 = S.key == "gt4";
  const float travel = S.key == "f1" ? 0.034f : g4 ? 0.115f : gt ? 0.085f : 0.045f, hz = S.key == "f1" ? 4.6f : g4 ? 1.75f : gt ? 2.1f : 3.6f, zeta = g4 ? 0.30f : gt ? 0.34f : 0.48f;
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
  // where every car drawn this frame is: the motion blur leaves them sharp
  if (!mirrorPass && mbSpots.size() < 24) { mbSpots.push_back((float)car.x); mbSpots.push_back((float)(groundH + std::max(0.0, car.z) + 0.5)); mbSpots.push_back((float)-car.y); }
  const float gain = car.airborne ? 1.0f : 3.0f;
  const float gp = car.airborne ? 0.0f : (float)gPitch, gr = car.airborne ? 0.0f : (float)gRoll;
  const Mat4 wheelsM = Mat4::translate((float)car.x, (float)(groundH + std::max(0.0, car.z)), (float)-car.y)
                     * Mat4::rotY((float)car.hdg) * Mat4::rotZ(gp + (float)car.pitch * gain) * Mat4::rotX(gr + (float)car.roll * gain);
  // the body rides on its springs; the wheels stay on the road, and hang when there is none
  const Susp &sp = suspOf(car, S);
  const float hang = -sp.droop * sp.travel * 0.9f;
  const Mat4 carM = wheelsM * Mat4::translate(0, sp.s, 0);
  const float gh = ghost;
  ghost = 0;
  if (gh > 0) {
    glUniform1f(uGhost, gh);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE);                 // light added to the night, never taken from it
  }
  if (packCar && gh <= 0) {
    // The model stands on the road at mid-wheelbase; the sim's origin is the CG.
    const Mat4 M = carM * Mat4::translate((float)(S.a - S.L / 2), 0, 0);
    bool lost[4]; double sag[4];
    for (int i = 0; i < 4; i++) { lost[i] = car.wheelLost[i]; sag[i] = (car.hasSag ? car.sag[i] : 0) - sp.s + hang; }
    // the blur of its turning wheels (dress.cpp): the angle a 1/75 s shutter sees
    dress->setWheelSweep((float)std::min(2.3, std::fabs(car.vx) / std::max(0.2, (double)packInfo(*packCar).wheelR) / 75));
    dress->setBrake((float)car.brake);
    dress->setDents(&car, S.a - S.L / 2);
    dress->drawPack(*packCar, M, car.steerEff, rolled, paint, lost, sag, false);
    dress->drawPack(*packCar, M, car.steerEff, rolled, paint, lost, sag, true);
    dress->setDents(nullptr, 0);
    dress->drawLights(*packCar, M, &car, car.brake, car.speed, car.steerEff, lost, sag);      // lamps, brake lights, hot discs (dress.hpp)
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
    // THE BLUR OF A TURNING WHEEL. What a camera sees of spokes and lettering
    // is everything they passed through while the shutter was open (1/75 s):
    // drawn seven to eighteen times across that angle, each that much less solid. Below a
    // walking pace it is drawn once, sharp.
    const GLMesh &sp2 = i < 2 ? spinF : spinR;
    const float sweep = std::min(2.3f, (float)(std::fabs(car.vx) / std::max(0.2, r) * (1.0 / 75)));
    if (gh > 0 || sweep < 0.09f) { drawMesh(sp2, wm); continue; }
    const int N = 7 + (int)(sweep * 5);          // the wider the smear the more of them, or it reads as dots
    const float solid = std::min(1.0f, std::max(1.55f / N, 1.0f - (sweep - 0.09f) * 3.2f));
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    for (int q = 0; q < N; q++) drawMesh(sp2, wm * Mat4::rotZ(((float)q / (N - 1) - 0.5f) * sweep), solid);
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);
  }
  if (gh > 0) { glUniform1f(uGhost, 0.0f); glDisable(GL_BLEND); }
}

// Rain you drive through: streaks across the view, more and faster with speed.
void Renderer::drawRain(const FrameIn &f) {
  if (post) return;                 // the developed picture draws its own rain, and keeps it out of the car (COMP_FS)
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

void haunt(Look &L, float a) {
  a = std::max(0.0f, std::min(1.0f, a));
  auto to = [&](float *d, float r, float g, float b) { d[0] += (r - d[0]) * a; d[1] += (g - d[1]) * a; d[2] += (b - d[2]) * a; };
  to(L.sun, -0.35f, 0.62f, 0.55f);
  to(L.sunCol, 0.40f, 0.50f, 0.54f);
  to(L.skyAmb, 0.10f, 0.14f, 0.15f); to(L.gndAmb, 0.05f, 0.07f, 0.07f);
  to(L.fog, 0.085f, 0.125f, 0.115f); to(L.skyTop, 0.012f, 0.03f, 0.04f);
  L.fogK += (0.016f - L.fogK) * a;
  L.night = std::max(L.night, a);
  L.cloud = std::max(L.cloud, 0.45f * a);
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
  // the depth is a texture, not a renderbuffer: developing the picture reads how far away each pixel is
  if (!sceneDepth) glGenTextures(1, &sceneDepth);
  glBindTexture(GL_TEXTURE_2D, sceneDepth);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, W, H, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, nullptr);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, sceneDepth, 0);
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
  // the soft distance: a ring this many pixels wide at its widest, on a 900-line picture. XBR_FAR=0 turns it off.
  static const float farSoft = std::getenv("XBR_FAR") ? (float)std::atof(std::getenv("XBR_FAR")) : 1.7f;
  glUniform1i(glGetUniformLocation(compProg, "uDepth"), 2);
  glUniform1f(glGetUniformLocation(compProg, "uRain"), rainNow);
  glUniform1f(glGetUniformLocation(compProg, "uGlass"), glassNow ? 1.0f : 0.0f);
  glUniform1f(glGetUniformLocation(compProg, "uDrops"), glassNow ? wiper.drops : 0.0f);
  glUniform1f(glGetUniformLocation(compProg, "uWipe"), glassNow ? wiper.pos : -1.0f);
  glUniform1f(glGetUniformLocation(compProg, "uWiped"), wiper.out ? 1.0f : 0.0f);
  glUniform1f(glGetUniformLocation(compProg, "uRainT"), (float)std::fmod(time, 3600.0));
  glUniform1f(glGetUniformLocation(compProg, "uRainV"), rainSpeed);
  glUniform4fv(glGetUniformLocation(compProg, "uRainCB"), 5, (const float *)&rainCB);
  // motion blur: XBR_BLUR=0 off, 0.5 gentler, 1.5 the most
  static const float blurK = std::getenv("XBR_BLUR") ? std::min(1.5f, (float)std::atof(std::getenv("XBR_BLUR"))) : 1.0f;
  {
    float cars[32]; int nc = 0;
    for (size_t i = 0; i + 2 < mbSpots.size() && nc < 8; i += 3, nc++) {
      const float x = mbSpots[i], y = mbSpots[i + 1], z = mbSpots[i + 2], *m = mbView.m;
      cars[nc * 4] = m[0] * x + m[4] * y + m[8] * z + m[12]; cars[nc * 4 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      cars[nc * 4 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]; cars[nc * 4 + 3] = 2.9f;
    }
    glUniform1i(glGetUniformLocation(compProg, "uMbN"), nc);
    if (nc) glUniform4fv(glGetUniformLocation(compProg, "uMbCar"), nc, cars);
    glUniform3fv(glGetUniformLocation(compProg, "uMbVel"), 1, mbVel);
    glUniform1f(glGetUniformLocation(compProg, "uMbTan"), mbTan);
    glUniform1f(glGetUniformLocation(compProg, "uMbAsp"), (float)W / (float)std::max(1, H));
    glUniform1f(glGetUniformLocation(compProg, "uMbAmt"), std::min(1.5f, mbAmt * blurK));
    glUniform1f(glGetUniformLocation(compProg, "uMbShutter"), 1.0f / 100);
    glUniform1f(glGetUniformLocation(compProg, "uMbMax"), 0.07f * blurK);
    glUniform4fv(glGetUniformLocation(compProg, "uMbHole"), 1, mbHole);
  }
  glUniform1f(glGetUniformLocation(compProg, "uFar"), farSoft * (float)H / 900.0f);
  glActiveTexture(GL_TEXTURE2); glBindTexture(GL_TEXTURE_2D, sceneDepth);
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

// ---- THE MENUS' PHOTOGRAPHS (Adam: "for the bg just do some cool art and photography u make
// like the ads"). Frames of the cinematic advert, build/tex/menu-NN.ppm. One is laid on the
// screen behind the menu instead of a live race: between two fractions of its height
// (the film's bars stay black), filling that band, drifting a little so it is never still.
int Renderer::photoCount() {
  if (photosTried) return (int)photoFbo.size();
  photosTried = true;
  for (int i = 1; i <= 40; i++) {
    char name[64];
    std::snprintf(name, sizeof name, "/menu-%02d.ppm", i);
    int w, h;
    std::vector<unsigned char> px;
    if (!readPPM(texDirKept + name, w, h, px)) break;
    GLuint tex = 0, fb = 0;
    glGenTextures(1, &tex);
    glBindTexture(GL_TEXTURE_2D, tex);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB8, w, h, 0, GL_RGB, GL_UNSIGNED_BYTE, px.data());
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glGenFramebuffers(1, &fb);
    glBindFramebuffer(GL_FRAMEBUFFER, fb);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, tex, 0);
    photoFbo.push_back(fb); photoW.push_back(w); photoH.push_back(h);
  }
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  return (int)photoFbo.size();
}
void Renderer::photoShow(int index, double t, float top, float bottom) {
  const int n = photoCount();
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glViewport(0, 0, W, H);
  glDisable(GL_SCISSOR_TEST);
  glClearColor(0, 0, 0, 1);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  sceneOpen = false;
  if (n <= 0) return;
  index = ((index % n) + n) % n;
  const float pw = (float)photoW[(size_t)index], ph = (float)photoH[(size_t)index];
  const int dy0 = (int)((1 - bottom) * H), dy1 = (int)((1 - top) * H);
  const float bandAspect = (float)W / (float)std::max(1, dy1 - dy0);
  // the part of the photograph that fills the band, a little inside its edges, wandering slowly
  const float zoom = 1.07f + 0.035f * (float)std::sin(t * 0.07 + index);
  float sw2 = pw / zoom, sh2 = sw2 / bandAspect;
  if (sh2 > ph / zoom) { sh2 = ph / zoom; sw2 = sh2 * bandAspect; }
  const float cx = pw / 2 + (pw - sw2) * 0.45f * (float)std::sin(t * 0.045 + index * 1.7), cy = ph / 2 + (ph - sh2) * 0.45f * (float)std::cos(t * 0.038 + index);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, photoFbo[(size_t)index]);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, fbo);
  // (a PPM's first row is the top of the picture, and GL's first row is the bottom: so the source is taken upside down)
  glBlitFramebuffer((int)(cx - sw2 / 2), (int)(cy + sh2 / 2), (int)(cx + sw2 / 2), (int)(cy - sh2 / 2), 0, dy0, W, dy1, GL_COLOR_BUFFER_BIT, GL_LINEAR);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
}

// ---- THE WIPER (Adam: "p for windshield wipers, double tap to increase speed, single tap for
// just 1 wipe"). One tap is one wipe. Two taps inside 0.35 s move it up a speed:
// off, slow, steady, fast, off. Water gathers on the glass while it rains and the
// blade takes it off on the way out.
const char *Renderer::wiperTap(double now) {
  static const char *NAME[4] = {"WIPERS OFF", "WIPERS: SLOW", "WIPERS: STEADY", "WIPERS: FAST"};
  const bool twice = now - wiper.tapAt < 0.35;
  wiper.tapAt = now;
  if (twice) { wiper.level = (wiper.level + 1) % 4; wiper.next = 0; return NAME[wiper.level]; }
  if (wiper.pos < 0) wiper.go = true;
  return wiper.level ? nullptr : "ONE WIPE";
}
void Renderer::wiperStep(float dt, double now) {
  Wiper &w = wiper;
  w.drops = std::min(1.0f, w.drops + rainNow * 0.75f * dt);
  if (rainNow < 0.02f) w.drops = std::max(0.0f, w.drops - 0.05f * dt);        // it dries, slowly
  // the same, kept the way the shader wants it: seconds of rain since the last sweep began
  w.since += rainNow * dt;
  if (rainNow < 0.02f) { w.since = std::max(0.0f, w.since - 0.07f * dt); w.before = std::max(0.0f, w.before - 0.05f * dt); }
  static const float EVERY[4] = {0, 2.6f, 1.35f, 0.0f};
  if (w.level && w.pos < 0) { w.next -= dt; if (w.next <= 0) { w.go = true; w.next = EVERY[w.level]; } }
  if (w.go && w.pos < 0) {
    w.go = false; w.pos = 0; w.out = true;
    w.before = std::min(1.0f, w.before + 0.75f * w.since); w.since = 0;      // what the blade is about to take
    w.sweepWater = rainNow * (w.level == 3 ? 0.38f : 0.5f);                  // how much rain falls while it crosses
  }
  if (w.pos >= 0) {
    const float speed = w.level == 3 ? 2.6f : 2.0f;                            // sweeps a second, each way
    if (w.out) { w.pos += speed * dt; if (w.pos >= 1) { w.pos = 1; w.out = false; w.drops = 0; w.before = 0; } }
    else { w.pos -= speed * dt; if (w.pos <= 0) w.pos = -1; }
  }
  (void)now;
  // for a photograph: XBR_DROPS=0.8 puts that much water on the glass, XBR_WIPE=0.5 stops the blade half way out
  static const char *ed = std::getenv("XBR_DROPS"), *ew = std::getenv("XBR_WIPE");
  if (ed) { w.drops = (float)std::atof(ed); w.before = w.drops; w.since = w.drops / 0.75f; }
  if (ew) { w.pos = (float)std::atof(ew); w.out = true; }
}

// ---- THE GLASS'S CONSTANTS, every frame, from the physics (render.hpp RainSystemCB; read by COMP_FS).
void Renderer::updateRainCB(const FrameIn &f, const Mat4 &view) {
  static_assert(sizeof(RainSystemCB) == 80 && alignof(RainSystemCB) == 16, "RainSystemCB is five 16-byte rows");
  const Car &car = *f.car;
  const float dt = (float)std::min(0.1, std::max(0.0, f.dt));
  RainSystemCB &cb = rainCB;
  // the wind: a weather wind that swings round and gusts, harder the harder it rains, in the world...
  const double bearing = 0.7 + 0.35 * std::sin(f.time * 0.05), gust = 1 + 0.35 * std::sin(f.time * 0.9) + 0.2 * std::sin(f.time * 2.3 + 1);
  const double wsp = (3.0 + 9.0 * f.look.rain) * gust;
  const double wx = std::cos(bearing) * wsp, wy = std::sin(bearing) * wsp;
  // ...and as the car meets it: its own speed through the air, plus the wind, in the car's axes (forward, left)
  const double ch = std::cos(car.hdg), sh = std::sin(car.hdg);
  const double vwx = car.vx * ch - car.vy * sh, vwy = car.vx * sh + car.vy * ch;        // the car over the ground, world
  const double rx = wx - vwx, ry = wy - vwy;                                            // the air relative to the car, world
  const double aFwd = rx * ch + ry * sh, aLeft = -rx * sh + ry * ch;
  // on the glass: air coming at the car (aFwd negative) runs UP the screen; air from the left runs to the right
  const bool closed = f.spec->gt;
  cb.rake = closed ? 0.52f : 0.95f;                                                     // a GT's screen lies back; a visor stands nearly upright
  cb.wind[0] = (float)(-aLeft); cb.wind[1] = (float)(-aFwd * std::cos(cb.rake)); cb.wind[2] = (float)(-aFwd * std::sin(cb.rake));
  cb.speed = (float)std::fabs(car.speed);
  cb.gLat = (float)std::max(-5.0, std::min(5.0, car.vx * car.r / 9.81));
  cb.gLong = shake.acc / 9.81f;
  cb.wiperAngle = wiper.pos >= 0 ? (wiper.pos - 0.5f) * 1.9f : -9.0f;
  cb.waterBefore = wiper.before; cb.gather = 0.75f; cb.rainSince = wiper.since; cb.sweep = wiper.sweepWater;
  // the running drops' travel: the same composite velocity the shader draws them along, integrated
  const float vfx = cb.wind[0] * 0.42f - cb.gLat * 5.2f, vfy = -9.81f * std::sin(cb.rake) * 0.35f + cb.wind[1] * 0.20f - cb.gLong * std::cos(cb.rake) * 5.2f;
  flowX += vfx * dt * 0.035f; flowY += vfy * dt * 0.035f;
  if (std::fabs(flowX) > 500 || std::fabs(flowY) > 500) { flowX = 0; flowY = 0; }
  cb.flow[0] = flowX; cb.flow[1] = flowY;
  cb.time = (float)std::fmod(f.time, 3600.0);
  cb.glass = glassNow ? 1.0f : 0.0f;
  // the brightest light, into view space: the sun by day; by night, lamps behind you in the glass
  const Look &L = f.look;
  const float *m = view.m;
  for (int k = 0; k < 3; k++) cb.light[k] = m[k] * L.sun[0] + m[4 + k] * L.sun[1] + m[8 + k] * L.sun[2];
  cb.lightPower = std::min(1.6f, 0.35f + 0.9f * (L.sunCol[0] + L.sunCol[1] + L.sunCol[2]) / 3 + 0.8f * L.night);
}

// ---- THE SHAKE (js/speedfx.js SpeedShake, and js/render.js's rule for when it runs).
// Adam, 2026-10-03, on the rig: "random shake when im on the track ... unplayable",
// "only shake on grass and crash". So the camera moves ONLY on grass or in a
// crash. Everywhere else every shake, buzz, dive and bob is zero.
// XBR_SHAKE=0 off, 2 double.
void Renderer::shakeCamera(const FrameIn &f, float eye[3], float at[3], float up[3]) {
  static const float K = std::getenv("XBR_SHAKE") ? (float)std::atof(std::getenv("XBR_SHAKE")) : 1.0f;
  const Car &car = *f.car;
  Shake &q = shake;
  const float dt = (float)std::min(0.1, std::max(0.0, f.dt));
  auto rnd = []() { return (float)std::rand() / (float)RAND_MAX * 2 - 1; };
  const float v = (float)std::fabs(car.speed);
  // grass: the only surface that shakes
  const float grass = (car.surface < 0.5 && !car.airborne) ? 0.45f * std::min(1.0f, v / 12.0f) : 0.0f;
  // a crash: speed lost far faster than any brake can (over 12 g), from real speed, over a real frame
  const float dvG = dt >= 0.008f && q.spdWas > 8 ? std::max(0.0f, q.spdWas - v) / dt / 9.81f : 0.0f;
  q.spdWas = v;
  const float crash = dvG > 12 ? std::min(0.06f, 0.015f + (dvG - 12) * 0.0015f) : 0.0f;
  q.level = std::max(q.level * (1 - dt * 6), grass * 0.05f + crash);
  const float ja = std::min(1.0f, dt * 18);
  for (float &j : q.jit) j += (rnd() * 0.5f - j) * ja;
  // acceleration, from the speed alone, over a 0.1 s window, and none below 11 km/h
  q.accT += dt;
  if (q.accT >= 0.1f) { q.accHeld = (v - q.lastSpd) / q.accT; q.lastSpd = v; q.accT = 0; }
  if (v < 3) q.accHeld = 0;
  q.acc += (std::max(-60.0f, std::min(60.0f, q.accHeld)) - q.acc) * std::min(1.0f, dt * 4);
  const bool on = K > 0 && (grass > 0 || q.level > 0.003f);
  if (!on) return;
  // per mount, degrees at 350 km/h (speedfx.js MOUNTS): onboard, chase, nose, t-cam
  struct Mount { float buzzP, buzzY, buzzR, roadP, roadR, heave, kerb, dive, squat, sink, latM, latR; };
  static const Mount M4[4] = {
    {0.075f, 0.035f, 0.03f, 0.16f, 0.10f, 0.004f, 0.9f, 0.18f, 0.08f, 0.02f, 0.010f, 0.30f},
    {0.025f, 0.015f, 0.0f, 0.06f, 0.03f, 0.012f, 0.35f, 0, 0, 0.03f, 0, 0},
    {0.12f, 0.05f, 0.04f, 0.20f, 0.08f, 0.006f, 1.2f, 0, 0, 0.006f, 0, 0},
    {0.16f, 0.045f, 0.05f, 0.14f, 0.12f, 0.005f, 1.1f, 0.12f, 0.05f, 0.015f, 0, 0}};
  const Mount &M = M4[std::max(0, std::min(3, f.camMode))];
  const float rough = grass * 0.12f, gLong = q.acc / 9.81f;
  const float gLat = (float)std::max(-5.0, std::min(5.0, car.vx * car.r / 9.81));
  const float gVert = std::fabs(gLat) * std::sin(std::fabs((float)f.gRoll));
  const float k = v / 97.2f;                                    // 1.0 at 350 km/h
  q.dist += v * dt;
  q.kick = std::max(q.kick, std::min(1.0f, rough * 1.6f));
  q.kick *= std::exp(-dt * 7);
  const float b = std::pow(k, 1.6f) * K;
  const float a = std::min(1.0f, dt * 55);
  for (float &h : q.hf) h += (rnd() - h) * a;
  const float d = q.dist;
  const float w1 = std::sin(d / 9.1f * 6.283f), w2 = std::sin(d / 3.7f * 6.283f + 1.3f), w3 = std::sin(d / 14.3f * 6.283f + 2.1f);
  const float road = (0.5f * w2 + 0.3f * w1 + 0.2f * w3) * std::min(1.0f, k) * K;
  const float roll = (0.6f * std::sin(d / 5.3f * 6.283f + 0.4f) + 0.4f * w3) * std::min(1.0f, k) * K;
  const float kk = q.kick * M.kerb * K;
  q.kn += (rnd() - q.kn) * std::min(1.0f, dt * 18);
  // the dive: a spring chasing the longitudinal g, so the release overshoots a touch
  const float tgt = std::max(-6.5f, std::min(2.5f, gLong));
  q.dv += (13 * 13 * (tgt - q.dx) - 2 * 0.45f * 13 * q.dv) * dt; q.dx += q.dv * dt;
  const float dive = (q.dx < 0 ? q.dx * M.dive : q.dx * M.squat) * K;
  q.gv += (std::max(0.0f, std::min(3.0f, gVert)) - q.gv) * std::min(1.0f, dt * 5);
  // the head in a corner
  q.lv += (81 * (gLat - q.lx) - 2 * 0.6f * 9 * q.lv) * dt; q.lx += q.lv * dt;
  const float D2R = (float)PI / 180;
  const float sx = M.latM * q.lx * K, headRoll = -M.latR * q.lx;
  const float sp = (M.buzzP * b * q.hf[0] + M.roadP * road + kk * q.kn * 0.9f + dive - 0.25f * q.gv) * D2R;
  const float sy = (M.buzzY * b * q.hf[1] + kk * q.kn * 0.25f) * D2R;
  const float sr = (M.buzzR * b * q.hf[2] + M.roadR * roll + kk * q.kn * 0.5f + headRoll * K) * D2R;
  const float sh2 = M.heave * (road + 0.5f * b * q.hf[0]) + 0.01f * kk * q.kn - M.sink * (q.gv + std::max(0.0f, -q.dx) * 0.25f);

  // ---- onto the camera: the hit as a small shove, then the angles about its own axes
  auto norm = [](float *p) { const float l = std::sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) + 1e-9f; p[0] /= l; p[1] /= l; p[2] /= l; };
  auto crossf = [](const float *x, const float *y, float *o) { o[0] = x[1] * y[2] - x[2] * y[1]; o[1] = x[2] * y[0] - x[0] * y[2]; o[2] = x[0] * y[1] - x[1] * y[0]; };
  auto turn = [&](float *p, const float *ax, float ang) {       // Rodrigues, ax a unit vector
    const float c = std::cos(ang), s = std::sin(ang), dt2 = ax[0] * p[0] + ax[1] * p[1] + ax[2] * p[2];
    float cr[3]; crossf(ax, p, cr);
    for (int i = 0; i < 3; i++) p[i] = p[i] * c + cr[i] * s + ax[i] * dt2 * (1 - c);
  };
  float fw[3] = {at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]};
  const float reach = std::sqrt(fw[0] * fw[0] + fw[1] * fw[1] + fw[2] * fw[2]);
  norm(fw);
  float right[3], u2[3];
  crossf(fw, up, right); norm(right);
  crossf(right, fw, u2); norm(u2);
  const float amp = q.level * 0.35f * K;
  for (int i = 0; i < 3; i++) eye[i] += q.jit[i] * amp + u2[i] * sh2 + right[i] * sx;
  turn(fw, right, sp); turn(u2, right, sp);                      // pitch
  turn(fw, u2, sy);                                              // yaw
  turn(u2, fw, sr);                                              // roll
  for (int i = 0; i < 3; i++) { at[i] = eye[i] + fw[i] * reach; up[i] = u2[i]; }
}

// ---- THE MIRROR (js/render.js _mirror): one wide glass at the top of the screen, in every
// view you drive from. The world is drawn a second time, small, looking back; game_main
// calls mirrorBegin, drawWorld, its rivals, mirrorEnd — on alternate frames, as ACC's does —
// and mirrorShow lays the picture on the finished frame, left and right swapped as glass swaps them.
bool Renderer::mirrorWanted(int camMode) const {
  static const bool off = std::getenv("XBR_MIRROR") && std::string(std::getenv("XBR_MIRROR")) == "0";
  return mirrorOn && !off && camMode != 1;
}
void Renderer::mirrorBegin() {
  if (!mirFbo) {
    glGenFramebuffers(1, &mirFbo);
    glBindFramebuffer(GL_FRAMEBUFFER, mirFbo);
    glGenTextures(1, &mirTex);
    glBindTexture(GL_TEXTURE_2D, mirTex);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, MIR_W, MIR_H, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, mirTex, 0);
    glGenRenderbuffers(1, &mirDepth);
    glBindRenderbuffer(GL_RENDERBUFFER, mirDepth);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, MIR_W, MIR_H);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, mirDepth);
  }
  mirrorPass = true;
}
void Renderer::mirrorEnd() {
  mirrorPass = false; mirHas = true;
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glViewport(0, 0, W, H);
}
void Renderer::mirrorShow() {
  if (!mirHas || !mirFbo) return;
  // a third of the screen wide, 4.2 to 1, ten pixels down from the top
  const int w = (int)std::min(W * 0.34f, 560.0f * H / 900.0f), h = (int)(w / 4.2f), x = (W - w) / 2, y = H - h - (int)(10.0f * H / 900.0f);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glEnable(GL_SCISSOR_TEST);
  glScissor(x - 3, y - 3, w + 6, h + 6);
  glClearColor(0.02f, 0.02f, 0.025f, 1);
  glClear(GL_COLOR_BUFFER_BIT);                       // the housing
  glDisable(GL_SCISSOR_TEST);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, mirFbo);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, fbo);
  glBlitFramebuffer(MIR_W, 0, 0, MIR_H, x, y, x + w, y + h, GL_COLOR_BUFFER_BIT, GL_LINEAR);     // left and right swapped
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
}

void Renderer::drawWorld(const FrameIn &f) {
  const Car &car = *f.car;
  const Spec &S = *f.spec;
  Look L = f.look;
  if (!mirrorPass) { PROF.frames++; PROF.begin(); }
  if (mirrorPass) {
    // THE MIRROR'S PICTURE: the same world, small, looking back (mirrorBegin).
    glBindFramebuffer(GL_FRAMEBUFFER, mirFbo);
    glViewport(0, 0, MIR_W, MIR_H);
  } else if (post) {
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
  const bool hdr = post && !mirrorPass;
  glClearColor(L.fog[0], L.fog[1], L.fog[2], 1);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glDisable(GL_CULL_FACE);
  glDisable(GL_BLEND);
  glUseProgram(prog);
  glUniform1i(uPass, 0);
  glUniform1f(uHdr, hdr ? (std::getenv("XBR_SHDEBUG") ? 2.0f : 1.0f) : 0.0f);
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
  if (!mirrorPass) {
    rainNow = f.look.rain; rainSpeed = (float)std::min(1.0, car.speed / 70.0);
    glassNow = f.camMode == 0;                    // the driver's eyes: behind a windscreen, or a visor
    wiperStep((float)f.dt, f.time);
  }
  // (the glass's constants are filled below, once the view is known: updateRainCB)
  if (!mirrorPass) shakeCamera(f, eye, at, up);
  if (mirrorPass) {
    // from just above your head, straight back down the road: one wide glass
    // (Adam: "also add mirrors" — a race you cannot see behind is a race against ghosts)
    const float e[3] = {-0.9f + shift, 1.12f, 0}, t[3] = {e[0] - 40, e[1] - 1.6f, 0}, u[3] = {0, 1, 0};
    xform(carM, e, 1, eye); xform(carM, t, 1, at); xform(carM, u, 0, up);
    fov = 24;
  }
  const Mat4 proj = Mat4::perspective(fov * (float)PI / 180, mirrorPass ? (float)MIR_W / (float)MIR_H : (float)W / (float)std::max(1, H), 0.12f, 12000.0f);
  const Mat4 view = Mat4::lookAt(eye, at, up);
  // for the motion blur (endScene): how the camera is travelling, in its own frame.
  // Fades in from 110 to 260 km/h, as the browser game's does.
  if (!mirrorPass) {
    const double bt = std::atan2(car.vy, std::max(std::fabs(car.vx), 1.0)), dir = car.hdg + bt;
    const float wv[3] = {(float)(std::cos(dir) * car.speed), 0, (float)(-std::sin(dir) * car.speed)};
    for (int k = 0; k < 3; k++) mbVel[k] = view.m[k] * wv[0] + view.m[4 + k] * wv[1] + view.m[8 + k] * wv[2];
    mbView = view; mbTan = std::tan(fov * (float)PI / 360);
    mbAmt = car.speed > 30 ? (float)std::min(1.0, std::max(0.0, (car.speed * 3.6 - 110) / 150)) : 0;
    mbSpots.clear();
  }
  if (!mirrorPass) updateRainCB(f, view);
  const Mat4 VP = proj * view;
  static const bool noSh = std::getenv("XBR_NOSH") != nullptr;
  if (std::getenv("XBR_NOTREESH")) treeShadows = false;
  bool shadowOnNow = false;
  if (post && !mirrorPass && !noSh && L.sun[1] / sl0(L.sun) > 0.10f && L.sunCol[0] + L.sunCol[1] + L.sunCol[2] > 0.9f) {
    shadowOnNow = true;
    const float fl = std::sqrt((at[0] - eye[0]) * (at[0] - eye[0]) + (at[2] - eye[2]) * (at[2] - eye[2])) + 1e-6f;
    const float fwd[3] = {(at[0] - eye[0]) / fl, 0, (at[2] - eye[2]) / fl};
    renderShadow(L, eye, fwd, f.time);
    glUniform1f(uShOn, 1.0f);
    glUniformMatrix4fv(uShVP, 1, GL_FALSE, shVP.m);
  }
  PROF.mark(0);
  glActiveTexture(GL_TEXTURE3); glBindTexture(GL_TEXTURE_2D, shTex); glActiveTexture(GL_TEXTURE0);
  if (dress) dress->frame(VP, eye, L, f.time);
  if (props) props->frame(VP, eye, L, shVP, shadowOnNow);
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
  // the mirrors on the car itself show the same picture as the glass at the top of the screen
  {
    const bool on = !mirrorPass && mirHas && mirrorOn;
    glUniform1f(glGetUniformLocation(prog, "uMirOn"), on ? 1.0f : 0.0f);
    glUniform1i(glGetUniformLocation(prog, "uMirror"), 5);
    if (on) { glActiveTexture(GL_TEXTURE5); glBindTexture(GL_TEXTURE_2D, mirTex); glActiveTexture(GL_TEXTURE0); }
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
  if (!mirrorPass) drawCar(car, S, f.groundH, f.gPitch, f.gRoll, f.paint[0] < 0 ? RED : f.paint, f.wheelAngle, f.camMode != 0);   // the glass is above your own car
  glBindVertexArray(0);
  glUseProgram(prog);
  glUniform3f(uPaint, 0.78f, 0.06f, 0.08f);
  setDents(nullptr);
  PROF.mark(4);

  drawMesh(corridor, Mat4::identity());
  drawMesh(scenery, Mat4::identity());
  PROF.mark(2);
  // (in the mirror: every tree as its two photographs and every rail as its big faces — a small picture needs no more)
  if (dress) { if (mirrorPass) dress->drawShadow(); else dress->drawWorld(); }
  if (props) { props->farOnly = mirrorPass; const BarrierWear &bw = barrierWear(); if (bw.on) props->deform(bw.bend, bw.broke, bw.version); props->draw(); }
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
  if (hudFlat) deg = 0;                       // the pro menus: nothing tilts
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
  if (hudFlat) r = std::min(r, 3.0f * (float)H / 900.0f);                 // the pro menus: a corner, not a blob
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
  if (hudFlat) {
    // the pro menus: a panel with a hairline, not a sticker with an outline
    const float hair[4] = {line[0], line[1], line[2], line[3] * 0.38f}, t = std::max(1.0f, (float)H / 900.0f);
    rrect(x, y, w, h, r, hair);
    rrect(x + t, y + t, w - 2 * t, h - 2 * t, r, fill);
    return;
  }
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
  if (hudFlat && font == MARKER) { font = RUBIK; size *= 0.84f; }
  const Font &F = fonts[font];
  const float k = size / FONT_PX;
  float w = 0;
  for (char ch : s) { const int c = (unsigned char)ch; w += (c >= 32 && c < 127 ? F.g[c - 32].adv : F.g[0].adv) * k + track * size; }
  return s.empty() ? 0 : w - track * size;
}
float Renderer::textPx(float x, float y, float size, const std::string &s, const float c[4], Align al, int font, float track) {
  if (hudFlat && font == MARKER) { font = RUBIK; size *= 0.84f; }           // the pro menus: no handwriting
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
