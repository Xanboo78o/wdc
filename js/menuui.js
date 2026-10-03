// menuui.js — everything about the MENUS that is not a setting of the race:
// the theme, the voice, and the soundtrack.
//
// Adam, 2026-10-02: "just change stuff in the menus not the game its supposed
// to be full realism graphics and physics, the menus dont have to be". So this
// file never touches the HUD or the world. A theme is a set of CSS variables
// scoped to `.screen` and `#pauseMenu` (style.css, "menu themes"); the HUD
// keeps reading the team's colours off :root exactly as before.
//
// And: "not punk rock visual, like mentality". The look is clean and quietly
// retro; the personality is in the WORDS and the mood, which is what the
// tables below are.
import { Music } from './music.js';
import { SONGS, STATIONS } from './ost.js';

// ---------------------------------------------------------------- themes
// 'team' is the look the game had before: the whole page in your livery.
export const THEMES = [
  ['light', 'LIGHT', 'PAPER AND INK'],
  ['dark', 'DARK', 'AFTER HOURS'],
  ['halloween', 'HALLOWEEN', 'PUMPKIN AND SLIME'],
  ['team', 'TEAM', 'YOUR LIVERY, WALL TO WALL'],
];
export const hasTheme = id => THEMES.some(t => t[0] === id);
// Light first: Adam, 2026-10-03, on the dark one: "it screams jackson storm".
export function defaultTheme() { return 'light'; }
export function setTheme(id) {
  const el = document.documentElement;
  el.dataset.theme = id;
  el.classList.toggle('themed', id !== 'team');
}

// ---------------------------------------------------------------- the voice
const pick = a => a[Math.floor(Math.random() * a.length)];

// What the menu says back when you change a row. Keyed by row, then by value;
// '*' is any value. Nothing here is ever load-bearing: no line, no problem.
const SAY = {
  CIRCUIT: {
    test: ['the test map. science time.'],
    kate: ['kate mascoi. wide, fast, and nowhere to hide.'],
    street: ['pembroke. home race. no pressure.'],
    adam1: ['the first one. be nice to it.'],
    monza: ['flat out. brake. pray. repeat.'],
    zandvoort: ['banking! in the dunes! who allowed this.'],
    suzuka: ['hachi no ji. best track. no notes.'],
    baku: ['two kilometres of straight and then a castle. obviously.'],
    monaco: ['the walls are closer than they look. then closer than that.'],
    nurburgring: ['germany. precise. cold. probably foggy.'],
    sepang: ['it will rain. it always rains.'],
  },
  CAR: { f4: ['small car. big dreams.'], gt3: ['the one with a roof.'], f1: ['the big one. hands at ten and two.'] },
  MODE: { hotlap: ['just you and the clock. the clock is mean.'], race: ['wheel to wheel. elbows out.'] },
  LAPS: { 2: ['a sprint. blink and it is over.'], 10: ['ten laps. hydrate.'] },
  GRID: { 6: ['six cars. cosy.'], 22: ["twenty-one other people's problems."] },
  RIVALS: { supercasual: ['vibes only.'], hard: ['ok tough guy.'], '*': ['they have been practising. have you?'] },
  'YOU START': { pole: ['clean air. do not look back.'], back: ['last to first. easy. (not easy.)'] },
  QUALIFYING: { true: ['one lap. everything on it.'], false: ['straight to the grid then.'] },
  RETIREMENT: { true: ['immortal mode. bold.'], false: ['real consequences. gulp.'] },
  TIME: { night: ['lights on. everything is faster in the dark.'], '*': ['nice light for it.'] },
  WEATHER: { rain: ['oh no. oh no no no. (yes.)'], storm: ['who ordered this.'], changing: ['could be anything. bring a coat.'], '*': ['weather noted.'] },
  THEME: { light: ['who turned the lights on.'], dark: ['ahh. better.'], halloween: ['boo. (sorry.)'], team: ['the classic. the whole room in your colours.'] },
  MUSIC: { off: ['fine. silence. very dramatic.'], low: ['a little quieter. thinking music.'], on: ['there it is.'] },
  TEAM: { '*': ['good team. good people. probably.'] },
};
export function sayFor(row, value) {
  const t = SAY[row];
  if (!t) return null;
  const a = t[String(value)] || t['*'];
  return a ? pick(a) : null;
}
export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return pick(['it is very late. one more race. (it is never one more race.)', 'go to bed. after this one.']);
  if (h < 12) return pick(['morning. lights out before breakfast?', 'early. keen. love that.']);
  if (h < 18) return pick(['afternoon. the track is warm.', 'ok. deep breath. pick a circuit.']);
  return pick(['evening session. best kind.', 'ok. deep breath. pick a circuit.']);
}
export const loadingLine = () => pick([
  'SOLVING THE RACING LINE… (IT IS THE FAST ONE)',
  'WARMING THE TYRES. AND THE DRIVER.',
  'ASKING THE MARSHALS NICELY…',
  'COUNTING THE KERBS…',
  'DEEP BREATH…',
]);
export const pauseLine = hurt => hurt
  ? pick(['we do not talk about that one.', 'the car has seen better days.', '...ow.'])
  : pick(['breathe.', 'shake your hands out.', 'it will still be here.']);

