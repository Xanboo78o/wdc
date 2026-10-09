#!/usr/bin/env bash
# admovie.sh — the two adverts as video files in ~/Downloads.
#   tools/admovie.sh [cinematic|deadpan|both] [WxH] [fps] [outdir]
# Every frame is drawn at its exact time by tools/adshot.mjs --gtx (a real
# browser window on the GTX 1060; the adverts are deterministic through
# ?frame= / __adSeek), the score is rendered offline by the page's own synth,
# and ffmpeg joins them. About five frames a second. (In software it was one
# to two MINUTES a frame, and played live in his browser it lagged.)
set -u
cd "$(dirname "$0")/.."
which=${1:-both}; size=${2:-1920x1080}; fps=${3:-30}; out=${4:-$HOME/Downloads}
declare -A LEN=([cinematic]=64 [deadpan]=69.4)
mkdir -p "$out"
for ad in cinematic deadpan; do
  [ "$which" = both ] || [ "$which" = "$ad" ] || continue
  dir=/tmp/xbr-ads/movie-$ad; rm -rf "$dir"; mkdir -p "$dir"
  step=$(python3 -c "print(1/$fps)")
  echo "== $ad: frames at $size, $fps fps  $(date +%T)"
  node tools/adshot.mjs "$ad" "0:${LEN[$ad]}:$step" --size "$size" --out "$dir" --seq --jpg --gtx --force | tail -3
  echo "== $ad: score  $(date +%T)"
  node tools/adshot.mjs "$ad" --audio --out "$dir" --gtx --force --q lo=1 | grep -E "^audio:|^wav:"
  n=$(ls "$dir"/f*.jpg 2>/dev/null | wc -l)
  echo "== $ad: $n frames -> mp4  $(date +%T)"
  ffmpeg -y -loglevel error -framerate "$fps" -i "$dir/f%05d.jpg" -i "$dir/ad-$ad.wav" \
    -c:v libx264 -preset medium -crf 19 -maxrate 14M -bufsize 28M -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart "$out/XBR-ad-$ad.mp4" \
    && ls -la "$out/XBR-ad-$ad.mp4"
done
echo "== done $(date +%T)"
