# Where the plants came from

Every image in this directory is **CC0 1.0 Universal** (public domain) from
**ambientCG** — https://ambientcg.com — like everything in `data/tex/`. They
are photoscans: real blades, real leaves, real bark. Nothing here is generated.

Refetch with `node tools/getflora.mjs [name|all] [--force]`.

| files | ambientCG asset | used for |
|---|---|---|
| `grass-*` | [Foliage001](https://ambientcg.com/view?id=Foliage001) | nine real grass blades — the near-field lawn |
| `seed-*` | [Foliage002](https://ambientcg.com/view?id=Foliage002) | dried seed heads, so the verge is not one plant repeated |
| `needle-*` | [LeafSet019](https://ambientcg.com/view?id=LeafSet019) | fir sprigs — the conifer canopy, a sprig per card |
| `leaf-*` | [LeafSet024](https://ambientcg.com/view?id=LeafSet024) | broadleaf leaves, built into branch cards at load |
| `bark-*` | [Bark012](https://ambientcg.com/view?id=Bark012) | the trunks — deep vertical furrows, warm brown |
| `dirt-*` | [Ground048](https://ambientcg.com/view?id=Ground048) | bare earth on a cut face — dark, loose, not sand |
| `rock-*` | [Rock030](https://ambientcg.com/view?id=Rock030) | anything too steep to hold soil — layered, brown-grey |

A cut-out set is two files and a measurement:

- `<name>-c.jpg` — colour, with the transparent area flooded with the mean
  colour of the plant so the mip chain cannot bleed a dark halo into it
- `<name>-a.png` — opacity; PNG and 4-bit, because JPEG rings around a hard
  alpha edge and an alpha-tested leaf turns that ringing into a torn silhouette
- `atlas.json` — the UV rectangle of every cut-out, found by connected
  components on the opacity map rather than assumed to be an even grid

A tiling material (`bark`) is the same three files as `data/tex/`: colour,
GL normal, and AO/roughness/metalness packed into one RGB image.
