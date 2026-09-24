// groundcheck.mjs — is there ground under the world, and is everything
// standing ON it rather than over it?
//
//   node tools/groundcheck.mjs                     monza + monaco
//   node tools/groundcheck.mjs --tracks monaco     one circuit
//   node tools/groundcheck.mjs --n 200 --reach 2400
//   node tools/groundcheck.mjs --break             prove the gate can fail
//   node tools/groundcheck.mjs --strict            fail on the known defect too
//
// WHY THIS EXISTS. The ground near a circuit is drawn by two meshes that have
// to agree with each other and with a height field neither of them owns:
//
//   ground.plate   24 km of terrain with a hole punched around the circuit
//   ground.skirt   a finer grid that fills that hole
//   World.groundY  where the code BELIEVES the ground is, which is what every
//                  tree, hoarding, guard rail and marshal post is placed on
//
// Every bug this file was written for is a disagreement between those three:
//
//   * The plate drops a cell when ANY of its corners is inside the hole, so
//     the ground it actually removes reaches a cell DIAGONAL further out than
//     the hole radius. The skirt was sized to hole+60 and the gap was a RING
//     of missing world roughly 300-700 m out, with the sky visible through it.
//   * The skirt is sunk under the circuit so its 26 m chords cannot surface
//     through a road surveyed at 2 m ("the Monza main straight renders as
//     GRASS"). Anything placed at the un-sunk height then floats by exactly
//     the sink, which is how a line of hoardings ends up hovering over its
//     own shadows.
//
// A screenshot cannot settle any of this. It proves a frame was drawn; it
// cannot tell you that 6% of the sample points 400 m off the circuit have
// nothing under them at all, because you were not looking that way.
//
// WHAT THE RIG CONTRIBUTES. This drives the real page in headless chromium on
// SwiftShader and raycasts the REAL scene graph — the same meshes the browser
// draws, not a re-derivation of the maths that built them. A gate that
// recomputes the geometry it is checking only ever proves the recomputation
// agrees with itself. The cost is that rays have no BVH here, so sample
// counts are in the low thousands rather than the millions.
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = new URL('../', import.meta.url).pathname;

const args = process.argv.slice(2);
const VALUE = new Set(['tracks', 'n', 'reach', 'bands', 'tol', 'seed']);
const BOOL = new Set(['break', 'strict']);
// REFUSE A FLAG THIS DOES NOT UNDERSTAND, and refuse a repeated one.
//
// `--track monaco` instead of `--tracks monaco` would otherwise check the
// default circuits and print a confident PASS about a circuit nobody asked
// for. A measurement tool that silently drops an input hands you a wrong
// number with a believable explanation already attached — it cost this repo an
// afternoon in shot.mjs, which took only the first `--q`.
const seen = new Set();
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith('--')) { console.error(`groundcheck: stray argument ${a} (circuits go after --tracks)`); process.exit(2); }
  const k = a.slice(2);
  if (!VALUE.has(k) && !BOOL.has(k)) {
    console.error(`groundcheck: unknown flag ${a}\n  known: ${[...VALUE].map(f => '--' + f + ' <v>').join(' ')} ${[...BOOL].map(f => '--' + f).join(' ')}`);
    process.exit(2);
  }
  if (seen.has(k)) { console.error(`groundcheck: --${k} given twice`); process.exit(2); }
  seen.add(k);
  if (VALUE.has(k)) {
    if (i + 1 >= args.length || args[i + 1].startsWith('--')) { console.error(`groundcheck: --${k} needs a value`); process.exit(2); }
    i++;
  }
}
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const BREAK = args.includes('--break');

const TRACKS = String(flag('tracks', 'monza,monaco')).split(',').filter(Boolean);
const OPT = {
  n: +flag('n', 140),          // samples per radius band
  bands: +flag('bands', 8),
  reach: +flag('reach', 1600), // metres from the centreline
  tol: +flag('tol', 0.25),     // metres of disagreement allowed
  seed: +flag('seed', 20260919),
  strict: args.includes('--strict'),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ALWAYS SERVE THIS TREE, NEVER SOMEBODY ELSE'S.
//
// shot.mjs reuses a server already listening on its port, which is a sensible
// saving right up to the moment two checkouts exist — and on this machine they
// do: two sessions share the repo, and this file was written while a second
// copy of it sat in a scratch directory for an A/B. Attaching to whatever is
// already on the port would have measured the OTHER tree and printed a
// perfectly formatted, completely wrong table. So take a port nothing is on
// and serve ROOT there ourselves.
function freePort() {
  for (let i = 0; i < 60; i++) {
    const p = 8300 + Math.floor(Math.random() * 600);
    try {
      execFileSync('bash', ['-c', `exec 3<>/dev/tcp/127.0.0.1/${p}`], { stdio: 'ignore' });
    } catch { return p; }    // nothing answered: the port is ours
  }
  throw new Error('no free port in 8300-8900');
}
function serve(port) {
  return spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true });
}

