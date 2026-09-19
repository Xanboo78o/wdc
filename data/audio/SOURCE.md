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
