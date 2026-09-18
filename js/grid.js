// grid.js — where the twenty-two cars stand before the lights go out.
//
// THIS MODULE IMPORTS NOTHING. That is the whole reason it exists as a file of
// its own rather than living beside the paint that draws it.
//
// The slot geometry started life inside `buildStartFinish` in furniture.js,
// which imports three.js. That made it unreachable from Node, so the headless
// race gate could not use it, and a race layer that can only be tested in a
// browser is exactly the kind of thing that hides bugs. Having it here means
// the renderer and the gate call the SAME function — which is the point. Two
// implementations of the same geometry is how `track.pit.side` came to say
// "left" about a pit lane that is 17 m to the right of the centreline.
//
// It sits under the same rule as js/physics.js: nothing renderer-shaped, so it
// runs unchanged in a browser and in plain node.
//
// Positions come back in SIM coordinates — metres along the centreline, metres
// to the LEFT of it (the sim's +y), and the heading in radians — because that
// is the frame cars are spawned in. The renderer converts; nothing else has to.
// In particular nothing here has an opinion about world height: on a banked
// section that comes from js/bank.js, applied by whatever places the car.

/**
 * The starting grid, pole first.
 *
 * Pole sits on the side the FIRST CORNER turns away from, which is the real
 * convention and worth about half a car's length into turn one. The rest
 * alternate at 8 m intervals back down the straight from 6 m behind the line,
 * so a full grid is 168 m long — worth knowing if a formation lap or a safety
 * car ever needs to know where the back of it is.
 *
 * Slots are half a track-width off centre, which keeps a metre of road either
 * side of every car even at Monaco, whose half-width is 3.8 m.
 *
 * @param {Track} track
 * @param {number} count how many slots, default a full 22-car grid
 * @returns {{n:number,s:number,lat:number,hdg:number,i:number}[]}
 */
export function gridSlots(track, count = 22) {
  const t = track;
  const first = (t.corners || [])[0];
  // corner.dir < 0 is a right-hander, so pole goes LEFT of the centreline.
  const poleSide = first && first.dir < 0 ? 1 : -1;
  const slots = [];
  for (let k = 0; k < count; k++) {
    const s = -6 - k * 8;
    const i = t.idx(s);
    slots.push({
      n: k + 1,                                            // 1 is pole
      s: t.wrap(s),                                        // metres along
      lat: (k % 2 ? -poleSide : poleSide) * t.w[i] * 0.46, // metres to the left
      hdg: t.hdg[i],
      i,
    });
  }
  return slots;
}
