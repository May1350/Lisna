import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export class SecretsStack extends Stack {
  readonly appSecret: Secret

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)
    this.appSecret = new Secret(this, 'AppSecret', {
      secretName: 'studyhelper/app',
      description: 'JWT secret, OAuth, AI keys, Stripe',
    })
    new CfnOutput(this, 'AppSecretArn', { value: this.appSecret.secretArn })
  }
}
