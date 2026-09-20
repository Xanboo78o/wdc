// app.js (the game show) — a free world with nothing in it but one hard thing
// at a time, and a mark out of ten.
//
// Adam, on the first wood: "im now seeing the leaves up close and WOW. THATS
// QUITE THE DETAIL. AWESOME. but at distance they js look like green ovals.
// try to practice trees and other difficult props in a free world ok? ill rate
// them 1-10".
//
// So: every candidate stands in a row on the same ground under the same
// measured sky as the track, and the camera walks BACKWARDS through fixed
// distances — 6 m, 15, 35, 80, 180, 400, 800. A tree that only works at six
// metres is the bug being hunted, and the only way to see it is to look at the
// same tree from both ends.
//
// Ratings are keyed 1-9 and 0 for ten, kept in localStorage AND posted to the
// dev server, which appends them to data/show/ratings.json — so the marks are
// still here in the next session instead of living in a chat message.
import * as THREE from 'three';
import { BuildLook } from '../build/look.js';
import { VARIANTS, buildVariant, bakeBranchAtlas } from '../trees.js';
import { SHAPES } from '../build/propview.js';

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);

const DISTANCES = [6, 15, 35, 80, 180, 400, 800];
const GROUND = 420;                    // m of lawn, so nothing floats in space

// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $('cv'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, Number(q.get('dpr')) || 1.25));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = !q.has('lo');
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.3, 6000);

const LOOK = await BuildLook.load(renderer, { sky: q.get('sky') || 'cloud' });
LOOK.install(scene, { shadows: !q.has('lo'), shadowMap: 2048, shadowBox: 90 });

// A lawn. UVs in metres like everywhere else, folded so the sampler keeps its
// precision (see js/build/meshes.js for why that matters).
{
  const g = new THREE.PlaneGeometry(GROUND, GROUND, 1, 1);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 96, uv.getY(i) * 96);
  const mat = LOOK.look.mat('grass', { size: 1.5, roughness: 1, env: 0.5 })
    || new THREE.MeshStandardMaterial({ color: 0x4d6b33 });
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  scene.add(m);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// The exhibits.
// ---------------------------------------------------------------------------
const CATS = ['trees', 'props'];
let cat = CATS.includes(q.get('cat')) ? q.get('cat') : 'trees';
const stands = { trees: [], props: [] };

function buildTrees() {
  const bark = LOOK.bark();
  bark.vertexColors = true;
  const cut = { needle: LOOK.cutouts('needle'), leaf: LOOK.cutouts('leaf') };
  const mats = {
    leaf: LOOK.cardMaterial('leaf', { sway: 0.45, glow: 0.5, alphaTest: 0.45, tint: 0x92a075 }),
    // The needle scan is dark to begin with — no tint on top of it.
    needle: LOOK.cardMaterial('needle', { sway: 0.3, glow: 0.45, alphaTest: 0.4 }),
  };

  // Branch cards, assembled out of the leaf scan at load. See bakeBranchAtlas.
  const leafTex = LOOK.flora?.tex?.leaf;
  if (leafTex?.c?.image && leafTex?.a?.image && cut.leaf.length) {
    const baked = bakeBranchAtlas(leafTex.c.image, leafTex.a.image, cut.leaf, { leaves: 26, seed: 9 });
    const map = new THREE.CanvasTexture(baked.canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = LOOK.look.aniso;
    const mat = new THREE.MeshStandardMaterial({
      map, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.85, metalness: 0,
      envMapIntensity: 0.9, color: 0xa8b48c,
    });
    mat.shadowSide = THREE.DoubleSide;
    LOOK.patchPlant(mat, { sway: 0.5, glow: 0.5 });
    mats.branch = mat;
    cut.branch = baked.rects;
    // ?atlas=1 hangs the baked sheet in the air at full size. Two rounds of
    // guessing at a texture from photographs of trees MADE of it is two rounds
    // too many — look at the sheet.
    if (q.has('atlas')) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 12),
        new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide }));
      board.position.set(0, 7, 14);
      scene.add(board);
    }
  }

  for (const m of Object.values(mats)) if (m) m.vertexColors = true;
  let x = 0;
  for (const name of Object.keys(VARIANTS)) {
    const atlas = VARIANTS[name].atlas;
    const rects = cut[atlas];
    if (!rects?.length || !mats[atlas]) continue;
    const t = buildVariant(name, rects);
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(t.trunk, bark);
    const foliage = new THREE.Mesh(t.foliage, mats[atlas]);
    for (const m of [trunk, foliage]) { m.castShadow = true; m.receiveShadow = true; }
    g.add(trunk, foliage);
    g.position.set(x, 0, 0);
    scene.add(g);
    stands.trees.push({ name, label: t.label, object: g, height: t.height, x });
    x += 13;
  }
}

function buildProps() {
  let x = 0;
  for (const [name, S] of Object.entries(SHAPES)) {
    const mesh = new THREE.Mesh(S.geo(), new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: S.rough, metalness: S.metal, envMapIntensity: 0.9,
    }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(x, 0, 0);
    scene.add(g);
    stands.props.push({ name, label: name, object: g, height: 2, x });
    x += 4;
  }
}

buildTrees();
buildProps();
for (const c of CATS) for (const s of stands[c]) s.object.visible = (c === cat);

