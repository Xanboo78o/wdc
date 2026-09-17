# CHASING WDC — design bible

A single-seater racing simulator, in the browser, built to be practised on
rather than played. Started 2026-09-16.

Read this file before touching `js/physics.js` or `js/autopilot.js`. Most of
what is in here was paid for with a debugging session, once, already.

## The pitch

Real tyres, real circuits, cheap paint. The graphics budget is deliberately
small so the simulation budget can be large. The thing on screen that matters
is not the car — it is the **slip bars**: how far into the tyre you currently
are, with a marker at the angle where grip actually peaks. Everything else is
decoration around that one readout.

## Locked decisions

- **Single-seaters, F4 → F1.** F4 is the default because it is the first rung
  of the real ladder and because its tyre peaks later (~10.1° vs ~7.4°), which
  means it warns you before it goes. You earn the F1 car.
- **Browser now, native later.** Which makes one rule absolute: `js/physics.js`
  must never import a renderer. Nothing in it may touch `window`, three.js, or
  a frame. That is what makes "native later" a fact rather than an intention.
- **Keyboard + gamepad, wheel-ready.** A keyboard is a switch and a wheel is
  not, so `js/input.js` models the driver's HANDS — the rack winds on at a
  finite rate, self-centres faster than it winds on, and usable lock falls away
  with speed. A gamepad bypasses all of that, because an analogue stick already
  is a wheel position and shaping it twice would double up.
- **No build step.** Plain ES modules with an import map, vendored three.js.
  The browser loads exactly the same files the Node harnesses do.

## Where the parts came from

Nothing here was written from scratch that already existed somewhere:

| part | origin |
|---|---|
| tyre/aero/load-transfer model, validated F1 numbers | `dirtyair/js/physics.js` |
| 5 circuits baked from real OSM survey data | `dirtyair/data/tracks/` |
| minimum-curvature line + speed profile | `dirtyair/js/line.js` |
| driver's-hands keyboard model | `dirtyair/js/input.js` |
| gamepad layer (deadzone/expo, rumble) | `cruise/js/input.js` |
| headless-harness discipline | `cruise/tools/`, `rally/tools/simcheck.mjs` |
| vendored three.js r163 | `cruise/js/vendor/` |

## Validated physics numbers

Carried over from DIRTY AIR, where they were checked against real F1 data.
**Do not "tidy" these without re-running `tools/drive.mjs`.**

| quantity | model | real |
|---|---|---|
| F1 top speed | 321 km/h | ~330 |
| F1 downforce @300 km/h | ~2000 kg | ~1800–2100 |
| F1 peak slip angle | 7.4° | 6–8° |
| F4 top speed (drag limit) | 212 km/h | ~210–215 |
| F4 peak slip angle | 10.1° | later + flatter than a slick, yes |

**Known systematic bias:** ideal-line lap times run ~10% slower than real pole
pace (F1 Monza 1:28 model vs 1:20 real; F4 Monza 2:06 model vs ~1:53 real).
This is inherited from DIRTY AIR and is consistent across both cars, so it is a
model-wide scale error, not an F4 spec error. Worth chasing later; harmless for
learning braking points, because it is uniform.

## Gotchas paid for on day one (do not reintroduce)

1. **Countersteer sign.** Positive `delta` steers LEFT, and in a left-hand
   slide the rear slip angle goes NEGATIVE. The catch must therefore ADD
   `sign(slipR) * excess`. Subtracting winds more lock *into* the slide — the
   autopilot went 49.6% off ideal with 45s a lap spent off the road.
2. **A controller is not a 400 Hz servo.** Recomputing the steering angle every
   physics substep with a countersteer gain of 1.5 injected +6.1° of lock in
   one 2.5 ms step for a 5.2° error. The tracer caught the result at Monza's
   first chicane: the rack flipped −1.7° → +3.9° → −5.5° and slip diverged
   4 → 6 → 8 → 11 → 15 → 22 → 30°. A tank-slapper. Fixed by a fixed control
   rate (120 Hz), a finite rack slew rate (6 rad/s), and gain 0.4 not 1.5.
3. **Do not re-derive braking on top of the speed profile.** `line.v` is
   already brake-limited — `line.js` solves it with a proper backward pass
   integrating 2 m at a time at the downforce that exists at each speed. Two
   attempts to recompute it on the fly both failed: holding current downforce
   across a 260 m horizon flattered the brakes (arrives 10–15% hot at every
   apex); evaluating at the average of current and target speed coupled the
   target to the car's own speed, so slowing lowered assumed braking, which
   demanded more braking — a feedback loop that parked the car at 7 km/h in a
   chicane asking for 50. Just read the profile, slightly ahead.
4. **Flat ribbons need explicit normals, not `computeVertexNormals()`.** Which
   side of the centreline `innerAt` lands on flips per ribbon (the road runs
   −w → +w, the left run-off runs +w → +w+run), so the winding flips with it
   and half the surfaces face DOWN. The tarmac was backface-culled and
   invisible while the run-off beside it rendered fine. Normals are hardcoded
   +Y and every ground material is `DoubleSide`.
5. **Shadow acne on flat ground needs `normalBias`, not depth bias.** The track
   is one enormous unbroken plane, which is the worst case; a depth bias alone
   left the whole road self-shadowing and rendering near-black.

## Inherited gotchas (from DIRTY AIR — still load-bearing here)

- Low-speed regularisation is mandatory: floor the slip-angle denominator at
  6 m/s or every slip angle blows up to 90° as vx → 0 and the car scrubs to a
  halt at full throttle.
- Never bleed `vy` when clamping `vx` at zero. A spun car still has ground
  speed; bleeding it empties the car's energy in ~0.05 s and reads as an
  instant stop from 120 km/h.
- The tyre thermal time constant must not be ~1 s. That pins every tyre at
  ambient, silently costs 30% of the grip, and looks like broken physics.
- Past peak slip, more lock means LESS grip. Any controller must stop winding
  on there.
- Run-off is per-side (`runL`/`runR`). Clamping both sides turns a chicane into
  a walled box.
- Rear weight bias: `b < a`. Backwards makes the car push into corners then
  snap on exit.

## Harnesses — use these instead of guessing

```
node tools/drive.mjs [track] [laps] [class]     # the gate: lap time, off-track, sideways
node tools/trace.mjs [track] [class]            # WHY it failed: timeline + dense window
```
`tools/harness.mjs` is shared by both so they can never drift apart and start
reporting on two different simulations. Flags `--rack=N --yaw=N` override the
autopilot's rack slew rate and switch countersteer to yaw-rate damping.

Browser check without a human clicking anything:
`?auto=monza:f1` boots straight into a session — used by the headless
chromium screenshot pass.

## Not done yet

- **The autopilot is 27–47% off ideal pace** and still spends 25–40 s a lap
  sideways. Suzuka is the best (27.5%), F1 anywhere is the worst (47%, and it
  still puts a wheel 17 m off). For reference, DIRTY AIR's AI sits at 30–45%
  off ideal and that is documented there as *its* open problem — this is a hard
  problem, not a missing line of code. **Next job.**
- No opponents, no qualifying, no race. It is a hotlap.
- No sound at all.
- No wheel/force-feedback layer. The WebHID pedal pairing in
  `apex-racer/js/main.js` (lines ~432–487) is the thing to port when the DIY
  pedals exist — see `apex-racer/docs/RIG-BUILD.md`.
- No cache-busting stamp yet (`dirtyair/tools/stamp.mjs` is the recipe).
