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


// ---------------------------------------------------------------------------
// LOCAL MODE — the engineer with no API key and no bill.
//
// It does not understand you; it classifies you, which is most of what a real
// engineer does anyway. The numbers are real (they come from the telemetry),
// the fallback is "Copy that.", and the fallback is not a failure — it is what
// an engineer says when he is not engaging. Runs instantly and offline.
//
// This is the mode whenever there is no key. Drop a key in .env and the same
// endpoint starts answering with Claude instead, with no other change.
// ---------------------------------------------------------------------------
const pick = a => a[Math.floor(Math.random() * a.length)];

const INTENTS = [
  ['greeting', /\b(hi|hey|hello|yo|you there|radio check|can you hear|morning)\b/i, t => [
    'Hello mate, loud and clear.', 'Reading you. All good here.',
    'Hearing you fine. Head down.', 'Loud and clear. Let us know if you need anything.',
  ]],
  ['incident', /\b(ran me|pushed me|penalty|divebomb|dive bomb|hit me|took me out|off the (road|track)|dirty|unfair|steward|cameras?|that was|he just|she just)\b/i, () => [
    'Got it, checking cameras now.', 'Understood, we will report it.',
    'We saw it. Leave it with us.', 'Noted. Stewards are looking at it.',
  ]],
  ['gap', /\b(gaps?|how far|intervals?|ahead|in front|behind me|catching)\b/i, t => {
    const a = [];
    if (t.gapAhead != null) a.push(`Gap to the car ahead, ${(+t.gapAhead).toFixed(1)}.`);
    if (t.gapBehind != null) a.push(`${(+t.gapBehind).toFixed(1)} to the car behind.`);
    if (t.carAhead) a.push(`${t.carAhead} ahead${t.gapAhead != null ? `, ${(+t.gapAhead).toFixed(1)}` : ''}.`);
    return a.length ? a : ['We are checking the gaps.'];
  }],
  ['tyres', /\b(tyres?|tires?|grip|rubber|temps?)\b/i, t => {
    const a = [];
    if (t.tyre) a.push(`You are on ${t.tyre}.`);
    if (t.tf != null && t.tr != null) a.push(`Fronts ${Math.round(t.tf)}, rears ${Math.round(t.tr)}.`);
    a.push('Manage the rears, be smooth on exit.', 'Tyres are in the window. Keep them there.');
    return a;
  }],
  ['laps', /\b(laps?\s*(left|remaining|to go)|how many laps|how long|to go)\b/i, t => {
    if (t.lap != null && t.totalLaps != null) {
      const left = Math.max(0, t.totalLaps - t.lap);
      return [left <= 1 ? 'Last lap. Bring it home.' : `${left} to go.`];
    }
    return ['We will count you down.'];
  }],
  ['box', /\b(box|pit|pitting|come in|should i stop|strategy)\b/i, () => [
    'Negative, stay out. Stay out.', 'Not this lap. We will call it.',
    'Box, box, box. Box this lap.', 'Plan is to go long. Keep pushing.',
  ]],
  ['fuel', /\b(fuel|petrol|gas|saving)\b/i, t => t.fuelLaps != null
    ? [`Fuel is good for ${Math.round(t.fuelLaps)} laps.`]
    : ['Fuel is fine. Race him.', 'Lift and coast into the braking zones.']],
  ['position', /\b(position|what place|where am i|p\d)\b/i, t => t.position != null
    ? [`You are P${t.position}.`] : ['We are checking the order.']],
  ['frustration', /\b(so slow|cant|can.t|undriv|terrible|awful|hate|useless|no grip|hopeless|rubbish|shit|fuck|damn)\b/i, () => [
    'Understood. Reset, next corner.', 'It is fine. Get your rhythm back.',
    'We hear you. Head down, one lap at a time.', 'Copy. We will look at the balance.',
  ]],
  ['praise', /\b(yes+|lets go|let.s go|come on|unreal|nailed|beautiful|amazing|great|love|brilliant)\b/i, () => [
    'Lovely. Keep it there.', 'Great job mate, great job.',
    'That is the lap. Same again.', 'Well done. Stay focused.',
  ]],
  ['push', /\b(push|attack|go for it|can i (get|have|take)|overtake|drs)\b/i, () => [
    'Push now, push.', 'Mode push, mode push. This is the lap.',
    'Go for it. You have the pace.', 'Not yet. Wait for the DRS.',
  ]],
];

