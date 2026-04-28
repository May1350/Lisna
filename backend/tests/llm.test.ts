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
      chunkDurationSec: 600,
    })
    expect(r.notes).toHaveLength(2)
    expect(r.notes[1].important).toBe(true)
  })

  it('shifts chunk-relative ts by startTimeSec', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            notes: [
              { ts: 2, text: 'A', important: false },
              { ts: 7, text: 'B', important: false },
            ]
          })
        }
      }]
    })
    process.env.GROQ_API_KEY = 'test'
    const r = await summarizeChunk({
      newTranscript: '...',
      priorContext: '',
      startTimeSec: 60,         // chunk starts 1 minute into video
      chunkDurationSec: 10,
    })
    // Backend shifts model's chunk-relative ts (0..10) to absolute video time.
    expect(r.notes[0].ts).toBe(62)
    expect(r.notes[1].ts).toBe(67)
  })

  it('clamps out-of-range ts values', async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            notes: [
              { ts: -5, text: 'before', important: false },
              { ts: 999, text: 'after', important: false },
            ]
          })
        }
      }]
    })
    process.env.GROQ_API_KEY = 'test'
    const r = await summarizeChunk({
      newTranscript: '...',
      priorContext: '',
      startTimeSec: 100,
      chunkDurationSec: 10,
    })
    expect(r.notes[0].ts).toBe(100)  // clamped to startTimeSec + 0
    expect(r.notes[1].ts).toBe(110)  // clamped to startTimeSec + chunkDurationSec
  })
})
