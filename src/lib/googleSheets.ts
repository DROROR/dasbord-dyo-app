import { supabase } from './supabase'

export interface GoogleSheetSyncResult {
  created: number
  existing: number
  skipped: number
  total: number
}

export async function getGoogleSheetSyncStatus(): Promise<{ configured: boolean }> {
  const response = await fetch('/api/leads/google-sheet/health')
  if (!response.ok) throw new Error('Google Sheets sync service unavailable')
  return response.json()
}

export async function syncGoogleSheetLeads(): Promise<GoogleSheetSyncResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Please sign in again')
  const response = await fetch('/api/leads/google-sheet/sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Google Sheets sync failed')
  return body as GoogleSheetSyncResult
}
