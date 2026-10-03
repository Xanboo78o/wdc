// MONACO — slow, tight, walls inches away, glamour, the harbour. And THE
// TUNNEL: you go in under the hotel, it is dark, loud and echoing, and you
// burst out into sunlight at the harbour chicane. Both songs carry it: the
// band drops into a muffled, echoing dark, then the harbour hits bright.

import { X, N, comp, bassline, mel, midi, voice, root } from '../ostkit.js';

// =============================================================================
// CHAMPAGNE AU PORT — the fun one. Riviera lounge / yacht jazz: swung brushes,
// a walking upright bass, Rhodes, a sax that knows it looks good, brass hits
// like camera flashes. F major, 104, smug and sunny. In the TUNNEL the band
// vanishes into a muffled roar and echoing pings; at the HARBOUR it bursts back
// in a whole tone brighter.
// =============================================================================
const RV = ['Fmaj7', 'Dm7', 'Gm7', 'C9'];
const RC = ['Bbmaj7', 'Am7', 'Gm7', 'C7sus4'];
const RT = ['Dm7', 'Dm7', 'Bbmaj7', 'Bbmaj7'];        // the tunnel
const WALK = [[0, 0, 4, 0.9], [4, 7, 4, 0.75], [8, 12, 4, 0.8], [12, 7, 4, 0.7]];
const VM = [[0, 'A4', 3], [3, 'C5', 3], [6, 'E5', 10], [16, 'F5', 3], [19, 'E5', 3], [22, 'D5', 10],
  [32, 'Bb4', 3], [35, 'D5', 3], [38, 'F5', 10], [48, 'E5', 8], [56, 'D5', 4], [60, 'C5', 4]];
const CM = [[0, 'D5', 6], [6, 'C5', 2], [8, 'A4', 8], [16, 'C5', 4], [20, 'E5', 4], [24, 'G5', 8, 0.9, { glide: 'E5' }],
  [32, 'F5', 6], [38, 'D5', 2], [40, 'Bb4', 8], [48, 'C5', 8, 0.8, { glide: 'Bb4' }], [56, 'F5', 8, 0.9, { glide: 'C5' }]];
