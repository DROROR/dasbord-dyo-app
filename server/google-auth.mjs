import { createSign } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const tokens = new Map()

async function credentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || await readFile(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed.client_email || !parsed.private_key) throw new Error('Invalid Google service-account credentials')
  return parsed
}

export function googleCredentialsConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_FILE || process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
}

export async function googleAccessToken(scope) {
  const cached = tokens.get(scope)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  const account = await credentials()
  const now = Math.floor(Date.now() / 1000)
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signer.sign(account.private_key, 'base64url')}` }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Google authentication failed (${response.status})`)
  const body = await response.json()
  tokens.set(scope, { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 })
  return body.access_token
}
