import { useAuth } from './useAuth'
import type { PermissionLevel, PermissionModule } from '../lib/permissions'

export function useCan(module: PermissionModule, level: PermissionLevel = 'edit'): boolean {
  return useAuth().hasPermission(module, level)
}
