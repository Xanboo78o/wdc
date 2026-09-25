#!/usr/bin/env python3
# voice.py — the radio's ears and mouth, on the laptop itself.
#
# Adam chose laptop mic + speakers over the iPad (2026-09-25). Chromium on Arch
# has no speech recognition (the Google keys are stripped) and no voices of its
# own, so both run here, locally, offline:
#
#   POST /stt   body: 16-bit mono WAV   -> {"text": "whats the gap"}
#   POST /tts   body: {"text": "..."}   -> audio/wav (22 kHz mono)
#   GET  /health                         -> {"ok": true, "stt": ..., "tts": ...}
#
# faster-whisper `base.en` on the CPU (int8) for the ears — a radio call is a
# few seconds of speech, and the GPU is busy being a race engineer (Ollama);
# piper's northern English male for the mouth.
#
# Runs in its own Python (3.12 venv at ~/.local/share/wdc-voice/venv, made by
# ~/.local/share/wdc-voice/setup.sh), because the system Python is 3.14 and
# the speech libraries have no wheels for it yet:
#
#   ~/.local/share/wdc-voice/venv/bin/python tools/voice.py
import io, json, os, sys, time, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser('~/.local/share/wdc-voice')
PORT = int(os.environ.get('VOICE_PORT', 8177))
VOICE = os.path.join(HOME, 'voices', 'en_GB-northern_english_male-medium.onnx')

stt = tts = None
try:
    from faster_whisper import WhisperModel
    stt = WhisperModel('base.en', device='cpu', compute_type='int8', cpu_threads=2,
                       download_root=os.path.join(HOME, 'models'))
except Exception as e:
    print('no speech recognition:', e, file=sys.stderr)
try:
    from piper import PiperVoice
    tts = PiperVoice.load(VOICE)
except Exception as e:
    print('no voice:', e, file=sys.stderr)

# Racing words Whisper would otherwise spell like a dictionary. It is only a
# hint — it biases, it does not force.
PROMPT = ('Radio check. Box box. What is the gap? How is my fuel? Tyres. Hammer time. '
          'Verstappen, Norris, Piastri, Leclerc, Hamilton, Russell, Antonelli, Alonso, Stroll, '
          'Gasly, Colapinto, Albon, Sainz, Hulkenberg, Bortoleto, Ocon, Bearman, Lawson, Hadjar, '
          'Lindblad, Perez, Bottas, Oscar, Lando, Max, Charles, Lewis, George, Kimi.')


class H(BaseHTTPRequestHandler):
    def _head(self, code=200, kind='application/json'):
        self.send_response(code)
        self.send_header('Content-Type', kind)
        # Only the game on this machine: it is served from localhost:8175.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        self.end_headers()

    def do_OPTIONS(self):
        self._head(204)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith('/health'):
            self._head()
            self.wfile.write(json.dumps({'ok': True, 'stt': stt is not None, 'tts': tts is not None}).encode())
        else:
            self._head(404)

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(n)
        if self.path.startswith('/stt'):
            if not stt:
                self._head(503); self.wfile.write(b'{"error":"no speech recognition"}'); return
            t0 = time.time()
            segs, _ = stt.transcribe(io.BytesIO(body), language='en', beam_size=1,
                                     initial_prompt=PROMPT, vad_filter=True)
            text = ' '.join(s.text.strip() for s in segs).strip()
            print(f'heard in {time.time() - t0:.2f}s: {text!r}', flush=True)
            self._head()
            self.wfile.write(json.dumps({'text': text}).encode())
        elif self.path.startswith('/tts'):
            if not tts:
                self._head(503); self.wfile.write(b'{"error":"no voice"}'); return
            text = str(json.loads(body or b'{}').get('text', ''))[:400]
            buf = io.BytesIO()
            with wave.open(buf, 'wb') as w:
                tts.synthesize_wav(text, w)
            self._head(200, 'audio/wav')
            self.wfile.write(buf.getvalue())
        else:
            self._head(404)


if __name__ == '__main__':
    print(f'voice on http://127.0.0.1:{PORT}  stt={stt is not None} tts={tts is not None}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
