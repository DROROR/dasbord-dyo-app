// Follow-up emails for leads on the unresponsive-leads chain.
//
// The marketing side writes the emails (day, subject, text) in the planner;
// this sends each one, once, to every lead whose day has come, from the
// client's own sales mailbox. It is called by lead-sequence-worker.mjs on
// every tick and is deliberately separate from the WhatsApp half: an email
// does not wait for a phone call to be confirmed.
//
// What keeps it from doing damage:
//
//  1. Nothing is sent until an email exists that is switched on and has both
//     a subject and a text. With no such row this file does nothing at all.
//  2. A lead gets a given email at most once: the log row is written BEFORE
//     the email, and the table allows one row per lead per email.
//  3. An email whose day passed more than three days ago is written off, not
//     sent late — so switching the emails on does not flood every lead that
//     has been on the chain for weeks.
//  4. One email per lead per run, and none within 20 hours of the last.
//  5. An address that unsubscribed is never written to again.

import net from 'node:net'
import tls from 'node:tls'
import dns from 'node:dns/promises'
import crypto from 'node:crypto'

const DAY_MS = 86_400_000
const LATE_LIMIT_MS = 3 * DAY_MS
const MIN_GAP_MS = 20 * 60 * 60 * 1000
const MAX_PER_RUN = 30

const MAIL_USER = (process.env.SALES_MAIL_USER ?? '').trim()
const MAIL_PASS = process.env.SALES_MAIL_PASSWORD ?? ''
// The name the server's certificate is issued for.
const MAIL_NAME = (process.env.SALES_MAIL_HOST ?? '').trim()
// Where to actually connect. The public hostname sits behind a web proxy that
// does not carry mail, so unless told otherwise the domain's own MX is used.
const MAIL_CONNECT = (process.env.SALES_MAIL_CONNECT_HOST ?? '').trim()
const FROM_NAME = (process.env.SALES_MAIL_FROM_NAME ?? 'CommuniTree').trim()
const PUBLIC_URL = (process.env.LEAD_EMAIL_PUBLIC_URL ?? 'https://planner.dyocourses.com').replace(/\/+$/, '')
const SIGNING_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const NO_ANSWER_SEQUENCE_KEYS = ['no_answer', 'noanswer']
// The same columns the WhatsApp chain may run in. Anywhere else — a meeting
// is booked, the lead is a customer, it was archived — a person has taken over.
const CHAIN_LEGACY_STATUSES = ['new', 'followup']
const CHAIN_LABELS = ['no answer', 'no-answer', 'אין מענה', 'ללא מענה']

export const mailConfigured = () => Boolean(MAIL_USER && MAIL_PASS && MAIL_NAME)

// ── Unsubscribe links ────────────────────────────────────────────────────────

const b64url = text => Buffer.from(text, 'utf8').toString('base64url')

/** Proof that an unsubscribe link was made by us for this address. */
export function unsubscribeSignature(email) {
  return crypto.createHmac('sha256', SIGNING_KEY).update(`lead-email-unsubscribe:${String(email).trim().toLowerCase()}`).digest('hex').slice(0, 32)
}

export function unsubscribeUrl(email) {
  const address = String(email).trim().toLowerCase()
  return `${PUBLIC_URL}/api/claude/unsubscribe?e=${b64url(address)}&s=${unsubscribeSignature(address)}`
}

/** The address a link is for, or null when the link was not made by us. */
export function readUnsubscribeLink(e, s) {
  try {
    const address = Buffer.from(String(e ?? ''), 'base64url').toString('utf8').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return null
    const expected = Buffer.from(unsubscribeSignature(address))
    const given = Buffer.from(String(s ?? ''))
    return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? address : null
  } catch {
    return null
  }
}

// ── Building the message ─────────────────────────────────────────────────────

const escapeHtml = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const hasHebrew = text => /[֐-׿]/.test(text)

function fill(text, lead) {
  const name = (lead.name ?? '').trim()
  return String(text)
    .replace(/\{\{\s*שם\s*\}\}/g, name)
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*שם פרטי\s*\}\}/g, name)
}

