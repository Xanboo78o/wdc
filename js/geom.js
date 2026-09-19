// geom.js — the small kit every piece of scenery in this project is built out
// of, and the one place the two coordinate frames are reconciled.
//
// ---------------------------------------------------------------------------
// HANDEDNESS, stated once.
//
// The simulation is right-handed and flat: +x forward at heading 0, +y to the
// car's LEFT, headings increasing anticlockwise. three.js is Y-up and the other
// handedness. Mapping sim y straight onto three z renders the entire world as
// its own mirror image — every circuit reflected, every right-hander a
// left-hander, and steering that reads as inverted because pressing left moves
// the car right on screen. One negation fixes it:
//
//     sim (x, y)   ->   three (x, 0, -y)
//     sim heading h  ->  forward (cos h, 0, -sin h)
//                        left    (-sin h, 0, -cos h)
//
// which is exactly what `rotation.y = h` already does to a mesh built along +X,
// so the car and the world agree without either knowing about the other.
//
// A reflection also reverses the sign of every face normal. That is why a
// horizontal quad has to be wound
//
//     inner@s -> inner@s+ds -> outer@s+ds -> outer@s
//
// to face UP. Get it backwards and, because these materials are DoubleSide,
// three does not cull the face — it negates the normal and lights the surface
// from underneath, so the tarmac renders near-black next to a run-off that
// looks perfect. It reads exactly like a shadow bug. It is not one. That cost
// two debugging rounds on day one; `Builder.strip` and `Builder.quadUp` exist
// so nobody has to get it right again by hand.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export const Z = y => -y;

/** Forward unit vector in three-space for a sim heading. */
export const fwd = h => [Math.cos(h), 0, -Math.sin(h)];
/** Left unit vector in three-space for a sim heading (the car's left). */
export const left = h => [-Math.sin(h), 0, -Math.cos(h)];

export const add3 = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k];

// ---------------------------------------------------------------------------
// Builder — accumulate triangles, hand back one BufferGeometry.
//
// three.js's BufferGeometryUtils.mergeGeometries lives in the addons bundle,
// which this project deliberately does not vendor (no build step, one three
// file). So scenery is accumulated into flat arrays here instead. It is also
// faster than building 900 meshes and merging them afterwards: a circuit's
// worth of advertising hoardings is one draw call built in one pass.
// ---------------------------------------------------------------------------
export class Builder {
  constructor({ uv = true, color = false } = {}) {
    this.pos = []; this.nrm = [];
    this.uv = uv ? [] : null;
    this.col = color ? [] : null;
    this.idx = [];
    this._c = new THREE.Color();
  }

  get count() { return this.pos.length / 3; }

  /**
   * Push one vertex colour. A hex or a CSS string goes through THREE.Color; a
   * [r, g, b] triple goes straight into the buffer UNCLAMPED.
   *
   * That last part matters. THREE.Color.getHex() quantises to 0-255, so a
   * vertex colour is capped at 1.0 the moment it passes through one — and 1.0
   * means "exactly the albedo as photographed". The racing surface needs to go
   * BOTH ways around that: darker where the rubber is laid down, and brighter
   * than the scan on the dusty tarmac nobody drives on. Float attributes are
   * not clamped by the shader, so the range is there if you do not throw it
   * away on the way in.
   */
  pushColour(c) {
    if (Array.isArray(c)) { this.col.push(c[0], c[1], c[2]); return; }
    this._c.set(c ?? 0xffffff);
    this.col.push(this._c.r, this._c.g, this._c.b);
  }

