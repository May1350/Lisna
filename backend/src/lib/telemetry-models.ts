import type { Pool } from 'pg'

export interface DownloadEventRow {
  event_id: string
  device_id: string
  user_id: string | null
  timestamp: Date
  event_type: string
  app_version: string
  os_family: string
  arch: string
  source_intent: 'meeting' | 'lecture' | 'unset'
  payload: Record<string, unknown>
}

export async function insertDownloadEvent(pool: Pool, row: DownloadEventRow): Promise<void> {
  await pool.query(
    `INSERT INTO model_download_events
       (event_id, device_id, user_id, timestamp, event_type, app_version, os_family, arch, source_intent, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      row.event_id,
      row.device_id,
      row.user_id,
      row.timestamp,
      row.event_type,
      row.app_version,
      row.os_family,
      row.arch,
      row.source_intent,
      row.payload,
    ],
  )
}

/**
 * Maps darwin kernel major version to bucketed macOS marketing name.
 * darwin-22 = macOS Ventura 13
 * darwin-23 = macOS Sonoma 14
 * darwin-24 = macOS Sequoia 15
 * darwin-25 = macOS Tahoe 26 (Apple jumped versioning 16→26 in 2026)
 * darwin-26 = macOS 27
 * Drops minor + build component to reduce fingerprintability.
 */
export function bucketOsVersion(osVersion: string): string {
  const m = /^darwin-(\d+)\./.exec(osVersion)
  if (!m) return 'unknown'
  const darwinMajor = Number(m[1])
  const macOsByDarwin: Record<number, string> = {
    22: 'macos-13',
    23: 'macos-14',
    24: 'macos-15',
    25: 'macos-26',
    26: 'macos-27',
  }
  return macOsByDarwin[darwinMajor] ?? `macos-darwin-${darwinMajor}`
}
