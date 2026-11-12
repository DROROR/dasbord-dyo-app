// Sends the WhatsApp follow-up chain to leads nobody could reach by phone.
//
// The planner enrols a lead (a lead_sequence_progress row) the moment its
// fifth unanswered attempt is recorded. This worker is the other half: it
// walks each running chain and sends the step whose day has arrived.
//
// Three things keep it from doing damage:
//
//  1. It sends nothing at all unless LEAD_SEQUENCE_SEND is exactly "on". The
//     default is a dry run that logs the message it would have sent and writes
//     nothing, so the worker can be deployed and watched before a single
//     customer hears from it.
//  2. A step is CLAIMED before it is sent — the last_day_sent update carries
//     the value it expects to replace, so a restart, or a second copy of this
//     worker, cannot send the same step twice.
//  3. Every stop condition is re-checked immediately before each send: the
//     lead answered a call, somebody moved it out of the No Answer column, or
//     the chain was stopped by hand. Any of those cancels the rest of it.
//
// Nothing here decides who gets enrolled; that is the planner's business.

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

// The same Green API sales instance the planner's own sendWhatsApp() uses for
// leads. Either name works; .env currently holds the VITE_ ones because the
// browser needed them first.
const GREEN_INSTANCE = process.env.GREEN_API_INSTANCE_SALES || process.env.VITE_GREEN_API_INSTANCE_SALES
const GREEN_TOKEN    = process.env.GREEN_API_TOKEN_SALES    || process.env.VITE_GREEN_API_TOKEN_SALES

// The client's own WhatsApp gateway (Evolution API v2). When all three are
// set it is the channel used, and Green API is not consulted. Server-side
// names only — none of these may ever be given a VITE_ prefix.
const EVOLUTION_URL      = (process.env.EVOLUTION_API_URL ?? '').trim().replace(/\/+$/, '')
const EVOLUTION_KEY      = (process.env.EVOLUTION_API_KEY ?? '').trim()
const EVOLUTION_INSTANCE = (process.env.EVOLUTION_INSTANCE_SALES ?? '').trim()
const USE_EVOLUTION = Boolean(EVOLUTION_URL && EVOLUTION_KEY && EVOLUTION_INSTANCE)
const CHANNEL_READY = USE_EVOLUTION || Boolean(GREEN_INSTANCE && GREEN_TOKEN)

// "on" and nothing else sends real messages.
const SENDING = process.env.LEAD_SEQUENCE_SEND === 'on'

// Nobody wants a sales follow-up at four in the morning. Local hours in Israel,
// inclusive of the opening hour and exclusive of the closing one.
const QUIET_FROM = Number(process.env.LEAD_SEQUENCE_HOUR_FROM ?? 9)
const QUIET_TO   = Number(process.env.LEAD_SEQUENCE_HOUR_TO   ?? 20)
const TIMEZONE   = process.env.LEAD_SEQUENCE_TZ || 'Asia/Jerusalem'

const POLL_MS = Number(process.env.LEAD_SEQUENCE_POLL_MS ?? 300_000)

// Said once, not every five minutes.
let warnedUnconfigured = false

// The column the planner moves an unreachable lead into, recognised by name
// exactly as src/lib/leadNoAnswer.ts does it.
const NO_ANSWER_LABELS = ['no answer', 'no-answer', 'אין מענה', 'ללא מענה']
const NO_ANSWER_SEQUENCE_KEYS = ['no_answer', 'noanswer']

const DAY_MS = 86_400_000

// The day of each follow-up call, counted from the day the lead joined the
// chain. src/lib/leadFollowUp.ts carries the same list (FOLLOW_UP_CALL_DAYS);
// change them together. A WhatsApp step is held back until every call that
// falls on or before its day has been confirmed unanswered by a person.
const CALL_DAYS = [0, 1, 3, 8]

// Two messages of a chain never reach the same person closer together than
// this, however late the calls before them were confirmed.
const MIN_GAP_MS = 20 * 60 * 60 * 1000

// New leads join the chain by themselves only when BOTH of these are set: the
// switch, and the moment from which a lead counts as new. Without the second
// one every lead already on the board would qualify, so its absence means off.
const AUTO_ENROL = process.env.LEAD_FOLLOWUP_AUTO_ENROL === 'on'
const AUTO_ENROL_SINCE = Date.parse(process.env.LEAD_FOLLOWUP_AUTO_ENROL_SINCE ?? '')

// Columns a lead may sit in while its chain runs. Anywhere else — a meeting is
// booked, it is in production, it was archived — a person has taken over.
const CHAIN_LEGACY_STATUSES = ['new', 'followup']
const CHAIN_LABELS = ['cold call', ...NO_ANSWER_LABELS]

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  process.exit(1)
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'content-type': 'application/json',
}

