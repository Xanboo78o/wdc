// main.js — wires the simulation to the screen, and nothing else.
//
// The important line in this file is the fixed-timestep accumulator. The
// physics runs at exactly 400 Hz no matter what the monitor does; the renderer
// takes whatever frame rate it gets. Step physics by the frame time instead
// and the car is literally faster on a 144 Hz screen than a 60 Hz one, which
// is the single most common way a browser "sim" quietly turns out not to be.
import { Track } from './track.js';
import { buildLines } from './line.js';
import { CARS, makeCar, step, FIXED_DT, SURFACE, peakSlip, dragFor, registerAero } from './physics.js';
import { makeAero } from './aero.js';
import { Hands, steerLock } from './input.js';
import { FFB } from './ffb.js';
import { View } from './render.js';
import { loadEnv } from './env.js';
import { resolveBarrier } from './collide.js';
import { Race } from './race.js';
import { gridSlots } from './grid.js';
import { Z } from './geom.js';
import { PropWorld } from './props.js';
import { Objects } from './build/objects.js';
import { TIERS, BATTLE, makeAutopilot, makeDriver } from './autopilot.js';
import { Field } from './field.js';
import { makeBox } from './gearbox.js';
import { Engine } from './audio.js';
import { startDash, mountDashCard, onDash } from './dash.js';

const $ = id => document.getElementById(id);
const CAMS = ['ONBOARD', 'CHASE', 'NOSE', 'TV'];

const state = {
  track: null, line: null, lines: null, car: null, view: null,
  peak: 0, hint: 0, sPrev: 0,
  lap: 0, lapT: 0, last: null, best: null, started: false,
  offT: 0, invalid: false, msgT: 0,
  // Race mode. `race` is the session out of js/race.js, `field` draws the other
  // twenty-one, and `me` is the player's entry inside the race — everything the
  // HUD needs about the player in a race hangs off that one object rather than
  // being copied into `state` and going stale.
  race: null, field: null, me: null, lightsWere: 0, shown: false,
  paused: false, menuAt: 0,
  box: null, engine: null,
};
const hands = new Hands();
const ffb = new FFB();
// the phone steers while it is live; keys and pedals are untouched
// (the phone used to steer here; a real wheel comes in through input.js)

// ---------------------------------------------------------------------------
// menu
// ---------------------------------------------------------------------------
const TRACKS = [
  // The hand-built one, baked out of data/build/pieces.js by
  // tools/baketrack.mjs. It is first because it is the one being worked on,
  // and because reaching it through the MENU is the only way to see the phone
  // wheel's pairing code — ?auto=test:f1 skips the menu, which is why the
  // phone would not connect to it.
  ['test', 'The test map', 'HAND-BUILT'],
  ['kate', 'Kate Mascoi Circuit', 'WIDE · FAST · BATTLES'],
  // Adam's own, modelled outside this project and read in by
  // tools/importtrack.mjs. Both carry real elevation in `z`, which nothing on
  // this side reads yet — so they drive flat for now, and that is the next
  // thing they want.
  ['street', 'Street Circuit', "ADAM'S OWN"],
  ['adam1', "Adam's first track", "ADAM'S OWN"],
  ['monza', 'Monza', 'ITALY'],
  ['zandvoort', 'Zandvoort', 'NETHERLANDS'],
  ['suzuka', 'Suzuka', 'JAPAN'],
  ['baku', 'Baku', 'AZERBAIJAN'],
  ['monaco', 'Monaco', 'MONACO'],
  ['nurburgring', 'Nürburgring', 'GERMANY'],
];
let pickTrack = 'monza', pickCar = 'f4';
// Race settings. `pickGrid` counts EVERY car including yours, so 22 is the real
// thing and 6 is a sprint you can actually see all of.
let pickMode = 'hotlap', pickGrid = 22, pickTier = 'medium', pickLaps = 3, pickStart = 'mid';
let pickNoDnf = false;
// SUPERCASUAL's OVERTAKES submode: how hard the pack around you fights.
let pickBattle = 'medium';

// The menu remembers what you last picked (Adam: "save my previous race
// settings"). Every value is checked against what exists NOW, so a circuit
// that was renamed or a tier that was removed falls back to the default
// instead of booting a session that cannot load. Storage is per ORIGIN —
// localhost:8175 and github.io each remember their own.
const MENU_KEY = 'wdc.menu';
function loadMenu() {
  let m;
  try { m = JSON.parse(localStorage.getItem(MENU_KEY) || 'null'); } catch { m = null; }
  if (!m) return;
  if (TRACKS.some(t => t[0] === m.track)) pickTrack = m.track;
  if (CARS[m.car]) pickCar = m.car;
  if (m.mode === 'race' || m.mode === 'hotlap') pickMode = m.mode;
  if ([6, 12, 16, 22].includes(m.grid)) pickGrid = m.grid;
  if (TIERS[m.tier]) pickTier = m.tier;
  if ([2, 3, 5, 10].includes(m.laps)) pickLaps = m.laps;
  if (['pole', 'front', 'mid', 'back'].includes(m.start)) pickStart = m.start;
  pickNoDnf = m.noDnf === true;
  if (BATTLE[m.battle]) pickBattle = m.battle;
}
function saveMenu() {
  try {
    localStorage.setItem(MENU_KEY, JSON.stringify({
      track: pickTrack, car: pickCar, mode: pickMode, grid: pickGrid, tier: pickTier,
      laps: pickLaps, start: pickStart, noDnf: pickNoDnf, battle: pickBattle,
    }));
  } catch { /* private window: it just won't remember */ }
}

// One card list, built the same way everywhere: the value, the big label, the
// small one under it, and what to do when it is clicked.
function cards(el, items, current, set, tight) {
  const box = $(el);
  box.innerHTML = '';
  for (const [value, big, small] of items) {
    const b = document.createElement('button');
    b.className = 'card' + (value === current ? ' on' : '');
    b.innerHTML = `<b>${big}</b>${small ? `<small>${small}</small>` : ''}`;
    b.onclick = () => { set(value); buildMenu(); };
    box.appendChild(b);
  }
}