class CDPClient {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
        return;
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        this.errors.push(`${d.text} ${d.exception?.description || ''}`.trim());
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        this.errors.push(`${m.params.entry.source}: ${m.params.entry.text}`);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)); }
      }, 180000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  }
}

async function connect(cdpPort) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        return new CDPClient(ws);
      }
    } catch { /* chromium is still coming up */ }
    await sleep(250);
  }
  throw new Error('chromium never opened a debuggable page');
}

// ---------------------------------------------------------------------------
// THE CHECK ITSELF, which runs inside the page.
//
// It is written here as an ordinary function and shipped over with
// `.toString()`, so it is real source that reads like the rest of the repo
// rather than a string literal nothing can check.
// ---------------------------------------------------------------------------
async function pageCheck(opt) {
  const V = window.__wdcView;
  if (!V) return { err: 'window.__wdcView is undefined — the world never built' };
  // The document's import map maps this specifier to the stamped URL the page
  // itself loaded, so this is the SAME three instance, not a second copy.
  const THREE = await import('./js/vendor/three.module.min.js');
  const S = V.scene, W = V.world, T = V.track;
  const Z = y => -y;
  // Where the code BELIEVES the ground is. `groundY` is the sunk surface that
  // everything track-side is placed on; the fallback is what this project used
  // before that existed, so the gate can still be pointed at an older tree and
  // the two runs compared.
  const says = W.groundY ? (x, z) => W.groundY(x, z) : (x, z) => W.heightAt(x, z);

  const ground = [];
  S.traverse(o => { if (o.name === 'ground.plate' || o.name === 'ground.skirt') ground.push(o); });
  if (!ground.length) return { err: 'no meshes named ground.plate / ground.skirt in the scene' };

  const rc = new THREE.Raycaster();
  rc.far = 20000;
  const DOWN = new THREE.Vector3(0, -1, 0);
  const org = new THREE.Vector3();
  // Which mesh answered matters as much as the height it gave. The plate is
  // ~300 m cells and the skirt is 26 m, so a chord error that is a defect on
  // one is simply the resolution of the other. A gate that averages the two
  // together can only ever produce a number that means nothing.
  const drop = (x, z, objs) => {
    org.set(x, 6000, z);
    rc.set(org, DOWN);
    const h = rc.intersectObjects(objs, true);
    return h.length ? { y: h[0].point.y, on: h[0].object.name } : null;
  };
  const dropY = (x, z, objs) => { const h = drop(x, z, objs); return h ? h.y : null; };
  // A miss is retried with both faces enabled. "Nothing here" and "something
  // here, wound the wrong way up" are identical to a downward ray and are
  // completely different bugs, and the report has to be able to say which.
  const dropEither = (x, z, objs) => {
    const was = objs.map(o => o.material.side);
    objs.forEach(o => { o.material.side = THREE.DoubleSide; });
    const h = drop(x, z, objs);
    objs.forEach((o, i) => { o.material.side = was[i]; });
    return h;
  };

  let seed = opt.seed >>> 0;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) & 0x7fffffff) / 0x7fffffff;
  const stat = a => {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    const q = f => +s[Math.min(s.length - 1, Math.floor(s.length * f))].toFixed(3);
    return { p50: q(0.5), p95: q(0.95), max: +s[s.length - 1].toFixed(3) };
  };

  // ---- 1 & 2. coverage, and does the visible ground agree with groundY -----
  const bands = [];
  const holes = [], drift = [];
  const step = opt.reach / opt.bands;
  let miss = 0, inverted = 0, total = 0;
  const agree = { 'ground.skirt': [], 'ground.plate': [] };
  for (let b = 0; b < opt.bands; b++) {
    const r0 = b * step, r1 = r0 + step;
    let bMiss = 0, bInv = 0;
    const bAgree = { 'ground.skirt': [], 'ground.plate': [] };
    for (let k = 0; k < opt.n; k++) {
      const i = Math.floor(rnd() * T.n);
      const a = rnd() * Math.PI * 2;
      const r = r0 + rnd() * (r1 - r0);
      const x = T.x[i] + Math.cos(a) * r, z = Z(T.y[i]) + Math.sin(a) * r;
      total++;
      const h = drop(x, z, ground);
      if (h == null) {
        if (dropEither(x, z, ground) == null) {
          bMiss++; miss++;
          if (holes.length < 8) holes.push({ x: Math.round(x), z: Math.round(z), r: Math.round(r) });
        } else { bInv++; inverted++; }
        continue;
      }
      const believed = says(x, z);
      const d = Math.abs(h.y - believed);
      (bAgree[h.on] || (bAgree[h.on] = [])).push(d);
      (agree[h.on] || (agree[h.on] = [])).push(d);
      if (h.on === 'ground.skirt' && d > opt.tol && drift.length < 8) {
        drift.push({ x: Math.round(x), z: Math.round(z), r: Math.round(r), seen: +h.y.toFixed(2), says: +believed.toFixed(2) });
      }
    }
    bands.push({
      to: Math.round(r1), n: opt.n, miss: bMiss, inv: bInv,
      skirt: stat(bAgree['ground.skirt']), plate: stat(bAgree['ground.plate']),
      nSkirt: bAgree['ground.skirt'].length, nPlate: bAgree['ground.plate'].length,
    });
  }

  // ---- 3. the road is on top of the grass, not under it --------------------
  // The failure this catches reads as "the main straight renders as GRASS":
  // the skirt's flat chord between two vertices rises above a road that dips
  // between them, and the grass wins the depth test in patches.
  let over = 0, roadN = 0;
  const clear = [], worstAt = [];
  const stride = Math.max(1, Math.floor(T.n / 400));
  for (let i = 0; i < T.n; i += stride) {
    const h = T.hdg[i];
    for (const f of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const lat = f * T.w[i];
      const x = T.x[i] - Math.sin(h) * lat, z = Z(T.y[i] + Math.cos(h) * lat);
      const ry = V.road ? dropY(x, z, [V.road]) : null;
      if (ry == null) continue;
      const g = drop(x, z, ground);
      if (g == null) continue;               // already counted as a hole
      roadN++;
      const up = g.y - ry;                   // positive = grass above the road
      clear.push(-up);                       // how far the grass is BELOW it
      if (up > -0.005) over++;
      worstAt.push({ up: +up.toFixed(3), s: Math.round(T.s ? T.s[i] : i), lat: +lat.toFixed(1), on: g.on });
    }
  }
  worstAt.sort((a, b) => b.up - a.up);

  // ---- 4. paint stays on the road -----------------------------------------
  //
  // This check exists because of a mistake made while writing the rest of this
  // file. Splitting placement into "on the height field" and "on the sunk
  // ground" is a judgement per object, and the chequered start line and the
  // twenty-two grid boxes were put on the SUNK ground with the scenery —
  // which buries 35 cm of painted road under the tarmac it is painted on.
  //
  // Nothing above could see it: the grass was continuous, agreed with
  // groundY, and sat below the road exactly as it should. That is the useful
  // question to ask of any gate — not "does it pass" but "what would it not
  // notice". Road paint is measured against the ROAD, vertex by vertex, so
  // the answer cannot come back plausible and wrong.
  const marks = [];
  S.traverse(o => { if (o.name && o.name.startsWith('mark.')) marks.push(o); });
  const paint = [];
  const pv = new THREE.Vector3();
  for (const m of marks) {
    m.updateMatrixWorld(true);
    const a = m.geometry.attributes.position.array;
    const stride = Math.max(3, Math.floor(a.length / 3 / 160) * 3);
    let lo = Infinity, hi = -Infinity, n = 0, off = 0;
    for (let k = 0; k < a.length; k += stride) {
      // Through the world matrix, not the raw array. `lift` bakes into the
      // geometry today, so the two agree — and a check that reads the array
      // directly would go on agreeing with itself after somebody moves the
      // mesh instead. (The --break below does exactly that, which is how this
      // line came to be written.)
      pv.set(a[k], a[k + 1], a[k + 2]).applyMatrix4(m.matrixWorld);
      const ry = V.road ? dropY(pv.x, pv.z, [V.road]) : null;
      if (ry == null) { off++; continue; }
      const d = pv.y - ry;                  // paint above the road, in metres
      lo = Math.min(lo, d); hi = Math.max(hi, d); n++;
    }
    paint.push({ name: m.name, n, offRoad: off, lo: n ? +lo.toFixed(3) : null, hi: n ? +hi.toFixed(3) : null });
  }

  // ---- 5. trees: off the circuit, and standing on the ground ---------------
  let trees = 0, onCircuit = 0;
  const float = { 'ground.skirt': [], 'ground.plate': [] };
  const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3();
  const offenders = [];
  S.traverse(o => {
    if (o.name !== 'env.trees' || !o.isInstancedMesh) return;
    trees += o.count;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4);
      v3.setFromMatrixPosition(m4);
      const n = W.nearest(v3.x, v3.z);
      // Deliberately the corridor WITHOUT the extra metre env.js allows
      // itself, so a tree just outside the run-off — the Monza avenue, which
      // is the one piece of scenery that circuit is known for — is not
      // reported as a failure by a gate measuring slightly differently.
      const clear = T.w[n.i] + Math.max(T.runL[n.i], T.runR[n.i]);
      if (n.d < clear) {
        onCircuit++;
        if (offenders.length < 6) offenders.push({ x: Math.round(v3.x), z: Math.round(v3.z), d: +n.d.toFixed(1), clear: +clear.toFixed(1) });
      }
      // Every eighth tree is dropped on to see whether it is standing on the
      // ground it was placed against. All of them is thousands of rays.
      if (i % 8 === 0) {
        const g = drop(v3.x, v3.z, ground);
        if (g != null) (float[g.on] || (float[g.on] = [])).push(Math.abs(v3.y - g.y));
      }
    }
  });

  return {
    meshes: ground.map(o => o.name),
    total, miss, inverted, bands, holes, drift,
    agree: { skirt: stat(agree['ground.skirt']), plate: stat(agree['ground.plate']) },
    road: { n: roadN, over, worst: worstAt.slice(0, 6), clear: stat(clear) },
    paint,
    trees: {
      n: trees, onCircuit, offenders,
      float: stat(float['ground.skirt']), floatN: float['ground.skirt'].length,
      farFloat: stat(float['ground.plate']), farFloatN: float['ground.plate'].length,
    },
  };
}

