#!/usr/bin/env bash
# Regenerate ja-30s.wav from a known Japanese script via macOS `say` + ffmpeg.
# macOS-only (Kyoko voice). Run from anywhere; output paths are absolute-from-script.
#
# Output:
#   ja-30s.wav         — 16 kHz mono signed-16 PCM, exactly 30 seconds, ~960 KB
#   ../transcripts/ja-30s.txt — the spoken script (already committed; only rewritten if missing)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT_WAV="$HERE/ja-30s.wav"
TRANSCRIPT="$HERE/../transcripts/ja-30s.txt"

if ! command -v say >/dev/null; then
  echo "macOS 'say' command not found — this script is macOS-only" >&2
  exit 1
fi
if ! command -v ffmpeg >/dev/null; then
  echo "ffmpeg not found — install via 'brew install ffmpeg'" >&2
  exit 1
fi

# Deliberately overshoot 30s — TTS speed varies. ffmpeg `-t 30` trims to exactly 30s.
SCRIPT='今日は良い天気ですね。これは日本語音声認識のテストです。コトバウィスパーというモデルを使って、サイドカープロセスで文字起こしを行います。三十秒ほど話し続けるので、しっかり認識できるか確認します。日本語の発音は明瞭で、機械翻訳と音声認識の両方に重要な役割を果たしています。'

mkdir -p "$(dirname "$TRANSCRIPT")"
if [ ! -f "$TRANSCRIPT" ]; then
  printf '%s\n' "$SCRIPT" > "$TRANSCRIPT"
fi

TMP_AIFF="$(mktemp -t lisna-ja-30s.XXXXXX).aiff"
trap 'rm -f "$TMP_AIFF"' EXIT

say -v Kyoko -o "$TMP_AIFF" "$SCRIPT"

# 16 kHz mono signed-16 PCM, hard-trimmed to 30 seconds.
# `-map_metadata -1 -bitexact` strips ffmpeg's default LIST/INFO chunk so the
# WAV header is exactly 44 bytes (RIFF + fmt + data) — the test relies on this
# offset when slicing PCM samples.
ffmpeg -y -loglevel error -i "$TMP_AIFF" -map_metadata -1 -bitexact -t 30 -ar 16000 -ac 1 -c:a pcm_s16le "$OUT_WAV"

echo "Wrote: $OUT_WAV"
ls -la "$OUT_WAV"
