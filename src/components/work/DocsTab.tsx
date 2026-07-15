import { useState, useRef, useEffect, useCallback } from 'react'
import {
  FileText, Plus, ArrowLeft, Save, Lock, Edit3,
  Bold, Italic, Underline, List, ListOrdered, Table, Heading1, Heading2, Heading3,
} from 'lucide-react'
import { Avatar } from '../Avatar'
import type { WorkDoc } from '../../types/work'

const ACCESS_LEVELS = ['none', 'view', 'comment', 'edit'] as const
type DocAccess = 'none' | 'view' | 'comment' | 'edit'

const ACCESS_LABEL: Record<DocAccess, string> = {
  none: 'No Access', view: 'View', comment: 'Comment', edit: 'Edit',
}

function newId() { return Math.random().toString(36).slice(2, 10) }

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

// ─── DocEditor ────────────────────────────────────────────────────────────────

function DocEditor({
  doc, assignees, currentUser, isAdmin, onSave, onBack,
}: {
  doc: WorkDoc
  assignees: string[]
  currentUser: string
  isAdmin: boolean
  onSave: (d: WorkDoc) => void
  onBack: () => void
}) {
  const [title,   setTitle]   = useState(doc.title)
  const [content, setContent] = useState(doc.content)
  const [access,  setAccess]  = useState(doc.access)
  const [showAcl, setShowAcl] = useState(false)

  // Reset local state when doc changes (e.g. external save)
  useEffect(() => {
    setTitle(doc.title)
    setContent(doc.content)
    setAccess(doc.access)
  }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function save() {
    onSave({ ...doc, title, content, access, updatedAt: new Date().toISOString() })
  }

  const myLevel = access[currentUser] ?? 'none'
  const canEdit = isAdmin || myLevel === 'edit'

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
        {isAdmin && (
          <button
            onClick={() => setShowAcl(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${showAcl ? 'bg-primary text-white border-primary' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            <Lock size={11} /> Access
          </button>
        )}
        {canEdit && (
          <button onClick={save} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors">
            <Save size={11} /> Save
          </button>
        )}
      </div>

      {showAcl && isAdmin && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 shrink-0">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Access Control</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {assignees.map(name => (
              <div key={name} className="flex items-center gap-2">
                <Avatar name={name} size="xs" />
                <span className="text-xs text-gray-700 flex-1">{name}</span>
                <select
                  value={access[name] ?? 'none'}
                  onChange={e => setAccess(prev => ({ ...prev, [name]: e.target.value as DocAccess }))}
                  className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:border-primary"
                >
                  {ACCESS_LEVELS.map(l => <option key={l} value={l}>{ACCESS_LABEL[l]}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
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
  docs, setDocs, currentUser, isAdmin, assignees,
}: {
  docs: WorkDoc[]
  setDocs: (docs: WorkDoc[]) => void
  currentUser: string
  isAdmin: boolean
  assignees: string[]
}) {
  const [selected, setSelected] = useState<WorkDoc | null>(null)

  function createDoc() {
    const newDoc: WorkDoc = {
      id: newId(),
      title: 'Untitled Document',
      content: '',
      createdBy: currentUser,
      updatedAt: new Date().toISOString(),
      access: Object.fromEntries(assignees.map(a => [a, isAdmin || a === currentUser ? 'edit' : 'view'])) as Record<string, DocAccess>,
    }
    const updated = [newDoc, ...docs]
    setDocs(updated)
    setSelected(newDoc)
  }

  function saveDoc(updated: WorkDoc) {
    setDocs(docs.map(d => d.id === updated.id ? updated : d))
    setSelected(updated)
  }

  if (selected) {
    const fresh = docs.find(d => d.id === selected.id) ?? selected
    return (
      <DocEditor
        doc={fresh}
        assignees={assignees}
        currentUser={currentUser}
        isAdmin={isAdmin}
        onSave={saveDoc}
        onBack={() => setSelected(null)}
      />
    )
  }

  const visible = docs.filter(d => {
    if (isAdmin) return true
    const level = d.access[currentUser] ?? 'none'
    return level !== 'none'
  })

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Documents</p>
        <button
          onClick={createDoc}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus size={14} /> New Doc
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
            <FileText size={26} className="text-gray-300" />
          </div>
          <p className="text-sm font-semibold text-gray-500">No documents yet</p>
          <p className="text-xs text-gray-400">Click "New Doc" to create the first one</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0 pb-4">
          {visible.map(doc => {
            const myLevel = (doc.access[currentUser] ?? 'none') as DocAccess
            const canEdit = isAdmin || myLevel === 'edit'
            const editors = assignees.filter(a => (doc.access[a] ?? 'none') !== 'none')
            return (
              <button
                key={doc.id}
                onClick={() => setSelected(doc)}
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
                <div className="flex items-center gap-1 shrink-0">
                  {editors.slice(0, 4).map(name => <Avatar key={name} name={name} size="xs" />)}
                  {editors.length > 4 && <span className="text-[9px] text-gray-400">+{editors.length - 4}</span>}
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${canEdit ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'}`}>
                  {canEdit ? <Edit3 size={9} /> : ACCESS_LABEL[myLevel]}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
