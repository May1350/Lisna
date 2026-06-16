# v2 Note Schema Naming Convention

**Locked 2026-05-27 (Plan 2 Task 5).**

## Three shapes, three layers

| Layer | Module | Shape | Naming |
|---|---|---|---|
| HTTP wire (extension ↔ backend) | `/shared/src/index.ts` (workspace pkg) | `session_id`, `start_time_sec`, `audio_b64` | **snake_case** |
| Desktop in-process (alpha single-shot path) | `desktop/src/shared/types.ts::TranscriptSegment` | `startSec`, `endSec`, `text`, `noSpeechProb?` | **camelCase + Sec suffix** |
| Desktop in-process (v2 structured-note path) | `desktop/src/shared/note-schema/transcript.ts::TranscriptSegment` | `ts`, `endTs`, `text`, `speakerId`, `meta?` | **camelCase, Sec implied** |

## Why two desktop shapes?

The alpha path (`ja-note-v1.ts` single-shot, removed in STT Phase 2) was
built around the legacy shape; that shape persists as the `TranscriptSegment`
that STT emits, adapted into the v2 shape via `adaptToV2Transcript`. v2
introduces `speakerId` (diarization) and
`meta` (P1 extensibility) and follows the spec §3.1 pseudo-code naming.
Both shapes co-exist during the alpha→v2 transition per spec §10.1.

## Adapter direction

STT emits legacy. The Plan 3 orchestrator's `afterTranscribe` hook
converts legacy → v2 once diarization has assigned `speakerId`:

```ts
function legacyToV2(legacy: LegacyTranscriptSegment, speakerId: number): TranscriptSegment {
  const { startSec, endSec, text, noSpeechProb } = legacy;
  return {
    ts: startSec,
    endTs: endSec,
    text,
    speakerId,
    meta: noSpeechProb !== undefined ? { noSpeechProb } : undefined,
  };
}
```

v2 segments are NEVER converted back to legacy. The alpha path stays
untouched on its existing shape; new sessions use v2 end-to-end.

## HTTP wire is out of scope

The root `/shared/` workspace package (snake_case) serves the extension
HTTP boundary. Extension is FROZEN per CLAUDE.md scope-freeze
(2026-05-24). Plan 2 does not touch it. If v2 ever needs HTTP sync
(it doesn't today — v2 is on-device only per PRD), an adapter at the
HTTP boundary would convert v2 ↔ wire.
