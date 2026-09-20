// trees.js — how a tree is built, and every variant of that idea worth trying.
//
// Split out of js/build/flora.js on 2026-09-19 because of Adam's verdict on
// the first wood: "im now seeing the leaves up close and WOW. THATS QUITE THE
// DETAIL... but at distance they just look like green ovals."
//
// Both halves of that are about the same thing and it is not leaf detail. At
// forty metres a tree is a SILHOUETTE and a pattern of light and shade, and
// the two things that decide whether it reads as a tree are:
//
//   THE OUTLINE. A crown of same-sized cards on a sphere is an oval, however
//   good the photograph on each card is. A real crown is lumpy, has gaps you
//   can see sky through, and a few branch tips sticking out past everything
//   else.
//
//   THE NORMALS. Cards facing straight up shade identically wherever they are
//   on the tree, so the whole crown is one flat green. Normals pointing OUT
//   from the middle of the crown give it a lit side and a shaded side, which
//   is what the eye reads as volume at a distance.
//
// So a variant here is a set of numbers and two choices, and the showroom
// (gameshow.html) puts them side by side at ten metres and at four hundred so
// Adam can mark them out of ten.
import * as THREE from 'three';

function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------------------
// One card. `normals` is 'up' (flat, the first version) or 'sphere' (pointing
// out of `centre`, which is what gives a crown a lit side).
// ---------------------------------------------------------------------------
export function card(rect, w, h, {
  rows = 2, bend = 0, tilt = 0, yaw = 0, at = [0, 0, 0], shade = 1, droop = 0,
  normals = 'up', centre = [0, 0, 0], twist = 0, roll = 0, cross = false,
} = {}) {
  // CROSS: the same spray, twice, the second one rolled onto its edge.
  //
  // Adam, on the first wood: "the leaves are paper thin, and from the side
  // they look like they arent there. from above they look great."
  //
  // Both halves of that are one fact. A card is a single ribbon whose width
  // runs horizontally, so its area is presented UPWARDS — perfect from above,
  // and geometrically zero from the side, because a plane seen edge-on is a
  // line. No amount of leaf detail fixes it; there is nothing there to light.
  //
  // Rolling a second copy 90 degrees about the spray's own growth axis gives
  // the pair area from every horizontal direction, for twice the triangles of
  // one card. Crowns spend that by carrying FEWER sprays, which is the better
  // trade anyway: 13 crossed sprays read as a denser tree than 20 flat ones
  // from the side, and identically from above.
  if (cross) {
    const a = card(rect, w, h, { rows, bend, tilt, yaw, at, shade, droop, normals, centre, twist, roll });
    const b = card(rect, w, h, {
      rows, bend, tilt, yaw, at, shade: shade * 0.86, droop, normals, centre, twist,
      roll: roll + Math.PI / 2,
    });
    const n = a.pos.length / 3;
    return {
      pos: a.pos.concat(b.pos), uv: a.uv.concat(b.uv), sway: a.sway.concat(b.sway),
      nor: a.nor.concat(b.nor), col: a.col.concat(b.col),
      idx: a.idx.concat(b.idx.map(i => i + n)),
    };
  }

  const pos = [], uv = [], sway = [], nor = [], col = [], idx = [];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const N = new THREE.Vector3();
  // Where the card's WIDTH points, once rolled about the growth axis. At
  // roll 0 this is (1,0,0) and everything below is what it always was.
  const wx = Math.cos(roll), wy = -Math.sin(roll) * st, wz = Math.sin(roll) * ct;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const lean = bend * t * t;
    const y = h * t * ct - droop * t * t;
    const z0 = h * t * st + lean;
    const k = shade * (0.74 + 0.26 * t);
    for (const s of [-0.5, 0.5]) {
      const x = s * w * (1 - 0.12 * t) + twist * t * (s > 0 ? 1 : -1);
      const lx = x * wx, ly = y + x * wy, lz = z0 + x * wz;
      const px = lx * cy - lz * sy + at[0], py = ly + at[1], pz = lx * sy + lz * cy + at[2];
      pos.push(px, py, pz);
      uv.push(rect.x + (s + 0.5) * rect.w, rect.y + t * rect.h);
      sway.push(t);
      if (normals === 'sphere') {
        // Out of the middle of the crown, lifted a little: a leaf is not a
        // wall, but it is not a floor either.
        N.set(px - centre[0], (py - centre[1]) * 0.85 + 0.35, pz - centre[2]).normalize();
        nor.push(N.x, N.y, N.z);
      } else if (roll === 0) {
        // Untouched, so a flat card shades in this build exactly as it did in
        // the last one and any change on screen is the CROSS and not a normal.
        nor.push(-sy * 0.45, 0.89, cy * 0.45);
      } else {
        // The rolled copy stands on its edge, so "mostly up" would be a lie
        // that lights it like a floor. Take the real normal — growth crossed
        // with width — and lean it back toward the sky, because a leaf really
        // does face everywhere and a wood that flickers black as the sun
        // crosses it is worse than one shaded approximately.
        N.set(ct * wz - st * wy, st * wx, -ct * wx);
        if (N.y < 0) N.negate();
        N.y += 0.55; N.normalize();
        nor.push(N.x * cy - N.z * sy, N.y, N.x * sy + N.z * cy);
      }
      col.push(k, k, k);
    }
    if (r > 0) {
      const q = r * 2;
      idx.push(q - 2, q - 1, q, q - 1, q + 1, q);
    }
  }
  return { pos, uv, sway, nor, col, idx };
}

