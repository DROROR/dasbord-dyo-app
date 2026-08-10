// Deno Edge Function — the only real write path for a profile's
// role/permissions/is_technical_support. Client-side UPDATEs to
// these columns are impossible after migration 001 (column
// privileges revoked), so this function is not just "extra"
// validation on top of the UI — it is the enforcement.
//
// Follows create-member's conventions: shared CORS headers, caller
// identified via their own JWT, privileged work done with a
// service-role client, generic client-facing errors with details
// logged server-side only, post-write re-read to verify.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'
import { corsHeaders } from '../_shared/cors.ts'
import { MODULES, LEVELS, rankOf, type PermissionModule } from '../_shared/permissions.ts'

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
      console.error('Missing required env vars for update-member-permissions function')
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

    // 2. Verify the caller may manage members at all.
    const { data: canManage, error: manageErr } = await callerClient.rpc('can_manage_permissions')
    if (manageErr) {
      console.error('can_manage_permissions() check failed:', manageErr)
      return json({ error: 'Could not verify permissions' }, 500)
    }
    if (!canManage) return json({ error: 'אין לך הרשאה לנהל משתמשים' }, 403)

    // 3. Parse + shape-validate the payload before touching the DB.
    const body = await req.json().catch(() => ({}))
    const { targetId, role, permissions, is_technical_support } = body as {
      targetId?: string
      role?: string
      permissions?: Record<string, string>
      is_technical_support?: boolean
    }

    if (typeof targetId !== 'string' || !targetId) {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }
    if (role !== undefined && role !== 'admin' && role !== 'staff') {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }
    let cleanPermissions: Record<string, string> | undefined
    if (permissions !== undefined) {
      if (typeof permissions !== 'object' || permissions === null) {
        return json({ error: 'בקשה לא תקינה' }, 400)
      }
      for (const [mod, level] of Object.entries(permissions)) {
        if (!MODULES.includes(mod as PermissionModule) || !LEVELS.includes(level as typeof LEVELS[number])) {
          return json({ error: 'בקשה לא תקינה' }, 400)
        }
      }
      cleanPermissions = permissions
    }
    if (is_technical_support !== undefined && typeof is_technical_support !== 'boolean') {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }

    // 4. Load caller + target with the service client (bypasses RLS —
    //    we're doing the authorization ourselves, explicitly, below).
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const [{ data: callerRow, error: callerErr }, { data: targetRow, error: targetErr }] = await Promise.all([
      adminClient.from('profiles').select('id, role, permissions, is_owner').eq('id', caller.id).maybeSingle(),
      adminClient.from('profiles').select('id, role, permissions, is_owner').eq('id', targetId).maybeSingle(),
    ])
    if (callerErr || !callerRow) {
      console.error('Failed to load caller profile:', callerErr)
      return json({ error: 'שגיאה לא צפויה' }, 500)
    }
    if (targetErr) {
      console.error('Failed to load target profile:', targetErr)
      return json({ error: 'שגיאה לא צפויה' }, 500)
    }
    if (!targetRow) return json({ error: 'משתמש לא נמצא' }, 404)

    // 5. Authorization — reject in order, no exceptions:
    if (targetRow.is_owner) {
      return json({ error: 'לא ניתן לערוך את המנהל הראשי' }, 403)
    }
    if (targetRow.id === callerRow.id) {
      return json({ error: 'לא ניתן לערוך את ההרשאות של עצמך' }, 403)
    }
    if (role !== undefined && !callerRow.is_owner) {
      return json({ error: 'רק המנהל הראשי יכול לשנות תפקיד' }, 403)
    }
    if (cleanPermissions !== undefined && !callerRow.is_owner) {
      const callerPerms = (callerRow.permissions ?? {}) as Record<string, string>
      for (const [mod, level] of Object.entries(cleanPermissions)) {
        const requested = rankOf(level)
        const held = rankOf(callerPerms[mod] ?? 'none')
        if (requested === null || held === null || requested > held) {
          return json({ error: 'לא ניתן להעניק הרשאה שאין לך בעצמך' }, 403)
        }
      }
    }

    // 6. Apply the update.
    const updates: Record<string, unknown> = {}
    if (role !== undefined) updates.role = role
    if (cleanPermissions !== undefined) updates.permissions = cleanPermissions
    if (is_technical_support !== undefined) updates.is_technical_support = is_technical_support

    if (Object.keys(updates).length === 0) {
      return json({ error: 'אין שינויים לשמירה' }, 400)
    }

    const { error: updateErr } = await adminClient.from('profiles').update(updates).eq('id', targetId)
    if (updateErr) {
      console.error('Failed to update target profile:', updateErr)
      return json({ error: 'השמירה נכשלה' }, 500)
    }

    // 7. Re-read to confirm and return the authoritative row.
    const { data: verified, error: verifyErr } = await adminClient
      .from('profiles')
      .select('id, name, email, role, permissions, is_technical_support, is_owner')
      .eq('id', targetId)
      .maybeSingle()
    if (verifyErr || !verified) {
      console.error('Post-update verification failed:', verifyErr)
      return json({ error: 'השמירה בוצעה אך האימות נכשל, רענן ובדוק' }, 500)
    }

    return json({ profile: verified })
  } catch (err) {
    console.error('update-member-permissions unexpected error:', err)
    return json({ error: 'שגיאה לא צפויה' }, 500)
  }
})
