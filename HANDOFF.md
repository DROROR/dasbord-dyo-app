# HANDOFF.md — Admin Platform

> **Purpose:** Complete technical handoff document for any new AI assistant or developer with zero prior context.
> **Last updated:** 2026-06-22

---

## 1. Project Overview

A full-stack internal admin platform for managing a **digital course platform business in Israel** (the product is called DYO — "Do Your Own" courses). The platform is used exclusively by the business owner/team — it is **not** customer-facing.

**What it manages:**
- CRM for paying clients (course platform operators)
- Variable billing per client (fixed monthly package + OTP usage + user block charges)
- WhatsApp communication (bulk sends, automated sequences, per-client chat logs)
- Lead management from Facebook/Instagram ads
- n8n automation agents (billing collection, follow-ups, renewals, bots)
- Internal task/work management for the dev team

**Business owner email:** droryosef1@gmail.com  
**Deployment target:** Vercel  
**Language rules:** UI is Hebrew (RTL). Work module is English. Code is English. Comments are English.

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | React | ^19.2.6 |
| Language | TypeScript | ~6.0.2 |
| Build tool | Vite | ^8.0.12 |
| Styling | Tailwind CSS | ^4.3.0 |
| Icons | lucide-react | ^1.17.0 |
| Database / Auth | Supabase (PostgreSQL + Auth) | ^2.107.0 |
| Automation | n8n (self-hosted on Railway) | — |
| Payments | Cardcom API | v11 |
| WhatsApp | Green API | — |
| Tasks | ClickUp | — |
| Meetings | Calendly | — |
| AI | Anthropic API (Claude) | — |
| Deployment | Vercel | — |
| Linting | ESLint + typescript-eslint | ^10.3.0 / ^8.59.2 |

---

## 3. Environment Variables

Create a `.env` file at the project root with these keys:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GREEN_API_INSTANCE_SERVICE=
VITE_GREEN_API_TOKEN_SERVICE=
VITE_GREEN_API_INSTANCE_SALES=
VITE_GREEN_API_TOKEN_SALES=
```

**Notes:**
- `SERVICE` instance = the business's service/support number, used for **client** messages
- `SALES` instance = the business's sales number, used for **lead** messages
- Green API base URL: `https://api.green-api.com/waInstance{instanceId}/sendMessage/{token}`

---

## 4. Folder Structure

```
admin-platform/
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── App.tsx                        — Root component; page routing via activePage state; auth guard
│   ├── main.tsx                       — React entry point; wraps App in SettingsProvider
│   ├── App.css                        — Global styles (minimal)
│   ├── assets/                        — Static images (logo, hero)
│   ├── config/
│   │   └── defaults.ts                — AppSettings type + default billing values (OTP price, thresholds)
│   ├── context/
│   │   └── SettingsContext.tsx        — Global billing settings stored in localStorage; useSettings() hook
│   ├── contexts/
│   │   ├── NotificationContext.tsx    — In-app notification queue for Work module events
│   │   └── TimerContext.tsx           — Floating timer state (active task, start time, pending entries)
│   ├── data/
│   │   ├── workConstants.ts           — Default board statuses, priority definitions, initial boards
│   │   └── workMockData.ts            — Mock tasks, assignees, clients, docs for Work module
│   ├── hooks/
│   │   └── useAuth.ts                 — Supabase auth + profiles table; returns user, profile, isAdmin, signOut
│   ├── lib/
│   │   ├── supabase.ts                — Supabase client (createClient with env vars)
│   │   ├── database.ts                — All Supabase DB functions + TypeScript row types
│   │   └── whatsapp.ts                — Green API send function + channel routing logic
│   ├── pages/
│   │   ├── Dashboard.tsx              — Stats, active alerts, agent error alerts, agent status table
│   │   ├── Clients.tsx                — Client CRM: list + detail view with tabs
│   │   ├── Billing.tsx                — Billing records: open payments, history, pricing settings
│   │   ├── WhatsApp.tsx               — Bulk send, templates, sequences, message log
│   │   ├── Leads.tsx                  — Lead Kanban board with follow-up and WhatsApp tab
│   │   ├── Agents.tsx                 — n8n agent control panel + flow map visualization
│   │   ├── Permissions.tsx            — User role and per-module access control
│   │   ├── Work.tsx                   — Internal task management (My Board, Tasks, Gantt, Docs, AI)
│   │   ├── Settings.tsx               — WhatsApp channel configuration (Green API numbers)
│   │   └── Login.tsx                  — Supabase email/password login form
│   ├── components/
│   │   ├── Avatar.tsx                 — User avatar component
│   │   ├── TeamOverview.tsx           — Dev team stats modal (used in Dashboard)
│   │   └── layout/
│   │       ├── Layout.tsx             — Shell: sidebar + topbar + content area
│   │       ├── Sidebar.tsx            — Navigation sidebar with page links
│   │       └── Topbar.tsx             — Top bar with user info and notifications
│   └── components/work/
│       ├── AiTaskCreator.tsx          — Claude API-powered task creation from natural language
│       ├── DocsTab.tsx                — Work docs list and viewer
│       ├── FloatingTimerWidget.tsx    — Persistent floating timer for time tracking
│       ├── GanttTab.tsx               — Gantt chart view for tasks
│       ├── MyBoard.tsx                — Personal task board filtered by assignee
│       ├── TaskDetailModal.tsx        — Full task detail modal (edit, comments, time, attachments)
│       └── VerticalBoard.tsx          — Kanban-style board with vertical status columns
├── types/
│   └── work.ts                        — TypeScript types: Task, TimeEntry, Board, BoardStatus, etc.
├── CLAUDE.md                          — Claude Code project instructions
├── HANDOFF.md                         — This file
├── package.json
├── tsconfig.json
├── vite.config.ts
└── eslint.config.js
```

---

## 5. Database Schema — Supabase

### Table: `clients`

