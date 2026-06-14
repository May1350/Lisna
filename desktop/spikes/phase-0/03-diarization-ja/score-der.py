#!/usr/bin/env python3
"""Diarization Error Rate via pyannote.metrics (the spec's source-of-truth
metric, collar 0.25 s). Inputs are two JSON arrays of turns,
[{"start", "end", "speaker"}]: --pred (diarization output) and --truth
(independently authored ground truth).

Prints a JSON report: DER with and without overlap scoring, the miss /
false-alarm / confusion breakdown (as fractions of total reference speech),
overlap-%, and predicted-vs-truth speaker counts. API: pyannote.metrics 4.1.
"""
import argparse
import json

from pyannote.core import Annotation, Segment
from pyannote.metrics.diarization import DiarizationErrorRate


def to_annotation(turns) -> Annotation:
    a = Annotation()
    for i, t in enumerate(turns):
        # Unique track id per turn so overlapping same-file turns both survive.
        a[Segment(float(t["start"]), float(t["end"])), i] = str(t["speaker"])
    return a


def overlap_fraction(truth: Annotation) -> float:
    """Fraction of reference speech time that has >=2 simultaneous speakers."""
    total = 0.0
    overlap = 0.0
    # Build a timeline of speaker counts via the overlap of the annotation.
    support = truth.get_timeline().support()
    total = sum(seg.duration for seg in support)
    # pyannote: regions where >=2 labels co-occur.
    ovl = truth.get_overlap()
    overlap = sum(seg.duration for seg in ovl)
    return (overlap / total) if total else 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pred", required=True)
    ap.add_argument("--truth", required=True)
    ap.add_argument("--collar", type=float, default=0.25)
    args = ap.parse_args()

    with open(args.pred) as f:
        pred_turns = json.load(f)
    with open(args.truth) as f:
        truth_turns = json.load(f)

    pred = to_annotation(pred_turns)
    truth = to_annotation(truth_turns)

    m = DiarizationErrorRate(collar=args.collar, skip_overlap=False)
    comp = m(truth, pred, detailed=True)
    der = comp["diarization error rate"]

    m2 = DiarizationErrorRate(collar=args.collar, skip_overlap=True)
    der_no_ov = abs(m2(truth, pred))

    total = comp["total"] or 1.0
    report = {
        "der": round(der, 4),
        "der_no_overlap": round(der_no_ov, 4),
        "miss": round(comp["missed detection"] / total, 4),
        "false_alarm": round(comp["false alarm"] / total, 4),
        "confusion": round(comp["confusion"] / total, 4),
        "overlap_pct": round(100.0 * overlap_fraction(truth), 2),
        "pred_speakers": len(pred.labels()),
        "truth_speakers": len(truth.labels()),
        "collar": args.collar,
    }
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
