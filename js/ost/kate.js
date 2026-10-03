// KATE MASCOI CIRCUIT — Adam's own. Measured from data/tracks/kate.json:
// 4.9 km, 20 m wide, only FOUR corners and two DRS zones. A 1.4 km straight
// ends at the MASCOI HAIRPIN (178°, R45 — the big braking overtake), then the
// Switchback, then a 2.6 km straight to Last Chance. WIDE · FAST · BATTLES.
// So: the fun song is the battle — a DRS straight that builds and builds,
// the hairpin slamming everything round 180° (the riff plays BACKWARDS), and a
// chorus with two guitars side by side, left and right, wheel to wheel. The
// less fun song is the 2.6 km straight alone: THE LONG ONE, one chord, flat
// out, a layer added every few bars until it breaks open.

import { X, N, comp, bassline, arp, mel, midi } from '../ostkit.js';

// =============================================================================
// DOWN THE INSIDE — the fun one. Rally house × pop-punk, 126, E major.
// 90s house underneath (clean kick, garage hats, offbeat bounce bass, a phonk
// cowbell), the RIFF on a bright PSX pluck, palm-muted chugs in the verse,
// open power chords in the chorus — dist on the left, dist2 on the right.
// =============================================================================
const KV = ['E', 'B', 'C#m', 'A'];                     // verse
const KC = ['A', 'B', 'E', 'C#m'];                     // chorus
const HOUSE_KICK = { f0: 180, f1: 50, sweep: 0.05, dec: 0.22, drive: 1.3, click: 0.6 };
const BOUNCE = [[2, 0, 1, 0.9], [6, 0, 1, 0.9], [10, 0, 1, 0.9], [14, 0, 1, 0.9]];
const BOUNCE_O = { cut: 1100, q: 2, fdec: 0.1 };
const CHUG = [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, 0, 1, i % 4 === 0 ? 0.95 : 0.7, { mute: true }]);
const OPEN = [[0, 0, 6, 0.95], [6, 0, 2, 0.75], [8, 0, 6, 0.9], [14, 0, 2, 0.75]];
// the riff: two bars, the second one reaching up to the C#
const RIFF = [[0, 'E5', 2], [2, 'E5', 1], [3, 'F#5', 2], [6, 'G#5', 2], [8, 'B5', 2], [10, 'G#5', 1], [11, 'F#5', 2], [14, 'E5', 2],
  [16, 'E5', 2], [18, 'E5', 1], [19, 'F#5', 2], [22, 'G#5', 2], [24, 'C#6', 2], [26, 'B5', 1], [27, 'G#5', 2], [30, 'F#5', 2]];
const riff = (vel, cut) => N('pluck', RIFF.map(([s, n, l]) => [s, [midi(n)], l, vel, cut ? { cut, floor: 600 } : undefined]), 32);
// the DRS straight: the riff over 8 bars with its filter opening hit by hit
const riffSweep = (() => { const ev = [], n = RIFF.length * 4; let k = 0;
  for (let r = 0; r < 4; r++) for (const [s, nm, l] of RIFF) { const u = k++ / n; ev.push([r * 32 + s, [midi(nm)], l, 0.55 + 0.35 * u, { cut: 700 * Math.pow(12, u), floor: 500 }]); }
  return N('pluck', ev, 128); })();
// the hairpin: the riff's first bar turned round 180° — played backwards on the organ
const REV = RIFF.slice(0, 8).map(([s, n, l]) => [16 - s - l, [midi(n)], l, 0.85]);
const CM = [[0, 'C#5', 2], [2, 'E5', 2], [4, 'E5', 4], [8, 'F#5', 2], [10, 'E5', 2], [12, 'C#5', 4],
  [16, 'D#5', 2], [18, 'F#5', 2], [20, 'F#5', 4], [24, 'G#5', 2], [26, 'F#5', 2], [28, 'D#5', 4],
  [32, 'E5', 2], [34, 'G#5', 2], [36, 'B5', 6], [42, 'A5', 2], [44, 'G#5', 4],
  [48, 'G#5', 4], [52, 'E5', 4], [56, 'C#5', 8]];
