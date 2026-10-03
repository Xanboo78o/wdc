// MONZA — Italy. The Temple of Speed: long flat-out sweeps (Curva Grande,
// Lesmo, Ascari, the Parabolica) where you barely lift, and ONE corner that
// stops everything — the Variante del Rettifilo at the end of the main
// straight, 340 down to 80 km/h. Adam: "its super fast and sweepy but hard on
// THAT 1 CORNER". So both songs flow in long gliding lines, and both have one
// brake point that slams the whole song to a stop.

import { X, N, trp, comp, bassline, arp, mel, midi } from '../ostkit.js';

// =============================================================================
// TEMPIO DELLA VELOCITÀ — the fun one. Italo disco, 1983, Milan: octave bass on
// the eighths, an arpeggio that never stops, a gated snare, and lead lines that
// GLIDE and hold for whole bars like a car committed through Curva Grande.
// Once per chorus the RETTIFILO: one huge stab, silence, the bass blipping down
// through the gears with the exhaust popping, a snare roll back on the
// throttle, and the chorus roars back. The last chorus goes up a whole tone.
// =============================================================================
const IV = ['Am', 'F', 'C', 'G'];                     // verse
const IC = ['F', 'G', 'Em', 'Am'];                    // chorus
const IB = ['Dm', 'Em', 'F', 'G'];                    // break
const KICK = { f0: 170, f1: 48, sweep: 0.05, dec: 0.3, drive: 1.4, click: 0.55 };
const OCT = [[0, 0, 1, 0.95], [2, 12, 1, 0.75], [4, 0, 1, 0.9], [6, 12, 1, 0.75], [8, 0, 1, 0.95], [10, 12, 1, 0.75], [12, 0, 1, 0.9], [14, 12, 1, 0.75]];
const OCT_O = { cut: 1700, q: 3.5, fdec: 0.11 };
const ARP16 = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3];
// verse: four long gliding notes a bar, sweeping between them
const VM = [[0, 'E5', 12], [12, 'D5', 4, 0.8, { glide: 'E5' }], [16, 'C5', 12, 0.85, { glide: 'D5' }], [28, 'A4', 4],
  [32, 'G5', 12, 0.9, { glide: 'E5' }], [44, 'E5', 4, 0.8, { glide: 'G5' }], [48, 'D5', 16, 0.85, { glide: 'E5' }]];
// chorus: soars up to the B and lands home on a long A
const CM = [[0, 'A5', 8], [8, 'G5', 4, 0.8, { glide: 'A5' }], [12, 'F5', 4], [16, 'G5', 8, 0.85, { glide: 'F5' }], [24, 'B5', 8, 0.95, { glide: 'G5' }],
  [32, 'B5', 4], [36, 'G5', 4], [40, 'E5', 8, 0.85, { glide: 'G5' }], [48, 'A5', 16, 0.95, { glide: 'E5' }]];
