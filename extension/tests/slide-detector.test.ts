import { describe, it, expect } from 'vitest'
import { pixelDiff } from '../src/content/slide-detector'

function makeImageData(width: number, height: number, fill: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]
    data[i + 1] = fill[1]
    data[i + 2] = fill[2]
    data[i + 3] = fill[3]
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

describe('pixelDiff', () => {
  it('returns 0 for identical images', () => {
    const a = makeImageData(4, 4, [255, 255, 255, 255])
    const b = makeImageData(4, 4, [255, 255, 255, 255])
    expect(pixelDiff(a, b)).toBe(0)
  })

  it('returns 1 when every pixel differs significantly', () => {
    const a = makeImageData(4, 4, [0, 0, 0, 255])
    const b = makeImageData(4, 4, [255, 255, 255, 255])
    expect(pixelDiff(a, b)).toBe(1)
  })

  it('ignores tiny per-channel differences below the threshold', () => {
    const a = makeImageData(4, 4, [100, 100, 100, 255])
    const b = makeImageData(4, 4, [110, 110, 110, 255])
    expect(pixelDiff(a, b)).toBe(0)
  })

  it('counts a pixel as changed when the channel sum exceeds 60', () => {
    const a = makeImageData(4, 4, [0, 0, 0, 255])
    const b = makeImageData(4, 4, [30, 30, 30, 255])
    expect(pixelDiff(a, b)).toBe(1)
  })
})
