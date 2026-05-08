import { z } from 'zod'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  // Provider split:
  //   - GROQ_API_KEY drives STT only (Whisper Large-v3 free tier ~8 h/day).
  //     Falls back to OPENAI_API_KEY (Whisper-1) if unset — see stt.ts.
  //   - OPENAI_API_KEY drives the curator (gpt-4o-mini, pre-paid billing).
  // Both required for production. The fallback in stt.ts means a Groq
  // outage won't take down STT as long as OpenAI is reachable.
  GROQ_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // Anthropic is a dormant curator alternative. Setting CURATOR_PROVIDER=
  // 'anthropic' in the Lambda env switches selectModels() in curator.ts
  // to Claude. If you flip the provider, also set ANTHROPIC_API_KEY.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
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
  // Materialise secrets into process.env, but DO NOT overwrite values
  // that the Lambda was already started with via CDK environment vars.
  // The AppSecret was historically used as a catch-all and contains
  // stale placeholders (e.g. `S3_BUCKET: TEMP_PLACEHOLDER_TO_BE_UPDATED`)
  // for keys that are now correctly set by CDK. Clobbering them here
  // caused S3 PutObject to fail with NoSuchBucket on the first request
  // after warmup. Treat CDK env as authoritative; secrets only fill blanks.
  for (const [k, v] of Object.entries(cachedSecrets!)) {
    if (!process.env[k]) process.env[k] = v
  }
  return cachedSecrets!
}
