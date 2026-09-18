# Where these textures came from

Every map in this directory is **CC0 1.0 Universal** (public domain) from
**ambientCG** — https://ambientcg.com. No attribution is required and
commercial use is permitted, which is what makes them safe to ship on public
GitHub Pages. They are photoscanned, not generated.

Refetch or change any of them with `node tools/gettex.mjs [name|all] [--force]`.

| file | ambientCG asset | used for |
|---|---|---|
| `tarmac-*.jpg` | [Asphalt016](https://ambientcg.com/view?id=Asphalt016) | the racing surface — dark asphalt with visible aggregate |
| `apron-*.jpg` | [Asphalt031](https://ambientcg.com/view?id=Asphalt031) | lighter asphalt: modern run-off and the pit apron |
| `gravel-*.jpg` | [Gravel023](https://ambientcg.com/view?id=Gravel023) | Monza/Suzuka gravel traps — light pebbles, not dirt |
| `grass-*.jpg` | [Grass005](https://ambientcg.com/view?id=Grass005) | mown trackside grass, not meadow |
| `sand-*.jpg` | [Ground093A](https://ambientcg.com/view?id=Ground093A) | Zandvoort dunes |
| `concrete-*.jpg` | [Concrete048](https://ambientcg.com/view?id=Concrete048) | barriers, garage walls, pit apron |
| `brick-*.jpg` | [Bricks101](https://ambientcg.com/view?id=Bricks101) | north-European facades (Zandvoort, Monza town) |
| `plaster-*.jpg` | [PaintedPlaster017](https://ambientcg.com/view?id=PaintedPlaster017) | painted render — Monaco, Baku; takes a tint well |
| `metal-*.jpg` | [MetalPlates014](https://ambientcg.com/view?id=MetalPlates014) | armco, garage doors, debris fence posts |
| `fence-*.jpg` | [Fence003](https://ambientcg.com/view?id=Fence003) | the debris fence — wire mesh, with a real opacity map |

Each material is three files, not six:

- `-c.jpg` — colour / albedo, sRGB
- `-n.jpg` — tangent-space normal, **GL convention** (green up)
- `-orm.jpg` — AO in red, roughness in green, metalness in blue, linear
- `-a.jpg` — opacity, where the material has holes in it (the debris fence)

That last one is the glTF ORM packing. three.js reads it natively: point
`aoMap`, `roughnessMap` and `metalnessMap` at the same texture and each
takes its own channel.
