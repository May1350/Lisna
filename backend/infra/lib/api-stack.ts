import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Vpc } from 'aws-cdk-lib/aws-ec2'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2'
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import type { DatabaseCluster } from 'aws-cdk-lib/aws-rds'
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
  dbCluster: DatabaseCluster
  appSecret: Secret
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const commonEnv = {
      S3_BUCKET: props.bucket.bucketName,
      DB_SECRET_ARN: props.dbSecret.secretArn,
      APP_SECRET_ARN: props.appSecret.secretArn,
    }

    const health = new NodejsFunction(this, 'HealthFn', {
      entry: path.join(__dirname, '../../src/handlers/health.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
    })

    const authGoogle = new NodejsFunction(this, 'AuthGoogleFn', {
      entry: path.join(__dirname, '../../src/handlers/auth-google.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(10),
      environment: commonEnv,
      vpc: props.vpc,
    })
    props.dbSecret.grantRead(authGoogle)
    props.appSecret.grantRead(authGoogle)
    props.dbCluster.connections.allowDefaultPortFrom(authGoogle)

    const authMe = new NodejsFunction(this, 'AuthMeFn', {
      entry: path.join(__dirname, '../../src/handlers/auth-me.ts'),
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(5),
      environment: commonEnv,
      vpc: props.vpc,
    })
    props.dbSecret.grantRead(authMe)
    props.appSecret.grantRead(authMe)
    props.dbCluster.connections.allowDefaultPortFrom(authMe)

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

    new CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint })
  }
}
