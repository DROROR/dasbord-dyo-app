import type { Developer, Task, TimeEntry, WorkDoc } from '../types/work'

// ─── Clients (CRM mock) ───────────────────────────────────────────────────────

export const MOCK_CLIENTS: { id: string; name: string }[] = [
  { id: 'cl1', name: 'יוסי כהן'    },
  { id: 'cl2', name: 'מרים לוי'   },
  { id: 'cl3', name: 'דוד ישראלי' },
  { id: 'cl4', name: 'שרה ברק'    },
]

// ─── Developers ───────────────────────────────────────────────────────────────

export const DEVELOPERS: Developer[] = [
  { id: 'fahad',     name: 'Fahad',     email: 'fahad@dyo.co',     role: 'Frontend Developer'   },
  { id: 'alexander', name: 'Alexander', email: 'alex@dyo.co',      role: 'Backend Developer'    },
  { id: 'dana',      name: 'Dana',      email: 'dana@dyo.co',      role: 'UI/UX Developer'      },
  { id: 'roi',       name: 'Roi',       email: 'roi@dyo.co',       role: 'Full Stack Developer' },
]

export const ASSIGNEES: string[] = ['Fahad', 'Alexander', 'Dana', 'Roi', 'Dror']

// ─── Time entry helpers ────────────────────────────────────────────────────────

