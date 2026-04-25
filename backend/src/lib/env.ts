import { z } from 'zod'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_GENAI_API_KEY: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_PRO: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  WS_ENDPOINT: z.string().url().optional(),
  AWS_REGION: z.string().default('ap-northeast-1'),
})

export type AppEnv = z.infer<typeof Env>

export function loadEnv(): AppEnv {
  return Env.parse(process.env)
}

let cachedSecrets: Record<string, string> | undefined

export async function loadAppSecrets(): Promise<Record<string, string>> {
  if (cachedSecrets) return cachedSecrets
  const arn = process.env.APP_SECRET_ARN
  if (!arn) {
    cachedSecrets = process.env as Record<string, string>
    return cachedSecrets
  }
  const sm = new SecretsManagerClient({})
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }))
  cachedSecrets = JSON.parse(out.SecretString!)
  for (const [k, v] of Object.entries(cachedSecrets!)) process.env[k] = v
  return cachedSecrets!
}
