// livery.js — every team's paint job, as zones on the car.
//
// Adam, 2026-09-25: "give the teams their actual multi color liveries, like
// the ferrari red with the wing with white, the williams gulf livery, bwt
// livery, the rb18 colors".
//
// HOW A LIVERY IS PAINTED. The single-seater (js/car.js) is one set of shapes
// shared by the whole grid, and every car is its clone. So a livery is not a
// texture on those shapes — it is a list of BOXES in the car's own space, each
// with a colour, and the paint's shader colours every pixel by which box it
// sits in. Later boxes win. Because it reads the car's OWN coordinates, the
// near car and the merged far-away copy (js/field.js) come out identical, and
// a rival is still one material clone per team.
//
// The car's axes (js/geom.js): x forward (nose tip +2.7, rear wing -2.8),
// y up from the ground, z to the side. Liveries are symmetric, so a box is
// written for the right-hand side and matched against |z|.
//
// Where things are, for writing a box (js/car.js, buildCar):
//   nose           x 1.45..2.7,  |z| < 0.2       nose tip  x > 2.25
//   cockpit sides  x -0.8..1.45
//   sidepods       x -1.65..0.66, |z| 0.40..0.92, y 0.25..0.56
//                  top y > 0.47, the lower half y < 0.37
//   engine cover   x -2.3..-0.8, |z| < 0.33, its top y > 0.55
//   front wing     x 2.1..2.85, y < 0.45; endplates |z| > 0.97
//   rear wing      x < -2.2, y > 0.55; endplates |z| > 0.50
//
// A rule is [colour, x0, x1, y0, y1, z0, z1, slant]. `slant` shears x by y,
// which is how a stripe leans back the way a livery flash does.
//
// These are from memory of each car's look, not from a style guide — the
// colours and the big shapes, not the logos (a colour is not a trademark,
// a logo is). Change a box here and the whole grid follows.
import * as THREE from 'three';

const ALL = 9;                                   // "no limit" on an axis
const LOWER_PODS = [-1.7, 0.7, 0, 0.36, 0.38, ALL];
const POD_STRIPE = (y0, y1) => [-1.62, 0.68, y0, y1, 0.38, ALL];
const RW = [-3.2, -2.18, 0.55, 1.2, 0, ALL];
const RW_ENDS = [-3.2, -2.18, 0.55, 1.2, 0.5, ALL];
const RW_TOP = [-3.2, -2.18, 0.96, 1.2, 0.5, ALL];
const FW_ENDS = [2.1, 3.2, 0, 0.5, 0.96, ALL];
const NOSE_TIP = [2.25, 3.2, 0, 0.5, 0, 0.25];
const COVER_TOP = [-2.35, -0.8, 0.55, 1.2, 0, 0.35];
const LOWER_BODY = [-2.4, 1.45, 0, 0.36, 0, ALL];

