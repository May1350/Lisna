import { describe, it, expect } from 'vitest';
import { buildJaNoteV1Prompt, JA_NOTE_V1_VERSION } from '../ja-note-v1';
import type { TranscriptSegment } from '@shared/engine-interfaces';

describe('buildJaNoteV1Prompt', () => {
  it('emits a non-empty prompt that contains the transcript text verbatim', () => {
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 2.3, text: 'こんにちは、今日のミーティングを始めます。' },
      { startSec: 2.3, endSec: 5.1, text: '議題は三つあります。' },
    ];
    const prompt = buildJaNoteV1Prompt('ja', segs);
    expect(prompt).toContain('こんにちは、今日のミーティングを始めます。');
    expect(prompt).toContain('議題は三つあります。');
    expect(prompt.length).toBeGreaterThan(50);
  });

  it('does NOT contain any Markdown syntax tokens', () => {
    // Failure mode being prevented: LLM sees Markdown in the prompt's own
    // examples/instructions and copies it into output. NoteView <pre> would
    // then render raw `#` / `**` / etc.
    //
    // We exempt `## **` only as a substring; what we actually forbid is the
    // tokens at the start of any line OR as a standalone fence. Use a simple
    // regex check: no line begins with `#`, `>`, `*`, `-`, no triple-backtick.
    const segs: TranscriptSegment[] = [
      { startSec: 0, endSec: 1, text: 'テスト' },
    ];
    const prompt = buildJaNoteV1Prompt('ja', segs);
    const lines = prompt.split('\n');
    for (const line of lines) {
      // Allow `・` (middle-dot bullet) — that's our chosen JA bullet glyph.
      // Forbid: `# `, `## `, `### `, `* `, `- `, `> `, ``` (triple-backtick), `**`
      expect(line).not.toMatch(/^#{1,6}\s/);
      expect(line).not.toMatch(/^\*\s/);
      expect(line).not.toMatch(/^-\s/);
      expect(line).not.toMatch(/^>\s/);
    }
    expect(prompt).not.toContain('```');
    expect(prompt).not.toContain('**');
  });

  it('instructs the LLM to use the JA section-header convention 【…】', () => {
    const segs: TranscriptSegment[] = [{ startSec: 0, endSec: 1, text: 'テスト' }];
    const prompt = buildJaNoteV1Prompt('ja', segs);
    // The prompt itself demonstrates the convention by listing the three
    // canonical section names. The LLM follows by example.
    expect(prompt).toContain('【要点】');
    expect(prompt).toContain('【次のアクション】');
    expect(prompt).toContain('【決定事項】');
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
    const prompt = buildJaNoteV1Prompt('ja', segs);
    expect(prompt).toMatch(/\[0\.0s\] First/);
    expect(prompt).toMatch(/\[12\.7s\] Second/);
  });

  it('exposes a version constant for eval/ADR cross-reference', () => {
    expect(JA_NOTE_V1_VERSION).toBe('ja-note-v1');
  });

  it('handles empty segments without throwing (caller is responsible for empty-transcript guard)', () => {
    // Defense in depth — the SessionOrchestrator.stop() empty-transcript guard
    // throws EMPTY_TRANSCRIPT before reaching this function. But if a future
    // caller bypasses that guard, the builder should not crash.
    expect(() => buildJaNoteV1Prompt('ja', [])).not.toThrow();
    const prompt = buildJaNoteV1Prompt('ja', []);
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});
