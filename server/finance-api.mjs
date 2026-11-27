// GET /finance/work-hours?month=YYYY-MM — every worker's logged hours for one
// month, day by day and task by task, for the owner's finance platform.
//
// Read-only, and open to one caller: whoever holds FINANCE_API_KEY, sent as
// "Authorization: Bearer <key>". Without the key set it answers nothing.
// FINANCE_API_ALLOWED_IPS (comma-separated) narrows it to those addresses, and
// an address that keeps sending wrong keys is shut out for a while. No CORS
// headers are sent: the key belongs on a server, never in a web page.
//
// GET /finance/docs is the Swagger page and /finance/openapi.json its spec.
// Neither holds any data; trying a call from the page still needs the key.
//
// Hours belong to whoever logged them and fall on the date the entry carries
// (an Israel-time calendar day), the same rule as the planner's work report,
// so the two always agree. With no month given it returns the last complete
// one, so a monthly job can call it without working out dates.

import { createHash, timingSafeEqual } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const API_KEY = process.env.FINANCE_API_KEY
const ALLOWED_IPS = new Set((process.env.FINANCE_API_ALLOWED_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean))
const TIMEZONE = 'Asia/Jerusalem'
const PAGE = 1000
const MAX_FAILURES = 10
const LOCKOUT_MS = 15 * 60_000
const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14'

const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS })
  response.end(JSON.stringify(body))
}

const digest = value => createHash('sha256').update(value).digest()

// nginx sets X-Real-IP; the socket address is only ever 127.0.0.1 behind it.
const clientIp = request => String(request.headers['x-real-ip'] || request.socket.remoteAddress || '')

const failures = new Map()
function lockedOut(ip) {
  const record = failures.get(ip)
  if (!record) return false
  if (Date.now() - record.since > LOCKOUT_MS) { failures.delete(ip); return false }
  return record.count >= MAX_FAILURES
}
function recordFailure(ip) {
  const record = failures.get(ip)
  if (record && Date.now() - record.since <= LOCKOUT_MS) record.count += 1
  else failures.set(ip, { count: 1, since: Date.now() })
  if (failures.size > 10_000) failures.clear()
}

function keyMatches(request) {
  if (!API_KEY) return false
  const header = request.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  return token.length > 0 && timingSafeEqual(digest(token), digest(API_KEY))
}

