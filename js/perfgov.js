// perfgov.js — hold 60 frames a second by spending fewer PIXELS, not fewer things.
//
// Adam, 2026-10-03: "the framerate is lower than it used to be fix, i want a
// smooth 60fps when racing". Measured that day: the game was drawing 3240x2160
// (his laptop panel at pixel ratio 2, seven million pixels, through a post
// pipeline and three mirror passes) on the INTEGRATED Intel chip, with the GTX
// 1060 idle. Nothing in the scene has to go to fix that; the picture just has
// to be drawn at the size the machine can afford, and that size has to be
// FOUND, because it differs by a factor of ten between this laptop's two
// graphics chips.
//
// So this watches the frame time and moves the renderer's pixel ratio:
//   - too slow (and the time is going on DRAWING, not on the simulation):
//     step the resolution down, by as much as the overshoot says;
//   - a step down that did not make the frame quicker is undone (the machine
//     is short of something else) and not retried for 45 s;
//   - comfortably at 60 for a while: try one step up; if that breaks 60, come
//     back down and wait twice as long before trying again.
// The ratio that worked is remembered per machine+window size, so the next
// session starts there instead of rediscovering it through ten bad seconds.
//
// It never touches physics, and the HUD is DOM, so text stays sharp.
const KEY = 'wdc.res';
const TARGET = 1000 / 60;

export class Governor {
  constructor(view, { show = false } = {}) {
    this.view = view;
    this.max = Math.min(devicePixelRatio || 1, 2);
    this.min = Math.min(this.max, 0.55);
    this.t = 0; this.good = 0; this.wait = 6; this.hold = 2.5; this.lastUp = -1e9; this.now = 0;
    // Start from what worked here before, else from at most ~2.3 megapixels:
    // starting at the full 7 MP on a slow chip is ten seconds of slideshow.
    let r = Math.min(this.max, Math.sqrt(2.3e6 / Math.max(1, innerWidth * innerHeight)));
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.w === innerWidth && s.h === innerHeight && s.r > 0) r = s.r; } catch { /* first time */ }
    this.set(Math.max(this.min, Math.min(this.max, r)), false);
    if (show) { this.box = document.createElement('div'); this.box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:200;padding:4px 8px;background:rgba(0,0,0,.7);color:#fff;font:12px/1.4 monospace;white-space:pre;pointer-events:none'; document.body.appendChild(this.box); }
  }
  set(r, save = true) {
    r = Math.round(r * 20) / 20;                       // steps of 0.05: no resize for a hair
    if (r === this.ratio) return;
    this.ratio = r;
    this.view.renderer.setPixelRatio(r);
    this.view.resize();                                // re-sizes the post pipeline's targets too
    if (typeof window !== 'undefined' && window.__wdc) window.__wdc.resScale = r;
    if (save) { try { localStorage.setItem(KEY, JSON.stringify({ w: innerWidth, h: innerHeight, r })); } catch { /* fine */ } }
  }
  // perf = { frame, sim, draw } in smoothed milliseconds (js/main.js); dt in seconds
  tick(perf, dt, paused) {
    this.now += dt;
    if (this.box) this.box.textContent = `${(1000 / perf.frame).toFixed(0)} fps   sim ${perf.sim.toFixed(1)}  draw ${perf.draw.toFixed(1)} ms\nres x${this.ratio.toFixed(2)} of ${this.max}   steps ${perf.steps.toFixed(1)}${perf.dropped ? `   dropped ${perf.dropped}` : ''}`;
    if (paused || (this.hold -= dt) > 0) return;       // let a change settle before judging it
    if ((this.t += dt) < 0.75) return;
    this.t = 0;
    const f = perf.frame;
    // DID THE LAST STEP DOWN BUY ANYTHING? If the frame is not at least 8%
    // quicker for it, pixels are not what this machine is short of (the time
    // is going on draw calls and JavaScript), so put the sharpness back and
    // stop going lower for a while. Measured: headless on the GTX the frame
    // cost the same at 891x594 as at 1862x1242, and the first version of this
    // rode all the way down to the floor for nothing.
    if (this.was) {
      const { f: f0, r: r0 } = this.was; this.was = null;
      if (f > f0 * 0.92) { this.floor = r0; this.floorUntil = this.now + 45; this.set(r0); this.hold = 1.5; return; }
    }
    const min = this.now < (this.floorUntil || 0) ? Math.max(this.min, this.floor) : this.min;
    if (f > TARGET * 1.14) {                           // under ~52 fps
      this.good = 0;
      if (perf.sim > perf.draw * 1.5) return;          // the simulation is the cost: pixels will not buy it back
      if (this.now - this.lastUp < 6) this.wait = Math.min(120, this.wait * 2);   // the step up was a mistake
      if (this.ratio > min + 0.01) { this.was = { f, r: this.ratio }; this.set(Math.max(min, this.ratio * Math.max(0.7, Math.sqrt(TARGET / f) * 0.97))); this.hold = 1.5; }
    } else if (f < TARGET * 1.04) {                    // at 60
      this.good += 0.75;
      if (this.good >= this.wait && this.ratio < this.max) { this.good = 0; this.lastUp = this.now; this.set(Math.min(this.max, this.ratio + 0.1)); this.hold = 1.5; }
    } else this.good = 0;
  }
}