const mc = {
  ride: X('ride', 'x...x.x.x...x.x.', { vel: 0.55 }),
  brush: X('brush', '....x.......x...', { vel: 0.9, o: { sweep: 0.22 } }),
  brushTap: X('brush', 'x.o.x.o.x.o.x.o.', { vel: 0.45, o: { sweep: 0.06, f: 5000 } }),
  kick: X('kick', 'x.........x.....', { vel: 0.55, o: { f0: 120, f1: 50, dec: 0.25, drive: 1.1, click: 0.15, duck: 0 } }),
  crash: X('crash', 'x...............|................|................|................', { vel: 0.45 }),
  walkV: bassline('upright', RV, WALK, 2),
  walkC: bassline('upright', RC, WALK, 2),
  rhodesV: comp('rhodes', RV, 'x.....x.....x...', 57, { len: 4, vel: 0.65 }),
  rhodesC: comp('rhodes', RC, 'x.....x...x.....', 57, { len: 4, vel: 0.75 }),
  rhodesIn: comp('rhodes', RV, 'x...............', 57, { len: 16, vel: 0.55 }),
  sax: mel('sax', 64, VM),
  saxC: mel('sax', 64, CM),
  flash: comp('brass', RC, '......x.......x.', 60, { len: 1, vel: 0.65 }),
  pad: comp('strings', RC, 'x...............', 60, { len: 16, vel: 0.4, part: { lvl: 0.5 } }),
  // THE TUNNEL: a muffled roar (kick through a 160 Hz lowpass), a drone, pings that echo away
  roar: X('kick', 'x...x...x...x...', { vel: 0.7, o: { f0: 90, f1: 40, dec: 0.5, drive: 2.2, click: 0, lp: 160, duck: 0 } }),
  drone: bassline('sub', RT, [[0, 0, 16, 0.22]], 2),
  darkPad: comp('strings', RT, 'x...............', 50, { len: 16, vel: 0.55, part: { o: { pad: true } } }),
  pings: mel('bell', 64, [[0, 'A5', 4, 0.9], [12, 'F5', 4, 0.7], [24, 'D6', 4, 0.8], [40, 'A5', 4, 0.8], [52, 'C6', 4, 0.7]]),
  echoSax: mel('sax', 64, [[8, 'D4', 8, 0.45], [40, 'F4', 8, 0.4, { glide: 'D4' }]]),
  // the burst into the light: brass all at once, the crash, everything up a tone
  burst: comp('brass', ['Cmaj7'], 'X...............', 60, { len: 6, vel: 1.0, extra: 1 }),
};
const champagne = {
  id: 'champagne', mood: 'fun', name: 'CHAMPAGNE AU PORT', artist: 'Xanboo78o Studios', bpm: 104, key: 'F', swing: 0.33, human: 0.006, loop: true,
  duck: 0, drumLevel: 0.7, drumDrive: 1.1,
  mix: { sax: { g: 0.55 }, rhodes: { g: 0.5 }, upright: { g: 0.62 }, brass: { g: 0.42 }, strings: { g: 0.3 }, bell: { g: 0.5, send: { hall: 0.8, delay: 0.5 } }, sub: { g: 0.4 } },
  sections: [
    { name: 'intro', bars: 4, parts: [mc.brushTap, mc.rhodesIn] },
    { name: 'verse', bars: 8, parts: [mc.ride, mc.brush, mc.kick, mc.walkV, mc.rhodesV, mc.sax] },
    { name: 'chorus', bars: 8, drop: true, parts: [mc.crash, mc.ride, mc.brush, mc.kick, mc.walkC, mc.rhodesC, mc.saxC, mc.flash, mc.pad] },
    { name: 'THE TUNNEL', bars: 4, parts: [mc.roar, mc.drone, mc.darkPad, mc.pings, mc.echoSax] },
    { name: 'HARBOUR', bars: 8, drop: true, parts: [mc.burst, mc.crash, mc.ride, mc.brush, mc.kick, ...[mc.walkC, mc.rhodesC, mc.saxC, mc.flash, mc.pad].map(p => ({ ...p, tr: 2 }))] },
    { name: 'verse 2', bars: 8, parts: [mc.ride, mc.brush, mc.kick, mc.walkV, mc.rhodesV, mc.sax, mc.flash] },
    { name: 'chorus 2', bars: 8, drop: true, parts: [mc.crash, mc.ride, mc.brush, mc.kick, mc.walkC, mc.rhodesC, mc.saxC, mc.flash, mc.pad] },
    { name: 'outro', bars: 4, fade: true, parts: [mc.brushTap, mc.rhodesIn, mc.walkV] },
  ],
};

// =============================================================================
// TROIS HEURES DU MATIN — the less fun one. 3 a.m. in the harbour, the yachts
// dark, a chanson waltz on accordion: oom-pah-pah upright and soft Rhodes,
// A minor. The waltz is written in 12-step bars (3 beats of 4 sixteenths), so
// every section is a multiple of 3 engine bars (48 steps = 4 waltz bars). In
// THE TUNNEL the waltz stops: the melody walks alone through the empty tunnel
// as echoing pings over a drone, then SORTIE brings the band back in the light.
// =============================================================================
const W = 12;                                          // steps per waltz bar
const WA = ['Am', 'Am', 'Dm', 'Dm', 'E7', 'E7', 'Am', 'A7'];
const WB = ['Dm', 'Dm', 'Am', 'Am', 'm7b5:B', 'E7', 'Am', 'Am'];
const sym = s => s.startsWith('m7b5:') ? s.slice(5) + 'm7b5' : s;
// oom: the bass on beat one; pah-pah: the chord on beats two and three
const oom = (chords, o = {}) => N('upright', chords.map((c, b) => [b * W, root(sym(c), 2), 4, o.vel ?? 0.55]), W * chords.length);
const pahpah = (inst, chords, lo, o = {}) => N(inst, chords.flatMap((c, b) => [[b * W + 4, voice(sym(c), lo), 3, o.vel ?? 0.55], [b * W + 8, voice(sym(c), lo), 3, (o.vel ?? 0.55) * 0.85]]), W * chords.length, o.part || {});
const held = (inst, chords, lo, o = {}) => N(inst, chords.map((c, b) => [b * W, voice(sym(c), lo), W, o.vel ?? 0.5]), W * chords.length, o.part || {});
const AM = [[0, 'E5', 8], [8, 'C5', 4], [12, 'A4', 8], [20, 'B4', 2], [22, 'C5', 2], [24, 'D5', 8], [32, 'F5', 4], [36, 'A5', 12],
  [48, 'G#5', 8], [56, 'F5', 4], [60, 'E5', 8], [68, 'D5', 4], [72, 'C5', 8], [80, 'B4', 4], [84, 'A4', 8], [92, 'C#5', 4]];
