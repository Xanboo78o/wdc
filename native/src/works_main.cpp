// works_main.cpp — XBR WORKS: build a car out of pieces.
//
// Adam, 2026-10-08: "i wanna just pull up a pic of a lego car and the real
// version and just replicate fast asf". So: a plate, a tray of pieces, and a
// piece in your hand that snaps to whatever the mouse is over. Any face takes
// a piece, pieces may pass through each other, and the far side builds itself.
//
//   native/works [name]            open (or start) data/garage/<name>.json
//   native/works name --ref pic    with a picture pinned in the corner (or drop one on the window)
//   xbr-works name --shot f.ppm [--yaw D --pitch D --dist M]   one frame, unseen, and exit
//   xbr-works --tray --shot f.ppm  one of every piece, for looking at the catalogue
//
// It links bricks.cpp and nothing else of the game: its own small shader, its
// own text. The car file is the only thing the two share.
#include <epoxy/gl.h>
#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MULTIPLE_MASTERS_H
#include <spawn.h>
#include <sys/wait.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

#include "bricks.hpp"

extern char **environ;
using namespace xbr::bricks;

static constexpr float PI = 3.14159265f;

// ---- small maths ------------------------------------------------------------------
struct V3 { float x, y, z; };
static V3 operator+(V3 a, V3 b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
static V3 operator-(V3 a, V3 b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
static V3 operator*(V3 a, float k) { return {a.x * k, a.y * k, a.z * k}; }
static float dot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static V3 cross(V3 a, V3 b) { return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x}; }
static V3 norm(V3 a) { const float l = std::sqrt(dot(a, a)); return l > 1e-9f ? a * (1 / l) : V3{0, 1, 0}; }

static void perspective(float *m, float fovy, float asp, float zn, float zf) {
  std::memset(m, 0, 64);
  const float f = 1 / std::tan(fovy / 2);
  m[0] = f / asp; m[5] = f; m[10] = (zf + zn) / (zn - zf); m[11] = -1; m[14] = 2 * zf * zn / (zn - zf);
}
static void lookAt(float *m, V3 e, V3 f, V3 r, V3 u) {       // f forward, r right, u up: all unit
  const float t[16] = {r.x, u.x, -f.x, 0, r.y, u.y, -f.y, 0, r.z, u.z, -f.z, 0, -dot(r, e), -dot(u, e), dot(f, e), 1};
  std::memcpy(m, t, 64);
}
static void mul(float *o, const float *a, const float *b) {
  float t[16];
  for (int c = 0; c < 4; c++) for (int r = 0; r < 4; r++) t[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  std::memcpy(o, t, 64);
}

// ---- GL ---------------------------------------------------------------------------
static const char *VS = R"(#version 330 core
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec3 aC; layout(location=3) in float aM;
uniform mat4 uVP; uniform vec3 uShift;
out vec3 vP; out vec3 vN; out vec3 vC; out float vM;
void main(){ vP = aP + uShift; vN = aN; vC = aC; vM = aM; gl_Position = uVP * vec4(vP, 1.0); })";
static const char *FS = R"(#version 330 core
in vec3 vP; in vec3 vN; in vec3 vC; in float vM;
uniform vec3 uEye; uniform float uAlpha; uniform vec4 uTint;
out vec4 o;
vec3 sky(vec3 d){ return mix(vec3(0.10,0.11,0.13), vec3(0.55,0.62,0.74), smoothstep(-0.2, 0.9, d.y)) + vec3(1.0,0.95,0.85) * pow(max(dot(d, normalize(vec3(0.45,0.8,0.35))), 0.0), 40.0); }
void main(){
  int m = int(vM + 0.5);
  vec3 c = pow(vC, vec3(2.2));
  if (m == 7) { o = vec4(pow(mix(c, uTint.rgb, uTint.a), vec3(1.0/2.2)), uAlpha); return; }
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uEye - vP);
  vec3 L = normalize(vec3(0.45, 0.8, 0.35)), L2 = normalize(vec3(-0.6, 0.3, -0.5));
  vec3 H = normalize(L + V);
  float d = max(dot(N, L), 0.0), d2 = max(dot(N, L2), 0.0);
  vec3 hemi = mix(vec3(0.20,0.20,0.22), vec3(0.62,0.66,0.74), N.y * 0.5 + 0.5);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  float gloss = 60.0, spec = 0.45, refl = 0.10, a = uAlpha;
  if (m == 1) { gloss = 10.0; spec = 0.06; refl = 0.0; }
  if (m == 2) { gloss = 120.0; spec = 0.9; refl = 0.35; a *= 0.34; c = c * 0.6; }
  if (m == 3) { gloss = 90.0; spec = 0.9; refl = 0.75; c *= 0.25; }
  if (m == 5) { gloss = 30.0; spec = 0.25; refl = 0.06;
    float w = step(0.5, fract((vP.x + vP.y + vP.z) * 40.0)) * 0.5 + step(0.5, fract((vP.x - vP.z + vP.y) * 40.0)) * 0.5;
    c = mix(vec3(0.016), vec3(0.030), w * smoothstep(9.0, 3.0, distance(uEye, vP))); }
  if (m == 6) { gloss = 6.0; spec = 0.04; refl = 0.0; }
  vec3 col = c * (hemi * 0.55 + vec3(1.0,0.96,0.9) * d * 0.95 + vec3(0.5,0.6,0.8) * d2 * 0.18);
  col += sky(R) * (refl + fres * 0.35 * step(0.01, refl)) + vec3(1.0) * spec * pow(max(dot(N, H), 0.0), gloss);
  if (m == 4) col = c * 1.25 + vec3(0.25) * pow(max(dot(N, V), 0.0), 3.0);
  if (m == 2) a = clamp(a + fres * 0.5, 0.0, 1.0);
  col = mix(col, uTint.rgb, uTint.a);
  o = vec4(pow(col, vec3(1.0/2.2)), a);
})";
static const char *HVS = R"(#version 330 core
layout(location=0) in vec2 aP; layout(location=1) in vec2 aU; layout(location=2) in vec4 aC;
uniform vec2 uSize; out vec2 vU; out vec4 vC;
void main(){ vU = aU; vC = aC; gl_Position = vec4(aP.x / uSize.x * 2.0 - 1.0, 1.0 - aP.y / uSize.y * 2.0, 0.0, 1.0); })";
static const char *HFS = R"(#version 330 core
in vec2 vU; in vec4 vC; uniform sampler2D uTex; uniform int uMode; out vec4 o;
void main(){
  if (uMode == 1) { o = vec4(texture(uTex, vU).rgb, vC.a); return; }
  float a = vU.x < 0.0 ? 1.0 : texture(uTex, vU).r;
  o = vec4(vC.rgb, vC.a * a);
})";

static GLuint compile(GLenum type, const char *src) {
  const GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[2048]; glGetShaderInfoLog(s, sizeof log, nullptr, log); std::fprintf(stderr, "works: shader: %s\n", log); }
  return s;
}
static GLuint program(const char *vs, const char *fs) {
  const GLuint p = glCreateProgram();
  glAttachShader(p, compile(GL_VERTEX_SHADER, vs));
  glAttachShader(p, compile(GL_FRAGMENT_SHADER, fs));
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { char log[2048]; glGetProgramInfoLog(p, sizeof log, nullptr, log); std::fprintf(stderr, "works: link: %s\n", log); }
  return p;
}

