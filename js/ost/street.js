// STREET CIRCUIT — Adam's own. Measured from data/tracks/street.json: 7.4 km
// between walls only 11 m apart, TWENTY-SEVEN corners, and its signature pair
// THE TWINS — two hairpins back to back (T6 185° at R12, then T7 175° at R18,
// 300 m apart, one right and one left). Then the circuit CLIMBS: 30 m from the
// low point at T6 to the crest at ~6.2 km, and drops off it at -6.4% into T26.
// So the fun song is stop-start and boxed in, and the twins are two slams,
// right then left. The less fun song is THE CLIMB: up the hill a step at a
// time, a breath at the crest, then the fall down the other side.

import { X, N, comp, bassline, arp, mel, midi } from '../ostkit.js';

// =============================================================================
// WALLS — the fun one. Rally house × pop-punk, 132, B♭ major. The riff is on
// the house organ (m1), staccato and boxed in; the drums stop and start like a
// lap of 27 corners; palm-muted chugs in the verse, open chords in the chorus.
// =============================================================================
const SV = ['Bb', 'F', 'Gm', 'Eb'];
const SC = ['Eb', 'Bb', 'F', 'Gm'];
const KICK = { f0: 180, f1: 50, sweep: 0.05, dec: 0.22, drive: 1.3, click: 0.6 };
const BOUNCE = [[2, 0, 1, 0.9], [6, 0, 1, 0.9], [10, 0, 1, 0.9], [14, 0, 1, 0.9]];
const BOUNCE_O = { cut: 1200, q: 2.2, fdec: 0.09 };
const CHUG = [0, 2, 3, 6, 8, 10, 11, 14].map((s, i) => [s, 0, 1, i % 4 === 0 ? 0.95 : 0.7, { mute: true }]);
const OPEN = [[0, 0, 3, 0.95], [3, 0, 3, 0.8], [6, 0, 4, 0.9], [10, 0, 2, 0.75], [12, 0, 4, 0.9]];
// the riff: Morse-code staccato on the organ, one bar
const RIFF = [[0, 'F5'], [2, 'F5'], [3, 'D5'], [6, 'F5'], [8, 'G5'], [10, 'F5'], [11, 'D5'], [14, 'C5']];
const riff = (vel, cut) => N('m1', RIFF.map(([s, n]) => [s, [midi(n), midi(n) - 12], 1, vel, cut ? { cut } : undefined]), 16);
const CM = [[0, 'G5', 2], [2, 'G5', 2], [4, 'Bb5', 4], [8, 'G5', 2], [10, 'F5', 2], [12, 'Eb5', 4],
  [16, 'D5', 2], [18, 'F5', 2], [20, 'F5', 4], [24, 'D5', 2], [26, 'Bb4', 2], [28, 'D5', 4],
  [32, 'C5', 2], [34, 'F5', 2], [36, 'A5', 4], [40, 'G5', 2], [42, 'F5', 2], [44, 'C5', 4],
  [48, 'D5', 8], [56, 'Bb4', 4], [60, 'G4', 4]];
