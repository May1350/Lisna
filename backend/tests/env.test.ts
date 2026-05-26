import { describe, it, expect } from 'vitest'
import { Env } from '../src/lib/env.js'

// Minimum env vars that the Env schema requires (no defaults for these).
// Mirrors what the secrets loader populates from AWS Secrets Manager
// when running in Lambda; in tests we supply them directly.
const baseEnv: Record<string, string> = {}

describe('env — model download fields', () => {
  it('parses MODEL_DOWNLOAD_ENABLED enum', () => {
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
    expect(parsed.MODEL_DOWNLOAD_ROLLOUT_PCT).toBe(50) // coerced to number
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
