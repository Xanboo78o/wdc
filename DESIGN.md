# CHASING WDC — design bible

A single-seater racing simulator, in the browser, built to be practised on
rather than played. Started 2026-09-16.

**Live: https://xanboo78o.github.io/wdc/** — repo `Xanboo78o/wdc`, Pages served
from `master` root, so a push is a deploy.

Read this file before touching `js/physics.js` or `js/autopilot.js`. Most of
what is in here was paid for with a debugging session, once, already.

## The pitch

Real tyres, real circuits, real surfaces. The thing on screen that matters is
not the car — it is the **slip bars**: how far into the tyre you currently are,
with a marker at the angle where grip actually peaks.

The graphics budget used to be deliberately tiny. It is not any more, and the
reason is not vanity: it is the complaint *"makes 210=210 not 210=60"*. Speed
is not a number, it is **optical flow**. A flat grey ribbon on a green plane
gives the eye nothing to measure, so 210 km/h reads as walking pace no matter
what the HUD says. Aggregate at its true size, guard rail posts every 4 m,
hoardings every 8, braking boards every 50 and marshal posts every 300 are a
RULER laid along the lap, and they are most of the sensation.

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
6. **The sim frame and three.js are opposite handedness.** The simulation is
   right-handed in 2D — +x forward at heading 0, +y to the car's LEFT, headings
   increasing anticlockwise. Mapping sim y straight onto three z renders the
   whole world as its MIRROR IMAGE: every circuit reflected, every right-hander
   a left-hander, and steering that feels inverted because pressing left moves
   the car right on screen. The fix is one negation (`Z()` in `render.js`), but
   a reflection also reverses every triangle's winding — so the edge-ordering
   rule in gotcha 4 had to flip at the same time, or the black tarmac comes
   straight back. Change one, change both.
7. **Overpass rejects requests without a real User-Agent** with a bare
   `406 Not Acceptable` and an HTML body, which looks exactly like the service
   being down. Send `-A '<project>/<version> (contact ...)'` and it works.
   `https://overpass-api.de/api/interpreter` answers fine with one.

## The world around the circuit

`tools/bakeenv.mjs` pulls the real surroundings from OpenStreetMap using the
**same projection the circuit was baked with**, so the facades line up with the
barriers instead of floating 40 m away. `js/env.js` renders them, merged into a
handful of draw calls — 2,300 separate building meshes would cost more than the
entire physics budget.

```
node tools/bakeenv.mjs [track|all] [--force]   # buildings, landcover, coastline
node tools/envmap.mjs  [track] [width]         # draw it as ASCII to check it
```
Raw Overpass responses cache under `data/env/raw/`, so re-running without
`--force` re-derives the geometry for free and does not hammer a volunteer-run
service. Output is ~140–330 KB per circuit.

**Proof the projection is right** (this is the test to repeat after any change):
the baked track carries real OSM corner names, and the building dump carries
real building names. At Monaco, the building called *Le Mirabeau* lands 56 m
from the corner called *Mirabeau Haute*, and La Rascasse/Anthony Noghès pick up
*Chapelle de la Miséricorde* and *Ecole de la Condamine* — both genuinely in La
Condamine. A mirrored or offset world cannot produce that pattern. Small
distances alone prove nothing: in a dense city a mirrored world still puts
buildings near the track.

More gotchas, paid for:

8. **Ground cover must render BELOW the racing surface.** The road is at y=0
   and the run-off at −0.03, so any positive y paints over the track. Zandvoort
   has a single 4,886 m dune polygon in a 2,173 m world; at y=+0.028 it
   blanketed the entire circuit and looked like a renderer crash. Cover is
   scenery and never competes with the surface you drive on. Layers are
   millimetres apart, so they also need `polygonOffset`.
9. **Query building RELATIONS as well as ways.** Only ~1% of buildings are
   multipolygon relations, but they are the landmarks — ways alone silently
   drops the Casino at Monaco, the one building anyone would recognise.
10. **The sea is not an area.** It is an open `natural=coastline` way with, by
    OSM convention, LAND ON THE LEFT of the direction of travel. Skip it and
    Monaco has no Mediterranean. Extrude it seaward and close it — but clamp
    BOTH edges to the world box: Overpass returns a whole way if any part
    touches the box, so a national coastline produced a single 14.6 km polygon
    around a 2 km circuit. Take the seaward direction from the UNCLAMPED line,
    or squashing points onto the box edge flips which side the sea is on.

