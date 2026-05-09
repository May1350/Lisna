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
  // Promise.allSettled so one failing connection doesn't abort siblings —
  // every WS subscriber gets an independent chance to receive the message.
  // 410 (stale connection) → delete row silently; any other error is
  // collected and surfaced as an aggregate at the end.
  const results = await Promise.allSettled(conns.map(async ({ connection_id }) => {
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
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => r.reason)
  if (errors.length > 0) {
    const messages = errors.map(e => (e instanceof Error ? e.message : String(e))).join('; ')
    throw new Error(`sendToSession: ${errors.length}/${conns.length} sends failed: ${messages}`)
  }
}