export const LIVERIES = {
  // ---- the 2026 grid ------------------------------------------------------
  // Ferrari: red, the rear wing in white, a black lower half with a white line.
  scarlet: { base: '#d6001c', second: '#f2f2f2', rules: [
    ['#141414', ...LOWER_PODS], ['#f2f2f2', ...POD_STRIPE(0.36, 0.385)],
    ['#f2f2f2', ...RW],
  ] },
  // Red Bull, RB18 colours: matte navy, the red of the charging bulls on the
  // engine cover, the yellow sun, a yellow nose tip and red wing ends.
  navy: { base: '#0e1c43', second: '#ffcc00', matte: true, rules: [
    ['#d8001f', -1.75, -0.95, 0.52, 1.2, 0, 0.36], ['#ffcc00', -1.40, -1.20, 0.52, 1.2, 0, 0.36],
    ['#d8001f', -0.45, 0.68, 0.28, 0.37, 0.38, ALL],
    ['#ffcc00', ...NOSE_TIP], ['#d8001f', ...FW_ENDS], ['#d8001f', -3.2, -2.18, 0.55, 0.78, 0.5, ALL],
  ] },
  // Mercedes: black, silver across the top, a teal line down the pods.
  silver: { base: '#17191c', second: '#00d2be', rules: [
    ['#c3c8cc', 1.1, 3.2, 0.33, 1.2, 0, 0.3], ['#c3c8cc', ...COVER_TOP],
    ['#00d2be', ...POD_STRIPE(0.44, 0.47)], ['#00d2be', ...RW_TOP], ['#00d2be', ...FW_ENDS],
  ] },
  // McLaren: papaya over anthracite, blue on the helmet and the top flap.
  papaya: { base: '#ff7a00', second: '#47c7fc', rules: [
    ['#2a2c30', ...LOWER_BODY], ['#2a2c30', ...RW_ENDS], ['#47c7fc', -3.2, -2.18, 0.96, 1.2, 0.5, ALL],
  ] },
  // Aston Martin: racing green with lime lines.
  emerald: { base: '#0b5b46', second: '#cedc00', rules: [
    ['#111312', ...LOWER_PODS], ['#cedc00', ...POD_STRIPE(0.47, 0.50)],
    ['#cedc00', 2.1, 3.2, 0, 0.12, 0.96, ALL], ['#cedc00', ...RW_TOP],
  ] },
  // Alpine in BWT pink: pink from the cockpit forward, blue behind, pink wing ends.
  rose: { base: '#1a55d8', second: '#ff5fa2', rules: [
    ['#ff5fa2', 0.25, 3.2, 0, 1.2, 0, ALL, -0.6], ['#ff5fa2', ...RW_ENDS],
  ] },
  // Williams in Gulf colours: powder blue, the orange stripe down the middle
  // and along the pods, navy underneath.
  azure: { base: '#8fcbea', second: '#f47a20', rules: [
    ['#0b1f4b', ...LOWER_PODS], ['#f47a20', -2.4, 3.2, 0, 1.2, 0, 0.055],
    ['#f47a20', ...POD_STRIPE(0.39, 0.45)], ['#f47a20', -3.2, -2.18, 0.76, 0.86, 0.5, ALL],
    ['#0b1f4b', ...FW_ENDS],
  ] },
  // Haas: white, black underneath, red at each end.
  graphite: { base: '#ececec', second: '#e10600', rules: [
    ['#161616', ...LOWER_BODY], ['#e10600', ...NOSE_TIP], ['#e10600', ...RW_ENDS],
  ] },
  // Racing Bulls: white at the front, blue from the cockpit back, a red flash.
  cobalt: { base: '#f2f2f2', second: '#e4002b', rules: [
    ['#1634cc', -3.2, -0.15, 0, 1.2, 0, ALL, 0.5], ['#e4002b', -0.15, 0.02, 0, 1.2, 0, ALL, 0.5],
    ['#1634cc', ...FW_ENDS],
  ] },
  // Audi: titanium, black below, a red line.
  titan: { base: '#c7c9cc', second: '#f50537', rules: [
    ['#151515', ...LOWER_BODY], ['#f50537', ...POD_STRIPE(0.40, 0.43)], ['#f50537', ...RW_TOP],
  ] },
  // Cadillac: white over black, a gold line between.
  ivory: { base: '#f2f2f2', second: '#101010', rules: [
    ['#101010', -1.7, 0.7, 0, 0.42, 0.38, ALL], ['#c9a449', ...POD_STRIPE(0.42, 0.44)],
    ['#101010', ...NOSE_TIP], ['#101010', ...RW_ENDS],
  ] },

  // ---- the classics that are more than two colours ---------------------------
  // Lotus in JPS: gloss black, gold lines.
  lotus: { base: '#0c0c0c', second: '#d4af37', rules: [
    ['#d4af37', ...POD_STRIPE(0.40, 0.415)], ['#d4af37', 1.2, 3.2, 0, 1.2, 0, 0.025],
    ['#d4af37', -3.2, -2.18, 0.80, 0.82, 0.5, ALL], ['#d4af37', ...FW_ENDS],
  ] },
  // Brawn: white, the fluorescent yellow flash, black underneath.
  brawn: { base: '#f2f2f2', second: '#cfff1a', rules: [
    ['#111111', ...LOWER_BODY], ['#cfff1a', -1.62, 2.7, 0.36, 0.41, 0, ALL, 0.3],
    ['#cfff1a', ...RW_TOP], ['#111111', ...FW_ENDS],
  ] },
};

// Anyone without a hand-written livery gets their two colours laid out the
// way most liveries are: the main colour, a dark lower half, the second colour
// as a line down the pods and on the wing ends.
function generic(team) {
  const [pri, sec] = team.ui || [team.col, team.fg];
  const dark = '#' + new THREE.Color(pri).lerp(new THREE.Color('#0a0a0a'), 0.82).getHexString();
  return { base: pri, second: sec, rules: [
    [dark, ...LOWER_PODS], [sec, ...POD_STRIPE(0.40, 0.44)], [sec, ...RW_TOP], [sec, ...FW_ENDS],
  ] };
}

/** The livery for a team key (drivers.js TEAMS), or a plain one for `colour`. */
export function liveryFor(key, team) {
  if (key && LIVERIES[key]) return LIVERIES[key];
  if (team) return generic(team);
  return null;
}

const MAX = 10;
/**
 * Paint a material with a livery. Safe to call on a clone: the shader hook is
 * re-attached and the uniforms are this material's own. Materials with the
 * same number of rules share one compiled program.
 */
export function applyLivery(mat, liv) {
  if (!mat || !liv) return mat;
  mat.color = new THREE.Color(liv.base);
  if (liv.matte) { mat.roughness = 0.55; if ('clearcoat' in mat) mat.clearcoat = 0.25; }
  const rules = liv.rules.slice(0, MAX);
  const U = {
    uLivN: { value: rules.length },
    uLivCol: { value: Array.from({ length: MAX }, (_, i) => new THREE.Color(rules[i] ? rules[i][0] : '#000')) },
    uLivA: { value: Array.from({ length: MAX }, (_, i) => rules[i] ? new THREE.Vector4(rules[i][1], rules[i][3], rules[i][5], rules[i][7] || 0) : new THREE.Vector4()) },
    uLivB: { value: Array.from({ length: MAX }, (_, i) => rules[i] ? new THREE.Vector4(rules[i][2], rules[i][4], rules[i][6], 0) : new THREE.Vector4()) },
  };
  mat.userData.livery = liv;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCarPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCarPos;
uniform int uLivN;
uniform vec3 uLivCol[${MAX}];
uniform vec4 uLivA[${MAX}];
uniform vec4 uLivB[${MAX}];`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vec3(vCarPos.x, vCarPos.y, abs(vCarPos.z));
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uLivN) break;
    vec4 a = uLivA[i]; vec4 b = uLivB[i];
    float xs = p.x + a.w * p.y;
    if (xs >= a.x && xs <= b.x && p.y >= a.y && p.y <= b.y && p.z >= a.z && p.z <= b.z) diffuseColor.rgb = uLivCol[i];
  }
}`);
  };
  mat.customProgramCacheKey = () => 'livery';
  mat.needsUpdate = true;
  return mat;
}
