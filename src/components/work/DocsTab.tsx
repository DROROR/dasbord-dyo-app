import { Fragment, useState, useRef, useEffect, useCallback } from 'react'
import {
  FileText, Plus, ArrowLeft, Save, Lock, Edit3, Loader2, AlertCircle, Check,
  Bold, Italic, Underline, List, ListOrdered, Table, Heading1, Heading2, Heading3,
  Folder, FolderPlus, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Pencil, Trash2, FolderInput,
  Paperclip, Download, X, File as FileIcon,
  FileSpreadsheet, FileArchive, FileAudio, FileVideo, FileCode, Presentation,
} from 'lucide-react'
import { Avatar } from '../Avatar'
import { useWorkLang } from '../../contexts/WorkLanguageContext'
import type { WorkDoc, WorkDocFolder, DocAccessLevel } from '../../types/work'
import {
  getWorkDocs, createWorkDoc, updateWorkDoc, moveWorkDocToFolder, deleteWorkDoc,
  getWorkDocFolders, createWorkDocFolder, renameWorkDocFolder, deleteWorkDocFolder,
  getResourceAccess, setResourceAccess,
  getWorkDocAttachments, uploadWorkDocAttachment, deleteWorkDocAttachment, signWorkDocAttachment,
  getWorkDocAttachmentCounts, setWorkDocIcon, setWorkDocFolderIcon,
  type DbWorkDocAttachment,
} from '../../lib/database'
import { sanitizePastedHtml, plainTextToHtml } from '../../lib/richText'

// Supabase/PostgREST rejections arrive as plain objects, not Error instances,
// so `err instanceof Error ? err.message : fallback` threw the real reason away
// and left only a generic failure. That is how "folder is not empty (1
// document(s)) — move or delete its contents first" reached the user as nothing
// but "Folder deletion failed". Read the message off whichever shape arrived,
// and keep the fallback for the genuinely messageless case.
function errorText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>
    for (const key of ['message', 'details', 'hint', 'error_description', 'error']) {
      const value = e[key]
      if (typeof value === 'string' && value.trim()) return value
    }
  }
  return fallback
}

const ACCESS_LEVELS: DocAccessLevel[] = ['none', 'view', 'full']
function accessLabel(level: DocAccessLevel, tr: (he: string, en: string) => string): string {
  return level === 'none' ? tr('אין גישה', 'No Access') : level === 'view' ? tr('צפייה', 'View') : tr('עריכה', 'Edit')
}

type DocRow = WorkDoc & { myLevel: DocAccessLevel }

// ─── Rich Text Toolbar ────────────────────────────────────────────────────────

