// dashfeed.mjs — the native game's line to the iPad dash.
//
// The iPad's page (dash.html) listens on a Supabase Realtime channel named by a
// six-letter code, the way js/dash.js feeds it from the browser game. The native
// game cannot speak that itself, so it starts this and writes one line of JSON
// telemetry at a time into its stdin; each line goes out as a 'tel' broadcast.
//
//   node tools/dashfeed.mjs ABC123        (the game does this; you never need to)
//
// It says so on stderr when the iPad arrives, and exits when the game closes its
// end. Nothing is sent until an iPad has said hello: no dash, no traffic.

const URL_ = 'wss://wsjrcoibrigewmwospva.supabase.co/realtime/v1/websocket';
const KEY = 'sb_publishable_n88dYo7wUYb_utwKiQT3uQ_HGOtXDZb';   // publishable: the one js/dash.js carries
const code = (process.argv[2] || '').toUpperCase();
if (!/^[A-Z0-9]{4,8}$/.test(code)) { console.error('dashfeed: usage: node tools/dashfeed.mjs CODE'); process.exit(2); }
if (process.argv.length > 3) { console.error('dashfeed: one argument, the code'); process.exit(2); }
const topic = `realtime:wdc:${code}:dash`;

let ws = null, joined = false, heard = false, ref = 0, beat = null, sent = 0, lastHello = 0;
const push = (t, event, payload) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic: t, event, payload, ref: String(++ref) })); };

function connect() {
  joined = false;
  ws = new WebSocket(`${URL_}?apikey=${KEY}&vsn=1.0.0`);
  ws.onopen = () => {
    push(topic, 'phx_join', { config: { broadcast: { self: false, ack: false }, presence: { key: '' } }, access_token: KEY });
    beat = setInterval(() => push('phoenix', 'heartbeat', {}), 25000);
  };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.topic !== topic) return;
    if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok' && !joined) { joined = true; console.error(`dashfeed: on the channel for ${code}, waiting for the iPad`); }
    else if (m.event === 'phx_reply' && m.payload && m.payload.status === 'error') console.error('dashfeed: the channel refused:', JSON.stringify(m.payload.response));
    else if (m.event === 'broadcast' && m.payload && m.payload.event === 'dash-here') { if (!heard) console.error('dashfeed: the iPad is here'); heard = true; lastHello = Date.now(); }
  };
  ws.onclose = () => { clearInterval(beat); ws = null; setTimeout(connect, 2000); };
  ws.onerror = () => { /* onclose follows, and retries */ };
}
connect();
// the page says hello every two seconds; six without one and it has gone (closed, asleep, out of range)
setInterval(() => { if (heard && Date.now() - lastHello > 6000) { heard = false; console.error('dashfeed: the iPad has gone quiet'); } }, 1000);

// one line in, one broadcast out; a line that is not JSON is dropped, loudly, once
let buf = '', warned = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line || !joined || !heard) continue;
    let t; try { t = JSON.parse(line); } catch { if (!warned) { warned = true; console.error('dashfeed: a line that is not JSON:', line.slice(0, 120)); } continue; }
    push(topic, 'broadcast', { type: 'broadcast', event: 'tel', payload: t });
    if (++sent === 1) console.error('dashfeed: telemetry is going out');
  }
});
process.stdin.on('end', () => process.exit(0));
