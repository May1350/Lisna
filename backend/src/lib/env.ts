import { z } from 'zod'
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { getSecretsManager } from './aws-clients.js'

/**
 * Zod schema for environment variables consumed by the model-download
 * feature (Plan A). All new Lambda env vars for this feature live here
 * so callers get typed + validated access via `Env.parse(process.env)`.
 *
 * R2 fields are optional so deployments with `MODEL_DOWNLOAD_ENABLED=off`
 * don't require R2 credentials at startup.
 */
export const Env = z.object({
  // Model download (Plan A — Phase A)
  MODEL_DOWNLOAD_ENABLED: z.enum(['off', 'allowlist', 'all']).default('off'),
  MODEL_DOWNLOAD_ROLLOUT_PCT: z.coerce.number().int().min(0).max(100).default(0),
  MIN_SUPPORTED_APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/).default('0.1.0'),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT_URL: z.string().url().optional(),
})

let cachedSecrets: Record<string, string> | undefined

export async function loadAppSecrets(): Promise<Record<string, string>> {
  if (cachedSecrets) return cachedSecrets
  const arn = process.env.APP_SECRET_ARN
  if (!arn) {
    cachedSecrets = process.env as Record<string, string>
    return cachedSecrets
  }
  const out = await getSecretsManager().send(new GetSecretValueCommand({ SecretId: arn }))
  cachedSecrets = JSON.parse(out.SecretString!)
  // Promote secret values into process.env, but NEVER overwrite values
  // the Lambda already received from CDK environment. The AppSecret
  // bundle historically carried non-secret deploy outputs (S3_BUCKET,
  // WS_ENDPOINT, …) with placeholder strings like "TEMP_PLACEHOLDER_
  // TO_BE_UPDATED" — when this loop blindly assigned them, it
  // clobbered the correct CDK-injected values and POSTs to S3 hit
  // NoSuchBucket. Lambda env wins; secrets only fill what's absent.
  for (const [k, v] of Object.entries(cachedSecrets!)) {
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = v
    }
  }
  return cachedSecrets!
}
