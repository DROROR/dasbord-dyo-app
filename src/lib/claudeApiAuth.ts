import { supabase } from './supabase'

/**
 * Puts the signed-in user's Supabase token on every request the app makes to
 * /api/claude/.
 *
 * Those endpoints reach a paid Anthropic account and the ticket webhooks, and
 * until now they asked the caller for nothing at all: anyone who knew the URL
 * could spend the account's money from a terminal. nginx caps the rate, which
 * is a ceiling rather than an answer; the answer is the proxy knowing who is
 * calling, and this is the half of it that runs in the browser.
 *
 * It is done by wrapping fetch once rather than by editing the sixteen call
 * sites. Those sites are spread over five files and a seventeenth is added
 * every time the app grows — one that forgot the header would fail only in
 * production, and only for whoever used that feature. Here nothing can be
 * forgotten: the rule is "requests to this prefix carry the token", and it is
 * written in exactly one place.
 *
 * Everything else about fetch is untouched: other URLs pass straight through,
 * an explicit Authorization header is left alone, and a request made while
 * nobody is signed in goes out exactly as it did before — the proxy decides
 * what to do with it, not the browser.
 */
const PREFIX = '/api/claude/'

export function installClaudeApiAuth() {
  const original = window.fetch
  if ((window.fetch as { __claudeAuth?: boolean }).__claudeAuth) return

  const wrapped: typeof window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.toString()
      : input.url
    // Only our own proxy, and only when the caller has not set its own header.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!url.startsWith(PREFIX) || headers.has('Authorization')) {
      return original(input as RequestInfo, init)
    }
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (token) headers.set('Authorization', `Bearer ${token}`)
    } catch {
      // No session, or storage is unreadable. Send it as it was and let the
      // proxy answer — a failure to read the token must never swallow the
      // request itself.
    }
    return original(input as RequestInfo, { ...init, headers })
  }

  ;(wrapped as { __claudeAuth?: boolean }).__claudeAuth = true
  window.fetch = wrapped
}