const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'DYO Planner — Work Hours API',
    version: '1.0.0',
    description: 'Read-only. Every worker\'s logged hours for one calendar month (Israel time), by day and by task. '
      + 'Hours belong to whoever logged them, on the date of the entry — the same rule as the planner\'s work report.',
  },
  servers: [{ url: '/api/claude' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'The finance API key.' } },
    schemas: {
      Entry: {
        type: 'object',
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          task: { type: 'string', description: 'Task title' },
          board: { type: 'string', description: 'Board name' },
          hours: { type: 'number', example: 1.25 },
          minutes: { type: 'integer', example: 75 },
          note: { type: 'string', nullable: true },
          fromTimer: { type: 'boolean', description: 'true when recorded by the planner\'s timer, false when typed in by hand' },
        },
      },
      Day: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date', example: '2026-11-02' },
          hours: { type: 'number', example: 7.5 },
          minutes: { type: 'integer', example: 450 },
          entries: { type: 'array', items: { $ref: '#/components/schemas/Entry' } },
        },
      },
      Worker: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          active: { type: 'boolean' },
          totalHours: { type: 'number', example: 98.4 },
          totalMinutes: { type: 'integer', example: 5904 },
          days: { type: 'array', items: { $ref: '#/components/schemas/Day' } },
        },
      },
      WorkHours: {
        type: 'object',
        properties: {
          month: { type: 'string', example: '2026-11' },
          timezone: { type: 'string', example: 'Asia/Jerusalem' },
          generatedAt: { type: 'string', format: 'date-time' },
          totalHours: { type: 'number' },
          unattributedHours: { type: 'number', description: 'Hours from very old entries with no worker recorded; not in any worker\'s total' },
          workers: { type: 'array', items: { $ref: '#/components/schemas/Worker' } },
        },
      },
      Error: { type: 'object', properties: { error: { type: 'string' } } },
    },
  },
  paths: {
    '/finance/work-hours': {
      get: {
        summary: 'Monthly work hours per worker',
        description: 'Active workers are always listed, with zero hours if they logged none. A worker who has since left appears only if they logged hours that month.',
        parameters: [{
          name: 'month', in: 'query', required: false,
          description: 'YYYY-MM. Omitted: the last complete month.',
          schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-11' },
        }],
        responses: {
          200: { description: 'Hours for the month', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkHours' } } } },
          400: { description: 'Bad month', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Missing or wrong API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          403: { description: 'Caller address not allowed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Too many wrong keys from this address; try again in 15 minutes', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
}

const DOCS_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Work Hours API</title>
<link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css"><style>body{margin:0;background:#fff}</style></head><body><div id="docs"></div>
<script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: 'openapi.json', dom_id: '#docs', persistAuthorization: false, tryItOutEnabled: false })</script></body></html>`

export function handleFinanceDocs(request, response) {
  if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed' })
  const path = new URL(request.url, 'http://local').pathname
  if (path === '/finance/openapi.json') return send(response, 200, OPENAPI)
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS })
  response.end(DOCS_PAGE)
}

function lastCompleteMonth() {
  const [year, month] = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }).split('-').map(Number)
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
}

async function readAll(path) {
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`, {
      headers: { apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Database read failed (${response.status})`)
    const page = await response.json()
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

const round2 = value => Math.round(value * 100) / 100

export async function handleFinanceWorkHours(request, response) {
  if (request.method !== 'GET') return send(response, 405, { error: 'Method not allowed' })
  const ip = clientIp(request)
  if (ALLOWED_IPS.size > 0 && !ALLOWED_IPS.has(ip)) {
    console.warn(`Finance API: refused ${ip} (not allowed)`)
    return send(response, 403, { error: 'Forbidden' })
  }
  if (lockedOut(ip)) return send(response, 429, { error: 'Too many failed attempts' })
  if (!keyMatches(request)) {
    recordFailure(ip)
    console.warn(`Finance API: wrong or missing key from ${ip}`)
    return send(response, 401, { error: 'Unauthorized' })
  }

  const url = new URL(request.url, 'http://local')
  const month = url.searchParams.get('month') || lastCompleteMonth()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return send(response, 400, { error: 'month must look like 2026-11' })
  }

  const [profiles, boards, tasks] = await Promise.all([
    readAll('profiles?select=id,name,email,is_active&order=id'),
    readAll('boards?select=id,name&order=id'),
    readAll('tasks?select=id,title,board,time_entries&order=id'),
  ])
  const boardName = new Map(boards.map(board => [board.id, board.name]))

  const workers = new Map()
  const workerFor = (id, fallbackName) => {
    if (!workers.has(id)) {
      const profile = profiles.find(row => row.id === id)
      workers.set(id, {
        id,
        name: profile?.name ?? fallbackName ?? null,
        email: profile?.email ?? null,
        active: profile?.is_active ?? false,
        minutes: 0,
        days: new Map(),
      })
    }
    return workers.get(id)
  }
  for (const profile of profiles) if (profile.is_active) workerFor(profile.id)

  let unattributedMinutes = 0
  for (const task of tasks) {
    for (const entry of task.time_entries ?? []) {
      if (typeof entry?.date !== 'string' || !entry.date.startsWith(`${month}-`)) continue
      const minutes = (Number(entry.hours) || 0) * 60 + (Number(entry.minutes) || 0)
      if (minutes <= 0) continue
      if (!entry.loggedById) { unattributedMinutes += minutes; continue }

      const worker = workerFor(entry.loggedById, entry.loggedBy)
      worker.minutes += minutes
      if (!worker.days.has(entry.date)) worker.days.set(entry.date, { date: entry.date, minutes: 0, entries: [] })
      const day = worker.days.get(entry.date)
      day.minutes += minutes
      day.entries.push({
        taskId: task.id,
        task: task.title,
        board: boardName.get(task.board) ?? task.board,
        hours: round2(minutes / 60),
        minutes,
        note: entry.note ?? null,
        fromTimer: entry.isLocked === true,
      })
    }
  }

  const result = [...workers.values()]
    .map(worker => ({
      id: worker.id,
      name: worker.name,
      email: worker.email,
      active: worker.active,
      totalHours: round2(worker.minutes / 60),
      totalMinutes: worker.minutes,
      days: [...worker.days.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(day => ({ date: day.date, hours: round2(day.minutes / 60), minutes: day.minutes, entries: day.entries })),
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

  console.log(`Finance API: ${ip} read ${month} (${result.length} workers)`)
  return send(response, 200, {
    month,
    timezone: TIMEZONE,
    generatedAt: new Date().toISOString(),
    totalHours: round2(result.reduce((sum, worker) => sum + worker.totalMinutes, 0) / 60),
    unattributedHours: round2(unattributedMinutes / 60),
    workers: result,
  })
}
