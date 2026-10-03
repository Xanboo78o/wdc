// BAKU — Azerbaijan. A street circuit of extremes: the LONGEST flat-out run
// in F1, 2.2 km along the Caspian seafront with cars weaving in each other's
// slipstream, and the CASTLE SECTION, climbing past the Old City walls through
// a gap barely wider than the car. So the fun song has both: an eight-bar
// straight that keeps accelerating, and a castle section where the whole band
// is squeezed into a narrow, tense, climbing passage.

import { X, N, trp, comp, bassline, mel, midi } from '../ostkit.js';

// =============================================================================
// BULVAR — the fun one. Named for the seafront boulevard the straight runs
// along. Tar riffs in sixteenths and a kamancha (fiddle) melody over a fast
// street beat, in D with the flavour of the Shur and Segah modes: a flattened
// second (E♭) that makes it ache, and sometimes a raised third (F♯).
// THE STRAIGHT: eight bars, a gear a bar — the lead climbs a step every bar,
// the hats double, the riff's filter opens, the kick doubles, a long riser,
// and it all lets go into the chorus. CASTLE: four bars squeezed into a narrow
// filtered band, the riff climbing a semitone a bar, no kick, only rim and
// darbuka ticking, the fiddle pinched high.
// =============================================================================
const BA = ['Dm', 'Eb', 'C', 'Dm'];
const BB = ['D', 'Eb', 'D', 'Cm'];
const RIFF = ['D4', 'Eb4', 'F4', 'Eb4', 'D4', null, 'A3', 'D4', 'F4', 'G4', 'A4', 'G4', 'F4', 'Eb4', 'D4', 'C4'];
const riffEv = (o = {}) => { const ev = []; RIFF.forEach((n, i) => { if (n) ev.push([i, midi(n), 1, (i % 4 === 0 ? 0.95 : 0.72) * (o.vel ?? 1), o.ev]); }); return ev; };
const tarRiff = (o = {}) => N('tar', riffEv(o), 16, o.part || {});
// the straight: the same riff on the pluck with its filter opening hit by hit over 8 bars
const straightRiff = () => { const ev = []; for (let b = 0; b < 8; b++) RIFF.forEach((n, i) => { if (!n) return; const u = (b * 16 + i) / 128; ev.push([b * 16 + i, [midi(n)], 1, 0.55 + 0.35 * u, { cut: 600 * Math.pow(9000 / 600, u), floor: 400 + 900 * u }]); }); return N('pluck', ev, 128); };
// the castle: riff squeezed through a low filter, climbing a semitone per bar
const castleRiff = () => { const ev = []; for (let b = 0; b < 4; b++) RIFF.forEach((n, i) => { if (n) ev.push([b * 16 + i, [midi(n) + b], 1, 0.5 + 0.08 * b, { cut: 1100, floor: 450 }]); }); return N('pluck', ev, 64); };
const FM = [[0, 'A4', 4], [4, 'Bb4', 4, 0.85, { glide: 'A4' }], [8, 'A4', 2], [10, 'G4', 2], [12, 'F4', 4],
  [16, 'G4', 6], [22, 'F4', 2], [24, 'Eb4', 4], [28, 'D4', 4],
  [32, 'D5', 8, 0.9, { glide: 'C5' }], [40, 'C5', 4], [44, 'Bb4', 4], [48, 'A4', 16, 0.9, { glide: 'Bb4' }]];
// chorus melody: the raised third (F#) comes in — Segah's brightness
const CM = [[0, 'D5', 4], [4, 'F#5', 4, 0.9, { glide: 'D5' }], [8, 'G5', 4], [12, 'A5', 4],
  [16, 'Bb5', 6, 0.95, { glide: 'A5' }], [22, 'A5', 2], [24, 'G5', 4], [28, 'F#5', 4],
  [32, 'A5', 8, 0.95, { glide: 'G5' }], [40, 'G5', 2], [42, 'F#5', 2], [44, 'Eb5', 4, 0.85, { glide: 'F#5' }],
  [48, 'C5', 4], [52, 'Eb5', 4], [56, 'D5', 8, 0.9, { glide: 'Eb5' }]];
