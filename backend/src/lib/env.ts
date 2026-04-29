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
  for (const [k, v] of Object.entries(cachedSecrets!)) process.env[k] = v
  return cachedSecrets!
}
