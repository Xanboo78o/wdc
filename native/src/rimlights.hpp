// rimlights.hpp — THE REV LIGHTS ON THE REAL WHEEL (Adam: "can the light on the wheel be used for
// stuff? ... make it do al sorts of practical things").
//
// The MOZA base has a serial port beside its game-controller one, and the row of ten lights on
// the rim takes a 10-bit mask over it (the protocol is the open-source boxflat project's
// data/serial.yml: frame 0x7E, length, group, device, id..., payload..., (sum + 13) % 256;
// "old-send-telemetry" = group 65, id 253 222, a 4-byte big-endian mask). That ONE command is
// all this file ever writes. It sets no option, moves no motor, and reads nothing it acts on.
//
// What the lights say, most urgent first:
//   the start        the five red lights, as pairs closing from the outside in; out = go
//   the pit lane     the two halves swapping, for as long as you are in it
//   a neutralised race (safety car, virtual safety car, red flag)   all ten, slowly on and off
//   a blue flag      a pair of lights running across the row: somebody is coming through
//   otherwise        the REVS: filling over the top half of the range, all flashing at the shift
//                    point — and the two outside lights on one side flicker while a car is ALONGSIDE
//                    you on that side, which no mirror in this game shows you
#pragma once
#include <cstdint>

namespace xbr {

struct RimIn {
  double clock = 0;                  // wall seconds
  double revs = 0;                   // 0..1 over the top half of the rev range (what the on-screen lights show)
  bool shift = false;                // at the shift point / on the limiter
  bool grid = false; double lightsIn = 0;      // on the grid, and seconds until the lights go out
  bool pit = false, neutral = false, blue = false;
  int alongside = 0;                 // -1 a car on your right, +1 on your left, 0 neither
};

class RimLights {
 public:
  ~RimLights();
  bool open();                       // false: no wheel with lights here (or XBR_RIM=0); everything else is then a no-op
  bool ok() const { return fd >= 0; }
  void update(const RimIn &in);      // once a frame while driving
  void off();                        // every light out (pause, menus, leaving)

 private:
  int fd = -1, dev = 19;
  uint32_t last = 0xffffffffu;
  double lastAt = -1;
  void send(uint32_t mask, double clock);
};

}  // namespace xbr
