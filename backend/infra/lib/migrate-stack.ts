import { Stack, type StackProps, Duration } from 'aws-cdk-lib'
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import type { DatabaseInstance } from 'aws-cdk-lib/aws-rds'
import type { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface Props extends StackProps {
  vpc: Vpc
  dbSecret: Secret
  db: DatabaseInstance
}

export class MigrateStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)
    const fn = new NodejsFunction(this, 'MigrateFn', {
      entry: path.join(__dirname, '../../src/lib/migrate.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: { DB_SECRET_ARN: props.dbSecret.secretArn },
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      bundling: {
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `mkdir -p ${outputDir}/migrations`,
            `cp ${inputDir}/backend/src/migrations/*.sql ${outputDir}/migrations/`,
          ],
        },
      },
    })
    props.dbSecret.grantRead(fn)
    // NOTE: do NOT call db.connections.allowDefaultPortFrom(fn) — that
    // would re-introduce the api↔data dependency cycle fixed in 462f573.
    // Lambda reaches DB via the existing VPC CIDR ingress on the DB SG.
    void props.db
  }
}
