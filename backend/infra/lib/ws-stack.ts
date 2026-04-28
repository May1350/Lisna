import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib'
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2'
import { Runtime } from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2'
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations'
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
  appSecret: Secret
}

export class WsStack extends Stack {
  readonly wsEndpoint: string
  readonly wsApiId: string
  readonly wsStageName: string

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props)

    const env = {
      DB_SECRET_ARN: props.dbSecret.secretArn,
      APP_SECRET_ARN: props.appSecret.secretArn,
    }
    const mk = (name: string, entry: string) => {
      const fn = new NodejsFunction(this, name, {
        entry: path.join(__dirname, '../../src/handlers/', entry),
        runtime: Runtime.NODEJS_20_X,
        timeout: Duration.seconds(15),
        environment: env,
        vpc: props.vpc,
        vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      })
      props.dbSecret.grantRead(fn)
      props.appSecret.grantRead(fn)
      // DB SG already permits VPC CIDR ingress on 5432; avoid cross-stack SG ref
      // (would create a Data <-> Ws dep cycle alongside IAM grant refs).
      return fn
    }
    const connectFn = mk('WsConnectFn', 'ws-connect.ts')
    const disconnectFn = mk('WsDisconnectFn', 'ws-disconnect.ts')
    void props.db

    const wsApi = new WebSocketApi(this, 'WsApi', {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('Conn', connectFn) },
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration('Disc', disconnectFn) },
    })
    const stage = new WebSocketStage(this, 'Stage', { webSocketApi: wsApi, stageName: 'prod', autoDeploy: true })
    this.wsEndpoint = `https://${wsApi.apiId}.execute-api.${this.region}.amazonaws.com/${stage.stageName}`
    // Exposed so other stacks (e.g., ApiStack handlers) can grant themselves
    // execute-api:ManageConnections on this WS API. Without that IAM permission,
    // the @aws-sdk/client-apigatewaymanagementapi PostToConnection call from
    // streamAudio fails with AccessDeniedException and notes never reach the
    // modal even when Gemini produces them.
    this.wsApiId = wsApi.apiId
    this.wsStageName = stage.stageName

    new CfnOutput(this, 'WsUrl', { value: stage.url })
    new CfnOutput(this, 'WsEndpoint', { value: this.wsEndpoint })
  }
}
