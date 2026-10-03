// NÜRBURGRING — Germany. The Grand-Prix-Strecke (5.1 km, data/tracks/nurburgring.json),
// with the Nordschleife — the Green Hell — in the forest next door. The GP
// track's signature: the long run down the start-finish straight into the
// CASTROL-S, the tight twisting Mercedes Arena complex where the whole field
// concertinas. The forest's signature: the SCHUMACHER-S, a fast left-right
// flick downhill through the trees.

import { X, N, trp, comp, bassline, arp, mel, midi } from '../ostkit.js';

// =============================================================================
// PRÄZISION — the fun one. German electro in the Kraftwerk mould: a robot
// sequencer bass on the sixteenths, metronomic drums, a vocoder-ish chopped
// voice, and a bell melody that is oddly, mechanically joyful. Perfectly
// quantised: no swing, no human. The STRAIGHT is the build (riser, roll, the
// sequencer opening up), then the CASTROL-S: one braking stab, and the melody
// zig-zags hard left-right through the complex (steel left, organ right) while
// the toms flick between them, before the chorus fires out of the last apex.
// =============================================================================
const PV = ['G', 'G', 'Bm', 'C'];                     // verse: nearly static, like a machine idling
const PC = ['C', 'D', 'G', 'Em'];                     // chorus
const PB = ['Em', 'C', 'G', 'D'];                     // break
const KICK = { f0: 140, f1: 56, sweep: 0.04, dec: 0.2, drive: 1.1, click: 0.25 };
const SEQ = [[0, 0, 1, 0.95], [2, 0, 1, 0.7], [3, 12, 1, 0.8], [4, 0, 1, 0.85], [6, 7, 1, 0.75], [8, 0, 1, 0.95], [10, 0, 1, 0.7], [11, 12, 1, 0.8], [12, 0, 1, 0.85], [14, 7, 1, 0.75]];
const SEQ_O = { cut: 1300, q: 6, fdec: 0.07 };
// the chorus: each bar walks up its chord and steps back down, like a machine that loves its job
const CM = [[0, 'E5', 4], [4, 'G5', 4], [8, 'E5', 2], [10, 'C5', 2], [12, 'G4', 4],
  [16, 'F#5', 4], [20, 'A5', 4], [24, 'F#5', 2], [26, 'D5', 2], [28, 'A4', 4],
  [32, 'B5', 4], [36, 'D6', 4], [40, 'B5', 2], [42, 'G5', 2], [44, 'D5', 4],
  [48, 'E5', 2], [50, 'G5', 2], [52, 'B5', 2], [54, 'E6', 2], [56, 'D6', 4], [60, 'B5', 4]];
