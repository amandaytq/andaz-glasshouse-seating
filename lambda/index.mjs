// AWS Lambda handler for the shared layout "database" (S3) and the per-guest-row
// "database" (DynamoDB). Pair it with a Lambda Function URL and an Amplify
// `/api/<*>` rewrite (see DEPLOY-amplify.md). Node 20 runtime already bundles
// @aws-sdk/*.
//
//   GET  /api/layout        -> { rev, updatedAt, layout }
//   PUT  /api/layout   body { layout } -> { rev, updatedAt }
//   POST /api/layout/reset  -> { rev, updatedAt, layout }
//
//   GET    /api/guests          -> [ guest, ... ]
//   PUT    /api/guests/:id       body <guest> -> { guest, bumped: guest|null }
//   DELETE /api/guests/:id      -> { ok: true }
//   POST   /api/guests/reset   -> [ guest, ... ]
//
// Guests are individual DynamoDB rows/items (one per person), not part of the
// layout document, so ~200 people can each edit their own row without a
// whole-document overwrite — see src/useGuests.js. We use the low-level
// @aws-sdk/client-dynamodb commands (manual attribute-value marshalling)
// rather than @aws-sdk/lib-dynamodb, since only @aws-sdk/client-s3 is
// confirmed bundled in this project's Lambda runtime.
//
// Env: LAYOUT_S3_BUCKET (required for /layout), LAYOUT_S3_KEY (default
//      "layout.json"), LAYOUT_S3_REGION (default: the Lambda's own AWS_REGION)
//      GUESTS_TABLE_NAME (required for /guests) — a DynamoDB table with a
//      String partition key named "id". See DEPLOY-amplify.md for how to
//      create it and the IAM permissions the execution role needs.

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { buildDefaultLayout } from './default-layout.js'
import { buildDefaultGuests } from './data/default-guests.js'

const s3 = new S3Client({ region: process.env.LAYOUT_S3_REGION || process.env.AWS_REGION })
const BUCKET = process.env.LAYOUT_S3_BUCKET
const KEY = process.env.LAYOUT_S3_KEY || 'layout.json'

const ddb = new DynamoDBClient({ region: process.env.LAYOUT_S3_REGION || process.env.AWS_REGION })
const GUESTS_TABLE = process.env.GUESTS_TABLE_NAME

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}
const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  body: JSON.stringify(body),
})

// ---- layout (S3) ----------------------------------------------------------

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

// ---- guests (DynamoDB) -----------------------------------------------------

function marshalGuest(g) {
  const item = {
    id: { S: String(g.id) },
    name: { S: String(g.name ?? '') },
    side: { S: g.side === 'bride' ? 'bride' : 'groom' },
    relation: { S: String(g.relation ?? '') },
    rsvp: { S: String(g.rsvp ?? 'yes') },
    meal: { S: String(g.meal ?? 'chinese') },
    afterparty: { BOOL: !!g.afterparty },
    arrived: { BOOL: !!g.arrived },
    needsParking: { BOOL: !!g.needsParking },
    isChild: { BOOL: !!g.isChild },
    childMeal: { BOOL: !!g.childMeal },
    tableId: g.tableId != null ? { S: String(g.tableId) } : { NULL: true },
    seatIndex: g.seatIndex != null ? { N: String(g.seatIndex) } : { NULL: true },
    updatedAt: { S: g.updatedAt || new Date().toISOString() },
  }
  if (g.role === 'bride' || g.role === 'groom') item.role = { S: g.role }
  return item
}

function unmarshalGuest(item) {
  if (!item) return null
  const g = {
    id: item.id?.S,
    name: item.name?.S || '',
    side: item.side?.S === 'bride' ? 'bride' : 'groom',
    relation: item.relation?.S || '',
    rsvp: item.rsvp?.S || 'yes',
    meal: item.meal?.S || 'chinese',
    afterparty: item.afterparty?.BOOL ?? false,
    arrived: item.arrived?.BOOL ?? false,
    needsParking: item.needsParking?.BOOL ?? false,
    isChild: item.isChild?.BOOL ?? false,
    childMeal: item.childMeal?.BOOL ?? false,
    tableId: item.tableId?.S ?? null,
    seatIndex: item.seatIndex?.N != null ? Number(item.seatIndex.N) : null,
    updatedAt: item.updatedAt?.S || null,
  }
  if (item.role?.S) g.role = item.role.S
  return g
}

