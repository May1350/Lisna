// User feedback intake. POST /v1/feedback. JWT-authenticated.
//
// Stores the submission in the `feedbacks` table and publishes a
// summary message to the existing `lisna-alerts` SNS topic so the
// operator gets a near-real-time email when something lands.
//
// Privacy note: the message body is included in the SNS notification
// (otherwise we'd have to log into the DB every time to read it,
// defeating the point). The Privacy Policy already discloses that
// "ユーザーフィードバックを送信した場合、その内容と送信元 URL が管理者に
// 通知されます".

import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { z } from 'zod'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { loadAppSecrets } from '../lib/env.js'
import { isWarmup, warmupResponse } from '../lib/warmup.js'

const Body = z.object({
  category: z.enum(['bug', 'feature_request', 'other']),
  // Match the schema CHECK + the UI's maxLength.
  message: z.string().trim().min(1).max(2000),
  // Optional context — extension passes the active page URL when
  // available so we can repro bug reports without playing
  // 20-questions over email.
  context_url: z.string().url().optional(),
  ext_version: z.string().max(32).optional(),
  // The browser's UA string. Capped to avoid pathological inputs.
  user_agent: z.string().max(512).optional(),
})

let _sns: SNSClient | undefined
function snsClient(): SNSClient {
  if (!_sns) _sns = new SNSClient({})
  return _sns
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (isWarmup(event)) return warmupResponse()
  await loadAppSecrets()

  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }

  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  let body: ReturnType<typeof Body.parse>
  try {
    body = Body.parse(JSON.parse(event.body || '{}'))
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'bad_request',
        message: e instanceof Error ? e.message : 'invalid body',
      }),
    }
  }

  // Insert + fetch the submitter's email in one round-trip. The JWT
  // payload only carries `sub` and `plan`, not `email` — pulling email
  // here means the SNS notification can include a human-readable
  // address instead of a UUID.
  const inserted = await query<{ id: string; created_at: string; email: string }>(
    `WITH ins AS (
       INSERT INTO feedbacks (user_id, category, message, context_url, ext_version, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at, user_id
     )
     SELECT ins.id, ins.created_at, u.email
       FROM ins JOIN users u ON u.id = ins.user_id`,
    [
      payload.sub,
      body.category,
      body.message,
      body.context_url ?? null,
      body.ext_version ?? null,
      body.user_agent ?? null,
    ],
  )
  const feedback = inserted[0]

  // SNS publish is best-effort — the row is already saved, so a failed
  // notification just means the operator won't see this one in their
  // inbox. They can still grep the table via the maintenance query in
  // operations.md. Log the error for diagnosis but don't 500 the user.
  const topicArn = process.env.ALERTS_TOPIC_ARN
  if (topicArn) {
    const subject = `[Lisna feedback] ${body.category} from ${feedback.email}`
      // SNS Subject must be ≤ 100 ASCII chars. Trim defensively.
      .slice(0, 100)
    const lines = [
      `Category: ${body.category}`,
      `User:     ${feedback.email} (${payload.sub})`,
      `URL:      ${body.context_url ?? '(none)'}`,
      `Version:  ${body.ext_version ?? '(none)'}`,
      `UA:       ${body.user_agent ?? '(none)'}`,
      `When:     ${feedback.created_at}`,
      ``,
      `Message:`,
      body.message,
      ``,
      `Feedback ID: ${feedback.id}`,
    ].join('\n')
    try {
      await snsClient().send(new PublishCommand({
        TopicArn: topicArn,
        Subject: subject,
        Message: lines,
      }))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[feedback] SNS publish failed:', e instanceof Error ? e.message : e)
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('[feedback] ALERTS_TOPIC_ARN not set; skipping notification')
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: feedback.id }),
  }
}
