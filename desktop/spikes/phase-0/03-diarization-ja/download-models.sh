#!/usr/bin/env bash
# Download the pre-converted, UNGATED ONNX models for sherpa-onnx offline
# speaker diarization. Avoids the gated HuggingFace pull. Production license
# for the default segmentation model (pyannote-segmentation-3.0) is MIT.
#
# Asset URLs verified live 2026-06-14 (HTTP 200) against:
#   https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html
# The k2-fsa/sherpa-onnx GitHub releases re-host the converted ONNX; the
# embedding release tag is literally misspelled "recongition" upstream.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p models && cd models

SEG_REL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models"
EMB_REL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models"

# Segmentation: pyannote-segmentation-3.0 (MIT, default) + reverb-tuned variant
# (sherpa-onnx-reverb-diarization-v1 — directly targets reverberant rooms).
for name in sherpa-onnx-pyannote-segmentation-3-0 sherpa-onnx-reverb-diarization-v1; do
  if [ ! -f "$name/model.onnx" ]; then
    echo "→ segmentation: $name"
    curl -fL "$SEG_REL/$name.tar.bz2" -o "$name.tar.bz2"
    tar xjf "$name.tar.bz2"
    rm -f "$name.tar.bz2"
  fi
done

# Embedding: 3D-Speaker eres2net (default) + campplus (fallback-ladder swap).
for emb in \
  3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx \
  3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx \
; do
  if [ ! -f "$emb" ]; then
    echo "→ embedding: $emb"
    curl -fL "$EMB_REL/$emb" -o "$emb"
  fi
done

echo "--- models ready ---"
ls -la
find . -name 'model.onnx' -o -name '*.onnx' | sort
