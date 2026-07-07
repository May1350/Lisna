import { describe, it, expect } from 'vitest';
import type { SessionTranscript } from '@shared/note-schema/transcript';
import { buildCloudNotePrompt } from '../cloud-prompt';

const transcript: SessionTranscript = {
  sessionId: 's1',
  speakers: [{ id: 0 }],
  transcriptSegments: [
    { ts: 0, endTs: 5, text: '会議を始めます。', speakerId: 0 },
    { ts: 95, endTs: 100, text: '価格は3,480円に決定しました。', speakerId: 0 },
  ],
};

const FAMILIES = ['lecture', 'meeting', 'interview', 'brainstorm'] as const;

describe('buildCloudNotePrompt', () => {
  it.each(FAMILIES)('%s: system carries family field semantics; user carries the full transcript', (family) => {
    const { system, user } = buildCloudNotePrompt(family, transcript, 'ja');
    expect(system.length).toBeGreaterThan(200);
    expect(user).toContain('価格は3,480円に決定しました。');
    expect(user).toContain('[01:35]');            // mm:ss timestamps
    expect(system).toContain('JSON');              // JSON-only output instruction
  });

  it.each(FAMILIES)('%s: forbids postDecodeOnly + system-meta fields', (family) => {
    const { system } = buildCloudNotePrompt(family, transcript, 'ja');
    expect(system).toContain('from');              // the do-not-emit instruction names them
    expect(system).toContain('generatedBy');
  });

  it('meeting system includes the decision-vs-label semantics (iter2 bank)', () => {
    const { system } = buildCloudNotePrompt('meeting', transcript, 'ja');
    expect(system).toMatch(/decisions|決定/);
    expect(system).toMatch(/next_steps/);
  });

  it('non-ja language is passed through as an output-language instruction', () => {
    const { system } = buildCloudNotePrompt('meeting', transcript, 'ko');
    expect(system).toMatch(/한국어|Korean|ko/);
  });

  it('multi-speaker transcripts render speaker markers', () => {
    const multi: SessionTranscript = {
      sessionId: 's1',
      speakers: [{ id: 0 }, { id: 1 }],
      transcriptSegments: [
        { ts: 0, endTs: 5, text: '質問です。', speakerId: 0 },
        { ts: 5, endTs: 8, text: 'こんにちは', speakerId: 1 },
      ],
    };
    const { user } = buildCloudNotePrompt('interview', multi, 'ja');
    expect(user).toContain('話者1');
  });

  it('single-speaker transcripts omit speaker markers', () => {
    const { user } = buildCloudNotePrompt('lecture', transcript, 'ja');
    expect(user).not.toContain('話者0');
  });

  it('ja is passed through with no language override appended', () => {
    const { system } = buildCloudNotePrompt('lecture', transcript, 'ja');
    expect(system).not.toMatch(/LANGUAGE OVERRIDE/);
  });
});
