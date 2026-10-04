// engineer.js — the pit wall: what your engineer tells you, what the other
// drivers say on their radios, and what the stewards decide.
//
// Adam, 2026-09-25: hold the radio button and say "What's the gap?", "How's my
// fuel?", "OSCAR RAN ME OFF THE ROAD"; the engineer calls "box box" and
// "hammer time" when the strategy says so, uses code words you can set and
// give a meaning, tells you "you cut the corner, give those 2 places back to
// ____ and ____", and the bots have engineers too — they pit on strategy and
// report YOU for running them off the track.
//
// Everything with a number in it is answered HERE, from the race, instantly
// and exactly. A small language model asked "what's the gap" once told him he
// was fourth when he was not; it now gets only the questions nobody can
// compute (tools/radio.mjs, Ollama on his GPU). This file never speaks: it
// hands lines to `say(text, who)` and the radio (js/radio.js) voices them.
//
// Nothing here is in the physics. The fuel model is a strategy number the
// engineer tracks, not a weight the car carries.

// First names, because nobody shouts "PIASTRI RAN ME OFF" — they shout Oscar.
const FIRST = {
  oscar: 'PIASTRI', lando: 'NORRIS', max: 'VERSTAPPEN', charles: 'LECLERC', lewis: 'HAMILTON',
  george: 'RUSSELL', kimi: 'ANTONELLI', fernando: 'ALONSO', lance: 'STROLL', pierre: 'GASLY',
  franco: 'COLAPINTO', alex: 'ALBON', carlos: 'SAINZ', nico: 'HULKENBERG', gabriel: 'BORTOLETO',
  esteban: 'OCON', ollie: 'BEARMAN', oliver: 'BEARMAN', liam: 'LAWSON', isack: 'HADJAR',
  arvid: 'LINDBLAD', checo: 'PEREZ', sergio: 'PEREZ', valtteri: 'BOTTAS', yuki: 'TSUNODA',
};
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const nice = n => n ? n[0] + n.slice(1).toLowerCase() : n;
const tenths = v => {
  // "one point four" is what an engineer says; "1.4" is what a speech engine
  // mangles into "one dot four" half the time.
  const s = Math.max(0, v).toFixed(1);
  return s.startsWith('0') ? 'point ' + s.slice(2) : s.replace('.', ' point ');
};
const FUEL_PER_KM = 1.6;         // kg — an F1 car's real consumption
const OFF = 0.9;                 // metres past the white line that counts as off (main.js uses the same)
const GIVE_BACK = 25;            // seconds to hand the places back before it is a penalty
const LIMITS_WARN = 3, LIMITS_PEN = 4;

const DEFAULT_CODES = [
  { say: 'box box', means: 'box this lap' },
  { say: 'hammer time', means: 'push' },
];

// WHOSE RADIO IS THIS? Yours. (Adam, 2026-10-04: "other driver's radios are
// on mine ... when i crash into sum1, they say on my radio 'HE just crashed
// into me!! look into that!!' like bro".) The other drivers' first-person
// complaints and their engineers' "box box" used to be handed to the same
// radio as a caption — and read exactly like your own side accusing somebody
// of the thing you had just done. Only your engineer talks to you now; what
// another car does reaches you as information from him, never as their voice.
export const onMyRadio = who => who === 'ENGINEER' || who === 'YOU';

// A collision the stewards have just penalised: what your engineer says, if
// anything. Pure, so tools/radiocheck.mjs can ask it directly.
//   fault   'me' | 'them'      whose penalty it is
//   other   the other car's name (victim if it was you, culprit if it was them)
//   hitUs   them at fault: was it US they hit? (false = somebody else's crash)
export function collisionLines({ fault, other, hitUs }) {
  if (fault === 'me') {
    return [other ? `That contact with ${nice(other)} was on us. Five second penalty, causing a collision.`
      : 'Five second penalty for us. Causing a collision.'];
  }
  if (fault === 'them' && hitUs) return [`${nice(other)} has five seconds for hitting us.`];
  return [];                                   // not our incident: silence
}

export class Engineer {
  constructor({ say }) {
    this.say = say;
    this.codes = DEFAULT_CODES.slice();
    try {
      const saved = JSON.parse(localStorage.getItem('wdc.radioCodes') || 'null');
      if (Array.isArray(saved)) this.codes = saved;
    } catch { /* fine */ }
    this.race = null;
  }

