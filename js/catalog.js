// catalog.js — what is sold, and who owns it. GROUNDWORK: nothing is for sale yet.
//
// Adam, 2026-10-03: Sepang "will be a dlc ... bought in game". 2026-10-05:
// "groundwork for a dlc update. Spa will be dlc". Two circuits are DLC now and
// until today the only thing that knew it was js/dlc.js, which is about how a
// circuit is DRESSED, not about who may drive it.
//
// This file is the other half, and it is deliberately the whole of it:
//
//   CATALOG      what exists to be owned: one entry per pack
//   owns / locked / grant / revoke
//                the entitlement record, kept in this browser
//   setStore     where a real shop plugs in (prices, buy) — there is none yet
//
// WHAT IS NOT DECIDED, and so is not built: the currency, the prices, whether
// a locked circuit can be test-driven, and whether ownership follows an
// account or a machine. Until then ENFORCE is false and every pack reads as
// owned, so the game behaves exactly as it did. `?dlc=locked` on home.html
// shows the locked state, for looking at.
//
// NOTHING HERE MAY IMPORT A RENDERER OR THE DOM: the menus read it, and so
// will a harness.
import { TRACKS } from './tracks.js';

// One entry per pack. `price` is null until there is a currency to put it in.
export const CATALOG = {
  sepang: {
    kind: 'circuit', track: 'sepang', title: 'Sepang International Circuit', country: 'MALAYSIA',
    since: '2026-10-03', price: null,
    has: ['surveyed circuit', 'its own grandstands, paddock and gantry', 'two songs'],
  },
  spa: {
    kind: 'circuit', track: 'spa', title: 'Circuit de Spa-Francorchamps', country: 'BELGIUM',
    since: '2026-10-05', price: null,
    has: ['surveyed circuit', 'Eau Rouge and Raidillon on the 0.5 m laser survey'],
  },
};

// Flip this when there is a shop. One line, on purpose.
export const ENFORCE = false;

const KEY = 'wdc.dlc';
const mem = { v: 1, owned: {} };
const store = () => (typeof localStorage === 'undefined' ? null : localStorage);
function load() {
  try { const j = JSON.parse(store()?.getItem(KEY) || 'null'); if (j && j.owned) Object.assign(mem.owned, j.owned); } catch { /* a fresh start */ }
}
function save() { try { store()?.setItem(KEY, JSON.stringify(mem)); } catch { /* private window */ } }
load();

// `?dlc=locked` (preview): enforce for this page view, own nothing.
let preview = false;
export function previewLocked(on) { preview = !!on; }

export const packOf = trackKey => Object.keys(CATALOG).find(k => CATALOG[k].track === trackKey) || null;
export const isDLC = trackKey => !!packOf(trackKey);
export const owns = pack => !!CATALOG[pack] && !preview && (!ENFORCE || !!mem.owned[pack]);
// A circuit you may not race: it is in a pack, the shop is open, and you do not own the pack.
export const locked = trackKey => { const p = packOf(trackKey); return !!p && !owns(p); };

// `how` is recorded so a refund, a gift and a purchase can be told apart later.
export function grant(pack, how = 'grant') {
  if (!CATALOG[pack]) throw new Error('no such pack ' + pack);
  mem.owned[pack] = { at: new Date().toISOString(), how };
  save();
}
export function revoke(pack) { delete mem.owned[pack]; save(); }
export const owned = () => Object.keys(CATALOG).filter(owns);

// The shop, when there is one: { price(pack) -> { amount, unit } | null,
// buy(pack) -> Promise<boolean> }. buy() resolving true is what grants.
let shop = null;
export function setStore(s) { shop = s; }
export const priceOf = pack => (shop && shop.price ? shop.price(pack) : CATALOG[pack]?.price ?? null);
export async function buy(pack) {
  if (!shop || !shop.buy) return false;
  const ok = await shop.buy(pack);
  if (ok) grant(pack, 'purchase');
  return !!ok;
}

// Every catalogued circuit must be on the menu, or it can be sold and not driven.
for (const [k, p] of Object.entries(CATALOG)) {
  if (p.kind === 'circuit' && !TRACKS.some(t => t[0] === p.track)) throw new Error(`catalog: ${k} sells a circuit that is not in js/tracks.js`);
}
