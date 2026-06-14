#!/usr/bin/env python3
"""STT-snap: re-express diarization output on the STT segment grid.

This is how the PRODUCT would actually attach a speaker to transcript text:
each STT segment gets exactly one speaker — the diarized speaker that covers the
most of that segment's span. Scoring the snapped turns (vs the by-ear ground
truth) gives the "STT-snap DER", whose delta from the native-turn DER tells us
how much the user-visible attribution differs from the raw diarization (spec
section-6: report native-turn DER + STT-snap delta).

Inputs (both JSON):
  --pred  diarization turns  [{"start","end","speaker"}]  (run-diarization.py)
  --stt   STT segments       [{"start","end", ...}]       (text ignored)

The STT segments come from the finalize debug dump (PR #113) of the founder's
real recording — e.g. `jq '[.transcript.segments[] | {start,end}]' dump.json`.
Confirm the exact dump field path against the first real dump before trusting
the numbers; the snap logic itself is field-shape-agnostic (needs only start/end
in seconds).

Output (stdout): snapped turns [{"start","end","speaker"}], one per STT segment
that overlaps any diarized speech (segments with zero overlap are dropped —
they would be a miss in either representation).
"""
import argparse
import json
import sys


def overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pred", required=True, help="diarization turns JSON")
    ap.add_argument("--stt", required=True, help="STT segments JSON (text ignored)")
    args = ap.parse_args()

    with open(args.pred) as f:
        pred = json.load(f)
    with open(args.stt) as f:
        segs = json.load(f)

    snapped = []
    dropped = 0
    for s in segs:
        s0, s1 = float(s["start"]), float(s["end"])
        if s1 <= s0:
            continue
        # Sum overlap per diarized speaker; the majority speaker wins the segment.
        by_spk: dict[str, float] = {}
        for t in pred:
            ov = overlap(s0, s1, float(t["start"]), float(t["end"]))
            if ov > 0:
                by_spk[str(t["speaker"])] = by_spk.get(str(t["speaker"]), 0.0) + ov
        if not by_spk:
            dropped += 1
            continue
        winner = max(by_spk.items(), key=lambda kv: kv[1])[0]
        snapped.append({"start": s0, "end": s1, "speaker": winner})

    snapped.sort(key=lambda t: t["start"])
    json.dump(snapped, sys.stdout, ensure_ascii=False)
    print(f"  {len(snapped)} snapped segments, "
          f"{len({t['speaker'] for t in snapped})} speakers, "
          f"{dropped} segment(s) with no diarized overlap dropped",
          file=sys.stderr)


if __name__ == "__main__":
    main()