The central CRM table. One row per paying client (a business using the DYO course platform).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Auto-generated |
| name | text | Contact person name |
| business_name | text | Name of their business/app |
| email | text \| null | Primary email |
| phone | text \| null | Israeli format — deprecated from UI; all phones now come from `client_contacts` |
| package | enum | `solo_pro`, `master_class`, `community_master` |
| joined_at | timestamptz \| null | Subscription start date |
| status | enum | `active`, `pending`, `on_hold`, `expired`, `cancelled` |
| trial_days | int | 0 = no trial |
| notes | text \| null | Free text internal notes — column added to Supabase 2026-06-22 |
| otp_price | numeric \| null | Custom ₪/OTP — falls back to system default (₪1) |
| user_threshold | int \| null | Custom user threshold — falls back to system default (250) |
| block_price | numeric \| null | Custom ₪/block — falls back to system default (₪100) |
| created_at | timestamptz | Row creation time |
| woo_customer_id | text \| null | WooCommerce customer ID (set by Agent 1) |
| cardcom_account_id | text \| null | Cardcom account ID |
| cardcom_foreign_account_number | text \| null | Cardcom token for recurring charge |
| payment_failed_at | timestamptz \| null | Timestamp of most recent payment failure |

**Status enum values:** `active` `pending` `on_hold` `expired` `cancelled`  
**Package enum values:** `solo_pro` `master_class` `community_master`

**Note:** `block_size` is a **global system setting only** (from `AppSettings` / `settings.DEFAULT_BLOCK_SIZE`). There is no per-client `block_size` column in the `clients` table — do not add it to any Supabase select query.

**Package prices (hardcoded in system):**
- `solo_pro` → ₪140/month
- `master_class` → ₪235/month
- `community_master` → ₪370/month

---

### Table: `client_contacts`

Multiple contacts per client. One must be the payment recipient; multiple can receive updates.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients.id | |
| name | text | |
| phone | text | |
| role | enum | `owner`, `app_manager`, `content_manager`, `other` |
| receives_payments | boolean | Exactly one contact per client should be true |
| receives_updates | boolean | Multiple allowed |
| created_at | timestamptz | |

---

### Table: `billing_records`

One record per client per billing cycle (month/year).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_id | uuid FK → clients.id | |
| month | int | 1–12 |
| year | int | e.g. 2025 |
| otp_count | int | OTPs sent that month |
| user_count | int | Active users that month |
| package_price | numeric | Fixed fee charged (₪140/235/370) |
| otp_cost | numeric | otp_count × otp_price |
| block_cost | numeric | blocks × block_price |
| variable_total | numeric | otp_cost + block_cost |
| cc_status | enum \| null | `paid`, `failed` — WooCommerce/Cardcom fixed charge result |
| variable_status | enum | `paid`, `unpaid`, `pending` — variable charge status |
| created_at | timestamptz | |
| payment_date | timestamptz \| null | Real payment timestamp from Cardcom `CreateDate` field |
| amount_paid | numeric \| null | Actual amount received from Cardcom (not the package price) |

---

### Table: `leads`

Prospects from Facebook/Instagram ads.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| phone | text | Israeli format |
| source | enum \| null | `facebook`, `instagram` |
| status | enum | `new`, `meeting`, `producing`, `followup`, `irrelevant` |
| lead_type | enum \| null | `has_course`, `producing` |
| follow_up_date | date \| null | |
| follow_up_note | text \| null | |
| follow_up_tone | text \| null | `friendly`, `professional`, `urgent` |
| created_at | timestamptz | |

**Status flow (Kanban columns):**
`new` → `meeting` → `producing` → `followup` → `irrelevant` (archived)

---

### Table: `messages`

WhatsApp message log — one row per sent/received message.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| recipient_id | uuid | Client or lead ID |
| recipient_type | enum | `client`, `lead` |
| phone | text | |
| message_text | text \| null | |
| template_key | text \| null | Template ID used, if any |
| media_url | text \| null | |
| status | enum | `sent`, `read`, `failed` |
| sent_at | timestamptz | |
| channel | enum \| null | `service`, `sales` |

---

### Table: `message_templates`

WhatsApp message templates — loaded and edited via the WhatsApp → Templates tab.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | Display name |
| body | text | Template text; may contain `{{שם}}` placeholder |
| tag | text | `אוטומטי`, `triggered`, `ידני` |
| channel | text | `service` (clients) or `sales` (leads) |
| media_url | text \| null | Optional media attachment URL |
| created_at | timestamptz | |

**Note:** Rows are ordered by `created_at ASC`. The first row is always the Welcome Message (sent automatically on new client). All other rows are general templates.

---

### Table: `sequences`

Warming sequence definitions — one row per sequence.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| seq_key | text | Short identifier: `a`, `b`, `c` — matches CSS style key in UI |
| label | text | Hebrew display name |
| description | text | Short description shown in UI |
| channel | text | `service` or `sales` |
| is_active | boolean | Whether the sequence is currently active |
| created_at | timestamptz | |

---

### Table: `sequence_steps`

Individual steps within a warming sequence.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sequence_id | uuid FK → sequences.id | |
| step_order | int | Position in sequence (1-based, re-ordered on save) |
| day | int | Absolute day number from sequence start (e.g. day 1, day 4, day 7) |
| message | text | Step message body; may contain `{{שם}}` |
| media_url | text \| null | Optional media |
| created_at | timestamptz | |

---

### Table: `agent_logs`

Every n8n agent writes a row here on each run.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| agent_id | text | Matches agent ID in UI (e.g. `billing-collect`) |
| agent_name | text | Human-readable name |
| status | enum | `success`, `error`, `running` |
| result_summary | text \| null | Short description of what happened |
| run_at | timestamptz | When the run started |

**Dashboard alert rule:** Fetch `agent_logs` where `status = 'error'` and `run_at >= now - 7 days`. Display as red alert cards in "התראות פעילות". Refreshes every 60 minutes.

---

### Table: `tasks`

Internal dev team tasks (Work module). Columns mirror the TypeScript `Task` type.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text | |
| description | text \| null | |
| board | text | Board ID |
| status | text | Flexible — defined per board |
| priority | text \| null | `critical`, `high`, `medium`, `low` |
| assignee | text \| null | Developer name |
| client_id | uuid \| null | Optional link to clients table |
| client_name | text \| null | Denormalized client name |
| start_date | date \| null | |
| due_date | date \| null | |
| time_estimate | int \| null | Hours |
| time_entries | jsonb | Array of `TimeEntry` objects |
| status_history | jsonb | Array of `StatusHistoryEntry` objects |
| comments | jsonb | Array of `TaskComment` objects |
| attachments | jsonb | Array of `Attachment` objects |
| created_by | text \| null | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| done_at | timestamptz \| null | |
| whatsapp_pending | boolean \| null | Needs WhatsApp approval before going to UX review |
| claimed | boolean \| null | Whether a dev has claimed the task |
| claimed_by | text \| null | |
| code_reviewer | text \| null | Assigned code reviewer |
| ux_reviewer | text \| null | Assigned UX reviewer |

