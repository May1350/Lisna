import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib'
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3'
import {
  Vpc, SubnetType, SecurityGroup, Port, Peer,
  InstanceType, InstanceClass, InstanceSize,
} from 'aws-cdk-lib/aws-ec2'
import {
  DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion,
  Credentials,
} from 'aws-cdk-lib/aws-rds'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
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
      engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_16_6 }),
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      credentials: Credentials.fromSecret(this.dbSecret),
      databaseName: 'studyhelper',
      securityGroups: [dbSg],
      allocatedStorage: 20,           // GB — within Free Tier
      maxAllocatedStorage: 100,       // auto-grow up to 100GB if needed (still cheap)
      // Free Tier caps backup retention at 1 day. Bump to 7 once on a paid plan
      // or after migrating to Aurora (which gets 35-day PITR included).
      backupRetention: Duration.days(1),
      deleteAutomatedBackups: true,
      removalPolicy: RemovalPolicy.DESTROY,
      publiclyAccessible: false,
      multiAz: false,                 // single-AZ for cost; flip to true before public launch
    })
  }
}