struct Mesh {
  GLuint vao = 0, vbo = 0;
  int count = 0;
  void set(const std::vector<float> &v, GLenum usage = GL_DYNAMIC_DRAW) {
    if (!vao) { glGenVertexArrays(1, &vao); glGenBuffers(1, &vbo); }
    glBindVertexArray(vao);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * sizeof(float)), v.data(), usage);
    const GLsizei st = 10 * sizeof(float);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, st, (void *)0);
    glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, st, (void *)(3 * sizeof(float)));
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 3, GL_FLOAT, GL_FALSE, st, (void *)(6 * sizeof(float)));
    glEnableVertexAttribArray(3); glVertexAttribPointer(3, 1, GL_FLOAT, GL_FALSE, st, (void *)(9 * sizeof(float)));
    count = (int)(v.size() / 10);
  }
  void draw(GLenum mode = GL_TRIANGLES) const { if (count) { glBindVertexArray(vao); glDrawArrays(mode, 0, count); } }
};

// ---- text ---------------------------------------------------------------------------
struct Glyph { float x, y, w, h, bx, by, adv; };
static Glyph glyphs[95];
static GLuint fontTex = 0;
static const int FONT_PX = 40, ATLAS = 512;
static bool loadFont(const std::string &path) {
  FT_Library ft = nullptr;
  FT_Face face = nullptr;
  if (FT_Init_FreeType(&ft)) return false;
  if (FT_New_Face(ft, path.c_str(), 0, &face)) { FT_Done_FreeType(ft); return false; }
  FT_MM_Var *mm = nullptr;
  if (!FT_Get_MM_Var(face, &mm) && mm) {
    std::vector<FT_Fixed> co(mm->num_axis);
    for (unsigned i = 0; i < mm->num_axis; i++) co[i] = mm->axis[i].tag == FT_MAKE_TAG('w', 'g', 'h', 't') ? 600 * 65536 : mm->axis[i].def;
    FT_Set_Var_Design_Coordinates(face, mm->num_axis, co.data());
    FT_Done_MM_Var(ft, mm);
  }
  FT_Set_Pixel_Sizes(face, 0, FONT_PX);
  std::vector<unsigned char> px((size_t)ATLAS * ATLAS, 0);
  int x = 2, y = 2, row = 0;
  for (int c = 32; c < 127; c++) {
    Glyph &g = glyphs[c - 32];
    g = {};
    if (FT_Load_Char(face, (FT_ULong)c, FT_LOAD_RENDER)) continue;
    const FT_GlyphSlot sl = face->glyph;
    const int w = (int)sl->bitmap.width, h = (int)sl->bitmap.rows;
    if (x + w + 2 > ATLAS) { x = 2; y += row + 2; row = 0; }
    if (y + h + 2 > ATLAS) break;
    for (int j = 0; j < h; j++) std::memcpy(&px[(size_t)(y + j) * ATLAS + x], sl->bitmap.buffer + (size_t)j * sl->bitmap.pitch, (size_t)w);
    g = {(float)x, (float)y, (float)w, (float)h, (float)sl->bitmap_left, (float)sl->bitmap_top, (float)(sl->advance.x >> 6)};
    x += w + 2; row = std::max(row, h);
  }
  FT_Done_Face(face);
  FT_Done_FreeType(ft);
  glGenTextures(1, &fontTex);
  glBindTexture(GL_TEXTURE_2D, fontTex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, ATLAS, ATLAS, 0, GL_RED, GL_UNSIGNED_BYTE, px.data());
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  return true;
}

struct Hud {
  std::vector<float> v;       // pos2 uv2 col4
  void quad(float x, float y, float w, float h, float u0, float v0, float u1, float v1, const float *c) {
    const float q[6][4] = {{x, y, u0, v0}, {x + w, y, u1, v0}, {x + w, y + h, u1, v1}, {x, y, u0, v0}, {x + w, y + h, u1, v1}, {x, y + h, u0, v1}};
    for (auto &p : q) { v.insert(v.end(), {p[0], p[1], p[2], p[3], c[0], c[1], c[2], c[3]}); }
  }
  void rect(float x, float y, float w, float h, const float *c) { quad(x, y, w, h, -1, -1, -1, -1, c); }
  void rect(float x, float y, float w, float h, unsigned rgb, float a = 1) {
    const float c[4] = {((rgb >> 16) & 255) / 255.0f, ((rgb >> 8) & 255) / 255.0f, (rgb & 255) / 255.0f, a};
    rect(x, y, w, h, c);
  }
  float width(float px, const std::string &s) const {
    float w = 0;
    for (char ch : s) if (ch >= 32 && ch < 127) w += glyphs[ch - 32].adv;
    return w * px / FONT_PX;
  }
  // y is the top of the line; align 0 left, 1 centre, 2 right
  void text(float x, float y, float px, const std::string &s, unsigned rgb = 0xe8e6e0, float a = 1, int align = 0) {
    const float k = px / FONT_PX, c[4] = {((rgb >> 16) & 255) / 255.0f, ((rgb >> 8) & 255) / 255.0f, (rgb & 255) / 255.0f, a};
    if (align) x -= width(px, s) * (align == 1 ? 0.5f : 1.0f);
    const float base = y + px * 0.78f;
    for (char ch : s) {
      if (ch < 32 || ch >= 127) continue;
      const Glyph &g = glyphs[ch - 32];
      if (g.w > 0) quad(x + g.bx * k, base - g.by * k, g.w * k, g.h * k, g.x / ATLAS, g.y / ATLAS, (g.x + g.w) / ATLAS, (g.y + g.h) / ATLAS, c);
      x += g.adv * k;
    }
  }
};

// ---- the palette --------------------------------------------------------------------
static const unsigned PALETTE[] = {
  0xf2f2ee, 0xbfc3c8, 0x7d8188, 0x3a3d42, 0x15161a, 0xd6001c, 0xff5a1f, 0xff7a00, 0xffcc00, 0xcfff1a,
  0x2fb34a, 0x0b5b46, 0x00d2be, 0x47c7fc, 0x8fcbea, 0x1a55d8, 0x0e1c43, 0x6a2fb0, 0xff5fa2, 0x8a1538,
  0x7a4a24, 0xd4af37, 0xfff1c9, 0xff2a12,
};
static const int N_PAL = (int)(sizeof(PALETTE) / sizeof(PALETTE[0]));

// ---- the editor ---------------------------------------------------------------------
enum Tool { BUILD, BRUSH, ERASE };
struct Hit { int piece = -1; V3 at{0, 0, 0}; int axis = 1, sign = 1; float t = 1e30f; bool any = false; };

struct App {
  Car car;
  std::string path;
  std::vector<std::vector<Piece>> undo, redo;
  Piece hand;                         // what is about to be placed (its p is worked out each frame)
  int sizes[N_SHAPES][3];             // the size each shape was last used at
  int tool = BUILD;
  bool mirror = true, half = false;
  bool ghostOk = false;
  Hit hit;
  // camera
  V3 target{0, 0.5f, 0};
  float yaw = 0.75f, pitch = 0.42f, dist = 9.0f;
  int W = 1600, H = 900;
  float mx = 0, my = 0;
  // derived
  std::vector<std::vector<float>> pm;  // each piece's triangles
  Mesh solid, glass, ghost, hover, plate, guide;
  Stats stats;
  bool dirty = true;
  std::string flash; double flashT = 0;
  // reference picture
  GLuint refTex = 0; int refW = 0, refH = 0; bool refOn = true;