---

### Table: `profiles`

Supabase Auth user profiles — extends the built-in `auth.users` table.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Matches `auth.users.id` |
| name | text | Display name |
| email | text | |
| role | text | `admin`, `staff`, `viewer` |
| permissions | jsonb | Per-module access map |

---

## 6. Every Page — Detailed

### `Dashboard.tsx`

**Purpose:** Command center. Shows at a glance: KPIs, active alerts, agent errors, agent status table.

**Key components:**
- `SectionHeader` — shared section title component
- `Card` — shared surface card component
- Stats row (4 cards: active clients, monthly revenue, open leads, unpaid billing)
- Alerts section ("התראות פעילות"): static alerts + dynamic `inactiveClients` alert + live `agent_logs` error alerts
- Recent Activity (static mock data)
- Team Overview modal (admin only) — renders `TeamOverview` component
- Agent status table (static mock data with mock statuses)

**Supabase connections:**
- `getDashboardStats()` on mount — queries clients, leads, billing_records
- `agent_logs` table — fetches errors from last 7 days; auto-refreshes every 60 minutes

**Business logic:**
- `monthlyRevenue` = sum of package prices for all active clients
- `inactiveClients` = count of clients with status `on_hold`, `expired`, or `cancelled`
- Agent error cards appear inline in the main alerts list, no separate section

**Known issues / TODOs:**
- Agent status table is still static mock data; should pull from `agent_logs` live
- Recent Activity is static mock data; should pull from `messages` + `agent_logs`
- Renewal alerts (month 11/12) are static; should query real `clients.joined_at`

---

### `Clients.tsx`

**Purpose:** Full CRM for paying clients. List view + detail panel with 4 tabs.

**Key components:**
- `ClientsList` — searchable, filterable, sortable table (sort by: name / join date / subscription month / status; default Hebrew alphabetical by name)
- `ClientDetail` — tabbed detail panel
  - `DetailsTab` — contact info grid (name, business name, email — no standalone phone field), contacts management, subscription info, custom pricing, notes
  - `BillingTab` — billing history (real Supabase data; falls back to generated mock if error)
  - `WhatsAppTab` — message routing display + static chat log (mock data)
  - `TicketsTab` — support tickets (mock data)
- `ContactsSection` — manages 1-N contacts; each contact has toggleable `receives_payments` (max one per client) and `receives_updates` (multiple allowed); checkboxes always visible — no special-casing for single-contact clients

**Supabase connections:**
- `getClients()` — loads all clients with contacts on mount
- `updateClient()` — saves contact info, package, status, custom pricing
- `updateClientContacts()` — atomic delete+insert of all contacts for a client
- `getBillingRecords(clientId)` — loads billing history per client

**Business logic:**
- All phone numbers live in `client_contacts` only — `clients.phone` column is not displayed in the UI
- `calcSubscriptionMonth(joinedAt)` — months since join date, capped at 1 minimum
- Contacts: exactly one must have `receives_payments = true`; multiple may have `receives_updates = true`
- Custom pricing overrides system defaults (see `config/defaults.ts`): if `otp_price`, `user_threshold`, or `block_price` is null on the client, system defaults apply
- `block_size` is a global system setting only — no per-client `block_size` column exists

**Known issues / TODOs:**
- WhatsApp tab chat history is static mock; needs real data from `messages` table
- Support tickets tab is entirely mock; no `tickets` table exists yet

---

### `Billing.tsx`

**Purpose:** Billing records management — view open payments, payment history, configure system-wide pricing defaults.

**Key components:**
- `OpenPaymentsTab` — table of unpaid/pending/failed records with "Send Payment Request" action
- `HistoryTab` — table of paid records
- `PricingTab` — edits `AppSettings` (stored in localStorage via SettingsContext)
- `PaymentModal` — shows variable billing breakdown before sending a payment request
- `AlertBanner` — red banner when any `cc_status = 'failed'` records exist

**Supabase connections:**
- `getBillingWithClients()` — join of `billing_records` + `clients` with pricing info
- `updateBillingStatus()` — updates `cc_status` or `variable_status` on a record

**Business logic:**
- `deriveStatus()`: if `cc_status = 'failed'` → `failed`; if `variable_status = 'paid'` → `paid`; if `variable_status = 'pending'` → `pending`; else `unpaid`
- Payment modal shows **variable billing only** — fixed monthly charge is handled by WooCommerce automatically
- `daysOpen` = days since `created_at` of billing record (shown in red if > 10 days)
- `amount_paid` and `payment_date` are read from Supabase and displayed in the billing table
- Table column order: קבוע (`amount_paid`), OTP (otp_count), משתמשים (user_count), תוספת תשלום חודשית (`variable_total`), סה"כ (`amount_paid + variable_total`)
- `block_size` is read from `settings.DEFAULT_BLOCK_SIZE` (global setting) — the embedded join does **not** select `block_size` from `clients` (no such column; doing so causes a 400 error)

**Known issues / TODOs:**
- "Send Payment Request" button updates `variable_status` to `pending` in DB but does not actually call Cardcom API yet — that is Agent 3 (not built)

---

### `WhatsApp.tsx`

**Purpose:** WhatsApp messaging hub — bulk send, template editor, warming sequences, message log.

**Three tabs:**
- **Compose** — select recipient packages, pick template, write message, send via n8n webhook
- **Templates** — view/edit Welcome Message and all send templates; add/remove/reorder sequence steps
- **Log** — message history from Supabase

**Key components:**
- `ComposeTab` — multi-select package checkboxes (Solo Pro / Master Class / Community Master), template picker, message textarea, send button that POSTs to n8n
- `TemplatesTab` — Welcome Message editor; editable template cards; sequence builder (add/remove/reorder steps per sequence)
- `LogTab` — paginated message history table

