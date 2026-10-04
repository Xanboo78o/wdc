import { loadTrack } from './harness.mjs';
import fs from 'fs';
const keys = fs.readdirSync(new URL('../data/tracks', import.meta.url).pathname).map(f => f.replace('.json', '')).filter(k => !/^fold|^test$/.test(k));
for (const key of keys) {
  let T; try { T = loadTrack(key, 'f1').track; } catch (e) { console.log(key, 'load failed', String(e).slice(0, 60)); continue; }
  const t = T, n = t.n, ds = t.ds; let ghost = 0, total = 0; const where = [];
  for (let i = 0; i < n; i += 5) for (const side of [1, -1]) {
    total++;
    const lat = side > 0 ? t.w[i] + t.runL[i] : -(t.w[i] + t.runR[i]);
    const h = t.hdg[i], bx = t.x[i] - Math.sin(h) * lat, by = t.y[i] + Math.cos(h) * lat;
    // is this drawn barrier point INSIDE the drivable band of some OTHER stretch of the lap?
    let hit = null;
    for (let j = 0; j < n; j += 3) {
      const along = Math.min(Math.abs(j - i), n - Math.abs(j - i)) * ds;
      if (along < 120) continue;
      const dx = bx - t.x[j], dy = by - t.y[j];
      if (dx * dx + dy * dy > 60 * 60) continue;
      const hj = t.hdg[j], l = -Math.sin(hj) * dx + Math.cos(hj) * dy, a = Math.cos(hj) * dx + Math.sin(hj) * dy;
      if (Math.abs(a) > 3) continue;
      const lim = l > 0 ? t.w[j] + t.runL[j] : t.w[j] + t.runR[j];
      if (Math.abs(l) < lim - 1.5) { hit = { j, inside: lim - Math.abs(l), onRoad: Math.abs(l) < t.w[j] }; break; }
    }
    if (hit) { ghost++; if (!where.length || i * ds - where[where.length - 1].s > 80) where.push({ s: i * ds, other: hit.j * ds, inside: hit.inside, onRoad: hit.onRoad }); }
  }
  console.log(`${key.padEnd(12)} drawn barrier inside another stretch's driveable area: ${(100 * ghost / total).toFixed(1)}% of barrier  ` + where.slice(0, 5).map(w => `s${w.s.toFixed(0)}↔s${w.other.toFixed(0)} (${w.inside.toFixed(0)} m in${w.onRoad ? ', ON THE ROAD' : ''})`).join('  '));
}