function localReply(text, t) {
  t = t || {};
  for (const [, re, lines] of INTENTS) {
    if (re.test(text)) {
      try { return pick(lines(t)); } catch { return 'Copy that.'; }
    }
  }
  return pick(['Copy that.', 'Understood.', 'Copy.']);
}


// ---------------------------------------------------------------------------
// OLLAMA — a real conversation, free, offline, on his own GTX 1060.
//
// The vocabulary engineer below cannot hold a conversation: it has no memory
// and cannot follow up, which is the one thing Adam asked for. A small model
// running locally can. 3B at Q4 is ~2 GB of the card's 6 GB and answers a
// thirty-token radio call in well under a second, which is the only latency
// budget that matters here — an engineer who pauses two seconds is wrong even
// when the words are right.
//
// Same system prompt and the same history as the Claude path, so the engineer
// is the same character whichever tier is live.
// ---------------------------------------------------------------------------
const OLLAMA = process.env.RADIO_OLLAMA || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.RADIO_OLLAMA_MODEL || 'llama3.2:3b';
let ollamaUp = null, ollamaCheckedAt = 0;

async function ollamaReady() {
  if (ollamaUp !== null && Date.now() - ollamaCheckedAt < 15000) return ollamaUp;
  ollamaCheckedAt = Date.now();
  try {
    const r = await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(700) });
    const j = await r.json();
    ollamaUp = !!(j.models || []).some(m => m.name === OLLAMA_MODEL || m.name.startsWith(OLLAMA_MODEL.split(':')[0]));
  } catch { ollamaUp = false; }
  return ollamaUp;
}

async function ollamaAsk() {
  const r = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [{ role: 'system', content: SYSTEM }, ...history],
      // Radio calls are one sentence. Capping it is most of the latency win,
      // and it also stops a small model rambling into a paragraph.
      options: { temperature: 0.8, num_predict: 60, stop: ['\n\n'] },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  // Small models like to wrap a line in quotes however firmly you ask them not
  // to, and a stray quote mark is something a speech engine can read aloud.
  return String((j.message && j.message.content) || '')
    .trim().split('\n')[0]
    .replace(/^["'`\u201c\u201d]+|["'`\u201c\u201d]+$/g, '')
    .trim().slice(0, 220);
}

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
  if (!key) {
    // A real conversation if a local model is up, the vocabulary if not.
    if (await ollamaReady()) {
      history.push({ role: 'user', content: `${telemetryBlock(telemetry)}\n\nDRIVER: ${text}` });
      while (history.length > 12) history.shift();
      try {
        const reply = (await ollamaAsk()) || 'Copy that.';
        history.push({ role: 'assistant', content: reply });
        return { reply, mode: 'ollama' };
      } catch (e) {
        history.pop();
        ollamaUp = null;
        return { reply: localReply(text, telemetry), mode: 'local', error: 'ollama: ' + (e.message || e) };
      }
    }
    return { reply: localReply(text, telemetry), mode: 'local' };
  }
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
    const ol = key ? false : await ollamaReady();
    return send(200, {
      ok: true, key: !!key,
      mode: key ? 'claude' : ol ? 'ollama' : 'local',
      model: key ? MODEL : ol ? OLLAMA_MODEL : 'vocabulary',
      converses: !!key || ol,
      calls, cap: MAX_CALLS,
    });
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
