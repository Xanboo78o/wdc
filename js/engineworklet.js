// engineworklet.js — runs js/enginecore.js on the audio thread.
//
// A firing simulator is thousands of per-sample decisions a second; on the
// main thread it would stutter every time the renderer took a long frame.
// Parameters arrive as messages ({rpm, throttle, gain, speed}) once a frame;
// the core smooths them per sample.
import { EngineCore } from './enginecore.js';

class EngineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.core = new EngineCore(sampleRate);
    this.port.onmessage = e => this.core.set(e.data);
  }
  process(_, outputs) {
    const out = outputs[0];
    this.core.render(out[0]);
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    return true;
  }
}
registerProcessor('wdc-engine', EngineProcessor);
