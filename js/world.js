// world.js — how high the ground is, everywhere.
//
// Every circuit has been flat since day one, because OpenStreetMap ways carry
// no elevation. `tools/getelev.mjs` fixes the data half of that with NASA SRTM
// at 30 m; this is the half that turns it into geometry.
//
// Adam: *"add height, banking, and material tags to the track"*.
//
// ---------------------------------------------------------------------------
// ONE HEIGHT FIELD, AND ONE WAY OF APPLYING IT
//
// The obvious approach is to thread an elevation through every builder and add
// it to every y in the project. There are about forty of those and missing one
// leaves a barrier floating over a hill, so instead there is exactly one
// function — `lift` — which takes a FINISHED BufferGeometry and displaces
// every vertex by the ground height under it.
//
// That works for everything because of a property of how this world is built:
// a vertical surface has its top and bottom vertices at the same (x, z), so
// both move by the same amount and the wall stays vertical with its foot on
// the ground. A horizontal surface follows the terrain. A guard rail post, a
// hoarding, a gantry leg and the racing surface itself all do the right thing
// from the same three lines.
//
// The field blends two sources, because they answer different questions. Near
// the circuit it is the surveyed profile ALONG the racing line, which is the
// only thing fine enough to carry a car over a crest. Far away it is the 32x32
// grid, which is the only thing that knows where the hillside is. In between
// it crossfades, so the track never sits in a trench or on a plinth.
//
// This is RENDERING ONLY. js/physics.js is two-dimensional and has no gravity
// component along a slope. If the picture and the simulation disagree about a
// downhill braking zone, the picture is the one that is lying.
// ---------------------------------------------------------------------------
import { Z } from './geom.js';
import { bankTable, bankGround } from './bank.js';

const NEAR = 55;       // inside this, the racing line's own profile wins
const FAR = 240;       // beyond this, the terrain grid wins
const CELL = 45;       // metres per bucket in the lookup grid (measured: 45 is the quickest of 30/45/60/90)
const SINK_MAX = 0.35; // how far the visible ground is pushed under the circuit
const BLEND = 20;      // metres either side of the line between two legs that are blended

