// dress.hpp — everything drawn from a PHOTOGRAPH with its own UVs: the
// downloaded car models (data/cars, tools/bakecar.mjs), Adam's forest
// (js/forest.js + js/woods.js) and the numbered braking boards
// (js/furniture.js).
//
// The world shader in render.cpp colours a surface from where it is (metre
// UVs off the world position); it has no UVs of its own. A car's livery, a
// leaf and a number on a board all need them, so they are drawn here, by a
// second small set of programs lit by the same sun, sky and fog.
//
// Owned and called by the Renderer; nothing outside render.cpp includes this.
#pragma once
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "json.hpp"
#include "physics.hpp"
#include "render.hpp"
#include "track.hpp"
#include "world.hpp"

namespace xbr {

struct PackCar;
struct Woods;

class Dress {
 public:
  Dress();
  ~Dress();
  bool init(const std::string &dataDir, const std::string &texDir);

  // Once a frame, before anything below is drawn.
  void frame(const Mat4 &VP, const float eye[3], const Look &look, double time);

  // ---- downloaded cars -------------------------------------------------------
  // Loads data/cars/<key> the first time it is asked for. Null if it is not there.
  const PackCar *pack(const std::string &key);
  // carM: the car's matrix with the origin on the road at mid-wheelbase.
  // paint: a team colour for the bodywork, or null to leave it as it came.
  // lost: four flags (fl, fr, rl, rr) for wheels that are gone.
  void drawPack(const PackCar &pc, const Mat4 &carM, double steer, double rolled, const float *paint, const bool *lost,
                const double *sag, bool glassPass);

  // Which of a car's eighty teams to paint: an index, or -1 to let the paint
  // colour passed to drawPack choose (the default). XBR_LIVERY=N or =off overrides.
  void setLivery(int index) { liveryIx = index; }
  size_t liveryCount(const PackCar &pc) const;
  std::string liveryName(const PackCar &pc, int index) const;      // the team that livery belongs to ("" if none)
  // How far the wheels turn while the shutter is open, radians (0 = sharp): the next drawPack smears them by it.
  void setWheelSweep(float radians) { wheelSweep = radians; }
  // LIGHTS (Adam: "make their headlights and brake lights work and brakes glow").
  // How hard this car is on the brakes, 0..1: the next drawPack lights its tail lamps by it.
  void setBrake(float b) { brakeNow = b; }
  void setWorld(bool on) { worldDraw = on; }       // what is drawn next is a circuit, not a car: nothing of it is a cabin
  void setCabinLift(float k) { cabinLift = k; }   // extra daylight on what is drawn next from inside (the steering wheel); 0 = none
  // every car's lamps, for the paint of the downloaded cars (render.cpp gathers them): up to eight
  void setLamps(int n, const float *pos4, const float *dir4, const float *col3) {
    nLamp = n < 8 ? n : 8;
    for (int i = 0; i < nLamp * 4; i++) { lampP[i] = pos4[i]; lampD[i] = dir4[i]; }
    for (int i = 0; i < nLamp * 3; i++) lampC[i] = col3[i];
  }
  // DAMAGE: the car's dents (physics Car::dents) for the next drawPack; null = none.
  // shift: how far ahead of the sim's origin (the CG) the pack's own origin (mid-wheelbase) is.
  void setDents(const Car *car, double shift);
  // After both drawPack passes: the lamps themselves as light — two white at the
  // nose, two red at the tail that flare under braking, a pool of light on the
  // road at night, and four discs that glow once they are hot. `who` is any
  // pointer that stays with this car: the discs' heat is remembered by it.
  void drawLights(const PackCar &pc, const Mat4 &carM, const void *who, double brake, double speed, double steer, const bool *lost,
                  const double *sag);

  // ---- the woods and the boards ------------------------------------------------
  void buildWorld(const Track &track, const World &world, const Json &env, const Line &raceLine);
  bool hasWoods() const;     // false: the photographs are missing, draw the old trees and boards
  void drawWorld();          // opaque + cut-out: call with depth test on, blend off
  void drawShadow();         // the trees only, as crossed photographs: for a sun shadow map (set frame() to the sun's view first)
  size_t worldTris = 0;

 private:
  std::string dataDir, texDir;
  unsigned carProg = 0, floraProg = 0, sheet = 0;
  bool sheetTried = false, liveryOn = true;
  int liveryIx = -1;
  float wheelSweep = 0, brakeNow = 0;
  int nDent = 0, nLamp = 0;
  float cabinLift = 0;
  bool worldDraw = false;
  float lampP[32] = {}, lampD[32] = {}, lampC[24] = {};
  float dentV[32] = {}, dentN[16] = {};
  unsigned glowProg = 0, glowVao = 0, glowVbo = 0;
  struct Heat { float h = 0; double t = -1; };
  std::map<const void *, Heat> heat;
  Mat4 VP;
  float eye[3] = {0, 0, 0};
  Look look;
  double time = 0;
  std::map<std::string, std::unique_ptr<PackCar>> packs;
  std::unique_ptr<Woods> woods;
  void lights(unsigned prog);
  void drawWoods(bool shadow);
};

// What the renderer needs to know about a pack to sit a driver in it.
struct PackInfo { float eye[3]; double wheelbase, wheelR; size_t tris = 0; };
PackInfo packInfo(const PackCar &pc);

}  // namespace xbr
