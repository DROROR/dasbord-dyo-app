import type { ReactNode } from 'react'
import { useCan } from '../hooks/useCan'
import type { PermissionLevel, PermissionModule } from '../lib/permissions'

// Hides/disables affordances. Not sufficient on its own for real
// protection — pair with a useCan() check at the top of the actual
// write handler, since hiding a button doesn't stop a drag gesture,
// an autosave-on-blur, or a call typed directly into devtools.
export function Guard({ module, level = 'edit', children, fallback = null }: {
  module: PermissionModule
  level?: PermissionLevel
  children: ReactNode
  fallback?: ReactNode
}) {
  return useCan(module, level) ? <>{children}</> : <>{fallback}</>
}