export function assemble(parts) {
  const pos = [], uv = [], sway = [], nor = [], col = [], idx = [];
  for (const p of parts) {
    const base = pos.length / 3;
    pos.push(...p.pos); uv.push(...p.uv); sway.push(...p.sway); nor.push(...p.nor); col.push(...p.col);
    for (const i of p.idx) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function trunkGeometry(rBase, rTop, h, { sides = 6, lean = 0, shade = 0.62 } = {}) {
  const g = new THREE.CylinderGeometry(rTop, rBase, h, sides, 1, false);
  g.translate(0, h / 2, 0);
  if (lean) g.rotateZ(lean);
  const uv = g.attributes.uv;
  const circ = 2 * Math.PI * (rBase + rTop) * 0.5;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  const n = g.attributes.position.count;
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(shade), 3));
  return g;
}

export function mergeGeoms(list) {
  const pos = [], nor = [], uv = [], col = [], sway = [], idx = [];
  for (const g of list) {
    const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    const c = g.attributes.color, s = g.attributes.aSway;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
      sway.push(s ? s.getX(i) : 0);
    }
    const ix = g.index;
    for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// Two by two leaves out of the atlas make a cluster card: the atlas is a grid
// of single leaves, and a rectangle spanning four of them is a branch's worth
// of foliage with transparent gaps, in one quad.
export function clusters(items, cols = 2, rows = 2) {
  if (items.length < 4) return items;
  const byCol = [...items].sort((a, b) => a.x - b.x || a.y - b.y);
  const out = [];
  for (let i = 0; i + cols * rows <= byCol.length; i += cols) {
    const grp = byCol.slice(i, i + cols * rows);
    const x0 = Math.min(...grp.map(g => g.x)), y0 = Math.min(...grp.map(g => g.y));
    const x1 = Math.max(...grp.map(g => g.x + g.w)), y1 = Math.max(...grp.map(g => g.y + g.h));
    out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, fill: 0.55 });
  }
  return out.length ? out : items;
}


