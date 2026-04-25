import type { APIGatewayProxyHandler } from 'aws-lambda'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'

export const handler: APIGatewayProxyHandler = async (event) => {
  await loadAppSecrets()
  await query(`DELETE FROM ws_connections WHERE connection_id = $1`,
    [event.requestContext.connectionId])
  return { statusCode: 200, body: 'ok' }
}