  void status(const std::string &s) { flash = s; flashT = 2.2; }
  void adopt(int shape) {
    const int keepCol = hand.col, keepMat = hand.mat;
    hand.shape = shape;
    for (int i = 0; i < 3; i++) hand.s[i] = sizes[shape][i];
    const ShapeInfo &I = info(shape);
    hand.col = keepCol;
    hand.mat = I.mat >= 0 ? I.mat : (keepMat == GLASS || keepMat == LIGHT ? (int)xbr::bricks::PAINT : keepMat);
    if (shape == LAMP_ROUND || shape == LAMP_SQUARE) hand.col = 0xfff1c9;
    if (shape == SCREEN) hand.col = 0x9fb6c4;
    if (shape == WHEEL) hand.col = 0xbfc3c8;
    if (shape == SEAT || shape == WING) hand.col = 0x15161a;
    hand.flip = false;
    const int I9[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
    std::memcpy(hand.r, I9, sizeof I9);
  }
  void push() { undo.push_back(car.pieces); if (undo.size() > 400) undo.erase(undo.begin()); redo.clear(); }
  void changed() { dirty = true; if (!path.empty() && !car.save(path)) status("COULD NOT SAVE to " + path); }
  void rebuild() {
    pm.assign(car.pieces.size(), {});
    std::vector<float> s, g;
    for (size_t i = 0; i < car.pieces.size(); i++) {
      mesh(car.pieces[i], pm[i]);
      for (size_t k = 0; k + 9 < pm[i].size(); k += 30) {
        // a triangle is glass or it is not; send it to the pass that draws it
        const bool gl = (int)(pm[i][k + 9] + 0.5f) == GLASS;
        (gl ? g : s).insert((gl ? g : s).end(), pm[i].begin() + (long)k, pm[i].begin() + (long)k + 30);
      }
    }
    solid.set(s); glass.set(g);
    stats = derive(car);
    dirty = false;
    buildGuide();
  }
  void line(std::vector<float> &v, V3 a, V3 b, unsigned rgb) {
    const float c[3] = {((rgb >> 16) & 255) / 255.0f, ((rgb >> 8) & 255) / 255.0f, (rgb & 255) / 255.0f};
    for (V3 p : {a, b}) v.insert(v.end(), {p.x, p.y, p.z, 0, 1, 0, c[0], c[1], c[2], (float)LINE});
  }
  void buildPlate() {
    std::vector<float> v;
    const float S = STUD * (float)UNIT, X = 16 * S, Z = 8 * S;
    for (int i = -16; i <= 16; i++) line(v, {i * S, 0, -Z}, {i * S, 0, Z}, i % 4 == 0 ? 0x4a4f57 : 0x30343a);
    for (int i = -8; i <= 8; i++) line(v, {-X, 0, i * S}, {X, 0, i * S}, i == 0 ? 0xd6001c : (i % 4 == 0 ? 0x4a4f57 : 0x30343a));
    plate.set(v, GL_STATIC_DRAW);
  }
  // The class's footprint and axle lines, to build to. A guide, not a rule.
  void buildGuide() {
    std::vector<float> v;
    const Klass &K = KLASSES[car.klass];
    const float l = (float)K.len / 2, w = (float)K.wid / 2, b = (float)K.wb / 2, y = 0.004f;
    const unsigned c = 0xffcc00;
    line(v, {-l, y, -w}, {l, y, -w}, c); line(v, {l, y, -w}, {l, y, w}, c); line(v, {l, y, w}, {-l, y, w}, c); line(v, {-l, y, w}, {-l, y, -w}, c);
    line(v, {b, y, -w}, {b, y, w}, 0x47c7fc); line(v, {-b, y, -w}, {-b, y, w}, 0x47c7fc);
    line(v, {l, y, 0}, {l + 0.5f, y, 0}, c); line(v, {l + 0.5f, y, 0}, {l + 0.3f, y, 0.12f}, c); line(v, {l + 0.5f, y, 0}, {l + 0.3f, y, -0.12f}, c);   // FRONT
    guide.set(v);
  }

  // camera basis
  void basis(V3 &eye, V3 &f, V3 &r, V3 &u) const {
    const V3 off{std::cos(pitch) * std::cos(yaw), std::sin(pitch), std::cos(pitch) * std::sin(yaw)};
    eye = target + off * dist;
    f = norm(target - eye);
    r = norm(cross(f, V3{0, 1, 0}));
    u = cross(r, f);
  }
  static constexpr float FOV = 36.0f * PI / 180;
  void ray(float px, float py, V3 &o, V3 &d) const {
    V3 f, r, u;
    basis(o, f, r, u);
    const float t = std::tan(FOV / 2), nx = (2 * px / W - 1) * t * W / H, ny = (1 - 2 * py / H) * t;
    d = norm(f + r * nx + u * ny);
  }

  // What is under the mouse: the nearest triangle of any piece, else the plate.
  Hit pick(V3 o, V3 d) const {
    Hit h;
    for (size_t i = 0; i < pm.size(); i++) {
      const Piece &p = car.pieces[i];
      int dm[3];
      p.dims(dm);
      // the box first
      float t0 = 0, t1 = h.t;
      const float oo[3] = {o.x, o.y, o.z}, dd[3] = {d.x, d.y, d.z};
      bool miss = false;
      for (int a = 0; a < 3 && !miss; a++) {
        const float lo = p.p[a] * (float)UNIT - 1e-4f, hi = (p.p[a] + dm[a]) * (float)UNIT + 1e-4f;
        if (std::fabs(dd[a]) < 1e-9f) { if (oo[a] < lo || oo[a] > hi) miss = true; continue; }
        float a0 = (lo - oo[a]) / dd[a], a1 = (hi - oo[a]) / dd[a];
        if (a0 > a1) std::swap(a0, a1);
        t0 = std::max(t0, a0); t1 = std::min(t1, a1);
        if (t0 > t1) miss = true;
      }
      if (miss) continue;
      const std::vector<float> &m = pm[i];
      for (size_t k = 0; k + 29 < m.size(); k += 30) {
        const V3 a{m[k], m[k + 1], m[k + 2]}, b{m[k + 10], m[k + 11], m[k + 12]}, c{m[k + 20], m[k + 21], m[k + 22]};
        const V3 e1 = b - a, e2 = c - a, pv = cross(d, e2);
        const float det = dot(e1, pv);
        if (std::fabs(det) < 1e-12f) continue;
        const V3 tv = o - a;
        const float u = dot(tv, pv) / det;
        if (u < 0 || u > 1) continue;
        const V3 qv = cross(tv, e1);
        const float v = dot(d, qv) / det;
        if (v < 0 || u + v > 1) continue;
        const float t = dot(e2, qv) / det;
        if (t <= 1e-4f || t >= h.t) continue;
        V3 n = norm(cross(e1, e2));
        if (dot(n, d) > 0) n = n * -1;
        h.t = t; h.piece = (int)i; h.any = true; h.at = o + d * t;
        const float an[3] = {std::fabs(n.x), std::fabs(n.y), std::fabs(n.z)};
        h.axis = an[0] > an[1] && an[0] > an[2] ? 0 : (an[1] >= an[2] ? 1 : 2);
        h.sign = (h.axis == 0 ? n.x : h.axis == 1 ? n.y : n.z) > 0 ? 1 : -1;
      }
    }
    if (!h.any && d.y < -1e-5f) {
      const float t = -o.y / d.y;
      if (t > 0 && t < 200) { h.t = t; h.any = true; h.at = o + d * t; h.axis = 1; h.sign = 1; h.piece = -1; }
    }
    return h;
  }

  // Where the piece in hand would go. It sits against the face that was hit —
  // the face of the piece's BOX, so a slope takes a piece on top like anything
  // else — and slides along it on the lattice: whole studs sideways (halves
  // with HALF STUD on), half plates up and down.
  void place() {
    ghostOk = false;
    if (!hit.any) return;
    int d[3];
    hand.dims(d);
    const float at[3] = {hit.at.x, hit.at.y, hit.at.z};
    for (int a = 0; a < 3; a++) {
      const int step = a == 1 ? VSTEP : (half ? HALF : STUD);
      if (a == hit.axis) {
        int face;
        if (hit.piece >= 0) {
          const Piece &q = car.pieces[(size_t)hit.piece];
          int qd[3];
          q.dims(qd);
          face = hit.sign > 0 ? q.p[a] + qd[a] : q.p[a];
        } else face = 0;
        hand.p[a] = hit.sign > 0 ? face : face - d[a];
      } else {
        const float lo = at[a] / (float)UNIT - d[a] / 2.0f;
        hand.p[a] = (int)std::floor(lo / step + 0.5f) * step;
      }
    }
    if (hand.p[1] < 0) hand.p[1] = 0;
    ghostOk = true;
  }
  void commit() {
    if (!ghostOk) return;
    push();
    car.pieces.push_back(hand);
    if (mirror) {
      const Piece m = mirrored(hand);
      int d[3];
      hand.dims(d);
      const bool same = m.p[2] == hand.p[2];          // it sits across the centreline: it is its own mirror
      if (!same) car.pieces.push_back(m);
    }
    changed();
  }
  // The piece on the other side that mirrors this one, or -1.
  int twin(int i) const {
    const Piece m = mirrored(car.pieces[(size_t)i]);
    for (size_t k = 0; k < car.pieces.size(); k++) {
      if ((int)k == i) continue;
      const Piece &q = car.pieces[k];
      if (q.shape == m.shape && q.p[0] == m.p[0] && q.p[1] == m.p[1] && q.p[2] == m.p[2] && q.s[0] == m.s[0] && q.s[1] == m.s[1] && q.s[2] == m.s[2]) return (int)k;
    }
    return -1;
  }
  void erase(int i) {
    if (i < 0) return;
    push();
    const int t = mirror ? twin(i) : -1;
    for (int k : {std::max(i, t), std::min(i, t)}) if (k >= 0) car.pieces.erase(car.pieces.begin() + k);
    changed();
  }
  void paint(int i) {
    if (i < 0) return;
    push();
    const int t = mirror ? twin(i) : -1;
    for (int k : {i, t}) if (k >= 0) {
      Piece &p = car.pieces[(size_t)k];
      p.col = hand.col;
      // a lamp stays a lamp and glass stays glass unless that is what is in hand
      if (info(p.shape).mat < 0 || hand.mat == info(p.shape).mat) p.mat = hand.mat;
    }
    changed();
  }
  void eyedrop(int i) {
    if (i < 0) return;
    const Piece &p = car.pieces[(size_t)i];
    hand = p;
    for (int k = 0; k < 3; k++) sizes[p.shape][k] = p.s[k];
    tool = BUILD;
    status(std::string("PICKED ") + info(p.shape).name);
  }
  void resize(int axis, int by) {
    const ShapeInfo &I = info(hand.shape);
    if (!I.sizable) { status(std::string(I.name) + " comes in one size"); return; }
    int &s = hand.s[axis];
    s = std::clamp(s + by, axis == 1 ? VSTEP : (hand.shape == LAMP_ROUND || hand.shape == LAMP_SQUARE || hand.shape == WHEEL ? 2 : HALF), 40 * STUD);
    if (hand.shape == WHEEL && axis != 2) hand.s[0] = hand.s[1] = s;      // a wheel is round
    for (int k = 0; k < 3; k++) sizes[hand.shape][k] = hand.s[k];
  }
  bool loadRef(const std::string &file, const std::string &scratch) {
    // Any picture format: let ImageMagick turn it into a plain PPM.
    const std::string out = scratch + "/works-ref.ppm";
    const char *argv[] = {"magick", file.c_str(), "-auto-orient", "-resize", "900x900>", "-depth", "8", out.c_str(), nullptr};
    pid_t pid;
    if (posix_spawnp(&pid, "magick", nullptr, nullptr, (char *const *)argv, environ) != 0) return false;
    int st = 0;
    waitpid(pid, &st, 0);
    std::ifstream f(out, std::ios::binary);
    std::string magic;
    int w = 0, h = 0, mx = 0;
    if (!(f >> magic >> w >> h >> mx) || magic != "P6" || w <= 0 || h <= 0) return false;
    f.get();
    std::vector<unsigned char> px((size_t)w * h * 3);
    f.read((char *)px.data(), (std::streamsize)px.size());
    if (!refTex) glGenTextures(1, &refTex);
    glBindTexture(GL_TEXTURE_2D, refTex);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB8, w, h, 0, GL_RGB, GL_UNSIGNED_BYTE, px.data());
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    refW = w; refH = h; refOn = true;
    return true;
  }
};

