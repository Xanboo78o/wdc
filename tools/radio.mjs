// radio.mjs — the race engineer's brain. Runs on the PC, holds the API key.
//
// Why a server at all: wheel.html is served from GitHub Pages over HTTPS (iOS
// only hands motion sensors to a secure page), so the phone cannot fetch an
// http:// localhost URL — mixed content. And a browser must never hold an API
// key. So the phone speaks to the GAME over the existing Supabase channel, and
// the game page (plain http on :8175) calls this server, which is the only
// thing that ever sees ANTHROPIC_API_KEY.
//
//   phone  --radio-said-->  game  --POST /ask-->  radio.mjs  -->  Claude
//   phone  <--radio-reply--  game  <---reply----
//
// Run:  ANTHROPIC_API_KEY=sk-ant-... node tools/radio.mjs
// Test: curl -s localhost:8178/health | jq

import http from 'node:http';
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

// A key you have to remember to type is a key you will forget to type, and the
// failure looks exactly like the radio being broken. Drop it in .env once.
// (.env is gitignored — it must never be committed.)
try {
  for (const line of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* no .env, fine */ }

const PORT     = +(process.env.RADIO_PORT || 8178);
const MODEL    = process.env.RADIO_MODEL || 'claude-opus-5';
const MAX_CALLS = +(process.env.RADIO_MAX_CALLS || 300);   // guard rail on prepaid credit
const MIN_GAP_MS = 900;                                    // no machine-gunning the API

const SYSTEM = `You are the race engineer for car 78 in a single-seater championship. Your driver is in the car right now. You are on the pit wall with his full telemetry in front of you. Everything you say goes out over team radio, into his ear, at 300 km/h.

## How you talk
- ALWAYS answer. Every single transmission gets a reply, including "hello", a joke, swearing, or something with nothing to do with racing. Silence is never an option and neither is refusing.
- One or two short sentences. Usually under fifteen words. Sometimes two words.
- Calm, clipped, British paddock register. Never excited, never apologetic, never chatty.
- No emoji, no markdown, no asterisks, no stage directions, no quote marks.
- Never mention being an AI, a model or an assistant. You are his engineer.
- If he just says hello, say hello back like a human on a radio and get on with it.

## Strategy — when to say what
- BOX: call "Box, box, box" when the tyres are past their window, there is damage, a safety car makes the stop cheap, or the undercut is on. Say which tyre he is getting. If he asks and the answer is no, "Stay out, stay out."
- UNDERCUT: a rival close behind with clean air is a threat. Pit first and tell him the out-lap is everything. "Push now, this is the lap."
- OVERCUT: if a rival stops first and he has clear track, keep him out. "Stay out, we're going long."
- SAFETY CAR: a safety car is a free pit stop. "Safety car. Box this lap, box this lap."
- TYRES: below the window, "weave, build some temperature". Above it, "short-shift, cool them". High degradation, "manage the rears, be smooth on exit".
- FUEL: behind target, "lift and coast into the braking zones". On target, "fuel is fine, race him."
- DRS: inside a second at the detection point means DRS next lap. Tell him.
- TRAFFIC: blue flags for the car being lapped; tell him where he will catch them.
- TRACK LIMITS: warn once, then tell him it is a black-and-white flag.
- RACECRAFT: name where the rival is weak and where to defend. "He's quicker in sector two. Defend the inside into one."
- ENDGAME: count him down. "Five to go." "Two to go." "Last lap, bring it home."

## When he is not asking a question
- COMPLAINING ABOUT ANOTHER DRIVER: acknowledge and say you are looking at it. Never argue, never agree it was deliberate, never take sides. "Got it, checking cameras now." "Understood, we'll report it."
- ANGRY OR SWEARING: stay level, bring him back to the lap. Never scold him.
- AFTER A MISTAKE: reset him. "It's fine. Next corner."
- HAPPY, OR HE DID SOMETHING GOOD: one short warm line. "Lovely. Keep it there."
- OFF-TOPIC OR NONSENSE: answer it anyway, briefly, in character, then point him back at the race.

## The one hard rule
Never invent a number. The TELEMETRY block is everything you know. If he asks for something that is not in it, say so the way an engineer would — "We're checking that." — and never guess a value.

"Copy that." is only for a transmission you genuinely could not make out. It is not a default answer.`;

const key = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const client = new Anthropic();          // resolves key/profile from the environment
let calls = 0, lastAt = 0;
const history = [];                      // recent exchanges, so he doesn't repeat himself

function telemetryBlock(t) {
  if (!t || typeof t !== 'object') return 'TELEMETRY: (none available)';
  const rows = Object.entries(t)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `  ${k}: ${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}`);
  return rows.length ? 'TELEMETRY (the only facts you have):\n' + rows.join('\n')
                     : 'TELEMETRY: (none available)';
}

