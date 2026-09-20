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

const NEAR = 55;       // inside this, the racing line's own profile wins
const FAR = 240;       // beyond this, the terrain grid wins
const CELL = 90;       // metres per bucket in the lookup grid
const SINK_MAX = 0.35; // how far the visible ground is pushed under the circuit

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
    if (!this.on) return;
    // What the land does BEYOND the surveyed box. The DEM only covers the
    // world box; sampling it outside clamps to whatever the boundary happened
    // to be, which at Monaco built a twenty-kilometre flat mesa at the height
    // of the hillside and floated the whole city on it. Past the box the
    // ground falls away to the lowest thing the survey saw — the sea, on the
    // three circuits that have one, and a harmless dip inland.
    this.seaY = Math.min(...elev.grid.h);
  }

  /** Nearest centreline sample to a point, and how far away it is. */
  nearest(x, z) {
    let best = -1, bd = Infinity;
    const cx = Math.floor((x - this.gx0) / CELL), cz = Math.floor((z - this.gz0) / CELL);
    // Widen the search until something is found — a point far out in the
    // countryside may have no track within several buckets.
    for (let ring = 1; ring <= 6 && best < 0; ring++) {
      for (let j = cz - ring; j <= cz + ring; j++) {
        if (j < 0 || j >= this.gnz) continue;
        for (let i = cx - ring; i <= cx + ring; i++) {
          if (i < 0 || i >= this.gnx) continue;
          for (const k of this.buckets[j * this.gnx + i]) {
            const dx = this.track.x[k] - x, dz = Z(this.track.y[k]) - z;
            const d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = k; }
          }
        }
      }
    }
    if (best < 0) {
      // Miles from the circuit. Coarse scan; this is rare and never per frame.
      for (let k = 0; k < this.track.n; k += 8) {
        const dx = this.track.x[k] - x, dz = Z(this.track.y[k]) - z;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = k; }
      }
    }
    return { i: best, d: Math.sqrt(bd) };
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
    const a = h[j0 * g.n + i0], b = h[j0 * g.n + i0 + 1];
    const c = h[(j0 + 1) * g.n + i0], d = h[(j0 + 1) * g.n + i0 + 1];
    const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    if (out <= 0) return v;
    // Fall to sea level over about fifteen cells, so the edge of the survey is
    // a coastline or a slope rather than a cliff into a plateau.
    const f = Math.min(1, out / 15);
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
  heightAt(x, z) {
    if (!this.on) return 0;
    const { i, d } = this.nearest(x, z);
    // Interpolate ALONG the track rather than snapping to the nearest sample.
    // Samples are 2 m apart, so snapping leaves a centimetre-scale staircase
    // in the racing surface — invisible standing still and a shimmer at speed,
    // and it would make the car bob relative to the road it is driving on.
    const t = this.track;
    const h = t.hdg[i];
    const frac = ((x - t.x[i]) * Math.cos(h) + (Z(z) - t.y[i]) * Math.sin(h)) / t.ds;
    const k = Math.max(-1, Math.min(1, frac));
    const j = ((i + (k >= 0 ? 1 : -1)) % t.n + t.n) % t.n;
    const onTrack = this.elev.s[i] + (this.elev.s[j] - this.elev.s[i]) * Math.abs(k);
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
  groundY(x, z) {
    const sink = this.sinkAt(this.nearest(x, z).d);
    return (this.on ? this.heightAt(x, z) : 0) - sink;
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
