#!/usr/bin/env bash
# check.sh — is the native sim still the same simulation as the JS?
#
# Runs the Node tools and the native ones on the same cases and compares the
# tables. Run it after touching anything in native/src that is not the renderer,
# and after any change to js/physics.js, track.js, line.js, autopilot.js,
# collide.js, aero.js or parts.js — a change there has to be carried across.
#
#   native/check.sh            the usual matrix (about a minute, niced)
#   native/check.sh --quick    two cases
#
# Two instruments, because one of them is weak:
#
# TRACE  the game loop (solved aero map, surface drag, barriers, damage, parts)
#        with the reference driver, position printed to the nanometre every
#        second. The two builds must agree to a millimetre for the first 25 s.
#        THIS is the gate. A port bug parts the two at once and by metres.
# LAPS   tools/drive.mjs against xbr-drive. IDENTICAL, or CLOSE when the best
#        laps agree within 1%. Only a sanity check, and here is why: the two
#        builds share every line of arithmetic but not a maths library, and the
#        sim is chaotic. Measured: Spa and Zandvoort agree to the NANOMETRE for
#        44-52 s, part by 1e-9 m, and are 0.2-0.3 s apart by the end of lap two.
#        A lap time cannot tell that drift from a wrong constant; the trace can.
#
# Exit status is the number of FAILs.
#
# THIS GATE HAS BEEN WATCHED FAILING: F1 mu 1.91 -> 1.90 in physics.cpp fails
# every F1 trace. What it CANNOT see: the renderer, the devices, the sound, and
# anything the reference driver never does (reverse, a lost wheel, a puncture).
set -u
cd "$(dirname "$0")/.."
BIN=native/build
[ -x $BIN/xbr-drive ] || { echo "build first: make -C native"; exit 2; }

if [ "${1:-}" = "--quick" ]; then
  LAPS=("monza 2 f1 hard")
  GAME=("monza 40 f1 hard" "monaco 30 f1 hard")
elif [ $# -gt 0 ]; then
  echo "check.sh: unknown argument $1"; exit 2
else
  LAPS=("monza 2 f1 all" "monza 2 f4 hard" "spa 2 f1 hard" "suzuka 2 f4 medium" "zandvoort 2 f1 hard"
        "monaco 2 gt3 hard" "kate 2 f4 casual" "sepang 2 gt3 medium")
  # monaco f1 hard hits the wall at Massenet at 19 s (in the JS too): that case
  # is here to put contact, damage, a lost wing and the parts model in the trace
  GAME=("monza 40 f1 hard" "monaco 30 f1 hard" "spa 40 gt3 medium" "zandvoort 40 f4 medium" "kate 40 f4 casual"
        "suzuka 40 f1 supercasual")
fi

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fails=0

# best laps of a drive table, in seconds, one per row
laps() { awk '/^(SUPERCASUAL|CASUAL|MEDIUM|HARD)/ { split($2, p, ":"); print (p[2] == "" ? -1 : p[1] * 60 + p[2]) }' "$1"; }

for c in "${GAME[@]}"; do
  nice node native/check/ref-game.mjs $c 1 > "$T/js" 2> "$T/jserr" || { echo "FAIL       trace $c   (node reference failed: $(head -1 "$T/jserr"))"; fails=$((fails + 1)); continue; }
  nice $BIN/xbr-drive --game $c 1 > "$T/cc" 2> "$T/ccerr" || { echo "FAIL       trace $c   (native tool failed: $(head -1 "$T/ccerr"))"; fails=$((fails + 1)); continue; }
  # rows judged, worst gap (m) in the first 25 s, when the gap first passed 1 mm, hits at the end
  r=$(paste "$T/js" "$T/cc" | awk '$1 ~ /^[0-9.]+$/ && NF == 16 { dx = $7 - $15; dy = $8 - $16; d = sqrt(dx * dx + dy * dy); if ($1 <= 25) { n++; if (d > m) m = d } if (d > 0.001 && !first) first = $1; hj = $6; hc = $14 } END { printf "%d %.9f %s %d %d", n, m, (first ? first : "-"), hj, hc }')
  set -- $r
  note="worst gap in 25 s: $2 m; first past 1 mm: ${3} s; wall hits $4/$5"
  if [ "$1" -ge 25 ] && awk -v d="$2" 'BEGIN { exit !(d <= 0.001) }'; then echo "EXACT      trace $c   ($note)"
  else echo "FAIL       trace $c   ($note)"; diff "$T/js" "$T/cc" | head -8; fails=$((fails + 1)); fi
done

for c in "${LAPS[@]}"; do
  nice node tools/drive.mjs $c > "$T/js" 2> "$T/jserr" || { echo "FAIL       laps  $c   (node tool failed: $(head -1 "$T/jserr"))"; fails=$((fails + 1)); continue; }
  nice $BIN/xbr-drive $c > "$T/cc" 2> "$T/ccerr" || { echo "FAIL       laps  $c   (native tool failed: $(head -1 "$T/ccerr"))"; fails=$((fails + 1)); continue; }
  if cmp -s "$T/js" "$T/cc"; then echo "IDENTICAL  laps  $c"; continue; fi
  # worst relative difference between best laps, in percent; 999 if a row is missing on one side
  d=$(paste <(laps "$T/js") <(laps "$T/cc") | awk 'BEGIN { m = 0 } { if (NF != 2 || $1 <= 0 || $2 <= 0) { m = ($1 == $2 && NF == 2 ? m : 999); next } d = ($1 - $2) / $1 * 100; if (d < 0) d = -d; if (d > m) m = d } END { printf "%.2f", m }')
  rows_js=$(laps "$T/js" | wc -l); rows_cc=$(laps "$T/cc" | wc -l)
  if [ "$rows_js" -gt 0 ] && [ "$rows_js" = "$rows_cc" ] && awk -v d="$d" 'BEGIN { exit !(d <= 1.0) }'; then
    echo "CLOSE      laps  $c   (best laps within ${d}%)"
  else
    echo "FAIL       laps  $c   (best laps differ by ${d}%)"; diff "$T/js" "$T/cc" | head -12; fails=$((fails + 1))
  fi
done

echo
[ $fails -eq 0 ] && echo "native sim matches the JS on every case" || echo "$fails case(s) FAILED"
exit $fails
