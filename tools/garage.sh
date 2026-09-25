#!/bin/bash
# garage.sh — start everything the game talks to on this laptop, once.
#
#   tools/ffb.py      :8179  force feedback + the rim buttons Chrome cuts off
#   tools/radio.mjs   :8178  the race engineer's brain (Ollama on the GPU)
#   tools/voice.py    :8177  the radio's ears and mouth (Whisper + Piper)
#   tools/serve.mjs   :8175  the game itself
#
# Anything already running is left alone. Logs go to /tmp/wdc-*.log.
#   tools/garage.sh          start what is missing
#   tools/garage.sh status   what is up
cd "$(dirname "$0")/.." || exit 1
VENV=~/.local/share/wdc-voice/venv/bin/python
up() { curl -s -m 2 -o /dev/null "http://127.0.0.1:$1/${2:-}" ; }

check() {
  for p in 8175 8177 8178 8179; do
    if up $p health || up $p; then echo "  :$p up"; else echo "  :$p DOWN"; fi
  done
}
if [ "$1" = status ]; then check; exit 0; fi

up 8175 || { nohup node tools/serve.mjs 8175 > /tmp/wdc-serve.log 2>&1 & echo "game      :8175"; }
up 8179 || { nohup python3 tools/ffb.py --max 0.5 > /tmp/wdc-ffb.log 2>&1 & echo "wheel     :8179  (force feedback at 50%)"; }
up 8178 health || { nohup node tools/radio.mjs > /tmp/wdc-radio.log 2>&1 & echo "engineer  :8178"; }
if [ -x "$VENV" ]; then
  up 8177 health || { nohup "$VENV" tools/voice.py > /tmp/wdc-voice.log 2>&1 & echo "voice     :8177  (takes a few seconds to load)"; }
else
  echo "voice     not installed — run ~/.local/share/wdc-voice/setup.sh"
fi
sleep 3
check
echo "game: http://localhost:8175/index.html"