const kd = {
  kick: X('kick', 'x...x...x...x...', { o: HOUSE_KICK }),
  kickIn: X('kick', '................|'.repeat(4) + 'x...x...x...x...|'.repeat(4), { o: HOUSE_KICK }),
  clap: X('clap', '....x.......x...', { vel: 0.85 }),
  snare: X('snare', '....x.......x...', { vel: 0.75, o: { dec: 0.16, tone: 195, snap: 0.9, body: 0.6 } }),
  punk: X('snare', '....x.......x..x', { vel: 0.95, o: { dec: 0.18, tone: 200, snap: 1, body: 0.75 } }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.85, o: { dec: 0.045 } }),
  hatSoft: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.5, o: { dec: 0.045 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.8, o: { dec: 0.16 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.5 }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.6 }),
  cowbell: X('cowbell', '......x.......x.|..........x.....', { vel: 0.6, o: { dec: 0.2 } }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.65 }),
  roll: X('snare', '................|'.repeat(6) + 'x...x...x...x...|x.x.x.x.xxxxxxxx', { vel: 0.6, o: { dec: 0.1, snap: 1, body: 0.4 } }),
  roll4: X('snare', '................|'.repeat(2) + 'x...x...x...x...|x.x.x.x.xxxxxxxx', { vel: 0.6, o: { dec: 0.1, snap: 1, body: 0.4 } }),
  riser8: X('riser', 'x...............|'.repeat(8), { vel: 0.4, o: { dur: 60 / 126 * 32 } }),
  riser4: X('riser', 'x...............|'.repeat(4), { vel: 0.4, o: { dur: 60 / 126 * 16 } }),
  flutter: X('flutter', '................|'.repeat(7) + '............x...', { vel: 0.6, o: { dur: 0.6 } }),
  bassV: bassline('hbass', KV, BOUNCE, 2, { o: BOUNCE_O }),
  bassC: bassline('hbass', KC, BOUNCE, 2, { o: BOUNCE_O }),
  bassB: bassline('hbass', ['B'], BOUNCE, 2, { o: BOUNCE_O }),
  subV: bassline('sub', KV, [[0, 0, 2, 0.6]], 2),
  subC: bassline('sub', KC, [[0, 0, 2, 0.6]], 2),
  subHold: bassline('sub', KV, [[0, 0, 16, 0.2]], 2),
  riff: riff(0.9), riffSoft: riff(0.45, 1100), riffSweep,
  chugV: bassline('dist', KV, CHUG, 2),
  chugB: bassline('dist', ['B'], CHUG, 2),
  openL: bassline('dist', KC, OPEN, 2),
  openR: bassline('dist2', KC, OPEN.map(([s, i, l, v]) => [s, i + 12, l, v * 0.85]), 2),
  // the battle: dist2 on the right shadows the chorus tune an octave down, a car's length behind
  shadow: N('dist2', CM.map(([s, n, l]) => [s, [midi(n) - 12], l, 0.6]), 64, { lvl: 0.3 }),
  chorus: mel('lead', 64, CM),
  chorusHi: N('pluck', CM.map(([s, n, l]) => [s, [midi(n) + 12], l, 0.35, { maxDur: 0.4 }]), 64, { lvl: 0.4 }),
  choir: comp('oo', KC, 'x...............', 57, { len: 16, vel: 0.5, part: { lvl: 0.4, o: { a: 0.25, voices: 3, vowel: 'ah' } } }),
  padV: comp('strings', KV, 'x...............', 56, { len: 16, vel: 0.3, part: { o: { pad: true } } }),
  // ---- MASCOI HAIRPIN: bar 1 the stop, bar 2 the riff turned round ----
  hpStab: mel('stab', 32, [[0, ['E4', 'G#4', 'B4', 'E5'], 3, 1]]),
  hpBoom: X('boom', 'x...............|................', { vel: 0.9 }),
  hpKick: X('kick', 'x...............|x...x...x...x...', { vel: 1.05, o: HOUSE_KICK }),
  hpCrash: X('crash', 'x...............|................', { vel: 0.8 }),
  hpPops: X('antilag', '....x.....x.....|................', { vel: 0.65, o: { n: 4 } }),
  hpDown: mel('sub', 32, [[4, 'E3', 2, 0.7, { glide: 'B3' }], [6, 'B2', 2, 0.65, { glide: 'F#3' }], [8, 'G#2', 2, 0.65, { glide: 'D#3' }], [10, 'E2', 2, 0.7, { glide: 'B2' }]]),
  hpRev: N('m1', REV.map(([s, n, l, v]) => [16 + s, n, l, v]), 32),
  hpRoll: X('snare', '................|........x.x.xxxx', { vel: 0.7, o: { dec: 0.09, snap: 1, body: 0.4 } }),
  hpFlutter: X('flutter', '................|x...............', { vel: 0.5, o: { dur: 0.5 } }),
};
const HAIRPIN = [kd.hpStab, kd.hpBoom, kd.hpKick, kd.hpCrash, kd.hpPops, kd.hpDown, kd.hpRev, kd.hpRoll, kd.hpFlutter];
const BATTLE = [kd.crash, kd.kick, kd.clap, kd.punk, kd.hat, kd.ohat, kd.ride, kd.shaker, kd.cowbell, kd.bassC, kd.subC, kd.openL, kd.openR, kd.shadow, kd.chorus, kd.chorusHi, kd.choir];
const downtheinside = {
  id: 'downtheinside', mood: 'fun', name: 'DOWN THE INSIDE', artist: 'Xanboo78o Studios', bpm: 126, key: 'E', swing: 0.12, loop: true,
  duck: 0.42, duckRelease: 0.18, drumLevel: 0.85, drumDrive: 1.3,
  mix: { pluck: { g: 0.55 }, hbass: { g: 0.62 }, sub: { g: 0.45 }, lead: { g: 0.45, send: { delay: 0.25, hall: 0.2 } }, m1: { g: 0.65 }, stab: { g: 0.6 }, dist: { g: 0.36 }, dist2: { g: 0.3 } },
  sections: [
    { name: 'intro', bars: 8, parts: [kd.kickIn, kd.hatSoft, kd.shaker, kd.riffSoft, kd.subHold] },
    { name: 'verse', bars: 16, parts: [kd.kick, kd.clap, kd.snare, kd.hat, kd.ohat, kd.shaker, kd.cowbell, kd.bassV, kd.subV, kd.riff, kd.chugV, kd.padV] },
    { name: 'DRS', bars: 8, parts: [kd.kick, kd.clap, kd.hat, kd.ohat, kd.bassB, kd.chugB, kd.riffSweep, kd.riser8, kd.roll, kd.flutter] },
    { name: 'MASCOI HAIRPIN', bars: 2, parts: HAIRPIN },
    { name: 'side by side', bars: 16, drop: true, parts: BATTLE },
    { name: 'break', bars: 8, parts: [kd.hatSoft, kd.shaker, kd.riffSoft, kd.padV, kd.choir, kd.subHold] },
    { name: 'DRS 2', bars: 4, parts: [kd.kick, kd.clap, kd.hat, kd.bassB, kd.chugB, kd.riff, kd.riser4, kd.roll4] },
    { name: 'MASCOI HAIRPIN 2', bars: 2, parts: HAIRPIN },
    { name: 'side by side 2', bars: 16, drop: true, parts: [...BATTLE, kd.riff] },
    { name: 'outro', bars: 8, fade: true, parts: [kd.kick, kd.hat, kd.bassV, kd.riffSoft] },
  ],
};

