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

function buildApiUrl(instanceId: string, token: string): string {
  return `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`
}

function formatChatId(phone: string): string {
  const digits     = phone.replace(/\D/g, '')
  const normalized = digits.startsWith('0') ? `972${digits.slice(1)}` : digits
  return `${normalized}@c.us`
}

export async function sendWhatsApp(
  phone: string,
  message: string,
  recipientType: 'client' | 'lead',
): Promise<void> {
  const channel = getRecipientChannel(recipientType)

  const instanceId = channel === 'service'
    ? import.meta.env.VITE_GREEN_API_INSTANCE_SERVICE
    : import.meta.env.VITE_GREEN_API_INSTANCE_SALES
  const token = channel === 'service'
    ? import.meta.env.VITE_GREEN_API_TOKEN_SERVICE
    : import.meta.env.VITE_GREEN_API_TOKEN_SALES

  if (!instanceId || !token) {
    throw new Error(`WhatsApp channel "${channel}" is not configured`)
  }

  const url    = buildApiUrl(instanceId as string, token as string)
  const chatId = formatChatId(phone)

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chatId, message }),
  })

  if (!response.ok) {
    throw new Error(`WhatsApp send failed: ${response.status}`)
  }
}