async function ask(text, telemetry) {
  const now = Date.now();
  if (now - lastAt < MIN_GAP_MS) return { reply: 'Stand by.', throttled: true };
  lastAt = now;
  if (calls >= MAX_CALLS) return { reply: 'Copy that.', capped: true };
  // Say the radio is DEAD, never a plausible "Copy that." — a wrong answer that
  // sounds right is worse than no answer, because you stop trusting the working ones.
  if (!key) return { reply: 'Radio is dead.', error: 'no ANTHROPIC_API_KEY set' };
  calls++;

  history.push({ role: 'user', content: `${telemetryBlock(telemetry)}\n\nDRIVER: ${text}` });
  while (history.length > 12) history.shift();        // keep it cheap

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 200,                                 // radio calls are one sentence
      system: SYSTEM,
      output_config: { effort: 'low' },                // latency matters more than depth here
      messages: history,
    });
    if (res.stop_reason === 'refusal') { history.pop(); return { reply: 'Copy that.' }; }
    const reply = res.content.filter(b => b.type === 'text').map(b => b.text).join(' ').trim()
      || 'Copy that.';
    history.push({ role: 'assistant', content: reply });
    return { reply, usage: res.usage, model: res.model };
  } catch (e) {
    history.pop();
    if (e instanceof Anthropic.AuthenticationError) return { reply: 'Radio is dead.', error: 'bad or missing API key' };
    if (e instanceof Anthropic.RateLimitError)      return { reply: 'Stand by.',      error: 'rate limited' };
    if (e instanceof Anthropic.APIConnectionError)  return { reply: 'Radio is dead.', error: 'cannot reach the API (offline?)' };
    if (e instanceof Anthropic.APIError)            return { reply: 'Copy that.',     error: `API ${e.status}: ${e.message}` };
    const m = String(e && e.message || e);
    if (/auth|api[_ -]?key|credential/i.test(m)) return { reply: 'Radio is dead.', error: m };
    return { reply: 'Copy that.', error: m };
  }
}

// Only the game page and the test page may call this — it spends real money,
// and a random website should not be able to reach it just because it is local.
function allowed(origin) {
  if (!origin) return true;                            // curl
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const ok = allowed(origin);
  if (ok && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (!ok) return res.writeHead(403).end('origin not allowed');

  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.url === '/health') {
    return send(200, { ok: true, key: !!key, model: MODEL, calls, cap: MAX_CALLS });
  }
  if (req.method === 'POST' && req.url === '/ask') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', async () => {
      let p = {};
      try { p = JSON.parse(body || '{}'); } catch { return send(400, { error: 'bad json' }); }
      const text = String(p.text || '').slice(0, 500).trim();
      if (!text) return send(400, { error: 'no text' });
      const out = await ask(text, p.telemetry);
      if (out.error) console.warn('[radio]', out.error);
      console.log(`[radio] ${calls}/${MAX_CALLS}  "${text}"  ->  "${out.reply}"`);
      send(200, out);
    });
    return;
  }
  send(404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[radio] listening on http://127.0.0.1:${PORT}  model=${MODEL}  cap=${MAX_CALLS}`);
  if (!key) console.warn(`
  ==========================================================
   NO API KEY. The engineer cannot say anything at all.
   Every transmission will come back "Radio is dead."

   Fix it once, and never type it again:
       echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
       node tools/radio.mjs

   (.env is gitignored. Check it worked: curl -s localhost:${PORT}/health)
  ==========================================================
`);
}).on('error', e => {
  // A second copy of this server silently losing the port looks EXACTLY like
  // a broken radio: the page keeps talking to whichever one got there first.
  if (e.code === 'EADDRINUSE') {
    console.error(`[radio] PORT ${PORT} IS ALREADY IN USE — another radio.mjs is already running.`);
    console.error(`[radio] That one answers the game, not this one. Stop it first:`);
    console.error(`[radio]     kill $(fuser -n tcp ${PORT} 2>/dev/null)`);
    process.exit(1);
  }
  throw e;
});
