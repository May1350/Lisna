import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Vpc } from 'aws-cdk-lib/aws-ec2'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import { PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { Alarm, ComparisonOperator, TreatMissingData, Metric } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { MetricFilter, FilterPattern } from 'aws-cdk-lib/aws-logs'
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
    }
    const wsEndpoint = props.wsEndpoint

    const health = new NodejsFunction(this, 'HealthFn', {
      entry: path.join(__dirname, '../../src/handlers/health.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
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
    })
    props.dbSecret.grantRead(authGoogle)
    props.appSecret.grantRead(authGoogle)

    const authMe = new NodejsFunction(this, 'AuthMeFn', {
      entry: path.join(__dirname, '../../src/handlers/auth-me.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
      vpc: props.vpc,
    })
    props.dbSecret.grantRead(authMe)
    props.appSecret.grantRead(authMe)

    const api = new HttpApi(this, 'HttpApi', {
      corsPreflight: {
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
      // Curator runs in this Lambda. GPT-5 family models are reasoning
      // models — a single full-fixture call took ~105 s in eval. Even
      // chunk-sized rolling-mode runs can exceed 60 s when the API Gateway
      // is heavily loaded. 5 min gives us plenty of margin without burning
      // money on idle: Lambda only bills for actual execution time.
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: { ...commonEnv, WS_ENDPOINT: wsEndpoint },
      vpc: props.vpc,
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
    })
    props.dbSecret.grantRead(sessionCurate)
    props.appSecret.grantRead(sessionCurate)
    sessionCurate.addToRolePolicy(wsManagePolicy)
    api.addRoutes({
      path: '/v1/session/curate',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SCurateInt', sessionCurate),
    })

    // ---- T10: session finalize / get / delete ----
    const sessionFinalize = new NodejsFunction(this, 'SessFinFn', {
      entry: path.join(__dirname, '../../src/handlers/session-finalize.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 1024,
      environment: commonEnv,
      vpc: props.vpc,
    })
    props.dbSecret.grantRead(sessionFinalize)
    props.appSecret.grantRead(sessionFinalize)
    props.bucket.grantReadWrite(sessionFinalize)

    const sessionGet = new NodejsFunction(this, 'SessGetFn', {
      entry: path.join(__dirname, '../../src/handlers/session-get.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
    })
    props.dbSecret.grantRead(sessionGet)
    props.appSecret.grantRead(sessionGet)

    const sessionDelete = new NodejsFunction(this, 'SessDelFn', {
      entry: path.join(__dirname, '../../src/handlers/session-delete.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
    })
    props.dbSecret.grantRead(sessionDelete)
    props.appSecret.grantRead(sessionDelete)

    api.addRoutes({
      path: '/v1/session/finalize',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('SFInt', sessionFinalize),
    })
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

    // ---- T11: Stripe checkout + webhook ----
    const stripeCheckout = new NodejsFunction(this, 'StripeCheckoutFn', {
      entry: path.join(__dirname, '../../src/handlers/stripe-checkout.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: commonEnv,
      vpc: props.vpc,
    })
    props.dbSecret.grantRead(stripeCheckout)
    props.appSecret.grantRead(stripeCheckout)

    const stripeWebhook = new NodejsFunction(this, 'StripeWebhookFn', {
      entry: path.join(__dirname, '../../src/handlers/stripe-webhook.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      environment: commonEnv,
      vpc: props.vpc,
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

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint })
    new CfnOutput(this, 'AlertsTopicArn', { value: alertsTopic.topicArn })
  }
}