const pz = {
  kick: X('kick', 'x...x...x...x...', { o: KICK }),
  kickIn: X('kick', '................|'.repeat(4) + 'x...x...x...x...|'.repeat(4), { o: KICK }),
  snare: X('snare', '....x.......x...', { vel: 0.7, o: { dec: 0.13, tone: 230, snap: 0.55, body: 0.85 } }),
  hat: X('hat', 'x.x.x.x.x.x.x.x.', { vel: 0.5, o: { dec: 0.03, hp: 8000 } }),
  hat16: X('hat', 'xoxoxoxoxoxoxoxo', { vel: 0.45, o: { dec: 0.025, hp: 8000 } }),
  rim: X('rim', '...x..x....x..x.', { vel: 0.55 }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.5 }),
  roll: X('snare', 'x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx', { vel: 0.45, o: { dec: 0.08, tone: 240, snap: 0.7, body: 0.6 } }),
  riser: X('riser', 'x...............|................|................|................', { vel: 0.4, o: { dur: 60 / 124 * 16 } }),
  seqV: bassline('hbass', PV, SEQ, 2, { o: SEQ_O }),
  seqC: bassline('hbass', PC, SEQ, 2, { o: SEQ_O }),
  seqB: bassline('hbass', PB, SEQ, 2, { o: { cut: 800, q: 6, fdec: 0.07 } }),
  seqDark: bassline('hbass', PV, SEQ, 2, { o: { cut: 600, q: 5, fdec: 0.05 } }),
  // the straight: the sequencer's filter opens bar by bar
  seqOpen: N('hbass', [0, 1, 2, 3].flatMap(b => SEQ.map(([s, iv, l, v]) => [b * 16 + s, midi('G2') + iv, l, v, { cut: 700 + b * 900 }])), 64, { o: { q: 7, fdec: 0.09 } }),
  arpV: arp('pluck', PV, 67, [0, 1, 2, 1, 0, 1, 2, 1], 2, { vel: 0.4, span: 1, part: { o: { cut: 4000, floor: 900 } } }),
  arpC: arp('pluck', PC, 67, [0, 1, 2, 3, 2, 1, 2, 3], 2, { vel: 0.45, span: 1 }),
  pad: comp('strings', PV, 'x...............', 55, { len: 16, vel: 0.35, part: { o: { pad: true } } }),
  padC: comp('strings', PC, 'x...............', 55, { len: 16, vel: 0.45, part: { o: { pad: true } } }),
  padB: comp('strings', PB, 'x...............', 55, { len: 16, vel: 0.5, part: { o: { pad: true } } }),
  // the robot voice: chopped formant notes, four to a phrase
  voice: mel('oo', 32, [[0, 'D5', 2, 0.8], [4, 'D5', 2, 0.7], [8, 'B4', 2, 0.75], [12, 'G4', 4, 0.8], [16, 'A4', 2, 0.75], [20, 'B4', 2, 0.75], [24, 'D5', 4, 0.8], [28, 'C5', 4, 0.75]], { o: { chop: true, vowel: 'oh' } }),
  bells: mel('bell', 64, CM),
  bellsSoft: mel('bell', 64, CM, { vel: 0.55 }),
  pluckDouble: N('pluck', CM.map(([st, n, l]) => [st, [midi(n) - 12], l, 0.4, { maxDur: 0.25 }]), 64, { lvl: 0.4 }),
  // ---- the CASTROL-S: two bars ----
  brakeStab: comp('stab', ['D'], 'X...............|................', 62, { len: 2, vel: 0.95, extra: 1 }),
  brakeBoom: X('boom', 'x...............|................', { vel: 0.8 }),
  brakeCrash: X('crash', 'x...............|................', { vel: 0.7 }),
  // left (steel) and right (organ) answer each other: in, flick, flick, out
  zigLeft: mel('steel', 32, [[4, 'G5', 1], [6, 'E5', 1], [8, 'G5', 1], [10, 'C5', 1], [12, 'G5', 1], [14, 'A4', 1], [16, 'D5', 2], [20, 'F#5', 2], [24, 'A5', 2], [28, 'D6', 2]], { vel: 0.9 }),
  zigRight: mel('m1', 32, [[5, 'F#5', 1], [7, 'D5', 1], [9, 'F#5', 1], [11, 'B4', 1], [13, 'F#5', 1], [15, 'G4', 1], [18, 'E5', 2], [22, 'G5', 2], [26, 'B5', 2], [30, 'C6', 2]], { vel: 0.8 }),
  zigBass: mel('hbass', 32, [[4, 'G2', 1], [5, 'G3', 1], [6, 'G2', 1], [7, 'G3', 1], [8, 'E2', 1], [9, 'E3', 1], [10, 'E2', 1], [11, 'E3', 1], [12, 'C2', 1], [13, 'C3', 1], [14, 'A1', 1], [15, 'A2', 1],
    [16, 'D2', 2], [18, 'D3', 2], [20, 'D2', 2], [22, 'D3', 2], [24, 'D2', 1], [25, 'D3', 1], [26, 'D2', 1], [27, 'D3', 1], [28, 'D2', 1], [29, 'D3', 1], [30, 'D2', 1], [31, 'D3', 1]], { o: { cut: 1800, q: 5, fdec: 0.06 } }),
  zigTomL: X('tom', '....x...x...x...|................', { vel: 0.7, o: { f: 200, dec: 0.2 } }),
  zigTomR: X('tom', '......x...x...x.|................', { vel: 0.7, o: { f: 140, dec: 0.25 } }),
  zigKick: X('kick', '................|x...x...x...x.x.', { o: KICK }),
  zigRoll: X('snare', '................|........x.x.xxxx', { vel: 0.6, o: { dec: 0.08, tone: 240, snap: 0.7, body: 0.6 } }),
};
const CASTROL = [pz.brakeStab, pz.brakeBoom, pz.brakeCrash, pz.zigLeft, pz.zigRight, pz.zigBass, pz.zigTomL, pz.zigTomR, pz.zigKick, pz.zigRoll];
const CHORUS = [pz.crash, pz.kick, pz.snare, pz.hat16, pz.rim, pz.seqC, pz.arpC, pz.padC, pz.bells, pz.pluckDouble];
const praezision = {
  id: 'praezision', mood: 'fun', name: 'PRÄZISION', artist: 'Xanboo78o Studios', bpm: 124, key: 'G', swing: 0, human: 0, loop: true,
  duck: 0.25, duckRelease: 0.14, drumLevel: 0.78, drumDrive: 1.15,
  mix: { hbass: { g: 0.46 }, bell: { g: 0.5, send: { hall: 0.35, delay: 0.25 } }, pluck: { g: 0.45 }, oochop: { g: 0.5 }, steel: { g: 0.55, pan: -0.65 }, m1: { g: 0.5, pan: 0.65 }, stab: { g: 0.6 } },
  sections: [
    { name: 'intro', bars: 8, parts: [pz.kickIn, pz.hat, pz.seqDark, pz.pad] },
    { name: 'verse', bars: 16, parts: [pz.kick, pz.snare, pz.hat, pz.rim, pz.seqV, pz.arpV, pz.pad, pz.voice] },
    { name: 'the straight', bars: 4, parts: [pz.kick, pz.hat16, pz.roll, pz.riser, pz.seqOpen, pz.voice] },
    { name: 'CASTROL-S', bars: 2, parts: CASTROL },
    { name: 'chorus', bars: 16, drop: true, parts: CHORUS },
    { name: 'break', bars: 8, parts: [pz.hat, pz.seqB, pz.padB, pz.bellsSoft] },
    { name: 'the straight 2', bars: 4, parts: [pz.kick, pz.hat16, pz.roll, pz.riser, pz.seqOpen, pz.voice, pz.arpV] },
    { name: 'CASTROL-S 2', bars: 2, parts: CASTROL },
    { name: 'chorus 2', bars: 16, drop: true, parts: [...CHORUS, pz.voice] },
    { name: 'outro', bars: 8, fade: true, parts: [pz.kick, pz.hat, pz.seqDark, pz.pad, pz.voice] },
  ],
};

