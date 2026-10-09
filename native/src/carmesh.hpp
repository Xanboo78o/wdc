// carmesh.hpp — the car's bodywork, ported from the browser game's js/car.js
// (buildCar: the 2022-shape single-seater, F1 and F4; buildGT3: the coupe) and
// the generic team livery of js/livery.js.
//
// Pure geometry: no GL calls. Everything is emitted through MeshB in SIM-LOCAL
// car coordinates (x forward, y left, z up, origin at the centre of gravity on
// the road, front axle at +spec.a, rear axle at -spec.b).
#pragma once
#include "physics.hpp"
#include "render.hpp"

namespace xbr {

struct CarMeshes {
  MeshB body, frontWing, rearWing, helmet, wheelF, wheelR;
  // What on a wheel is NOT the same all the way round: the spokes, and the
  // lettering and compound marks on the tyre wall. Drawn over the wheel, and
  // smeared round it when it is turning fast (render.cpp drawCar).
  MeshB spinF, spinR;
  double wheelRadF = 0.36, wheelRadR = 0.36;
  float eye[3] = {0, 0, 0};   // driver's eye, GL-local (x forward, y up, z to the car's right)
  bool cabin = false;         // true: there is a cockpit to sit in, put ONBOARD at `eye`
};

CarMeshes buildCarMeshes(const Spec &spec);   // spec.key "f1" | "f4" | "gt3"; spec.gt true for the coupe

}  // namespace xbr