  /** One quad, wound as given, with an explicit normal and per-corner UVs. */
  quad(p0, p1, p2, p3, n, uvs, colour) {
    const base = this.count;
    const ps = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      this.pos.push(ps[i][0], ps[i][1], ps[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      if (this.uv) this.uv.push(uvs[i][0], uvs[i][1]);
      if (this.col) this.pushColour(Array.isArray(colour) && colour.length === 4 ? colour[i] : colour);
    }
    // Measured, not trusted — the same rule as the polygon helper below, and
    // for the same reason. These surfaces are DoubleSide, so a quad wound
    // against its own normal is NOT culled and never looks missing: three
    // flips the shading normal for the back face, lights the tarmac from
    // underneath, and the road renders near-black with no sun on it at all.
    // Nothing can then cast a visible shadow onto it, because a shadow is
    // subtracted sunlight and there is none there to subtract.
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const wx = p2[0] - p0[0], wy = p2[1] - p0[1], wz = p2[2] - p0[2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * n[0] + fy * n[1] + fz * n[2] < 0) {
      this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    } else {
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /**
   * A horizontal polygon that faces UP, given its corners in either winding.
   * It is measured and reversed if necessary rather than trusted, which is the
   * whole point: this is the mistake that made the tarmac render black, and it
   * cannot be made here. UVs are world metres, so the texture lands at true
   * scale with no tiling factor to pick.
   *
   * In this frame — three's x/z plane after the sim->three reflection — an
   * UP-facing ring has a NEGATIVE shoelace area. Worth writing down because it
   * is the opposite of the maths convention everyone reaches for.
   */
  quadUp(ring, y, colour) {
    if (ring.length < 3) return this;
    let sa = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      sa += p[0] * q[1] - q[0] * p[1];
    }
    const r = sa > 0 ? ring.slice().reverse() : ring;
    const base = this.count;
    for (const p of r) {
      this.pos.push(p[0], y, p[1]);
      this.nrm.push(0, 1, 0);
      if (this.uv) this.uv.push(p[0], p[1]);
      if (this.col) this.pushColour(colour);
    }
    for (let i = 2; i < r.length; i++) this.idx.push(base, base + i - 1, base + i);
    return this;
  }

  /**
   * The same, but with the normal DERIVED from the winding instead of asserted.
   *
   * Use this for anything whose orientation is the product of a few sign
   * choices — a raked stand facing whichever way the track happens to be, a
   * guard rail hugging a corner. Asserting a normal that disagrees with the
   * winding is the bug that makes a surface look lit from inside: with
   * DoubleSide, three negates the supplied normal for back-facing fragments,
   * so a normal that already points the wrong way gets flipped to point the
   * wrong way again. Derive it and pair it with DoubleSide and the surface is
   * correct from both sides, whatever the signs did.
   */
  quadN(p0, p1, p2, p3, uvs, colour) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const m = Math.hypot(nx, ny, nz) || 1;
    nx /= m; ny /= m; nz /= m;
    return this.quad(p0, p1, p2, p3, [nx, ny, nz], uvs, colour);
  }

  /**
   * A vertical quad standing on the segment p->q, from y0 up to y1, with its
   * face pointing along `n`. UVs run in metres: u along the wall, v up it.
   */
  wall(p, q, y0, y1, n, colour, u0 = 0) {
    const len = Math.hypot(q[0] - p[0], q[2] - p[2]);
    const u1 = u0 + len;
    this.quad(
      [p[0], y0, p[2]], [q[0], y0, q[2]], [q[0], y1, q[2]], [p[0], y1, p[2]],
      n, [[u0, y0], [u1, y0], [u1, y1], [u0, y1]], colour);
    return u1;
  }

  /**
   * An axis-aligned-then-rotated box. `ry` turns it about Y, so a crate can sit
   * square to a pit box rather than square to the world. Every face is UV'd in
   * metres, which is why a 12 m garage and a 0.4 m toolbox show concrete and
   * steel at the same grain.
   *
   * `ry` IS `Object3D.rotation.y`, and for a sim heading h that means pass h,
   * not -h. It reads like it should be negated, because sim y maps to three
   * -z — but the negation is already inside this frame, so negating again
   * mirrors the box about the track direction. On anything square that is
   * invisible; on the 14 m start gantry beam it put the whole span at the
   * wrong angle and the banner meant to sit on its face ended up half buried
   * in it.
   */
  box(cx, cy, cz, sx, sy, sz, ry = 0, colour = 0xffffff, uvScale = 1) {
    const co = Math.cos(ry), si = Math.sin(ry);
    const R = (x, z) => [cx + x * co + z * si, cz - x * si + z * co];
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // Corners in the UP-facing winding (negative shoelace in this frame). The
    // obvious anticlockwise-in-maths order is the wrong one here and produces
    // a box whose faces all point INWARD — invisible from outside, perfect
    // from inside, which is a confusing thing to debug on a toolbox.
    const c = [R(-hx, -hz), R(-hx, hz), R(hx, hz), R(hx, -hz)];
    const y0 = cy - hy, y1 = cy + hy;
    const P = (i, y) => [c[i][0], y, c[i][1]];
    const s = uvScale;
    this.quad(P(0, y1), P(1, y1), P(2, y1), P(3, y1), [0, 1, 0],
      [[0, 0], [0, sz * s], [sx * s, sz * s], [sx * s, 0]], colour);
    // The underside is never seen on anything this builds, so it is not emitted.
    const lens = [sz, sx, sz, sx];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const dx = c[j][0] - c[i][0], dz = c[j][1] - c[i][1];
      const m = Math.hypot(dx, dz) || 1;
      const n = [-dz / m, 0, dx / m];      // outward, for this winding
      this.quad(P(i, y0), P(j, y0), P(j, y1), P(i, y1), n,
        [[0, 0], [lens[i] * s, 0], [lens[i] * s, sy * s], [0, sy * s]], colour);
    }
    return this;
  }

