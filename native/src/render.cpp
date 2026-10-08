// render.cpp — see render.hpp.
//
// WHAT THIS IS AND IS NOT. It draws the circuit from the same baked data the
// browser game uses — centreline, widths, run-off, the per-metre surface bake
// (data/surf), and the OSM surroundings (data/env) — as flat-shaded geometry
// with procedural grain. It does not yet draw elevation, banking, PBR textures,
// crowds, pit buildings, the downloaded car or bodywork damage. Those live in
// js/render.js and friends and have not been ported.
#include "render.hpp"

#include <epoxy/gl.h>

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
// kind: 0 plain  1 asphalt  2 grass  3 gravel  6 paint (specular)  8 unlit  9 sky
static const char *VS = R"(#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm;
layout(location=2) in vec3 aCol; layout(location=3) in float aKind;
uniform mat4 uVP, uModel;
out vec3 vW, vN, vC; out float vK;
void main(){ vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vN = mat3(uModel) * aNrm; vC = aCol; vK = aKind; gl_Position = uVP * w; }
)";
static const char *FS = R"(#version 330 core
in vec3 vW, vN, vC; in float vK;
uniform vec3 uEye, uSun; uniform float uAlpha;
out vec4 o;
const vec3 FOG = vec3(0.78, 0.84, 0.90);
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
void main(){
  int k = int(vK + 0.5);
  if (k == 9) { o = vec4(vC, 1.0); return; }
  if (k == 8) { o = vec4(vC, uAlpha); return; }
  vec3 V = uEye - vW; float dist = length(V); V /= dist;
  vec3 n = normalize(vN); if (dot(n, V) < 0.0) n = -n;
  vec3 c = vC;
  // Grain you can see moving is most of what makes 210 km/h feel like 210.
  // The fine layer fades with distance, or it turns to shimmer.
  float near = clamp(1.0 - dist / 140.0, 0.0, 1.0);
  if (k == 1) {
    float g = vnoise(vW.xz * 0.35) * 0.45 + vnoise(vW.xz * 3.1) * 0.30 + hash(floor(vW.xz * 45.0)) * 0.25 * near;
    c *= 0.84 + 0.30 * g;
  } else if (k == 2) {
    float g = vnoise(vW.xz * 0.05) * 0.40 + vnoise(vW.xz * 0.7) * 0.35 + hash(floor(vW.xz * 18.0)) * 0.25 * near;
    c *= 0.74 + 0.48 * g;
  } else if (k == 3) {
    float g = vnoise(vW.xz * 1.2) * 0.4 + hash(floor(vW.xz * 22.0)) * 0.6 * near + 0.3 * (1.0 - near);
    c *= 0.80 + 0.36 * g;
  }
  float ndl = max(dot(n, uSun), 0.0);
  vec3 amb = mix(vec3(0.34, 0.33, 0.30), vec3(0.52, 0.58, 0.68), n.y * 0.5 + 0.5);
  vec3 lit = c * (amb + vec3(1.00, 0.95, 0.86) * ndl * 0.78);
  if (k == 6) {
    vec3 h = normalize(uSun + V);
    lit += vec3(1.0) * pow(max(dot(n, h), 0.0), 48.0) * 0.55;
    lit += FOG * 0.10 * pow(1.0 - max(dot(n, V), 0.0), 3.0);
  }
  float f = 1.0 - exp(-dist * 0.00055);
  o = vec4(mix(lit, FOG, f), uAlpha);
}
)";
static const char *HVS = R"(#version 330 core
layout(location=0) in vec2 aPos; layout(location=1) in vec4 aCol;
uniform vec2 uSize; out vec4 vC;
void main(){ vC = aCol; gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0); }
)";
static const char *HFS = R"(#version 330 core
in vec4 vC; out vec4 o; void main(){ o = vC; }
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