// a twin: one slam, the downshift, the exhaust, and the throttle back on
const twin = (side, pan) => ({
  stab: mel('stab', 16, [[0, ['Bb3', 'F4', 'Bb4', 'D5'], 3, 1]]),
  chord: N(side, [[0, midi('Bb2'), 3, 1]], 16),
  boom: X('boom', 'x...............', { vel: 0.85 }),
  kick: X('kick', 'x...........x.x.', { vel: 1.05, o: KICK }),
  pops: X('antilag', '...x.....x......', { vel: 0.6, o: { n: 3 } }),
  down: mel('sub', 16, [[4, 'Bb2', 2, 0.7, { glide: 'F3' }], [6, 'F2', 2, 0.65, { glide: 'C3' }], [8, 'D2', 2, 0.65, { glide: 'A2' }]]),
  roll: X('snare', '..........x.xxxx', { vel: 0.65, o: { dec: 0.09, snap: 1, body: 0.4 } }),
});
const T1 = twin('dist2'), T2 = twin('dist');
const st = {
  kick: X('kick', 'x...x...x...x...', { o: KICK }),
  // stop-start: the kick drops out for a corner every other bar
  kickStop: X('kick', 'x...x...x...x...|x...x...x.......', { o: KICK }),
  kickIn: X('kick', '................|'.repeat(4) + 'x...x...x...x...|'.repeat(4), { o: KICK }),
  clap: X('clap', '....x.......x...', { vel: 0.85 }),
  punk: X('snare', '....x.......x...|....x.......x.xx', { vel: 0.9, o: { dec: 0.17, tone: 205, snap: 1, body: 0.7 } }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.85, o: { dec: 0.04 } }),
  hatSoft: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.5, o: { dec: 0.04 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.75, o: { dec: 0.15 } }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.6 }),
  rim: X('rim', '...x......x..x..', { vel: 0.5 }),
  cowbell: X('cowbell', '..........x.....|......x.......x.', { vel: 0.6, o: { dec: 0.18, f: 1100 } }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.6 }),
  roll: X('snare', '................|................|x...x...x...x...|x.x.x.x.xxxxxxxx', { vel: 0.6, o: { dec: 0.1, snap: 1, body: 0.4 } }),
  riser: X('riser', 'x...............|'.repeat(4), { vel: 0.4, o: { dur: 60 / 132 * 16 } }),
  bassV: bassline('hbass', SV, BOUNCE, 2, { o: BOUNCE_O }),
  bassC: bassline('hbass', SC, BOUNCE, 2, { o: BOUNCE_O }),
  subV: bassline('sub', SV, [[0, 0, 2, 0.55]], 2),
  subC: bassline('sub', SC, [[0, 0, 2, 0.55]], 2),
  riff: riff(0.85), riffV: riff(0.55, 2600), riffSoft: riff(0.45, 1300),
  chugV: bassline('dist', SV, CHUG.map(([s, i, l, v, e]) => [s, i, l, v * 0.7, e]), 2),
  openL: bassline('dist', SC, OPEN, 2),
  openR: bassline('dist2', SC, OPEN.map(([s, i, l, v]) => [s, i + 12, l, v * 0.85]), 2),
  chorus: mel('lead', 64, CM),
  chorusOct: N('pluck', CM.map(([s, n, l]) => [s, [midi(n) + 12], l, 0.35, { maxDur: 0.4 }]), 64, { lvl: 0.4 }),
  stabs: comp('stab', SC, '..x...x...x..x..', 58, { len: 1, vel: 0.45 }),
  pad: comp('strings', SV, 'x...............', 58, { len: 16, vel: 0.3, part: { o: { pad: true } } }),
  choir: comp('oo', SC, 'x...............', 58, { len: 16, vel: 0.45, part: { o: { a: 0.25, voices: 3, vowel: 'ah' } } }),
};
const TWINS = [T1.stab, T1.chord, T1.boom, T1.kick, T1.pops, T1.down, T1.roll];
const TWINS_2 = [T2.stab, T2.chord, T2.boom, T2.kick, T2.pops, T2.down, T2.roll];
const CHORUS = [st.kick, st.clap, st.punk, st.hat, st.ohat, st.shaker, st.cowbell, st.bassC, st.subC, st.openL, st.openR, st.chorus, st.chorusOct, st.stabs, st.choir, st.riff];
const walls = {
  id: 'walls', mood: 'fun', name: 'WALLS', artist: 'Xanboo78o Studios', bpm: 132, key: 'Bb', swing: 0.1, loop: true,
  duck: 0.42, duckRelease: 0.16, drumLevel: 0.85, drumDrive: 1.3,
  mix: { m1: { g: 0.55 }, hbass: { g: 0.6 }, sub: { g: 0.4 }, lead: { g: 0.45, send: { delay: 0.2, hall: 0.2 } }, stab: { g: 0.55 }, dist: { g: 0.36 }, dist2: { g: 0.3 } },
  sections: [
    { name: 'intro', bars: 8, parts: [st.kickIn, st.hatSoft, st.rim, st.riffSoft] },
    { name: 'verse', bars: 16, parts: [st.kickStop, st.hat, st.rim, st.cowbell, st.bassV, st.riffV, st.chugV] },
    { name: 'pre', bars: 4, parts: [st.kick, st.hat, st.bassV, st.riff, st.chugV, st.roll, st.riser] },
    { name: 'chorus', bars: 8, drop: true, parts: [st.crash, ...CHORUS] },
    { name: 'THE TWINS (right)', bars: 1, parts: TWINS },
    { name: 'THE TWINS (left)', bars: 1, parts: TWINS_2 },
    { name: 'chorus b', bars: 8, drop: true, parts: [st.crash, ...CHORUS] },
    { name: 'break', bars: 8, parts: [st.hatSoft, st.rim, st.riffSoft, st.pad, st.choir] },
    { name: 'pre 2', bars: 4, parts: [st.kick, st.hat, st.bassV, st.riff, st.chugV, st.roll, st.riser] },
    { name: 'THE TWINS again (right)', bars: 1, parts: TWINS },
    { name: 'THE TWINS again (left)', bars: 1, parts: TWINS_2 },
    { name: 'chorus 2', bars: 16, drop: true, parts: [st.crash, ...CHORUS] },
    { name: 'outro', bars: 4, fade: true, parts: [st.kick, st.hat, st.bassV, st.riffSoft] },
  ],
};

