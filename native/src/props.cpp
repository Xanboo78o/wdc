// props.cpp — see props.hpp.
#include "props.hpp"

#include <epoxy/gl.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>

#include "json.hpp"

namespace xbr {

// ---- small things dress.cpp also has, kept private to each file -------------------
static GLuint compileP(GLenum type, const char *src) {
  const GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok = 0;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[2048]; glGetShaderInfoLog(s, sizeof log, nullptr, log); std::fprintf(stderr, "props: shader:\n%s\n", log); return 0; }
  return s;
}
static GLuint linkP(const char *vs, const char *fs) {
  const GLuint v = compileP(GL_VERTEX_SHADER, vs), f = compileP(GL_FRAGMENT_SHADER, fs);
  if (!v || !f) return 0;
  const GLuint p = glCreateProgram();
  glAttachShader(p, v); glAttachShader(p, f);
  glLinkProgram(p);
  GLint ok = 0;
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { char log[2048]; glGetProgramInfoLog(p, sizeof log, nullptr, log); std::fprintf(stderr, "props: link:\n%s\n", log); return 0; }
  glDeleteShader(v); glDeleteShader(f);
  return p;
}
// PAM (P7), RGB or RGB_ALPHA, 8 bit: what the Makefile turns base.jpg / base.png into.
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

// ---- a model -------------------------------------------------------------------
struct PropKit {
  std::string key;
  GLuint vbo = 0, tex = 0;
  int verts = 0, farVerts = 0;
  double length = 1, height = 1, depth = 0.3;
  bool bend = true, cutout = false;
};
// ---- one model laid along one edge: its pieces, in chunks that are drawn or not together
struct PropRun {
  PropKit *k = nullptr;
  float zoff = 0;
  GLuint vao = 0, inst = 0;
  bool gives = false, right = false;       // a barrier the cars can bend; which side of the road
  std::vector<float> data;                 // 13 floats a piece: P0 C P2, then how far back its start, middle and end are pushed, and its lean
  std::vector<int> ids;                    // 3 a piece: the track samples under its start, middle and end
  struct Chunk { int first, count; float cx, cy, cz, rad; };
  std::vector<Chunk> chunks;
};

static const int PIECE = 13;        // floats a piece in the instance buffer

// The piece is bent here. aPos.x runs 0..uLen along the curve iP0 -> iC -> iP2
// (a quadratic), y is up, z is across: positive away from the road.
static const char *PROP_VS = R"(#version 330 core
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aUv;
layout(location=3) in vec3 iP0; layout(location=4) in vec3 iC; layout(location=5) in vec3 iP2; layout(location=6) in vec4 iB;
uniform mat4 uVP; uniform float uLen, uZoff, uLean;
out vec3 vW, vN; out vec2 vU;
void main(){
  float u = aPos.x / uLen;
  vec3 a = mix(iP0, iC, u), b = mix(iC, iP2, u);
  vec3 d = normalize(b - a);
  vec3 o = normalize(cross(d, vec3(0.0, 1.0, 0.0)));
  // HIT: pushed back by iB.x at its start, .y in the middle, .z at its end (a
  // curve through the three), and a rail leans over as it goes: iB.w is how far
  // (1 = torn off its posts and lying down). A concrete unit only slides (uLean 0).
  float bc = 2.0 * iB.y - 0.5 * (iB.x + iB.z);
  float back = mix(mix(iB.x, bc, u), mix(bc, iB.z, u), u);
  float lean = uLean * iB.w * clamp(back / max(max(iB.x, max(iB.y, iB.z)), 0.001), 0.0, 1.0);
  float y = aPos.y * (1.0 - 0.62 * lean);
  vW = mix(a, b, u) + vec3(0.0, y, 0.0) + o * (aPos.z + uZoff + back + aPos.y * lean * 0.85);
  vN = d * aNrm.x + vec3(0.0, aNrm.y, 0.0) + o * aNrm.z;
  vU = aUv;
  gl_Position = uVP * vec4(vW, 1.0);
}
)";
// Lit the way the world is (render.cpp's FS) and shaded by the same shadow map.
static const char *PROP_FS = R"(#version 330 core
in vec3 vW, vN; in vec2 vU;
uniform sampler2D uTex; uniform int uCutout;
uniform vec3 uEye, uSun, uSunCol, uSkyAmb, uGndAmb, uFog; uniform float uFogK, uWet;
uniform sampler2DShadow uShadow; uniform mat4 uShVP; uniform float uShOn;
out vec4 o;
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
void main(){
  vec4 t = texture(uTex, vU);
  vec3 V = uEye - vW; float dist = length(V); V /= dist;
  // A wire mesh: close to, each wire is there or it is not. Further off the
  // wires are thinner than a pixel and a hard test loses them all, so there
  // the mesh covers as many pixels as it covers of the view: a grey veil,
  // which is what a catch fence is from a hundred metres.
  if (uCutout == 1) {
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (t.a < mix(0.4, 0.04 + 0.92 * dither, smoothstep(6.0, 30.0, dist))) discard;
  }
  vec3 n = normalize(vN); if (dot(n, V) < 0.0) n = -n;
  float ndl = max(dot(n, uSun), 0.0) * sunVis(vW, n);
  vec3 amb = mix(uGndAmb, uSkyAmb, n.y * 0.5 + 0.5);
  vec3 c = t.rgb * (1.0 - 0.18 * uWet);
  vec3 lit = c * (amb + uSunCol * ndl * 0.78);
  vec3 h = normalize(uSun + V);
  lit += uSunCol * pow(max(dot(n, h), 0.0), 28.0) * (0.10 + 0.25 * uWet) * ndl;
  float f = 1.0 - exp(-dist * uFogK);
  o = vec4(mix(lit, uFog, f), 1.0);
}
)";

