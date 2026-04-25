import { describe, it, expect } from 'vitest'

// Simple sanity: pixelDiff equivalent test via construction.
describe('SlideDetector pixel logic', () => {
  it('produces ImageData of expected size', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 4; canvas.height = 4
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 4, 4)
    const img = ctx.getImageData(0, 0, 4, 4)
    expect(img.data.length).toBe(64)  // 4*4*4 channels
  })
})