// =============================================================================
// THE LONG ONE — the less fun one. 92, G major, sincere pop-punk/emo: a clean
// guitar arpeggio alone ('twang' with its tremolo off — brighter than 'guitar'), a melody that means it, and the 2.6 km straight —
// sixteen bars on ONE chord, flat out, alone with your thoughts, a layer
// added every four bars (drums, then chugs and voices, then the roll) until
// it bursts into the last chorus with everything open.
// =============================================================================
const LV = ['G', 'D', 'Em', 'C'];
const LC = ['C', 'G', 'D', 'Em'];
const LL = ['Gadd9', 'G', 'Gadd9', 'G'];
const LVM = [[0, 'B4', 4], [4, 'D5', 4], [8, 'D5', 2], [10, 'B4', 2], [12, 'A4', 4],
  [16, 'A4', 4], [20, 'F#4', 2], [22, 'A4', 2], [24, 'D5', 8],
  [32, 'E5', 4], [36, 'D5', 2], [38, 'B4', 2], [40, 'G4', 8],
  [48, 'G4', 4], [52, 'A4', 4], [56, 'E4', 8]];
const LCM = [[0, 'E5', 6], [6, 'D5', 2], [8, 'C5', 4], [12, 'E5', 4],
  [16, 'D5', 6], [22, 'B4', 2], [24, 'G5', 8],
  [32, 'F#5', 6], [38, 'E5', 2], [40, 'D5', 4], [44, 'A5', 4],
  [48, 'G5', 8], [56, 'E5', 4], [60, 'D5', 4]];