Props::Props() {}
Props::~Props() {}

bool Props::init(const std::string &dd, const std::string &td) {
  dataDir = dd; texDir = td;
  prog = linkP(PROP_VS, PROP_FS);
  return prog != 0;
}

PropKit *Props::kit(const std::string &key) {
  for (auto &k : kits) if (k->key == key) return k->vbo ? k.get() : nullptr;
  kits.push_back(std::make_unique<PropKit>());
  PropKit &K = *kits.back();
  K.key = key;
  const std::string dir = dataDir + "/props/" + key + "/";
  const Json m = Json::loadOpt(dir + "prop.json");
  std::ifstream f(dir + "prop.bin", std::ios::binary);
  if (!m.has("verts") || !f) return nullptr;                       // not downloaded: the plain barrier stands in
  K.verts = (int)m["verts"].n(); K.farVerts = (int)m["farVerts"].n();
  K.length = m["length"].n(); K.height = m["height"].n(); K.depth = m["depth"].n();
  K.bend = m["bend"].truthy(); K.cutout = m["cutout"].truthy();
  std::vector<float> v((size_t)K.verts * 8);
  f.read((char *)v.data(), (std::streamsize)(v.size() * 4));
  if (!f || K.verts <= 0) { std::fprintf(stderr, "props: %s: prop.bin is short\n", key.c_str()); return nullptr; }
  int w, h;
  std::vector<unsigned char> px;
  const std::string tp = texDir + "/prop-" + key + ".pam";
  if (!readPAM(tp, w, h, px)) { std::fprintf(stderr, "props: %s: cannot read %s (run make)\n", key.c_str(), tp.c_str()); return nullptr; }
  glGenTextures(1, &K.tex);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, K.tex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
  glGenerateMipmap(GL_TEXTURE_2D);                                  // no mip chain = opaque black (dress.cpp paid for that)
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
  if (epoxy_has_gl_extension("GL_EXT_texture_filter_anisotropic") || epoxy_gl_version() >= 46)
    glTexParameterf(GL_TEXTURE_2D, 0x84FE /* TEXTURE_MAX_ANISOTROPY */, 8.0f);
  glGenBuffers(1, &K.vbo);
  glBindBuffer(GL_ARRAY_BUFFER, K.vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(v.size() * 4), v.data(), GL_STATIC_DRAW);
  return &K;
}

bool Props::canBarrier(const std::string &wall) const {
  if (!prog) return false;
  const std::string key = wall == "wall" ? "concrete" : "armco";
  return const_cast<Props *>(this)->kit(key) != nullptr;
}

