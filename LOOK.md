# How WDC should look

Twenty decisions, 2026-09-20. Adam answered all of them; this file is the
record so nobody has to re-derive them later, and so a future change that
contradicts one of these is an argument rather than an accident.

The one sentence version: **you are a person in a helmet, in a real place, at
the real time, in the real weather.** Not a camera, not a film. Every decision
below falls out of that.

---

## The direction

**1. Photoreal, not stylised.** Adam picked "raw simulator" and then corrected
the question: *"no like literally real like, lotsa bloom, sun rays, sun
blinding, allat"*. That is not "no post-processing" — it is **physically real
light**. The option I offered was the wrong axis. Realism here means modelling
how light actually behaves, not removing effects.

**2. The camera is an EYE, not a lens.** You are in a helmet. So:

| yes | no |
|---|---|
| pupil adaptation | lens flare |
| sun dazzle and afterglow | lens dirt |
| god rays | chromatic aberration |
| visor beading (a visor is real) | anamorphic streaks |

Anything that only happens inside a camera body is out. This is the rule that
settles most future arguments.

**3. Open-world sandbox**, not a circuit collection — *"like race island in
trailmakers"*. Everything below is built for driving around for an hour in
every direction, not for a fixed camera on a fixed track.

---

## Light

**4. Sun dazzle: properly blinding.** Low sun washes the screen toward white
and you lose the braking point for about a second. It is a real hazard you
learn to drive around, and it will cost laptime. That is the point.

**5. Eye adaptation at human speed.** ~1.2 s bright→dark, ~0.4 s dark→bright,
because real eyes recover from dark faster than from glare. Makes tunnels,
grandstand shadow and dusk into things you *feel*.

**6. God rays through geometry**, not just a radial smear off the sun disc.
Shafts break through the Monza tree avenue and under grandstand roofs. Best
effect where the world already has something to cut the light with.

**7. Bloom with a high threshold.** Only genuinely bright things glow — sun,
sky, polished metal, wet paint — but when it fires it fires hard. Not a soft
glow over everything.

---

## Colour

**8. Time of day drives the grade.** Dawn blue and low contrast, noon neutral
and hard-shadowed, dusk gold and long.

**9. Biome modulates it.** *"this plus the biome when ur driving"* — park,
city, desert and coast each shift the grade on top of the time of day. Two
inputs, not one.

---

## Air and distance

**10. Real aerial perspective.** Distance goes blue and pale, and the haze
warms and thickens as the sun drops. This is the single biggest thing that
makes an open world feel big.

**11. Nearsighted far blur, starting close.** Adam: *"things get blurry at
distance, like the pixels find the average color of each area and blend
together, like if u were nearsighted"*. Sharp to ~150 m, soft fast after
that. Deliberately stronger than realistic — he chose the dreamy version, and
it hides distant geometry for free.

---

## Time and weather

**12. Real time, real weather.** *"if its 2:00pm sunny? sunny ingame, sun is
where it should be. 11:00 am rainy? it rains and its SLICK"*. Sun position is
pure maths from date, time and latitude — no API. Weather comes from a free
API that needs no key. There is a manual override, and it is deliberately
tedious to reach, because the default is reality.

**13. YOUR local sky, everywhere.** Not the circuit's. 2pm sunny for Adam is
2pm sunny at Monza, Baku and Suzuka alike. Chosen over correctness so the
game is always playable.

**14. But the in-world biome bends it.** *"if youre in the dry areas, the
rains gonna be lighter, if u travel far enoguh, the rain will be gone."*
Real weather is the base; where you are in the world modulates it. Weather
becomes something you can **drive out of**.

**15. Nudge dull weather prettier.** Real conditions, read flatteringly:
overcast becomes moody rather than flat. Honest data, generous interpretation.

**16. Rain: visor beads AND car spray.** Droplets land, sit, and tear off
sideways as speed rises, so the visor clears on the straights and blurs under
braking. Plus the wall of spray off the car ahead, which is the genuinely
frightening part of racing in the wet.

