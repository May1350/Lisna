import { describe, it, expect } from 'vitest';
import { buildJaNoteV1Prompt, JA_NOTE_V1_VERSION } from '../ja-note-v1';
import type { TranscriptSegment } from '@shared/engine-interfaces';

/**
 * Helper — flatten the returned ChatMessage[] into a single string so the
 * substring-style assertions stay readable. We assert on the joined view
 * because the LLM-visible content equivalence is what matters; the role
 * boundary is exercised by the dedicated "splits system from user" test.
 */
function joinedContent(messages: ReturnType<typeof buildJaNoteV1Prompt>): string {
  return messages.map((m) => m.content).join('\n');
}

describe('buildJaNoteV1Prompt', () => {
  it('emits non-empty messages that contain the transcript text verbatim', () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 2.3, text: 'こんにちは、今日のミーティングを始めます。' },
      { startSec: 2.3, endSec: 5.1, text: '議題は三つあります。' },
    ];
    const messages = buildJaNoteV1Prompt('ja', segs);
    expect(messages.length).toBeGreaterThan(0);
    const joined = joinedContent(messages);
    expect(joined).toContain('こんにちは、今日のミーティングを始めます。');
    expect(joined).toContain('議題は三つあります。');
    expect(joined.length).toBeGreaterThan(50);
  });

  it('does NOT contain any Markdown syntax tokens in any message content', () => {
    // Failure mode being prevented: LLM sees Markdown in the prompt's own
    // examples/instructions and copies it into output. NoteView <pre> would
    // then render raw `#` / `**` / etc.
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: 'テスト' },
    ];
    const messages = buildJaNoteV1Prompt('ja', segs);
    for (const m of messages) {
      const lines = m.content.split('\n');
      for (const line of lines) {
        // Allow `・` (middle-dot bullet) — that's our chosen JA bullet glyph.
        // Forbid: `# `, `## `, `### `, `* `, `- `, `> `, ``` (triple-backtick), `**`
        expect(line).not.toMatch(/^#{1,6}\s/);
        expect(line).not.toMatch(/^\*\s/);
        expect(line).not.toMatch(/^-\s/);
        expect(line).not.toMatch(/^>\s/);
      }
      expect(m.content).not.toContain('```');
      expect(m.content).not.toContain('**');
    }
  });

  it('instructs the LLM to use the JA section-header convention 【…】', () => {
    const segs: TranscriptSegment[] = [{ startSec: 0, endSec: 1, text: 'テスト' }];
    const joined = joinedContent(buildJaNoteV1Prompt('ja', segs));
    // The system message demonstrates the convention by listing the three
    // canonical section names. The LLM follows by example.
    expect(joined).toContain('【要点】');
    expect(joined).toContain('【次のアクション】');
    expect(joined).toContain('【決定事項】');
  });

  it('formats transcript segments with [Xs] timestamp prefix matching legacy format', () => {
    // Preserved from the old defaultPrompt — segments are time-stamped so the
    // LLM can preserve ordering and refer to specific moments. The exact
    // format `[Xs]` with a single decimal place is contract-fixed because
    // downstream eval scripts (Phase B+) parse it.
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1.2, text: 'First' },
      { startSec: 12.7, endSec: 14.0, text: 'Second' },
    ];
    const joined = joinedContent(buildJaNoteV1Prompt('ja', segs));
    expect(joined).toMatch(/\[0\.0s\] First/);
    expect(joined).toMatch(/\[12\.7s\] Second/);
  });

  it('exposes a version constant for eval/ADR cross-reference', () => {
    expect(JA_NOTE_V1_VERSION).toBe('ja-note-v1');
  });

  it('handles empty segments without throwing (caller is responsible for empty-transcript guard)', () => {
    // Defense in depth — the SessionOrchestrator.stop() empty-transcript guard
    // throws EMPTY_TRANSCRIPT before reaching this function. But if a future
    // caller bypasses that guard, the builder should not crash.
    expect(() => buildJaNoteV1Prompt('ja', [])).not.toThrow();
    const messages = buildJaNoteV1Prompt('ja', []);
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(typeof m.content).toBe('string');
      expect(m.content.length).toBeGreaterThan(0);
    }
  });

  it('splits system instructions from user transcript so the chat template can tag them', () => {
    // The Llama 3.2 chat template wraps each role in distinct header tokens
    // (`<|start_header_id|>system<|end_header_id|>` etc.). Putting the
    // instructions and the transcript into separate messages is what lets
    // the model treat the transcript as input, not as more instructions.
    // 2026-05-15 1B catastrophe root cause was sending a single flat string.
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: 'テスト発話' },
    ];
    const messages = buildJaNoteV1Prompt('ja', segs);
    // Exactly one system + one user (in that order). If we ever introduce
    // few-shot examples this will need updating, but that's a deliberate
    // change worth catching here.
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    // The instructions live in `system`; the transcript lives in `user`.
    expect(messages[0]?.content).toContain('【要点】');
    expect(messages[1]?.content).toContain('テスト発話');
    // And vice versa: the transcript text should NOT appear in the system
    // message, otherwise we'd be back to the merged-string failure mode.
    expect(messages[0]?.content).not.toContain('テスト発話');
  });
});
