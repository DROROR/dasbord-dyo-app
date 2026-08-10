import type { ComponentType } from 'react'
import {
  LayoutDashboard, Users, CreditCard, MessageCircle, Target, Bot,
  GraduationCap, Briefcase, Shield, Settings, FileText,
} from 'lucide-react'

// ============================================================
// Central page/permission registry — the single source of truth for
// Sidebar navigation, the Permissions page's grid rows, App.tsx's
// route guard (PAGE_MODULE), and each module's available permission
// levels and default grants. Add, remove, or rename a page by editing
// PAGES below — Sidebar and Permissions both update automatically;
// there is nowhere else in the frontend that duplicates this list.
//
// IMPORTANT — this registry only wires up FRONTEND gating (nav
// visibility, the route guard in App.tsx, the Permissions UI, and the
// default grant new users receive). If a new page owns its own
// database table(s), you must ALSO write a migration adding RLS
// policies keyed on has_permission('<module>', ...) for those tables
// — nothing here does that automatically, and forgetting it leaves a
// table wide open (see the original permissions audit that motivated
// all of this). supabase/migrations/20260809130000_bot_training_permission_split.sql
// is a worked example of moving a table's RLS from one module key to
// a newly-introduced one.
//
// Mirrors (kept in step by hand, cannot share this file directly):
//   - supabase/functions/_shared/permissions.ts (Deno side — module
//     list, levels, rankOf, DEFAULT_STAFF_PERMISSIONS only; no
//     labels/icons/nav, Edge Functions don't render UI).
//   - permission_rank() in supabase/migrations/
//     20260809120000_owner_tier_and_profile_lockdown.sql (the level
//     ranking rule, not the module list — has_permission() is
//     module-agnostic by design, so new modules never require a SQL
//     change there, only new RLS policies that call it).
// ============================================================

export type PermissionModule =
  | 'dashboard' | 'clients' | 'billing' | 'whatsapp' | 'leads'
  | 'agents' | 'bot_training' | 'work' | 'work_docs' | 'pricing' | 'permissions'

export const LEVELS = ['none', 'view', 'edit', 'send', 'full'] as const
export type PermissionLevel = typeof LEVELS[number]

export interface PageEntry {
  /** activePage id (App.tsx) / Sidebar nav id. */
  id: string
  /** Permission module gating this page. null = no permission needed (e.g. own settings). */
  module: PermissionModule | null
  labelHe: string
  labelEn: string
  /** Sidebar icon. Unused (but still required, to keep the type simple) for permission-only rows that aren't a nav page, e.g. pricing. */
  icon: ComponentType<{ size?: number; className?: string }>
  /** Levels offered in the Permissions grid for this module (ignored when module is null). */
  levels: readonly PermissionLevel[]
  /** Where this shows in Sidebar: main nav, bottom nav, or not a page at all (permission-only row). */
  nav: 'main' | 'bottom' | 'none'
  /** The level a brand-new staff member gets for this module by default. */
  staffDefault: PermissionLevel
  /** Reachable only via canManagePermissions (owner, or admin granted permissions:'full'), not a plain hasPermission('view') check. */
  managePermissionsOnly?: boolean
}

