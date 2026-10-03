// ZANDVOORT — the Netherlands. Old-school and narrow, a rollercoaster up and
// down through the DUNES with sand blowing across the track, and the BANKED
// corners: Hugenholtz, and above all the Arie Luyendyk banking onto the
// straight — 18°, flat out, the car pressed down into the road and you pressed
// into the seat. And the ORANGE ARMY, a whole grandstand singing. So both
// songs have one banked section where the music leans: it glides upward,
// pumps under the pressure, and comes out the other side in a higher key.

import { X, N, trp, comp, bassline, arp, mel, midi } from '../ostkit.js';

// =============================================================================
// ORANJELEGIOEN — the fun one. The orange army: a Dutch brass band with oompah
// (low brass on one and three, accordion "pah" on two and four) over a clean
// 90s house kick, and the grandstand chanting the tune on 'oh'. The dunes are
// a rollercoaster break where an accordion arpeggio climbs and plunges. Then
// the LUYENDYK BANKING: every line glides upward bar by bar, the kick pumps
// the whole band down like g-force, and the last chorus lands a whole tone up.
// =============================================================================
const OC = ['Bb', 'F', 'Gm', 'Eb'];                   // I V vi IV
const OD = ['Gm', 'Eb', 'Bb', 'F'];                   // the dunes
const OB = ['Eb', 'F', 'G', 'G'];                     // the banking: climbs to G, the V of the new key (C)
const KICK = { f0: 175, f1: 50, sweep: 0.05, dec: 0.24, drive: 1.3, click: 0.6 };
// the chant: "olé olé olé olé" shape, four bars
const CHANT = [[0, 'D5', 4], [4, 'Bb4', 2], [6, 'D5', 2], [8, 'F5', 8],
  [16, 'C5', 4], [20, 'A4', 2], [22, 'C5', 2], [24, 'F5', 8],
  [32, 'D5', 4], [36, 'Bb4', 2], [38, 'D5', 2], [40, 'G5', 8],
  [48, 'Eb5', 4], [52, 'D5', 4], [56, 'C5', 4], [60, 'Bb4', 4]];
// the brass riff: bright, major, bouncing
const RIFF = [[0, 'F4', 1], [2, 'Bb4', 1], [3, 'D5', 2], [6, 'C5', 1], [8, 'Bb4', 2], [11, 'F4', 1], [12, 'G4', 2], [14, 'A4', 2],
  [16, 'A4', 1], [18, 'C5', 1], [19, 'F5', 2], [22, 'Eb5', 1], [24, 'D5', 2], [27, 'C5', 1], [28, 'A4', 4]];
// the banking line: one long glide up per half-bar, into the new key
const BANK = [[0, 'Bb4', 8], [8, 'C5', 8, 0.85, { glide: 'Bb4' }], [16, 'D5', 8, 0.85, { glide: 'C5' }], [24, 'F5', 8, 0.9, { glide: 'D5' }],
  [32, 'G5', 16, 0.95, { glide: 'F5' }], [48, 'B5', 16, 1, { glide: 'G5' }]];
