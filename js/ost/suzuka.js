// SUZUKA — Japan, all-Japanese sound. A figure of eight: the ESSES (a snake of
// S-bends, left-right-left-right), Degner, under the crossover bridge, Spoon,
// and 130R — flat out, terrifying, held breath — then the Casio chicane where
// you finally breathe out. So: the fun song has an ESSES riff that swaps hands
// across the stereo field, a 130R that holds one suspended chord at full
// intensity and never resolves, and a CASIO flick that lets it all go. The
// less fun song has the crossover: the melody passes over itself in canon.

import { X, N, comp, bassline, arp, mel, midi } from '../ostkit.js';

// =============================================================================
// HACHI NO JI (figure eight) — the fun one. 80s Japanese city pop / fusion, in
// the spirit of the broadcast themes: slap bass, bright brass, a soaring
// EWI-ish lead, Rhodes, and the 王道進行 "royal road" chorus (IVmaj7 V7 iii7 vi7).
// E major, 136.
// =============================================================================
const SV = ['C#m7', 'F#m7', 'B7', 'Emaj7'];           // verse
const SC = ['Amaj7', 'B7', 'G#m7', 'C#m7'];           // the royal road
const SE = ['C#m7', 'Amaj7', 'B7', 'G#m7'];           // the Esses
const SS = ['Amaj7', 'Amaj7', 'G#m7', 'F#m7'];        // Spoon: one long curve
const S130 = ['B7sus4', 'B7sus4', 'B7sus4', 'B7sus4']; // 130R: never resolves
const KICK = { f0: 160, f1: 50, dec: 0.28, drive: 1.3, click: 0.5 };
const SLAP = [[0, 0, 3, 0.95], [3, 0, 1, 0.5], [6, 12, 1, 0.85, { pop: true }], [8, 7, 2, 0.8], [10, 0, 1, 0.6], [11, 10, 1, 0.6], [14, 12, 1, 0.85, { pop: true }]];
// verse: the sax, warm and low
const VM = [[0, 'G#4', 4], [4, 'B4', 4], [8, 'C#5', 8], [16, 'A4', 4], [20, 'C#5', 4], [24, 'E5', 6], [30, 'D#5', 2],
  [32, 'F#5', 8], [40, 'D#5', 4], [44, 'B4', 4], [48, 'G#4', 8], [56, 'B4', 8, 0.8, { glide: 'G#4' }]];
// chorus: the lead soars over the royal road
const CM = [[0, 'C#6', 6], [6, 'B5', 2], [8, 'A5', 4], [12, 'B5', 4, 0.85, { glide: 'A5' }],
  [16, 'D#6', 6, 0.95, { glide: 'B5' }], [22, 'C#6', 2], [24, 'B5', 8],
  [32, 'B5', 4], [36, 'D#6', 4], [40, 'E6', 8, 0.95, { glide: 'D#6' }],
  [48, 'E6', 4], [52, 'D#6', 4], [56, 'C#6', 8, 0.9, { glide: 'D#6' }]];
