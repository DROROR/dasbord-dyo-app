import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FileText, Plus, ArrowLeft, Save, Lock, Edit3, Loader2, AlertCircle, Check,
  Bold, Italic, Underline, List, ListOrdered, Table, Heading1, Heading2, Heading3,
} from 'lucide-react'
import { Avatar } from '../Avatar'
import type { WorkDoc, DocAccessLevel } from '../../types/work'
import { getWorkDocs, createWorkDoc, updateWorkDoc, getResourceAccess, setResourceAccess } from '../../lib/database'

const ACCESS_LEVELS: DocAccessLevel[] = ['none', 'view', 'full']
const ACCESS_LABEL: Record<DocAccessLevel, string> = { none: 'No Access', view: 'View', full: 'Edit' }

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
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  return (
    <div className="absolute top-full mt-1 left-0 z-20 bg-white border border-gray-200 rounded-xl shadow-lg p-4 flex flex-col gap-3" style={{ minWidth: 180 }}>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">הכנס טבלה</p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600 w-12">שורות</label>
        <input type="number" min={1} max={20} value={rows} onChange={e => setRows(Number(e.target.value))} className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-primary" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-600 w-12">עמודות</label>
        <input type="number" min={1} max={10} value={cols} onChange={e => setCols(Number(e.target.value))} className="w-16 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-primary" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => { onInsert(rows, cols); onClose() }} className="flex-1 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90">הכנס</button>
        <button onClick={onClose} className="px-3 py-1.5 border border-gray-200 text-gray-500 text-xs font-semibold rounded-lg hover:bg-gray-50">ביטול</button>
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
      editorRef.current.innerHTML = content
      lastContentRef.current = content
    }
  }, [content])

  // Set initial content on mount
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = content
      lastContentRef.current = content
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus()
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand(cmd, false, value)
    updateActiveFormats()
  }

  function updateActiveFormats() {
    setActiveFormats({
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      bold:      document.queryCommandState('bold'),
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      italic:    document.queryCommandState('italic'),
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      underline: document.queryCommandState('underline'),
    })
  }

  function insertTable(rows: number, cols: number) {
    const tbl = document.createElement('table')
    tbl.style.cssText = 'border-collapse:collapse;width:100%;margin:8px 0'
    for (let r = 0; r < rows; r++) {
      const tr = tbl.insertRow()
      for (let c = 0; c < cols; c++) {
        const td = r === 0 ? document.createElement('th') : tr.insertCell()
        if (r === 0) tr.appendChild(td)
        td.contentEditable = 'true'
        td.style.cssText = `border:1px solid #e5e7eb;padding:6px 10px;min-width:70px;${r === 0 ? 'background:#f9fafb;font-weight:600;' : ''}`
        td.innerHTML = '&nbsp;'
      }
    }
    editorRef.current?.focus()
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    document.execCommand('insertHTML', false, tbl.outerHTML)
  }

  const handleInput = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? ''
    lastContentRef.current = html
    onChange(html)
    updateActiveFormats()
  }, [onChange])

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
        onKeyUp={updateActiveFormats}
        onMouseUp={updateActiveFormats}
        className={`flex-1 min-h-0 overflow-y-auto px-5 py-4 text-sm text-gray-700 leading-relaxed focus:outline-none ${readOnly ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}`}
        style={{
          // Prose-style heading + list formatting
          '--tw-prose-h1': '1.4em',
        } as React.CSSProperties}
      />

      <style>{`
        [contenteditable] h1 { font-size: 1.5em; font-weight: 700; margin: 0.5em 0 0.25em; color: #111827; }
        [contenteditable] h2 { font-size: 1.25em; font-weight: 600; margin: 0.5em 0 0.2em; color: #1f2937; }
        [contenteditable] h3 { font-size: 1.1em; font-weight: 600; margin: 0.4em 0 0.15em; color: #374151; }
        [contenteditable] ul { list-style: disc; padding-right: 1.5em; margin: 0.3em 0; }
        [contenteditable] ol { list-style: decimal; padding-right: 1.5em; margin: 0.3em 0; }
        [contenteditable] li { margin: 0.15em 0; }
        [contenteditable] table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        [contenteditable] td, [contenteditable] th { border: 1px solid #e5e7eb; padding: 6px 10px; min-width: 70px; }
        [contenteditable] th { background: #f9fafb; font-weight: 600; }
        [contenteditable]:empty:before { content: attr(data-placeholder); color: #d1d5db; }
      `}</style>
    </div>
  )
}

// ─── Access panel ─────────────────────────────────────────────────────────────
// Reads/writes strictly through the update-resource-access Edge Function
// (never a direct table select/update of `access`) — its own
// can_manage_permissions() check is the actual enforcement, this button
// only being shown to canManagePermissions users is UX, not security.

