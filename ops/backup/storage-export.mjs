#!/usr/bin/env node
// Copies every Supabase Storage object listed in a TSV file into a local
// directory, for the nightly Planner backup (ops/backup/planner-backup-s3.sh).
//
//   node storage-export.mjs --list <tsv> --out <dir> --url <SUPABASE_URL>
//
// The TSV has one object per line: bucket_id<TAB>name<TAB>size (bytes).
// SUPABASE_SERVICE_ROLE_KEY comes from the environment and is never logged.
// Prints one JSON line {"files":N,"bytes":B,"failed":F} and exits non-zero
// unless every object arrived with exactly the size Storage recorded.

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ATTEMPTS = 3
const CONCURRENCY = 4

function objectUrl(baseUrl, bucket, name) {
  const encoded = name.split('/').map(encodeURIComponent).join('/')
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encoded}`
}

async function download(object, { outDir, baseUrl, key, fetchImpl }) {
  const target = path.resolve(outDir, object.bucket, object.name)
  if (!target.startsWith(path.resolve(outDir) + path.sep)) {
    throw new Error('object name escapes the output directory')
  }

  let lastError
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(objectUrl(baseUrl, object.bucket, object.name), {
        headers: { Authorization: `Bearer ${key}`, apikey: key },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = Buffer.from(await response.arrayBuffer())
      if (body.length !== object.size) {
        throw new Error(`size ${body.length}, expected ${object.size}`)
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, body)
      return body.length
    } catch (error) {
      lastError = error
      if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 200 * attempt))
    }
  }
  throw lastError
}

export async function exportObjects({ objects, outDir, baseUrl, key, fetchImpl = fetch }) {
  const result = { files: 0, bytes: 0, failed: 0, errors: [] }
  const queue = [...objects]

  async function worker() {
    while (queue.length) {
      const object = queue.shift()
      try {
        result.bytes += await download(object, { outDir, baseUrl, key, fetchImpl })
        result.files++
      } catch (error) {
        result.failed++
        result.errors.push(`${object.bucket}/${object.name}: ${error.message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return result
}

export function parseList(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const [bucket, name, size] = line.split('\t')
    if (!bucket || !name || !/^\d+$/.test(size ?? '')) {
      throw new Error(`bad list line: ${JSON.stringify(line)}`)
    }
    return { bucket, name, size: Number(size) }
  })
}

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index > 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const list = argValue('--list')
  const outDir = argValue('--out')
  const baseUrl = argValue('--url')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!list || !outDir || !baseUrl || !key) {
    console.error('usage: SUPABASE_SERVICE_ROLE_KEY=... node storage-export.mjs --list <tsv> --out <dir> --url <SUPABASE_URL>')
    process.exit(64)
  }

  const objects = parseList(await fs.readFile(list, 'utf8'))
  await fs.mkdir(outDir, { recursive: true })
  const result = await exportObjects({ objects, outDir, baseUrl, key })
  for (const error of result.errors) console.error(`storage-export: ${error}`)
  console.log(JSON.stringify({ files: result.files, bytes: result.bytes, failed: result.failed }))
  process.exit(result.failed === 0 ? 0 : 1)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(`storage-export: ${error.message}`)
    process.exit(1)
  })
}
