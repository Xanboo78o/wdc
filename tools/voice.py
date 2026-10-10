#!/usr/bin/env python3
# voice.py — the radio's ears and mouth, on the laptop itself.
#
# Adam chose laptop mic + speakers over the iPad (2026-09-25). Chromium on Arch
# has no speech recognition (the Google keys are stripped) and no voices of its
# own, so both run here, locally, offline:
#
#   POST /stt   body: 16-bit mono WAV   -> {"text": "whats the gap"}
#   POST /tts   body: {"text": "...", "voice": "bm_george", "speed": 1.1}
#                                        -> audio/wav (mono; 24 kHz Kokoro, 22 kHz piper)
#   GET  /voices                         -> {"voices": [...], "default": "..."}
#   GET  /health                         -> {"ok": true, "stt": ..., "tts": ...}
#
# faster-whisper `base.en` on the CPU (int8) for the ears — a radio call is a
# few seconds of speech, and the GPU is busy being a race engineer (Ollama);
# piper's northern English male for the mouth.
#
# 2026-10-10, "give him a frfr tts": KOKORO (82M, ~/.local/share/wdc-voice/kokoro)
# sounds like a person, where piper sounds like a sat-nav. But MEASURED on this
# laptop's CPU with a race running: 5.8 s to say a 1.9 s line, 16.6 s for a 6.5 s
# one. A radio call that late is wrong by the time it arrives. So Kokoro is the
# default mouth ONLY when it is running on the GTX 1060 (onnxruntime-gpu, which
# ~/.local/share/wdc-voice/more-voices.sh installs); until then piper speaks,
# in a tenth of the time, and Kokoro is still there if a request names a voice.
#
# VOICES: "piper" (the northern English one), any other piper voice by a word of
# its file name ("ryan", "alan", "joe" — voices/*.onnx), or a Kokoro name
# ("bm_george", "am_fenrir", ...). The voice a request does not name is
# ~/.local/share/wdc-voice/voice.txt (one line: "ryan 1.1" — name, speed), so
# the pick is made once, by ear, and both games get it.
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

kok = None
try:
    import numpy as np
    import onnxruntime as ort
    from kokoro_onnx import Kokoro
    so = ort.SessionOptions()
    so.intra_op_num_threads = 2          # a race is being drawn on the other two
    gpu = 'CUDAExecutionProvider' in ort.get_available_providers()
    if gpu and hasattr(ort, 'preload_dlls'):
        ort.preload_dlls()               # CUDA and cuDNN from the pip wheels beside it
    full = os.path.join(HOME, 'kokoro', 'kokoro-v1.0.onnx')
    sess = ort.InferenceSession(full if gpu and os.path.exists(full) else os.path.join(HOME, 'kokoro', 'kokoro-v1.0.int8.onnx'), so,
                                providers=(['CUDAExecutionProvider'] if gpu else []) + ['CPUExecutionProvider'])
    kok = Kokoro.from_session(sess, os.path.join(HOME, 'kokoro', 'voices-v1.0.bin'))
    kok_fast = 'CUDAExecutionProvider' in sess.get_providers()
except Exception as e:
    kok_fast = False
    print('no kokoro (piper speaks):', e, file=sys.stderr)

pipers = {}                              # a word of the file name -> a loaded voice


def piper_voice(name):
    if name in pipers:
        return pipers[name]
    import glob
    hit = None if name == 'piper' else next((f for f in sorted(glob.glob(os.path.join(HOME, 'voices', '*.onnx'))) if name.lower() in os.path.basename(f).lower()), None)
    pipers[name] = PiperVoice.load(hit) if hit else tts
    return pipers[name]


def piper_names():
    import glob
    out = []
    for f in sorted(glob.glob(os.path.join(HOME, 'voices', '*.onnx'))):
        w = os.path.basename(f).split('-')
        out.append('piper' if f == VOICE else w[1] if len(w) > 1 else w[0])
    return out


def chosen():
    try:
        w = open(os.path.join(HOME, 'voice.txt')).read().split()
        return w[0], float(w[1]) if len(w) > 1 else 1.1
    except Exception:
        return ('bm_george', 1.1) if kok and kok_fast else ('piper', 1.1)


def speak(text, voice=None, speed=None):
    dv, ds = chosen()
    voice = voice or dv
    speed = float(speed or ds)
    buf = io.BytesIO()
    if kok and len(voice) > 3 and voice[2] == '_':
        pcm, rate = kok.create(text, voice=voice, speed=max(0.6, min(1.6, speed)),
                               lang='en-gb' if voice.startswith('b') else 'en-us')
        with wave.open(buf, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
            w.writeframes((np.clip(pcm, -1, 1) * 32767).astype('<i2').tobytes())
    elif tts:
        from piper import SynthesisConfig
        with wave.open(buf, 'wb') as w:
            piper_voice(voice).synthesize_wav(text, w, SynthesisConfig(length_scale=1 / max(0.6, min(1.6, speed))))
    else:
        return None
    return buf.getvalue()


# NO PROMPT. A list of driver names here made Whisper invent them: Adam's
# transmission came back "Ok, Antonelli." and "what's the gap" as "Box the
# gap" (2026-09-25, "im not kimi"). Names are matched loosely in
# js/engineer.js instead, so a misheard surname still finds its driver.
PROMPT = None


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
            self.wfile.write(json.dumps({'ok': True, 'stt': stt is not None, 'tts': tts is not None or kok is not None,
                                         'kokoro': kok is not None, 'kokoroOnGpu': bool(kok and kok_fast), 'voice': chosen()[0]}).encode())
        elif self.path.startswith('/voices'):
            self._head()
            names = (piper_names() if tts else []) + (sorted(v for v in kok.get_voices() if v[0] in 'ab') if kok else [])
            self.wfile.write(json.dumps({'voices': names, 'default': chosen()[0]}).encode())
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
            j = json.loads(body or b'{}')
            t0 = time.time()
            try:
                out = speak(str(j.get('text', ''))[:400], j.get('voice'), j.get('speed'))
            except Exception as e:
                print('tts failed:', e, file=sys.stderr, flush=True); out = None
            if not out:
                self._head(503); self.wfile.write(b'{"error":"no voice"}'); return
            print(f'spoke in {time.time() - t0:.2f}s: {str(j.get("text", ""))[:60]!r}', flush=True)
            self._head(200, 'audio/wav')
            self.wfile.write(out)
        else:
            self._head(404)


def warm():
    # The first call pays for loading everything: 12.3 s measured, against
    # 1.6 s warm. Pay it here, at startup, not on the first call of a race.
    if stt:
        import numpy as np
        list(stt.transcribe(np.zeros(16000, dtype=np.float32), language='en', beam_size=1)[0])
    try:
        speak('Radio check.')
    except Exception as e:
        print('voice warm-up failed:', e, file=sys.stderr)


if __name__ == '__main__':
    warm()
    print(f'voice on http://127.0.0.1:{PORT}  stt={stt is not None} tts={tts is not None} kokoro={kok is not None} voice={chosen()[0]}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
