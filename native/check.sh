#!/usr/bin/env bash
# check.sh — is the native sim still the same simulation as the JS?
#
# Runs the Node tools and the native ones on the same cases and compares the
# tables. Run it after touching anything in native/src that is not the renderer,
# and after any change to js/physics.js, track.js, line.js, autopilot.js,
# collide.js, aero.js or parts.js — or to the race layer: js/race.js,
# pitstop.js, safetycar.js, drivers.js, grid.js, xingus.js — a change there has
# to be carried across.
#
#   native/check.sh            the usual matrix (about a minute and a half, niced)
#   native/check.sh --quick    a few cases of each
#
# Three instruments, because one of them is weak:
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
# RACE   a whole race (native/check/ref-race.mjs against xbr-race --trace): every
#        car's position to the nanometre every second, and every race-control
#        event. Agree to a millimetre, with identical events, for `@N` seconds —
#        OR UNTIL TWO CARS FIRST TOUCH, whichever comes first, and that needs
#        saying why. js/collide.js resolveCars puts the contact at the corner of
#        each car furthest along the contact normal; when the normal is one of
#        the car's own axes two corners tie, and which wins is decided in the
#        last bit. Measured (Suzuka, F4, 12 cars, seed 3, 14.8 s): the two builds
#        arrive 4e-12 m apart and leave with impulses of 278 and 25 N s. Both are
#        right; the same function gives the same answer for the same input in
#        both languages. So a touch is where the nanometre ends, in the JS as
#        much as here, and the gate judges up to it. The cases are chosen so that
#        most of them never touch: 22 cars at Monza agree to a NANOMETRE for 57 s
#        and to a millimetre for 283 s; a red flag, the pit lane and a standing
#        restart agree to a micrometre for the 300 s they are judged.
#        A case that touches before it has been judged for 10 s FAILS as useless.
#
# Exit status is the number of FAILs.
#
# THIS GATE HAS BEEN WATCHED FAILING: F1 mu 1.91 -> 1.90 in physics.cpp fails
# every F1 trace; the car-following headway 0.28 -> 0.29 in race.cpp racecraft
# fails nine RACE cases, and a pit-lane constant fails the ones with a stop.
# What it CANNOT see: the renderer, the devices, the sound, anything the
# reference driver never does (reverse, a lost wheel, a puncture), and anything
# in a race after its cars have touched — which is most of a real race: the
# closing laps of a safety-car queue, a red flag with a full grid, a restart.
set -u
cd "$(dirname "$0")/.."
BIN=native/build
[ -x $BIN/xbr-drive ] && [ -x $BIN/xbr-race ] || { echo "build first: make -C native sim"; exit 2; }

if [ "${1:-}" = "--quick" ]; then
  LAPS=("monza 2 f1 hard")
  GAME=("monza 40 f1 hard" "monaco 30 f1 hard")
  RACE=("monza f1 3 22 medium --seed 1 @30" "speedway gt3 4 4 hard --seed 4 --rolling 0 @50"
        "monaco f1 3 10 medium --seed 2 --player 1 --input floor --aero @60")
