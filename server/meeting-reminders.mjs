// Two jobs, one small worker.
//
// 1. Fills the calendar from the weekly rules: "every Monday 17:00 Pakistan
//    time" becomes real meeting rows, a fortnight ahead. The rule holds a wall
//    clock plus its zone, so 17:00 in Karachi stays 17:00 in Karachi when
//    Israel or Ukraine change their clocks.
//
// 2. Posts team meetings to Slack: once when the meeting is set, again at the
//    first warning (5 minutes before by default), and a last call (1 minute
//    before). Every post carries the Google Meet link as a button and the same
//    time in Israel, Pakistan and Ukraine.
//
// This runs on the server, not in the browser, so the warning still arrives
// when nobody has the planner open. The three meetings.slack_*_sent_at stamps
// are claimed before the post goes out — a restart, or a second copy of this
// worker, therefore cannot double-post the same meeting.

const SUPABASE_URL  = process.env.SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const SLACK_WEBHOOK = process.env.SLACK_MEETINGS_WEBHOOK_URL
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://planner.dyocourses.com'
// Who gets pinged on the two warnings. '' turns the ping off entirely.
const SLACK_PING    = process.env.SLACK_MEETINGS_PING ?? '<!channel>'
const POLL_MS       = 20_000

if (!SUPABASE_URL || !SERVICE_KEY || !SLACK_WEBHOOK) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SLACK_MEETINGS_WEBHOOK_URL are required')
  process.exit(1)
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' }

// How far ahead the weekly rules are turned into real meetings.
const HORIZON_DAYS = 14

const ZONES = [
  { zone: 'Asia/Jerusalem', label: 'Israel',   flag: '🇮🇱' },
  { zone: 'Asia/Karachi',   label: 'Pakistan', flag: '🇵🇰' },
  { zone: 'Europe/Kyiv',    label: 'Ukraine',  flag: '🇺🇦' },
]

const dayIn  = (iso, zone) => new Date(iso).toLocaleDateString('en-GB', { timeZone: zone, weekday: 'short', day: '2-digit', month: 'short' })
const timeIn = (iso, zone) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// ── Turning the weekly rules into meetings ─────────────────────────────────────

const zoneParts = new Map()

function zoneFormatter(zone) {
  let fmt = zoneParts.get(zone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    zoneParts.set(zone, fmt)
  }
  return fmt
}

/** How far ahead of UTC `zone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant, zone) {
  const parts = zoneFormatter(zone).formatToParts(new Date(instant))
  const get = type => Number(parts.find(p => p.type === type)?.value ?? '0')
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - instant
}

/**
 * A wall clock read in `zone`, turned into a real instant. The second pass is
 * for the twice-a-year clock change: the offset depends on the instant we are
 * still solving for, so the first guess can land on the wrong side of it.
 * Mirrors zonedLocalToIso() in src/lib/meetings.ts — same arithmetic, so the
 * preview the planner draws and the row this worker writes always agree.
 */
function zonedLocalToIso(local, zone) {
  const naive = Date.parse(`${local}:00Z`)
  let instant = naive - zoneOffsetMs(naive, zone)
  instant = naive - zoneOffsetMs(instant, zone)
  return new Date(instant).toISOString()
}

/** The calendar date and weekday a given instant falls on, in `zone`. */
function dateInZone(instant, zone) {
  const parts = zoneFormatter(zone).formatToParts(new Date(instant))
  const get = type => parts.find(p => p.type === type)?.value ?? '00'
  const date = `${get('year')}-${get('month')}-${get('day')}`
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return { date, weekday }
}