/** A header value in UTF-8, split so that no encoded word runs past the limit. */
function encodeHeader(text) {
  if (/^[\x20-\x7e]*$/.test(text)) return text
  const words = []
  let chunk = ''
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 39) { words.push(chunk); chunk = '' }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words.map(word => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join('\r\n ')
}

const base64Lines = text => Buffer.from(text, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')

export function buildMessage({ to, subject, body, lead }) {
  const link = unsubscribeUrl(to)
  const text = fill(body, lead)
  const rtl = hasHebrew(text)
  const placed = /\{\{\s*(הסרה|unsubscribe)\s*\}\}/i
  const footer = rtl ? 'להסרה מרשימת התפוצה' : 'Unsubscribe from these emails'
  const plain = placed.test(text) ? text.replace(placed, link) : `${text}\n\n—\n${footer}: ${link}`
  const anchor = `<a href="${escapeHtml(link)}" style="color:#6b7280">${escapeHtml(footer)}</a>`
  const htmlBody = escapeHtml(text).replace(/\r?\n/g, '<br>')
  const html = `<div dir="${rtl ? 'rtl' : 'ltr'}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827">`
    + (placed.test(text) ? htmlBody.replace(/\{\{\s*(הסרה|unsubscribe)\s*\}\}/i, anchor) : `${htmlBody}<p style="margin-top:28px;font-size:12px;color:#6b7280">${anchor}</p>`)
    + '</div>'
  const boundary = `b-${crypto.randomUUID()}`
  const domain = MAIL_USER.split('@')[1] ?? 'localhost'
  return [
    `From: ${encodeHeader(FROM_NAME)} <${MAIL_USER}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(fill(subject, lead).replace(/[\r\n]+/g, ' ').trim())}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `List-Unsubscribe: <${link}>`,
    'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(plain),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html),
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

// ── A small SMTP client ──────────────────────────────────────────────────────
//
// It talks on the submission port (587) and switches to TLS with STARTTLS
// before anything private is said. Port 465 would be one step shorter, but
// hosting companies commonly block it outbound — the server this runs on
// does — while 587 is the port meant for exactly this. Setting
// SALES_MAIL_SMTPS_PORT brings back TLS-from-the-first-byte on that port.

/** Opens an authenticated session with the sales mailbox's own server. */
export async function openMailbox() {
  let host = MAIL_CONNECT
  if (!host) {
    const records = await dns.resolveMx(MAIL_USER.split('@')[1])
    host = records.sort((a, b) => a.priority - b.priority)[0]?.exchange
    if (!host) throw new Error('the mail domain has no MX record')
  }
  const implicitPort = Number(process.env.SALES_MAIL_SMTPS_PORT ?? 0)
  const submissionPort = Number(process.env.SALES_MAIL_SMTP_PORT ?? 587)
  let socket = implicitPort
    ? tls.connect({ host, port: implicitPort, servername: MAIL_NAME })
    : net.connect({ host, port: submissionPort })

  let buffer = ''
  let waiting = null
  let failure = null
  const flush = () => {
    if (!waiting) return
    if (failure) { const { reject } = waiting; waiting = null; reject(failure); return }
    // A reply is complete at the first line whose code is followed by a space.
    const lines = buffer.split('\r\n')
    for (let i = 0; i < lines.length - 1; i += 1) {
      if (/^\d{3} /.test(lines[i])) {
        const reply = lines.slice(0, i + 1).join('\n')
        buffer = lines.slice(i + 1).join('\r\n')
        const { resolve } = waiting
        waiting = null
        resolve({ code: Number(lines[i].slice(0, 3)), text: reply })
        return
      }
    }
  }
  const listen = () => {
    socket.setTimeout(30_000, () => socket.destroy(new Error('the mail server stopped answering')))
    socket.on('data', chunk => { buffer += chunk.toString('utf8'); flush() })
    socket.on('error', error => { failure = error; flush() })
    socket.on('close', () => { failure ??= new Error('the mail server closed the connection'); flush() })
  }
  listen()
  const reply = () => new Promise((resolve, reject) => { waiting = { resolve, reject }; flush() })
  const command = async (line, expected, what) => {
    socket.write(`${line}\r\n`)
    const answer = await reply()
    if (!expected.includes(answer.code)) throw new Error(`${what}: ${answer.text.slice(0, 200)}`)
    return answer
  }

  try {
    const greeting = await reply()
    if (greeting.code !== 220) throw new Error(`greeting: ${greeting.text.slice(0, 200)}`)
    await command('EHLO planner.dyocourses.com', [250], 'hello')
    if (!implicitPort) {
      await command('STARTTLS', [220], 'starting TLS')
      // The plain connection hands over to an encrypted one. Its listeners
      // come off first, so nothing it says or does is mistaken for the new one.
      const plain = socket
      plain.removeAllListeners('data')
      plain.removeAllListeners('error')
      plain.removeAllListeners('close')
      plain.removeAllListeners('timeout')
      plain.setTimeout(0)
      buffer = ''
      socket = await new Promise((resolve, reject) => {
        // The certificate is checked against the mailbox's own name, exactly
        // as on the direct port: a server that cannot prove who it is never
        // gets the password.
        const secure = tls.connect({ socket: plain, servername: MAIL_NAME })
        secure.once('secureConnect', () => { secure.removeListener('error', reject); resolve(secure) })
        secure.once('error', reject)
      })
      listen()
      await command('EHLO planner.dyocourses.com', [250], 'hello over TLS')
    }
    await command('AUTH LOGIN', [334], 'sign-in')
    await command(Buffer.from(MAIL_USER).toString('base64'), [334], 'sign-in')
    await command(Buffer.from(MAIL_PASS).toString('base64'), [235], 'sign-in')
  } catch (error) {
    socket.destroy()
    throw error
  }

  return {
    async send(to, message) {
      await command(`MAIL FROM:<${MAIL_USER}>`, [250], 'sender')
      try {
        await command(`RCPT TO:<${to}>`, [250, 251], 'recipient')
      } catch (error) {
        await command('RSET', [250], 'reset').catch(() => {})
        throw error
      }
      await command('DATA', [354], 'data')
      // Every body line is base64 and no header starts with a dot, so there
      // is nothing here for dot-stuffing to do.
      await command(`${message}\r\n.`, [250], 'delivery')
    },
    async close() {
      await command('QUIT', [221], 'goodbye').catch(() => {})
      socket.destroy()
    },
  }
}

// ── The run ──────────────────────────────────────────────────────────────────

const validEmail = address => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) && address.length <= 254

function columnAllowsChain(column) {
  if (!column) return true
  if (column.is_archived) return false
  if (CHAIN_LEGACY_STATUSES.includes(String(column.legacy_status ?? ''))) return true
  const names = [String(column.label_en ?? '').trim().toLowerCase(), String(column.label_he ?? '').trim().toLowerCase()]
  return names.some(name => CHAIN_LABELS.includes(name))
}

const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/**
 * Sends whatever is due. `rest` is the worker's own PostgREST helper;
 * `open` and `now` exist so the whole run can be exercised without a mailbox.
 */
export async function runLeadEmails({ rest, open = openMailbox, now = Date.now(), log = console.log }) {
  let steps
  try {
    steps = await rest('lead_email_steps?is_active=eq.true&select=id,day,subject,body&order=day.asc')
  } catch {
    return { sent: 0, skipped: 0, failed: 0 } // the tables are not there yet
  }
  steps = steps.filter(step => String(step.subject ?? '').trim() && String(step.body ?? '').trim())
  const totals = { sent: 0, skipped: 0, failed: 0 }
  if (steps.length === 0 || !mailConfigured()) return totals

  const sequences = await rest('sequences?select=id,seq_key,is_active')
  const chain = sequences.find(sequence => sequence.is_active && NO_ANSWER_SEQUENCE_KEYS.includes(String(sequence.seq_key ?? '').trim().toLowerCase()))
  if (!chain) return totals

  // A chain that has finished its WhatsApp messages ('done') still owes its
  // later emails. One that was paused or stopped owes nothing.
  const progress = await rest(`lead_sequence_progress?sequence_id=eq.${chain.id}&status=in.(active,done)&select=lead_id,started_at&limit=2000`)
  if (progress.length === 0) return totals

  const [columns, unsubscribed] = await Promise.all([
    rest('lead_pipeline_statuses?select=id,label_he,label_en,legacy_status,is_archived'),
    rest('lead_email_unsubscribes?select=email&limit=10000'),
  ])
  const gone = new Set(unsubscribed.map(row => row.email))
  const leads = new Map()
  const logged = new Map()
  for (const ids of chunks(progress.map(row => row.lead_id), 80)) {
    const [people, rows] = await Promise.all([
      rest(`leads?id=in.(${ids.join(',')})&select=id,name,email,pipeline_status_id`),
      rest(`lead_email_log?lead_id=in.(${ids.join(',')})&select=lead_id,step_id,status,sent_at&limit=5000`),
    ])
    for (const person of people) leads.set(person.id, person)
    for (const row of rows) logged.set(row.lead_id, [...(logged.get(row.lead_id) ?? []), row])
  }

  // Decide first, connect second: no mailbox is opened on the many runs where
  // nothing is due.
  const due = []
  for (const row of progress) {
    const lead = leads.get(row.lead_id)
    const address = String(lead?.email ?? '').trim().toLowerCase()
    if (!lead || !validEmail(address) || gone.has(address)) continue
    if (!columnAllowsChain(columns.find(column => column.id === lead.pipeline_status_id))) continue
    const history = logged.get(lead.id) ?? []
    const lastSent = Math.max(0, ...history.filter(item => item.status === 'sent').map(item => new Date(item.sent_at).getTime()))
    const started = new Date(row.started_at).getTime()
    for (const step of steps) {
      if (history.some(item => item.step_id === step.id)) continue
      const dueAt = started + step.day * DAY_MS
      if (now < dueAt) break
      due.push({ lead, address, step, late: now - dueAt > LATE_LIMIT_MS, tooSoon: now - lastSent < MIN_GAP_MS })
      if (now - dueAt <= LATE_LIMIT_MS) break // one real email per lead per run
    }
  }

  const claim = async (item, status) => {
    try {
      await rest('lead_email_log', {
        method: 'POST',
        body: JSON.stringify({ lead_id: item.lead.id, step_id: item.step.id, email: item.address, status, sent_at: new Date(now).toISOString() }),
      })
      return true
    } catch {
      return false // already claimed, here or by another copy of the worker
    }
  }

  let mailbox = null
  try {
    for (const item of due) {
      if (item.late) { if (await claim(item, 'skipped')) totals.skipped += 1; continue }
      if (item.tooSoon) continue
      if (totals.sent + totals.failed >= MAX_PER_RUN) break
      // Connected before anything is claimed: a mailbox that cannot be
      // reached costs no lead their email, the run simply ends.
      mailbox ??= await open()
      if (!(await claim(item, 'sent'))) continue
      try {
        await mailbox.send(item.address, buildMessage({ to: item.address, subject: item.step.subject, body: item.step.body, lead: item.lead }))
        totals.sent += 1
        log(`[lead-email] day ${item.step.day} sent to ${item.lead.name}`)
      } catch (error) {
        totals.failed += 1
        await rest(`lead_email_log?lead_id=eq.${item.lead.id}&step_id=eq.${item.step.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'failed', error: String(error.message ?? error).slice(0, 300) }),
        }).catch(() => {})
        console.error(`[lead-email] day ${item.step.day} failed for ${item.lead.name}: ${error.message}`)
      }
    }
  } finally {
    await mailbox?.close()
  }
  return totals
}