function te(
  id: string, date: string, hours: number, minutes: number,
  loggedBy: string, note?: string,
): TimeEntry {
  return { id, date, hours, minutes, loggedBy, note, isLocked: false, createdAt: `${date}T09:00:00Z` }
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const MOCK_TASKS: Task[] = [

  // ── General Development (White Label) ─────────────────────────────────────

  {
    id: 'GD-001',
    title: 'Add multi-language support (i18n)',
    description: 'Implement i18n infrastructure using react-i18next. Support Hebrew, English, Arabic. Use CSS logical properties for RTL. Add language switcher to client portal header.',
    assignee: 'Fahad',
    board: 'development',
    priority: 'high',
    status: 'in_progress',
    dueDate: '2026-06-15',
    startDate: '2026-06-01',
    timeEstimate: 24,
    timeEntries: [
      te('te-gd001-1', '2026-06-01', 2, 0,  'Fahad', 'Setup i18n infrastructure'),
      te('te-gd001-2', '2026-06-02', 3, 0,  'Fahad', 'Hebrew/English translation setup'),
      te('te-gd001-3', '2026-06-03', 2, 30, 'Fahad', 'RTL CSS logical properties'),
      te('te-gd001-4', '2026-06-04', 1, 0,  'Fahad', 'Language switcher component'),
    ],
    statusHistory: [
      { status: 'not_started', timestamp: '2026-05-28T09:00:00Z', changedBy: 'Dror' },
      { status: 'in_progress', timestamp: '2026-06-01T10:00:00Z', changedBy: 'Fahad' },
    ],
    attachments: [{ id: 'a1', type: 'url', name: 'i18n spec doc', url: 'https://example.com/spec' }],
    comments: [
      { id: 'c1', author: 'Dror',  text: 'Make sure Arabic RTL is handled at layout level — use CSS logical properties throughout.', timestamp: '2026-06-01T11:00:00Z', mentions: [] },
      { id: 'c2', author: 'Fahad', text: '@Dror Confirmed, using logical properties throughout.',                                     timestamp: '2026-06-01T14:30:00Z', mentions: ['Dror'] },
    ],
    createdAt: '2026-05-28T09:00:00Z',
  },

  {
    id: 'GD-002',
    title: 'White label theme engine',
    description: 'Build a dynamic theming system so white-label clients can configure primary color, logo, and fonts via a JSON config. Apply via CSS custom properties at runtime. Include a live preview mode.',
    assignee: 'Alexander',
    board: 'development',
    priority: 'critical',
    status: 'pending_code_review',
    dueDate: '2026-06-10',
    startDate: '2026-05-25',
    timeEstimate: 16,
    timeEntries: [
      te('te-gd002-1', '2026-05-26', 4, 0,  'Alexander', 'Theme engine design'),
      te('te-gd002-2', '2026-05-29', 3, 0,  'Alexander', 'CSS custom properties setup'),
      te('te-gd002-3', '2026-06-02', 4, 0,  'Alexander', 'Live preview mode'),
      te('te-gd002-4', '2026-06-04', 3, 0,  'Alexander', 'PR preparation and cleanup'),
    ],
    codeReviewer: 'Dror',
    statusHistory: [
      { status: 'not_started',         timestamp: '2026-05-20T09:00:00Z', changedBy: 'Dror'      },
      { status: 'in_progress',         timestamp: '2026-05-25T09:00:00Z', changedBy: 'Alexander' },
      { status: 'pending_code_review', timestamp: '2026-06-05T16:00:00Z', changedBy: 'Alexander' },
    ],
    attachments: [],
    comments: [
      { id: 'c3', author: 'Alexander', text: 'PR #42 ready for code review.', timestamp: '2026-06-05T16:05:00Z', mentions: [] },
    ],
    createdAt: '2026-05-20T09:00:00Z',
  },

  {
    id: 'GD-003',
    title: 'Client portal dashboard redesign',
    description: 'Redesign the client-facing portal dashboard. New KPI widgets, activity feed, and quick action buttons. Figma spec provided. Must be fully responsive.',
    assignee: 'Dana',
    board: 'development',
    priority: 'medium',
    status: 'done',
    dueDate: '2026-05-30',
    startDate: '2026-05-10',
    timeEstimate: 20,
    timeEntries: [
      te('te-gd003-1', '2026-05-12', 4, 0,  'Dana', 'Dashboard layout'),
      te('te-gd003-2', '2026-05-14', 5, 0,  'Dana', 'KPI widgets'),
      te('te-gd003-3', '2026-05-19', 4, 0,  'Dana', 'Activity feed'),
      te('te-gd003-4', '2026-05-22', 5, 0,  'Dana', 'Quick actions'),
      te('te-gd003-5', '2026-05-26', 2, 0,  'Dana', 'UX review fixes'),
      te('te-gd003-6', '2026-05-29', 2, 0,  'Dana', 'Final polish'),
    ],
    doneAt: '2026-05-30T14:00:00Z',
    statusHistory: [
      { status: 'not_started',      timestamp: '2026-05-10T09:00:00Z', changedBy: 'Dror' },
      { status: 'in_progress',      timestamp: '2026-05-12T09:00:00Z', changedBy: 'Dana' },
      { status: 'pending_ux_review', timestamp: '2026-05-26T15:00:00Z', changedBy: 'Dana' },
      { status: 'done',             timestamp: '2026-05-30T14:00:00Z', changedBy: 'Dror' },
    ],
    attachments: [],
    comments: [],
    createdAt: '2026-05-10T09:00:00Z',
  },

  {
    id: 'GD-004',
    title: 'Export CSV reports for clients',
    description: 'Allow clients to export usage data, billing history, and user list as CSV. Date range picker required. Must handle up to 50k rows without timeout.',
    assignee: 'Roi',
    board: 'development',
    priority: 'low',
    status: 'not_started',
    dueDate: '2026-06-30',
    startDate: '2026-06-20',
    timeEstimate: 8,
    timeEntries: [],
    statusHistory: [
      { status: 'not_started', timestamp: '2026-06-07T09:00:00Z', changedBy: 'Dror' },
    ],
    attachments: [],
    comments: [],
    createdAt: '2026-06-07T09:00:00Z',
  },

  {
    id: 'GD-005',
    title: 'Custom domain routing for white-label',
    description: 'White-label clients need custom subdomain/full domain support. Nginx proxy config, DNS setup docs, CORS handling for wildcard subdomains.',
    assignee: 'Fahad',
    board: 'development',
    priority: 'high',
    status: 'fixing',
    dueDate: '2026-06-12',
    startDate: '2026-06-03',
    timeEstimate: 12,
    timeEntries: [
      te('te-gd005-1', '2026-06-03', 2, 0, 'Fahad', 'Nginx proxy config'),
      te('te-gd005-2', '2026-06-04', 2, 0, 'Fahad', 'CORS investigation'),
      te('te-gd005-3', '2026-06-05', 2, 0, 'Fahad', 'Wildcard subdomain fix attempt'),
    ],
    statusHistory: [
      { status: 'not_started',         timestamp: '2026-06-01T09:00:00Z', changedBy: 'Dror'  },
      { status: 'in_progress',         timestamp: '2026-06-03T10:00:00Z', changedBy: 'Fahad' },
      { status: 'pending_code_review', timestamp: '2026-06-05T12:00:00Z', changedBy: 'Fahad' },
      { status: 'fixing',              timestamp: '2026-06-06T09:00:00Z', changedBy: 'Dror'  },
    ],
    attachments: [],
    comments: [
      { id: 'c4', author: 'Dror',  text: 'CORS headers not passing on wildcard subdomain — fix before re-review.', timestamp: '2026-06-06T09:10:00Z', mentions: []  },
      { id: 'c5', author: 'Fahad', text: 'Investigating nginx config now.',                                         timestamp: '2026-06-06T10:00:00Z', mentions: []  },
    ],
    createdAt: '2026-06-01T09:00:00Z',
  },

  // ── App Production ─────────────────────────────────────────────────────────

  {
    id: 'AP-001',
    title: 'Push notifications — iOS deep link fix',
    description: 'Notifications not deep-linking on iOS 17.4+. Investigate APN payload: `aps.alert` structure and universal link URL. Must test on iOS 17.4.1.',
    assignee: 'Alexander',
    board: 'app_production',
    priority: 'critical',
    status: 'in_progress',
    dueDate: '2026-06-08',
    startDate: '2026-06-04',
    timeEstimate: 6,
    timeEntries: [
      te('te-ap001-1', '2026-06-04', 2, 0,  'Alexander', 'Reproducing issue on device'),
      te('te-ap001-2', '2026-06-05', 1, 30, 'Alexander', 'APN payload analysis'),
      te('te-ap001-3', '2026-06-06', 1, 0,  'Alexander', 'Universal link testing'),
    ],
    statusHistory: [
      { status: 'not_started', timestamp: '2026-06-03T09:00:00Z', changedBy: 'Dror'      },
      { status: 'in_progress', timestamp: '2026-06-04T09:00:00Z', changedBy: 'Alexander' },
    ],
    attachments: [],
    comments: [
      { id: 'c6', author: 'Alexander', text: 'Reproduced on iPhone 13 Pro (iOS 17.4.1). URL scheme malformed in payload.', timestamp: '2026-06-04T11:00:00Z', mentions: [] },
    ],
    createdAt: '2026-06-03T09:00:00Z',
  },

  {
    id: 'AP-002',
    title: 'Video player — PiP & fullscreen improvements',
    description: 'Add Picture-in-Picture on iOS/Android. Fix fullscreen orientation lock. Improve seek bar precision on mobile touch. Figma spec attached.',
    assignee: 'Dana',
    board: 'app_production',
    priority: 'high',
    status: 'pending_ux_review',
    dueDate: '2026-06-11',
    startDate: '2026-06-02',
    timeEstimate: 18,
    timeEntries: [
      te('te-ap002-1', '2026-06-02', 4, 0, 'Dana', 'PiP implementation'),
      te('te-ap002-2', '2026-06-03', 4, 0, 'Dana', 'Fullscreen orientation lock'),
      te('te-ap002-3', '2026-06-04', 3, 0, 'Dana', 'Seek bar precision'),
      te('te-ap002-4', '2026-06-05', 2, 0, 'Dana', 'Mobile touch testing'),
      te('te-ap002-5', '2026-06-06', 2, 0, 'Dana', 'Review preparation'),
    ],
    uxReviewer: 'Roi',
    statusHistory: [
      { status: 'not_started',       timestamp: '2026-05-28T09:00:00Z', changedBy: 'Dror' },
      { status: 'in_progress',       timestamp: '2026-06-02T09:00:00Z', changedBy: 'Dana' },
      { status: 'pending_ux_review', timestamp: '2026-06-06T17:00:00Z', changedBy: 'Dana' },
    ],
    attachments: [{ id: 'a2', type: 'url', name: 'Figma spec', url: 'https://figma.com/example' }],
    comments: [],
    createdAt: '2026-05-28T09:00:00Z',
  },

  {
    id: 'AP-003',
    title: 'Offline content sync',
    description: 'Download lessons for offline viewing. React Native AsyncStorage + background sync. Download manager UI with per-lesson progress indicators.',
    assignee: 'Roi',
    board: 'app_production',
    priority: 'medium',
    status: 'not_started',
    dueDate: '2026-07-01',
    startDate: '2026-06-15',
    timeEstimate: 30,
    timeEntries: [],
    statusHistory: [
      { status: 'not_started', timestamp: '2026-06-07T09:00:00Z', changedBy: 'Dror' },
    ],
    attachments: [],
    comments: [],
    createdAt: '2026-06-07T09:00:00Z',
  },

  {
    id: 'AP-004',
    title: 'App Store submission — v2.1',
    description: 'Prepare v2.1 App Store assets: screenshots (all device sizes), updated description copy, privacy manifest, export compliance declaration.',
    assignee: 'Dror',
    board: 'app_production',
    priority: 'high',
    status: 'archived',
    dueDate: '2026-05-25',
    startDate: '2026-05-18',
    timeEstimate: 10,
    timeEntries: [
      te('te-ap004-1', '2026-05-18', 3, 0, 'Dror', 'Screenshot preparation'),
      te('te-ap004-2', '2026-05-20', 4, 0, 'Dror', 'Store listing updates'),
      te('te-ap004-3', '2026-05-22', 2, 0, 'Dror', 'Privacy manifest'),
      te('te-ap004-4', '2026-05-24', 2, 0, 'Dror', 'Final submission'),
    ],
    doneAt: '2026-05-25T14:00:00Z',
    statusHistory: [
      { status: 'not_started', timestamp: '2026-05-15T09:00:00Z', changedBy: 'Dror' },
      { status: 'in_progress', timestamp: '2026-05-18T09:00:00Z', changedBy: 'Dror' },
      { status: 'done',        timestamp: '2026-05-25T14:00:00Z', changedBy: 'Dror' },
      { status: 'archived',    timestamp: '2026-05-25T14:05:00Z', changedBy: 'Dror' },
    ],
    attachments: [],
    comments: [],
    createdAt: '2026-05-15T09:00:00Z',
  },

  {
    id: 'AP-005',
    title: 'Payment flow — Cardcom iframe integration',
    description: 'Replace redirect with Cardcom iframe. Implement 3DS2 handling, subscription upgrade/downgrade UI, retry logic for failed payments.',
    assignee: 'Fahad',
    clientId: 'cl1',
    clientName: 'יוסי כהן',
    board: 'app_production',
    priority: 'critical',
    status: 'in_progress',
    dueDate: '2026-06-09',
    startDate: '2026-06-01',
    timeEstimate: 20,
    timeEntries: [
      te('te-ap005-1', '2026-05-30', 3, 0, 'Fahad', 'Cardcom iframe setup'),
      te('te-ap005-2', '2026-06-01', 3, 0, 'Fahad', '3DS2 redirect handling'),
      te('te-ap005-3', '2026-06-03', 4, 0, 'Fahad', 'Subscription upgrade/downgrade UI'),
      te('te-ap005-4', '2026-06-05', 2, 0, 'Fahad', 'Retry logic for failed payments'),
    ],
    statusHistory: [
      { status: 'not_started', timestamp: '2026-05-30T09:00:00Z', changedBy: 'Dror'  },
      { status: 'in_progress', timestamp: '2026-06-01T09:00:00Z', changedBy: 'Fahad' },
    ],
    attachments: [{ id: 'a3', type: 'url', name: 'Cardcom API docs', url: 'https://cardcom.co.il' }],
    comments: [
      { id: 'c7', author: 'Dror',  text: '@Fahad This is blocking יוסי כהן upgrade — top priority.', timestamp: '2026-06-05T08:00:00Z', mentions: ['Fahad'] },
      { id: 'c8', author: 'Fahad', text: 'Working on 3DS2 redirect handling now.',                    timestamp: '2026-06-05T09:30:00Z', mentions: []        },
    ],
    createdAt: '2026-05-30T09:00:00Z',
  },

  // ── Support Tickets ────────────────────────────────────────────────────────

  {
    id: 'ST-001',
    title: 'Login crash on iPhone 13 (iOS 16.7.8)',
    description: 'App crashes immediately after credentials on iPhone 13 running iOS 16.7.8. Crash before home screen. Possibly related to auth session change in v2.0.8.',
    assignee: 'Fahad',
    board: 'support',
    priority: 'critical',
    status: 'not_started',
    dueDate: '2026-06-08',
    timeEntries: [],
    claimed: false,
    statusHistory: [
      { status: 'not_started', timestamp: '2026-06-06T08:00:00Z', changedBy: 'Support Bot' },
    ],
    attachments: [],
    comments: [],
    createdAt: '2026-06-06T08:00:00Z',
  },

  {
    id: 'ST-002',
    title: 'Videos buffering infinitely — CDN migration issue',
    description: 'Client reports all video lessons buffer endlessly on web app after CDN migration. Check CloudFront distribution CORS policy for this origin.',
    assignee: 'Alexander',
    clientId: 'cl2',
    clientName: 'מרים לוי',
    board: 'support',
    priority: 'high',
    status: 'in_progress',
    dueDate: '2026-06-09',
    timeEstimate: 3,
    timeEntries: [
      te('te-st002-1', '2026-06-05', 1, 0,  'Alexander', 'CORS investigation'),
      te('te-st002-2', '2026-06-06', 0, 30, 'Alexander', 'CloudFront config fix'),
    ],
    claimed: true,
    claimedBy: 'Alexander',
    statusHistory: [
      { status: 'not_started', timestamp: '2026-06-05T14:00:00Z', changedBy: 'Support Bot' },
      { status: 'in_progress', timestamp: '2026-06-05T14:10:00Z', changedBy: 'Alexander'   },
    ],
    attachments: [],
    comments: [
      { id: 'c9', author: 'Alexander', text: 'CORS issue confirmed on CloudFront. Adding correct origin headers.', timestamp: '2026-06-05T14:30:00Z', mentions: [] },
    ],
    createdAt: '2026-06-05T14:00:00Z',
  },
]

// ─── Docs ─────────────────────────────────────────────────────────────────────

export const MOCK_DOCS: WorkDoc[] = [
  {
    id: 'd1',
    title: 'API Integration Guide — Cardcom',
    content: `# Cardcom API Integration\n\n## Authentication\nUse the terminal number and API key from the Cardcom dashboard.\n\n## Token Creation\nPOST /v11/api/Token/Create\n\n## Subscription Management\n- Create: POST /v11/api/Subscription/Create\n- Update: POST /v11/api/Subscription/Update\n- Cancel: POST /v11/api/Subscription/Cancel\n\n## Webhooks\nAll payloads signed with HMAC-SHA256. Set callback URL in dashboard.`,
    createdBy: 'Dror',
    updatedAt: '2026-06-01T10:00:00Z',
    access: { Fahad: 'edit', Alexander: 'view', Dana: 'view', Roi: 'view', Dror: 'edit' },
  },
  {
    id: 'd2',
    title: 'White Label Onboarding Checklist',
    content: `# White Label Client Onboarding\n\n## Pre-launch\n- [ ] Theme config (colors, logo, fonts)\n- [ ] Custom domain setup\n- [ ] Payment gateway configured\n- [ ] Test accounts created\n\n## Launch Day\n1. DNS records updated\n2. SSL certificate issued\n3. Smoke test all pages\n4. Monitor error logs 24h\n\n## Post-launch\n- Send welcome email\n- Schedule 7-day check-in call`,
    createdBy: 'Alexander',
    updatedAt: '2026-06-05T15:00:00Z',
    access: { Fahad: 'edit', Alexander: 'edit', Dana: 'comment', Roi: 'view', Dror: 'edit' },
  },
]
