// Migration 010 — model_download_events + model_download_weekly_agg
//
// No live Postgres is available in CI or local dev without DATABASE_URL
// (all existing backend tests mock db.ts). This test validates the SQL
// *content* — exact column names/order, nullability keyword presence,
// default value strings, and PK column list — matching the same
// structural contract that information_schema queries would assert.

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = join(__dirname, '../../src/migrations/010_model_download_events.sql')

let sql: string

beforeAll(() => {
  sql = readFileSync(SQL_PATH, 'utf8')
})

describe('migration 010 — model_download_events', () => {
  it('creates model_download_events table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS model_download_events/)
  })

  it('columns appear in correct order', () => {
    // Extract everything between the two outermost parens of model_download_events
    const tableMatch = sql.match(
      /CREATE TABLE IF NOT EXISTS model_download_events\s*\(([\s\S]*?)\);/
    )
    expect(tableMatch).not.toBeNull()
    const body = tableMatch![1]

    // Columns must appear in the plan-specified order (ordinal_position)
    const expected = [
      'event_id',
      'device_id',
      'user_id',
      'timestamp',
      'event_type',
      'app_version',
      'os_family',
      'arch',
      'source_intent',
      'payload',
    ]
    let lastIdx = -1
    for (const col of expected) {
      const idx = body.indexOf(col)
      expect(idx, `column "${col}" not found in table body`).toBeGreaterThan(-1)
      expect(idx, `column "${col}" is out of order`).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  it('user_id is nullable (no NOT NULL on user_id line)', () => {
    const lines = sql.split('\n')
    const userIdLine = lines.find(l => l.trimStart().startsWith('user_id'))
    expect(userIdLine).toBeDefined()
    // user_id must NOT carry NOT NULL — nullable by design (anonymous callers)
    expect(userIdLine).not.toMatch(/NOT NULL/)
  })

  it('user_id has REFERENCES users(id)', () => {
    expect(sql).toMatch(/user_id\s+uuid\s+REFERENCES users\(id\)/)
  })

  it('source_intent default is \'unset\'', () => {
    // Both tables have source_intent DEFAULT 'unset' — check event table's line
    const lines = sql.split('\n')
    const sourceIntentLines = lines.filter(l => l.trimStart().startsWith('source_intent'))
    expect(sourceIntentLines.length).toBeGreaterThanOrEqual(1)
    // Every source_intent column must carry DEFAULT 'unset'
    for (const line of sourceIntentLines) {
      expect(line).toMatch(/DEFAULT 'unset'/)
    }
  })

  it('payload has NOT NULL DEFAULT {}', () => {
    expect(sql).toMatch(/payload\s+jsonb\s+NOT NULL\s+DEFAULT '\{\}'::jsonb/)
  })

  it('creates required indexes', () => {
    expect(sql).toMatch(/idx_mde_device_time/)
    expect(sql).toMatch(/idx_mde_user_time/)
    expect(sql).toMatch(/idx_mde_type_time/)
    expect(sql).toMatch(/idx_mde_intent/)
  })

  it('partial index on user_id filters WHERE user_id IS NOT NULL', () => {
    expect(sql).toMatch(/idx_mde_user_time[\s\S]*?WHERE user_id IS NOT NULL/)
  })
})

describe('migration 010 — model_download_weekly_agg', () => {
  it('creates model_download_weekly_agg table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS model_download_weekly_agg/)
  })

  it('composite PK includes all 5 columns in exact order', () => {
    // PRIMARY KEY (device_id, model_id, week_start, event_type, source_intent)
    expect(sql).toMatch(
      /PRIMARY KEY\s*\(\s*device_id\s*,\s*model_id\s*,\s*week_start\s*,\s*event_type\s*,\s*source_intent\s*\)/
    )
  })

  it('count column has NOT NULL DEFAULT 0', () => {
    expect(sql).toMatch(/count\s+int\s+NOT NULL\s+DEFAULT 0/)
  })

  it('week_start is date type', () => {
    expect(sql).toMatch(/week_start\s+date\s+NOT NULL/)
  })
})