export const PAGES: PageEntry[] = [
  { id: 'dashboard', module: 'dashboard', labelHe: 'לוח בקרה', labelEn: 'Dashboard', icon: LayoutDashboard, levels: ['none', 'view'], nav: 'main', staffDefault: 'view' },
  { id: 'clients', module: 'clients', labelHe: 'לקוחות', labelEn: 'Clients', icon: Users, levels: ['none', 'view', 'edit', 'full'], nav: 'main', staffDefault: 'view' },
  { id: 'billing', module: 'billing', labelHe: 'חיוב', labelEn: 'Billing', icon: CreditCard, levels: ['none', 'view', 'full'], nav: 'main', staffDefault: 'none' },
  { id: 'whatsapp', module: 'whatsapp', labelHe: 'וואטסאפ', labelEn: 'WhatsApp', icon: MessageCircle, levels: ['none', 'view', 'send', 'full'], nav: 'main', staffDefault: 'none' },
  { id: 'leads', module: 'leads', labelHe: 'לידים', labelEn: 'Leads', icon: Target, levels: ['none', 'view', 'edit', 'full'], nav: 'main', staffDefault: 'view' },
  { id: 'agents', module: 'agents', labelHe: 'סוכנים', labelEn: 'Agents', icon: Bot, levels: ['none', 'view', 'full'], nav: 'main', staffDefault: 'none' },
  // Split from 'agents' — was silently sharing that module's permission
  // (Decision C in the original audit). Now its own key: see the 003
  // migration for the RLS remap + the one-time backfill that preserves
  // every existing user's effective access across the split.
  { id: 'bots', module: 'bot_training', labelHe: 'אימון בוטים', labelEn: 'Bot Training', icon: GraduationCap, levels: ['none', 'view', 'full'], nav: 'main', staffDefault: 'none' },
  { id: 'work', module: 'work', labelHe: 'עבודה', labelEn: 'Work', icon: Briefcase, levels: ['none', 'view', 'edit', 'full'], nav: 'main', staffDefault: 'edit' },
  // Not a Sidebar page — a tab inside Work (Docs) — but its own
  // permission module, deliberately not sharing 'work': gates section
  // visibility of the Docs tab. Per-document access is a separate,
  // finer-grained layer on top (work_docs.access, enforced by
  // has_doc_access() — see 20260809140000_docs_and_board_access.sql),
  // not expressed in this registry at all.
  { id: 'work_docs', module: 'work_docs', labelHe: 'קבצים', labelEn: 'Files', icon: FileText, levels: ['none', 'view', 'full'], nav: 'none', staffDefault: 'none' },
  { id: 'permissions', module: 'permissions', labelHe: 'הרשאות', labelEn: 'Permissions', icon: Shield, levels: ['none', 'full'], nav: 'main', staffDefault: 'none', managePermissionsOnly: true },
  { id: 'settings', module: null, labelHe: 'הגדרות', labelEn: 'Settings', icon: Settings, levels: [], nav: 'bottom', staffDefault: 'none' },
  // Not a Sidebar page — a tab inside Billing — but still a real
  // permission module with its own grid row in Permissions. icon is
  // unused (nav: 'none' means it never renders in Sidebar).
  { id: 'pricing', module: 'pricing', labelHe: 'הגדרות תמחור', labelEn: 'Pricing settings', icon: CreditCard, levels: ['none', 'full'], nav: 'none', staffDefault: 'none' },
]

// Dev-time guard: every module key must be unique across the registry
// (the whole point of the split above) and every page id must be
// unique too. Throws immediately on module load if violated, rather
// than failing silently at some unrelated call site later.
if (import.meta.env.DEV) {
  const moduleKeys = PAGES.map(p => p.module).filter((m): m is PermissionModule => m !== null)
  const dupModule = moduleKeys.find((m, i) => moduleKeys.indexOf(m) !== i)
  if (dupModule) throw new Error(`PAGES registry: module "${dupModule}" is used by more than one entry`)
  const ids = PAGES.map(p => p.id)
  const dupId = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dupId) throw new Error(`PAGES registry: id "${dupId}" is used by more than one entry`)
}

const RANK: Record<string, number> = { none: 0, view: 1, edit: 2, send: 2, full: 3 }

// Returns null (not a numeric fallback) for anything unrecognized —
// keeps comparisons fail-closed whether the unrecognized value is
// the level a user holds or the level being required. A module key
// missing from a stored permissions object (e.g. an older profile
// row created before a new module existed) resolves to 'none' by the
// caller (see hasPermission in useAuth.tsx), never to this function
// returning a permissive default.
export function rankOf(level: string | null | undefined): number | null {
  return level != null && level in RANK ? RANK[level] : null
}

export const MODULES: PermissionModule[] = PAGES
  .map(p => p.module)
  .filter((m): m is PermissionModule => m !== null)

export const FULL_PERMISSIONS: Record<PermissionModule, PermissionLevel> =
  Object.fromEntries(MODULES.map(m => [m, 'full'])) as Record<PermissionModule, PermissionLevel>

export const DEFAULT_STAFF_PERMISSIONS: Record<PermissionModule, PermissionLevel> =
  Object.fromEntries(PAGES.filter(p => p.module).map(p => [p.module, p.staffDefault])) as Record<PermissionModule, PermissionLevel>

// activePage id -> the module that gates it, for every id that is
// actually a routable page (nav !== 'none' — excludes permission-only
// rows like 'pricing', which is a Billing tab, not its own page).
// `null` means "no module check, allowed to any authenticated user".
export const PAGE_MODULE: Record<string, PermissionModule | null> =
  Object.fromEntries(PAGES.filter(p => p.nav !== 'none').map(p => [p.id, p.module]))
