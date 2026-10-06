// SPA — Belgium. Spa-Francorchamps (7.0 km), through the Ardennes forest. The
// track's signature: out of the LA SOURCE hairpin the road plunges downhill to
// the bottom of the valley and EAU ROUGE — flat out, left, the car slammed into
// the compression, right, and then RAIDILLON, a blind thirty-metre climb, left
// over a crest you cannot see past — and it spits you out onto KEMMEL, a long
// uphill straight in somebody's slipstream. Then the hard stop at LES COMBES
// (right-left-right), the downhill double-apex left at POUHON taken almost
// flat, the flowing curves of FAGNES and STAVELOT at the lowest point of the
// lap, BLANCHIMONT flat out through the trees, and the BUS STOP: stop dead,
// right-left, back onto the start straight. And the weather: it can be raining
// at one end of the lap and dry at the other.

import { X, N, trp, comp, bassline, arp, mel, midi, voice, root } from '../ostkit.js';

// =============================================================================
// PLEIN GAZ (flat out) — the fun one. Belgian New Beat growing up into
// Eurodance, 1989: a bass that bounces between its octaves, the house organ
// chopping a syncopated riff, piano-ish stabs, and a bright A major lead you
// can hum. The intro is the grid; LA SOURCE is one braking stab and a slow
// turn to the right (guitar, hard right); the verse is THE PLUNGE, its chords
// walking downhill (D C#m Bm A). Then EAU ROUGE-RAIDILLON, four bars: a run
// tumbling down the scale on the left (steel) with the kick still flat out,
// the compression (boom, one low stab, the bass sitting on the floor), a
// flick right (guitar), and the climb — bass and lead walking up two octaves
// under a riser to the crest, half a beat of nothing — and the hook fires out
// onto KEMMEL. LES COMBES brakes right-left-right; POUHON is one long gliding
// line with two apexes and nothing braking it; STAVELOT is the verse again,
// fuller; BLANCHIMONT is the build, the bass filter opening bar by bar; the
// BUS STOP stops the song dead, flicks right, left, and the last chorus comes
// back up a whole tone down the start-finish straight.
// =============================================================================
const PV = ['D', 'C#m', 'Bm', 'A'];                                   // the plunge: downhill, landing home
const PC = ['A', 'E', 'F#m', 'D', 'A', 'E', 'D', 'E'];                // the hook
const PP = ['Bm7', 'E', 'Amaj7', 'F#m7', 'Bm7', 'E', 'Amaj7', 'A'];   // Pouhon: round and round, never stopping
const KICK = { f0: 160, f1: 50, dec: 0.26, drive: 1.3, click: 0.4 };
const RIFF = 'x..x..x..x.x.x..';                                      // the organ chop
// the bounce: root on the beat, the octave popping up just before the next one
const BOUNCE = [[0, 0, 2, 0.95], [3, 12, 1, 0.75], [4, 0, 2, 0.85], [7, 12, 1, 0.75], [8, 0, 2, 0.95], [10, 7, 1, 0.7], [11, 12, 1, 0.8], [12, 0, 2, 0.85], [14, 12, 2, 0.75]];
const BOUNCE_O = { cut: 1500, q: 5, fdec: 0.1 };
// the hook: two long steps up, a held top note and three quick ones down; the answer leans on its third and fourth
const HOOK = [[0, 'C#5', 3], [3, 'E5', 3], [6, 'A5', 4], [10, 'G#5', 2], [12, 'E5', 2], [14, 'C#5', 2],
  [16, 'B4', 3], [19, 'E5', 3], [22, 'G#5', 4], [26, 'F#5', 4], [30, 'G#5', 2],
  [32, 'A5', 3], [35, 'F#5', 3], [38, 'C#6', 4], [42, 'B5', 2], [44, 'A5', 2], [46, 'F#5', 2],
  [48, 'A5', 3], [51, 'F#5', 3], [54, 'D5', 4], [58, 'E5', 4], [62, 'F#5', 2],
  [64, 'C#5', 3], [67, 'E5', 3], [70, 'A5', 4], [74, 'G#5', 2], [76, 'E5', 2], [78, 'C#6', 2],
  [80, 'B5', 3], [83, 'G#5', 3], [86, 'E5', 4], [90, 'F#5', 4], [94, 'G#5', 2],
  [96, 'A5', 3], [99, 'B5', 3], [102, 'C#6', 4], [106, 'D6', 2], [108, 'C#6', 2], [110, 'B5', 2],
  [112, 'B5', 3], [115, 'G#5', 3], [118, 'B5', 4], [122, 'E6', 6, 0.95, { glide: 'B5' }]];
