import http from 'node:http'

const HOST = '127.0.0.1'
const PORT = Number(process.env.ANTHROPIC_PROXY_PORT || 3002)
const MAX_BODY_BYTES = 1_000_000
const API_KEY = process.env.ANTHROPIC_API_KEY
const TRANSLATION_API_KEY = process.env.ANTHROPIC_TRANSLATION_API_KEY
const NOTIFY_TICKET_DEPLOYED_URL = process.env.NOTIFY_TICKET_DEPLOYED_URL
const SEND_TICKET_MESSAGE_URL = process.env.SEND_TICKET_MESSAGE_URL
const GET_TICKET_MESSAGES_URL = process.env.GET_TICKET_MESSAGES_URL
const DEPLOY_SECRET = process.env.DEPLOY_SECRET

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

// ─── Ticket chat states ──────────────────────────────────────────────────────
// The board needs to show, without opening each task, whether a ticket we
// messaged has been answered. The upstream function answers one ticket at a
// time, so the fan-out happens here: one browser request, a short server-side
// cache, and a small concurrency cap so a board full of tickets cannot turn
// into a burst of upstream reads.
const TICKET_STATE_TTL_MS = 60_000
const TICKET_STATE_MAX_TICKETS = 200
const TICKET_STATE_CONCURRENCY = 6
const TICKET_STATE_CACHE_MAX = 2000
const ticketStateCache = new Map()

function summariseTicketMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  let dyoCount = 0
  let adminCount = 0
  let lastAt = null
  let lastSender = null
  for (const message of list) {
    const isDyo = message && message.sender === 'dyo'
    if (isDyo) dyoCount += 1
    else adminCount += 1
    const at = message && typeof message.timestamp === 'number' ? message.timestamp : null
    if (at !== null && (lastAt === null || at >= lastAt)) {
      lastAt = at
      lastSender = isDyo ? 'dyo' : 'admin'
    }
  }
  // A thread whose messages carry no usable timestamp still has an order.
  if (lastSender === null && list.length > 0) {
    lastSender = list[list.length - 1] && list[list.length - 1].sender === 'dyo' ? 'dyo' : 'admin'
  }
  return { total: list.length, dyoCount, adminCount, lastSender, lastAt }
}

function readTicketStateCache(key) {
  const hit = ticketStateCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at >= TICKET_STATE_TTL_MS) {
    ticketStateCache.delete(key)
    return null
  }
  return hit.state
}

