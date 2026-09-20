// audio.js — the car, out of the speakers.
//
// This is Adam's idea, arrived at the long way round: a loop, played back at a
// rate. Two attempts at synthesising the loop sounded, in his words, like
// garbage, and the reason was measurable rather than a matter of taste —
// speeding a sample up moves its TIMBRE, not just its pitch. Reaching an F1's
// firing rate from a 0.2 s drum loop takes 37x, which puts a 210 Hz drum body
// at 7,900 Hz and leaves hiss. A real engine recording is already at engine
// frequency, so it moves about an octave and keeps its character.
//
// So the loops are CC0 recordings from data/audio/ (see SOURCE.md), and this
// file only decides how fast to play them and how loud.
//
// TWO AXES for the engine, and getting them the wrong way round is the classic
// mistake:
//   RATE  follows RPM.      What note the engine is at.
//   LOAD  follows throttle. How hard it is working: level and brightness.
// Driving rate from throttle means blipping in the pit lane screams at max
// pitch while stationary, and lifting at 250 km/h drops to idle while you are
// still doing 250. Both are backwards, and both are what this avoids.
//
// AND A THIRD AXIS THE ENGINE CANNOT CARRY: SPEED.
//
// Adam, after driving it: "make gear 5 feel like gear 3". He was right and the
// cause was one line. The engine note is rpm and throttle only, and F1 gears
// reach the limiter at [85,115,146,176,208,240,280,321] km/h — so third and
// fifth are both 15,000 rpm at their limiter and therefore BYTE FOR BYTE the
// same sound, sixty km/h apart. To the audio, gear 5 was gear 3.
//
// Road and wind fix that: they rise with speed and ignore revs entirely.
//
// TYRES are on a fourth axis, slip, expressed as a fraction of the car's own
// limit via physics.peakSlip — so "starts talking at 70%" means 70% of the
// grip this car actually has, not 70% of a number someone picked.
//
// Imports nothing from the renderer or the simulation. main.js hands it
// numbers; it never reaches back.

// The loop files. REF is the engine speed the RATE is normalised against, and
// it is NOT measured from the file: tools/enginecheck.mjs tries and its
// fundamental detector is not trustworthy on this material — it read 25 Hz to
// 1225 Hz across six recordings of one engine. See data/audio/SOURCE.md.
//
// 8300 was chosen by ear on engine.html. 11000 got into sound.html by mistake
// when I rebuilt the model there from this file's COMMENT instead of its code,
// and Adam's verdict on the mistake was "THE ENGINE IS GOLLDDDDD". A lower REF
// is a lower rate is a deeper engine, and he prefers the deeper one. So the
// default is now his, and it stays overridable because it was always a guess.
const FILES = ['loop_0', 'loop_1_0', 'loop_2_0', 'loop_3_0', 'loop_4_0', 'loop_5_0'];
const REF_RPM = 11000;
const RATE_MIN = 0.35, RATE_MAX = 2.60;

// Everything the sound bench can tune. sound.html writes these to localStorage
// under the same origin, so tuning there changes the game without a rebuild —
// and whatever is left here is what ships for anyone who never opens it.
// Bumped when a DEFAULT changes in a way a saved mix would otherwise mask: a
// stored roadLvl of 0.45 would keep the wind on forever, and nobody would
// guess the fix was to clear their browser storage.
export const MIX_KEY = 'wdc.sound.v2';

