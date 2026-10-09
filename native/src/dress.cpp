// dress.cpp — see dress.hpp.
#include "dress.hpp"

#include <epoxy/gl.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>

namespace xbr {

// ---- shared -----------------------------------------------------------------------
static GLuint compileD(GLenum type, const char *src) {
  const GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[2048]; glGetShaderInfoLog(s, sizeof log, nullptr, log); std::fprintf(stderr, "dress: shader:\n%s\n", log); return 0; }
  return s;
}
static GLuint linkD(const char *vs, const char *fs) {
  const GLuint v = compileD(GL_VERTEX_SHADER, vs), f = compileD(GL_FRAGMENT_SHADER, fs);
  if (!v || !f) return 0;
  const GLuint p = glCreateProgram();
  glAttachShader(p, v); glAttachShader(p, f);
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { char log[2048]; glGetProgramInfoLog(p, sizeof log, nullptr, log); std::fprintf(stderr, "dress: link:\n%s\n", log); return 0; }
  glDeleteShader(v); glDeleteShader(f);
  return p;
}

// PAM (P7), RGB or RGB_ALPHA, 8 bit — what tools/bakecar.mjs and the Makefile
// write, so the game needs no JPEG or PNG decoder of its own.
static bool readPAM(const std::string &path, int &w, int &h, std::vector<unsigned char> &rgba) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  std::string tok;
  int depth = 0, maxv = 0;
  w = h = 0;
  f >> tok;
  if (tok != "P7") return false;
  while (f >> tok) {
    if (tok == "ENDHDR") break;
    if (tok == "WIDTH") f >> w;
    else if (tok == "HEIGHT") f >> h;
    else if (tok == "DEPTH") f >> depth;
    else if (tok == "MAXVAL") f >> maxv;
    else if (tok == "TUPLTYPE") f >> tok;
  }
  f.get();
  if (w <= 0 || h <= 0 || maxv != 255 || (depth != 3 && depth != 4)) return false;
  std::vector<unsigned char> raw((size_t)w * h * depth);
  f.read((char *)raw.data(), (std::streamsize)raw.size());
  if (!f) return false;
  if (depth == 4) { rgba.swap(raw); return true; }
  rgba.resize((size_t)w * h * 4);
  for (size_t i = 0, n = (size_t)w * h; i < n; i++) { rgba[i * 4] = raw[i * 3]; rgba[i * 4 + 1] = raw[i * 3 + 1]; rgba[i * 4 + 2] = raw[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return true;
}
static GLuint texture(const std::string &path, bool repeat = true) {
  int w, h;
  std::vector<unsigned char> px;
  if (!readPAM(path, w, h, px)) return 0;
  GLuint t = 0;
  glGenTextures(1, &t);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, t);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
  glGenerateMipmap(GL_TEXTURE_2D);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, repeat ? GL_REPEAT : GL_CLAMP_TO_EDGE);
  if (epoxy_has_gl_extension("GL_EXT_texture_filter_anisotropic") || epoxy_gl_version() >= 46)
    glTexParameterf(GL_TEXTURE_2D, 0x84FE /* TEXTURE_MAX_ANISOTROPY */, 6.0f);
  return t;
}

// ---- the downloaded cars ---------------------------------------------------------------
// Roles, as tools/bakecar.mjs names them.
enum Role { R_TRIM, R_PAINT, R_GLASS, R_TYRE, R_RIM, R_LAMP, R_TAIL, R_CHROME };
static int roleOf(const std::string &s) {
  if (s == "paint") return R_PAINT;
  if (s == "glass") return R_GLASS;
  if (s == "tyre") return R_TYRE;
  if (s == "rim") return R_RIM;
  if (s == "lamp") return R_LAMP;
  if (s == "tail") return R_TAIL;
  if (s == "chrome") return R_CHROME;
  return R_TRIM;
}
struct PackMat { int role = R_TRIM; float col[3] = {1, 1, 1}; float alpha = 1; GLuint map = 0; bool cutout = false; bool see = false; };
// part: 0 body, 1..4 a wheel that spins (fl fr rl rr), 5..8 the same wheel's hub (steers, does not spin)
struct PackGroup { int part = 0, mat = 0; GLuint vao = 0; int count = 0; };
struct PackCar {
  std::string key;
  std::vector<PackMat> mats;
  std::vector<PackGroup> groups;
  GLuint vbo = 0, ebo = 0;
  double wc[4][3] = {}, wr[4] = {0.33, 0.33, 0.33, 0.33};
  double wheelbase = 2.6;
  float eye[3] = {-0.1f, 1.0f, -0.36f};
  size_t tris = 0;
};
PackInfo packInfo(const PackCar &pc) {
  PackInfo I;
  for (int k = 0; k < 3; k++) I.eye[k] = pc.eye[k];
  I.wheelbase = pc.wheelbase; I.wheelR = pc.wr[0];
  return I;
}