bool Renderer::init() {
  prog = link(VS, FS);
  hudProg = link(HVS, HFS);
  if (!prog || !hudProg) return false;
  uVP = glGetUniformLocation(prog, "uVP");
  uModel = glGetUniformLocation(prog, "uModel");
  uEye = glGetUniformLocation(prog, "uEye");
  uSun = glGetUniformLocation(prog, "uSun");
  uAlpha = glGetUniformLocation(prog, "uAlpha");
  uHudSize = glGetUniformLocation(hudProg, "uSize");

  glGenVertexArrays(1, &hudVao);
  glGenBuffers(1, &hudVbo);
  glBindVertexArray(hudVao);
  glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 6 * sizeof(float), (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, 6 * sizeof(float), (void *)(2 * sizeof(float)));
  glBindVertexArray(0);

  // The sky: a dome that travels with the camera. Its horizon band is the fog
  // colour, so the far ground dissolves into it and there is no edge of the
  // world to see.
  MeshB b;
  const float hz[3] = {0.78f, 0.84f, 0.90f}, zen[3] = {0.24f, 0.46f, 0.82f};
  const int RINGS = 10, SEG = 24;
  auto pt = [&](int ring, int seg, double p[3], float c[3]) {
    const double el = -0.12 + (PI / 2 + 0.12) * ring / RINGS, az = 2 * PI * seg / SEG;
    p[0] = std::cos(el) * std::cos(az); p[1] = std::cos(el) * std::sin(az); p[2] = std::sin(el);
    const float t = (float)std::pow(std::max(0.0, std::sin(el)), 0.55);
    for (int k = 0; k < 3; k++) c[k] = hz[k] + (zen[k] - hz[k]) * t;
  };
  for (int r = 0; r < RINGS; r++)
    for (int s = 0; s < SEG; s++) {
      double p[4][3]; float c[4][3];
      pt(r, s, p[0], c[0]); pt(r, s + 1, p[1], c[1]); pt(r + 1, s + 1, p[2], c[2]); pt(r + 1, s, p[3], c[3]);
      const int order[6] = {0, 1, 2, 0, 2, 3};
      for (int i : order) b.vert(p[i][0], p[i][1], p[i][2], 0, 0, 1, c[i], 9);
    }
  sky.upload(b);
  return true;
}

