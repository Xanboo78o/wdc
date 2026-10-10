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
#include <algorithm>
#include <string>
#include <unordered_map>
#include <vector>

#include "json.hpp"
#include "physics.hpp"
#include "track.hpp"
#include "world.hpp"

namespace xbr {

class Dress;
struct PackCar;

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

// The light and the air: time of day and weather, as the renderer needs them.
struct Look {
  float sun[3] = {0.42f, 0.80f, 0.36f};          // toward the sun (GL space; normalised on use)
  float sunCol[3] = {1.00f, 0.95f, 0.86f};
  float skyAmb[3] = {0.52f, 0.58f, 0.68f}, gndAmb[3] = {0.34f, 0.33f, 0.30f};
  float fog[3] = {0.78f, 0.84f, 0.90f}, skyTop[3] = {0.24f, 0.46f, 0.82f};
  float fogK = 0.00055f;
  float wet = 0;                                  // 0 dry .. 1 soaked: the road darkens and shines
  float rain = 0;                                 // 0..1: streaks across the view
  float cloud = 0;                                // 0 fair-weather .. 1 overcast: what the sky is covered with
  float night = 0;                                // 0 day .. 1 night: lamps on, stars out
};
// phase: "dawn" | "day" | "dusk" | "night" (anything else is day); cloud 0 clear .. 1 overcast
Look makeLook(const std::string &phase, double cloud, double wet, double rain);
// A HAUNTED NIGHT, laid over any look (amount 0..1): fog you can see forty metres
// into, the colour of pond water; a hard pale moon; almost no light of its own.
void haunt(Look &L, float amount = 1);

struct FrameIn {
  const Car *car = nullptr;
  const Spec *spec = nullptr;
  int camMode = 0;              // 0 onboard, 1 chase, 2 high
  bool showLine = false;
  double wheelAngle = 0;        // metres the wheels have rolled
  double groundH = 0;           // height of the road under the car
  double gPitch = 0, gRoll = 0; // the tilt of the ground under its wheels
  double dt = 1.0 / 60;
  double time = 0;              // seconds, for anything that animates
  float paint[3] = {-1, 0, 0};  // the player's car; negative = the house red
  Look look;
};

class Renderer {
 public:
  bool init(const std::string &dataDir, const std::string &texDir);
  void shutdown();
  void resize(int w, int h) { W = w; H = h; }
  void buildWorld(const Track &track, const World &world, const Json &surf, const Json &env, const Line &raceLine);
  void buildCar(const Spec &spec);
  // A downloaded car model (data/cars/<key>, tools/bakecar.mjs) in place of the
  // built-in body for every car drawn after this; "" goes back to the built-in.
  // Returns false, and changes nothing, if there is no such pack.
  bool setCarPack(const std::string &key);
  const std::string &carPack() const { return packKey; }
  void snapCamera() { camReady = false; }
  void drawWorld(const FrameIn &f);
  // the mirror (render.cpp): mirrorBegin, drawWorld + the rivals, mirrorEnd; then mirrorShow after endScene
  bool mirrorOn = true;                       // the player's switch (M)
  bool mirrorWanted(int camMode) const;
  void mirrorBegin();
  void mirrorEnd();
  void mirrorShow();
  // the menus' photographs (render.cpp): how many there are, and one laid behind the menu in a band of the screen (0 = top, 1 = bottom)
  int photoCount();
  void photoShow(int index, double t, float top, float bottom);
  // P: one tap is one wipe, two quick taps the next speed. Returns what to tell the driver, or null.
  const char *wiperTap(double now);
  void mirrorClear() { mirHas = false; }
  // After the world and every car: develop the picture onto the screen. The HUD goes on top afterwards.
  void endScene(double time);
  // THE SUSPENSION YOU CAN SEE. The sim keeps the wheels on the road; this is
  // the body riding on its springs above them: it squats under downforce,
  // goes down and comes back when the car lands, shakes over kerbs and grass,
  // and lets the wheels hang when the car is in the air. One state a car.
  struct Susp { float s = 0, v = 0, droop = 0, vzAir = 0, travel = 0.04f; bool air = false; double at = -1; unsigned rng = 1; };
  std::unordered_map<const Car *, Susp> susp;
  double frameT = 0;
  float frameDt = 1.0f / 60;
  const Susp &suspOf(const Car &car, const Spec &S);