// The sabotages. A gate nobody has watched fail is not a gate — and the
// second question, which matters just as much, is what class of mistake it
// structurally CANNOT see. These break the world in the three specific ways
// the checks above claim to catch.
function pageBreak(which) {
  const S = window.__wdcView.scene;
  if (which === 'holes') {
    const s = S.getObjectByName('ground.skirt');
    if (!s) return 'no ground.skirt to remove';
    s.parent.remove(s);
    return 'removed ground.skirt — the ring the plate does not cover is now open sky';
  }
  if (which === 'sink') {
    let n = 0;
    for (const nm of ['ground.plate', 'ground.skirt']) {
      const o = S.getObjectByName(nm);
      if (o) { o.position.y += 0.6; o.updateMatrixWorld(true); n++; }
    }
    return `raised ${n} ground mesh(es) 0.6 m — grass now over the road, trees now under it`;
  }
  if (which === 'paint') {
    const m = S.getObjectByName('mark.line');
    if (!m) return 'no mark.line to sink';
    m.position.y -= 0.4; m.updateMatrixWorld(true);
    return 'sank the start line 0.4 m — exactly what placing it on the grass did';
  }
  if (which === 'trees') {
    const t = S.getObjectByName('env.trees');
    if (!t) return 'no env.trees to move';
    const T = window.__wdcView.track;
    const m = new t.matrixWorld.constructor();
    for (let i = 0; i < Math.min(12, t.count); i++) {
      t.getMatrixAt(i, m);
      const k = Math.floor((i / 12) * T.n);
      m.elements[12] = T.x[k]; m.elements[14] = -T.y[k];
      t.setMatrixAt(i, m);
    }
    t.instanceMatrix.needsUpdate = true;
    return 'moved 12 trees on to the centreline';
  }
  return 'unknown sabotage';
}

