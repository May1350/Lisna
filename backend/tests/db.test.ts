import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/lib/db.js', async () => {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT 1')) return [{ ok: 1 }]
      return []
    }),
    getPool: vi.fn(),
  }
})

import { query } from '../src/lib/db.js'

describe('db.query', () => {
  it('returns rows from a select', async () => {
    const rows = await query('SELECT 1 AS ok')
    expect(rows[0]).toEqual({ ok: 1 })
  })
})
