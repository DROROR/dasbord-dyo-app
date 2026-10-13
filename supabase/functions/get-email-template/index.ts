// Public GET endpoint — no user auth required.
// Called by the AI agent after createVendorUser to fetch the admin-configured
// email template. Returns the singleton row from email_template, falling back
// to hardcoded defaults if the table is somehow empty.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'
import { corsHeaders } from '../_shared/cors.ts'

const DEFAULTS = {
  subject:    'Welcome to DYO — Your Login Details',
  header:     'Welcome aboard!',
  body_above: 'Here are your login details to access the platform:',
  body_below: 'If you have any questions, feel free to reach out to us.',
  footer:     'The DYO Team',
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

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing env vars for get-email-template')
    return json({ error: 'Server misconfiguration' }, 500)
  }

  try {
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data, error } = await adminClient
      .from('email_template')
      .select('subject, header, body_above, body_below, footer')
      .eq('id', 1)
      .maybeSingle()

    if (error) {
      console.error('Failed to fetch email template:', error)
      return json({ error: 'Failed to fetch template' }, 500)
    }

    return json(data ?? DEFAULTS)
  } catch (err) {
    console.error('get-email-template unexpected error:', err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
