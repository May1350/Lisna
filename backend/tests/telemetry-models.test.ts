import { describe, it, expect, vi } from 'vitest'
import { insertDownloadEvent, bucketOsVersion } from '../src/lib/telemetry-models.js'

describe('telemetry-models', () => {
  describe('insertDownloadEvent', () => {
    it('calls pool.query with the correct INSERT + ON CONFLICT clause', async () => {
      const queryMock = vi.fn().mockResolvedValue({ rowCount: 1 })
      const pool = { query: queryMock } as unknown as import('pg').Pool

      await insertDownloadEvent(pool, {
        event_id: '550e8400-e29b-41d4-a716-446655440000',
        device_id: '00000000-0000-0000-0000-000000000001',
        user_id: null,
        timestamp: new Date('2026-05-25T10:00:00Z'),
        event_type: 'download.complete',
        app_version: '0.2.0',
        os_family: 'macos-26',
        arch: 'arm64',
        source_intent: 'lecture',
        payload: { slot: 'stt', duration_ms: 5000 },
      })

      expect(queryMock).toHaveBeenCalledOnce()
      const [sql, params] = queryMock.mock.calls[0]
      expect(sql).toContain('INSERT INTO model_download_events')
      expect(sql).toContain('ON CONFLICT (event_id) DO NOTHING')
      expect(params).toHaveLength(10)
      expect(params[2]).toBeNull()       // user_id slot
      expect(params[8]).toBe('lecture')  // source_intent slot
    })
  })

  describe('bucketOsVersion', () => {
    it('darwin 23.x → macos-14', () =>
      expect(bucketOsVersion('darwin-23.6.0-arm64')).toBe('macos-14'))

    it('darwin 25.x → macos-26', () =>
      expect(bucketOsVersion('darwin-25.3.0-arm64')).toBe('macos-26'))

    it('darwin 24.x → macos-15', () =>
      expect(bucketOsVersion('darwin-24.0.0-arm64')).toBe('macos-15'))

    it('unparseable → "unknown"', () => {
      expect(bucketOsVersion('Windows 10')).toBe('unknown')
      expect(bucketOsVersion('')).toBe('unknown')
    })
  })
})
