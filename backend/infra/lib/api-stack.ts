import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Vpc } from 'aws-cdk-lib/aws-ec2'
import { Runtime, FunctionUrlAuthType, HttpMethod as LambdaHttpMethod } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs'
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import type { DatabaseInstance } from 'aws-cdk-lib/aws-rds'
import type { Bucket } from 'aws-cdk-lib/aws-s3'
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface Props extends StackProps {
  vpc: Vpc
  dbSecret: Secret
  bucket: Bucket
  db: DatabaseInstance
  appSecret: Secret
  wsEndpoint: string
  wsApiId: string
  wsStageName: string
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const commonEnv = {
      S3_BUCKET: props.bucket.bucketName,
      DB_SECRET_ARN: props.dbSecret.secretArn,
      APP_SECRET_ARN: props.appSecret.secretArn,
    }
    const wsEndpoint = props.wsEndpoint

    // Shared bundling defaults for every NodejsFunction in this stack:
    //   - minify: true        — strips whitespace/comments/longidents in
    //                           the bundled output, ~30-50% smaller .zip,
    //                           which makes cold-start faster (less to
    //                           download + parse).
    //   - sourceMap: true     — production stack traces map back to the
    //                           original .ts file. Sourcemaps go into the
    //                           bundle (Lambda /tmp), so CloudWatch
    //                           reports the right line.
    //   - externalModules: ['@aws-sdk/*'] — the Node 20 runtime ships
    //                           AWS SDK v3 as a built-in. Bundling it
    //                           wastes ~3 MB per function for no gain.
    //                           NOTE: judge.ts (an eval-only Anthropic
    //                           consumer) was moved to scripts/lib/ so
    //                           Lambda builds don't pull it. curator.ts
    //                           also imports @anthropic-ai/sdk for its
    //                           dormant CURATOR_PROVIDER='anthropic'
    //                           branch — that one is intentionally
    //                           bundled into SessCurateFn so flipping
    //                           the env var is sufficient to swap
    //                           providers in production. Switching to
    //                           dynamic import would shave it from the
    //                           cold-start path; defer until that
    //                           branch is actually live.
    const lambdaBundling: NonNullable<NodejsFunctionProps['bundling']> = {
      minify: true,
      sourceMap: true,
      externalModules: ['@aws-sdk/*'],
    }

    const health = new NodejsFunction(this, 'HealthFn', {
      entry: path.join(__dirname, '../../src/handlers/health.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
      bundling: lambdaBundling,
    })

    // DB SG already permits VPC CIDR ingress on 5432 (see data-stack.ts).
    // We do NOT call props.db.connections.allowDefaultPortFrom(...) here
    // because doing so creates a cross-stack SG ref Data -> Api that conflicts
    // with the IAM cross-stack ref Api -> Data on dbSecret/appSecret, producing
    // a CDK dependency cycle. Lambdas attached to the VPC will reach the DB
    // via the existing CIDR ingress rule.
    void props.db
    const authGoogle = new NodejsFunction(this, 'AuthGoogleFn', {
      entry: path.join(__dirname, '../../src/handlers/auth-google.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(authGoogle)
    props.appSecret.grantRead(authGoogle)

    const authMe = new NodejsFunction(this, 'AuthMeFn', {
      entry: path.join(__dirname, '../../src/handlers/auth-me.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(authMe)
    props.appSecret.grantRead(authMe)

    // CORS allowlist. Defaults to '*' for dev because unpacked Chrome
    // extensions get a randomized chrome-extension://<id> on each install,
    // making a strict allowlist impractical until the extension is
    // published to the Web Store and gets a stable ID.
    //
    // Once we have a stable ID, set ALLOWED_CORS_ORIGINS as a CDK
    // context variable (cdk deploy -c allowedCorsOrigins=chrome-extension://abc123...)
    // so we narrow this to just the actual extension. Bearer JWT auth
    // already prevents unauthenticated reads, but CORS narrowing makes
    // it impossible for a stolen token to be used from a third-party
    // page in someone's browser.
    const allowedCorsOrigins =
      (this.node.tryGetContext('allowedCorsOrigins') as string | undefined)?.split(',')
        .map(s => s.trim()).filter(Boolean) ?? ['*']
    const api = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        allowOrigins: allowedCorsOrigins,
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    })

    api.addRoutes({
      path: '/v1/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthInt', health),
    })

    api.addRoutes({
      path: '/v1/auth/google',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('AuthGoogleInt', authGoogle),
    })

    api.addRoutes({
      path: '/v1/auth/me',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('AuthMeInt', authMe),
    })

    // ---- T9: stream handlers (audio + slide) ----
    const streamAudio = new NodejsFunction(this, 'StreamAudioFn', {
      entry: path.join(__dirname, '../../src/handlers/stream-audio.ts'),
      runtime: Runtime.NODEJS_20_X,
      // Phase 6.1 moved the curator OFF this hot path. stream-audio
      // now only does STT (~1-3 s) + transcript broadcast + DB append.
      // 30 s timeout has comfortable margin even with cold-start init
      // and a transient Groq slowdown; the API Gateway integration
      // timeout caps requests at 30 s anyway.
      timeout: Duration.seconds(30),
      memorySize: 1024,
      environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint },
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(streamAudio)
    props.appSecret.grantRead(streamAudio)
    props.bucket.grantReadWrite(streamAudio)

    const streamSlide = new NodejsFunction(this, 'StreamSlideFn', {
      entry: path.join(__dirname, '../../src/handlers/stream-slide.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      memorySize: 512,
      environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint },
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(streamSlide)
    props.appSecret.grantRead(streamSlide)
    props.bucket.grantReadWrite(streamSlide)

    // Both stream handlers push notes/slides to client modals via the
    // WebSocket API's PostToConnection call. That action lives behind the
    // execute-api:ManageConnections permission scoped to the WS API stage.
    // Without this grant the SDK call returns AccessDeniedException and
    // notes never reach the modal — even if Gemini produces them.
    const wsManagePolicy = new PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${props.wsApiId}/${props.wsStageName}/POST/@connections/*`,
      ],
    })
    streamAudio.addToRolePolicy(wsManagePolicy)
    streamSlide.addToRolePolicy(wsManagePolicy)

    api.addRoutes({
      path: '/v1/stream/audio',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SAInt', streamAudio),
    })
    api.addRoutes({
      path: '/v1/stream/slide',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SSInt', streamSlide),
    })

    // ── Phase 6.1: on-demand curator (POST /v1/session/curate) ──────────
    // Pulled out of stream-audio so the per-chunk hot path stays fast
    // (just STT + transcript broadcast). Triggered by the modal when the
    // user pauses, stops, ends the video, or hits "📝 ノートを生成".
    const sessionCurate = new NodejsFunction(this, 'SessCurateFn', {
      entry: path.join(__dirname, '../../src/handlers/session-curate.ts'),
      runtime: Runtime.NODEJS_20_X,
      // Same 5 min ceiling as stream-audio — GPT-5 nano is a reasoning
      // model and a single full-transcript call can stretch to ~100 s.
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint },
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(sessionCurate)
    props.appSecret.grantRead(sessionCurate)
    sessionCurate.addToRolePolicy(wsManagePolicy)
    api.addRoutes({
      path: '/v1/session/curate',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SCurateInt', sessionCurate),
    })

    // 2026-04-30: API Gateway HTTP API has a HARD 30 s integration timeout
    // that cannot be raised. The curator's wall-clock can hit 50–90 s on
    // longer transcripts (gpt-4o-mini through OpenAI is sometimes slow,
    // and total tokens scale with lecture length). When that happens API
    // Gateway returns 503 to the client even though the Lambda is still
    // running and will eventually persist the outline + broadcast over WS.
    // The modal never sees a successful HTTP response and falls into the
    // "ノート生成に失敗しました (HTTP 503: Service Unavailable)" error path.
    //
    // Fix: expose the curator behind a Lambda Function URL too. Function
    // URLs are limited only by the Lambda's own timeout (here 5 min), so
    // we can ride out the full curator latency and return the outline
    // synchronously. The handler is the same — Lambda Function URL events
    // are shape-compatible with APIGatewayProxyEventV2 (the SDK uses the
    // same payload format v2.0 by default), so no handler change required.
    //
    // The modal calls the Function URL directly with the JWT in the
    // Authorization header. The handler still does verifyJwt, so opening
    // the URL with authType: NONE doesn't widen our auth surface.
    const sessionCurateUrl = sessionCurate.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [LambdaHttpMethod.POST],
        allowedHeaders: ['authorization', 'content-type'],
        maxAge: Duration.hours(1),
      },
    })
    new CfnOutput(this, 'CurateUrl', {
      value: sessionCurateUrl.url,
      description: 'Lambda Function URL for /v1/session/curate (bypasses API Gateway 30 s timeout)',
    })

    // ---- session get / delete ----
    // Phase 6.1 retired the legacy session-finalize Lambda (it produced
    // a PDF off the deprecated `notes` jsonb column, which no current
    // handler writes — every produced PDF was empty). Markdown export
    // via GET /v1/session?format=markdown covers the same use case
    // using the live `outline` column. The CDK resource + route were
    // removed; CloudFormation will drop the orphaned function on next
    // deploy.
    const sessionGet = new NodejsFunction(this, 'SessGetFn', {
      entry: path.join(__dirname, '../../src/handlers/session-get.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(sessionGet)
    props.appSecret.grantRead(sessionGet)
    // Required for presignGet — a presigned URL inherits the signing
    // principal's IAM permissions. Without this grant the URL is
    // syntactically valid but every browser GET against it returns 403
    // because session-get's role lacks s3:GetObject. Symptom seen in
    // the wild: zip export → "slide slide-XX-XX.jpg fetch 403" on
    // every slide. Discovered after S3 bucket CORS was added (which
    // we'd assumed was the culprit) and the failure persisted.
    props.bucket.grantRead(sessionGet)

    const sessionDelete = new NodejsFunction(this, 'SessDelFn', {
      entry: path.join(__dirname, '../../src/handlers/session-delete.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(sessionDelete)
    props.appSecret.grantRead(sessionDelete)

    api.addRoutes({
      path: '/v1/session',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('SGInt', sessionGet),
    })
    api.addRoutes({
      path: '/v1/session/{id}',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('SDInt', sessionDelete),
    })

    // List endpoint: powers the side-panel history view. Lightweight
    // — returns id / url / title / counts, NOT outline content, so the
    // payload stays small even with 100+ sessions per user.
    const sessionsList = new NodejsFunction(this, 'SessListFn', {
      entry: path.join(__dirname, '../../src/handlers/sessions-list.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(sessionsList)
    props.appSecret.grantRead(sessionsList)
    api.addRoutes({
      path: '/v1/sessions',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('SLInt', sessionsList),
    })

    // ---- T11: Stripe checkout + webhook ----
    const stripeCheckout = new NodejsFunction(this, 'StripeCheckoutFn', {
      entry: path.join(__dirname, '../../src/handlers/stripe-checkout.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: commonEnv,
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(stripeCheckout)
    props.appSecret.grantRead(stripeCheckout)

    const stripeWebhook = new NodejsFunction(this, 'StripeWebhookFn', {
      entry: path.join(__dirname, '../../src/handlers/stripe-webhook.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: commonEnv,
      vpc: props.vpc,
      bundling: lambdaBundling,
    })
    props.dbSecret.grantRead(stripeWebhook)
    props.appSecret.grantRead(stripeWebhook)

    api.addRoutes({
      path: '/v1/billing/checkout',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SCInt', stripeCheckout),
    })
    api.addRoutes({
      path: '/v1/billing/webhook',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SWInt', stripeWebhook),
    })

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint })
  }
}
