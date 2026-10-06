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
// DECIDED (Adam, 2026-10-05: "money, 5.00, 50% of on the the weekend of said
// race, no racing if no buy"):
//   - real money, $5.00 a circuit
//   - half price over the weekend that circuit's own Grand Prix is run (SALES)
//   - a circuit you have not bought cannot be raced at all: no test drive
//
// NOT BUILT, and the reason ENFORCE is still false: the till. Real money needs
// a payment account (an adult's) and a server that remembers who paid — a
// record kept in this browser is one line in the console away from "owned".
// Until that exists every pack reads as owned and the game behaves exactly as
// it did. `?dlc=locked` on home.html shows the locked state and its price.
//
// NOTHING HERE MAY IMPORT A RENDERER OR THE DOM: the menus read it, and so
// will a harness.
import { TRACKS } from './tracks.js';

// One entry per pack. Prices are in US dollars.
const PRICE = { amount: 5.00, unit: 'USD' };
export const CATALOG = {
  sepang: {
    kind: 'circuit', track: 'sepang', title: 'Sepang International Circuit', country: 'MALAYSIA',
    since: '2026-10-03', price: PRICE,
    has: ['surveyed circuit', 'its own grandstands, paddock and gantry', 'two songs'],
  },
  spa: {
    kind: 'circuit', track: 'spa', title: 'Circuit de Spa-Francorchamps', country: 'BELGIUM',
    since: '2026-10-05', price: PRICE,
    has: ['surveyed circuit', 'Eau Rouge and Raidillon on the 0.5 m laser survey'],
  },
};

// HALF PRICE ON THE WEEKEND OF SAID RACE: Friday to Sunday of the circuit's own
// Grand Prix, by the buyer's calendar. Dates are the published ones and are
// added a season at a time — a weekend that is not listed is not a sale.
//   spa     Formula 1 Belgian Grand Prix, 23-25 July 2027 (2026's was 17-19 July, gone)
//   sepang  Formula 1 left in 2017; the Grand Prix run there is MotoGP's
//           Malaysian round, 30 October - 1 November 2026. That it counts as
//           "said race" is my reading, not his word.
export const SALE_PCT = 50;
export const SALES = {
  spa: [['2027-07-23', '2027-07-25', 'BELGIAN GRAND PRIX']],
  sepang: [['2026-10-30', '2026-11-01', 'MALAYSIAN GRAND PRIX']],
};
const day = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function saleFor(pack, now = new Date()) {
  const t = day(now);
  const w = (SALES[pack] || []).find(([a, b]) => t >= a && t <= b);
  return w ? { pct: SALE_PCT, why: w[2], until: w[1] } : null;
}

// Flip this when there is a till. One line, on purpose.
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
// What it costs right now: { amount, unit, full, sale } — `full` is the
// list price, `sale` is null or { pct, why, until }. In cents, so half of
// $5.00 is $2.50 and not 2.4999.
export function priceOf(pack, now = new Date()) {
  const p = shop && shop.price ? shop.price(pack) : CATALOG[pack]?.price ?? null;
  if (!p) return null;
  const sale = saleFor(pack, now);
  const cents = Math.round(p.amount * 100), due = sale ? Math.round(cents * (100 - sale.pct) / 100) : cents;
  return { amount: due / 100, unit: p.unit, full: p.amount, sale };
}
export const priceLabel = (pack, now = new Date()) => { const p = priceOf(pack, now); return p ? `$${p.amount.toFixed(2)}` : ''; };
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
