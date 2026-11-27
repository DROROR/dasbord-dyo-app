// The finance platform's read-only API: who works here and the hours each of
// them logged, day by day and task by task. Served at /api/finance/v1/… —
// nginx forwards that prefix here as /finance/… and marks the request with
// X-Planner-Route: finance; anything arriving without the mark is a 404.
//
// Security:
// - every endpoint needs FINANCE_API_KEY as "Authorization: Bearer <key>";
//   the Swagger page (/docs) and its spec need it too, as the password of a
//   browser login with the username "finance". Unset key: nothing answers.
// - FINANCE_API_ALLOWED_IPS (comma-separated), when set, admits only those.
// - an address that keeps sending a wrong key is shut out for 15 minutes.
// - no CORS headers: the key belongs on a server, never in a web page.
// - it only reads; nothing here writes to the database.
//
// Hours belong to whoever logged them and fall on the date the entry carries
// (an Israel-time calendar day) — the planner's own work report uses the same
// rule, so the two always agree. Every call reads the database afresh.

import { createHash, timingSafeEqual } from 'node:crypto'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const API_KEY = process.env.FINANCE_API_KEY
const ALLOWED_IPS = new Set((process.env.FINANCE_API_ALLOWED_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean))
const DOCS_USER = 'finance'
const TIMEZONE = 'Asia/Jerusalem'
const PAGE = 1000
const MAX_RANGE_DAYS = 366
const MAX_FAILURES = 10
const LOCKOUT_MS = 15 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Responses ────────────────────────────────────────────────────────────────

function send(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(body))
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// ── Who is calling ───────────────────────────────────────────────────────────

const digest = value => createHash('sha256').update(value).digest()
const sameSecret = value => Boolean(API_KEY) && value.length > 0 && timingSafeEqual(digest(value), digest(API_KEY))

// nginx sets X-Real-IP; behind it the socket address is always 127.0.0.1.
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

function bearerOk(request) {
  const header = request.headers.authorization || ''
  return header.startsWith('Bearer ') && sameSecret(header.slice(7).trim())
}

function basicOk(request) {
  const header = request.headers.authorization || ''
  if (!header.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
  const split = decoded.indexOf(':')
  return split > 0 && decoded.slice(0, split) === DOCS_USER && sameSecret(decoded.slice(split + 1))
}

// ── Reading the planner ──────────────────────────────────────────────────────

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

const readProfiles = () => readAll('profiles?select=id,name,email,is_active&order=name')
const toWorker = profile => ({ id: profile.id, name: profile.name, email: profile.email, active: profile.is_active })

// ── Periods ──────────────────────────────────────────────────────────────────

const isoDay = date => date.toISOString().slice(0, 10)
const validDay = text => /^\d{4}-\d{2}-\d{2}$/.test(text) && isoDay(new Date(`${text}T00:00:00Z`)) === text

function monthPeriod(month) {
  const [year, number] = month.split('-').map(Number)
  return { from: `${month}-01`, to: isoDay(new Date(Date.UTC(year, number, 0))) }
}

function readPeriod(params) {
  const month = params.get('month')
  const from = params.get('from')
  const to = params.get('to')
  if (month && (from || to)) throw new HttpError(400, 'Send either month, or from and to — not both')
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'month must look like 2026-11')
    return monthPeriod(month)
  }
  if (from || to) {
    if (!from || !to || !validDay(from) || !validDay(to)) throw new HttpError(400, 'from and to must both be dates like 2026-11-01')
    if (from > to) throw new HttpError(400, 'from must not be after to')
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= MAX_RANGE_DAYS) throw new HttpError(400, `A period can be at most ${MAX_RANGE_DAYS} days`)
    return { from, to }
  }
  // Nothing asked for: the last complete month, in Israel time.
  const [year, number] = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }).split('-').map(Number)
  return monthPeriod(new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7))
}

// ── Hours ────────────────────────────────────────────────────────────────────

const round2 = value => Math.round(value * 100) / 100