// ---------------------------------------------------------------------------
// BRANCH CARDS, baked at load.
//
// This is the thing that was wrong with the first wood, and the showroom found
// it in one screenshot: data/flora/leaf-*.png is a grid of SINGLE leaves, and
// a card carrying four of them had to be three metres wide to hold them — so
// every "leaf" on the tree was a metre and a half across. Up close that reads
// as astonishing detail (Adam: "WOW. THATS QUITE THE DETAIL"), and at any
// distance at all it reads as a green oval, because it is twenty enormous
// flat leaves.
//
// A game tree is built from BRANCH cards: one quad carrying twenty small
// leaves on a twig. Nobody ships an atlas of those, they are assembled — the
// same thing a Blender artist does by hand with a scanned leaf and a plane.
// So it is assembled here, at load, out of the scan: leaves drawn small, along
// a twig, at real relative size. The photograph is still the photograph.
// ---------------------------------------------------------------------------
export function bakeBranchAtlas(colourImg, alphaImg, rects, {
  size = 1024, cols = 2, rows = 2, leaves = 22, seed = 4,
} = {}) {
  const merged = document.createElement('canvas');
  merged.width = colourImg.width; merged.height = colourImg.height;
  const mc = merged.getContext('2d', { willReadFrequently: true });
  mc.drawImage(colourImg, 0, 0);

  // Punch the leaves out of their backdrop with the opacity map.
  //
  // NOT with globalCompositeOperation 'destination-in' and drawImage: the
  // opacity map is a GREY IMAGE, and every compositing mode in canvas works on
  // the source's ALPHA channel — which in a grey PNG is 255 everywhere. That
  // composite is a no-op that looks like it worked, and the result was a tree
  // built out of solid dark rectangles. Grey has to be moved into alpha by
  // hand, one pixel at a time.
  const tmp = document.createElement('canvas');
  tmp.width = merged.width; tmp.height = merged.height;
  const tc = tmp.getContext('2d', { willReadFrequently: true });
  tc.drawImage(alphaImg, 0, 0, tmp.width, tmp.height);
  const A = tc.getImageData(0, 0, tmp.width, tmp.height).data;
  const C = mc.getImageData(0, 0, merged.width, merged.height);
  for (let i = 0; i < A.length; i += 4) C.data[i + 3] = A[i];
  mc.putImageData(C, 0, 0);

  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const cw = size / cols, ch = size / rows;
  const r = rng(seed);
  const W = colourImg.width, H = colourImg.height;
  const out = [];
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const ox = cx * cw, oy = cy * ch;
    // THREE twigs fanning across the cell, not one line of leaves along the
    // middle: a card with empty top and bottom is a card whose crown has holes
    // in it wherever it is used, and the first bake did exactly that.
    // `leaves` is the count for the WHOLE cell, shared between the twigs. It
    // used to be per twig, which put 72 leaves on a card and covered three
    // times its own area — a solid green slab with a ragged edge, which is
    // exactly what the showroom photographed.
    const twigs = 3;
    const per = Math.max(3, Math.round(leaves / twigs));
    for (let t0 = 0; t0 < twigs; t0++) {
      const y0 = ch * (0.22 + t0 * 0.28) + (r() - 0.5) * ch * 0.06;
      const y1 = ch * (0.2 + t0 * 0.3) + (r() - 0.5) * ch * 0.2;
      g.save();
      g.strokeStyle = 'rgba(74,58,40,0.9)';
      g.lineWidth = Math.max(2, cw * 0.01);
      g.beginPath();
      g.moveTo(ox + cw * 0.04, oy + y0);
      g.bezierCurveTo(ox + cw * 0.35, oy + y0 * 0.9, ox + cw * 0.7, oy + y1, ox + cw * 0.97, oy + y1);
      g.stroke();
      g.restore();
      for (let i = 0; i < per; i++) {
        const rect = rects[Math.floor(r() * rects.length)];
        // atlas rect is UV (v from the bottom); the canvas is top-down
        const sx = rect.x * W, sw = rect.w * W;
        const sh = rect.h * H, sy = (1 - rect.y - rect.h) * H;
        const t = i / (per - 1);
        const px = ox + cw * (0.05 + t * 0.9) + (r() - 0.5) * cw * 0.07;
        const py = oy + (y0 + (y1 - y0) * t) + (i % 2 ? 1 : -1) * ch * (0.02 + r() * 0.12);
        const lw = cw * (0.13 + r() * 0.07) * (1 - t * 0.3);
        const lh = lw * (sh / sw);
        g.save();
        g.translate(px, py);
        g.rotate((i % 2 ? 1 : -1) * (0.4 + r() * 1.6));
        g.globalAlpha = 0.85 + r() * 0.15;
        g.drawImage(merged, sx, sy, sw, sh, -lw * 0.5, -lh * 0.5, lw, lh);
        g.restore();
      }
    }
    out.push({ x: cx / cols, y: 1 - (cy + 1) / rows, w: 1 / cols, h: 1 / rows, fill: 0.5 });
  }
  return { canvas: cv, rects: out };
}

