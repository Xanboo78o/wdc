// autopilot.js — the driver. One of these runs the player's rivals, and one of
// them is the regression gate that proves the physics is drivable at all.
//
// It drives the SAME physics the player does: same tyres, same aero, same dirty
// air, same friction circle. No bot gets a speed cheat. Skill is a budget —
// what fraction of the available grip a driver dares to use, how accurately
// they place the car, and how often they get it wrong.
//
// Pure: no renderer, no DOM.
//
// THE TWO LESSONS THIS FILE IS BUILT OUT OF (do not undo either):
//
// 1. A controller is not a 400 Hz servo. The first version recomputed steering
//    every physics substep and fed it a countersteer gain of 1.5; the tracer
//    caught the rack flipping -1.7 deg -> +3.9 -> -5.5 in two tenths with slip
//    diverging 4 -> 6 -> 8 -> 11 -> 15 -> 22 -> 30. A tank-slapper. Fixed by a
//    fixed control rate, a finite rack slew rate, and a small gain.
//
// 2. Brakes and steering spend the SAME grip. The second version braked at
//    1.0 while turning into Monza's first chicane and the rear let go every
//    lap at small steering angles — the trace showed rear slip climbing
//    1.0 -> 2.6 -> 4.0 -> 5.8 -> 6.5 deg with the wheel almost straight. The
//    pedals now spend a friction-circle budget. That is trail braking, and it
//    is the single biggest thing separating a lap time from a spin.
import { steerLock } from './input.js';

// ---------------------------------------------------------------------------
// Difficulty. `line: 'centre'` is the interesting one — SUPERCASUAL drivers are
// competent (they brake correctly, they stay on the road, they catch slides)
// and slow for one honest reason: they do not know where the racing line is.
// You can watch them take the wrong path through Lesmo.
// ---------------------------------------------------------------------------
// How much of the tyre this controller can actually USE, per circuit and per
// car, MEASURED by tools/ceiling.mjs rather than guessed. Above these numbers
// the bot overdrives every corner and gets SLOWER, which is not an intuitive
// failure and cost two rounds of hand-tuning before the sweep existed.
//
// Monaco in an F1 car is the hardest thing here; Baku is the most forgiving.
// Re-run `node tools/ceiling.mjs all f1` after any physics change — if the
// physics gets easier to drive, these are free lap time left on the table.
const CEILING = {
  monza:     { f4: 0.84, f1: 0.84 },
  zandvoort: { f4: 0.84, f1: 0.88 },
  suzuka:    { f4: 0.88, f1: 0.92 },
  monaco:    { f4: 0.84, f1: 0.78 },
  baku:      { f4: 0.88, f1: 0.95 },
};
const ceilingFor = (track, spec) => CEILING[track.key]?.[spec.key] ?? 0.82;

// What fraction of its grip a driver re-solves at once the front wing is gone.
// This is a FIRST MEASURED VALUE, not a swept optimum: 0.78 was picked as a
// plausible "the car has lost its front end" number and then measured — see
// makeAutopilot for what it did. Nobody has tried 0.70 or 0.86 yet, and
// tools/fieldcheck.mjs is the thing to try them with.
const WINGLESS_GRIP = 0.78;

// `gripFrac` is a fraction of THAT ceiling, and it is the only thing that sets
// pace. It re-solves the speed profile rather than scaling it, so a slower tier
// is slower where a slower driver actually is — in the corners — and still
// reaches the same speed down the straight.
//
// Two earlier versions got this wrong in opposite directions. The first asked
// HARD for 98% of the ideal line, which does not make a fast bot, it makes a
// bot that crashes: HARD finished slowest of the four. The second scaled the
// target speed by skill, which quietly capped everyone's top speed 70 km/h
// below the drag limit.
export const TIERS = {
  supercasual: { name: 'SUPERCASUAL', line: 'centre', gripFrac: 0.76, spread: 0.035, consistency: 0.55, aggression: 0.20, defence: 0.25, mistakes: 2.2, place: 0.55 },
  casual:      { name: 'CASUAL',      line: 'race',   gripFrac: 0.84, spread: 0.030, consistency: 0.62, aggression: 0.38, defence: 0.42, mistakes: 1.5, place: 0.70 },
  medium:      { name: 'MEDIUM',      line: 'race',   gripFrac: 0.93, spread: 0.020, consistency: 0.78, aggression: 0.58, defence: 0.62, mistakes: 0.7, place: 0.86 },
  hard:        { name: 'HARD',        line: 'race',   gripFrac: 1.00, spread: 0.012, consistency: 0.92, aggression: 0.80, defence: 0.85, mistakes: 0.22, place: 0.97 },
};