  // This frame's camera and light, for anything that draws itself into the scene
  // between drawWorld() and endScene() (effects: smoke, fire, sparks, loose parts).
  // The target is float when `post` is on: a colour above 1.0 blooms.
  Mat4 curVP;
  float curEye[3] = {0, 0, 0};
  Look curLook;
  // > 0: the NEXT drawCar is a ghost of this strength (0..1) — the built-in body,
  // see-through, lit from inside, brightest at its edges. Read and cleared by drawCar.
  float ghost = 0;
  float scalePin = 0;           // > 0: draw the scene at this share of the window (--scale) instead of letting the governor choose
  bool hudFlat = false;         // the pro menus: square corners, hairlines, no tilt, no handwriting (homestyle.hpp)
  bool post = true;             // false: the plain picture, as it was (SETTINGS - LOOK)
  bool postOk = true;           // false: this GPU could not build the look at all
  bool treeShadows = true;
  // Another car on the circuit (a rival): same meshes, its own paint. Call
  // between drawWorld and the HUD.
  void drawCar(const Car &car, const Spec &S, double groundH, double gPitch, double gRoll, const float paint[3], double rolled,
               bool helmet = true);
  void drawRain(const FrameIn &f);

  // ---- HUD: pixel coordinates, origin top-left
  void hudBegin();
  void rect(float x, float y, float w, float h, const float rgba[4]);
  // font: 0 Anton, 1 Rubik, -1 picks by size (big figures in Anton)
  void text(float x, float y, float px, const std::string &s, const float rgba[4], Align al = LEFT, int font = -1);
  float textWidth(float px, const std::string &s, int font = -1) const;
  void hudEnd();
  // ---- the shapes the game's own pages are made of (CSS pixels in, as given)
  enum { ANTON = 0, RUBIK = 1, MARKER = 2, HUD_I = 3, HUD_B = 4 };
  void poly(const float *xy, int n, const float rgba[4]);
  void rrect(float x, float y, float w, float h, float r, const float rgba[4]);
  void card(float x, float y, float w, float h, float r, float bw, const float fill[4], const float line[4]);
  void circle(float cx, float cy, float r, const float rgba[4]);
  void path(const float *xy, int n, float width, const float rgba[4], bool closed);
  float textPx(float x, float y, float size, const std::string &s, const float rgba[4], Align al = LEFT, int font = 1, float track = 0);
  float widthPx(float size, const std::string &s, int font = 1, float track = 0) const;
  void hudRot(float cx, float cy, float deg);       // every shape after this is turned about (cx, cy); 0 turns it off
  float hudAlpha = 1;                               // multiplies every shape's alpha

  // Render into an offscreen target and write a PPM. For checking a build
  // without putting a window on anyone's screen.
  bool beginOffscreen(int w, int h);
  bool writePPM(const std::string &path);
  unsigned offscreenFbo() const { return fbo; }

  int W = 1280, H = 720;
  size_t worldTris = 0;