  /**
   * A closed vertical prism from a footprint ring, with an optional flat roof.
   *
   * The ring is normalised to the up-facing winding first. OSM does not
   * guarantee which way round a footprint is wound, and the extrusion's facing
   * follows that winding — so roughly half of every city came out with its
   * walls facing INWARD, got backface-culled, and you could see straight
   * through the building.
   */
  prism(ring0, y0, y1, colour, roof = true, uvScale = 1, roofColour = null) {
    let sa = 0;
    for (let i = 0; i < ring0.length; i++) {
      const p = ring0[i], q = ring0[(i + 1) % ring0.length];
      sa += p[0] * q[1] - q[0] * p[1];
    }
    const ring = sa > 0 ? ring0.slice().reverse() : ring0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const m = Math.hypot(dx, dz) || 1;
      const nx = -dz / m, nz = dx / m;
      const u = i === 0 ? 0 : undefined;
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]],
        [nx, 0, nz],
        [[0, y0 * uvScale], [m * uvScale, y0 * uvScale], [m * uvScale, y1 * uvScale], [0, y1 * uvScale]],
        colour);
      void u;
    }
    if (roof) this.fan(ring, y1, roofColour ?? colour, uvScale);
    return this;
  }

  /**
   * Triangulate a flat ring at height y and add it facing up. three's
   * ShapeUtils handles the concave footprints OSM is full of; a naive fan folds
   * them inside out.
   *
   * The ring is forced to the up-facing winding first (negative shoelace in
   * this frame — see quadUp) rather than the triangle indices being flipped
   * afterwards, because ShapeUtils' output orientation follows its input and
   * OSM does not guarantee which way round a footprint is wound. Flipping
   * blind gets half of every city right and half of it inside out.
   */
  fan(ring, y, colour, uvScale = 1) {
    if (ring.length < 3) return this;
    let sa = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      sa += p[0] * q[1] - q[0] * p[1];
    }
    const r = sa > 0 ? ring.slice().reverse() : ring;
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(r.map(p => new THREE.Vector2(p[0], p[1])), []);
    } catch { return this; }
    const base = this.count;
    for (const p of r) {
      this.pos.push(p[0], y, p[1]);
      this.nrm.push(0, 1, 0);
      if (this.uv) this.uv.push(p[0] * uvScale, p[1] * uvScale);
      if (this.col) this.pushColour(colour);
    }
    // Belt and braces: check each triangle's own orientation rather than
    // trusting that the triangulator preserved the contour's. A single ring
    // that comes back the other way round is a black hole in a roof, and it
    // costs three multiplies to rule out.
    for (const t of tris) {
      const a = r[t[0]], b = r[t[1]], c = r[t[2]];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (cross > 0) this.idx.push(base + t[0], base + t[2], base + t[1]);
      else this.idx.push(base + t[0], base + t[1], base + t[2]);
    }
    return this;
  }

  geometry() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (this.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      // three wants a second uv set for ambient occlusion even when it is
      // identical. Without it aoMap silently does nothing.
      g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv, 2));
    }
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }

  mesh(material, { shadow = true, receive = true } = {}) {
    const g = this.geometry();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadow; m.receiveShadow = receive;
    return m;
  }
}

