// ADAM'S FIRST TRACK — Adam's own, and the first one. Measured from
// data/tracks/adam1.json: tiny (2.64 km), narrow (9.5 m, squeezing to just
// 4 m at the end), nineteen corners, a figure of eight that crosses over
// itself, and one rollercoaster moment — up to an 11.6 m crest at Turn 4 and
// straight off it at -34%, down 20 metres in a heartbeat.
// So the fun song climbs to TURN 4 and DROPS off it. The less fun song is the
// figure of eight — THE BRIDGE, where two melodies cross over each other —
// and ends in THE SQUEEZE, the band narrowing to one guitar, four metres wide.

import { X, N, comp, bassline, arp, mel, midi, voice } from '../ostkit.js';

// =============================================================================
// FIRST LAP — the fun one. Rally house × pop-punk, 134, C major. The riff is
// Adam's own rhythm from CRUISE — "1,1,2,2,2,1,1,3,3,3 with the synth" — as
// rally-house STABS: C C F F F C C G G G, the bass bouncing under each change.
// =============================================================================
const RS = [0, 1, 3, 4, 5, 8, 9, 11, 12, 13];
const RC = ['C', 'C', 'F', 'F', 'F', 'C', 'C', 'G', 'G', 'G'];
const RV = [1, 0.85, 1, 0.85, 0.9, 1, 0.85, 1, 0.85, 0.9];
const riffStab = (vel, ex) => N('stab', RS.map((s, i) => [s, voice(RC[i], 60), 1, vel * RV[i], ex]), 16);
const rootAt = st => { let r = RC[0]; for (let i = 0; i < RS.length; i++) if (RS[i] <= st) r = RC[i]; return r; };
const bounce = N('hbass', [2, 6, 10, 14].map(st => [st, midi(rootAt(st) + '2'), 1, 0.9]), 16, { o: { cut: 1100, q: 2, fdec: 0.1 } });
const chug = N('dist', [0, 2, 4, 6, 8, 10, 12, 14].map((st, i) => [st, midi(rootAt(st) + '2'), 1, i % 4 === 0 ? 0.9 : 0.65, { mute: true }]), 16);
const FC = ['F', 'G', 'Am', 'C'];
const OPEN = [[0, 0, 4, 0.95], [4, 0, 2, 0.75], [6, 0, 4, 0.9], [10, 0, 2, 0.75], [12, 0, 4, 0.9]];
const CM = [[0, 'A5', 2], [2, 'G5', 2], [4, 'F5', 2], [6, 'G5', 2], [8, 'A5', 4], [12, 'C6', 4],
  [16, 'B5', 2], [18, 'A5', 2], [20, 'G5', 2], [22, 'D5', 2], [24, 'G5', 8],
  [32, 'C6', 2], [34, 'B5', 2], [36, 'A5', 2], [38, 'E5', 2], [40, 'A5', 4], [44, 'B5', 4],
  [48, 'C6', 8], [56, 'G5', 4], [60, 'E5', 4]];
