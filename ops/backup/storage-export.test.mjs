import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportObjects } from './storage-export.mjs'

const KEY = 'test-service-role-key'

// A stand-in for Supabase Storage: serves `files` (request path -> body),
// records every request, and answers 404 for anything else.
async function fakeStorage(files) {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers })
    if (Object.hasOwn(files, req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(files[req.url])
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  return { baseUrl, requests, close: () => new Promise(r => server.close(r)) }
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'storage-export-test-'))
}

test('downloads names with Hebrew and spaces', async () => {
  const encoded = '/storage/v1/object/authenticated/task-attachments/abc/' +
    encodeURIComponent('דוח מכירות.pdf')
  const storage = await fakeStorage({ [encoded]: 'hello' })
  const outDir = await tempDir()
  try {
    const result = await exportObjects({
      objects: [{ bucket: 'task-attachments', name: 'abc/דוח מכירות.pdf', size: 5 }],
      outDir, baseUrl: storage.baseUrl, key: KEY,
    })
    assert.equal(result.failed, 0, result.errors.join('\n'))
    assert.equal(result.files, 1)
    assert.equal(result.bytes, 5)
    assert.equal(storage.requests[0].url, encoded)
    const stat = await fs.stat(path.join(outDir, 'task-attachments', 'abc', 'דוח מכירות.pdf'))
    assert.equal(stat.size, 5)
  } finally {
    await storage.close()
  }
})

test('size mismatch counts as failure', async () => {
  const storage = await fakeStorage({
    '/storage/v1/object/authenticated/work-doc-attachments/short.txt': 'abc',
  })
  try {
    const result = await exportObjects({
      objects: [{ bucket: 'work-doc-attachments', name: 'short.txt', size: 5 }],
      outDir: await tempDir(), baseUrl: storage.baseUrl, key: KEY,
    })
    assert.equal(result.failed, 1)
    assert.equal(result.files, 0)
  } finally {
    await storage.close()
  }
})

test('404 after retries counts as failure', async () => {
  const storage = await fakeStorage({})
  try {
    const result = await exportObjects({
      objects: [{ bucket: 'task-attachments', name: 'gone/file.png', size: 10 }],
      outDir: await tempDir(), baseUrl: storage.baseUrl, key: KEY,
    })
    assert.equal(result.failed, 1)
    assert.match(result.errors[0], /task-attachments/)
    assert.match(result.errors[0], /gone\/file\.png/)
    assert.equal(storage.requests.length, 3, 'tries 3 times before giving up')
  } finally {
    await storage.close()
  }
})

test('byte total is the sum of all files when downloads run in parallel', async () => {
  const files = {}
  const objects = []
  for (let i = 0; i < 8; i++) {
    files[`/storage/v1/object/authenticated/task-attachments/f${i}.bin`] = 'x'.repeat(100 + i)
    objects.push({ bucket: 'task-attachments', name: `f${i}.bin`, size: 100 + i })
  }
  const storage = await fakeStorage(files)
  try {
    const result = await exportObjects({
      objects, outDir: await tempDir(), baseUrl: storage.baseUrl, key: KEY,
    })
    assert.equal(result.failed, 0)
    assert.equal(result.files, 8)
    assert.equal(result.bytes, 828)
  } finally {
    await storage.close()
  }
})

test('sends both auth headers', async () => {
  const storage = await fakeStorage({
    '/storage/v1/object/authenticated/task-attachments/a.txt': 'x',
  })
  try {
    await exportObjects({
      objects: [{ bucket: 'task-attachments', name: 'a.txt', size: 1 }],
      outDir: await tempDir(), baseUrl: storage.baseUrl, key: KEY,
    })
    assert.equal(storage.requests[0].headers.authorization, `Bearer ${KEY}`)
    assert.equal(storage.requests[0].headers.apikey, KEY)
  } finally {
    await storage.close()
  }
})