export const MIX = {
  ref: REF_RPM,
  engCans: 1.00, engRoom: 1.00,
  // WEIGHT. Adam: "we need a deeper bass heavier louder engine bro".
  //
  //   sub    a second copy of the same loop an OCTAVE DOWN, underneath. This
  //          is the one that matters. A single sample has whatever body the
  //          recording had; a half-rate copy under it adds an octave of
  //          fundamental the original never contained, which is the whole
  //          difference between a whine and a engine you feel. Free, because
  //          it is the same buffer.
  //   bass   a low shelf, for weight the sample simply does not have.
  //   drive  compression. Loud is not gain: gain clips. A compressor pulls
  //          the peaks down so the BODY can come up, which reads as heavier
  //          and louder at the same time.
  //   shake  THE ONE HE MEANS. A parallel copy of the engine through a steep
  //          lowpass, mixed back into the main output. On the bench what shook
  //          his chair was the engine on the ROOM bus, where the chassis
  //          filter strips everything above 600 Hz so every bit of energy goes
  //          into the low end. In the game that bus is off unless a second
  //          device is chosen, so the same energy was spread across the whole
  //          spectrum and his speaker spent it on mids. This is that filter
  //          back, as a BLEND rather than a separate output - resonant at the
  //          cutoff, because a little Q at 110 Hz is the difference between
  //          bass and a thump.
  sub: 0.85, subCut: 460, bass: 12, bassAt: 120, drive: 0.55, master: 0.78,
  shake: 0.80, shakeAt: 110, shakeQ: 3.5,
  // BOTH OFF BY DEFAULT. Adam, after one drive: "i only hear wind, i only want
  // engine". The road layer is still the tyre sample detuned and lowpassed, a
  // placeholder meant to test whether SPEED belongs in the mix — and it does,
  // that part worked. But a placeholder drone at 300 km/h beats a varying
  // engine for attention every time, and shipping a stand-in at 45% was my
  // error, not his taste.
  //
  // They stay in the code because the axes are right. They come back when
  // there is a real road loop, and he can raise either from sound.html
  // whenever he wants to hear where they are.
  tyreLvl: 0.00, thresh: 0.18, tyreCans: 1.00, tyreRoom: 0.15,
  roadLvl: 0.00, roadCut: 900, roadCans: 1.00, roadRoom: 0.70,
  gustD: 0.45, gustR: 0.70,
  muffle: 600,
  roomSink: null,
};

function savedMix() {
  try {
    const raw = localStorage.getItem(MIX_KEY);
    if (!raw) return { ...MIX };
    return { ...MIX, ...JSON.parse(raw) };
  } catch { return { ...MIX }; }      // private window, blocked storage, bad JSON
}

export class Engine {
  constructor(opts = {}) {
    this.ok = false;
    this.ctx = null;
    this.src = null;
    this.file = FILES[Math.max(0, Math.min(FILES.length - 1, (opts.pick ?? 1) - 1))];
    this.mix = savedMix();
    this.ref = opts.ref || this.mix.ref || REF_RPM;
    this.master = opts.volume ?? this.mix.master ?? 0.5;
    this.muted = false;
    this.t0 = 0;
  }