// Pieces of k, end to end along e. zoff: how far behind the foot line its middle stands.
void Props::lay(PropKit &k, const Edge &e, double zoff, bool onlyFenced, bool gives) {
  const int n = (int)(e.p.size() / 3);
  if (n < 2) return;
  // arc length along the edge
  const int m = e.closed ? n + 1 : n;
  std::vector<double> S((size_t)m, 0);
  auto pt = [&](int i) { return &e.p[(size_t)(((i % n) + n) % n) * 3]; };
  for (int i = 1; i < m; i++) { const float *a = pt(i - 1), *b = pt(i); S[(size_t)i] = S[(size_t)i - 1] + std::sqrt((double)(b[0] - a[0]) * (b[0] - a[0]) + (double)(b[1] - a[1]) * (b[1] - a[1]) + (double)(b[2] - a[2]) * (b[2] - a[2])); }
  const double total = S.back();
  const int pieces = std::max(1, (int)std::floor(total / k.length + 0.5));
  const double L = total / pieces;                                  // stretched a hair so the last piece meets the first
  int seg = 0;
  auto at = [&](double s, double out[3]) -> int {
    s = std::min(std::max(s, 0.0), total);
    while (seg < m - 2 && S[(size_t)seg + 1] < s) seg++;
    while (seg > 0 && S[(size_t)seg] > s) seg--;
    const double d = S[(size_t)seg + 1] - S[(size_t)seg], f = d > 1e-9 ? (s - S[(size_t)seg]) / d : 0;
    const float *a = pt(seg), *b = pt(seg + 1);
    for (int c = 0; c < 3; c++) out[c] = a[c] + (b[c] - a[c]) * f;
    return ((seg % n) + n) % n;
  };
  auto run = std::make_unique<PropRun>();
  run->k = &k; run->zoff = (float)zoff; run->gives = gives; run->right = e.rightSide;
  std::vector<float> &inst = run->data;
  const bool ided = e.sample.size() == (size_t)n;
  const int PER = 12;                                               // pieces to a chunk
  PropRun::Chunk ch{0, 0, 0, 0, 0, 0};
  double lo[3] = {1e30, 1e30, 1e30}, hi[3] = {-1e30, -1e30, -1e30};
  auto close = [&]() {
    if (!ch.count) return;
    ch.cx = (float)((lo[0] + hi[0]) / 2); ch.cy = (float)((lo[1] + hi[1]) / 2); ch.cz = (float)((lo[2] + hi[2]) / 2);
    ch.rad = (float)(std::sqrt((hi[0] - lo[0]) * (hi[0] - lo[0]) + (hi[1] - lo[1]) * (hi[1] - lo[1]) + (hi[2] - lo[2]) * (hi[2] - lo[2])) / 2 + k.height + 1.0);
    run->chunks.push_back(ch);
    ch.first += ch.count; ch.count = 0;
    for (int c = 0; c < 3; c++) { lo[c] = 1e30; hi[c] = -1e30; }
  };
  for (int q = 0; q < pieces; q++) {
    double a[3], mid[3], b[3];
    const int ia = at(q * L, a);
    const int im = at((q + 0.5) * L, mid);
    const int ib = at((q + 1) * L, b);
    if (onlyFenced && !(e.fenced.size() == (size_t)n && e.fenced[(size_t)ia] && e.fenced[(size_t)ib])) { close(); continue; }
    double c[3];
    for (int t = 0; t < 3; t++) c[t] = k.bend ? 2 * mid[t] - (a[t] + b[t]) / 2 : (a[t] + b[t]) / 2;
    // The model's +z (away from the road) is cross(direction, up). On the right
    // of the road that is the way the cars go; on the left the piece runs back.
    const double *p0 = e.rightSide ? a : b, *p2 = e.rightSide ? b : a;
    for (int t = 0; t < 3; t++) inst.push_back((float)p0[t]);
    for (int t = 0; t < 3; t++) inst.push_back((float)c[t]);
    for (int t = 0; t < 3; t++) inst.push_back((float)p2[t]);
    for (int t = 0; t < 4; t++) inst.push_back(0.0f);
    const int sa = ided ? e.sample[(size_t)ia] : -1, sm = ided ? e.sample[(size_t)im] : -1, sb = ided ? e.sample[(size_t)ib] : -1;
    run->ids.push_back(e.rightSide ? sa : sb); run->ids.push_back(sm); run->ids.push_back(e.rightSide ? sb : sa);
    for (const double *p : {a, mid, b}) for (int t = 0; t < 3; t++) { lo[t] = std::min(lo[t], p[t]); hi[t] = std::max(hi[t], p[t]); }
    if (++ch.count == PER) close();
  }
  close();
  if (inst.empty()) return;
  glGenVertexArrays(1, &run->vao);
  glBindVertexArray(run->vao);
  glBindBuffer(GL_ARRAY_BUFFER, k.vbo);
  const GLsizei st = 8 * sizeof(float);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, st, (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, st, (void *)(3 * sizeof(float)));
  glEnableVertexAttribArray(2); glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, st, (void *)(6 * sizeof(float)));
  glGenBuffers(1, &run->inst);
  glBindBuffer(GL_ARRAY_BUFFER, run->inst);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(inst.size() * 4), inst.data(), GL_DYNAMIC_DRAW);
  for (int t = 0; t < 4; t++) {
    glEnableVertexAttribArray((GLuint)(3 + t));
    glVertexAttribPointer((GLuint)(3 + t), t == 3 ? 4 : 3, GL_FLOAT, GL_FALSE, PIECE * sizeof(float), (void *)(size_t)(t * 3 * sizeof(float)));
    glVertexAttribDivisor((GLuint)(3 + t), 1);
  }
  glBindVertexArray(0);
  runs.push_back(std::move(run));
}