**Supabase connections:**
- `getAllMessages()` — fetches message log
- `getClientNameMap()` — resolves client IDs to names in log view
- `getMessageTemplates()` — loads all templates (first row = Welcome Message by `created_at ASC`)
- `updateMessageTemplate(id, { body })` — saves template edits
- `getSequences()` — loads all sequences with their steps
- `updateSequenceStep(id, patch)` — saves step edits (day, message, step_order)
- `createSequenceStep(data)` — adds a new step
- `deleteSequenceStep(id)` — removes a step
- `getClients()` — loads all clients with `client_contacts` for the recipient selector

**n8n webhook:**
- **Endpoint:** `POST https://primary-production-2bdeb.up.railway.app/webhook/send-bulk`
- **Body:** `{ "packages": ["solo_pro", "master_class"], "message": "text with {{שם}}" }`
- n8n handles recipient lookup, `{{שם}}` substitution, Green API send, and logging to `messages` table
- **CORS note:** when deployed to Vercel (non-localhost), the webhook's Allowed Origins must be updated from `*/localhost` to the production domain

**Business logic:**
- Packages selected via checkboxes (multi-select); default = all three selected
- Recipient count display = contacts with `receives_updates = true` in selected packages; no status filtering
- `willSend` useMemo is for display only — the actual send payload is just `{ packages, message }`
- Template placeholder: `{{שם}}` (U+05E9 U+05DD — Hebrew "שם" = name). Insert button puts this exact string; n8n replaces it with the contact's name.
- Channel routing: clients → `service` number; leads → `sales` number
- Sequences: `seq_key` `a`/`b`/`c` — styled with fixed CSS accent colors (not stored in DB)

**Known issues / TODOs:**
- `createMessages` no longer called from ComposeTab (n8n handles logging); if n8n doesn't write to `messages`, the log tab will be empty for bulk sends
- Sequences "Save" button persists step edits to DB but does not trigger or restart active sequence runs in n8n

---

### `Leads.tsx`

**Purpose:** Lead CRM — Kanban board for leads from Facebook/Instagram ads.

**Kanban columns (left to right):**
1. `new` — ליד חדש (new lead, came from ad)
2. `meeting_set` — נקבעה שיחה (meeting scheduled via Calendly)
3. `producer` — מעוניין — בהפקה (interested, in production process)
4. `follow_up` — לחזור אליו (needs manual follow-up)

**Key components:**
- Kanban column cards — drag-style status change via "Move" dropdowns
- Lead detail modal with 3 tabs: Details, WhatsApp (chat), Follow-up (sequence enrollment)

**Supabase connections:**
- `getLeads()` — fetches all leads where `status != 'irrelevant'`
- `updateLead()` — saves status, follow-up info, notes
- `archiveLead()` — sets `status = 'irrelevant'`

**Business logic:**
- `lead_type` determines warming sequence: `has_course` → Sequence A (שרשרת א׳), `producing` → Sequence B (שרשרת ב׳)
- Follow-up tones: `friendly`, `professional`, `urgent` — used by the sales bot
- Leads in `follow_up` status with a past `follow_up_date` are highlighted

---

### `Agents.tsx`

**Purpose:** n8n automation agent monitoring and control panel.

**Two views:**
1. **List tab** — expandable cards per agent with status, schedule, last run, log
2. **Flow map tab** — visual flow diagrams grouped by function

**Key components:**
- `AgentCard` — collapsible card showing status badge, schedule, run controls, activity log
- `FlowCard` / `FlowNodeCard` / `FlowConnector` — visual flow map nodes
- `Toggle` — enable/disable agent (local state only; does not call n8n API)

**Supabase connections:**
- `getLatestAgentStatus()` — fetches latest log per agent_id on mount; overlaid onto static agent data
- `getAgentLogs(agentId)` — lazy-loaded when an agent card is expanded

**Business logic:**
- Agent status is derived from the latest `agent_logs` row: `running` → פעיל, `error` → שגיאה, anything else → ממתין
- "Run Now" button is UI-only (2s simulated delay); real trigger would call n8n webhook
- Static `AGENTS` array is the source of truth for agent definitions; DB overlays last-run info

**Known issues / TODOs:**
- Toggle on/off is local state only; does not persist to DB or pause n8n
- "Run Now" does not call the real n8n webhook

---

### `Permissions.tsx`

**Purpose:** User management and per-module access control.

**Roles:** `admin` (full access), `staff` (configurable)

**Module permissions (per user):**
- `dashboard`: `none` | `view`
- `clients`: `none` | `view` | `edit` | `full`
- `billing`: `none` | `view` | `full`
- `whatsapp`: `none` | `view` | `send` | `full`
- `leads`: `none` | `view` | `edit` | `full`
- `agents`: `none` | `view` | `full`
- `work`: `none` | `view` | `edit` | `full`
- `pricing`: `none` | `full`
- `permissions`: `none` | `full` (admin-only)

**Known issues / TODOs:**
- Entirely static mock data; does not read from or write to the `profiles` table yet

---

### `Work.tsx`

**Purpose:** Internal dev team task management system. **UI is in English** (unlike the rest of the app which is Hebrew).

**Five tabs:**
1. **My Board** — Personal Kanban filtered to logged-in user's tasks
2. **Tasks** — Full team board with all assignees
3. **Gantt** — Timeline view by due date
4. **Docs** — Internal document list and viewer
5. **New Task (AI)** — Natural language task creation via Claude API

**Key components:**
- `VerticalBoard` — vertical Kanban columns with drag-style card reordering
- `MyBoard` — personal filtered task view
- `TaskDetailModal` — full task editor with time tracking, comments, attachments, status history, code/UX review assignment
- `FloatingTimerWidget` — persistent bottom-right timer that survives page navigation
- `AiTaskCreator` — sends user prompt to Claude, parses response into a `Task` object

**Supabase connections:**
- `getTasks(board?)` — loads tasks, optionally filtered by board
- `createTask(task)` — creates new task row
- `updateTask(id, updates)` — partial update; always sets `updated_at`

**Business logic:**
- Time entries: `{ id, date, hours, minutes, loggedBy, note, isLocked, createdAt }` — stored as JSONB. `isLocked = true` means created by the floating timer (cannot be edited manually).
- Status flow: `not_started` → `in_progress` → `fixing` | `pending_code_review` | `pending_ux_review` → `done` → `archived`
- `whatsapp_pending = true` blocks the task from moving to `pending_ux_review` until WhatsApp approval is given
- `claimed` / `claimedBy` — a dev can claim an unclaimed ticket; notification fires to others when claimed
- Code reviewer and UX reviewer are separate assignees per task

