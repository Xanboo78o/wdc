// aerolib.mjs — mesh in, aerodynamic coefficients out.
//
// Shared by the bake tool and its gate, so the two can never drift apart and
// start describing two different cars.
//
// WHAT THIS IS, said plainly: a panel method with a ground-effect term. Not
// CFD. It takes a closed surface, points a freestream at it, and integrates a
// pressure coefficient over every triangle. That is enough to get the SHAPE of
// the aero right — how the numbers move with pitch, yaw, ride height and
// damage — which is the part no constant can ever capture.
//
// The MAGNITUDES are then calibrated against the numbers DIRTY AIR already
// validated against real F1 data (ClA 4.62, CdA 1.28). That is deliberate and
// it is the only honest option: a panel method cannot produce a modern F1
// car's downforce from first principles, because most of that downforce comes
// from circulation around cambered wings and from a venturi under the floor,
// neither of which is impact pressure. Pretending otherwise would give a car
// with a third of the grip and would throw away every validated lap time.
//
// So: geometry decides how aero CHANGES, measurement decides how big it is.

// ---------------------------------------------------------------------------
// Mesh I/O. STL and OBJ, because those are what a 3D printing site hands you.
// ---------------------------------------------------------------------------
export function readSTL(buf) {
  // ASCII or binary? A binary STL's header is 80 bytes and the triangle count
  // that follows has to match the file length exactly. Sniffing for the word
  // "solid" is NOT enough — plenty of binary exporters write it into the
  // header, which is the classic way an STL reader gets this wrong.
  const tris = [];
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50;
        const v = [];
        for (let k = 0; k < 3; k++) {
          const p = o + 12 + k * 12;
          v.push([buf.readFloatLE(p), buf.readFloatLE(p + 4), buf.readFloatLE(p + 8)]);
        }
        tris.push(v);
      }
      return tris;
    }
  }
  const txt = buf.toString('utf8');
  const nums = [];
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
  let m;
  while ((m = re.exec(txt))) nums.push([+m[1], +m[2], +m[3]]);
  for (let i = 0; i + 2 < nums.length; i += 3) tris.push([nums[i], nums[i + 1], nums[i + 2]]);
  return tris;
}

export function readOBJ(txt) {
  const v = [], tris = [];
  for (const line of txt.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] === 'v') v.push([+p[1], +p[2], +p[3]]);
    else if (p[0] === 'f') {
      const idx = p.slice(1).map(s => {
        const i = parseInt(s.split('/')[0], 10);
        return i < 0 ? v.length + i : i - 1;
      });
      // fan-triangulate, so quads and n-gons both work
      for (let i = 1; i + 1 < idx.length; i++) tris.push([v[idx[0]], v[idx[i]], v[idx[i + 1]]]);
    }
  }
  return tris;
}

export function writeOBJ(tris) {
  const out = [], key = new Map();
  let n = 0;
  const id = p => {
    const k = p.map(x => x.toFixed(5)).join(',');
    if (!key.has(k)) { key.set(k, ++n); out.push(`v ${p[0].toFixed(5)} ${p[1].toFixed(5)} ${p[2].toFixed(5)}`); }
    return key.get(k);
  };
  const faces = tris.map(t => `f ${id(t[0])} ${id(t[1])} ${id(t[2])}`);
  return out.concat(faces).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Panels. Area, outward normal, centroid — computed once, reused for every
// direction in the sweep.
// ---------------------------------------------------------------------------
export function panels(tris, group = '') {
  const out = [];
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * w[2] - u[2] * w[1];
    const ny = u[2] * w[0] - u[0] * w[2];
    const nz = u[0] * w[1] - u[1] * w[0];
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;                    // degenerate, skip
    out.push({
      A: len * 0.5, g: group,
      n: [nx / len, ny / len, nz / len],
      c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    });
  }
  return out;
}

export function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) {
    if (p[k] < lo[k]) lo[k] = p[k];
    if (p[k] > hi[k]) hi[k] = p[k];
  }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

// Frontal area by rasterising the silhouette, NOT by summing projected panel
// areas. Summing double-counts every surface hidden behind another one — on a
// closed body it reports exactly twice the true area, and on an open-wheel car
// with four wheels behind bodywork it is worse than that.
export function frontalArea(P, dir, grid = 256) {
  // build an orthonormal basis with `dir` as the view axis
  const up = Math.abs(dir[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const ex = norm(cross(up, dir)), ey = cross(dir, ex);
  let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
  const uv = P.map(p => {
    const u = dot(p.c, ex), v = dot(p.c, ey);
    if (u < lo[0]) lo[0] = u; if (u > hi[0]) hi[0] = u;
    if (v < lo[1]) lo[1] = v; if (v > hi[1]) hi[1] = v;
    return [u, v];
  });
  const w = hi[0] - lo[0], h = hi[1] - lo[1];
  if (!(w > 0 && h > 0)) return 0;
  const cell = new Uint8Array(grid * grid);
  // Stamp each panel's centroid with a disc the size of the panel. Cheap, and
  // accurate to a few percent on a mesh with many small triangles, which is
  // what a printable model always is.
  for (let i = 0; i < P.length; i++) {
    const r = Math.sqrt(P[i].A / Math.PI);
    const cu = (uv[i][0] - lo[0]) / w * (grid - 1);
    const cv = (uv[i][1] - lo[1]) / h * (grid - 1);
    const ru = Math.max(0.5, r / w * grid), rv = Math.max(0.5, r / h * grid);
    for (let dv = -Math.ceil(rv); dv <= Math.ceil(rv); dv++) {
      for (let du = -Math.ceil(ru); du <= Math.ceil(ru); du++) {
        if ((du / ru) ** 2 + (dv / rv) ** 2 > 1) continue;
        const x = Math.round(cu + du), y = Math.round(cv + dv);
        if (x >= 0 && x < grid && y >= 0 && y < grid) cell[y * grid + x] = 1;
      }
    }
  }
  let hit = 0;
  for (let i = 0; i < cell.length; i++) hit += cell[i];
  return hit / (grid * grid) * w * h;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const m = Math.hypot(...a) || 1; return [a[0] / m, a[1] / m, a[2] / m]; };
export { dot, cross, norm };

// Convenience for the Node tools: read a baked map and register it, so a
// harness turns the real aerodynamics on with one line.
export async function useAero(keys = ['f1', 'f4']) {
  const fs = await import('fs');
  const { makeAero, selfTest } = await import('../js/aero.js');
  const { registerAero, CARS } = await import('../js/physics.js');
  // Run the self test wherever the aero is turned on, so a broken constant is
  // reported at the point of use rather than waiting for someone to run a gate.
  selfTest(CARS);
  const on = [];
  for (const k of keys) {
    const p = new URL(`../data/aero/${k}.json`, import.meta.url);
    if (!fs.existsSync(p)) continue;
    registerAero(k, makeAero(JSON.parse(fs.readFileSync(p, 'utf8'))));
    on.push(k);
  }
  return on;
}
