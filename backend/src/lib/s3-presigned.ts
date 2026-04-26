import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let _client: S3Client | undefined
function client(): S3Client {
  if (!_client) _client = new S3Client({})
  return _client
}

export async function presignGet(key: string, ttl = 3600): Promise<string> {
  const Bucket = process.env.S3_BUCKET
  if (!Bucket) throw new Error('S3_BUCKET not set')
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket, Key: key }),
    { expiresIn: ttl }
  )
}
