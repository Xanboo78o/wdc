# Where the heights came from

**NASA SRTM at 30 m**, read through [opentopodata.org](https://www.opentopodata.org/)
— free, no key required, and it reports which dataset answered each point so
the provenance stays with the numbers. SRTM is public domain.

Refetch with `node tools/getelev.mjs [track|all] [--force]`.

Each file holds two things, because they answer different questions:

- `s` — the height of the racing line at every centreline sample, taken every
  20 m and smoothed. A 30 m grid is far too coarse to carry a car over a crest;
  you need the profile ALONG the road.
- `grid` — a 32x32 grid over the whole world box, which is what the ground,
  the buildings and the trees sit on. A profile along the road says nothing
  about where to put a building two hundred metres away.

Both are **metres relative to the mean height of the racing line**, so every
circuit sits around y = 0 and nothing else in the renderer had to move.

## This is a rendering input only

`js/physics.js` is two-dimensional. It has no elevation and no gravity
component along a slope, so a downhill braking zone is not simulated as one.
Nothing here feeds back into the simulation, exactly as with banking. If the
picture and the physics disagree, the picture is the one that is lying.