  // MUST be called from a real user gesture — browsers will not let an
  // AudioContext start otherwise, and one that starts suspended never makes a
  // sound and never reports an error either.
  async start(baseUrl = './') {
    if (this.ctx) return this.ok;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.t0 = this.ctx.currentTime;

      // TWO BUSES. CANS is everything; ROOM is what goes to a speaker sitting
      // against the car — Adam taped his under the seat and reported it
      // "shakes a lil and muffles it like its comiing from the engine". That
      // muffling was an accident of a small driver pointing at the floor; here
      // it is deliberate, because it is the whole trick of a bass shaker.
      //
      // ROOM stays SILENT unless a separate output device has been chosen. If
      // both buses land on the same speakers, the filtered copy just adds
      // boom to the unfiltered one, which is worse than not having it.
      this.cans = this.ctx.createGain();
      this.cans.connect(this.ctx.destination);
      this.room = this.ctx.createGain();
      this.room.gain.value = this.mix.roomSink ? 1 : 0;
      this.roomLP = this.ctx.createBiquadFilter();
      this.roomLP.type = 'lowpass';
      this.roomLP.frequency.value = this.mix.muffle;
      this.roomLP.Q.value = 0.7;
      this.room.connect(this.roomLP);
      this.roomLP.connect(this.ctx.destination);
      if (this.mix.roomSink && this.ctx.setSinkId) {
        this.ctx.setSinkId(this.mix.roomSink).catch(() => { /* device went away */ });
      }

      this.engine = await this._layer(baseUrl, this.file, 'lowpass');
      // The weight chain sits between the engine and its sends, so tyres and
      // road are not dragged through a compressor tuned for an engine.
      this.shelf = this.ctx.createBiquadFilter();
      this.shelf.type = 'lowshelf';
      this.shelf.frequency.value = this.mix.bassAt;
      this.shelf.gain.value = this.mix.bass;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.ratio.value = 4; this.comp.knee.value = 12;
      this.comp.attack.value = 0.008; this.comp.release.value = 0.14;
      this.engine.gain.disconnect();
      this.engine.gain.connect(this.shelf);
      this.shelf.connect(this.comp);
      this.comp.connect(this.engine.toCans);
      this.comp.connect(this.engine.toRoom);

      // THE OCTAVE. Same buffer, half the rate, its own lowpass so only the
      // body of it comes through and it never competes with the note on top.
      this.sub = await this._layer(baseUrl, this.file, 'lowpass');
      this.sub.gain.disconnect();
      this.sub.gain.connect(this.shelf);

      // THE SHAKE. Taken from the shelf - so it carries the octave as well as
      // the note - through a steep resonant lowpass, and added back in
      // PARALLEL rather than in series. In series it would just be a duller
      // engine; in parallel it is the same engine with a chest under it.
      this.shakeLP = this.ctx.createBiquadFilter();
      this.shakeLP.type = 'lowpass';
      this.shakeLP.frequency.value = this.mix.shakeAt;
      this.shakeLP.Q.value = this.mix.shakeQ;
      this.shakeGain = this.ctx.createGain();
      this.shakeGain.gain.value = 0;
      this.shelf.connect(this.shakeLP);
      this.shakeLP.connect(this.shakeGain);
      this.shakeGain.connect(this.cans);
      this.shakeGain.connect(this.room);
      // Tyres and road are OPTIONAL: a missing file must cost the engine
      // nothing, because the engine is the one sound this game cannot be
      // played without.
      this.tyre = await this._layer(baseUrl, 'tyre_squeal', 'lowpass').catch(() => null);
      this.road = await this._layer(baseUrl, 'tyre_squeal', 'lowpass').catch(() => null);
      if (this.road) this.road.src.playbackRate.value = 0.55;

      // main.js reads these for the __wdc telemetry block; they mean the
      // ENGINE, as they always did.
      this.src = this.engine.src;
      this.gain = this.engine.gain;
      this.ok = true;
      return true;
    } catch (e) {
      this.err = e.message;
      return false;
    }
  }

  async _layer(baseUrl, name, filter) {
    const r = await fetch(`${baseUrl}data/audio/${name}.wav`);
    if (!r.ok) throw new Error(`${name}.wav: HTTP ${r.status}`);
    const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = this.ctx.createBiquadFilter(); filt.type = filter;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    const toCans = this.ctx.createGain(), toRoom = this.ctx.createGain();
    src.connect(filt); filt.connect(gain);
    gain.connect(toCans); gain.connect(toRoom);
    toCans.connect(this.cans); toRoom.connect(this.room);
    src.start();
    return { src, filt, gain, toCans, toRoom };
  }

  /**
   * `rpm` and `throttle` are the engine. Everything else is optional and
   * silent when absent, so an older caller keeps working unchanged.
   *   off    1 when the wheels are off the tarmac
   *   speed  metres per second (car.speed)
   *   slip   the larger of |slipF|,|slipR| in radians
   *   peak   physics.peakSlip(spec) — the slip angle this car peaks at
   */
  update(rpm, throttle, { off = 0, speed = 0, slip = 0, peak = 0 } = {}) {
    if (!this.ok || this.muted) { if (this.gain) this.gain.gain.value = 0; return; }
    const m = this.mix;

    // ---- engine: rate from rpm, load from throttle --------------------------
    const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, rpm / this.ref));
    this.engine.src.playbackRate.value = rate;
    const t = Math.max(0, Math.min(1, throttle));
    this.engine.filt.frequency.value = 500 + 7500 * Math.pow(t, 1.3);
    // Level rises with load but never to zero: an engine on the overrun is
    // still an engine, and a car that goes silent mid-corner sounds broken.
    const load = (0.30 + 0.70 * t) * (1 - 0.25 * off);
    this.engine.gain.gain.value = this.master * load;
    this.engine.toCans.gain.value = m.engCans;
    this.engine.toRoom.gain.value = m.engRoom;

    // The octave below, tracking the same note so it is weight and not a
    // second engine. Its own filter keeps it to body only.
    if (this.sub) {
      this.sub.src.playbackRate.value = rate * 0.5;
      this.sub.filt.frequency.value = m.subCut;
      this.sub.gain.gain.value = this.master * load * m.sub;
    }
    if (this.shelf) {
      this.shelf.frequency.value = m.bassAt;
      this.shelf.gain.value = m.bass;
    }
    if (this.shakeGain) {
      this.shakeLP.frequency.value = m.shakeAt;
      this.shakeLP.Q.value = m.shakeQ;
      // Follows the load, so it breathes with the throttle instead of
      // rumbling flat all lap - which is the difference between a car and a
      // fridge.
      this.shakeGain.gain.value = this.master * load * m.shake;
    }
    if (this.comp) {
      // More drive is a lower threshold and more makeup: the peaks come down
      // and the body comes up, which is what "heavier" and "louder" both are.
      this.comp.threshold.value = -6 - 30 * m.drive;
      this.cans.gain.value = 1 + 1.1 * m.drive;
      this.room.gain.value = (this.mix.roomSink ? 1 : 0) * (1 + 1.1 * m.drive);
    }

    const kmh = speed * 3.6;

    // ---- tyres: a fraction of THIS car's limit, silent below a threshold ----
    if (this.tyre) {
      // peakSlip is where the tyre makes its most force. Past 1.0 it is
      // sliding, which is the part you can hear.
      const frac = peak > 0 ? Math.min(1.6, Math.abs(slip) / peak) : 0;
      const over = Math.max(0, frac - m.thresh) / Math.max(0.01, 1 - m.thresh);
      const sp = Math.min(1, kmh / 90);     // scrubbing at walking pace is nothing
      this.tyre.gain.gain.value = this.master * m.tyreLvl * Math.pow(over, 1.4) * sp;
      this.tyre.src.playbackRate.value = 0.72 + 0.55 * Math.min(1, over);
      this.tyre.filt.frequency.value = 700 + 9000 * Math.pow(Math.min(1, over), 0.8);
      this.tyre.toCans.gain.value = m.tyreCans;
      this.tyre.toRoom.gain.value = m.tyreRoom;
    }

    // ---- road and wind: speed only, and it BREATHES -------------------------
    if (this.road) {
      const sn = Math.min(1, kmh / 321);
      // Three waves at rates sharing no common multiple, so it never settles
      // into a rhythm you can hear as a machine. Same trick js/build/look.js
      // uses to stop a whole forest swaying in time.
      const gt = (this.ctx.currentTime - this.t0) * m.gustR;
      const gust = 0.55 * Math.sin(gt * 0.61) + 0.30 * Math.sin(gt * 1.37 + 1.1)
                 + 0.15 * Math.sin(gt * 2.93 + 2.7);
      // The gust moves the TONE as well as the level. A gust that only gets
      // louder is a volume knob; a real one changes character as it hits.
      const amp = Math.max(0, 1 + m.gustD * gust * 0.8);
      const tone = 1 + m.gustD * gust * 0.45;
      this.road.gain.gain.value = this.master * m.roadLvl * Math.pow(sn, 1.7) * amp;
      this.road.src.playbackRate.value = 0.45 + 0.5 * sn;
      this.road.filt.frequency.value = Math.max(80, m.roadCut * tone);
      this.road.toCans.gain.value = m.roadCans;
      this.road.toRoom.gain.value = m.roadRoom;
    }

    if (this.roomLP) this.roomLP.frequency.value = m.muffle;
  }

  /** Re-read the bench's settings without restarting the context. */
  reloadMix() { this.mix = savedMix(); this.ref = this.mix.ref || REF_RPM; return this.mix; }

  setVolume(v) { this.master = Math.max(0, Math.min(1, v)); }
  toggleMute() { this.muted = !this.muted; return this.muted; }
  stop() { try { this.src?.stop(); this.ctx?.close(); } catch { /* going away anyway */ } this.ok = false; }
}

export const ENGINE_FILES = FILES;