elif [ $# -gt 0 ]; then
  echo "check.sh: unknown argument $1"; exit 2
else
  LAPS=("monza 2 f1 all" "monza 2 f4 hard" "spa 2 f1 hard" "suzuka 2 f4 medium" "zandvoort 2 f1 hard"
        "monaco 2 gt3 hard" "kate 2 f4 casual" "sepang 2 gt3 medium")
  # monaco f1 hard hits the wall at Massenet at 19 s (in the JS too): that case
  # is here to put contact, damage, a lost wing and the parts model in the trace
  GAME=("monza 40 f1 hard" "monaco 30 f1 hard" "spa 40 gt3 medium" "zandvoort 40 f4 medium" "kate 40 f4 casual"
        "suzuka 40 f1 supercasual")
  # `@N`: judged for N s of race time, or to the first touch. What each is for:
  RACE=(
    "monza f1 3 22 medium --seed 1 @60"                       # a full grid, pits and rules on, nobody touches
    "suzuka f4 5 12 hard --seed 3 @25"                        # they touch at 14.8 s: judged to 14
    "speedway gt3 6 18 medium --seed 2 @60"                   # stock rules: out of the pits in fives, the formation
    "speedway gt3 4 4 hard --seed 4 --rolling 0 @50"          # ...and from the grid: a whole pit stop, a speeding penalty
    "heilrx f4 4 10 medium --seed 5 @100"                     # a joker lap owed, gravel road, banking
    "monza f1 6 8 medium --seed 1 --player 4 @280"            # YOU, parked on the grid: round you, then four minutes of safety car and its queue
    "monza f1 4 8 medium --seed 1 --player 1 --input floor @300"   # jump start, the wall at turn one, and a WHOLE safety car: truck, in this lap, the restart
    "monaco f1 3 10 medium --seed 2 --player 1 --input floor --aero @90"    # the same at Monaco with the solved aero map, and a rival in the wall under it
    "monza f1 5 4 hard --seed 9 --rainat 20 @300"             # rain: red flag, the pit lane, garages, a standing restart
    "heilgrand gt3 3 8 medium --seed 6 --xingus rally --player 1 --input floor @45"   # Xingus handling, snow, no race control
    "speedway f1 5 6 medium --seed 3 --rolling 0 --player 2 --input floor --xingus gt @45"   # Xingus on the oval: tyre stints, gCap
    "spa f1 3 20 supercasual --seed 8 --battle hard --player 1 --input floor --nodnf @100"   # the OVERTAKES band and its leash
    "zandvoort f4 3 14 casual --seed 4 --battle medium --player 7 --standin @80"   # a stand-in at your wheel, the duel trim
    "sepang gt3 4 16 medium --seed 11 --aero --wet 0.6 --pits 0 --rules 0 @25"   # the race before race control, in the wet
  )
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

for full in "${RACE[@]}"; do
  c=${full% @*}; W=${full##*@}
  nice node native/check/ref-race.mjs $c --trace 1 --time $W > "$T/js" 2> "$T/jserr" || { echo "FAIL       race  $c   (node reference failed: $(head -1 "$T/jserr"))"; fails=$((fails + 1)); continue; }
  nice $BIN/xbr-race $c --trace 1 --time $W > "$T/cc" 2> "$T/ccerr" || { echo "FAIL       race  $c   (native tool failed: $(head -1 "$T/ccerr"))"; fails=$((fails + 1)); continue; }
  # when two cars first touched, in each build ("-" = never)
  cj=$(awk '$1 == "CONTACT" { print $2 }' "$T/js"); cc=$(awk '$1 == "CONTACT" { print $2 }' "$T/cc")
  # judged to the last whole second before the JS's first touch, or to W
  J=$(awk -v c="$cj" -v w="$W" 'BEGIN { j = w; if (c != "-" && c != "") { f = int(c); if (f == c) f--; if (f < j) j = f } print j }')
  # rows judged, worst gap (m) over them, when the gap first passed 1 mm, rows whose lap / place / flags differ
  r=$(paste -d'|' "$T/js" "$T/cc" | awk -F'|' -v J="$J" '{ n1 = split($1, a, " "); n2 = split($2, b, " ")
        if (a[1] !~ /^[0-9.]+$/ || n1 != 9) next
        if (n2 != 9 || a[1] != b[1] || a[2] != b[2]) { if (a[1] <= J) bad++; next }
        dx = a[3] - b[3]; dy = a[4] - b[4]; d = sqrt(dx * dx + dy * dy)
        if (a[1] <= J) { n++; if (d > m) m = d; if (a[6] != b[6] || a[7] != b[7] || a[9] != b[9]) bad++ }
        if (d > 0.001 && !first) first = a[1] }
      END { printf "%d %.9f %s %d", n, m, (first ? first : "-"), bad }')
  set -- $r
  # the race-control feed up to there: every line the same
  awk -v J="$J" '$1 == "E" && $2 <= J' "$T/js" > "$T/jsev"; awk -v J="$J" '$1 == "E" && $2 <= J' "$T/cc" > "$T/ccev"
  ev=$(wc -l < "$T/jsev")
  touch=$([ "$cj" = "-" ] && echo "no touch" || echo "first touch $cj s")
  note="judged $J s, $touch; worst gap $2 m; first past 1 mm: ${3} s; $ev events"
  cars=$(awk 'NR == 1 { print $5 }' "$T/js")
  if [ "$cj" != "$cc" ]; then echo "FAIL       race  $c   (first touch at $cj s in the JS, $cc s native; $note)"; fails=$((fails + 1))
  elif [ "$J" -lt 10 ]; then echo "FAIL       race  $c   (they touch after $cj s: too soon to judge anything; pick another seed)"; fails=$((fails + 1))
  elif [ "$1" -ne $((J * cars)) ] || [ "$4" -ne 0 ]; then echo "FAIL       race  $c   ($1 rows of $((J * cars)), $4 with a different lap, place or flag; $note)"; fails=$((fails + 1))
  elif ! cmp -s "$T/jsev" "$T/ccev"; then echo "FAIL       race  $c   (the event feeds differ; $note)"; diff "$T/jsev" "$T/ccev" | head -6; fails=$((fails + 1))
  elif awk -v d="$2" 'BEGIN { exit !(d <= 0.001) }'; then echo "EXACT      race  $c   ($note)"
  else echo "FAIL       race  $c   ($note)"; paste -d'|' "$T/js" "$T/cc" | awk -F'|' '{ split($1, a, " "); split($2, b, " "); if (a[1] ~ /^[0-9.]+$/ && (a[3] != b[3] || a[4] != b[4])) { print $1; print $2; if (++k >= 3) exit } }'; fails=$((fails + 1)); fi
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