export async function loadElev(key) {
  try {
    const r = await fetch(`./data/elev/${key}.json`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export class World {
  /**
   * `elev` may be null — a fresh clone that has not run tools/getelev.mjs gets
   * a flat world and everything still boots.
   */
  constructor(track, elev) {
    this.track = track;
    this.elev = elev || null;
    this.on = !!elev;

    // How far out the ground is pushed down under the circuit. This is a
    // property of the TRACK, not of the survey, so it is measured even on a
    // flat world: the grass is sunk either way, and everything standing on it
    // has to agree. The taper has to finish OUTSIDE the widest run-off here,
    // or the ground is still sinking where it becomes the visible surface and
    // the run-off edge sits on a lip. Monza's corridor is ~22 m a side and
    // Monaco's is a few metres, so measure it rather than pick one.
    let corridor = 0;
    for (let i = 0; i < track.n; i++) {
      const c = track.w[i] + Math.max(track.runL[i], track.runR[i]);
      if (c > corridor) corridor = c;
    }
    this.sinkTo = corridor + 14;
    // Banked corners stand on an embankment, and the ground has to know.
    this.bank = track.bank && track.bank.some(v => v) ? bankTable(track) : null;

    // A bucket grid over the centreline, so finding the nearest sample is O(1)
    // rather than a scan. `lift` runs over a few hundred thousand vertices at
    // load; at 700 samples a piece that would be a quarter of a second of
    // nothing. Built even without elevation, because `groundY` needs it.
    const bb = track.bbox;
    this.gx0 = bb.x0 - 400; this.gz0 = Z(bb.y1) - 400;
    this.gnx = Math.ceil((bb.x1 - bb.x0 + 800) / CELL) + 1;
    this.gnz = Math.ceil((bb.y1 - bb.y0 + 800) / CELL) + 1;
    this.buckets = Array.from({ length: this.gnx * this.gnz }, () => []);
    for (let i = 0; i < track.n; i++) {
      const cx = Math.floor((track.x[i] - this.gx0) / CELL);
      const cz = Math.floor((Z(track.y[i]) - this.gz0) / CELL);
      if (cx < 0 || cz < 0 || cx >= this.gnx || cz >= this.gnz) continue;
      this.buckets[cz * this.gnx + cx].push(i);
    }
    // The same buckets holding every 4th sample (8 m): the first, cheap pass
    // of `nearest`, and all `_blendNear` needs once its reach is wide.
    this.buckets4 = this.buckets.map(b => b.filter(k => k % 4 === 0));
    this.buckets8 = this.buckets.map(b => b.filter(k => k % 8 === 0));
    if (!this.on) return;
    // What the land does BEYOND the surveyed box. The DEM only covers the
    // world box; sampling it outside clamps to whatever the boundary happened
    // to be, which at Monaco built a twenty-kilometre flat mesa at the height
    // of the hillside and floated the whole city on it. Past the box the
    // ground falls away to the lowest thing the survey saw — the sea, on the
    // three circuits that have one, and a harmless dip inland.
    this.seaY = Math.min(...elev.grid.h);
    this.gridLo = this.seaY; this.gridHi = Math.max(...elev.grid.h);
    this.plane = elev.outside === 'plane' && elev.plane ? elev.plane : null;
  }

  /** Nearest centreline sample to a point, and how far away it is. */
  nearest(x, z) {
    // Two passes. Every 4th sample first (8 m apart), which finds the right
    // stretch of the lap at a quarter of the cost; then every sample within
    // four of any coarse candidate that came within one spacing of the best.
    // The nearest sample overall is always within 4 of some coarse sample,
    // and that coarse sample is at most 8 m further than it — so it is found.
    return this._nearestIn(this.buckets, x, z, 0);
  }

  /**
   * `nearest`, but only as far as it matters to the ground: past FAR the
   * height is the terrain grid alone and the sink is zero, so a point that
   * far out only needs to be told so — {i: -1, d: Infinity} — instead of
   * searching a kilometre of buckets for an answer nobody reads. That search
   * was most of the cost of building the skirt.
   */
  near(x, z) {
    return this._nearestIn(this.buckets, x, z, 0, Math.ceil((FAR + 30) / CELL) + 1);
  }

  /**
   * Nearest sample among `buckets`, and (when `slack` > 0) every sample that
   * came within `slack` metres of it — the candidates for a finer pass.
   */
  _nearestIn(buckets, x, z, slack, maxRing = 12) {
    let best = -1, bd = Infinity;
    const cand = slack > 0 ? [] : null, cd = slack > 0 ? [] : null;
    const cx = Math.floor((x - this.gx0) / CELL), cz = Math.floor((z - this.gz0) / CELL);
    // Widen the search ring by ring — a point far out in the countryside may
    // have no track within several buckets — and stop only when no bucket
    // further out COULD hold anything nearer. (It used to stop at the first
    // ring with anything in it. A sample in the next ring out can be closer
    // than one in the corner of this one, so the "nearest" leg flipped early
    // and the ground stepped by up to 0.9 m along a line 100 m from Monza's
    // main straight, which groundcheck read as a 0.5 m chord error.)
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let j = cz - ring; j <= cz + ring; j++) {
        if (j < 0 || j >= this.gnz) continue;
        const edge = j === cz - ring || j === cz + ring;
        for (let i = cx - ring; i <= cx + ring; i += (edge ? 1 : 2 * ring || 1)) {
          if (i < 0 || i >= this.gnx) continue;
          for (const k of buckets[j * this.gnx + i]) {
            const dx = this.track.x[k] - x, dz = Z(this.track.y[k]) - z;
            const d = dx * dx + dz * dz;
            if (cand) { cand.push(k); cd.push(d); }
            if (d < bd) { bd = d; best = k; }
          }
        }
      }
      // Everything in ring r+1 is at least r*CELL away from any point in
      // the centre bucket.
      const lim = Math.sqrt(bd) + slack;
      if (best >= 0 && lim <= ring * CELL) break;
    }
    if (best < 0 && maxRing < 12) return { i: -1, d: Infinity };
    if (best < 0) {
      // Miles from the circuit. Coarse scan; this is rare and never per frame.
      for (let k = 0; k < this.track.n; k += 8) {
        const dx = this.track.x[k] - x, dz = Z(this.track.y[k]) - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = k; }
      }
      if (cand) { cand.push(best); cd.push(bd); }
    }
    if (!cand) return { i: best, d: Math.sqrt(bd) };
    const lim = (Math.sqrt(bd) + slack) ** 2;
    return { i: best, d: Math.sqrt(bd), cand: cand.filter((_, q) => cd[q] <= lim) };
  }

  /**
   * The nearest sample on ANOTHER part of the lap — a sample more than 80 m of
   * lap away from `i` — within `reach` metres, or null. Used to blend across
   * the line halfway between two legs of the circuit (see heightAt).
   */
  otherLeg(x, z, i, reach) {
    const n = this.track.n, gap = Math.ceil(80 / this.track.ds);
    const cx = Math.floor((x - this.gx0) / CELL), cz = Math.floor((z - this.gz0) / CELL);
    const r = Math.ceil(reach / CELL);
    let best = -1, bd = reach * reach;
    for (let j = cz - r; j <= cz + r; j++) {
      if (j < 0 || j >= this.gnz) continue;
      for (let q = cx - r; q <= cx + r; q++) {
        if (q < 0 || q >= this.gnx) continue;
        for (const k of this.buckets[j * this.gnx + q]) {
          const dk = Math.abs(k - i);
          if (Math.min(dk, n - dk) <= gap) continue;
          const dx = this.track.x[k] - x, dz = Z(this.track.y[k]) - z;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = k; }
        }
      }
    }
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  }

  /**
   * Weighted height of every centreline sample within `d + R` of (x, z):
   * weight (1 - (dk - d)/R)², so the nearest counts fully and one R further
   * counts nothing. `fallback` if nothing lands (never, in practice: the
   * nearest sample is always within d). Every 4th sample when R is large —
   * the profile is smoothed over 10 m, so 8 m spacing loses nothing.
   */
  _blendNear(x, z, d, R, fallback) {
    const t = this.track, reach = d + R;
    const step = R > 30 ? 8 : R > 12 ? 4 : 1;
    const cx = Math.floor((x - this.gx0) / CELL), cz = Math.floor((z - this.gz0) / CELL);
    const r = Math.ceil(reach / CELL);
    let sw = 0, sh = 0;
    const r2 = reach * reach;
    for (let j = cz - r; j <= cz + r; j++) {
      if (j < 0 || j >= this.gnz) continue;
      for (let q = cx - r; q <= cx + r; q++) {
        if (q < 0 || q >= this.gnx) continue;
        for (const k of (step === 8 ? this.buckets8 : step === 4 ? this.buckets4 : this.buckets)[j * this.gnx + q]) {
          const dx = t.x[k] - x, dz = Z(t.y[k]) - z;
          const dd = dx * dx + dz * dz;
          if (dd > r2) continue;
          const u = Math.max(0, 1 - (Math.sqrt(dd) - d) / R);
          const w = u * u;
          sw += w; sh += w * this.elev.s[k];
        }
      }
    }
    return sw > 0 ? sh / sw : fallback;
  }

  /** Bilinear sample of the terrain grid, in sim x / three z. */
  gridAt(x, z) {
    const g = this.elev.grid;
    const fx = (x - g.x0) / g.dx;
    // The grid was baked in SIM coordinates, so convert z back before indexing.
    const fy = (Z(z) - g.y0) / g.dy;
    // How far outside the surveyed box, in cells.
    const out = Math.max(0, -fx, fx - (g.n - 1), -fy, fy - (g.n - 1));
    const i0 = Math.max(0, Math.min(g.n - 2, Math.floor(fx)));
    const j0 = Math.max(0, Math.min(g.n - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - i0)), ty = Math.max(0, Math.min(1, fy - j0));
    const h = g.h;
    // CATMULL-ROM, not bilinear. Bilinear is continuous but its slope jumps
    // at every grid line — a crease every 45-60 m across the whole landscape —
    // and every ground mesh drawn over it is a set of flat chords that cannot
    // follow a crease. groundcheck.mjs measured those creases as the worst
    // disagreement left on Monza's skirt (0.53 m). A cubic through the same
    // posts is smooth, passes through every measured height exactly, and
    // leaves only true curvature for the chords to miss.
    const at = (i, j) => h[Math.max(0, Math.min(g.n - 1, j)) * g.n + Math.max(0, Math.min(g.n - 1, i))];
    const cr = (p0, p1, p2, p3, t) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = j => cr(at(i0 - 1, j), at(i0, j), at(i0 + 1, j), at(i0 + 2, j), tx);
    const v = cr(row(j0 - 1), row(j0), row(j0 + 1), row(j0 + 2), ty);
    if (out <= 0) return v;
    // Fall to sea level over about fifteen cells, so the edge of the survey is
    // a coastline or a slope rather than a cliff into a plateau.
    const f = Math.min(1, out / 15);
    // An inland circuit has no sea to fall to, and falling to the lowest post
    // the survey saw dug a moat round the Parco di Monza. Carry on along the
    // land's own measured tilt instead (a plane fitted to the grid by
    // tools/getelev.mjs), held within the relief the survey itself saw.
    if (this.plane) {
      const [a, b, c] = this.plane;
      const p = Math.max(this.gridLo - 15, Math.min(this.gridHi + 15, a + b * x + c * Z(z)));
      return v + (p - v) * (f * f * (3 - 2 * f));
    }
    return v + (this.seaY - v) * (f * f * (3 - 2 * f));
  }

  /** The height of the racing line at centreline sample `i`. */
  trackY(i) { return this.on ? this.elev.s[i] : 0; }

  /** The height of the racing line at distance `s` along it, interpolated. */
  trackYAt(s) {
    if (!this.on) return 0;
    const t = this.track;
    const f = ((s / t.ds) % t.n + t.n) % t.n;
    const i = Math.floor(f), j = (i + 1) % t.n;
    const k = f - i;
    return this.elev.s[i] * (1 - k) + this.elev.s[j] * k;
  }

  /**
   * The ground height anywhere: the racing line's own profile near the
   * circuit, the terrain grid far from it, crossfaded in between so the track
   * never ends up in a trench or on a plinth.
   */
  heightAt(x, z, near = null) {
    if (!this.on) return 0;
    const { i, d } = near || this.near(x, z);
    if (i < 0 || d >= FAR) return this.gridAt(x, z);
    // Interpolate ALONG the track rather than snapping to the nearest sample.
    // Samples are 2 m apart, so snapping leaves a centimetre-scale staircase
    // in the racing surface — invisible standing still and a shimmer at speed,
    // and it would make the car bob relative to the road it is driving on.
    const t = this.track;
    const h = t.hdg[i];
    const frac = ((x - t.x[i]) * Math.cos(h) + (Z(z) - t.y[i]) * Math.sin(h)) / t.ds;
    const k = Math.max(-1, Math.min(1, frac));
    const j = ((i + (k >= 0 ? 1 : -1)) % t.n + t.n) % t.n;
    let onTrack = this.elev.s[i] + (this.elev.s[j] - this.elev.s[i]) * Math.abs(k);
    // HALFWAY BETWEEN TWO LEGS the nearest sample flips from one to the other,
    // and if the legs sit at different heights the ground stepped there — a
    // cliff down the middle of the infield with houses cut in half by it
    // (Street, 2026-09-24: steps of several metres wherever two parts of the
    // lap ran within a few hundred metres). Blend toward the other leg as the
    // point nears the bisector: half-and-half ON it, none at all once the
    // other leg is BLEND metres further away — which is always true on the
    // road itself, so the racing surface is exactly what it was.
    // Never on the circuit, nor within one grass-grid cell of it: tarmac and
    // run-off keep their own leg's height however close another leg runs
    // (Monaco's are metres apart), and so does the grass that meets them.
    //
    // 2026-09-28: THAT WAS STILL A STEP, just a smaller one. "Nearest sample"
    // is discontinuous on every line equidistant from two parts of the lap —
    // not only between two legs but at the centre of every CORNER, where a
    // point 75 m inside Lesmo is equally near five stretches of it. The
    // nearest flipped from s=2174 to s=2238 to s=2304 across two metres, the
    // ground stepped 0.7 m, and three trees planted there floated on one side
    // of the step (groundcheck: 0.41 m). So off the circuit the height is a
    // WEIGHTED blend of every sample within R of the nearest distance, R
    // growing with the distance from the corridor: a point on the bisector
    // gets exactly half of each side, and the weights move continuously, so
    // the ground cannot step anywhere. At the corridor's edge R is zero, so
    // tarmac, run-off and the grass that meets them keep exactly their own
    // leg's height, however close another leg runs (Monaco's are metres
    // apart, and Suzuka's cross over each other).
    // The WIDEST corridor on the lap, not this sample's: a per-sample one
    // would itself jump where the nearest sample does.
    const corr = this.sinkTo - 12;
    if (d < FAR && d > corr) {
      const R = Math.min(70, 0.5 * (d - corr));
      if (R > 0.5) onTrack = this._blendNear(x, z, d, R, onTrack);
    }
    if (d <= NEAR) return onTrack;
    const grid = this.gridAt(x, z);
    if (d >= FAR) return grid;
    const f = (d - NEAR) / (FAR - NEAR);
    return onTrack + (grid - onTrack) * (f * f * (3 - 2 * f));
  }

  /** How far the ground is pushed down at distance `d` from the track. */
  sinkAt(d) {
    return d >= this.sinkTo ? 0 : SINK_MAX * (1 - d / this.sinkTo) ** 2;
  }

  /**
   * Where the ground you can SEE is, as opposed to where the field says it is.
   *
   * The skirt that draws the grass near the circuit is 26 m cells over a road
   * surveyed at 2 m, so between two of its vertices it is a flat chord, and
   * wherever the road dips below that chord the grass wins the depth test and
   * the main straight renders as patches of turf. It is pushed down to stop
   * that, and 5 cm of mesh offset cannot cover a chord error over 26 m.
   *
   * Everything STANDING on the ground has to be pushed down by the same
   * amount or it floats by exactly the gap. Hoardings, guard rails, marshal
   * posts and the trees at the track edge all hovered over their own shadows
   * because the grass was sunk under them and they were not.
   */
  groundY(x, z, near = null) {
    near = near || this.near(x, z);
    const { i, d } = near;
    let y = (this.on ? this.heightAt(x, z, near) : 0) - this.sinkAt(d);
    if (this.bank && i >= 0 && this.bank[i]) {
      const t = this.track, h = t.hdg[i];
      const lat = -Math.sin(h) * (x - t.x[i]) + Math.cos(h) * (Z(z) - t.y[i]);
      y += bankGround(this.bank, t, i, lat);
    }
    return y;
  }

  /** `lift`, onto the visible ground rather than onto the height field. */
  liftGround(geo) {
    if (!geo) return geo;
    const p = geo.attributes.position;
    const a = p.array;
    for (let k = 0; k < a.length; k += 3) a[k + 1] += this.groundY(a[k], a[k + 2]);
    p.needsUpdate = true;
    geo.computeBoundingSphere();
    return geo;
  }

  /**
   * Displace a finished geometry onto the ground, in place.
   *
   * The whole elevation feature is this function applied to about fifteen
   * meshes. See the note at the top for why a vertical wall survives it.
   */
  lift(geo) {
    if (!this.on || !geo) return geo;
    const p = geo.attributes.position;
    const a = p.array;
    for (let k = 0; k < a.length; k += 3) a[k + 1] += this.heightAt(a[k], a[k + 2]);
    p.needsUpdate = true;
    geo.computeBoundingSphere();
    return geo;
  }

  /** The same, for a mesh — returns the mesh so it can be chained. */
  liftMesh(m) {
    if (m) this.lift(m.geometry);
    return m;
  }
}