function buildMenu() {
  cards('trackList', TRACKS.map(([k, n, c]) => [k, n, c]), pickTrack, v => pickTrack = v);
  cards('carList', ['f4', 'gt3', 'f1'].map(k => [k, CARS[k].name, CARS[k].full]), pickCar, v => pickCar = v);
  cards('modeList', [
    ['hotlap', 'HOT LAP', 'EMPTY CIRCUIT'],
    ['race', 'RACE', 'WHEEL TO WHEEL'],
  ], pickMode, v => pickMode = v);
  cards('gridList', [[6, '6'], [12, '12'], [16, '16'], [22, '22']], pickGrid, v => pickGrid = v);
  cards('tierList', Object.keys(TIERS).map(k => [k, TIERS[k].name]), pickTier, v => pickTier = v);
  cards('battleList', Object.keys(BATTLE).map(k => [k, BATTLE[k].name]), pickBattle, v => pickBattle = v);
  $('battleOpt').classList.toggle('off', pickTier !== 'supercasual');
  cards('lapList', [[2, '2'], [3, '3'], [5, '5'], [10, '10']], pickLaps, v => pickLaps = v);
  cards('startList', [
    ['pole', 'POLE'], ['front', 'FRONT'], ['mid', 'MIDFIELD'], ['back', 'LAST'],
  ], pickStart, v => pickStart = v);
  cards('dnfList', [[false, 'NORMAL'], [true, 'NO DNF']], pickNoDnf, v => pickNoDnf = v);
  saveMenu();
  $('raceOpts').classList.toggle('off', pickMode !== 'race');
}

// Which slot on the grid you line up in, 1 being pole.
function startSlot(grid) {
  if (pickStart === 'pole') return 1;
  if (pickStart === 'front') return Math.min(grid, 3);
  if (pickStart === 'back') return grid;
  return Math.max(1, Math.round(grid * 0.55));
}

