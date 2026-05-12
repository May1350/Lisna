# Lisna — Product Requirements

> Decision-grade narrative. The Concept is the fixed yardstick;
> everything below it (stack stage, copy, target, scenarios) is the
> current means and is allowed to move.

## Concept (yardstick — locked)

> **모든 음성을, 디바이스 안에서, 구조화된 텍스트로.**
>
> Every spoken sound, on the user's own device, turned into structured
> text.

This is the lens for every product decision. If a feature widens the
gap between an arbitrary spoken stream and a structured artifact the
user can read in a fraction of the original time, it belongs. If it
doesn't, it doesn't — regardless of how clever the implementation is.

## Stack stage (current means — moves over time)

- **v1 — Cloud (now).** Chrome extension + AWS Lambda + cloud STT /
  curator. Student beta is the production load for this stage; see
  *Target* below for why the student surface stays running rather
  than being phased out.
- **v2 — Desktop native, on-device primary, cloud fallback.** A
  desktop app whose default path is on-device STT + curator; cloud is
  retained as a fallback for first launch (model not yet downloaded)
  and for devices below the on-device threshold. v2 is triggered when
  on-device quality, hardware coverage, and download UX cross the
  internal completion bar — not on calendar date.

## External copy candidates (marketing finalises)

Not locked. Three working candidates that compress the value into one
sentence:

- ja — 「1時間の音声を、5分で読める資料に」
- ko — "1시간 음성을, 5분에 읽을 자료로"
- en — "An hour of audio. Five minutes to read."

## Target

- **Primary business**: Japanese workplace — meetings, on-site
  conversations, in-room presentations. Japanese market first because
  the language + workplace combination is where the competitive slot
  (on-device, individual price, Japanese-tuned summarisation) is least
  contested.
- **Test board (kept alive)**: Japanese university students using
  LMS lecture videos. The student beta — launched and Stripe + CWS
  approved on 2026-05-11 — stays as the **validation infrastructure**
  for new features. Same end-to-end pipeline, same usage signal, less
  ceremony to ship a change. It is not being phased out.

## Scenarios

All four reduce to the same product shape: **live audio → structured
notes**. Differences are the audio source, the host surface, and the
attendee mode (single speaker vs multi-speaker).

1. **LMS lecture (primary student case, also workplace e-learning).**
   Browser playback of a recorded lecture. Single-speaker.
2. **Video conferencing — Zoom / Teams / Meet.** Desktop system audio
   capture, multi-speaker.
3. **In-room lecture, live.** Laptop microphone, single-speaker
   (mostly), classroom setting.
4. **Meeting room, live.** Laptop microphone with speaker
   diarisation, multi-speaker conversational pace.
