import { Stack, type StackProps } from 'aws-cdk-lib'
import {
  Vpc,
  SubnetType,
  GatewayVpcEndpointAwsService,
  InterfaceVpcEndpointAwsService,
} from 'aws-cdk-lib/aws-ec2'
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

    // S3 Gateway Endpoint — free (no hourly charge), routes private-subnet
    // S3 traffic over the VPC backbone instead of through the NAT Gateway.
    // Cuts NAT data-processing fees on every presigned-URL upload, every
    // putObject from stream-audio/curator, and every export download.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: GatewayVpcEndpointAwsService.S3,
    })

    // Secrets Manager Interface Endpoint — ~$7/mo per AZ, but cheaper than
    // the cumulative NAT data charges for every Lambda cold-start fetching
    // dbSecret + appSecret. Single AZ is sufficient at this scale; the
    // remaining AZ falls back to NAT egress, which still works.
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      privateDnsEnabled: true,
    })

    // NAT Gateway is intentionally retained — Lambdas still need outbound
    // internet for OpenAI / Anthropic / Google API calls, and Stripe.
  }
}
