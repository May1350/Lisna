import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib'
import { Bucket, BlockPublicAccess, HttpMethods } from 'aws-cdk-lib/aws-s3'
import {
  Vpc, SubnetType, SecurityGroup, Port, Peer,
  InstanceType, InstanceClass, InstanceSize,
} from 'aws-cdk-lib/aws-ec2'
import {
  DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion,
  Credentials,
} from 'aws-cdk-lib/aws-rds'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'
import type { Construct } from 'constructs'

interface Props extends StackProps { vpc: Vpc }

/**
 * MVP DB layer: single-AZ RDS PostgreSQL on db.t3.micro (AWS Free Tier eligible
 * for the first 12 months of the account: 750 instance-hours + 20GB storage + 20GB backup).
 *
 * Why not Aurora Serverless v2 (the PRD's eventual choice):
 *  - Aurora has no Free Tier; idle ACU + storage = ~$43/month from day 1.
 *  - With db.t3.micro we get 12 months at $0 + ~$32/mo NAT only.
 *  - Migration path to Aurora is well-trodden (read-replica promotion, ~30s downtime,
 *    no schema or app code changes). See docs/superpowers/specs/...migration-aurora.md
 *    when the time comes.
 *
 * Trade-offs accepted at this stage:
 *  - Single-AZ: data center outage will pause the service (acceptable for closed beta).
 *  - Fixed instance size: cannot auto-scale to bursts; ~50–100 concurrent users ceiling
 *    on db.t3.micro. Switch to db.t3.small (~$30/mo) or migrate to Aurora before public launch.
 *  - 7-day automated backups (vs Aurora's 35-day PITR).
 */
export class DataStack extends Stack {
  readonly bucket: Bucket
  readonly db: DatabaseInstance
  readonly dbSecret: Secret

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    this.bucket = new Bucket(this, 'AssetsBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      // CORS rule for direct browser GET from the extension. The zip-
      // export path in the side-panel UI fetches each slide directly
      // from S3 via its presigned URL — without an allow-origin rule
      // S3 returns 403 to the browser even though the signature is
      // valid (presigning grants the IAM action, CORS gates whether
      // *the browser* will surface the response). The PUT path goes
      // through Lambda so it doesn't need a CORS rule. allowedOrigins
      // is '*' for now because unpacked Chrome extensions get random
      // IDs per install — narrow to chrome-extension://<published-id>
      // once the Web Store listing is live (same TODO as the API
      // Gateway CORS allowlist; flip both at the same time).
      cors: [{
        allowedMethods: [HttpMethods.GET],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
        exposedHeaders: [],
        maxAge: 3600,
      }],
    })

    this.dbSecret = new Secret(this, 'DbSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'studyhelper' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    })

    const dbSg = new SecurityGroup(this, 'DbSg', { vpc: props.vpc, allowAllOutbound: true })
    dbSg.addIngressRule(Peer.ipv4(props.vpc.vpcCidrBlock), Port.tcp(5432))

    this.db = new DatabaseInstance(this, 'Db', {
      // Manually upgraded to 16.13 on 2026-04-29 due to AWS deprecation
      // notice for 16.6 (effective 2026-05-31). Keep this in sync with the
      // live RDS version so cdk diff doesn't show drift.
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16_13 }),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      credentials: Credentials.fromSecret(this.dbSecret),
      databaseName: 'studyhelper',
      securityGroups: [dbSg],
      allocatedStorage: 20,           // GB — within Free Tier
      maxAllocatedStorage: 100,       // auto-grow up to 100GB if needed (still cheap)
      // Backup retention. Tried bumping 1 → 7 days (~+$2/mo on 20 GB)
      // for paid-user "user emails Tuesday about a Friday problem"
      // recovery scenarios, but RDS rejected with "exceeds the maximum
      // available to free tier customers". This account is still on
      // Free Tier; revisit once we've moved off (then 7 days is the
      // right target).
      backupRetention: Duration.days(1),
      deleteAutomatedBackups: true,
      removalPolicy: RemovalPolicy.DESTROY,
      publiclyAccessible: false,
      multiAz: false,                 // single-AZ for cost; flip to true before public launch
    })

    // Standalone alerts topic for data-stack. ApiStack owns its own
    // 'lisna-alerts' topic, but DataStack is created BEFORE ApiStack in
    // bin/app.ts — passing the api-stack topic as a prop would create a
    // CloudFormation dependency cycle (Api → Data already exists via
    // dbSecret + bucket grants). Two topics is the clean fix; both
    // subscribe the same on-call email so the operator UX is unchanged.
    const alertEmail = process.env.LISNA_ALERT_EMAIL ?? 'takgun.jr@gmail.com'
    const dataAlertsTopic = new Topic(this, 'DataAlertsTopic', {
      topicName: 'lisna-data-alerts',
      displayName: 'Lisna Data Alerts',
    })
    dataAlertsTopic.addSubscription(new EmailSubscription(alertEmail))

    // FreeStorageSpace ≤ 2 GiB. RDS auto-scales storage up to
    // maxAllocatedStorage, but the scale-up takes minutes and a fully
    // saturated disk wedges Postgres before that completes. 2 GiB headroom
    // is a comfortable warning threshold at 20 GiB allocated.
    const lowStorageAlarm = new Alarm(this, 'DbLowStorageAlarm', {
      alarmName: 'lisna-rds-low-storage',
      alarmDescription: 'RDS FreeStorageSpace ≤ 2 GiB — provision more storage or investigate growth.',
      metric: this.db.metric('FreeStorageSpace', { period: Duration.minutes(5), statistic: 'Average' }),
      threshold: 2 * 1024 * 1024 * 1024, // 2 GiB in bytes
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    lowStorageAlarm.addAlarmAction(new SnsAction(dataAlertsTopic))
  }
}
