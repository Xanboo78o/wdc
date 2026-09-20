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
import Anthropic from '@anthropic-ai/sdk';

const PORT     = +(process.env.RADIO_PORT || 8178);
const MODEL    = process.env.RADIO_MODEL || 'claude-opus-5';
const MAX_CALLS = +(process.env.RADIO_MAX_CALLS || 300);   // guard rail on prepaid credit
const MIN_GAP_MS = 900;                                    // no machine-gunning the API

const SYSTEM = `You are a Formula 1 race engineer on the pit wall, talking to your driver over team radio during a race.

How you speak:
- ONE short sentence. Usually under twelve words. Two words is often right.
- Calm and clipped. Never excited, never apologetic, never chatty.
- No emoji, no markdown, no quotation marks, no stage directions.
- Never mention being an AI, a model, or an assistant. You are the engineer.

What you do:
- If the driver asks something answerable from the TELEMETRY below, answer it with the real number and nothing else.
- If the driver complains about another driver, acknowledge it and say you are looking at it. Never argue, never take sides, never agree that it was deliberate. "Got it, checking cameras now." "Understood, we'll report it."
- If the driver is angry or swearing, stay level and bring them back to driving. Do not scold them.
- If the driver is happy or just did something good, one short warm line. "Lovely. Keep it there."
- If you cannot tell what they said or it needs information you do not have, say "Copy that." That is a complete and correct answer.

Hard rule: never invent a number. If a value is not in the TELEMETRY block, you do not know it.`;

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
  if (!key) console.warn('[radio] NO ANTHROPIC_API_KEY SET — /ask will answer "Radio is dead."');
});