async function scanAllGuests() {
  const out = []
  let ExclusiveStartKey
  do {
    const res = await ddb.send(new ScanCommand({ TableName: GUESTS_TABLE, ExclusiveStartKey }))
    for (const item of res.Items || []) out.push(unmarshalGuest(item))
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return out
}

// DynamoDB BatchWriteItem takes at most 25 requests per call.
async function batchWrite(requests) {
  for (let i = 0; i < requests.length; i += 25) {
    const chunk = requests.slice(i, i + 25)
    let unprocessed = { [GUESTS_TABLE]: chunk }
    while (unprocessed[GUESTS_TABLE]?.length) {
      const res = await ddb.send(new BatchWriteItemCommand({ RequestItems: unprocessed }))
      unprocessed = res.UnprocessedItems || {}
    }
  }
}

async function listGuests() {
  const rows = await scanAllGuests()
  if (rows.length) return rows
  // fresh table: seed it from the blueprint's authored seating
  const seed = buildDefaultGuests().map((g) => ({ ...g, updatedAt: new Date().toISOString() }))
  await batchWrite(seed.map((g) => ({ PutRequest: { Item: marshalGuest(g) } })))
  return seed
}

// Upsert one guest. If it takes a seat (tableId+seatIndex both set), whoever
// else is currently in that exact seat is bumped out (their tableId/seatIndex
// cleared). Returns { guest, bumped: guest|null }.
async function upsertGuest(patch) {
  const id = String(patch.id)
  const got = await ddb.send(new GetItemCommand({ TableName: GUESTS_TABLE, Key: { id: { S: id } } }))
  const prev = unmarshalGuest(got.Item) || {}
  const guest = {
    id,
    name: String(patch.name ?? prev.name ?? ''),
    side: patch.side === 'bride' || prev.side === 'bride' ? 'bride' : 'groom',
    relation: String(patch.relation ?? prev.relation ?? '').trim(),
    rsvp: patch.rsvp ?? prev.rsvp ?? 'yes',
    meal: patch.meal ?? prev.meal ?? 'chinese',
    afterparty: patch.afterparty !== undefined ? !!patch.afterparty : !!prev.afterparty,
    arrived: patch.arrived !== undefined ? !!patch.arrived : !!prev.arrived,
    needsParking: patch.needsParking !== undefined ? !!patch.needsParking : !!prev.needsParking,
    isChild: patch.isChild !== undefined ? !!patch.isChild : !!prev.isChild,
    childMeal: patch.childMeal !== undefined ? !!patch.childMeal : !!prev.childMeal,
    tableId: patch.tableId !== undefined ? patch.tableId : (prev.tableId ?? null),
    seatIndex: patch.seatIndex !== undefined ? patch.seatIndex : (prev.seatIndex ?? null),
    updatedAt: new Date().toISOString(),
  }
  if (prev.role) guest.role = prev.role
  if (patch.role) guest.role = patch.role

  let bumped = null
  if (guest.tableId != null && guest.seatIndex != null) {
    // No GSI on (tableId, seatIndex) — a full scan is fine at wedding-guest-list
    // scale (~200 rows); it's the same trade-off server/guestStore.js makes.
    const all = await scanAllGuests()
    for (const g of all) {
      if (g.id !== id && g.tableId === guest.tableId && g.seatIndex === guest.seatIndex) {
        bumped = { ...g, tableId: null, seatIndex: null, updatedAt: new Date().toISOString() }
        await ddb.send(
          new PutItemCommand({ TableName: GUESTS_TABLE, Item: marshalGuest(bumped) }),
        )
      }
    }
  }

  await ddb.send(new PutItemCommand({ TableName: GUESTS_TABLE, Item: marshalGuest(guest) }))
  return { guest, bumped }
}

async function deleteGuest(id) {
  await ddb.send(new DeleteItemCommand({ TableName: GUESTS_TABLE, Key: { id: { S: String(id) } } }))
  return { ok: true }
}

async function resetGuests() {
  const existing = await scanAllGuests()
  if (existing.length) {
    await batchWrite(existing.map((g) => ({ DeleteRequest: { Key: { id: { S: g.id } } } })))
  }
  const seed = buildDefaultGuests().map((g) => ({ ...g, updatedAt: new Date().toISOString() }))
  await batchWrite(seed.map((g) => ({ PutRequest: { Item: marshalGuest(g) } })))
  return seed
}

// ---- routing ----------------------------------------------------------------

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'GET'
  const path = ((event?.rawPath || event?.path || '/').replace(/\/+$/, '') || '/').replace(/^\/api/, '')

  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }

  try {
    if (path === '/layout' || path === '/layout/reset') {
      if (!BUCKET) return json(500, { error: 'LAYOUT_S3_BUCKET is not set' })

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
    }

    if (path.startsWith('/guests')) {
      if (!GUESTS_TABLE) return json(500, { error: 'GUESTS_TABLE_NAME is not set' })

      if (method === 'GET' && path === '/guests') {
        return json(200, await listGuests())
      }
      if (method === 'POST' && path === '/guests/reset') {
        return json(200, await resetGuests())
      }
      const guestMatch = path.match(/^\/guests\/([^/]+)$/)
      if (guestMatch && method === 'PUT') {
        const id = decodeURIComponent(guestMatch[1])
        const raw = event.isBase64Encoded
          ? Buffer.from(event.body || '', 'base64').toString('utf8')
          : event.body || '{}'
        const body = JSON.parse(raw || '{}')
        if (!body || typeof body.name !== 'string') {
          return json(400, { error: 'invalid guest' })
        }
        return json(200, await upsertGuest({ ...body, id }))
      }
      if (guestMatch && method === 'DELETE') {
        return json(200, await deleteGuest(decodeURIComponent(guestMatch[1])))
      }
    }

    return json(404, { error: 'not found' })
  } catch (err) {
    return json(500, { error: String(err?.message || err) })
  }
}