function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// One driver's personality. Seeded, so a grid is reproducible for the harness
// and still different every seed.
export function makeDriver(seed, tierKey = 'medium', nCorners = 24) {
  const T = TIERS[tierKey] || TIERS.medium;
  const rng = mulberry(seed * 7919 + 13);
  // Per-corner strength. Real drivers are better at some corners than others,
  // and that — not random speed noise — is what makes gaps breathe and battles
  // start on their own. A grid where everyone loses time in the same place
  // never produces a race.
  const corner = new Float32Array(nCorners);
  for (let i = 0; i < nCorners; i++) corner[i] = 1 + (rng() - 0.5) * (1 - T.consistency) * 0.10;
  return {
    tier: tierKey, T,
    // A fraction of the circuit's ceiling. The ceiling itself is applied in
    // makeAutopilot, because only it knows which track and which car.
    gripFrac: Math.max(0.4, T.gripFrac + (rng() - 0.5) * T.spread),
    aggression: Math.min(1, T.aggression * (0.7 + rng() * 0.6)),
    defence: Math.min(1, T.defence * (0.7 + rng() * 0.6)),
    consistency: T.consistency,
    place: T.place,
    tyreCare: 0.3 + rng() * 0.7,
    corner, rng,
    noise: 0, noiseT: 0,
    mistake: null, nextMistake: 6 + rng() * 40,
    lastMove: 0, movedAt: -999,
  };
}

