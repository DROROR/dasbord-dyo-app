export type Channel = 'service' | 'sales'

// Template IDs 1-7 (regular templates) → service; warming sequences → sales
const SERVICE_TEMPLATE_IDS = new Set(['1', '2', '3', '4', '5', '6', '7'])

export function getTemplateChannel(templateId: string | null): Channel {
  if (!templateId) return 'service'
  return SERVICE_TEMPLATE_IDS.has(templateId) ? 'service' : 'sales'
}

export function getRecipientChannel(recipientType: 'client' | 'lead'): Channel {
  return recipientType === 'client' ? 'service' : 'sales'
}

export function getChannelLabel(channel: Channel): string {
  return channel === 'service' ? 'שירות' : 'מכירות'
}

// There used to be a sendWhatsApp() here that read
// VITE_GREEN_API_TOKEN_SALES / _SERVICE straight out of import.meta.env.
//
// Anything named VITE_* is compiled into the JavaScript the browser downloads,
// so those two tokens would have been published to everyone the moment they
// were given values — and with them, anybody could send WhatsApp messages from
// the business number. The tokens happen to be empty today, which is the only
// reason nothing leaked.
//
// Nothing ever called that function. It is gone, and with it the only
// reference to those variables, so filling them in can no longer publish them.
// Sending is the server's job: server/lead-sequence-worker.mjs talks to Green
// API with GREEN_API_INSTANCE_SALES / GREEN_API_TOKEN_SALES — no VITE_ prefix,
// never bundled. Anything the browser needs sent must go through an endpoint
// on the proxy, never straight to Green API.