// =============================================================================
// THE CLIMB — the less fun one. 84, F major. A clean guitar picking the tune,
// half-time drums, a little tape. Then the hill: eight bars where the bass
// climbs a step every bar (B♭ C D E♭ F G A B♭ — 30 metres of climbing), a
// breath at THE CREST with only a bell, the guitar FALLING down the other side
// in a run, and the last chorus on the long straight at the bottom.
// =============================================================================
const CV = ['F', 'C', 'Dm', 'Bb'];
const CC = ['Bb', 'F', 'C', 'Dm'];
const CL = ['Bb', 'C', 'Dm', 'Eb', 'F', 'Gm', 'A', 'Bb'];
const CVM = [[0, 'C5', 3], [3, 'A4', 3], [6, 'F4', 2], [8, 'A4', 2], [10, 'C5', 2], [12, 'D5', 4],
  [16, 'E5', 3], [19, 'C5', 3], [22, 'G4', 2], [24, 'C5', 8],
  [32, 'A4', 3], [35, 'D5', 3], [38, 'F5', 2], [40, 'E5', 4], [44, 'D5', 4],
  [48, 'D5', 3], [51, 'C5', 3], [54, 'Bb4', 2], [56, 'F4', 8]];
const CCM = [[0, 'F4', 2], [2, 'G4', 2], [4, 'Bb4', 4], [8, 'D5', 8],
  [16, 'C5', 2], [18, 'D5', 2], [20, 'F5', 4], [24, 'A4', 8],
  [32, 'G4', 2], [34, 'A4', 2], [36, 'C5', 4], [40, 'E5', 4], [44, 'G5', 4],
  [48, 'F5', 12], [60, 'E5', 2], [62, 'D5', 2]];
// the climb's tune: one note a bar, each a step higher, held like a breath in
const CLM = [[0, 'D5', 16], [16, 'E5', 16], [32, 'F5', 16], [48, 'G5', 16], [64, 'A5', 16], [80, 'Bb5', 16], [96, 'C#6', 16], [112, 'D6', 16]];
// down the other side: a run falling two octaves in two bars
const FALL = ['F6', 'E6', 'D6', 'C6', 'Bb5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'Bb4', 'A4', 'G4', 'F4', 'E4',
  'D4', 'C4', 'Bb3', 'A3', 'G3', 'F3', 'F3', 'F3'].map((n, i) => [i, n, 1, 0.85 - i * 0.012]);
