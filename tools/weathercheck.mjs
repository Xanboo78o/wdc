// weathercheck.mjs — is the sun where the sun actually is?
//
//   node tools/weathercheck.mjs            maths only, no network
//   node tools/weathercheck.mjs --live     also hit Open-Meteo for real
//   node tools/weathercheck.mjs --break    prove the gate can fail
//
// Almost everything else in this repo is checked against ITSELF — a gate
// proves the ground is continuous, or that contacts went down, but there is no
// external authority saying what the right number was. This one is different
// and it is worth saying so: the sun's position is known to arcseconds and has
// been for centuries, so these are tests with a RIGHT ANSWER.
//
// The anchors are school astronomy, not values copied out of my own function:
//
//   at local solar noon,  elevation = 90 - |latitude - declination|
//   at the solstices,     declination = +/- 23.44 degrees
//   at the equinoxes,     declination = 0
//   in the northern hemisphere the midday sun is due SOUTH (azimuth 180)
//
// If solarPosition drifts, these fail. Nothing here can be satisfied by the
// code agreeing with itself.
import { solarPosition, sunVector, readWeather, atBiome, fetchWeather } from '../js/weather.js';

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const BREAK = argv.includes('--break');
for (const a of argv) if (a !== '--live' && a !== '--break') { console.error(`unknown flag ${a}`); process.exit(2); }

let fails = 0;
const fail = m => { fails++; console.log('FAIL  ' + m); };
const ok = m => console.log('ok    ' + m);

// A deliberately wrong sun, to prove the checks below can see one.
const sun = BREAK
  ? (d, lat, lon) => ({ ...solarPosition(d, lat, lon), elevation: 42, azimuth: 42 })
  : solarPosition;

// Highest elevation of the day, and the azimuth when it happens. Scanning
// rather than solving, because it tests the whole function end to end.
function noon(dateUTC, lat, lon) {
  let best = { elevation: -99, azimuth: 0, at: null };
  for (let m = 0; m < 1440; m++) {
    const d = new Date(Date.UTC(dateUTC[0], dateUTC[1], dateUTC[2], 0, m));
    const s = sun(d, lat, lon);
    if (s.elevation > best.elevation) best = { ...s, at: d };
  }
  return best;
}

console.log('\nSUN — checked against astronomy, not against itself\n');
console.log('  date         place                lat     expected   measured    err');
const CASES = [
  // [label, [y,m,d], lat, lon, declination that day]
  ['equinox   ', [2026, 2, 20], 0.0, 0.0, 0.0],
  ['equinox   ', [2026, 2, 20], 51.5, -0.13, 0.0],
  ['Jun sols. ', [2026, 5, 21], 51.5, -0.13, 23.44],
  ['Dec sols. ', [2026, 11, 21], 51.5, -0.13, -23.44],
  ['Jun sols. ', [2026, 5, 21], 45.62, 9.28, 23.44],     // Monza
  ['Jun sols. ', [2026, 5, 21], 37.98, -122.03, 23.44],  // Concord, California
  ['Dec sols. ', [2026, 11, 21], -33.86, 151.2, -23.44], // Sydney, southern summer
];
for (const [label, ymd, lat, lon, decl] of CASES) {
  const want = 90 - Math.abs(lat - decl);
  const got = noon(ymd, lat, lon);
  const err = Math.abs(got.elevation - want);
  const place = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  console.log(`  ${label} ${place.padEnd(20)} ${want.toFixed(2).padStart(7)}째 ${got.elevation.toFixed(2).padStart(9)}째 ${err.toFixed(2).padStart(6)}`);
  // 0.6 degrees of slack: refraction near the horizon, and the declination
  // anchors are the solstice EXTREMES rather than that exact calendar day.
  if (err > 0.6) fail(`${label.trim()} at ${place}: midday sun is ${got.elevation.toFixed(2)}째, should be ${want.toFixed(2)}째`);
}

// Midday sun is due south in the north, due north in the south.
const london = noon([2026, 5, 21], 51.5, -0.13);
if (Math.abs(london.azimuth - 180) > 2) fail(`London's midday sun is at azimuth ${london.azimuth.toFixed(1)}, should be ~180 (due south)`);
else ok(`northern midday sun is due south (${london.azimuth.toFixed(1)}째)`);
const sydney = noon([2026, 11, 21], -33.86, 151.2);
const sydOff = Math.min(Math.abs(sydney.azimuth), Math.abs(sydney.azimuth - 360));
if (sydOff > 2) fail(`Sydney's midday sun is at azimuth ${sydney.azimuth.toFixed(1)}, should be ~0/360 (due north)`);
else ok(`southern midday sun is due north (${sydney.azimuth.toFixed(1)}째)`);