void Props::buildWorld(const std::string &wall, const std::vector<Edge> &edges) {
  for (auto &r : runs) { glDeleteVertexArrays(1, &r->vao); glDeleteBuffers(1, &r->inst); }
  runs.clear();
  barrier = false;
  if (!prog) return;
  PropKit *b = kit(wall == "wall" ? "concrete" : "armco");
  PropKit *f = kit("fence");
  if (!b) return;
  for (const Edge &e : edges) {
    lay(*b, e, b->depth / 2, false, true);                          // its road face on the line the cars hit
    if (f) lay(*f, e, b->depth + 1.0 + f->depth / 2, true, false);  // a metre clear: where a bent rail ends up
  }
  barrier = !runs.empty();
  wearSeen = 0;
}

void Props::deform(const std::vector<float> bend[2], const std::vector<char> broke[2], unsigned version) {
  if (version == wearSeen) return;
  wearSeen = version;
  for (auto &rp : runs) {
    PropRun &r = *rp;
    if (!r.gives) continue;
    const auto &B = bend[r.right ? 1 : 0];
    const auto &K = broke[r.right ? 1 : 0];
    const size_t pieces = r.ids.size() / 3;
    bool changed = false;
    for (size_t q = 0; q < pieces; q++) {
      float v[4] = {0, 0, 0, 0};
      bool torn = false;
      for (int t = 0; t < 3; t++) {
        const int id = r.ids[q * 3 + (size_t)t];
        if (id < 0 || (size_t)id >= B.size()) continue;
        v[t] = B[(size_t)id];
        torn = torn || K[(size_t)id] != 0;
      }
      if (!r.k->bend) v[1] = (v[0] + v[2]) / 2;                     // a concrete unit does not bend: it turns
      const float most = std::max(v[0], std::max(v[1], v[2]));
      v[3] = torn ? 1.0f : std::min(0.55f, most / 0.90f * 0.55f);
      float *d = &r.data[q * PIECE + 9];
      if (std::memcmp(d, v, sizeof v) != 0) { std::memcpy(d, v, sizeof v); changed = true; }
    }
    if (changed) {
      glBindBuffer(GL_ARRAY_BUFFER, r.inst);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(r.data.size() * 4), r.data.data());
    }
  }
}

void Props::frame(const Mat4 &vp, const float e[3], const Look &l, const Mat4 &sv, bool so) {
  VP = vp; look = l; shVP = sv; shOn = so;
  for (int k = 0; k < 3; k++) eye[k] = e[k];
}

