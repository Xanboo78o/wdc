# Where these skies came from

Every `.jpg` here is a tone-mapped 2048x1024 equirectangular crop of a
**CC0 1.0** HDRI from **Poly Haven** — https://polyhaven.com/hdris. Public
domain, no attribution required, safe on public GitHub Pages.

| file | Poly Haven HDRI | used for |
|---|---|---|
| `clear.jpg` | [kloofendal_43d_clear_puresky](https://polyhaven.com/a/kloofendal_43d_clear_puresky) | dry, high sun, hard shadows |
| `cloud.jpg` | [kloofendal_48d_partly_cloudy_puresky](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | broken cloud, the default racing sky |
| `overcast.jpg` | [overcast_soil_puresky](https://polyhaven.com/a/overcast_soil_puresky) | flat North Sea light, almost no shadow |

`skies.json` is the part that matters. For each sky it stores the **measured**
sun direction and colour, the overhead sky colour and the horizon colour, all
read out of the original HDR's float pixels by `tools/getsky.mjs`. The
renderer points its directional light along that vector and tints the fog with
that horizon, so the shadows agree with the clouds you can see and the haze
agrees with the sky behind it.

Refetch with `node tools/getsky.mjs [name|all] [--force]`.