// Lit the way the world is (render.cpp's FS): ambient from sky and ground, the
// sun at 0.78, the same fog. Colours are display values, as they are there.
static const char *CAR_VS = R"(#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
uniform mat4 uVP, uModel;
out vec3 vW, vN; out vec2 vU;
void main(){ vec4 w = uModel * vec4(aPos, 1.0); vW = w.xyz; vN = mat3(uModel) * aNrm; vU = aUv; gl_Position = uVP * w; }
)";
static const char *CAR_FS = R"(#version 330 core
in vec3 vW, vN; in vec2 vU;
uniform sampler2D uTex; uniform int uHasMap, uRole, uCutout;
uniform vec3 uColor, uPaint; uniform float uOpacity;
uniform vec3 uEye, uSun, uSunCol, uSkyAmb, uGndAmb, uFog, uSkyTop; uniform float uFogK;
out vec4 o;
vec3 skyAt(vec3 d){ return mix(uFog, uSkyTop, pow(clamp(d.y, 0.0, 1.0), 0.55)) * (d.y < 0.0 ? 0.45 : 1.0); }
void main(){
  vec3 V = uEye - vW; float dist = length(V); V /= dist;
  vec3 n = normalize(vN); if (dot(n, V) < 0.0) n = -n;
  vec4 t = uHasMap == 1 ? texture(uTex, vU) : vec4(1.0);
  if (uCutout == 1 && t.a < 0.5) discard;
  vec3 c = uHasMap == 1 ? t.rgb : uColor;
  float a = uOpacity;
  float gloss = 0.0, shine = 24.0, mirror = 0.0;
  // 0 trim  1 paint  2 glass  3 tyre  4 rim  5 lamp  6 tail  7 chrome
  if (uRole == 1) { if (uPaint.x >= 0.0) c = uPaint; gloss = 0.55; shine = 64.0; mirror = 0.10; }
  else if (uRole == 2) { c = vec3(0.03, 0.04, 0.05); gloss = 0.9; shine = 120.0; mirror = 0.35; a = 0.62; }
  else if (uRole == 3) { if (uHasMap == 0) c = vec3(0.045); gloss = 0.04; shine = 8.0; }
  else if (uRole == 4) { if (uHasMap == 0 && dot(c, vec3(0.333)) < 0.03) c = vec3(0.17, 0.17, 0.19); gloss = 0.45; shine = 40.0; mirror = 0.22; }
  else if (uRole == 7) { c = vec3(0.62, 0.63, 0.66); gloss = 0.8; shine = 90.0; mirror = 0.6; }
  else { gloss = 0.10; shine = 18.0; }
  float ndl = max(dot(n, uSun), 0.0);
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y * 0.5 + 0.5);
  vec3 lit = c * (amb + uSunCol * ndl * 0.78);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 h = normalize(uSun + V);
  lit = mix(lit, skyAt(reflect(-V, n)), clamp(mirror + fres * (mirror > 0.0 ? 0.5 : 0.0), 0.0, 0.9));
  lit += uSunCol * pow(max(dot(n, h), 0.0), shine) * gloss;
  if (uRole == 6) lit += (uHasMap == 1 ? t.rgb : vec3(0.75, 0.05, 0.04)) * 0.55;
  if (uRole == 5) lit += vec3(0.80, 0.86, 0.92) * 0.55;
  if (uRole == 2) a = clamp(a + fres * 0.35, 0.0, 1.0);
  float f = 1.0 - exp(-dist * uFogK);
  o = vec4(mix(lit, uFog, f), a);
}
)";

