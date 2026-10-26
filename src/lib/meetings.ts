import { supabase } from './supabase'

// ── Team meetings ───────────────────────────────────────────────────────────────
// One shared list of Google Meet calls, read by a team split across Israel,
// Pakistan and Ukraine. A meeting is a single instant (`starts_at`) — the three
// clocks are that instant rendered three ways, so they cannot disagree.
//
// A weekly schedule is the other half: "every Monday 17:00 Pakistan time" is a
// wall clock plus the zone it is read in, never an instant, so it stays 17:00 in
// Karachi when Israel or Ukraine change their clocks. The server turns each
// rule into real meetings a fortnight ahead; from there they behave like any
// other meeting and can be moved, re-linked or cancelled one by one.

export const MEETING_ZONES = [
  { zone: 'Asia/Jerusalem', labelHe: 'ישראל',    labelEn: 'Israel',   flag: '🇮🇱' },
  { zone: 'Asia/Karachi',   labelHe: 'פקיסטן',   labelEn: 'Pakistan', flag: '🇵🇰' },
  { zone: 'Europe/Kyiv',    labelHe: 'אוקראינה', labelEn: 'Ukraine',  flag: '🇺🇦' },
] as const

/** The zone a time is typed in unless another one is picked — the client's own. */
export const MEETING_INPUT_ZONE = 'Asia/Jerusalem'

export const DEFAULT_MEET_LINK = 'https://meet.google.com/bzt-qtnh-vds'

export const WEEKDAYS = [
  { value: 0, he: 'ראשון',  en: 'Sunday' },
  { value: 1, he: 'שני',    en: 'Monday' },
  { value: 2, he: 'שלישי',  en: 'Tuesday' },
  { value: 3, he: 'רביעי',  en: 'Wednesday' },
  { value: 4, he: 'חמישי',  en: 'Thursday' },
  { value: 5, he: 'שישי',   en: 'Friday' },
  { value: 6, he: 'שבת',    en: 'Saturday' },
] as const

export interface DbMeeting {
  id: string
  title: string
  starts_at: string
  duration_minutes: number
  meet_link: string
  notes: string | null
  remind_minutes: number
  final_remind_minutes: number
  input_timezone: string
  schedule_id: string | null
  occurrence_date: string | null
  customized: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  cancelled_at: string | null
  slack_created_sent_at: string | null
  slack_reminder_sent_at: string | null
  slack_final_sent_at: string | null
}

export interface DbMeetingSchedule {
  id: string
  title: string
  weekday: number
  local_time: string
  timezone: string
  duration_minutes: number
  meet_link: string
  notes: string | null
  remind_minutes: number
  final_remind_minutes: number
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

const MEETING_COLUMNS =
  'id, title, starts_at, duration_minutes, meet_link, notes, remind_minutes, final_remind_minutes, input_timezone, schedule_id, occurrence_date, customized, created_by, created_at, updated_at, cancelled_at, slack_created_sent_at, slack_reminder_sent_at, slack_final_sent_at'

const SCHEDULE_COLUMNS =
  'id, title, weekday, local_time, timezone, duration_minutes, meet_link, notes, remind_minutes, final_remind_minutes, active, created_by, created_at, updated_at'

// ── Time helpers ────────────────────────────────────────────────────────────────

const ZONE_PARTS = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = ZONE_PARTS.get(zone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    ZONE_PARTS.set(zone, fmt)
  }
  return fmt
}

/** How far ahead of UTC `zone` is at `instant`, in milliseconds. */
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = zoneFormatter(zone).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asIfUtc - instant
}

/**
 * A wall-clock "YYYY-MM-DDTHH:mm" read in `zone`, turned into a real instant.
 * The second pass is for the twice-a-year clock change: the offset depends on
 * the instant we are still solving for, so the first guess can land on the
 * wrong side of it.
 */
export function zonedLocalToIso(local: string, zone: string = MEETING_INPUT_ZONE): string {
  const naive = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`)
  if (Number.isNaN(naive)) throw new Error(`Bad meeting time: ${local}`)
  let instant = naive - zoneOffsetMs(naive, zone)
  instant = naive - zoneOffsetMs(instant, zone)
  return new Date(instant).toISOString()
}

/** The reverse: an instant as the "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
export function isoToZonedLocal(iso: string, zone: string = MEETING_INPUT_ZONE): string {
  const parts = zoneFormatter(zone).formatToParts(new Date(iso))
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`
}

