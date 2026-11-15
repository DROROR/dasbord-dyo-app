// Deno Edge Function — receives an app deployment request from the web-admin
// and creates a task in the dashboard's app_deployment_request board.
// Auth: caller must pass the TICKET_WEBHOOK_SECRET value in the
// x-webhook-secret header (same secret as create-support-ticket).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically
// by the Supabase platform — never set manually.
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
      short_description,
      full_description,
      keywords,
      contact_email,
      app_category,
      age_group,
      target_platforms,
      logo_url,
      feature_url,
      mobile_screenshots_urls,
      tablet_screenshots_urls,
      privacy_policy_url,
      terms_of_use_url,
      push_notification_setup,
    } = body as Record<string, unknown>

    if (!app_name || typeof app_name !== 'string' || app_name.trim() === '') {
      return json({ error: 'app_name is required' }, 400)
    }

    const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error('Missing Supabase env vars')
      return json({ error: 'Server misconfiguration' }, 500)
    }

    // 3. Build a human-readable description block.
    const lines: string[] = []
    if (short_description && typeof short_description === 'string' && short_description.trim()) {
      lines.push(short_description.trim())
      lines.push('')
    }
    if (full_description && typeof full_description === 'string' && full_description.trim()) {
      lines.push('Full Description:')
      lines.push(full_description.trim())
      lines.push('')
    }
    if (keywords && typeof keywords === 'string' && keywords.trim()) {
      lines.push(`Keywords: ${keywords.trim()}`)
    }
    if (contact_email && typeof contact_email === 'string' && contact_email.trim()) {
      lines.push(`Contact Email: ${contact_email.trim()}`)
    }
    if (app_category && typeof app_category === 'string' && app_category.trim()) {
      lines.push(`Category: ${app_category.trim()}`)
    }
    if (age_group && typeof age_group === 'string' && age_group.trim()) {
      lines.push(`Age Group: ${age_group.trim()}`)
    }
    const platforms = Array.isArray(target_platforms) ? (target_platforms as string[]).join(', ') : ''
    if (platforms) lines.push(`Target Platforms: ${platforms}`)
    if (app_id && typeof app_id === 'string') lines.push(`App ID: ${app_id}`)

    // 4. Build the attachments array — logo, feature graphic, then screenshots.
    const attachments: Array<{ id: string; type: string; name: string; url: string }> = []

    const pushUrl = (url: unknown, name: string) => {
      if (typeof url === 'string' && url.trim()) {
        attachments.push({ id: crypto.randomUUID(), type: 'url', name, url: url.trim() })
      }
    }

    pushUrl(logo_url, 'App Logo')
    pushUrl(feature_url, 'Feature Graphic')

    if (Array.isArray(mobile_screenshots_urls)) {
      ;(mobile_screenshots_urls as string[]).forEach((url, i) => pushUrl(url, `Mobile Screenshot ${i + 1}`))
    }
    if (Array.isArray(tablet_screenshots_urls)) {
      ;(tablet_screenshots_urls as string[]).forEach((url, i) => pushUrl(url, `Tablet Screenshot ${i + 1}`))
    }

    // 5. Build the structured deployment_details object.
    const deploymentDetails: Record<string, unknown> = {}
    const put = (key: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') deploymentDetails[key] = value
    }
    put('short_description',       short_description)
    put('full_description',        full_description)
    put('keywords',                keywords)
    put('contact_email',           contact_email)
    put('app_category',            app_category)
    put('age_group',               age_group)
    put('target_platforms',        Array.isArray(target_platforms) && (target_platforms as string[]).length > 0 ? target_platforms : undefined)
    put('logo_url',                logo_url)
    put('feature_url',             feature_url)
    put('mobile_screenshots_urls', Array.isArray(mobile_screenshots_urls) && (mobile_screenshots_urls as string[]).length > 0 ? mobile_screenshots_urls : undefined)
    put('tablet_screenshots_urls', Array.isArray(tablet_screenshots_urls) && (tablet_screenshots_urls as string[]).length > 0 ? tablet_screenshots_urls : undefined)
    put('privacy_policy_url',      privacy_policy_url)
    put('terms_of_use_url',        terms_of_use_url)
    if (push_notification_setup !== undefined) deploymentDetails['push_notification_setup'] = !!push_notification_setup

    // 6. Insert the task using the service-role client (bypasses RLS).
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const now = new Date().toISOString()

    const { data, error } = await adminClient
      .from('tasks')
      .insert({
        title:             `App Deployment Request — ${(app_name as string).trim()}`,
        description:       lines.join('\n'),
        board:             'app_deployment_request',
        status:            'to_ask',
        priority:          'high',
        client_name:       (app_name as string).trim(),
        app_id:            typeof app_id === 'string' && app_id.trim() ? app_id.trim() : null,
        platforms:         ['mobile_app'],
        attachments,
        time_entries:      [],
        status_history:    [{ status: 'to_ask', timestamp: now, changedBy: 'System' }],
        comments:          [],
        deployment_details: Object.keys(deploymentDetails).length > 0 ? deploymentDetails : null,
        created_by:        'System',
        created_at:        now,
        updated_at:        now,
        claimed:           false,
        whatsapp_pending:  false,
        deployed_to_admin: false,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Failed to insert deployment task:', error)
      return json({ error: 'Failed to create task' }, 500)
    }

    return json({ task_id: data.id })
  } catch (err) {
    console.error('create-app-deployment-request unexpected error:', err)
    return json({ error: 'Unexpected error' }, 500)
  }
})