---

### `Settings.tsx`

**Purpose:** Configure WhatsApp channel phone numbers for display.

- Two cards: Service number (clients) and Sales number (leads)
- Phone labels are stored in `localStorage` with key `waPhoneLabel_service` / `waPhoneLabel_sales`
- Actual Green API credentials are in `.env` — this page just sets the display label

---

### `Login.tsx`

**Purpose:** Supabase email + password authentication.

- On submit: calls `supabase.auth.signInWithPassword()`
- On success: `useAuth` hook detects session change and fetches profile
- No self-registration; users must be created via Supabase dashboard

---

## 7. Critical Business Logic

### Billing Calculation Formula

```
variable_total = (otp_count × otp_price) + (⌈max(0, user_count − user_threshold) / block_size⌉ × block_price)
```

**Per-client pricing fallback chain:**
1. Client's own `otp_price` / `user_threshold` / `block_price` if set (no per-client `block_size`)
2. System defaults from `AppSettings` stored in localStorage (configurable in Billing → Pricing tab)
3. Hard defaults: `otp_price = ₪1`, `user_threshold = 250`, `block_size = 250`, `block_price = ₪100`

**Note:** `block_size` is always the system-wide value — it cannot be customized per client.

**Example from Billing.tsx `PricingTab`:**
> 300 OTP + 500 users (threshold 250, block 250, block price ₪100):
> `300 × ₪1 = ₪300` + `⌈(500−250)/250⌉ × ₪100 = 1 × ₪100 = ₪100` → **₪400 variable**

---

### Dual WhatsApp Numbers Logic

The system has **two Green API instances**:

| Instance | Purpose | Used for |
|---|---|---|
| `VITE_GREEN_API_INSTANCE_SERVICE` | Service/support number | Clients (`recipient_type = 'client'`) |
| `VITE_GREEN_API_INSTANCE_SALES` | Sales number | Leads (`recipient_type = 'lead'`) |

Routing logic in `src/lib/whatsapp.ts`:
- `getRecipientChannel(recipientType)` → `'client'` → `'service'`; `'lead'` → `'sales'`
- `getTemplateChannel(templateId)` → template IDs 1–7 → `'service'`; all others → `'sales'`
- Phone normalization: strips non-digits, converts `05x...` → `9725x...`, appends `@c.us`

---

### Time Tracking Entries Structure

Stored as JSONB array in `tasks.time_entries`:

```typescript
interface TimeEntry {
  id: string          // random
  date: string        // YYYY-MM-DD
  hours: number
  minutes: number
  loggedBy: string    // developer name
  note?: string
  isLocked: boolean   // true = created by floating timer; cannot be manually edited
  createdAt: string   // ISO timestamp
}
```

The floating timer stores its in-progress state in `localStorage` under the key from `TimerContext.PENDING_KEY`. When the timer is stopped, a locked `TimeEntry` is appended to the task and saved to Supabase.

---

### Work Module Status Flow and Automations

**Status transitions:**
```
not_started
    ↓
in_progress
    ↓
┌─────────────────────────────────────┐
│ fixing          (bug found)         │
│ pending_code_review                 │
│ pending_ux_review                   │
└─────────────────────────────────────┘
    ↓
done
    ↓
archived
```

**Automatic notifications (NotificationContext):**
- Task moves to `pending_code_review` → notify assigned `code_reviewer`
- Task moves to `pending_ux_review` → notify assigned `ux_reviewer`
- Task moves to `fixing` → notify original assignee
- Task has `whatsapp_pending = true` → cannot advance past `in_progress` until approved
- Unclaimed ticket sits for > X minutes → `ticket_unclaimed` notification
- Review request sits stale → `review_stale` notification
- `status_owner_assigned` → when a board status with `owner` is assigned a task
- `task_done_return` → when a done task is reopened

---

## 8. n8n Agents — Complete List

All agents hosted on n8n (self-hosted on Railway). All agents log to `agent_logs` on every run.

---

### Shared Infrastructure & Conventions

**Cardcom API (read):** `POST https://secure.cardcom.solutions/api/v11/Transactions/ListTransactions`
- Terminal: `164833`
- Response shape: `data[0].Tranzactions[]`
- Matching key: CustomField `Id 21` = `wc_user_{customer_id}` — compared against `clients.cardcom_foreign_account_number`
- Keys currently hardcoded in HTTP nodes (**⚠️ keys exposed during build session — must be rotated**). `$env` approach abandoned — n8n blocks env access when `N8N_RUNNERS_ENABLED=true`.

**WooCommerce REST:** `GET https://dyoapp.com/wp-json/wc/v3/subscriptions` — uses WooCommerce account credential. Returns `next_payment_date_gmt`, `status`, `customer_id`, etc.

**Webhook pattern:** WooCommerce `subscription.*` events are **not** supported by n8n's WooCommerce Trigger node (only order/customer/product). Use a generic **Webhook node (POST)** and paste the Production URL into the WooCommerce webhook Delivery URL.

**Hosting:** n8n on Railway — service `Primary` (`primary-production-2bdeb...`). Also: Worker, Redis, Postgres services.

**`billing_records` upsert pattern:** `UNIQUE (client_id, month, year)` constraint exists (`billing_records_client_id_month_year_key`). All billing writes use **Create + Update-on-error** (no native upsert in this n8n Supabase node).

---

### `woo-new-client` — New Customer (BUILT ✅)

**Workflow name:** Agent 1 - New Customer  
**Trigger:** Webhook (POST) — WooCommerce event: Subscription created  
**Flow:** Webhook → Insert `clients` → Log `agent_logs` → Call `cardcom-verify-activate`

**Node details:**
- **Webhook** — replaces old WooCommerce Trigger node. Event = Subscription created, API = WP REST API Integration v3.
- **הזנת נתוני משתמש במערכת** — Supabase Create row, `clients`:
  - `name` = `{{$json.billing.first_name}} {{$json.billing.last_name}}`
  - `business_name` = `{{$json.billing.company}}`
  - `email`, `phone` = billing fields
  - `package` = ternary mapping: Solo Pro / Community Master / Master Class → enum, fallback `solo_pro`
  - `status` = WooCommerce status mapped to enum (`completed→active`, `on-hold→on_hold`, etc.)
  - `woo_customer_id` = `{{$json.customer_id}}`
  - `cardcom_foreign_account_number` = `{{ 'wc_user_' + $json.customer_id }}` *(Fixed: was reading a non-existent meta key and writing empty)*