// the verse: a short call that falls a step every bar with the road
const CALL = [[0, 'F#5', 2], [2, 'A5', 2], [4, 'F#5', 1], [6, 'D5', 2], [10, 'F#5', 4],
  [16, 'E5', 2], [18, 'G#5', 2], [20, 'E5', 1], [22, 'C#5', 2], [26, 'E5', 4],
  [32, 'D5', 2], [34, 'F#5', 2], [36, 'B5', 1], [38, 'F#5', 2], [42, 'D5', 2], [44, 'F#5', 2],
  [48, 'E5', 2], [50, 'A5', 2], [52, 'C#6', 1], [54, 'A5', 2], [58, 'E5', 2], [60, 'A5', 4]];
// Pouhon: one line, every note sliding out of the last; it swells twice — the two apexes
const FLOW = [[0, 'D5', 8], [8, 'F#5', 8, 0.85, { glide: 'D5' }], [16, 'B5', 12, 0.9, { glide: 'F#5' }], [28, 'G#5', 4],
  [32, 'G#5', 10, 0.85, { glide: 'A5' }], [42, 'E5', 6], [48, 'C#5', 16, 0.8, { glide: 'E5' }],
  [64, 'D5', 8], [72, 'F#5', 8, 0.85, { glide: 'D5' }], [80, 'B5', 6, 0.9, { glide: 'F#5' }], [86, 'E6', 10, 0.95, { glide: 'B5' }],
  [96, 'C#6', 8, 0.9, { glide: 'E6' }], [104, 'A5', 8], [112, 'E5', 16, 0.8, { glide: 'A5' }]];