export function meetingTimeInZone(iso: string, zone: string, locale = 'en-GB'): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone })
}

export function meetingDateInZone(iso: string, zone: string, locale = 'en-GB'): string {
  return new Date(iso).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: 'short', timeZone: zone })
}

/** Milliseconds until the meeting starts; negative once it has. */
export function msUntil(iso: string, now = Date.now()): number {
  return new Date(iso).getTime() - now
}

/** "1h 12m", "12m 30s", "now" — the countdown text. */
export function countdownText(ms: number, he: boolean): string {
  if (ms <= 0) return he ? 'עכשיו' : 'now'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return he ? `${days} ימים ${hours} שע׳` : `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

/**
 * Which of the two warnings a meeting is currently in: the first one (5 minutes
 * before by default), the last call (1 minute before), or none. 'live' is once
 * it has started and until it is over, so the dialog keeps offering the link to
 * anyone who has not joined yet.
 */
export type MeetingStage = 'first' | 'final' | 'live' | null

export function meetingStage(meeting: DbMeeting, now = Date.now()): MeetingStage {
  if (meeting.cancelled_at) return null
  const ms = msUntil(meeting.starts_at, now)
  if (ms <= -meeting.duration_minutes * 60_000) return null
  if (ms <= 0) return 'live'
  if (ms <= meeting.final_remind_minutes * 60_000) return 'final'
  if (ms <= meeting.remind_minutes * 60_000) return 'first'
  return null
}

/** True while the meeting is inside either warning window and not over yet. */
export function isMeetingDueSoon(meeting: DbMeeting, now = Date.now()): boolean {
  return meetingStage(meeting, now) !== null
}

/**
 * The next time a weekly rule comes round, as an instant. Used for the preview
 * under the schedule form ("next Monday — 17:00 Pakistan, 15:00 Israel…"); the
 * real occurrences are created by the server, from the same arithmetic.
 */
export function nextOccurrenceIso(
  schedule: Pick<DbMeetingSchedule, 'weekday' | 'local_time' | 'timezone'>,
  from = new Date(),
): string {
  const hhmm = schedule.local_time.slice(0, 5)
  for (let ahead = 0; ahead <= 7; ahead++) {
    // Walk forward day by day in the rule's own zone, not in the browser's.
    const probe = new Date(from.getTime() + ahead * 86_400_000)
    const dayInZone = isoToZonedLocal(probe.toISOString(), schedule.timezone).slice(0, 10)
    const iso = zonedLocalToIso(`${dayInZone}T${hhmm}`, schedule.timezone)
    const weekday = new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: schedule.timezone })
    const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
    if (index === schedule.weekday && new Date(iso).getTime() > from.getTime()) return iso
  }
  return zonedLocalToIso(`${isoToZonedLocal(from.toISOString(), schedule.timezone).slice(0, 10)}T${hhmm}`, schedule.timezone)
}

// ── Meetings: reads and writes ──────────────────────────────────────────────────

/**
 * Everything worth showing: meetings that have not finished yet, plus the last
 * few hours of finished ones so a late joiner still finds the link.
 */
export async function getMeetings(): Promise<DbMeeting[]> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('meetings')
    .select(MEETING_COLUMNS)
    .gte('starts_at', since)
    .order('starts_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbMeeting[]
}

export interface MeetingInput {
  title: string
  /** Wall clock "YYYY-MM-DDTHH:mm", read in `timezone`. */
  localStart: string
  timezone: string
  durationMinutes: number
  meetLink: string
  remindMinutes: number
  finalRemindMinutes: number
  notes: string
}

function inputToRow(input: MeetingInput) {
  return {
    title: input.title.trim(),
    starts_at: zonedLocalToIso(input.localStart, input.timezone),
    input_timezone: input.timezone,
    duration_minutes: input.durationMinutes,
    meet_link: input.meetLink.trim() || DEFAULT_MEET_LINK,
    remind_minutes: input.remindMinutes,
    final_remind_minutes: Math.min(input.finalRemindMinutes, input.remindMinutes),
    notes: input.notes.trim() || null,
  }
}

export async function createMeeting(input: MeetingInput): Promise<DbMeeting> {
  const { data, error } = await supabase
    .from('meetings')
    .insert(inputToRow(input))
    .select(MEETING_COLUMNS)
    .single()
  if (error) throw error
  return data as DbMeeting
}

export async function updateMeeting(id: string, input: MeetingInput): Promise<DbMeeting> {
  const { data, error } = await supabase
    .from('meetings')
    .update({ ...inputToRow(input), cancelled_at: null })
    .eq('id', id)
    .select(MEETING_COLUMNS)
    .single()
  if (error) throw error
  return data as DbMeeting
}

/** Cancel, not delete — the row stays so nobody loses the history. */
export async function cancelMeeting(id: string): Promise<DbMeeting> {
  const { data, error } = await supabase
    .from('meetings')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('id', id)
    .select(MEETING_COLUMNS)
    .single()
  if (error) throw error
  return data as DbMeeting
}

/**
 * Gone for good. A meeting that came from a weekly rule leaves a skip behind it
 * (recorded in the database, not here), so the worker treats that rule day as
 * dealt with instead of laying the meeting down again a few seconds later.
 */
export async function deleteMeeting(id: string): Promise<void> {
  const { error } = await supabase.from('meetings').delete().eq('id', id)
  if (error) throw error
}

export async function restoreMeeting(id: string): Promise<DbMeeting> {
  const { data, error } = await supabase
    .from('meetings')
    .update({ cancelled_at: null })
    .eq('id', id)
    .select(MEETING_COLUMNS)
    .single()
  if (error) throw error
  return data as DbMeeting
}

// ── Weekly schedules: reads and writes ──────────────────────────────────────────

export async function getMeetingSchedules(): Promise<DbMeetingSchedule[]> {
  const { data, error } = await supabase
    .from('meeting_schedules')
    .select(SCHEDULE_COLUMNS)
    .order('weekday', { ascending: true })
    .order('local_time', { ascending: true })
  if (error) throw error
  return (data ?? []) as DbMeetingSchedule[]
}

export interface ScheduleInput {
  title: string
  weekday: number
  /** "HH:mm", read in `timezone`. */
  localTime: string
  timezone: string
  durationMinutes: number
  meetLink: string
  remindMinutes: number
  finalRemindMinutes: number
  notes: string
  active: boolean
}

function scheduleToRow(input: ScheduleInput) {
  return {
    title: input.title.trim(),
    weekday: input.weekday,
    local_time: `${input.localTime}:00`,
    timezone: input.timezone,
    duration_minutes: input.durationMinutes,
    meet_link: input.meetLink.trim() || DEFAULT_MEET_LINK,
    remind_minutes: input.remindMinutes,
    final_remind_minutes: Math.min(input.finalRemindMinutes, input.remindMinutes),
    notes: input.notes.trim() || null,
    active: input.active,
  }
}

export async function createMeetingSchedule(input: ScheduleInput): Promise<DbMeetingSchedule> {
  const { data, error } = await supabase
    .from('meeting_schedules')
    .insert(scheduleToRow(input))
    .select(SCHEDULE_COLUMNS)
    .single()
  if (error) throw error
  return data as DbMeetingSchedule
}

export async function updateMeetingSchedule(id: string, input: ScheduleInput): Promise<DbMeetingSchedule> {
  const { data, error } = await supabase
    .from('meeting_schedules')
    .update(scheduleToRow(input))
    .eq('id', id)
    .select(SCHEDULE_COLUMNS)
    .single()
  if (error) throw error
  return data as DbMeetingSchedule
}

/** Pausing a rule stops future occurrences; the ones already held are cleared by the database. */
export async function setMeetingScheduleActive(id: string, active: boolean): Promise<DbMeetingSchedule> {
  const { data, error } = await supabase
    .from('meeting_schedules')
    .update({ active })
    .eq('id', id)
    .select(SCHEDULE_COLUMNS)
    .single()
  if (error) throw error
  return data as DbMeetingSchedule
}

export async function deleteMeetingSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('meeting_schedules').delete().eq('id', id)
  if (error) throw error
}
