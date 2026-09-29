# Where the heights came from

A **bare-earth survey (DTM)** from the national mapping agency wherever one
answers a public query, because SRTM is radar and reads the TOP of trees and
buildings — Monza came out 20 m "hilly" off the canopy of its park against a
real 12.8 m. Each file's `dataset`/`source`/`licence` fields say which:

| circuit | survey | licence |
|---|---|---|
| monza | Regione Lombardia DTM 5x5 (ed. 2015), bare earth | CC-BY 4.0 |
| suzuka | GSI Japan DEM5A/10B, airborne laser | GSI terms, attribution |
| zandvoort | AHN DTM 0.5 m lidar via PDOK | CC0 |
| monaco | IGN RGE ALTI via Géoplateforme | Licence Ouverte 2.0 |
| others | **NASA SRTM at 30 m**, via [opentopodata.org](https://www.opentopodata.org/) | public domain |

Raw answers are cached per point in `raw/`, so a re-bake queries nobody.

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