const pg = {
  kick: X('kick', 'x...x...x...x...', { o: KICK }),
  kickIn: X('kick', '................|................|x...x...x...x...|x...x...x...x.x.', { o: KICK }),
  kickSoft: X('kick', 'x...x...x...x...', { vel: 0.7, o: KICK }),
  clap: X('clap', '....x.......x...', { vel: 0.65 }),
  hat: X('hat', 'xo.oxo.oxo.oxo.o', { vel: 0.45, o: { dec: 0.03 } }),
  hat16: X('hat', 'xoxoxoxoxoxoxoxo', { vel: 0.45, o: { dec: 0.025, hp: 8000 } }),
  ohat: X('ohat', '..x...x...x...x.', { vel: 0.6, o: { dec: 0.11 } }),
  shaker: X('shaker', 'o-x-o-x-o-x-o-x-', { vel: 0.45 }),
  rim: X('rim', '..x..x....x..x..', { vel: 0.5 }),
  crash: X('crash', 'x...............|'.repeat(8), { vel: 0.55 }),
  roll: X('snare', 'x...x...x...x...|x.x.x.x.x.x.x.x.|xxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxx', { vel: 0.45, o: { dec: 0.08, tone: 230, snap: 0.7, body: 0.5 } }),
  riser: X('riser', 'x...............|................|................|................', { vel: 0.4, o: { dur: 60 / 122 * 16 } }),
  bassV: bassline('hbass', PV, BOUNCE, 2, { o: BOUNCE_O }),
  bassC: bassline('hbass', PC, BOUNCE, 2, { o: BOUNCE_O }),
  bassP: bassline('sub', PP, [[0, 0, 10, 0.8], [10, 7, 6, 0.65]], 2),
  bassHold: bassline('sub', ['A'], [[0, 0, 16, 0.3]], 1),
  // Blanchimont: flat out on the dominant, the filter opening a bar at a time
  bassOpen: N('hbass', [0, 1, 2, 3].flatMap(b => [0, 2, 4, 6, 8, 10, 12, 14].map(s => [b * 16 + s, midi('E2') + (s % 4 === 2 ? 12 : 0), 2, 0.85, { cut: 600 + b * 800 }])), 64, { o: { q: 6, fdec: 0.08 } }),
  riffIn: comp('m1', ['A'], RIFF, 57, { vel: 0.6, part: { o: { cut: 1400 } } }),
  riffV: comp('m1', PV, RIFF, 57, { vel: 0.65, part: { o: { cut: 3200 } } }),
  riffC: comp('m1', PC, RIFF, 57, { vel: 0.75 }),
  riffE: comp('m1', ['E'], RIFF, 56, { vel: 0.7 }),
  stabs: comp('stab', PC, 'x.....x......x..', 64, { len: 2, vel: 0.5 }),
  padV: comp('strings', PV, 'x...............', 57, { len: 16, vel: 0.35, part: { o: { pad: true } } }),
  padC: comp('strings', PC, 'x...............', 57, { len: 16, vel: 0.45, part: { o: { pad: true } } }),
  padP: comp('strings', PP, 'x...............', 57, { len: 16, vel: 0.5, part: { o: { pad: true } } }),
  arpP: arp('pluck', PP, 69, [0, 2, 1, 3, 2, 4], 3, { vel: 0.4, len: 1, span: 2, part: { o: { cut: 5000, floor: 1000 } } }),
  call: mel('pluck', 64, CALL, { vel: 0.8 }),
  hook: mel('lead', 128, HOOK),
  hookBell: mel('bell', 128, HOOK.map(([s, n, l]) => [s, n, l, 0.4])),
  flow: mel('lead', 128, FLOW, { vel: 0.9 }),
  // ---- LA SOURCE: brake, then one slow turn to the right, and out ----
  brakeStab: comp('stab', ['E'], 'X...............|................', 64, { len: 2, vel: 0.95, extra: 1 }),
  brakeBoom: X('boom', 'x...............|................', { vel: 0.8 }),
  brakeCrash: X('crash', 'x...............|................', { vel: 0.7 }),
  srcTurn: mel('guitar', 32, [[6, 'E5', 2], [8, 'C#5', 2], [10, 'A4', 4], [14, 'B4', 2], [16, 'C#5', 4], [20, 'E5', 4], [24, 'A5', 4]], { vel: 1.1 }),
  srcBass: mel('sub', 32, [[0, 'E1', 16, 0.45], [16, 'E2', 8, 0.45], [24, 'E1', 4, 0.45]]),
  srcFill: X('snare', '................|............x.xx', { vel: 0.6, o: { dec: 0.09, tone: 230, snap: 0.7, body: 0.5 } }),
  // ---- EAU ROUGE-RAIDILLON: down (left), the compression, right, and the climb over the crest ----
  erDrop: mel('steel', 64, ['E6', 'D6', 'C#6', 'B5', 'A5', 'G#5', 'F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'G#4', 'F#4', 'E4', 'D4'].map((n, k) => [k, n, 1, 0.9 - k * 0.01]), { vel: 0.95 }),
  erComp: N('stab', [[16, voice('D', 50, 1), 4, 1, { cut: 5000, floor: 600 }]], 64),
  erBoom: X('boom', '................|x...............|................|................', { vel: 0.9 }),
  erCrash: X('crash', '................|x...............|................|................', { vel: 0.7 }),
  erRight: mel('guitar', 64, [[20, 'F#5', 1], [21, 'A5', 1], [22, 'D6', 2], [26, 'A5', 1], [27, 'D6', 1], [28, 'F#6', 2]], { vel: 1.1 }),
  erClimb: mel('lead', 64, [[32, 'A4', 2], [34, 'B4', 2], [36, 'C#5', 2], [38, 'D5', 2], [40, 'E5', 2], [42, 'F#5', 2], [44, 'G#5', 2], [46, 'A5', 2],
    [48, 'A5', 1], [49, 'B5', 1], [50, 'C#6', 1], [51, 'B5', 1], [52, 'C#6', 1], [53, 'D6', 1], [54, 'C#6', 1], [55, 'D6', 1], [56, 'E6', 6, 0.95]]),
  erBass: N('hbass', [
    ...['A2', 'G#2', 'F#2', 'E2', 'D2', 'C#2', 'B1', 'A1'].map((n, k) => [k * 2, midi(n), 2, 0.85]),
    ...['E2', 'E2', 'F#2', 'F#2', 'G#2', 'G#2', 'A2', 'A2', 'B2', 'B2', 'C#3', 'C#3', 'D3', 'D3', 'E3'].map((n, k) => [32 + k * 2, midi(n), 2, 0.85, { cut: 700 + k * 220 }]),
  ], 64, { o: { cut: 1500, q: 6, fdec: 0.09 } }),
  erFloor: mel('sub', 64, [[16, 'D1', 14, 0.6, { glide: 'A1' }]]),
  erKick: X('kick', 'x...x...x...x...|x.......x...x...|x...x...x...x...|x.x.x.x.x.x.x...', { o: KICK }),
  erRoll: X('snare', '................|................|x...x...x...x...|x.x.x.x.xxxxxx..', { vel: 0.5, o: { dec: 0.08, tone: 230, snap: 0.7, body: 0.5 } }),
  erRiser: X('riser', '................|................|x...............|................', { vel: 0.45, o: { dur: 60 / 122 * 8 } }),
  // ---- LES COMBES: brake, right (guitar), left (steel), right again ----
  lcRight: mel('guitar', 32, [[3, 'E5', 1], [4, 'G#5', 1], [5, 'B5', 1], [6, 'E6', 2], [18, 'E5', 1], [19, 'G#5', 1], [20, 'B5', 1], [21, 'D6', 1], [22, 'E6', 2]], { vel: 1.1 }),
  lcLeft: mel('steel', 32, [[10, 'D6', 1], [11, 'B5', 1], [12, 'G#5', 1], [13, 'E5', 2]], { vel: 0.95 }),
  lcBass: mel('hbass', 32, [[2, 'E2', 2], [8, 'E2', 2], [16, 'E2', 2], [18, 'E3', 2], [20, 'E2', 2], [22, 'E3', 2], [24, 'E2', 1], [25, 'E3', 1], [26, 'E2', 1], [27, 'E3', 1], [28, 'E2', 1], [29, 'E3', 1], [30, 'E2', 1], [31, 'E3', 1]], { o: { cut: 1800, q: 5, fdec: 0.06 } }),
  lcKick: X('kick', '................|x...x...x.x.x.x.', { o: KICK }),
  lcRim: X('rim', '...xxxx...xxxx..|..xxxxx.........', { vel: 0.5 }),
  // ---- the BUS STOP: stop dead (on the dominant of the new key), right, left, back on it ----
  bsStab: comp('stab', ['F#7'], 'X...............|................', 66, { len: 2, vel: 1, extra: 1 }),
  bsRight: mel('guitar', 32, [[8, 'C#6', 1], [9, 'A#5', 1], [10, 'F#5', 2]], { vel: 1.15 }),
  bsLeft: mel('steel', 32, [[14, 'F#5', 1], [15, 'A#5', 1], [16, 'C#6', 2]], { vel: 1 }),
  bsBass: mel('hbass', 32, [[20, 'F#2', 2], [22, 'F#3', 2], [24, 'F#2', 1], [25, 'F#3', 1], [26, 'F#2', 1], [27, 'F#3', 1], [28, 'F#2', 1], [29, 'F#3', 1], [30, 'F#2', 1], [31, 'F#3', 1]], { o: { cut: 2000, q: 5, fdec: 0.06 } }),
  bsRoll: X('snare', '................|........x.x.xxxx', { vel: 0.6, o: { dec: 0.08, tone: 230, snap: 0.7, body: 0.5 } }),
  bsKick: X('kick', '................|....x...x...x.x.', { o: KICK }),
};
const VERSE = [pg.kick, pg.clap, pg.hat, pg.shaker, pg.bassV, pg.riffV, pg.call];
const CH_D = [pg.crash, pg.kick, pg.clap, pg.hat, pg.ohat, pg.shaker, pg.rim];
const CH_N = [pg.bassC, pg.riffC, pg.stabs, pg.padC, pg.hook, pg.hookBell];
const LA_SOURCE = [pg.brakeStab, pg.brakeBoom, pg.brakeCrash, pg.srcTurn, pg.srcBass, pg.srcFill];
const EAU_ROUGE = [pg.erDrop, pg.erComp, pg.erBoom, pg.erCrash, pg.erRight, pg.erClimb, pg.erBass, pg.erFloor, pg.erKick, pg.erRoll, pg.erRiser, pg.hat16];
const LES_COMBES = [pg.brakeStab, pg.brakeBoom, pg.brakeCrash, pg.lcRight, pg.lcLeft, pg.lcBass, pg.lcKick, pg.lcRim];
const BUS_STOP = [pg.bsStab, pg.brakeBoom, pg.brakeCrash, pg.bsRight, pg.bsLeft, pg.bsBass, pg.bsRoll, pg.bsKick];
const pleinGaz = {
  id: 'pleingaz', mood: 'fun', name: 'PLEIN GAZ', artist: 'Xanboo78o Studios', bpm: 122, key: 'A', swing: 0.1, loop: true,
  duck: 0.3, duckRelease: 0.15, drumLevel: 0.78, drumDrive: 1.2,
  mix: { hbass: { g: 0.5 }, sub: { g: 0.45 }, m1: { g: 0.5 }, stab: { g: 0.5 }, pluck: { g: 0.45, pan: 0.15 }, lead: { g: 0.5, send: { delay: 0.3, hall: 0.25 } },
    bell: { g: 0.35, pan: -0.2, send: { hall: 0.35, delay: 0.15 } }, steel: { g: 0.55, pan: -0.7 }, guitar: { g: 0.7, pan: 0.7 }, pad: { g: 0.3 } },
  sections: [
    { name: 'intro', bars: 4, parts: [pg.kickIn, pg.hat, pg.riffIn, pg.bassHold] },
    { name: 'LA SOURCE', bars: 2, choke: 0.3, parts: LA_SOURCE },
    { name: 'the plunge', bars: 8, parts: VERSE },
    { name: 'EAU ROUGE-RAIDILLON', bars: 4, parts: EAU_ROUGE },
    { name: 'KEMMEL', bars: 16, drop: true, parts: [...CH_D, ...CH_N] },
    { name: 'LES COMBES', bars: 2, parts: LES_COMBES },
    { name: 'POUHON', bars: 8, parts: [pg.kickSoft, pg.ohat, pg.shaker, pg.bassP, pg.padP, pg.arpP, pg.flow] },
    { name: 'STAVELOT', bars: 8, parts: [...VERSE, pg.ohat, pg.rim, pg.padV] },
    { name: 'BLANCHIMONT', bars: 4, parts: [pg.kick, pg.hat16, pg.roll, pg.riser, pg.bassOpen, pg.riffE] },
    { name: 'BUS STOP', bars: 2, choke: 0.25, parts: BUS_STOP },
    { name: 'start-finish', bars: 16, drop: true, parts: [...CH_D, ...trp(CH_N, 2)] },
    { name: 'outro', bars: 4, fade: true, parts: [pg.kick, pg.hat, pg.riffIn, pg.bassHold] },
  ],
};

// =============================================================================
// IL PLEUT À STAVELOT (it is raining in Stavelot) — the less fun one. The
// Ardennes in the rain: a slow valse musette in G minor, an accordion with its
// reeds a little apart, a guitar going pah-pah after the bass, brushes. The
// waltz is written in 12-step bars (3 beats of 4 sixteenths), so every section
// is a multiple of 3 engine bars (48 steps = 4 waltz bars). It starts wet — the
// rain is the shaker and hats — and THE FOREST is the tune: one long note and
// three short ones stepping up into the next bar. EAU ROUGE-RAIDILLON: the
// accordion runs down the scale into the valley, the compression is one low
// chord and a drum, and then the climb — three notes a bar, the bass walking
// up under it, strings swelling — to the crest, where everything falls away
// and one high note hangs alone with nothing in front of it. KEMMEL comes out
// into the dry (the rain stops; it has not reached this end of the lap): long
// notes in the major, a fiddle tucked in a sixth below in the tow. POUHON
// runs in unbroken eighths, round the circle of fifths, leaning twice. The
// BUS STOP stops the waltz dead — a ping to the right, a mandolin to the
// left — and three notes pick it up again, and it is raining at the start line.
// =============================================================================
const W = 12;                                                          // steps per waltz bar
const FA = ['Gm', 'Gm', 'Eb', 'Eb', 'Cm', 'D7', 'Gm', 'D7'];           // the forest
const FE = ['Gm', 'Gm', null, 'Cm', 'Eb', 'F', 'Gm', null];            // Eau Rouge: null = nobody plays (the floor, the crest)
const FK = ['Eb', 'F', 'Bb', 'Bb', 'Eb', 'F', 'Gm', 'D7'];             // Kemmel: uphill, in the major
const FP = ['Cm', 'F', 'Bb', 'Eb', 'Cm', 'D7', 'Gm', 'Gm'];            // Pouhon: the circle, flowing
// oom: the bass on one (root, then the fifth below on the even bars) with a lift into the next bar
const oom = (chords, o = {}) => N('upright', chords.flatMap((c, b) => c ? [[b * W, root(c, 2) - (b % 2 ? 5 : 0), 5, o.vel ?? 0.55], ...(b % 2 && !o.plain ? [[b * W + 10, root(c, 2), 2, (o.vel ?? 0.55) * 0.7]] : [])] : []), W * chords.length);
// pah-pah: the guitar on two and three
const pah = (chords, lo, o = {}) => N('guitar', chords.flatMap((c, b) => c ? [[b * W + 4, voice(c, lo), 3, o.vel ?? 0.55], [b * W + 8, voice(c, lo), 3, (o.vel ?? 0.55) * 0.8]] : []), W * chords.length);
const held = (inst, chords, lo, o = {}) => N(inst, chords.flatMap((c, b) => c ? [[b * W, voice(c, lo), W, (o.vel ?? 0.5) * (o.swell ? 0.6 + 0.12 * b : 1)]] : []), W * chords.length, o.part || {});
// the tune: long, and three short ones up into the next bar
const TUNE = [[0, 'D5', 6], [6, 'G5', 2], [8, 'A5', 2], [10, 'Bb5', 2], [12, 'D6', 10], [22, 'C6', 2],
  [24, 'Bb5', 6], [30, 'G5', 2], [32, 'A5', 2], [34, 'Bb5', 2], [36, 'G5', 10], [46, 'F5', 2],
  [48, 'Eb5', 6], [54, 'C5', 2], [56, 'D5', 2], [58, 'Eb5', 2], [60, 'F#5', 6], [66, 'D5', 2], [68, 'F#5', 2], [70, 'A5', 2],
  [72, 'G5', 12], [84, 'A5', 6], [90, 'G5', 2], [92, 'F#5', 2], [94, 'Eb5', 2]];
// Kemmel: a whole bar held, then a bar that leans and takes two unequal steps on
const LONG = [[0, 'G5', 12], [12, 'A5', 6], [18, 'Bb5', 4], [22, 'C6', 2], [24, 'D6', 12], [36, 'Bb5', 6], [42, 'C6', 4], [46, 'D6', 2],
  [48, 'Eb6', 12], [60, 'C6', 6], [66, 'Bb5', 4], [70, 'A5', 2], [72, 'Bb5', 12], [84, 'A5', 6], [90, 'F#5', 6]];
// the fiddle in the tow: a sixth below, joining two bars late
const TOW = [[24, 'F5', 12], [36, 'D5', 6], [42, 'Eb5', 4], [46, 'F5', 2],
  [48, 'G5', 12], [60, 'Eb5', 6], [66, 'D5', 4], [70, 'C5', 2], [72, 'D5', 12], [84, 'C5', 6], [90, 'A4', 6]];
// Pouhon: unbroken eighths that lean on a long high D twice — the two apexes
const RUN = [...['G5', 'Eb5', 'C5', 'D5', 'Eb5', 'G5', 'A5', 'F5', 'C5', 'F5', 'A5', 'C6'].map((n, k) => [k * 2, n, 2]), [24, 'D6', 6, 0.95], [30, 'Bb5', 6],
  ...['G5', 'Bb5', 'G5', 'Eb5', 'D5', 'Eb5', 'G5', 'Eb5', 'C5', 'Eb5', 'G5', 'C6', 'D6', 'C6', 'A5', 'F#5', 'A5', 'C6'].map((n, k) => [36 + k * 2, n, 2]),
  [72, 'D6', 6, 0.95], [78, 'Bb5', 6], [84, 'G5', 12]];
// Eau Rouge: down the scale into the valley; then the climb, three to a bar; then the crest, alone
const DOWN = [[0, 'G5', 2], [2, 'F5', 2], [4, 'Eb5', 2], [6, 'D5', 2], [8, 'C5', 2], [10, 'Bb4', 2], [12, 'A4', 2], [14, 'G4', 2], [16, 'F#4', 2], [18, 'G4', 6],
  [24, ['C3', 'G3', 'Eb4'], 12, 0.95],
  [36, 'G4', 4], [40, 'C5', 4], [44, 'Eb5', 4], [48, 'Eb5', 4], [52, 'G5', 4], [56, 'Bb5', 4], [60, 'F5', 4], [64, 'A5', 4], [68, 'C6', 4], [72, 'G5', 4], [76, 'Bb5', 4], [80, 'D6', 4],
  [84, 'D6', 12, 0.9]];
const ACC = { musette: 16, bellows: 4 };
const ps = {
  // the rain
  rain: X('shaker', '-o-o-o-o-o-o', { vel: 0.4 }),
  rainHat: X('hat', 'o--o-o-o--o-', { vel: 0.28, o: { dec: 0.02, hp: 9000 } }),
  thunder: X('boom', '........................x.......................', { vel: 0.35 }),
  wind: X('riser', 'x...............................................', { vel: 0.14, o: { dur: 60 / 88 * 6 } }),
  farBell: mel('bell', 48, [[0, 'D5', 12, 0.3], [30, 'G4', 12, 0.22]]),
  brush: X('brush', 'x...o...o...', { vel: 0.5, o: { sweep: 0.22 } }),
  tap: X('brush', '....x...x.x.', { vel: 0.4, o: { sweep: 0.05, f: 2600 } }),
  drone: held('accordion', ['Gm', 'Gm', 'Gm', 'Gm'], 55, { vel: 0.35, part: { o: ACC } }),
  oomSoft: oom(['Gm', 'Gm', 'Gm', 'Gm'], { vel: 0.3, plain: true }),
  oomA: oom(FA), pahA: pah(FA, 55),
  oomE: oom(FE), pahE: pah(FE, 55),
  oomK: oom(FK), pahK: pah(FK, 55),
  oomP: oom(FP, { plain: true }),
  tune: mel('accordion', 96, TUNE, { o: ACC }),
  long: mel('accordion', 96, LONG, { o: ACC }),
  tow: mel('fiddle', 96, TOW, { vel: 0.8 }),
  run: mel('accordion', 96, RUN, { o: ACC }),
  stringsK: held('strings', FK, 55, { vel: 0.45 }),
  stringsP: held('strings', FP, 55, { vel: 0.4 }),
  harpP: N('harp', FP.flatMap((c, b) => { const v = voice(c, 55, 1); return [0, 2, 3].map((i, k) => [b * W + k * 4, v[i], 4, k ? 0.4 : 0.5]); }), 96),
  // ---- EAU ROUGE-RAIDILLON ----
  down: mel('accordion', 96, DOWN, { o: ACC }),
  climbFiddle: mel('fiddle', 96, DOWN.slice(11, 23).map(([s, n, l]) => [s, n.replace(/\d$/, d => +d - 1), l, 0.5 + (s - 36) * 0.006]), { vel: 0.9 }),
  climbStrings: held('strings', [null, null, null, 'Cm', 'Eb', 'F', 'Gm', null], 55, { vel: 0.5, swell: true, part: { o: { a: 0.5, r: 0.3 } } }),
  floorDrum: X('tom', '........................x.......................', { vel: 0.85, o: { f: 65.4, dec: 1.8, bend: 1.15 } }),
  floorBoom: X('boom', '........................x.......................', { vel: 0.6 }),
  crestBell: mel('bell', 96, [[86, 'D5', 8, 0.4]]),
  // ---- the BUS STOP: stop dead, right (bell), left (mandolin), three notes back onto the straight ----
  bsChord: mel('accordion', 48, [[0, ['D4', 'F#4', 'C5'], 3, 0.9], [36, 'D5', 4, 0.7], [40, 'F#5', 4, 0.75], [44, 'A5', 4, 0.8]], { o: ACC }),
  bsDrum: X('tom', 'x...............................................', { vel: 0.85, o: { f: 73.4, dec: 1.5, bend: 1.15 } }),
  bsRight: mel('bell', 48, [[12, 'A5', 2, 0.6], [14, 'F#5', 2, 0.55], [16, 'D5', 4, 0.6]]),
  bsLeft: mel('mando', 48, [[24, 'D5', 2], [26, 'F#5', 2], [28, 'C6', 6, 0.9, { trem: 0.07 }]], { vel: 1 }),
  bsBass: mel('upright', 48, [[36, 'D2', 8, 0.5], [44, 'D2', 4, 0.45]]),
  bsBrush: X('brush', '....................................x...x...x.x.', { vel: 0.5, o: { sweep: 0.1 } }),
};
const RAIN = [ps.rain, ps.rainHat];
const pleutStavelot = {
  id: 'pleutstavelot', mood: 'less fun', name: 'IL PLEUT À STAVELOT', artist: 'Xanboo78o Studios', bpm: 88, key: 'Gm', swing: 0, human: 0.008, loop: true,
  duck: 0, drumLevel: 0.62, drumDrive: 1.05, delay: 60 / 88 * 0.75,
  mix: { accordion: { g: 0.8, pan: 0, send: { room: 0.3, hall: 0.25 } }, upright: { g: 0.5 }, guitar: { g: 0.45, pan: 0.2 }, strings: { g: 0.28 }, fiddle: { g: 0.55, pan: -0.25 },
    harp: { g: 0.4, pan: 0.25 }, bell: { g: 0.5, pan: 0.6, send: { hall: 0.8, delay: 0.4 } }, mando: { g: 0.8, pan: -0.6 }, shaker: { g: 0.32 }, hat: { g: 0.4 }, boom: { g: 0.7 } },
  sections: [                                          // bars here are engine bars: 6 = 96 steps = 8 waltz bars
    { name: 'rain', bars: 3, parts: [...RAIN, ps.wind, ps.thunder, ps.drone, ps.oomSoft, ps.farBell] },
    { name: 'the forest', bars: 6, parts: [...RAIN, ps.oomA, ps.pahA, ps.tune, ps.tap] },
    { name: 'EAU ROUGE-RAIDILLON', bars: 6, parts: [ps.rain, ps.down, ps.oomE, ps.pahE, ps.floorDrum, ps.floorBoom, ps.climbFiddle, ps.climbStrings, ps.crestBell] },
    { name: 'KEMMEL', bars: 6, drop: true, parts: [ps.oomK, ps.pahK, ps.long, ps.tow, ps.stringsK, ps.brush, ps.tap] },
    { name: 'POUHON', bars: 6, parts: [ps.oomP, ps.run, ps.harpP, ps.stringsP, ps.brush] },
    { name: 'BUS STOP', bars: 3, choke: 0.3, parts: [ps.bsChord, ps.bsDrum, ps.bsRight, ps.bsLeft, ps.bsBass, ps.bsBrush] },
    { name: 'start-finish', bars: 3, parts: [...RAIN, ps.oomA, ps.pahA, ps.tune, ps.tap, ps.brush] },
    { name: 'outro', bars: 3, fade: true, parts: [...RAIN, ps.drone, ps.oomSoft, ps.farBell] },
  ],
};

export const CIRCUIT = { id: 'spa', name: 'SPA-FRANCORCHAMPS', tag: 'Belgium · New Beat house / Ardennes rain waltz', color: '#fae042', songs: [pleinGaz, pleutStavelot] };
