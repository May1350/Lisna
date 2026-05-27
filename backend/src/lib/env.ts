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
  // Comma-joined email allowlist loaded from ModelDownloadSecret. Only used when
  // MODEL_DOWNLOAD_ENABLED === 'allowlist'. Parsed into a Set in the handler.
  ALLOWLIST_EMAILS: z.string().optional(),
})

let cachedSecrets: Record<string, string> | undefined

/**
 * Load the operator-managed AppSecret (studyhelper/app) into process.env.
 *
 * The AppSecret is an empty CDK container — CDK does NOT manage its value.
 * All runtime keys (JWT_SECRET, GOOGLE_CLIENT_*, GROQ_API_KEY, STRIPE_*, …)
 * are set by the operator via AWS Console and are never overwritten by a deploy.
 *
 * Idempotent: subsequent calls return the cached value without a network round-trip.
 */
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

let cachedModelDownloadSecrets: Record<string, string> | undefined

/**
 * Load the CDK-managed ModelDownloadSecret (studyhelper/model-download) into
 * process.env. This secret carries R2 credentials and ALLOWLIST_EMAILS for
 * the model-download feature. It is separate from AppSecret so CDK deploys
 * can safely rewrite it without touching operator-managed production keys.
 *
 * Call this from model-download handler entry points in addition to
 * loadAppSecrets(). Idempotent — subsequent calls are no-ops.
 *
 * Fields merged: ALLOWLIST_EMAILS, R2_BUCKET, R2_ACCESS_KEY_ID,
 *                R2_SECRET_ACCESS_KEY, R2_ENDPOINT_URL
 * Same non-overwrite rule as loadAppSecrets (CDK env wins over secret value).
 */
export async function loadModelDownloadSecrets(): Promise<Record<string, string>> {
  if (cachedModelDownloadSecrets) return cachedModelDownloadSecrets
  const arn = process.env.MODEL_DOWNLOAD_SECRET_ARN
  if (!arn) {
    // Local / test environment — process.env already has the vars (or they're absent).
    cachedModelDownloadSecrets = process.env as Record<string, string>
    return cachedModelDownloadSecrets
  }
  const out = await getSecretsManager().send(new GetSecretValueCommand({ SecretId: arn }))
  cachedModelDownloadSecrets = JSON.parse(out.SecretString!)
  // Same non-overwrite rule as loadAppSecrets: CDK-injected Lambda env wins.
  for (const [k, v] of Object.entries(cachedModelDownloadSecrets!)) {
    if (process.env[k] === undefined || process.env[k] === '') {
      process.env[k] = v
    }
  }
  return cachedModelDownloadSecrets!
}