  // ---------------------------------------------------------------- per race
  begin(race) {
    this.race = race;
    this.me = race.entries.find(e => e.isPlayer);
    const km = race.track.length / 1000;
    this.fuelLap = FUEL_PER_KM * km;
    this.fuel = this.fuelLap * (race.laps + 0.4);    // fills to finish, with 0.4 of a lap in hand
    this.seen = race.events.length;
    this.cool = {};                                   // per-call cooldowns (race seconds)
    this.off = null;                                  // an off-track in progress
    this.owed = null;                                 // places to give back
    this.limits = 0;
    this.near = new Map();                            // car idx -> last race time within 10 m of you
    this.probe = [];                                  // cars you were beside, to see if they go off
    this.lastLap = 0;
    this.lapWear = null;
    this.gapWas = null;
    this.pending = [];                                // [time, fn] — stewards take a moment
    this.stoppedFor = -1;                             // the pitStops count we called a box for
    this.lastCheer = -99; this.cheers = 0;            // your passes that stuck (cheer)
  }

  // ------------------------------------------------------------ every frame
  tick(dt) {
    const r = this.race, me = this.me;
    if (!r || !me) return;
    const t = r.time;
    for (const p of this.pending.splice(0)) (t >= p[0] ? p[1]() : this.pending.push(p));
    if (r.state !== 'green' || me.retired || me.finished) { this.events(); return; }
    const car = me.car;

    // fuel — distance, weighted by how hard the throttle is worked
    this.fuel = Math.max(0, this.fuel - FUEL_PER_KM / 1000 * car.speed * dt * (0.35 + 0.65 * (car.throttle || 0)) / 0.75);   // 0.75 = the burn at the 62% average throttle measured over a race

    this.lapTick();
    this.proximity(t);
    this.limitsTick(t);
    this.strategy(t);
    this.tail(dt, t);
    this.events();
  }

  // BUILDING (2026-09-28). Sat within 0.7 s of the same car for a while: the
  // engineer tells you it is coming, and where — which is the half of "building,
  // building" a driver cannot see from the cockpit. Rationed hard; this is
  // encouragement, not commentary.
  tail(dt, t) {
    const me = this.me, i = me.pos - 1, a = i > 0 ? this.race.standings[i - 1] : null;
    if (!a || a.inPit || a.retired) { this.tailOn = null; this.tailT = 0; return; }
    if (a !== this.tailOn) { this.tailOn = a; this.tailT = 0; }
    const gap = this.gapTo(a);
    if (gap < 0.7) this.tailT += dt; else if (gap > 1.3) this.tailT = 0;
    if (this.tailT > 25 && this.ready('tail', 75)) {
      const drs = this.race.drsRule && me.lap >= 1;
      const lines = [
        `Good, stay with ${nice(a.name)}. You are quicker. Be patient, it will come.`,
        drs ? `Keep it inside the second for the DRS. ${nice(a.name)} is struggling.` : `${nice(a.name)} is struggling on the exits. Get a good one and take the tow.`,
        `He is defending the inside everywhere. Better exit, then the outside.`,
      ];
      this.call(lines[(this.tailN = (this.tailN || 0) + 1) % lines.length]);
      this.tailT = 0;
    }
  }

  lapsLeft() { return this.race.laps - this.me.lap; }

  lapTick() {
    const me = this.me, left = this.lapsLeft();
    if (me.lap === this.lastLap) return;
    this.lastLap = me.lap;
    const w = this.wear();
    if (this.lapWear != null) this.wearPerLap = Math.max(0.001, w - this.lapWear);
    this.lapWear = w;
    if (me.lap === 1 && this.race.drsRule && left > 1) this.call('DRS enabled.');
    else if (left === 2) this.call('Two laps to go.');
    else if (left === 1) this.call('Last lap. Bring it home.');
  }

  wear() { const ty = this.me.car.tyre; return ty ? Math.max(ty.wf, ty.wr) : 0; }

  // A code word the driver defined for this meaning, or the standard one.
  code(meaning) {
    const c = this.codes.find(x => x.means.toLowerCase().includes(meaning));
    return c ? c.say : null;
  }
  shout(meaning, fallback) {
    const w = this.code(meaning) || fallback;
    const cap = w[0].toUpperCase() + w.slice(1);
    return `${cap}, ${w}.`;
  }

  call(text, who = 'ENGINEER') { if (onMyRadio(who)) this.say(text, who); }
  ready(key, gap) {
    const t = this.race.time;
    if (t < (this.cool[key] || -1e9)) return false;
    this.cool[key] = t + gap;
    return true;
  }