/** Every active worker, plus anyone else who logged hours in the period. */
async function hoursFor(period, onlyWorkerId) {
  const [profiles, boards, tasks] = await Promise.all([
    readProfiles(),
    readAll('boards?select=id,name&order=id'),
    readAll('tasks?select=id,title,board,time_entries&order=id'),
  ])
  const boardName = new Map(boards.map(board => [board.id, board.name]))
  const profileById = new Map(profiles.map(profile => [profile.id, profile]))

  const workers = new Map()
  const workerFor = (id, fallbackName) => {
    if (!workers.has(id)) {
      const profile = profileById.get(id)
      workers.set(id, {
        ...(profile ? toWorker(profile) : { id, name: fallbackName ?? null, email: null, active: false }),
        minutes: 0,
        days: new Map(),
      })
    }
    return workers.get(id)
  }
  for (const profile of profiles) {
    if (onlyWorkerId ? profile.id === onlyWorkerId : profile.is_active) workerFor(profile.id)
  }

  let unattributedMinutes = 0
  for (const task of tasks) {
    for (const entry of task.time_entries ?? []) {
      if (typeof entry?.date !== 'string' || entry.date < period.from || entry.date > period.to) continue
      const minutes = (Number(entry.hours) || 0) * 60 + (Number(entry.minutes) || 0)
      if (minutes <= 0) continue
      if (!entry.loggedById) { unattributedMinutes += minutes; continue }
      if (onlyWorkerId && entry.loggedById !== onlyWorkerId) continue

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

  const list = [...workers.values()]
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

  return { workers: list, unattributedMinutes }
}

const periodInfo = period => ({ from: period.from, to: period.to, timezone: TIMEZONE, generatedAt: new Date().toISOString() })
const totalOf = workers => round2(workers.reduce((sum, worker) => sum + worker.totalMinutes, 0) / 60)

// ── Endpoints ────────────────────────────────────────────────────────────────

const routes = [
  {
    path: /^\/v1\/workers$/,
    run: async () => ({ workers: (await readProfiles()).map(toWorker) }),
  },
  {
    path: /^\/v1\/work-hours$/,
    run: async params => {
      const period = readPeriod(params)
      const { workers, unattributedMinutes } = await hoursFor(period)
      return { period: periodInfo(period), totalHours: totalOf(workers), unattributedHours: round2(unattributedMinutes / 60), workers }
    },
  },
  {
    path: /^\/v1\/work-hours\/summary$/,
    run: async params => {
      const period = readPeriod(params)
      const { workers, unattributedMinutes } = await hoursFor(period)
      return {
        period: periodInfo(period),
        totalHours: totalOf(workers),
        unattributedHours: round2(unattributedMinutes / 60),
        workers: workers.map(({ days, ...worker }) => ({ ...worker, daysWorked: days.length })),
      }
    },
  },
  {
    path: /^\/v1\/workers\/([^/]+)\/work-hours$/,
    run: async (params, [id]) => {
      if (!UUID.test(id)) throw new HttpError(404, 'No such worker')
      const period = readPeriod(params)
      const { workers } = await hoursFor(period, id)
      if (workers.length === 0) throw new HttpError(404, 'No such worker')
      return { period: periodInfo(period), worker: workers[0] }
    },
  },
]

// ── Swagger ──────────────────────────────────────────────────────────────────

const SWAGGER = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14'
const SWAGGER_CSS_SRI = 'sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn'
const SWAGGER_JS_SRI = 'sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep'
const DOCS_INIT = "SwaggerUIBundle({ url: 'openapi.json', dom_id: '#docs', persistAuthorization: false, displayRequestDuration: true, defaultModelsExpandDepth: 0 })"
const DOCS_CSP = [
  "default-src 'none'",
  `script-src ${SWAGGER}/ 'sha256-${createHash('sha256').update(DOCS_INIT).digest('base64')}'`,
  `style-src ${SWAGGER}/ 'unsafe-inline'`,
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ')
const DOCS_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>DYO Planner · Finance API</title>
<link rel="stylesheet" href="${SWAGGER}/swagger-ui.css" integrity="${SWAGGER_CSS_SRI}" crossorigin="anonymous"></head>
<body style="margin:0"><div id="docs"></div>
<script src="${SWAGGER}/swagger-ui-bundle.js" integrity="${SWAGGER_JS_SRI}" crossorigin="anonymous"></script>
<script>${DOCS_INIT}</script></body></html>`

const errorResponse = description => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } })
const ok = (description, schema) => ({ description, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } })
const COMMON_ERRORS = {
  401: errorResponse('Missing or wrong API key'),
  403: errorResponse('Calling address not allowed'),
  429: errorResponse('Too many wrong keys from this address — wait 15 minutes'),
  500: errorResponse('Something went wrong on the planner\'s side'),
}
const PERIOD_PARAMS = [
  { $ref: '#/components/parameters/month' },
  { $ref: '#/components/parameters/from' },
  { $ref: '#/components/parameters/to' },
]

const OPENAPI = {
  openapi: '3.0.3',
  info: {
    title: 'DYO Planner · Finance API',
    version: '1.0.0',
    description: [
      'Read-only access to the planner\'s workers and the hours they log.',
      '',
      '**Authentication** — every call needs the finance API key: `Authorization: Bearer <key>`. Press **Authorize** above to try calls here.',
      '',
      '**Periods** — give `month` (`2026-11`), or `from` and `to` (`2026-11-01` … `2026-11-30`, at most 366 days). Give neither and you get the last complete month. Days are Israel-time calendar days.',
      '',
      '**Freshness** — every call reads the planner live. Hours can be added, edited or removed after the day they belong to, so a daily sync should re-read the current and the previous month and replace what it holds.',
      '',
      'Hours belong to whoever logged them, on the date of the entry — the same rule as the planner\'s own work report.',
    ].join('\n'),
  },
  servers: [{ url: '/api/finance' }],
  security: [{ apiKey: [] }],
  tags: [
    { name: 'Workers', description: 'The people who log hours' },
    { name: 'Work hours', description: 'Logged hours for a period' },
  ],
  paths: {
    '/v1/workers': {
      get: {
        tags: ['Workers'],
        summary: 'List workers',
        description: 'Everyone with a planner account, including those no longer active.',
        operationId: 'listWorkers',
        responses: { 200: ok('The workers', 'WorkerList'), ...COMMON_ERRORS },
      },
    },
    '/v1/work-hours': {
      get: {
        tags: ['Work hours'],
        summary: 'Hours of every worker, by day and task',
        description: 'Active workers are always listed, with zero hours if they logged none. Someone no longer active appears only if they logged hours in the period.',
        operationId: 'getWorkHours',
        parameters: PERIOD_PARAMS,
        responses: { 200: ok('Hours for the period', 'WorkHours'), 400: errorResponse('Bad period'), ...COMMON_ERRORS },
      },
    },
    '/v1/work-hours/summary': {
      get: {
        tags: ['Work hours'],
        summary: 'Total hours of every worker',
        description: 'The same people and totals as /v1/work-hours, without the day-by-day detail.',
        operationId: 'getWorkHoursSummary',
        parameters: PERIOD_PARAMS,
        responses: { 200: ok('Totals for the period', 'WorkHoursSummary'), 400: errorResponse('Bad period'), ...COMMON_ERRORS },
      },
    },
    '/v1/workers/{workerId}/work-hours': {
      get: {
        tags: ['Work hours'],
        summary: 'Hours of one worker, by day and task',
        operationId: 'getWorkerWorkHours',
        parameters: [
          { name: 'workerId', in: 'path', required: true, description: 'The worker\'s id, from /v1/workers', schema: { type: 'string', format: 'uuid' } },
          ...PERIOD_PARAMS,
        ],
        responses: { 200: ok('Hours for the period', 'WorkerWorkHours'), 400: errorResponse('Bad period'), 404: errorResponse('No such worker'), ...COMMON_ERRORS },
      },
    },
  },
  components: {
    securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'The finance API key' } },
    parameters: {
      month: { name: 'month', in: 'query', required: false, description: 'A calendar month. Not together with from/to.', schema: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', example: '2026-11' } },
      from: { name: 'from', in: 'query', required: false, description: 'First day, inclusive. Needs to.', schema: { type: 'string', format: 'date', example: '2026-11-01' } },
      to: { name: 'to', in: 'query', required: false, description: 'Last day, inclusive. Needs from.', schema: { type: 'string', format: 'date', example: '2026-11-30' } },
    },
    schemas: {
      Worker: {
        type: 'object',
        required: ['id', 'name', 'email', 'active'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string', nullable: true, example: 'Fahad Nakash' },
          email: { type: 'string', nullable: true, example: 'worker@example.com' },
          active: { type: 'boolean', description: 'false once the account is deactivated' },
        },
      },
      WorkerList: {
        type: 'object',
        properties: { workers: { type: 'array', items: { $ref: '#/components/schemas/Worker' } } },
      },
      Period: {
        type: 'object',
        properties: {
          from: { type: 'string', format: 'date', example: '2026-11-01' },
          to: { type: 'string', format: 'date', example: '2026-11-30' },
          timezone: { type: 'string', example: 'Asia/Jerusalem' },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Entry: {
        type: 'object',
        properties: {
          taskId: { type: 'string', format: 'uuid' },
          task: { type: 'string', description: 'Task title' },
          board: { type: 'string', description: 'Board the task is on' },
          hours: { type: 'number', example: 1.25 },
          minutes: { type: 'integer', example: 75 },
          note: { type: 'string', nullable: true },
          fromTimer: { type: 'boolean', description: 'true when the planner\'s timer recorded it, false when typed in by hand' },
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
      WorkerHours: {
        allOf: [
          { $ref: '#/components/schemas/Worker' },
          {
            type: 'object',
            properties: {
              totalHours: { type: 'number', example: 98.4 },
              totalMinutes: { type: 'integer', example: 5904 },
              days: { type: 'array', items: { $ref: '#/components/schemas/Day' } },
            },
          },
        ],
      },
      WorkerTotal: {
        allOf: [
          { $ref: '#/components/schemas/Worker' },
          {
            type: 'object',
            properties: {
              totalHours: { type: 'number', example: 98.4 },
              totalMinutes: { type: 'integer', example: 5904 },
              daysWorked: { type: 'integer', example: 21 },
            },
          },
        ],
      },
      WorkHours: {
        type: 'object',
        properties: {
          period: { $ref: '#/components/schemas/Period' },
          totalHours: { type: 'number' },
          unattributedHours: { type: 'number', description: 'Hours from very old entries with no worker recorded; in no worker\'s total' },
          workers: { type: 'array', items: { $ref: '#/components/schemas/WorkerHours' } },
        },
      },
      WorkHoursSummary: {
        type: 'object',
        properties: {
          period: { $ref: '#/components/schemas/Period' },
          totalHours: { type: 'number' },
          unattributedHours: { type: 'number' },
          workers: { type: 'array', items: { $ref: '#/components/schemas/WorkerTotal' } },
        },
      },
      WorkerWorkHours: {
        type: 'object',
        properties: {
          period: { $ref: '#/components/schemas/Period' },
          worker: { $ref: '#/components/schemas/WorkerHours' },
        },
      },
      Error: { type: 'object', properties: { error: { type: 'string' } } },
    },
  },
}

// ── Entry point ──────────────────────────────────────────────────────────────

/** Everything under /finance/ — reached only through nginx's /api/finance/. */
export async function handleFinance(request, response) {
  if (request.headers['x-planner-route'] !== 'finance') return send(response, 404, { error: 'Not found' })
  const url = new URL(request.url, 'http://local')
  const path = url.pathname.replace(/^\/finance/, '').replace(/\/+$/, '') || '/'
  const ip = clientIp(request)

  if (request.method !== 'GET') return send(response, 405, { error: 'Only GET is supported' }, { allow: 'GET' })
  if (ALLOWED_IPS.size > 0 && !ALLOWED_IPS.has(ip)) {
    console.warn(`Finance API: refused ${ip} (address not allowed)`)
    return send(response, 403, { error: 'Forbidden' })
  }
  if (lockedOut(ip)) return send(response, 429, { error: 'Too many failed attempts' }, { 'retry-after': String(LOCKOUT_MS / 1000) })

  if (path === '/docs' || path === '/openapi.json') {
    if (!basicOk(request)) {
      if (request.headers.authorization) recordFailure(ip)
      return send(response, 401, { error: 'Unauthorized' }, { 'www-authenticate': 'Basic realm="DYO Planner Finance API", charset="UTF-8"' })
    }
    if (path === '/openapi.json') return send(response, 200, OPENAPI)
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': DOCS_CSP,
    })
    return response.end(DOCS_PAGE)
  }

  const route = routes.find(candidate => candidate.path.test(path))
  if (!route) return send(response, 404, { error: 'Not found' })
  if (!bearerOk(request)) {
    recordFailure(ip)
    console.warn(`Finance API: wrong or missing key from ${ip}`)
    return send(response, 401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' })
  }

  try {
    const body = await route.run(url.searchParams, route.path.exec(path).slice(1))
    console.log(`Finance API: ${ip} ${path}${url.search}`)
    return send(response, 200, body)
  } catch (error) {
    if (error instanceof HttpError) return send(response, error.status, { error: error.message })
    console.error(`Finance API failed on ${path}: ${error.message}`)
    return send(response, 500, { error: 'Something went wrong' })
  }
}