const it = {
  kick: X('kick', 'x...x...x...x...', { o: KICK }),
  kickIn: X('kick', '................|'.repeat(4) + 'x...x...x...x...|'.repeat(4), { o: KICK }),
  snare: X('snare', '....x.......x...', { vel: 0.85, o: { dec: 0.2, tone: 190, snap: 1.0, body: 0.6, gate: true } }),
  clap: X('clap', '....x.......x...', { vel: 0.6 }),
  hat: X('hat', 'x-o-x-o-x-o-x-o-', { vel: 0.55, o: { dec: 0.04 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.7, o: { dec: 0.1 } }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.5 }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.6 }),
  crashOnce: X('crash', 'x...............|'.repeat(8), { vel: 0.7 }),
  tomHi: X('tom', '................|................|................|........x.x.....', { vel: 0.75, o: { f: 190, dec: 0.3 } }),
  tomLo: X('tom', '................|................|................|............x.x.', { vel: 0.8, o: { f: 120, dec: 0.35 } }),
  roll: X('snare', 'x.......x.......|x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx', { vel: 0.55, o: { dec: 0.1, tone: 200, snap: 1, body: 0.4 } }),
  riser: X('riser', 'x...............|................|................|................', { vel: 0.4, o: { dur: 60 / 128 * 16 } }),
  bassV: bassline('hbass', IV, OCT, 2, { o: OCT_O }),
  bassC: bassline('hbass', IC, OCT, 2, { o: OCT_O }),
  bassB: bassline('hbass', IB, OCT, 2, { o: OCT_O }),
  bassHold: bassline('sub', IV, [[0, 0, 16, 0.22]], 2),
  arpV: arp('pluck', IV, 57, ARP16, 1, { vel: 0.5, span: 2 }),
  arpC: arp('pluck', IC, 57, ARP16, 1, { vel: 0.5, span: 2 }),
  arpB: arp('pluck', IB, 57, ARP16, 1, { vel: 0.42, span: 2, part: { o: { cut: 3200, floor: 800 } } }),
  arpDark: arp('pluck', IV, 57, ARP16, 1, { vel: 0.42, span: 2, part: { o: { cut: 1800, floor: 500 } } }),
  padV: comp('strings', IV, 'x...............', 57, { len: 16, vel: 0.4, part: { o: { pad: true } } }),
  padSoft: comp('strings', IV, 'x...............', 57, { len: 16, vel: 0.25, part: { o: { pad: true } } }),
  padC: comp('strings', IC, 'x...............', 60, { len: 16, vel: 0.55, part: { o: { pad: true } } }),
  padB: comp('strings', IB, 'x...............', 57, { len: 16, vel: 0.55, part: { o: { pad: true } } }),
  verse: mel('lead', 64, VM, { vel: 0.8 }),
  chorus: mel('lead', 64, CM),
  chorusOct: N('pluck', CM.map(([st, n, l]) => [st, [midi(n) + 12], l, 0.35, { maxDur: 0.5 }]), 64, { lvl: 0.4 }),
  choir: comp('oo', IC, 'x...............', 57, { len: 16, vel: 0.5, part: { lvl: 0.4, o: { a: 0.25, voices: 3, vowel: 'ah' } } }),
  choirB: mel('oo', 64, [[0, 'A4', 16, 0.5], [16, 'B4', 16, 0.5], [32, 'C5', 16, 0.55], [48, 'D5', 16, 0.6]], { o: { a: 0.4, voices: 3 } }),
  stabs: comp('stab', IC, '..x.......x..x..', 60, { len: 1, vel: 0.45, part: { lvl: 0.5 } }),
  // ---- the RETTIFILO: one bar, the whole song brakes ----
  brakeStab: comp('stab', ['Am'], 'X...............', 57, { len: 3, vel: 1, extra: 1 }),
  brakeBoom: X('boom', 'x...............', { vel: 0.6 }),
  brakeKick: X('kick', 'x...............', { vel: 1.1, o: KICK }),
  brakeCrash: X('crash', 'x...............', { vel: 0.8 }),
  // downshift: the bass blips down through the gears, each blip revving up into the note
  downshift: mel('sub', 16, [[4, 'A2', 1, 0.34, { glide: 'E3' }], [6, 'E2', 1, 0.32, { glide: 'B2' }], [8, 'C2', 1, 0.32, { glide: 'G2' }], [10, 'A1', 1, 0.34, { glide: 'E2' }]]),
  pops: X('antilag', '.....x...x......', { vel: 0.55, o: { n: 3 } }),
  reroll: X('snare', '............xxxx', { vel: 0.7, o: { dec: 0.09, tone: 210, snap: 1, body: 0.4 } }),
  reflutter: X('flutter', '........x.......', { vel: 0.45, o: { dur: 0.45 } }),
};
const CHORUS = [it.kick, it.snare, it.clap, it.hat, it.ohat, it.shaker, it.tomHi, it.tomLo];
const CHORUS_N = [it.bassC, it.arpC, it.padC, it.chorus, it.chorusOct, it.choir, it.stabs];
const BRAKE = [it.brakeKick, it.brakeBoom, it.brakeCrash, it.pops, it.reroll, it.reflutter];
const BRAKE_N = [it.brakeStab, it.downshift];
const tempio = {
  id: 'tempio', mood: 'fun', name: 'TEMPIO DELLA VELOCITÀ', artist: 'Xanboo78o Studios', bpm: 128, key: 'Am', swing: 0, loop: true,
  duck: 0.35, duckRelease: 0.16, drumLevel: 0.8, drumDrive: 1.25,
  mix: { pluck: { g: 0.5 }, lead: { g: 0.52, send: { delay: 0.35, hall: 0.3 } }, hbass: { g: 0.62 }, oo: { g: 0.45 }, sub: { g: 0.55 }, stab: { g: 0.6 } },
  sections: [
    { name: 'intro', bars: 8, parts: [it.kickIn, it.hat, it.arpDark, it.padSoft, it.bassHold] },
    { name: 'verse', bars: 16, parts: [it.kick, it.snare, it.hat, it.ohat, it.bassV, it.arpV, it.padV, it.verse, it.tomHi, it.tomLo] },
    { name: 'build', bars: 4, parts: [it.kick, it.roll, it.riser, it.hat, it.bassV, it.arpV, it.padV] },
    { name: 'chorus', bars: 7, drop: true, parts: [it.crashOnce, ...CHORUS, ...CHORUS_N] },
    { name: 'RETTIFILO', bars: 1, choke: 0.28, parts: [...BRAKE, ...BRAKE_N] },
    { name: 'chorus b', bars: 8, drop: true, parts: [it.crashOnce, ...CHORUS, ...CHORUS_N] },
    { name: 'break', bars: 8, parts: [it.hat, it.arpB, it.padB, it.choirB, it.bassB] },
    { name: 'build2', bars: 4, parts: [it.kick, it.roll, it.riser, it.hat, it.bassV, it.arpV, it.padV, it.verse] },
    { name: 'chorus 2', bars: 7, drop: true, parts: [it.crashOnce, ...CHORUS, ...trp(CHORUS_N, 2)] },
    { name: 'RETTIFILO 2', bars: 1, choke: 0.28, parts: [...BRAKE, ...trp(BRAKE_N, 2)] },
    { name: 'chorus 2b', bars: 8, drop: true, parts: [it.crashOnce, ...CHORUS, ...trp(CHORUS_N, 2)] },
    { name: 'outro', bars: 8, fade: true, parts: [it.kick, it.hat, it.bassV, it.arpDark, it.padSoft] },
  ],
};