const PackCar *Dress::pack(const std::string &key) {
  auto it = packs.find(key);
  if (it != packs.end()) return it->second.get();
  auto &slot = packs[key];                      // remembered even when it fails: do not hit the disk every frame
  const std::string dir = dataDir + "/cars/" + key + "/";
  const Json j = Json::loadOpt(dir + "car.json");
  if (!j.isObj()) { std::fprintf(stderr, "dress: no car pack at %scar.json (node tools/bakecar.mjs %s <folder>)\n", dir.c_str(), key.c_str()); return nullptr; }
  std::ifstream bf(dir + "car.bin", std::ios::binary);
  if (!bf) { std::fprintf(stderr, "dress: %scar.bin is missing\n", dir.c_str()); return nullptr; }
  const size_t nv = (size_t)j["verts"].n(), ni = (size_t)j["tris"].n() * 3;
  std::vector<float> verts(nv * 8);
  std::vector<unsigned> idx(ni);
  bf.read((char *)verts.data(), (std::streamsize)(verts.size() * 4));
  bf.read((char *)idx.data(), (std::streamsize)(idx.size() * 4));
  if (!bf) { std::fprintf(stderr, "dress: %scar.bin is shorter than car.json says\n", dir.c_str()); return nullptr; }

  auto pc = std::make_unique<PackCar>();
  pc->key = key;
  pc->tris = ni / 3;
  pc->wheelbase = j["wheelbase"].n(2.6);
  for (int k = 0; k < 3; k++) pc->eye[k] = (float)j["eye"][(size_t)k].n(pc->eye[k]);
  static const char *WN[4] = {"fl", "fr", "rl", "rr"};
  for (int w = 0; w < 4; w++) {
    const Json &jw = j["wheels"][WN[w]];
    for (int k = 0; k < 3; k++) pc->wc[w][k] = jw["c"][(size_t)k].n();
    pc->wr[w] = jw["r"].n(0.33);
  }
  for (const Json &m : j["materials"].arr) {
    PackMat pm;
    pm.role = roleOf(m["role"].s());
    // the file's colours are linear light; everything here is display values
    for (int k = 0; k < 3; k++) pm.col[k] = (float)std::pow(std::max(0.0, m["color"][(size_t)k].n(1)), 1 / 2.2);
    pm.cutout = m["cutout"].truthy();
    if (m.has("alpha")) { pm.alpha = (float)std::max(0.35, m["alpha"].n(1)); pm.see = true; }
    if (pm.role == R_GLASS) pm.see = true;
    if (m.has("pam")) {
      pm.map = texture(dir + m["pam"].s());
      if (!pm.map) std::fprintf(stderr, "dress: %s: cannot read %s\n", key.c_str(), m["pam"].s().c_str());
    }
    pc->mats.push_back(pm);
  }
  glGenBuffers(1, &pc->vbo);
  glBindBuffer(GL_ARRAY_BUFFER, pc->vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(verts.size() * 4), verts.data(), GL_STATIC_DRAW);
  for (const Json &g : j["groups"].arr) {
    PackGroup G;
    const std::string part = g["part"].s();
    G.part = 0;
    for (int w = 0; w < 4; w++) if (part.rfind(WN[w], 0) == 0) G.part = (part.size() > 2 ? 5 : 1) + w;
    G.mat = (int)g["mat"].n();
    if (G.mat < 0 || G.mat >= (int)pc->mats.size()) continue;
    const size_t v0 = (size_t)g["v0"].n(), i0 = (size_t)g["i0"].n(), in = (size_t)g["in"].n();
    if (i0 + in > idx.size()) continue;
    G.count = (int)in;
    GLuint ebo = 0;
    glGenVertexArrays(1, &G.vao);
    glBindVertexArray(G.vao);
    glBindBuffer(GL_ARRAY_BUFFER, pc->vbo);
    // the group's indices count from its own first vertex: point the attributes there
    const GLsizei st = 8 * sizeof(float);
    const size_t base = v0 * 8 * sizeof(float);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, st, (void *)base);
    glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, st, (void *)(base + 3 * sizeof(float)));
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, st, (void *)(base + 6 * sizeof(float)));
    glGenBuffers(1, &ebo);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(in * 4), &idx[i0], GL_STATIC_DRAW);
    pc->groups.push_back(G);
  }
  glBindVertexArray(0);
  std::fprintf(stderr, "dress: car pack %s — %zu triangles, %zu groups, %zu materials\n", key.c_str(), pc->tris, pc->groups.size(), pc->mats.size());
  slot = std::move(pc);
  return slot.get();
}