## The look: where every pixel came from

Nothing in `data/` is procedurally generated except text, which cannot be
photographed. Both piles are **CC0 public domain**, which is what makes them
safe on GitHub Pages, and both have their own fetch tool and a SOURCE.md that
travels with the files.

```
node tools/gettex.mjs [name|all] [--force]   # PBR materials, ambientCG
node tools/getsky.mjs [name|all] [--force]   # sky HDRIs, Poly Haven
```

`data/tex/` is ten photoscanned PBR sets, 2.1 MB, three files each:

| file | what | colour space |
|---|---|---|
| `-c.jpg` | colour / albedo | sRGB |
| `-n.jpg` | tangent-space normal, **GL convention** | linear |
| `-orm.jpg` | AO in R, roughness in G, metalness in B | linear |

That last one is the glTF ORM packing, and three.js reads it natively: point
`aoMap`, `roughnessMap` and `metalnessMap` at the same texture and each takes
its own channel. Three maps instead of five halves the bytes and halves the
texture units a material burns.

### UVs are metres

The one idea the whole graphics layer rests on. Every surface is UV-mapped in
real-world metres, so a material only says how big its photograph is on the
ground and sets `repeat = 1/size`. A 7.6 m road at Monaco and a 28 m gravel
trap at Monza then show aggregate at exactly the same physical size, with no
hand-tuned tiling number anywhere. `js/tex.js` is the only file that knows.

### The sky lights the world, and it is measured

