import { z } from 'zod'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  // Phase 6 (2026-04-29): split provider responsibilities.
  //  - GROQ_API_KEY drives STT only (Whisper Large-v3 free tier — ~8 h/day).
  //  - OPENAI_API_KEY drives the LLM curator (GPT-5 nano, pre-paid billing).
  // Both required for production. STT can fall back to OpenAI Whisper API
  // if Groq is down (already supported in stt.ts).
  GROQ_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  // Phase 6.2 (2026-04-29 후반): Claude Haiku 4.5 as primary curator —
  // GPT-5 nano's reasoning latency (70-99 s) was unacceptable on the
  // on-demand path. Anthropic key is OPTIONAL: if present the curator
  // auto-selects Anthropic; if absent it falls back to OpenAI GPT-5 nano.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Gemini was the previous curator. Kept optional so existing Secrets
  // Manager entries don't fail validation, but no longer wired in.
  GOOGLE_GENAI_API_KEY: z.string().min(1).optional(),
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
