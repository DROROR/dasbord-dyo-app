// The page behind the unsubscribe link at the bottom of every follow-up email.
//
// It is public on purpose — the person clicking it has no account — so it
// trusts nothing but the link itself: the address travels with a signature
// only this server can produce, and anything else gets a polite refusal.
//
// Opening the link only ASKS. Mail scanners and link previews open every link
// in an email, and an unsubscribe that happened on a mere visit would remove
// people who never asked. The address is recorded on the button press (POST),
// which is also what a mail app's own one-click "Unsubscribe" sends.

import { readUnsubscribeLink } from './lead-emails.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const escapeHtml = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))

function page(title, inner) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f5f9;color:#1b2440;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}main{background:#fff;border:1px solid #dfe3ee;border-radius:14px;max-width:440px;width:100%;padding:28px;text-align:center}h1{font-size:20px;margin:0 0 10px}p{margin:6px 0;line-height:1.6;color:#4b5563;font-size:15px}.en{direction:ltr;font-size:13px;color:#6b7280}button{margin-top:18px;font:inherit;font-weight:700;border:0;border-radius:10px;background:#1f2f6b;color:#fff;padding:12px 22px;cursor:pointer}code{direction:ltr;unicode-bidi:embed;font-size:14px}</style></head><body><main>${inner}</main></body></html>`
}

function send(response, status, html) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(html)
}

export async function handleUnsubscribe(request, response) {
  const url = new URL(request.url, 'http://local')
  const address = readUnsubscribeLink(url.searchParams.get('e'), url.searchParams.get('s'))
  if (!address) {
    return send(response, 400, page('קישור לא תקין', '<h1>הקישור אינו תקין</h1><p>לא ניתן לזהות את הכתובת מהקישור הזה.</p><p class="en">This unsubscribe link is not valid.</p>'))
  }

  if (request.method === 'GET') {
    return send(response, 200, page('הסרה מרשימת התפוצה', `<h1>הסרה מרשימת התפוצה</h1><p>להפסיק לשלוח מיילים אל <code>${escapeHtml(address)}</code>?</p><p class="en">Stop sending emails to this address?</p><form method="post"><button type="submit">כן, הסירו אותי · Unsubscribe</button></form>`))
  }

  if (request.method !== 'POST') return send(response, 405, page('—', '<h1>—</h1>'))
  request.resume() // a mail app's one-click request carries a small body nobody needs

  try {
    const saved = await fetch(`${SUPABASE_URL}/rest/v1/lead_email_unsubscribes?on_conflict=email`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({ email: address }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!saved.ok) throw new Error(`${saved.status} ${await saved.text()}`)
  } catch (error) {
    console.error(`Unsubscribe could not be saved: ${error.message}`)
    return send(response, 502, page('שגיאה', '<h1>משהו השתבש</h1><p>לא הצלחנו לשמור את הבקשה. נסו שוב בעוד כמה דקות.</p><p class="en">We could not save your request. Please try again in a few minutes.</p>'))
  }
  return send(response, 200, page('הוסרת', '<h1>הוסרת מרשימת התפוצה</h1><p>לא יישלחו אליך מיילים נוספים.</p><p class="en">You have been unsubscribed. No further emails will be sent.</p>'))
}
