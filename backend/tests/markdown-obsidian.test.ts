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
            { term: 'サステナビリティ', definition: '持続可能性の英訳。多層的に存在', ts: 5 },
          ],
          examples: [
            { text: '地球の環境', ts: 18 },
            { text: '個人の寿命', ts: 32 },
          ],
          points: [
            { text: '持続可能性は地球→国→企業→地域→個人と階層化される', ts: 65, important: true },
            { text: 'サステナビリティ＝環境問題は狭い', ts: 88, important: false },
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

    // 定義 callout
    expect(md).toContain('> [!定義] サステナビリティ')

    // Examples with deep-link timestamps (URL already has ?, so & joiner)
    expect(md).toContain('地球の環境 [▶ 00:18](https://example.com/lecture?id=42&t=18s)')

    // Important point with star (auto-wikilink only fires on known terms;
    // "持続可能性" isn't a key_term in this fixture so it stays plain)
    expect(md).toMatch(/⭐ \*\*持続可能性は地球[^\n]*階層化される\*\*/)

    // 関連用語 inline links
    expect(md).toContain('**関連用語**: [[ESG]] | [[CSR]]')

    // 関連リンク section
    expect(md).toContain('## 関連リンク')
    expect(md).toContain('- [[ESG投資]]')
    expect(md).toContain('- [[コーポレートガバナンス・コード]]')

    // 用語インデックス
    expect(md).toContain('## 用語インデックス')
    expect(md).toContain('- [[サステナビリティ]]')

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

  it('builds deep links with & when URL has query, ? when not', () => {
    const o: Outline = {
      title: 't',
      sections: [{
        heading: 'h', ts: 0, summary: '',
        key_terms: [], examples: [{ text: 'ex', ts: 90 }], points: [],
      }],
    }
    const noQuery = outlineToObsidianMarkdown(o, { ...ctx, sourceUrl: 'https://example.com/lec' })
    expect(noQuery).toContain('[▶ 01:30](https://example.com/lec?t=90s)')

    const withQuery = outlineToObsidianMarkdown(o, { ...ctx, sourceUrl: 'https://example.com/lec?id=1' })
    expect(withQuery).toContain('[▶ 01:30](https://example.com/lec?id=1&t=90s)')
  })

  it('sanitises wikilink targets (no [, ], |, ^, # leaks)', () => {
    const o: Outline = {
      title: 't',
      course: 'My [Course] | Spring',  // intentionally dangerous
      sections: [{
        heading: 'h', ts: 0, summary: '',
        key_terms: [{ term: 'A^B#C', definition: 'd', ts: 0 }],
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
