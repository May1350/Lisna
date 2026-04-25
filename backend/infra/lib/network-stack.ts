import { Stack, type StackProps } from 'aws-cdk-lib'
import { Vpc, SubnetType } from 'aws-cdk-lib/aws-ec2'
import type { Construct } from 'constructs'

export class NetworkStack extends Stack {
  readonly vpc: Vpc
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props)
    this.vpc = new Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      ],
    })
  }
}
