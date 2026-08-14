// Lets one page ask another to open a specific record — used by the
// notification panel to jump straight to the support ticket or the client it
// refers to. Written just before navigating, read and cleared on arrival.

const TASK_KEY   = 'focus_task_id'
const CLIENT_KEY = 'focus_client_id'

// Covers the case sessionStorage alone can't: the target page is already
// mounted (no navigation happens, so nothing re-reads sessionStorage).
// Cross-page navigation keeps working exactly as before — the event fires
// too, but the destination page hasn't mounted its listener yet, so it
// simply falls through to reading sessionStorage on mount, same as always.
export const TASK_FOCUS_EVENT = 'work:taskFocusRequested'

export function requestTaskFocus(taskId: string) {
  sessionStorage.setItem(TASK_KEY, taskId)
  window.dispatchEvent(new CustomEvent<string>(TASK_FOCUS_EVENT, { detail: taskId }))
}

export function requestClientFocus(clientId: string) {
  sessionStorage.setItem(CLIENT_KEY, clientId)
}

/** Returns the requested id once, then forgets it. */
export function takeTaskFocus(): string | null {
  const id = sessionStorage.getItem(TASK_KEY)
  if (id) sessionStorage.removeItem(TASK_KEY)
  return id
}

/** Returns the requested id once, then forgets it. */
export function takeClientFocus(): string | null {
  const id = sessionStorage.getItem(CLIENT_KEY)
  if (id) sessionStorage.removeItem(CLIENT_KEY)
  return id
}
