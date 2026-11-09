import type { DbLeadHistory, DbLeadPipelineStatus, DbSequenceWithSteps } from './database'

/**
 * Unanswered-call automation for leads.
 *
 * The agents already record every failed call themselves — the "Contact
 * Attempt — No Answer" button in the lead history panel has been in use for a
 * while. This module only decides what should happen once those taps reach a
 * threshold; it adds no new way of counting and changes nothing about how a
 * call is recorded.
 */

/** How many unanswered attempts (the fifth included) move a lead on its own. */
export const NO_ANSWER_THRESHOLD = 5

/**
 * The target column is found by its NAME, not by a new database column or a
 * new enum value, so it is created from the Leads board's own "Add Status"
 * button and nothing has to be migrated. Until a status with one of these
 * names exists the whole automation stays dormant — no status, no move.
 */
const NO_ANSWER_LABELS = ['no answer', 'no-answer', 'אין מענה', 'ללא מענה']

export function findNoAnswerStatus(statuses: DbLeadPipelineStatus[]): DbLeadPipelineStatus | undefined {
  return statuses.find(status =>
    NO_ANSWER_LABELS.includes(status.label_en.trim().toLowerCase()) ||
    NO_ANSWER_LABELS.includes(status.label_he.trim()),
  )
}

/** The follow-up chain to start, found the same dormant-by-default way. */
const NO_ANSWER_SEQUENCE_KEYS = ['no_answer', 'noanswer']

export function findNoAnswerSequence(sequences: DbSequenceWithSteps[]): DbSequenceWithSteps | undefined {
  return sequences.find(sequence =>
    sequence.is_active &&
    sequence.steps.length > 0 &&
    NO_ANSWER_SEQUENCE_KEYS.includes(sequence.seq_key.trim().toLowerCase()),
  )
}

export function countNoAnswer(history: DbLeadHistory[]): number {
  return history.filter(entry => entry.kind === 'no_answer').length
}

/**
 * Which columns a lead may be carried OUT of automatically.
 *
 * Deliberately a short allow-list rather than a block-list: a lead that has a
 * meeting booked, is in production, asked to join or was archived by somebody
 * is not an unreachable lead, and moving it would quietly undo a person's own
 * decision. Anything not named here is left exactly where it is, however many
 * unanswered attempts it collects.
 */
const AUTO_MOVE_FROM_LEGACY = ['new', 'followup']
const AUTO_MOVE_FROM_LABELS = ['cold call']

export function mayAutoMove(from: DbLeadPipelineStatus | undefined, to: DbLeadPipelineStatus): boolean {
  if (!from || from.id === to.id || from.is_archived) return false
  const legacy = (from.legacy_status ?? '').trim()
  if (legacy && AUTO_MOVE_FROM_LEGACY.includes(legacy)) return true
  return AUTO_MOVE_FROM_LABELS.includes(from.label_en.trim().toLowerCase())
    || AUTO_MOVE_FROM_LABELS.includes(from.label_he.trim().toLowerCase())
}

/**
 * Whether this many attempts has earned the automatic move.
 *
 * Only ever asked right after a new attempt was recorded, which is what keeps
 * the existing data untouched: nothing sweeps the table on deploy, so a lead
 * already sitting on four or five old attempts moves on its next REAL failed
 * call and not before. It is `>=` rather than `===` so a move that could not
 * happen the first time — no "No Answer" column existed yet — is not lost
 * forever; moving twice is prevented by the status check and by the lead
 * already having an active chain, not by this number.
 */
export function reachedThreshold(attempts: number): boolean {
  return attempts >= NO_ANSWER_THRESHOLD
}
