// File-backed store for the shared layout. Acts as a tiny single-table "database":
// one JSON document on disk (server/data/layout.json) that every visitor reads
// and the editor writes. Writes are serialised and atomic (temp file + rename).

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDefaultLayout } from '../src/default-layout.js'

const dir = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.LAYOUT_DATA_DIR || path.join(dir, 'data')
const FILE = path.join(DATA_DIR, 'layout.json')

// record shape: { rev, updatedAt, layout }
let cache = null
let chain = Promise.resolve() // serialises all store operations

async function readFromDisk() {
  if (cache) return cache
  try {
    const raw = await fs.readFile(FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.layout && Array.isArray(parsed.layout.items)) {
      cache = {
        rev: Number(parsed.rev) || 1,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        layout: parsed.layout,
      }
      return cache
    }
  } catch {
    /* missing or corrupt -> seed with the blueprint */
  }
  cache = { rev: 1, updatedAt: new Date().toISOString(), layout: buildDefaultLayout() }
  await writeToDisk()
  return cache
}

async function writeToDisk() {
  await fs.mkdir(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2))
  await fs.rename(tmp, FILE)
}

export function getLayout() {
  chain = chain.then(readFromDisk, readFromDisk)
  return chain
}

export function saveLayout(layout) {
  chain = chain.then(async () => {
    await readFromDisk()
    cache = { rev: cache.rev + 1, updatedAt: new Date().toISOString(), layout }
    await writeToDisk()
    return cache
  })
  return chain
}

export function resetLayout() {
  chain = chain.then(async () => {
    await readFromDisk()
    cache = { rev: cache.rev + 1, updatedAt: new Date().toISOString(), layout: buildDefaultLayout() }
    await writeToDisk()
    return cache
  })
  return chain
}
