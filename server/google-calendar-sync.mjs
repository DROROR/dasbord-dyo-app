import { googleAccessToken, googleCredentialsConfigured } from './google-auth.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
// "id=color,id=color": every calendar is read and shown on the dashboard;
// meetings set on the dashboard are created in the first one.
const CALENDARS = String(process.env.GOOGLE_CALENDAR_IDS || '').split(',').map(entry => entry.trim()).filter(Boolean)
  .map((entry, position) => { const [id, color] = entry.split('='); return { id: id.trim(), color: color?.trim() || null, position } })
const PRIMARY_CALENDAR = CALENDARS[0]?.id
const INTERVAL_MS = Math.max(Number(process.env.GOOGLE_CALENDAR_SYNC_INTERVAL_MS || 60_000), 30_000)
const DEFAULT_MINUTES = Number(process.env.GOOGLE_CALENDAR_MEETING_MINUTES || 30)
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://dashboard.dyocourses.com'
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const LEAD_FIELDS = 'id,name,phone,email,status,due_at,meeting_ends_at,google_event_id,google_calendar_id,google_synced_due_at,google_sync_pending'
const FIRST_SYNC_DAYS = 7
// Statuses a fresh booking moves forward to "meeting"; a lead further along keeps its status.
const BOOKABLE_STATUSES = new Set(['new', 'followup', 'irrelevant'])

const log = (...parts) => console.log(new Date().toISOString(), ...parts)
const enc = encodeURIComponent
const sameTime = (a, b) => (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null)