function AccessPanel({
  docId, profiles,
}: {
  docId: string
  profiles: { id: string; name: string }[]
}) {
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
    getResourceAccess('work_docs', docId)
      .then(a => { if (!cancelled) setAccess(a) })
      .catch((err: Error) => { if (!cancelled) setLoadError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [docId])

  async function changeLevel(profileId: string, level: string) {
    setSavingId(profileId)
    setSavedId(null)
    setSaveError(null)
    try {
      const next = await setResourceAccess('work_docs', docId, profileId, level)
      setAccess(next)
      setSavedId(profileId)
      setTimeout(() => setSavedId(cur => cur === profileId ? null : cur), 1500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'השמירה נכשלה')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 shrink-0">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Access Control</p>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
          <Loader2 size={13} className="animate-spin" /> טוען הרשאות...
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
                  {ACCESS_LEVELS.map(l => <option key={l} value={l}>{ACCESS_LABEL[l]}</option>)}
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

// ─── DocEditor ────────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function DocEditor({
  doc, profiles, canManagePermissions, onSaved, onBack,
}: {
  doc: DocRow
  profiles: { id: string; name: string }[]
  canManagePermissions: boolean
  onSaved: (d: DocRow) => void
  onBack: () => void
}) {
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

  const canEdit = doc.myLevel === 'full'

  async function save() {
    setSaveState('saving')
    setSaveError(null)
    try {
      const updated = await updateWorkDoc(doc.id, title, content, Object.fromEntries(profiles.map(p => [p.id, p.name])))
      onSaved(updated)
      setSaveState('saved')
      setTimeout(() => setSaveState(cur => cur === 'saved' ? 'idle' : cur), 1500)
    } catch (err) {
      setSaveState('error')
      setSaveError(err instanceof Error ? err.message : 'השמירה נכשלה')
    }
  }

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
          placeholder="Document title..."
        />
        {canManagePermissions && (
          <button
            onClick={() => setShowAcl(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showAcl ? 'bg-primary text-white border-primary' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            <Lock size={11} /> Access
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => void save()}
            disabled={saveState === 'saving'}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saveState === 'saving'
              ? <><Loader2 size={11} className="animate-spin" /> שומר...</>
              : saveState === 'saved'
              ? <><Check size={11} /> נשמר</>
              : <><Save size={11} /> Save</>}
          </button>
        )}
      </div>

      {saveState === 'error' && saveError && (
        <div className="flex items-center gap-2 text-xs text-red-500 shrink-0">
          <AlertCircle size={13} /> {saveError}
        </div>
      )}

      {showAcl && canManagePermissions && (
        <AccessPanel docId={doc.id} profiles={profiles} />
      )}

      <RichEditor content={content} onChange={setContent} readOnly={!canEdit} />

      <div className="shrink-0 text-[10px] text-gray-400">
        Created by {doc.createdBy} · Last updated {new Date(doc.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}

// ─── DocsTab ──────────────────────────────────────────────────────────────────

export function DocsTab({
  profiles, canManagePermissions, canCreate,
}: {
  profiles: { id: string; name: string }[]
  canManagePermissions: boolean
  canCreate: boolean
}) {
  const [docs, setDocs]         = useState<DocRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const profileNames = Object.fromEntries(profiles.map(p => [p.id, p.name]))

  // Runs once on mount — initial state above (loading: true, loadError:
  // null) already covers the reset, so the effect only needs the fetch.
  useEffect(() => {
    getWorkDocs(profileNames)
      .then(setDocs)
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false))
    // profileNames is derived fresh each render from `profiles`; this must
    // still only run once (mount) — refetching on every profiles reference
    // change would be wasteful and isn't needed for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createDoc() {
    if (!canCreate || creating) return
    setCreating(true)
    try {
      const created = await createWorkDoc('Untitled Document', '', profileNames)
      setDocs(prev => [created, ...prev])
      setSelectedId(created.id)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'יצירת המסמך נכשלה')
    } finally {
      setCreating(false)
    }
  }

  const selected = selectedId ? docs.find(d => d.id === selectedId) ?? null : null

  if (selected) {
    return (
      <DocEditor
        key={selected.id}
        doc={selected}
        profiles={profiles}
        canManagePermissions={canManagePermissions}
        onSaved={updated => setDocs(prev => prev.map(d => d.id === updated.id ? updated : d))}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Documents</p>
        {canCreate && (
          <button
            onClick={() => void createDoc()}
            disabled={creating}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-60"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} New Doc
          </button>
        )}
      </div>

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

      {!loading && !loadError && docs.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <FileText size={26} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">No documents yet</p>
          <p className="text-xs text-gray-400">
            {canCreate ? 'Click "New Doc" to create the first one' : 'אין לך גישה לאף מסמך עדיין'}
          </p>
        </div>
      )}

      {!loading && !loadError && docs.length > 0 && (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pb-4">
          {docs.map(doc => {
            const canEdit = doc.myLevel === 'full'
            return (
              <button
                key={doc.id}
                onClick={() => setSelectedId(doc.id)}
                className="flex items-center gap-4 bg-white border border-gray-100 rounded-xl px-5 py-3.5 hover:border-gray-200 hover:shadow-sm transition-all text-left w-full"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{doc.title || 'Untitled'}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Updated {new Date(doc.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · by {doc.createdBy}
                  </p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 flex items-center gap-1 ${canEdit ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'}`}>
                  {canEdit ? <><Edit3 size={9} /> Edit</> : ACCESS_LABEL[doc.myLevel]}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
