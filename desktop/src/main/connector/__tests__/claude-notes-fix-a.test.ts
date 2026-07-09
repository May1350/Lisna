/**
 * FIX-A (audit 2026-07-09 §H1/H2/M13) — split out of claude-notes.test.ts to
 * respect the file-size ceiling. Covers:
 *   - A1.3 truncation-aware retry (H2): stop_reason='max_tokens' retries ONCE
 *     with max_tokens bumped to 32_000; a second truncation throws
 *     CONNECTOR_OUTPUT_TRUNCATED instead of blind-retrying at the same cap.
 *   - A1.4 reason threading (H1): CONNECTOR_BAD_RESPONSE:<reason> suffix —
 *     parse | schema:<first zod issue path> | lang-mismatch.
 *   - A2 server-busy classification (M13): InternalServerError (covers both
 *     500 and 529/Overloaded — the installed SDK has no separate Overloaded
 *     class, see claude-errors.ts) → CONNECTOR_SERVER_BUSY.
 */
import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { generateCloudNote, type CloudMessages, type CloudMessageResponse } from '../claude-notes';

const TRANSCRIPT: SessionTranscript = {
  sessionId: 'sess-1',
  speakers: [{ id: 0 }, { id: 1 }],
  transcriptSegments: [
    { ts: 0, endTs: 4, text: 'おはようございます。本日はローンチ判断会議を始めます。', speakerId: 0 },
    { ts: 5, endTs: 9, text: '本日のアジェンダはローンチ可否の判断です。', speakerId: 1 },
  ],
};

/** Same fixture shape as claude-notes.test.ts's validMeetingRawJson — kept
 * local (not imported) since test files don't share exports. */
function validMeetingRawJson(): string {
  return JSON.stringify({
    family: 'meeting',
    title: 'ローンチ判断会議',
    purpose: 'ローンチ可否を判断する',
    executive_summary: 'チームはローンチ準備状況について議論した。',
    topic_arc: [{ topic: 'ローンチ判断', ts: 5, speakers_involved: [0, 1] }],
    discussions: [
      { topic: 'ローンチ判断', ts_start: 5, summary: 'ブロッカーについて議論した。', key_points: ['ブロッカーA'] },
    ],
    decisions: [{ text: '金曜日にローンチする', ts: 5 }],
    open_questions: [],
  });
}

/** Same content shape as validMeetingRawJson but with `decisions` typed
 * wrong (string, not array) — survives Stage 2.5's blank-text drop (it's not
 * a blank string) and fails Stage 4's zod parse with issue path ['decisions']. */
function schemaInvalidMeetingRawJson(): string {
  const obj = JSON.parse(validMeetingRawJson()) as Record<string, unknown>;
  obj.decisions = 'not-an-array';
  return JSON.stringify(obj);
}

/** English content with language:'ja' args — findLanguageMismatch's grounding
 * guard fires (checked text >=100 chars, ja-script ratio <5%). Valid JSON, so
 * it fails at the grounding guard, not at JSON.parse or the zod schema. */
function englishMeetingRawJson(): string {
  return JSON.stringify({
    family: 'meeting',
    title: 'Launch Decision Meeting',
    purpose: 'Decide whether to launch the product this week after reviewing blockers and readiness.',
    executive_summary: 'The team discussed launch readiness and outstanding blockers in detail during the call.',
    topic_arc: [{ topic: 'Launch readiness', ts: 5, speakers_involved: [0, 1] }],
    discussions: [
      { topic: 'Launch readiness', ts_start: 5, summary: 'Reviewed remaining blockers before shipping.', key_points: ['Blocker A'] },
    ],
    decisions: [{ text: 'Ship on Friday if QA signs off by Thursday evening.', ts: 5 }],
    open_questions: [],
  });
}

function textResponse(text: string, stopReason: string | null = 'end_turn'): CloudMessageResponse {
  return { content: [{ type: 'text', text }], stop_reason: stopReason };
}