const KICK = { f0: 180, f1: 50, sweep: 0.05, dec: 0.22, drive: 1.3, click: 0.6 };
// THE DROP: off the crest, a run falling two octaves in one bar
const DROP = ['C6', 'B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4', 'C3'];
const fl = {
  kick: X('kick', 'x...x...x...x...', { o: KICK }),
  clap: X('clap', '....x.......x...', { vel: 0.85 }),
  punk: X('snare', '....x.......x...', { vel: 0.95, o: { dec: 0.17, tone: 210, snap: 1, body: 0.7 } }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.85, o: { dec: 0.045 } }),
  hatSoft: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.5, o: { dec: 0.045 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.8, o: { dec: 0.15 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.5 }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.6 }),
  cowbell: X('cowbell', '......x.......x.|..........x.....', { vel: 0.65, o: { dec: 0.2 } }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.6 }),
  riff: riffStab(0.85), riffSoft: riffStab(0.5, { cut: 1800, floor: 500 }),
  // the climb to Turn 4: the stabs' filter opens bar by bar
  riffClimb: N('stab', [0, 1, 2, 3].flatMap(b => RS.map((s, i) => [b * 16 + s, voice(RC[i], 60), 1, (0.55 + 0.1 * b) * RV[i], { cut: 1200 * Math.pow(2, b) }])), 64),
  bounce, chug,
  sub: N('sub', [[0, midi('C2'), 3, 0.3], [8, midi('C2'), 3, 0.25]], 16),
  subC: bassline('sub', FC, [[0, 0, 2, 0.55]], 2),
  bassC: bassline('hbass', FC, [[2, 0, 1, 0.9], [6, 0, 1, 0.9], [10, 0, 1, 0.9], [14, 0, 1, 0.9]], 2, { o: { cut: 1100, q: 2, fdec: 0.1 } }),
  openL: bassline('dist', FC, OPEN, 2),
  openR: bassline('dist2', FC, OPEN.map(([s, i, l, v]) => [s, i + 12, l, v * 0.85]), 2),
  chorus: mel('lead', 64, CM),
  chorusOct: N('pluck', CM.map(([s, n, l]) => [s, [midi(n) - 12], l, 0.4, { maxDur: 0.4 }]), 64, { lvl: 0.4 }),
  choir: comp('oo', FC, 'x...............', 57, { len: 16, vel: 0.45, part: { o: { a: 0.25, voices: 3, vowel: 'ah' } } }),
  offStabs: comp('stab', FC, '..x...x...x...x.', 60, { len: 1, vel: 0.35, part: { lvl: 0.5 } }),
  pad: comp('strings', ['C', 'F', 'C', 'G'], 'x...............', 55, { len: 16, vel: 0.35, part: { o: { pad: true } } }),
  climbRoll: X('snare', 'x.......x.......|x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx', { vel: 0.6, o: { dec: 0.1, snap: 1, body: 0.4 } }),
  climbRiser: X('riser', 'x...............|'.repeat(4), { vel: 0.45, o: { dur: 60 / 134 * 20 } }),
  // TURN 4: the crest. Half a bar flat out, then weightless — one high note in the air
  crestRoll: X('snare', 'xxxxxxxx........', { vel: 0.8, o: { dec: 0.08, snap: 1, body: 0.4 } }),
  crestKick: X('kick', 'x...x...........', { vel: 1, o: KICK }),
  crestFlutter: X('flutter', '........x.......', { vel: 0.5, o: { dur: 0.5 } }),
  crestNote: mel('bell', 16, [[8, ['C6', 'G6'], 8, 0.7]]),
  crestOo: mel('oo', 16, [[8, ['E5', 'G5', 'C6'], 8, 0.5]], { o: { a: 0.05, voices: 3, vowel: 'oo' } }),
  // THE DROP: the plunge
  drop: N('lead', DROP.map((n, i) => [i, midi(n), 1, 0.9 - i * 0.02]), 16),
  dropBoom: X('boom', 'x...............', { vel: 0.95 }),
  dropCrash: X('crash', 'x...............', { vel: 0.8 }),
  dropPops: X('antilag', '..........x.....', { vel: 0.6, o: { n: 4 } }),
  dropSub: mel('sub', 16, [[0, 'C3', 4, 0.7, { glide: 'C4' }], [4, 'G2', 4, 0.65, { glide: 'G3' }], [8, 'E2', 4, 0.6, { glide: 'E3' }], [12, 'C2', 4, 0.7, { glide: 'C3' }]]),
};
const CLIMB = [fl.kick, fl.hat, fl.bounce, fl.chug, fl.riffClimb, fl.climbRoll, fl.climbRiser];
const T4 = [fl.crestRoll, fl.crestKick, fl.crestFlutter, fl.crestNote, fl.crestOo];
const DROPS = [fl.drop, fl.dropBoom, fl.dropCrash, fl.dropPops, fl.dropSub];
const CHORUS = [fl.crash, fl.kick, fl.clap, fl.punk, fl.hat, fl.ohat, fl.ride, fl.shaker, fl.cowbell, fl.bassC, fl.subC, fl.openL, fl.openR, fl.chorus, fl.chorusOct, fl.choir, fl.offStabs];
const firstlap = {
  id: 'firstlap', mood: 'fun', name: 'FIRST LAP', artist: 'Xanboo78o Studios', bpm: 134, key: 'C', swing: 0.12, loop: true,
  duck: 0.42, duckRelease: 0.16, drumLevel: 0.85, drumDrive: 1.3,
  mix: { stab: { g: 0.8 }, hbass: { g: 0.55 }, sub: { g: 0.3 }, lead: { g: 0.45, send: { delay: 0.22, hall: 0.2 } }, dist: { g: 0.36 }, dist2: { g: 0.3 }, bell: { g: 0.6 } },
  sections: [
    { name: 'intro', bars: 4, parts: [fl.hatSoft, fl.shaker, fl.riffSoft, fl.sub] },
    { name: 'verse', bars: 16, parts: [fl.kick, fl.clap, fl.hat, fl.ohat, fl.cowbell, fl.bounce, fl.riff, fl.chug, fl.pad] },
    { name: 'up to turn 4', bars: 4, parts: CLIMB },
    { name: 'TURN 4', bars: 1, parts: T4 },
    { name: 'THE DROP', bars: 1, parts: DROPS },
    { name: 'chorus', bars: 16, drop: true, parts: CHORUS },
    { name: 'break', bars: 8, parts: [fl.hatSoft, fl.shaker, fl.riffSoft, fl.pad, fl.sub] },
    { name: 'up to turn 4 again', bars: 4, parts: CLIMB },
    { name: 'TURN 4 again', bars: 1, parts: T4 },
    { name: 'THE DROP again', bars: 1, parts: DROPS },
    { name: 'chorus 2', bars: 16, drop: true, parts: [...CHORUS, fl.riff] },
    { name: 'outro', bars: 4, fade: true, parts: [fl.kick, fl.hat, fl.bounce, fl.riffSoft] },
  ],
};