// The panels. One description, used twice: once to draw, once to ask what a
// click landed on — so the picture and the hit test cannot drift apart.
struct Ui {
  enum Kind { NONE, SHAPE, COLOUR, FINISH, TOOL, MIRROR, HALFSTUD, KLASS, PANEL };
  Kind kind = NONE; int index = 0;
};
static const float TRAY_W = 232, ROW = 27, SW = 30;
static std::string sizeText(const Piece &p) {
  auto studs = [](int u) { char b[16]; if (u % STUD == 0) std::snprintf(b, sizeof b, "%d", u / STUD); else std::snprintf(b, sizeof b, "%.1f", u / (double)STUD); return std::string(b); };
  if (p.shape == WHEEL) { char b[64]; std::snprintf(b, sizeof b, "%.0f cm across, %.0f cm wide", p.s[0] * UNIT * 100, p.s[2] * UNIT * 100); return b; }
  std::string h;
  if (p.s[1] == PLATE) h = "plate";
  else if (p.s[1] == BRICK) h = "brick";
  else if (p.s[1] == CUBE) h = "cube";
  else { char b[24]; std::snprintf(b, sizeof b, "%.1f plates", p.s[1] / (double)PLATE); h = b; }
  return studs(p.s[0]) + " x " + studs(p.s[2]) + ", " + h + " high";
}
// draw = false: only answer what is at (mx, my).
static Ui ui(App &A, Hud *hud, float mx, float my) {
  Ui over;
  auto in = [&](float x, float y, float w, float h) { return mx >= x && mx < x + w && my >= y && my < y + h; };
  const float W = (float)A.W, H = (float)A.H;
  // ---- the tray
  const float trayH = 44 + (float)N_SHAPES * ROW + 12;
  if (hud) hud->rect(10, 10, TRAY_W, trayH, 0x14161a, 0.86f);
  if (in(10, 10, TRAY_W, trayH)) over.kind = Ui::PANEL;
  if (hud) hud->text(22, 18, 19, "PIECES", 0x8a8f98);
  if (hud) hud->text(10 + TRAY_W - 12, 20, 14, "Q / E", 0x5d626b, 1, 2);
  for (int i = 0; i < N_SHAPES; i++) {
    const float y = 48 + i * ROW;
    const bool on = A.hand.shape == i, hov = in(10, y, TRAY_W, ROW);
    if (hov) over = {Ui::SHAPE, i};
    if (hud) {
      if (on) hud->rect(10, y, TRAY_W, ROW, 0xd6001c, 1);
      else if (hov) hud->rect(10, y, TRAY_W, ROW, 0x2a2d33, 1);
      hud->text(22, y + 4, 17, info(i).name, on ? 0xffffff : 0xcfd2d6);
    }
  }
  // ---- colours and finishes
  const int perRow = 6;
  const float py = 10 + trayH + 10, palH = 34 + ((N_PAL + perRow - 1) / perRow) * (SW + 4) + 8 + N_FINISH / 2 * ROW + 10;
  if (hud) hud->rect(10, py, TRAY_W, palH, 0x14161a, 0.86f);
  if (in(10, py, TRAY_W, palH)) over.kind = Ui::PANEL;
  if (hud) hud->text(22, py + 8, 19, "COLOUR", 0x8a8f98);
  for (int i = 0; i < N_PAL; i++) {
    const float x = 22 + (i % perRow) * (SW + 4), y = py + 36 + (i / perRow) * (SW + 4);
    if (in(x, y, SW, SW)) over = {Ui::COLOUR, i};
    if (hud) {
      if (A.hand.col == PALETTE[i]) hud->rect(x - 3, y - 3, SW + 6, SW + 6, 0xffffff, 1);
      else hud->rect(x - 1, y - 1, SW + 2, SW + 2, 0x4a4f57, 1);
      hud->rect(x, y, SW, SW, PALETTE[i], 1);
    }
  }
  const float fy = py + 36 + ((N_PAL + perRow - 1) / perRow) * (SW + 4) + 6;
  for (int i = 0; i < N_FINISH; i++) {
    const float x = 10 + (i % 2) * (TRAY_W / 2), y = fy + (i / 2) * ROW;
    const bool on = A.hand.mat == i, hov = in(x, y, TRAY_W / 2, ROW);
    if (hov) over = {Ui::FINISH, i};
    if (hud) {
      if (on) hud->rect(x, y, TRAY_W / 2, ROW, 0x3a3d42, 1);
      else if (hov) hud->rect(x, y, TRAY_W / 2, ROW, 0x23262b, 1);
      std::string n = matName(i);
      for (char &c : n) c = (char)std::toupper(c);
      hud->text(x + 12, y + 4, 16, n, on ? 0xffffff : 0xa9adb3);
    }
  }
  // ---- the top bar: tool, mirror, half stud, class
  struct Btn { const char *label; Ui::Kind k; int i; bool on; float w; };
  const std::string kl = std::string("CLASS  ") + KLASSES[A.car.klass].name;
  const Btn btns[] = {
    {"BUILD  B", Ui::TOOL, BUILD, A.tool == BUILD, 104}, {"PAINT  P", Ui::TOOL, BRUSH, A.tool == BRUSH, 104}, {"ERASE  X", Ui::TOOL, ERASE, A.tool == ERASE, 104},
    {"MIRROR  M", Ui::MIRROR, 0, A.mirror, 118}, {"HALF STUD  J", Ui::HALFSTUD, 0, A.half, 142}, {kl.c_str(), Ui::KLASS, 0, false, 190},
  };
  float bx = 10 + TRAY_W + 12;
  for (const Btn &b : btns) {
    const bool hov = in(bx, 10, b.w, 34);
    if (hov) over = {b.k, b.i};
    if (hud) {
      hud->rect(bx, 10, b.w, 34, b.on ? 0xd6001c : (hov ? 0x2a2d33 : 0x14161a), b.on ? 1 : 0.86f);
      hud->text(bx + b.w / 2, 18, 16, b.label, b.on ? 0xffffff : 0xcfd2d6, 1, 1);
    }
    bx += b.w + 6;
    if (b.k == Ui::TOOL && b.i == ERASE) bx += 12;
  }
  if (!hud) return over;

  // ---- what is in hand
  const float hx = 10 + TRAY_W + 12;
  hud->text(hx, 54, 22, info(A.hand.shape).name, 0xffffff);
  hud->text(hx, 82, 16, sizeText(A.hand) + (A.half ? "   ·   half studs" : ""), 0xa9adb3);

  // ---- the numbers
  const Stats &S = A.stats;
  const float sx = W - 262, sw = 252;
  float sy = 10;
  if (A.refTex && A.refOn) {
    const float rw = std::min(420.0f, W * 0.28f), rh = rw * A.refH / std::max(1, A.refW);
    sy = 10 + rh + 10;                       // the picture has the corner; the numbers sit under it
    (void)rw;
  }
  hud->rect(sx, sy, sw, 268, 0x14161a, 0.86f);
  std::string nm = A.car.name;
  for (char &c : nm) c = (char)std::toupper(c);
  hud->text(sx + 12, sy + 8, 21, nm, 0xffffff);
  char b[96];
  float y = sy + 40;
  auto row = [&](const char *k, const std::string &v, unsigned col = 0xe8e6e0) {
    hud->text(sx + 12, y, 15, k, 0x8a8f98);
    hud->text(sx + sw - 12, y, 15, v, col, 1, 2);
    y += 21;
  };
  std::snprintf(b, sizeof b, "%d", S.pieces); row("PIECES", b);
  std::snprintf(b, sizeof b, "%.2f x %.2f x %.2f m", S.len, S.wid, S.hgt); row("SIZE", b);
  std::snprintf(b, sizeof b, "%.0f kg", S.mass); row("WEIGHT", b);
  if (S.wheelbase > 0) { std::snprintf(b, sizeof b, "%.0f%% front", S.frontWeight * 100); row("BALANCE", b); }
  else row("BALANCE", "-");
  if (S.wheelbase > 0) { std::snprintf(b, sizeof b, "%.2f m", S.wheelbase); row("WHEELBASE", b); } else row("WHEELBASE", "-");
  if (S.trackF > 0) { std::snprintf(b, sizeof b, "%.2f / %.2f m", S.trackF, S.trackR); row("TRACK F / R", b); } else row("TRACK F / R", "-");
  std::snprintf(b, sizeof b, "%.2f m2", S.frontal); row("FRONTAL AREA", b);
  std::snprintf(b, sizeof b, "%.2f", S.cd); row("DRAG  Cd", b);
  std::snprintf(b, sizeof b, "%.0f kg", 0.5 * 1.225 * S.clA * 55.56 * 55.56 / 9.81);
  row("DOWNFORCE at 200", b, S.clA < 0 ? 0xff5a1f : 0xe8e6e0);
  std::snprintf(b, sizeof b, "%.0f km/h", S.vmax * 3.6); row("TOP SPEED", S.vmax > 0 ? b : "-");
  if (!S.note.empty()) hud->text(sx + 12, y + 4, std::min(15.0f, 15 * (sw - 24) / std::max(1.0f, hud->width(15, S.note))), S.note, 0xffcc00);
  else hud->text(sx + 12, y + 4, 15, "ready to be driven", 0x2fb34a);

  // ---- keys
  const char *keys = A.tool == BUILD
    ? "CLICK place    R T F turn    ARROWS length / width    PGUP PGDN height    H plate/cube/brick    MIDDLE-CLICK pick    DEL remove    RIGHT-DRAG look    SHIFT+DRAG slide    WHEEL zoom    CTRL+Z undo"
    : A.tool == BRUSH ? "CLICK paint a piece in the colour and finish in hand    MIDDLE-CLICK pick    B back to building"
                      : "CLICK remove a piece (and its twin while MIRROR is on)    B back to building";
  hud->rect(0, H - 30, W, 30, 0x0c0d10, 0.82f);
  hud->text(W / 2, H - 24, 14, keys, 0xa9adb3, 1, 1);
  if (A.flashT > 0) {
    const float w = hud->width(18, A.flash) + 32;
    hud->rect(W / 2 - w / 2, H - 78, w, 34, 0xd6001c, std::min(1.0f, (float)A.flashT));
    hud->text(W / 2, H - 70, 18, A.flash, 0xffffff, std::min(1.0f, (float)A.flashT), 1);
  }
  return over;
}