// ---------------------------------------------------------------------------
// A canvas atlas for everything in this world that has WORDS on it: advertising
// hoardings, braking boards, garage name plates, the gantry banner.
//
// Text is the one thing here that cannot be a downloaded photograph, so it is
// drawn — but drawn ONCE, into a single atlas, and every sign in the circuit
// then indexes a cell of it. That keeps the whole set to one texture and one
// draw call, which is what makes it affordable to line an entire 5.8 km lap
// with hoardings instead of dotting a few around.
// ---------------------------------------------------------------------------
export class Atlas {
  constructor(cols, rows, cw, ch) {
    this.cols = cols; this.rows = rows; this.cw = cw; this.ch = ch;
    const c = document.createElement('canvas');
    c.width = cols * cw; c.height = rows * ch;
    this.canvas = c;
    this.g = c.getContext('2d');
    this.n = 0;
  }

  get capacity() { return this.cols * this.rows; }

  /**
   * Draw into the next free cell; returns its index.
   *
   * It REFUSES to overflow. A 4x8 atlas silently ran out at Monza — 20
   * sponsors plus 6 braking boards plus 7 corner names plus the banner and the
   * pit sign is 35 cells — and the two that fell off the end were the banner
   * and the PIT LANE sign. They did not disappear: their cell index divided
   * out to a row past the bottom of the canvas, so they sampled off the edge
   * of the texture and rendered as a black rectangle wrapped across the start
   * gantry. Nothing warned, and it looked like a UV bug rather than a
   * capacity one.
   */
  cell(draw) {
    if (this.n >= this.capacity) {
      console.warn(`Atlas full at ${this.capacity} cells — this sign will not be drawn`);
      return -1;
    }
    const i = this.n++;
    const x = (i % this.cols) * this.cw, y = Math.floor(i / this.cols) * this.ch;
    const g = this.g;
    g.save();
    g.translate(x, y);
    g.beginPath(); g.rect(0, 0, this.cw, this.ch); g.clip();
    draw(g, this.cw, this.ch);
    g.restore();
    return i;
  }

  /**
   * The four UV corners of cell `i`, in the same order Builder.quad takes them
   * for a wall: bottom-left, bottom-right, top-right, top-left.
   *
   * A half-texel inset on every edge. Without it the GPU samples across the
   * cell boundary at grazing angles and every hoarding picks up a sliver of its
   * neighbour's text down one edge.
   */
  uv(i, flip = false) {
    if (i == null || i < 0 || i >= this.capacity) i = 0;
    const cx = i % this.cols, cy = Math.floor(i / this.cols);
    const ex = 0.5 / this.canvas.width, ey = 0.5 / this.canvas.height;
    const u0 = cx / this.cols + ex, u1 = (cx + 1) / this.cols - ex;
    // Canvas y runs down, texture v runs up.
    const v1 = 1 - cy / this.rows - ey, v0 = 1 - (cy + 1) / this.rows + ey;
    const a = flip ? u1 : u0, b = flip ? u0 : u1;
    return [[a, v0], [b, v0], [b, v1], [a, v1]];
  }

  texture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
}

// Fit the largest font size that makes `text` fit `maxW`, then draw it centred.
export function fitText(g, text, cx, cy, maxW, maxH, { weight = '800', family = 'Inter, Helvetica, Arial, sans-serif', colour = '#fff' } = {}) {
  let size = maxH;
  for (; size > 6; size -= 2) {
    g.font = `${weight} ${size}px ${family}`;
    if (g.measureText(text).width <= maxW) break;
  }
  g.fillStyle = colour;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cx, cy);
  return size;
}
