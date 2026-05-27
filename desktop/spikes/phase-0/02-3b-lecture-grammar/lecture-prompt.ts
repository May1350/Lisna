// Spike 0.2 — minimal Lecture-style prompt for 3B + grammar.
//
// Why plain English (no <|system|>...<|/system|> chat-template tags)?
// Spike 0.1 empirically established that `llama-completion` + grammar
// constraint produces structurally valid JSON from a single plain prompt
// string with no chat-template markup. Grammar enforces the output shape
// regardless of chat-template adherence on this build, so adding template
// tags just risks the model treating them as literal content. Keeping
// shape parity with Spike 0.1's rig.
//
// Slot emergence triggers (extras) — the prompt explicitly mentions two
// known LectureMiniSchema extras variants (procedure_steps, formula). The
// physics fixture is heavy on formula-bearing language (E=mc² style + 静電
// ポテンシャル derivations) so the formula trigger should fire on at least
// one of the three runs.

export interface TranscriptBucket {
  ts: number;
  text: string;
}

export function buildLectureSpikePrompt(transcript: TranscriptBucket[]): string {
  const transcriptText = transcript
    .map((b) => `[${fmtTs(b.ts)}] ${b.text}`)
    .join('\n');

  return [
    'You are a lecture note writer. Given a Japanese lecture transcript with timestamps, output a structured JSON note matching the LectureNote schema.',
    '',
    'Rules:',
    '- All user-visible text in Japanese.',
    '- Each section has heading, ts (integer seconds), summary, key_terms[].',
    '- If the transcript mentions specific years/dates with events (e.g., 1991年, 2014年), include a timeline extra slot for that section.',
    '- If the transcript mentions formulas or equations (e.g., E=mc²), include a formula extra slot.',
    '- Output ONLY valid JSON matching the schema. No markdown, no commentary.',
    '',
    'Transcript:',
    transcriptText,
    '',
    'Produce the LectureNote JSON.',
  ].join('\n');
}

function fmtTs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