// the Esses: a two-bar riff that flicks hand to hand — pluck hard LEFT, stab hard RIGHT
const ESS_L = [[0, 'E5', 2], [2, 'G#5', 1], [3, 'B5', 2], [10, 'G#5', 1], [11, 'F#5', 2], [22, 'B5', 1], [23, 'G#5', 2], [30, 'C#5', 2]];
const ESS_R = [[6, 'C#6', 1], [7, 'B5', 2], [14, 'E5', 2], [16, 'F#5', 2], [18, 'G#5', 1], [19, 'C#6', 2], [26, 'F#5', 1], [27, 'E5', 2]];
const sz = {
  kick: X('kick', 'x.....x...x.....', { o: KICK }),
  kickEss: X('kick', 'x..x..x...x..x..', { o: KICK }),
  kick4: X('kick', 'x...x...x...x...', { vel: 1.05, o: KICK }),
  snare: X('snare', '....x..-....x.-.', { o: { dec: 0.17, tone: 205, snap: 0.95, body: 0.6 } }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.8 }),
  hat8: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 0.6 }),
  ohat: X('ohat', '..............x.', { vel: 0.6, o: { dec: 0.2 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.6 }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.6 }),
  crash8: X('crash', 'x...............|'.repeat(8), { vel: 0.6 }),
  tomFill: X('tom', '................|................|................|........x.x.x.x.', { vel: 0.8, o: { f: 140 } }),
  riser: X('riser', 'x...............|................|................|................', { vel: 0.5, o: { dur: 60 / 136 * 16 } }),
  slapV: bassline('slap', SV, SLAP, 2),
  slapC: bassline('slap', SC, SLAP, 2),
  slapE: bassline('slap', SE, [[0, 0, 2, 0.95], [3, 0, 1, 0.6], [6, 12, 1, 0.85, { pop: true }], [10, 7, 1, 0.75], [13, 12, 1, 0.85, { pop: true }]], 2),
  slapS: bassline('slap', SS, [[0, 0, 6, 0.9], [8, 7, 4, 0.7], [14, 12, 1, 0.7, { pop: true }]], 2),
  pedal: bassline('hbass', S130, [[0, 0, 1, 0.9], [2, 12, 1, 0.7], [4, 0, 1, 0.9], [6, 12, 1, 0.7], [8, 0, 1, 0.9], [10, 12, 1, 0.7], [12, 0, 1, 0.9], [14, 12, 1, 0.7]], 1, { o: { cut: 1400, q: 3, fdec: 0.1 } }),
  rhodesV: comp('rhodes', SV, 'x.....x...x.....', 60, { len: 3, vel: 0.7 }),
  rhodesC: comp('rhodes', SC, 'x.....x.x.....x.', 60, { len: 3, vel: 0.8 }),
  rhodesS: comp('rhodes', SS, 'x...............', 60, { len: 16, vel: 0.75 }),
  rhodesIn: comp('rhodes', SV, 'x.......x.......', 60, { len: 8, vel: 0.55 }),
  brassV: comp('brass', SV, '..............x.', 60, { len: 2, vel: 0.6, part: { lvl: 0.5 } }),
  brassC: comp('brass', SC, 'x.....x.......x.', 60, { len: 2, vel: 0.75 }),
  brass130: comp('brass', S130, 'x...............', 60, { len: 16, vel: 0.8 }),
  pad130: comp('strings', S130, 'x...............', 59, { len: 16, vel: 0.6 }),
  padC: comp('strings', SC, 'x...............', 64, { len: 16, vel: 0.45, part: { lvl: 0.5 } }),
  sax: mel('sax', 64, VM),
  saxIn: mel('sax', 64, [[0, 'G#4', 8, 0.6], [8, 'B4', 8, 0.6], [32, 'F#4', 8, 0.6], [40, 'D#4', 24, 0.6, { glide: 'F#4' }]]),
  lead: mel('lead', 64, CM),
  leadSpoon: mel('lead', 64, [[0, 'E5', 16, 0.75], [16, 'G#5', 16, 0.8, { glide: 'E5' }], [32, 'B5', 16, 0.85, { glide: 'G#5' }], [48, 'A5', 16, 0.8, { glide: 'B5' }]]),
  // 130R: the lead climbs and HOLDS — four bars, no landing
  lead130: mel('lead', 64, [[0, 'B5', 16, 0.9], [16, 'E6', 48, 1.0, { glide: 'B5' }]]),
  essL: mel('pluck', 32, ESS_L, { vel: 0.9 }),
  essR: mel('stab', 32, ESS_R, { vel: 0.8 }),
  arpS: arp('bell', SS, 64, [0, 2, 4, 6, 4, 2, 1, 3], 2, { vel: 0.35, span: 2 }),
  // CASIO: flick left, flick right, a breath, the fill — and the royal road comes home
  casioL: mel('pluck', 16, [[0, ['B4', 'E5', 'A5'], 2, 1.0]]),
  casioR: mel('stab', 16, [[3, ['B4', 'E5', 'A5'], 2, 1.0]]),
  casioKick: X('kick', 'x..x............', { vel: 1.1, o: KICK }),
  casioCrash: X('crash', 'x...............', { vel: 0.8 }),
  casioFill: X('tom', '........x.x.x.xx', { vel: 0.85, o: { f: 150 } }),
  casioSnare: X('snare', '............xxxx', { vel: 0.7, o: { dec: 0.1, tone: 210, snap: 1, body: 0.4 } }),
};
const CHORUS = [sz.kick, sz.snare, sz.hat, sz.ohat, sz.slapC, sz.rhodesC, sz.brassC, sz.lead, sz.padC, sz.tomFill];
const hachinoji = {
  id: 'hachinoji', mood: 'fun', name: 'HACHI NO JI', artist: 'Xanboo78o Studios', bpm: 136, key: 'E', swing: 0.08, human: 0.004, loop: true,
  duck: 0.12, drumLevel: 0.72, drumDrive: 1.2,
  mix: { lead: { g: 0.48, send: { delay: 0.3, hall: 0.25 } }, sax: { g: 0.55 }, slap: { g: 0.5 }, rhodes: { g: 0.45 }, brass: { g: 0.42 },
    pluck: { g: 0.55, pan: -0.8 }, stab: { g: 0.5, pan: 0.8, duck: 0 }, hbass: { g: 0.5 }, strings: { g: 0.32 } },
  sections: [
    { name: 'intro', bars: 4, parts: [sz.hat8, sz.rhodesIn, sz.saxIn] },
    { name: 'verse', bars: 8, parts: [sz.kick, sz.snare, sz.hat, sz.slapV, sz.rhodesV, sz.brassV, sz.sax, sz.tomFill] },
    { name: 'chorus', bars: 8, drop: true, parts: [sz.crash, ...CHORUS] },
    { name: 'ESSES', bars: 8, drop: true, parts: [sz.kickEss, sz.snare, sz.hat, sz.slapE, sz.essL, sz.essR, sz.tomFill] },
    { name: 'verse 2', bars: 8, parts: [sz.kick, sz.snare, sz.hat, sz.slapV, sz.rhodesV, sz.brassV, sz.sax, sz.essL, sz.tomFill] },
    { name: 'chorus 2', bars: 8, drop: true, parts: [sz.crash, ...CHORUS] },
    { name: 'SPOON', bars: 4, parts: [sz.hat8, sz.slapS, sz.rhodesS, sz.leadSpoon, sz.arpS] },
    { name: '130R', bars: 4, drop: true, parts: [sz.crash, sz.kick4, sz.ride, sz.hat, sz.pedal, sz.brass130, sz.pad130, sz.lead130, sz.riser] },
    { name: 'CASIO', bars: 1, parts: [sz.casioKick, sz.casioCrash, sz.casioL, sz.casioR, sz.casioFill, sz.casioSnare] },
    { name: 'chorus 3', bars: 8, drop: true, parts: [sz.crash8, ...CHORUS, sz.essL, sz.essR] },
    { name: 'outro', bars: 4, fade: true, parts: [sz.hat8, sz.rhodesIn, sz.saxIn, sz.slapS] },
  ],
};