- **Create a row** — `agent_logs`: `agent_id=woo-new-client`, `status=success`, `run_at=now()`
- **Call 'Verify Cardcom Payment'** — Execute Workflow node, calls `cardcom-verify-activate`. Passes context via passthrough.

**Decisions:**
- Trigger is Subscription created (fires once on new subscription) → no duplicate-client risk on monthly renewals.
- `cardcom_account_id` field still reads a non-existent meta key (writes empty). Left as-is — not used downstream.

**Writes to Supabase:** `clients` (new row), `agent_logs`

---

### `cardcom-verify-activate` — Verify Cardcom Payment (BUILT ✅)

**Workflow name:** Verify Cardcom Payment  
**Trigger:** Execute Workflow Trigger — called directly by `woo-new-client` (not a separate webhook)  
**Flow:** Receive context → Cardcom HTTP → Code match → IF verified → [true] Update status → Upsert `billing_records` → Log success / [false] Set `payment_failed_at` → Log error

**Node details:**
- **בקשת נתוני עסקאות מקארדקום** — HTTP POST `ListTransactions`. Body: `TerminalNumber=164833`, `ApiName/ApiPassword` (hardcoded — rotate), `Page_size=10`, `Page=1`, `FromDate={{ DateTime.fromISO($json.created_at).minus({ days: 1 }).toFormat('ddMMyyyy') }}` (1-day safety margin), `ToDate=now`.
- **השוואה...** — Code node. Reads `data[0].Tranzactions`, matches CustomField `Id 21` (cast to Number) vs trimmed `cardcom_foreign_account_number`. Requires `ResponseCode===0` and `IsRefund===false`. Returns `{ payment_verified, amount, payment_date, client_id }`.
- **Check Payment Verified** — IF, Boolean `{{ $json.payment_verified }}` is true. *(Fixed: was a string compare with empty 2nd condition.)*
- **[true] עדכון סטטוס לקוח** — Supabase Update `clients`, filter `id eq client_id` *(Fixed: was filtering on non-existent `wc_user_id`)*, set `status=active`.
- **[true] עדכון מחיר** — Supabase Create `billing_records` (`client_id`, `month`, `year`, `amount_paid`, `payment_date`, `cc_status=paid`, `variable_status=pending`). `onError: continueErrorOutput`.
- **[true, error branch] עדכון מחיר קיים** — Supabase Update `billing_records`, allFilters `client_id+month+year`, same fields. The "exists → update" half of the upsert pattern.
- **[true] עדכון תשלום עבר בהצלחה** — `agent_logs` success, `agent_id=cardcom-verify-activate`.
- **[false] עדכון הודעת שגיאת תשלום** — Supabase Update `clients`, set `status=pending`, `payment_failed_at=now()`.
- **[false] עדכון שדות תשלום לא אומת** — `agent_logs` error, `agent_id=cardcom-verify-activate`.

**Decisions:**
- Upsert = Create + (on error) Update because the `UNIQUE(client_id, month, year)` constraint would otherwise throw on a duplicate row.

**Writes to Supabase:** `clients` (status, payment_failed_at), `billing_records`, `agent_logs`

---

### `package-change` — Subscription Package Change (BUILT ✅)

**Workflow name:** עדכון חבילת הרשמה למנוי  
**Trigger:** Webhook (POST) — WooCommerce event: Subscription switched  
**Flow:** Webhook → Update `clients.package` → Log `agent_logs`

**Node details:**
- **Update a row** — Supabase Update `clients`, filter `woo_customer_id eq {{$json.customer_id}}`, set `package` = same ternary mapping as `woo-new-client` (3 packages → enum, fallback `solo_pro`).
- **Create a row** — `agent_logs`: `agent_id=package-change`, `status=success`, `run_at=now()`.

**Decisions:**
- Mid-cycle proration **not implemented**. Package change takes effect immediately; monthly check picks up the correct price going forward.
- `package` is a Postgres enum with exactly `solo_pro`, `master_class`, `community_master`. Invalid values rejected by DB. Fallback = `solo_pro` (malfunction surfaces as unexpected Solo Pro — visible red flag).

**Writes to Supabase:** `clients` (package), `agent_logs`

---

### `status-change` — Subscription Status / Cancellation (BUILT ✅)

**Workflow name:** עדכון על שינוי סטטוס\ביטול  
**Trigger:** Webhook (POST) — WooCommerce event: Subscription updated (covers cancellation — no separate cancel agent needed)  
**Flow:** Webhook → Update `clients.status` → IF critical → [true] Log error (red dashboard alert) / [false] Log success

**Node details:**
- **עדכון סטטוס לקוח** — Supabase Update `clients`, filter `woo_customer_id`, set `status` = mapping: `active→active`, `on-hold→on_hold`, `pending→pending`, `cancelled→cancelled`, `expired→expired`, fallback `pending`.
- **If** — Boolean `{{ $json.status == 'cancelled' || $json.status == 'on-hold' }}` is true.
- **[true] עדכון סטטוס איגנט** — `agent_logs` **error** (forces red dashboard alert), `agent_id=status-change`, `result_summary = "שינוי קריטי — לקוח {id} עבר ל: {status}"`.
- **[false] עדכון סטטוס איגנט1** — `agent_logs` success, same `agent_id`.

**Decisions:**
- Critical statuses that trigger dashboard alert: `cancelled` + `on-hold` (confirmed with Dror).
- App takedown on cancellation is **not automated** — dashboard alert only; team handles manually.

**Writes to Supabase:** `clients` (status), `agent_logs`

---

### `daily-payment-check` — Daily Payment Reconciliation (BUILT ✅)

**Workflow name:** בדיקת תשלום חודשי למנויים  
**Trigger:** Schedule — daily at 06:00  
**Flow:** Schedule → Get WooCommerce subscriptions → Code filter → Cardcom HTTP → Code cross-match → IF paid → [true] Get client → Update `billing_records` → Log success / [false] Log error

