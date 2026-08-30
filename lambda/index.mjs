// AWS Lambda handler for the shared layout "database", backed by a single S3
// object. Pair it with a Lambda Function URL and an Amplify `/api/<*>` rewrite
// (see DEPLOY-amplify.md). Node 20 runtime already bundles @aws-sdk/*.
//
//   GET  /api/layout        -> { rev, updatedAt, layout }
//   PUT  /api/layout   body { layout } -> { rev, updatedAt }
//   POST /api/layout/reset  -> { rev, updatedAt, layout }
//
// Env: LAYOUT_S3_BUCKET (required), LAYOUT_S3_KEY (default "layout.json"),
//      LAYOUT_S3_REGION (default: the Lambda's own AWS_REGION)

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { buildDefaultLayout } from './defaultLayout.js'

const s3 = new S3Client({ region: process.env.LAYOUT_S3_REGION || process.env.AWS_REGION })
const BUCKET = process.env.LAYOUT_S3_BUCKET
const KEY = process.env.LAYOUT_S3_KEY || 'layout.json'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  body: JSON.stringify(body),
})

async function readRecord() {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: KEY }))
    const rec = JSON.parse(await out.Body.transformToString())
    if (rec?.layout && Array.isArray(rec.layout.items)) return rec
  } catch (err) {
    const missing = err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404
    if (!missing) throw err
  }
  const seeded = { rev: 1, updatedAt: new Date().toISOString(), layout: buildDefaultLayout() }
  await writeRecord(seeded)
  return seeded
}

async function writeRecord(rec) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: KEY,
      Body: JSON.stringify(rec, null, 2),
      ContentType: 'application/json',
    }),
  )
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET'
  const path = ((event?.rawPath || event?.path || '/').replace(/\/+$/, '') || '/').replace(/^\/api/, '')

  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (!BUCKET) return json(500, { error: 'LAYOUT_S3_BUCKET is not set' })

  try {
    if (method === 'GET' && path === '/layout') {
      return json(200, await readRecord())
    }
    if ((method === 'PUT' || method === 'POST') && path === '/layout') {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : event.body || '{}'
      const body = JSON.parse(raw || '{}')
      if (!body?.layout || !Array.isArray(body.layout.items)) {
        return json(400, { error: 'invalid layout' })
      }
      const cur = await readRecord()
      const rec = { rev: (cur.rev || 0) + 1, updatedAt: new Date().toISOString(), layout: body.layout }
      await writeRecord(rec)
      return json(200, { rev: rec.rev, updatedAt: rec.updatedAt })
    }
    if (method === 'POST' && path === '/layout/reset') {
      const cur = await readRecord()
      const rec = {
        rev: (cur.rev || 0) + 1,
        updatedAt: new Date().toISOString(),
        layout: buildDefaultLayout(),
      }
      await writeRecord(rec)
      return json(200, rec)
    }
    return json(404, { error: 'not found' })
  } catch (err) {
    return json(500, { error: String(err?.message || err) })
  }
}
