import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FileText, Plus, ArrowLeft, Save, Lock, Edit3, Loader2, AlertCircle, Check,
  Bold, Italic, Underline, List, ListOrdered, Table, Heading1, Heading2, Heading3,
  Folder, FolderPlus, ChevronLeft, ChevronRight, Pencil, Trash2, FolderInput,
} from 'lucide-react'
import { Avatar } from '../Avatar'
import { useWorkLang } from '../../contexts/WorkLanguageContext'
import type { WorkDoc, WorkDocFolder, DocAccessLevel } from '../../types/work'
import {
  getWorkDocs, createWorkDoc, updateWorkDoc, moveWorkDocToFolder,
  getWorkDocFolders, createWorkDocFolder, renameWorkDocFolder, deleteWorkDocFolder,
  getResourceAccess, setResourceAccess,
} from '../../lib/database'

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
      setSaveError(err instanceof Error ? err.message : tr('השמירה נכשלה', 'Save failed'))
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
      setSaveError(err instanceof Error ? err.message : tr('השמירה נכשלה', 'Save failed'))
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
      setMoveError(err instanceof Error ? err.message : tr('ההעברה נכשלה', 'Move failed'))
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

      <div className="shrink-0 text-[10px] text-gray-400">
        {tr('נוצר על ידי', 'Created by')} {doc.createdBy} · {tr('עודכן לאחרונה', 'Last updated')} {new Date(doc.updatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
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
  const { t: tr } = useWorkLang()
  const [docs, setDocs]         = useState<DocRow[]>([])
  const [folders, setFolders]   = useState<WorkDocFolder[]>([])
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [creatingDoc, setCreatingDoc] = useState(false)

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderOpError, setFolderOpError] = useState<string | null>(null)

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const profileNames = Object.fromEntries(profiles.map(p => [p.id, p.name]))

  // Runs once on mount — initial state above (loading: true, loadError:
  // null) already covers the reset, so the effect only needs the fetch.
  useEffect(() => {
    Promise.all([getWorkDocs(profileNames), getWorkDocFolders(profileNames)])
      .then(([d, f]) => { setDocs(d); setFolders(f) })
      .catch((err: Error) => setLoadError(err.message))
      .finally(() => setLoading(false))
    // profileNames is derived fresh each render from `profiles`; this must
    // still only run once (mount) — refetching on every profiles reference
    // change would be wasteful and isn't needed for this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentFolder = currentFolderId ? folders.find(f => f.id === currentFolderId) ?? null : null
  const parentFolder = currentFolder?.parentId ? folders.find(f => f.id === currentFolder.parentId) ?? null : null
  // Two-level max: a subfolder (parentId set) can never itself contain a
  // "New Folder" action — matches the server's own enforce_folder_depth.
  const canCreateSubfolderHere = currentFolder === null
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
      setFolderOpError(err instanceof Error ? err.message : tr('יצירת התיקייה נכשלה', 'Folder creation failed'))
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
      setFolderOpError(err instanceof Error ? err.message : tr('שינוי השם נכשל', 'Rename failed'))
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
      setDeleteError(err instanceof Error ? err.message : tr('מחיקת התיקייה נכשלה', 'Folder deletion failed'))
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
      setLoadError(err instanceof Error ? err.message : tr('יצירת המסמך נכשלה', 'Document creation failed'))
    } finally {
      setCreatingDoc(false)
    }
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
          {parentFolder && (
            <>
              <ChevronLeft size={11} className="rtl:hidden" />
              <ChevronRight size={11} className="ltr:hidden" />
              <button onClick={() => setCurrentFolderId(parentFolder.id)} className="hover:text-gray-700 transition-colors">{parentFolder.name}</button>
            </>
          )}
          {currentFolder && (
            <>
              <ChevronLeft size={11} className="rtl:hidden" />
              <ChevronRight size={11} className="ltr:hidden" />
              <span className="text-gray-700">{currentFolder.name}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canCreateHere && canCreateSubfolderHere && (
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

      {!loading && !loadError && (subfoldersHere.length > 0 || docsHere.length > 0) && (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pb-4">
          {subfoldersHere.map(folder => {
            const isRenaming = renamingFolderId === folder.id
            const canManageFolder = canCreate && folder.myLevel === 'full'
            return (
              <div key={folder.id} className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-5 py-3.5 hover:border-gray-200 hover:shadow-sm transition-all">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                  <Folder size={18} className="text-amber-500" />
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
                    <p className="text-sm font-semibold text-gray-800 truncate">{folder.name}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{accessLabel(folder.myLevel, tr)}</p>
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
            )
          })}

          {docsHere.map(doc => {
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
                  <p className="text-sm font-semibold text-gray-800 truncate">{doc.title || tr('ללא כותרת', 'Untitled')}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {tr('עודכן', 'Updated')} {new Date(doc.updatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} · {tr('על ידי', 'by')} {doc.createdBy}
                  </p>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 flex items-center gap-1 ${canEdit ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'}`}>
                  {canEdit ? <><Edit3 size={9} /> {tr('עריכה', 'Edit')}</> : accessLabel(doc.myLevel, tr)}
                </span>
              </button>
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
    </div>
  )
}
