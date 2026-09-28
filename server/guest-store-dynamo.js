// DynamoDB-backed guest store for LOCAL DEV, used instead of the file-backed
// server/guest-store.js when GUESTS_TABLE_NAME is set in the environment —
// lets you point `npm run dev` at the real table before deploying, rather
// than only ever testing against the local JSON file. Logic here is
// deliberately a copy of lambda/index.mjs's guest functions (same reasoning
// as guest-store.js vs. lambda: kept in sync by hand rather than shared
// across a packaging boundary).
//
// Needs AWS credentials visible to the process (e.g. `aws configure`, or
// AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in the shell) and GUESTS_TABLE_NAME
// set — see DEPLOY-amplify.md §4 for how to create the table.

import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb'
import { buildDefaultGuests } from '../src/data/default-guests.js'

const REGION = process.env.AWS_REGION || process.env.GUESTS_TABLE_REGION || 'ap-southeast-1'
const ddb = new DynamoDBClient({ region: REGION })
const TABLE = process.env.GUESTS_TABLE_NAME

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
    const res = await ddb.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }))
    for (const item of res.Items || []) out.push(unmarshalGuest(item))
    ExclusiveStartKey = res.LastEvaluatedKey
  } while (ExclusiveStartKey)
  return out
}

async function batchWrite(requests) {
  for (let i = 0; i < requests.length; i += 25) {
    const chunk = requests.slice(i, i + 25)
    let unprocessed = { [TABLE]: chunk }
    while (unprocessed[TABLE]?.length) {
      const res = await ddb.send(new BatchWriteItemCommand({ RequestItems: unprocessed }))
      unprocessed = res.UnprocessedItems || {}
    }
  }
}

export async function listGuests() {
  if (!TABLE) throw new Error('GUESTS_TABLE_NAME is not set')
  const rows = await scanAllGuests()
  if (rows.length) return rows
  const seed = buildDefaultGuests().map((g) => ({ ...g, updatedAt: new Date().toISOString() }))
  await batchWrite(seed.map((g) => ({ PutRequest: { Item: marshalGuest(g) } })))
  return seed
}

export async function upsertGuest(patch) {
  if (!TABLE) throw new Error('GUESTS_TABLE_NAME is not set')
  const id = String(patch.id)
  const got = await ddb.send(new GetItemCommand({ TableName: TABLE, Key: { id: { S: id } } }))
  const prev = unmarshalGuest(got.Item) || {}
  const guest = {
    id,
    name: String(patch.name ?? prev.name ?? '').trim(),
    side: patch.side === 'bride' || prev.side === 'bride' ? 'bride' : 'groom',
    relation: String(patch.relation ?? prev.relation ?? '').trim(),
    rsvp: patch.rsvp ?? prev.rsvp ?? 'yes',
    meal: patch.meal ?? prev.meal ?? 'chinese',
    afterparty: patch.afterparty !== undefined ? !!patch.afterparty : !!prev.afterparty,
    arrived: patch.arrived !== undefined ? !!patch.arrived : !!prev.arrived,
    needsParking: patch.needsParking !== undefined ? !!patch.needsParking : !!prev.needsParking,
    tableId: patch.tableId !== undefined ? patch.tableId : (prev.tableId ?? null),
    seatIndex: patch.seatIndex !== undefined ? patch.seatIndex : (prev.seatIndex ?? null),
    updatedAt: new Date().toISOString(),
  }
  if (prev.role) guest.role = prev.role
  if (patch.role) guest.role = patch.role

  let bumped = null
  if (guest.tableId != null && guest.seatIndex != null) {
    const all = await scanAllGuests()
    for (const g of all) {
      if (g.id !== id && g.tableId === guest.tableId && g.seatIndex === guest.seatIndex) {
        bumped = { ...g, tableId: null, seatIndex: null, updatedAt: new Date().toISOString() }
        await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshalGuest(bumped) }))
      }
    }
  }

  await ddb.send(new PutItemCommand({ TableName: TABLE, Item: marshalGuest(guest) }))
  return { guest, bumped }
}

export async function deleteGuest(id) {
  if (!TABLE) throw new Error('GUESTS_TABLE_NAME is not set')
  await ddb.send(new DeleteItemCommand({ TableName: TABLE, Key: { id: { S: String(id) } } }))
  return { ok: true }
}

export async function resetGuests() {
  if (!TABLE) throw new Error('GUESTS_TABLE_NAME is not set')
  const existing = await scanAllGuests()
  if (existing.length) {
    await batchWrite(existing.map((g) => ({ DeleteRequest: { Key: { id: { S: g.id } } } })))
  }
  const seed = buildDefaultGuests().map((g) => ({ ...g, updatedAt: new Date().toISOString() }))
  await batchWrite(seed.map((g) => ({ PutRequest: { Item: marshalGuest(g) } })))
  return seed
}