void Props::draw() {
  tris = 0;
  if (runs.empty() || !prog) return;
  GLint was = 0;
  glGetIntegerv(GL_CURRENT_PROGRAM, &was);
  const GLboolean cull = glIsEnabled(GL_CULL_FACE);
  glDisable(GL_CULL_FACE);                                          // a fence is seen from both sides, and a post from all round
  glUseProgram(prog);
  const Look &L = look;
  const float sl = std::sqrt(L.sun[0] * L.sun[0] + L.sun[1] * L.sun[1] + L.sun[2] * L.sun[2]);
  glUniformMatrix4fv(glGetUniformLocation(prog, "uVP"), 1, GL_FALSE, VP.m);
  glUniformMatrix4fv(glGetUniformLocation(prog, "uShVP"), 1, GL_FALSE, shVP.m);
  glUniform1f(glGetUniformLocation(prog, "uShOn"), shOn ? 1.0f : 0.0f);
  glUniform1i(glGetUniformLocation(prog, "uShadow"), 3);
  glUniform1i(glGetUniformLocation(prog, "uTex"), 0);
  glUniform3f(glGetUniformLocation(prog, "uEye"), eye[0], eye[1], eye[2]);
  glUniform3f(glGetUniformLocation(prog, "uSun"), L.sun[0] / sl, L.sun[1] / sl, L.sun[2] / sl);
  glUniform3fv(glGetUniformLocation(prog, "uSunCol"), 1, L.sunCol);
  glUniform3fv(glGetUniformLocation(prog, "uSkyAmb"), 1, L.skyAmb);
  glUniform3fv(glGetUniformLocation(prog, "uGndAmb"), 1, L.gndAmb);
  glUniform3fv(glGetUniformLocation(prog, "uFog"), 1, L.fog);
  glUniform1f(glGetUniformLocation(prog, "uFogK"), L.fogK);
  glUniform1f(glGetUniformLocation(prog, "uWet"), L.wet);
  const GLint uLen = glGetUniformLocation(prog, "uLen"), uZoff = glGetUniformLocation(prog, "uZoff"), uCut = glGetUniformLocation(prog, "uCutout");
  glActiveTexture(GL_TEXTURE0);
  for (auto &rp : runs) {
    const PropRun &r = *rp;
    const PropKit &k = *r.k;
    // how far each version is worth drawing: the whole model close to, its big faces beyond, nothing past the haze
    const float NEAR = k.cutout ? 40.0f : 60.0f, FAR = k.cutout ? 450.0f : 1800.0f;
    glBindTexture(GL_TEXTURE_2D, k.tex);
    glUniform1f(uLen, (float)k.length);
    glUniform1f(uZoff, r.zoff);
    glUniform1i(uCut, k.cutout ? 1 : 0);
    glUniform1f(glGetUniformLocation(prog, "uLean"), k.bend && r.gives ? 1.0f : 0.0f);
    glBindVertexArray(r.vao);
    glBindBuffer(GL_ARRAY_BUFFER, r.inst);
    for (const auto &c : r.chunks) {
      const float dx = c.cx - eye[0], dy = c.cy - eye[1], dz = c.cz - eye[2];
      const float d = std::sqrt(dx * dx + dy * dy + dz * dz) - c.rad;
      if (d > FAR) continue;
      // behind the camera, or well off to one side of what it sees
      const float cw = VP.m[3] * c.cx + VP.m[7] * c.cy + VP.m[11] * c.cz + VP.m[15];
      const float cxp = VP.m[0] * c.cx + VP.m[4] * c.cy + VP.m[8] * c.cz + VP.m[12];
      if (cw < -c.rad || std::fabs(cxp) > std::fabs(cw) + c.rad * 2.2f) continue;
      const int nv = d < NEAR ? k.verts : k.farVerts;
      // (GL 3.3 has no base instance: point the three per-piece attributes at this chunk's first piece)
      for (int t = 0; t < 4; t++)
        glVertexAttribPointer((GLuint)(3 + t), t == 3 ? 4 : 3, GL_FLOAT, GL_FALSE, PIECE * sizeof(float), (void *)(size_t)((c.first * PIECE + t * 3) * sizeof(float)));
      glDrawArraysInstanced(GL_TRIANGLES, 0, nv, c.count);
      tris += (size_t)(nv / 3) * (size_t)c.count;
    }
  }
  glBindVertexArray(0);
  if (cull) glEnable(GL_CULL_FACE);
  glUseProgram((GLuint)was);
}

}  // namespace xbr
