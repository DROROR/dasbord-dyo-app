// Deno Edge Function — creates a real Supabase Auth user + profiles row for
// a new team member, verifying the caller is an admin first.
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by the Supabase platform into every Edge Function — never
// set manually, never exposed to the client.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'
import { corsHeaders } from '../_shared/cors.ts'
import { DEFAULT_STAFF_PERMISSIONS } from '../_shared/permissions.ts'

function randomPassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => chars[b % chars.length]).join('')
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
      console.error('Missing required env vars for create-member function')
      return json({ error: 'Server misconfiguration' }, 500)
    }

    // 1. Identify the caller from their JWT (forwarded automatically by
    //    supabase.functions.invoke via the Authorization header).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: caller }, error: userErr } = await callerClient.auth.getUser()
    if (userErr || !caller) return json({ error: 'Invalid session' }, 401)

    // 2. Verify the caller may manage team members — reuse the shared
    //    can_manage_permissions() SQL function (security definer, same
    //    one the update-member-permissions function relies on) so the
    //    rule is defined in exactly one place. Under the 3-tier model,
    //    role='admin' alone is NOT enough — only the owner, or an admin
    //    explicitly granted permissions.permissions='full', may invite.
    const { data: canManage, error: manageErr } = await callerClient.rpc('can_manage_permissions')
    if (manageErr) {
      console.error('can_manage_permissions() check failed:', manageErr)
      return json({ error: 'Could not verify permissions' }, 500)
    }
    if (!canManage) return json({ error: 'Admins only' }, 403)

    // 3. Validate input.
    const { email, name } = await req.json().catch(() => ({}))
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return json({ error: 'כתובת אימייל לא תקינה' }, 400)
    }
    const cleanEmail = email.trim().toLowerCase()
    const cleanName = typeof name === 'string' && name.trim() ? name.trim() : undefined

    // 4. Generate the real password server-side — never trust a
    //    client-supplied password.
    const password = randomPassword()

    // 5. Create the auth user with the service-role client.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: cleanEmail,
      password,
      email_confirm: true,
      user_metadata: cleanName ? { name: cleanName } : undefined,
    })

    if (createErr) {
      const msg = /already registered|already exists/i.test(createErr.message)
        ? 'כבר קיים משתמש עם כתובת אימייל זו'
        : createErr.message
      return json({ error: msg }, 400)
    }

    const newUserId = created.user?.id
    if (!newUserId) {
      console.error('createUser succeeded but returned no user id')
      return json({ error: 'שגיאה לא צפויה ביצירת המשתמש' }, 500)
    }

    // 6. Explicitly ensure a valid profiles row exists — do not rely solely
    //    on the DB trigger (handle_new_user) as an implicit side effect,
    //    since this project's live schema has already been found to drift
    //    from what's committed in schema.sql. Only columns actually used
    //    elsewhere in the app (DbProfile: id, name, email, role,
    //    permissions, is_technical_support, created_at) are referenced —
    //    nothing invented here.
    const rollback = async (reason: string, detail: unknown) => {
      console.error(reason, detail)
      const { error: deleteErr } = await adminClient.auth.admin.deleteUser(newUserId)
      if (deleteErr) {
        console.error('Rollback failed — orphaned auth user left behind:', deleteErr)
      }
      return json({ error: 'יצירת חבר הצוות נכשלה, נסה שוב' }, 500)
    }

    const { data: existingProfile, error: fetchErr } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', newUserId)
      .maybeSingle()

    if (fetchErr) {
      return await rollback('Failed to check for existing profile row:', fetchErr)
    }

    // Only insert if the trigger hasn't already created the row — never
    // touch/overwrite an existing row, so any unrelated data on it (set by
    // the trigger or anything else) is left exactly as-is.
    if (!existingProfile) {
      const { error: insertErr } = await adminClient
        .from('profiles')
        .insert({
          id: newUserId,
          name: cleanName ?? cleanEmail.split('@')[0],
          email: cleanEmail,
          role: 'staff', // lowest-privilege default role — never 'admin' here
          // Set explicitly rather than relying only on the column default
          // (migration 20260809120000) or the handle_new_user() trigger —
          // this is the fallback path that runs precisely when the
          // trigger did NOT create the row, so it must not depend on
          // trigger-adjacent defaults either. Imported from the shared
          // module rather than duplicated, so a new page's default (e.g.
          // bot_training) only has to be added in one place.
          permissions: DEFAULT_STAFF_PERMISSIONS,
        })
      if (insertErr) {
        return await rollback('Failed to insert profile row for new member:', insertErr)
      }
    }

    // 7. Re-read the row to confirm it now exists with the correct role,
    //    regardless of which path created it above.
    const { data: verifiedProfile, error: verifyErr } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('id', newUserId)
      .maybeSingle()

    if (verifyErr || !verifiedProfile || verifiedProfile.role !== 'staff') {
      return await rollback('Post-creation profile verification failed:', verifyErr ?? verifiedProfile)
    }

    return json({ password, userId: newUserId })
  } catch (err) {
    console.error('create-member unexpected error:', err)
    return json({ error: 'שגיאה לא צפויה' }, 500)
  }
})
