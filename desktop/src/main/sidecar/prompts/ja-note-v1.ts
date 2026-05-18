import type { Language, TranscriptSegment, ChatMessage } from '@shared/engine-interfaces';

/**
 * Version tag for cross-referencing this prompt in eval logs and ADRs. Bump
 * to `ja-note-v2` (etc.) if substantive changes ship — keep the old fn for
 * regression comparison until a v2 ADR retires it.
 */
export const JA_NOTE_V1_VERSION = 'ja-note-v1' as const;

/**
 * Build the chat-style prompt for a JA-language meeting-note generation pass.
 *
 * **Design rationale**: See `docs/superpowers/decisions/2026-05-15-step-5-section-9-decisions.md`
 * §2 for the format decision. Output is intentionally plain-text — no Markdown
 * tokens — because the renderer (`NoteView.tsx`) uses a `<pre>` element that
 * displays whitespace literally and any `#`/`**`/`-` syntax would render raw.
 *
 * Returns a `ChatMessage[]` (system + user) instead of a flat string so the
 * sidecar can apply the GGUF-embedded chat template (`llama_chat_apply_template`).
 * Without this split, the LLM sees raw text and degrades into continuation
 * mode — the 2026-05-15 1B catastrophe (6588-char repetition loop) was caused
 * by exactly that failure. See `desktop/sidecar/src/llm/llama_engine.cpp`.
 *
 * Format conventions the LLM is instructed to follow (in the system message):
 * - Section headers: `【要点】`, `【次のアクション】`, `【決定事項】`
 * - Bullets: `・` (U+30FB middle-dot) followed by a space, one item per line
 * - Sections separated by a single blank line
 * - Body in polite desu/masu form (です・ます調)
 * - Omit any section that has no content (do not emit empty headers)
 *
 * The transcript is rendered as a flat list of `[Xs] text` lines where `Xs`
 * is `startSec.toFixed(1)`. This is the same format the old `defaultPrompt`
 * used; downstream eval tooling may parse it, so the format is contract-fixed.
 *
 * **Final wording note**: This is the Phase B scaffolding. Founder will tune
 * the exact instruction text post-§6-manual-smoke once real LLM output is
 * observable. The contract this function exposes (signature, version constant,
 * no-Markdown invariant) is stable; the wording inside the template is the
 * tuning surface.
 */
export function buildJaNoteV1Prompt(
  language: Language,
  segments: TranscriptSegment[],
): ChatMessage[] {
  // Render transcript. Matches legacy `[Xs] text` format.
  const transcript = segments.length === 0
    ? '(発話なし)'
    : segments.map((s) => `[${s.startSec.toFixed(1)}s] ${s.text}`).join('\n');

  // System instruction. NOTE: no Markdown tokens. The `【】` and `・` glyphs are
  // full-width characters that render correctly in `<pre>` and any future rich
  // renderer. The body uses polite desu/masu form which the prompt itself
  // demonstrates ("〜してください" rather than casual "〜して").
  //
  // Language placeholder retained so a future bilingual variant can swap the
  // template wholesale without touching the orchestrator. v2.0 alpha is JA-only;
  // calling this with `language !== 'ja'` still returns a valid prompt (the LLM
  // would just write JA output regardless), but the orchestrator-level
  // UNSUPPORTED_LANGUAGE guard fires before reaching here.
  //
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for v2.1 multilingual
  const _lang = language;

  const systemContent = [
    'あなたは会議のノートライターです。下記の文字起こし(タイムスタンプ付き)を読み、',
    '日本語のプレーンテキストで構造化されたノートを作成してください。',
    '',
    '【出力フォーマットの規則】',
    '・セクション見出しは全角ブラケットで囲んでください: 【要点】 / 【次のアクション】 / 【決定事項】',
    '・箇条書きは行頭に「・」(中黒) を置き、半角スペースを一つ空けてから本文を書いてください。',
    '・セクションとセクションの間は空行を一行入れてください。',
    '・文体は丁寧体 (です・ます調) に統一してください。',
    '・該当する内容が無いセクションは見出しごと省略してください。',
    '・Markdown 記号 (#, *, -, >, バッククォート) は絶対に使用しないでください。',
  ].join('\n');

  // Transcript goes in a user-role turn so the chat template tags it
  // accordingly (Llama 3.2 wraps it in user-header tokens; the assistant
  // header that follows tells the model "now respond with the note").
  const userContent = ['【入力 (文字起こし)】', transcript].join('\n');

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}
