# Engine loops

**racing car engine sound loops** — https://opengameart.org/content/racing-car-engine-sound-loops

**Licence: CC0** (public domain dedication). No attribution required, none of
the files may be re-licensed by us. Downloaded, not generated — see
[[stock-assets-not-generated]]: Adam's rule for this project is "dont make your
own" noises, source CC0.

Six mono 16-bit 44.1 kHz loops, 0.62–0.86 s each:

    loop_0.wav  loop_1_0.wav  loop_2_0.wav
    loop_3_0.wav  loop_4_0.wav  loop_5_0.wav

Re-fetch with:

    for f in loop_0 loop_1_0 loop_2_0 loop_3_0 loop_4_0 loop_5_0; do
      curl -sL -o data/audio/$f.wav \
        "https://opengameart.org/sites/default/files/$f.wav"
    done

## A warning about tools/enginecheck.mjs

It reports each loop's fundamental, and **on these files that number is not
trustworthy**. Autocorrelation on material this harmonically dense keeps
locking onto harmonics: the first version returned exactly 1225.0 Hz for five
different recordings — identical to 0.1 Hz, which is the giveaway, and 24,500
rpm for a V6, which no engine does. A sub-harmonic correction improved it and
did not fix it: the six files now read anywhere from 25 Hz to 1225 Hz, a
spread of five and a half octaves for what is plainly the same engine.

So: the LOOP CLOSURE column is sound and is a real defect check. The
fundamental and the rpm columns are a hypothesis, not a measurement, and
nothing should be built on them until the detector is fixed or replaced.

Which loop to use is Adam's call from engine.html, by ear. There is no number
for "sounds like the right engine" and neither of the Claudes on this project
can hear one.

# Tyres

**Car tire squeal skid loop** — https://opengameart.org/content/car-tire-squeal-skid-loop

**Licence: CC-BY 3.0**, NOT CC0 — the only file here that is not. Attribution is
required and is the point of this section:

> "Car tire squeal skid loop" by **Tom Haigh** (audible-edge), originally from
> Freesound.org, submitted to OpenGameArt by qubodup. CC-BY 3.0.

    tyre_squeal.wav   3.00 s, 44.1 kHz, 16-bit mono, 265 KB

The download is 24-bit 96 kHz mono (864 KB), which is studio format and three
times the size for nothing a browser can use. Converted down to match the
engine loops:

    curl -sL -o /tmp/t.wav https://opengameart.org/sites/default/files/tires_squal_loop.wav
    ffmpeg -i /tmp/t.wav -ar 44100 -sample_fmt s16 -ac 1 data/audio/tyre_squeal.wav

If the CC-BY attribution is ever unwanted, this file is the one to replace —
everything else here is public domain and carries no obligation.
