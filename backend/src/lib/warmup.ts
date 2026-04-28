// Lambda warmup short-circuit. Allows a no-op invocation that bypasses all
// downstream work (Secrets Manager, DB, external APIs) but still triggers
// the Node.js init + VPC ENI attach the first time. Subsequent real
// invocations within ~5-15 minutes hit the warm container directly,
// removing 1-3 s of cold-start latency from the user-perceived flow.
//
// Two activation paths so any caller can warm the function regardless of
// the integration used:
//   - HTTP API: `?warmup=1` query param OR `x-sh-warmup: 1` header
//   - Direct invoke (future): `event.warmup === true`
//
// Usage in a handler:
//   export const handler: APIGatewayProxyHandlerV2 = async (event) => {
//     if (isWarmup(event)) return warmupResponse()
//     // ...real work...
//   }

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

interface WarmupEvent { warmup?: boolean }

export function isWarmup(event: APIGatewayProxyEventV2 | WarmupEvent): boolean {
  if ('warmup' in event && event.warmup === true) return true
  const e = event as APIGatewayProxyEventV2
  if (e.queryStringParameters?.warmup === '1') return true
  const h = e.headers
  if (h && (h['x-sh-warmup'] === '1' || h['X-Sh-Warmup'] === '1')) return true
  return false
}

export function warmupResponse(): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 204,
    headers: { 'x-sh-warmed': '1' },
    body: '',
  }
}