const BM = [[0, 'F5', 6], [6, 'E5', 2], [8, 'D5', 4], [12, 'A5', 12], [24, 'E5', 6], [30, 'D5', 2], [32, 'C5', 4], [36, 'A4', 12],
  [48, 'D5', 8], [56, 'F5', 4], [60, 'E5', 8], [68, 'G#4', 4], [72, 'A4', 24]];
const ch = {
  oomA: oom(WA), oomB: oom(WB), oomSoft: oom(WA, { vel: 0.3 }),
  pahA: pahpah('rhodes', WA, 57), pahB: pahpah('rhodes', WB, 57),
  accA: mel('accordion', 96, AM), accB: mel('accordion', 96, BM),
  accHeld: held('accordion', WA, 57, { vel: 0.35 }),
  stringsB: held('strings', WB, 57, { vel: 0.45 }),
  brush: X('brush', '....x...x...', { vel: 0.5, o: { sweep: 0.15 } }),
  tap: X('brush', 'x...........', { vel: 0.5, o: { sweep: 0.05, f: 2500 } }),
  // the tunnel: the melody as echoing pings, one note at a time, over a drone
  pings: mel('bell', 96, AM.filter((_, i) => i % 2 === 0).map(([s, n]) => [s, n, 4, 0.5])),
  drone: N('sub', [[0, midi('A1'), 48, 0.22], [48, midi('E1'), 48, 0.2]], 96),
  darkPad: held('strings', ['Am', 'Am', 'Am', 'Am', 'E7', 'E7', 'E7', 'E7'], 52, { vel: 0.4, part: { o: { pad: true } } }),
  rumble: X('kick', 'x.......................', { vel: 0.35, o: { f0: 80, f1: 38, dec: 0.8, drive: 2, click: 0, lp: 140, duck: 0 } }),
};
const troisheures = {
  id: 'troisheures', mood: 'less fun', name: 'TROIS HEURES DU MATIN', artist: 'Xanboo78o Studios', bpm: 112, key: 'Am', swing: 0, human: 0.01, loop: true,
  duck: 0, vinyl: 0.3, tape: 0.5, drumLevel: 0.6,
  mix: { accordion: { g: 0.85 }, rhodes: { g: 0.5, lp: 3200 }, upright: { g: 0.5 }, strings: { g: 0.28 }, bell: { g: 0.7, send: { hall: 0.85, delay: 0.55 } }, sub: { g: 0.35 } },
  sections: [                                          // bars here are engine bars: 6 = 96 steps = 8 waltz bars
    { name: 'intro', bars: 3, parts: [ch.accHeld, ch.oomSoft] },
    { name: 'waltz', bars: 6, parts: [ch.oomA, ch.pahA, ch.accA, ch.tap] },
    { name: 'waltz 2', bars: 6, drop: true, parts: [ch.oomA, ch.pahA, ch.accA, ch.brush, ch.tap] },
    { name: 'harbour', bars: 6, drop: true, parts: [ch.oomB, ch.pahB, ch.accB, ch.stringsB, ch.brush, ch.tap] },
    { name: 'THE TUNNEL', bars: 6, parts: [ch.pings, ch.drone, ch.darkPad, ch.rumble] },
    { name: 'SORTIE', bars: 6, drop: true, parts: [ch.oomA, ch.pahA, ch.accA, ch.stringsB, ch.brush, ch.tap] },
    { name: 'harbour 2', bars: 6, drop: true, parts: [ch.oomB, ch.pahB, ch.accB, ch.stringsB, ch.brush, ch.tap] },
    { name: 'outro', bars: 3, fade: true, parts: [ch.accHeld, ch.oomSoft] },
  ],
};

export const CIRCUIT = { id: 'monaco', name: 'MONACO', tag: 'Monaco · Riviera yacht jazz / 3 a.m. chanson', color: '#c9a227', songs: [champagne, troisheures] };