---

## Motion and feel

**17. Per-object motion blur only.** Wheels and trackside smear; your car and
the road stay sharp. Speed without nausea.

**18. FOV opens with speed, plus edge warp.** Widens as you accelerate,
tightens under braking, and the screen edges stretch past ~250 km/h. Adam
chose the more dramatic of the two.

**19. Impacts are physical.** Camera shake scaled by the real impact force,
and the head keeps moving after the car stops — because a neck does. No
flashes, no filters. An eye would do exactly this.

---

## Technical

**20. TAA**, because it gates the rest: it makes per-object blur and cheap AO
affordable, and it is the only thing that stops catch fencing and tree cards
crawling. Cost is slight softness, which the far blur is doing on purpose
anyway. Plus screen-space **ambient occlusion**, so the car sits *in* the
scene rather than on it.

**Quality is detected, not chosen.** Ask the GPU what it is, measure real
frame time, then decide. Everything on for the GeForce, stripped back on the
Intel chip, no menu unless you go looking. Measured 2026-09-20: Monza at
112 ms a frame on the UHD 620 and 16.6 ms on the GTX 1060, and 4× the pixels
costs only +33% on the GeForce — **per-pixel work is nearly free on that card,
geometry is not.** Which is exactly why this list is almost entirely
per-pixel.

---

## Build order

Adam's call: **the light first** — adaptation, sun dazzle, god rays, physical
bloom. Biggest jump in how real it looks, lowest cost, and it is the
foundation the grade and the weather both sit on.

Then real time and weather, then air and distance, with TAA and AO going in
underneath whenever they are needed to make the rest affordable.

---

## Amendment, 2026-09-23: the graphics upgrade

Adam's brief for the next pass, answered in three rounds. Where it touches the
twenty decisions above, the amendment rules.

**The house style.** *"Mariokart, but shaders BUTTT more realistic, like ACC
but more smooth, and less harsh."* Asked whether that overturns decision 1, he
chose to **blend the two**: materials and surfaces go soft, warm and smooth
(Mario Kart), the world stays a real place (ACC), and a low sun may still
blind you as a racing hazard (decision 4 stands). Bloom (decision 7) softens
from "fires hard" to generous but gentle. All three Mario Kart qualities count
equally — soft light with nothing pitch black, rich colour, clean edges — and
**sun rays** above all (decision 6, now a headline item).

**Budget.** 50 fps minimum while driving with the wheel.

**Scope.** Everything: the race game and the builder share one look.

**Worst offenders today:** the trackside world and the car.

**The car:** better paint (clear coat, soft reflections, rim light), better
shape (halo, sidepods, wing elements, suspension, lettered tyres), liveries,
and alive details (spinning/steering wheels, glowing discs, rain light,
sparks). **And damage, especially damage:** parts fly off as physics debris,
bodywork deforms where struck, scuffs and scrapes build up over a race.
Standing bug in his words: *"crashing can remove your front wing, but when it
does, the hinges connect to nothing... and it also looks super goofy without
it."* A lost wing must leave a broken stub and real mounting points, not
floating hinges and a bald nose.

**Trackside:** richer buildings, the builder's flora and props brought into
the race circuits, barrier dressing (boards, tyre walls, catch fencing, worn
Armco).

**The forest — Adam's own recipe, verbatim intent.** Front to back:
1. Three rows of real trees, each randomly resized and spun.
2. Between the 2nd and 3rd row, a **short banner** of flora — paper thin, flat 2D.
3. A **taller banner** behind the 3rd row.
4. Then three layers of **cut-out trees that slowly rotate to face the
   player**, a little taller than the real rows.
5. Then a big **super-dark green backdrop**, near BLACK, that still blends in.

The law of the whole stack: **the deeper it goes, the darker it gets.**

**Build order:** the forest first.