const cl = {
  tune: N('twang', CVM.map(([s, n, l]) => [s, [midi(n)], l, 0.85]), 64, { o: { tremDepth: 0.08, trem: 4 } }),
  tuneC: N('twang', CCM.map(([s, n, l]) => [s, [midi(n)], l, 0.9]), 64, { o: { tremDepth: 0.08, trem: 4 } }),
  tuneOo: mel('oo', 64, CCM, { vel: 0.45, o: { a: 0.15, voices: 3, vowel: 'ah' } }),
  arpV: arp('twang', CV, 53, [0, 3, 1, 4, 2, 5, 1, 3], 2, { vel: 0.75, span: 2, part: { o: { tremDepth: 0 } } }),
  arpC: arp('twang', CC, 53, [0, 3, 1, 4, 2, 5, 1, 3], 2, { vel: 0.5, span: 2, part: { o: { tremDepth: 0 } } }),
  arpL: arp('twang', CL, 55, [0, 1, 2, 3, 4, 3, 2, 1], 2, { vel: 0.5, span: 2, part: { o: { tremDepth: 0 } } }),
  climb: mel('lead', 128, CLM, { vel: 0.7 }),
  climbOo: comp('oo', CL, 'x...............', 55, { len: 16, vel: 0.5, part: { o: { a: 0.4, voices: 3, vowel: 'oo' } } }),
  climbBass: bassline('upright', CL, [[0, 0, 4, 0.9], [8, 7, 4, 0.7], [12, 12, 4, 0.6]], 2),
  crestBell: mel('bell', 16, [[0, ['A5', 'D6'], 16, 0.7]]),
  crestOo: mel('oo', 16, [[0, ['A4', 'D5', 'F#5'], 16, 0.5]], { o: { a: 0.6, voices: 3, vowel: 'ah' } }),
  fall: N('pluck', FALL.map(([s, n, l, v]) => [s, [midi(n)], l, v, { maxDur: 0.25 }]), 32),
  fallTwang: N('twang', FALL.filter((_, i) => i % 2 === 0).map(([s, n, l, v]) => [s, [midi(n) - 12], 2, v]), 32, { o: { tremDepth: 0 } }),
  fallRiser: X('boom', '................|..............x.', { vel: 0.7 }),
  kick: X('kick', 'x.......x.x.....', { vel: 0.6, o: { f0: 150, f1: 58, dec: 0.28, drive: 1.5, click: 0.45 } }),
  kickBig: X('kick', 'x.....x.x.....x.', { vel: 0.8, o: { f0: 155, f1: 56, dec: 0.3, drive: 1.8, click: 0.5 } }),
  snare: X('snare', '........x.......', { vel: 0.8, o: { dec: 0.28, tone: 175, snap: 1, body: 0.8, gate: true } }),
  snare24: X('snare', '....x.......x...', { vel: 0.9, o: { dec: 0.24, tone: 180, snap: 1.05, body: 0.8 } }),
  hat: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 0.6, o: { dec: 0.05 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.55 }),
  climbHat: X('hat', 'x...x...x...x...|'.repeat(4) + 'x.x.x.x.x.x.x.x.|'.repeat(3) + 'xxxxxxxxxxxxxxxx', { vel: 0.55, o: { dec: 0.04 } }),
  climbKick: X('kick', 'x...............|'.repeat(4) + 'x.......x.......|'.repeat(2) + 'x...x...x...x...|x.x.x.x.x.x.x.x.', { vel: 0.7, o: { f0: 140, f1: 50, dec: 0.3, drive: 1.6 } }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.55 }),
  sub: bassline('sub', CV, [[0, 0, 8, 0.35], [10, 0, 6, 0.28]], 2),
  subC: bassline('sub', CC, [[0, 0, 8, 0.4], [8, 0, 8, 0.32]], 2),
  openC: bassline('dist', CC, [[0, 0, 8, 0.9], [8, 0, 6, 0.8], [14, 0, 2, 0.7]], 2),
  openC2: bassline('dist2', CC, [[0, 12, 8, 0.75], [8, 12, 6, 0.7], [14, 12, 2, 0.6]], 2),
  pad: comp('strings', CC, 'x...............', 53, { len: 16, vel: 0.4, part: { o: { pad: true } } }),
};
const theclimb = {
  id: 'theclimb', mood: 'less fun', name: 'THE CLIMB', artist: 'Xanboo78o Studios', bpm: 84, key: 'F', swing: 0.08, human: 0.006, loop: true,
  duck: 0.15, drumLevel: 0.78, drumDrive: 1.35, tape: 0.5,
  mix: { twang: { g: 1.1, lp: 5000, send: { room: 0.3, hall: 0.3 } }, lead: { g: 0.36, lp: 3000, send: { delay: 0.3, hall: 0.4 } }, oo: { g: 0.45 }, sub: { g: 0.14 }, upright: { g: 0.5 }, dist: { g: 0.45 }, dist2: { g: 0.36 }, pluck: { g: 0.45 } },
  sections: [
    { name: 'intro', bars: 4, parts: [cl.arpV] },
    { name: 'verse', bars: 8, parts: [cl.arpV, cl.tune, cl.kick, cl.snare, cl.hat, cl.sub] },
    { name: 'chorus', bars: 8, drop: true, parts: [cl.arpC, cl.tuneC, cl.tuneOo, cl.kick, cl.snare, cl.hat, cl.subC, cl.pad] },
    { name: 'THE CLIMB', bars: 8, parts: [cl.arpL, cl.climb, cl.climbOo, cl.climbBass, cl.climbHat, cl.climbKick] },
    { name: 'THE CREST', bars: 1, parts: [cl.crestBell, cl.crestOo] },
    { name: 'down the other side', bars: 2, parts: [cl.fall, cl.fallTwang, cl.fallRiser] },
    { name: 'the long straight', bars: 8, drop: true, parts: [cl.crash, cl.arpC, cl.tuneC, cl.tuneOo, cl.kickBig, cl.snare24, cl.ride, cl.subC, cl.openC, cl.openC2, cl.pad] },
    { name: 'outro', bars: 4, fade: true, parts: [cl.arpV, cl.tune] },
  ],
};

export const CIRCUIT = { id: 'street', name: 'STREET CIRCUIT', tag: "Adam's own", color: '#9b5cff', songs: [walls, theclimb] };
