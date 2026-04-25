import type { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { verifyJwt } from '../lib/auth.js'
import { query } from '../lib/db.js'
import { buildPdf } from '../lib/pdf.js'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { loadAppSecrets } from '../lib/env.js'
import { z } from 'zod'

const s3 = new S3Client({})
const Body = z.object({ session_id: z.string().uuid(), title: z.string().default('講義ノート') })

interface SessionRow {
  notes: { ts: number; text: string; important: boolean }[]
  slides: { ts: number; key: string }[]
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  await loadAppSecrets()
  const auth = event.headers.authorization || event.headers.Authorization
  if (!auth?.startsWith('Bearer ')) return { statusCode: 401, body: 'unauthorized' }
  let payload
  try { payload = await verifyJwt(auth.slice(7)) }
  catch { return { statusCode: 401, body: 'invalid token' } }

  const body = Body.parse(JSON.parse(event.body || '{}'))
  const rows = await query<SessionRow>(
    `SELECT notes, slides FROM sessions WHERE id = $1 AND user_id = $2`,
    [body.session_id, payload.sub]
  )
  if (rows.length === 0) return { statusCode: 404, body: 'not found' }
  const sess = rows[0]

  const slideImages: { ts: number; data: Buffer }[] = []
  for (const s of sess.slides) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: s.key }))
    const arr = await obj.Body!.transformToByteArray()
    slideImages.push({ ts: s.ts, data: Buffer.from(arr) })
  }

  const pdf = await buildPdf({ title: body.title, notes: sess.notes, slides: slideImages })
  const pdfKey = `pdfs/${payload.sub}/${body.session_id}.pdf`
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET, Key: pdfKey, Body: pdf, ContentType: 'application/pdf',
  }))

  await query(`UPDATE sessions SET status = 'finalized', pdf_s3_key = $1 WHERE id = $2`,
    [pdfKey, body.session_id])

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: pdfKey }), { expiresIn: 3600 })
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf_url: url, notes: sess.notes }),
  }
}
