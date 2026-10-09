// props.hpp — the downloaded things that stand beside the road: armco,
// concrete barrier, catch fence (data/props, tools/bakeprop.mjs).
//
// Each is ONE model drawn thousands of times, a piece after a piece along the
// edge of the circuit. The pieces are not copied into a mesh: every piece is
// three points of a curve (where it starts, where it bends, where it ends) and
// the vertex shader lays the model along that curve. So twenty kilometres of
// Nordschleife armco costs thirteen floats a piece and the rail still follows
// the road round a hairpin instead of cutting it as a six metre chord.
//
// Owned and called by the Renderer, beside Dress.
#pragma once
#include <memory>
#include <string>
#include <vector>

#include "render.hpp"

namespace xbr {

struct PropKit;
struct PropRun;

class Props {
 public:
  Props();
  ~Props();
  bool init(const std::string &dataDir, const std::string &texDir);

  // One side of the circuit: the foot of the barrier at every track sample, in
  // GL space (x, up, z), in the direction of travel.
  struct Edge {
    std::vector<float> p;          // xyz per sample
    std::vector<char> fenced;      // per point: a catch fence stands behind the barrier here
    std::vector<int> sample;       // per point: the track sample it belongs to
    bool rightSide = false;        // which side of the road it is
    bool closed = true;            // the last sample joins the first
  };
  // wall: the track file's word for its barrier ("wall" = concrete, anything else = armco).
  void buildWorld(const std::string &wall, const std::vector<Edge> &edges);
  // true once buildWorld has put a barrier round this circuit: the renderer then leaves its own plain one out
  bool hasBarrier() const { return barrier; }
  // can a barrier be laid for this kind of wall at all? (asked BEFORE the corridor is built)
  bool canBarrier(const std::string &wall) const;

  void frame(const Mat4 &VP, const float eye[3], const Look &look, const Mat4 &shadowVP, bool shadowOn);
  // The barrier as the cars have left it (collide.hpp BarrierWear): call when its version has changed.
  void deform(const std::vector<float> bend[2], const std::vector<char> broke[2], unsigned version);
  void draw();                     // depth test on, blend off; the sun's shadow map on texture unit 3
  size_t tris = 0;                 // drawn last frame

 private:
  std::string dataDir, texDir;
  unsigned prog = 0;
  bool barrier = false;
  unsigned wearSeen = 0;
  Mat4 VP, shVP;
  bool shOn = false;
  float eye[3] = {0, 0, 0};
  Look look;
  std::vector<std::unique_ptr<PropKit>> kits;
  std::vector<std::unique_ptr<PropRun>> runs;
  PropKit *kit(const std::string &key);
  void lay(PropKit &k, const Edge &e, double zoff, bool onlyFenced, bool gives);
};

}  // namespace xbr