`tools/getsky.mjs` decodes the HDR's float pixels in Node and reads out, per
capture: where the sun actually is (luminance-weighted centroid of everything
above 60% of peak), what colour it is, how hard its shadows should be
(`punch`, the sun's peak against the median sky), the colour overhead, and the
colour of the horizon band. `data/sky/skies.json` stores all of it, the
renderer points its directional light along that vector and tints the fog with
that horizon, and the result is that the shadows agree with the clouds you can
see behind them. Each circuit gets the sky its race is actually run under.

### Where the detail budget goes

By DISTANCE, and by measurement rather than by feel. Monza runs **165 draw
calls and 1.16M triangles** a frame, which is the number to watch when the
22-car grid arrives.

- one mesh for every hoarding on the lap, one for every guard rail, one
  instanced mesh for every tyre in every tyre wall
- 9,000 people in the grandstands are two instanced meshes (bodies, heads)
- buildings within 340 m get windows, a ground floor and a cornice; beyond
  that they are tinted textured extrusions, which at 300 m is the same picture
  for a twentieth of the cost. Capped at 26,000 windows and spent nearest-first

## Gotchas paid for on the look pass

11. **`Builder.box`'s `ry` IS `Object3D.rotation.y`.** For a sim heading `h`
    pass `h`, not `-h` — the sim->three reflection is already inside the
    frame, and negating a second time mirrors the box about the track
    direction. Invisible on anything square, which is how it survived; on the
    14 m start gantry beam it put the whole span at the wrong angle and the
    banner meant to sit on its face ended up half buried inside it.

12. **Derive a normal from the winding when the orientation is the product of
    sign choices.** `Builder.quadN` exists for this. Asserting a normal that
    disagrees with the winding is what makes a surface look lit from inside:
    with `DoubleSide`, three negates the supplied normal for back-facing
    fragments, so a normal that already points the wrong way gets flipped to
    point the wrong way *again*.

13. **In three's x/z plane after the reflection, an UP-facing ring has a
    NEGATIVE shoelace area.** The opposite of the maths convention everyone
    reaches for. `quadUp`, `fan` and `prism` all measure and correct rather
    than trust, because this is the mistake that made the tarmac render black.

14. **A wire fence must be BLENDED, not alpha-tested.** A mesh is mostly
    holes, so once it is far enough away for mipmapping to average whole
    squares together the alpha lands either side of the threshold at random
    and the fence becomes a field of black specks hanging in the sky. It looks
    like a particle bug. Blending degrades into the grey haze a real catch
    fence actually becomes.

15. **Vertex colour caps at 1.0 if it goes through `THREE.Color`.**
    `getHex()` quantises to 0-255. The racing surface needs to go both ways
    around the scanned albedo — darker where the rubber is, *brighter* on the
    pale tarmac nobody drives on — so `Builder.pushColour` takes a float
    triple and puts it in the buffer unclamped.

16. **Measure a texture before trusting it.** The first tarmac (Asphalt033)
    has a colour-map standard deviation of 4/255 — it is almost flat grey,
    with all its detail in the normal map, and under soft sky light it reads
    as painted cardboard. Asphalt016 measures 15/255 at the same brightness.
    `magick <file> -colorspace Gray -format "%[fx:standard_deviation]" info:`

17. **`track.pit.side` does not reliably say which side the pit lane is on.**
    Monza says left and the lane is 17 m to the RIGHT; Baku says right and it
    is 7.5 m to the left. `js/pit.js` derives the side from where the surveyed
    points actually are. Trusting the flag puts every garage between the pit
    lane and the racing line.

18. **The pit complex and the circuit's own furniture fight over the same
    ground.** At Monza the right-hand barrier lands 4.7 m from the pit
    centreline, so guard rail and advertising were built standing in the pit
    lane; and 81 OSM buildings tagged `garage` sit exactly where the real pit
    block is, so the synthetic garages were built through a brick wall.
    `pitCorridor(track)` publishes both clearances and the barrier builder and
    the city builder both keep out.

19. **A canvas atlas that overflows fails SILENTLY and invisibly.** 4x8 is 32
    cells; Monza needs 35. The two that fell off the end indexed a row past
    the bottom of the canvas, sampled off the edge of the texture, and drew as
    a black rectangle wrapped across the start gantry. `Atlas.cell` refuses to
    overflow now, and warns.

20. **A surveyed colour is whatever somebody typed into OpenStreetMap.** At
    Baku somebody typed "navy blue". `THREE.Color` cannot parse it and
    complains once per building rather than throwing, so it fills the console
    and looks like a renderer fault. Validate, fall back to the palette.

21. **Yaw, roll and pitch cannot all live on one object.** three's default
    Euler order is XYZ, so the Z rotation is applied to the UN-yawed mesh:
    putting `rotation.y = heading` and `rotation.z = roll` on the same object
    makes roll come out as PITCH everywhere except heading zero. At 0.03 rad
    of body roll nobody notices, which is how it survived; at 18 degrees of
    banking it is obvious. The car is a yaw PARENT with a roll/pitch CHILD now.

22. **`car.gLat` is not cornering load.** It is `Fy/m - vx*r`, the rate of
    change of lateral velocity, which in a steady corner is approximately
    ZERO however hard the car is going round. Body roll driven off it meant
    the car never leaned in a long corner. The renderer uses `vx * r / g`.
    Measured over a hard F1 lap: `gLat` peaks at 4.17 with a mean of 0.11,
    while the real cornering acceleration peaks at 5.24 with a mean of 0.73 —
    at 199 km/h through a Monza corner `gLat` says 0.38 g and the car is
    pulling 3.43. **The HUD still prints `gLat`**, so the G LAT readout is
    wrong in the same way; that is in `js/main.js` and not fixed here.

## Zandvoort's banking

Drawn, as of the taper landing in the bake. `js/bank.js` is the model and it
is VISUAL ONLY — the simulation is 2D, reads `track.bank[i]` as a force, and
nothing in the geometry feeds back into it. If the two disagree, the geometry
is lying.

Two decisions carry it. It pivots at the **inside edge of the road**, not the
centreline: rotating about the centreline drops the inside of the corner 3.6 m
below the dunes around it, and real banking is built UP. And the camber falls
back to zero across the **outer run-off** on a smoothstep, so every barrier,
hoarding, tyre wall and marshal post stays at grade and nothing in
furniture.js had to move.

The direction of a banked run comes from the curvature **summed over the whole
run**, never per sample. At Arie Luyendyk the per-sample curvature reads
-0.0022, 0.0000, -0.0038 over three consecutive samples — sign noise, which
would put a fold down the middle of the corner.

Zandvoort's two banked corners are **Hugenholtzbocht** (turn 3, a left-hander,
banked high on the right) and **Arie Luyendykbocht** (turn 14, a right-hander,
banked high on the left). Not Tarzanbocht, which is the famous one and is not
banked in the survey.

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
node tools/drive.mjs [track] [laps] [class] [tier|all]   # the gate: lap, off-track, sideways
node tools/trace.mjs [track] [class] [tier]              # WHY: timeline + dense failure window
node tools/ceiling.mjs [track|all] [class]               # how much grip the controller can use
```
`tools/harness.mjs` is shared by all three so they can never drift apart and
start reporting on two different simulations.

And one for the graphics, which is the only reason anything in the look pass
is verified rather than asserted:

```
node tools/shot.mjs [track:car] [--photo s,lat,y,lead,aimLat] [--probe u,v]
                    [--q a=1&b=2] [--out name] [--lo]
