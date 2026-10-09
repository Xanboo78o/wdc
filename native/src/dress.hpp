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

  // ---- the woods and the boards ------------------------------------------------
  void buildWorld(const Track &track, const World &world, const Json &env, const Line &raceLine);
  bool hasWoods() const;     // false: the photographs are missing, draw the old trees and boards
  void drawWorld();          // opaque + cut-out: call with depth test on, blend off
  size_t worldTris = 0;

 private:
  std::string dataDir, texDir;
  unsigned carProg = 0, floraProg = 0;
  Mat4 VP;
  float eye[3] = {0, 0, 0};
  Look look;
  double time = 0;
  std::map<std::string, std::unique_ptr<PackCar>> packs;
  std::unique_ptr<Woods> woods;
  void lights(unsigned prog);
};

// What the renderer needs to know about a pack to sit a driver in it.
struct PackInfo { float eye[3]; double wheelbase, wheelR; };
PackInfo packInfo(const PackCar &pc);

}  // namespace xbr