const OPEN_SLOW = [[0, 0, 8, 0.9], [8, 0, 6, 0.8], [14, 0, 2, 0.7]];
const lo = {
  arpV: arp('twang', LV, 55, [0, 2, 4, 5, 4, 2, 1, 3], 2, { vel: 0.7, span: 2, part: { o: { tremDepth: 0 } } }),
  arpC: arp('twang', LC, 55, [0, 2, 4, 5, 4, 2, 1, 3], 2, { vel: 0.75, span: 2, part: { o: { tremDepth: 0 } } }),
  arpL: arp('twang', LL, 55, [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 6, 5, 4, 3], 1, { vel: 0.6, span: 2, part: { o: { tremDepth: 0 } } }),
  verse: mel('lead', 64, LVM, { vel: 0.7 }),
  verseOo: mel('oo', 64, LVM, { vel: 0.4, o: { a: 0.15, voices: 2 } }),
  chorus: mel('lead', 64, LCM, { vel: 0.8 }),
  chorusOo: mel('oo', 64, LCM, { vel: 0.5, o: { a: 0.15, voices: 3, vowel: 'ah' } }),
  kick: X('kick', 'x.....x...x.....', { vel: 0.85, o: { f0: 150, f1: 52, dec: 0.32, drive: 1.6, click: 0.4 } }),
  kickQ: X('kick', 'x...x...x...x...', { vel: 0.55, o: { f0: 160, f1: 58, dec: 0.22, drive: 1.3, click: 0.5 } }),
  kickBig: X('kick', 'x.....x.x.x.....', { vel: 1.0, o: { f0: 150, f1: 52, dec: 0.34, drive: 2, click: 0.45 } }),
  snare: X('snare', '....x.......x...', { vel: 0.85, o: { dec: 0.24, tone: 180, snap: 1, body: 0.8 } }),
  hat: X('hat', 'x.o.x.o.x.o.x.o.', { vel: 0.7, o: { dec: 0.05 } }),
  ride: X('ride', 'x.x.x.x.x.x.x.x.', { vel: 0.55 }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.6 }),
  roll: X('snare', 'x...x...x...x...|x.x.x.x.x.x.x.x.|x.x.x.x.xxxxxxxx|xxxxxxxxxxxxxxxx', { vel: 0.6, o: { dec: 0.1, snap: 1, body: 0.5 } }),
  riser: X('riser', 'x...............|'.repeat(4), { vel: 0.45, o: { dur: 60 / 92 * 16 } }),
  sub: bassline('sub', LV, [[0, 0, 8, 0.5], [10, 0, 6, 0.4]], 2),
  subC: bassline('sub', LC, [[0, 0, 8, 0.55], [8, 0, 8, 0.45]], 2),
  subL: bassline('sub', LL, [[0, 0, 8, 0.2], [8, 0, 8, 0.16]], 2),
  chugL: bassline('dist', LL, CHUG, 2),
  openC: bassline('dist', LC, OPEN_SLOW, 2),
  openC2: bassline('dist2', LC, OPEN_SLOW.map(([s, i, l, v]) => [s, i + 12, l, v * 0.8]), 2),
  choirL: comp('oo', LL, 'x...............', 55, { len: 16, vel: 0.7, part: { o: { a: 0.6, voices: 3, vowel: 'ah' } } }),
  pad: comp('strings', LC, 'x...............', 55, { len: 16, vel: 0.45, part: { o: { pad: true } } }),
  bell: mel('bell', 64, [[0, 'D6', 16, 0.5], [16, 'B5', 16, 0.45], [32, 'G5', 16, 0.45], [48, 'A5', 16, 0.5]], { lvl: 0.3 }),
};
const thelongone = {
  id: 'thelongone', mood: 'less fun', name: 'THE LONG ONE', artist: 'Xanboo78o Studios', bpm: 92, key: 'G', swing: 0.06, human: 0.005, loop: true,
  duck: 0.2, duckRelease: 0.2, drumLevel: 0.8, drumDrive: 1.4, tape: 0.4,
  mix: { twang: { g: 1.3, lp: 4600, send: { room: 0.3, hall: 0.25 } }, lead: { g: 0.4, lp: 3200, send: { delay: 0.3, hall: 0.35 } }, oo: { g: 0.5 }, sub: { g: 0.2 }, dist: { g: 0.5 }, dist2: { g: 0.4 } },
  sections: [
    { name: 'intro', bars: 4, parts: [lo.arpV] },
    { name: 'verse', bars: 8, parts: [lo.arpV, lo.verse, lo.verseOo, lo.kick, lo.hat, lo.sub] },
    { name: 'chorus', bars: 8, drop: true, parts: [lo.arpC, lo.chorus, lo.chorusOo, lo.kick, lo.snare, lo.hat, lo.subC, lo.pad, lo.bell] },
    { name: 'THE LONG ONE', bars: 4, parts: [lo.arpL, lo.subL] },
    { name: 'still flat out', bars: 4, parts: [lo.arpL, lo.subL, lo.kickQ, lo.hat] },
    { name: 'alone out there', bars: 4, parts: [lo.arpL, lo.subL, lo.kickQ, lo.hat, lo.snare, lo.chugL, lo.choirL] },
    { name: 'lift', bars: 4, parts: [lo.arpL, lo.subL, lo.kickQ, lo.ride, lo.chugL, lo.choirL, lo.roll, lo.riser] },
    { name: 'last chorus', bars: 8, drop: true, parts: [lo.crash, lo.arpC, lo.chorus, lo.chorusOo, lo.kickBig, lo.snare, lo.ride, lo.subC, lo.openC, lo.openC2, lo.pad, lo.bell] },
    { name: 'outro', bars: 4, fade: true, parts: [lo.arpV] },
  ],
};

export const CIRCUIT = { id: 'kate', name: 'KATE MASCOI CIRCUIT', tag: "Adam's own", color: '#ff3d7f', songs: [downtheinside, thelongone] };