// ---------------------------------------------------------------------------
function verdict(r, opt) {
  // TWO LISTS, ON PURPOSE.
  //
  // `fails` set the exit code: they are the things that are correct today and
  // must stay correct. `known` is a defect this tool FOUND and that nothing
  // here fixes — the skirt is a 26 m grid over terrain surveyed at 2 m, and
  // between two of its vertices it is a flat chord. On Monza that chord is
  // wrong by up to 0.8 m; on Monaco's hillside, by 9 m.
  //
  // It is not in `fails` because a gate that is red on a clean master teaches
  // people to run it with their eyes shut, and it is not silenced because
  // then nobody would ever see it again. It prints, every run, with the
  // number. `--strict` moves it into `fails` for whoever goes to fix it.
  const fails = [], known = [];
  if (r.err) return { fails: [r.err], known };
  if (r.miss) fails.push(`${r.miss} of ${r.total} sample points have NO GROUND under them`);
  if (r.inverted) fails.push(`${r.inverted} points have ground facing the wrong way — invisible from above`);
  for (const p of r.paint) {
    if (!p.n) { fails.push(`${p.name}: not one vertex of it is over the road`); continue; }
    if (p.lo < -0.002) fails.push(`${p.name} is painted UNDER the road, by up to ${(-p.lo).toFixed(3)} m`);
    else if (p.hi > 0.15) fails.push(`${p.name} floats up to ${p.hi} m over the road`);
  }
  if (r.trees.onCircuit) fails.push(`${r.trees.onCircuit} trees are standing on the circuit`);

  const chord = r.agree.skirt ? r.agree.skirt.max : 0;
  if (chord > opt.tol) known.push(`the skirt's 26 m chords miss the surveyed ground by up to ${chord} m`);
  if (r.road.over) known.push(`${r.road.over} of ${r.road.n} points on the racing surface have grass at or above the road, worst +${r.road.worst[0].up} m at s=${r.road.worst[0].s}`);
  if (r.trees.float && r.trees.float.max > opt.tol) known.push(`trees on the skirt stand up to ${r.trees.float.max} m off it (p50 ${r.trees.float.p50} m, which is the part that got fixed)`);
  if (opt.strict) { fails.push(...known); known.length = 0; }
  return { fails, known };
}

