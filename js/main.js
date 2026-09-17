// main.js — wires the simulation to the screen, and nothing else.
//
// The important line in this file is the fixed-timestep accumulator. The
// physics runs at exactly 400 Hz no matter what the monitor does; the renderer
// takes whatever frame rate it gets. Step physics by the frame time instead
// and the car is literally faster on a 144 Hz screen than a 60 Hz one, which
// is the single most common way a browser "sim" quietly turns out not to be.
import { Track } from './track.js';
import { buildLine } from './line.js';
import { CARS, makeCar, step, FIXED_DT, SURFACE, peakSlip } from './physics.js';
import { Hands, steerLock } from './input.js';
import { View } from './render.js';
import { loadEnv } from './env.js';
import { resolveBarrier } from './collide.js';

const $ = id => document.getElementById(id);
const CAMS = ['CHASE', 'CLOSE', 'NOSE', 'TV'];

const state = {
  track: null, line: null, car: null, view: null,
  peak: 0, hint: 0, sPrev: 0,
  lap: 0, lapT: 0, last: null, best: null, started: false,
  offT: 0, invalid: false, msgT: 0,
};
const hands = new Hands();

// ---------------------------------------------------------------------------
// menu
// ---------------------------------------------------------------------------
const TRACKS = [
  ['monza', 'Monza', 'ITALY'],
  ['zandvoort', 'Zandvoort', 'NETHERLANDS'],
  ['suzuka', 'Suzuka', 'JAPAN'],
  ['baku', 'Baku', 'AZERBAIJAN'],
  ['monaco', 'Monaco', 'MONACO'],
];
let pickTrack = 'monza', pickCar = 'f4';

function buildMenu() {
  const tl = $('trackList');
  tl.innerHTML = '';
  for (const [key, name, country] of TRACKS) {
    const b = document.createElement('button');
    b.className = 'card' + (key === pickTrack ? ' on' : '');
    b.innerHTML = `<b>${name}</b><small>${country}</small>`;
    b.onclick = () => { pickTrack = key; buildMenu(); };
    tl.appendChild(b);
  }
  const cl = $('carList');
  cl.innerHTML = '';
  for (const k of ['f4', 'f1']) {
    const s = CARS[k];
    const b = document.createElement('button');
    b.className = 'card' + (k === pickCar ? ' on' : '');
    b.innerHTML = `<b>${s.name}</b><small>${s.full}</small>`;
    b.onclick = () => { pickCar = k; buildMenu(); };
    cl.appendChild(b);
  }
}

async function start() {
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('load').classList.remove('hidden');
  // let the browser paint the loading line before the line solver blocks
  await new Promise(r => setTimeout(r, 30));

  const t = await Track.load(pickTrack);
  const spec = CARS[pickCar];
  const line = buildLine(t, spec);
  state.track = t; state.line = line;
  state.peak = peakSlip(spec);
  state.car = makeCar({ cls: pickCar });
  resetCar();

  const q = new URLSearchParams(location.search);
  // Driver aids are tunable from the URL, including all the way off. They are
  // real systems — TC limits drive torque to what the rear tyre can still take
  // once cornering has used its share of the friction circle, ABS releases
  // pressure when the front locks, and SC adds counter-lock plus stops the rack
  // asking the front for more slip than it can give. None of them invent grip.
  //   ?tc=0&abs=0&sc=0   purist, nothing between you and the tyres
  //   ?tc=1&sc=1         maximum help while you learn a circuit
  const aid = (k, d) => { const v = q.get(k); return v == null ? d : Math.max(0, Math.min(1, parseFloat(v) || 0)); };
  state.car.aids = { tc: aid('tc', 0.6), abs: aid('abs', 0.6), sc: aid('sc', 0.35) };
  const env = q.has('noenv') ? null : await loadEnv(pickTrack);
  if (!state.view) state.view = new View($('cv'), t, line, { shadows: !q.has('lo'), env });
  else { location.reload(); return; }   // changing circuit rebuilds the world

  $('trackName').textContent = t.full;
  $('carName').textContent = `${spec.full}  ·  peak grip at ${(state.peak * 180 / Math.PI).toFixed(1)}°`;
  $('drsLight').style.display = spec.drs ? '' : 'none';
  $('load').classList.add('hidden');
  state.started = true;
  requestAnimationFrame(loop);
}

function resetCar() {
  const { track, line, car } = state;
  const i = track.idx(0);
  const p = track.point(0, line.off[i]);
  car.x = p.x; car.y = p.y; car.hdg = line.hdg[i];
  car.vx = 0.001; car.vy = 0; car.r = 0; car.ax = 0; car.ay = 0;
  car.delta = 0; car.throttle = 0; car.brake = 0;
  car.tyre.Tf = 70; car.tyre.Tr = 70; car.tyre.wf = 0; car.tyre.wr = 0;
  car.drsOpen = false;
  state.hint = i; state.sPrev = 0;
  state.lapT = 0; state.invalid = false; state.offT = 0;
  hands.wheel = 0;
}

function toast(msg) { $('msg').textContent = msg; state.msgT = 2.2; }

