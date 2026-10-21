// Deno Edge Function — receives a support ticket from the web-admin and
// creates a task in the dashboard's support board.
// Auth: caller must pass the TICKET_WEBHOOK_SECRET value in the
// x-webhook-secret header. Set this secret in the Supabase dashboard →
// Edge Functions → Secrets before deploying.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the Supabase platform — never set manually.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

// The admin's urgency, mapped onto a priority the support board actually
// defines. Its priorities are critical | high | medium | low, so 'urgent' was
// writing an id no board knows: the card then resolved no priority definition
// and showed a grey "No priority" instead of the urgency the person had just
// chosen, and the priority filter could not find those tickets either.
// 'critical' is the board's own top priority (and the one flagged
// showInSupportQueue), which is what "urgent" means here.
const URGENCY_TO_PRIORITY: Record<string, string> = {
  normal: 'medium',
  high:   'high',
  urgent: 'critical',
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

    // 1. Validate the shared secret.
    const WEBHOOK_SECRET = Deno.env.get('TICKET_WEBHOOK_SECRET')
    if (!WEBHOOK_SECRET) {
      console.error('TICKET_WEBHOOK_SECRET env var is not set')
      return json({ error: 'Server misconfiguration' }, 500)
    }
    const callerSecret = req.headers.get('x-webhook-secret')
    if (!callerSecret || callerSecret !== WEBHOOK_SECRET) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // 2. Parse and validate the request body.
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const {
      app_id,
      app_name,
      ticket_id,
      subject,
      description,
      urgency,
      category,
      user_id,
      attachment_url,
      // The ticket wizard's own fields. Each is sent only when the chosen
      // system area calls for it, so every one of them is optional and a
      // ticket from the old admin build (which sends none of them) still
      // creates exactly the task it always did.
      system_area,
      admin_tab,
      app_scope,
      app_screen,
      web_component,
      lesson_id,
      user_phone,
      device_info,
      page_url,
    } = body as Record<string, string | undefined>

    if (!subject || typeof subject !== 'string' || subject.trim() === '') {
      return json({ error: 'subject is required' }, 400)
    }
    if (!app_name || typeof app_name !== 'string' || app_name.trim() === '') {
      return json({ error: 'app_name is required' }, 400)
    }

    const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')
    const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('Missing Supabase env vars')
      return json({ error: 'Server misconfiguration' }, 500)
    }

    // 3. Build the task description — a clean block combining all ticket info.
    const descriptionLines: string[] = []
    if (description && description.trim()) {
      descriptionLines.push(description.trim())
      descriptionLines.push('')
    }
    descriptionLines.push(`Category: ${category ?? 'general'}`)
    if (user_id)   descriptionLines.push(`User ID: ${user_id}`)
    if (app_id)    descriptionLines.push(`App ID: ${app_id}`)
    if (ticket_id) descriptionLines.push(`Ticket ID: ${ticket_id}`)
    if (attachment_url) descriptionLines.push(`Attachment: ${attachment_url}`)

    // 4. Build the attachments array — only populated when an image was uploaded.
    const attachments: Array<{ id: string; type: string; name: string; url: string }> = []
    if (attachment_url && attachment_url.trim() !== '') {
      attachments.push({
        id:   crypto.randomUUID(),
        type: 'url',
        name: 'Ticket Attachment',
        url:  attachment_url.trim(),
      })
    }

    const now      = new Date().toISOString()
    const priority = URGENCY_TO_PRIORITY[urgency ?? ''] ?? 'medium'

    // 4b. The structured copy of the ticket, for the two board tabs (which
    // split on `category`) and the details block in the task modal. Only the
    // keys that arrived with a value are stored, so an empty object means a
    // ticket from an admin build that does not send them yet and the column
    // stays null rather than holding nine empty strings.
    // The description lines built above are kept exactly as they were: the
    // tickets already on the board carry their App ID / Ticket ID only there,
    // and the dashboard still reads them back out of that text.
    const ticketDetails: Record<string, string> = {}
    const putDetail = (key: string, value: string | undefined) => {
      if (typeof value === 'string' && value.trim() !== '') ticketDetails[key] = value.trim()
    }
    putDetail('category',      category)
    putDetail('system_area',   system_area)
    putDetail('admin_tab',     admin_tab)
    putDetail('app_scope',     app_scope)
    putDetail('app_screen',    app_screen)
    putDetail('web_component', web_component)
    putDetail('lesson_id',     lesson_id)
    putDetail('user_phone',    user_phone)
    putDetail('device_info',   device_info)
    putDetail('page_url',      page_url)

    // 5. Insert the task using the service-role client (bypasses RLS).
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data, error } = await adminClient
      .from('tasks')
      .insert({
        title:          subject.trim(),
        description:    descriptionLines.join('\n'),
        board:          'support',
        status:         'not_started',
        priority,
        client_name:    app_name.trim(),
        platforms:      ['mobile_app'],
        attachments,
        time_entries:   [],
        status_history: [{ status: 'not_started', timestamp: now, changedBy: 'System' }],
        comments:       [],
        ticket_id:      ticket_id ?? null,
        app_id:         app_id    ?? null,
        ticket_details: Object.keys(ticketDetails).length > 0 ? ticketDetails : null,
        created_by:     'System',
        created_at:     now,
        updated_at:     now,
        claimed:        false,
        whatsapp_pending: false,
        deployed_to_admin: false,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to insert task:', error)
      return json({ error: 'Failed to create task' }, 500)
    }

    return json({ task_id: data.id })
  } catch (err) {
    console.error('create-support-ticket unexpected error:', err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