async function start() {
  $('menu').classList.add('hidden');
  // Engine audio MUST be created inside a real user gesture. A context made
  // any later starts suspended, never makes a sound, and never reports an
  // error either — so it is started here, from the click, and awaited at the
  // end of this function rather than blocking the load.
  const qa = new URLSearchParams(location.search);
  if (qa.get('sound') !== '0') {
    state.engine = new Engine({
      pick: +(qa.get('eng') || 1),
      ref: +(qa.get('engref') || 0) || undefined,
      // undefined, NOT 0.5 — a hardcoded default here silently beat MIX.master
      // in audio.js, so raising the shipped volume did nothing at all and I
      // spent a round wondering why it was still quiet. ?vol= still wins.
      volume: qa.has('vol') ? +qa.get('vol') : undefined,
    });
  }
  $('hud').classList.remove('hidden');
  $('load').classList.remove('hidden');
  // let the browser paint the loading line before the line solver blocks
  await new Promise(r => setTimeout(r, 30));

  const q = new URLSearchParams(location.search);
  // Solved aerodynamics, baked offline by tools/aerobake.mjs. This MUST run
  // before the first makeCar: a car captures its aero map at construction, so
  // registering afterwards silently leaves that car on the old constants —
  // and a grid where the player is on one aero model and the bots are on
  // another is the kind of bug that reads as "the AI is cheating".
  for (const k of ['f1', 'f4', 'gt3']) {
    try {
      const r = await fetch(`./data/aero/${k}.json`);
      if (r.ok) registerAero(k, makeAero(await r.json()));
    } catch { /* fall back to the constants; the car still drives */ }
  }
  // The wheel's calibration, before anything can be driven. Storage first, then
  // data/wheel.json — see Hands.loadProfile for why a file exists at all.
  await hands.loadProfile('./');
  await hands.loadButtons('./');
  const t = await Track.load(pickTrack);
  const spec = CARS[pickCar];
  // buildLines gives the racing line AND the centreline, plus `at(which, grip)`
  // — which is what lets a slower rival re-solve the speed profile at less grip
  // instead of driving the fast line slowly. A hot lap only ever uses `.race`.
  const lines = buildLines(t, spec);
  const line = lines.race;
  state.track = t; state.line = line; state.lines = lines;
  state.peak = peakSlip(spec);
  state.box = makeBox(spec);
  // Not awaited: a missing or slow .wav must not hold up the green light.
  if (state.engine) state.engine.start('./');

  if (pickMode === 'race') {
    // Everything here can also come off the URL, so a headless check can boot
    // a full grid without a human clicking four card lists:
    //   ?auto=monza:f1&race=1&grid=22&tier=hard&laps=2&start=10&seed=7
    const grid = Math.max(2, Math.min(22, +q.get('grid') || pickGrid));
    const laps = Math.max(1, Math.min(60, +q.get('laps') || pickLaps));
    const tier = TIERS[q.get('tier')] ? q.get('tier') : pickTier;
    // ?battle=easy|medium|hard (or 0 for the old, passive supercasual field)
    const battle = tier !== 'supercasual' ? null
      : q.has('battle') ? (BATTLE[q.get('battle')] ? q.get('battle') : null) : pickBattle;
    const slot = Math.max(1, Math.min(grid, +q.get('start') || startSlot(grid)));
    $('load').innerHTML = `<div class="loadbox">BUILDING A GRID OF ${grid}…</div>`;
    await new Promise(r => setTimeout(r, 30));
    state.race = new Race({
      track: t, lines, spec, slots: gridSlots(t, grid), laps, grid,
      playerGrid: slot, tier, player: true, battle,
      noDnf: q.has('nodnf') ? q.get('nodnf') === '1' : pickNoDnf,
      seed: +q.get('seed') || (1 + Math.floor(Math.random() * 9973)),
    });
    state.me = state.race.entries.find(e => e.isPlayer);
    state.car = state.me.car;

    // Debug: fast-forward the race before the first frame, with a bot standing
    // in at your wheel.  ?spool=25
    //
    // It exists because a headless browser runs at a fifth of a frame a second
    // under swiftshader, and the loop is frame-limited — so however long a
    // screenshot waits, it comes back at lap 0:00.7 with the grid still on the
    // grid. A photograph proves a thing RENDERS, never that a thing HAPPENS,
    // and this is what lets a photograph of a race in progress exist at all.
    const spool = Math.max(0, Math.min(900, +q.get('spool') || 0));
    if (spool) {
      const ghost = makeAutopilot(t, lines, spec, state.peak,
        { driver: makeDriver(11, 'medium', t.corners.length || 24) });
      const me = state.me;
      for (let n = Math.round(spool / FIXED_DT); n > 0; n--) {
        ghost(me.car, me.proj, FIXED_DT, me.ctx);
        state.race.tick(FIXED_DT,
          { throttle: me.car.throttle, brake: me.car.brake, delta: me.car.delta });
      }
    }
  } else {
    state.car = makeCar({ cls: pickCar });
    resetCar();
  }
  // Driver aids are tunable from the URL, including all the way off. They are
  // real systems — TC limits drive torque to what the rear tyre can still take
  // once cornering has used its share of the friction circle, ABS releases
  // pressure when the front locks, and SC adds counter-lock plus stops the rack
  // asking the front for more slip than it can give. None of them invent grip.
  //   ?tc=0&abs=0&sc=0   purist, nothing between you and the tyres
  //   ?tc=1&sc=1         maximum help while you learn a circuit
  const aid = (k, d) => { const v = q.get(k); return v == null ? d : Math.max(0, Math.min(1, parseFloat(v) || 0)); };
  state.car.aids = { tc: aid('tc', 0.6), abs: aid('abs', 0.6), sc: aid('sc', 0.35) };
  // Debug: preset bodywork damage so the crumple can be photographed without
  // having to crash into something first.  ?crush=front:0.9,left:0.5
  //
  // ORDER MATTERS: this runs AFTER resetCar(), which zeroes crush because a
  // reset car is a repaired car. Move it above resetCar while tidying and the
  // preset silently stops working with nothing to show for it.
  if (q.has('crush')) {
    state.car.crush = { front: 0, rear: 0, left: 0, right: 0 };
    for (const bit of q.get('crush').split(',')) {
      const [k, v] = bit.split(':');
      if (k in state.car.crush) state.car.crush[k] = Math.max(0, Math.min(1, parseFloat(v) || 0));
    }
  }
  // Debug: throw the car in the air on load, so a flight can be photographed
  // without having to arrange a 260 km/h spin first.  ?launch=6  (metres/second
  // of vertical kick)  ?launch=6,2.5  (and a nose-up pitch rate)
  if (q.has('launch')) {
    const [vz, pr] = q.get('launch').split(',').map(parseFloat);
    state.car.airborne = true;
    state.car.z = 0.05;
    state.car.vz = Math.max(0, Math.min(25, vz || 0));
    state.car.pRate = Math.max(-8, Math.min(8, pr || 0));
  }
  const env = q.has('noenv') ? null : await loadEnv(pickTrack);
  // View.create is async because the circuit is painted with real photographed
  // materials and lit by a real sky, both of which come off the network.
  //   ?notex   skip the texture set and run on flat colours
  //   ?lo      no shadows
  if (!state.view) {
    state.view = await View.create($('cv'), t, line, {
      shadows: !q.has('lo'), env, textures: !q.has('notex'), cls: pickCar,
    });
  } else {
    location.reload(); return;          // changing circuit rebuilds the world
  }

  // The rest of the grid. It is built after the View because it needs the
  // View's material cache and its sky-lit environment map — a car built against
  // a different `look` than the world it stands in reads as a sticker.
  // The rear-view mirror: on in a race, off on an empty circuit, V toggles it,
  // and the choice is remembered. ?mirror=0|1 overrides for a headless check.
  {
    let pref = null;
    try { pref = localStorage.getItem('wdc.mirror'); } catch { /* private window */ }
    const on = q.has('mirror') ? q.get('mirror') !== '0' : pref != null ? pref === '1' : !!state.race;
    state.view.setMirror(on);
  }
  if (state.race) {
    state.field = new Field(state.view, state.race.entries, spec.key);
    const c = state.field.cost();
    if (typeof window !== 'undefined' && window.__wdc) {
      window.__wdc.cars = c.cars + 1;
      window.__wdc.meshesPerCar = c.meshesPerCar;
      window.__wdc.farMeshesPerCar = c.farMeshesPerCar;
    }
  }
  for (const id of ['tower', 'startLights']) $(id).classList.toggle('hidden', !state.race);
  $('posRow').classList.toggle('hidden', !state.race);

  $('trackName').textContent = t.full;
  $('carName').textContent = `${spec.full}  ·  peak grip at ${(state.peak * 180 / Math.PI).toFixed(1)}°`;
  $('drsLight').style.display = spec.drs ? '' : 'none';
  // THE THINGS IN THE WORLD, for a track that has a layout file. Same file the
  // builder reads (data/build/objects.js): model names and positions, no
  // geometry worked out here. Each solid one hands the prop world a wall, so
  // they are things you hit rather than things you drive through.
  state.things = null;
  if (!q.has('noobjects')) {
    try {
      const layout = await import('../data/build/objects.js');
      if (layout.TRACK === pickTrack && layout.OBJECTS.length) {
        const world = state.view.world;
        const high = (x, y) => (world ? world.heightAt(x, Z(y)) : 0);
        const props = new PropWorld({ seed: 7, groundY: high });
        const things = new Objects(state.view.scene, high, props);
        await things.build();
        state.things = { props, things };
        // Its OWN global. Hanging it off window.__wdc looked right and was
        // not: render.js publishes that later, so both the success line and
        // the failure line above were being skipped in silence and a layout
        // that had loaded 2,942 objects reported nothing at all.
        if (typeof window !== 'undefined') window.__things = things.stats();
      }
    } catch (e) {
      // Visible, not whispered: a console.warn is invisible to every headless
      // check in this repo, so a layout that fails to load looks exactly like
      // a track that has none.
      console.error('object layout failed:', e.message);
      if (typeof window !== 'undefined') window.__things = { error: e.message };
    }
  }

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
  car.damage = 0;
  car.crush = { front: 0, rear: 0, left: 0, right: 0 };   // a reset car is a repaired car
  car.dents = []; car.lost = null;                        // ...and a straight one
  // Put the car back on the ground. Resetting mid-flip and keeping the
  // attitude would leave you sitting upside down on the grid.
  car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
  car.airborne = false; car.onRoof = false; car.inContact = false;
  car.wheelZ = [0, 0, 0, 0]; car.gripF = 1; car.gripR = 1;
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

  // ---- the pause menu ----------------------------------------------------
  // MENU opens it, HOME closes it, the D-PAD moves and START chooses — which
  // is what every wheel expects and what Escape-reloads-the-page was not.
  // READ EACH TAP EXACTLY ONCE. `tapped()` CONSUMES the event — it is a read
  // that clears. Writing `hands.tapped('Escape') && !state.paused` therefore
  // ate the Escape whenever the menu was open, because && evaluates the call
  // first and then throws the result away, so the branch that closes the menu
  // never saw it. The menu opened and would not shut.
  const tapPause = hands.tapped('w:pause');
  const tapBack = hands.tapped('w:back');
  const tapEsc = hands.tapped('Escape');
  if (!state.paused && (tapPause || tapEsc)) setPaused(true);
  else if (state.paused && (tapPause || tapBack || tapEsc)) setPaused(false);
  if (state.paused) {
    if (hands.tapped('w:up') || hands.tapped('ArrowUp')) moveMenu(-1);
    if (hands.tapped('w:down') || hands.tapped('ArrowDown')) moveMenu(1);
    if (hands.tapped('w:confirm') || hands.tapped('Enter')) chooseMenu();
    hands.endFrame();
    // Drop the accumulated time. Without this, every second spent in the menu
    // is a second the physics owes, and resuming fast-forwards the car into a
    // barrier — the same trap the frame cap at the top of this loop exists for.
    acc = 0;
    return;
  }

  // THE PADDLES ARE THE SELECTOR — drive and reverse, the real one.
  //
  // Not the gearbox: js/gearbox.js invents ratios so the engine has something
  // to sing and states outright that it does not change how the car
  // accelerates. `selector` is the thing that is actually mechanical —
  // physics.js reads it and caps reverse at a 25 km/h crawl.
  //
  // Reverse only from near a standstill, because selecting it at racing speed
  // is not a gearshift, it is a typo with consequences. Forward always.
  if (hands.tapped('w:shiftUp') && hands.selector < 0) {
    hands.selector = 1; toast('DRIVE');
  }
  if (hands.tapped('w:shiftDn') && hands.selector > 0) {
    if (car.speed < 5) { hands.selector = -1; toast('REVERSE'); }
    else toast('TOO FAST FOR REVERSE');
  }

  if (hands.tapped('KeyC') || hands.tapped('pad:y') || hands.tapped('w:cam')) {
    view.setMode(view.mode + 1);
    toast('CAMERA ' + CAMS[view.mode]);
  }
  if (hands.tapped('KeyL')) toast('IDEAL LINE ' + (view.toggleLine() ? 'ON' : 'OFF'));
  if (hands.tapped('KeyH')) toast('HEADLIGHTS ' + (view.toggleHeadlights() ? 'ON' : 'OFF'));
  if (hands.tapped('KeyR') || hands.tapped('pad:b')) {
    // In a race there is no reset. You rejoin where you went off, with the
    // damage you earned — anything else is a different game.
    if (state.race) { rejoin(); toast('REJOIN'); } else { resetCar(); toast('RESET'); }
  }
  // Ask for a pit stop. The lane controller in js/pitstop.js takes the car over
  // once it commits, the way every racing game does it — the interesting
  // decision is WHEN to come in, not whether you can drive at 80 km/h.
  if (state.race && hands.tapped('KeyP')) {
    const me = state.me;
    me.pitRequest = !me.pitRequest;
    toast(me.pitRequest ? 'BOX THIS LAP' : 'PIT CANCELLED');
  }
  if (hands.tapped('KeyV')) {
    const on = view.setMirror(!view.mirrorOn);
    try { localStorage.setItem('wdc.mirror', on ? '1' : '0'); } catch { /* fine */ }
    toast('MIRROR ' + (on ? 'ON' : 'OFF'));
  }
  if (hands.tapped('KeyM') && state.engine) toast('SOUND ' + (state.engine.toggleMute() ? 'OFF' : 'ON'));

  let rough = 0;
  let steps = 0;
  const race = state.race;
  while (acc >= FIXED_DT && steps < 240) {
    acc -= FIXED_DT; steps++;

    // ---- race: the session steps every car, including yours ---------------
    if (race) {
      const inp = hands.update(FIXED_DT);
      if (spec.drs && (hands.tapped('Space') || hands.tapped('w:drs'))) car.drsOpen = !car.drsOpen;
      race.tick(FIXED_DT, {
        throttle: inp.throttle, brake: inp.brake,
        delta: inp.wheel * steerLock(car.speed),
      });
      if (car.brake > 0.05) car.drsOpen = false;
      // Contact the player was part of, reported by the race layer rather than
      // felt for a second time here — two places deciding what counts as a hit
      // is how they end up disagreeing.
      const bump = state.me.bump;
      if (bump) {
        state.me.bump = null;
        hands.rumble(Math.min(1, bump.closing / 14), 0.5, 160);
        ffb.hit(bump.closing / 14);
        state.adr = 1;                     // contact: full adrenaline
        if (state.engine) state.engine.hit(bump.closing);
        toast(bump.what === 'car'
          ? (bump.harm > 1.2 ? 'CONTACT — WHEEL TO WHEEL' : 'RUBBING')
          : (bump.harm > 0.12 ? `HEAVY CONTACT — ${String(bump.part).toUpperCase()}` : 'CONTACT'));
      }
      continue;
    }

    const inp = hands.update(FIXED_DT);
    car.throttle = inp.throttle;
    car.brake = inp.brake;
    car.selector = hands.selector;        // Shift+R toggles reverse
    car.delta = inp.wheel * steerLock(car.speed);

    // Walls and loose objects, in the same substep as everything else. At
    // frame rate a car covers two metres between contact tests, which is more
    // than a barrier is thick.
    if (state.things) state.things.props.step(FIXED_DT, [car]);

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

    if (spec.drs && (hands.tapped('Space') || hands.tapped('w:drs'))) car.drsOpen = !car.drsOpen;
    if (car.brake > 0.05) car.drsOpen = false;   // DRS shuts under braking

    step(car, FIXED_DT, { surface, bank: proj.bank, bankDir: Math.sign(proj.curv),
                          rollMul: dragFor(surface) });

    // ---- barrier: real rigid-body contact, resolved at the bodywork corners
    const hit = resolveBarrier(car, track, state.hint);
    if (hit && hit.closing > 3.5) {
      hands.rumble(Math.min(1, hit.closing / 14), 0.5, 160);
      ffb.hit(hit.closing / 14);
      state.adr = 1;
      if (state.engine) state.engine.hit(hit.closing);
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

  // In a race the surface under the player is worked out by the race layer, so
  // rather than test it a second time and risk the two disagreeing, read it off
  // the projection the race already made. This only drives camera shake.
  if (race) {
    const me = state.me, pr = me.proj, al = Math.abs(pr.lat);
    rough = al > pr.w + 1.2 ? 0.45 : al > pr.w ? 0.22 : 0;
    // The lap clock in a race belongs to the race, not to a second copy of the
    // timing code living here. Mirror it into `state` so the existing HUD keeps
    // reading one set of fields whichever session type is running.
    state.lap = me.lap + 1;
    state.lapT = race.state === 'grid' ? 0 : Math.max(0, race.time - me.lapStart);
    state.last = me.lastLap;
    state.best = me.bestLap;
    state.invalid = false;
  }
  ffb.update(car, rough, frame);   // the wheel pushes back (tools/ffb.py)

  // ADRENALINE, 0..1: how much the light trails are allowed to smear. Adam:
  // "make it less, but this amount when collisions or any SUPER high
  // adrenaline, and turn it up a lil at the last lap". Contact sets it to 1
  // (the two hit sites above) and it drains over about three seconds; a spin
  // or wheel-to-wheel at speed holds it up while it lasts.
  {
    let a = Math.max(0, (state.adr || 0) - frame * 0.35);
    const pk = state._peak || 0.15;
    if (Math.abs(car.slipR || 0) > pk * 2.5 && car.speed > 12) a = Math.max(a, 0.85);
    let last = false;
    if (race && state.me) {
      const me = state.me;
      let d = Infinity;
      for (const e of race.entries) {
        if (e === me || e.retired) continue;
        d = Math.min(d, Math.hypot(e.car.x - car.x, e.car.y - car.y));
      }
      if (d < 7 && car.speed > 30) a = Math.max(a, 0.35 + 0.4 * (1 - d / 7));
      last = me.lap + 1 >= race.laps && !me.finished;
    }
    state.adr = a;
    view.trailBoost = 0.4 + 0.6 * a + (last ? 0.15 : 0);
  }

  // how far past the peak the rear tyre is — this drives the smoke AND the HUD
  const over = Math.max(0, (Math.abs(car.slipR) - state.peak) / state.peak);
  // The field is posed BEFORE the view draws, because view.frame ends with the
  // render call. Smoke goes in first too: it writes into the renderer's puff
  // pool, which view.frame then ages by one frame.
  if (state.field) {
    state.field.frame(race.entries, frame);
    state.field.smoke(race.entries, state.peak);
  }
  // ---- gears and engine note --------------------------------------------
  // Read off the speed the car already has. gearbox.js changes no forces, so
  // every validated lap time is untouched — see the header of that file.
  if (state.box) {
    state.box.update(frame, car.speed * 3.6, car.throttle);
    if (state.engine) {
      // peakSlip is 60 rounds of bisection, so it is cached per car spec — the
      // tyre layer wants the slip angle THIS car peaks at, so that "starts
      // talking at 70%" means 70% of the grip it actually has.
      if (state._peak === undefined || state._peakFor !== car.spec) {
        state._peak = peakSlip(car.spec); state._peakFor = car.spec;
      }
      state.engine.update(state.box.rpm, car.throttle, {
        off: car.surface < 0.9 ? 1 : 0,   // grass and gravel, not kerbs
        speed: car.speed,
        slip: Math.max(Math.abs(car.slipF), Math.abs(car.slipR)),
        peak: state._peak,
        surf: car.surface, wall: !!car.wallTouch, dt: frame,
      });
    }
  }
  view.frame(car, frame, { slipOver: over, rough });
  // Republish what the LAST frame actually cost. render.js publishes this once,
  // on the first frame, which is honest for a static world and useless for a
  // grid: on frame one the camera has not been placed yet, so every rival is
  // culled and the count says the field is free. Overwriting it here means the
  // number a tool reads is the number the frame in front of you paid.
  if (typeof window !== 'undefined' && window.__wdc) {
    const info = view.renderer.info.render;
    window.__wdc.draws = info.calls;
    window.__wdc.tris = info.triangles;
    if (state.field) window.__wdc.carsDrawn = state.field.drawn;
    // Gear, revs and the state of the engine audio, published for the
    // harnesses. `audioOk` is read off the AudioContext, not off a flag this
    // file set — reporting a label you wrote yourself is not a measurement.
    // A live reference to the player's car, so a harness can drive it. Same
    // reason __wdc exists at all: the alternative is a second copy of the loop.
    window.__wdc.car = car;
    if (state.box) { window.__wdc.gear = state.box.gear + 1; window.__wdc.rpm = Math.round(state.box.rpm); }
    if (state.engine) {
      window.__wdc.audioOk = !!(state.engine.ctx && state.engine.ctx.state === 'running' && state.engine.ok);
      window.__wdc.audioRate = state.engine.src ? +state.engine.src.playbackRate.value.toFixed(3) : 0;
      window.__wdc.audioGain = state.engine.gain ? +state.engine.gain.gain.value.toFixed(3) : 0;
      window.__wdc.audioFile = state.engine.file;
    }
  }
  hud(over, rough);
  if (race) raceHud(frame);
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

  // The bar used to be scaled to 2.4x peak, which put the peak marker at 41.6%
  // — visually the MIDDLE of the bar. Adam read a bar sitting on its marker as
  // "the grip bars are in the middle", i.e. as having half the tyre left, when
  // it meant he was exactly at the limit. The gauge was not wrong, it was
  // unreadable. At 1.4x the marker sits at 71%, past it is plainly past it,
  // and there is still room to show an overdriven tyre.
  const bar = (el, a) => {
    const frac = Math.min(1, Math.abs(a) / (peak * 1.4));
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
  inputReadout(hands, car);
}

// ---------------------------------------------------------------------------
// ?input=1 — what the game thinks is driving it.
//
// Added the day the wheel arrived, because "the pedals don't work" has at
// least four causes that look identical from the driving seat: no device seen
// at all, a device seen but no saved profile, a profile saved under a
// DIFFERENT ORIGIN (localStorage is per-origin, and this game is reachable at
// 127.0.0.1, at localhost and at github.io — three separate stores), or a
// profile whose device id no longer matches. Each of those sends the code down
// the Xbox path, where steering happens to work off axes[0] and the pedals are
// looked for on TRIGGERS that a wheel does not have. So: steering works,
// pedals do nothing — the same symptom from four different faults.
//
// Guessing between them cost an hour. This prints the answer.
// ---------------------------------------------------------------------------
// THE PAUSE MENU.
//
// Escape used to reload the page. That is not a pause menu, it is a way to
// lose a lap, and on a wheel there is no Escape key within reach anyway.
//
// Built in JS rather than in index.html on purpose: the pre-commit hook
// restamps the importmap only while index.html is otherwise clean, so keeping
// new UI out of that file keeps cache-busting working.
const MENU_ITEMS = () => [
  ['RESUME', () => setPaused(false)],
  [state.race ? 'REJOIN' : 'RESTART LAP', () => { setPaused(false); if (state.race) rejoin(); else resetCar(); }],
  ['CAMERA — ' + CAMS[state.view.mode], () => { state.view.setMode(state.view.mode + 1); drawMenu(); }],
  ['IDEAL LINE', () => { state.view.toggleLine(); drawMenu(); }],
  ['SOUND', () => { if (state.engine) state.engine.toggleMute(); drawMenu(); }],
  ['QUIT TO MENU', () => location.reload()],
];
let _menuBox = null;
function setPaused(on) {
  state.paused = on;
  if (on) state.menuAt = 0;
  if (!_menuBox) {
    _menuBox = document.createElement('div');
    _menuBox.id = 'pauseMenu';
    _menuBox.style.cssText = 'position:fixed;inset:0;z-index:120;display:flex;align-items:center;'
      + 'justify-content:center;background:rgba(6,8,11,.72);backdrop-filter:blur(3px);'
      + 'font:16px/2.1 ui-monospace,monospace;color:#e8eaee';
    document.body.appendChild(_menuBox);
  }
  _menuBox.style.display = on ? 'flex' : 'none';
  if (on) drawMenu();
}
function drawMenu() {
  if (!_menuBox) return;
  const items = MENU_ITEMS();
  _menuBox.innerHTML = '<div style="min-width:320px;padding:22px 26px;border:1px solid #2a3039;'
    + 'border-radius:10px;background:rgba(10,13,17,.92)">'
    + '<div style="letter-spacing:.2em;color:#7d8590;font-size:12px;margin-bottom:14px">PAUSED</div>'
    + items.map(([label], i) => `<div style="padding:2px 10px;border-radius:5px;${i === state.menuAt
        ? 'background:#35d6a0;color:#04150e;font-weight:700' : ''}">${i === state.menuAt ? '\u203a ' : '\u00a0\u00a0'}${label}</div>`).join('')
    + '<div style="margin-top:16px;color:#7d8590;font-size:11px;letter-spacing:.1em">'
    + 'D-PAD MOVE &middot; START SELECT &middot; HOME CLOSE</div></div>';
}
function moveMenu(d) {
  const n = MENU_ITEMS().length;
  state.menuAt = (state.menuAt + d + n) % n;
  drawMenu();
}
function chooseMenu() { MENU_ITEMS()[state.menuAt][1](); }

let _inputBox = null;
function inputReadout(hands, car) {
  if (!new URLSearchParams(location.search).has('input')) return;
  if (!_inputBox) {
    _inputBox = document.createElement('div');
    _inputBox.id = 'inputBox';
    _inputBox.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99;padding:8px 10px;'
      + 'background:rgba(8,10,13,.86);color:#e8eaee;font:12px/1.55 ui-monospace,monospace;'
      + 'border:1px solid #2a3039;border-radius:6px;white-space:pre;pointer-events:none';
    document.body.appendChild(_inputBox);
  }
  const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
  // Report the profile the game is ACTUALLY USING, not a fresh read of
  // localStorage. Those are different things now that a profile can also come
  // from data/wheel.json, and a diagnostic that reports a different source
  // from the one in play is worse than no diagnostic.
  const prof = hands._prof || null;
  let storeErr = '';
  if (_inputBox._where === undefined) {
    _inputBox._where = 'none';
    try { _inputBox._where = localStorage.getItem('wdc.wheel') ? 'localStorage (calibrated here)' : (prof ? 'data/wheel.json (shipped)' : 'none'); }
    catch (e) { storeErr = String(e.message || e); }
  }
  const p = pads[0];
  // Same shape test the input layer uses: does this device HAVE the axes the
  // profile names? Matching on the device string is what broke before.
  const needs = prof ? Math.max(prof.steer.ax, prof.throttle.ax, prof.brake.ax) : 0;
  const match = !!(prof && p && p.axes.length > needs);
  const L = [];
  L.push(`origin    ${location.origin}`);
  L.push(`devices   ${pads.length}${p ? '  ' + p.id.slice(0, 46) : '  — press a button on the wheel'}`);
  L.push(`profile   ${prof ? prof.id.slice(0, 46) : (storeErr || 'NONE — no calibration and no data/wheel.json')}`);
  L.push(`   from   ${_inputBox._where}`);
  L.push(`match     ${match ? `YES — wheel ax ${prof.steer.ax}, pedals ${prof.throttle.ax}/${prof.brake.ax}` : 'NO — falling back to the Xbox mapping'}`);
  if (p) L.push(`axes      ${p.axes.map((v, i) => `${i}:${v.toFixed(2)}`).join(' ')}`);
  L.push(`car       steer ${car.delta.toFixed(3)}   throttle ${car.throttle.toFixed(2)}   brake ${car.brake.toFixed(2)}`);
  _inputBox.textContent = L.join('\n');
}

// ---------------------------------------------------------------------------
// RACE HUD. Everything here reads the race and writes the screen; it decides
// nothing. If the tower says you are fourth, it is because race.js sorted you
// fourth, and if it disagrees with the finishing order then the bug is in one
// place rather than in two that have to be kept in step.
// ---------------------------------------------------------------------------
let towerRows = null;
let towerAcc = 9;

function buildTower(race) {
  const box = $('tower');
  box.innerHTML = '';
  towerRows = race.entries.map(() => {
    const d = document.createElement('div');
    d.className = 'trow';
    d.innerHTML = '<b></b><i></i><span></span><em></em>';
    box.appendChild(d);
    return { d, pos: d.children[0], chip: d.children[1], name: d.children[2], gap: d.children[3] };
  });
}

// The interval to the car in front, in seconds, the way a timing screen shows
// it: distance between them divided by how fast the one behind is travelling.
// A lap down is a lap down and no number of seconds describes it usefully.
function interval(race, ahead, e) {
  const d = race.progress(ahead) - race.progress(e);
  if (d > race.track.length * 0.97) {
    const laps = Math.round(d / race.track.length);
    return `+${laps} LAP${laps > 1 ? 'S' : ''}`;
  }
  return '+' + (d / Math.max(e.car.speed, 14)).toFixed(1);
}

function rowText(race, e, i) {
  if (e.retired) return ['dnf', 'DNF'];
  // Before the lights there are no gaps, only a grid. An interval computed from
  // a stationary car is 8 m over a floor speed, which prints a confident +0.6
  // for every single row and means nothing at all.
  if (race.state === 'grid') return ['', ''];
  // A car that has finished keeps driving — it does not vanish — so its
  // `progress` keeps climbing and an interval computed from it is nonsense.
  // A classified car's gap is the difference in race time, penalties included,
  // which is also what decided the order it is being listed in.
  if (e.finished) {
    if (i === 0) return ['', fmt(e.finishTime + e.penalty)];
    const lead = race.standings[0];
    return ['', '+' + ((e.finishTime + e.penalty) - (lead.finishTime + lead.penalty)).toFixed(1)];
  }
  if (e.inPit) return ['pit', 'PIT'];
  if (i === 0) return ['', 'LEADER'];
  return ['', interval(race, race.standings[i - 1], e)];
}

function raceHud(dt) {
  const race = state.race, me = state.me;

  // ---- five lights, then the wait ----------------------------------------
  const L = $('startLights');
  if (race.state === 'grid') {
    const on = Math.max(0, Math.min(5, Math.floor((3.2 - race.lights) / 0.5)));
    if (on !== state.lightsWere) {
      for (let i = 0; i < 5; i++) L.children[i].classList.toggle('on', i < on);
      state.lightsWere = on;
    }
  } else if (!L.classList.contains('hidden')) {
    L.classList.add('hidden');
  }

  // ---- position, and the lap you are on ----------------------------------
  $('posV').textContent = me.retired ? 'DNF' : 'P' + me.pos;
  const pit = $('pitLight');
  pit.style.display = (me.pitRequest || me.inPit) ? '' : 'none';
  pit.classList.toggle('on', !!me.inPit);
  pit.textContent = me.inPit ? `PIT ${me.pitTimer > 0 ? me.pitTimer.toFixed(1) : ''}` : 'BOX';
  $('lapNo').textContent = `${Math.min(race.laps, me.lap + 1)}/${race.laps}`;
  if (me.penalty > 0) $('posV').textContent += ` +${me.penalty}s`;

  // ---- race control ------------------------------------------------------
  // There isn't one any more, and that is the point.
  //
  // This used to be a scrolling feed of "X INTO THE BARRIER", "Y TRACK LIMITS
  // (2/3)", "Z CAUSED A COLLISION". All of it was the game telling you what
  // had just happened to you on a screen you were not looking at, while the
  // thing itself was happening out of the windscreen. If you hit a wall you
  // can see that you hit a wall. The only thing left is the safety car light,
  // because a safety car is information you genuinely cannot get by looking.
  $('scLight').style.display = race.safety > 0 ? '' : 'none';

  // ---- the tower ---------------------------------------------------------
  // Eight times a second, not sixty. Twenty-two rows of four text nodes is a
  // real cost at frame rate and gaps do not change fast enough to notice.
  towerAcc += dt;
  if (towerAcc > 0.125) {
    towerAcc = 0;
    if (!towerRows) buildTower(race);
    const st = race.standings;
    for (let i = 0; i < st.length; i++) {
      const e = st[i], r = towerRows[i];
      const [cls, gap] = rowText(race, e, i);
      r.pos.textContent = i + 1;
      r.chip.style.background = e.col;
      r.name.textContent = e.name;
      r.gap.textContent = gap;
      r.gap.className = cls;
      r.d.className = 'trow' + (e.isPlayer ? ' me' : '') + (e.retired ? ' out' : '');
    }
  }

  // ---- and the end of it -------------------------------------------------
  // Crossing the line yourself is NOT the end of the race, so it does not put a
  // screen over it: you watch the rest of the field come home, which is half of
  // what finishing third is. The results appear when the race is actually over,
  // or straight away if you are out of it — and while you sit there retired,
  // they keep updating, because the race is still going on without you.
  //
  // Retiring does NOT put a screen over it either. Your race ends where the car
  // stops: the camera stays on it, it sits there in the gravel with its wing
  // off, and the rest of them go past. Adam's word for it was "let it sink
  // in", and a results table thrown up two seconds later is the exact opposite
  // of that. Escape still reloads if you have had enough.
  if (race.state === 'over') {
    if (!state.shown) { state.shown = true; state.resAcc = 0; showResults(); }
    else if ((state.resAcc += dt) > 0.5) { state.resAcc = 0; showResults(); }
  }
}

function showResults() {
  const race = state.race, me = state.me;
  $('resTitle').innerHTML = me.retired ? 'RACE <span>OVER</span>' : 'CHEQUERED <span>FLAG</span>';
  $('resSub').textContent = me.retired
    ? 'you did not make the finish'
    : `P${me.pos} of ${race.entries.length}` +
      (me.bestLap ? ` · best lap ${fmt(me.bestLap)}` : '') +
      (me.penalty ? ` · ${me.penalty}s of penalties` : '');
  $('resTable').innerHTML = race.standings.map((e, i) => {
    const [cls, gap] = rowText(race, e, i);
    const best = e.bestLap ? `<u style="color:#6c7687;font-size:10px">${fmt(e.bestLap)}</u>` : '';
    const pen = e.penalty ? ` <u style="color:var(--warn)">+${e.penalty}s</u>` : '';
    return `<div class="trow${e.isPlayer ? ' me' : ''}${e.retired ? ' out' : ''}">` +
      `<b>${i + 1}</b><i style="background:${e.col}"></i>` +
      `<span>${e.name}${pen} ${best}</span>` +
      `<em class="${cls}">${gap}</em></div>`;
  }).join('');
  $('results').classList.remove('hidden');
}

// Rejoin, for when you are beached in a gravel trap and the race is still
// going. Same thing race.js does for a stuck bot: put the car back on the
// racing line a little way behind where it stopped, pointing the right way, at
// a speed you could plausibly have rejoined at. It does NOT repair anything.
function rejoin() {
  const { track, line, me } = state;
  const car = me.car;
  const s = me.proj.s - 12;
  const p = track.point(s, line.off[track.idx(s)] || 0);
  car.x = p.x; car.y = p.y; car.hdg = p.hdg;
  car.vx = 10; car.vy = 0; car.r = 0;
  car.z = 0; car.vz = 0; car.pitch = 0; car.roll = 0; car.pRate = 0; car.rRate = 0;
  car.airborne = false; car.onRoof = false;
  me.stuck = 0;
}

// ---------------------------------------------------------------------------
hands.attach();
// Phone wheel: the pairing card (code + QR) sits under the key help on the
// menu, and a connect or drop mid-session says so on screen.

// ---------------------------------------------------------------------------
// What the dash gets. This is the ONLY place that decides what the iPad knows,
// and it reads the same state the screen does, so the two can never disagree.
// Called 15x a second by js/dash.js; the tower is stripped out of most of
// those frames on the way (22 rows of strings do not change at 15 Hz).
// ---------------------------------------------------------------------------
function dashTelemetry() {
  const car = state.car;
  if (!car) return null;
  const race = state.race, me = state.me, box = state.box;
  const t = {
    spd: car.speed * 3.6,
    gLat: car.gLat,
    thr: car.throttle,
    brk: car.brake,
    slipF: car.slipF,
    slipR: car.slipR,
    peak: state.peak,
    tf: car.tyre && car.tyre.Tf,
    tr: car.tyre && car.tyre.Tr,
    lapT: state.lapT,
    last: state.last,
    best: state.best,
    invalid: !!state.invalid,
    drs: !!car.drsOpen,
    pad: !!hands.usingPad,
    track: state.trackName || (state.track && state.track.name) || '',
    car: state.carName || '',
  };
  if (box) { t.gear = box.gear; t.rpm = box.rpm; t.rpmMax = box.box && box.box.limit; }
  t.sel = car.selector;

  if (race && me) {
    t.lap = Math.min(race.laps, me.lap + 1);
    t.laps = race.laps;
    t.pos = me.retired ? 'DNF' : me.pos;
    t.box = !!(me.pitRequest || me.inPit);
    t.sc = race.safety > 0;
    t.tower = race.standings.map((e, i) => ({
      p: i + 1, n: e.name, col: e.col, you: !!e.isPlayer, g: rowText(race, e, i)[1],
    }));
  } else {
    t.lap = Math.max(1, state.lap);
  }
  return t;
}

startDash({ getTelemetry: dashTelemetry });
mountDashCard(document.querySelector('#menu .keys'));
{
  let was = false;
  onDash(d => {
    if (d.connected !== was && state.started) toast(d.connected ? 'DASH CONNECTED' : 'DASH LOST');
    was = d.connected;
  });
}

// The URL pre-selects the menu rather than bypassing it, so ?race=1 on its own
// opens the menu with RACE already chosen and every setting visible — which is
// also how you find out that a headless run and a human run set up the same
// session. A flag that only works down the automated path is a flag nobody
// tests.
const Q = new URLSearchParams(location.search);
loadMenu();   // before the URL, so ?race= and friends still win
if (Q.has('race')) pickMode = Q.get('race') === '0' ? 'hotlap' : 'race';
if (Q.has('grid')) pickGrid = Math.max(2, Math.min(22, +Q.get('grid') || 22));
if (TIERS[Q.get('tier')]) pickTier = Q.get('tier');
if (Q.has('laps')) pickLaps = Math.max(1, Math.min(60, +Q.get('laps') || 3));

buildMenu();
$('go').onclick = start;
$('resBack').onclick = () => location.reload();

// Test hook: ?auto=monza:f1 boots straight into a session. It exists so a
// headless browser can prove the page actually runs without a human clicking
// anything — the menu is not where the bugs live.
const auto = Q.get('auto');
if (auto !== null) {
  const [t, c] = auto.split(':');
  if (t) pickTrack = t;
  if (c) pickCar = c;
  start();
}