// =============================================================================
// AMEFURI (rainfall) — the less fun one. Suzuka in the rain, the grandstands
// under umbrellas. Koto in the miyako-bushi scale (E F A B C), a shakuhachi
// breathing over it, a slow lo-fi beat through tape and rain. The signature is
// the CROSSOVER: the figure of eight passes over itself, so the shakuhachi
// plays the koto's own melody two beats behind it, the line crossing its own
// path. A minor, 72.
// =============================================================================
const AC = ['Am7', 'Fmaj7', 'Dm7', 'Esus4'];
const KM = [[0, 'E5', 4], [4, 'F5', 2], [6, 'E5', 2], [8, 'C5', 8],
  [16, 'A4', 4], [20, 'B4', 4], [24, 'B4', 8, 0.85, { bend: 1 }],
  [32, 'A4', 6], [38, 'F4', 2], [40, 'A4', 8],
  [48, 'B4', 4], [52, 'A4', 4], [56, 'E4', 8]];
const SH = [[0, 'A4', 16], [16, 'C5', 8, 0.8, { glide: 'A4' }], [24, 'B4', 8], [32, 'A4', 12], [44, 'F4', 4], [48, 'E4', 16, 0.8, { glide: 'F4' }]];
// the crossover: the koto's melody, two beats late, on the shakuhachi
const canon = KM.map(([s, n, l]) => [(s + 8) % 64, n, Math.min(l, 8), 0.8]);
const am = {
  kick: X('kick', 'x......x..x.....', { vel: 0.62, o: { f0: 140, f1: 50, dec: 0.35, drive: 1.8, click: 0.3, lp: 1200 } }),
  snare: X('snare', '....x.......x...', { vel: 0.75, o: { dec: 0.22, tone: 175, snap: 0.9, body: 0.7 } }),
  hat: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 0.5, o: { dec: 0.05, hp: 6500 } }),
  rim: X('rim', '.......x......x.', { vel: 0.4 }),
  shaker: X('shaker', '..x...x...x...x.', { vel: 0.35 }),
  sub: bassline('sub', AC, [[0, 0, 8, 0.24], [10, 0, 6, 0.18]], 2),
  rhodes: comp('rhodes', AC, 'x.......x.......', 57, { len: 7, vel: 0.5 }),
  rhodesSoft: comp('rhodes', AC, 'x...............', 57, { len: 16, vel: 0.4 }),
  koto: mel('koto', 64, KM),
  kotoArp: arp('koto', AC, 52, [0, 2, 1, 3, 2, 4, 3, 5], 2, { vel: 0.5, span: 2 }),
  shaku: mel('shaku', 64, SH),
  canon: N('shaku', canon.map(([s, n, l, v]) => [s, midi(n), l, v]), 64),
  pad: comp('strings', AC, 'x...............', 57, { len: 16, vel: 0.4, part: { o: { pad: true } } }),
  kotoIntro: mel('koto', 64, [[0, 'E4', 8], [8, 'A4', 8], [16, 'B4', 16, 0.8, { bend: 1 }], [32, 'F4', 8], [40, 'E4', 24]]),
};
const amefuri = {
  id: 'amefuri', mood: 'less fun', name: 'AMEFURI', artist: 'Xanboo78o Studios', bpm: 72, key: 'Am', swing: 0.22, human: 0.008, loop: true,
  duck: 0.2, duckRelease: 0.25, vinyl: 0.7, tape: 0.8, drumLevel: 0.7,
  mix: { koto: { g: 0.6 }, shaku: { g: 0.5 }, rhodes: { g: 0.45, lp: 3000 }, sub: { g: 0.4 }, strings: { g: 0.28 } },
  sections: [
    { name: 'intro', bars: 4, parts: [am.kotoIntro, am.rhodesSoft] },
    { name: 'rain', bars: 8, parts: [am.kick, am.snare, am.hat, am.rim, am.sub, am.rhodes, am.koto] },
    { name: 'shakuhachi', bars: 8, drop: true, parts: [am.kick, am.snare, am.hat, am.shaker, am.sub, am.rhodes, am.kotoArp, am.shaku] },
    { name: 'CROSSOVER', bars: 8, drop: true, parts: [am.kick, am.snare, am.hat, am.shaker, am.rim, am.sub, am.rhodes, am.koto, am.canon, am.pad] },
    { name: 'outro', bars: 4, fade: true, parts: [am.kotoIntro, am.rhodesSoft] },
  ],
};

export const CIRCUIT = { id: 'suzuka', name: 'SUZUKA', tag: 'Japan · city pop fusion / koto in the rain', color: '#e8e8e8', songs: [hachinoji, amefuri] };
