// SEPANG — Malaysia. Sepang International Circuit (5.5 km, data/tracks/sepang.json),
// cut out of the oil-palm estates south of Kuala Lumpur. The track's signature:
// the long start straight into the T1-T2 hairpin — a tight RIGHT that folds
// straight back into a LEFT — then the fast sweepers in the middle (Langkawi,
// Genting, KLIA) where the car flows and nobody touches the brakes, and at the
// end of the lap the long back straight into the slow T15 LEFT hairpin, which
// throws you out onto the pit straight. Two straights, two hairpins, one long
// breath of sweepers between them. And the weather: heat, then the afternoon
// storm, every single day.

import { X, N, comp, bassline, arp, mel, midi } from '../ostkit.js';

// =============================================================================
// JOGET LAJU (the fast joget) — the fun one. Malay pop in the dangdut and joget
// mould: the gendang (two congas and a deep "dut" tom) rolling under everything,
// an accordion pumping the offbeats, a biola (fiddle) singing the hook, a suling
// (bamboo flute) in the verses, and a gamelan pair — bell and steel — playing
// interlocking kotekan, one on the beat and one between, in the slendro-ish
// pentatonic A C D E G. A minor with dangdut's harmonic-minor E7 leaning on it.
// The START STRAIGHT is the build; the T1-T2 HAIRPIN is one big braking stab and
// then right (koto, hard right) folding into left (mandolin, hard left); the
// SWEEPERS are a long, gliding fiddle with no drums braking it; the BACK
// STRAIGHT builds again into T15 — one slow LEFT, a single gong — and out.
// =============================================================================
const JV = ['Am', 'Dm', 'E7', 'Am'];                  // verse: the dangdut walk
const JC = ['F', 'G', 'E7', 'Am'];                    // chorus
const JS = ['Dm7', 'G', 'Cmaj7', 'Fmaj7'];            // sweepers: open, flowing, no tension
const KICK = { f0: 150, f1: 52, dec: 0.24, drive: 1.2, click: 0.35 };
const GONG = { f: 55, dec: 2.4, bend: 1.04 };
// the gendang: "tak" high, "dung" low, and the deep "dut" that gives dangdut its name
const gendang = {
  tak: X('conga', '..x...x...x.x.x.', { vel: 0.7, o: { hi: true } }),
  dung: X('conga', 'x......x.x......', { vel: 0.85 }),
  dut: X('tom', '...........x..x.', { vel: 0.75, o: { f: 95, dec: 0.45, bend: 1.5 } }),
};
// kotekan: polos on the beat (bell), sangsih between (steel), two hands making one line
const POLOS = [[0, 'A5', 2], [4, 'C6', 2], [8, 'D6', 2], [12, 'E6', 2], [16, 'D6', 2], [20, 'C6', 2], [24, 'A5', 2], [28, 'G5', 2]];
const SANGSIH = [[2, 'E6', 1], [6, 'G6', 1], [10, 'A6', 1], [14, 'G6', 1], [18, 'A6', 1], [22, 'E6', 1], [26, 'D6', 1], [30, 'E6', 1]];
// the suling in the verse: breathy, ornamented, sliding up into its notes
const SUL = [[0, 'E5', 6], [6, 'D5', 2], [8, 'C5', 4], [12, 'A4', 4, 0.8, { glide: 'G4' }],
  [16, 'D5', 6], [22, 'F5', 2], [24, 'E5', 8, 0.85, { glide: 'D5' }],
  [32, 'G#4', 4], [36, 'B4', 4], [40, 'D5', 4], [44, 'E5', 4, 0.85, { glide: 'D5' }],
  [48, 'C5', 4], [52, 'B4', 4], [56, 'A4', 8]];
// the hook: the fiddle over the chorus — climbs, cries on the G#, lands home
const HOOK = [[0, 'A5', 4], [4, 'C6', 2], [6, 'A5', 2], [8, 'F5', 6], [14, 'E5', 2],
  [16, 'G5', 4], [20, 'B5', 2], [22, 'G5', 2], [24, 'D6', 8, 0.9, { glide: 'B5' }],
  [32, 'G#5', 4], [36, 'B5', 4], [40, 'E6', 6, 0.95, { glide: 'D6' }], [46, 'D6', 2],
  [48, 'C6', 4], [52, 'B5', 4], [56, 'A5', 8]];
