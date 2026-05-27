import { describe, it, expect } from 'vitest'
import { outlineToObsidianMarkdown } from '../src/lib/markdown-obsidian.js'
import type { Outline } from '../src/lib/curator.js'

const ctx = {
  sourceUrl: 'https://example.com/lecture?id=42',
  sessionId: 'sess-uuid-123',
  lectureDate: '2026-04-29',
  durationSec: 3600,
}

describe('outlineToObsidianMarkdown', () => {
  it('emits frontmatter + title + sections + indices', () => {
    const o: Outline = {
      title: '持続可能性とガバナンス',
      course: '現代企業経営各論',
      lecturer: '谷口 和弘',
      tldr: 'サステナビリティは多層構造で、ガバナンスはその制度的基盤',
      related_lectures: ['ESG投資', 'コーポレートガバナンス・コード'],
      sections: [
        {
          heading: '持続可能性の定義',
          ts: 0,
          summary: 'サステナビリティは多層構造を持つ',
          takeaway: '持続可能性は環境問題に限らず階層的概念である',
          check_question: '持続可能性の 5 階層を列挙せよ',
          related_terms: ['ESG', 'CSR'],
          key_terms: [
            { term: 'サステナビリティ', definition: '持続可能性の英訳。多層的に存在', ts: 5, from: 'transcript' as const },
          ],
          examples: [
            { text: '地球の環境', ts: 18, from: 'transcript' as const },
            { text: '個人の寿命', ts: 32, from: 'transcript' as const },
          ],
          points: [
            { text: '持続可能性は地球→国→企業→地域→個人と階層化される', ts: 65, important: true, from: 'transcript' as const },
            { text: 'サステナビリティ＝環境問題は狭い', ts: 88, important: false, from: 'transcript' as const },
          ],
        },
      ],
    }
    const md = outlineToObsidianMarkdown(o, ctx)

    // YAML frontmatter present
    expect(md).toMatch(/^---\n/)
    expect(md).toContain('type: lecture-note')
    expect(md).toContain('course: "[[現代企業経営各論]]"')
    expect(md).toContain('lecturer: "[[谷口 和弘]]"')
    expect(md).toContain('source: "https://example.com/lecture?id=42"')
    expect(md).toContain('session_id: sess-uuid-123')

    // Title heading + 講義情報 callout
    expect(md).toContain('# 持続可能性とガバナンス')
    expect(md).toContain('> [!info] 講義情報')
    expect(md).toContain('> - 教授: [[谷口 和弘]]')

    // TL;DR section — note that "サステナビリティ" gets auto-linked because
    // it's a known key_term, so the literal text becomes [[サステナビリティ]]は…
    expect(md).toContain('## TL;DR')
    expect(md).toContain('[[サステナビリティ]]は多層構造で')

    // 重要事項 roll-up at top
    expect(md).toContain('## 重要事項 ⭐')
    expect(md).toContain('持続可能性は地球→国→企業→地域→個人と階層化される')

    // Per-section: heading wraps first term as wikilink
    expect(md).toContain('## [[サステナビリティ]] (持続可能性の定義)')

    // Block id anchor for section
    expect(md).toMatch(/\^s1-/)

    // 要旨 callout for takeaway
    expect(md).toContain('> [!summary] 要旨')

    // 定義 are now emitted as a `**用語**` bullet list (compressed
    // from the previous N-callout layout, ~6-10 lines saved per
    // section; see markdown-obsidian.ts comment for context).
    expect(md).toContain('**用語**')
    expect(md).toMatch(/- \*\*サステナビリティ\*\*:/)

    // Examples now live in the unified `**ポイント**` list with a
    // "例: " prefix instead of a separate `**用例**` section.
    expect(md).toContain('**ポイント**')
    expect(md).toContain('- 例: 地球の環境 [▶ 00:18](https://example.com/lecture?id=42&t=18s&__sh_seek=18)')

    // Important point with star (auto-wikilink only fires on known terms;
    // "持続可能性" isn't a key_term in this fixture so it stays plain)
    expect(md).toMatch(/⭐ \*\*持続可能性は地球[^\n]*階層化される\*\*/)

    // 関連 inline links (label shortened from 関連用語 → 関連; separator
    // changed from " | " → " · ")
    expect(md).toContain('**関連**: [[ESG]] · [[CSR]]')

    // 関連リンク section
    expect(md).toContain('## 関連リンク')
    expect(md).toContain('- [[ESG投資]]')
    expect(md).toContain('- [[コーポレートガバナンス・コード]]')

    // 用語インデックス was removed — terms now live in frontmatter
    // `key_terms` array + body wikilinks. The Properties panel +
    // Obsidian backlinks panel cover this without a redundant section.
    expect(md).not.toContain('## 用語インデックス')
    expect(md).toContain('key_terms:')
    expect(md).toContain('  - "[[サステナビリティ]]"')

    // 学習チェックリスト
    expect(md).toContain('## 学習チェックリスト')
    expect(md).toContain('- [ ] 持続可能性の 5 階層を列挙せよ')
  })

  it('omits optional sections when fields are missing', () => {
    const o: Outline = {
      title: 'Minimal',
      sections: [{
        heading: 'Section A',
        ts: 0,
        summary: 's',
        key_terms: [],
        examples: [],
        points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, ctx)
    expect(md).not.toContain('## TL;DR')
    expect(md).not.toContain('## 重要事項 ⭐')
    expect(md).not.toContain('## 関連リンク')
    expect(md).not.toContain('## 学習チェックリスト')
    expect(md).not.toContain('教授:')
    expect(md).not.toContain('科目:')
  })

  it('treats curator placeholder values (不明 etc.) as missing — no [[不明]] in output', () => {
    // Pre-scrub at curator.ts should make this redundant for new
    // outlines, but we have legacy DB rows where course/lecturer were
    // stored as the literal string "不明". Renderer must defensively
    // skip them so the Obsidian graph doesn't get a fake "[[不明]]"
    // hub aggregating every lecture where curator extraction failed.
    const o: Outline = {
      title: 'Test',
      course: '不明',
      lecturer: 'unknown',
      sections: [{
        heading: 'h', ts: 0, summary: '',
        key_terms: [{ term: 'X', definition: 'd', ts: 0, from: 'transcript' as const }],
        examples: [], points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, ctx)
    expect(md).not.toContain('[[不明]]')
    expect(md).not.toContain('[[unknown]]')
    expect(md).not.toContain('course:')
    expect(md).not.toContain('lecturer:')
    expect(md).not.toContain('教授:')
    expect(md).not.toContain('科目:')
  })

  it('builds deep links with & when URL has query, ? when not', () => {
    const o: Outline = {
      title: 't',
      sections: [{
        heading: 'h', ts: 0, summary: '',
        key_terms: [], examples: [{ text: 'ex', ts: 90, from: 'transcript' as const }], points: [],
      }],
    }
    const noQuery = outlineToObsidianMarkdown(o, { ...ctx, sourceUrl: 'https://example.com/lec' })
    expect(noQuery).toContain('[▶ 01:30](https://example.com/lec?t=90s&__sh_seek=90)')

    const withQuery = outlineToObsidianMarkdown(o, { ...ctx, sourceUrl: 'https://example.com/lec?id=1' })
    expect(withQuery).toContain('[▶ 01:30](https://example.com/lec?id=1&t=90s&__sh_seek=90)')
  })

  it('embeds slides into the section whose ts range covers the slide ts', () => {
    const o: Outline = {
      title: 't',
      sections: [
        {
          heading: 'A', ts: 0, summary: '',
          key_terms: [], examples: [], points: [],
        },
        {
          heading: 'B', ts: 60, summary: '',
          key_terms: [], examples: [], points: [],
        },
        {
          heading: 'C', ts: 180, summary: '',
          key_terms: [], examples: [], points: [],
        },
      ],
    }
    const md = outlineToObsidianMarkdown(o, {
      ...ctx,
      slides: [
        { ts: 10,  url: 'https://s3/key-a1.jpg?sig=1', key: 'k/a1' },
        { ts: 95,  url: 'https://s3/key-b1.jpg?sig=2', key: 'k/b1' },
        { ts: 120, url: 'https://s3/key-b2.jpg?sig=3', key: 'k/b2' },
        { ts: 250, url: 'https://s3/key-c1.jpg?sig=4', key: 'k/c1' },
      ],
    })

    // Slide refs are bare-alt `![](url)` (matches the export.ts regex on the
    // extension side that rewrites them to local filenames in zip export).
    expect(md).toContain('![](https://s3/key-a1.jpg?sig=1)')
    expect(md).toContain('![](https://s3/key-b1.jpg?sig=2)')
    expect(md).toContain('![](https://s3/key-b2.jpg?sig=3)')
    expect(md).toContain('![](https://s3/key-c1.jpg?sig=4)')

    // Each section's slides must land in its own block (between the
    // section heading and the next H2). The renderer doesn't emit `---`
    // dividers — H2 underlines do the visual separation — so split on
    // the next `\n## ` instead.
    const aBlock = md.split('## A')[1].split(/\n## /)[0]
    const bBlock = md.split('## B')[1].split(/\n## /)[0]
    const cBlock = md.split('## C')[1].split(/\n## /)[0]
    expect(aBlock).toContain('![](https://s3/key-a1.jpg?sig=1)')
    expect(aBlock).not.toContain('![](https://s3/key-b1.jpg?sig=2)')
    expect(bBlock).toContain('![](https://s3/key-b1.jpg?sig=2)')
    expect(bBlock).toContain('![](https://s3/key-b2.jpg?sig=3)')
    expect(bBlock).not.toContain('![](https://s3/key-c1.jpg?sig=4)')
    expect(cBlock).toContain('![](https://s3/key-c1.jpg?sig=4)')
  })

  it('skips slide embedding when no slides provided', () => {
    const o: Outline = {
      title: 't',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, ctx)
    expect(md).not.toMatch(/!\[\]\(/)
  })

  it('inferred key_term is rendered as > [!note] callout', () => {
    const o: Outline = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [{ term: '純資産', definition: '資産から負債を差し引いた正味財産', ts: 0, from: 'inferred' as const }],
        examples: [], points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('> [!note] 補足 — ※ 純資産')
    expect(md).toContain('> 資産から負債を差し引いた正味財産')
    // transcript path must NOT appear
    expect(md).not.toContain('- **純資産**:')
  })

  it('inferred point is rendered as > [!note] callout', () => {
    const o: Outline = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [],
        examples: [],
        points: [{ text: '追加の補足ポイント', ts: 0, important: false, from: 'inferred' as const }],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('> [!note] 補足')
    expect(md).toContain('> ※ 追加の補足ポイント')
    // transcript path must NOT appear (no deep-link arrow)
    expect(md).not.toContain('- 追加の補足ポイント')
  })

  it('inferred example is rendered as > [!note] callout', () => {
    const o: Outline = {
      title: 'X',
      sections: [{
        heading: 'A', ts: 0, summary: '',
        key_terms: [],
        examples: [{ text: 'AI生成の補足用例', ts: 0, from: 'inferred' as const }],
        points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('> [!note] 補足')
    expect(md).toContain('> ※ AI生成の補足用例')
    // transcript path must NOT appear (no "例:" prefix)
    expect(md).not.toContain('- 例: AI生成の補足用例')
  })

  it('sanitises wikilink targets (no [, ], |, ^, # leaks)', () => {
    const o: Outline = {
      title: 't',
      course: 'My [Course] | Spring',  // intentionally dangerous
      sections: [{
        heading: 'h', ts: 0, summary: '',
        key_terms: [{ term: 'A^B#C', definition: 'd', ts: 0, from: 'transcript' as const }],
        examples: [], points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, ctx)
    expect(md).toContain('course: "[[My Course  Spring]]"')
    expect(md).toContain('[[ABC]]')
    // No raw broken-link characters in the wikilink
    expect(md).not.toContain('[[A^B#C]]')
  })

  it('escapes backslash in extraTags so YAML frontmatter round-trips', () => {
    // CodeQL js/incomplete-sanitization (alert #3) — quoteIfNeeded
    // originally escaped `"` but not `\`. A backslash in a tag breaks
    // the YAML scalar two ways:
    //   - middle: `back\slash` emits `"back\slash"`; the parser reads
    //     `\s` as an undefined escape sequence
    //   - trailing: `foo\` emits `"foo\"`; the parser reads `\"` as an
    //     escaped close-quote and the scalar never closes, corrupting
    //     the entire frontmatter document
    const o: Outline = {
      title: 't',
      sections: [{
        heading: 'h', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, {
      ...ctx,
      extraTags: ['back\\slash', 'foo\\'],
    })
    // Each `\` must be emitted as `\\` in the YAML scalar.
    expect(md).toContain('"back\\\\slash"')
    expect(md).toContain('"foo\\\\"')
    // Single-escape forms (the buggy output) must never appear.
    expect(md).not.toContain('"back\\slash"')
    expect(md).not.toContain('"foo\\"')
  })

  it('escapes backslash and double-quote in course/lecturer/key_terms frontmatter', () => {
    // Same bug class as the extraTags fix in markdown-obsidian.ts:
    // course / lecturer / key_terms each wrap a sanitiseWikilink(...)
    // value in a raw `"[[…]]"` YAML scalar. sanitiseWikilink only strips
    // `[`, `]`, `|`, `^`, `#` — it leaves `\` and `"` untouched. An LLM-
    // generated course / lecturer / tag that contains either character
    // (round-tripped through sessions.outline JSONB) corrupts the
    // exported .md frontmatter three ways:
    //   - middle `\`     : YAML reads `\W` as an undefined escape
    //   - trailing `\`   : YAML reads `\]` as undefined, and the
    //                      following `]]"` no longer closes the scalar
    //   - embedded `"`   : terminates the YAML scalar early, breaking
    //                      the rest of the frontmatter line
    const o: Outline = {
      title: 't',
      course: 'Course\\With"Quote',  // mid `\` + embedded `"`
      lecturer: 'Prof\\',             // trailing `\`
      sections: [{
        heading: 'h', ts: 0, summary: '',
        key_terms: [
          { term: 'term\\one', definition: 'd1', ts: 0, from: 'transcript' as const },
          { term: 'tag"with"q', definition: 'd2', ts: 0, from: 'transcript' as const },
        ],
        examples: [], points: [],
      }],
    }
    const md = outlineToObsidianMarkdown(o, ctx)

    // Each `\` must be emitted as `\\` and each `"` as `\"` in the YAML.
    expect(md).toContain('course: "[[Course\\\\With\\"Quote]]"')
    expect(md).toContain('lecturer: "[[Prof\\\\]]"')
    expect(md).toContain('- "[[term\\\\one]]"')
    expect(md).toContain('- "[[tag\\"with\\"q]]"')

    // Buggy single-escape forms (current pre-fix output) must NOT appear.
    expect(md).not.toContain('course: "[[Course\\With"Quote]]"')
    expect(md).not.toContain('lecturer: "[[Prof\\]]"')
    expect(md).not.toContain('- "[[term\\one]]"')
    expect(md).not.toContain('- "[[tag"with"q]]"')
  })

  // ──────────────────────────────────────────────────────────────────
  // New slot serialization (Task 23): procedure_steps / formula /
  // argument_chain / timeline — transcript + inferred variants each
  // ──────────────────────────────────────────────────────────────────

  it('procedure_steps (transcript) renders as ordered list with deep link', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        procedure_steps: [
          { text: '借方科目を確認する', order: 1, ts: 120, from: 'transcript' as const },
          { text: '貸方科目を確認する', order: 2, ts: 180, from: 'transcript' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('#### 手順')
    expect(md).toContain('1. 借方科目を確認する')
    expect(md).toContain('2. 貸方科目を確認する')
    // deep link present for transcript items
    expect(md).toContain('[▶ 02:00]')
    expect(md).toContain('[▶ 03:00]')
    // inferred callout must NOT appear
    expect(md).not.toContain('> [!note] 補足')
  })

  it('procedure_steps (inferred) renders as > [!note] callout with ※', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        procedure_steps: [
          { text: '検算を行う', order: 3, ts: 0, from: 'inferred' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('#### 手順')
    expect(md).toContain('> [!note] 補足')
    expect(md).toContain('> 3. ※ 検算を行う')
    // transcript path must NOT appear (no deep-link arrow)
    expect(md).not.toContain('3. 検算を行う [▶')
  })

  it('formula (transcript) renders as labeled ```math block', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        formula: [
          { label: '基本等式', expression: '資産 = 負債 + 純資産', ts: 60, from: 'transcript' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('#### 公式')
    expect(md).toContain('**基本等式**')
    expect(md).toContain('```math')
    expect(md).toContain('資産 = 負債 + 純資産')
    // inferred callout must NOT appear
    expect(md).not.toContain('> [!note] 補足')
  })

  it('formula (inferred) renders as > [!note] callout with math block', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        formula: [
          { label: 'Pythagoras', expression: 'a² + b² = c²', ts: 0, from: 'inferred' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'en' })
    expect(md).toContain('#### Formula')
    expect(md).toContain('> [!note] Note — ※ Pythagoras')
    expect(md).toContain('> ```math')
    expect(md).toContain('> a² + b² = c²')
    // transcript path (unlabeled **label** + plain ```math) must NOT appear
    expect(md).not.toContain('**Pythagoras**')
  })

  it('argument_chain (transcript) renders as bulleted → list with deep link', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        argument_chain: [
          { text: '前提: 気候変動は人類の脅威である', ts: 300, from: 'transcript' as const },
          { text: '結論: 早急な政策転換が必要だ', ts: 360, from: 'transcript' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('#### 論証')
    expect(md).toContain('- → 前提: 気候変動は人類の脅威である')
    expect(md).toContain('- → 結論: 早急な政策転換が必要だ')
    // deep links for transcript items
    expect(md).toContain('[▶ 05:00]')
    expect(md).toContain('[▶ 06:00]')
    // inferred callout must NOT appear
    expect(md).not.toContain('> [!note] 補足')
  })

  it('argument_chain (inferred) renders as > [!note] callout with → ※', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        argument_chain: [
          { text: '中間推論: コスト削減が競争力を高める', ts: 0, from: 'inferred' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('#### 論証')
    expect(md).toContain('> [!note] 補足')
    expect(md).toContain('> → ※ 中間推論: コスト削減が競争力を高める')
    // transcript path must NOT appear
    expect(md).not.toContain('- → 中間推論')
  })

  it('timeline (transcript) renders as markdown table with locale-specific event header', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        timeline: [
          { when: '1868年', event: '明治維新', ts: 10, from: 'transcript' as const },
          { when: '1945年', event: '第二次世界大戦終結', ts: 20, from: 'transcript' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'ja' })
    expect(md).toContain('#### 時系列')
    // table header includes locale event label (ja = イベント)
    expect(md).toContain('| 時系列 | イベント |')
    expect(md).toContain('|---|---|')
    expect(md).toContain('| 1868年 | 明治維新 |')
    expect(md).toContain('| 1945年 | 第二次世界大戦終結 |')
    // no ※ marker for transcript items
    expect(md).not.toContain('| ※')
  })

  it('timeline (inferred) renders row with ※ prefix in when column', () => {
    const o: Outline = {
      title: 'T',
      sections: [{
        heading: 'H', ts: 0, summary: '',
        key_terms: [], examples: [], points: [],
        timeline: [
          { when: 'Q3 2024', event: 'Revenue peak inferred from trend', ts: 0, from: 'inferred' as const },
        ],
      }],
    }
    const md = outlineToObsidianMarkdown(o, { ...ctx, lang: 'en' })
    expect(md).toContain('#### Timeline')
    // table header locale = en → Event
    expect(md).toContain('| Timeline | Event |')
    // inferred row has ※ prefix in when column
    expect(md).toContain('| ※ Q3 2024 | Revenue peak inferred from trend |')
  })
})
