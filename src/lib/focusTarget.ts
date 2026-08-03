// Lets one page ask another to open a specific record — used by the
// notification panel to jump straight to the support ticket or the client it
// refers to. Written just before navigating, read and cleared on arrival.

const TASK_KEY   = 'focus_task_id'
const CLIENT_KEY = 'focus_client_id'

export function requestTaskFocus(taskId: string) {
  sessionStorage.setItem(TASK_KEY, taskId)
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