// the sweepers: one long line, every note gliding out of the last, like a car on rails
const FLOW = [[0, 'A5', 12], [12, 'F5', 4, 0.8, { glide: 'G5' }], [16, 'G5', 16, 0.85, { glide: 'F5' }],
  [32, 'E5', 12, 0.85, { glide: 'G5' }], [44, 'G5', 4], [48, 'A5', 16, 0.9, { glide: 'G5' }]];
const jg = {
  kick: X('kick', 'x...x...x...x...', { o: KICK }),
  clap: X('clap', '....x.......x...', { vel: 0.6 }),
  shaker: X('shaker', 'xoxoxoxoxoxoxoxo', { vel: 0.45 }),
  hat: X('hat', '..x...x...x...x.', { vel: 0.45, o: { dec: 0.04 } }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.5 }),
  gong: X('tom', 'x...............|'.repeat(4), { vel: 0.7, o: GONG }),
  gong1: X('tom', 'x...............|................', { vel: 0.8, o: GONG }),
  roll: X('snare', 'x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx', { vel: 0.45, o: { dec: 0.08, tone: 240, snap: 0.6, body: 0.7 } }),
  takRoll: X('conga', 'x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx', { vel: 0.55, o: { hi: true } }),
  riser: X('riser', 'x...............|................|................|................', { vel: 0.4, o: { dur: 60 / 132 * 16 } }),
  sub: bassline('sub', JV, [[0, 0, 3, 0.9], [7, 0, 1, 0.7], [8, 7, 3, 0.8], [12, 12, 2, 0.7], [14, 7, 2, 0.6]], 2),
  subC: bassline('sub', JC, [[0, 0, 3, 0.9], [7, 0, 1, 0.7], [8, 7, 3, 0.8], [12, 12, 2, 0.7], [14, 7, 2, 0.6]], 2),
  subS: bassline('sub', JS, [[0, 0, 8, 0.8], [8, 7, 8, 0.7]], 2),
  // the straight: the bass drives eighths, filter opening a bar at a time
  bassOpen: N('hbass', [0, 1, 2, 3].flatMap(b => [0, 2, 4, 6, 8, 10, 12, 14].map(s => [b * 16 + s, midi('A1') + (s % 4 === 2 ? 12 : 0), 2, 0.85, { cut: 600 + b * 800 }])), 64, { o: { q: 6, fdec: 0.08 } }),
  accV: comp('accordion', JV, '..x...x...x...x.', 57, { len: 2, vel: 0.6 }),
  accC: comp('accordion', JC, '..x...x...x...x.', 57, { len: 2, vel: 0.7 }),
  polos: mel('bell', 32, POLOS, { vel: 0.7 }),
  sangsih: mel('steel', 32, SANGSIH, { vel: 0.6 }),
  suling: mel('shaku', 64, SUL),
  hook: mel('fiddle', 64, HOOK),
  hookLow: mel('fiddle', 64, HOOK.map(([s, n, l, v, ex]) => [s, n.replace(/\d$/, d => +d - 1), l, (v ?? 0.85) * 0.6, ex && ex.glide ? { glide: ex.glide.replace(/\d$/, d => +d - 1) } : ex])),
  flow: mel('fiddle', 64, FLOW),
  padS: comp('strings', JS, 'x...............', 55, { len: 16, vel: 0.45, part: { o: { pad: true } } }),
  arpS: arp('koto', JS, 64, [0, 1, 2, 3, 4, 3, 2, 1], 2, { vel: 0.45, span: 2 }),
  choir: comp('oo', JC, 'x...............', 57, { len: 16, vel: 0.35, part: { o: { a: 0.6, voices: 3, vowel: 'ah' } } }),
  // ---- T1-T2: brake, RIGHT (koto, hard right), then fold back LEFT (mandolin, hard left) ----
  brakeStab: comp('stab', ['E7'], 'X...............|................', 62, { len: 2, vel: 0.95, extra: 1 }),
  brakeBoom: X('boom', 'x...............|................', { vel: 0.8 }),
  brakeCrash: X('crash', 'x...............|................', { vel: 0.7 }),
  hairR: mel('koto', 32, [[2, 'E6', 1], [3, 'D6', 1], [4, 'C6', 1], [5, 'A5', 1], [6, 'G5', 1], [7, 'E5', 2], [10, 'A5', 1], [11, 'C6', 1], [12, 'E6', 2, 0.9, { bend: 1 }]], { vel: 1 }),
  hairL: mel('mando', 32, [[16, 'A5', 1], [17, 'C6', 1], [18, 'D6', 1], [19, 'E6', 1], [20, 'G6', 2], [24, 'A6', 1], [25, 'G6', 1], [26, 'E6', 1], [28, 'A6', 4]], { vel: 1 }),
  hairBass: mel('hbass', 32, [[2, 'E2', 2], [6, 'E2', 2], [10, 'E3', 2], [16, 'A1', 2], [18, 'A2', 2], [20, 'A1', 2], [22, 'A2', 2], [24, 'A1', 1], [25, 'A2', 1], [26, 'A1', 1], [27, 'A2', 1], [28, 'A1', 1], [29, 'A2', 1], [30, 'A1', 1], [31, 'A2', 1]], { o: { cut: 1800, q: 5, fdec: 0.06 } }),
  hairTak: X('conga', '..x.x.x.x.x.....|................', { vel: 0.8, o: { hi: true } }),
  hairDung: X('conga', '................|x...x...x.x.xxxx', { vel: 0.85 }),
  // ---- T15: the slow LEFT before the pit straight: brake, one gong, a slow mandolin turn, out ----
  t15Turn: mel('mando', 32, [[4, 'E5', 2], [6, 'G5', 2], [8, 'A5', 4], [12, 'C6', 4], [16, 'B5', 2], [18, 'G#5', 2], [20, 'E5', 4], [24, 'E6', 8, 0.9]], { vel: 1.15 }),
  t15Bass: mel('sub', 32, [[0, 'E1', 16, 0.45], [16, 'E2', 8, 0.45], [24, 'E1', 8, 0.45]]),
};
const T1T2 = [jg.brakeStab, jg.brakeBoom, jg.brakeCrash, jg.hairR, jg.hairL, jg.hairBass, jg.hairTak, jg.hairDung];
const T15 = [jg.brakeStab, jg.brakeBoom, jg.gong1, jg.t15Turn, jg.t15Bass, jg.hairTak];
const VERSE = [jg.kick, jg.shaker, gendang.tak, gendang.dung, gendang.dut, jg.sub, jg.accV, jg.suling, jg.polos];
const CHORUS = [jg.crash, jg.kick, jg.clap, jg.hat, jg.shaker, gendang.tak, gendang.dung, gendang.dut, jg.subC, jg.accC, jg.hook, jg.hookLow, jg.polos, jg.sangsih, jg.choir];
const STRAIGHT = [jg.kick, jg.hat, jg.roll, jg.takRoll, jg.riser, jg.bassOpen, jg.polos, jg.sangsih];
const jogetLaju = {
  id: 'jogetlaju', mood: 'fun', name: 'JOGET LAJU', artist: 'Xanboo78o Studios', bpm: 132, key: 'Am', swing: 0.08, human: 0.004, loop: true,
  duck: 0.2, duckRelease: 0.14, drumLevel: 0.78, drumDrive: 1.1,
  mix: { sub: { g: 0.45 }, hbass: { g: 0.44 }, accordion: { g: 0.42, pan: 0.2 }, bell: { g: 0.42, pan: -0.25, send: { hall: 0.35, delay: 0.15 } },
    steel: { g: 0.4, pan: 0.3 }, shaku: { g: 0.5, send: { hall: 0.5, delay: 0.15 } }, fiddle: { g: 0.45, send: { hall: 0.4 } },
    koto: { g: 0.6, pan: 0.7 }, mando: { g: 0.55, pan: -0.7 }, conga: { g: 0.55, pan: -0.15 }, stab: { g: 0.55 } },
  sections: [
    { name: 'intro', bars: 4, parts: [jg.gong, jg.polos, jg.sangsih, jg.shaker] },
    { name: 'verse', bars: 16, parts: VERSE },
    { name: 'start straight', bars: 4, parts: STRAIGHT },
    { name: 'T1-T2', bars: 2, parts: T1T2 },
    { name: 'chorus', bars: 16, drop: true, parts: CHORUS },
    { name: 'sweepers', bars: 8, parts: [jg.subS, jg.padS, jg.arpS, jg.flow, jg.shaker, jg.gong] },
    { name: 'back straight', bars: 4, parts: STRAIGHT },
    { name: 'T15', bars: 2, parts: T15 },
    { name: 'chorus 2', bars: 16, drop: true, parts: [...CHORUS, jg.suling] },
    { name: 'outro', bars: 8, fade: true, parts: [jg.gong, jg.polos, jg.sangsih, jg.shaker, gendang.tak, jg.sub] },
  ],
};