// =============================================================================
// LESMO AL TRAMONTO — the less fun one. Lesmo at sunset, the grandstands empty,
// a western in the style of Morricone: a twanging guitar alone in a huge room,
// a whistled melody that sweeps on and on over a tremolo mandolin, the gallop,
// a trumpet. And the corner, played as tragedy: at the end of the question the
// gallop stops dead, one trumpet note hangs in the air with the timpani, and
// then the answer picks itself up and carries on. D minor; the Andalusian
// cadence (Dm C B♭ A) is the whole landscape.
// =============================================================================
const WQ = ['Dm', 'C', 'Bb', 'A'];                    // the question
const WR = ['Dm', 'Gm', 'A', 'Dm'];                   // the answer
const QM = [[0, 'A4', 4], [4, 'D5', 8], [12, 'E5', 2], [14, 'F5', 2], [16, 'E5', 6], [22, 'D5', 2], [24, 'C5', 8],
  [32, 'D5', 4], [36, 'Bb4', 4], [40, 'F5', 8], [48, 'E5', 12], [60, 'C#5', 4]];
const RM = [[0, 'F5', 4], [4, 'A5', 8], [12, 'G5', 2], [14, 'F5', 2], [16, 'G5', 6], [22, 'F5', 2], [24, 'D5', 8],
  [32, 'E5', 4], [36, 'C#5', 4], [40, 'E5', 8], [48, 'D5', 16]];