const KICK = { f0: 165, f1: 58, sweep: 0.045, dec: 0.2, drive: 1.3, click: 0.6 };
const bk = {
  kick: X('kick', 'x..x..x.x..x....', { o: KICK }),
  kickHalf: X('kick', 'x.......x.......', { o: KICK }),
  kickRun: X('kick',  'x...x...x...x...|'.repeat(4) + 'x.x.x.x.x.x.x.x.|'.repeat(2) + 'x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx', { o: KICK }),
  clap: X('clap', '....x.......x...', { vel: 0.75 }),
  snare: X('snare', '....x.......x..o', { vel: 0.6, o: { dec: 0.13, tone: 230, snap: 1, body: 0.5 } }),
  dumLo: X('conga', 'x.....x...x.....', { vel: 0.85 }),
  takHi: X('conga', '..o.o...o.o.o.oo', { vel: 0.6, o: { hi: true } }),
  rim: X('rim', 'x.xxx.xxx.xxx.xx', { vel: 0.4 }),
  hat: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 0.55, o: { dec: 0.04 } }),
  hatRun: X('hat', 'x...x...x...x...|x.x.x.x.x.x.x.x.|x.x.x.x.x.x.x.x.|x-x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx', { vel: 0.42, o: { dec: 0.035 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.6, o: { dec: 0.1 } }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.6 }),
  roll: X('snare', '................|'.repeat(6) + 'x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx', { vel: 0.55, o: { dec: 0.09, tone: 220, snap: 1, body: 0.4 } }),
  riser: X('riser', 'x...............|' + '................|'.repeat(7), { vel: 0.5, o: { dur: 60 / 132 * 32 } }),
  flutter: X('flutter', '................|'.repeat(7) + '........x.......', { vel: 0.5, o: { dur: 0.8 } }),
  bass: bassline('hbass', BA, [[0, 0, 1, 0.95], [3, 0, 1, 0.8], [6, 0, 1, 0.85], [8, 0, 1, 0.95], [11, 0, 1, 0.8], [14, 12, 1, 0.8]], 2, { o: { cut: 1500, q: 3, fdec: 0.1 } }),
  bassB: bassline('hbass', BB, [[0, 0, 1, 0.95], [3, 0, 1, 0.8], [6, 0, 1, 0.85], [8, 0, 1, 0.95], [11, 0, 1, 0.8], [14, 12, 1, 0.8]], 2, { o: { cut: 1500, q: 3, fdec: 0.1 } }),
  bassRun: bassline('hbass', ['Dm', 'Dm', 'Dm', 'Dm', 'Dm', 'Dm', 'Dm', 'Dm'], [[0, 0, 1, 0.9], [2, 0, 1, 0.7], [4, 0, 1, 0.85], [6, 0, 1, 0.7], [8, 0, 1, 0.9], [10, 0, 1, 0.7], [12, 0, 1, 0.85], [14, 12, 1, 0.75]], 2, { o: { cut: 1200, q: 3, fdec: 0.1 } }),
  bassCastle: N('hbass', [0, 1, 2, 3].flatMap(b => [[b * 16, midi('D2') + b, 2, 0.8], [b * 16 + 8, midi('D2') + b, 2, 0.7]]), 64, { o: { cut: 500, q: 1, fdec: 0.1 } }),
  sub: bassline('sub', BA, [[0, 0, 8, 0.16]], 1),
  subB: bassline('sub', BB, [[0, 0, 8, 0.16]], 1),
  tar: tarRiff(),
  tarSoft: tarRiff({ vel: 0.55 }),
  fiddle: mel('fiddle', 64, FM),
  fiddleHi: mel('fiddle', 64, CM),
  fiddleLow: N('fiddle', CM.map(([s, n, l]) => [s, midi(n) - 12, l, 0.55]), 64, { lvl: 0.3 }),
  fiddleIntro: mel('fiddle', 64, [[0, 'A4', 12], [12, 'Bb4', 4, 0.85, { glide: 'A4' }], [16, 'A4', 16, 0.9, { glide: 'Bb4' }], [32, 'G4', 8], [40, 'F4', 4], [44, 'Eb4', 4, 0.85, { glide: 'F4' }], [48, 'D4', 16, 0.85, { glide: 'Eb4' }]]),
  drone: comp('strings', ['D5', 'D5', 'D5', 'D5'], 'x...............', 50, { len: 16, vel: 0.4, part: { o: { pad: true } } }),
  stabs: comp('stab', BB, 'x..x..x.....x...', 60, { len: 1, vel: 0.45, part: { lvl: 0.5 } }),
  pad: comp('strings', BB, 'x...............', 57, { len: 16, vel: 0.4, part: { o: { pad: true } } }),
  // the straight: a step up every bar, like a gear
  climb: mel('lead', 128, ['D4', 'Eb4', 'F4', 'G4', 'A4', 'Bb4', 'C5', 'D5'].map((n, i) => [i * 16, n, 16, 0.55 + 0.05 * i, i ? { glide: ['D4', 'Eb4', 'F4', 'G4', 'A4', 'Bb4', 'C5'][i - 1] } : undefined])),
  straightRiff: straightRiff(),
  // the castle: narrow
  castleRiff: castleRiff(),
  castleFiddle: mel('fiddle', 64, [[0, 'A5', 2, 0.6], [4, 'Bb5', 2, 0.6], [8, 'A5', 2, 0.6], [12, 'Bb5', 2, 0.6], [16, 'B5', 2, 0.65], [20, 'C6', 2, 0.65], [24, 'B5', 2, 0.65], [28, 'C6', 2, 0.65],
    [32, 'C6', 2, 0.7], [36, 'Db6', 2, 0.7], [40, 'C6', 2, 0.7], [44, 'Db6', 2, 0.7], [48, 'Db6', 2, 0.75], [52, 'D6', 2, 0.75], [56, 'Db6', 2, 0.75], [60, 'D6', 4, 0.8]]),
  castleTick: X('rim', 'x.x.x.x.x.x.x.x.', { vel: 0.45 }),
  castleTak: X('conga', '..o...o...o...o.', { vel: 0.5, o: { hi: true } }),
};
const BEAT = [bk.kick, bk.clap, bk.snare, bk.dumLo, bk.takHi, bk.hat, bk.ohat];
const bulvar = {
  id: 'bulvar', mood: 'fun', name: 'BULVAR', artist: 'Xanboo78o Studios', bpm: 132, key: 'D Shur', swing: 0.08, human: 0.003, loop: true,
  duck: 0.35, duckRelease: 0.15, drumLevel: 0.8, drumDrive: 1.35,
  mix: { tar: { g: 0.7 }, fiddle: { g: 0.55 }, hbass: { g: 0.45 }, sub: { g: 0.38 }, pluck: { g: 0.5, crush: 0 }, lead: { g: 0.42, send: { delay: 0.3, hall: 0.25 } }, conga: { g: 0.55 } },
  sections: [
    { name: 'intro', bars: 4, parts: [bk.fiddleIntro, bk.drone, bk.dumLo] },
    { name: 'riff', bars: 16, parts: [...BEAT, bk.bass, bk.sub, bk.tar, bk.fiddle] },
    { name: 'THE STRAIGHT', bars: 8, parts: [bk.kickRun, bk.hatRun, bk.roll, bk.riser, bk.flutter, bk.bassRun, bk.straightRiff, bk.climb, bk.takHi] },
    { name: 'chorus', bars: 16, drop: true, parts: [bk.crash, ...BEAT, bk.rim, bk.bassB, bk.subB, bk.tar, bk.fiddleHi, bk.fiddleLow, bk.stabs, bk.pad] },
    { name: 'CASTLE', bars: 4, parts: [bk.castleRiff, bk.castleFiddle, bk.castleTick, bk.castleTak, bk.bassCastle] },
    { name: 'chorus 2', bars: 8, drop: true, parts: [bk.crash, ...BEAT, bk.rim, ...trp([bk.bassB, bk.subB, bk.tar, bk.fiddleHi, bk.fiddleLow, bk.stabs, bk.pad], 0)] },
    { name: 'outro', bars: 4, fade: true, parts: [bk.kickHalf, bk.dumLo, bk.tarSoft, bk.drone] },
  ],
};

