#!/usr/bin/env bash
# Generate silence + bg-noise fixtures via ffmpeg with bit-exact PCM (no metadata).
# 16-bit signed PCM, 16kHz mono, 30s, 44-byte WAV header to match generate-ja-30s.sh.
# Re-run any time you want to regenerate from scratch — output is deterministic.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# Pure digital silence: every sample = 0x0000. RMS = 0 → -Inf dBFS.
ffmpeg -y -f lavfi -i "anullsrc=r=16000:cl=mono" \
  -t 30 -bitexact -map_metadata -1 -ac 1 -ar 16000 -acodec pcm_s16le \
  "$HERE/ja-silence-30s.wav"

# Pink noise at amplitude 0.003 (linear) ≈ -50 dBFS RMS. Sits at the D
# silence-gate boundary so it bypasses D (in tests that disable D) and
# exercises E+F.
ffmpeg -y -f lavfi -i "anoisesrc=color=pink:amplitude=0.003:duration=30:sample_rate=16000" \
  -t 30 -bitexact -map_metadata -1 -ac 1 -ar 16000 -acodec pcm_s16le \
  "$HERE/ja-bg-noise-30s.wav"