void Dress::lights(unsigned prog) {
  const Look &L = look;
  const float sl = std::sqrt(L.sun[0] * L.sun[0] + L.sun[1] * L.sun[1] + L.sun[2] * L.sun[2]);
  glUniformMatrix4fv(glGetUniformLocation(prog, "uVP"), 1, GL_FALSE, VP.m);
  glUniform3f(glGetUniformLocation(prog, "uEye"), eye[0], eye[1], eye[2]);
  glUniform3f(glGetUniformLocation(prog, "uSun"), L.sun[0] / sl, L.sun[1] / sl, L.sun[2] / sl);
  glUniform3fv(glGetUniformLocation(prog, "uSunCol"), 1, L.sunCol);
  glUniform3fv(glGetUniformLocation(prog, "uSkyAmb"), 1, L.skyAmb);
  glUniform3fv(glGetUniformLocation(prog, "uGndAmb"), 1, L.gndAmb);
  glUniform3fv(glGetUniformLocation(prog, "uFog"), 1, L.fog);
  glUniform3fv(glGetUniformLocation(prog, "uSkyTop"), 1, L.skyTop);
  glUniform1f(glGetUniformLocation(prog, "uFogK"), L.fogK);
}

void Dress::drawPack(const PackCar &pc, const Mat4 &carM, double steer, double rolled, const float *paint, const bool *lost,
                     const double *sag, bool glassPass) {
  GLint was = 0;
  glGetIntegerv(GL_CURRENT_PROGRAM, &was);
  glUseProgram(carProg);
  lights(carProg);
  const GLint uModel = glGetUniformLocation(carProg, "uModel"), uHasMap = glGetUniformLocation(carProg, "uHasMap"),
              uRole = glGetUniformLocation(carProg, "uRole"), uCutout = glGetUniformLocation(carProg, "uCutout"),
              uColor = glGetUniformLocation(carProg, "uColor"), uPaint = glGetUniformLocation(carProg, "uPaint"),
              uOpacity = glGetUniformLocation(carProg, "uOpacity");
  glUniform1i(glGetUniformLocation(carProg, "uTex"), 0);
  if (paint) glUniform3f(uPaint, paint[0], paint[1], paint[2]); else glUniform3f(uPaint, -1, 0, 0);
  Mat4 hub[4], spin[4];
  for (int w = 0; w < 4; w++) {
    hub[w] = carM * Mat4::translate((float)pc.wc[w][0], (float)(pc.wc[w][1] + (sag ? sag[w] : 0)), (float)pc.wc[w][2]);
    if (w < 2) hub[w] = hub[w] * Mat4::rotY((float)steer);
    spin[w] = hub[w] * Mat4::rotZ((float)(-rolled / pc.wr[w]));
  }
  if (glassPass) { glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDepthMask(GL_FALSE); }
  glActiveTexture(GL_TEXTURE0);
  for (const PackGroup &G : pc.groups) {
    const PackMat &M = pc.mats[(size_t)G.mat];
    if (M.see != glassPass) continue;
    const int w = G.part == 0 ? -1 : (G.part - 1) % 4;
    if (w >= 0 && lost && lost[w]) continue;
    glUniformMatrix4fv(uModel, 1, GL_FALSE, (G.part == 0 ? carM : G.part <= 4 ? spin[w] : hub[w]).m);
    glUniform1i(uHasMap, M.map ? 1 : 0);
    glUniform1i(uRole, M.role);
    glUniform1i(uCutout, M.cutout ? 1 : 0);
    glUniform3fv(uColor, 1, M.col);
    glUniform1f(uOpacity, M.alpha);
    if (M.map) glBindTexture(GL_TEXTURE_2D, M.map);
    glBindVertexArray(G.vao);
    glDrawElements(GL_TRIANGLES, G.count, GL_UNSIGNED_INT, nullptr);
  }
  if (glassPass) { glDepthMask(GL_TRUE); glDisable(GL_BLEND); }
  glBindVertexArray(0);
  glUseProgram((GLuint)was);
}

// ---- the woods and the boards -----------------------------------------------------------
struct Woods {};

Dress::Dress() = default;
Dress::~Dress() = default;

bool Dress::init(const std::string &data, const std::string &tex) {
  dataDir = data; texDir = tex;
  carProg = linkD(CAR_VS, CAR_FS);
  return carProg != 0;
}
void Dress::frame(const Mat4 &vp, const float e[3], const Look &l, double t) {
  VP = vp; look = l; time = t;
  for (int k = 0; k < 3; k++) eye[k] = e[k];
}
void Dress::buildWorld(const Track &, const World &, const Json &) {}
void Dress::drawWorld() {}

}  // namespace xbr
