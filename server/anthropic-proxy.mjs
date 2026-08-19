import http from 'node:http'

const HOST = '127.0.0.1'
const PORT = Number(process.env.ANTHROPIC_PROXY_PORT || 3002)
const MAX_BODY_BYTES = 1_000_000
const API_KEY = process.env.ANTHROPIC_API_KEY

if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY is required')
  process.exit(1)
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { status: 'ok' })
  }

  if (request.method !== 'POST' || request.url !== '/v1/messages') {
    return sendJson(response, 404, { error: { message: 'Not found' } })
  }

  try {
    const rawBody = await readBody(request)
    JSON.parse(rawBody.toString('utf8'))

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: rawBody,
      signal: AbortSignal.timeout(120_000),
    })

    const body = Buffer.from(await upstream.arrayBuffer())
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(body)
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_TOO_LARGE') {
      return sendJson(response, 413, { error: { message: 'Request body too large' } })
    }
    console.error('Anthropic proxy request failed:', error instanceof Error ? error.message : 'unknown error')
    return sendJson(response, 502, { error: { message: 'AI service unavailable' } })
  }
})

server.requestTimeout = 125_000
server.headersTimeout = 10_000
server.listen(PORT, HOST, () => {
  console.log(`Anthropic proxy listening on http://${HOST}:${PORT}`)
})