// Centre each row on the origin so a distance is a distance from the ROW, not
// from whichever end of it happens to be first.
for (const c of CATS) {
  const row = stands[c];
  if (!row.length) continue;
  const mid = (row[row.length - 1].x) / 2;
  for (const s of row) { s.object.position.x -= mid; s.x -= mid; }
}

// ---------------------------------------------------------------------------
// Marks out of ten.
// ---------------------------------------------------------------------------
const KEY = 'wdc-gameshow-ratings';
let marks = {};
try { marks = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { marks = {}; }

async function post(name, score) {
  try {
    await fetch('/rate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cat, name, score, at: new Date().toISOString() }),
    });
  } catch { /* the page still works without the dev server */ }
}

function rate(score) {
  const s = current();
  if (!s) return;
  marks[s.name] = score;
  try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch { /* private window */ }
  post(s.name, score);
  $('saved').style.opacity = 1;
  setTimeout(() => { $('saved').style.opacity = 0; }, 450);
  draw();
  if (pick < stands[cat].length - 1) { pick++; frame(); }   // straight on to the next one
}

// ---------------------------------------------------------------------------
// Camera: a row seen from `dist`, or one exhibit orbited on its own.
// ---------------------------------------------------------------------------
let pick = 0, di = 2, solo = false, yaw = 0, pitch = 0.12;
const current = () => stands[cat][pick];

function frame() {
  draw();
  $('d').textContent = DISTANCES[di];
}

function place() {
  const s = current();
  if (!s) return;
  const d = DISTANCES[di];
  // Look at the middle of the exhibit, not its feet: at 800 m a tree is three
  // pixels tall and aiming at the ground puts it off the top of the screen.
  const target = new THREE.Vector3(solo ? s.x : 0, Math.min(s.height * 0.55, 4 + d * 0.02), 0);
  const eye = new THREE.Vector3(
    target.x + Math.sin(yaw) * Math.cos(pitch) * d,
    target.y + Math.sin(pitch) * d + 1.4,
    target.z + Math.cos(yaw) * Math.cos(pitch) * d);
  camera.position.copy(eye);
  camera.lookAt(target);
  // Wide enough to hold the whole row at the shorter distances.
  const want = solo ? 40 : Math.min(62, 34 + DISTANCES.length * 2);
  if (camera.fov !== want) { camera.fov = want; camera.updateProjectionMatrix(); }
}

function draw() {
  $('cat').textContent = cat.toUpperCase() + (solo ? ' · SOLO' : ' · ROW');
  $('items').innerHTML = stands[cat].map((s, i) => {
    const m = marks[s.name];
    return `<li class="${i === pick ? 'on' : ''}"><span class="n">${i + 1}</span>` +
      `<span>${s.label}</span>` +
      `<span class="s ${m ? '' : 'none'}">${m ? m + '/10' : '—'}</span></li>`;
  }).join('');
}

addEventListener('keydown', (e) => {
  const row = stands[cat];
  if (e.code === 'ArrowRight') pick = Math.min(row.length - 1, pick + 1);
  else if (e.code === 'ArrowLeft') pick = Math.max(0, pick - 1);
  else if (e.code === 'ArrowUp') di = Math.max(0, di - 1);
  else if (e.code === 'ArrowDown') di = Math.min(DISTANCES.length - 1, di + 1);
  else if (e.code === 'Tab') { solo = !solo; e.preventDefault(); }
  else if (e.code === 'KeyC') {
    cat = CATS[(CATS.indexOf(cat) + 1) % CATS.length];
    pick = 0;
    for (const c of CATS) for (const s of stands[c]) s.object.visible = (c === cat);
  } else if (/^Digit[0-9]$/.test(e.code)) {
    rate(e.code === 'Digit0' ? 10 : Number(e.code.slice(5)));
    return;
  } else return;
  frame();
});

let drag = null;
$('cv').addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; $('cv').setPointerCapture(e.pointerId); });
$('cv').addEventListener('pointerup', () => drag = null);
$('cv').addEventListener('pointermove', e => {
  if (!drag) return;
  yaw -= (e.clientX - drag.x) * 0.005;
  pitch = Math.max(-0.2, Math.min(1.2, pitch + (e.clientY - drag.y) * 0.003));
  drag = { x: e.clientX, y: e.clientY };
});

// ---------------------------------------------------------------------------
let fpsT = performance.now(), fpsN = 0, frames = 0;
function loop(now) {
  requestAnimationFrame(loop);
  LOOK.tick(now / 1000);
  place();
  const s = current();
  if (s) LOOK.follow(new THREE.Vector3(solo ? s.x : 0, 0, 0));
  renderer.render(scene, camera);
  fpsN++;
  if (now - fpsT > 500) {
    const r = renderer.info.render;
    $('fps').textContent = `${Math.round(fpsN * 1000 / (now - fpsT))} fps · ${r.calls} draws · ${(r.triangles / 1000).toFixed(1)}k tris`;
    fpsT = now; fpsN = 0;
  }
  if (++frames === 2) {
    window.__show = { ready: true, trees: stands.trees.length, props: stands.props.length,
      draws: renderer.info.render.calls, tris: renderer.info.render.triangles };
  }
}
frame();
requestAnimationFrame(loop);
