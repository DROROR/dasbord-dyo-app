import type { PriorityDef, Board, BoardStatus } from '../types/work'

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

export const DEFAULT_PRIORITY_DEFS: PriorityDef[] = [
  { id: 'critical', label: 'Critical', textCls: 'text-red-600',    bgCls: 'bg-red-50',    dotCls: 'bg-red-500',    borderCls: 'border-red-200'    },
  { id: 'high',     label: 'High',     textCls: 'text-orange-600', bgCls: 'bg-orange-50', dotCls: 'bg-orange-500', borderCls: 'border-orange-200' },
  { id: 'medium',   label: 'Medium',   textCls: 'text-amber-600',  bgCls: 'bg-amber-50',  dotCls: 'bg-amber-500',  borderCls: 'border-amber-200'  },
  { id: 'low',      label: 'Low',      textCls: 'text-blue-600',   bgCls: 'bg-blue-50',   dotCls: 'bg-blue-400',   borderCls: 'border-blue-200'   },
]

export const INITIAL_BOARDS: Board[] = [
  {
    id: 'development',
    name: 'General Development (White Label)',
    isDefault: true,
    access: { Fahad: 'full', Alexander: 'full', Dana: 'full', Roi: 'full', Dror: 'full' },
    statuses: DEFAULT_BOARD_STATUSES,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'app_production',
    name: 'App Production',
    isDefault: true,
    access: { Fahad: 'full', Alexander: 'full', Dana: 'full', Roi: 'full', Dror: 'full' },
    statuses: DEFAULT_BOARD_STATUSES,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'support',
    name: 'Support Tickets',
    isDefault: true,
    access: { Fahad: 'full', Alexander: 'full', Dana: 'full', Roi: 'full', Dror: 'full' },
    statuses: DEFAULT_BOARD_STATUSES,
    createdAt: '2026-01-01T00:00:00Z',
  },
]