const or = {
  kick: X('kick', 'x...x...x...x...', { o: KICK }),
  kickPress: X('kick', 'x...x...x...x...', { vel: 1.05, o: { ...KICK, duck: 0.85 } }),
  clap: X('clap', '....x.......x...', { vel: 0.8 }),
  crowdClap: X('clap', 'x...x...x...x...', { vel: 0.55 }),
  snare: X('snare', '....x.......x...', { vel: 0.6, o: { dec: 0.16, tone: 200, snap: 0.9, body: 0.6 } }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.5, o: { dec: 0.04 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.75, o: { dec: 0.12 } }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.45 }),
  toms: X('tom', 'x.......x.x.....', { vel: 0.8, o: { f: 90, dec: 0.5 } }),
  tomFill: X('tom', '................|................|................|x.x.x.x.x.x.xxxx', { vel: 0.7, o: { f: 140, dec: 0.25 } }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.6 }),
  crashOnce: X('crash', 'x...............|'.repeat(8), { vel: 0.65 }),
  roll: X('snare', '................|................|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx', { vel: 0.5, o: { dec: 0.1, tone: 210, snap: 1, body: 0.4 } }),
  sand: X('riser', 'x...............|................|................|................', { vel: 0.3, o: { dur: 60 / 124 * 16 } }),
  // oompah: low brass on one and three (root, fifth), accordion "pah" on two and four
  oom: bassline('brass', OC, [[0, 0, 3, 0.75], [8, 7, 3, 0.6]], 2),
  pah: comp('accordion', OC, '....x.......x...', 60, { len: 2, vel: 0.75 }),
  bounce: bassline('hbass', OC, [[2, 0, 1, 0.9], [6, 0, 1, 0.85], [10, 0, 1, 0.9], [14, 0, 1, 0.85]], 2, { o: { cut: 1300, q: 2, fdec: 0.1 } }),
  sub: bassline('sub', OC, [[0, 0, 4, 0.25], [8, 0, 4, 0.2]], 1),
  riff: mel('brass', 32, RIFF, { vel: 0.85 }),
  chant: mel('oo', 64, CHANT, { o: { a: 0.03, voices: 5, vowel: 'oh' } }),
  chantLow: N('oo', CHANT.map(([s, n, l]) => [s, midi(n) - 12, l, 0.6]), 64, { o: { a: 0.03, voices: 4, vowel: 'ah' } }),
  chantSoft: mel('oo', 64, CHANT, { vel: 0.6, o: { a: 0.05, voices: 5, vowel: 'oh' } }),
  horns: N('brass', CHANT.map(([s, n, l]) => [s, [midi(n)], l, 0.7]), 64, { lvl: 0.4 }),
  stabs: comp('stab', OC, '..x...x...x...x.', 60, { len: 1, vel: 0.4, part: { lvl: 0.5 } }),
  // the dunes: up and down like the road through them
  dunesArp: arp('accordion', OD, 60, [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3], 1, { vel: 0.6, span: 2 }),
  dunesOom: bassline('brass', OD, [[0, 0, 6, 0.8], [8, 7, 6, 0.65]], 2),
  dunesPad: comp('strings', OD, 'x...............', 57, { len: 16, vel: 0.45, part: { o: { pad: true } } }),
  // the banking
  bankLead: mel('lead', 64, BANK),
  bankHorns: N('brass', BANK.map(([s, n, l, v, ex]) => [s, [midi(n) - 12], l, 0.75]), 64),
  bankChoir: comp('oo', OB, 'x...............', 57, { len: 16, vel: 0.6, part: { o: { a: 0.4, voices: 5, vowel: 'ah' } } }),
  bankBass: bassline('sub', OB, [[0, 0, 16, 0.22, {}]], 2),
  bankRiser: X('riser', 'x...............|................|................|................', { vel: 0.5, o: { dur: 60 / 124 * 16 } }),
  bankPad: comp('strings', OB, 'x...............', 60, { len: 16, vel: 0.55, part: { o: { pad: true } } }),
};
const FULL = [or.kick, or.clap, or.snare, or.hat, or.ohat, or.shaker, or.tomFill];
const FULL_N = [or.oom, or.pah, or.bounce, or.sub, or.chant, or.chantLow, or.horns, or.stabs];
const oranje = {
  id: 'oranje', mood: 'fun', name: 'ORANJELEGIOEN', artist: 'Xanboo78o Studios', bpm: 124, key: 'Bb', swing: 0.06, loop: true,
  duck: 0.4, duckRelease: 0.17, drumLevel: 0.8, drumDrive: 1.3,
  mix: { brass: { g: 0.45 }, accordion: { g: 0.36 }, oo: { g: 0.5 }, hbass: { g: 0.55 }, sub: { g: 0.4 }, lead: { g: 0.45 } },
  sections: [
    { name: 'intro', bars: 4, parts: [or.toms, or.crowdClap, or.chantSoft] },
    { name: 'verse', bars: 8, parts: [or.kick, or.snare, or.hat, or.ohat, or.oom, or.pah, or.sub, or.riff, or.tomFill] },
    { name: 'chorus', bars: 8, drop: true, parts: [or.crash, ...FULL, ...FULL_N] },
    { name: 'dunes', bars: 8, parts: [or.toms, or.hat, or.shaker, or.sand, or.dunesArp, or.dunesOom, or.dunesPad, or.roll] },
    { name: 'verse 2', bars: 8, parts: [or.kick, or.snare, or.hat, or.ohat, or.oom, or.pah, or.sub, or.riff, or.chantSoft, or.tomFill] },
    { name: 'LUYENDYK BANKING', bars: 4, parts: [or.kickPress, or.clap, or.hat, or.ohat, or.bankRiser, or.roll, or.bankLead, or.bankHorns, or.bankChoir, or.bankBass, or.bankPad] },
    { name: 'final chorus', bars: 16, drop: true, parts: [or.crashOnce, ...FULL, ...trp(FULL_N, 2), ...trp([or.riff], 2)] },
    { name: 'outro', bars: 4, fade: true, parts: [or.toms, or.crowdClap, ...trp([or.chantSoft], 2)] },
  ],
};

// =============================================================================
// NOORDZEEWIND — the less fun one. The North Sea on a grey afternoon: wind
// off the water, sand hissing over the kerbs, cold pads and a heartbeat bass
// (lub-dub) under a lonely bell. Its banked corner is HUGENHOLTZ, played slow:
// the whole song leans up a semitone for four bars, the heartbeat quickens and
// presses, then it settles back to the grey.
// =============================================================================
const NC = ['Em9', 'Cmaj7', 'G', 'D/F#'];
const NM = [[0, 'B4', 6], [8, 'G4', 4], [12, 'A4', 4], [16, 'E5', 8], [24, 'D5', 8],
  [32, 'D5', 6], [40, 'B4', 8], [48, 'A4', 12], [60, 'F#4', 4]];
