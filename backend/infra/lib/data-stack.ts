import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib'
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3'
import { Vpc, SubnetType, SecurityGroup, Port, Peer } from 'aws-cdk-lib/aws-ec2'
import {
  DatabaseCluster, DatabaseClusterEngine, AuroraPostgresEngineVersion,
  ClusterInstance, Credentials,
} from 'aws-cdk-lib/aws-rds'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

interface Props extends StackProps { vpc: Vpc }

export class DataStack extends Stack {
  readonly bucket: Bucket
  readonly cluster: DatabaseCluster
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

    this.cluster = new DatabaseCluster(this, 'Db', {
      engine: DatabaseClusterEngine.auroraPostgres({ version: AuroraPostgresEngineVersion.VER_16_2 }),
      writer: ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 2,
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      credentials: Credentials.fromSecret(this.dbSecret),
      defaultDatabaseName: 'studyhelper',
      securityGroups: [dbSg],
      removalPolicy: RemovalPolicy.DESTROY,
    })
  }
}
