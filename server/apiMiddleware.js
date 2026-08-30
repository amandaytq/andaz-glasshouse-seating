// Connect/Express-style middleware exposing the layout "database" as JSON.
// Mounted both in the Vite dev server (vite.config.js) and the production
// server (server/index.js), so the API behaves identically in dev and prod.
//
//   GET  /api/layout        -> { rev, updatedAt, layout }
//   PUT  /api/layout         body { layout }  -> { rev, updatedAt }
//   POST /api/layout/reset  -> { rev, updatedAt, layout }

import { getLayout, saveLayout, resetLayout } from './layoutStore.js'

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

    return send(res, 404, { error: 'not found' })
  } catch (err) {
    return send(res, 500, { error: String(err?.message || err) })
  }
}
