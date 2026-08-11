// Deno Edge Function — generates a new random password for an
// existing member and returns it once. Never stores or logs it.
// Follows create-member/update-member-permissions' conventions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'
import { corsHeaders } from '../_shared/cors.ts'

// Same generator as create-member — kept duplicated rather than
// shared to avoid coupling two independent Edge Functions' deploy
// lifecycles to a third shared module for four lines of code.
function randomPassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

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
      console.error('Missing required env vars for reset-member-password function')
      return json({ error: 'Server misconfiguration' }, 500)
    }

    // 1. Identify the caller from their own JWT.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !caller) return json({ error: 'Invalid session' }, 401)

    // 2. Authorize via can_manage_permissions().
    const { data: canManage, error: manageErr } = await callerClient.rpc('can_manage_permissions')
    if (manageErr) {
      console.error('can_manage_permissions() check failed:', manageErr)
      return json({ error: 'Could not verify permissions' }, 500)
    }
    if (!canManage) return json({ error: 'אין לך הרשאה לאפס סיסמה' }, 403)

    // 3. Validate input.
    const body = await req.json().catch(() => ({}))
    const { targetId } = body as { targetId?: string }
    if (typeof targetId !== 'string' || !targetId) {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }

    // 4. Construct the service-role client only after authorization.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: targetRow, error: targetErr } = await adminClient
      .from('profiles')
      .select('id, is_owner, is_active')
      .eq('id', targetId)
      .maybeSingle()
    if (targetErr) {
      console.error('Failed to load target profile:', targetErr)
      return json({ error: 'שגיאה לא צפויה' }, 500)
    }
    if (!targetRow) return json({ error: 'משתמש לא נמצא' }, 404)

    // 5. Reject the Owner as a target.
    if (targetRow.is_owner) {
      return json({ error: 'לא ניתן לאפס סיסמה למנהל הראשי' }, 403)
    }

    // 6. Reject inactive users — no explicit safe reason to allow a
    //    password reset for a deactivated account was identified, so
    //    the safer default is to refuse. Reactivate first if a real
    //    need arises.
    if (targetRow.is_active === false) {
      return json({ error: 'לא ניתן לאפס סיסמה למשתמש מושבת' }, 403)
    }

    // 7. Generate a cryptographically secure password server-side —
    //    never trust a client-supplied one, never log it.
    const password = randomPassword()

    // 8. Update the Auth user through the service-role client. Per
    //    the installed Supabase SDK's own documentation (checked
    //    locally — see the accompanying report), updateUserById does
    //    not by itself invalidate already-issued sessions, and there
    //    is no admin call in this SDK version to revoke sessions by
    //    user id (only by a live JWT, which this function doesn't
    //    have). A changed password blocks future sign-ins with the
    //    old credential; it does not forcibly end an existing one.
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetId, { password })
    if (updateErr) {
      console.error('Failed to update Auth password:', updateErr)
      return json({ error: 'איפוס הסיסמה נכשל' }, 500)
    }

    // 9. Read back non-sensitive state only — never the password —
    //    to confirm the operation reached a real user record.
    const { data: verified, error: verifyErr } = await adminClient
      .from('profiles')
      .select('id, name, email')
      .eq('id', targetId)
      .maybeSingle()
    if (verifyErr || !verified) {
      console.error('Post-reset verification failed:', verifyErr)
      return json({ error: 'הסיסמה עודכנה אך האימות נכשל, ודא עם המשתמש שההתחברות עובדת' }, 500)
    }

    return json({ password })
  } catch (err) {
    console.error('reset-member-password unexpected error:', err)
    return json({ error: 'שגיאה לא צפויה' }, 500)
  }
})