// The results screen has feelings. One mood per race, chosen from where you
// finished; the title and the line under it are in that mood, and style.css
// does the rest (`#results.mood-…`).
const RESULT = {
  win: [
    ["P1!!! <span>LET'S GOOO</span>", 'you absolute menace. frame this one.'],
    ['WINNER <span>WINNER</span>', 'nobody tell the others how easy that looked.'],
    ['WE ARE <span>SO BACK</span>', 'top step. remember this feeling.'],
  ],
  podium: [
    ['PODIUM <span>BABY</span>', 'champagne is on you. (it is apple juice.)'],
    ['A <span>TROPHY</span>', 'small trophy. still a trophy.'],
  ],
  good: [
    ['CHEQUERED <span>FLAG</span>', 'solid. not boring. SOLID.'],
    ['POINTS <span>IN THE BAG</span>', 'we take those.'],
  ],
  meh: [
    ['WELL. <span>THAT HAPPENED</span>', 'we move. we always move.'],
    ['CHEQUERED <span>FLAG</span>', 'the car came home. the pace did not.'],
  ],
  last: [
    ['LAST. <span>BUT FINISHED</span>', 'someone has to be. today it was us.'],
  ],
  dnf: [
    ['<span>...ow.</span>', 'the wall won. the wall always has home advantage.'],
    ['RACE <span>OVER</span>', 'ok. sad for exactly ten seconds. then again.'],
  ],
};
export function resultMood(pos, n, retired) {
  const mood = retired ? 'dnf' : pos === 1 ? 'win' : pos <= 3 ? 'podium' : pos >= n && n > 3 ? 'last' : pos <= Math.ceil(n / 2) ? 'good' : 'meh';
  const [title, line] = pick(RESULT[mood]);
  return { mood, title, line };
}

// ---------------------------------------------------------------- the OST
// Every circuit has two songs, one fun and one less fun (js/ost.js). The menu
// plays the chosen circuit's fun one; the results screen plays the fun one
// after a good race and the less fun one after a bad one. It is SILENT while
// you drive: the race is the engine's, not the band's.
//
// A browser will not start audio before a real key or click, so `wake()` is
// called from those and the song that was asked for starts then.
const LEVEL = { off: 0, low: 0.3, on: 0.6 };
export const MUSIC_LEVELS = [['on', 'ON'], ['low', 'QUIET'], ['off', 'OFF']];
export const hasLevel = id => id in LEVEL;

class MenuMusic {
  constructor() { this.music = null; this.level = 'on'; this.want = null; this.awake = false; this.onTrack = null; }
  _song(circuit, kind) {
    const st = STATIONS.find(s => s.id === circuit);
    return st ? st.songs[kind === 'sad' ? 1 : 0] : null;
  }
  // which song SHOULD be on; plays it now if audio is allowed yet
  cue(circuit, kind = 'fun') {
    this.want = this._song(circuit, kind);
    this._sync();
  }
  setLevel(level) { this.level = level; this._sync(); }
  wake() {
    if (this.awake) return;
    this.awake = true;
    this._sync();
  }
  _sync() {
    const vol = LEVEL[this.level] || 0;
    if (!this.awake || !this.want || !vol) { if (this.music && this.music.playing) this.music.stop(); this._tell(); return; }
    if (!this.music) this.music = new Music(SONGS, STATIONS);
    this.music.setVolume(vol);
    if (this.music.playing !== this.want) this.music.play(this.want);
    if (this.music.ctx && this.music.ctx.state === 'suspended') this.music.ctx.resume();
    this._tell();
  }
  _tell() { if (this.onTrack) this.onTrack(this.title()); }
  // The name of what is playing, for the menu to show. null when silent.
  title() {
    if (!LEVEL[this.level] || !this.want) return null;
    return SONGS[this.want].name;
  }
  // Lights out: fade, then stop, so the grid is quiet.
  fadeOut(secs = 0.7) {
    this.want = null;
    const m = this.music;
    if (!m || !m.playing) return;
    m.master.gain.setTargetAtTime(0, m.ctx.currentTime, secs / 4);
    // ...and the context goes to sleep, so the band costs the race nothing
    setTimeout(() => {
      if (this.want) return;
      m.stop(); m.master.gain.setTargetAtTime(LEVEL[this.level] || 0, m.ctx.currentTime, 0.05);
      m.ctx.suspend();
    }, secs * 1000);
  }
}
export const menuMusic = new MenuMusic();

// ---------------------------------------------------------------- furniture
// The few extra elements the themed menu has. Built here rather than written
// into index.html for the same reason the pause menu is: the pre-commit hook
// only restamps the importmap while index.html is otherwise clean.
let _mood = null, _now = null, _no = null;
export function mountChrome() {
  if (_mood) return;
  const mark = document.querySelector('#menu .mark'), text = document.querySelector('#menu .heroText');
  const keys = document.querySelector('#menu .keys');
  if (!mark || !text || !keys) return;
  _mood = document.createElement('div'); _mood.id = 'moodLine';
  mark.after(_mood);
  _no = document.createElement('div'); _no.id = 'heroNo';
  text.prepend(_no);
  _now = document.createElement('div'); _now.id = 'nowPlaying';
  keys.before(_now);
  menuMusic.onTrack = name => { _now.innerHTML = name ? `<i></i><i></i><i></i> <b>${name}</b>` : ''; };
  mood(greeting());
}
// Say a line under the mark. Re-adding the class replays its little entrance.
export function mood(text) {
  if (!_mood || !text) return;
  _mood.textContent = text;
  _mood.classList.remove('in'); void _mood.offsetWidth; _mood.classList.add('in');
}
export function boardNo(n) { if (_no) _no.textContent = String(n).padStart(2, '0'); }