const both = (f) => ({ q: f(WQ, QM), r: f(WR, RM) });
const wl = {
  twangLine: mel('twang', 32, [[0, 'D3', 4, 0.9], [4, 'A3', 4, 0.8], [8, 'D4', 8, 0.95, { bend: 1 }], [16, 'C4', 4, 0.85], [20, 'Bb3', 4, 0.8], [24, 'A3', 8, 0.95, { bend: 2 }]]),
  wind: X('riser', 'x...............|................|................|................', { vel: 0.22, o: { dur: 60 / 80 * 16 } }),
  whistle: both((ch, m) => mel('whistle', 64, m)),
  trumpet: both((ch, m) => N('brass', m.map(([st, n, l]) => [st, [midi(n)], l, 0.8]), 64)),
  trumpetLow: both((ch, m) => N('brass', m.map(([st, n, l]) => [st, [midi(n) - 12], l, 0.6]), 64, { lvl: 0.3 })),
  twangHits: both(ch => comp('twang', ch, 'x...............', 50, { len: 12, vel: 0.6, part: { o: { strum: 0.03 } } })),
  mando: both(ch => comp('mando', ch, 'x...............', 62, { len: 16, vel: 0.75, part: { o: { trem: 0.062 } } })),
  mandoHalf: both(ch => comp('mando', ch, 'x.......x.......', 62, { len: 8, vel: 0.8, part: { o: { trem: 0.062 } } })),
  sub: both(ch => bassline('sub', ch, [[0, 0, 8, 0.38], [8, 7, 8, 0.26]], 2)),
  subSoft: both(ch => bassline('sub', ch, [[0, 0, 16, 0.2]], 2)),
  strings: both(ch => comp('strings', ch, 'x...............', 55, { len: 16, vel: 0.5 })),
  choir: both(ch => comp('oo', ch, 'x...............', 57, { len: 16, vel: 0.6, part: { o: { a: 0.5, voices: 4, vowel: 'ah' } } })),
  timp: X('tom', 'x...............|................', { vel: 0.9, o: { f: 73, dec: 1.4, bend: 1.15 } }),
  timpRoll: X('tom', '................|................|................|x.x.x.x.xxxxxxxx', { vel: 0.55, o: { f: 73, dec: 0.5, bend: 1.1 } }),
  gallop: X('snare', 'x.xxx.xxx.xxx.xx', { vel: 0.32, o: { dec: 0.07, tone: 220, snap: 0.7, body: 0.3 } }),
  kick: X('kick', 'x.......x.......', { vel: 0.6, o: { f0: 110, f1: 45, dec: 0.5, drive: 1.1, click: 0.15, duck: 0 } }),
  crash: X('crash', 'x...............|'.repeat(4), { vel: 0.45 }),
  // the corner: everything stops but one trumpet note and the timpani
  cornerNote: mel('brass', 16, [[0, 'A4', 16, 0.9]]),
  cornerTimp: X('tom', 'x...............', { vel: 0.85, o: { f: 73, dec: 1.6, bend: 1.15 } }),
  cornerChoir: mel('oo', 16, [[4, ['A3', 'C#4', 'E4'], 12, 0.22]], { o: { a: 1.2, voices: 3, vowel: 'oo' } }),
};
const tramonto = {
  id: 'tramonto', mood: 'less fun', name: 'LESMO AL TRAMONTO', artist: 'Xanboo78o Studios', bpm: 80, key: 'Dm', swing: 0, human: 0.008, loop: true,
  duck: 0, drumLevel: 0.75, drumDrive: 1.1, delay: 60 / 80 * 0.75,
  mix: { brass: { g: 0.42, send: { hall: 0.5 } }, strings: { g: 0.3 }, oo: { g: 0.45 }, sub: { g: 0.4 }, twang: { g: 0.85 } },
  sections: [
    { name: 'intro', bars: 4, parts: [wl.twangLine, wl.wind, wl.timp] },
    { name: 'whistle', bars: 4, parts: [wl.whistle.q, wl.mando.q, wl.subSoft.q, wl.twangHits.q, wl.timp] },
    { name: 'whistle b', bars: 4, parts: [wl.whistle.r, wl.mando.r, wl.subSoft.r, wl.twangHits.r, wl.timp] },
    { name: 'gallop', bars: 4, drop: true, parts: [wl.trumpet.q, wl.mandoHalf.q, wl.gallop, wl.kick, wl.sub.q, wl.strings.q, wl.choir.q, wl.timp] },
    { name: 'gallop b', bars: 4, drop: true, parts: [wl.trumpet.r, wl.mandoHalf.r, wl.gallop, wl.kick, wl.sub.r, wl.strings.r, wl.choir.r, wl.timp, wl.timpRoll] },
    { name: 'sunset', bars: 3, drop: true, parts: [wl.crash, wl.whistle.q, wl.trumpetLow.q, wl.mandoHalf.q, wl.gallop, wl.kick, wl.sub.q, wl.strings.q, wl.choir.q, wl.twangHits.q, wl.timp] },
    { name: 'THE CORNER', bars: 1, choke: 0.05, parts: [wl.cornerNote, wl.cornerTimp, wl.cornerChoir] },
    { name: 'sunset b', bars: 4, drop: true, parts: [wl.crash, wl.whistle.r, wl.trumpetLow.r, wl.mandoHalf.r, wl.gallop, wl.kick, wl.sub.r, wl.strings.r, wl.choir.r, wl.twangHits.r, wl.timp] },
    { name: 'outro', bars: 4, fade: true, parts: [wl.twangLine, wl.wind, wl.timp] },
  ],
};

export const CIRCUIT = { id: 'monza', name: 'MONZA', tag: 'Italy · Italo disco / spaghetti western', color: '#d8352a', songs: [tempio, tramonto] };