 private:
  unsigned prog = 0, hudProg = 0;
  int uVP = -1, uModel = -1, uEye = -1, uSun = -1, uAlpha = -1, uHudSize = -1;
  int uSunCol = -1, uSkyAmb = -1, uGndAmb = -1, uFog = -1, uSkyTop = -1, uFogK = -1, uWet = -1, uNDent = -1, uDent = -1, uDentN = -1, uPaint = -1;
  void setDents(const Car *car);
  GLMesh ground, sea, corridor, decals, lineMesh, scenery, sky, shadow;
  GLMesh carBody, carFrontWing, carRearWing, carHelmet, wheelF, wheelR;
  GLMesh spinF, spinR;          // the spokes and the writing on the tyre wall: smeared round the wheel at speed
  double wheelR_f = 0.36, wheelR_r = 0.36;
  bool carCabin = true;
  float carEye[3] = {0.2f, 0.76f, 0};
  // the least height the three bolted cameras (roof, nose, T-bar) may sit at and still be OUTSIDE this body
  float camFloor[3] = {0, 0, 0};
  float onboardX = -0.34f;
  std::string dataRoot;         // data/, for the few things a world reads for itself (landmarks)
  unsigned hudVao = 0, hudVbo = 0, fontTex = 0;
  struct Glyph { float x = 0, y = 0, w = 0, h = 0, bx = 0, by = 0, adv = 0; };
  struct Font { Glyph g[95]; float cap = 50, asc = 50, desc = 14; };
  Font fonts[5];
  bool rotOn = false;
  float rotCx = 0, rotCy = 0, rotC = 1, rotS = 0;
  void hudVert(float x, float y, float u, float v, const float c[4]);
  bool loadFonts(const std::string &dataDir);
  bool loadTextures(const std::string &texDir);
  unsigned texCol = 0, texNrm = 0;
  bool hasTex = false;
  int uHasTex = -1, uOrigin = -1;
  int fontFor(float px, int font) const;
  void hudQuad(float x, float y, float w, float h, float u0, float v0, float u1, float v1, const float c[4], float skew = 0);
  std::vector<float> hud;
  unsigned fbo = 0, fboCol = 0, fboDepth = 0;
  // ---- THE LOOK: the scene is drawn into a float picture, the sun casts real
  // shadows from a map, and the picture is then developed like film (bloom,
  // a filmic curve, a grade, anti-aliasing, a vignette). render.cpp, "the look".
  unsigned sceneFbo = 0, sceneCol = 0, sceneDepth = 0, bloomFbo[2] = {0, 0}, bloomTex[2] = {0, 0}, ldrFbo = 0, ldrTex = 0;
  unsigned shFbo = 0, shTex = 0, fsVao = 0, brightProg = 0, blurProg = 0, compProg = 0, fxaaProg = 0;
  int postW = 0, postH = 0, uShVP = -1, uShOn = -1, uPass = -1, uHdr = -1;
  int uGhost = -1;
  int uLampPos = -1, uLampDir = -1, uLampOn = -1, uTime = -1, uCloud = -1, uNight = -1;
  float shKey[6] = {1e9f, 0, 0, 0, 0, 0};
  Mat4 shVP;
  static constexpr int MIR_W = 840, MIR_H = 200;
  std::vector<unsigned> photoFbo, photoTex;
  void drawPicture(unsigned tex, float dx0, float dy0, float dx1, float dy1, float u0, float v0, float u1, float v1);
  std::vector<int> photoW, photoH;
  bool photosTried = false;
  std::string texDirKept;
  // rain on the glass and the wiper that clears it (render.cpp wiperTap, wiperStep, COMP_FS)
  struct Wiper { int level = 0; float pos = -1, drops = 0, next = 0, since = 0, before = 0, sweepWater = 0.25f; bool out = false, go = false; double tapAt = -10; } wiper;
  // THE GLASS'S CONSTANT BLOCK: five rows of four floats, each row on a 16-byte boundary,
  // sent to the develop shader as uRainCB[5] (render.cpp updateRainCB fills it from the physics).
  struct alignas(16) RainSystemCB {
    float wind[3];        // the air over the glass, m/s: x to the right, y up the glass, z off it
    float speed;          // the car's speed, m/s
    float gLat, gLong;    // lateral g (+ in a left-hander), longitudinal g (+ accelerating)
    float rake;           // the screen's angle, radians from flat
    float wiperAngle;     // the blade, radians from upright (-9: parked)
    float waterBefore;    // water on the glass before the last sweep, 0..1
    float gather;         // how fast it gathers, per second of rain
    float rainSince;      // seconds of rain since that sweep began
    float sweep;          // seconds of rain that fall while the blade crosses
    float flow[2];        // how far the running drops have travelled
    float time;
    float glass;          // 1: you are looking through a screen or a visor
    float light[3];       // the brightest light, view space
    float lightPower;
  } rainCB;
  float flowX = 0, flowY = 0;
  void updateRainCB(const FrameIn &f, const Mat4 &view);
  float rainNow = 0, rainSpeed = 0;
  bool glassNow = false;
  void wiperStep(float dt, double now);
  // the camera's shake (render.cpp shakeCamera): only ever on grass or in a crash
  struct Shake { float level = 0, spdWas = 0, jit[3] = {0, 0, 0}, accT = 0, accHeld = 0, lastSpd = 0, acc = 0, dist = 0, kick = 0, hf[3] = {0, 0, 0}, kn = 0, dv = 0, dx = 0, gv = 0, lv = 0, lx = 0; } shake;
  void shakeCamera(const FrameIn &f, float eye[3], float at[3], float up[3]);
  unsigned mirFbo = 0, mirTex = 0, mirDepth = 0;
  bool mirrorPass = false, mirHas = false;
  // motion blur (render.cpp COMP_FS): the camera's travel in view space, the view itself, and the cars to leave sharp
  float mbVel[3] = {0, 0, 0}, mbTan = 0.6f, mbAmt = 0, mbHole[4] = {-1, -1, -1, -1};
  Mat4 mbView;
  std::vector<float> mbSpots;
  bool sceneOpen = false;
  // THE GOVERNOR. The scene is drawn at `scale` of the window and enlarged when
  // it is developed; the scale follows what the GPU is measured to take, so the
  // picture is as sharp as this machine can hold at speed, and no sharper.
  float scale = 1.0f;
  int sw() const { return std::max(8, (int)(W * scale + 0.5f)); }
  int sh() const { return std::max(8, (int)(H * scale + 0.5f)); }
  unsigned gpuQ[2] = {0, 0};
  int gpuAt = 0, gpuN = 0;
  double gpuSum = 0, gpuMs = 0;
  void ensurePost();
  void renderShadow(const Look &L, const float eye[3], const float fwd[3], double time);
  bool camReady = false;
  double camYaw = 0;
  void drawMesh(const GLMesh &m, const Mat4 &model, float alpha = 1);
  // photographs with their own UVs: downloaded cars, the woods, the boards (dress.cpp)
  Dress *dress = nullptr;
  // downloaded trackside models laid along the circuit's edge: armco, concrete, fence (props.cpp)
  class Props *props = nullptr;
  const PackCar *packCar = nullptr;
  std::string packKey;
};

}  // namespace xbr
