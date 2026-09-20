// ground.js — the land, made FROM the road.
//
// Terrain clips through a road when the two are made separately and then
// placed on top of each other: a heightmap from somewhere, a ribbon from
// somewhere else, and nothing stopping one poking through the other between
// two vertices. So here the road comes first and the ground is not allowed to
// disagree with it. Every road segment near a point puts two limits on the
// ground there:
//
//   under the road       ground = road surface - EPS         (exactly)
//   out to the verge     ground = road edge height - EPS     (a level shoulder)
//   beyond the verge     ground within CUT / FILL slopes of the edge
//
// and the natural lie of the land is clamped between them:
//
//   H = min( every upper limit,  max( every lower limit,  natural ground ) )
//
// Upper limits win a tie. That is the rule that makes clipping impossible: if
// two roads disagree about what is under a point (a hairpin climbing a hill,
// a bridge), the ground drops to the LOWER one and the higher road stands on a
// wall — it never ends up underground.
//
// A TUNNEL is one deliberate exception, and it is the same rule upside
// down: through a tunnel the road is INSIDE the hill, so those samples set no
// upper limit at all and instead demand ROCK metres of land above the road.
// The bore is cut by the tunnel mesh in dressing.js, not by the terrain.
//
// A BRIDGE is the other, and it is the tunnel's mirror image: the road is
// carried OVER the land, so those samples set no lower limit — they hold
// nothing up — and instead demand CLEAR metres of daylight beneath the deck.
// Without it the rule above does exactly what it promises: where the road
// crosses itself the ground drops to the lower road and the upper one "stands
// on a wall", and that wall is a cliff face across the road underneath.
//
// The level verge is not decoration. The ground is drawn as triangles, and a
// triangle straddling the road edge interpolates between its corners; if the
// land started climbing right at the edge, that interpolation would lift it
// over the tarmac. A shoulder at least one cell-diagonal wide means every
// triangle touching the road has all three corners at road height.
// tools/buildcheck.mjs proves that, triangle by triangle, as drawn.
//
// Pure: no renderer. The page and the gate run this same file.
import { surfaceY } from './path.js';

export const GROUND = {
  EPS: 0.12,        // m the ground sits under the road surface. Enough that a
                    // terrain triangle cutting the corner of a tight banked
                    // climb (the double loop, R38) still passes underneath.
  VERGE: 5,         // m of level shoulder beyond the barrier
  CUT: 0.6,         // steepest rise away from the road (rise / run)
  FILL: 0.5,        // steepest fall away from it
  QUERY: 130,       // m around a point within which roads constrain it
  ROCK: 7,          // m of hill the land must keep ABOVE a tunnel's road
  PORTAL: 16,       // m over which that rock thickens from nothing at the mouth
  CLEAR: 6,         // m of daylight the land must keep BELOW a bridge's deck
  ABUT: 20,         // m over which the ground lets go of the deck, at each end
  TILE: 48,         // m, one terrain tile
  NEAR: 3, MID: 12, FAR: 24, HORIZON: 48,   // cell sizes by distance from the road
  MARGIN: 4000,     // m of land beyond the track's bounding box (the fog eats the edge)
};

const HASH = 32;