void Renderer::shutdown() {
  for (GLMesh *m : {&ground, &corridor, &decals, &lineMesh, &scenery, &sky, &shadow, &carBody, &carFrontWing,
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

void Renderer::buildWorld(const Track &track, const Json &surf, const Json &env, const Line &raceLine) {
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
  const float RUNKIND[4] = {3, 1, 2, 1};
  const float KRED[3] = {0.78f, 0.15f, 0.17f};
  const float KALT_DEF[3] = {0.93f, 0.93f, 0.92f}, KALT_SPA[3] = {0.90f, 0.75f, 0.12f};
  const float *KALT = track.key == "spa" ? KALT_SPA : KALT_DEF;

  auto P = [&](int i, double lat, double z, double out[3]) {
    const double h = track.hdg[i];
    out[0] = track.x[i] - std::sin(h) * lat; out[1] = track.y[i] + std::cos(h) * lat; out[2] = z;
  };

  // ---- the ground: one sheet, drawn first with depth writes off, so nothing
  // on it can ever z-fight with it. Landcover from OSM lies on top of it.
  MeshB g;
  {
    double x0 = 1e300, x1 = -1e300, y0 = 1e300, y1 = -1e300;
    for (int i = 0; i < n; i++) {
      x0 = std::min(x0, track.x[i]); x1 = std::max(x1, track.x[i]);
      y0 = std::min(y0, track.y[i]); y1 = std::max(y1, track.y[i]);
    }
    const double M = 7000;
    const double a[3] = {x0 - M, y0 - M, 0}, b[3] = {x1 + M, y0 - M, 0}, c[3] = {x1 + M, y1 + M, 0}, d[3] = {x0 - M, y1 + M, 0};
    g.flat(a, b, c, d, GRASS, 2);
    struct Cover { const char *k; float c[3]; float kind; };
    static const Cover COVER[] = {
      {"water", {0.22f, 0.38f, 0.52f}, 0}, {"farm", {0.52f, 0.50f, 0.28f}, 2}, {"urban", {0.47f, 0.46f, 0.44f}, 1},
      {"forest", {0.17f, 0.31f, 0.14f}, 2}, {"scrub", {0.33f, 0.40f, 0.20f}, 2}, {"park", {0.30f, 0.48f, 0.20f}, 2},
      {"pitch", {0.25f, 0.52f, 0.22f}, 2}, {"sand", {0.76f, 0.70f, 0.52f}, 3}, {"bare", {0.50f, 0.46f, 0.38f}, 3},
      {"rock", {0.46f, 0.45f, 0.43f}, 3}, {"grass", {0.30f, 0.46f, 0.19f}, 2},
    };
    auto fill = [&](const std::vector<P2> &p, const float col[3], float kind) {
      const std::vector<int> t = earclip(p);
      for (int i : t) g.vert(p[(size_t)i][0], p[(size_t)i][1], 0, 0, 0, 1, col, kind);
    };
    for (const auto &ar : env["areas"].arr) {
      const std::string k = ar["k"].s();
      for (const auto &cv : COVER)
        if (k == cv.k) { fill(polyOf(ar["p"]), cv.c, cv.kind); break; }
    }
    // env.sea is NOT drawn. Measured at Monaco: every one of the circuit's 1661
    // samples lies inside a sea polygon. The browser game lays the sea under
    // the terrain and lets the land's height hide it; in a flat world it
    // floods the town. It comes back with the elevation model.
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
      P(i, A[0], 0, a); P(j, B[0], 0, b); P(j, B[0], hWall, c); P(i, A[0], hWall, d);
      P(i, A[0] + out, hWall, e); P(j, B[0] + out, hWall, f); P(j, B[0] + out, 0, gq); P(i, A[0] + out, 0, hq);
      m.quad(a, b, c, d, face, 0);
      m.quad(d, c, f, e, top, 0);
      m.quad(e, f, gq, hq, face, 0);
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
          o[2] = 0.006;
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
    const double r = hgt * 0.22, tr = hgt * 0.035;
    const float TRUNK[3] = {0.26f, 0.19f, 0.13f};
    const float tone = (float)(0.75 + 0.5 * hash2(x * 0.37, y * 0.91));
    const float LEAF[3] = {0.13f * tone, 0.30f * tone, 0.12f * tone}, LEAF2[3] = {0.16f * tone, 0.35f * tone, 0.14f * tone};
    sc.box(x - tr, x + tr, y - tr, y + tr, 0, hgt * 0.4, TRUNK, 0);
    const int S = 6;
    for (int lvl = 0; lvl < 2; lvl++) {
      const double z0 = hgt * (lvl ? 0.55 : 0.25), z1 = hgt * (lvl ? 1.0 : 0.80), rr = r * (lvl ? 0.72 : 1.0);
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
    for (size_t i = 0; i < p.size(); i++) {
      const P2 &u = p[i], &w = p[(i + 1) % p.size()];
      const double a[3] = {u[0], u[1], 0}, b[3] = {w[0], w[1], 0}, c[3] = {w[0], w[1], hgt}, d[3] = {u[0], u[1], hgt};
      sc.quad(a, b, c, d, wall, 0);
    }
    for (int i : earclip(p)) sc.vert(p[(size_t)i][0], p[(size_t)i][1], hgt, 0, 0, 1, roof, 0);
    nBuild++;
  }
  for (const auto &t : env["trees"].arr) {
    const double x = t[(size_t)0].n(), y = t[(size_t)1].n();
    if (onCircuit(x, y, 2.5)) continue;
    tree(x, y, 7 + 6 * hash2(x, y));
    nTree++;
  }
  {
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
  scenery.upload(sc);
  worldTris = (g.count() + m.count() + dm.count() + sc.count()) / 3;
  std::fprintf(stderr, "world: %zu triangles  (%zu buildings, %zu trees, surface bake %s)\n", worldTris, nBuild, nTree,
               haveSurf ? "yes" : "no — fallback");
  camReady = false;
}

// ---------------------------------------------------------------------------
// The car — drawn from the spec's real dimensions. Not the downloaded model.
// ---------------------------------------------------------------------------
static void wheelMesh(MeshB &b, double r, double w) {
  const float TYRE[3] = {0.045f, 0.045f, 0.05f}, RIM[3] = {0.20f, 0.20f, 0.22f}, RIM2[3] = {0.55f, 0.55f, 0.58f};
  const int S = 18;
  const double ri = r * 0.60, hw = w / 2;
  for (int s = 0; s < S; s++) {
    const double a0 = 2 * PI * s / S, a1 = 2 * PI * (s + 1) / S;
    const double c0 = std::cos(a0), s0 = std::sin(a0), c1 = std::cos(a1), s1 = std::sin(a1);
    // tread
    const double t0[3] = {r * c0, -hw, r * s0}, t1[3] = {r * c1, -hw, r * s1}, t2[3] = {r * c1, hw, r * s1}, t3[3] = {r * c0, hw, r * s0};
    b.quad(t0, t1, t2, t3, TYRE, 0);
    for (double side : {-1.0, 1.0}) {
      const double y = side * hw;
      const double o0[3] = {r * c0, y, r * s0}, o1[3] = {r * c1, y, r * s1}, i0[3] = {ri * c0, y, ri * s0}, i1[3] = {ri * c1, y, ri * s1};
      const double hub[3] = {0, y, 0};
      b.quad(o0, o1, i1, i0, TYRE, 0);
      b.tri(i0, i1, hub, (s % 3 == 0) ? RIM2 : RIM, 0);     // a spoke you can see turning
    }
  }
}

void Renderer::buildCar(const Spec &S) {
  const float PAINT[3] = {0.78f, 0.06f, 0.08f}, CARBON[3] = {0.055f, 0.055f, 0.065f}, WHITE[3] = {0.92f, 0.92f, 0.90f};
  const float HELMET[3] = {0.95f, 0.78f, 0.10f}, GLASS[3] = {0.07f, 0.09f, 0.12f}, LIGHT[3] = {0.9f, 0.05f, 0.05f};
  MeshB body, fw, rw, helm, wf, wr;
  const double hw = S.bodyW / 2;
  const double over = S.bodyL - S.L;
  if (!S.gt) {
    const double xF = S.a + over * 0.565, xR = -S.b - over * 0.435;
    const double rF = S.key == "f4" ? 0.29 : 0.36, rR = S.key == "f4" ? 0.30 : 0.36;
    const double wF = S.key == "f4" ? 0.25 : 0.36, wR = S.key == "f4" ? 0.31 : 0.42;
    wheelR_f = rF; wheelR_r = rR;
    const double k = S.bodyW / 2.0;                    // widths scale with the car
    // floor and plank
    body.box(-S.b - 0.30, S.a - 0.55, -0.74 * k, 0.74 * k, 0.035, 0.085, CARBON, 0);
    // nose -> tub -> engine cover
    body.taper(xF - 0.10, 0.08, 0.15, 0.24, S.a - 0.35, 0.23 * k, 0.15, 0.50, PAINT, 6);
    body.taper(S.a - 0.35, 0.23 * k, 0.15, 0.50, -0.10, 0.34 * k, 0.09, 0.62, PAINT, 6);
    body.taper(-0.10, 0.31 * k, 0.09, 0.62, -S.b - 0.10, 0.13 * k, 0.12, 0.40, PAINT, 6);
    // airbox and its spine
    body.taper(-0.12, 0.12, 0.60, 0.94, -S.b + 0.15, 0.04, 0.38, 0.56, PAINT, 6);
    // cockpit opening
    body.box(0.02, 0.55, -0.21, 0.21, 0.50, 0.635, CARBON, 0);
    // sidepods
    for (double sd : {-1.0, 1.0})
      body.taper(0.58, 0.20 * k, 0.09, 0.43, -S.b + 0.35, 0.13 * k, 0.09, 0.30, PAINT, 6, sd * 0.54 * k);
    // the halo: a pillar and two arms
    {
      const double top[3] = {0.84, 0, 0.96}, foot[3] = {0.90, 0, 0.50};
      body.beam(foot, top, 0.045, CARBON, 0);
      for (double sd : {-1.0, 1.0}) {
        const double back[3] = {-0.08, sd * 0.31, 0.92}, mid[3] = {0.45, sd * 0.27, 1.00};
        body.beam(top, mid, 0.04, CARBON, 0);
        body.beam(mid, back, 0.04, CARBON, 0);
      }
    }
    // suspension: two arms a wheel
    double W[4][2];
    wheelPos(S, W);
    for (int i = 0; i < 4; i++) {
      const double r = i < 2 ? rF : rR, sd = W[i][1] > 0 ? 1 : -1, inb = (i < 2 ? 0.20 : 0.16) * k;
      const double hub[3] = {W[i][0], W[i][1] - sd * 0.20, r};
      const double c1[3] = {W[i][0] + 0.28, sd * inb, r + 0.08}, c2[3] = {W[i][0] - 0.30, sd * inb, r - 0.10};
      body.beam(c1, hub, 0.035, CARBON, 0);
      body.beam(c2, hub, 0.035, CARBON, 0);
    }
    // diffuser and the rain light
    body.box(xR + 0.05, -S.b - 0.10, -0.42 * k, 0.42 * k, 0.09, 0.22, CARBON, 0);
    body.box(xR + 0.02, xR + 0.07, -0.04, 0.04, 0.28, 0.40, LIGHT, 8);
    // front wing
    fw.box(xF - 0.44, xF - 0.06, -hw + 0.02, hw - 0.02, 0.065, 0.10, WHITE, 6);
    fw.box(xF - 0.52, xF - 0.26, -hw + 0.04, -0.16, 0.16, 0.19, PAINT, 6);
    fw.box(xF - 0.52, xF - 0.26, 0.16, hw - 0.04, 0.16, 0.19, PAINT, 6);
    for (double sd : {-1.0, 1.0}) fw.box(xF - 0.54, xF - 0.02, sd * hw - 0.02, sd * hw + 0.02, 0.05, 0.27, PAINT, 6);
    // rear wing
    const double rwW = 0.50 * k;
    rw.box(xR + 0.04, xR + 0.40, -rwW, rwW, 0.82, 0.86, CARBON, 6);
    rw.box(xR + 0.00, xR + 0.22, -rwW, rwW, 0.90, 0.93, PAINT, 6);
    for (double sd : {-1.0, 1.0}) rw.box(xR - 0.02, xR + 0.46, sd * rwW - 0.015, sd * rwW + 0.015, 0.32, 0.97, PAINT, 6);
    rw.box(xR + 0.16, xR + 0.26, -0.03, 0.03, 0.38, 0.82, CARBON, 0);
    helm.box(0.08, 0.36, -0.13, 0.13, 0.60, 0.87, HELMET, 6);
    helm.box(0.30, 0.37, -0.11, 0.11, 0.70, 0.80, GLASS, 6);
    wheelMesh(wf, rF, wF);
    wheelMesh(wr, rR, wR);
  } else {
    // A closed car: body, cabin, splitter, wing on swan necks.
    const double xF = S.a + over * 0.50, xR = -S.b - over * 0.50;
    const double r = 0.34;
    wheelR_f = wheelR_r = r;
    body.taper(xF, hw * 0.90, 0.14, 0.52, xF - 0.9, hw, 0.12, 0.72, PAINT, 6);
    body.box(xR + 0.25, xF - 0.9, -hw, hw, 0.12, 0.74, PAINT, 6);
    body.taper(xR + 0.25, hw, 0.12, 0.74, xR, hw * 0.92, 0.22, 0.70, PAINT, 6);
    body.taper(0.75, hw * 0.74, 0.74, 0.76, 0.10, hw * 0.70, 0.74, 1.18, GLASS, 6);
    body.box(-0.75, 0.10, -hw * 0.70, hw * 0.70, 0.74, 1.18, PAINT, 6);
    body.taper(-0.75, hw * 0.70, 0.74, 1.18, -1.55, hw * 0.66, 0.74, 0.80, GLASS, 6);
    body.box(xF - 0.05, xF + 0.14, -hw, hw, 0.07, 0.11, CARBON, 0);
    body.box(xR + 0.02, xR + 0.07, -hw * 0.8, hw * 0.8, 0.50, 0.58, LIGHT, 8);
    rw.box(xR - 0.05, xR + 0.33, -hw * 0.92, hw * 0.92, 1.16, 1.20, CARBON, 6);
    for (double sd : {-1.0, 1.0}) {
      rw.box(xR - 0.07, xR + 0.36, sd * hw * 0.92 - 0.015, sd * hw * 0.92 + 0.015, 1.06, 1.26, CARBON, 0);
      const double p0[3] = {xR + 0.30, sd * 0.42, 0.72}, p1[3] = {xR + 0.15, sd * 0.42, 1.17};
      rw.beam(p0, p1, 0.05, CARBON, 0);
    }
    wheelMesh(wf, r, 0.30);
    wheelMesh(wr, r, 0.32);
  }
  carBody.upload(body); carFrontWing.upload(fw); carRearWing.upload(rw); carHelmet.upload(helm);
  wheelF.upload(wf); wheelR.upload(wr);

  MeshB sh;
  const float BLK[3] = {0, 0, 0};
  const double a[3] = {-S.bodyL / 2 - 0.1, -hw - 0.08, 0}, b[3] = {S.bodyL / 2 + 0.1, -hw - 0.08, 0};
  const double c[3] = {S.bodyL / 2 + 0.1, hw + 0.08, 0}, d[3] = {-S.bodyL / 2 - 0.1, hw + 0.08, 0};
  sh.flat(a, b, c, d, BLK, 8);
  shadow.upload(sh);
}

void Renderer::drawMesh(const GLMesh &m, const Mat4 &model, float alpha) {
  glUniformMatrix4fv(uModel, 1, GL_FALSE, model.m);
  glUniform1f(uAlpha, alpha);
  m.draw();
}

void Renderer::drawWorld(const FrameIn &f) {
  const Car &car = *f.car;
  const Spec &S = *f.spec;
  glViewport(0, 0, W, H);
  glClearColor(0.78f, 0.84f, 0.90f, 1);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glDisable(GL_CULL_FACE);
  glDisable(GL_BLEND);
  glUseProgram(prog);

  // ---- where the car is, in GL space
  // A grounded single-seater pitches and rolls by fractions of a degree. That
  // is real, and invisible; scale it so the eye can read weight moving — from
  // OUTSIDE. From the seat the horizon tips by what the car really does.
  const float gain = (car.airborne || f.camMode == 0) ? 1.0f : 3.0f;
  const Mat4 carM = Mat4::translate((float)car.x, (float)std::max(0.0, car.z), (float)-car.y)
                  * Mat4::rotY((float)car.hdg) * Mat4::rotZ((float)car.pitch * gain) * Mat4::rotX((float)car.roll * gain);

  // ---- camera. ONE field of view, always: this is a sim rig.
  float eye[3], at[3], up[3] = {0, 1, 0};
  if (f.camMode == 0) {
    // the driver's eye. No virtual wheel and no helmet in view. The closed
    // car's cabin is a solid block for now, so its eye sits at the base of
    // the windscreen, on the driver's side: a scuttle camera, not a seat.
    const float e[3] = {S.gt ? 0.82f : 0.20f, S.gt ? 1.00f : 0.76f, S.gt ? -0.36f : 0.0f};
    const float t[3] = {e[0] + 10.0f, e[1] - 0.45f, e[2]};
    const float u[3] = {0, 1, 0};
    xform(carM, e, 1, eye); xform(carM, t, 1, at); xform(carM, u, 0, up);
  } else {
    double d = car.hdg - camYaw;
    while (d > PI) d -= 2 * PI;
    while (d < -PI) d += 2 * PI;
    if (!camReady) { camYaw = car.hdg; camReady = true; }
    else camYaw += d * std::min(1.0, f.dt * 7.0);
    const double back = f.camMode == 1 ? 7.4 : 17.0, hgt = f.camMode == 1 ? 2.35 : 7.5;
    const double cx = std::cos(camYaw), cy = std::sin(camYaw);
    eye[0] = (float)(car.x - cx * back); eye[1] = (float)(car.z + hgt); eye[2] = (float)-(car.y - cy * back);
    at[0] = (float)(car.x + cx * 6); at[1] = (float)(car.z + 0.9); at[2] = (float)-(car.y + cy * 6);
  }
  const Mat4 proj = Mat4::perspective(52.0f * (float)PI / 180, (float)W / (float)std::max(1, H), 0.12f, 12000.0f);
  const Mat4 view = Mat4::lookAt(eye, at, up);
  const Mat4 VP = proj * view;
  glUniformMatrix4fv(uVP, 1, GL_FALSE, VP.m);
  glUniform3f(uEye, eye[0], eye[1], eye[2]);
  const float sl = std::sqrt(0.42f * 0.42f + 0.80f * 0.80f + 0.36f * 0.36f);
  glUniform3f(uSun, 0.42f / sl, 0.80f / sl, 0.36f / sl);

  // sky, then the ground sheet: neither writes depth
  glDisable(GL_DEPTH_TEST);
  glDepthMask(GL_FALSE);
  drawMesh(sky, Mat4::translate(eye[0], eye[1], eye[2]) * Mat4::scale(5000, 5000, 5000));
  drawMesh(ground, Mat4::identity());
  glDepthMask(GL_TRUE);
  glEnable(GL_DEPTH_TEST);
  glDepthFunc(GL_LEQUAL);

  drawMesh(corridor, Mat4::identity());
  drawMesh(scenery, Mat4::identity());

  glEnable(GL_POLYGON_OFFSET_FILL);
  glPolygonOffset(-2.0f, -6.0f);
  drawMesh(decals, Mat4::identity());
  if (f.showLine) drawMesh(lineMesh, Mat4::identity());
  // a soft dark patch under the car: the cheapest thing that glues it down
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glDepthMask(GL_FALSE);
  const float lift = (float)std::max(0.0, car.z);
  drawMesh(shadow, Mat4::translate((float)car.x, 0.004f, (float)-car.y) * Mat4::rotY((float)car.hdg), 0.42f / (1.0f + lift * 1.5f));
  glDepthMask(GL_TRUE);
  glDisable(GL_BLEND);
  glDisable(GL_POLYGON_OFFSET_FILL);

  // ---- the car
  drawMesh(carBody, carM);
  if (!(car.hasLost && car.lostFrontWing)) drawMesh(carFrontWing, carM);
  if (!(car.hasLost && car.lostRearWing)) drawMesh(carRearWing, carM);
  if (f.camMode != 0) drawMesh(carHelmet, carM);
  double Wp[4][2];
  wheelPos(S, Wp);
  for (int i = 0; i < 4; i++) {
    if (car.wheelLost[i]) continue;
    const double r = i < 2 ? wheelR_f : wheelR_r;
    Mat4 wm = carM * Mat4::translate((float)Wp[i][0], (float)r, (float)-Wp[i][1]);
    if (i < 2) wm = wm * Mat4::rotY((float)car.steerEff);
    wm = wm * Mat4::rotZ((float)(-f.wheelAngle / r));
    drawMesh(i < 2 ? wheelF : wheelR, wm);
  }
  glBindVertexArray(0);
}

// ---------------------------------------------------------------------------
// HUD: a 5x7 font, drawn as rectangles. No texture, no file.
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

void Renderer::hudBegin() { hud.clear(); }
void Renderer::rect(float x, float y, float w, float h, const float c[4]) {
  const float p[6][2] = {{x, y}, {x + w, y}, {x + w, y + h}, {x, y}, {x + w, y + h}, {x, y + h}};
  for (const auto &q : p) hud.insert(hud.end(), {q[0], q[1], c[0], c[1], c[2], c[3]});
}
float Renderer::textWidth(float px, const std::string &s) const { return s.empty() ? 0 : (float)s.size() * 6 * px - px; }
void Renderer::text(float x, float y, float px, const std::string &s, const float c[4], Align al) {
  if (al == CENTRE) x -= textWidth(px, s) / 2;
  else if (al == RIGHT) x -= textWidth(px, s);
  for (char ch : s) {
    const unsigned char *g = glyph(ch);
    for (int r = 0; r < 7; r++)
      for (int col = 0; col < 5; col++)
        if (g[r] & (0x10 >> col)) rect(x + col * px, y + r * px, px, px, c);
    x += 6 * px;
  }
}
void Renderer::hudEnd() {
  if (hud.empty()) return;
  glDisable(GL_DEPTH_TEST);
  glEnable(GL_BLEND);
  glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glUseProgram(hudProg);
  glUniform2f(uHudSize, (float)W, (float)H);
  glBindVertexArray(hudVao);
  glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(hud.size() * sizeof(float)), hud.data(), GL_STREAM_DRAW);
  glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(hud.size() / 6));
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