  // -------------------------------------------------------------- strategy
  strategy(t) {
    const me = this.me, car = me.car, left = this.lapsLeft();
    // BOX: damage, a lost wing, or tyres past their life with laps to use new ones.
    if (!me.inPit && !me.pitRequest && this.stoppedFor !== me.pitStops && left >= 2) {
      const wing = car.lost && (car.lost.frontWing || car.lost.rearWing);
      const why = wing ? `We'll change the ${car.lost.frontWing ? 'front' : 'rear'} wing.`
        : (car.damage || 0) > 0.35 ? 'We have damage, we need to look at it.'
        : this.wear() > 0.8 ? 'Those tyres are finished.'
        : null;
      if (why) {
        this.stoppedFor = me.pitStops;
        me.pitRequest = true;
        this.call(`${this.shout('box', 'box box')} ${why}`);
      }
    }
    // HAMMER TIME: close to the car ahead and closing, late in the race or
    // with the car ahead on old tyres. Calculated, and then rationed.
    const i = me.pos - 1, ahead = i > 0 ? this.race.standings[i - 1] : null;
    if (ahead && !ahead.inPit) {
      const gap = this.gapTo(ahead);
      const closing = this.gapWas != null && gap < this.gapWas - 0.02;
      this.gapWas = gap;
      const theirs = ahead.car.tyre ? Math.max(ahead.car.tyre.wf, ahead.car.tyre.wr) : 0;
      if (gap < 1.2 && closing && (left <= 3 || theirs > this.wear() + 0.15) && this.ready('hammer', 150)) {
        this.call(`${this.shout('push', 'hammer time')} ${nice(ahead.name)} is ${tenths(gap)} ahead${theirs > this.wear() + 0.15 ? ' on old tyres' : ''}.`);
      }
    }
  }

  gapTo(o) {
    const r = this.race;
    return Math.abs(r.progress(o) - r.progress(this.me)) / Math.max(this.me.car.speed, 14);
  }

  // ----------------------------------------------------- track limits, cuts
  limitsTick(t) {
    const me = this.me, p = me.proj;
    if (!p || me.inPit) return;
    const w = this.race.track.w[this.race.track.idx(p.s)];
    const out = Math.abs(p.lat) > w + OFF;
    if (out && !this.off) {
      // Who was ahead of you, and where, the moment you left the track.
      this.off = { t, pos: me.pos, s: p.s, ahead: new Set(this.race.standings.slice(0, me.pos - 1).map(e => e.idx)) };
    } else if (!out && this.off && t - this.off.t > 0.3) {
      const o = this.off; this.off = null;
      const gained = this.race.standings.filter(e => o.ahead.has(e.idx) && e.pos > me.pos && !e.inPit && !e.retired);
      const where = this.race.track.cornerAt(o.s)?.name || 'that corner';
      if (gained.length) {
        this.owed = { until: t + GIVE_BACK, who: gained.map(e => e.idx), where };
        const names = gained.map(e => nice(e.name));
        const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
        this.call(`You cut ${where}. Give ${gained.length > 1 ? `those ${gained.length} places` : 'that place'} back to ${list}.`);
      } else {
        this.limits++;
        if (this.limits === LIMITS_WARN) this.call('Black and white flag. Track limits, careful.');
        else if (this.limits >= LIMITS_PEN) {
          this.penalise(5, 'TRACK LIMITS');
          this.call('Five second penalty. Track limits.');
        }
      }
    }
    if (this.owed) {
      const still = this.owed.who.filter(ix => { const e = this.race.entries[ix]; return e && !e.retired && !e.inPit && e.pos > me.pos; });
      if (!still.length) { this.owed = null; this.call('Thank you. That is fine now.'); }
      else if (t > this.owed.until) {
        const where = this.owed.where;
        this.owed = null;
        this.penalise(5, `LEAVING THE TRACK AND GAINING AN ADVANTAGE at ${where}`);
        this.call('We have a five second penalty. Leaving the track and gaining an advantage.');
      }
    }
  }

  penalise(sec, why, e = this.me) {
    e.penalty += sec;
    this.race.log('penalty', `${e.name} +${sec}s ${why}`, e);
    this.seen = this.race.events.length;   // our own entry, not news
  }