// --- a little value noise, for the lie of the land away from the road -------
// Procedural DECORATION only: it shapes the hills in the distance and never
// decides where the road goes.
function hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
function fbm(x, y) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 5; o++) { v += amp * (vnoise(x * f, y * f) * 2 - 1); f *= 2.03; amp *= 0.5; }
  return v;
}
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Ground {
  constructor(path, opts = {}) {
    this.path = path;
    this.o = { ...GROUND, ...opts };
    this._segments();
    this._natural();
  }

  // ---- road segments, bucketed so a point only looks at roads near it -------
  _segments() {
    const p = this.path, n = p.n;
    const m = p.closed ? n : n - 1;
    this.seg = [];
    this.buckets = new Map();
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      const dx = p.x[j] - p.x[i], dy = p.y[j] - p.y[i], len = Math.hypot(dx, dy);
      const sg = {
        i, j, ax: p.x[i], ay: p.y[i], ux: dx / len, uy: dy / len, len,
        first: !p.closed && i === 0, last: !p.closed && i === m - 1,
        kMax: Math.max(Math.abs(p.k[i]), Math.abs(p.k[j])),
      };
      const id = this.seg.length;
      this.seg.push(sg);
      const pad = 0;
      const x0 = Math.floor((Math.min(p.x[i], p.x[j]) - pad) / HASH), x1 = Math.floor((Math.max(p.x[i], p.x[j]) + pad) / HASH);
      const y0 = Math.floor((Math.min(p.y[i], p.y[j]) - pad) / HASH), y1 = Math.floor((Math.max(p.y[i], p.y[j]) + pad) / HASH);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const key = cx * 100003 + cy;
        let b = this.buckets.get(key);
        if (!b) this.buckets.set(key, b = []);
        b.push(id);
      }
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      x0 = Math.min(x0, p.x[i]); x1 = Math.max(x1, p.x[i]);
      y0 = Math.min(y0, p.y[i]); y1 = Math.max(y1, p.y[i]);
    }
    const M = this.o.MARGIN;
    this.bounds = { x0: x0 - M, y0: y0 - M, x1: x1 + M, y1: y1 + M };
  }

  // ---- the natural ground: the road's heights, blurred wide, plus hills -----
  // A coarse grid holding (a) the road height averaged over ~150 m, so the land
  // rises under a road that climbs and falls away under one that descends, and
  // (b) the distance to the nearest road, so the hills can grow away from it.
  _natural() {
    const p = this.path, b = this.bounds, C = 40;
    const nx = Math.ceil((b.x1 - b.x0) / C) + 1, ny = Math.ceil((b.y1 - b.y0) / C) + 1;
    const num = new Float64Array(nx * ny), den = new Float64Array(nx * ny);
    const dist = new Float64Array(nx * ny).fill(1e9);
    let zs = 0;
    for (let i = 0; i < p.n; i++) zs += p.z[i];
    this.zMean = zs / p.n;
    for (let i = 0; i < p.n; i += 2) {
      const gx = (p.x[i] - b.x0) / C, gy = (p.y[i] - b.y0) / C;
      const ix = Math.round(gx), iy = Math.round(gy);
      num[iy * nx + ix] += p.z[i]; den[iy * nx + ix] += 1;
      // seed the distance field with exact distances around the road
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
        const qx = ix + ox, qy = iy + oy;
        if (qx < 0 || qy < 0 || qx >= nx || qy >= ny) continue;
        const d = Math.hypot(b.x0 + qx * C - p.x[i], b.y0 + qy * C - p.y[i]);
        if (d < dist[qy * nx + qx]) dist[qy * nx + qx] = d;
      }
    }
    // separable gaussian, sigma 150 m
    const sig = 150 / C, R = Math.ceil(3 * sig), kw = [];
    for (let j = -R; j <= R; j++) kw.push(Math.exp(-0.5 * (j / sig) ** 2));
    const blur = (src) => {
      const tmp = new Float64Array(nx * ny), out = new Float64Array(nx * ny);
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        let a = 0;
        for (let j = -R; j <= R; j++) { const q = x + j; if (q >= 0 && q < nx) a += src[y * nx + q] * kw[j + R]; }
        tmp[y * nx + x] = a;
      }
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        let a = 0;
        for (let j = -R; j <= R; j++) { const q = y + j; if (q >= 0 && q < ny) a += tmp[q * nx + x] * kw[j + R]; }
        out[y * nx + x] = a;
      }
      return out;
    };
    const bn = blur(num), bd = blur(den);
    const zb = new Float64Array(nx * ny);
    // far from any road the land settles to the track's average height
    for (let k = 0; k < nx * ny; k++) zb[k] = (bn[k] + 0.02 * this.zMean) / (bd[k] + 0.02);
    // chamfer distance transform, two passes
    const D1 = C, D2 = C * Math.SQRT2;
    const at = (x, y) => dist[y * nx + x];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      let d = at(x, y);
      if (x > 0) d = Math.min(d, at(x - 1, y) + D1);
      if (y > 0) d = Math.min(d, at(x, y - 1) + D1);
      if (x > 0 && y > 0) d = Math.min(d, at(x - 1, y - 1) + D2);
      if (x < nx - 1 && y > 0) d = Math.min(d, at(x + 1, y - 1) + D2);
      dist[y * nx + x] = d;
    }
    for (let y = ny - 1; y >= 0; y--) for (let x = nx - 1; x >= 0; x--) {
      let d = at(x, y);
      if (x < nx - 1) d = Math.min(d, at(x + 1, y) + D1);
      if (y < ny - 1) d = Math.min(d, at(x, y + 1) + D1);
      if (x < nx - 1 && y < ny - 1) d = Math.min(d, at(x + 1, y + 1) + D2);
      if (x > 0 && y < ny - 1) d = Math.min(d, at(x - 1, y + 1) + D2);
      dist[y * nx + x] = d;
    }
    this.nat = { C, nx, ny, zb, dist };
  }

  _bilin(arr, x, y) {
    const { C, nx, ny } = this.nat, b = this.bounds;
    const gx = Math.max(0, Math.min(nx - 1.001, (x - b.x0) / C));
    const gy = Math.max(0, Math.min(ny - 1.001, (y - b.y0) / C));
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const k = iy * nx + ix;
    return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fy) + (arr[k + nx] * (1 - fx) + arr[k + nx + 1] * fx) * fy;
  }

  roadDist(x, y) { return this._bilin(this.nat.dist, x, y); }

  /**
   * EXACT distance to the nearest road centreline, and how much room is left
   * over after that road's own width and run-off — metres, negative meaning
   * the point is inside the corridor.
   *
   * roadDist() above is a 40 m chamfer grid and overestimates by up to 8%,
   * which is fine for deciding how tall a hill is and not fine for deciding
   * whether something may stand somewhere. Where the road folds back on itself
   * — the hairpins, the snail, the loop — a point 21 m from one sample is on
   * the tarmac of another, and the grid says there is room. That put six trees
   * on the racing surface at s=1902-1984.
   */
  nearestRoad(x, y, max = 90) {
    const p = this.path;
    let bd = max * max, bi = -1;
    const R = Math.ceil(max / HASH) + 1;
    const cx = Math.floor(x / HASH), cy = Math.floor(y / HASH);
    for (let gx = cx - R; gx <= cx + R; gx++) for (let gy = cy - R; gy <= cy + R; gy++) {
      const bk = this.buckets.get(gx * 100003 + gy);
      if (!bk) continue;
      for (const id of bk) {
        const sg = this.seg[id];
        const rx = x - sg.ax, ry = y - sg.ay;
        const t = Math.max(0, Math.min(sg.len, rx * sg.ux + ry * sg.uy));
        const dx = rx - sg.ux * t, dy = ry - sg.uy * t;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; bi = t < sg.len * 0.5 ? sg.i : sg.j; }
      }
    }
    if (bi < 0) return null;
    return { d: Math.sqrt(bd), i: bi };
  }

  /** Metres of clear ground between a point and the nearest road's barrier. */
  roadSlack(x, y) {
    const n = this.nearestRoad(x, y);
    if (!n) return Infinity;
    const p = this.path;
    return n.d - (p.w[n.i] + Math.max(p.runL[n.i], p.runR[n.i]));
  }

  // The height a camera must stay above. Normally the land — but inside a
  // tunnel the "land" is the rock ABOVE the road, so a camera clamped to it
  // gets shoved out through the hilltop (which is exactly what happened).
  // There, the floor is the road.
  cameraFloor(x, y) {
    const p = this.path;
    if (p.tunIn) {
      const cx = Math.floor(x / HASH), cy = Math.floor(y / HASH);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const bk = this.buckets.get((cx + ox) * 100003 + cy + oy);
        if (!bk) continue;
        for (const id of bk) {
          const sg = this.seg[id];
          if (!p.tunIn[sg.i] && !p.tunIn[sg.j]) continue;
          const rx = x - sg.ax, ry = y - sg.ay;
          const t = Math.max(0, Math.min(1, (rx * sg.ux + ry * sg.uy) / sg.len));
          const lat = -rx * sg.uy + ry * sg.ux;
          if (Math.abs(lat) > p.w[sg.i] + 14) continue;
          return p.z[sg.i] + (p.z[sg.j] - p.z[sg.i]) * t - 0.2;
        }
      }
    }
    return this.height(x, y);
  }

  // `wz` / `ws` are the road's own heights near this point, weighted by how
  // close each bit of road is (height() gathers them). Near the road they
  // outweigh the wide blur completely, so the land runs downhill WITH a road
  // that runs downhill, instead of leaving it in a trench; a hundred metres
  // out they have faded to nothing and the wide lie of the land takes over.
  natural(x, y, wz = 0, ws = 0) {
    const d = this.roadDist(x, y);
    const amp = 1.5 + 55 * smoothstep(120, 2200, d);
    return (wz + this._bilin(this.nat.zb, x, y)) / (ws + 1) + amp * fbm(x / 900 + 17.3, y / 900 - 4.1);
  }

  // ---- the height of the ground at (x, y), sim frame -------------------------
  height(x, y) {
    const o = this.o, p = this.path, Q = o.QUERY;
    // Nowhere near a road: nothing constrains the land. The distance grid is
    // coarse (40 m) and a chamfer overestimates by up to 8%, hence the slack.
    if (this.roadDist(x, y) > Q * 1.1 + 60) return this.natural(x, y);
    let U = Infinity, L = -Infinity, wz = 0, ws = 0;
    const NS = 30;                                      // m, how far the road's height carries
    const cx0 = Math.floor((x - Q) / HASH), cx1 = Math.floor((x + Q) / HASH);
    const cy0 = Math.floor((y - Q) / HASH), cy1 = Math.floor((y + Q) / HASH);
    const seen = this._seen || (this._seen = new Uint32Array(this.seg.length));
    const stamp = this._stamp = ((this._stamp || 0) + 1) >>> 0;
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const bk = this.buckets.get(cx * 100003 + cy);
      if (!bk) continue;
      for (const id of bk) {
        if (seen[id] === stamp) continue;
        seen[id] = stamp;
        const sg = this.seg[id];
        const rx = x - sg.ax, ry = y - sg.ay;
        const along = rx * sg.ux + ry * sg.uy;
        const lat = -rx * sg.uy + ry * sg.ux;           // + = left of travel
        if (Math.abs(lat) > Q) continue;
        let t = along / sg.len;
        const lo = sg.first ? -Infinity : 0, hi = sg.last ? Infinity : 1;
        const tc = Math.max(lo, Math.min(hi, t));
        const f = Math.max(0, Math.min(1, t));          // cross-section blend
        const i = sg.i, j = sg.j;
        const w = p.w[i] + (p.w[j] - p.w[i]) * f;
        const side = lat >= 0 ? 1 : -1;
        const run = side > 0 ? p.runL[i] + (p.runL[j] - p.runL[i]) * f : p.runR[i] + (p.runR[j] - p.runR[i]) * f;
        const F = w + run + o.VERGE;
        // Neighbouring segments' slabs must overlap on the OUTSIDE of a bend,
        // where they fan apart; this tolerance is that fan at the verge's edge.
        // 0 outside a tunnel, 1 once properly inside it
        const depth = p.tunIn ? Math.min(p.tunIn[i], p.tunIn[j]) : 0;
        const tunnel = depth > 0 ? smoothstep(0, o.PORTAL, depth) : 0;
        // 0 off a bridge, 1 once properly out onto it
        const bDepth = p.briIn ? Math.min(p.briIn[i], p.briIn[j]) : 0;
        const bridge = bDepth > 0 ? smoothstep(0, o.ABUT, bDepth) : 0;
        const tol = 0.5 * sg.len * (1 + F * sg.kMax) + 0.25;
        const over = Math.abs(t - tc) * sg.len;
        // centreline height along this segment; within the slab it is carried
        // on at the segment's own grade, past an open end it stays level
        const tz = over <= tol ? Math.max(-tol / sg.len, Math.min(1 + tol / sg.len, t)) : Math.max(0, Math.min(1, t));
        const tzc = Math.max(0, Math.min(1, tz));
        // the road's height, pulled into the land around it
        // A bridge does not drag the land up with it: the deck's height is
        // not this ground's height, it is 20 m of fresh air above it.
        const dReal = Math.hypot((t - f) * sg.len, lat);
        if (dReal < 4 * NS && bridge < 1) {
          const wt = Math.exp(-0.5 * (dReal / NS) ** 2) * (1 - bridge);
          ws += wt; wz += wt * (p.z[i] + (p.z[j] - p.z[i]) * f);
        }
        const sA = surfaceY(p, i, side * w), sB = surfaceY(p, j, side * w);
        const edge = p.z[i] + (p.z[j] - p.z[i]) * tz + ((sA - p.z[i]) * (1 - tzc) + (sB - p.z[j]) * tzc);
        let u, l;
        if (tunnel > 0) {
          // Inside the hill: nothing above the road is forbidden, and the land
          // over it has to BE a hill — thickening from nothing at the portal,
          // so the mouth is a slope the tunnel mesh runs into rather than a
          // cliff whose triangles cut across the road outside.
          const d = Math.hypot(Math.max(0, over - tol), Math.max(0, Math.abs(lat) - F));
          l = edge + o.ROCK * tunnel - o.CUT * d;
          if (l > L) L = l;
          continue;
        }
        if (over <= tol) {
          const al = Math.abs(lat);
          if (al <= w) {
            const cA = surfaceY(p, i, lat) - p.z[i], cB = surfaceY(p, j, lat) - p.z[j];
            const surf = p.z[i] + (p.z[j] - p.z[i]) * tz + cA * (1 - tzc) + cB * tzc;
            u = l = surf - o.EPS;
          } else if (al <= F) {
            u = l = edge - o.EPS;
          } else {
            const d = al - F;
            u = edge - o.EPS + o.CUT * d; l = edge - o.EPS - o.FILL * d;
          }
        } else {
          const d = Math.hypot(over - tol, Math.max(0, Math.abs(lat) - F));
          u = edge - o.EPS + o.CUT * d; l = edge - o.EPS - o.FILL * d;
        }
        // Open the daylight, and let go. Lowering the UPPER limit by CLEAR is
        // what keeps the land off the soffit; dropping the LOWER limit out of
        // sight is what stops this road demanding to be held up, so the ground
        // beneath is free to fall to whatever is genuinely there — the road
        // being crossed, or the valley floor. Tapered over ABUT, so the
        // abutment is a slope at the ends instead of a wall in the middle.
        if (bridge > 0) { u -= bridge * o.CLEAR; l -= bridge * 1e4; }
        if (u < U) U = u;
        if (l > L) L = l;
      }
    }
    const G = this.natural(x, y, wz, ws);
    // L still applies with no upper limit in sight: deep inside a tunnel every
    // segment in range is a tunnel one, and returning G there threw the rock
    // away and left the road in an open trench (caught by buildcheck).
    if (U === Infinity) return Math.max(L, G);
    return Math.min(U, Math.max(L, G));
  }

  // ---- terrain meshes -------------------------------------------------------
  // Tiles of TILE metres, fine near the road and coarse far from it, merged
  // into chunks of 8x8 tiles so the renderer can cull them. Skirts hang down
  // wherever two tiles of different detail meet, to hide the crack between
  // them. Returns plain arrays; positions are in the SIM frame (x, y, height).
  chunks() {
    const o = this.o, b = this.bounds, T = o.TILE;
    const tx0 = Math.floor(b.x0 / T), ty0 = Math.floor(b.y0 / T);
    const ntx = Math.ceil(b.x1 / T) - tx0, nty = Math.ceil(b.y1 / T) - ty0;
    const lod = new Uint8Array(ntx * nty);
    const half = T * Math.SQRT1_2;
    for (let ty = 0; ty < nty; ty++) for (let tx = 0; tx < ntx; tx++) {
      const cx = (tx0 + tx + 0.5) * T, cy = (ty0 + ty + 0.5) * T;
      const d = this.roadDist(cx, cy) - half - 40;   // 40 m: the distance grid's own slack
      lod[ty * ntx + tx] = d < 70 ? 0 : d < 520 ? 1 : d < 1400 ? 2 : 3;
    }
    const cellOf = [o.NEAR, o.MID, o.FAR, o.HORIZON], skirt = [4, 10, 24, 40];
    const CH = 16, out = [];
    for (let cy = 0; cy < nty; cy += CH) for (let cx = 0; cx < ntx; cx += CH) {
      const pos = [], nor = [], col = [], uv = [], idx = [];
      for (let ty = cy; ty < Math.min(nty, cy + CH); ty++) for (let tx = cx; tx < Math.min(ntx, cx + CH); tx++) {
        const L = lod[ty * ntx + tx];
        const nb = (dx, dy) => {
          const qx = tx + dx, qy = ty + dy;
          return qx < 0 || qy < 0 || qx >= ntx || qy >= nty ? L : lod[qy * ntx + qx];
        };
        this._tile((tx0 + tx) * T, (ty0 + ty) * T, T, cellOf[L], skirt[L],
          [nb(0, -1) !== L, nb(1, 0) !== L, nb(0, 1) !== L, nb(-1, 0) !== L],
          pos, nor, col, uv, idx);
      }
      out.push({
        position: Float32Array.from(pos), normal: Float32Array.from(nor),
        color: Float32Array.from(col),
        // UVs in METRES, the same law the rest of the game uses: a material
        // says how big its photo is and sets repeat = 1 / size.
        uv: Float32Array.from(uv),
        index: pos.length / 3 > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx),
      });
    }
    return out;
  }

  _tile(x0, y0, T, cell, skirtDepth, skirts, pos, nor, col, uv, idx) {
    const n = Math.round(T / cell), m = n + 3;       // one ring of padding for normals
    const h = new Float64Array(m * m);
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++)
      h[j * m + i] = this.height(x0 + (i - 1) * cell, y0 + (j - 1) * cell);
    const base = pos.length / 3;
    const vid = (i, j) => base + j * (n + 1) + i;
    const normals = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const hc = h[(j + 1) * m + (i + 1)];
      const ddx = (h[(j + 1) * m + i + 2] - h[(j + 1) * m + i]) / (2 * cell);
      const ddy = (h[(j + 2) * m + i + 1] - h[j * m + i + 1]) / (2 * cell);
      const nl = Math.hypot(ddx, ddy, 1);
      const nx = -ddx / nl, ny = -ddy / nl, nz = 1 / nl;
      pos.push(x0 + i * cell, y0 + j * cell, hc);
      uv.push(x0 + i * cell, y0 + j * cell);
      nor.push(nx, ny, nz);
      normals.push(nx, ny, nz);
      const c = this._colour(x0 + i * cell, y0 + j * cell, nz);
      col.push(c[0], c[1], c[2]);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
      idx.push(a, b, c, a, c, d);                     // anticlockwise seen from above (sim frame)
    }
    // skirts: S, E, N, W edges, walked anticlockwise so they face outward
    const edges = [
      [...Array(n + 1).keys()].map(i => [i, 0]),
      [...Array(n + 1).keys()].map(j => [n, j]),
      [...Array(n + 1).keys()].map(i => [n - i, n]),
      [...Array(n + 1).keys()].map(j => [0, n - j]),
    ];
    edges.forEach((e, k) => {
      if (!skirts[k]) return;
      const top = [], bot = [];
      for (const [i, j] of e) {
        const v = vid(i, j);
        top.push(v);
        bot.push(pos.length / 3);
        pos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2] - skirtDepth);
        uv.push(uv[v * 2], uv[v * 2 + 1] - skirtDepth);
        nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        col.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
      }
      for (let q = 0; q < top.length - 1; q++) idx.push(top[q], bot[q], bot[q + 1], top[q], bot[q + 1], top[q + 1]);
    });
  }

  // Untextured on purpose. Colour says what the land is doing: level ground is
  // grass, a cut face is earth, anything steeper than a scree slope is rock.
  _colour(x, y, nz) {
    const grass = [0.27, 0.40, 0.15], dry = [0.44, 0.44, 0.22], earth = [0.46, 0.36, 0.25], rock = [0.46, 0.45, 0.43];
    const v = fbm(x / 140 + 3.7, y / 140 + 9.1) * 0.5 + 0.5;          // patches of drier grass
    const g = grass.map((c, k) => c + (dry[k] - c) * smoothstep(0.35, 0.8, v) * 0.6);
    const e = smoothstep(0.93, 0.8, nz), r = smoothstep(0.8, 0.66, nz);
    return g.map((c, k) => {
      const a = c + (earth[k] - c) * e;
      return a + (rock[k] - a) * r;
    });
  }
}
