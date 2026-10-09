// film.js — the projector. Plays a list of shots against ONE clock.
//
// A film is { bpm, beats, shots, captions, score }. Every time in it is in
// BEATS, the picture's and the music's alike, so a cut and the drum under it
// are the same number rather than two numbers that were once equal.
//
//   ?t=SECONDS      start there
//   ?mute=1         no sound
//   ?frame=SECONDS  draw exactly that moment, no audio, then set
//                   window.__adReady = true           (for screenshots)
//   ?lo=1           skip woods and town (fast framing checks)
//   ?scale=0.6      fix the render scale instead of letting it adapt
//
// window.__adSeek(seconds) redraws at another moment and resolves when drawn,
// so one browser can photograph a whole film.
import * as THREE from 'three';
import { Stage } from './stage.js';
import { Grade, GRADES } from './grade.js';
import { Sprites, Streaks, wobble } from './actors.js';
import { Player, renderOffline } from './synth.js';

const Q = new URLSearchParams(location.search);
const $ = id => document.getElementById(id);

export async function runFilm(def) {
  const frameQ = Q.has('frame') ? +Q.get('frame') : null;
  const still = frameQ != null;
  const secPerBeat = 60 / def.bpm;
  const duration = def.beats * secPerBeat;
  const canvas = $('cv'), stageEl = $('stage'), card = $('card'), cardMsg = $('cardmsg'), capsEl = $('caps');
  const say = m => { if (cardMsg) cardMsg.textContent = m; };

  window.__adInfo = { title: def.title, bpm: def.bpm, beats: def.beats, duration };
  window.__adErrors = [];
  addEventListener('error', e => window.__adErrors.push(String(e.message)));
  addEventListener('unhandledrejection', e => window.__adErrors.push(String(e.reason)));

  // The fonts have to be IN before the first caption is measured or drawn.
  try { await Promise.all([document.fonts.load('400 40px Anton'), document.fonts.load('500 20px Rubik'), document.fonts.load('800 20px Rubik')]); } catch { /* system fonts, then */ }

  say('LOADING THE CIRCUIT');
  const stage = await Stage.create(canvas, def.track, { car: def.car || 'f1', progress: p => say('LOADING · ' + p.toUpperCase()) });
  const grade = new Grade(stage.renderer, { msaa: Q.has('msaa') ? +Q.get('msaa') : (still || !stage.weak ? 4 : 0) });
  const camera = stage.camera;
  const kit = {
    stage, grade, camera, THREE,
    puffs: new Sprites(stage.scene, { max: 2600 }),
    glow: new Sprites(stage.scene, { max: 1600, additive: true }),
    streaks: new Streaks(stage.scene, { max: 7000 }),
    cars: [],
  };
  // Aim the camera. `shake` is in degrees and wobbles ABOUT the framing, so a
  // locked-off look stays locked off.
  const _t = new THREE.Vector3();
  kit.aim = (pos, target, fov = 40, { roll = 0, shake = 0, time = 0, seed = 1, near = 0.3, far = 12000 } = {}) => {
    camera.position.copy(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(_t.copy(target));
    if (shake) {
      const k = shake * Math.PI / 180;
      camera.rotateX(wobble(time * 1.3, seed) * k);
      camera.rotateY(wobble(time * 1.1, seed + 5) * k);
      camera.rotateZ(wobble(time * 0.9, seed + 9) * k * 0.5);
    }
    if (roll) camera.rotateZ(roll);
    if (camera.fov !== fov || camera.near !== near || camera.far !== far) {
      camera.fov = fov; camera.near = near; camera.far = far; camera.updateProjectionMatrix();
    }
    stage.focus(target.x, target.y, target.z);
  };
  say('BUILDING THE CARS');
  const state = (await def.build(kit)) || {};
  kit.state = state;

  // ---- captions: plain DOM, opacity worked out from the clock ---------------
  const caps = (def.captions || []).map(c => {
    const el = document.createElement('div');
    el.className = 'cap ' + (c.cls || '');
    el.innerHTML = c.html;
    el.style.opacity = '0';
    capsEl.appendChild(el);
    return { ...c, el, t0: c.at * secPerBeat, t1: c.to * secPerBeat, fin: c.fin ?? 0.0, fout: c.fout ?? 0.0 };
  });

  // ---- size -----------------------------------------------------------------
  // A weak chip (integrated graphics, or software) starts soft and is allowed to go softer.
  let scale = Q.has('scale') ? +Q.get('scale') : (!still && stage.weak ? 0.6 : 1);
  const minScale = stage.weak ? 0.3 : 0.42;
  function resize() {
    // the picture is 16:9, fitted inside the window
    const W = innerWidth, H = innerHeight, w = Math.min(W, H * 16 / 9), h = w * 9 / 16;
    stageEl.style.width = w + 'px'; stageEl.style.height = h + 'px';
    stageEl.style.left = (W - w) / 2 + 'px'; stageEl.style.top = (H - h) / 2 + 'px';
    stageEl.style.fontSize = (h / 100) + 'px';            // 1em = 1% of picture height
    const dpr = still ? 1 : Math.min(devicePixelRatio || 1, 1.5);
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    stage.renderer.setSize(cw, ch, false);
    grade.setSize(Math.max(320, Math.round(cw * scale)), Math.max(180, Math.round(ch * scale)));
    camera.aspect = 16 / 9; camera.updateProjectionMatrix();
  }
  addEventListener('resize', () => { resize(); if (still || ended) draw(lastT); });
  resize();

  // ---- one frame --------------------------------------------------------------
  const shots = def.shots.slice().sort((a, b) => a.at - b.at);
  shots.forEach((s, i) => { s.end = i + 1 < shots.length ? shots[i + 1].at : def.beats; s.index = i; });
  let lastT = 0, ended = false;
  const ctx = { kit, stage, grade, camera, state };
  function draw(T) {
    lastT = T;
    const beat = T / secPerBeat;
    let shot = shots[0];
    for (const s of shots) if (s.at <= beat + 1e-6) shot = s;
    if (typeof shot.moodOver === 'function') shot.moodOver = shot.moodOver(kit);
    stage.setMood(shot.mood || 'day', shot.moodOver || null);
    for (const l of stage.spots) l.intensity = 0;
    for (const l of stage.points) l.intensity = 0;
    grade.grade = GRADES[shot.grade || def.grade || 'film'];
    grade.exposure = stage.exposure;
    grade.fade = 1; grade.flash = 0; grade.dof = 0; grade.streak = 0;
    grade.bars = def.letterbox ? (1 - (16 / 9) / 2.39) / 2 : 0;
    for (const c of kit.cars) c.root.visible = false;
    kit.puffs.begin(); kit.glow.begin(); kit.streaks.begin();
    ctx.T = T; ctx.beat = beat; ctx.shot = shot;
    ctx.t = (beat - shot.at) * secPerBeat;
    ctx.dur = (shot.end - shot.at) * secPerBeat;
    ctx.u = ctx.t / ctx.dur;
    ctx.b = beat - shot.at;
    shot.draw(ctx);
    kit.puffs.end(camera, stage.scene.fog); kit.glow.end(camera, stage.scene.fog); kit.streaks.end();
    grade.render(stage.scene, camera, T);
    for (const c of caps) {
      let o = 0;
      if (T >= c.t0 && T < c.t1) {
        o = 1;
        if (c.fin) o = Math.min(o, (T - c.t0) / c.fin);
        if (c.fout) o = Math.min(o, (c.t1 - T) / c.fout);
      }
      const v = o.toFixed(3);
      if (c.el._o !== v) { c.el._o = v; c.el.style.opacity = v; c.el.style.visibility = o > 0 ? 'visible' : 'hidden'; }
      if (o > 0 && c.live) c.live(c.el, T - c.t0, c.t1 - c.t0);
    }
    window.__adNow = { T: +T.toFixed(3), beat: +beat.toFixed(3), shot: shot.name, mood: shot.mood };
  }
  window.__adShots = shots.map(s => ({ name: s.name, at: s.at, t: +(s.at * secPerBeat).toFixed(2), end: +(s.end * secPerBeat).toFixed(2), mood: s.mood || 'day' }));
  window.__adDraw = draw;
  // Two passes: the woods and the cars' own environment maps settle a frame
  // after the light changes.
  const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__adSeek = async T => { draw(T); await settle(); draw(T); await settle(); return window.__adNow; };

  // ---- the score ----------------------------------------------------------------
  const score = def.score ? def.score() : null;
  window.__adScore = score;
  window.__adAudioTest = async (seconds = duration + 2) => renderOffline(score, seconds);

  if (still) {
    card.style.display = 'none';
    // give the forest (which loads its photographs after the world) a moment
    await new Promise(r => setTimeout(r, Q.has('lo') ? 100 : 1500));
    await window.__adSeek(frameQ);
    window.__adReady = true;
    return;
  }

  // ---- play ----------------------------------------------------------------------
  let player = null, t0 = 0, playing = false, startAt = Q.has('t') ? Math.max(0, +Q.get('t')) : 0;
  const mute = Q.get('mute') === '1';
  let acc = 0, frames = 0, lastWall = 0;
  draw(startAt);
  say(def.pressText || 'PRESS TO PLAY');
  card.classList.add('ready');
  window.__adReady = true;

  const clock = () => player ? player.time() : (performance.now() - t0) / 1000;
  function start(from = 0) {
    if (player) { player.stop(); player = null; }
    ended = false; playing = true;
    card.classList.add('gone'); $('again').classList.remove('show');
    document.body.classList.add('playing');
    if (!mute && score) {
      try { player = new Player(score, from); } catch (e) { console.warn('[ad] no audio:', e); player = null; }
    }
    t0 = performance.now() - from * 1000;
    lastWall = performance.now(); acc = 0; frames = 0;
    requestAnimationFrame(loop);
  }
  function loop() {
    if (!playing) return;
    const T = clock();
    if (T >= duration) {
      draw(duration - 0.001);
      playing = false; ended = true;
      document.body.classList.remove('playing');
      $('again').classList.add('show');
      return;
    }
    draw(Math.max(0, T));
    // Adaptive resolution: a film that stutters is worse than a soft one.
    if (!Q.has('scale')) {
      const w = performance.now(); acc += w - lastWall; lastWall = w; frames++;
      if (frames >= 20) {
        const ms = acc / frames; acc = 0; frames = 0;
        const was = scale;
        if (ms > 36 && scale > minScale) scale = Math.max(minScale, scale * 0.85);
        else if (ms > 55 && !stage.noShadows) { stage.noShadows = true; stage.sun.castShadow = false; }   // last resort
        else if (ms < 19 && scale < 1) scale = Math.min(1, scale * 1.12);
        if (scale !== was) resize();
        window.__adPerf = { ms: +ms.toFixed(1), scale: +scale.toFixed(2), shadows: !stage.noShadows, gpu: stage.gpu };
      }
    }
    requestAnimationFrame(loop);
  }
  const go = e => {
    if (e.type === 'keydown' && (e.metaKey || e.ctrlKey || e.altKey)) return;
    if (!playing) start(ended ? 0 : startAt);
  };
  card.addEventListener('click', go);
  $('again').addEventListener('click', go);
  addEventListener('keydown', go);

  // ---- THE FILM AS A FILE (Adam, 2026-10-09: "lemmi download the ads") -------
  // Drawing 4,000 frames one at a time in software was measured at one to two
  // minutes a frame, so the film is recorded as it plays instead: the browser
  // captures THIS TAB (picture, captions and sound together), and when the
  // film ends the recording is saved as a file. Full screen first, so what is
  // captured is the picture and nothing else. ?rec=1 puts the button in focus.
  const slug = (def.title || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/^xbr-/, 'ad-');
  const recBtn = document.createElement('button');
  recBtn.textContent = 'RECORD + DOWNLOAD';
  recBtn.style.cssText = 'margin-top:2.2em;padding:.8em 1.8em .7em;font:400 1.5em/1 "Anton","Arial Narrow",Impact,sans-serif;letter-spacing:.14em;' +
    'color:#fff;background:#ff2d46;border:0;border-radius:.3em;cursor:pointer;pointer-events:auto';
  const recNote = document.createElement('div');
  recNote.style.cssText = 'margin-top:1em;font:400 1.1em/1.4 "Rubik",system-ui,sans-serif;letter-spacing:.08em;opacity:.6;text-align:center;max-width:46em';
  recNote.textContent = 'plays the film once and saves it as a video. when the browser asks, share THIS TAB with its audio.';
  card.append(recBtn, recNote);
  async function record() {
    if (playing) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 60, displaySurface: 'browser', cursor: 'never' }, audio: true,
        preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include',
      });
    } catch (e) { recNote.textContent = 'recording was not allowed (' + (e.name || e) + '). press anywhere to just watch.'; return; }
    try { await document.documentElement.requestFullscreen(); } catch { /* it records the tab as it is */ }
    await new Promise(r => setTimeout(r, 700));                 // the window settles at its new size
    const types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const type = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    const rec = new MediaRecorder(stream, { mimeType: type || undefined, videoBitsPerSecond: 16e6, audioBitsPerSecond: 256e3 });
    const parts = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
    const done = new Promise(r => { rec.onstop = r; });
    const hadAudio = stream.getAudioTracks().length > 0;
    rec.start(1000);
    await new Promise(r => setTimeout(r, 400));                 // a breath of black before the first frame
    start(0);
    await new Promise(r => { const iv = setInterval(() => { if (ended || !stream.active) { clearInterval(iv); r(); } }, 100); });
    await new Promise(r => setTimeout(r, 1300));                // let the last note ring out
    if (rec.state !== 'inactive') rec.stop();
    await done;
    stream.getTracks().forEach(t => t.stop());
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* fine */ } }
    const ext = (type || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(parts, { type: type || 'video/webm' }));
    a.download = `XBR-${slug}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    card.classList.remove('gone');
    say(hadAudio ? `SAVED · XBR-${slug}.${ext} · PRESS TO PLAY` : `SAVED WITHOUT SOUND · TICK "SHARE TAB AUDIO" NEXT TIME`);
  }
  recBtn.addEventListener('click', e => { e.stopPropagation(); record(); });
  recBtn.addEventListener('keydown', e => e.stopPropagation());
  if (Q.get('rec') === '1') recBtn.focus();
}
