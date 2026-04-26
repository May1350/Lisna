import { describe, it, expect } from 'vitest'
import { buildMarkdown } from '../src/lib/markdown.js'

describe('buildMarkdown', () => {
  it('produces a non-empty Markdown buffer with required sections', () => {
    const buf = buildMarkdown({
      title: 'テスト講義',
      notes: [
        { ts: 42, text: 'AI の定義', important: false },
        { ts: 135, text: '誤差逆伝播', important: true },
      ],
      slides: [
        { ts: 30, url: 'https://example.com/s1.jpg' },
      ],
    })
    expect(buf.byteLength).toBeGreaterThan(0)
    const text = buf.toString('utf8')
    expect(text.startsWith('# ')).toBe(true)
    expect(text).toContain('## ノート')
    expect(text).toContain('## スライド')
    expect(text).toContain('**[02:15]** ⭐ 誤差逆伝播')
    expect(text).toContain('[00:42] AI の定義')
    expect(text).toContain('![00:30](https://example.com/s1.jpg)')
  })
})
