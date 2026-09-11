import http from 'node:http'
import { createHash, createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const HOST = '127.0.0.1'
const PORT = Number(process.env.GOOGLE_SHEETS_SYNC_PORT || 3003)
const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SHEET_ID = process.env.GOOGLE_SHEET_ID
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB_NAME
const CREDENTIALS_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE
const CREDENTIALS_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
const SYNC_INTERVAL_MS = Number(process.env.GOOGLE_SHEET_SYNC_INTERVAL_MS || 300_000)
const REQUIRED_HEADERS = ['id', 'created_time', 'מה_מתאר_אותך_הכי_טוב_כרגע', 'email', 'full_name', 'phone_number']
let syncPromise = null
let lastSync = null

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(JSON.stringify(body))
}

function configured() {
  return Boolean(SUPABASE_URL && SERVICE_KEY && SHEET_ID && SHEET_TAB && (CREDENTIALS_FILE || CREDENTIALS_JSON))
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

async function credentials() {
  const raw = CREDENTIALS_JSON || await readFile(CREDENTIALS_FILE, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed.client_email || !parsed.private_key) throw new Error('Invalid Google service-account credentials')
  return parsed
}

async function googleAccessToken() {
  const account = await credentials()
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Google authentication failed (${response.status})`)
  return (await response.json()).access_token
}

const adminHeaders = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' })

async function authorize(request) {
  const authorization = request.headers.authorization || ''
  if (!authorization.startsWith('Bearer ')) return false
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, authorization } })
  if (!userResponse.ok) return false
  const user = await userResponse.json()
  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_owner,is_active,permissions`, { headers: adminHeaders() })
  if (!profileResponse.ok) return false
  const profile = (await profileResponse.json())[0]
  if (!profile || profile.is_active === false) return false
  return profile.is_owner === true || profile.permissions?.leads === 'full'
}

function parseCreatedTime(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function sourceFor(platform) {
  const value = String(platform || '').toLowerCase()
  if (value.includes('instagram')) return 'instagram'
  if (value.includes('facebook') || value.includes('fb')) return 'facebook'
  return null
}

async function syncSheet() {
  const token = await googleAccessToken()
  const range = encodeURIComponent(`${SHEET_TAB}!A:Q`)
  const sheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SHEET_ID)}/values/${range}?majorDimension=ROWS`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  })
  if (!sheetResponse.ok) throw new Error(`Google Sheets read failed (${sheetResponse.status})`)
  const rows = (await sheetResponse.json()).values || []
  if (!rows.length) return { created: 0, existing: 0, skipped: 0, total: 0 }
  const headers = rows[0].map(value => String(value).trim())
  const missing = REQUIRED_HEADERS.filter(header => !headers.includes(header))
  if (missing.length) throw new Error(`Missing sheet headers: ${missing.join(', ')}`)
  const index = Object.fromEntries(headers.map((header, position) => [header, position]))

  const statusResponse = await fetch(`${SUPABASE_URL}/rest/v1/lead_pipeline_statuses?legacy_status=eq.new&select=id&limit=1`, { headers: adminHeaders() })
  if (!statusResponse.ok) throw new Error('Could not load the New Lead pipeline status')
  const newStatusId = (await statusResponse.json())[0]?.id
  if (!newStatusId) throw new Error('New Lead pipeline status is missing')

  let skipped = 0
  const leads = rows.slice(1).flatMap((row, offset) => {
    const get = header => String(row[index[header]] ?? '').trim()
    const name = get('full_name')
    const phone = get('phone_number')
    if (!name || !phone) { skipped += 1; return [] }
    const externalId = get('id') || createHash('sha256').update(`${get('created_time')}|${get('email')}|${phone}|${offset + 2}`).digest('hex')
    return [{
      sheet_row_key: `google:${SHEET_ID}:${externalId}`,
      name,
      phone,
      email: get('email') || null,
      form_answer: get('מה_מתאר_אותך_הכי_טוב_כרגע') || null,
      source: sourceFor(get('platform')),
      status: 'new',
      pipeline_status_id: newStatusId,
      created_at: parseCreatedTime(get('created_time')),
    }]
  })

  const existingResponse = await fetch(`${SUPABASE_URL}/rest/v1/leads?sheet_row_key=not.is.null&select=sheet_row_key`, { headers: adminHeaders() })
  if (!existingResponse.ok) throw new Error('Could not check existing imported leads')
  const existing = new Set((await existingResponse.json()).map(row => row.sheet_row_key))
  const created = leads.filter(lead => !existing.has(lead.sheet_row_key)).length
  const existingCount = leads.length - created
  if (leads.length) {
    const upsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/leads?on_conflict=sheet_row_key`, {
      method: 'POST', headers: { ...adminHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(leads),
    })
    if (!upsertResponse.ok) throw new Error(`Supabase lead sync failed (${upsertResponse.status})`)
  }
  return { created, existing: existingCount, skipped, total: leads.length }
}

async function runSync() {
  if (syncPromise) return syncPromise
  syncPromise = syncSheet()
    .then(result => { lastSync = { at: new Date().toISOString(), ok: true, result }; return result })
    .catch(error => { lastSync = { at: new Date().toISOString(), ok: false, error: error instanceof Error ? error.message : 'Unknown error' }; throw error })
    .finally(() => { syncPromise = null })
  return syncPromise
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { status: 'ok', configured: configured(), lastSync })
  if (request.method !== 'POST' || request.url !== '/sync') return sendJson(response, 404, { error: 'Not found' })
  if (!configured()) return sendJson(response, 503, { error: 'Google Sheets sync is not configured yet' })
  try {
    if (!await authorize(request)) return sendJson(response, 403, { error: 'Full Leads permission is required' })
    return sendJson(response, 200, await runSync())
  } catch (error) {
    console.error('Google Sheets sync failed:', error instanceof Error ? error.message : 'Unknown error')
    return sendJson(response, 502, { error: error instanceof Error ? error.message : 'Google Sheets sync failed' })
  }
})

server.requestTimeout = 65_000
server.headersTimeout = 10_000
server.listen(PORT, HOST, () => {
  console.log(`Google Sheets sync listening on http://${HOST}:${PORT}`)
  if (configured()) {
    const scheduled = () => runSync().catch(error => console.error('Scheduled Google Sheets sync failed:', error instanceof Error ? error.message : 'Unknown error'))
    void scheduled()
    setInterval(scheduled, Math.max(SYNC_INTERVAL_MS, 60_000))
  }
})
