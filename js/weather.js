// weather.js — the real sky, at the real time, in the real weather.
//
// LOOK.md items 12-15. Adam: "literally real time and weather. if its 2:00pm
// sunny? sunny ingame, sun is where it should be. 11:00 am rainy? it rains and
// its SLICK and well not very sunny yk? but you also have a override, but its
// tedious."
//
// Two halves, and only one of them needs the internet:
//
//   WHERE THE SUN IS — pure arithmetic from the date, the time and a latitude.
//   No service, no key, no network, works on a plane. The sun has been
//   predictable for four and a half billion years and this is ninety lines of
//   it.
//
//   WHAT THE WEATHER IS — Open-Meteo, which is free and needs no API key at
//   all. One request, cached, and a total failure just means a nice day.
//
// HIS SKY, NOT THE CIRCUIT'S (LOOK.md 13). 2pm sunny in California is 2pm
// sunny at Monza, Baku and Suzuka alike. Correctness would put Monza in the
// dark at his bedtime, and a game you cannot play is worse than a sky that is
// nine hours out.

// ---------------------------------------------------------------------------
// WHERE THE SUN IS
// ---------------------------------------------------------------------------
const RAD = Math.PI / 180, DEG = 180 / Math.PI;

/**
 * Sun elevation and azimuth for a moment and a place.
 *
 * NOAA's solar position algorithm, the abridged one: good to about a tenth of
 * a degree, which is a hundred times better than anyone can see in a sky
 * texture. Azimuth is degrees clockwise from north, elevation degrees above
 * the horizon and NEGATIVE at night, which is how night gets detected.
 */
export function solarPosition(date, latDeg, lonDeg) {
  // Julian day, then centuries since J2000.
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const centre = Math.sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + centre;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * RAD);

  // Obliquity: the tilt that makes seasons happen.
  const obl = 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)))) / 60) / 60;
  const oblCorr = obl + 0.00256 * Math.cos((125.04 - 1934.136 * t) * RAD);

  const decl = Math.asin(Math.sin(oblCorr * RAD) * Math.sin(appLong * RAD)) * DEG;

  // The equation of time: why sundials disagree with clocks by up to a quarter
  // of an hour depending on the month.
  const y = Math.tan(oblCorr / 2 * RAD) ** 2;
  const eqTime = 4 * DEG * (
    y * Math.sin(2 * meanLong * RAD)
    - 2 * ecc * Math.sin(meanAnom * RAD)
    + 4 * ecc * y * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD)
    - 0.5 * y * y * Math.sin(4 * meanLong * RAD)
    - 1.25 * ecc * ecc * Math.sin(2 * meanAnom * RAD));

  // True solar time, in minutes, at this longitude. UTC in — the caller's
  // timezone is irrelevant, because longitude already says where noon is.
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const solarMin = (utcMin + eqTime + 4 * lonDeg + 1440) % 1440;
  const hourAngle = solarMin / 4 - 180;      // degrees, 0 at local solar noon

  const lat = latDeg * RAD, d = decl * RAD, ha = hourAngle * RAD;
  const cosZen = Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(ha);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZen))) * DEG;
  let elevation = 90 - zenith;

  // Refraction lifts the sun visibly near the horizon — it is why you can
  // still see it after it has technically set, and it is worth half a degree
  // at sunset, which is a whole sun's width.
  //
  // SAEMUNDSSON, not the polynomial. The usual 58.1/tan(h) series has a
  // 1/tan^5 term in it that is fine above about five degrees and explodes
  // below: at h = 0.1 degrees it returned an elevation of 1,471,402 degrees,
  // which tools/weathercheck.mjs caught by scanning a whole day and taking
  // the maximum. Dawn and dusk are exactly when this matters, so the formula
  // that is well behaved all the way to the horizon is the only usable one.
  if (elevation > -2 && elevation < 20) {
    const r = 1.02 / Math.tan((elevation + 10.3 / (elevation + 5.11)) * RAD);  // arcminutes
    elevation += r / 60;
  }

  let azimuth = Math.atan2(
    Math.sin(ha),
    Math.cos(ha) * Math.sin(lat) - Math.tan(d) * Math.cos(lat)) * DEG + 180;
  azimuth = (azimuth + 360) % 360;
  return { elevation, azimuth, declination: decl };
}

/**
 * The sun as a direction in the game's axes.
 *
 * +x east, +y up, +z south — which is what the existing sky data uses, and
 * what sunRig in tex.js expects. Below the horizon it is clamped just above
 * it so shadows do not invert; night is signalled by `elevation`, not by a
 * sun pointing at the floor.
 */