// =============================================================================
// DIE GRÜNE HÖLLE — the less fun one. The Nordschleife in fog: a drone low in
// the trees, a heavy slow pulse like a heartbeat in a helmet, distant bells,
// a choir that never quite resolves, and a shakuhachi melody that starts clear
// and loses its way — sliding onto the wrong notes before it finds D again.
// D minor with the Phrygian E♭ hanging over it. Then the SCHUMACHER-S: the only
// fast thing in the forest, a left-right flick downhill — koto hard left, mandolin
// hard right, toms answering — two bars and gone back into the fog.
// =============================================================================
const FOG = ['Dm', 'Eb', 'Dm', 'Bb'];
const DEEP = ['Gm', 'Eb', 'Dm', 'A'];
// clear, then lost, then found faintly
const LOST = [[0, 'A4', 6], [6, 'D5', 2], [8, 'F5', 8], [16, 'Eb5', 8, 0.8, { glide: 'F5' }], [24, 'D5', 4], [28, 'Bb4', 4],
  [32, 'A4', 12], [44, 'C5', 4], [48, 'D5', 16, 0.85, { glide: 'C5' }],
  [64, 'A4', 6], [70, 'D5', 2], [72, 'F5', 6], [78, 'G5', 2], [80, 'Gb5', 8, 0.75, { glide: 'G5' }], [88, 'F5', 4], [92, 'E5', 4, 0.7, { glide: 'F5' }],
  [96, 'Eb5', 8, 0.7], [104, 'D5', 8, 0.65, { glide: 'Eb5' }], [112, 'C#5', 8, 0.6], [120, 'D5', 8, 0.55, { glide: 'C#5' }]];
