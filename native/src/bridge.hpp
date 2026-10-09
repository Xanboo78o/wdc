// bridge.hpp — the wheel's force feedback and its hidden buttons, through the
// bridge Adam already runs and trusts (tools/ffb.py on ws://127.0.0.1:8179).
//
// The native game does NOT open the wheel's motor itself. The bridge owns the
// device, the force ceiling Adam chose (--max), the ramp, the slew limit and
// the direction he verified; this speaks the same messages js/ffb.js does. No
// bridge running = no forces and nothing else changes.
//
// It also hears the rim's buttons from the bridge ({"b": n, "v": 0|1}) — the
// measured indices data/wheelbtn.json is written in.
#pragma once
#include <set>
#include <string>

#include "physics.hpp"

namespace xbr {

class Bridge {
 public:
  ~Bridge();
  // Call every frame. `force` false sends zero and the wheel goes limp.
  void update(const Car &car, double rough, double dt, bool force, double gain);
  void hit(double k) { if (k > jolt) jolt = k > 1 ? 1 : k; }
  void release();                       // zero the wheel now (pause, menu, quit)
  bool live() const { return state == 2; }
  std::set<int> buttons;                // rim buttons held, by measured index

 private:
  int fd = -1, state = 0;               // 0 idle, 1 handshaking, 2 open
  double retryIn = 0, jolt = 0, dist = 0, kick = 1, sinceSend = 0;
  bool zeroed = true, reqSent = false;
  std::string inbuf;
  void connect();
  void drop();
  void pump();
  void sendText(const std::string &s);
};

}  // namespace xbr