// =============================================================================
// THE SQUEEZE — the less fun one. 76, D major, the first track remembered: a
// music-box melody on bells over a clean picked guitar. THE BRIDGE is the
// figure of eight crossing over itself — two melodies, one falling and one
// rising, passing through each other in the middle. The song ends in THE
// SQUEEZE, where the track narrows to 4 m and the band narrows with it until
// one guitar is left, and the lap begins again.
// =============================================================================
const QV = ['D', 'F#m', 'G', 'A'];
const QC = ['G', 'A', 'F#m', 'Bm'];
const QB = ['Bm', 'G', 'D', 'A'];
const QVM = [[0, 'F#5', 2], [2, 'A5', 2], [4, 'D6', 4], [8, 'C#6', 4], [12, 'A5', 4],
  [16, 'C#6', 2], [18, 'A5', 2], [20, 'F#5', 4], [24, 'E5', 8],
  [32, 'D5', 2], [34, 'G5', 2], [36, 'B5', 4], [40, 'A5', 4], [44, 'G5', 4],
  [48, 'E5', 4], [52, 'A5', 4], [56, 'C#6', 8]];
const QCM = [[0, 'B4', 4], [4, 'D5', 4], [8, 'G5', 8], [16, 'A5', 4], [20, 'E5', 4], [24, 'C#5', 8],
  [32, 'C#5', 4], [36, 'F#5', 4], [40, 'A5', 8], [48, 'F#5', 6], [54, 'E5', 2], [56, 'D5', 8]];
