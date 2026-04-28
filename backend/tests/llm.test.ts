import { describe, it, expect, vi } from 'vitest'

// Mock the OpenAI SDK so summarizeChunk doesn't try to actually hit Groq.
// llm.ts constructs `new OpenAI({...})` and calls `chat.completions.create`.
const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: mockCreate } }
  }
}))

import { summarizeChunk, formatTimestamp } from '../src/lib/llm.js'

describe('formatTimestamp', () => {
  it('formats seconds as mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(42)).toBe('00:42')
    expect(formatTimestamp(135)).toBe('02:15')
    expect(formatTimestamp(3600)).toBe('60:00')
  })
})

describe('summarizeChunk', () => {
  it('returns parsed note items', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            notes: [
              { ts: 42, text: 'AI の定義', important: false },
              { ts: 135, text: '⭐ 重要: 誤差逆伝播', important: true },
            ]
          })
        }
      }]
    })
    process.env.GROQ_API_KEY = 'test'
    const r = await summarizeChunk({
      newTranscript: '本日は AI について話します...',
      priorContext: '',
      startTimeSec: 0,
    })
    expect(r.notes).toHaveLength(2)
    expect(r.notes[1].important).toBe(true)
  })
})
