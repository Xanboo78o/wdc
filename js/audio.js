// audio.js — the engine, out of the speakers.
//
// This is Adam's idea, arrived at the long way round: a loop, played back at a
// rate. Two attempts at synthesising the loop sounded, in his words, like
// garbage, and the reason was measurable rather than a matter of taste —
// speeding a sample up moves its TIMBRE, not just its pitch. Reaching an F1's
// firing rate from a 0.2 s drum loop takes 37x, which puts a 210 Hz drum body
// at 7,900 Hz and leaves hiss. A real engine recording is already at engine
// frequency, so it moves about an octave and keeps its character.
//
// So the loop is a CC0 recording from data/audio/ (see SOURCE.md), and the
// only thing this file does is decide how fast to play it.
//
// TWO AXES, and getting them the wrong way round is the classic mistake:
//   RATE  follows RPM.      What note the engine is at.
//   LOAD  follows throttle. How hard it is working: level and brightness.
// Driving rate from throttle means blipping in the pit lane screams at max
// pitch while stationary, and lifting at 250 km/h drops to idle while you are
// still doing 250. Both are backwards, and both are what this avoids.
//
// Imports nothing from the renderer or the simulation. main.js hands it
// numbers; it never reaches back.

// The loop file, and the engine speed the RATE is normalised against. This is
// NOT measured from the file: tools/enginecheck.mjs tries and its fundamental
// detector is not trustworthy on this material — it read 25 Hz to 1225 Hz
// across six recordings of one engine. See data/audio/SOURCE.md. So REF is a
// tuning constant chosen by ear on engine.html, not a measurement, and it is
// overridable precisely because it is a guess.
const FILES = ['loop_0', 'loop_1_0', 'loop_2_0', 'loop_3_0', 'loop_4_0', 'loop_5_0'];
const REF_RPM = 8300;        // rpm at which the loop plays at 1.00x
const RATE_MIN = 0.40, RATE_MAX = 2.20;

export class Engine {
  constructor(opts = {}) {
    this.ok = false;
    this.ctx = null;
    this.src = null;
    this.file = FILES[Math.max(0, Math.min(FILES.length - 1, (opts.pick ?? 1) - 1))];
    this.ref = opts.ref || REF_RPM;
    this.master = opts.volume ?? 0.5;
    this.muted = false;
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
      const r = await fetch(`${baseUrl}data/audio/${this.file}.wav`);
      if (!r.ok) throw new Error(`${this.file}.wav: HTTP ${r.status}`);
      const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());

      // Load: a lowpass that opens with throttle. An engine off the throttle
      // is not quieter so much as duller, and the filter is most of that.
      this.filt = this.ctx.createBiquadFilter();
      this.filt.type = 'lowpass'; this.filt.Q.value = 0.8;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.filt.connect(this.gain);
      this.gain.connect(this.ctx.destination);

      // ONE source node, started once, rate modulated forever. Restarting it
      // per frame is the classic mistake and it machine-guns.
      this.src = this.ctx.createBufferSource();
      this.src.buffer = buf;
      this.src.loop = true;
      this.src.connect(this.filt);
      this.src.start();

      await this.ctx.resume();
      this.ok = this.ctx.state === 'running';
      return this.ok;
    } catch (e) {
      // A game that will not start because the speakers are busy is worse than
      // a silent one.
      console.warn('engine audio unavailable:', e.message);
      this.ok = false;
      return false;
    }
  }

  // rpm and throttle from the sim. `airborne` and `off` are cues, not physics.
  update(rpm, throttle, { off = 0 } = {}) {
    if (!this.ok || this.muted) { if (this.gain) this.gain.gain.value = 0; return; }
    const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, rpm / this.ref));
    this.src.playbackRate.value = rate;
    const t = Math.max(0, Math.min(1, throttle));
    // Brightness is the load axis. Off the throttle the top end shuts down.
    this.filt.frequency.value = 500 + 7500 * Math.pow(t, 1.3);
    // Level rises with load but never to zero: an engine on the overrun is
    // still an engine, and a car that goes silent mid-corner sounds broken.
    // `off` dulls it further when the wheels are off the tarmac.
    this.gain.gain.value = this.master * (0.30 + 0.70 * t) * (1 - 0.25 * off);
  }

  setVolume(v) { this.master = Math.max(0, Math.min(1, v)); }
  toggleMute() { this.muted = !this.muted; return this.muted; }
  stop() { try { this.src?.stop(); this.ctx?.close(); } catch { /* going away anyway */ } this.ok = false; }
}

export const ENGINE_FILES = FILES;