// =============================================================================
// HUJAN PETANG (afternoon rain) — the less fun one. Sepang at four o'clock: the
// air too thick to breathe, the sky going purple over the palms, and then the
// storm. A gamelan gong cycle in pelog (D E♭ F A B♭) marks time very slowly;
// a choir hangs in the heat; the suling drifts and sags flat like a voice in
// humidity. Then the rain: soft sixteenths on the shaker and hats, thunder
// rolling under it (boom), and the koto and bells running the sweepers in the
// wet — still fast, still flowing, but every note smeared. The back straight
// is two bars of spray, and the gong closes the cycle.
// =============================================================================
const HEAT = ['Dm', 'Eb', 'Dm', 'Bbmaj7'];
const STORM = ['Gm', 'Eb', 'Bb', 'A'];
const DRIFT = [[0, 'A4', 8], [8, 'Bb4', 8, 0.8, { glide: 'A4' }], [16, 'A4', 12], [28, 'F4', 4],
  [32, 'D5', 8], [40, 'Eb5', 4, 0.8], [44, 'D5', 4, 0.75, { glide: 'Eb5' }], [48, 'A4', 16, 0.75],
  [64, 'F5', 6], [70, 'Eb5', 2], [72, 'D5', 8, 0.8, { glide: 'Eb5' }], [80, 'Bb4', 8], [88, 'A4', 8, 0.7, { glide: 'Bb4' }],
  [96, 'D5', 12, 0.7], [108, 'C#5', 4, 0.6], [112, 'D5', 16, 0.55, { glide: 'C#5' }]];
