#!/usr/bin/env bash
# Founder-free STT eval corpus: regenerate stt-*.wav from the committed stt-*.txt
# reference scripts via macOS `say` (Kyoko, JA) + ffmpeg. The .txt IS the ground
# truth; the .wav is derived (gitignored). macOS-only.
#
# Usage: bash generate.sh   (run from anywhere)
# Then:  pnpm exec tsx scripts/eval-stt-corpus.ts   (from desktop/)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
command -v say   >/dev/null || { echo "macOS 'say' not found (macOS-only)" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found — brew install ffmpeg" >&2; exit 1; }

shopt -s nullglob
count=0
for txt in "$HERE"/stt-*.txt; do
  base="$(basename "$txt" .txt)"
  out_wav="$HERE/$base.wav"
  script="$(cat "$txt")"
  tmp_aiff="$(mktemp -t "lisna-$base.XXXXXX").aiff"
  # shellcheck disable=SC2064
  trap "rm -f '$tmp_aiff'" EXIT

  say -v Kyoko -o "$tmp_aiff" "$script"
  # 16 kHz mono signed-16 PCM; -map_metadata -1 -bitexact → exactly-44-byte WAV
  # header (the eval WAV reader slices PCM at offset 44).
  ffmpeg -y -loglevel error -i "$tmp_aiff" -map_metadata -1 -bitexact -ar 16000 -ac 1 -c:a pcm_s16le "$out_wav"
  rm -f "$tmp_aiff"
  echo "  $base.wav  ($(du -h "$out_wav" | cut -f1))"
  count=$((count + 1))
done
echo "Generated $count clip(s) → $HERE"