function ToolbarBtn({
  onClick, title, active, children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}`}
    >
      {children}
    </button>
  )
}

// ─── Table Insert Dialog ──────────────────────────────────────────────────────

function TableDialog({ onInsert, onClose }: { onInsert: (rows: number, cols: number) => void; onClose: () => void }) {
  const { t: tr } = useWorkLang()
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  return (
    <div className="absolute top-full mt-1 left-0 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex flex-col gap-3" style={{ minWidth: 180 }}>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{tr('הכנס טבלה', 'Insert table')}</p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600 w-12">{tr('שורות', 'Rows')}</label>
        <input type="number" min={1} max={20} value={rows} onChange={e => setRows(Number(e.target.value))} className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-primary" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600 w-12">{tr('עמודות', 'Columns')}</label>
        <input type="number" min={1} max={10} value={cols} onChange={e => setCols(Number(e.target.value))} className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-primary" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => { onInsert(rows, cols); onClose() }} className="flex-1 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90">{tr('הכנס', 'Insert')}</button>
        <button onClick={onClose} className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs font-semibold rounded-lg hover:bg-gray-50">{tr('ביטול', 'Cancel')}</button>
      </div>
    </div>
  )
}

// ─── RichEditor ───────────────────────────────────────────────────────────────

function RichEditor({ content, onChange, readOnly }: { content: string; onChange: (html: string) => void; readOnly: boolean }) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [showTable, setShowTable] = useState(false)
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false })

  // Sync content only when switching documents (not on every keystroke)
  const lastContentRef = useRef(content)
  useEffect(() => {
    if (!editorRef.current) return
    // Only reset innerHTML when external content changes (not our own onChange)
    if (content !== lastContentRef.current) {
      editorRef.current.innerHTML = sanitizePastedHtml(content)
      lastContentRef.current = content
    }
  }, [content])

  // Set initial content on mount
  useEffect(() => {
    if (editorRef.current) {
      // Documents saved before the paste cleanup existed still carry the colours
      // of whatever they were pasted from, so clean on the way in as well —
      // otherwise old text stays black in dark mode until it is retyped.
      editorRef.current.innerHTML = sanitizePastedHtml(content)
      lastContentRef.current = content
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus()
    document.execCommand(cmd, false, value)
    updateActiveFormats()
  }

  function updateActiveFormats() {
    setActiveFormats({
      bold:      document.queryCommandState('bold'),
      italic:    document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    })
  }

  function insertTable(rows: number, cols: number) {
    const tbl = document.createElement('table')
    for (let r = 0; r < rows; r++) {
      const tr = tbl.insertRow()
      for (let c = 0; c < cols; c++) {
        const td = r === 0 ? document.createElement('th') : tr.insertCell()
        if (r === 0) tr.appendChild(td)
        // Borders and the header tint come from the stylesheet below, which
        // has a dark-mode counterpart; inline colours would not.
        td.innerHTML = '&nbsp;'
      }
    }
    editorRef.current?.focus()
    document.execCommand('insertHTML', false, tbl.outerHTML)
  }

  const handleInput = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? ''
    lastContentRef.current = html
    onChange(html)
    updateActiveFormats()
  }, [onChange])

  // A click inside a contentEditable only moves the caret, so a pasted link
  // looked like a link and did nothing. Open it instead; the caret can still be
  // put inside the text with the arrow keys.
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
  }, [])

  // The browser's own paste keeps the source's colours, classes and <style>
  // blocks. Insert the cleaned markup instead: same text, emoji, headings,
  // bold, lists, tables and links, but the theme's colours.
  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    if (readOnly) return
    const html = event.clipboardData.getData('text/html')
    const text = event.clipboardData.getData('text/plain')
    // A pasted file (a screenshot, say) has neither — leave it to the browser.
    if (!html && !text) return
    event.preventDefault()
    document.execCommand('insertHTML', false, html ? sanitizePastedHtml(html) : plainTextToHtml(text))
    handleInput()
  }, [readOnly, handleInput])

  return (
    <div className="flex flex-col flex-1 min-h-0 border border-gray-200 rounded-xl overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10 transition">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex items-center gap-0.5 px-3 py-2 border-b border-gray-100 bg-gray-50/60 flex-wrap shrink-0">
          <ToolbarBtn onClick={() => exec('bold')}      title="Bold (Ctrl+B)"      active={activeFormats.bold}><Bold      size={13} /></ToolbarBtn>
          <ToolbarBtn onClick={() => exec('italic')}    title="Italic (Ctrl+I)"    active={activeFormats.italic}><Italic    size={13} /></ToolbarBtn>
          <ToolbarBtn onClick={() => exec('underline')} title="Underline (Ctrl+U)" active={activeFormats.underline}><Underline size={13} /></ToolbarBtn>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <ToolbarBtn onClick={() => exec('formatBlock', 'h1')} title="Heading 1"><Heading1 size={13} /></ToolbarBtn>
          <ToolbarBtn onClick={() => exec('formatBlock', 'h2')} title="Heading 2"><Heading2 size={13} /></ToolbarBtn>
          <ToolbarBtn onClick={() => exec('formatBlock', 'h3')} title="Heading 3"><Heading3 size={13} /></ToolbarBtn>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Bullet list"><List        size={13} /></ToolbarBtn>
          <ToolbarBtn onClick={() => exec('insertOrderedList')}   title="Numbered list"><ListOrdered size={13} /></ToolbarBtn>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <div className="relative">
            <ToolbarBtn onClick={() => setShowTable(s => !s)} title="Insert table"><Table size={13} /></ToolbarBtn>
            {showTable && <TableDialog onInsert={insertTable} onClose={() => setShowTable(false)} />}
          </div>
        </div>
      )}

      {/* Content area */}
      <div
        ref={editorRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onInput={handleInput}
        onPaste={handlePaste}
        onClick={handleClick}
        onKeyUp={updateActiveFormats}
        onMouseUp={updateActiveFormats}
        className={`doc-editor flex-1 min-h-0 overflow-y-auto px-5 py-4 text-sm text-gray-700 leading-relaxed focus:outline-none ${readOnly ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}`}
        style={{
          // Prose-style heading + list formatting
          '--tw-prose-h1': '1.4em',
        } as React.CSSProperties}
      />

      {/* Scoped to .doc-editor (not every [contenteditable] on the page) and
          written as a light half plus a dark half, because the pasted text
          inherits these colours now that its own are stripped. */}
      <style>{`
        .doc-editor h1 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0 0.25em; color: #111827; }
        .doc-editor h2 { font-size: 1.25em; font-weight: 600; margin: 0.5em 0 0.2em; color: #1f2937; }
        .doc-editor h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.15em; color: #374151; }
        .doc-editor h4, .doc-editor h5, .doc-editor h6 { font-weight: 600; margin: 0.4em 0 0.15em; color: #374151; }
        .doc-editor ul { list-style: disc; padding-right: 1.5em; margin: 0.3em 0; }
        .doc-editor ol { list-style: decimal; padding-right: 1.5em; margin: 0.3em 0; }
        .doc-editor li { margin: 0.15em 0; }
        .doc-editor table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        .doc-editor td, .doc-editor th { border: 1px solid #e5e7eb; padding: 6px 10px; min-width: 70px; }
        .doc-editor th { background: #f9fafb; font-weight: 600; }
        .doc-editor a { color: #2563eb; text-decoration: underline; cursor: pointer; }
        .doc-editor blockquote { border-inline-start: 3px solid #e5e7eb; padding-inline-start: 0.75em; margin: 0.4em 0; color: #6b7280; }
        .doc-editor code { background: #f3f4f6; border-radius: 4px; padding: 0.1em 0.3em; font-size: 0.9em; }
        .doc-editor pre { background: #f3f4f6; border-radius: 8px; padding: 0.6em 0.8em; overflow-x: auto; }
        .doc-editor hr { border: 0; border-top: 1px solid #e5e7eb; margin: 0.8em 0; }
        .doc-editor img { max-width: 100%; height: auto; border-radius: 6px; }
        .doc-editor:empty:before { content: attr(data-placeholder); color: #d1d5db; }

        .dark .doc-editor h1 { color: #f8fafc; }
        .dark .doc-editor h2 { color: #e5e7eb; }
        .dark .doc-editor h3, .dark .doc-editor h4, .dark .doc-editor h5, .dark .doc-editor h6 { color: #d1d5db; }
        .dark .doc-editor td, .dark .doc-editor th { border-color: #2c3a4f; }
        .dark .doc-editor th { background: #161f2f; }
        .dark .doc-editor a { color: #7dd3fc; }
        .dark .doc-editor blockquote { border-color: #2c3a4f; color: #a3b1c6; }
        .dark .doc-editor code, .dark .doc-editor pre { background: #1e293b; }
        .dark .doc-editor hr { border-top-color: #2c3a4f; }
        .dark .doc-editor:empty:before { color: #4b5563; }
      `}</style>
    </div>
  )
}

// ─── Access panel ─────────────────────────────────────────────────────────────
// Reads/writes strictly through the update-resource-access Edge Function
// (never a direct table select/update of `access`) — its own
// can_manage_permissions() check is the actual enforcement, this button
// only being shown to canManagePermissions users is UX, not security.
// Shared between documents and folders via the `table` prop.

function AccessPanel({
  table, resourceId, profiles,
}: {
  table: 'work_docs' | 'work_doc_folders'
  resourceId: string
  profiles: { id: string; name: string }[]
}) {
  const { t: tr } = useWorkLang()
  const [access, setAccess]   = useState<Record<string, string> | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId]   = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // AccessPanel is only ever mounted fresh (the parent conditionally
  // renders it on toggle) — initial state above already covers "loading
  // on mount", so this effect only needs the fetch itself.
  useEffect(() => {
    let cancelled = false
    getResourceAccess(table, resourceId)
      .then(a => { if (!cancelled) setAccess(a) })
      .catch((err: Error) => { if (!cancelled) setLoadError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [table, resourceId])

  async function changeLevel(profileId: string, level: string) {
    setSavingId(profileId)
    setSavedId(null)
    setSaveError(null)
    try {
      const next = await setResourceAccess(table, resourceId, profileId, level)
      setAccess(next)
      setSavedId(profileId)
      setTimeout(() => setSavedId(cur => cur === profileId ? null : cur), 1500)
    } catch (err) {
      setSaveError(errorText(err, tr('השמירה נכשלה', 'Save failed')))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 shrink-0">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{tr('בקרת גישה', 'Access Control')}</p>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 size={13} className="animate-spin" /> {tr('טוען הרשאות...', 'Loading access...')}
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 text-xs text-red-500 py-2">
          <AlertCircle size={13} /> {loadError}
        </div>
      )}
      {access && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {profiles.map(p => (
              <div key={p.id} className="flex items-center gap-2">
                <Avatar name={p.name} size="xs" />
                <span className="text-xs text-gray-700 flex-1 truncate">{p.name}</span>
                {savingId === p.id && <Loader2 size={11} className="text-gray-400 animate-spin shrink-0" />}
                {savedId === p.id && <Check size={11} className="text-green-500 shrink-0" />}
                <select
                  value={(access[p.id] ?? 'none') as DocAccessLevel}
                  disabled={savingId === p.id}
                  onChange={e => void changeLevel(p.id, e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:border-primary disabled:opacity-50"
                >
                  {ACCESS_LEVELS.map(l => <option key={l} value={l}>{accessLabel(l, tr)}</option>)}
                </select>
              </div>
            ))}
          </div>
          {saveError && (
            <div className="flex items-center gap-2 text-xs text-red-500 mt-3">
              <AlertCircle size={13} /> {saveError}
            </div>
          )}
        </>
      )}
    </div>
  )
}


// ─── Attachments ──────────────────────────────────────────────────────────────
// Files hanging off the document, under the editor: images preview in place,
// everything else shows as a file card, and both open full size and download.

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

function formatBytes(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isImage(attachment: DbWorkDocAttachment): boolean {
  return (attachment.mime_type ?? '').startsWith('image/')
    || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(attachment.name)
}

/**
 * The card for a non-image file: a coloured icon and its extension, so a PDF is
 * recognisable at a glance instead of every file looking the same. The tints are
 * written as /10 over the card's own background, which keeps them right in dark
 * mode too.
 */
function fileVisual(name: string, mimeType: string | null): {
  Icon: typeof FileIcon; tint: string; label: string
} {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const mime = mimeType ?? ''
  const label = ext.length > 0 && ext.length <= 5 ? ext.toUpperCase() : ''
  const of = (Icon: typeof FileIcon, tint: string) => ({ Icon, tint, label })

  if (ext === 'pdf' || mime === 'application/pdf') return of(FileText, 'bg-red-500/10 text-red-500')
  if (['doc', 'docx', 'rtf', 'odt', 'pages'].includes(ext)) return of(FileText, 'bg-blue-500/10 text-blue-500')
  if (['xls', 'xlsx', 'csv', 'ods', 'tsv'].includes(ext)) return of(FileSpreadsheet, 'bg-emerald-500/10 text-emerald-500')
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) return of(Presentation, 'bg-orange-500/10 text-orange-500')
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return of(FileArchive, 'bg-amber-500/10 text-amber-500')
  if (mime.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return of(FileVideo, 'bg-violet-500/10 text-violet-500')
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg', 'aac'].includes(ext)) return of(FileAudio, 'bg-pink-500/10 text-pink-500')
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'sql', 'sh', 'xml', 'yml', 'yaml'].includes(ext)) return of(FileCode, 'bg-cyan-500/10 text-cyan-600')
  if (['txt', 'md', 'log'].includes(ext)) return of(FileText, 'bg-slate-500/10 text-slate-500')
  return of(FileIcon, 'bg-gray-500/10 text-gray-500')
}

function isPdf(attachment: DbWorkDocAttachment): boolean {
  return attachment.mime_type === 'application/pdf' || /\.pdf$/i.test(attachment.name)
}

/** Forces a save-as rather than a navigation — Supabase honours ?download. */
function downloadUrl(signedUrl: string, name: string): string {
  return `${signedUrl}${signedUrl.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`
}

function AttachmentsPanel({ docId, canEdit }: { docId: string; canEdit: boolean }) {
  const { t: tr } = useWorkLang()
  const [attachments, setAttachments] = useState<DbWorkDocAttachment[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<DbWorkDocAttachment | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Signed links expire, so they are fetched for the list rather than stored.
  const signAll = useCallback(async (rows: DbWorkDocAttachment[]) => {
    const signed = await Promise.all(rows.map(async row => {
      try { return [row.id, await signWorkDocAttachment(row.storage_path)] as const }
      catch { return null }
    }))
    setUrls(Object.fromEntries(signed.filter(entry => entry !== null) as (readonly [string, string])[]))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void getWorkDocAttachments(docId)
      .then(async rows => {
        if (cancelled) return
        setAttachments(rows)
        setError(null)
        await signAll(rows)
      })
      .catch(err => { if (!cancelled) setError(errorText(err, tr('טעינת הקבצים נכשלה', 'Could not load the attachments'))) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId])

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    const tooBig = files.find(file => file.size > MAX_ATTACHMENT_BYTES)
    if (tooBig) {
      setError(tr(`הקובץ ${tooBig.name} גדול מ-20MB`, `${tooBig.name} is larger than 20 MB`))
      return
    }
    setUploading(true)
    setError(null)
    try {
      for (const file of files) {
        const created = await uploadWorkDocAttachment(docId, file)
        setAttachments(prev => [created, ...prev])
        try {
          const signed = await signWorkDocAttachment(created.storage_path)
          setUrls(prev => ({ ...prev, [created.id]: signed }))
        } catch { /* the card still lists it; the link is refetched on reload */ }
      }
    } catch (err) {
      setError(errorText(err, tr('העלאת הקובץ נכשלה', 'Upload failed')))
    } finally {
      setUploading(false)
    }
  }

  async function confirmDelete(attachment: DbWorkDocAttachment) {
    setDeletingId(attachment.id)
    setError(null)
    try {
      await deleteWorkDocAttachment(attachment)
      setAttachments(prev => prev.filter(row => row.id !== attachment.id))
      setConfirmId(null)
    } catch (err) {
      setError(errorText(err, tr('מחיקת הקובץ נכשלה', 'Could not delete the file')))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          <Paperclip size={11} /> {tr('קבצים מצורפים', 'Attachments')}
          {attachments.length > 0 && <span className="text-gray-400">({attachments.length})</span>}
        </p>
        {canEdit && (
          <>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => void handleFiles(e)} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-60"
            >
              {uploading
                ? <><Loader2 size={11} className="animate-spin" /> {tr('מעלה...', 'Uploading...')}</>
                : <><Plus size={11} /> {tr('צרף קובץ', 'Attach file')}</>}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mb-2 flex items-center gap-2 text-xs text-red-500">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-1 text-xs text-gray-400">
          <Loader2 size={13} className="animate-spin" /> {tr('טוען קבצים...', 'Loading attachments...')}
        </div>
      ) : attachments.length === 0 ? (
        <p className="py-1 text-xs text-gray-400">
          {canEdit ? tr('אין קבצים. אפשר לצרף תמונות, PDF או כל קובץ אחר.', 'No files yet — attach images, PDFs or any other file.') : tr('אין קבצים מצורפים', 'No attachments')}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {attachments.map(attachment => {
            const url = urls[attachment.id]
            const openable = isImage(attachment) || isPdf(attachment)
            const { Icon, tint, label } = fileVisual(attachment.name, attachment.mime_type)
            return (
              <div key={attachment.id} className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white">
                <button
                  onClick={() => { if (url && openable) setPreview(attachment) }}
                  disabled={!url || !openable}
                  title={openable ? tr('פתח תצוגה מקדימה', 'Open preview') : attachment.name}
                  className={`flex h-20 w-full items-center justify-center gap-1.5 disabled:cursor-default ${isImage(attachment) && url ? 'bg-gray-50' : tint}`}
                >
                  {isImage(attachment) && url
                    ? <img src={url} alt={attachment.name} className="h-full w-full object-cover" />
                    : <>
                        <Icon size={26} strokeWidth={1.75} />
                        {label && <span className="text-[10px] font-bold tracking-wide">{label}</span>}
                      </>}
                </button>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-gray-700" title={attachment.name}>{attachment.name}</p>
                    <p className="text-[10px] text-gray-400">{formatBytes(attachment.size_bytes)}</p>
                  </div>
                  {url && (
                    <a
                      href={downloadUrl(url, attachment.name)}
                      download={attachment.name}
                      title={tr('הורד', 'Download')}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <Download size={12} />
                    </a>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => setConfirmId(attachment.id)}
                      title={tr('מחק', 'Delete')}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                {confirmId === attachment.id && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/95 p-2 text-center">
                    <p className="text-[11px] font-semibold text-gray-700">{tr('למחוק את הקובץ?', 'Delete this file?')}</p>
                    <div className="flex gap-1.5">
                      <button onClick={() => setConfirmId(null)} className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-500">
                        {tr('ביטול', 'Cancel')}
                      </button>
                      <button
                        onClick={() => void confirmDelete(attachment)}
                        disabled={deletingId === attachment.id}
                        className="flex items-center gap-1 rounded-lg bg-red-500 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-60"
                      >
                        {deletingId === attachment.id && <Loader2 size={10} className="animate-spin" />}
                        {tr('מחק', 'Delete')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {preview && urls[preview.id] && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className="mb-2 flex items-center gap-3 text-white" onClick={event => event.stopPropagation()}>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{preview.name}</p>
            <a
              href={downloadUrl(urls[preview.id], preview.name)}
              download={preview.name}
              className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold hover:bg-white/25"
            >
              <Download size={12} /> {tr('הורד', 'Download')}
            </a>
            <button onClick={() => setPreview(null)} className="rounded-lg bg-white/15 p-1.5 hover:bg-white/25">
              <X size={14} />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center" onClick={event => event.stopPropagation()}>
            {isImage(preview)
              ? <img src={urls[preview.id]} alt={preview.name} className="max-h-full max-w-full rounded-lg object-contain" />
              : <iframe src={urls[preview.id]} title={preview.name} className="h-full w-full rounded-lg bg-white" />}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── DocEditor ────────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function DocEditor({
  doc, profiles, folders, canManagePermissions, onSaved, onMoved, onBack,
}: {
  doc: DocRow
  profiles: { id: string; name: string }[]
  folders: WorkDocFolder[]
  canManagePermissions: boolean
  onSaved: (d: DocRow) => void
  onMoved: (d: DocRow) => void
  onBack: () => void
}) {
  const { t: tr } = useWorkLang()
  // Switching to a different doc always remounts this component (the
  // caller keys it by doc.id), so initial state below is all the reset
  // a doc switch needs — no effect required. A save (same doc.id)
  // deliberately does NOT remount, so in-progress edits/save state
  // survive it.
  const [title,   setTitle]   = useState(doc.title)
  const [content, setContent] = useState(doc.content)
  const [showAcl, setShowAcl] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  const canEdit = doc.myLevel === 'full'
  const profileNames = Object.fromEntries(profiles.map(p => [p.id, p.name]))

  async function save() {
    setSaveState('saving')
    setSaveError(null)
    try {
      const updated = await updateWorkDoc(doc.id, title, content, profileNames)
      onSaved(updated)
      setSaveState('saved')
      setTimeout(() => setSaveState(cur => cur === 'saved' ? 'idle' : cur), 1500)
    } catch (err) {
      setSaveState('error')
      setSaveError(errorText(err, tr('השמירה נכשלה', 'Save failed')))
    }
  }

  async function moveTo(folderId: string) {
    if (moving) return
    setMoving(true)
    setMoveError(null)
    try {
      const updated = await moveWorkDocToFolder(doc.id, folderId || null, profileNames)
      onMoved(updated)
    } catch (err) {
      setMoveError(errorText(err, tr('ההעברה נכשלה', 'Move failed')))
    } finally {
      setMoving(false)
    }
  }

  // Only folders the doc's own mover (canEdit) has 'full' on are valid
  // destinations — mirrors the server's own has_folder_access(...,'full')
  // check on both sides of the move exactly, so this never offers a
  // choice the server would reject.
  const eligibleFolders = folders.filter(f => f.myLevel === 'full')

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={!canEdit}
          className="flex-1 text-lg font-semibold text-gray-900 bg-transparent border-0 focus:outline-none focus:border-b-2 focus:border-primary disabled:cursor-not-allowed"
          placeholder={tr('כותרת המסמך...', 'Document title...')}
        />
        {canEdit && eligibleFolders.length > 0 && (
          <select
            value={doc.folderId ?? ''}
            disabled={moving}
            onChange={e => void moveTo(e.target.value)}
            title={tr('העבר לתיקייה', 'Move to folder')}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="">{tr('שורש דוקומנטציה', 'Documentation root')}</option>
            {eligibleFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        {canManagePermissions && (
          <button
            onClick={() => setShowAcl(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showAcl ? 'bg-primary text-white border-primary' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            <Lock size={11} /> {tr('הרשאות', 'Access')}
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => void save()}
            disabled={saveState === 'saving'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saveState === 'saving'
              ? <><Loader2 size={11} className="animate-spin" /> {tr('שומר...', 'Saving...')}</>
              : saveState === 'saved'
              ? <><Check size={11} /> {tr('נשמר', 'Saved')}</>
              : <><Save size={11} /> {tr('שמור', 'Save')}</>}
          </button>
        )}
      </div>

      {saveState === 'error' && saveError && (
        <div className="flex items-center gap-2 text-xs text-red-500 shrink-0">
          <AlertCircle size={13} /> {saveError}
        </div>
      )}
      {moveError && (
        <div className="flex items-center gap-2 text-xs text-red-500 shrink-0">
          <AlertCircle size={13} /> {moveError}
        </div>
      )}

      {showAcl && canManagePermissions && (
        <AccessPanel table="work_docs" resourceId={doc.id} profiles={profiles} />
      )}

      <RichEditor content={content} onChange={setContent} readOnly={!canEdit} />

      <AttachmentsPanel docId={doc.id} canEdit={canEdit} />

      <div className="shrink-0 text-[10px] text-gray-400">
        {tr('נוצר על ידי', 'Created by')} {doc.createdBy} · {tr('עודכן לאחרונה', 'Last updated')} {new Date(doc.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

// ─── Icon picker ──────────────────────────────────────────────────────────────
// The emoji that replaces the default icon on a row. A small set to click plus a
// field to paste any other one, because no list of favourites covers everybody.

const EMOJI_CHOICES = [
  '📁', '📂', '🗂️', '📄', '📝', '📋', '📊', '📈',
  '💰', '🧾', '⚙️', '🔧', '🛠️', '🚀', '🎯', '✅',
  '⚠️', '🔒', '🔑', '💡', '📌', '⭐', '🔥', '❤️',
  '🎓', '🎥', '🎨', '📷', '📞', '✉️', '🌐', '🤖',
  '🧠', '📚', '🗓️', '⏱️', '🏆', '🧩', '🩺', '🍀',
]

function IconPicker({ current, onPick, onClose }: {
  current: string | null | undefined
  onPick: (icon: string | null) => void
  onClose: () => void
}) {
  const { t: tr } = useWorkLang()
  const [typed, setTyped] = useState('')
  return (
    <>
      {/* Click anywhere else to dismiss. */}
      <div className="fixed inset-0 z-30" onClick={e => { e.stopPropagation(); onClose() }} />
      <div
        className="absolute top-full z-40 mt-1 w-60 rounded-xl border border-gray-200 bg-white p-2 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJI_CHOICES.map(emoji => (
            <button
              key={emoji}
              onClick={() => onPick(emoji)}
              className={`h-7 rounded-lg text-base leading-none transition-colors hover:bg-gray-100 ${current === emoji ? 'bg-primary/10' : ''}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={typed}
            onChange={e => setTyped(e.target.value.slice(0, 16))}
            onKeyDown={e => { if (e.key === 'Enter' && typed.trim()) onPick(typed.trim()) }}
            placeholder={tr('הדביקו אימוג׳י...', 'Paste an emoji...')}
            className="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-sm focus:border-primary focus:outline-none"
          />
          <button
            onClick={() => typed.trim() && onPick(typed.trim())}
            disabled={!typed.trim()}
            className="h-8 shrink-0 rounded-lg bg-primary px-2.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {tr('קבע', 'Set')}
          </button>
        </div>
        <button
          onClick={() => onPick(null)}
          className="mt-1.5 w-full rounded-lg px-2 py-1.5 text-start text-[11px] font-semibold text-gray-500 hover:bg-gray-50"
        >
          {tr('חזרה לאייקון המקורי', 'Back to the default icon')}
        </button>
      </div>
    </>
  )
}

// ─── DocsTab ──────────────────────────────────────────────────────────────────

const OPEN_FOLDER_KEY = 'work-docs:open-folder'

export function DocsTab({
  profiles, canManagePermissions, canCreate,
}: {
  profiles: { id: string; name: string }[]
  canManagePermissions: boolean
  canCreate: boolean
}) {
  const { t: tr } = useWorkLang()
  const [docs, setDocs]         = useState<DocRow[]>([])
  const [folders, setFolders]   = useState<WorkDocFolder[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Remembered across reloads: a refresh (or a deploy) used to drop the view
  // back to the Documentation root, and a document created right afterwards
  // landed there instead of in the folder the person thought they were in.
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    try { return localStorage.getItem(OPEN_FOLDER_KEY) || null } catch { return null }
  })
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [attachmentCounts, setAttachmentCounts] = useState<Record<string, number>>({})
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [iconError, setIconError] = useState<string | null>(null)

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderOpError, setFolderOpError] = useState<string | null>(null)

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [docDeleteConfirm, setDocDeleteConfirm] = useState<DocRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const profileNames = Object.fromEntries(profiles.map(p => [p.id, p.name]))

  // Runs once on mount — initial state above (loading: true, loadError:
  // null) already covers the reset, so the effect only needs the fetch.
  useEffect(() => {
    Promise.all([getWorkDocs(profileNames), getWorkDocFolders(profileNames)])
      .then(([d, f]) => {
        setDocs(d)
        setFolders(f)
        // A remembered folder that has since been deleted (or is no longer
        // shared) must not leave the view pointing at nothing.
        setCurrentFolderId(prev => prev !== null && !f.some(folder => folder.id === prev) ? null : prev)
      })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false))
    // profileNames is derived fresh each render from `profiles`; this must
    // still only run once (mount) — refetching on every profiles reference
    // change would be wasteful and isn't needed for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function applyDocIcon(id: string, icon: string | null) {
    setIconPickerFor(null)
    setIconError(null)
    try {
      const updated = await setWorkDocIcon(id, icon, profileNames)
      setDocs(prev => prev.map(d => d.id === id ? updated : d))
    } catch (err) {
      setIconError(errorText(err, tr('שמירת האייקון נכשלה', 'Could not save the icon')))
    }
  }

  async function applyFolderIcon(id: string, icon: string | null) {
    setIconPickerFor(null)
    setIconError(null)
    try {
      const updated = await setWorkDocFolderIcon(id, icon, profileNames)
      setFolders(prev => prev.map(f => f.id === id ? updated : f))
    } catch (err) {
      setIconError(errorText(err, tr('שמירת האייקון נכשלה', 'Could not save the icon')))
    }
  }

  // The paperclip count is fetched for the list, and again whenever the list
  // comes back into view — a file attached inside a document has to show up on
  // its row without a page reload.
  useEffect(() => {
    if (selectedId !== null) return
    let cancelled = false
    void getWorkDocAttachmentCounts()
      .then(counts => { if (!cancelled) setAttachmentCounts(counts) })
      .catch(() => { /* the rows just show no paperclip */ })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    try {
      if (currentFolderId) localStorage.setItem(OPEN_FOLDER_KEY, currentFolderId)
      else localStorage.removeItem(OPEN_FOLDER_KEY)
    } catch { /* private mode: the folder just is not remembered */ }
  }, [currentFolderId])

  const currentFolder = currentFolderId ? folders.find(f => f.id === currentFolderId) ?? null : null
  // The trail from the root down to the folder being viewed, for the breadcrumb.
  // Guarded against a missing link so a folder whose parent is not in the list
  // (no access to it) cannot loop forever.
  const folderTrail: WorkDocFolder[] = []
  for (let node = currentFolder; node; node = node.parentId ? folders.find(f => f.id === node!.parentId) ?? null : null) {
    folderTrail.unshift(node)
    if (folderTrail.length > 20) break
  }
  // Nesting is no longer capped at two levels (20261006170000), so a folder can
  // hold folders at any depth the server still allows.
  const canCreateHere = canCreate && (currentFolderId === null || currentFolder?.myLevel === 'full')

  const subfoldersHere = folders.filter(f => (f.parentId ?? null) === currentFolderId)
  const docsHere = docs.filter(d => (d.folderId ?? null) === currentFolderId)

  async function createFolder() {
    const name = newFolderName.trim()
    if (!name || creatingFolder) return
    setCreatingFolder(true)
    setFolderOpError(null)
    try {
      const created = await createWorkDocFolder(name, currentFolderId, profileNames)
      setFolders(prev => [...prev, created])
      setNewFolderName('')
      setNewFolderOpen(false)
    } catch (err) {
      setFolderOpError(errorText(err, tr('יצירת התיקייה נכשלה', 'Folder creation failed')))
    } finally {
      setCreatingFolder(false)
    }
  }

  async function commitRename(id: string) {
    const name = renameValue.trim()
    if (!name || renaming) return
    setRenaming(true)
    setFolderOpError(null)
    try {
      const updated = await renameWorkDocFolder(id, name, profileNames)
      setFolders(prev => prev.map(f => f.id === updated.id ? updated : f))
      setRenamingFolderId(null)
    } catch (err) {
      setFolderOpError(errorText(err, tr('שינוי השם נכשל', 'Rename failed')))
    } finally {
      setRenaming(false)
    }
  }

  async function confirmDelete(id: string) {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteWorkDocFolder(id)
      setFolders(prev => prev.filter(f => f.id !== id))
      setDeleteConfirmId(null)
      if (currentFolderId === id) setCurrentFolderId(null)
    } catch (err) {
      setDeleteError(errorText(err, tr('מחיקת התיקייה נכשלה', 'Folder deletion failed')))
    } finally {
      setDeleting(false)
    }
  }

  // Deleting a document was reachable in the data layer (deleteWorkDoc has
  // existed all along) but had no control anywhere in this tab, which also made
  // a non-empty folder impossible to empty and therefore impossible to delete.
  // RLS ("work_docs: delete") requires work_docs:'full' plus doc access 'full',
  // which is what canCreate && myLevel === 'full' mirrors on the button below.
  async function confirmDeleteDoc(doc: DocRow) {
    if (deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteWorkDoc(doc.id)
      setDocs(prev => prev.filter(d => d.id !== doc.id))
      setDocDeleteConfirm(null)
      if (selectedId === doc.id) setSelectedId(null)
    } catch (err) {
      setDeleteError(errorText(err, tr('מחיקת המסמך נכשלה', 'Document deletion failed')))
    } finally {
      setDeleting(false)
    }
  }

  async function createDoc() {
    if (!canCreateHere || creatingDoc) return
    setCreatingDoc(true)
    try {
      const created = await createWorkDoc(tr('מסמך ללא כותרת', 'Untitled Document'), '', profileNames, currentFolderId)
      setDocs(prev => [created, ...prev])
      setSelectedId(created.id)
    } catch (err) {
      setLoadError(errorText(err, tr('יצירת המסמך נכשלה', 'Document creation failed')))
    } finally {
      setCreatingDoc(false)
    }
  }

  function toggleFolder(id: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // The contents of an expanded folder, indented under its row: subfolders
  // first (expandable in turn), then its documents. A plain function rather
  // than a component so it keeps the list's own handlers, and recursive because
  // folders nest as deep as the person needs.
  function renderFolderChildren(parentId: string) {
    const childFolders = folders.filter(f => f.parentId === parentId)
    const childDocs = docs.filter(d => (d.folderId ?? null) === parentId)

    return (
      <div className="ms-6 flex flex-col gap-1 border-s border-gray-100 ps-3">
        {childFolders.length === 0 && childDocs.length === 0 && (
          <p className="py-1 text-[11px] text-gray-400">{tr('התיקייה ריקה', 'This folder is empty')}</p>
        )}

        {childFolders.map(child => (
          <Fragment key={child.id}>
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50">
              <button
                onClick={() => toggleFolder(child.id)}
                title={expandedFolders.has(child.id) ? tr('סגור', 'Collapse') : tr('פתח', 'Expand')}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                {expandedFolders.has(child.id) ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              <span className="text-sm leading-none">{child.icon ? child.icon : <Folder size={13} className="text-amber-500" />}</span>
              <button onClick={() => setCurrentFolderId(child.id)} className="min-w-0 flex-1 truncate text-start text-[12px] font-semibold text-gray-700">
                {child.name}
              </button>
            </div>
            {expandedFolders.has(child.id) && renderFolderChildren(child.id)}
          </Fragment>
        ))}

        {childDocs.map(childDoc => (
          <button
            key={childDoc.id}
            onClick={() => setSelectedId(childDoc.id)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-gray-50"
          >
            <span className="w-[13px] shrink-0" />
            <span className="text-sm leading-none">{childDoc.icon ? childDoc.icon : <FileText size={13} className="text-primary" />}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-600">{childDoc.title || tr('ללא כותרת', 'Untitled')}</span>
            {(attachmentCounts[childDoc.id] ?? 0) > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-gray-400">
                <Paperclip size={9} /> {attachmentCounts[childDoc.id]}
              </span>
            )}
          </button>
        ))}
      </div>
    )
  }

  const selected = selectedId ? docs.find(d => d.id === selectedId) ?? null : null

  if (selected) {
    return (
      <DocEditor
        key={selected.id}
        doc={selected}
        profiles={profiles}
        folders={folders}
        canManagePermissions={canManagePermissions}
        onSaved={updated => setDocs(prev => prev.map(d => d.id === updated.id ? updated : d))}
        onMoved={updated => setDocs(prev => prev.map(d => d.id === updated.id ? updated : d))}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center justify-between shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          <button
            onClick={() => setCurrentFolderId(null)}
            className={`hover:text-gray-700 transition-colors ${currentFolderId === null ? 'text-gray-700' : ''}`}
          >
            {tr('דוקומנטציה', 'Documentation')}
          </button>
          {folderTrail.map((node, index) => (
            <Fragment key={node.id}>
              <ChevronLeft size={11} className="rtl:hidden" />
              <ChevronRight size={11} className="ltr:hidden" />
              {index === folderTrail.length - 1
                ? <span className="text-gray-700">{node.name}</span>
                : <button onClick={() => setCurrentFolderId(node.id)} className="hover:text-gray-700 transition-colors">{node.name}</button>}
            </Fragment>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {canCreateHere && (
            <button
              onClick={() => setNewFolderOpen(s => !s)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-white border border-gray-200 text-gray-600 hover:border-gray-300 transition-colors"
            >
              <FolderPlus size={14} /> {tr('תיקייה חדשה', 'New Folder')}
            </button>
          )}
          {canCreateHere && (
            <button
              onClick={() => void createDoc()}
              disabled={creatingDoc}
              title={currentFolder
                ? tr(`ייווצר בתוך ${currentFolder.name}`, `Will be created inside ${currentFolder.name}`)
                : tr('ייווצר בשורש דוקומנטציה', 'Will be created in the Documentation root')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-60"
            >
              {creatingDoc ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {tr('מסמך חדש', 'New Doc')}
            </button>
          )}
        </div>
      </div>

      {newFolderOpen && (
        <div className="flex items-center gap-2 shrink-0">
          <input
            autoFocus
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void createFolder() }}
            placeholder={tr('שם התיקייה...', 'Folder name...')}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary"
          />
          <button onClick={() => void createFolder()} disabled={creatingFolder || !newFolderName.trim()} className="px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50">
            {creatingFolder ? <Loader2 size={12} className="animate-spin" /> : tr('צור', 'Create')}
          </button>
          <button onClick={() => { setNewFolderOpen(false); setNewFolderName('') }} className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs font-semibold rounded-lg hover:bg-gray-50">
            {tr('ביטול', 'Cancel')}
          </button>
        </div>
      )}
      {folderOpError && (
        <div className="flex items-center gap-2 text-xs text-red-500 shrink-0">
          <AlertCircle size={13} /> {folderOpError}
        </div>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-primary opacity-50" />
        </div>
      )}

      {loadError && !loading && (
        <div className="flex items-center gap-2 text-sm text-red-500">
          <AlertCircle size={14} /> {loadError}
        </div>
      )}

      {!loading && !loadError && subfoldersHere.length === 0 && docsHere.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <FileText size={26} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">{tr('אין עדיין מסמכים', 'No documents yet')}</p>
          <p className="text-xs text-gray-400">
            {canCreateHere ? tr('לחצו על "מסמך חדש" כדי ליצור את הראשון', 'Click "New Doc" to create the first one') : tr('אין לך גישה לאף מסמך עדיין', 'You don’t have access to any documents yet')}
          </p>
        </div>
      )}

      {iconError && (
        <div className="flex items-center gap-2 text-xs text-red-500 shrink-0">
          <AlertCircle size={13} /> {iconError}
        </div>
      )}

      {!loading && !loadError && (subfoldersHere.length > 0 || docsHere.length > 0) && (
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-0 pb-4">
          {subfoldersHere.map(folder => {
            const isRenaming = renamingFolderId === folder.id
            const canManageFolder = canCreate && folder.myLevel === 'full'
            const isExpanded = expandedFolders.has(folder.id)
            return (
              <Fragment key={folder.id}>
              <div className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2 hover:border-gray-200 hover:shadow-sm transition-all">
                <button
                  onClick={() => toggleFolder(folder.id)}
                  title={isExpanded ? tr('סגור', 'Collapse') : tr('הצג את התוכן', 'Show what is inside')}
                  className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <div className="relative shrink-0">
                  <button
                    onClick={() => canManageFolder && setIconPickerFor(prev => prev === folder.id ? null : folder.id)}
                    disabled={!canManageFolder}
                    title={canManageFolder ? tr('בחרו אייקון', 'Choose an icon') : undefined}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-base leading-none transition-colors enabled:hover:ring-2 enabled:hover:ring-amber-200 disabled:cursor-default"
                  >
                    {folder.icon ? folder.icon : <Folder size={15} className="text-amber-500" />}
                  </button>
                  {iconPickerFor === folder.id && (
                    <IconPicker current={folder.icon} onPick={icon => void applyFolderIcon(folder.id, icon)} onClose={() => setIconPickerFor(null)} />
                  )}
                </div>
                {isRenaming ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void commitRename(folder.id) }}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-primary"
                    />
                    <button onClick={() => void commitRename(folder.id)} disabled={renaming} className="text-xs font-semibold text-primary">{tr('שמור', 'Save')}</button>
                    <button onClick={() => setRenamingFolderId(null)} className="text-xs text-gray-400">{tr('ביטול', 'Cancel')}</button>
                  </div>
                ) : (
                  <button onClick={() => setCurrentFolderId(folder.id)} className="flex-1 text-left min-w-0">
                    <p className="text-[13px] font-semibold text-gray-800 truncate leading-tight">{folder.name}</p>
                  </button>
                )}
                {!isRenaming && canManageFolder && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setRenamingFolderId(folder.id); setRenameValue(folder.name) }} title={tr('שנה שם', 'Rename')} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => { setDeleteConfirmId(folder.id); setDeleteError(null) }} title={tr('מחק', 'Delete')} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              {isExpanded && renderFolderChildren(folder.id)}
              </Fragment>
            )
          })}

          {docsHere.map(doc => {
            const canEdit = doc.myLevel === 'full'
            return (
              // A div, not a button: the delete control below is itself a real
              // <button>, and nesting one button inside another is invalid HTML
              // with inconsistent click behaviour. role + onKeyDown keeps the
              // row keyboard-activatable, the same pattern the task cards use.
              <div
                key={doc.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(doc.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(doc.id) } }}
                className="group flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-2 hover:border-gray-200 hover:shadow-sm transition-all text-left w-full cursor-pointer"
              >
                <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => canEdit && setIconPickerFor(prev => prev === doc.id ? null : doc.id)}
                    disabled={!canEdit}
                    title={canEdit ? tr('בחרו אייקון', 'Choose an icon') : undefined}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-base leading-none transition-colors enabled:hover:ring-2 enabled:hover:ring-primary/20 disabled:cursor-default"
                  >
                    {doc.icon ? doc.icon : <FileText size={15} className="text-primary" />}
                  </button>
                  {iconPickerFor === doc.id && (
                    <IconPicker current={doc.icon} onPick={icon => void applyDocIcon(doc.id, icon)} onClose={() => setIconPickerFor(null)} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-gray-800 truncate leading-tight">{doc.title || tr('ללא כותרת', 'Untitled')}</p>
                  <p className="text-[10px] text-gray-400 leading-tight">
                    {tr('עודכן', 'Updated')} {new Date(doc.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {tr('על ידי', 'by')} {doc.createdBy}
                  </p>
                </div>
                {(attachmentCounts[doc.id] ?? 0) > 0 && (
                  <span
                    title={tr(`${attachmentCounts[doc.id]} קבצים מצורפים`, `${attachmentCounts[doc.id]} attachment(s)`)}
                    className="flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold text-gray-500 shrink-0"
                  >
                    <Paperclip size={9} /> {attachmentCounts[doc.id]}
                  </span>
                )}
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 flex items-center gap-1 ${canEdit ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'}`}>
                  {canEdit ? <><Edit3 size={9} /> {tr('עריכה', 'Edit')}</> : accessLabel(doc.myLevel, tr)}
                </span>
                {canCreate && canEdit && (
                  <button
                    onClick={e => { e.stopPropagation(); setDocDeleteConfirm(doc); setDeleteError(null) }}
                    title={tr('מחק', 'Delete')}
                    className="p-1.5 rounded-lg text-gray-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !deleting && setDeleteConfirmId(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <FolderInput size={18} className="text-red-500" />
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {tr('למחוק את התיקייה', 'Delete folder')} "{folders.find(f => f.id === deleteConfirmId)?.name}"?
              </p>
            </div>
            <p className="text-xs text-gray-500">
              {tr('תיקייה שאינה ריקה לא ניתנת למחיקה — יש להעביר או למחוק קודם את כל המסמכים/תתי-התיקיות בתוכה.', 'A non-empty folder cannot be deleted — move or delete its documents/subfolders first.')}
            </p>
            {deleteError && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <AlertCircle size={13} /> {deleteError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void confirmDelete(deleteConfirmId)}
                disabled={deleting}
                className="flex-1 px-3 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} {tr('מחק', 'Delete')}
              </button>
              <button onClick={() => setDeleteConfirmId(null)} disabled={deleting} className="px-3 py-2 border border-gray-200 text-gray-500 text-xs font-semibold rounded-lg hover:bg-gray-50">
                {tr('ביטול', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {docDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !deleting && setDocDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full flex flex-col gap-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                <FileText size={18} className="text-red-500" />
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {tr('למחוק את המסמך', 'Delete document')} "{docDeleteConfirm.title || tr('ללא כותרת', 'Untitled')}"?
              </p>
            </div>
            <p className="text-xs text-gray-500">
              {tr('המסמך יימחק לצמיתות ולא ניתן לשחזר אותו.', 'The document is permanently deleted and cannot be restored.')}
            </p>
            {deleteError && (
              <div className="flex items-center gap-2 text-xs text-red-500">
                <AlertCircle size={13} /> {deleteError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void confirmDeleteDoc(docDeleteConfirm)}
                disabled={deleting}
                className="flex-1 px-3 py-2 bg-red-500 text-white text-xs font-semibold rounded-lg hover:bg-red-600 disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} {tr('מחק', 'Delete')}
              </button>
              <button onClick={() => setDocDeleteConfirm(null)} disabled={deleting} className="px-3 py-2 border border-gray-200 text-gray-500 text-xs font-semibold rounded-lg hover:bg-gray-50">
                {tr('ביטול', 'Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