// ---------------------------------------------------------------------------
// BROADLEAF. `lumpy` is the dial that decides whether this is an oval: 0 puts
// every cluster the same size on a sphere, 1 gives them wildly different sizes
// and pushes a few of them out past the rest.
// ---------------------------------------------------------------------------
export function broadTree(rects, S) {
  const r = rng(S.seed);
  const h = S.height, crown = S.crown;
  const centre = [0, h * 0.6 + crown * 0.55, 0];
  const trunk = [trunkGeometry(S.trunkR, S.trunkR * 0.5, h, { sides: S.sides })];
  for (let k = 0; k < S.branches; k++) {
    const g = trunkGeometry(0.17, 0.07, crown * (0.85 + r() * 0.5), { sides: 4, lean: 0.55 + r() * 0.3 });
    g.rotateY(k * 1.7 + r() * 0.5);
    g.translate(0, h * 0.6, 0);
    trunk.push(g);
  }
  const parts = [];
  for (let k = 0; k < S.cards; k++) {
    const rect = rects[k % rects.length];
    const t = k / S.cards;
    const yaw = k * 2.3999 + r() * 0.4;
    const up = 0.26 + 0.8 * Math.sin(t * Math.PI * 1.6 + r() * 0.6);
    // A few cards are thrown well outside the crown: those are the branch tips
    // that break the outline, and an outline that is never broken is an oval.
    const reach = (r() < S.strays) ? 1.35 + r() * 0.45 : 0.42 + r() * 0.72;
    const out = crown * reach * Math.max(0.35, Math.sin(up * Math.PI * 0.85));
    const size = crown * (S.cardScale ?? 1) * (0.78 + r() * 0.55) * (1 + S.lumpy * (r() - 0.5) * 1.3);
    const shade = (S.floor ?? 0.4) + (1 - (S.floor ?? 0.4)) * Math.min(1, (out / crown) * 0.5 + up * 0.7);
    parts.push(card(rect, size, size * 0.92, {
      rows: 2, tilt: 0.5 + r() * 1.1, bend: (r() - 0.5) * size * 0.55, yaw, shade,
      droop: size * S.droop, normals: S.normals, centre, cross: !!S.cross,
      at: [Math.cos(yaw) * out, h * 0.58 + up * crown, Math.sin(yaw) * out],
    }));
  }
  return { trunk: mergeGeoms(trunk), foliage: assemble(parts), height: h + crown };
}

