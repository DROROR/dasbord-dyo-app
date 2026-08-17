import type { PriorityDef, Board, BoardStatus, Task } from '../types/work'

export const COLUMNS: { id: string; label: string }[] = [
  { id: 'not_started',         label: 'Not Started'          },
  { id: 'in_progress',         label: 'In Progress'          },
  { id: 'fixing',              label: 'Fixing / Round'       },
  { id: 'pending_code_review', label: 'Pending Code Review'  },
  { id: 'pending_ux_review',   label: 'Pending UI/UX Review' },
  { id: 'done',                label: 'Done'                 },
  { id: 'archived',            label: 'Archive'              },
]

export const STATUS_PILL: Record<string, string> = {
  not_started:         'bg-gray-100 text-gray-600',
  in_progress:         'bg-blue-100 text-blue-700',
  fixing:              'bg-orange-100 text-orange-700',
  pending_code_review: 'bg-purple-100 text-purple-700',
  pending_ux_review:   'bg-pink-100 text-pink-700',
  done:                'bg-green-100 text-green-700',
  archived:            'bg-gray-100 text-gray-400',
}

export const STATUS_LABEL: Record<string, string> = {
  not_started:         'Not Started',
  in_progress:         'In Progress',
  fixing:              'Fixing / Round',
  pending_code_review: 'Pending Code Review',
  pending_ux_review:   'Pending UI/UX Review',
  done:                'Done',
  archived:            'Archive',
}

// Hebrew companion for STATUS_LABEL/COLUMNS — additive only, so existing
// callers reading the plain English constants (TeamOverview, TaskDetailModal)
// are unaffected. These are My Board's own fixed grouping headers (drawn
// from COLUMNS, not any specific board's live, admin-editable
// board.statuses[].label), so they're safe, built-in UI strings — not
// user/administrator content.
export const STATUS_LABEL_HE: Record<string, string> = {
  not_started:         'טרם התחיל',
  in_progress:         'בתהליך',
  fixing:              'תיקונים / סבב',
  pending_code_review: 'ממתין לבדיקת קוד',
  pending_ux_review:   'ממתין לבדיקת UI/UX',
  done:                'הושלם',
  archived:            'ארכיון',
}

export const STATUS_LEFT: Record<string, string> = {
  not_started:         'border-l-gray-300',
  in_progress:         'border-l-blue-400',
  fixing:              'border-l-orange-400',
  pending_code_review: 'border-l-purple-500',
  pending_ux_review:   'border-l-pink-400',
  done:                'border-l-green-500',
  archived:            'border-l-gray-200',
}

export const DEFAULT_BOARD_STATUSES: BoardStatus[] = [
  { id: 'not_started',         label: 'Not Started',          pillCls: 'bg-gray-100 text-gray-600',     leftBorderCls: 'border-l-gray-300',   canDelete: false, order: 0 },
  { id: 'in_progress',         label: 'In Progress',          pillCls: 'bg-blue-100 text-blue-700',     leftBorderCls: 'border-l-blue-400',   canDelete: true,  order: 1 },
  { id: 'fixing',              label: 'Fixing / Round',       pillCls: 'bg-orange-100 text-orange-700', leftBorderCls: 'border-l-orange-400', canDelete: true,  order: 2 },
  { id: 'pending_code_review', label: 'Pending Code Review',  pillCls: 'bg-purple-100 text-purple-700', leftBorderCls: 'border-l-purple-500', canDelete: true,  order: 3 },
  { id: 'pending_ux_review',   label: 'Pending UI/UX Review', pillCls: 'bg-pink-100 text-pink-700',     leftBorderCls: 'border-l-pink-400',   canDelete: true,  order: 4 },
  { id: 'done',                label: 'Done',                 pillCls: 'bg-green-100 text-green-700',   leftBorderCls: 'border-l-green-500',  canDelete: false, order: 5 },
  { id: 'archived',            label: 'Archive',              pillCls: 'bg-gray-100 text-gray-400',     leftBorderCls: 'border-l-gray-200',   canDelete: false, order: 6 },
]

