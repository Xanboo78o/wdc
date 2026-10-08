// render.hpp — everything that draws. OpenGL 3.3 core, one lit shader with
// procedural surface grain, one flat shader for the HUD.
//
// The sim core never includes this file. The renderer READS a Car and a Track
// and owns nothing the physics depends on.
//
// World space here is GL's: +Y up. The sim's (x, y, z-up) maps to (x, z, -y),
// a pure rotation, so the world is not mirrored — which the browser game once
// was, and it read as "the steering is inverted".
#pragma once
#include <string>
#include <vector>

#include "json.hpp"
#include "physics.hpp"
#include "track.hpp"

namespace xbr {

struct Mat4 {
  float m[16];
  static Mat4 identity();
  static Mat4 perspective(float fovyRad, float aspect, float zn, float zf);
  static Mat4 lookAt(const float eye[3], const float at[3], const float up[3]);
  static Mat4 translate(float x, float y, float z);
  static Mat4 scale(float x, float y, float z);
  static Mat4 rotX(float a);
  static Mat4 rotY(float a);
  static Mat4 rotZ(float a);
  Mat4 operator*(const Mat4 &b) const;
};

// A mesh under construction. Positions are given in SIM coordinates (x, y,
// z-up) and converted on the way in.
struct MeshB {
  std::vector<float> v;                       // pos3 nrm3 col3 kind1
  void vert(double x, double y, double z, double nx, double ny, double nz, const float c[3], float kind);
  void tri(const double a[3], const double b[3], const double c[3], const float col[3], float kind);
  void quad(const double a[3], const double b[3], const double c[3], const double d[3], const float col[3], float kind);
  // flat on the ground, normal straight up
  void flat(const double a[3], const double b[3], const double c[3], const double d[3], const float col[3], float kind);
  void box(double x0, double x1, double y0, double y1, double z0, double z1, const float col[3], float kind);
  // a box whose cross-section changes from one end (x0) to the other (x1)
  void taper(double x0, double hw0, double z00, double z01, double x1, double hw1, double z10, double z11,
             const float col[3], float kind, double yc = 0);
  void beam(const double p0[3], const double p1[3], double thick, const float col[3], float kind);
  size_t count() const { return v.size() / 10; }
};

struct GLMesh {
  unsigned vao = 0, vbo = 0;
  int count = 0;
  void upload(const MeshB &b);
  void draw() const;
  void free();
};

enum Align { LEFT, CENTRE, RIGHT };

struct FrameIn {
  const Car *car = nullptr;
  const Spec *spec = nullptr;
  int camMode = 0;              // 0 onboard, 1 chase, 2 high
  bool showLine = false;
  double wheelAngle = 0;        // radians the wheels have rolled
  double dt = 1.0 / 60;
};

class Renderer {
 public:
  bool init();
  void shutdown();
  void resize(int w, int h) { W = w; H = h; }
  void buildWorld(const Track &track, const Json &surf, const Json &env, const Line &raceLine);
  void buildCar(const Spec &spec);
  void snapCamera() { camReady = false; }
  void drawWorld(const FrameIn &f);

  // ---- HUD: pixel coordinates, origin top-left
  void hudBegin();
  void rect(float x, float y, float w, float h, const float rgba[4]);
  void text(float x, float y, float px, const std::string &s, const float rgba[4], Align al = LEFT);
  float textWidth(float px, const std::string &s) const;
  void hudEnd();

  // Render into an offscreen target and write a PPM. For checking a build
  // without putting a window on anyone's screen.
  bool beginOffscreen(int w, int h);
  bool writePPM(const std::string &path);

  int W = 1280, H = 720;
  size_t worldTris = 0;

 private:
  unsigned prog = 0, hudProg = 0;
  int uVP = -1, uModel = -1, uEye = -1, uSun = -1, uAlpha = -1, uHudSize = -1;
  GLMesh ground, corridor, decals, lineMesh, scenery, sky, shadow;
  GLMesh carBody, carFrontWing, carRearWing, carHelmet, wheelF, wheelR;
  double wheelR_f = 0.36, wheelR_r = 0.36;
  unsigned hudVao = 0, hudVbo = 0;
  std::vector<float> hud;
  unsigned fbo = 0, fboCol = 0, fboDepth = 0;
  bool camReady = false;
  double camYaw = 0;
  void drawMesh(const GLMesh &m, const Mat4 &model, float alpha = 1);
};

}  // namespace xbr