async function materializeSchedules() {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/meeting_schedules?active=is.true`, { headers })
  if (!response.ok) throw new Error(`Schedules read failed (${response.status})`)
  const schedules = await response.json()
  if (!schedules.length) return

  const now = Date.now()
  for (const schedule of schedules) {
    const hhmm = String(schedule.local_time).slice(0, 5)
    const wanted = []
    for (let ahead = 0; ahead <= HORIZON_DAYS; ahead++) {
      const { date, weekday } = dateInZone(now + ahead * 86_400_000, schedule.timezone)
      if (weekday !== schedule.weekday) continue
      const startsAt = zonedLocalToIso(`${date}T${hhmm}`, schedule.timezone)
      // Never create one in the past — a rule added on Monday afternoon starts
      // from next Monday, not from this morning.
      if (new Date(startsAt).getTime() <= now) continue
      wanted.push({ date, startsAt })
    }
    if (!wanted.length) continue

    // Which of those days already have a row — including ones somebody edited
    // or cancelled by hand, which must never be recreated behind their back.
    const from = wanted[0].date
    const held = await fetch(
      `${SUPABASE_URL}/rest/v1/meetings?schedule_id=eq.${schedule.id}&occurrence_date=gte.${from}&select=occurrence_date`,
      { headers },
    )
    if (!held.ok) throw new Error(`Occurrence read failed (${held.status})`)
    const existing = new Set((await held.json()).map(row => row.occurrence_date))

    const rows = wanted.filter(w => !existing.has(w.date)).map(w => ({
      title: schedule.title,
      starts_at: w.startsAt,
      duration_minutes: schedule.duration_minutes,
      meet_link: schedule.meet_link,
      notes: schedule.notes,
      remind_minutes: schedule.remind_minutes,
      final_remind_minutes: schedule.final_remind_minutes,
      input_timezone: schedule.timezone,
      schedule_id: schedule.id,
      occurrence_date: w.date,
      created_by: schedule.created_by,
    }))
    if (!rows.length) continue

    const created = await fetch(`${SUPABASE_URL}/rest/v1/meetings`, {
      method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(rows),
    })
    if (!created.ok) {
      console.error(`schedule ${schedule.id}: insert failed (${created.status}) ${await created.text()}`)
      continue
    }
    console.log(`schedule ${schedule.id}: created ${rows.length} meeting(s)`)
  }
}

// ── Slack ──────────────────────────────────────────────────────────────────────

/** Slack escapes only these three — the link stays clickable, the text stays honest. */
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function headline(meeting, kind) {
  if (kind === 'created')  return `📅  New meeting — ${meeting.title}`
  if (kind === 'reminder') return `⏰  ${meeting.title} starts in ${meeting.remind_minutes} minutes`
  return `🔴  Last call — ${meeting.title} starts in ${meeting.final_remind_minutes} minute${meeting.final_remind_minutes === 1 ? '' : 's'}`
}

function slackMessage(meeting, kind) {
  const title = headline(meeting, kind)
  const clocks = ZONES
    .map(z => `${z.flag}  *${z.label}*\n${timeIn(meeting.starts_at, z.zone)}  ·  ${dayIn(meeting.starts_at, z.zone)}`)
    .join('\n\n')
  const ping = kind === 'created' || !SLACK_PING ? '' : `${SLACK_PING} `
  const lead = kind === 'created'
    ? 'A team meeting has been scheduled. The time below is the same moment everywhere — each line is your own clock.'
    : 'Join on time, please — the link is the same for everyone.'

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: title.slice(0, 150), emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `${ping}${lead}` } },
    { type: 'section', fields: ZONES.map(z => ({
      type: 'mrkdwn',
      text: `${z.flag}  *${z.label}*\n${timeIn(meeting.starts_at, z.zone)}  ·  ${dayIn(meeting.starts_at, z.zone)}`,
    })) },
    { type: 'section', text: { type: 'mrkdwn', text: `⏱  *Duration:* ${meeting.duration_minutes} minutes` } },
  ]
  if (meeting.notes) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `📝  ${esc(meeting.notes).slice(0, 2500)}` } })
  }
  blocks.push({
    type: 'actions',
    elements: [
      { type: 'button', style: 'primary', text: { type: 'plain_text', text: '🎥  Join Google Meet', emoji: true }, url: meeting.meet_link },
      { type: 'button', text: { type: 'plain_text', text: 'Open the planner', emoji: true }, url: DASHBOARD_URL },
    ],
  })
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `<${meeting.meet_link}|${esc(meeting.meet_link.replace(/^https?:\/\//, ''))}>` }] })

  // `text` is the notification line and the fallback wherever blocks do not
  // render (phone banners, email digests), so it carries the link too.
  return {
    text: `${ping}${title} — ${ZONES.map(z => `${z.label} ${timeIn(meeting.starts_at, z.zone)}`).join(' · ')} — ${meeting.meet_link}`,
    blocks,
  }
}

async function postToSlack(payload) {
  const response = await fetch(SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw new Error(`Slack returned ${response.status}: ${await response.text()}`)
}

/**
 * Claims one of the three stamps. The `is.null` filter is the claim: if another
 * copy of this worker got there first, zero rows come back and we skip the post
 * rather than repeating it.
 */
async function claim(meeting, column) {
  const url = `${SUPABASE_URL}/rest/v1/meetings?id=eq.${meeting.id}&${column}=is.null`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ [column]: new Date().toISOString() }),
  })
  if (!response.ok) throw new Error(`Meeting update failed (${response.status})`)
  return (await response.json()).length > 0
}

