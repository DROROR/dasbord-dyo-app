const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RESEND_KEY = process.env.RESEND_API_KEY
const FROM = process.env.TASK_EMAIL_FROM
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://planner.dyocourses.com'
const POLL_MS = 15_000

if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY || !FROM) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY and TASK_EMAIL_FROM are required')
  process.exit(1)
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

async function patch(id, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/task_email_outbox?id=eq.${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Outbox update failed (${response.status})`)
}

async function run() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/task_email_outbox?status=in.(queued,failed)&attempts=lt.5&order=created_at.asc&limit=10`, { headers })
  if (!response.ok) throw new Error(`Outbox read failed (${response.status})`)
  for (const item of await response.json()) {
    try {
      await patch(item.id, { status: 'processing', attempts: item.attempts + 1, last_error: null })
      const sent = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: FROM, to: [item.recipient_email], subject: item.subject, html: `<p>${escapeHtml(item.message)}</p><p><a href="${escapeHtml(DASHBOARD_URL)}">Open Dyo Planner</a></p>` }) })
      if (!sent.ok) throw new Error(`Email provider returned ${sent.status}`)
      await patch(item.id, { status: 'sent', sent_at: new Date().toISOString() })
    } catch (error) {
      await patch(item.id, { status: 'failed', last_error: error instanceof Error ? error.message : 'Unknown error' }).catch(() => {})
    }
  }
}

setInterval(() => run().catch(error => console.error(error.message)), POLL_MS)
void run().catch(error => console.error(error.message))
