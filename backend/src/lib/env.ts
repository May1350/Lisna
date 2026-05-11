import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { getSecretsManager } from './aws-clients.js'

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
