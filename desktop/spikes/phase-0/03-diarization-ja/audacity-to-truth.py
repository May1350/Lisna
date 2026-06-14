#!/usr/bin/env python3
"""Convert an Audacity label track export (or any TSV `start<TAB>end<TAB>label`)
to the turns JSON [{"start","end","speaker"}] consumed by score-der.py.

This is the STAGE 2 ground-truth path: the founder authors speaker turns BY EAR
in Audacity (Select Audio → Edit → Labels → Add Label, then File → Export →
Export Labels…), independently of the STT — spec R11 (no Whisper boundaries, no
circularity). Each label's *text* is the speaker id (e.g. S1, S2, or a name).

Audacity "Export Labels" format (tab-separated, one label per line):
    54.950000\t60.850000\tS1
    55.700000\t56.030000\tS2
A label made from a *spectral* selection adds a second continuation line that
starts with a backslash and carries the frequency range — those are skipped.
Point labels (start == end) carry no speech span and are dropped.

ELAN: export via File → Export As → Tab-delimited Text with columns
"Begin Time - ssms.ms / End Time / annotation"; this same parser handles it as
long as the three leading tab-separated fields are start, end, label. For ELAN
.eaf XML, export to tab-delimited first (this script does not parse XML).

Optionally clip to [--start,--end) (seconds) and re-base to 0, mirroring
rttm-to-truth.py, for scoring a trimmed slice.
"""
import argparse
import json
import sys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", required=True, help="Audacity/ELAN tab-delimited label export")
    ap.add_argument("--start", type=float, default=None, help="clip window start sec")
    ap.add_argument("--end", type=float, default=None, help="clip window end sec")
    args = ap.parse_args()

    turns = []
    dropped_point = 0
    with open(args.labels) as f:
        for raw in f:
            line = raw.rstrip("\n")
            if not line.strip():
                continue
            # Audacity spectral-selection continuation line: starts with a backslash.
            if line.lstrip().startswith("\\"):
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                # Tolerate runs-of-spaces separation as a fallback.
                parts = line.split()
            if len(parts) < 3:
                print(f"  skip (not 3 fields): {line!r}", file=sys.stderr)
                continue
            try:
                start = float(parts[0])
                end = float(parts[1])
            except ValueError:
                print(f"  skip (non-numeric times): {line!r}", file=sys.stderr)
                continue
            spk = parts[2].strip()
            if not spk:
                print(f"  skip (empty speaker label): {line!r}", file=sys.stderr)
                continue
            if end <= start:
                dropped_point += 1
                continue
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
    spk_set = {t["speaker"] for t in turns}
    msg = f"  {len(turns)} turns, {len(spk_set)} speakers {sorted(spk_set)}"
    if dropped_point:
        msg += f", dropped {dropped_point} point-label(s)"
    print(msg, file=sys.stderr)


if __name__ == "__main__":
    main()
