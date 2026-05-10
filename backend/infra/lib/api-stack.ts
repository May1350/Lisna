import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Vpc } from 'aws-cdk-lib/aws-ec2'
import { Runtime, FunctionUrlAuthType, HttpMethod as LambdaHttpMethod } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Alarm, ComparisonOperator, TreatMissingData, Metric, Dashboard, GraphWidget, SingleValueWidget } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { MetricFilter, FilterPattern, RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'
import { CfnBudget } from 'aws-cdk-lib/aws-budgets'
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
      // Read by stripe-checkout (success/cancel URLs) and any future
      // handler that links back to the marketing site. Without this
      // injected, handlers fall through to a hardcoded Vercel preview
      // URL — fine until the marketing site moves to a custom domain,
      // at which point checkout URLs would 404.
      PUBLIC_WEB_BASE_URL: 'https://lisna-may1350s-projects.vercel.app',
    }
    const wsEndpoint = props.wsEndpoint

    const health = new NodejsFunction(this, 'HealthFn', {
      entry: path.join(__dirname, '../../src/handlers/health.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
      logRetention: RetentionDays.ONE_MONTH,
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
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(authGoogle)
    props.appSecret.grantRead(authGoogle)

    const authMe = new NodejsFunction(this, 'AuthMeFn', {
      entry: path.join(__dirname, '../../src/handlers/auth-me.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(authMe)
    props.appSecret.grantRead(authMe)

    const api = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
        // CORS retained as '*' on purpose:
        //   - The extension's service worker performs the actual fetches
        //     with `host_permissions: <all_urls>`, which bypasses CORS
        //     entirely (extension-privileged context, no preflight).
        //   - JWT verification is the real auth gate; an unauthorised
        //     CORS-allowed request still 401s without doing any work.
        //   - API Gateway v2 rejects chrome-extension:// origins as
        //     "Invalid format" so the obvious narrow doesn't even
        //     deploy. The marketing site origin alone would lock out
        //     any future browser-side caller (admin dashboards etc.)
        //     without buying us security we don't already have.
        // Revisit only if cookie-based auth or browser-direct calls
        // become a primary path.
        allowOrigins: ['*'],
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
      // Curator was pulled out into session-curate (Phase 6.1), so this
      // Lambda is now just per-chunk Whisper STT + transcript broadcast.
      // 90 s is comfortable headroom: a single chunk's STT typically runs
      // 5–15 s; 90 s covers tail latency under API-Gateway load without
      // letting a runaway request hold a Lambda slot for 5 minutes.
      timeout: Duration.seconds(90),
      memorySize: 1024,
      // Cap concurrent executions so a retry storm (extension reconnect
      // loop, Whisper 5xx bursts) cannot blow through the account-level
      // Lambda concurrency budget and starve other handlers.
      reservedConcurrentExecutions: 20,
      environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint },
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
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
      logRetention: RetentionDays.ONE_MONTH,
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
      // 5 min ceiling because the curator legitimately runs that long —
      // GPT-5 nano is a reasoning model and a single full-transcript call
      // can stretch to ~100 s on long sessions.
      timeout: Duration.minutes(5),
      memorySize: 1024,
      // Cap concurrency: each invocation holds an OpenAI/Anthropic call
      // for ~1–2 min, so 10 in-flight is enough headroom while keeping
      // a runaway burst from exhausting the upstream LLM rate limit.
      reservedConcurrentExecutions: 10,
      environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint },
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(sessionCurate)
    props.appSecret.grantRead(sessionCurate)
    sessionCurate.addToRolePolicy(wsManagePolicy)
    api.addRoutes({
      path: '/v1/session/curate',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SCurateInt', sessionCurate),
    })

    // ── User feedback (POST /v1/feedback) ───────────────────────────────
    // Inserts to the feedbacks table and publishes a summary to the
    // existing lisna-alerts SNS topic so the operator gets an email
    // the moment it lands. Topic is created later in this stack — we
    // wire grant + env var below right after the Topic is constructed.
    const feedback = new NodejsFunction(this, 'FeedbackFn', {
      entry: path.join(__dirname, '../../src/handlers/feedback.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(feedback)
    props.appSecret.grantRead(feedback)
    api.addRoutes({
      path: '/v1/feedback',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('FbInt', feedback),
    })

    // Lambda Function URL bypasses API Gateway HTTP API's hard 30 s
    // integration timeout — the curator can take 50–90 s on long
    // transcripts, which would 504 through API Gateway even though
    // the Lambda itself runs to completion. The handler still calls
    // verifyJwt on the Authorization header, so authType: NONE
    // doesn't widen the auth surface (Lambda Function URL just hands
    // the request straight to the function — JWT verification gates
    // access exactly the same way).
    //
    // The extension's content/index.ts honours VITE_CURATE_URL (the
    // exported value below). If unset, callApi falls back through
    // API Gateway and sessions long enough to need the Function URL
    // path will time out; this is the recovery for that situation.
    // Function URL is unauthenticated at the AWS layer; the Lambda
    // verifies the JWT internally before any expensive curator work.
    // CORS kept '*' for the same reasons documented on HttpApi above
    // (extension SW bypasses CORS, JWT is the real gate, AWS rejects
    // chrome-extension:// origins anyway).
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
      description: 'Lambda Function URL for /v1/session/curate (bypasses API Gateway 30 s timeout). Set as VITE_CURATE_URL in extension/.env.local.',
    })

    // ---- T10: session get / delete ----
    const sessionGet = new NodejsFunction(this, 'SessGetFn', {
      entry: path.join(__dirname, '../../src/handlers/session-get.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(sessionGet)
    props.appSecret.grantRead(sessionGet)
    // Required for presignGet — a presigned URL inherits the signing
    // principal's IAM permissions. Without this grant the URL is
    // syntactically valid but every browser GET against it returns 403
    // because session-get's role lacks s3:GetObject. Symptom in the
    // wild: existing notes' slide thumbnails all 403; zip export
    // → "slide slide-XX-XX.jpg fetch 403".
    props.bucket.grantRead(sessionGet)

    const sessionDelete = new NodejsFunction(this, 'SessDelFn', {
      entry: path.join(__dirname, '../../src/handlers/session-delete.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(sessionDelete)
    props.appSecret.grantRead(sessionDelete)

    // GET /v1/sessions — recent-session list for the side-panel
    // SessionHistory component. Read-only single-SELECT, no S3 access
    // needed (the row carries url + title + counts; thumbnails are
    // fetched lazily via /v1/session?url=…).
    const sessionList = new NodejsFunction(this, 'SessListFn', {
      entry: path.join(__dirname, '../../src/handlers/sessions-list.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(sessionList)
    props.appSecret.grantRead(sessionList)

    api.addRoutes({
      path: '/v1/session',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('SGInt', sessionGet),
    })
    api.addRoutes({
      path: '/v1/sessions',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('SLInt', sessionList),
    })
    api.addRoutes({
      path: '/v1/session/{id}',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('SDInt', sessionDelete),
    })

    // ---- T11: Stripe checkout + webhook ----
    const stripeCheckout = new NodejsFunction(this, 'StripeCheckoutFn', {
      entry: path.join(__dirname, '../../src/handlers/stripe-checkout.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    })
    props.dbSecret.grantRead(stripeCheckout)
    props.appSecret.grantRead(stripeCheckout)

    const stripeWebhook = new NodejsFunction(this, 'StripeWebhookFn', {
      entry: path.join(__dirname, '../../src/handlers/stripe-webhook.ts'),
      runtime: Runtime.NODEJS_20_X,
      // 30 s — Stripe signature verification + DB write through the NAT
      // Gateway can race the previous 15 s budget under cold-start +
      // NAT contention, and a missed webhook means a missed billing event.
      timeout: Duration.seconds(30),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
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

    // ---- 2-hour trial flow (4 endpoints) ----
    // Frontend calls these in this order:
    //   start    → returns Stripe Checkout (setup mode) URL
    //              → user adds card → Stripe redirects back to our success URL
    //   confirm  → frontend POSTs the returned session_id; we verify
    //              SetupIntent succeeded + create the trial_grants row
    // Then user records up to 2 h. At 100 %:
    //   subscribe → "Pro 가입 (원클릭)": uses saved PM, creates subscription
    //   decline   → "가입 안함": detaches PM, marks grant declined
    const trialFnDefaults = {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(20),
      environment: commonEnv,
      vpc: props.vpc,
      logRetention: RetentionDays.ONE_MONTH,
    }
    const trialStart = new NodejsFunction(this, 'TrialStartFn', {
      ...trialFnDefaults,
      entry: path.join(__dirname, '../../src/handlers/trial-start.ts'),
    })
    const trialConfirm = new NodejsFunction(this, 'TrialConfirmFn', {
      ...trialFnDefaults,
      entry: path.join(__dirname, '../../src/handlers/trial-confirm.ts'),
    })
    const trialDecline = new NodejsFunction(this, 'TrialDeclineFn', {
      ...trialFnDefaults,
      entry: path.join(__dirname, '../../src/handlers/trial-decline.ts'),
    })
    const trialSubscribe = new NodejsFunction(this, 'TrialSubscribeFn', {
      ...trialFnDefaults,
      entry: path.join(__dirname, '../../src/handlers/trial-subscribe.ts'),
    })
    for (const fn of [trialStart, trialConfirm, trialDecline, trialSubscribe]) {
      props.dbSecret.grantRead(fn)
      props.appSecret.grantRead(fn)
    }
    api.addRoutes({
      path: '/v1/trial/start',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('TStartInt', trialStart),
    })
    api.addRoutes({
      path: '/v1/trial/confirm',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('TConfirmInt', trialConfirm),
    })
    api.addRoutes({
      path: '/v1/trial/decline',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('TDeclineInt', trialDecline),
    })
    api.addRoutes({
      path: '/v1/billing/subscribe-from-trial',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('TSubscribeInt', trialSubscribe),
    })

    // ── Client error reporting (POST /v1/errors) ───────────────────────────
    // No auth: errors must report even when login itself fails. Logs to
    // CloudWatch only — no DB. Use CloudWatch Insights to query by severity:
    //   fields @timestamp, @message
    //   | filter type = "CLIENT_ERROR" and severity = "fatal"
    //   | sort @timestamp desc
    const errorReport = new NodejsFunction(this, 'ErrorReportFn', {
      entry: path.join(__dirname, '../../src/handlers/error-report.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      memorySize: 256,
      logRetention: RetentionDays.ONE_MONTH,
    })
    api.addRoutes({
      path: '/v1/errors',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('ErrInt', errorReport),
    })

    // ── Operational alerting: SNS topic + email subscription ───────────────
    // Single topic shared by every alarm in the stack. Email subscribers
    // must click the AWS confirmation link (sent right after first deploy)
    // before they actually receive notifications — this is enforced by SNS
    // and not something CDK can shortcut.
    const alertEmail = process.env.LISNA_ALERT_EMAIL ?? 'takgun.jr@gmail.com'
    const alertsTopic = new Topic(this, 'AlertsTopic', {
      topicName: 'lisna-alerts',
      displayName: 'Lisna Alerts',
    })
    alertsTopic.addSubscription(new EmailSubscription(alertEmail))

    // The feedback Lambda (declared earlier so it could be wired into
    // the route table) reuses this same topic for user-submitted
    // feedback notifications. Wire grant + env var here once the topic
    // exists.
    alertsTopic.grantPublish(feedback)
    feedback.addEnvironment('ALERTS_TOPIC_ARN', alertsTopic.topicArn)

    // Same plumbing for the Lambdas that classify upstream-LLM-failure
    // (auth / quota / rate) and publish an URGENT alert so the
    // operator hears about it before users start emailing about
    // captions / notes being broken. lib/upstream-alert.ts reads
    // ALERTS_TOPIC_ARN at call time.
    alertsTopic.grantPublish(streamAudio)
    streamAudio.addEnvironment('ALERTS_TOPIC_ARN', alertsTopic.topicArn)
    alertsTopic.grantPublish(sessionCurate)
    sessionCurate.addEnvironment('ALERTS_TOPIC_ARN', alertsTopic.topicArn)

    // ── CloudWatch alarm: fatal client errors spike ────────────────────────
    // Counts log lines with severity = "fatal" emitted by error-report
    // Lambda. Alarm fires when ≥ 5 fatals occur in any 10-min window — a
    // smoke signal for "something just broke for many users at once".
    const fatalErrorMetric = new MetricFilter(this, 'FatalClientErrorFilter', {
      logGroup: errorReport.logGroup,
      metricNamespace: 'Lisna/ClientErrors',
      metricName: 'FatalCount',
      filterPattern: FilterPattern.stringValue('$.severity', '=', 'fatal'),
      metricValue: '1',
      defaultValue: 0,
    })
    void fatalErrorMetric
    const fatalAlarm = new Alarm(this, 'FatalClientErrorAlarm', {
      alarmName: 'lisna-fatal-client-errors',
      alarmDescription: 'Triggered when ≥5 fatal client errors are reported within any 10-minute window.',
      metric: new Metric({
        namespace: 'Lisna/ClientErrors',
        metricName: 'FatalCount',
        statistic: 'Sum',
        period: Duration.minutes(10),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    fatalAlarm.addAlarmAction(new SnsAction(alertsTopic))

    // ── Per-Lambda error-rate alarms ───────────────────────────────────────
    // Lambda.metricErrors() counts handler invocations that returned a
    // non-2xx (uncaught throw, OOM, timeout). A handful of errors in a
    // 5-min window is a real signal — these handlers are on the hot path
    // for STT, note generation, and billing.
    const streamAudioErrorAlarm = new Alarm(this, 'StreamAudioErrorAlarm', {
      alarmName: 'lisna-stream-audio-errors',
      alarmDescription: 'StreamAudio Lambda errors ≥ 3 in 5 min — STT pipeline degraded.',
      metric: streamAudio.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    streamAudioErrorAlarm.addAlarmAction(new SnsAction(alertsTopic))

    const sessionCurateErrorAlarm = new Alarm(this, 'SessionCurateErrorAlarm', {
      alarmName: 'lisna-session-curate-errors',
      alarmDescription: 'SessionCurate Lambda errors ≥ 3 in 5 min — note generation broken.',
      metric: sessionCurate.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    sessionCurateErrorAlarm.addAlarmAction(new SnsAction(alertsTopic))

    // Stripe webhook: any error matters — a dropped event means a missed
    // subscription state transition (charge succeeded / cancelled / refunded).
    const stripeWebhookErrorAlarm = new Alarm(this, 'StripeWebhookErrorAlarm', {
      alarmName: 'lisna-stripe-webhook-errors',
      alarmDescription: 'StripeWebhook Lambda errors ≥ 1 in 5 min — billing event may be lost.',
      metric: stripeWebhook.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    stripeWebhookErrorAlarm.addAlarmAction(new SnsAction(alertsTopic))

    // API Gateway 5xx: catches integration timeouts (HTTP API's 30 s ceiling)
    // and Lambda permission errors that never even reach the handler.
    // Using the raw CloudWatch metric since HttpApi.metricServerError() is
    // not exposed on aws-cdk-lib's CfnApi-based HttpApi construct in 2.251.
    const apiGw5xxAlarm = new Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: 'lisna-apigw-5xx',
      alarmDescription: 'API Gateway 5xx ≥ 5 in 5 min — upstream Lambda or integration failing.',
      metric: new Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5xx',
        dimensionsMap: { ApiId: api.apiId },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    apiGw5xxAlarm.addAlarmAction(new SnsAction(alertsTopic))

    // ── AWS Budgets: monthly cost cap with early-warning thresholds ────────
    // Two notifications: 80 % (warning, "we're trending hot") and 100 %
    // (actual breach). Both go to the same email — SNS can't be a target
    // for Budgets directly, so this is its own subscription channel.
    new CfnBudget(this, 'MonthlyCostBudget', {
      budget: {
        budgetName: 'lisna-monthly-cost',
        budgetLimit: { amount: 50, unit: 'USD' },
        timeUnit: 'MONTHLY',
        budgetType: 'COST',
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
        },
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: alertEmail }],
        },
      ],
    })

    // ── Operational dashboard: single pane of glass for week-1 post-launch ─
    // Surfaces invocation/error counts per Lambda group, latency for the slow
    // handlers, RDS health, and API Gateway / WS traffic. Alarms still SNS
    // out via the topic above; this dashboard is for at-a-glance triage so
    // the operator doesn't have to click through 10+ log groups.
    const dashboardPeriod = Duration.minutes(5)
    const dashboard = new Dashboard(this, 'OpsDashboard', {
      dashboardName: 'lisna-operations',
    })

    // Row 1 — Lambda invocation health (4 widgets, width 6 each)
    const authWidget = new GraphWidget({
      title: 'Auth handlers — invocations & errors',
      width: 6,
      left: [
        authGoogle.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        authMe.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        sessionList.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        authGoogle.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
        authMe.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
        sessionList.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
      ],
    })

    const captureWidget = new GraphWidget({
      title: 'Capture handlers — invocations & errors',
      width: 6,
      left: [
        streamAudio.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        streamAudio.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
        streamSlide.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        streamSlide.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
      ],
    })

    const curatorWidget = new GraphWidget({
      title: 'Curator + session — invocations & errors',
      width: 6,
      left: [
        sessionCurate.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        sessionCurate.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
        sessionGet.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        sessionGet.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
      ],
    })

    const billingWidget = new GraphWidget({
      title: 'Billing — invocations & errors',
      width: 6,
      left: [
        stripeCheckout.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        stripeCheckout.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
        stripeWebhook.metricInvocations({ period: dashboardPeriod, statistic: 'Sum' }),
        stripeWebhook.metricErrors({ period: dashboardPeriod, statistic: 'Sum' }),
      ],
    })

    dashboard.addWidgets(authWidget, captureWidget, curatorWidget, billingWidget)

    // Row 2 — Latency p50/p95/p99 for the two slow handlers (width 12 each)
    const streamAudioLatencyWidget = new GraphWidget({
      title: 'streamAudio Duration (p50 / p95 / p99)',
      width: 12,
      left: [
        streamAudio.metricDuration({ period: dashboardPeriod, statistic: 'p50' }),
        streamAudio.metricDuration({ period: dashboardPeriod, statistic: 'p95' }),
        streamAudio.metricDuration({ period: dashboardPeriod, statistic: 'p99' }),
      ],
    })
    const sessionCurateLatencyWidget = new GraphWidget({
      title: 'sessionCurate Duration (p50 / p95 / p99)',
      width: 12,
      left: [
        sessionCurate.metricDuration({ period: dashboardPeriod, statistic: 'p50' }),
        sessionCurate.metricDuration({ period: dashboardPeriod, statistic: 'p95' }),
        sessionCurate.metricDuration({ period: dashboardPeriod, statistic: 'p99' }),
      ],
    })
    dashboard.addWidgets(streamAudioLatencyWidget, sessionCurateLatencyWidget)

    // Row 3 — RDS health (3 widgets, width 8 each)
    const dbCpuWidget = new GraphWidget({
      title: 'RDS CPUUtilization',
      width: 8,
      left: [
        props.db.metricCPUUtilization({ period: dashboardPeriod, statistic: 'Average' }),
      ],
    })
    const dbConnWidget = new GraphWidget({
      title: 'RDS DatabaseConnections',
      width: 8,
      left: [
        props.db.metricDatabaseConnections({ period: dashboardPeriod, statistic: 'Average' }),
      ],
    })
    const dbStorageWidget = new GraphWidget({
      title: 'RDS FreeStorageSpace (worst-case)',
      width: 8,
      left: [
        props.db.metricFreeStorageSpace({ period: dashboardPeriod, statistic: 'Minimum' }),
      ],
    })
    dashboard.addWidgets(dbCpuWidget, dbConnWidget, dbStorageWidget)

    // Row 4 — API Gateway + WS
    // Using raw Metric() throughout because aws-cdk-lib 2.251's HttpApi v2
    // construct doesn't expose metricClientError/metricServerError/metricCount
    // convenience methods (those exist on REST API v1 only). Same approach as
    // the apiGw5xxAlarm above.
    const apiBaseDims = { ApiId: api.apiId }
    const apiGw4xxWidget = new GraphWidget({
      title: 'API Gateway 4xx',
      width: 6,
      left: [
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '4xx',
          dimensionsMap: apiBaseDims,
          statistic: 'Sum',
          period: dashboardPeriod,
        }),
      ],
    })
    const apiGw5xxWidget = new GraphWidget({
      title: 'API Gateway 5xx',
      width: 6,
      left: [
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: '5xx',
          dimensionsMap: apiBaseDims,
          statistic: 'Sum',
          period: dashboardPeriod,
        }),
      ],
    })
    const apiGwCountWidget = new GraphWidget({
      title: 'API Gateway request count',
      width: 6,
      left: [
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Count',
          dimensionsMap: apiBaseDims,
          statistic: 'Sum',
          period: dashboardPeriod,
        }),
      ],
    })
    const apiGwLatencyWidget = new GraphWidget({
      title: 'API Gateway Latency p99',
      width: 6,
      left: [
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'Latency',
          dimensionsMap: apiBaseDims,
          statistic: 'p99',
          period: dashboardPeriod,
        }),
      ],
    })
    dashboard.addWidgets(apiGw4xxWidget, apiGw5xxWidget, apiGwCountWidget, apiGwLatencyWidget)

    // WS connection count — best-effort. If the WS API isn't emitting this
    // metric (deployment shape, idle stage), the widget just shows a flat 0.
    const wsConnectCountWidget = new SingleValueWidget({
      title: 'WS ConnectCount (5 min Sum)',
      width: 24,
      metrics: [
        new Metric({
          namespace: 'AWS/ApiGateway',
          metricName: 'ConnectCount',
          dimensionsMap: { ApiId: props.wsApiId, Stage: props.wsStageName },
          statistic: 'Sum',
          period: dashboardPeriod,
        }),
      ],
    })
    dashboard.addWidgets(wsConnectCountWidget)

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint })
    new CfnOutput(this, 'AlertsTopicArn', { value: alertsTopic.topicArn })
  }
}
