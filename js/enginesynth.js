// enginesynth.js — the engine the game hears: js/enginecore.js, fired one
// combustion at a time on the audio thread (js/engineworklet.js).
//
// 2026-09-25: the periodic-wave synth that lived here was measured against
// four real F1 recordings and was the wrong kind of sound — ~95% pure
// harmonics against the real cars' 21-35%, perfectly repeating, dark. See
// the top of js/enginecore.js for the measurements and the model. This file
// keeps the old interface so js/audio.js did not have to change:
//
//   new SynthEngine(ctx, out, cls, spatial?)      update(rpm, throttle, gain, dt, speed)      silence()
//
// `rpm` arrives from the gearbox (js/gearbox.js), whose F1 range is the
// V10's — 4,500 to 19,000 — since Adam chose the 2005 V10.

export class SynthEngine {
  constructor(ctx, out, cls = 'f1', spatial = null) {
    this.ctx = ctx; this.node = null; this.pending = null;
    const url = new URL('./engineworklet.js', import.meta.url);
    ctx.audioWorklet.addModule(url).then(() => {
      this.node = new AudioWorkletNode(ctx, 'wdc-engine', { numberOfOutputs: 1, outputChannelCount: [1] });
      // With 360 sound, the spatial layer places it (exhaust + airbox).
      if (spatial) spatial.adoptOwn(this.node); else this.node.connect(out);
      if (this.pending) this.node.port.postMessage(this.pending);
    }).catch(e => console.error('engine worklet:', e));
  }

  update(rpm, throttle, gain, dt = 1 / 60, speed = 0) {
    const msg = { rpm, throttle: Math.max(0, Math.min(1, throttle)), gain, speed };
    if (this.node) this.node.port.postMessage(msg); else this.pending = msg;
  }

  silence() { this.update(0, 0, 0); }
}