const num = (v, w = 5) => (v == null ? '--' : v.toFixed(2)).padStart(w);
const trio = st => st ? `${num(st.p50)} /${num(st.p95)} /${num(st.max)}` : '        --       ';

function report(r, opt) {
  if (r.err) { console.log('  ' + r.err); return; }
  console.log(`  ground meshes: ${r.meshes.join(', ')}`);
  console.log('  out to    n  holes  inv     skirt |seen-groundY| p50/p95/max        plate, same');
  for (const b of r.bands) {
    const bad = b.miss || b.inv;
    console.log(`  ${String(b.to).padStart(5)} m ${String(b.n).padStart(4)} ${String(b.miss).padStart(6)} ${String(b.inv).padStart(4)}` +
      `   ${trio(b.skirt)} (${String(b.nSkirt).padStart(3)})   ${trio(b.plate)} (${String(b.nPlate).padStart(3)})${bad ? '  <—' : ''}`);
  }
  if (r.holes.length) console.log('  holes at: ' + r.holes.map(h => `(${h.x},${h.z}) ${h.r} m out`).join(', '));
  if (r.drift.length) console.log('  skirt disagrees at: ' + r.drift.map(d => `(${d.x},${d.z}) seen ${d.seen} vs ${d.says}`).join(', '));
  console.log(`  racing surface: ${r.road.n} points; grass sits ${r.road.clear ? `${r.road.clear.p50} m below it (p50), ${r.road.clear.max} m at best, ` : ''}` +
    `${r.road.over} point(s) at or above it`);
  if (r.road.worst.length) {
    console.log('    closest: ' + r.road.worst.slice(0, 4).map(w => `s=${w.s} lat ${w.lat} ${w.up >= 0 ? '+' : ''}${w.up} m`).join(', '));
  }
  for (const p of r.paint) {
    console.log(`  ${p.name}: ${p.n} vertices checked, sitting ${p.lo} to ${p.hi} m above the road` +
      (p.offRoad ? ` (${p.offRoad} not over any road triangle)` : ''));
  }
  console.log(`  trees: ${r.trees.n} placed, ${r.trees.onCircuit} on the circuit`);
  console.log(`    standing on the skirt (${r.trees.floatN}): ${trio(r.trees.float).trim()} m off the ground` +
    `   |  on the plate (${r.trees.farFloatN}): ${trio(r.trees.farFloat).trim()} m`);
  if (r.trees.offenders.length) console.log('    on the circuit at: ' + r.trees.offenders.map(o => `(${o.x},${o.z}) ${o.d} m from centre, corridor ${o.clear} m`).join(', '));
}