static void seedTray(Car &car) {
  car.pieces.clear();
  for (int i = 0; i < N_SHAPES; i++) {
    Piece p;
    p.shape = i;
    for (int k = 0; k < 3; k++) p.s[k] = info(i).s[k] * (info(i).sizable && i != WHEEL && i != SCREEN && i != WING && i != LAMP_ROUND && i != LAMP_SQUARE && i != ARCH ? 2 : 1);
    p.mat = info(i).mat >= 0 ? info(i).mat : PAINT;
    p.col = i == LAMP_ROUND || i == LAMP_SQUARE ? 0xfff1c9 : i == SCREEN ? 0x9fb6c4 : i == WHEEL ? 0xbfc3c8 : PALETTE[5 + i % 14];
    int d[3];
    p.dims(d);
    p.p[0] = ((i % 4) * 10 - 20) * STUD / 2 + 10;
    p.p[2] = ((i / 4) * 9 - 16) * STUD / 2;
    car.pieces.push_back(p);
  }
}

int main(int argc, char **argv) {
  std::string name = "untitled", shot, ref;
  bool tray = false;
  std::vector<std::pair<float, float>> pokes;      // --poke X,Y: put the piece in hand down at that pixel (a self-test)
  std::vector<std::string> script;                 // --do: shape ids and turns before each poke
  float cyaw = 0.75f, cpitch = 0.42f, cdist = 0;
  for (int i = 1; i < argc; i++) {
    const std::string a = argv[i];
    auto val = [&]() -> std::string { if (i + 1 >= argc) { std::fprintf(stderr, "works: %s needs a value\n", a.c_str()); std::exit(2); } return argv[++i]; };
    if (a == "--shot") shot = val();
    else if (a == "--ref") ref = val();
    else if (a == "--tray") tray = true;
    else if (a == "--poke") { const std::string v = val(); float x = 0, y = 0; if (std::sscanf(v.c_str(), "%f,%f", &x, &y) != 2) { std::fprintf(stderr, "works: --poke X,Y\n"); return 2; } pokes.push_back({x, y}); script.push_back(""); }
    else if (a == "--hand") { const std::string v = val(); if (shapeById(v) < 0) { std::fprintf(stderr, "works: no piece called %s\n", v.c_str()); return 2; } script.push_back(v); pokes.push_back({-1, -1}); }
    else if (a == "--yaw") cyaw = std::stof(val()) * PI / 180;
    else if (a == "--pitch") cpitch = std::stof(val()) * PI / 180;
    else if (a == "--dist") cdist = std::stof(val());
    else if (a.rfind("--", 0) == 0) { std::fprintf(stderr, "works: unknown option %s\n", a.c_str()); return 2; }
    else name = a;
  }
  for (char c : name) if (!(std::isalnum((unsigned char)c) || c == '-' || c == '_')) { std::fprintf(stderr, "works: a car's name is letters, digits, - and _ (got \"%s\")\n", name.c_str()); return 2; }
  const bool shotMode = !shot.empty();

  if (shotMode) SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "offscreen");
  if (!SDL_Init(SDL_INIT_VIDEO)) {
    SDL_ResetHint(SDL_HINT_VIDEO_DRIVER);
    if (!SDL_Init(SDL_INIT_VIDEO)) { std::fprintf(stderr, "works: SDL: %s\n", SDL_GetError()); return 1; }
  }
  std::string root;
  { const char *base = SDL_GetBasePath(); root = std::string(base ? base : "./") + "../../"; }   // native/build/ -> the repo
  const std::string dataDir = root + "data", garage = dataDir + "/garage";
  SDL_CreateDirectory(garage.c_str());
  const char *tmp = std::getenv("XDG_RUNTIME_DIR");
  const std::string scratch = tmp ? tmp : "/tmp";

  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
  if (!shotMode) { SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 1); SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 4); }
  SDL_WindowFlags flags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE;
  if (shotMode) flags |= SDL_WINDOW_HIDDEN;
  App A;
  SDL_Window *win = SDL_CreateWindow("XBR Works", A.W, A.H, flags);
  SDL_GLContext ctx = win ? SDL_GL_CreateContext(win) : nullptr;
  if (!ctx && !shotMode) {
    if (win) SDL_DestroyWindow(win);
    SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 0); SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 0);
    win = SDL_CreateWindow("XBR Works", A.W, A.H, flags);
    ctx = win ? SDL_GL_CreateContext(win) : nullptr;
  }
  if (!ctx) { std::fprintf(stderr, "works: no OpenGL 3.3 context: %s\n", SDL_GetError()); return 1; }
  SDL_GL_MakeCurrent(win, ctx);
  if (!shotMode) { SDL_GL_SetSwapInterval(1); int w, h; SDL_GetWindowSizeInPixels(win, &w, &h); A.W = w; A.H = h; glEnable(GL_MULTISAMPLE); }

  GLuint fbo = 0;
  if (shotMode) {
    GLuint colr, dep;
    glGenFramebuffers(1, &fbo); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
    glGenTextures(1, &colr); glBindTexture(GL_TEXTURE_2D, colr);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, A.W, A.H, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, colr, 0);
    glGenRenderbuffers(1, &dep); glBindRenderbuffer(GL_RENDERBUFFER, dep);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, A.W, A.H);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, dep);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) { std::fprintf(stderr, "works: no offscreen target\n"); return 1; }
  }

  const GLuint prog = program(VS, FS), hprog = program(HVS, HFS);
  const GLint uVP = glGetUniformLocation(prog, "uVP"), uEye = glGetUniformLocation(prog, "uEye"), uAlpha = glGetUniformLocation(prog, "uAlpha"),
              uTint = glGetUniformLocation(prog, "uTint"), uShift = glGetUniformLocation(prog, "uShift");
  const GLint uSize = glGetUniformLocation(hprog, "uSize"), uMode = glGetUniformLocation(hprog, "uMode");
  if (!loadFont(dataDir + "/fonts/rubik.woff2")) std::fprintf(stderr, "works: no font at %s/fonts/rubik.woff2 — the panels will have no words\n", dataDir.c_str());
  GLuint hvao, hvbo;
  glGenVertexArrays(1, &hvao); glGenBuffers(1, &hvbo);
  glBindVertexArray(hvao); glBindBuffer(GL_ARRAY_BUFFER, hvbo);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void *)(2 * sizeof(float)));
  glEnableVertexAttribArray(2); glVertexAttribPointer(2, 4, GL_FLOAT, GL_FALSE, 8 * sizeof(float), (void *)(4 * sizeof(float)));

  // ---- the car
  A.car.name = name;
  A.path = garage + "/" + name + ".json";
  for (int i = 0; i < N_SHAPES; i++) for (int k = 0; k < 3; k++) A.sizes[i][k] = info(i).s[k];
  if (tray) { seedTray(A.car); A.path.clear(); A.car.name = "the tray"; }
  else if (A.car.load(A.path)) std::printf("works: opened %s (%zu pieces)\n", A.path.c_str(), A.car.pieces.size());
  else {
    std::ifstream probe(A.path);
    if (probe) { std::fprintf(stderr, "works: %s is there but is not a car I can read. Not touching it.\n", A.path.c_str()); return 1; }
    std::printf("works: a new car, %s\n", A.path.c_str());
  }
  A.car.name = tray ? A.car.name : name;
  A.hand.col = PALETTE[5];
  A.adopt(BLOCK);
  A.buildPlate();
  A.yaw = cyaw; A.pitch = cpitch;
  if (cdist > 0) A.dist = cdist;
  if (!ref.empty() && !A.loadRef(ref, scratch)) std::fprintf(stderr, "works: could not read the picture %s\n", ref.c_str());

  for (size_t i = 0; i < pokes.size(); i++) {
    if (!script[i].empty()) { A.adopt(shapeById(script[i])); continue; }
    A.rebuild();
    V3 o, d;
    A.mx = pokes[i].first; A.my = pokes[i].second;
    A.ray(A.mx, A.my, o, d);
    A.hit = A.pick(o, d);
    A.place();
    std::printf("works: poke %.0f,%.0f -> %s at %d,%d,%d (hit piece %d, axis %d%+d)\n", A.mx, A.my, A.ghostOk ? info(A.hand.shape).id : "nothing",
                A.hand.p[0], A.hand.p[1], A.hand.p[2], A.hit.piece, A.hit.axis, A.hit.sign);
    A.commit();
  }
  if (!pokes.empty()) { A.mx = A.my = -100; }
  bool running = true, orbiting = false, panning = false;
  float downX = 0, downY = 0;
  Uint64 prev = SDL_GetTicksNS();
  while (running) {
    const Uint64 now = SDL_GetTicksNS();
    const double dt = std::min(0.1, (now - prev) / 1e9);
    prev = now;
    A.flashT = std::max(0.0, A.flashT - dt);
    if (A.dirty) A.rebuild();
    const SDL_Keymod mod = SDL_GetModState();
    const bool ctrl = mod & SDL_KMOD_CTRL, shift = mod & SDL_KMOD_SHIFT;

    SDL_Event e;
    while (SDL_PollEvent(&e)) {
      switch (e.type) {
        case SDL_EVENT_QUIT: running = false; break;
        case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED: { int w, h; SDL_GetWindowSizeInPixels(win, &w, &h); A.W = std::max(1, w); A.H = std::max(1, h); break; }
        case SDL_EVENT_DROP_FILE:
          if (e.drop.data) A.status(A.loadRef(e.drop.data, scratch) ? "PICTURE PINNED  ·  V hides it" : "COULD NOT READ THAT PICTURE");
          break;
        case SDL_EVENT_MOUSE_MOTION: {
          int ww, wh; SDL_GetWindowSize(win, &ww, &wh);
          const float sx = (float)A.W / std::max(1, ww), sy = (float)A.H / std::max(1, wh);
          A.mx = e.motion.x * sx; A.my = e.motion.y * sy;
          if (orbiting) { A.yaw += e.motion.xrel * 0.006f; A.pitch = std::clamp(A.pitch + e.motion.yrel * 0.006f, -0.2f, 1.52f); }
          if (panning) {
            V3 eye, f, r, u; A.basis(eye, f, r, u);
            const float k = A.dist * 0.0013f;
            A.target = A.target - r * (e.motion.xrel * k) + u * (e.motion.yrel * k);
          }
          break;
        }
        case SDL_EVENT_MOUSE_WHEEL: A.dist = std::clamp(A.dist * std::pow(0.88f, e.wheel.y), 1.0f, 40.0f); break;
        case SDL_EVENT_MOUSE_BUTTON_DOWN: {
          downX = A.mx; downY = A.my;
          const Ui over = ui(A, nullptr, A.mx, A.my);
          if (e.button.button == SDL_BUTTON_RIGHT || (e.button.button == SDL_BUTTON_LEFT && (mod & SDL_KMOD_ALT))) { orbiting = !shift; panning = shift; break; }
          if (e.button.button == SDL_BUTTON_MIDDLE) { if (over.kind == Ui::NONE && A.hit.piece >= 0) A.eyedrop(A.hit.piece); break; }
          if (e.button.button != SDL_BUTTON_LEFT) break;
          switch (over.kind) {
            case Ui::SHAPE: A.adopt(over.index); A.tool = BUILD; break;
            case Ui::COLOUR: A.hand.col = PALETTE[over.index]; break;
            case Ui::FINISH: A.hand.mat = over.index; break;
            case Ui::TOOL: A.tool = over.index; break;
            case Ui::MIRROR: A.mirror = !A.mirror; break;
            case Ui::HALFSTUD: A.half = !A.half; break;
            case Ui::KLASS: A.car.klass = (A.car.klass + 1) % N_KLASSES; A.changed(); break;
            case Ui::PANEL: break;
            case Ui::NONE:
              if (A.tool == BUILD) A.commit();
              else if (A.tool == BRUSH) A.paint(A.hit.piece);
              else A.erase(A.hit.piece);
              break;
          }
          break;
        }
        case SDL_EVENT_MOUSE_BUTTON_UP: orbiting = panning = false; (void)downX; (void)downY; break;
        case SDL_EVENT_KEY_DOWN: {
          const SDL_Scancode k = e.key.scancode;
          const int stud = shift ? HALF : STUD;
          if (ctrl && k == SDL_SCANCODE_Z) { if (!A.undo.empty()) { A.redo.push_back(A.car.pieces); A.car.pieces = A.undo.back(); A.undo.pop_back(); A.changed(); } break; }
          if (ctrl && k == SDL_SCANCODE_Y) { if (!A.redo.empty()) { A.undo.push_back(A.car.pieces); A.car.pieces = A.redo.back(); A.redo.pop_back(); A.changed(); } break; }
          if (ctrl && k == SDL_SCANCODE_S) { A.status(A.car.save(A.path) ? "SAVED  (it saves itself after every piece, too)" : "COULD NOT SAVE"); break; }
          if (ctrl) break;
          switch (k) {
            case SDL_SCANCODE_ESCAPE: running = false; break;
            case SDL_SCANCODE_B: A.tool = BUILD; break;
            case SDL_SCANCODE_P: A.tool = BRUSH; break;
            case SDL_SCANCODE_X: A.tool = ERASE; break;
            case SDL_SCANCODE_M: A.mirror = !A.mirror; A.status(A.mirror ? "MIRROR ON" : "MIRROR OFF"); break;
            case SDL_SCANCODE_J: A.half = !A.half; A.status(A.half ? "HALF STUDS" : "WHOLE STUDS"); break;
            case SDL_SCANCODE_V: A.refOn = !A.refOn; break;
            case SDL_SCANCODE_Q: A.adopt((A.hand.shape + N_SHAPES - 1) % N_SHAPES); A.tool = BUILD; break;
            case SDL_SCANCODE_E: A.adopt((A.hand.shape + 1) % N_SHAPES); A.tool = BUILD; break;
            case SDL_SCANCODE_R: turn(A.hand, 1, shift ? 3 : 1); break;
            case SDL_SCANCODE_T: turn(A.hand, 2, shift ? 3 : 1); break;
            case SDL_SCANCODE_F: turn(A.hand, 0, shift ? 3 : 1); break;
            case SDL_SCANCODE_UP: A.resize(0, stud); break;
            case SDL_SCANCODE_DOWN: A.resize(0, -stud); break;
            case SDL_SCANCODE_RIGHT: A.resize(2, A.hand.shape == WHEEL ? 2 : stud); break;
            case SDL_SCANCODE_LEFT: A.resize(2, A.hand.shape == WHEEL ? -2 : -stud); break;
            case SDL_SCANCODE_PAGEUP: A.resize(1, VSTEP); break;
            case SDL_SCANCODE_PAGEDOWN: A.resize(1, -VSTEP); break;
            case SDL_SCANCODE_H: {
              if (A.hand.shape == WHEEL) break;
              const int cur = A.hand.s[1], next = cur < PLATE ? PLATE : cur < CUBE ? CUBE : cur < BRICK ? BRICK : cur < 2 * BRICK ? 2 * BRICK : PLATE;
              A.resize(1, next - cur);
              break;
            }
            case SDL_SCANCODE_DELETE: case SDL_SCANCODE_BACKSPACE: A.erase(A.hit.piece); break;
            case SDL_SCANCODE_TAB: A.car.klass = (A.car.klass + (shift ? N_KLASSES - 1 : 1)) % N_KLASSES; A.changed(); break;
            case SDL_SCANCODE_HOME: A.target = {0, 0.5f, 0}; A.yaw = 0.75f; A.pitch = 0.42f; A.dist = 9; break;
            case SDL_SCANCODE_1: A.yaw = PI / 2; A.pitch = 0.02f; break;        // side
            case SDL_SCANCODE_2: A.yaw = 0; A.pitch = 0.02f; break;             // front
            case SDL_SCANCODE_3: A.yaw = PI / 2; A.pitch = 1.52f; break;        // top
            case SDL_SCANCODE_4: A.yaw = PI; A.pitch = 0.02f; break;            // rear
            default: break;
          }
          break;
        }
        default: break;
      }
    }
    if (A.dirty) A.rebuild();

    // ---- what the mouse is over, and where the piece in hand would go
    const Ui over = ui(A, nullptr, A.mx, A.my);
    V3 ro, rd;
    A.ray(A.mx, A.my, ro, rd);
    A.hit = over.kind == Ui::NONE && !orbiting && !panning ? A.pick(ro, rd) : Hit{};
    if (A.tool == BUILD) A.place(); else A.ghostOk = false;

    // ---- draw
    V3 eye, f, r, u;
    A.basis(eye, f, r, u);
    float P[16], Vw[16], VP[16];
    perspective(P, App::FOV, (float)A.W / A.H, 0.05f, 200);
    lookAt(Vw, eye, f, r, u);
    mul(VP, P, Vw);
    glViewport(0, 0, A.W, A.H);
    glClearColor(0.105f, 0.115f, 0.135f, 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glEnable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE); glDisable(GL_BLEND);
    glUseProgram(prog);
    glUniformMatrix4fv(uVP, 1, GL_FALSE, VP);
    glUniform3f(uEye, eye.x, eye.y, eye.z);
    glUniform1f(uAlpha, 1); glUniform4f(uTint, 0, 0, 0, 0); glUniform3f(uShift, 0, 0, 0);
    A.plate.draw(GL_LINES);
    A.guide.draw(GL_LINES);
    A.solid.draw();
    // the piece that PAINT or ERASE is about to touch, lit up
    if (A.tool != BUILD && A.hit.piece >= 0) {
      std::vector<float> hv = A.pm[(size_t)A.hit.piece];
      const int t = A.mirror ? A.twin(A.hit.piece) : -1;
      if (t >= 0) hv.insert(hv.end(), A.pm[(size_t)t].begin(), A.pm[(size_t)t].end());
      A.hover.set(hv);
      glEnable(GL_POLYGON_OFFSET_FILL); glPolygonOffset(-2, -2);
      if (A.tool == ERASE) glUniform4f(uTint, 1.0f, 0.1f, 0.05f, 0.65f);
      else glUniform4f(uTint, ((A.hand.col >> 16) & 255) / 255.0f, ((A.hand.col >> 8) & 255) / 255.0f, (A.hand.col & 255) / 255.0f, 0.7f);
      A.hover.draw();
      glDisable(GL_POLYGON_OFFSET_FILL);
      glUniform4f(uTint, 0, 0, 0, 0);
    }
    glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    A.glass.draw();
    glDepthMask(GL_TRUE);
    if (A.ghostOk) {
      std::vector<float> gv;
      mesh(A.hand, gv);
      if (A.mirror) { const Piece m = mirrored(A.hand); if (m.p[2] != A.hand.p[2]) mesh(m, gv); }
      A.ghost.set(gv);
      glUniform1f(uAlpha, 0.62f);
      A.ghost.draw();
      glUniform1f(uAlpha, 1);
    }
    glDisable(GL_DEPTH_TEST);

    // ---- panels
    Hud hud;
    ui(A, &hud, A.mx, A.my);
    glUseProgram(hprog);
    glUniform2f(uSize, (float)A.W, (float)A.H);
    glUniform1i(uMode, 0);
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, fontTex);
    glBindVertexArray(hvao); glBindBuffer(GL_ARRAY_BUFFER, hvbo);
    glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(hud.v.size() * sizeof(float)), hud.v.data(), GL_STREAM_DRAW);
    glDrawArrays(GL_TRIANGLES, 0, (GLsizei)(hud.v.size() / 8));
    if (A.refTex && A.refOn) {
      Hud pic;
      const float rw = std::min(420.0f, A.W * 0.28f), rh = rw * A.refH / std::max(1, A.refW);
      const float one[4] = {1, 1, 1, 1};
      pic.quad(A.W - 10 - rw, 10, rw, rh, 0, 0, 1, 1, one);
      glUniform1i(uMode, 1);
      glBindTexture(GL_TEXTURE_2D, A.refTex);
      glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(pic.v.size() * sizeof(float)), pic.v.data(), GL_STREAM_DRAW);
      glDrawArrays(GL_TRIANGLES, 0, 6);
    }
    glDisable(GL_BLEND);

    if (shotMode) {
      glFinish();
      std::vector<unsigned char> px((size_t)A.W * A.H * 3);
      glPixelStorei(GL_PACK_ALIGNMENT, 1);
      glReadPixels(0, 0, A.W, A.H, GL_RGB, GL_UNSIGNED_BYTE, px.data());
      FILE *o = std::fopen(shot.c_str(), "wb");
      if (!o) { std::fprintf(stderr, "works: cannot write %s\n", shot.c_str()); return 1; }
      std::fprintf(o, "P6\n%d %d\n255\n", A.W, A.H);
      for (int y = A.H - 1; y >= 0; y--) std::fwrite(&px[(size_t)y * A.W * 3], 1, (size_t)A.W * 3, o);
      std::fclose(o);
      const Stats &S = A.stats;
      std::printf("works: %d pieces  %.0f kg  %.2f x %.2f x %.2f m  frontal %.2f m2  Cd %.2f  CdA %.2f  ClA %.2f  wheelbase %.2f  %s\n",
                  S.pieces, S.mass, S.len, S.wid, S.hgt, S.frontal, S.cd, S.cdA, S.clA, S.wheelbase, S.note.empty() ? "ready" : S.note.c_str());
      break;
    }
    SDL_GL_SwapWindow(win);
  }
  SDL_GL_DestroyContext(ctx);
  SDL_DestroyWindow(win);
  SDL_Quit();
  return 0;
}