// the balungan: the skeleton melody, one note a beat, in pelog
const BAL = [[0, 'D5', 4], [4, 'Eb5', 4], [8, 'F5', 4], [12, 'A5', 4], [16, 'Bb5', 4], [20, 'A5', 4], [24, 'F5', 4], [28, 'Eb5', 4]];
const hp = {
  heat: comp('strings', HEAT, 'x...............', 50, { len: 16, vel: 0.45, part: { o: { pad: true, a: 1.5, r: 1.5 } } }),
  stormPad: comp('strings', STORM, 'x...............', 50, { len: 16, vel: 0.5, part: { o: { pad: true, a: 0.6 } } }),
  sub: bassline('sub', HEAT, [[0, 0, 16, 0.1]], 1),
  subStorm: bassline('sub', STORM, [[0, 0, 8, 0.35], [8, 0, 8, 0.25]], 1),
  gong: X('tom', 'x...............|................|................|................', { vel: 0.7, o: { f: 49, dec: 3.2, bend: 1.03 } }),
  kempul: X('tom', '................|........x.......|................|........x.......', { vel: 0.45, o: { f: 98, dec: 1.4, bend: 1.05 } }),
  pulse: X('kick', 'x.......x.......', { vel: 0.35, o: { f0: 95, f1: 48, dec: 0.7, drive: 1.05, click: 0.05, duck: 0 } }),
  balungan: mel('bell', 32, BAL, { vel: 0.4 }),
  balunganFast: arp('bell', STORM, 74, [0, 1, 2, 1, 3, 2, 1, 2], 2, { vel: 0.4, span: 1 }),
  choir: comp('oo', HEAT, 'x...............', 50, { len: 16, vel: 0.4, part: { o: { a: 1.4, voices: 4, vowel: 'oo' } } }),
  choirStorm: comp('oo', STORM, 'x...............', 55, { len: 16, vel: 0.5, part: { o: { a: 0.8, voices: 4, vowel: 'ah' } } }),
  suling: mel('shaku', 128, DRIFT),
  // the rain
  rain: X('shaker', '-o-o-o-o-o-o-o-o', { vel: 0.4 }),
  rainHat: X('hat', 'o-o-o-o-o-o-o-o-', { vel: 0.3, o: { dec: 0.02, hp: 9000 } }),
  thunder: X('boom', 'x...............|................|........x.......|................', { vel: 0.45 }),
  wind: X('riser', 'x...............|................', { vel: 0.16, o: { dur: 60 / 72 * 8 } }),
  // the sweepers in the wet: koto runs, still flowing
  kotoRun: arp('koto', STORM, 62, [0, 2, 1, 3, 2, 4, 3, 2], 2, { vel: 0.5, span: 2 }),
  // ---- the back straight in spray: two bars, rushing ----
  sprayHat: X('hat', 'xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx', { vel: 0.55, o: { dec: 0.02, hp: 9000 } }),
  sprayRiser: X('riser', 'x...............|................', { vel: 0.4, o: { dur: 60 / 72 * 8 } }),
  sprayKick: X('kick', 'x...x...x...x...|x.x.x.x.x.x.x.x.', { vel: 0.6, o: { f0: 110, f1: 55, dec: 0.4, drive: 1.1, click: 0.1, duck: 0 } }),
  sprayKoto: mel('koto', 32, [[0, 'D5', 2], [2, 'F5', 2], [4, 'A5', 2], [6, 'D6', 2], [8, 'Eb6', 2], [10, 'D6', 2], [12, 'A5', 2], [14, 'F5', 2],
    [16, 'D5', 1], [17, 'F5', 1], [18, 'A5', 1], [19, 'D6', 1], [20, 'F6', 4], [24, 'D6', 8, 0.9, { bend: -1 }]], { vel: 1.1 }),
  sprayDrone: comp('strings', ['Dm', 'A'], 'x...............', 50, { len: 16, vel: 0.45, part: { o: { pad: true, a: 0.1 } } }),
};
const hujan = {
  id: 'hujanpetang', mood: 'less fun', name: 'HUJAN PETANG', artist: 'Xanboo78o Studios', bpm: 72, key: 'Dm', swing: 0, human: 0.006, loop: true,
  duck: 0, drumLevel: 0.72, drumDrive: 1.05, delay: 60 / 72 * 0.75,
  mix: { strings: { g: 0.3 }, pad: { g: 0.32 }, oo: { g: 0.4 }, sub: { g: 0.35 }, bell: { g: 0.4, send: { hall: 0.7, delay: 0.3 } },
    shaku: { g: 0.6, send: { hall: 0.7, delay: 0.25 } }, koto: { g: 0.8, pan: -0.3, send: { hall: 0.5 } }, shaker: { g: 0.35 }, boom: { g: 0.7 } },
  sections: [
    { name: 'intro', bars: 4, parts: [hp.heat, hp.sub, hp.gong, hp.wind] },
    { name: 'heat', bars: 8, parts: [hp.heat, hp.sub, hp.gong, hp.kempul, hp.pulse, hp.balungan, hp.choir, hp.suling] },
    { name: 'storm', bars: 8, drop: true, parts: [hp.stormPad, hp.subStorm, hp.gong, hp.kempul, hp.pulse, hp.rain, hp.rainHat, hp.thunder, hp.balunganFast, hp.choirStorm, hp.kotoRun] },
    { name: 'back straight', bars: 2, drop: true, parts: [hp.sprayHat, hp.sprayRiser, hp.sprayKick, hp.sprayKoto, hp.sprayDrone, hp.rain] },
    { name: 'outro', bars: 4, fade: true, parts: [hp.heat, hp.sub, hp.gong, hp.rain, hp.balungan] },
  ],
};

export const CIRCUIT = { id: 'sepang', name: 'SEPANG', tag: 'Malaysia · dangdut-joget / afternoon storm', color: '#cc0001', songs: [jogetLaju, hujan] };