export function sunVector(elevation, azimuth) {
  const el = Math.max(elevation, -6) * RAD, az = azimuth * RAD;
  const c = Math.cos(el);
  return [Math.sin(az) * c, Math.max(Math.sin(el), 0.02), -Math.cos(az) * c];
}

/**
 * Where "here" is, without asking permission and without a network call.
 *
 * The browser's geolocation API puts a prompt in front of a racing game, and
 * an IP lookup is another service to be down. But the machine already knows
 * its timezone, and a timezone is mostly a statement about LONGITUDE — which
 * is the half that decides what time the sun rises.
 *
 * Worth writing down why this exists: the first version hardcoded Concord,
 * California while the machine was set to America/New_York, so the clock said
 * 19:50 and the sun sat at 41 degrees — late afternoon three time zones west.
 * The sums were right and the place was wrong, which is the hardest kind of
 * wrong to see in a screenshot.
 */
const ZONES = {
  'America/New_York': [40.71, -74.01], 'America/Detroit': [42.33, -83.05],
  'America/Toronto': [43.65, -79.38], 'America/Chicago': [41.88, -87.63],
  'America/Denver': [39.74, -104.99], 'America/Phoenix': [33.45, -112.07],
  'America/Los_Angeles': [34.05, -118.24], 'America/Vancouver': [49.28, -123.12],
  'America/Sao_Paulo': [-23.55, -46.63], 'America/Mexico_City': [19.43, -99.13],
  'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26],
  'Europe/Paris': [48.86, 2.35], 'Europe/Madrid': [40.42, -3.70],
  'Europe/Berlin': [52.52, 13.40], 'Europe/Rome': [41.90, 12.50],
  'Europe/Warsaw': [52.23, 21.01], 'Europe/Moscow': [55.76, 37.62],
  'Asia/Dubai': [25.20, 55.27], 'Asia/Kolkata': [22.57, 88.36],
  'Asia/Shanghai': [31.23, 121.47], 'Asia/Tokyo': [35.68, 139.69],
  'Asia/Singapore': [1.35, 103.82], 'Australia/Sydney': [-33.87, 151.21],
  'Pacific/Auckland': [-36.85, 174.76], 'Africa/Johannesburg': [-26.20, 28.05],
};

export function guessLocation() {
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* old runtime */ }
  if (ZONES[zone]) return { lat: ZONES[zone][0], lon: ZONES[zone][1], from: zone };

  // Unknown zone: longitude from the STANDARD offset, because that is what a
  // timezone is. Good to about seven degrees, which is half an hour of sun.
  // Latitude cannot be had this way at all, so 40 and admit it.
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  const standard = Math.max(jan, jul);          // the larger offset is winter, i.e. no DST
  return { lat: 40, lon: -standard / 4, from: zone || 'offset' };
}

// ---------------------------------------------------------------------------
// WHAT THE WEATHER IS
// ---------------------------------------------------------------------------

// WMO weather codes, grouped into the only distinctions this game can draw.
// The full table has 28 entries and most of them are "a kind of rain".
function readCode(code) {
  if (code >= 95) return 'storm';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80) return 'showers';
  if (code >= 51) return 'rain';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 2) return 'cloud';
  return 'clear';
}

/**
 * One request, no key. Failure is not an error — it is a nice day, because a
 * game that will not start because a weather service is down is a worse game
 * than one that guesses.
 */
export async function fetchWeather(lat, lon, { signal } = {}) {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
    + '&current=temperature_2m,precipitation,cloud_cover,wind_speed_10m,weather_code'
    + '&timezone=UTC';
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const c = j.current || {};
    return {
      ok: true,
      temp: c.temperature_2m ?? 18,
      rain: c.precipitation ?? 0,           // mm in the last hour
      cloud: (c.cloud_cover ?? 20) / 100,   // 0..1
      wind: c.wind_speed_10m ?? 6,          // km/h
      kind: readCode(c.weather_code ?? 0),
      at: Date.now(),
    };
  } catch (e) {
    return { ok: false, why: e.message, temp: 18, rain: 0, cloud: 0.18, wind: 6, kind: 'clear', at: Date.now() };
  }
}

/**
 * Turn real numbers into the four things the renderer and the physics care
 * about — and NUDGE IT PRETTIER on the way (LOOK.md 15).
 *
 * The nudge is honest about what it is: real conditions, read generously.
 * Overcast becomes MOODY rather than flat, because a week of real drizzle in
 * a game with no roof is a week of looking at a grey rectangle. Nothing here
 * invents weather that is not happening; it only refuses to render the dull
 * version of weather that is.
 */
