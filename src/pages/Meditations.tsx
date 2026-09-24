import { useState, useEffect, useMemo } from 'react'
import {
  Video, Plus, Search, Trash2, Pencil, X, Loader2, AlertCircle,
  Calendar, ExternalLink, RefreshCw, Play,
} from 'lucide-react'
import {
  getMeditations, createMeditation, updateMeditation, deleteMeditation,
  type DbMeditation,
} from '../lib/database'
import { useLang } from '../contexts/LanguageContext'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// recorded_at is a timestamptz, so both the day and the time of the session
// are shown. Falls back to the raw value rather than rendering "Invalid Date".
function fmtDateTime(iso: string | null, lang: 'he' | 'en'): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm", not an ISO
// UTC string — converting through the raw ISO would shift the shown time.
function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date()
  if (isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

// Recordings live in Google Drive / YouTube — nothing is uploaded here, only
// linked. A bad paste should never render as a clickable broken link.
function isUsableUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// Google Drive and YouTube both expose an embeddable player, so a recording can
// play inside the dashboard instead of sending the viewer off to another tab.
// Returns null for anything else — the card then falls back to a plain link
// rather than dropping an untrusted URL straight into an iframe.
function embedUrlFor(rawUrl: string): string | null {
  let u: URL
  try {
    u = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null

  // https://drive.google.com/file/d/<id>/view  ->  .../preview
  if (u.hostname === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1]
    return id ? `https://drive.google.com/file/d/${id}/preview` : null
  }

  // youtu.be/<id>  and  youtube.com/watch?v=<id>
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1)
    return id ? `https://www.youtube.com/embed/${id}` : null
  }
  if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
    const id = u.searchParams.get('v') ?? u.pathname.match(/\/embed\/([^/]+)/)?.[1]
    return id ? `https://www.youtube.com/embed/${id}` : null
  }

  return null
}

