import { describe, it, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { CLOUD_PROMPT_VERSION } from '@shared/families/util/cloud-prompt';
import { generateCloudNote, CLOUD_MODEL, type CloudMessages } from '../claude-notes';

const TRANSCRIPT: SessionTranscript = {
  sessionId: 'sess-1',
  speakers: [{ id: 0 }, { id: 1 }],
  transcriptSegments: [
    { ts: 0, endTs: 4, text: 'おはようございます。本日はローンチ判断会議を始めます。', speakerId: 0 },
    { ts: 5, endTs: 9, text: '本日のアジェンダはローンチ可否の判断です。', speakerId: 1 },
  ],
};

/** Real MeetingNoteSchema content shape, minus postDecodeOnly (`from`) fields
 * and system-owned NoteBase meta — exactly what the cloud model is told to
 * emit (see cloud-prompt.ts CLOUD_ADDENDUM). This is the executable proof
 * that the stub-injection + runPostDecodePipeline contract holds. */
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

function textResponse(text: string): Awaited<ReturnType<CloudMessages['messages']['create']>> {
  return { content: [{ type: 'text', text }] };
}

function makeClient(
  responses: ReadonlyArray<Awaited<ReturnType<CloudMessages['messages']['create']>> | Error>,
): { client: CloudMessages; create: ReturnType<typeof vi.fn> } {
  let call = 0;
  const create = vi.fn(async () => {
    const r = responses[call++];
    if (r === undefined) throw new Error('makeClient: not enough queued responses');
    if (r instanceof Error) throw r;
    return r;
  });
  return { client: { messages: { create } }, create };
}

const BASE_ARGS = {
  family: 'meeting' as const,
  transcript: TRANSCRIPT,
  language: 'ja' as const,
  durationSec: 600,
};

describe('generateCloudNote', () => {
  it('(a) valid meeting-note JSON resolves with origin=claude, correct model, attempts=1', async () => {
    const { client, create } = makeClient([textResponse(validMeetingRawJson())]);
    const result = await generateCloudNote(BASE_ARGS, {
      loadApiKey: async () => 'sk-ant-fake-key',
      createClient: () => client,
    });
    expect(result.note.origin).toBe('claude');
    expect(result.note.generatedBy.model).toBe(CLOUD_MODEL);
    expect(result.note.generatedBy.promptVersion).toBe(CLOUD_PROMPT_VERSION);
    expect(result.telemetry.attempts).toBe(1);
    expect(result.telemetry.model).toBe(CLOUD_MODEL);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('(b) garbage then valid resolves, attempts=2, onEvent sees cloud-retry', async () => {
    const { client } = makeClient([textResponse('not json {'), textResponse(validMeetingRawJson())]);
    const events: unknown[] = [];
    const result = await generateCloudNote(BASE_ARGS, {
      loadApiKey: async () => 'sk-ant-fake-key',
      createClient: () => client,
      onEvent: (e) => events.push(e),
    });
    expect(result.telemetry.attempts).toBe(2);
    expect(events).toContainEqual({ kind: 'cloud-retry', attempt: 2 });
  });

  it('(c) garbage twice rejects with CONNECTOR_BAD_RESPONSE', async () => {
    const { client } = makeClient([textResponse('not json {'), textResponse('still not json')]);
    await expect(
      generateCloudNote(BASE_ARGS, {
        loadApiKey: async () => 'sk-ant-fake-key',
        createClient: () => client,
      }),
    ).rejects.toThrow('CONNECTOR_BAD_RESPONSE');
  });

  it('(d) Anthropic.AuthenticationError rejects with CONNECTOR_AUTH_INVALID (no retry)', async () => {
    const authError = new Anthropic.AuthenticationError(
      401,
      { message: 'invalid x-api-key' },
      undefined,
      new Headers(),
    );
    const { client, create } = makeClient([authError]);
    await expect(
      generateCloudNote(BASE_ARGS, {
        loadApiKey: async () => 'sk-ant-fake-key',
        createClient: () => client,
      }),
    ).rejects.toThrow('CONNECTOR_AUTH_INVALID');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('(e) no key rejects with CONNECTOR_NO_KEY without constructing a client', async () => {
    const createClient = vi.fn();
    await expect(
      generateCloudNote(BASE_ARGS, {
        loadApiKey: async () => null,
        createClient,
      }),
    ).rejects.toThrow('CONNECTOR_NO_KEY');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('(f) fence-wrapped ```json output parses successfully', async () => {
    const fenced = '```json\n' + validMeetingRawJson() + '\n```';
    const { client } = makeClient([textResponse(fenced)]);
    const result = await generateCloudNote(BASE_ARGS, {
      loadApiKey: async () => 'sk-ant-fake-key',
      createClient: () => client,
    });
    expect(result.note.family).toBe('meeting');
    expect(result.telemetry.attempts).toBe(1);
  });

  it('(g) oversized transcript rejects with CONNECTOR_TRANSCRIPT_TOO_LONG without a client call', async () => {
    const hugeTranscript: SessionTranscript = {
      sessionId: 'sess-huge',
      speakers: [{ id: 0 }],
      transcriptSegments: [{ ts: 0, endTs: 1, text: 'x'.repeat(700_001), speakerId: 0 }],
    };
    const createClient = vi.fn();
    await expect(
      generateCloudNote(
        { ...BASE_ARGS, transcript: hugeTranscript },
        { loadApiKey: async () => 'sk-ant-fake-key', createClient },
      ),
    ).rejects.toThrow('CONNECTOR_TRANSCRIPT_TOO_LONG');
    expect(createClient).not.toHaveBeenCalled();
  });

  // Beyond the required (a)-(g) list: the remaining branches of the SDK error
  // classification table (flow contract step 5) are cheap to cover and are
  // otherwise entirely untested surface.
  it('classifies Anthropic.RateLimitError as CONNECTOR_RATE_LIMITED', async () => {
    const err = new Anthropic.RateLimitError(429, { message: 'rate limited' }, undefined, new Headers());
    const { client } = makeClient([err]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_RATE_LIMITED');
  });

  it('classifies a credit/billing BadRequestError as CONNECTOR_NO_CREDIT', async () => {
    const err = new Anthropic.BadRequestError(
      400,
      { message: 'Your credit balance is too low to access the Anthropic API' },
      undefined,
      new Headers(),
    );
    const { client } = makeClient([err]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_NO_CREDIT');
  });

  it('classifies a non-credit BadRequestError as CONNECTOR_BAD_RESPONSE', async () => {
    const err = new Anthropic.BadRequestError(400, { message: 'invalid request body' }, undefined, new Headers());
    const { client } = makeClient([err]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_BAD_RESPONSE');
  });

  it('classifies Anthropic.APIConnectionTimeoutError as CONNECTOR_TIMEOUT', async () => {
    const err = new Anthropic.APIConnectionTimeoutError({ message: 'timed out' });
    const { client } = makeClient([err]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_TIMEOUT');
  });

  it('classifies Anthropic.APIConnectionError as CONNECTOR_OFFLINE', async () => {
    const err = new Anthropic.APIConnectionError({ message: 'network down' });
    const { client } = makeClient([err]);
    await expect(
      generateCloudNote(BASE_ARGS, { loadApiKey: async () => 'sk-ant-fake-key', createClient: () => client }),
    ).rejects.toThrow('CONNECTOR_OFFLINE');
  });
});