```

It drives headless chromium over the DevTools protocol. Chromium's own
`--screenshot` flag is not enough: it fires on load, before the textures and
the sky have come off the network and before a single frame has been drawn.
This one **waits for the world to exist** (`render.js` publishes `window.__wdc`
when the circuit is built, and it polls for that rather than sleeping), reports
console errors and uncaught exceptions, parks the camera anywhere on the
circuit with `--photo`, and with `--probe` raycasts through a point on the
screen and names what is actually there. Six real bugs came out of it in one
afternoon. The first thing `--probe` was pointed at turned out to be an
engineer's monitor 1.3 m from the lens rather than the bug it looked like.

`?notex` runs the whole world on flat colours, which is both a setting for a
weak machine and the fastest way to tell a material problem from a geometry
one. A fresh clone that has not run `gettex.mjs` boots this way on its own.

## The difficulty ladder is measured, not chosen

Difficulty is a **grip fraction**, never a speed multiplier. Skill means using
more of the tyre, which slows the corners (`v ~ sqrt(mu)`) and leaves the
straights alone, because top speed is drag-limited. Scaling the finished speed
profile instead capped every bot's top speed 70 km/h under the drag limit.

`tools/ceiling.mjs` measures the highest grip this controller can drive cleanly
— strictly: under 1 s off track, under 1.5 s sideways, never a wheel past the
white line. HARD sits exactly there; the other tiers are fractions of it.

| circuit | F4 | F1 |
|---|---|---|
| Monza | 0.84 | 0.84 |
| Zandvoort | 0.84 | 0.88 |
| Suzuka | 0.88 | 0.92 |
| Monaco | 0.84 | **0.78** |
| Baku | 0.88 | **0.95** |

At the ceiling the bots run 7–15% off the ideal line and put nothing a wheel
wrong. **Above it they get SLOWER, not faster** — an unintuitive failure that
cost two rounds of hand-tuning before this sweep existed. Re-run it after any
physics change: if the car becomes easier to drive, those are free tenths.

Browser check without a human clicking anything:
`?auto=monza:f1` boots straight into a session, `?lo` disables shadows — both
used by the headless chromium screenshot pass. Chromium needs
`--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader` to get
WebGL in headless mode.

## Cache busting (do not remove)

`tools/stamp.mjs` rewrites the import map so every module is fetched as
`./js/foo.js?v=<epoch>`, and `.git/hooks/pre-commit` re-stamps on every commit.
Without it, a plain reload after a push serves the new `index.html` alongside
JS from a ~10 minute cache — new HTML running old modules, which presents as
"you didn't add the thing you said you added" and sends you hunting a bug that
does not exist.

Git hooks are not committed, so **after a fresh clone the hook has to be
reinstalled** or stamping silently stops happening:

```sh
printf '#!/bin/sh\nnode tools/stamp.mjs "$(date +%%s)" >/dev/null 2>&1 && git add index.html\nexit 0\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

## Not done yet

- **Racecraft is not built yet.** The driver can lap cleanly; it cannot yet
  attack, defend, or race anyone. `dirtyair/js/ai.js` has the attack/defend
  layer worth adapting (one committed move, take the inside for the braking
  zone, don't drive into someone alongside) and `dirtyair/js/race.js` has the
  session layer: grid, dirty-air/tow neighbour loop, collisions with damage and
  blame, pit lane (densify the OSM pit nodes first), track limits, DRS.
- **No grid yet.** Target is 21 opponents; nothing has been performance-tested
  at 22 cars, and `track.project()` searching 90 samples per car per substep is
  the obvious first thing that will need rate-limiting.
- No qualifying, no race, no damage-forces-a-pitstop. It is a hotlap.
- No sound at all.
- No wheel/force-feedback layer. The WebHID pedal pairing in
  `apex-racer/js/main.js` (lines ~432–487) is the thing to port when the DIY
  pedals exist — see `apex-racer/docs/RIG-BUILD.md`.
- No sound at all, still.
- The car is primitives — real dimensions (5.63 m long, 2.0 m wide, 3.6 m
  wheelbase), real DRS flap, suspension arms, a driver in a helmet, but
  primitives. `js/collide.js` accumulates `car.crush` per corner from real
  contact impulses and nothing reads it yet: deforming the bodywork from it
  costs no physics and is the obvious next thing.