// ---------------------------------------------------------------------------
// CONIFER. The outline is everything here: whorls that shrink going up, and a
// spire. `ragged` pulls individual whorls in and out so the cone is not a
// perfect cone, which is the difference between a fir and a party hat.
// ---------------------------------------------------------------------------
export function coniferTree(rects, S) {
  const r = rng(S.seed);
  const h = S.height;
  const centre = [0, h * 0.55, 0];
  const trunk = trunkGeometry(S.trunkR, S.trunkR * 0.3, h, { sides: S.sides });
  const parts = [];
  for (let k = 0; k < S.whorls; k++) {
    const t = 0.18 + 0.82 * (k / (S.whorls - 1));
    const jitter = 1 + S.ragged * (r() - 0.5) * 1.2;
    const reach = (S.crown * Math.pow(1 - t, 0.72) + 0.4) * jitter;
    // Not 0.5 at the foot: the needle scan is already dark (mean 0.26 of
    // white) and a shade floor on top of it made the firs read as black
    // bottle brushes in the showroom's first photograph.
    const shade = 0.68 + 0.32 * t;
    for (let j = 0; j < S.perWhorl; j++) {
      const rect = rects[(k + j) % rects.length];
      const yaw = k * 2.3999 + j * (Math.PI * 2 / S.perWhorl) + r() * 0.4;
      parts.push(card(rect, reach * 2.3, reach * 1.45, {
        rows: 2, tilt: S.tilt + r() * 0.2, bend: -reach * 0.18, yaw, shade,
        droop: reach * S.droop, normals: S.normals, centre, cross: !!S.cross,
        at: [Math.cos(yaw) * reach * 0.2, h * t, Math.sin(yaw) * reach * 0.2],
      }));
    }
  }
  parts.push(card(rects[0], S.crown * 0.7, S.crown * 1.15, {
    rows: 2, yaw: 0.7, shade: 1, normals: S.normals, centre, at: [0, h * 0.93, 0],
  }));
  return { trunk, foliage: assemble(parts), height: h };
}

