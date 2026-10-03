// dlc.js — circuits sold as DLC carry their own trackside set.
//
// A base circuit is dressed entirely by the shared pipeline: furniture.js,
// crowd.js, pit.js, env.js. A DLC circuit is made to be itself: its own
// grandstands, its own pit building, its own gantry and paint. A pack names
// the shared pieces it REPLACES (render.js then leaves them out), may strip
// surveyed buildings out of the env before the city is built (the ones it
// rebuilds by hand), and builds its set after the shared world is up.
//
//   pack = { replaces: Set<'boards'|'startFinish'|'flagpoles'|'marshals'|...>,
//            prepareEnv(env, track), build(view, ctx) -> stats }
import * as sepang from './dlc/sepang/index.js';

const PACKS = { sepang };

export const dlcFor = key => PACKS[key] || null;
export const isDLC = key => !!PACKS[key];