async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  })
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`)
  }
  // An insert answers 201 with an empty body unless a representation was
  // asked for. Reading that as JSON threw, which made a message that HAD been
  // sent look like a failure. An empty body is simply "nothing to return".
  const text = await response.text()
  return text ? JSON.parse(text) : []
}

function withinSendingHours(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', hour12: false,
  }).format(now))
  return hour >= QUIET_FROM && hour < QUIET_TO
}

function matchesNoAnswer(status) {
  return NO_ANSWER_LABELS.includes(String(status.label_en ?? '').trim().toLowerCase())
    || NO_ANSWER_LABELS.includes(String(status.label_he ?? '').trim())
}

/** The lead's own name dropped into whatever the step's text asks for. */
function fillPlaceholders(text, lead) {
  const name = (lead.name ?? '').trim()
  return String(text)
    .replace(/\{\{\s*שם\s*\}\}/g, name)
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*שם פרטי\s*\}\}/g, name)
}

function chatIdOf(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 9) return null
  const normalised = digits.startsWith('0') ? `972${digits.slice(1)}` : digits
  return `${normalised}@c.us`
}

async function sendWhatsApp(phone, message) {
  const chatId = chatIdOf(phone)
  if (!chatId) throw new Error(`unusable phone "${phone}"`)
  if (USE_EVOLUTION) {
    const response = await fetch(`${EVOLUTION_URL}/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: EVOLUTION_KEY },
      body: JSON.stringify({ number: chatId.replace('@c.us', ''), text: message }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`Evolution API returned ${response.status}`)
    return
  }
  if (!GREEN_INSTANCE || !GREEN_TOKEN) throw new Error('the sales WhatsApp channel is not configured')
  const response = await fetch(`https://api.green-api.com/waInstance${GREEN_INSTANCE}/sendMessage/${GREEN_TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId, message }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Green API returned ${response.status}`)
}

/**
 * Takes the step away from any other copy of this worker before it is sent.
 * The filter carries the value last_day_sent is expected to still hold, so
 * exactly one caller can move it forward.
 */
async function claimStep(progress, lastSent, day) {
  const claimed = await rest(
    `lead_sequence_progress?id=eq.${progress.id}&last_day_sent=eq.${lastSent}&status=eq.active`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ last_day_sent: day, updated_at: new Date().toISOString() }),
    },
  )
  return claimed.length > 0
}