const gh = {
  drone: comp('strings', ['Dm'], 'x...............', 50, { len: 16, vel: 0.5, part: { o: { pad: true, a: 1.5, r: 1.5 } } }),
  droneDeep: comp('strings', DEEP, 'x...............', 50, { len: 16, vel: 0.5, part: { o: { pad: true, a: 0.8 } } }),
  sub: bassline('sub', FOG, [[0, 0, 16, 0.1]], 1),
  subDeep: bassline('sub', DEEP, [[0, 0, 16, 0.1]], 1),
  wind: X('riser', 'x...............|................', { vel: 0.18, o: { dur: 60 / 66 * 8 } }),
  pulse: X('kick', 'x.......x.......', { vel: 0.4, o: { f0: 100, f1: 50, dec: 0.8, drive: 1.05, click: 0.05, duck: 0 } }),
  pulseHeavy: X('kick', 'x.....x.x.......', { vel: 0.36, o: { f0: 100, f1: 50, dec: 0.8, drive: 1.1, click: 0.08, duck: 0 } }),
  timp: X('tom', 'x...............|................', { vel: 0.45, o: { f: 73, dec: 1.6, bend: 1.1 } }),
  bells: mel('bell', 64, [[0, 'D5', 16, 0.35], [24, 'A4', 8, 0.25], [40, 'D5', 8, 0.3], [56, 'Eb5', 8, 0.25]]),
  bellsFar: mel('bell', 32, [[0, 'D4', 32, 0.3]]),
  choir: comp('oo', FOG, 'x...............', 50, { len: 16, vel: 0.45, part: { o: { a: 1.2, voices: 4, vowel: 'oo' } } }),
  choirDeep: comp('oo', DEEP, 'x...............', 55, { len: 16, vel: 0.55, part: { o: { a: 0.8, voices: 4, vowel: 'ah' } } }),
  shaku: mel('shaku', 128, LOST),
  koto: mel('koto', 32, [[0, 'D4', 4, 0.6], [6, 'A3', 2, 0.4], [16, 'Eb4', 6, 0.5, { bend: -1 }]]),
  fiddle: mel('fiddle', 64, [[0, 'D5', 8], [8, 'Bb4', 8], [16, 'G4', 8], [24, 'Bb4', 4], [28, 'C5', 4], [32, 'A4', 16], [48, 'A4', 8], [56, 'C#5', 8]]),
  fiddleLow: mel('fiddle', 64, [[0, 'D4', 8], [8, 'Bb3', 8], [16, 'G3', 8], [24, 'Bb3', 4], [28, 'C4', 4], [32, 'A3', 16], [48, 'A3', 8], [56, 'C#4', 8]], { vel: 0.6 }),
  // ---- the SCHUMACHER-S: two bars, left-right, gone ----
  sLeft: mel('koto', 32, [[0, 'D5', 1], [1, 'F5', 1], [2, 'A5', 1], [8, 'D5', 1], [9, 'F5', 1], [10, 'A5', 1], [16, 'Eb5', 1], [17, 'G5', 1], [18, 'Bb5', 1], [24, 'D5', 2, 0.9, { bend: -1 }]], { vel: 1 }),
  sRight: mel('mando', 32, [[4, 'A5', 1], [5, 'F5', 1], [6, 'D5', 1], [12, 'A5', 1], [13, 'F5', 1], [14, 'D5', 1], [20, 'Bb5', 1], [21, 'G5', 1], [22, 'Eb5', 1], [28, 'A4', 4]], { vel: 1 }),
  sTomL: X('tom', 'x.......x.......|x.......x.......', { vel: 0.8, o: { f: 150, dec: 0.35 } }),
  sTomR: X('tom', '....x.......x...|....x.......x...', { vel: 0.8, o: { f: 110, dec: 0.4 } }),
  sKick: X('kick', 'x.x...x.x.x...x.|x.x...x.x.x.x.x.', { vel: 0.38, o: { f0: 110, f1: 55, dec: 0.4, drive: 1.1, click: 0.1, duck: 0 } }),
  sDrone: comp('strings', ['Dm', 'Eb'], 'x...............', 50, { len: 16, vel: 0.45, part: { o: { pad: true, a: 0.1 } } }),
};
const hoelle = {
  id: 'hoelle', mood: 'less fun', name: 'DIE GRÜNE HÖLLE', artist: 'Xanboo78o Studios', bpm: 66, key: 'Dm', swing: 0, human: 0.006, loop: true,
  duck: 0, drumLevel: 0.75, drumDrive: 1.05, delay: 60 / 66 * 0.75,
  mix: { strings: { g: 0.3 }, pad: { g: 0.32 }, oo: { g: 0.4 }, sub: { g: 0.35 }, bell: { g: 0.4, send: { hall: 0.8, delay: 0.3 } },
    shaku: { g: 0.65, send: { hall: 0.7, delay: 0.25 } }, koto: { g: 1.1, pan: -0.7 }, mando: { g: 1.0, pan: 0.7 }, fiddle: { g: 1.0 } },
  sections: [
    { name: 'intro', bars: 4, parts: [gh.drone, gh.wind, gh.bellsFar, gh.sub] },
    { name: 'fog', bars: 8, parts: [gh.drone, gh.sub, gh.pulse, gh.choir, gh.shaku, gh.bells, gh.koto, gh.timp] },
    { name: 'SCHUMACHER-S', bars: 2, drop: true, parts: [gh.sLeft, gh.sRight, gh.sTomL, gh.sTomR, gh.sKick, gh.sDrone] },
    { name: 'deep', bars: 8, drop: true, parts: [gh.droneDeep, gh.pulseHeavy, gh.choirDeep, gh.fiddle, gh.fiddleLow, gh.bells, gh.timp] },
    { name: 'outro', bars: 4, fade: true, parts: [gh.drone, gh.wind, gh.bellsFar, gh.sub] },
  ],
};

export const CIRCUIT = { id: 'nurburgring', name: 'NÜRBURGRING', tag: 'Germany · Kraftwerk electro / the Green Hell', color: '#2e8b57', songs: [praezision, hoelle] };
