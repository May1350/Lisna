import { describe, it, expect } from 'vitest'
import { __testOnly_parseJudgeResponse } from '../scripts/lib/judge.js'

describe('judge response parsing — provenance axis', () => {
  it('parses 6-axis response correctly', () => {
    const raw = JSON.stringify({
      coverage: 8, accuracy: 9, hierarchy: 8,
      conciseness: 7, importance: 8, provenance: 7.5,
      overall: 8.1,
      issues: ['x'], wins: ['y'],
    })
    const r = __testOnly_parseJudgeResponse(raw)
    expect(r.provenance).toBe(7.5)
    expect(r.overall).toBe(8.1)
  })

  it('legacy 5-axis response defaults provenance to 0 (or NaN — see policy)', () => {
    const raw = JSON.stringify({
      coverage: 8, accuracy: 9, hierarchy: 8,
      conciseness: 7, importance: 8,
      overall: 8.1,
      issues: [], wins: [],
    })
    const r = __testOnly_parseJudgeResponse(raw)
    expect(r.provenance).toBe(0)
  })
})