// ---------------------------------------------------------------------------
// THE CANDIDATES. `atlas` says which cut-out set to hang on it.
// Everything here is a guess until Adam marks it out of ten in gameshow.html.
// ---------------------------------------------------------------------------
export const VARIANTS = {
  'broad-v1': {
    label: 'Broadleaf v1 — what shipped', atlas: 'leaf', make: broadTree,
    spec: { height: 9.5, crown: 3.6, cards: 20, branches: 4, trunkR: 0.42, sides: 6,
      lumpy: 0, strays: 0, droop: 0.18, normals: 'up', seed: 11 },
  },
  // Adam, 2026-09-20: "the leaves are paper thin, and from the side they look
  // like they arent there... increase some thickness... and remember trees
  // block LOTS of light".
  'broad-cross': {
    label: 'Broadleaf — crossed sprays, 13 not 20', atlas: 'leaf', make: broadTree,
    spec: { height: 9.5, crown: 3.6, cards: 13, branches: 4, trunkR: 0.42, sides: 6,
      lumpy: 0.4, strays: 0.14, droop: 0.2, normals: 'up', cross: true, seed: 11 },
  },
  'broad-cross-dark': {
    label: 'Broadleaf — crossed, and a canopy you cannot see into', atlas: 'leaf', make: broadTree,
    spec: { height: 9.5, crown: 3.6, cards: 13, branches: 4, trunkR: 0.42, sides: 6,
      lumpy: 0.4, strays: 0.14, droop: 0.2, normals: 'up', cross: true, floor: 0.16, seed: 11 },
  },
  'broad-lumpy': {
    label: 'Broadleaf — lumpy crown, same count', atlas: 'leaf', make: broadTree,
    spec: { height: 9.5, crown: 3.6, cards: 20, branches: 4, trunkR: 0.42, sides: 6,
      lumpy: 0.8, strays: 0.18, droop: 0.24, normals: 'up', seed: 11 },
  },
  'broad-round': {
    label: 'Broadleaf — spherical normals', atlas: 'leaf', make: broadTree,
    spec: { height: 9.5, crown: 3.6, cards: 20, branches: 4, trunkR: 0.42, sides: 6,
      lumpy: 0, strays: 0, droop: 0.18, normals: 'sphere', seed: 11 },
  },
  'broad-both': {
    label: 'Broadleaf — lumpy AND round', atlas: 'leaf', make: broadTree,
    spec: { height: 9.5, crown: 3.6, cards: 22, branches: 5, trunkR: 0.42, sides: 6,
      lumpy: 0.85, strays: 0.2, droop: 0.24, normals: 'sphere', seed: 11 },
  },
  'broad-dense': {
    label: 'Broadleaf — 40 cards, lumpy, round', atlas: 'leaf', make: broadTree,
    spec: { height: 10.5, crown: 4.0, cards: 40, branches: 5, trunkR: 0.46, sides: 7,
      lumpy: 0.7, strays: 0.15, droop: 0.22, normals: 'sphere', seed: 5 },
  },
  'broad-tall': {
    label: 'Broadleaf — tall, narrow, ragged', atlas: 'leaf', make: broadTree,
    spec: { height: 14, crown: 3.2, cards: 30, branches: 5, trunkR: 0.38, sides: 6,
      lumpy: 0.9, strays: 0.25, droop: 0.3, normals: 'sphere', seed: 21 },
  },
  // --- built on BAKED BRANCH CARDS (atlas 'branch'), which is the fix for
  // --- "green ovals": small leaves, many cards, a ragged outline.
  'broad-branch': {
    label: 'Broadleaf — real branch cards', atlas: 'branch', make: broadTree,
    spec: { height: 10, crown: 3.8, cards: 78, branches: 5, trunkR: 0.44, sides: 7,
      lumpy: 0.5, strays: 0.14, droop: 0.2, normals: 'sphere', cardScale: 0.52, seed: 31 },
  },
  'broad-branch-big': {
    label: 'Broadleaf — branch cards, 70 of them', atlas: 'branch', make: broadTree,
    spec: { height: 12, crown: 4.4, cards: 120, branches: 6, trunkR: 0.5, sides: 7,
      lumpy: 0.55, strays: 0.16, droop: 0.22, normals: 'sphere', cardScale: 0.5, seed: 41 },
  },
  'broad-branch-oak': {
    label: 'Broadleaf — wide oak, branch cards', atlas: 'branch', make: broadTree,
    spec: { height: 9, crown: 5.2, cards: 110, branches: 6, trunkR: 0.62, sides: 8,
      lumpy: 0.7, strays: 0.2, droop: 0.26, normals: 'sphere', cardScale: 0.46, seed: 53 },
  },
  'fir-v1': {
    label: 'Fir v1 — what shipped', atlas: 'needle', make: coniferTree,
    spec: { height: 15, crown: 3.0, whorls: 16, perWhorl: 2, trunkR: 0.34, sides: 6,
      tilt: 1.28, droop: 0.22, ragged: 0, normals: 'up', seed: 3 },
  },
  'fir-ragged': {
    label: 'Fir — ragged whorls', atlas: 'needle', make: coniferTree,
    spec: { height: 15, crown: 3.0, whorls: 18, perWhorl: 2, trunkR: 0.34, sides: 6,
      tilt: 1.3, droop: 0.3, ragged: 0.55, normals: 'up', seed: 3 },
  },
  'fir-round': {
    label: 'Fir — ragged + spherical normals', atlas: 'needle', make: coniferTree,
    spec: { height: 16, crown: 3.1, whorls: 20, perWhorl: 3, trunkR: 0.34, sides: 6,
      tilt: 1.32, droop: 0.32, ragged: 0.5, normals: 'sphere', seed: 7 },
  },
  'fir-spruce': {
    label: 'Fir — tall spruce, steep droop', atlas: 'needle', make: coniferTree,
    spec: { height: 21, crown: 2.6, whorls: 24, perWhorl: 3, trunkR: 0.36, sides: 6,
      tilt: 1.45, droop: 0.42, ragged: 0.35, normals: 'sphere', seed: 13 },
  },
};

export function buildVariant(name, rects) {
  const V = VARIANTS[name];
  if (!V) throw new Error(`no tree variant "${name}"`);
  return { ...V.make(rects, V.spec), label: V.label, atlas: V.atlas, name };
}