async function closeChain(progress, status) {
  await rest(`lead_sequence_progress?id=eq.${progress.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  })
}

/** The same question for a chain that has call tasks: the lead need not be in the No Answer column. */
async function stopReasonWithCalls(progress, lead, statuses) {
  if (!lead) return 'the lead is gone'
  const column = statuses.find(status => status.id === lead.pipeline_status_id)
  if (column) {
    const names = [String(column.label_en ?? '').trim().toLowerCase(), String(column.label_he ?? '').trim().toLowerCase()]
    const allowed = !column.is_archived
      && (CHAIN_LEGACY_STATUSES.includes(String(column.legacy_status ?? '')) || names.some(name => CHAIN_LABELS.includes(name)))
    if (!allowed) return 'the lead was moved to another status'
  }
  const answered = await rest(
    `lead_history?lead_id=eq.${progress.lead_id}&kind=eq.completed_call&occurred_at=gt.${encodeURIComponent(progress.started_at)}&select=id&limit=1`,
  )
  if (answered.length > 0) return 'the lead answered a call'
  return null
}

/**
 * Follow-up call tasks of the given chains, by chain. Empty when the table is
 * not there yet, which leaves every chain on the original rules.
 */
async function callTasksOf(progressIds) {
  const byProgress = new Map()
  if (progressIds.length === 0) return byProgress
  try {
    const rows = await rest(`lead_followup_tasks?progress_id=in.(${progressIds.join(',')})&select=progress_id,status,outcome,created_at&limit=5000`)
    for (const row of rows) byProgress.set(row.progress_id, [...(byProgress.get(row.progress_id) ?? []), row])
  } catch { /* table absent: no chain has calls */ }
  return byProgress
}

/**
 * Puts leads that have just arrived on the chain: its row, and the first call
 * task. Only the form's own "new lead" column counts — never the cold-call
 * list, whose people did not ask to be contacted — and only leads created
 * after the configured moment, so nothing already on the board is swept in.
 */
async function enrolNewLeads(sequence, statuses) {
  if (!AUTO_ENROL || !Number.isFinite(AUTO_ENROL_SINCE) || !sequence) return
  const entry = statuses.find(status => status.legacy_status === 'new' && !status.is_archived)
  if (!entry) return
  const since = encodeURIComponent(new Date(AUTO_ENROL_SINCE).toISOString())
  const fresh = await rest(`leads?created_at=gt.${since}&pipeline_status_id=eq.${entry.id}&select=id,name&order=created_at.asc&limit=50`)
  if (fresh.length === 0) return
  const known = await rest(`lead_sequence_progress?sequence_id=eq.${sequence.id}&lead_id=in.(${fresh.map(lead => lead.id).join(',')})&select=lead_id`)
  const seen = new Set(known.map(row => row.lead_id))
  for (const lead of fresh) {
    if (seen.has(lead.id)) continue
    try {
      // The table allows one row per lead per chain, so a second copy of this
      // worker loses the insert and creates no second call task.
      const [progress] = await rest('lead_sequence_progress', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ lead_id: lead.id, sequence_id: sequence.id, status: 'active', last_day_sent: -1 }),
      })
      await rest('lead_followup_tasks', {
        method: 'POST',
        body: JSON.stringify({ lead_id: lead.id, progress_id: progress.id, step_no: 1, due_at: new Date().toISOString() }),
      })
      console.log(`[lead-sequence] ${lead.name} joined ${sequence.seq_key} on arrival`)
    } catch (error) {
      console.error(`[lead-sequence] could not enrol ${lead.id}: ${error.message}`)
    }
  }
}

/** Why this chain should stop, or null to carry on. */
async function stopReasonFor(progress, lead, noAnswerStatusId) {
  if (!lead) return 'the lead is gone'
  // Somebody took it out of the No Answer column, so a person is on it again.
  if (noAnswerStatusId && lead.pipeline_status_id !== noAnswerStatusId) return 'the lead was moved to another status'
  // They picked up after all.
  const answered = await rest(
    `lead_history?lead_id=eq.${progress.lead_id}&kind=eq.completed_call&occurred_at=gt.${encodeURIComponent(progress.started_at)}&select=id&limit=1`,
  )
  if (answered.length > 0) return 'the lead answered a call'
  return null
}

async function run() {
  // Checked before anything is claimed. Without a channel every send would
  // throw, and because a step is claimed BEFORE it is sent, a chain would
  // quietly burn through all four of its steps marking them failed — so by
  // the time the credentials arrived there would be nothing left to send.
  if (SENDING && !CHANNEL_READY) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true
      console.error('[lead-sequence] the sales WhatsApp channel has no credentials — standing down until EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE_SALES (or the Green API pair) are set')
    }
    return
  }

  if (AUTO_ENROL) {
    try {
      const [chains, columns] = await Promise.all([
        rest('sequences?select=id,seq_key,is_active'),
        rest('lead_pipeline_statuses?select=id,label_he,label_en,legacy_status,is_archived'),
      ])
      await enrolNewLeads(chains.find(chain => chain.is_active && NO_ANSWER_SEQUENCE_KEYS.includes(String(chain.seq_key ?? '').trim().toLowerCase())), columns)
    } catch (error) {
      console.error(`[lead-sequence] enrolment skipped: ${error.message}`)
    }
  }

  const running = await rest('lead_sequence_progress?status=eq.active&select=*&order=started_at.asc&limit=200')
  if (running.length === 0) return

  const [sequences, statuses, callTasks] = await Promise.all([
    rest('sequences?select=id,seq_key,label,is_active,sequence_steps(id,step_order,day,message,media_url)'),
    rest('lead_pipeline_statuses?select=id,label_he,label_en,legacy_status,is_archived'),
    callTasksOf(running.map(progress => progress.id)),
  ])
  const noAnswerStatus = statuses.find(matchesNoAnswer)
  const byId = new Map(sequences.map(sequence => [sequence.id, sequence]))

  if (!withinSendingHours()) return

  for (const progress of running) {
    try {
      const sequence = byId.get(progress.sequence_id)
      if (!sequence || !sequence.is_active) continue
      // This worker sends the no-answer chain and nothing else. The three
      // older onboarding chains (seq_key a/b/c) are active and have never had
      // a progress row; if one ever appeared, by hand or from some future
      // screen, it must not be this worker that starts posting them to leads.
      if (!NO_ANSWER_SEQUENCE_KEYS.includes(String(sequence.seq_key ?? '').trim().toLowerCase())) continue

      const steps = [...(sequence.sequence_steps ?? [])].sort((a, b) => a.day - b.day)
      // -1 means nothing has gone out. A sequence may legitimately open with a
      // step on day 0, so 0 cannot also mean "nothing sent": that collision
      // made the first step unsendable and showed in the dialog as "1 of 4
      // sent" when nothing had been. Rows written before -1 was the sentinel
      // carry 0 and are read as untouched, because a day-0 step is only ever
      // marked by the claim that raises last_day_sent to 0 from -1.
      const lastSent = progress.last_day_sent < 0 ? -1 : progress.last_day_sent
      const elapsedDays = Math.floor((Date.now() - new Date(progress.started_at).getTime()) / DAY_MS)
      // One step per lead per run: a chain that was paused does not fire its
      // whole backlog into somebody's phone at once.
      const due = steps.find(step => step.day > lastSent && step.day <= elapsedDays)

      if (!due) {
        const remaining = steps.some(step => step.day > lastSent)
        if (!remaining) await closeChain(progress, 'done')
        continue
      }

      // A chain with call tasks of its own follows the calls: a message waits
      // until every call on or before its day was confirmed unanswered. A
      // chain without any (started by the five-attempts rule) is untouched.
      // Restarting a chain detaches the calls of its earlier run, so whatever
      // is attached here belongs to the run in progress.
      const calls = callTasks.get(progress.id) ?? []
      const withCalls = calls.length > 0
      if (withCalls) {
        const needed = due.day <= 0 ? 0 : CALL_DAYS.filter(day => day <= due.day).length
        const confirmed = calls.filter(task => task.status === 'done' && task.outcome === 'no_answer').length
        if (confirmed < needed) continue
      }

      const [lead] = await rest(`leads?id=eq.${progress.lead_id}&select=id,name,phone,pipeline_status_id`)
      const stop = withCalls
        ? await stopReasonWithCalls(progress, lead, statuses)
        : await stopReasonFor(progress, lead, noAnswerStatus?.id)
      if (stop) {
        console.log(`[lead-sequence] chain ${progress.id} stopped — ${stop}`)
        // 'stopped' is the value the table allows. This used to say
        // 'cancelled', which the database refused, so a chain that should
        // have ended was retried every five minutes instead.
        await closeChain(progress, 'stopped')
        if (withCalls) {
          await rest(`lead_followup_tasks?progress_id=eq.${progress.id}&status=eq.open`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() }),
          }).catch(() => {})
        }
        continue
      }

      if (withCalls) {
        const recent = await rest(
          `messages?recipient_id=eq.${lead.id}&status=eq.sent&sent_at=gt.${encodeURIComponent(new Date(Date.now() - MIN_GAP_MS).toISOString())}&template_key=like.${encodeURIComponent(`${sequence.seq_key}:`)}*&select=id&limit=1`,
        )
        if (recent.length > 0) continue
      }

      const message = fillPlaceholders(due.message, lead)

      if (!SENDING) {
        console.log(`[lead-sequence] DRY RUN — would send day ${due.day} to ${lead.name} <${lead.phone}>:\n${message}\n`)
        continue
      }
      if (!(await claimStep(progress, progress.last_day_sent, due.day))) continue

      try {
        await sendWhatsApp(lead.phone, message)
        await rest('messages', {
          method: 'POST',
          body: JSON.stringify({
            recipient_id: lead.id,
            recipient_type: 'lead',
            phone: lead.phone,
            message_text: message,
            template_key: `${sequence.seq_key}:day${due.day}`,
            media_url: due.media_url ?? null,
            status: 'sent',
            sent_at: new Date().toISOString(),
          }),
        })
        console.log(`[lead-sequence] sent day ${due.day} of ${sequence.seq_key} to ${lead.name}`)
      } catch (error) {
        // The step stays claimed: a message that may or may not have reached
        // the customer is never retried blindly. The failure is recorded
        // against the lead so somebody can look.
        await rest('messages', {
          method: 'POST',
          body: JSON.stringify({
            recipient_id: lead.id,
            recipient_type: 'lead',
            phone: lead.phone,
            message_text: message,
            template_key: `${sequence.seq_key}:day${due.day}`,
            status: 'failed',
          }),
        }).catch(() => {})
        console.error(`[lead-sequence] send failed for ${progress.id}: ${error.message}`)
      }
    } catch (error) {
      console.error(`[lead-sequence] chain ${progress.id} skipped: ${error.message}`)
    }
  }
}

console.log(`[lead-sequence] worker up — ${SENDING ? 'SENDING' : 'DRY RUN'}, channel ${USE_EVOLUTION ? 'evolution' : CHANNEL_READY ? 'green' : 'none'}, ${QUIET_FROM}:00–${QUIET_TO}:00 ${TIMEZONE}, every ${Math.round(POLL_MS / 1000)}s`)
setInterval(() => run().catch(error => console.error(`[lead-sequence] ${error.message}`)), POLL_MS)
void run().catch(error => console.error(`[lead-sequence] ${error.message}`))
