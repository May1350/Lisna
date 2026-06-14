#!/usr/bin/env python3
"""Convert an RTTM file (e.g. AMI ground truth from pyannote/AMI-diarization-setup)
to the turns JSON [{"start","end","speaker"}] consumed by score-der.py.

RTTM line: SPEAKER <file> <chan> <start> <dur> <NA> <NA> <speaker> <NA> <NA>
Optionally clip to [--start,--end) (seconds) when scoring a trimmed audio slice;
turns are clipped to the window and re-based to 0 so they align with the slice.
"""
import argparse
import json
import sys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rttm", required=True)
    ap.add_argument("--start", type=float, default=None, help="clip window start sec")
    ap.add_argument("--end", type=float, default=None, help="clip window end sec")
    args = ap.parse_args()

    turns = []
    with open(args.rttm) as f:
        for line in f:
            p = line.split()
            if len(p) < 8 or p[0] != "SPEAKER":
                continue
            start = float(p[3])
            end = start + float(p[4])
            spk = p[7]
            if args.start is not None or args.end is not None:
                lo = args.start if args.start is not None else 0.0
                hi = args.end if args.end is not None else float("inf")
                start = max(start, lo)
                end = min(end, hi)
                if end <= start:
                    continue
                start -= lo
                end -= lo
            turns.append({"start": start, "end": end, "speaker": spk})

    turns.sort(key=lambda t: t["start"])
    json.dump(turns, sys.stdout, ensure_ascii=False)
    print(f"  {len(turns)} turns, {len({t['speaker'] for t in turns})} speakers",
          file=sys.stderr)


if __name__ == "__main__":
    main()