export function readWeather(w) {
  const wet = Math.min(1, (w.rain || 0) / 2.5);           // 2.5 mm/h is properly wet
  const kindWet = w.kind === 'storm' ? 1 : w.kind === 'rain' || w.kind === 'showers' ? 0.7 : 0;
  const wetness = Math.max(wet, kindWet);

  // The nudge. Cloud never reads as a flat lid: even at 100% we leave a little
  // structure, so there is always somewhere brighter to look.
  const cloud = Math.min(0.92, (w.cloud ?? 0.2) * 0.88 + 0.04);

  return {
    wetness,                                    // 0..1, drives grip and spray
    cloud,                                      // 0..1, drives sun punch and ambient
    // Thick air when it is humid or raining, thin when it is clear and cold.
    haze: Math.min(1, 0.12 + cloud * 0.5 + wetness * 0.45),
    // How hard the sun is allowed to hit. Overcast still has a bright patch.
    punch: Math.max(0.12, 1 - cloud * 0.85),
    wind: w.wind ?? 6,
    temp: w.temp ?? 18,
    kind: w.kind || 'clear',
  };
}

/**
 * WEATHER YOU CAN DRIVE OUT OF (LOOK.md 14).
 *
 * Adam: "if youre in the dry areas, the rains gonna be lighter, if u travel
 * far enoguh, the rain will be gone."
 *
 * The live reading is the BASE; where you are in the world scales it. A desert
 * biome gets a fraction of the rain that is really falling, so a storm thins
 * out as you drive into dry country and comes back when you leave. `dryness`
 * is 0 for temperate and 1 for desert.
 */
export function atBiome(read, dryness = 0) {
  const d = Math.max(0, Math.min(1, dryness));
  const wetness = read.wetness * (1 - d * 0.92);
  return {
    ...read,
    wetness,
    cloud: read.cloud * (1 - d * 0.55),
    haze: read.haze * (1 - d * 0.35) + d * 0.10,   // dry air is clear but dusty
    punch: Math.min(1, read.punch * (1 + d * 0.35)),
  };
}

// ---------------------------------------------------------------------------
// THE PHASES OF A DAY
//
// Adam: "this looks like night time but irl it looks like morning ... theres
// not js day or night, theres night morning dusk day dawn sunset night".
// Right: the sun below the horizon is not night. Civil twilight (to 6 degrees
// under) is bright enough to read by, and the game treated all of it as dark.
//
//   NIGHT     below -12        the sky is black-blue, lamps full
//   DAWN/DUSK -12 .. -1        blue hour: no sun, a lit sky, lamps coming on/off
//   SUNRISE/SUNSET -1 .. 8     the sun on the horizon, long orange light
//   MORNING/EVENING 8 .. 25    low, warm, long shadows
//   DAY       above 25
//
// `dark` (0 day .. 1 night) is what the lamps follow, so they fade in through
// dusk instead of snapping on at one number.
// ---------------------------------------------------------------------------
export function dayPhase(elevation, azimuth) {
  const rising = azimuth < 180;          // east of south: before solar noon
  const e = elevation;
  const name = e < -12 ? 'NIGHT' : e < -1 ? (rising ? 'DAWN' : 'DUSK')
    : e < 8 ? (rising ? 'SUNRISE' : 'SUNSET') : e < 25 ? (rising ? 'MORNING' : 'EVENING') : 'DAY';
  const dark = Math.max(0, Math.min(1, (2 - e) / 10));
  return { name, dark, rising };
}

// The moment today (in the player's own clock) when the sun is at a phase.
// Searched minute by minute, which is 1440 evaluations of ninety lines of
// arithmetic, once, when a session starts.
const PHASE_AT = {
  night: { mid: -1 }, dawn: { e: -5, rise: true }, sunrise: { e: 2, rise: true },
  morning: { e: 15, rise: true }, day: { noon: true }, evening: { e: 15, rise: false },
  sunset: { e: 2, rise: false }, dusk: { e: -5, rise: false },
};
export const TIME_PHASES = Object.keys(PHASE_AT);

export function timeFor(phase, now, lat, lon) {
  const want = PHASE_AT[phase];
  if (!want) return null;
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  let best = null, score = Infinity;
  for (let m = 0; m < 1440; m++) {
    const d = new Date(+day0 + m * 60000);
    const s = solarPosition(d, lat, lon);
    let k;
    if (want.noon) k = -s.elevation;
    else if (want.mid) k = s.elevation;
    else {
      if ((s.azimuth < 180) !== want.rise) continue;
      k = Math.abs(s.elevation - want.e);
    }
    if (k < score) { score = k; best = d; }
  }
  return best;
}
