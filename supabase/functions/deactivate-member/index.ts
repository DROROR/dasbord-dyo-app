// Deno Edge Function — safe deactivation, not deletion. Sets
// profiles.is_active = false and bans the corresponding Auth user.
// Follows create-member/update-member-permissions' conventions:
// shared CORS headers, caller identified via their own JWT,
// privileged work done with a service-role client only after
// authorization succeeds, generic client-facing errors with details
// logged server-side only (never the JWT/keys/password), post-write
// re-read to verify.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'
import { corsHeaders } from '../_shared/cors.ts'

// See the accompanying report: the installed Supabase SDK
// (@supabase/auth-js, checked locally) exposes ban_duration on
// updateUserById as the documented way to block future sign-in/token
// refresh, but no admin call to invalidate an already-issued session
// by user id (admin.signOut() needs a live JWT, which this function
// never has). ban_duration alone is therefore not sufficient on its
// own — is_active is also threaded through has_permission() and every
// other central RLS gate (see 20260810101000_rls_rpc_identity_and_queue.sql)
// so a still-valid existing token stops working at the DB layer
// immediately, regardless of the Auth-level ban.
const BAN_DURATION = '876000h' // ~100 years, the SDK's own documented example for a permanent ban

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
      console.error('Missing required env vars for deactivate-member function')
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

    // 2. Authorize via can_manage_permissions() — same shared RPC as
    //    create-member/update-member-permissions.
    const { data: canManage, error: manageErr } = await callerClient.rpc('can_manage_permissions')
    if (manageErr) {
      console.error('can_manage_permissions() check failed:', manageErr)
      return json({ error: 'Could not verify permissions' }, 500)
    }
    if (!canManage) return json({ error: 'אין לך הרשאה להשבית משתמשים' }, 403)

    // 3. Validate input.
    const body = await req.json().catch(() => ({}))
    const { targetId } = body as { targetId?: string }
    if (typeof targetId !== 'string' || !targetId) {
      return json({ error: 'בקשה לא תקינה' }, 400)
    }

    // 4. Construct the service-role client only now, after
    //    authorization has already succeeded.
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

    // 5. Reject the Owner outright.
    if (targetRow.is_owner) {
      return json({ error: 'לא ניתן להשבית את המנהל הראשי' }, 403)
    }

    // 6. Reject an already-inactive profile cleanly (not an error the
    //    caller did anything wrong to cause — just nothing to do).
    if (targetRow.is_active === false) {
      return json({ error: 'המשתמש כבר מושבת' }, 409)
    }

    // 7. Deactivate: is_active=false, and ban the Auth user so future
    //    sign-in/token-refresh attempts fail. Order matters: flip
    //    is_active first so that even if the ban call below fails for
    //    some reason, the DB-level gates (has_permission() etc.)
    //    already stop working for this user immediately.
    const { error: updateErr } = await adminClient
      .from('profiles')
      .update({ is_active: false })
      .eq('id', targetId)
    if (updateErr) {
      console.error('Failed to set is_active=false:', updateErr)
      return json({ error: 'ההשבתה נכשלה' }, 500)
    }

    const { error: banErr } = await adminClient.auth.admin.updateUserById(targetId, {
      ban_duration: BAN_DURATION,
    })
    if (banErr) {
      // is_active is already false at this point — the account is
      // already functionally locked out at the DB layer even if the
      // Auth-level ban failed. Report the partial failure rather than
      // claiming full success.
      console.error('Failed to ban Auth user during deactivation:', banErr)
      return json({ error: 'ההשבתה בוצעה חלקית — עודכן בבסיס הנתונים אך חסימת ההתחברות נכשלה, נסה שוב' }, 500)
    }

    // 8. Re-read to confirm and verify final state before returning success.
    const { data: verified, error: verifyErr } = await adminClient
      .from('profiles')
      .select('id, name, email, is_active, is_owner')
      .eq('id', targetId)
      .maybeSingle()
    if (verifyErr || !verified || verified.is_active !== false) {
      console.error('Post-deactivation verification failed:', verifyErr ?? verified)
      return json({ error: 'ההשבתה בוצעה אך האימות נכשל, רענן ובדוק' }, 500)
    }

    return json({ profile: verified })
  } catch (err) {
    console.error('deactivate-member unexpected error:', err)
    return json({ error: 'שגיאה לא צפויה' }, 500)
  }
})
