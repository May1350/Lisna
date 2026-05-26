import { Stack, type StackProps, CfnOutput, SecretValue } from 'aws-cdk-lib'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class SecretsStack extends Stack {
  /** Operator-managed secret. CDK creates an empty container on first deploy;
   *  all runtime keys (JWT_SECRET, GOOGLE_CLIENT_*, GROQ_API_KEY,
   *  OPENAI_API_KEY, STRIPE_*) are set by the operator via AWS Console.
   *  CDK does NOT write secretObjectValue here — doing so would overwrite
   *  production values with PENDING strings on every deploy. */
  readonly appSecret: Secret

  /** CDK-owned secret for the model-download feature.
   *  Carries the allowlist CSV (computed at synth time from
   *  allowlist-emails.json) and R2 credential placeholders.
   *  Operator fills R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT_URL
   *  via AWS Console after completing the Task A12 R2 runbook. */
  readonly modelDownloadSecret: Secret

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)

    // ── AppSecret — operator-managed, CDK creates the container only ──────
    // IMPORTANT: No secretObjectValue here. If secretObjectValue is added,
    // every cdk deploy REPLACES the current secret value with the CDK-declared
    // one — erasing operator-set production keys (JWT_SECRET, GROQ_API_KEY,
    // STRIPE_SECRET_KEY, …) and breaking auth + LLM + Stripe.
    this.appSecret = new Secret(this, 'AppSecret', {
      secretName: 'studyhelper/app',
      description: 'JWT secret, OAuth, AI keys, Stripe — operator-managed via Console',
    })
    new CfnOutput(this, 'AppSecretArn', { value: this.appSecret.secretArn })

    // ── ModelDownloadSecret — CDK-owned, safe to write via secretObjectValue ─
    // Compute ALLOWLIST_EMAILS at synth time from allowlist-emails.json.
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

    // R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT_URL start as
    // PENDING sentinels. Operator fills them via Console after Task A12
    // (R2 bucket creation runbook). CDK may overwrite these fields on
    // future deploys — that is SAFE because this secret contains no
    // pre-existing production credentials.
    this.modelDownloadSecret = new Secret(this, 'ModelDownloadSecret', {
      secretName: 'studyhelper/model-download',
      description: 'Model download feature secrets: allowlist + R2 credentials',
      secretObjectValue: {
        ALLOWLIST_EMAILS:       SecretValue.unsafePlainText(allowlistCsv),
        R2_BUCKET:              SecretValue.unsafePlainText('lisna-models-prod'),
        R2_ACCESS_KEY_ID:       SecretValue.unsafePlainText('PENDING'),
        R2_SECRET_ACCESS_KEY:   SecretValue.unsafePlainText('PENDING'),
        R2_ENDPOINT_URL:        SecretValue.unsafePlainText('https://PENDING.r2.cloudflarestorage.com'),
      },
    })
    new CfnOutput(this, 'ModelDownloadSecretArn', { value: this.modelDownloadSecret.secretArn })
    // Emit current allowlist so CI logs show who is gated in (no secret value leaked)
    new CfnOutput(this, 'AllowlistEmailCount', {
      value: String(allowlistJson.users.filter(u => !u.holdout).length),
      description: 'Number of non-holdout users in allowlist-emails.json',
    })
  }
}
