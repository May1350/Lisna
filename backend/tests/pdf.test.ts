import { describe, it, expect } from 'vitest'
import { buildPdf } from '../src/lib/pdf.js'

describe('buildPdf', () => {
  it('produces a non-empty PDF buffer', async () => {
    const buf = await buildPdf({
      title: 'テスト講義',
      notes: [
        { ts: 42, text: 'AI の定義', important: false },
        { ts: 135, text: '⭐ 重要: 誤差逆伝播', important: true },
      ],
      slides: [],
    })
    expect(buf.byteLength).toBeGreaterThan(500)
    expect(buf.subarray(0, 4).toString()).toBe('%PDF')
  })
})
