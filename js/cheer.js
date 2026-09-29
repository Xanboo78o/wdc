// cheer.js — the grandstand, when YOUR pass sticks.
//
// Adam, 2026-09-28: "FINALLY overtaking and its a celebration". The engineer
// says it in your ear (js/engineer.js cheer); this is the other half — the
// crowd going up. js/race.js decides WHAT counts as a pass (held CHEER_HOLD
// seconds, half a car clear); main.js calls cheer() once per pass.
//
// EMULATED, not a clip (the WDC sound rule: synthesise from the event). A
// crowd is noise with a shape: a broad roar that swells in a quarter of a
// second and dies over three, a few hundred voices that are really a dozen
// narrow formant bands each wobbling at its own syllable rate and rising as
// the excitement does, a handful of whistles, all of it heard from a
// grandstand away — so it sits in a short synthetic hall.
//
// Its own AudioContext unless the sound session hands it theirs: js/audio.js
// is owned elsewhere, and routing is one call — cheerRoute(ctx, destination)
// — the moment they want the crowd on their bus (and under their master).
//
// Volume: localStorage 'wdc.cheer' (0..1, default 0.6). 0 turns it off.

let ctx = null, out = null, noise = null, hall = null;

/** Put the crowd on someone else's context and bus. */
export function cheerRoute(audioCtx, destination) {
  ctx = audioCtx; out = destination; noise = null; hall = null;
}

function ac() {
  if (!ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC(); out = ctx.destination;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function level() {
  try {
    const v = parseFloat(localStorage.getItem('wdc.cheer'));
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.6;
  } catch { return 0.6; }
}

// Four seconds of pinkish noise, made once. Pink rather than white because a
// crowd's energy falls with frequency; white noise reads as a hiss.
function noiseBuf(c) {
  if (noise) return noise;
  const n = Math.floor(c.sampleRate * 4);
  const b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  }
  return (noise = b);
}

// A grandstand's worth of room: 1.4 s of decaying noise as an impulse.
function hallNode(c) {
  if (hall) return hall;
  const n = Math.floor(c.sampleRate * 1.4);
  const ir = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
  }
  const conv = c.createConvolver(); conv.buffer = ir;
  const wet = c.createGain(); wet.gain.value = 0.28;
  conv.connect(wet); wet.connect(out);
  return (hall = conv);
}

/**
 * The crowd goes up. `big` (taking the lead) is longer and louder, with more
 * whistles. Safe to call anywhere: without Web Audio it does nothing.
 */
export function cheer({ big = false } = {}) {
  const vol = level();
  if (vol <= 0) return;
  const c = ac();
  if (!c) return;
  const now = c.currentTime + 0.02;
  const len = big ? 4.2 : 3.2, peak = (big ? 0.62 : 0.5) * vol;

  // The bus: everything below meets here, is shaped once, and goes dry to the
  // output and wet to the hall.
  const bus = c.createGain();
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
  bus.connect(hp); hp.connect(lp); lp.connect(out); lp.connect(hallNode(c));
  bus.gain.setValueAtTime(0, now);
  bus.gain.linearRampToValueAtTime(peak, now + 0.28);
  bus.gain.setValueAtTime(peak, now + 0.28 + len * 0.22);
  bus.gain.exponentialRampToValueAtTime(0.0008, now + len);

  const buf = noiseBuf(c);
  const src = () => {
    const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
    s.start(now, Math.random() * 3); s.stop(now + len + 0.1);
    return s;
  };

  // 1. The roar: broad, centred where voices are.
  {
    const s = src();
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.55;
    const g = c.createGain(); g.gain.value = 0.9;
    s.connect(bp); bp.connect(g); g.connect(bus);
  }

  // 2. The voices: narrow formants, each with its own syllable wobble,
  // rising a little as the roar builds — the "wooo" going up.
  const nv = big ? 14 : 10;
  for (let k = 0; k < nv; k++) {
    const s = src();
    const f0 = 380 + Math.random() * 2200;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7 + Math.random() * 9;
    bp.frequency.setValueAtTime(f0, now);
    bp.frequency.linearRampToValueAtTime(f0 * (1.08 + Math.random() * 0.2), now + 0.6 + Math.random() * 0.6);
    bp.frequency.linearRampToValueAtTime(f0 * 0.95, now + len);
    const g = c.createGain(); g.gain.value = 0.0;
    const lfo = c.createOscillator(); lfo.frequency.value = 2.5 + Math.random() * 5;
    const depth = c.createGain(); depth.gain.value = 0.45 + Math.random() * 0.2;
    lfo.connect(depth); depth.connect(g.gain);
    const base = c.createConstantSource ? c.createConstantSource() : null;
    if (base) { base.offset.value = 0.6; base.connect(g.gain); base.start(now); base.stop(now + len + 0.1); }
    lfo.start(now); lfo.stop(now + len + 0.1);
    s.connect(bp); bp.connect(g); g.connect(bus);
    // Stereo spread, so the stand is wide rather than one point.
    if (c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8;
      g.disconnect(); g.connect(p); p.connect(bus);
    }
  }

  // 3. Whistles: a few, scattered through the first second and a half.
  const nw = big ? 5 : 3;
  for (let k = 0; k < nw; k++) {
    const t0 = now + 0.15 + Math.random() * 1.4, d = 0.35 + Math.random() * 0.5;
    const o = c.createOscillator(); o.type = 'sine';
    const f = 2100 + Math.random() * 1300;
    o.frequency.setValueAtTime(f * 0.92, t0);
    o.frequency.linearRampToValueAtTime(f, t0 + 0.08);
    o.frequency.setValueAtTime(f, t0 + d - 0.1);
    o.frequency.linearRampToValueAtTime(f * (Math.random() < 0.5 ? 0.8 : 1.1), t0 + d);
    const vib = c.createOscillator(); vib.frequency.value = 22 + Math.random() * 10;
    const vd = c.createGain(); vd.gain.value = f * 0.012;
    vib.connect(vd); vd.connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.07, t0 + 0.04);
    g.gain.setValueAtTime(0.07, t0 + d - 0.06);
    g.gain.linearRampToValueAtTime(0, t0 + d);
    o.connect(g); g.connect(bus);
    o.start(t0); o.stop(t0 + d + 0.05); vib.start(t0); vib.stop(t0 + d + 0.05);
  }
}
