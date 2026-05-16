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
})
