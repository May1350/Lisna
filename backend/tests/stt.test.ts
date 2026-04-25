import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('openai', () => ({
  default: class { audio = { transcriptions: { create: mockCreate } } }
}))

import { transcribeChunk } from '../src/lib/stt.js'

beforeEach(() => mockCreate.mockReset())

describe('transcribeChunk', () => {
  it('calls OpenAI with the correct model and returns text', async () => {
    mockCreate.mockResolvedValue({ text: 'こんにちは。今日は AI について話します。' })
    process.env.OPENAI_API_KEY = 'sk-test'
    const result = await transcribeChunk(new Uint8Array([1, 2, 3]).buffer, 'audio/webm')
    expect(result.text).toContain('AI')
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-4o-mini-transcribe',
    }))
  })

  it('throws on empty buffer', async () => {
    await expect(transcribeChunk(new ArrayBuffer(0), 'audio/webm')).rejects.toThrow(/empty/)
  })
})