**Node details:**
- **API DYOAPP** — HTTP GET WooCommerce subscriptions (WooCommerce credential).
- **סינון עסקאות** — Code. Keeps subscriptions where `status` is `active` or `pending` AND `next_payment_date_gmt` is within the last 0–2 days (`diffDays 0..2`). Maps to `{ subscription_id, customer_id, cardcom_foreign_account_number: 'wc_user_'+customer_id, total, status, email }`.
- **בקשת נתוני עסקאות מקארדקום** — HTTP POST `ListTransactions`, `FromDate=now-3 days`, `ToDate=now`, `Page_size=150`. Keys hardcoded (rotate).
- **בדיקת עסקאות** — Code. Cross-matches each filtered client vs `data[0].Tranzactions` on CustomField `Id 21`. Adds `{ paid, amount, payment_date, transaction_id }`. Reads `$('סינון עסקאות').all()`.
- **If** — Boolean `{{ $json.paid }}` is true.
- **[true] איסוף נתוני משתמשים להשוואה** — Supabase Get `clients` by `woo_customer_id` (to retrieve Supabase `id`).
- **[true] רישום תשלום חדש** — Supabase Update `billing_records`, allFilters `client_id+month+year`, set `amount_paid`, `payment_date`, `cc_status=paid`.
- **[true] רישום הצלחה איגנט** — `agent_logs` success, `agent_id=daily-payment-check`.
- **[false] רישום כישלון איגנט** — `agent_logs` error, `result_summary` includes `customer_id + email`.

**Decisions:**
- Safety layer / financial sync. Primary failed-payment detection is via `status-change` (WooCommerce sets on-hold → `status-change` alerts dashboard).
- Uses `next_payment_date` (due date), NOT `last_payment_date` — unpaid customers never get a new `last_payment_date` and would be missed.
- Handles **only** the fixed monthly subscription payment. OTP + users variable billing is a separate future agent.

**Writes to Supabase:** `billing_records`, `agent_logs`

---

### Canonical `agent_id` Registry

| `agent_id` | Workflow name | Trigger | Status |
|---|---|---|---|
| `woo-new-client` | Agent 1 - New Customer | Webhook — Subscription created | ✅ Built |
| `cardcom-verify-activate` | Verify Cardcom Payment | Called by `woo-new-client` | ✅ Built |
| `package-change` | עדכון חבילת הרשמה למנוי | Webhook — Subscription switched | ✅ Built |
| `status-change` | עדכון על שינוי סטטוס\ביטול | Webhook — Subscription updated | ✅ Built |
| `daily-payment-check` | בדיקת תשלום חודשי למנויים | Schedule — daily 06:00 | ✅ Built |
| `send-bulk` | שליחה מרוכזת בווטסאפ | Webhook — POST from admin UI Compose tab | ✅ Built |
| `variable-billing` | *(not built)* | Schedule — 1st of month | Planned |
| `collection-followup` | *(not built)* | Schedule — days 15 / 20 / 25 | Planned |
| `renewal-alerts` | *(not built)* | Schedule — daily | Planned |
| `lead-wa-contact` | *(not built)* | Lead status change webhook | Planned |

---

### Open Tasks Before Production

1. **Rotate Cardcom API keys** — exposed during build session. Decide final storage: hardcoded-in-node (works now) vs Custom Auth credential (cleaner). `$env` approach abandoned — n8n blocks env access; `N8N_RUNNERS_ENABLED=true` must stay.
2. **End-to-end test** — one real test order through `woo-new-client` → `cardcom-verify-activate`, verify: `clients` row populated, `cardcom_foreign_account_number` set, `billing_records` created, `agent_logs` success. *(Site had an issue during session; deferred.)*
3. **Verify all WooCommerce webhooks** — correct Production URLs wired for events: created / switched / updated. All workflows set to Active.
4. **WooCommerce retry settings** — configure failed-payment automatic retries before on-hold. Separate task.

---

### `send-bulk` — Bulk WhatsApp Send (BUILT ✅)

**Workflow name:** שליחה מרוכזת בווטסאפ  
**Trigger:** Webhook (POST) — called by the admin UI ComposeTab send button  
**Flow:** Webhook → Fetch matching clients from Supabase → Fetch their `receives_updates` contacts → Loop with 6s Wait between each → Send via Green API (service number) → Log each to `messages` table

**Request body shape:**
```json
{
  "packages": ["solo_pro", "master_class"],
  "message": "message text with {{שם}} placeholder"
}
```

**Node details:**
- **Webhook** — POST. Allowed Origins currently set to `*/localhost` — **must be updated to production domain before deploy**.
- **Fetch clients** — Supabase query `clients` (no filter in the Supabase node itself). Package matching is done in a **separate Filter node** immediately after, because the Supabase node has no `IN` operator for list membership. Filter expression: `{{ $('Webhook').item.json.body.packages.includes($json.package) }}`.
- **Fetch contacts** — for each client, get `client_contacts` where `receives_updates = true`.
- **Loop** — iterates over contacts. Flow order inside the loop: **HTTP Request → Create a row (messages log) → Wait (6s) → back to Loop**.
- **Send (HTTP Request)** — HTTP POST to Green API service number instance. Both `chatId` and `message` values are wrapped in `JSON.stringify()` to prevent line breaks in the message from breaking the JSON body. The `{{שם}}` placeholder in the replace expression is split as `'{' + '{שם}' + '}'` so n8n's expression parser does not interpret it as its own expression. Credentials embedded directly in HTTP node.
- **Log (Create a row)** — Supabase Create in `messages` table per sent message, inside the loop, before the Wait.

**Decisions:**
- No status filtering on clients — business decision: `on_hold` clients still receive WhatsApp bulk sends.
- `{{שם}}` replacement done in n8n, not the frontend — frontend sends raw message text.
- Green API credentials embedded in HTTP nodes (same pattern as Cardcom — `$env` approach abandoned; `N8N_RUNNERS_ENABLED=true` blocks env access).
- ⚠️ **Not yet verified:** the 6-second Wait between sends has not been confirmed in a live multi-recipient run. Awaiting confirmation after a real test send before marking this fully done.

**Writes to Supabase:** `messages`

---

### Remaining Agents — Build Roadmap