// Poster frame for the card. Drive and YouTube both serve one from a plain
// image URL, so no API call or stored asset is needed. null -> the card shows
// a neutral placeholder instead of a broken image.
function thumbnailUrlFor(rawUrl: string): string | null {
  let u: URL
  try {
    u = new URL(rawUrl.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null

  if (u.hostname === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([^/]+)/)?.[1]
    return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w640` : null
  }
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1)
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
  }
  if (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') {
    const id = u.searchParams.get('v') ?? u.pathname.match(/\/embed\/([^/]+)/)?.[1]
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
  }
  return null
}

// ─── Loading / error ──────────────────────────────────────────────────────────

function LoadingScreen() {
  const { t } = useLang()
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-400">
      <Loader2 size={32} className="animate-spin text-primary/40" />
      <p className="text-sm">{t('טוען מדיטציות...', 'Loading meditations...')}</p>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLang()
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <AlertCircle size={32} className="text-red-300" />
      <p className="text-sm text-red-500">{message}</p>
      <button onClick={onRetry} className="flex items-center gap-2 text-xs text-primary border border-primary/30 px-3 py-2 rounded-lg hover:bg-primary/5 transition-colors">
        <RefreshCw size={13} />{t('נסה שוב', 'Try again')}
      </button>
    </div>
  )
}

// ─── Add / edit modal ─────────────────────────────────────────────────────────

function MeditationModal({ existing, categories, onClose, onSave }: {
  /** null = creating a new one. */
  existing: DbMeditation | null
  categories: string[]
  onClose: () => void
  onSave: (data: {
    title: string; description: string; url: string
    category: string; recorded_at: string
  }) => Promise<void>
}) {
  const { t } = useLang()
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [url, setUrl] = useState(existing?.url ?? '')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [recordedAt, setRecordedAt] = useState(toLocalInput(existing?.recorded_at ?? null))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const urlOk = !url.trim() || isUsableUrl(url)
  const canSubmit = !!title.trim() && !!url.trim() && urlOk && !saving

  async function save() {
    if (!canSubmit) return
    setSaving(true)
    setError('')
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        url: url.trim(),
        category: category.trim(),
        recorded_at: recordedAt ? new Date(recordedAt).toISOString() : '',
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('השמירה נכשלה', 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'h-10 w-full rounded-lg border border-gray-200 bg-surface px-3 text-sm outline-none focus:border-primary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label={t('סגור', 'Close')} />
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-primary">
            {existing ? t('עריכת מדיטציה', 'Edit meditation') : t('הוספת מדיטציה', 'Add meditation')}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="grid gap-3">
          <label className="text-xs font-semibold text-gray-500">
            {t('כותרת', 'Title')} *
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className={`${inputClass} mt-1.5`} />
          </label>

          <label className="text-xs font-semibold text-gray-500">
            {t('קישור להקלטה', 'Recording link')} *
            <input
              dir="ltr"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
              className={`${inputClass} mt-1.5 ${!urlOk ? 'border-red-300' : ''}`}
            />
            {!urlOk && (
              <span className="mt-1 block font-normal text-red-500">
                {t('קישור לא תקין — יש להדביק כתובת מלאה', 'Not a valid link — paste the full address')}
              </span>
            )}
            <span className="mt-1 block font-normal text-gray-400">
              {t(
                'הקלטת Google Meet נשמרת אוטומטית ב-Drive — הדביקו כאן את קישור השיתוף שלה',
                'A Google Meet recording is saved to Drive automatically — paste its share link here',
              )}
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-gray-500">
              {t('תאריך ושעת ההקלטה', 'Recorded on')}
              <input type="datetime-local" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} className={`${inputClass} mt-1.5`} />
            </label>
            <label className="text-xs font-semibold text-gray-500">
              {t('קטגוריה', 'Category')}
              <input
                list="meditation-categories"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder={t('לדוגמה: בוקר', 'e.g. Morning')}
                className={`${inputClass} mt-1.5`}
              />
              <datalist id="meditation-categories">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </label>
          </div>

          <label className="text-xs font-semibold text-gray-500">
            {t('תיאור', 'Description')}
            <textarea
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="mt-1.5 w-full resize-none rounded-lg border border-gray-200 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="h-9 px-3 text-sm text-gray-500">{t('ביטול', 'Cancel')}</button>
          <button
            onClick={() => void save()}
            disabled={!canSubmit}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {existing ? t('שמור', 'Save') : t('הוסף', 'Add')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function DeleteModal({ meditation, onClose, onDelete }: {
  meditation: DbMeditation
  onClose: () => void
  onDelete: () => Promise<void>
}) {
  const { t } = useLang()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    if (deleting) return
    setDeleting(true)
    setError('')
    try {
      await onDelete()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('המחיקה נכשלה', 'Could not delete'))
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/40" onClick={() => !deleting && onClose()} aria-label={t('סגור', 'Close')} />
      <div className="relative w-full max-w-md rounded-2xl bg-surface p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50">
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-800">{t('מחיקת מדיטציה', 'Delete meditation')}</h2>
            <p className="mt-1.5 text-sm leading-6 text-gray-500">
              <strong className="text-gray-700">{meditation.title}</strong> {t('תימחק לצמיתות. לא ניתן לבטל פעולה זו.', 'will be permanently deleted. This cannot be undone.')}
            </p>
            <p className="mt-1.5 text-xs text-gray-400">
              {t('ההקלטה עצמה ב-Drive לא תימחק — רק הרשומה כאן.', 'The recording itself in Drive is not deleted — only this entry.')}
            </p>
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} disabled={deleting} className="h-9 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-600 disabled:opacity-50">
            {t('ביטול', 'Cancel')}
          </button>
          <button
            onClick={() => void confirm()}
            disabled={deleting}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {deleting ? t('מוחק...', 'Deleting...') : t('מחק', 'Delete')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Player ───────────────────────────────────────────────────────────────────
// Plays the recording in place. Drive/YouTube serve their own player in the
// iframe, so nothing is proxied or re-hosted here — the viewer still needs
// their own access to the underlying file, exactly as if they opened the link.

function PlayerModal({ meditation, onClose }: {
  meditation: DbMeditation
  onClose: () => void
}) {
  const { t, lang } = useLang()
  const embed = embedUrlFor(meditation.url)

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/70" onClick={onClose} aria-label={t('סגור', 'Close')} />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="flex shrink-0 items-start gap-3 border-b border-gray-100 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-gray-800" title={meditation.title}>{meditation.title}</p>
            <p className="mt-0.5 text-[10px] text-gray-400">
              {fmtDateTime(meditation.recorded_at, lang)}
              {meditation.category ? ` · ${meditation.category}` : ''}
            </p>
          </div>
          <a
            href={meditation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <ExternalLink size={13} />{t('פתח במקור', 'Open original')}
          </a>
          <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800" aria-label={t('סגור', 'Close')}>
            <X size={15} />
          </button>
        </div>

        {embed ? (
          <div className="relative w-full bg-black" style={{ aspectRatio: '16 / 9' }}>
            <iframe
              src={embed}
              title={meditation.title}
              allow="autoplay; fullscreen"
              allowFullScreen
              className="absolute inset-0 h-full w-full border-0"
            />
          </div>
        ) : (
          // Not a Drive/YouTube link — never iframe an arbitrary URL, just hand
          // the viewer the link itself.
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <AlertCircle size={26} className="text-gray-300" />
            <p className="text-sm text-gray-500">
              {t('לא ניתן לנגן קישור זה כאן', 'This link cannot be played here')}
            </p>
            <a
              href={meditation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              <ExternalLink size={14} />{t('פתח בכרטיסייה חדשה', 'Open in a new tab')}
            </a>
          </div>
        )}

        {meditation.description && (
          <div className="shrink-0 overflow-y-auto border-t border-gray-100 px-5 py-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-500">{meditation.description}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function MeditationCard({ meditation, canManage, onPlay, onEdit, onDelete }: {
  meditation: DbMeditation
  canManage: boolean
  onPlay: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, lang } = useLang()
  const playable = isUsableUrl(meditation.url)
  const thumb = thumbnailUrlFor(meditation.url)
  // A Drive thumbnail 404s while Google is still generating it, and for some
  // files never appears at all — fall back to the placeholder instead of
  // leaving a broken image in the grid.
  const [thumbFailed, setThumbFailed] = useState(false)

  return (
    <div className="group flex flex-col gap-3 rounded-2xl border border-gray-100 bg-surface p-4 shadow-sm transition-all hover:border-primary/30 hover:shadow-md">
      {/* Preview */}
      <button
        onClick={playable ? onPlay : undefined}
        disabled={!playable}
        className="relative -m-4 mb-0 block overflow-hidden rounded-t-2xl bg-gray-100 disabled:cursor-default"
        style={{ aspectRatio: '16 / 9' }}
        aria-label={t('צפייה', 'Watch')}
      >
        {thumb && !thumbFailed ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-secondary/10">
            <Video size={30} className="text-primary/40" />
          </span>
        )}
        {playable && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 shadow-lg">
              <Play size={20} className="ms-0.5 text-primary" />
            </span>
          </span>
        )}
      </button>

      <div className="flex items-start gap-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-800" title={meditation.title}>{meditation.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-400">
            <Calendar size={10} className="shrink-0" />
            {fmtDateTime(meditation.recorded_at, lang)}
          </p>
        </div>
        {canManage && (
          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={onEdit} title={t('ערוך', 'Edit')} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-primary">
              <Pencil size={13} />
            </button>
            <button onClick={onDelete} title={t('מחק', 'Delete')} className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {meditation.category && (
        <span className="w-fit rounded-md bg-secondary/15 px-2 py-0.5 text-[10px] font-semibold text-secondary-dark">
          {meditation.category}
        </span>
      )}

      {meditation.description && (
        <p className="line-clamp-3 text-xs leading-relaxed text-gray-500">{meditation.description}</p>
      )}

      <div className="mt-auto pt-1">
        {playable ? (
          <button
            onClick={onPlay}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            <Play size={14} />
            {t('צפייה', 'Watch')}
          </button>
        ) : (
          <span className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-gray-100 text-xs font-medium text-gray-400">
            <AlertCircle size={13} />
            {t('קישור לא תקין', 'Invalid link')}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function Meditations() {
  const { t } = useLang()
  // The library is deliberately open to every authenticated user — viewing and
  // managing alike (see the 'meditations' entry in lib/permissions.ts). Kept as
  // a named constant so gating it later is a one-line change here plus the
  // matching RLS policy, with none of the JSX below needing to move.
  const canManage = true

  const [items, setItems] = useState<DbMeditation[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<DbMeditation | null>(null)
  const [deleting, setDeleting] = useState<DbMeditation | null>(null)
  const [playing, setPlaying] = useState<DbMeditation | null>(null)

  async function load(showLoading = true) {
    if (showLoading) setLoading(true)
    setFetchError(null)
    try {
      setItems(await getMeditations())
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : t('טעינת המדיטציות נכשלה', 'Failed to load meditations'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const categories = useMemo(
    () => Array.from(new Set(items.map(m => m.category).filter((c): c is string => !!c))).sort(),
    [items],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(m => {
      if (categoryFilter && m.category !== categoryFilter) return false
      if (q && !`${m.title} ${m.description ?? ''} ${m.category ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, query, categoryFilter])

  // Server-confirmed only — local state is updated from the row the API
  // actually returned, never optimistically.
  async function handleSave(data: {
    title: string; description: string; url: string
    category: string; recorded_at: string
  }) {
    if (editing) {
      const saved = await updateMeditation(editing.id, data)
      setItems(prev => prev.map(m => m.id === saved.id ? saved : m))
    } else {
      const created = await createMeditation(data)
      setItems(prev => [created, ...prev])
    }
  }

  async function handleDelete(id: string) {
    await deleteMeditation(id)
    setItems(prev => prev.filter(m => m.id !== id))
  }

  if (loading) return <LoadingScreen />
  if (fetchError) return <ErrorScreen message={fetchError} onRetry={() => void load()} />

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-primary">{t('מדיטציות', 'Meditations')}</h1>
          <p className="mt-1 text-sm text-gray-400">
            {t('הקלטות מפגשים — זמינות לצפייה בכל עת', 'Session recordings — available to watch any time')}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            <Plus size={15} />{t('הוסף מדיטציה', 'Add meditation')}
          </button>
        )}
      </div>

      {/* Filters */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-surface p-2">
          <label className="relative min-w-44 flex-1 sm:max-w-72">
            <Search size={14} className="absolute start-2.5 top-2 text-gray-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('חיפוש לפי כותרת או תיאור', 'Search by title or description')}
              className="h-8 w-full rounded-lg border border-gray-200 bg-surface ps-8 pe-3 text-xs outline-none focus:border-primary"
            />
          </label>

          {categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setCategoryFilter(null)}
                className={`h-8 rounded-lg px-3 text-xs font-bold transition-all ${!categoryFilter ? 'bg-gray-700 text-white' : 'border border-gray-200 bg-surface text-gray-600 hover:border-gray-400'}`}
              >
                {t('הכל', 'All')}
              </button>
              {categories.map(c => (
                <button
                  key={c}
                  onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                  className={`h-8 rounded-lg px-3 text-xs font-bold transition-all ${categoryFilter === c ? 'bg-primary text-white' : 'border border-primary/30 bg-surface text-primary hover:bg-primary/5'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <span className="ms-auto text-xs text-gray-400">
            {filtered.length} {filtered.length === 1 ? t('מדיטציה', 'meditation') : t('מדיטציות', 'meditations')}
          </span>
        </div>
      )}

      {/* List */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-gray-100 bg-surface py-16 text-center shadow-sm">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
            <Video size={26} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">{t('אין עדיין מדיטציות', 'No meditations yet')}</p>
          <p className="text-xs text-gray-400">
            {canManage
              ? t('לחצו על "הוסף מדיטציה" כדי להוסיף את הראשונה', 'Click "Add meditation" to add the first one')
              : t('ההקלטות יופיעו כאן ברגע שיתווספו', 'Recordings will appear here once they are added')}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-surface py-12 text-center shadow-sm">
          <p className="text-sm text-gray-400">{t('לא נמצאו תוצאות', 'No results found')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(m => (
            <MeditationCard
              key={m.id}
              meditation={m}
              canManage={canManage}
              onPlay={() => setPlaying(m)}
              onEdit={() => setEditing(m)}
              onDelete={() => setDeleting(m)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {(adding || editing) && (
        <MeditationModal
          existing={editing}
          categories={categories}
          onClose={() => { setAdding(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
      {playing && (
        <PlayerModal meditation={playing} onClose={() => setPlaying(null)} />
      )}
      {deleting && (
        <DeleteModal
          meditation={deleting}
          onClose={() => setDeleting(null)}
          onDelete={() => handleDelete(deleting.id)}
        />
      )}
    </div>
  )
}