// It is dark at night. Obvious, and it is how the renderer knows to switch on
// the headlights, so it had better be true.
const midnight = sun(new Date(Date.UTC(2026, 5, 21, 0, 0)), 51.5, -0.13);
if (midnight.elevation > -5) fail(`the sun is ${midnight.elevation.toFixed(1)}째 up at London midnight`);
else ok(`the sun is below the horizon at midnight (${midnight.elevation.toFixed(1)}째)`);

// The vector keeps the sun up even when it has set, but never points it down —
// a downward sun inverts every shadow in the scene.
const v = sunVector(-20, 180);
if (v[1] < 0) fail(`a set sun points downward (${v.map(n => n.toFixed(2))}) — shadows would invert`);
else ok(`a set sun still points upward (y ${v[1].toFixed(3)})`);
// And it points the right way: due south at 45째 should be +z, no x.
const s45 = sunVector(45, 180);
if (Math.abs(s45[0]) > 0.02 || s45[2] < 0.5) fail(`a southern sun points ${s45.map(n => n.toFixed(2))}, expected roughly (0, 0.7, 0.7)`);
else ok(`a southern sun points south and up (${s45.map(n => n.toFixed(2)).join(', ')})`);

// ---- the reading, and the biome ---------------------------------------------
console.log('\nWEATHER — the reading, and what a biome does to it\n');
const storm = readWeather({ rain: 3.2, cloud: 0.95, wind: 34, temp: 11, kind: 'storm' });
const clear = readWeather({ rain: 0, cloud: 0.05, wind: 4, temp: 24, kind: 'clear' });
console.log(`  storm   wetness ${storm.wetness.toFixed(2)}  cloud ${storm.cloud.toFixed(2)}  punch ${storm.punch.toFixed(2)}  haze ${storm.haze.toFixed(2)}`);
console.log(`  clear   wetness ${clear.wetness.toFixed(2)}  cloud ${clear.cloud.toFixed(2)}  punch ${clear.punch.toFixed(2)}  haze ${clear.haze.toFixed(2)}`);
if (storm.wetness <= clear.wetness) fail('a storm is no wetter than a clear day');
if (storm.punch >= clear.punch) fail('a storm has as much sun as a clear day');
// The nudge: overcast must never read as a flat lid.
if (storm.punch < 0.1) fail(`overcast leaves only ${storm.punch.toFixed(2)} of sun — that is a grey rectangle, not moody`);
else ok(`overcast keeps ${storm.punch.toFixed(2)} of punch — moody, not flat`);

const dry = [0, 0.5, 1].map(d => atBiome(storm, d));
console.log(`\n  driving into dry country, with a storm overhead:`);
for (let i = 0; i < 3; i++) {
  console.log(`    dryness ${[0, 0.5, 1][i].toFixed(1)}  wetness ${dry[i].wetness.toFixed(3)}  cloud ${dry[i].cloud.toFixed(2)}  punch ${dry[i].punch.toFixed(2)}`);
}
if (!(dry[0].wetness > dry[1].wetness && dry[1].wetness > dry[2].wetness)) {
  fail('rain does not thin out as the country gets drier');
} else if (dry[2].wetness > 0.15) {
  fail(`deep desert still has ${dry[2].wetness.toFixed(2)} of wet — he asked for the rain to be GONE`);
} else ok('rain thins with dryness and is gone in the desert');

// ---- live, only when asked ---------------------------------------------------
if (LIVE) {
  console.log('\nLIVE — Open-Meteo, no API key\n');
  const w = await fetchWeather(37.98, -122.03);
  if (!w.ok) console.log(`  unreachable (${w.why}) — and that is FINE, it falls back to a nice day`);
  else {
    const r = readWeather(w);
    console.log(`  Concord, CA: ${w.kind}, ${w.temp}째C, cloud ${(w.cloud * 100) | 0}%, rain ${w.rain}mm, wind ${w.wind}km/h`);
    console.log(`  reads as: wetness ${r.wetness.toFixed(2)}  punch ${r.punch.toFixed(2)}  haze ${r.haze.toFixed(2)}`);
  }
  const now = solarPosition(new Date(), 37.98, -122.03);
  console.log(`  sun right now: ${now.elevation.toFixed(1)}째 up, azimuth ${now.azimuth.toFixed(0)}째` +
    (now.elevation < 0 ? '  (below the horizon — it is night there)' : ''));
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nthe sun is where the sun is');
process.exit(fails ? 1 : 0);
