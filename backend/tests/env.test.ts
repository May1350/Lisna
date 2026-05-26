import { describe, it, expect } from 'vitest'
import { Env } from '../src/lib/env.js'

// All schema fields carry defaults or are optional, so {} is a valid minimum.
// In production, the secrets loader populates these from AWS Secrets Manager
// + process.env; in tests we supply only the fields each test exercises.
const baseEnv: Record<string, string> = {}

describe('env — model download fields', () => {
  it('parses allowlist mode with full R2 config (happy path)', () => {
    const parsed = Env.parse({
      ...baseEnv,
      MODEL_DOWNLOAD_ENABLED: 'allowlist',
      MODEL_DOWNLOAD_ROLLOUT_PCT: '50',
      MIN_SUPPORTED_APP_VERSION: '0.1.1',
      R2_ACCESS_KEY_ID: 'redacted',
      R2_SECRET_ACCESS_KEY: 'redacted',
      R2_BUCKET: 'lisna-models-prod',
      R2_ENDPOINT_URL: 'https://acct.r2.cloudflarestorage.com',
    })
    expect(parsed.MODEL_DOWNLOAD_ENABLED).toBe('allowlist')
  })

  it('coerces MODEL_DOWNLOAD_ROLLOUT_PCT string to integer', () => {
    const parsed = Env.parse({ ...baseEnv, MODEL_DOWNLOAD_ROLLOUT_PCT: '50' })
    expect(parsed.MODEL_DOWNLOAD_ROLLOUT_PCT).toBe(50)
    expect(typeof parsed.MODEL_DOWNLOAD_ROLLOUT_PCT).toBe('number')
  })

  it('rejects invalid MODEL_DOWNLOAD_ENABLED value', () => {
    expect(() =>
      Env.parse({ ...baseEnv, MODEL_DOWNLOAD_ENABLED: 'sometimes' })
    ).toThrow()
  })

  it('defaults MODEL_DOWNLOAD_ROLLOUT_PCT to 0 when absent', () => {
    const parsed = Env.parse({ ...baseEnv })
    expect(parsed.MODEL_DOWNLOAD_ROLLOUT_PCT).toBe(0)
  })

  it('rejects MODEL_DOWNLOAD_ROLLOUT_PCT > 100', () => {
    expect(() =>
      Env.parse({ ...baseEnv, MODEL_DOWNLOAD_ROLLOUT_PCT: '150' })
    ).toThrow()
  })
})
