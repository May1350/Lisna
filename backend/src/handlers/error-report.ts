import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'

interface ErrorReport {
  message: string
  stack?: string
  context?: string
  url?: string
  userAgent?: string
  userId?: string
  extensionVersion?: string
  severity?: 'fatal' | 'error' | 'warning'
  metadata?: Record<string, unknown>
}

// Receives client-side error reports and emits a single structured log line
// per error. CloudWatch Insights can then query by severity/context/userId
// without needing a dedicated DB table — keeps infra footprint minimal until
// volume warrants it.
//
// No auth required: errors must report even when the user is not logged in
// (login itself can fail). Rate limiting handled by API Gateway throttling.
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  let report: ErrorReport
  try {
    report = JSON.parse(event.body ?? '{}') as ErrorReport
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'invalid json' }) }
  }

  if (!report.message || typeof report.message !== 'string') {
    return { statusCode: 400, body: JSON.stringify({ error: 'message required' }) }
  }

  // Truncate to keep CloudWatch log entries reasonable (max event size 256KB
  // but we never need anywhere near that; cap each field at sensible limits).
  const truncate = (s: string | undefined, max: number) =>
    s && s.length > max ? s.slice(0, max) + '…[truncated]' : s

  const logEntry = {
    type: 'CLIENT_ERROR',
    severity: report.severity ?? 'error',
    message: truncate(report.message, 2000),
    context: truncate(report.context, 200),
    stack: truncate(report.stack, 4000),
    url: truncate(report.url, 500),
    userAgent: truncate(report.userAgent, 300),
    userId: report.userId,
    extensionVersion: report.extensionVersion,
    metadata: report.metadata,
    receivedAt: new Date().toISOString(),
    sourceIp: event.requestContext.http.sourceIp,
  }

  // Single-line JSON output → CloudWatch Insights can `parse @message`
  // and filter by `severity = "fatal"` etc.
  console.log(JSON.stringify(logEntry))

  return {
    statusCode: 204,
    headers: { 'Content-Type': 'application/json' },
    body: '',
  }
}
