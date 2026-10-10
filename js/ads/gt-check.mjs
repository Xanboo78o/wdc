// gt-check.mjs — the GT film, checked WITHOUT rendering it.
//
//   node js/ads/gt-check.mjs geo            where everything is, shot by shot (no browser, no GPU)
//   node js/ads/gt-check.mjs score          the score as written: motif spelling, section plan, event sanity
//   node js/ads/gt-check.mjs audio [wav]    the score as RENDERED (the WAV tools/adshot.mjs gt --audio writes)
//
// `geo` runs js/ads/gt-plan.js — the same functions the film draws from — over
// the real Nordschleife survey and projects the cars through each shot's
// camera: is the car in the tall frame, is the tyre on the stripe, do the two
// cars ever touch, is the camera above the ground. It cannot see light, colour
// or whether a shot is any good; only a picture can.
import fs from 'fs';
import { register } from 'node:module';
const ROOT = new URL('../../', import.meta.url);
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(spec, ctx, next) { if (spec === 'three') return { url: ${JSON.stringify(new URL('js/vendor/three.module.min.js', ROOT).href)}, shortCircuit: true }; return next(spec, ctx); }`));
const mode = process.argv[2] || 'geo';
if (!['geo', 'score', 'audio'].includes(mode)) { console.error('usage: node js/ads/gt-check.mjs geo | score | audio [wav]'); process.exit(2); }
const J = f => JSON.parse(fs.readFileSync(new URL(f, ROOT)));
let bad = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) bad++; };

if (mode === 'geo') {
  const THREE = await import('three');
  const { Track } = await import('../track.js');
  const { World } = await import('../world.js');
  const { bankTable, bankY } = await import('../bank.js');
  const plan = await import('./gt-plan.js');
  const { SHOTS, resolve, local, KERB, G4, G3, DURATION } = plan;
  const track = new Track(J('data/tracks/nordschleife.json'));
  const world = new World(track, J('data/elev/nordschleife.json'));
  const bank = bankTable(track);
  // js/ads/stage.js Stage.at / v3, word for word
  const stage = {
    track, world,
    at(s, lat = 0, out = {}) {
      const t = track, n = t.n, f = (((s / t.ds) % n) + n) % n, i = Math.floor(f), j = (i + 1) % n, k = f - i;
      let dh = t.hdg[j] - t.hdg[i]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      const h = t.hdg[i] + dh * k, cx = t.x[i] + (t.x[j] - t.x[i]) * k, cy = t.y[i] + (t.y[j] - t.y[i]) * k;
      out.x = cx - Math.sin(h) * lat; out.z = -(cy + Math.cos(h) * lat);
      out.y = world.trackYAt(s) + bankY(bank, t, i, lat) * (1 - k) + bankY(bank, t, j, lat) * k;
      out.hdg = h; return out;
    },
    v3(s, lat = 0, up = 0, target = new THREE.Vector3()) { const p = this.at(s, lat, {}); return target.set(p.x, p.y + up, p.z); },
  };
  const cam = new THREE.PerspectiveCamera(40, 9 / 16, 0.1, 12000);
  const aim = c => { cam.fov = c.fov; cam.near = c.near || 0.3; cam.position.copy(c.pos); cam.up.set(0, 1, 0); cam.lookAt(c.look); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); };
  const ndc = p => { const v = p.clone().applyMatrix4(cam.matrixWorldInverse); const z = -v.z; v.applyMatrix4(cam.projectionMatrix); return { x: v.x, y: v.y, z }; };
  const box = (pose, sp) => { const o = []; for (const x of [sp.rear, sp.front]) for (const z of [-sp.halfW, sp.halfW]) for (const y of [0.05, 1.15]) o.push(local(pose, x, y, z)); return o; };
  const span = (pose, sp) => { let x0 = 9, x1 = -9, y0 = 9, y1 = -9, zmin = 1e9, behind = 0; for (const p of box(pose, sp)) { const q = ndc(p); if (q.z <= 0) { behind++; continue; } x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); zmin = Math.min(zmin, q.z); } return { x0, x1, y0, y1, zmin, behind }; };
  // how much of the frame a car covers, and how much of the car is in it
  const seen = sp => sp.behind === 8 ? 0 : Math.max(0, Math.min(1, sp.x1) - Math.max(-1, sp.x0)) * Math.max(0, Math.min(1, sp.y1) - Math.max(-1, sp.y0)) / Math.max(1e-6, (sp.x1 - sp.x0) * (sp.y1 - sp.y0));
  const f2 = v => (v >= 0 ? ' ' : '') + v.toFixed(2);
  // the two cars as rectangles on the road: the gap between them (negative = contact)
  const rect = (pose, sp) => [[sp.rear, -sp.halfW], [sp.front, -sp.halfW], [sp.front, sp.halfW], [sp.rear, sp.halfW]].map(([x, z]) => { const p = local(pose, x, 0, z); return [p.x, p.z]; });
  const gapOf = (A, B) => { // separating axis: the largest separation over both rectangles' edge normals
    let best = -1e9;
    for (const [P, Q] of [[A, B], [B, A]]) for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4], nx = b[1] - a[1], nz = -(b[0] - a[0]), l = Math.hypot(nx, nz);
      let mp = -1e9, mq = 1e9; for (const p of P) mp = Math.max(mp, (p[0] * nx + p[1] * nz) / l); for (const q of Q) mq = Math.min(mq, (q[0] * nx + q[1] * nz) / l);
      best = Math.max(best, mq - mp);
    }
    return best;
  };
  console.log(`THE GT FILM — ${SHOTS.length} shots, ${DURATION} s; frame 9:16. NDC: x -1 left .. +1 right, y -1 bottom .. +1 top.\n`);
  let minGap = 1e9, minGapAt = '';
  for (const sh of SHOTS) {
    const dur = sh.end - sh.at;
    console.log(`${sh.name.padEnd(30)} ${sh.at.toFixed(1).padStart(5)}–${sh.end.toFixed(1).padEnd(5)} (${dur.toFixed(1)} s)  sound: ${sh.sound}`);
    for (const u of [0.02, 0.25, 0.5, 0.75, 0.98]) {
      const R = resolve(stage, sh, u * dur); aim(R.cam);
      let line = `   t=${(u * dur).toFixed(2).padStart(4)} fov ${R.cam.fov.toFixed(0).padStart(2)}`;
      for (const k of ['g4', 'g3']) if (R[k]) { const sp = span(R[k], R[k].spec); line += `  ${k}: x[${f2(sp.x0)},${f2(sp.x1)}] y[${f2(sp.y0)},${f2(sp.y1)}] ${sp.zmin < 1e8 ? sp.zmin.toFixed(1).padStart(5) + 'm' : 'behind'} in-frame ${(seen(sp) * 100).toFixed(0).padStart(3)}%`; }
      if (!R.cam.inside) {
        const g = world.heightAt(R.cam.pos.x, R.cam.pos.z); line += `  cam ${(R.cam.pos.y - g).toFixed(2)} m up`;
        if (R.cam.pos.y - g < 0.1) { line += ' UNDERGROUND'; bad++; }
        for (const k of ['g4', 'g3']) if (R[k]) { const q = R.cam.pos.clone().sub(R[k].pos).applyQuaternion(R[k].quat.clone().invert()); if (q.x > R[k].spec.rear - 0.15 && q.x < R[k].spec.front + 0.15 && Math.abs(q.z) < R[k].spec.halfW + 0.15 && q.y < 1.3) { line += ` CAMERA INSIDE ${k}`; bad++; } }
      }
      console.log(line);
    }
    if (sh.fn(stage, 0, sh.at).g3) for (let t = 0; t <= dur; t += 0.01) { const R = resolve(stage, sh, t); if (R.g4 && R.g3) { const g = gapOf(rect(R.g4, G4), rect(R.g3, G3)); if (g < minGap) { minGap = g; minGapAt = `${sh.name} t=${t.toFixed(2)}`; } } }
  }
  console.log('\nCHECKS');
  ok(minGap > 0.25, `the cars never touch: closest they ever come, bodywork to bodywork, is ${minGap.toFixed(2)} m (${minGapAt})`);
  // the stripe
  const stripe = stage.v3(KERB.s, KERB.lat, KERB.top);
  const hits = [];
  for (const sh of SHOTS.filter(s => /stripe|kerb/.test(s.name) && s.fn(stage, 0, s.at).g4)) {
    // the moment the right-front contact patch is nearest the middle of the stripe
    let best = 1e9, bt = 0, bp = null;
    for (let t = 0; t <= sh.end - sh.at; t += 0.0005) { const R = resolve(stage, sh, t); const p = local(R.g4, G4.wheelX, 0, G4.wheelZ); const d = Math.hypot(p.x - stripe.x, p.z - stripe.z); if (d < best) { best = d; bt = t; bp = p; } }
    hits.push({ sh, bt, bp });
    const R = resolve(stage, sh, bt); aim(R.cam); const q = ndc(stripe);
    ok(best < 0.02 && Math.abs(bp.y - stripe.y) < 0.01, `${sh.name}: right-front tyre meets the stripe at T=${(sh.at + bt).toFixed(2)} s, ${(best * 100).toFixed(1)} cm from its middle, ${((bp.y - stripe.y) * 100).toFixed(1)} cm above its top`);
    ok(Math.abs(q.x) < 0.8 && Math.abs(q.y) < 0.85 && q.z > 0, `   …and the stripe is in frame there: NDC (${f2(q.x)}, ${f2(q.y)}), ${q.z.toFixed(1)} m from the lens`);
    // the two ends of the one-metre stripe on screen: is it big enough to read?
    const a = ndc(stage.v3(KERB.s0, KERB.lat, KERB.top)), b = ndc(stage.v3(KERB.s1, KERB.lat, KERB.top)), c0 = ndc(stage.v3(KERB.s, KERB.in, KERB.top)), c1 = ndc(stage.v3(KERB.s, KERB.out, KERB.top));
    console.log(`         the stripe on screen: ${(Math.hypot(a.x - b.x, (a.y - b.y) * 16 / 9) * 50).toFixed(1)}% of frame width along the road, ${(Math.hypot(c0.x - c1.x, (c0.y - c1.y) * 16 / 9) * 50).toFixed(1)}% across`);
  }
  if (hits.length > 1) { const d = hits.slice(1).map(h => h.bp.distanceTo(hits[0].bp) * 100); ok(Math.max(...d) < 1, `the same stripe every time: contact points differ by ${d.map(v => v.toFixed(2)).join(', ')} cm between the ${hits.length} passes`); }
  { const sh = SHOTS.find(s => /H1/.test(s.name)), R = resolve(stage, sh, 1); aim(R.cam); const q = ndc(stripe); ok(Math.abs(q.x) < 0.8 && Math.abs(q.y) < 0.85, `H1 (no car): the stripe sits at NDC (${f2(q.x)}, ${f2(q.y)}) in the locked frame`); }
  { const sh = SHOTS.find(s => /D3/.test(s.name)), R = resolve(stage, sh, 3.0); const room = R.g4.L - G4.halfW + 4.25; ok(Math.abs(room - 2 * G3.halfW) < 0.005, `D3: the GT4 leaves ${room.toFixed(3)} m to the edge of the road; the GT3 is ${(2 * G3.halfW).toFixed(3)} m wide`); }
  { const sh = SHOTS.find(s => /L4/.test(s.name)); let tl = 0, tc = 0; for (let t = 0; t < sh.end - sh.at; t += 0.005) { const R = resolve(stage, sh, t); if (!tl && R.g3.s >= R.g4.s) tl = t; if (!tc && R.g3.s + G3.rear >= R.g4.s + G4.front) tc = t; } console.log(`  info the pass: level at T=${(sh.at + tl).toFixed(2)} s, clear ahead at T=${(sh.at + tc).toFixed(2)} s`); }
  console.log(`  info running time ${DURATION} s; ${SHOTS.length - 1} picture shots, ${((DURATION - 2.2) / (SHOTS.length - 1)).toFixed(1)} s each on average`);
}

if (mode === 'score') {
  const { score, CUTS, MARK } = await import('./score-gt.js');
  const { describe, NOTE, spell, QUESTION } = await import('./motif.js');
  const { INST } = await import('./synth.js'); await import('./voices-gt.js');
  const { SHOTS, DURATION } = await import('./gt-plan.js');
  const s = score();
  console.log(describe(s)); console.log('\nCHECKS');
  let badEv = 0;
  for (const e of s.events) {
    const why = [];
    if (!INST[e.i]) why.push('unknown instrument');
    if (!Number.isFinite(e.t) || e.t < 0 || e.t >= s.beats) why.push('time out of range');
    if (!(e.d > 0)) why.push('no length');
    if (e.n != null && (!Number.isFinite(e.n) || e.n < 21 || e.n > 108)) why.push('pitch out of range');
    if (!(e.v > 0 && e.v <= 1.2)) why.push('velocity');
    for (const k of ['curve', 'amp']) if (e[k]) for (let i = 1; i < e[k].length; i++) if (!(e[k][i][0] >= e[k][i - 1][0]) || e[k][i][0] > 1.0001) why.push(k + ' not in time order');
    if (why.length) { badEv++; console.log('  BAD EVENT', JSON.stringify(e).slice(0, 160), why.join(', ')); }
  }
  ok(!badEv, `${s.events.length} events, every one a known instrument, in range, in time order`);
  ok(s.beats * 60 / s.bpm === DURATION && DURATION < 90, `running time ${s.beats * 60 / s.bpm} s (the plan says ${DURATION}); under 90`);
  // every cut in the score is a cut in the picture
  const names = Object.keys(CUTS).filter(k => k !== 'OUT');
  ok(names.length === SHOTS.length && names.every((k, i) => Math.abs(CUTS[k] - SHOTS[i].at) < 1e-9 && SHOTS[i].name.startsWith(k)), `the score's ${names.length} cuts are the picture's ${SHOTS.length} cuts, to the millisecond`);
  // the motif, as written
  for (const tag of ['motif, one note at a time', 'MOTIF (horns)', 'MOTIF 8va', 'MOTIF, all of it']) {
    const ev = s.events.filter(e => e.tag === tag).sort((a, b) => a.t - b.t || b.n - a.n);
    const top = ev.filter(e => e.i === ev[0].i && e.n >= Math.max(...ev.filter(q => q.i === ev[0].i).map(q => q.n)) - 11);
    const line = top.map(e => NOTE(e.n).replace(/-?\d+$/, '')).join(' ');
    ok(line === 'D A Bb A F G', `"${tag}" (${ev[0].i}) spells ${line}  at ${top.map(e => e.t.toFixed(2)).join(', ')} s`);
  }
  void spell; void QUESTION;
  // the heart tightens
  const hb = s.beatsOfHeart, iv = hb.slice(1).map((t, i) => t - hb[i]);
  ok(iv.every((d, i) => i === 0 || d <= iv[i - 1] + 1e-9) && hb[0] >= CUTS.D1 && hb[hb.length - 1] < MARK.peak, `heartbeat: ${hb.length} beats from ${hb[0].toFixed(1)} to ${hb[hb.length - 1].toFixed(1)} s, every interval shorter than the last (${iv[0].toFixed(2)} s → ${iv[iv.length - 1].toFixed(2)} s)`);
  // nothing musical after the fury except the faint fifth, and nothing musical at all in the last ten seconds
  const tuned = new Set(['piano', 'bell', 'pad', 'choir', 'cello', 'brass', 'sub', 'drone', 'riser', 'swell', 'taiko', 'snare', 'hat', 'rage', 'boom']);
  const late = s.events.filter(e => tuned.has(e.i) && e.t >= MARK.furyEnd);
  ok(late.every(e => e.tag === 'after') && late.length > 0, `after ${MARK.furyEnd} s the only music is the faint fifth (${late.map(e => NOTE(e.n)).join(' + ')}, velocity ${late.map(e => e.v).join(', ')}), ending by ${Math.max(...late.map(e => e.t + e.d)).toFixed(1)} s`);
  ok(!s.events.some(e => tuned.has(e.i) && e.t + e.d > 60), 'no music at all from 60 s on: rain, one engine, wipers');
  ok(s.events.filter(e => e.tag === 'fury').every(e => e.t >= MARK.fury - 1e-9 && e.t + e.d <= MARK.furyEnd + 1e-9), `the fury is ${MARK.fury}–${MARK.furyEnd} s and nothing of it is written past that`);
}

if (mode === 'audio') {
  const { score, CUTS, MARK } = await import('./score-gt.js');
  const { NOTE } = await import('./motif.js');
  const file = process.argv[3] || '/tmp/xbr-ads/ad-gt.wav';
  const buf = fs.readFileSync(file), sr = buf.readUInt32LE(24), pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
  const OFF = 0.05;                                         // synth.js renderOffline starts the film 50 ms in
  const db = x => 10 * Math.log10(x + 1e-12);
  const rms = (a, b) => { let e = 0, n = 0; for (let i = Math.floor((a + OFF) * sr); i < Math.floor((b + OFF) * sr); i++) { const x = (pcm[i] || 0) / 32768; e += x * x; n++; } return db(e / Math.max(1, n)); };
  // harshness: the energy in the SLOPE of the wave, in dB — how much loud top end there is (bright, clipped sound has a
  // steep slope; a quiet hiss has a steep one too but no level, so this is absolute, not a ratio)
  const harsh = (a, b) => { let d = 0, n = 0; for (let i = Math.floor((a + OFF) * sr) + 1; i < Math.floor((b + OFF) * sr); i++) { const x = (pcm[i] || 0) / 32768, y = (pcm[i - 1] || 0) / 32768; d += (x - y) * (x - y); n++; } return db(d / Math.max(1, n)); };
  const s = score(), names = Object.keys(CUTS);
  console.log(`${file}: ${(pcm.length / sr).toFixed(1)} s at ${sr} Hz\n\nLOUDNESS BY SHOT (dB RMS, 60 ms trimmed off each end)`);
  const L = {};
  for (let i = 0; i + 1 < names.length; i++) { const a = CUTS[names[i]], b = CUTS[names[i + 1]]; L[names[i]] = rms(a + 0.06, b - 0.06); console.log(`  ${names[i].padEnd(4)} ${a.toFixed(1).padStart(5)}–${b.toFixed(1).padEnd(5)} ${L[names[i]].toFixed(1).padStart(6)}  ${'#'.repeat(Math.max(0, Math.round((L[names[i]] + 66) / 1.5)))}`); }
  console.log('\nCHECKS');
  ok(L.H2 - L.H1 > 12 && L.H2 - L.H3 > 12 && L.H4 - L.H3 > 12 && L.H4 - L.H5 > 12, `the hook alternates: quiet ${L.H1.toFixed(1)}, LOUD ${L.H2.toFixed(1)}, quiet ${L.H3.toFixed(1)}, LOUD ${L.H4.toFixed(1)}, quiet ${L.H5.toFixed(1)} dB — each roar ${Math.min(L.H2 - L.H1, L.H2 - L.H3, L.H4 - L.H3, L.H4 - L.H5).toFixed(0)} dB or more over the quiet beside it`);
  // how fast the hook's cuts are: level 40 ms either side of each
  for (const k of ['H2', 'H3', 'H4', 'H5']) console.log(`         cut at ${CUTS[k]} s: ${rms(CUTS[k] - 0.06, CUTS[k] - 0.01).toFixed(1)} dB just before, ${rms(CUTS[k] + 0.03, CUTS[k] + 0.08).toFixed(1)} dB just after`);
  // every one-second window in the film, stepped 0.1 s
  let loud = -99, loudAt = 0, hMax = -999, hAt = 0; const win = [];
  for (let t = 0; t + 1 <= 72; t += 0.1) { const r = rms(t, t + 1), h = harsh(t, t + 1); win.push([t, r, h]); if (r > loud) { loud = r; loudAt = t; } if (h > hMax) { hMax = h; hAt = t; } }
  const fury = rms(MARK.fury, MARK.furyEnd), furyH = harsh(MARK.fury, MARK.furyEnd);
  let sw = -99, swAt = 0; for (const [t, r] of win) if (t >= MARK.swell && t + 1 <= MARK.peak + 0.001 && r > sw) { sw = r; swAt = t; }
  ok(swAt >= MARK.peak - 1.6, `the swell (45–55.5 s) is loudest in its last second and a half: ${sw.toFixed(1)} dB in ${swAt.toFixed(1)}–${(swAt + 1).toFixed(1)} s (it starts at ${rms(45, 46).toFixed(1)}, is ${rms(49, 50).toFixed(1)} at 49 s)`);
  ok(Math.abs(loudAt - MARK.fury) < 0.25, `the loudest second of the film is ${loudAt.toFixed(1)}–${(loudAt + 1).toFixed(1)} s at ${loud.toFixed(1)} dB; the fury is ${MARK.fury}–${MARK.furyEnd} s (${fury.toFixed(1)} dB, ${(fury - sw).toFixed(1)} dB over the swell's peak)`);
  ok(Math.abs(hAt - MARK.fury) < 0.35, `the harshest second is ${hAt.toFixed(1)}–${(hAt + 1).toFixed(1)} s (top-end energy ${hMax.toFixed(1)} dB; the fury ${furyH.toFixed(1)}, the swell's peak ${harsh(swAt, swAt + 1).toFixed(1)}, the first roar ${harsh(3.05, 4.15).toFixed(1)})`);
  const after = rms(MARK.furyEnd + 0.15, 59.5);
  ok(fury - after > 25, `the hard cut: ${fury.toFixed(1)} dB of fury, then ${rms(MARK.furyEnd + 0.05, MARK.furyEnd + 0.3).toFixed(1)} dB a quarter of a second later and ${after.toFixed(1)} dB on average to 59.5 s (${(fury - after).toFixed(0)} dB down)`);
  ok(after > -75, `…but not digital silence: the faint fifth is there (${after.toFixed(1)} dB)`);
  const last = rms(62, 72);
  ok(sw - last > 12, `the last ten seconds average ${last.toFixed(1)} dB: ${(sw - last).toFixed(0)} dB under the swell's peak`);
  ok(rms(70.8, 72) < -60, `under the name it is silent: ${rms(70.8, 72).toFixed(1)} dB from 70.8 s`);
  const pre = rms(60.6, 61.15), dip = rms(MARK.lift + 0.15, MARK.liftEnd - 0.05), post = rms(MARK.liftEnd + 0.25, 62.6);
  ok(pre - dip > 5 && post - dip > 5, `he lifts: ${pre.toFixed(1)} dB, ${dip.toFixed(1)} dB for the half second from ${MARK.lift} s, ${post.toFixed(1)} dB again after`);
  // which pitch is loudest when each motif note starts (a Goertzel filter per semitone, as tools/adpitch.mjs does)
  const power = (t0, len, f) => { const i0 = Math.floor((t0 + OFF) * sr), n = Math.floor(len * sr), w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let a = 0, b = 0; for (let i = 0; i < n; i++) { const x = (pcm[i0 + i] || 0) / 32768 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); const y = x + c * a - b; b = a; a = y; } return a * a + b * b - c * a * b; };
  for (const [inst, tag] of [['piano', 'motif, one note at a time'], ['brass', 'MOTIF (horns)'], ['brass', 'MOTIF 8va']]) {
    const ev = s.events.filter(e => e.i === inst && e.tag === tag).sort((a, b) => a.t - b.t), top = Math.max(...ev.map(e => e.n)), line = ev.filter(e => e.n >= top - 11);
    const heard = line.map(e => { let best = -1, bp = 0; for (let n = e.n - 3; n <= e.n + 3; n++) { const p = power(e.t + 0.04, Math.min(0.2, e.d * 0.8), 440 * 2 ** ((n - 69) / 12)); if (p > bp) { bp = p; best = n; } } return best; });
    const sp = heard.map(n => NOTE(n).replace(/-?\d+$/, '')).join(' ');
    ok(sp === 'D A Bb A F G', `"${tag}" as rendered: at each note's start the strongest pitch within three semitones is ${sp}`);
  }
  // the heartbeat: energy below 90 Hz on the beat against between beats, in the cabin shot D6
  const lowAt = t => power(t, 0.12, 58) + power(t, 0.12, 48) + power(t, 0.12, 68);
  const hb = s.beatsOfHeart.filter(t => t > CUTS.D6 + 0.2 && t < CUTS.D7 - 0.6);
  if (hb.length) { const onB = hb.map(t => lowAt(t)), offB = hb.map(t => lowAt(t + 0.42)); const r = db(onB.reduce((a, b) => a + b) / offB.reduce((a, b) => a + b)); ok(r > 4, `the heartbeat is in the sound: 50–70 Hz is ${r.toFixed(1)} dB stronger on the ${hb.length} beats in the cabin (34.5–38 s) than between them`); }
}
console.log(bad ? `\n${bad} PROBLEM(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);
