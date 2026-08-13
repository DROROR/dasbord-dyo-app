// Deno Edge Function — the only real read/write path for the
// per-resource access map (work_docs.access / boards.access). Client
// UPDATEs to the `access` column are impossible after migration
// 20260809140000 (column privileges revoked) — this function is the
// enforcement, not just extra validation.
//
// Shared between work_docs and boards (rather than two near-identical
// functions) via a hardcoded resource-table allowlist — the client
// never gets to name an arbitrary table.
//
// Follows update-member-permissions' conventions: shared CORS
// headers, caller identified via their own JWT, privileged work done
// with a service-role client, generic client-facing errors with
// details logged server-side only, post-write re-read to verify.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'
import { corsHeaders } from '../_shared/cors.ts'
import { WORK_DOC_ACCESS_LEVELS, BOARD_ACCESS_LEVELS } from '../_shared/permissions.ts'

// work_doc_folders uses the exact same none/view/full vocabulary as
// work_docs — no new level constant needed.
const RESOURCE_TABLES = {
  work_docs: { levels: WORK_DOC_ACCESS_LEVELS as readonly string[] },
  boards: { levels: BOARD_ACCESS_LEVELS as readonly string[] },
  work_doc_folders: { levels: WORK_DOC_ACCESS_LEVELS as readonly string[] },
} as const
type ResourceTable = keyof typeof RESOURCE_TABLES

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405)
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      console.error('Missing required env vars for update-resource-access function')
      return json({ error: 'Server misconfiguration' }, 500)
    }

    // 1. Identify the caller.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !caller) return json({ error: 'Invalid session' }, 401)

    // 2. Verify the caller may manage access settings at all — this is
    //    deliberately can_manage_permissions() (owner, or admin
    //    explicitly granted permissions:'full'), not
    //    has_permission('work'/'work_docs','full'). Holding full
    //    section access to Work or Docs does not by itself authorize
    //    changing who can see a specific board or document.
    const { data: canManage, error: manageErr } = await callerClient.rpc('can_manage_permissions')
    if (manageErr) {
      console.error('can_manage_permissions() check failed:', manageErr)
      return json({ error: 'Could not verify permissions' }, 500)
    }
    if (!canManage) return json({ error: 'אין לך הרשאה לנהל הרשאות גישה' }, 403)

    // 3. Parse + shape-validate the payload before touching the DB.
    const body = await req.json().catch(() => ({}))
    const { table, resourceId, action } = body as {
      table?: string
      resourceId?: string
      action?: 'read' | 'write'
    }

    if (!table || !(table in RESOURCE_TABLES)) {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }
    const resourceTable = table as ResourceTable
    if (typeof resourceId !== 'string' || !resourceId) {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // 4a. Read path — returns the resource's current access map.
    //     Goes through this function (not a direct client select of
    //     the `access` column) so that "may view access settings" is
    //     enforced by the same can_manage_permissions() gate as
    //     "may change access settings", not just the write side.
    if (action === 'read') {
      const { data: row, error: readErr } = await adminClient
        .from(resourceTable)
        .select('id, access')
        .eq('id', resourceId)
        .maybeSingle()
      if (readErr) {
        console.error(`Failed to read ${resourceTable}.access:`, readErr)
        return json({ error: 'שגיאה לא צפויה' }, 500)
      }
      if (!row) return json({ error: 'המשאב לא נמצא' }, 404)
      return json({ access: row.access ?? {} })
    }

    // 4b. Write path.
    const { profileId, level } = body as { profileId?: string; level?: string }
    if (typeof profileId !== 'string' || !profileId) {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }
    if (typeof level !== 'string' || !RESOURCE_TABLES[resourceTable].levels.includes(level)) {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }

    // Owner always has implicit full access (has_doc_access/
    // has_board_access both bypass for is_owner) — their entry in the
    // stored map is never consulted, so writing one is meaningless and
    // rejected the same way update-member-permissions rejects editing
    // the owner's own permissions.
    const { data: targetProfile, error: targetErr } = await adminClient
      .from('profiles')
      .select('id, is_owner')
      .eq('id', profileId)
      .maybeSingle()
    if (targetErr) {
      console.error('Failed to load target profile:', targetErr)
      return json({ error: 'שגיאה לא צפויה' }, 500)
    }
    if (!targetProfile) return json({ error: 'משתמש לא נמצא' }, 404)
    if (targetProfile.is_owner) {
      return json({ error: 'לא ניתן להגדיר הרשאה למנהל הראשי' }, 403)
    }

    const { data: current, error: currentErr } = await adminClient
      .from(resourceTable)
      .select('id, access')
      .eq('id', resourceId)
      .maybeSingle()
    if (currentErr) {
      console.error(`Failed to load ${resourceTable} for access update:`, currentErr)
      return json({ error: 'שגיאה לא צפויה' }, 500)
    }
    if (!current) return json({ error: 'המשאב לא נמצא' }, 404)

    const nextAccess = { ...(current.access as Record<string, string> ?? {}), [profileId]: level }

    const { error: updateErr } = await adminClient
      .from(resourceTable)
      .update({ access: nextAccess })
      .eq('id', resourceId)
    if (updateErr) {
      console.error(`Failed to update ${resourceTable}.access:`, updateErr)
      return json({ error: 'השמירה נכשלה' }, 500)
    }

    // 5. Re-read to confirm and return the authoritative map.
    const { data: verified, error: verifyErr } = await adminClient
      .from(resourceTable)
      .select('access')
      .eq('id', resourceId)
      .maybeSingle()
    if (verifyErr || !verified) {
      console.error('Post-update verification failed:', verifyErr)
      return json({ error: 'השמירה בוצעה אך האימות נכשל, רענן ובדוק' }, 500)
    }

    return json({ access: verified.access })
  } catch (err) {
    console.error('update-resource-access unexpected error:', err)
    return json({ error: 'שגיאה לא צפויה' }, 500)
  }
})
