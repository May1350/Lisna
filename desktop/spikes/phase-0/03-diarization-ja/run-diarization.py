#!/usr/bin/env python3
"""Run sherpa-onnx OFFLINE speaker diarization on a 16 kHz mono WAV.

Stdout: a pure JSON array of predicted speaker turns
    [{"start": <sec>, "end": <sec>, "speaker": "<id>"}]  (sorted by start time)
Stderr: a one-line JSON diagnostic (detected #speakers, audio sec, wall sec,
    real-time factor, model paths) + throttled progress.

Mirrors sherpa-onnx's offline-speaker-diarization.py example. API verified
against sherpa-onnx 1.13.2 (2026-06-14). This is the offline-at-Stop path the
spec (section 8) says production should adopt — global clustering over the
whole-session WAV, no streaming.
"""
import argparse
import json
import sys
import time

import soundfile as sf
import sherpa_onnx


def _maybe_call(v):
    return v() if callable(v) else v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--seg", required=True, help="segmentation ONNX path")
    ap.add_argument("--emb", required=True, help="embedding ONNX path")
    ap.add_argument("--num-speakers", type=int, default=-1, help="-1 = auto-detect")
    ap.add_argument("--cluster-threshold", type=float, default=0.5,
                    help="cosine threshold; used only when --num-speakers < 0")
    ap.add_argument("--num-threads", type=int, default=2)
    args = ap.parse_args()

    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=args.seg),
            num_threads=args.num_threads,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=args.emb,
            num_threads=args.num_threads,
        ),
        clustering=sherpa_onnx.FastClusteringConfig(
            num_clusters=args.num_speakers,
            threshold=args.cluster_threshold,
        ),
    )
    if not config.validate():
        print("ERROR: invalid sherpa-onnx diarization config", file=sys.stderr)
        sys.exit(2)

    sd = sherpa_onnx.OfflineSpeakerDiarization(config)

    audio, sr = sf.read(args.wav, dtype="float32", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio[:, 0]  # collapse to mono (first channel)
    if sr != sd.sample_rate:
        print(f"ERROR: wav sr {sr} != model sr {sd.sample_rate} (resample first)",
              file=sys.stderr)
        sys.exit(3)

    dur = len(audio) / sr
    last_decile = [-1]

    def progress(processed: int, total: int) -> int:
        decile = int(10.0 * processed / max(total, 1))
        if decile != last_decile[0]:
            last_decile[0] = decile
            print(f"  diarize {10 * decile:3d}%", file=sys.stderr, flush=True)
        return 0

    t0 = time.time()
    result = sd.process(audio, callback=progress)
    wall = time.time() - t0

    segs = result.sort_by_start_time()
    turns = [
        {"start": float(s.start), "end": float(s.end), "speaker": str(s.speaker)}
        for s in segs
    ]

    diag = {
        "wav": args.wav,
        "audio_sec": round(dur, 2),
        "wall_sec": round(wall, 2),
        "rtf": round(wall / max(dur, 1e-9), 4),
        "num_speakers": _maybe_call(result.num_speakers),
        "num_segments": _maybe_call(result.num_segments),
        "num_speakers_arg": args.num_speakers,
        "seg_model": args.seg,
        "emb_model": args.emb,
    }
    print("DIAG " + json.dumps(diag, ensure_ascii=False), file=sys.stderr)

    json.dump(turns, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