// the crossover: one line falls, one rises, and they pass through each other in bar 2
const FALLS = [[0, 'F#6', 8], [8, 'D6', 8], [16, 'D6', 8], [24, 'B5', 8], [32, 'A5', 8], [40, 'F#5', 8], [48, 'E5', 8], [56, 'C#5', 8]];
const RISES = [[0, 'B4', 8], [8, 'D5', 8], [16, 'G5', 8], [24, 'B5', 8], [32, 'D6', 8], [40, 'F#6', 8], [48, 'A6', 8], [56, 'E6', 8]];
const sq = {
  arpV: arp('guitar', QV, 55, [0, 2, 4, 2, 5, 2, 4, 2], 2, { vel: 0.75, span: 2 }),
  arpC: arp('guitar', QC, 55, [0, 2, 4, 2, 5, 2, 4, 2], 2, { vel: 0.8, span: 2 }),
  arpB: arp('guitar', QB, 55, [0, 2, 4, 2, 5, 2, 4, 2], 2, { vel: 0.75, span: 2 }),
  box: mel('bell', 64, QVM, { vel: 0.7 }),
  boxSoft: mel('bell', 64, QVM, { vel: 0.4 }),
  chorus: mel('lead', 64, QCM, { vel: 0.75 }),
  chorusOo: mel('oo', 64, QCM, { vel: 0.5, o: { a: 0.15, voices: 3, vowel: 'ah' } }),
  falls: mel('bell', 64, FALLS, { vel: 0.7 }),
  rises: mel('lead', 64, RISES, { vel: 0.65 }),
  risesOo: mel('oo', 64, RISES.map(([s, n, l]) => [s, n, l, 0.4]), { o: { a: 0.3, voices: 2 } }),
  kick: X('kick', 'x.......x..x....', { vel: 0.6, o: { f0: 150, f1: 58, dec: 0.28, drive: 1.5, click: 0.45 } }),
  kickBig: X('kick', 'x.....x.x.....x.', { vel: 0.8, o: { f0: 155, f1: 56, dec: 0.3, drive: 1.8, click: 0.5 } }),
  snareHalf: X('snare', '........x.......', { vel: 0.8, o: { dec: 0.3, tone: 170, snap: 1, body: 0.8, gate: true } }),
  snare: X('snare', '....x.......x...', { vel: 0.9, o: { dec: 0.24, tone: 180, snap: 1.05, body: 0.8 } }),
  hat: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 0.55, o: { dec: 0.05 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.5 }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.55 }),
  bridgeRoll: X('snare', '................|'.repeat(7) + 'x.x.x.x.xxxxxxxx', { vel: 0.55, o: { dec: 0.1, snap: 1, body: 0.5 } }),
  sub: bassline('sub', QV, [[0, 0, 8, 0.35], [10, 0, 6, 0.28]], 2),
  subC: bassline('sub', QC, [[0, 0, 8, 0.4], [8, 0, 8, 0.32]], 2),
  subB: bassline('sub', QB, [[0, 0, 16, 0.3]], 2),
  openC: bassline('dist', QC, [[0, 0, 8, 0.9], [8, 0, 6, 0.8], [14, 0, 2, 0.7]], 2),
  openC2: bassline('dist2', QC, [[0, 12, 8, 0.75], [8, 12, 6, 0.7], [14, 12, 2, 0.6]], 2),
  pad: comp('strings', QB, 'x...............', 55, { len: 16, vel: 0.4, part: { o: { pad: true } } }),
  // the squeeze: the guitar alone on single notes, the voices thinning to one
  thin: arp('guitar', QV, 57, [0, 2, 4, 2], 4, { vel: 1.0, span: 1 }),
  thinOo: mel('oo', 32, [[0, 'A4', 32, 0.35]], { o: { a: 0.6, voices: 1 } }),
};
const squeeze = {
  id: 'squeeze', mood: 'less fun', name: 'THE SQUEEZE', artist: 'Xanboo78o Studios', bpm: 76, key: 'D', swing: 0.06, human: 0.006, loop: true,
  duck: 0.12, drumLevel: 0.78, drumDrive: 1.3, tape: 0.6, vinyl: 0.15,
  mix: { guitar: { g: 1.0, lp: 4600 }, bell: { g: 0.5 }, lead: { g: 0.36, lp: 2800, send: { delay: 0.3, hall: 0.4 } }, oo: { g: 0.45 }, sub: { g: 0.15 }, dist: { g: 0.45 }, dist2: { g: 0.36 } },
  sections: [
    { name: 'intro', bars: 4, parts: [sq.arpV, sq.boxSoft] },
    { name: 'verse', bars: 8, parts: [sq.arpV, sq.box, sq.kick, sq.snareHalf, sq.hat, sq.sub] },
    { name: 'chorus', bars: 8, drop: true, parts: [sq.arpC, sq.chorus, sq.chorusOo, sq.kick, sq.snare, sq.hat, sq.subC] },
    { name: 'THE BRIDGE', bars: 8, parts: [sq.arpB, sq.falls, sq.rises, sq.risesOo, sq.pad, sq.kick, sq.snareHalf, sq.hat, sq.subB, sq.bridgeRoll] },
    { name: 'last chorus', bars: 8, drop: true, parts: [sq.crash, sq.arpC, sq.chorus, sq.chorusOo, sq.kickBig, sq.snare, sq.ride, sq.subC, sq.openC, sq.openC2] },
    { name: 'THE SQUEEZE', bars: 2, parts: [sq.arpV, sq.boxSoft, sq.thinOo] },
    { name: 'four metres wide', bars: 2, fade: true, parts: [sq.thin] },
  ],
};

export const CIRCUIT = { id: 'adam1', name: "ADAM'S FIRST TRACK", tag: "Adam's own", color: '#35d6a0', songs: [firstlap, squeeze] };