async function db(path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json', Prefer: prefer || 'return=representation' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${response.status}): ${await response.text()}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

async function google(calendarId, path, { method = 'GET', body } = {}) {
  return fetch(`https://www.googleapis.com/calendar/v3/calendars/${enc(calendarId)}/events${path}`, {
    method,
    headers: { Authorization: `Bearer ${await googleAccessToken(SCOPE)}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
}

// The event link is saved unconditionally so a retry never creates a second
// event; the "Google agrees" stamp only lands if nobody moved the meeting
// again while Google was being called.
async function settle(lead, link, syncedDueAt) {
  await db(`leads?id=eq.${lead.id}`, { method: 'PATCH', body: link, prefer: 'return=minimal' })
  const unchanged = lead.due_at ? `due_at=eq.${enc(lead.due_at)}` : 'due_at=is.null'
  await db(`leads?id=eq.${lead.id}&${unchanged}`, { method: 'PATCH', body: { google_synced_due_at: syncedDueAt }, prefer: 'return=minimal' })
}

function eventBody(lead) {
  return {
    summary: `פגישה: ${lead.name}`,
    description: [lead.phone, lead.email, `${DASHBOARD_URL}/leads`].filter(Boolean).join('\n'),
    extendedProperties: { private: { dyoLeadId: lead.id } },
  }
}

// A meeting the team already put in Google by hand must not get a twin:
// the lead adopts it, and Google's time wins.
async function adoptExisting(lead) {
  const name = lead.name?.trim()
  if (!name || name.length < 3) return false
  const at = Date.parse(lead.due_at)
  const window = `starts_at=gte.${enc(new Date(at - 2 * 86_400_000).toISOString())}&starts_at=lte.${enc(new Date(at + 2 * 86_400_000).toISOString())}`
  const candidates = await db(`google_calendar_events?${window}&summary=ilike.${enc(`*${name}*`)}&select=calendar_id,event_id,starts_at,ends_at&order=starts_at&limit=5`)
  for (const event of candidates) {
    if (await findLead(`google_event_id=eq.${enc(event.event_id)}`)) continue
    await db(`leads?id=eq.${lead.id}&due_at=eq.${enc(lead.due_at)}`, { method: 'PATCH', prefer: 'return=minimal', body: {
      due_at: event.starts_at, google_synced_due_at: event.starts_at, meeting_ends_at: event.ends_at, google_event_id: event.event_id, google_calendar_id: event.calendar_id,
    } })
    log(`lead ${lead.id} matched to existing event ${event.event_id} at ${event.starts_at}`)
    return true
  }
  return false
}

async function pushLead(lead) {
  const calendarId = lead.google_calendar_id || PRIMARY_CALENDAR
  if (!lead.due_at) {
    if (lead.google_event_id) {
      const response = await google(calendarId, `/${enc(lead.google_event_id)}?sendUpdates=none`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google DELETE event failed (${response.status}): ${await response.text()}`)
    }
    await settle(lead, { google_event_id: null, google_calendar_id: null, meeting_ends_at: null }, null)
    return
  }
  const previousMinutes = lead.meeting_ends_at && lead.google_synced_due_at ? (Date.parse(lead.meeting_ends_at) - Date.parse(lead.google_synced_due_at)) / 60_000 : 0
  const minutes = previousMinutes > 0 ? previousMinutes : DEFAULT_MINUTES
  const start = new Date(lead.due_at).toISOString()
  const end = new Date(Date.parse(lead.due_at) + minutes * 60_000).toISOString()
  const times = { start: { dateTime: start }, end: { dateTime: end }, status: 'confirmed' }
  if (lead.google_event_id) {
    const response = await google(calendarId, `/${enc(lead.google_event_id)}?sendUpdates=none`, { method: 'PATCH', body: times })
    if (response.ok) {
      await settle(lead, { meeting_ends_at: end }, lead.due_at)
      return
    }
    if (response.status === 403 && calendarId !== PRIMARY_CALENDAR) {
      log(`lead ${lead.id}: ${calendarId} is read-only for the service account; the meeting moved on the dashboard only`)
      await settle(lead, { meeting_ends_at: end }, lead.due_at)
      return
    }
    if (response.status !== 404 && response.status !== 410) throw new Error(`Google PATCH event failed (${response.status}): ${await response.text()}`)
  }
  if (!lead.google_event_id && await adoptExisting(lead)) return
  const response = await google(PRIMARY_CALENDAR, '?sendUpdates=none', { method: 'POST', body: { ...times, ...eventBody(lead) } })
  if (!response.ok) throw new Error(`Google POST event failed (${response.status}): ${await response.text()}`)
  const event = await response.json()
  await settle(lead, { google_event_id: event.id, google_calendar_id: PRIMARY_CALENDAR, meeting_ends_at: end }, lead.due_at)
}

async function pushAll() {
  const pending = await db(`leads?google_sync_pending=is.true&select=${LEAD_FIELDS}&order=due_at.asc.nullsfirst&limit=200`)
  for (const lead of pending) {
    try {
      await pushLead(lead)
      log(`pushed lead ${lead.id} (${lead.due_at ?? 'meeting removed'})`)
    } catch (error) {
      log(`push failed for lead ${lead.id}: ${error.message}`)
    }
  }
}

const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g
const isBooking = event => Boolean(event.extendedProperties?.shared?.['goo.createdByAvailId'])

function phoneIn(text) {
  return text.match(/\+?\d[\d\s\-().]{7,}\d/g)?.find(candidate => candidate.replace(/\D/g, '').length >= 9)?.trim() ?? ''
}

// Appointment-schedule bookings describe the booker as
// "Booked by / name / email / phone", then each form question and its answer.
function bookingDetails(event) {
  const lines = String(event.description || '')
    .replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(BIDI_MARKS, '')
    .split('\n').map(line => line.trim()).filter(Boolean)
  const at = lines.findIndex(line => /^booked by$/i.test(line))
  const question = lines.findIndex((line, index) => index > at && line.endsWith('?'))
  return {
    name: at >= 0 && !lines[at + 1]?.includes('@') ? lines[at + 1] : '',
    phone: phoneIn(lines.slice(Math.max(at, 0)).join('\n')),
    answer: question >= 0 ? lines[question + 1] ?? '' : '',
  }
}

const phoneIdentity = value => { const digits = String(value || '').replace(/\D/g, ''); return digits.length >= 9 ? digits.slice(-9) : null }

async function findLead(filter) {
  return (await db(`leads?${filter}&select=${LEAD_FIELDS}&limit=1`))[0] ?? null
}

async function findBooker(email, phone, context) {
  context.directory ??= await db(`leads?select=${LEAD_FIELDS}&order=created_at.desc&limit=5000`)
  const wantedEmail = email?.trim().toLowerCase()
  const wantedPhone = phoneIdentity(phone)
  return context.directory.find(lead => (wantedEmail && lead.email?.trim().toLowerCase() === wantedEmail) || (wantedPhone && phoneIdentity(lead.phone) === wantedPhone)) ?? null
}

async function applyEvent(event, calendarId, context) {
  const ownLeadId = event.extendedProperties?.private?.dyoLeadId
  let lead = await findLead(`google_event_id=eq.${enc(event.id)}`) ?? (ownLeadId ? await findLead(`id=eq.${enc(ownLeadId)}`) : null)
  // The same event shows up in every calendar invited to it; the organizer's
  // copy is the one that can be moved, so it wins the link.
  if (lead?.google_event_id === event.id && lead.google_calendar_id && lead.google_calendar_id !== calendarId) {
    if (event.status === 'cancelled' || !event.organizer?.self) return
    await db(`leads?id=eq.${lead.id}`, { method: 'PATCH', body: { google_calendar_id: calendarId }, prefer: 'return=minimal' })
    lead.google_calendar_id = calendarId
  }

  if (event.status === 'cancelled') {
    if (!lead || lead.google_event_id !== event.id || lead.google_sync_pending) return
    await db(`leads?id=eq.${lead.id}&google_sync_pending=is.false`, { method: 'PATCH', body: { due_at: null, google_synced_due_at: null, meeting_ends_at: null, google_event_id: null, google_calendar_id: null }, prefer: 'return=minimal' })
    log(`meeting cancelled in Google for lead ${lead.id}`)
    return
  }

  const start = event.start?.dateTime
  const end = event.end?.dateTime
  if (!start) return

  const guest = event.attendees?.find(attendee => !attendee.self && !attendee.organizer && !attendee.resource && attendee.email)
  if (!lead && !ownLeadId && !isBooking(event)) {
    // A meeting made by hand joins a lead only by the guest's email, only
    // ahead of time, and only if that lead has no meeting linked yet.
    if (!guest || Date.parse(start) < Date.now()) return
    lead = await findBooker(guest.email, null, context)
    if (!lead || lead.google_event_id) return
  }
  if (!lead) {
    if (ownLeadId) return
    const booking = bookingDetails(event)
    lead = await findBooker(guest?.email, booking.phone, context)
    if (!lead) {
      const name = booking.name || guest?.displayName || event.summary?.match(/\(([^)]+)\)\s*$/)?.[1]?.replace(BIDI_MARKS, '').trim() || guest?.email || 'Website booking'
      const [created] = await db('leads', { method: 'POST', body: {
        name, email: guest?.email ?? null, phone: booking.phone, form_answer: booking.answer || null,
        source: 'website', status: 'meeting', pipeline_status_id: context.meetingStatusId,
        due_at: start, meeting_ends_at: end, google_event_id: event.id, google_calendar_id: calendarId, google_synced_due_at: start,
      } })
      context.directory?.unshift(created)
      log(`new website lead ${created.id} booked for ${start}`)
      return
    }
  }

  if (lead.google_event_id === event.id && lead.google_sync_pending) return
  const newBooking = lead.google_event_id !== event.id
  if (!newBooking && sameTime(lead.due_at, start) && sameTime(lead.meeting_ends_at, end)) return
  const patch = { due_at: start, google_synced_due_at: start, meeting_ends_at: end, google_event_id: event.id, google_calendar_id: calendarId }
  if (newBooking && !ownLeadId && Date.parse(start) > Date.now() && BOOKABLE_STATUSES.has(lead.status)) {
    Object.assign(patch, { status: 'meeting', pipeline_status_id: context.meetingStatusId })
  }
  await db(`leads?id=eq.${lead.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' })
  Object.assign(lead, patch)
  log(`${newBooking ? 'linked booking to' : 'moved meeting for'} lead ${lead.id} → ${start}`)
}

const upsertCalendar = row => db('google_calendars?on_conflict=calendar_id', {
  method: 'POST', body: { ...row, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal',
})

// The dashboard shows every timed event, not only lead meetings, so it looks
// like the calendars the team already reads.
async function mirror(calendarId, events) {
  const gone = events.filter(event => event.status === 'cancelled' || !event.start?.dateTime).map(event => `"${event.id}"`)
  for (let index = 0; index < gone.length; index += 100) {
    await db(`google_calendar_events?calendar_id=eq.${enc(calendarId)}&event_id=in.(${enc(gone.slice(index, index + 100).join(','))})`, { method: 'DELETE', prefer: 'return=minimal' })
  }
  const rows = events.filter(event => event.status !== 'cancelled' && event.start?.dateTime && event.end?.dateTime).map(event => ({
    calendar_id: calendarId, event_id: event.id, summary: event.summary ?? null,
    starts_at: event.start.dateTime, ends_at: event.end.dateTime,
    html_link: event.htmlLink ?? null, meet_link: event.hangoutLink ?? null, updated_at: new Date().toISOString(),
  }))
  for (let index = 0; index < rows.length; index += 500) {
    await db('google_calendar_events?on_conflict=calendar_id,event_id', { method: 'POST', body: rows.slice(index, index + 500), prefer: 'resolution=merge-duplicates,return=minimal' })
  }
}

async function pullCalendar({ id: calendarId, color, position }, context) {
  await upsertCalendar({ calendar_id: calendarId, color, position })
  const state = (await db(`google_calendars?calendar_id=eq.${enc(calendarId)}&select=sync_token`))[0]
  let syncToken = state?.sync_token ?? null
  let pageToken = null
  let nextSyncToken = null
  let name = null
  const events = []
  for (;;) {
    const params = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '250' })
    if (syncToken) params.set('syncToken', syncToken)
    else params.set('timeMin', new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000).toISOString())
    if (pageToken) params.set('pageToken', pageToken)
    const response = await google(calendarId, `?${params}`)
    if (response.status === 410 && syncToken) {
      log(`Google sync token expired for ${calendarId}; reading the calendar again`)
      syncToken = null; pageToken = null; events.length = 0
      continue
    }
    if (!response.ok) throw new Error(`Google list events failed (${response.status}): ${await response.text()}`)
    const page = await response.json()
    name = page.summary ?? name
    events.push(...(page.items ?? []))
    pageToken = page.nextPageToken ?? null
    nextSyncToken = page.nextSyncToken ?? null
    if (!pageToken) break
  }

  await mirror(calendarId, events)
  let failed = false
  for (const event of events) {
    try {
      await applyEvent(event, calendarId, context)
    } catch (error) {
      failed = true
      log(`could not apply event ${event.id} from ${calendarId}: ${error.message}`)
    }
  }
  // Keeping the old token on a failure makes the next pass read the same
  // changes again; applying an event twice is harmless.
  await upsertCalendar({ calendar_id: calendarId, name, ...(failed || !nextSyncToken ? {} : { sync_token: nextSyncToken }) })
}

async function pull() {
  const [meetingStatus] = await db('lead_pipeline_statuses?legacy_status=eq.meeting&select=id&limit=1')
  if (!meetingStatus) throw new Error('Meeting pipeline status is missing')
  const context = { meetingStatusId: meetingStatus.id, directory: null }
  for (const calendar of CALENDARS) {
    try {
      await pullCalendar(calendar, context)
    } catch (error) {
      log(`pull failed for ${calendar.id}: ${error.message}`)
    }
  }
}

let running = false
async function cycle() {
  if (running) return
  running = true
  try {
    await pushAll()
    await pull()
  } catch (error) {
    log(`sync failed: ${error.message}`)
  } finally {
    running = false
  }
}

if (!SUPABASE_URL || !SERVICE_KEY || !PRIMARY_CALENDAR || !googleCredentialsConfigured()) {
  log('Google Calendar sync is not configured (GOOGLE_CALENDAR_IDS, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_SERVICE_ACCOUNT_FILE); idle')
  setInterval(() => {}, 3_600_000)
} else {
  log(`Google Calendar sync started for ${CALENDARS.map(calendar => calendar.id).join(', ')}, every ${INTERVAL_MS / 1000}s`)
  void cycle()
  setInterval(() => void cycle(), INTERVAL_MS)
}