export function makeAutopilot(track, lines, spec, peak, opt = {}) {
  const cfg = {
    hz: 120,           // control rate. The sim runs at 400; a driver does not.
    kCross: 3.2,       // lateral-error gain
    kYaw: 0.030,       // yaw-rate damping — gentler than an angle correction
    kCounter: 0.40,    // countersteer gain on EXCESS rear slip
    rackRate: 6.0,     // rad/s slew limit on the rack
    ...Object.fromEntries(Object.entries(opt).filter(([, v]) => v !== undefined)),
  };
  const d = cfg.driver || makeDriver(1, cfg.tier || 'hard', track.corners.length || 24);
  // Resolve this driver's actual grip against the circuit's measured ceiling,
  // and record it on the driver so the harness reports the same number the
  // controller is driving. `gripOverride` is for measurement runs only.
  d.grip = d.gripOverride ?? Math.max(0.35, Math.min(1.05, d.gripFrac * ceilingFor(track, spec)));
  // The profile is solved at THIS driver's grip, so pace differences live in
  // the physics rather than in a speed multiplier.
  let line = lines.at(d.T.line, d.grip);

  // ---- and what happens when the car changes underneath the driver --------
  // Losing a front wing costs 56% of the front downforce. Until this existed
  // the driver never noticed: it kept aiming at corner speeds that needed a
  // wing it no longer had, understeered off, hit something, and retired.
  //
  // That is not a theory. `tools/fieldcheck.mjs`, four circuits x four seeds:
  // 4.81 cars per race lost a front wing and 4.38 of them retired — about
  // ninety percent — and those were sixty percent of ALL retirements. It is
  // the single biggest thing emptying a twenty-two car grid.
  //
  // The fix is the one this file is already built on. A driver with less grip
  // is not a fast driver with the speed turned down; they are a driver whose
  // speed profile was solved at less grip. So re-solve it, once, the moment the
  // wing goes: corner speeds fall, and the straights, which are drag-limited,
  // do not. The real answer is a pit stop for a new nose. This is what a driver
  // does on the lap before one — drives the car they actually have.
  //
  // Measured, same four circuits and four seeds, before and after:
  //   retired 7.25 -> 5.25 of 22     of the wingless, 91% -> 56%
  //   passes    104 ->  100          contacts 255 -> 247
  // Retirements down 28% and the overtaking did not move, which is the shape a
  // change has to have here — a grid can always be made to stop crashing by
  // making it stop racing.
  let wingless = false;

  let acc = 1e9, want = 0, thr = 0, brk = 0;
  let info = { need: 0, err: 0, cross: 0, budget: 1, mistake: null };
  // `ctx` is racecraft, decided by whoever knows the running order — which is
  // never this file. It carries a lateral bias in metres (move off the line to
  // attack or defend) and an optional speed cap (do not drive into the back of
  // someone). Keeping it out here means the autopilot stays a driver and the
  // race layer stays the rulebook.
  return function drive(car, proj, dt, ctx = null) {
    acc += dt;
    if (acc < 1 / cfg.hz) {
      const max = cfg.rackRate * dt;
      car.delta += Math.max(-max, Math.min(max, want - car.delta));
      car.throttle = thr; car.brake = brk;
      return info;
    }
    acc = 0;
    const v = car.speed;
    const i = proj.i;
    const idxAt = m => track.idx(proj.s + m);

    // One test at 120 Hz, and one solve in the life of a damaged car. It cannot
    // be un-noticed, because the wing does not come back.
    if (!wingless && car.lost && car.lost.frontWing) {
      wingless = true;
      line = lines.at(d.T.line, Math.max(0.35, d.grip * WINGLESS_GRIP));
    }

    // ---- mistakes: scheduled, with consequences ---------------------------
    // Not jitter. A real error is a lockup, a missed apex, or a snap on exit,
    // and it costs time because the physics makes it cost time.
    d.nextMistake -= 1 / cfg.hz;
    if (d.nextMistake <= 0 && !d.mistake && v > 20) {
      const r = d.rng();
      d.mistake = { kind: r < 0.45 ? 'lock' : r < 0.8 ? 'wide' : 'snap', t: 0.35 + d.rng() * 0.5 };
      d.nextMistake = (60 / Math.max(0.05, d.T.mistakes)) * (0.5 + d.rng());
    }
    if (d.mistake && (d.mistake.t -= 1 / cfg.hz) <= 0) d.mistake = null;

    // ---- where do I want to be, laterally? --------------------------------
    // Everything about racecraft is a change to this one number, which is why
    // the controller is built around it rather than around a fixed path.
    let wantOff = line.off[i] + (ctx?.offBias || 0);
    if (d.mistake?.kind === 'wide') wantOff += Math.sign(line.cur[i] || 1) * -1.6;
    const lim = Math.max(0.3, track.w[i] - 1.0);
    wantOff = Math.max(-lim, Math.min(lim, wantOff));

    // Off the road and slow: aim short and sharp to get back on, or the car
    // ploughs round in the gravel forever.
    const lost = Math.abs(proj.lat) > proj.w && v < 22;

    // ---- steering ---------------------------------------------------------
    // Stanley on lateral error, with a SHORT preview. A long preview lets the
    // heading term see a whole corner's worth of rotation and apply near-full
    // lock on entry, which turns in early and cuts to the inside wall.
    const prev = Math.round(Math.min(8, spec.a + 1 + v * 0.055) / track.ds);
    const j = track.idx((i + prev) * track.ds);
    const ff = Math.atan(spec.L * (line.cur[j] || 0));   // the steering the corner needs
    let hErr = line.hdg[j] - car.hdg;
    while (hErr > Math.PI) hErr -= 2 * Math.PI;
    while (hErr < -Math.PI) hErr += 2 * Math.PI;
    const cross = proj.lat - wantOff;                    // + = left of where I want to be
    const K = lost ? 1.6 : cfg.kCross * (0.6 + 0.4 * d.place);
    let delta = ff + hErr + Math.atan2(-K * cross, Math.max(v, 7));
    delta -= cfg.kYaw * car.r;                           // settle, don't weave

    // Catch oversteer on the EXCESS rear slip only. SIGN, because it costs an
    // afternoon: positive delta steers LEFT and the rear slip angle goes
    // NEGATIVE in a left-hand slide, so the catch ADDS sign(slipR)*excess.
    // Subtracting winds more lock INTO the slide — positive feedback.
    const over = Math.abs(car.slipR) - Math.abs(car.slipF);
    if (over > 0.03) delta += Math.sign(car.slipR) * Math.min(0.30, (over - 0.03) * 1.8 * cfg.kCounter / 0.40);

    // Past the front tyre's peak, MORE lock gives LESS grip — the curve is
    // falling. Clamp rather than scale: never allow the magnitude to grow.
    if (car.slipF < -peak) delta = Math.min(delta, car.delta);
    else if (car.slipF > peak) delta = Math.max(delta, car.delta);

    // human wobble, scaled by how consistent this driver is
    d.noiseT -= 1 / cfg.hz;
    if (d.noiseT <= 0) { d.noiseT = 0.25 + d.rng() * 0.5; d.noise = (d.rng() * 2 - 1) * (1 - d.consistency) * 0.045; }
    delta += d.noise;
    if (d.mistake?.kind === 'snap') delta += Math.sign(car.slipR || 1) * 0.04;

    const lock = steerLock(v);
    want = Math.max(-lock, Math.min(lock, delta));

    // ---- speed ------------------------------------------------------------
    // line.v is already brake-limited — line.js solved it with a proper
    // backward pass. Do NOT re-derive braking on top of it; two earlier
    // attempts did and both were wrong, the second badly enough to park the
    // car at 7 km/h in a chicane asking for 50.
    // Pace already lives in the profile. What is left here are the genuine
    // moment-to-moment modifiers — this corner is one of your weaker ones, the
    // tyres are going off, you are in someone's wake.
    let mod = 1;
    const c = track.cornerAt(proj.s);
    if (c) mod *= d.corner[c.n % d.corner.length];       // per-corner strength
    const wear = Math.max(car.tyre.wf, car.tyre.wr);
    mod *= 1 - 0.05 * wear * d.tyreCare;
    mod *= 1 - 0.17 * (car.dirty || 0);                  // no front wing in the wake
    if (car.drsOpen) mod *= 1.02;

    const look = Math.min(60, v * 0.30);
    let need = line.v[idxAt(look)] * mod;
    if (lost) need = Math.min(need, 13);                 // you cannot rejoin at 250 km/h
    if (ctx?.speedCap != null) need = Math.min(need, ctx.speedCap);

    const err = need - v;
    thr = err > 0.4 ? Math.min(1, err / 2.5) : 0;
    brk = err < -0.25 ? Math.min(1, -err / 1.5) : 0;

    // ---- the friction circle: brakes and steering spend the same grip ------
    // This is the trail-braking budget. Without it the driver asks for full
    // brake AND turn-in simultaneously, the rear runs out of grip at tiny
    // steering angles, and the car spins on entry to every slow corner.
    const g = 9.81;
    const q = 0.5 * spec.rho * v * v;
    const Fz = spec.m * g + q * spec.ClA;
    const grip = Math.min(car.muF ?? spec.mu, car.muR ?? spec.mu);
    const aMax = Math.max(4, grip * Fz / spec.m);
    // TRUE lateral load, not the body-frame derivative. car.ay is `Fy/m - vx*r`
    // and goes to ~zero in a steady corner, so reading it here told the budget
    // the car was barely cornering while it was pinned at 3 g — and it handed
    // the brakes a friction circle that was already spoken for.
    const aLat = Math.abs((car.gLat || 0) * 9.81);
    // How much of the circle is left once cornering has taken its share. A
    // braver driver leans closer to the edge of it; that is what `place` buys.
    const budget = Math.sqrt(Math.max(0, 1 - Math.min(1, (aLat / aMax) ** 2)));
    // A better driver uses more of what is LEFT — never more than exists. The
    // first version had this backwards, growing the allowance past the circle
    // with skill, so the quickest tier was the one permitted to overdrive
    // hardest and HARD finished slowest and most sideways of the four.
    // Braking is where the circle actually bit: the rear was being braked past
    // its grip at tiny steering angles. Throttle gets a much looser cap because
    // the physics already enforces a per-axle friction circle, and the reactive
    // cut below catches power oversteer — double-limiting it just made the
    // whole grid crawl out of every corner.
    brk = Math.min(brk, budget * (0.85 + 0.15 * d.place) + 0.10);
    thr = Math.min(thr, budget * 0.55 + 0.45);

    // The rear going away under braking is the specific failure this file was
    // rewritten for. Release when it starts, the way a driver does.
    if (over > 0.03) brk *= Math.max(0.25, 1 - (over - 0.03) * 5);
    if (over > 0.07) thr *= Math.max(0, 1 - (over - 0.07) * 5);
    if (d.mistake?.kind === 'lock') brk = Math.min(1, brk * 1.45 + 0.15);

    info = { need, err, cross, budget, mistake: d.mistake?.kind || null };

    const max = cfg.rackRate * dt;
    car.delta += Math.max(-max, Math.min(max, want - car.delta));
    car.throttle = thr; car.brake = brk;
    return info;
  };
}