// ---------------------------------------------------------------------------
const PORT = freePort();
const server = serve(PORT);
await sleep(900);
console.log(`serving ${ROOT} on 127.0.0.1:${PORT}`);

let bad = 0;
for (const track of TRACKS) {
  const CDP = 9900 + Math.floor(Math.random() * 90);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wdc-gc-'));
  const url = `http://127.0.0.1:${PORT}/index.html?auto=${track}:f1`;
  const chrome = spawn('/usr/bin/chromium', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    '--window-size=1280,720', `--remote-debugging-port=${CDP}`,
    `--user-data-dir=${profile}`, url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeErr = '';
  chrome.stderr.on('data', d => { chromeErr += d.toString(); });

  const t0 = Date.now();
  try {
    const cdp = await connect(CDP);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    let built = false;
    for (let i = 0; i < 120 && !built; i++) {
      built = await cdp.eval('!!window.__wdcView').catch(() => false);
      if (!built) await sleep(250);
    }
    if (!built) throw new Error(`the world never built (${cdp.errors.slice(0, 3).join(' | ') || 'no console errors'})`);
    // The woods (js/woods.js) arrive AFTER the world: they wait on the plant
    // photographs. Checked before they land, this gate counted 0 trees and
    // passed — so wait for them, up to 30 s. A circuit with no survey data
    // never sets __wdcWoods; it just costs the wait.
    for (let i = 0; i < 120; i++) {
      if (await cdp.eval('!!window.__wdcWoods').catch(() => false)) break;
      await sleep(250);
    }

    const run = async () => cdp.eval(`(${pageCheck.toString()})(${JSON.stringify(OPT)})`);
    console.log(`\n${track.toUpperCase()}  —  ${OPT.bands} bands to ${OPT.reach} m, ${OPT.n} samples each  (${((Date.now() - t0) / 1000).toFixed(1)}s to build)`);
    const clean = await run();
    report(clean, OPT);
    const v = verdict(clean, OPT);
    for (const m of v.fails) console.log('  FAIL  ' + m);
    for (const m of v.known) console.log('  KNOWN ' + m);
    if (v.fails.length) bad++;
    else console.log('  ok    ground is continuous, trees are off the circuit, paint is on the road');

    if (BREAK) {
      // Each sabotage must flip a SPECIFIC check. A break that fails
      // everything proves nothing about which check was doing the work.
      const suite = [
        ['sink', r => r.agree.skirt.max > OPT.tol && r.road.over > 0, 'agreement + racing surface'],
        ['paint', r => r.paint.some(p => p.lo < -0.002), 'road paint'],
        ['trees', r => r.trees.onCircuit > 0, 'trees on the circuit'],
        ['holes', r => r.miss > 0, 'coverage'],
      ];
      console.log('\n  --break: the world is now sabotaged on purpose.');
      for (const [which, caught, what] of suite) {
        const note = await cdp.eval(`(${pageBreak.toString()})(${JSON.stringify(which)})`);
        const r = await run();
        const got = !r.err && caught(r);
        console.log(`  ${got ? 'ok   ' : 'FAIL '} ${which}: ${note}`);
        console.log(`          ${what} ${got ? 'caught it' : 'DID NOT NOTICE — this check is blind'}` +
          `  (holes ${r.miss}, skirt agree max ${r.agree && r.agree.skirt ? r.agree.skirt.max : '--'}, road ${r.road ? r.road.over : '--'}, trees on track ${r.trees ? r.trees.onCircuit : '--'})`);
        if (!got) bad++;
      }
    }
  } catch (e) {
    console.log(`\n${track.toUpperCase()}\n  FAIL  ${e.message}`);
    if (chromeErr) console.log('  ' + chromeErr.split('\n').filter(l => /ERROR/.test(l)).slice(0, 4).join('\n  '));
    bad++;
  } finally {
    chrome.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
try { process.kill(-server.pid); } catch { /* already gone */ }
console.log(bad ? `\n${bad} FAILURE(S)` : `\nall clear across ${TRACKS.length} circuit(s)`);
process.exit(bad ? 1 : 0);
