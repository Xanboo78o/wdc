// fx.hpp — the crash drama, native: loose wheels and wings as rigid bodies,
// sparks, tyre smoke and dust, fire, and the explosion. js/fx.js with
// js/smoke.js, js/sparks.js and js/debris.js behind it, ported where they
// exist; the fire and the explosion are new here.
//
// IT ONLY READS. Each car's state is diffed frame to frame (damage went up, a
// wing flag turned true, the velocity changed by 30 m/s in one frame) and
// turned into things you can see. Nothing here writes a Car, so the simulation
// native/check.sh compares against the JS cannot be moved by it.
//
// The frame:
//     fx.begin(session, track, world, terrain, spec);
//     fx.car(car, proj, paint, mine, dt);        // every car on the circuit
//     fx.end(dt);                                // integrate particles and bodies
//     ... R.drawWorld(f); drawField();
//     fx.draw(R, time);                          // into the open scene, before R.endScene()
//
// Thresholds (fx.cpp, "what burns"): energy is 0.5 * mass * dv^2, dv being the
// velocity the car lost or gained in one frame of an impact.
//     FIRE       >= 0.35 MJ taken within a few seconds, on a car at damage >= 0.50
//                (or >= 0.12 MJ on one already at damage >= 0.85)
//     EXPLOSION  >= 1.60 MJ in one blow, or >= 2.40 MJ within a few seconds,
//                or a car that has burned for 7.5 - 10 s
//
// Unseen checks (the game's --shot): XBR_FXTEST=fire,explode,wreck,wheel,wing,
// sparks,smoke,dust,all stages that on your car (XBR_FXCAR=n: on the n-th car
// of the field instead, 0 = pole); XBR_FXT=seconds is how long the effects run
// before the photograph (default 2); XBR_FXHOLD=1 parks the car first;
// XBR_FXCRASH=kmh,deg points it at the barrier and lets the real physics do it
// (game_main.cpp reads those two). XBR_FXTIME=1 prints what a frame of it
// costs; XBR_FXHALF=0 / XBR_FXSOFT=0 turn off the half-size puff pass / the
// soft edges, to compare.
#pragma once
#include "collide.hpp"
#include "physics.hpp"
#include "render.hpp"
#include "track.hpp"
#include "world.hpp"

namespace xbr {

class Fx {
 public:
  Fx();
  ~Fx();
  Fx(const Fx &) = delete;
  Fx &operator=(const Fx &) = delete;

  // `session`: any pointer that is different for a different session. A new one
  // clears the circuit: every piece, every puff, every fire.
  void begin(const void *session, const Track &track, const World *world, const Terrain *terrain, const Spec &spec);
  void car(const Car &car, const Proj &proj, const float paint[3], bool mine, double dt);
  void end(double dt);
  // Between drawField() and R.endScene(). Leaves blend off, depth test on, depth
  // writes on, and the program, VAO and active texture as it found them.
  void draw(const Renderer &R, double time);

  // A car that has burned is not the colour it was: darkens `paint` in place.
  void tint(const Car &car, float paint[3]) const;
  // 0 sound, 1 on fire, 2 a wreck that has exploded. The game retires a wreck: nothing drives away from that.
  int phaseOf(const Car &car) const;
  // This car has been replaced by a new one (a reset): it is not on fire any more. What it left on the circuit stays.
  void forget(const Car &car);
  // An explosion since the last call, as a closing speed for EngineAudio::hit
  // (already faded by its distance from the camera); 0 = none.
  double takeBoom();

  // THE BIG PIECES ARE REALLY THERE (collide.hpp Hazard). hazards(): every loose wheel and wing, where it is and
  // how fast it is going, for the game to run the cars against. struck(): what a car did to one. sweep(): the
  // marshals have carried it off. Fx still writes no Car: the game does the hitting, and tells the piece.
  void hazards(std::vector<Hazard> &out);
  void struck(const Struck &k);
  void sweep(int id);

  // seconds of effects to run before a --shot (0 = no test asked for)
  static double testSeconds();

 private:
  struct Impl;
  Impl *d;
};

}  // namespace xbr
