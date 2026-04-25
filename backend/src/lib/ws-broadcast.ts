import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi'
import { query } from './db.js'

let _client: ApiGatewayManagementApiClient | undefined
function client(): ApiGatewayManagementApiClient {
  if (!_client) {
    const endpoint = process.env.WS_ENDPOINT
    if (!endpoint) throw new Error('WS_ENDPOINT not set')
    _client = new ApiGatewayManagementApiClient({ endpoint })
  }
  return _client
}

export async function sendToSession(sessionId: string, message: unknown): Promise<void> {
  const conns = await query<{ connection_id: string }>(
    `SELECT connection_id FROM ws_connections WHERE session_id = $1`,
    [sessionId]
  )
  await Promise.all(conns.map(async ({ connection_id }) => {
    try {
      await client().send(new PostToConnectionCommand({
        ConnectionId: connection_id,
        Data: Buffer.from(JSON.stringify(message)),
      }))
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
      if (status === 410) {
        await query(`DELETE FROM ws_connections WHERE connection_id = $1`, [connection_id])
      } else { throw e }
    }
  }))
}