/** Lets the stamp go again when the post itself failed, so the next pass retries. */
async function release(meeting, column) {
  await fetch(`${SUPABASE_URL}/rest/v1/meetings?id=eq.${meeting.id}`, {
    method: 'PATCH', headers, body: JSON.stringify({ [column]: null }),
  }).catch(() => {})
}

async function send(meeting, column, kind) {
  if (!await claim(meeting, column)) return
  try {
    await postToSlack(slackMessage(meeting, kind))
    console.log(`meeting ${meeting.id}: posted "${kind}"`)
  } catch (error) {
    await release(meeting, column)
    throw error
  }
}

async function run() {
  // The rules first, so a meeting created this pass can still be announced in
  // the same one.
  await materializeSchedules().catch(error => console.error(`schedules: ${error.message}`))

  // Meetings from six hours back (a late "set" still deserves its post) up to
  // two days ahead — far enough for any warning window.
  const from = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const to   = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const query = `cancelled_at=is.null&starts_at=gte.${from}&starts_at=lte.${to}&order=starts_at.asc&limit=50`
  const response = await fetch(`${SUPABASE_URL}/rest/v1/meetings?${query}`, { headers })
  if (!response.ok) throw new Error(`Meetings read failed (${response.status})`)

  const now = Date.now()
  for (const meeting of await response.json()) {
    const startsIn = new Date(meeting.starts_at).getTime() - now
    try {
      // "A meeting was set" — only while it is still in the future, so an old
      // row edited after the fact does not announce a meeting that is over.
      if (!meeting.slack_created_sent_at && startsIn > 0) {
        await send(meeting, 'slack_created_sent_at', 'created')
      }
      // First warning, then the last call. Both stop once the meeting starts:
      // a worker that was down through the whole window stays quiet rather than
      // posting "starts in 5 minutes" about a meeting already under way.
      if (!meeting.slack_reminder_sent_at && startsIn <= meeting.remind_minutes * 60_000 && startsIn > 0) {
        await send(meeting, 'slack_reminder_sent_at', 'reminder')
      }
      if (!meeting.slack_final_sent_at && startsIn <= meeting.final_remind_minutes * 60_000 && startsIn > 0) {
        await send(meeting, 'slack_final_sent_at', 'final')
      }
    } catch (error) {
      console.error(`meeting ${meeting.id}: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}

setInterval(() => run().catch(error => console.error(error.message)), POLL_MS)
void run().catch(error => console.error(error.message))