// =============================================================================
// İÇƏRİŞƏHƏR — the less fun one. The Old City at night, after the race, the
// walls the cars squeezed past still warm. A mugham: a free, aching melody on
// the kamancha (fiddle) over a drone on D, the tar answering each phrase in
// tremolo, then a slow daf rhythm for the tasnif. QALA (the castle) is where
// the drone falls away and the fiddle climbs alone, narrow and high, with only
// a heartbeat of frame drum under it. Segah flavour: D E♭ F♯ G A B♭ C.
// =============================================================================
const P1 = [[0, 'A4', 6], [6, 'Bb4', 4, 0.8, { glide: 'A4' }], [10, 'A4', 2], [12, 'G4', 4], [16, 'F#4', 8, 0.85, { glide: 'G4' }], [24, 'G4', 4], [28, 'A4', 4],
  [32, 'Bb4', 4], [36, 'C5', 6, 0.9, { glide: 'Bb4' }], [42, 'Bb4', 2], [44, 'A4', 4], [48, 'G4', 4], [52, 'F#4', 4], [56, 'Eb4', 4, 0.8, { glide: 'F#4' }], [60, 'D4', 4]];
const P2 = [[0, 'D5', 8], [8, 'Eb5', 4, 0.9, { glide: 'D5' }], [12, 'D5', 4], [16, 'C5', 6], [22, 'Bb4', 2], [24, 'A4', 8],
  [32, 'G4', 4], [36, 'A4', 4], [40, 'Bb4', 8, 0.85, { glide: 'A4' }], [48, 'A4', 16, 0.85]];
