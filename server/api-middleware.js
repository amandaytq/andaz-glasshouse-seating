// Connect/Express-style middleware exposing the layout + guest "databases" as
// JSON. Mounted both in the Vite dev server (vite.config.js) and the production
// server (server/index.js), so the API behaves identically in dev and prod.
//
//   GET  /api/layout        -> { rev, updatedAt, layout }
//   PUT  /api/layout         body { layout }  -> { rev, updatedAt }
//   POST /api/layout/reset  -> { rev, updatedAt, layout }
//
//   GET    /api/guests           -> [ guest, ... ]
//   PUT    /api/guests/:id        body <guest>  -> { guest, bumped: guest|null }
//   DELETE /api/guests/:id       -> { ok: true }
//   POST   /api/guests/reset    -> [ guest, ... ]
//
// Guests are individual rows, not part of the layout document — see
// src/hooks/use-guests.js for why (so ~200 people can each edit their own row
// without a whole-document overwrite). Backed by a local JSON file
// (server/guest-store.js) by default; set GUESTS_TABLE_NAME to point
// `npm run dev` at a real DynamoDB table instead (server/guest-store-dynamo.js
// — see DEPLOY-amplify.md §4).

import { getLayout, saveLayout, resetLayout } from './layout-store.js'
import * as fileGuestStore from './guest-store.js'
import * as dynamoGuestStore from './guest-store-dynamo.js'

const guestStore = process.env.GUESTS_TABLE_NAME ? dynamoGuestStore : fileGuestStore
const { listGuests, upsertGuest, deleteGuest, resetGuests } = guestStore

function send(res, code, body) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 5_000_000) reject(new Error('payload too large'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export async function layoutApi(req, res, next) {
  const url = (req.url || '').split('?')[0]
  if (!url.startsWith('/api/')) return next()

  try {
    if (url === '/api/layout' && req.method === 'GET') {
      return send(res, 200, await getLayout())
    }

    if (url === '/api/layout' && (req.method === 'PUT' || req.method === 'POST')) {
      const body = JSON.parse((await readBody(req)) || '{}')
      if (!body?.layout || !Array.isArray(body.layout.items)) {
        return send(res, 400, { error: 'invalid layout' })
      }
      return send(res, 200, await saveLayout(body.layout))
    }

    if (url === '/api/layout/reset' && req.method === 'POST') {
      return send(res, 200, await resetLayout())
    }

    if (url === '/api/guests' && req.method === 'GET') {
      return send(res, 200, await listGuests())
    }

    if (url === '/api/guests/reset' && req.method === 'POST') {
      return send(res, 200, await resetGuests())
    }

    const guestMatch = url.match(/^\/api\/guests\/([^/]+)$/)
    if (guestMatch && req.method === 'PUT') {
      const id = decodeURIComponent(guestMatch[1])
      const body = JSON.parse((await readBody(req)) || '{}')
      if (!body || typeof body.name !== 'string') {
        return send(res, 400, { error: 'invalid guest' })
      }
      return send(res, 200, await upsertGuest({ ...body, id }))
    }
    if (guestMatch && req.method === 'DELETE') {
      return send(res, 200, await deleteGuest(decodeURIComponent(guestMatch[1])))
    }

    return send(res, 404, { error: 'not found' })
  } catch (err) {
    return send(res, 500, { error: String(err?.message || err) })
  }
}
