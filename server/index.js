// Production server: serves the built SPA (dist/) and the layout API from the
// same origin, so a deployed instance gives every visitor the one shared layout.
//
//   npm run serve      # build then start
//   npm start          # start (expects dist/ to exist)
//   PORT=8080 npm start

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import express from 'express'
import { layoutApi } from './api-middleware.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(dir, '..', 'dist')

const app = express()
app.use(layoutApi)

if (!fs.existsSync(dist)) {
  console.warn('dist/ not found — run "npm run build" first (API still works).')
} else {
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`The Glasshouse layout planner  ->  http://localhost:${port}`)
})