// ---------------------------------------------------------------------------
// the loop
// ---------------------------------------------------------------------------
let acc = 0, prev = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const frame = Math.min(0.1, (now - prev) / 1000);   // cap: a tab that was
  prev = now;                                          // backgrounded must not
  acc += frame;                                        // fast-forward the sim

  const { track, line, car, view } = state;
  const spec = car.spec;

  if (hands.tapped('KeyC') || hands.tapped('pad:y')) {
    view.setMode(view.mode + 1);
    toast('CAMERA ' + CAMS[view.mode]);
  }
  if (hands.tapped('KeyL')) toast('IDEAL LINE ' + (view.toggleLine() ? 'ON' : 'OFF'));
  if (hands.tapped('KeyR') || hands.tapped('pad:b')) { resetCar(); toast('RESET'); }
  if (hands.tapped('Escape')) { location.reload(); return; }

  let rough = 0;
  let steps = 0;
  while (acc >= FIXED_DT && steps < 240) {
    acc -= FIXED_DT; steps++;

    const inp = hands.update(FIXED_DT);
    car.throttle = inp.throttle;
    car.brake = inp.brake;
    car.delta = inp.wheel * steerLock(car.speed);

    const proj = track.project(car.x, car.y, state.hint);
    state.hint = proj.i;

    const al = Math.abs(proj.lat);
    let surface = SURFACE.track;
    if (al > proj.w + proj.run) surface = SURFACE.grass;
    else if (al > proj.w + 1.2) surface = SURFACE.runoff;
    else if (al > proj.w) surface = SURFACE.kerb;
    if (surface !== SURFACE.track) {
      rough = Math.max(rough, surface === SURFACE.kerb ? 0.22 : 0.45);
      if (al > proj.w + 0.9) { state.offT += FIXED_DT; if (state.offT > 0.35) state.invalid = true; }
    }

    if (spec.drs && hands.tapped('Space')) car.drsOpen = !car.drsOpen;
    if (car.brake > 0.05) car.drsOpen = false;   // DRS shuts under braking

    step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv) });

    // ---- barrier: real rigid-body contact, resolved at the bodywork corners
    const hit = resolveBarrier(car, track, state.hint);
    if (hit && hit.closing > 3.5) {
      hands.rumble(Math.min(1, hit.closing / 14), 0.5, 160);
      toast(hit.harm > 0.12 ? `HEAVY CONTACT — ${hit.part.toUpperCase()}` : 'CONTACT');
    }

    // ---- lap timing ------------------------------------------------------
    const s = proj.s;
    if (state.sPrev > track.length * 0.8 && s < track.length * 0.2) {
      if (state.lap > 0) {
        state.last = state.lapT;
        if (!state.invalid && (state.best == null || state.lapT < state.best)) {
          state.best = state.lapT;
          toast('PERSONAL BEST');
        } else if (state.invalid) toast('LAP DELETED — TRACK LIMITS');
      }
      state.lap++; state.lapT = 0; state.invalid = false; state.offT = 0;
    }
    state.sPrev = s;
    state.lapT += FIXED_DT;
  }
  hands.endFrame();

  // how far past the peak the rear tyre is — this drives the smoke AND the HUD
  const over = Math.max(0, (Math.abs(car.slipR) - state.peak) / state.peak);
  view.frame(car, frame, { slipOver: over, rough });
  hud(over, rough);
  if (state.msgT > 0 && (state.msgT -= frame) <= 0) $('msg').textContent = '';
}

// ---------------------------------------------------------------------------
// HUD. The slip bars are the point of the whole thing: the marker is where the
// tyre actually peaks, computed from the tyre curve, so it cannot drift out of
// agreement with the physics.
// ---------------------------------------------------------------------------
const fmt = s => s == null ? '--:--.---'
  : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;

function hud(over, rough) {
  const { car, peak } = state;
  $('spd').textContent = Math.round(car.speed * 3.6);
  $('gLat').textContent = Math.abs(car.gLat).toFixed(1);
  $('pedT').style.width = (car.throttle * 100).toFixed(0) + '%';
  $('pedB').style.width = (car.brake * 100).toFixed(0) + '%';

  const bar = (el, a) => {
    const frac = Math.min(1, Math.abs(a) / (peak * 2.4));
    el.style.width = (frac * 100).toFixed(1) + '%';
    el.style.background = Math.abs(a) > peak ? '#ff4d3d' : Math.abs(a) > peak * 0.8 ? '#ffc23d' : '#35d6a0';
  };
  bar($('slipFbar'), car.slipF);
  bar($('slipRbar'), car.slipR);
  $('slipFv').textContent = (Math.abs(car.slipF) * 180 / Math.PI).toFixed(1) + '°';
  $('slipRv').textContent = (Math.abs(car.slipR) * 180 / Math.PI).toFixed(1) + '°';
  $('peakMark').textContent = (peak * 180 / Math.PI).toFixed(1) + '°';

  $('tfT').textContent = Math.round(car.tyre.Tf);
  $('trT').textContent = Math.round(car.tyre.Tr);
  $('tCur').textContent = fmt(state.lapT);
  $('tLast').textContent = fmt(state.last);
  $('tBest').textContent = fmt(state.best);
  $('lapNo').textContent = Math.max(1, state.lap);
  $('tCur').className = state.invalid ? 'bad' : '';
  $('drsLight').classList.toggle('on', car.drsOpen);
  $('padLight').style.display = hands.usingPad ? '' : 'none';
}

// ---------------------------------------------------------------------------
hands.attach();
buildMenu();
$('go').onclick = start;

// Test hook: ?auto=monza:f1 boots straight into a session. It exists so a
// headless browser can prove the page actually runs without a human clicking
// anything — the menu is not where the bugs live.
const auto = new URLSearchParams(location.search).get('auto');
if (auto !== null) {
  const [t, c] = auto.split(':');
  if (t) pickTrack = t;
  if (c) pickCar = c;
  start();
}
