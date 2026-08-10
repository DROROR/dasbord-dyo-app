// Mirrors the PAGES registry in src/lib/permissions.ts (Vite/browser
// side, the source of truth for module keys, levels, and per-module
// staff defaults) and permission_rank()/has_permission() in
// supabase/migrations/20260809120000_owner_tier_and_profile_lockdown.sql
// (Postgres side). All three must stay in step — this is the
// Deno-side copy since Vite and Deno cannot share one file directly.
// No labels/icons/nav here — Edge Functions don't render UI, they
// only need the module list, levels, and defaults for validation.

export const MODULES = [
  'dashboard', 'clients', 'billing', 'whatsapp', 'leads', 'agents', 'bot_training', 'work', 'work_docs', 'pricing', 'permissions',
] as const
export type PermissionModule = typeof MODULES[number]

export const LEVELS = ['none', 'view', 'edit', 'send', 'full'] as const
export type PermissionLevel = typeof LEVELS[number]

const RANK: Record<string, number> = { none: 0, view: 1, edit: 2, send: 2, full: 3 }

// Returns null (not a numeric fallback) for anything unrecognized —
// see the matching comment on permission_rank() in migration
// 20260809120000 for why that's what keeps comparisons fail-closed in
// both directions.
export function rankOf(level: unknown): number | null {
  return typeof level === 'string' && level in RANK ? RANK[level] : null
}

// work_docs defaults to 'none' — a brand-new staff member sees no
// documents until explicitly granted section access (see
// 20260809140000_docs_and_board_access.sql).
export const DEFAULT_STAFF_PERMISSIONS: Record<PermissionModule, PermissionLevel> = {
  dashboard: 'view', clients: 'view', billing: 'none',
  whatsapp: 'none', leads: 'view', agents: 'none', bot_training: 'none',
  work: 'edit', work_docs: 'none', pricing: 'none', permissions: 'none',
}

// Boards use a separate, 4-value access vocabulary (none/view/comment/full,
// src/types/work.ts AccessLevel) that doesn't fully overlap with the
// module-permission LEVELS above ('comment' isn't a module level) —
// mirrors board_access_rank() in
// 20260809140000_docs_and_board_access.sql. Used only for validating
// the `level` field of an update-resource-access request targeting
// boards; the database's own board_access_rank()/has_board_access()
// remain the actual authorization source of truth.
export const BOARD_ACCESS_LEVELS = ['none', 'view', 'comment', 'full'] as const
export type BoardAccessLevel = typeof BOARD_ACCESS_LEVELS[number]

// work_docs uses the 3-value module vocabulary (none/view/full — a
// subset of LEVELS), so it needs no separate list.
export const WORK_DOC_ACCESS_LEVELS = ['none', 'view', 'full'] as const
export type WorkDocAccessLevel = typeof WORK_DOC_ACCESS_LEVELS[number]
