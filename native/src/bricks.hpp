// bricks.hpp — a car made of pieces: the catalogue, the shapes, the file, and
// what the pieces add up to (mass, drag, downforce, where the wheels are).
//
// Adam, 2026-10-08: "having me design them in a trailmakers/lego style editor",
// "lego bits too, like plates, and being able to center stud and middle stud",
// "connection points on all sides even if technically it wouldnt and no
// collisions between pieces", "ill place them but u will physic them".
//
// NOTHING HERE TOUCHES OpenGL OR SDL. The editor (works_main.cpp) draws what
// this file makes; the game and a headless check can read the same car.
//
// THE LATTICE. One unit is 2.5 cm, and every piece sits on whole units:
//   a stud   = 10 units = 25 cm   (a Speed Champions car is 8 studs = 2.0 m wide)
//   half     =  5 units           (the jumper-plate offset: "centre stud")
//   a plate  =  4 units = 10 cm   (so 5 plates = 2 studs, as in the real thing)
//   a brick  = 12 units = 3 plates
//   a cube   = 10 units           (a Trailmakers 1x1x1)
// Axes are the car's: +x forward, +y up, +z the car's RIGHT. z = 0 is the
// centreline, y = 0 is the build plate.
#pragma once
#include <string>
#include <vector>

namespace xbr::bricks {

constexpr double UNIT = 0.025;                 // metres
constexpr int STUD = 10, HALF = 5, PLATE = 4, VSTEP = 2, BRICK = 12, CUBE = 10;

enum Shape {
  BLOCK, WEDGE, WEDGE_CORNER, WEDGE_INNER, CURVE, CURVE_IN, CURVE_CORNER, ROUND, CONE, ARCH,
  SCREEN, WING, WHEEL, SEAT, LAMP_ROUND, LAMP_SQUARE, N_SHAPES
};
// What a surface is made of. The first six are a piece's own finish; RUBBER is
// only ever a part of a piece (a tyre), LINE is the editor's unlit grid.
enum Mat { PAINT, MATTE, GLASS, CHROME, LIGHT, CARBON, RUBBER, LINE, N_MATS };
constexpr int N_FINISH = 6;

struct ShapeInfo {
  const char *id;        // in the file
  const char *name;      // on the tray
  int s[3];              // the size it arrives at: length (x), height (y), width (z), in units
  bool sizable;          // may be stretched
  int mat;               // the finish it arrives in, or -1 for "whatever is in hand"
};
const ShapeInfo &info(int shape);
int shapeById(const std::string &id);
const char *matName(int mat);

struct Piece {
  int shape = BLOCK;
  int s[3] = {STUD, BRICK, STUD};   // its own length, height, width before it is turned
  int p[3] = {0, 0, 0};             // the low corner of the box it fills once turned
  int r[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};   // how it is turned: a rotation, row-major
  bool flip = false;                // mirrored left-for-right (a corner piece has a handedness)
  unsigned col = 0xd8352a;          // 0xRRGGBB
  int mat = PAINT;
  void dims(int d[3]) const;        // the box it fills once turned
  bool operator==(const Piece &o) const;
};

// Turn a piece a quarter about a world axis (0 x, 1 y, 2 z), keeping its low corner.
void turn(Piece &p, int axis, int quarters = 1);
// The same piece on the other side of the centreline.
Piece mirrored(const Piece &p);

// Triangles, 10 floats a vertex: position (metres), normal, colour (0..1,
// sRGB), material. The same layout the game's MeshB uses.
void mesh(const Piece &p, std::vector<float> &out);

struct Klass {
  const char *id, *name;
  double power;        // W
  double base;         // kg of what is not bodywork: engine, driveline, cage, driver
  double len, wid;     // a footprint to build to, metres (drawn on the plate; nothing enforces it)
  double wb;           // and its wheelbase
};
extern const Klass KLASSES[];
extern const int N_KLASSES;
int klassById(const std::string &id);

struct Car {
  std::string name = "untitled";
  int klass = 0;
  std::vector<Piece> pieces;
  bool save(const std::string &path) const;
  bool load(const std::string &path);          // false and untouched if the file is not there or not a car
};

// What the pieces add up to. Lengths in metres, masses in kg.
struct Stats {
  int pieces = 0, wheels = 0;
  double mass = 0;
  double cg[3] = {0, 0, 0};
  double len = 0, wid = 0, hgt = 0;
  double frontal = 0;      // m2, what the air sees from dead ahead
  double cd = 0;           // from the slope of every surface the air meets first
  double cdA = 0, clA = 0; // clA positive = downforce
  double wingArea = 0;
  double wheelbase = 0, trackF = 0, trackR = 0, wheelR = 0;
  double frontWeight = 0;  // share of the weight on the front axle, 0..1
  double vmax = 0;         // m/s, where the class's power meets this drag
  std::string note;        // what is missing before it can be driven, or empty
};
Stats derive(const Car &car);

}  // namespace xbr::bricks