// showInSupportQueue matches the live-audited backfill in
// 20260810100500_support_queue_config.sql exactly: 'critical' was the
// only id that ever drove the old hardcoded urgent check, so it's the
// only one true here. Boards with their own stored priorities array
// carry this flag in the DB instead — this constant only matters for
// boards using the fallback (empty stored array).
export const DEFAULT_PRIORITY_DEFS: PriorityDef[] = [
  { id: 'critical', label: 'Critical', textCls: 'text-red-600',    bgCls: 'bg-red-50',    dotCls: 'bg-red-500',    borderCls: 'border-red-200',    showInSupportQueue: true  },
  { id: 'high',     label: 'High',     textCls: 'text-orange-600', bgCls: 'bg-orange-50', dotCls: 'bg-orange-500', borderCls: 'border-orange-200', showInSupportQueue: false },
  { id: 'medium',   label: 'Medium',   textCls: 'text-amber-600',  bgCls: 'bg-amber-50',  dotCls: 'bg-amber-500',  borderCls: 'border-amber-200',  showInSupportQueue: false },
  { id: 'low',      label: 'Low',      textCls: 'text-blue-600',   bgCls: 'bg-blue-50',   dotCls: 'bg-blue-400',   borderCls: 'border-blue-200',   showInSupportQueue: false },
]

// Single source of truth for "what priorities exist on this board" —
// the board's own saved priorities array when it has one, otherwise
// these defaults (matching dbToBoard()'s own fallback in database.ts,
// so client-created and freshly-loaded boards never disagree). Never
// merge multiple boards' priority arrays together: two different
// boards — or even two entries on the SAME board, see the known
// duplicate id "high" on the live `development` board — can use the
// same id for a different priority, so resolution must always be
// scoped to one specific board's own array, never a cross-board map.
export function priorityDefsForBoard(board: Board | undefined): PriorityDef[] {
  return (board?.priorities && board.priorities.length > 0) ? board.priorities : DEFAULT_PRIORITY_DEFS
}

// Same fallback convention as priorityDefsForBoard, for the same reason:
// dbToBoard() maps a board with no stored statuses to an empty array, not
// to DEFAULT_BOARD_STATUSES — this is the single place that substitutes
// the default set back in, so every caller (Gantt's status filter, any
// future one) sees a board's REAL custom statuses when it has them.
export function statusesForBoard(board: Board | undefined): BoardStatus[] {
  return (board?.statuses && board.statuses.length > 0) ? board.statuses : DEFAULT_BOARD_STATUSES
}

// Resolves a task's priority definition from its OWN board only. Used
// by components that render tasks from several boards at once (My
// Board, Gantt, the task modal) where a single board-scoped array
// isn't available up front.
export function resolveTaskPriority(task: Task, boards: Board[]): PriorityDef | undefined {
  return priorityDefsForBoard(boards.find(b => b.id === task.board)).find(p => p.id === task.priority)
}

export const INITIAL_BOARDS: Board[] = [
  {
    id: 'development',
    name: 'General Development (White Label)',
    isDefault: true,
    access: { Fahad: 'full', Alexander: 'full', Dana: 'full', Roi: 'full', Dror: 'full' },
    statuses: DEFAULT_BOARD_STATUSES,
    priorities: DEFAULT_PRIORITY_DEFS,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'app_production',
    name: 'App Production',
    isDefault: true,
    access: { Fahad: 'full', Alexander: 'full', Dana: 'full', Roi: 'full', Dror: 'full' },
    statuses: DEFAULT_BOARD_STATUSES,
    priorities: DEFAULT_PRIORITY_DEFS,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'support',
    name: 'Support Tickets',
    isDefault: true,
    access: { Fahad: 'full', Alexander: 'full', Dana: 'full', Roi: 'full', Dror: 'full' },
    statuses: DEFAULT_BOARD_STATUSES,
    priorities: DEFAULT_PRIORITY_DEFS,
    createdAt: '2026-01-01T00:00:00Z',
    allTasksToSupportQueue: true,
  },
  {
    id: 'prosperity',
    name: 'Prosperity',
    isDefault: false,
    access: { Prosperity: 'full', Dror: 'full' },
    statuses: DEFAULT_BOARD_STATUSES,
    priorities: DEFAULT_PRIORITY_DEFS,
    createdAt: '2026-07-27T00:00:00Z',
  },
]