function writeTicketStateCache(key, state) {
  if (ticketStateCache.size >= TICKET_STATE_CACHE_MAX) {
    for (const [cached, entry] of ticketStateCache) {
      if (Date.now() - entry.at >= TICKET_STATE_TTL_MS) ticketStateCache.delete(cached)
    }
    // Still full of fresh entries: drop the oldest insertions.
    while (ticketStateCache.size >= TICKET_STATE_CACHE_MAX) {
      const oldest = ticketStateCache.keys().next()
      if (oldest.done) break
      ticketStateCache.delete(oldest.value)
    }
  }
  ticketStateCache.set(key, { at: Date.now(), state })
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { status: 'ok' })
  }

  const isClaudeRequest = request.method === 'POST' && (request.url === '/v1/messages' || request.url === '/v1/translation-messages')
  const isDeployNotification = request.method === 'POST' && request.url === '/notify-ticket-deployed'
  const isSendTicketMessage = request.method === 'POST' && request.url === '/send-ticket-message'
  const isGetTicketMessages = request.method === 'POST' && request.url === '/get-ticket-messages'
  const isGetTicketMessageStates = request.method === 'POST' && request.url === '/get-ticket-message-states'
  if (!isClaudeRequest && !isDeployNotification && !isSendTicketMessage && !isGetTicketMessages && !isGetTicketMessageStates) {
    return sendJson(response, 404, { error: 'Not found' })
  }

  try {
    const rawBody = await readBody(request)
    const parsedBody = JSON.parse(rawBody.toString('utf8'))

    if (isDeployNotification) {
      if (!NOTIFY_TICKET_DEPLOYED_URL || !DEPLOY_SECRET) return sendJson(response, 503, { error: 'Deployment notification is not configured' })
      const upstream = await fetch(NOTIFY_TICKET_DEPLOYED_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': DEPLOY_SECRET },
        body: rawBody,
        signal: AbortSignal.timeout(30_000),
      })
      const body = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      return response.end(body)
    }

    if (isSendTicketMessage) {
      if (!SEND_TICKET_MESSAGE_URL || !DEPLOY_SECRET) return sendJson(response, 503, { error: 'Ticket messaging is not configured' })
      const upstream = await fetch(SEND_TICKET_MESSAGE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': DEPLOY_SECRET },
        body: rawBody,
        signal: AbortSignal.timeout(30_000),
      })
      const body = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      return response.end(body)
    }

    if (isGetTicketMessageStates) {
      if (!GET_TICKET_MESSAGES_URL || !DEPLOY_SECRET) return sendJson(response, 503, { error: 'Ticket messaging is not configured' })
      const wanted = parsedBody && Array.isArray(parsedBody.tickets) ? parsedBody.tickets : []
      const jobs = []
      const seen = new Set()
      for (const entry of wanted) {
        const appId = entry && typeof entry.app_id === 'string' ? entry.app_id : ''
        const ticketId = entry && typeof entry.ticket_id === 'string' ? entry.ticket_id : ''
        if (!appId || !ticketId) continue
        const key = `${appId}/${ticketId}`
        if (seen.has(key)) continue
        seen.add(key)
        jobs.push({ appId, ticketId, key })
        if (jobs.length >= TICKET_STATE_MAX_TICKETS) break
      }

      const states = {}
      const misses = []
      for (const job of jobs) {
        const cached = readTicketStateCache(job.key)
        if (cached) states[job.key] = cached
        else misses.push(job)
      }

      let cursor = 0
      const worker = async () => {
        while (cursor < misses.length) {
          const job = misses[cursor]
          cursor += 1
          try {
            const upstream = await fetch(GET_TICKET_MESSAGES_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-webhook-secret': DEPLOY_SECRET },
              body: JSON.stringify({ app_id: job.appId, ticket_id: job.ticketId }),
              signal: AbortSignal.timeout(20_000),
            })
            if (!upstream.ok) continue
            const data = await upstream.json()
            const state = summariseTicketMessages(data && data.messages)
            writeTicketStateCache(job.key, state)
            states[job.key] = state
          } catch {
            // A ticket that cannot be read is left out of the reply, and the
            // board shows no badge for it rather than a wrong one.
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(TICKET_STATE_CONCURRENCY, misses.length) }, worker))
      return sendJson(response, 200, { states })
    }

    if (isGetTicketMessages) {
      if (!GET_TICKET_MESSAGES_URL || !DEPLOY_SECRET) return sendJson(response, 503, { error: 'Ticket messaging is not configured' })
      const upstream = await fetch(GET_TICKET_MESSAGES_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': DEPLOY_SECRET },
        body: rawBody,
        signal: AbortSignal.timeout(30_000),
      })
      const body = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      return response.end(body)
    }

    const anthropicKey = request.url === '/v1/translation-messages' ? TRANSLATION_API_KEY : API_KEY
    if (!anthropicKey) return sendJson(response, 503, { error: { message: 'AI service is not configured' } })

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
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
      return sendJson(response, 413, { error: 'Request body too large' })
    }
    console.error('Anthropic proxy request failed:', error instanceof Error ? error.message : 'unknown error')
    return sendJson(response, 502, { error: 'AI service unavailable' })
  }
})

server.requestTimeout = 125_000
server.headersTimeout = 10_000
server.listen(PORT, HOST, () => {
  console.log(`Anthropic proxy listening on http://${HOST}:${PORT}`)
})