function makeClient(
  responses: ReadonlyArray<CloudMessageResponse | Error>,
): { client: CloudMessages; stream: ReturnType<typeof vi.fn> } {
  let call = 0;
  const stream = vi.fn(() => ({
    finalMessage: async () => {
      const r = responses[call++];
      if (r === undefined) throw new Error('makeClient: not enough queued responses');
      if (r instanceof Error) throw r;
      return r;
    },
  }));
  return { client: { messages: { stream } }, stream };
}

const BASE_ARGS = {
  family: 'meeting' as const,
  transcript: TRANSCRIPT,
  language: 'ja' as const,
  durationSec: 600,
};

describe('generateCloudNote — FIX-A H2 truncation-aware retry (A1.3)', () => {
  it('attempt-1 truncation (stop_reason=max_tokens) retries ONCE with max_tokens bumped to 32000, then succeeds', async () => {
    const { client, stream } = makeClient([
      textResponse('not json {', 'max_tokens'),
      textResponse(validMeetingRawJson(), 'end_turn'),
    ]);
    const events: unknown[] = [];
    const result = await generateCloudNote(BASE_ARGS, {
      loadApiKey: async () => 'sk-ant-fake-key',
      createClient: () => client,
      onEvent: (e) => events.push(e),
    });
    expect(result.telemetry.attempts).toBe(2);
    expect(events).toContainEqual({ kind: 'cloud-retry', attempt: 2 });
    expect(stream).toHaveBeenCalledTimes(2);
    expect((stream.mock.calls[0]![0] as { max_tokens: number }).max_tokens).toBe(16_000);
    expect((stream.mock.calls[1]![0] as { max_tokens: number }).max_tokens).toBe(32_000);
  });

  it('truncation on BOTH attempts throws CONNECTOR_OUTPUT_TRUNCATED — never a third blind retry at the same cap', async () => {
    const { client, stream } = makeClient([
      textResponse('not json {', 'max_tokens'),
      textResponse('still not json', 'max_tokens'),
    ]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_OUTPUT_TRUNCATED');
    expect(stream).toHaveBeenCalledTimes(2);
    // Attempt 2 used the bumped cap, not a repeat of attempt 1's 16000 — the
    // "never blind-retry at the same cap" invariant.
    expect((stream.mock.calls[1]![0] as { max_tokens: number }).max_tokens).toBe(32_000);
  });
});

describe('generateCloudNote — FIX-A H1 reason threading (A1.4)', () => {
  it('a non-truncated parse failure on both attempts threads reason=parse', async () => {
    const { client } = makeClient([textResponse('not json {'), textResponse('still not json')]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_BAD_RESPONSE:parse');
  });

  it('a schema validation failure threads reason=schema:<first zod issue path>', async () => {
    const badSchemaJson = schemaInvalidMeetingRawJson();
    const { client } = makeClient([textResponse(badSchemaJson), textResponse(badSchemaJson)]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_BAD_RESPONSE:schema:decisions');
  });

  it('a language-grounding-guard failure threads reason=lang-mismatch', async () => {
    const englishJson = englishMeetingRawJson();
    const { client } = makeClient([textResponse(englishJson), textResponse(englishJson)]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_BAD_RESPONSE:lang-mismatch');
  });
});

describe('generateCloudNote — FIX-A M13 server-busy classification (A2)', () => {
  it('classifies Anthropic.InternalServerError (covers both 500 and 529/Overloaded) as CONNECTOR_SERVER_BUSY', async () => {
    const err = new Anthropic.InternalServerError(529, { message: 'Overloaded' }, undefined, new Headers());
    const { client } = makeClient([err]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_SERVER_BUSY');
  });

  it('classifies a 500 InternalServerError as CONNECTOR_SERVER_BUSY too', async () => {
    const err = new Anthropic.InternalServerError(500, { message: 'internal error' }, undefined, new Headers());
    const { client } = makeClient([err]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_SERVER_BUSY');
  });
});