  // ------------------------------------------ who ran whom off the road
  proximity(t) {
    const me = this.me, mc = me.car;
    for (const e of this.race.entries) {
      if (e === me || e.retired || e.inPit) continue;
      const d = Math.hypot(e.car.x - mc.x, e.car.y - mc.y);
      if (d < 10) this.near.set(e.idx, t);
      // Beside you and still on the road: watch whether it goes off.
      if (d < 6 && e.proj && this.onTrack(e) && !this.probe.some(p => p.idx === e.idx)) {
        this.probe.push({ idx: e.idx, until: t + 2.5, pos: e.pos });
      }
    }
    this.probe = this.probe.filter(p => {
      const e = this.race.entries[p.idx];
      if (!e || t > p.until) return false;
      if (!this.onTrack(e) && this.onTrack(me)) {
        // It left the road next to you, and you did not. Its driver reports
        // you — on ITS radio. What you hear is your engineer (stewards()).
        if (this.ready('complain' + p.idx, 40)) {
          this.stewards(e, me, 9, 'FORCING ANOTHER DRIVER OFF THE TRACK', p.pos);
        }
        return false;
      }
      return true;
    });
  }

  onTrack(e) {
    const tr = this.race.track;
    return e.proj && Math.abs(e.proj.lat) <= tr.w[tr.idx(e.proj.s)] + OFF;
  }

  // The stewards look, then decide. `culprit` is punished if the victim lost
  // the place to them (or was just behind), otherwise no further action.
  stewards(victim, culprit, delay, why, victimPosBefore) {
    const t = this.race.time;
    if (culprit === this.me) this.call(`The stewards are looking at the incident with ${nice(victim.name)}.`);
    this.pending.push([t + delay, () => {
      const lost = victim.pos > (victimPosBefore ?? victim.pos);
      const guilty = lost || Math.random() < 0.35;
      if (guilty) {
        this.penalise(5, why, culprit);
        if (culprit === this.me) this.call(`Five second penalty for us, for ${why.toLowerCase().replace(/ at .*/, '')}.`);
        else this.call(`${nice(culprit.name)} has a five second penalty for that.`);
      } else {
        this.call(`No further action on the ${nice(victim === this.me ? culprit.name : victim.name)} incident.`);
      }
    }]);
  }

  // -------------------------------------- the race log, told as radio
  events() {
    const r = this.race;
    for (; this.seen < r.events.length; this.seen++) {
      const ev = r.events[this.seen];
      const e = ev.car != null ? r.entries[ev.car] : null;
      if (!e) continue;
      if (ev.kind === 'flag' && / WILL PIT$/.test(ev.text) && !e.isPlayer) {
        // Their engineer calls them in on THEIR radio; what is yours to hear
        // is the undercut threat, from your own engineer.
        const me = this.me;
        if (me && Math.abs(e.pos - me.pos) === 1 && this.ready('undercut', 60)) {
          this.call(e.pos < me.pos ? `${nice(e.name)} is pitting. Push now, we go long.` : `${nice(e.name)} is pitting behind. Watch the undercut.`);
        }
      }
      if (ev.kind === 'penalty' && /CAUSING A COLLISION/.test(ev.text)) {
        // The penalty is logged against the car at FAULT. Yours: the engineer
        // owns it. Theirs: only if it was us they hit.
        const lines = e.isPlayer
          ? collisionLines({ fault: 'me', other: this.closest()?.name })
          : collisionLines({ fault: 'them', other: e.name,
              hitUs: this.near.get(e.idx) > r.time - 1.5 && this.closestTo(e) === this.me });
        for (const line of lines) this.call(line);
      }
      if (ev.kind === 'pass' && e.isPlayer) {
        const c = r.cheers && r.cheers.find(x => x.t === ev.t);
        if (c) this.cheer(c);
      }
      if (ev.kind === 'crash' && / RETIRES$/.test(ev.text) && !e.isPlayer && this.ready('retire', 20)) {
        this.call(`${nice(e.name)} is out of the race.`);
      }
    }
  }

  // THE PASS THAT STUCK (race.js cheerTick). Adam, 2026-09-28: "FINALLY
  // overtaking and its a celebration". An engineer who has watched you sit on
  // someone's gearbox for two laps does not say "position gained" — he loses
  // it a little. Two in quick succession get a short one, not a speech.
  cheer(c) {
    // Places you were told to give back are not passes.
    if (this.owed && this.owed.who.includes(c.idx)) return;
    // A lap-one scramble or a double move lands several at once: one call,
    // a beat after the last of them, not three stacked in the queue.
    (this.cheerQ || (this.cheerQ = [])).push(c);
    if (this.cheerQ.length > 1) return;
    this.pending.push([this.race.time + 1.2, () => this.cheerSay()]);
  }

