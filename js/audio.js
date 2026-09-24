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
import { SynthEngine } from './enginesynth.js';

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

// THE INTENSE PASS (Adam, 2026-09-23: "sound mixing needs WAYYYY MORE, engines
// need to be INTENSE, going off track i wanna hear the dirt and gravel.
// Crashes? Traumatizing."). Kept OUT of MIX on purpose: a mix saved from
// sound.html before this existed would otherwise pin every one of these at
// whatever the old bench stored, and "I asked for more and nothing changed"
// would be the result.
//
// Every sound here is a RECORDING (data/audio/SOURCE.md) — Stunt Rally's
// set: VDrift's gravel and grass loops and bump thuds, Halleck's metal crash
// hits, dirt-spray hits, a roll-cage hit and a metal scrape.
export const FX = {
  // Adam, round two: "i want engine the LOUDEST and most intense... watching
  // a car race is LOUD, its GRITTY, not smooth and quiet lil softie".
  engBoost: 2.2,    // engine level on top of the saved mix
  grit: 1.3,        // parallel distortion: the rasp a clean loop has not got
  gritAt: 2400,     // centre of the rasp band
  bark: 0.9,        // a second, lower distortion band: the bark under the rasp
  barkAt: 850,
  tyreMin: 0.22,    // squeal is on, but under the engine (Adam: "wheel losing grip ... too loud")
  gravel: 1.25, grass: 1.05, kerb: 0.9, stones: 0.8,
  // Adam: "the engine should be louder than crashes". It was 1.6 against an
  // engine that never got loud enough; the engine is the lead now.
  crash: 0.22,      // impact level (Adam, twice: crashes too loud)
  synth: 1.7,       // the emulated engine (js/enginesynth.js), the lead instrument
  scrape: 1.4,      // bodywork along a wall
  concuss: 0,       // the big-hit muffle. OFF: Adam, first listen: "very muddy"
  trim: 0.72,       // into the tanh clip (0.95 made the emulated engine harsh): hotter = more saturation = grittier. It
                    // bends peaks, it cannot exceed full scale (0.96 ceiling).
};
const CRASH_FILES = ['crash_01', 'crash_02', 'crash_03', 'crash_04', 'crash_05', 'crash_06',
  'crash_07', 'crash_08', 'crash_09', 'crash_10', 'crash_11'];

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
    this.cls = opts.cls || 'f1';
    // THE EMULATED ENGINE is the engine now; ?eng=loop brings the recording back.
    this.synthOn = opts.synth !== false;
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
      // THE LAST TWO THINGS BEFORE THE SPEAKERS.
      //   concuss  a lowpass that sits wide open (20 kHz) until a big hit
      //            slams it shut, then eases back over seconds — the world
      //            going to cotton wool, which is what "traumatizing" is.
      //   limiter  everything is louder now, and loud without a limiter is
      //            clipping. A brick wall at -1 dB lets the level go up
      //            without the crackle.
      this.concuss = this.ctx.createBiquadFilter();
      this.concuss.type = 'lowpass'; this.concuss.frequency.value = 20000; this.concuss.Q.value = 0.9;
      //   MEASURED before this stage existed (tools/shots/audiotest.html, an
      //   OfflineAudioContext render of a scripted lap): the OLD mix clipped
      //   38,551 samples in 12 s at full throttle. Loud without a ceiling is
      //   crackle. Chrome's DynamicsCompressor adds its own makeup gain, so a
      //   compressor alone is not a ceiling — hence the trim after it and a
      //   tanh soft-clip last, which can never exceed full scale and bends
      //   the peaks instead of chopping them.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10; this.limiter.knee.value = 6;
      this.limiter.ratio.value = 12; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
      this.trim = this.ctx.createGain(); this.trim.gain.value = FX.trim;
      this.clip = this.ctx.createWaveShaper();
      {
        const n = 4096, c = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i / (n - 1) * 2 - 1) * 2; c[i] = 0.96 * Math.tanh(x); }
        this.clip.curve = c; this.clip.oversample = '4x';
      }
      this.cans.connect(this.concuss);
      this.concuss.connect(this.limiter);
      this.limiter.connect(this.trim);
      this.trim.connect(this.clip);
      this.clip.connect(this.ctx.destination);
      this.room = this.ctx.createGain();
      this.room.gain.value = this.mix.roomSink ? 1 : 0;
      this.roomLP = this.ctx.createBiquadFilter();
      this.roomLP.type = 'lowpass';
      this.roomLP.frequency.value = this.mix.muffle;
      this.roomLP.Q.value = 0.7;
      // TWO OUTPUTS NEEDS A SECOND EXIT, NOT A SECOND setSinkId.
      //
      // AudioContext.setSinkId moves the WHOLE CONTEXT to a device, not one
      // bus - so the first version of this, which connected both buses to
      // ctx.destination and then called setSinkId for the room, sent
      // EVERYTHING to the seat speaker the moment a device was chosen. It
      // looked like two buses and behaved like one switch.
      //
      // The room bus leaves through its own MediaStreamDestination into an
      // <audio> element, and setSinkId on THAT pins only that stream. One
      // context, one set of sources, two destinations - and CANS stays on the
      // system default, which is the laptop speakers.
      this.room.connect(this.roomLP);
      if (this.mix.roomSink) {
        try {
          const dest = this.ctx.createMediaStreamDestination();
          this.roomLP.connect(dest);
          this.roomEl = new Audio();           // held, or it is collected mid-lap
          this.roomEl.srcObject = dest.stream;
          this.roomEl.autoplay = true;
          if (this.roomEl.setSinkId) await this.roomEl.setSinkId(this.mix.roomSink);
          await this.roomEl.play().catch(() => {});
        } catch {
          // Device gone, or the browser will not pin a sink. Fall back to one
          // output rather than to silence.
          this.roomEl = null;
          this.roomLP.connect(this.ctx.destination);
        }
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
      // THE RASP. A copy of the engine through a waveshaper — hard tanh
      // saturation — then a band around 2.4 kHz, mixed back in parallel. A
      // recording played faster gets higher, not angrier; saturation is what
      // adds the harmonics that make a note sound like it is being ABUSED.
      this.shaper = this.ctx.createWaveShaper();
      {
        const n = 2048, c = new Float32Array(n), k = 11;
        for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
        this.shaper.curve = c; this.shaper.oversample = '2x';
      }
      this.gritBP = this.ctx.createBiquadFilter();
      this.gritBP.type = 'bandpass'; this.gritBP.frequency.value = FX.gritAt; this.gritBP.Q.value = 0.55;
      this.gritGain = this.ctx.createGain(); this.gritGain.gain.value = 0;
      this.shelf.connect(this.shaper); this.shaper.connect(this.gritBP);
      this.gritBP.connect(this.gritGain); this.gritGain.connect(this.cans);
      this.barkBP = this.ctx.createBiquadFilter();
      this.barkBP.type = 'bandpass'; this.barkBP.frequency.value = FX.barkAt; this.barkBP.Q.value = 0.7;
      this.barkGain = this.ctx.createGain(); this.barkGain.gain.value = 0;
      this.shaper.connect(this.barkBP); this.barkBP.connect(this.barkGain); this.barkGain.connect(this.cans);

      // One-shots and surface loops all land on one FX bus, so a crash can
      // duck the engine without ducking itself.
      // A highpass on the whole bus: the recordings carry rumble below 180 Hz
      // that the engine's own bass already owns, and two things fighting over
      // the bottom octave is what muddy IS.
      this.fxHP = this.ctx.createBiquadFilter();
      this.fxHP.type = 'highpass'; this.fxHP.frequency.value = 180; this.fxHP.Q.value = 0.7;
      this.fx = this.ctx.createGain(); this.fx.connect(this.fxHP); this.fxHP.connect(this.cans);
      const optional = n => this._layer(baseUrl, n, 'lowpass', this.fx).catch(() => null);
      this.gravel = await optional('surf_gravel');
      this.grass = await optional('surf_grass');
      this.scrape = await optional('scrape');
      this.bufs = {};
      await Promise.all(['dirt_1', 'dirt_2', 'dirt_3', 'dirt_4', 'bump_1', 'bump_2', 'crash_heavy', ...CRASH_FILES]
        .map(n => this._buf(baseUrl, n).then(b => { this.bufs[n] = b; }).catch(() => {})));
      this.duck = 1;          // engine level after a big hit, recovers to 1
      // The modelled engine goes straight to the output bus: the loop's bass
      // shelf, octave-down and shake were weight for a LOW engine, and under a
      // 750 Hz scream they are the mud and the "brbrbr".
      if (this.synthOn) this.synth = new SynthEngine(this.ctx, this.cans, this.cls);
      // THE LOOPS MUST STOP WHEN THE GAME DOES. update() only runs while the
      // car is being driven, so in the pause menu, on the results screen or
      // after leaving the circuit the loops just kept playing at whatever
      // level they had last — Adam: "even after ive left the sound is still
      // playing". If nobody has called update() for a fifth of a second,
      // everything is faded out.
      this.lastUpd = 0;
      this.watch = setInterval(() => {
        if (this.ok && this.ctx.currentTime - this.lastUpd > 0.2) this.silence();
      }, 100);
      this.lastStone = 0; this.kerbDist = 0; this.wasOff = false; this.lastHit = -9;

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

  async _buf(baseUrl, name) {
    const r = await fetch(`${baseUrl}data/audio/${name}.wav`);
    if (!r.ok) throw new Error(`${name}.wav: HTTP ${r.status}`);
    return this.ctx.decodeAudioData(await r.arrayBuffer());
  }

  // Glide a gain instead of stepping it. A value set straight each frame is a
  // step in the waveform every frame, which is a click, which sixty times a
  // second is crackle.
  _to(param, v, tc = 0.03) { param.setTargetAtTime(v, this.ctx.currentTime, tc); }

  /** Every continuous sound down to nothing (pause, menu, muted, gone). */
  silence() {
    for (const L of [this.engine, this.sub, this.tyre, this.road, this.gravel, this.grass, this.scrape]) {
      if (L) this._to(L.gain.gain, 0, 0.05);
    }
    if (this.shakeGain) this._to(this.shakeGain.gain, 0, 0.05);
    if (this.gritGain) this._to(this.gritGain.gain, 0, 0.05);
    if (this.barkGain) this._to(this.barkGain.gain, 0, 0.05);
    if (this.synth) this.synth.silence();
  }

  // Fire a recording once. `rate` a little off 1 each time so twenty hits in
  // a race are not twenty copies of the same hit.
  _once(name, gain, rate = 1, delay = 0) {
    const b = this.bufs && this.bufs[name];
    if (!b || !this.ok || this.muted) return;
    const src = this.ctx.createBufferSource(); src.buffer = b;
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const g = this.ctx.createGain(); g.gain.value = this.master * gain;
    src.connect(g); g.connect(this.fx);
    src.start(this.ctx.currentTime + delay);
  }

  /**
   * A hit. `closing` is the impact speed in m/s (collide.js), which is how
   * hard it was and so which recordings, how many, and how loud.
   *   < 6 m/s    a knock: one light metal hit
   *   6 - 12     a proper hit: a heavy hit and a bump under it
   *   > 12       a wreck: two big hits a beat apart, the roll-cage crunch,
   *              the engine ducks, and the world goes to cotton wool
   */
  hit(closing) {
    if (!this.ok || this.muted || !this.bufs) return;
    const now = this.ctx.currentTime;
    // Grinding along a wall reports contact nearly every physics step; the
    // crash is the IMPACT, and the scrape loop is the grinding. So a hit can
    // only sound once in 0.6 s (it used to machine-gun for the whole slide).
    if (now - this.lastHit < 0.6) return;
    this.lastHit = now;
    const k = Math.min(1, closing / 20);
    const pick = (lo, hi) => CRASH_FILES[lo + Math.floor(Math.random() * (hi - lo + 1))];
    if (closing < 6) {
      this._once(pick(0, 4), FX.crash * (0.35 + 0.5 * k));
      return;
    }
    this._once(pick(5, 10), FX.crash * (0.6 + 0.6 * k));
    this._once(Math.random() < 0.5 ? 'bump_1' : 'bump_2', FX.crash * 0.9, 0.7);
    if (closing < 12) return;
    this._once(pick(5, 10), FX.crash * (0.7 + 0.5 * k), 0.85, 0.07 + Math.random() * 0.08);
    this._once('crash_heavy', FX.crash * (0.8 + 0.6 * k), 0.9 + 0.2 * Math.random());
    this._once(`dirt_${1 + Math.floor(Math.random() * 4)}`, FX.crash * 0.7, 1, 0.12);
    if (FX.concuss > 0) {
      // Slammed shut, then a slow way back. Harder hits close further and take
      // longer to come back from.
      const f = this.concuss.frequency, hold = 0.35 + 1.2 * k, back = 2.5 + 3 * k;
      f.cancelScheduledValues(now);
      f.setValueAtTime(20000, now);
      f.exponentialRampToValueAtTime(Math.max(180, 900 - 700 * k * FX.concuss), now + 0.06);
      f.setValueAtTime(Math.max(180, 900 - 700 * k * FX.concuss), now + hold);
      f.exponentialRampToValueAtTime(20000, now + hold + back);
      this.duck = 0.7;               // a dip under the impact, not the engine dying
    }
  }

  async _layer(baseUrl, name, filter, bus = null) {
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
    toCans.connect(bus || this.cans); toRoom.connect(this.room);
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
  update(rpm, throttle, { off = 0, speed = 0, slip = 0, peak = 0, surf = 1, wall = false, dt = 1 / 60 } = {}) {
    if (!this.ok) return;
    if (this.muted) { this.silence(); return; }
    this.lastUpd = this.ctx.currentTime;
    const m = this.mix;

    // ---- engine: rate from rpm, load from throttle --------------------------
    // OFF THE TARMAC. Adam: "make it a lil wobbly and stuggly on grass".
    //
    // A car on grass is not a quieter car, it is a car whose wheels keep
    // losing and finding the ground. So the rate WOBBLES and the level
    // STUTTERS, on two fast waves that do not line up - the same
    // no-common-multiple trick as the wind, at a speed you read as struggling
    // rather than as vibrato. `off` scales all of it, so tarmac is untouched.
    let wob = 1, stut = 1;
    if (off > 0) {
      const wt = this.ctx.currentTime - this.t0;
      const w = 0.62 * Math.sin(wt * 37.2) + 0.38 * Math.sin(wt * 23.7 + 1.7);
      wob = 1 + off * w * 0.045;                       // it bogs and catches
      stut = 1 - off * (0.18 + 0.34 * Math.max(0, w)); // and keeps dropping out
    }

    const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, rpm / this.ref));
    this.engine.src.playbackRate.value = rate * wob;
    const t = Math.max(0, Math.min(1, throttle));
    // COASTING. The off-throttle floor was a flat 0.30, which made a car
    // coasting at 12,000 rpm exactly as quiet as one idling at 4,000. An
    // engine on the overrun at high revs is one of the LOUDEST things a race
    // car does - engine braking is not silence, it is a different kind of
    // noise. So the floor rises with revs, and full throttle is still 1.0
    // whatever the revs are.
    const rev = Math.min(1, rpm / (this.ref * 1.35));
    const overrun = 0.16 + 0.44 * rev;
    // IDLE HAS TO KEEP A NOTE. This floor was 500 Hz, which was fine when the
    // engine was the only thing in the mix - but with +12 dB of shelf and an
    // octave underneath it, closing to 500 at zero throttle leaves a shapeless
    // rumble with no engine in it. Adam: "idling cuts audo". It did not cut;
    // it lost everything that identified it. 1100 keeps the note, and the
    // throttle still opens it the rest of the way.
    // Brightness follows the throttle, but the floor rises with revs too: a
    // 12,000 rpm overrun has a hard edge that an idle has not, and a filter
    // that only watches the throttle cannot tell those apart.
    this.engine.filt.frequency.value = 700 + 2200 * rev + 6000 * Math.pow(t, 1.3);
    // Level rises with load but never to zero: an engine on the overrun is
    // still an engine, and a car that goes silent mid-corner sounds broken.
    const load = (overrun + (1 - overrun) * t) * (1 - 0.25 * off) * stut;
    // After a big hit the engine is pushed down under the crash and comes back
    // over a second or two, instead of carrying on as if nothing happened.
    this.duck = Math.min(1, (this.duck ?? 1) + dt * 0.45);
    const boost = FX.engBoost * this.duck;
    this._to(this.engine.gain.gain, this.master * load * boost, 0.02);
    if (this.gritGain) this._to(this.gritGain.gain, this.master * FX.grit * boost * (0.25 + 0.75 * t) * (0.4 + 0.6 * rev), 0.02);
    if (this.barkGain) this._to(this.barkGain.gain, this.master * FX.bark * boost * (0.3 + 0.7 * t), 0.02);
    this.engine.toCans.gain.value = m.engCans;
    this.engine.toRoom.gain.value = m.engRoom;

    // The octave below, tracking the same note so it is weight and not a
    // second engine. Its own filter keeps it to body only.
    if (this.sub) {
      this.sub.src.playbackRate.value = rate * 0.5 * wob;
      this.sub.filt.frequency.value = m.subCut;
      this._to(this.sub.gain.gain, this.master * load * m.sub * boost, 0.02);
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
      this._to(this.shakeGain.gain, this.master * load * m.shake * boost, 0.02);
    }
    if (this.comp) {
      // More drive is a lower threshold and more makeup: the peaks come down
      // and the body comes up, which is what "heavier" and "louder" both are.
      this.comp.threshold.value = -6 - 30 * m.drive;
      this.cans.gain.value = 1 + 1.1 * m.drive;
      this.room.gain.value = (this.mix.roomSink ? 1 : 0) * (1 + 1.1 * m.drive);
    }

    if (this.synth) {
      // the loop goes quiet; the modelled engine sings (with the same grass
      // wobble and stutter, and the same duck after a big hit)
      for (const L of [this.engine, this.sub]) if (L) this._to(L.gain.gain, 0, 0.02);
      for (const G of [this.shakeGain, this.gritGain, this.barkGain]) if (G) this._to(G.gain, 0, 0.02);
      this.synth.update(rpm * wob, t, this.master * FX.synth * this.duck * stut, dt);
    }

    const kmh = speed * 3.6;

    // ---- tyres: a fraction of THIS car's limit, silent below a threshold ----
    if (this.tyre) {
      // peakSlip is where the tyre makes its most force. Past 1.0 it is
      // sliding, which is the part you can hear.
      const frac = peak > 0 ? Math.min(1.6, Math.abs(slip) / peak) : 0;
      const over = Math.max(0, frac - m.thresh) / Math.max(0.01, 1 - m.thresh);
      const sp = Math.min(1, kmh / 90);     // scrubbing at walking pace is nothing
      this._to(this.tyre.gain.gain, this.master * Math.max(m.tyreLvl, FX.tyreMin) * Math.pow(over, 1.4) * sp, 0.03);
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
      this._to(this.road.gain.gain, this.master * m.roadLvl * Math.pow(sn, 1.7) * amp, 0.05);
      this.road.src.playbackRate.value = 0.45 + 0.5 * sn;
      this.road.filt.frequency.value = Math.max(80, m.roadCut * tone);
      this.road.toCans.gain.value = m.roadCans;
      this.road.toRoom.gain.value = m.roadRoom;
    }

    // ---- the ground: gravel, grass, kerbs, and stones off the floor ---------
    // car.surface: 1 tarmac, 0.93 kerb, 0.58 run-off (the gravel trap), 0.42
    // grass. The loops scale with speed and pitch up with it — the faster the
    // wheels go through it, the harder the stones hit the floor.
    const sp = Math.min(1, kmh / 140), moving = Math.min(1, kmh / 15);
    const onGravel = surf > 0.5 && surf < 0.7, onGrass = surf < 0.5, onKerb = surf > 0.9 && surf < 1;
    if (this.gravel) {
      this._to(this.gravel.gain.gain, onGravel ? this.master * FX.gravel * moving * (0.45 + 0.55 * sp) : 0, 0.06);
      this.gravel.src.playbackRate.value = 0.75 + 0.55 * sp;
      this.gravel.filt.frequency.value = 2500 + 9000 * sp;
    }
    if (this.grass) {
      this._to(this.grass.gain.gain, onGrass ? this.master * FX.grass * moving * (0.4 + 0.6 * sp) : 0, 0.06);
      this.grass.src.playbackRate.value = 0.8 + 0.4 * sp;
      this.grass.filt.frequency.value = 1500 + 7000 * sp;
    }
    const nowT = this.ctx.currentTime;
    if (this.bufs) {
      const offNow = onGravel || onGrass;
      // Dropping a wheel off the road at speed is a spray of dirt, once.
      if (offNow && !this.wasOff && kmh > 40) this._once(`dirt_${1 + Math.floor(Math.random() * 4)}`, FX.stones * (0.6 + 0.6 * sp));
      this.wasOff = offNow;
      // In the gravel, stones keep flicking up into the floor: more often and
      // harder the faster you are going.
      if (onGravel && kmh > 20 && nowT > this.lastStone) {
        this._once(`dirt_${1 + Math.floor(Math.random() * 4)}`, FX.stones * (0.25 + 0.5 * sp) * Math.random(), 1.1);
        this.lastStone = nowT + 0.08 + Math.random() * (0.5 - 0.35 * sp);
      }
      // A kerb is a row of thuds, one per stripe — distance, not time, so it
      // drums faster the faster you cross it.
      if (onKerb && kmh > 10) {
        this.kerbDist += speed * dt;
        if (this.kerbDist > 2.0) {
          this.kerbDist = 0;
          this._once(Math.random() < 0.5 ? 'bump_1' : 'bump_2', FX.kerb * (0.35 + 0.65 * sp), 0.8 + 0.3 * sp);
        }
      } else this.kerbDist = 1.9;              // the first stripe lands at once
    }
    // Along a wall: the scrape, while there is contact and the car is moving.
    if (this.scrape) {
      this._to(this.scrape.gain.gain, wall && kmh > 15 ? this.master * FX.scrape * Math.min(1, kmh / 80) : 0, 0.05);
      this.scrape.src.playbackRate.value = 0.8 + 0.5 * sp;
      this.scrape.filt.frequency.value = 12000;
    }

    if (this.roomLP) this.roomLP.frequency.value = m.muffle;
  }

  /** Re-read the bench's settings without restarting the context. */
  reloadMix() { this.mix = savedMix(); this.ref = this.mix.ref || REF_RPM; return this.mix; }

  setVolume(v) { this.master = Math.max(0, Math.min(1, v)); }
  toggleMute() { this.muted = !this.muted; return this.muted; }
  stop() { clearInterval(this.watch); try { this.src?.stop(); this.ctx?.close(); } catch { /* going away anyway */ } this.ok = false; }
}

export const ENGINE_FILES = FILES;
