import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
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

    const WEBHOOK_SECRET = Deno.env.get('TICKET_WEBHOOK_SECRET')
    if (!WEBHOOK_SECRET) {
      console.error('TICKET_WEBHOOK_SECRET env var is not set')
      return json({ error: 'Server misconfiguration' }, 500)
    }
    const callerSecret = req.headers.get('x-webhook-secret')
    if (!callerSecret || callerSecret !== WEBHOOK_SECRET) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const { ticket_id, app_id, ticket_subject, reply_text } = body as Record<string, string | undefined>

    if (!ticket_id || !ticket_subject || !reply_text) {
      return json({ error: 'ticket_id, ticket_subject, and reply_text are required' }, 400)
    }

    const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('Missing Supabase env vars')
      return json({ error: 'Server misconfiguration' }, 500)
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { error } = await adminClient
      .from('notifications')
      .insert({
        type:       'ticket_reply',
        message:    `Admin replied to ticket: ${ticket_subject.trim()}`,
        task_id:    null,
        task_title: ticket_subject.trim(),
        client_id:  app_id ?? null,
        timestamp:  new Date().toISOString(),
        read:       false,
        severity:   'normal',
      })

    if (error) {
      console.error('Failed to insert notification:', error)
      return json({ error: 'Failed to save notification' }, 500)
    }

    return json({ success: true })
  } catch (err) {
    console.error('notify-admin-replied unexpected error:', err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
