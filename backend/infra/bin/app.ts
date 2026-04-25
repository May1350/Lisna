import { App } from 'aws-cdk-lib'
import { NetworkStack } from '../lib/network-stack.js'
import { DataStack } from '../lib/data-stack.js'
import { ApiStack } from '../lib/api-stack.js'
import { SecretsStack } from '../lib/secrets-stack.js'

const app = new App()
const env = { region: 'ap-northeast-1' }

const network = new NetworkStack(app, 'StudyHelperNetwork', { env })
const data = new DataStack(app, 'StudyHelperData', { env, vpc: network.vpc })
const secrets = new SecretsStack(app, 'StudyHelperSecrets', { env })
new ApiStack(app, 'StudyHelperApi', {
  env,
  vpc: network.vpc,
  dbSecret: data.dbSecret,
  bucket: data.bucket,
  dbCluster: data.cluster,
  appSecret: secrets.appSecret,
})
