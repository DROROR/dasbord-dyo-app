import { supabase } from './supabase'

export interface GoogleSheetSyncResult {
  created: number
  existing: number
  excluded?: number
  skipped: number
  total: number
}

export interface GoogleSheetSyncStatus {
  configured: boolean
  /** The second sheet (cold-call research list). Absent on an older service build. */
  coldCall?: {
    configured: boolean
    /** `sheet_row_key` prefix of rows imported from that sheet. */
    keyPrefix?: string | null
  }
}

export async function getGoogleSheetSyncStatus(): Promise<GoogleSheetSyncStatus> {
  const response = await fetch('/api/leads/google-sheet/health')
  if (!response.ok) throw new Error('Google Sheets sync service unavailable')
  return response.json()
}

async function runSheetSync(path: string, failureMessage: string): Promise<GoogleSheetSyncResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again')
  const response = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || failureMessage)
  return body as GoogleSheetSyncResult
}

export async function syncGoogleSheetLeads(): Promise<GoogleSheetSyncResult> {
  return runSheetSync('/api/leads/google-sheet/sync', 'Google Sheets sync failed')
}

/** The cold-call research sheet — lands in the `cold call` pipeline status. */
export async function syncColdCallLeads(): Promise<GoogleSheetSyncResult> {
  return runSheetSync('/api/leads/google-sheet/cold-call/sync', 'Cold-call sheet sync failed')
}
