// attract.js — the director of the race behind the home page (?attract=1).
//
// Adam, 2026-10-03: "make the pov rotate between, and make things happen to
// keep them interesting". Two bots lapping in formation is a screensaver; this
// cuts between cameras and, every so often, makes something HAPPEN: a spin, a
// lunge down the inside, a hop over a kerb that was not there. Then it mends
// both cars, because the backdrop must never end up parked in a wall.
//
// It is a show, not a race: none of this runs outside ?attract=1, and what it
// does to a car (a yaw kick, a shove, a launch) is deliberately not physics.
// What happened is published on window.__attractEvent for home.js to shout.
import { launch } from './physics.js';

// [camera mode, seconds]: CHASE, T-CAM, ONBOARD, CHASE, TV, NOSE (render.js CAMS)
const CUTS = [[1, 8], [4, 6], [0, 6], [1, 7], [3, 5], [2, 5]];
const pick = a => a[Math.floor(Math.random() * a.length)];

export function makeDirector(race, view, me) {
  let cut = 0, cutT = CUTS[0][1], nextEvent = 10, mendAt = Infinity, stuckT = 0;
  const rival = () => race.entries.find(e => e !== me);
  const say = (text, kind) => { window.__attractEvent = { text, kind, at: performance.now() }; };
  const mend = car => {
    car.damage = 0; car.crush = { front: 0, rear: 0, left: 0, right: 0 }; car.dents = []; car.lost = null;
  };
  const EVENTS = [
    // the car in front loops it
    () => { const a = me.pos < rival().pos ? me : rival(); a.car.r += (Math.random() < 0.5 ? -1 : 1) * 3.4; say(`${label(a)} SPINS!!`, 'spin'); },
    // the car behind gets a shove and goes for it
    () => { const b = me.pos > rival().pos ? me : rival(); b.car.vx += 14; say(`${label(b)} SENDS IT DOWN THE INSIDE`, 'lunge'); },
    // both get air
    () => { for (const e of race.entries) launch(e.car, e.car.spec.m * (3.2 + Math.random() * 1.6), 0.25, 0); say('AIRBORNE. BOTH OF THEM. WHY.', 'air'); },
    // the leader has a wobble, the other closes right up
    () => { const a = me.pos < rival().pos ? me : rival(); a.car.vx *= 0.72; a.car.r += 0.9; say(`${label(a)} HAS A MOMENT`, 'wobble'); },
  ];
  const label = e => e === me ? 'THE BOT IN YOUR SEAT' : e.name;
  return function tick(dt) {
    // cameras
    if ((cutT -= dt) <= 0) {
      cut = (cut + 1) % CUTS.length;
      cutT = CUTS[cut][1];
      view.setMode(CUTS[cut][0]);
    }
    if (race.lights > 0 || !rival()) return;       // nothing happens on the grid
    // things happen: only at speed and on the ground, so they read as racing
    if ((nextEvent -= dt) <= 0) {
      const ok = race.entries.every(e => e.car.speed > 22 && !e.car.airborne && !e.inPit);
      if (ok) { pick(EVENTS)(); nextEvent = 16 + Math.random() * 14; mendAt = 7; view.setMode(1); cut = 0; cutT = 7; }
      else nextEvent = 2;
    }
    if ((mendAt -= dt) <= 0) { mendAt = Infinity; for (const e of race.entries) mend(e.car); }
    // a car that is parked, upside down or out of the race ends the show: run it again
    const dead = race.entries.some(e => e.retired || e.car.onRoof) || race.entries.every(e => e.car.speed < 2);
    stuckT = dead ? stuckT + dt : 0;
    if (stuckT > 6) location.reload();
  };
}
