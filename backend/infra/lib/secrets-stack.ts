import { Stack, type StackProps, CfnOutput, SecretValue } from 'aws-cdk-lib'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class SecretsStack extends Stack {
  readonly appSecret: Secret

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    // Compute ALLOWLIST_EMAILS at synth time from allowlist-emails.json.
    // Non-holdout users are joined into a comma-separated string and stored
    // in the AppSecret so all Lambdas pick it up via loadAppSecrets().
    // To add a user: edit allowlist-emails.json and redeploy (deploy-backend CI).
    const allowlistPath = path.join(__dirname, '..', 'allowlist-emails.json')
    const allowlistJson: {
      version: number
      users: Array<{ email: string; added_at: string; holdout: boolean }>
    } = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
    const allowlistCsv = allowlistJson.users
      .filter(u => !u.holdout)
      .map(u => u.email)
      .join(',')

    // IMPORTANT — CDK manages this secret's value. Any operator-set fields
    // NOT listed in secretObjectValue below will be erased on deploy.
    // All runtime keys must be declared here (use 'PENDING' for fields the
    // operator fills via AWS Console after first deploy — see A12 runbook).
    //
    // Keys that MUST be updated in Console post-deploy (real values):
    //   JWT_SECRET              — generate: openssl rand -base64 32
    //   GOOGLE_CLIENT_ID        — GCP OAuth 2.0 credential
    //   GOOGLE_CLIENT_SECRET    — GCP OAuth 2.0 credential
    //   GROQ_API_KEY            — Groq dashboard
    //   OPENAI_API_KEY          — OpenAI dashboard (curator fallback)
    //   STRIPE_SECRET_KEY       — Stripe dashboard (sk_live_…)
    //   STRIPE_PRICE_PRO        — Stripe product price ID (price_…)
    //   STRIPE_WEBHOOK_SECRET   — Stripe webhook signing secret (whsec_…)
    //   R2_ACCESS_KEY_ID        — Cloudflare R2 API token key
    //   R2_SECRET_ACCESS_KEY    — Cloudflare R2 API token secret
    //   R2_ENDPOINT_URL         — https://<acct>.r2.cloudflarestorage.com
    this.appSecret = new Secret(this, 'AppSecret', {
      secretName: 'studyhelper/app',
      description: 'JWT secret, OAuth, AI keys, Stripe, R2 model download creds',
      secretObjectValue: {
        // Operator-managed keys (set via Console post-deploy; PENDING is a sentinel)
        JWT_SECRET:             SecretValue.unsafePlainText('PENDING'),
        GOOGLE_CLIENT_ID:       SecretValue.unsafePlainText('PENDING'),
        GOOGLE_CLIENT_SECRET:   SecretValue.unsafePlainText('PENDING'),
        GROQ_API_KEY:           SecretValue.unsafePlainText('PENDING'),
        OPENAI_API_KEY:         SecretValue.unsafePlainText('PENDING'),
        STRIPE_SECRET_KEY:      SecretValue.unsafePlainText('PENDING'),
        STRIPE_PRICE_PRO:       SecretValue.unsafePlainText('PENDING'),
        STRIPE_WEBHOOK_SECRET:  SecretValue.unsafePlainText('PENDING'),
        // R2 model-download credentials (Task A12 — fill after R2 bucket creation)
        R2_ACCESS_KEY_ID:       SecretValue.unsafePlainText('PENDING'),
        R2_SECRET_ACCESS_KEY:   SecretValue.unsafePlainText('PENDING'),
        R2_BUCKET:              SecretValue.unsafePlainText('lisna-models-prod'),
        R2_ENDPOINT_URL:        SecretValue.unsafePlainText('https://PENDING.r2.cloudflarestorage.com'),
        // Allowlist — synced from allowlist-emails.json at CDK synth time
        ALLOWLIST_EMAILS:       SecretValue.unsafePlainText(allowlistCsv),
      },
    })
    new CfnOutput(this, 'AppSecretArn', { value: this.appSecret.secretArn })
    // Emit current allowlist so CI logs show who is gated in (no secret value leaked)
    new CfnOutput(this, 'AllowlistEmailCount', {
      value: String(allowlistJson.users.filter(u => !u.holdout).length),
      description: 'Number of non-holdout users in allowlist-emails.json',
    })
  }
}