1. **Connect Green API** — service number (clients) + sales number (leads). Needs: Instance ID + Token for both numbers. **Immediate next step (per Dror).**
2. **Sales bot** (`sales-bot`) — Green API sales number + LLM. **First bot (sales priority).**
3. **`variable-billing`** — monthly: collect OTP + user counts from SuperAdmin API (Fahad), calculate `variable_total`, send Cardcom payment requests. Needs SuperAdmin API access + Cardcom charge endpoint.
4. **`collection-followup`** — escalating WhatsApp reminders on days 15 / 20 / 25 for unpaid variable billing.
5. **Support bot** (`support-bot`) — after sales bot.
6. **`renewal-alerts`** — daily scan for clients in month 11–12, send WhatsApp renewal offer.
7. **`lead-wa-contact`** — save lead phone as WhatsApp contact via Green API on status change, in format `"שם DYO"`.

---

## 9. Supabase Tables — Current State Summary

| Table | Status | Notes |
|---|---|---|
| `clients` | Live | Includes WooCommerce + Cardcom linking columns; no per-client `block_size` column |
| `client_contacts` | Live | Single source of truth for all client phone numbers |
| `billing_records` | Live | |
| `leads` | Live | |
| `messages` | Live | |
| `message_templates` | Live | WhatsApp templates; first row by `created_at` = Welcome Message |
| `sequences` | Live | Warming sequence definitions |
| `sequence_steps` | Live | Steps within each warming sequence |
| `agent_logs` | Live | Required: all n8n agents must write here |
| `tasks` | Live | Powers Work module |
| `profiles` | Live | Auth user profiles |

**Note:** All tables should have Row Level Security (RLS) enabled. Authenticated users should only see data appropriate for their role.

---

## 10. Integration Points

### WooCommerce
- Sends webhook to n8n on new subscription
- Fixed monthly charges handled by WooCommerce recurring payments
- Customer ID stored in `clients.woo_customer_id`

### Cardcom API
- **Base URL:** `https://secure.cardcom.solutions/api/v11/`
- **Transaction list:** `POST /Transactions/List`
- **Custom fields in transactions:**
  - `Id 21` → `wc_user_xx` (WooCommerce user identifier)
  - `Id 22` → WooCommerce Order ID
  - `Id 23` → Customer email
- Used for: variable charge payment requests, payment status verification, monthly audit

### Green API
- **2 instances** — see Environment Variables section
- **Service instance** — for client messages (billing, support, renewal)
- **Sales instance** — for lead messages (warming sequences, sales bot)
- Phone format: `972XXXXXXXXX@c.us` (drop leading `0`, prepend `972`)

### Anthropic API (Claude)
- Used in `AiTaskCreator` in the Work module
- Sends natural language description, receives structured task JSON
- Model: use latest Claude Sonnet (claude-sonnet-4-6 as of last update)

### Calendly
- Used by sales bot to schedule discovery calls with leads
- Not yet integrated in code; planned for sales bot flow

### ClickUp
- Used by support bot to create tickets for complex support issues
- Not yet integrated in code; planned for support bot flow

---

## 11. Working Rules for Future Sessions

1. **UI language is Hebrew, RTL** — always set `dir="rtl"` on page wrappers. Exception: Work module is English LTR.
2. **Brand colors** — always use these, never raw hex:
   - Primary: `#1F3272` (deep navy) → Tailwind class `text-primary`, `bg-primary`
   - Secondary: `#6ECFCA` (teal) → `text-secondary`, `bg-secondary`
   - Accent: `#FF7F50` (coral/orange) → `text-accent`, `bg-accent`
3. **Client status enum must match WooCommerce:** `active`, `pending`, `on_hold`, `expired`, `cancelled` — do not invent new values.
4. **All monetary amounts in Israeli Shekels (₪)** — display with `₪` prefix, never `$` or `€`.
5. **Phone numbers in Israeli format** — store as-is; normalize to `972XXXXXXXXX@c.us` only when calling Green API.
6. **Update HANDOFF.md at end of each session** — especially when: new Supabase columns are added, new agents are built, integration details change.
7. **When adding new Supabase columns:** also update the TypeScript interface in `src/lib/database.ts` AND update Section 9 of this document.
8. **When building n8n agents:** always log to `agent_logs` table with `agent_id` matching the ID in the `AGENTS` array in `Agents.tsx`.
9. **Supabase Row Level Security** — always enable RLS on new tables. Write policies before shipping.
10. **No comments in code** unless the WHY is genuinely non-obvious. No trailing summary comments.
11. **WooCommerce order status mapping** — WooCommerce sends `status = 'completed'` for paid orders. Always map this to `'active'` in n8n before writing to Supabase. Never write `'completed'` to the `clients.status` column — it is not a valid enum value.

---

## 12. Next Steps In Order

| # | Task | Status |
|---|---|---|
| 1 | Connect dashboard alerts to `agent_logs` | Done ✅ |
| 2 | Build `woo-new-client` — WooCommerce Subscription created → insert client | Done ✅ |
| 3 | Build `cardcom-verify-activate` — verify payment → activate client or set `payment_failed_at` | Done ✅ |
| 4 | Build `package-change` — Subscription switched → update `clients.package` | Done ✅ |
| 5 | Build `status-change` — Subscription updated → update `clients.status`; red dashboard alert on cancellation/on-hold | Done ✅ |
| 6 | Build `daily-payment-check` — daily 06:00, cross-match WooCommerce + Cardcom, update `billing_records` | Done ✅ |
| 7 | Test `woo-new-client` → `cardcom-verify-activate` full flow end-to-end | In progress |
| 8 | Rotate Cardcom API keys (exposed during build session) | Next |
| 9 | Connect Green API — service number (clients) + sales number (leads) | Next |
| 9b | Update n8n `send-bulk` webhook Allowed Origins from `*/localhost` to production URL (required before Vercel deploy) | Before deploy |
| 10 | Build `sales-bot` — Green API sales number + LLM (sales priority first) | Planned |
| 11 | Build `variable-billing` — monthly OTP + users collection → calculate `variable_total` → Cardcom payment requests | Planned |
| 12 | Build `collection-followup` — escalating WhatsApp reminders days 15 / 20 / 25 for unpaid variable billing | Planned |
| 13 | Build `support-bot` — after sales bot | Planned |
| 14 | Build `renewal-alerts` — daily scan for clients in month 11–12, send WhatsApp renewal offer | Planned |
| 15 | Build `lead-wa-contact` — save lead as WhatsApp contact via Green API on status change | Planned |
| 16 | Connect Permissions page to real `profiles` table | Planned |
| 17 | Deploy to Vercel | Planned |
