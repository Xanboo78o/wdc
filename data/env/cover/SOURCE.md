# Ground cover

**ESA WorldCover 10 m 2021 v200** — © ESA WorldCover project 2021 / Contains
modified Copernicus Sentinel data (2021) processed by the ESA WorldCover
consortium. Licence: CC-BY 4.0. https://esa-worldcover.org

A 10 m land-cover classification from Sentinel-1 and Sentinel-2, read straight
from the public Cloud-Optimised GeoTIFFs (only the tiles under each circuit).
Re-fetch with `node tools/getcover.mjs <track|all>`.

Each file is a raster in the circuit's own sim coordinates (the same projection
as data/env and data/elev): `x0,y0` is the south-west corner, `cell` metres,
`nx` by `ny`, rows south to north, classes run-length encoded as
`class,count;...`. 10 = tree cover, 20 shrub, 30 grass, 40 crop, 50 built,
60 bare, 80 water, 90 wetland.