const nz = {
  wind: X('riser', 'x...............|................|................|................', { vel: 0.3, o: { dur: 60 / 72 * 16 } }),
  gust: X('brush', 'x...............|........x.......', { vel: 0.9, o: { sweep: 2.2, f: 1400 } }),
  gust2: X('brush', '........x.......|x...............', { vel: 0.6, o: { sweep: 1.8, f: 700 } }),
  gustHi: X('brush', '........x.......|................', { vel: 0.6, o: { sweep: 1.4, f: 3200 } }),
  sandHiss: X('shaker', 'o-o-x-o-o-o-x-o-', { vel: 0.35 }),
  // the heartbeat: lub-dub, a soft kick and the sub together
  heart: X('kick', 'x..x............', { vel: 0.55, o: { f0: 95, f1: 42, dec: 0.4, drive: 1.1, click: 0.05, duck: 0.15 } }),
  heartFast: X('kick', 'x..x....x..x....', { vel: 0.7, o: { f0: 95, f1: 42, dec: 0.35, drive: 1.1, click: 0.05, duck: 0.45 } }),
  heartSub: bassline('sub', NC, [[0, 0, 2, 0.2], [3, 0, 3, 0.15]], 2),
  heartSubFast: bassline('sub', NC, [[0, 0, 2, 0.24], [3, 0, 2, 0.18], [8, 0, 2, 0.22], [11, 0, 2, 0.17]], 2),
  pad: comp('strings', NC, 'x...............', 52, { len: 16, vel: 0.5, part: { o: { pad: true } } }),
  padHi: comp('strings', NC, 'x...............', 64, { len: 16, vel: 0.3, part: { o: { pad: true }, lvl: 0.3 } }),
  padFar: comp('strings', NC, 'x...............', 64, { len: 16, vel: 0.18, part: { o: { pad: true } } }),
  bell: mel('bell', 64, NM, { vel: 0.55 }),
  voice: N('oo', NM.map(([s, n, l]) => [s, midi(n) - 12, l, 0.55]), 64, { o: { a: 0.35, voices: 3, vowel: 'oo' } }),
  pluck: arp('pluck', NC, 52, [0, 2, 4, 2], 4, { vel: 0.35, span: 2, part: { o: { cut: 2200, floor: 500 } } }),
  choir: comp('oo', NC, 'x...............', 57, { len: 16, vel: 0.45, part: { o: { a: 0.8, voices: 4, vowel: 'ah' } } }),
  swell: X('riser', 'x...............|................|................|................', { vel: 0.35, o: { dur: 60 / 72 * 16 } }),
};
const noordzee = {
  id: 'noordzee', mood: 'less fun', name: 'NOORDZEEWIND', artist: 'Xanboo78o Studios', bpm: 72, key: 'Em', swing: 0, human: 0.006, loop: true,
  duck: 0.2, duckRelease: 0.3, drumLevel: 0.7, drumDrive: 1.05, delay: 60 / 72 * 0.75,
  mix: { strings: { g: 0.38, lp: 4000 }, pad: { g: 0.4 }, bell: { g: 0.5 }, oo: { g: 0.42 }, sub: { g: 0.45 }, brush: { g: 0.55 } },
  sections: [
    { name: 'intro', bars: 4, parts: [nz.wind, nz.gust, nz.gust2, nz.heart, nz.heartSub, nz.padFar] },
    { name: 'grey', bars: 8, parts: [nz.wind, nz.gust, nz.gust2, nz.heart, nz.heartSub, nz.pad, nz.bell] },
    { name: 'sand', bars: 4, parts: [nz.wind, nz.gust, nz.gustHi, nz.sandHiss, nz.heart, nz.heartSub, nz.pluck, nz.pad] },
    { name: 'HUGENHOLTZ', bars: 4, drop: true, parts: [nz.swell, nz.gustHi, nz.heartFast, ...trp([nz.heartSubFast, nz.pad, nz.padHi, nz.choir, nz.bell, nz.pluck], 1)] },
    { name: 'grey 2', bars: 8, drop: true, parts: [nz.wind, nz.gust, nz.heart, nz.heartSub, nz.pad, nz.padHi, nz.bell, nz.voice, nz.pluck] },
    { name: 'outro', bars: 4, fade: true, parts: [nz.wind, nz.gust, nz.gust2, nz.heart, nz.heartSub, nz.padFar] },
  ],
};

export const CIRCUIT = { id: 'zandvoort', name: 'ZANDVOORT', tag: 'Netherlands · orange-army brass band / North Sea wind', color: '#ff7a00', songs: [oranje, noordzee] };