const TAR_ANS = [[0, 'A4', 4], [4, 'G4', 4], [8, 'F#4', 4], [12, 'G4', 4], [16, 'A4', 8], [24, 'Bb4', 8],
  [32, 'A4', 4], [36, 'G4', 2], [38, 'F#4', 2], [40, 'Eb4', 4], [44, 'F#4', 4], [48, 'D4', 16]];
const QALA = [[0, 'D5', 8], [8, 'Eb5', 8, 0.85, { glide: 'D5' }], [16, 'F#5', 8, 0.9, { glide: 'Eb5' }], [24, 'G5', 8, 0.9, { glide: 'F#5' }],
  [32, 'A5', 12, 0.95, { glide: 'G5' }], [44, 'Bb5', 4, 0.9, { glide: 'A5' }], [48, 'A5', 16, 0.9, { glide: 'Bb5' }]];
const ic = {
  droneLow: mel('sub', 64, [[0, 'D2', 64, 0.16]]),
  drone: mel('strings', 64, [[0, ['D3', 'A3', 'D4'], 64, 0.5]], { o: { pad: true } }),
  droneHi: mel('strings', 64, [[0, ['A4', 'D5'], 64, 0.35]], { o: { pad: true } }),
  p1: mel('fiddle', 64, P1),
  p2: mel('fiddle', 64, P2),
  qala: mel('fiddle', 64, QALA),
  tarAns: mel('tar', 64, TAR_ANS, { vel: 1, o: { trem: 0.055 } }),
  tarSoft: mel('tar', 64, TAR_ANS, { vel: 0.45, o: { trem: 0.07 } }),
  tarStrum: comp('tar', ['Dm', 'Eb', 'D', 'Cm'], 'x.....x.........', 57, { len: 6, vel: 0.5 }),
  daf: X('tom', 'x..x..x.x.......', { vel: 0.7, o: { f: 92, dec: 0.45, bend: 1.3 } }),
  dafEdge: X('rim', '...x.....x.x....', { vel: 0.35 }),
  dafHeart: X('tom', 'x..x............', { vel: 0.55, o: { f: 85, dec: 0.5, bend: 1.2 } }),
  strings: comp('strings', ['Dm', 'Eb', 'D', 'Cm'], 'x...............', 55, { len: 16, vel: 0.4 }),
  bell: mel('bell', 64, [[0, 'D5', 16, 0.35]]),
};
const icheri = {
  id: 'icheri', mood: 'less fun', name: 'İÇƏRİŞƏHƏR', artist: 'Xanboo78o Studios', bpm: 60, key: 'D Segah', swing: 0, human: 0.03, loop: true,
  duck: 0, drumLevel: 0.75, drumDrive: 1.05,
  mix: { fiddle: { g: 0.5, send: { hall: 0.6 } }, tar: { g: 0.5, send: { room: 0.3, hall: 0.35 } }, strings: { g: 0.3 }, pad: { g: 0.35 }, sub: { g: 0.4 } },
  sections: [
    { name: 'bardasht', bars: 4, parts: [ic.droneLow, ic.drone, ic.p1] },
    { name: 'tar', bars: 4, parts: [ic.droneLow, ic.drone, ic.tarAns] },
    { name: 'tasnif', bars: 4, drop: true, parts: [ic.droneLow, ic.drone, ic.strings, ic.daf, ic.dafEdge, ic.tarStrum, ic.p2] },
    { name: 'tasnif b', bars: 4, drop: true, parts: [ic.droneLow, ic.drone, ic.strings, ic.daf, ic.dafEdge, ic.tarStrum, ic.p1, ic.tarSoft] },
    { name: 'QALA', bars: 4, parts: [ic.droneHi, ic.dafHeart, ic.qala] },
    { name: 'return', bars: 4, parts: [ic.droneLow, ic.drone, ic.p2, ic.bell] },
    { name: 'outro', bars: 4, fade: true, parts: [ic.droneLow, ic.drone, ic.tarSoft] },
  ],
};

export const CIRCUIT = { id: 'baku', name: 'BAKU', tag: 'Azerbaijan · tar & kamancha street beat / mugham', color: '#2fa6d8', songs: [bulvar, icheri] };