  cheerSay() {
    const q = this.cheerQ || [];
    this.cheerQ = [];
    if (!q.length) return;
    const c = q[q.length - 1], pos = this.me.pos, name = nice(c.name);
    const t = this.race.time, again = t - (this.lastCheer ?? -99) < 10;
    this.lastCheer = t;
    this.cheers = (this.cheers || 0) + 1;
    let line;
    if (pos === 1) line = again ? 'And that is the lead! P1!' : 'YES! P1! Get in there, you are leading the race!';
    else if (q.length > 1) line = `YES! ${q.length} cars in one go! P${pos}.`;
    else if (again) line = [`And another one! P${pos}.`, `Two in a row! P${pos}.`][this.cheers % 2];
    else {
      const lines = [
        `YES! Get in there! Great move on ${name}. P${pos}.`,
        `Mega, mega. ${name} done, P${pos}.`,
        `That's it! Beautiful, beautiful move. P${pos}.`,
        `Yes mate! ${name} is behind you. P${pos}, keep it clean.`,
        `Get in! You earned that one. P${pos}.`,
      ];
      line = lines[this.cheers % lines.length];
    }
    this.call(line);
  }

  // Which car is nearest to `e` — the one it most likely hit.
  closestTo(e) {
    let best = null, bd = 1e9;
    for (const o of this.race.entries) {
      if (o === e || o.retired) continue;
      const d = Math.hypot(o.car.x - e.car.x, o.car.y - e.car.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  closest() {
    let best = null, bd = 1e9;
    for (const e of this.race.entries) {
      if (e === this.me) continue;
      const d = Math.hypot(e.car.x - this.me.car.x, e.car.y - this.me.car.y);
      if (d < bd) { bd = d; best = e; }
    }
    return bd < 12 ? best : null;
  }

  // ------------------------------------------------------ what you said
  /**
   * The driver's transmission. Returns the engineer's reply if it can be
   * answered here, or null for tools/radio.mjs to answer.
   */
  hear(raw) {
    const text = String(raw || '').toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const r = this.race, me = this.me;

    // A code word you define: "when I say pineapple it means box this lap".
    let m = text.match(/(?:when|if) i say (.+?) (?:it )?(?:means?|is) (.+)/);
    if (m) {
      const say = m[1].replace(/^the word /, '').trim(), means = m[2].trim();
      this.codes = this.codes.filter(c => c.say !== say && !(means.includes('box') && c.means.includes('box') && c.say !== 'box box')).concat([{ say, means }]);
      try { localStorage.setItem('wdc.radioCodes', JSON.stringify(this.codes)); } catch { /* fine */ }
      return `Copy. ${say[0].toUpperCase() + say.slice(1)} means ${means}.`;
    }
    // One of your code words, said back to the pit wall.
    const code = this.codes.find(c => text.includes(c.say));
    if (code) return this.act(code.means, code.say);

    if (!r || !me) return /radio check/.test(text) ? 'Loud and clear.' : null;

    // Someone ran you off: the stewards will look.
    const named = this.driverIn(text);
    if (named && /(ran|run|push|pushed|shoved|hit|crash|forced|off|penalty|divebomb|dive bomb|brake test|punted|took me out)/.test(text)) {
      const was = me.pos;
      const recent = (this.near.get(named.idx) ?? -99) > r.time - 25;
      if (!recent) return `Copy. We didn't see ${nice(named.name)} near you, but we'll pass it on.`;
      this.stewards(me, named, 8, `FORCING ${me.name} OFF THE TRACK`, was);
      return `Copy, we'll get the stewards to look at ${nice(named.name)}.`;
    }
    if (/\b(gap|ahead|behind|interval|how far|catching)\b/.test(text)) return this.gapLine();
    if (/\bfuel\b/.test(text)) return this.fuelLine();
    if (/\b(tyres?|tires?|grip|rubber|deg)\b/.test(text)) return this.tyreLine();
    if (/\b(position|where am i|what place|laps? (left|to go|remaining)|which lap)\b/.test(text)) {
      return `P${me.pos}. Lap ${Math.min(r.laps, me.lap + 1)} of ${r.laps}.`;
    }
    if (/\bstay out\b|\bno box\b|\bcancel\b/.test(text)) { me.pitRequest = false; return 'Copy, stay out, stay out.'; }
    if (/\b(box|pit)\b/.test(text)) return this.act('box this lap', null);
    if (/\bradio check\b/.test(text)) return 'Loud and clear.';
    return null;
  }

  act(means, word) {
    const me = this.me, lm = means.toLowerCase();
    if (/box|pit/.test(lm)) {
      if (me) { me.pitRequest = true; this.stoppedFor = me.pitStops; }
      return 'Copy, box this lap, box this lap.';
    }
    if (/push|hammer|attack|go/.test(lm)) return 'Copy. Everything you have got, this lap.';
    if (/save|conserve|manage|lift|coast/.test(lm)) return 'Copy, managing. Lift and coast into the braking zones.';
    if (/stay out|long/.test(lm)) { if (me) me.pitRequest = false; return 'Copy, staying out.'; }
    return `Copy. ${word ? word[0].toUpperCase() + word.slice(1) + ', ' : ''}${means}.`;
  }

  driverIn(text) {
    if (!this.race) return null;
    for (const [first, last] of Object.entries(FIRST)) {
      if (new RegExp(`\\b${first}\\b`).test(text)) { const e = this.race.entries.find(x => x.name === last); if (e) return e; }
    }
    const exact = this.race.entries.find(e => !e.isPlayer && new RegExp(`\\b${e.name.toLowerCase()}\\b`).test(text));
    if (exact) return exact;
    // Loosely: speech recognition spells "Piastri" as "piastry" or "pia streets".
    // A word within two edits of a surname (of five letters or more) counts.
    const words = text.replace(/\s+/g, ' ').split(' ');
    const joined = words.map((w, k) => w + (words[k + 1] || ''));
    let best = null, bd = 3;
    for (const e of this.race.entries) {
      if (e.isPlayer || e.name.length < 5) continue;
      const n = e.name.toLowerCase();
      for (const w of words.concat(joined)) {
        if (Math.abs(w.length - n.length) > 2) continue;
        const d = edits(w, n);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  gapLine() {
    const r = this.race, me = this.me, i = me.pos - 1;
    const a = i > 0 ? r.standings[i - 1] : null, b = r.standings[i + 1];
    const parts = [];
    if (a) parts.push(`${nice(a.name)} ahead, ${tenths(this.gapTo(a))}`);
    else parts.push('You are leading');
    if (b && !b.retired) parts.push(`${nice(b.name)} behind, ${tenths(this.gapTo(b))}`);
    return parts.join('. ') + '.';
  }

  // Laps of fuel in hand at the flag: what is in the tank against the exact
  // distance still to run — not whole laps, which read "short" all of lap one.
  spareLaps() {
    const r = this.race, L = r.track.length;
    const left = Math.max(0, r.laps * L - r.progress(this.me)) / L;
    return (this.fuel - this.fuelLap * left) / this.fuelLap;
  }

  fuelLine() {
    const spare = this.spareLaps();
    if (spare >= 0.25) return `Fuel is fine. Plus ${tenths(spare)} of a lap. Race him.`;
    if (spare >= -0.05) return 'Fuel is right on target. Save where you can.';
    return `We're ${tenths(-spare)} of a lap short. Lift and coast into the braking zones.`;
  }

  tyreLine() {
    const w = this.wear(), pct = Math.round(w * 100 / 1.0);
    const per = this.wearPerLap || 0;
    const life = per > 0 ? Math.max(0, (0.8 - w) / per) : null;
    if (w < 0.1) return 'Tyres are in good shape. No wear to speak of.';
    if (w > 0.8) return `Tyres are gone, ${pct} percent worn. Box when we call it.`;
    if (life != null && life < this.lapsLeft()) return `${pct} percent worn. Good for about ${Math.floor(life)} more laps.`;
    return `${pct} percent worn. They'll make the end.`;
  }

  /** What tools/radio.mjs is told, for the questions only a conversation can answer. */
  telemetry() {
    const r = this.race, me = this.me;
    if (!r || !me) return {};
    const i = me.pos - 1, a = i > 0 ? r.standings[i - 1] : null, b = r.standings[i + 1];
    return {
      position: me.pos, lap: Math.min(r.laps, me.lap + 1), laps: r.laps,
      ahead: a ? nice(a.name) : 'nobody, leading', gapAhead: a ? +this.gapTo(a).toFixed(1) : 0,
      behind: b ? nice(b.name) : 'nobody', gapBehind: b ? +this.gapTo(b).toFixed(1) : 0,
      tyreWearPct: Math.round(this.wear() * 100), fuelSpareLaps: +this.spareLaps().toFixed(1),
      damage: Math.round((me.car.damage || 0) * 100), penaltySeconds: me.penalty, pitStops: me.pitStops,
    };
  }
}
