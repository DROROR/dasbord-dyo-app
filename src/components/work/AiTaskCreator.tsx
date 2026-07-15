import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Send, Loader2, Bot, User, Check, ChevronDown,
  Sparkles, Paperclip, X, Brain, Mic, Square,
} from 'lucide-react'
import type { Task, PriorityDef, Board, Attachment } from '../../types/work'

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'chat' | 'preview'

interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
interface TextBlock  { type: 'text'; text: string }
type ContentBlock = ImageBlock | TextBlock

interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
  imagePreview?: string
}

interface TaskPreview {
  title: string
  description: string
  board: string
  priority: string
  assignee: string
  startDate: string
  dueDate: string
  clientId: string
  clientName: string
}

interface AttachedImage {
  base64: string
  mediaType: string
  preview: string   // object URL for display
  dataUrl: string   // data: URL for storage
}

interface Client { id: string; name: string }

// ─── Learning system ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'dyo_task_patterns'
interface TaskPattern { userDescription: string; task: { title: string }; createdAt: string }

function loadPatterns(): TaskPattern[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') }
  catch { return [] }
}
function savePattern(p: TaskPattern) {
  const all = loadPatterns(); all.unshift(p)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, 20)))
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2 && !part.startsWith('**'))
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i} className="bg-black/10 rounded px-1 text-[11px] font-mono">{part.slice(1, -1)}</code>
    return <span key={i}>{part}</span>
  })
}

function MarkdownMessage({ text }: { text: string }) {
  const lines = text.split('\n')
  const els: React.ReactNode[] = []
  let lType: 'ul' | 'ol' | null = null
  let lItems: React.ReactNode[] = []

  function flush(k: number) {
    if (!lItems.length) return
    els.push(lType === 'ul'
      ? <ul key={`ul${k}`} className="list-disc pr-5 my-1 space-y-0.5">{lItems}</ul>
      : <ol key={`ol${k}`} className="list-decimal pr-5 my-1 space-y-0.5">{lItems}</ol>)
    lItems = []; lType = null
  }

  lines.forEach((line, i) => {
    const h3 = line.match(/^### (.+)/); if (h3) { flush(i); els.push(<p key={i} className="font-semibold text-sm mt-2 mb-0.5">{renderInline(h3[1])}</p>); return }
    const h2 = line.match(/^## (.+)/);  if (h2) { flush(i); els.push(<p key={i} className="font-bold text-sm mt-2 mb-0.5">{renderInline(h2[1])}</p>); return }
    const h1 = line.match(/^# (.+)/);   if (h1) { flush(i); els.push(<p key={i} className="font-bold text-base mt-2 mb-1">{renderInline(h1[1])}</p>); return }
    const ul = line.match(/^[*-] (.+)/);if (ul) { if (lType==='ol') flush(i); lType='ul'; lItems.push(<li key={i} className="text-sm">{renderInline(ul[1])}</li>); return }
    const ol = line.match(/^\d+\. (.+)/);if(ol) { if (lType==='ul') flush(i); lType='ol'; lItems.push(<li key={i} className="text-sm">{renderInline(ol[1])}</li>); return }
    flush(i)
    if (line.trim() === '') { els.push(<div key={i} className="h-1" />); return }
    els.push(<p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>)
  })
  flush(lines.length)
  return <div className="flex flex-col gap-0.5">{els}</div>
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function callClaude(msgs: Message[], systemPrompt: string): Promise<string> {
  const res = await fetch('/api/claude/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
    }),
  })
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('מפתח API לא תקין. בדוק VITE_ANTHROPIC_API_KEY בקובץ .env והפעל מחדש.')
    if (res.status === 529 || res.status === 503) throw new Error('שרת Claude עמוס. נסה שנית בעוד כמה שניות.')
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: { message?: string } }).error?.message ?? `שגיאת API (${res.status})`)
  }
  const data = await res.json()
  return (data.content[0] as { text: string }).text
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function getMsgText(m: Message): string {
  if (typeof m.content === 'string') return m.content
  const t = (m.content as ContentBlock[]).find(b => b.type === 'text') as TextBlock | undefined
  return t?.text ?? ''
}

const INITIAL_MSG: Message = {
  role: 'assistant',
  content: 'שלום! אני כאן לעזור לך להגדיר משימה פיתוח. ספר לי מה צריך לעשות.',
}

// ─── SelectField ──────────────────────────────────────────────────────────────

function SelectField({ label, value, onChange, children, required }: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; required?: boolean
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
        {label}{required && <span className="text-red-400 mr-1">*</span>}
      </label>
      <div className="relative mt-1">
        <select value={value} onChange={e => onChange(e.target.value)}
          className={`w-full appearance-none text-sm border rounded-lg px-3 py-2 pr-8 bg-white focus:outline-none focus:border-primary transition ${!value && required ? 'border-red-200 text-gray-400' : 'border-gray-200 text-gray-700'}`}>
          {children}
        </select>
        <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  )
}

// ─── AiTaskCreator ────────────────────────────────────────────────────────────

// Minimal SpeechRecognition interface (webkit + standard)
interface SR {
  lang: string; continuous: boolean; interimResults: boolean
  onresult: ((e: {
    resultIndex: number
    results: { [i: number]: { [j: number]: { transcript: string }; isFinal: boolean }; length: number }
  }) => void) | null
  onend:   (() => void) | null
  onerror: (() => void) | null
  start(): void; stop(): void
}

const hasSpeechAPI = typeof window !== 'undefined' &&
  ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

export function AiTaskCreator({
  boards, priorityDefs, assignees, clients = [], onCreateTask,
}: {
  boards: Board[]
  priorityDefs: PriorityDef[]
  assignees: string[]
  clients?: Client[]
  onCreateTask: (task: Omit<Task, 'id' | 'createdAt' | 'statusHistory' | 'comments'>) => void
}) {
  const [messages,      setMessages]      = useState<Message[]>([INITIAL_MSG])
  const [input,         setInput]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [phase,         setPhase]         = useState<Phase>('chat')
  const [preview,       setPreview]       = useState<TaskPreview | null>(null)
  const [creating,      setCreating]      = useState(false)
  const [created,       setCreated]       = useState(false)
  const [attachedImage, setAttachedImage] = useState<AttachedImage | null>(null)
  // Last image sent in any message — attached to task card when preview opens
  const [lastSentImage, setLastSentImage] = useState<AttachedImage | null>(null)
  const [isListening,    setIsListening]    = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState('') // live interim text shown in textarea
  const [patterns,       setPatterns]       = useState<TaskPattern[]>(() => loadPatterns())

  const bottomRef           = useRef<HTMLDivElement>(null)
  const textareaRef         = useRef<HTMLTextAreaElement>(null)
  const fileInputRef        = useRef<HTMLInputElement>(null)
  const recognitionRef      = useRef<SR | null>(null)
  const voiceTranscriptRef  = useRef('')  // always-current mirror of voiceTranscript (safe in closures)
  const inputBeforeVoiceRef = useRef('')  // input value captured when recording starts
  // Ref guard prevents double-send regardless of React state timing
  const isSendingRef        = useRef(false)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  // Resize textarea when input changes programmatically (e.g. after voice finalises)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 400) + 'px'
  }, [input, voiceTranscript])

  // Dynamic system prompt
  const systemPrompt = useMemo(() => {
    const learningCtx = patterns.length > 0
      ? `\n\n## Session Context\nThis user has created ${patterns.length} task(s) before. Recent: ${patterns.slice(0, 3).map(p => `"${p.task.title}"`).join(', ')}. Use patterns to ask better questions.`
      : ''
    return `# Product Requirements Analyst

## Role
You are a Product Requirements Analyst for DYO — a platform that converts digital courses into mobile applications for clients in Israel.

Your role is to help transform ideas, voice notes, rough descriptions, customer requests, bugs, feature requests, UI changes, permissions, workflows, and product discussions into clear, structured development tasks.

You act as the bridge between business requirements and the development team.
You are not a developer, project manager, QA engineer, or designer.

The development team already knows the product, architecture, tools, and integrations. Do not explain technologies or existing components.

## Language Rules
- Always converse in Hebrew
- Generate all task output (title, description) in English only
- Translations (buttons, labels, UI text) are provided in Hebrew, English, Spanish, Arabic

## Core Principles

### Never Assume
If any information is unclear, missing, or open to interpretation:
- Do not guess
- Do not complete missing information yourself
- Do not make product decisions on behalf of the user
Instead: Stop. Ask focused clarification questions.

### Confirm Understanding Before Writing
Before creating any task, summarize in Hebrew:
"מה שהבנתי:
1. ...
2. ...
3. ...
האם זה נכון?"
Do not generate the final task until the user confirms.

### Be Direct
Communication style: professional, direct, business-oriented, clear, concise.
Avoid: flattery, excitement, repetition, unnecessary explanations.

### Do NOT ask about
Priority, assignee, board, sprint, story points, estimates, or client — these are set manually after task generation.

## Work Modes

### Mode 1 – Brainstorming
Triggered by: "בוא נחשוב", "בוא נגדיר", "בוא נתכנן"
Role: ask questions, explore options, challenge assumptions. Do not generate a task yet.

### Mode 2 – Task Definition
Triggered by: "בוא נכתוב משימה", "צור משימה", "הגדר משימה"
Steps:
1. Gather information
2. Identify missing details
3. Ask clarification questions if needed
4. Summarize understanding in Hebrew
5. Wait for approval
6. Generate task in English

## Task Structure
Generate tasks using ONLY title and description. Do not add priority, story points, sprint, dependencies, estimates, or acceptance criteria unless explicitly requested.

## Description Writing Rules
When possible, structure naturally using current behavior, required change, desired outcome. Do not force section titles. Focus on behavior, not implementation.

## Bug Reporting Rules
Never present assumptions as facts.
Correct: "It appears the behavior may be related to..."
Incorrect: "The issue is caused by..."

## Image Analysis
If the user attaches an image, analyze it as part of the requirement. Describe what you see that is relevant to the task.

## Translation Rules
If the task includes user-facing text: after task approval, ask "האם תרצה גם תרגומים?" If yes, provide Hebrew, English, Spanish, Arabic.

## Default Flow
1. Understand → 2. Clarify → 3. Summarize in Hebrew → 4. Receive approval → 5. Generate task in English → 6. Offer translations if needed

Never skip the approval step. Never guess. Never assume.

## Technical Output
When generating a task (after the user confirms), output ONLY this JSON — no other text:
{"title":"English concise title","description":"English detailed description ready for developers"}${learningCtx}`
  }, [patterns])

  function parseTaskJson(reply: string): Pick<TaskPreview, 'title' | 'description'> | null {
    const match = reply.match(/\{[\s\S]*?\}/)
    if (!match) return null
    try {
      const p = JSON.parse(match[0]) as { title?: string; description?: string }
      if (!p.title || !p.description) return null
      return { title: p.title, description: p.description }
    } catch { return null }
  }

  function openPreview(parsed: Pick<TaskPreview, 'title' | 'description'>) {
    setPreview({
      title:       parsed.title,
      description: parsed.description,
      board:       '',
      priority:    priorityDefs[1]?.id ?? 'medium',
      assignee:    assignees[0] ?? '',
      startDate:   '',
      dueDate:     '',
      clientId:    '',
      clientName:  '',
    })
    setPhase('preview')
  }

  // ── Send ─────────────────────────────────────────────────────────────────────

  async function send() {
    // Ref guard — synchronous, prevents double-send regardless of React state timing
    if (isSendingRef.current) return
    const text = input.trim()
    if (!text && !attachedImage) return

    isSendingRef.current = true
    setLoading(true)

    let content: string | ContentBlock[]
    const capturedImage = attachedImage  // snapshot before clearing

    if (capturedImage) {
      const blocks: ContentBlock[] = [
        { type: 'image', source: { type: 'base64', media_type: capturedImage.mediaType, data: capturedImage.base64 } },
      ]
      if (text) blocks.push({ type: 'text', text })
      content = blocks
      setLastSentImage(capturedImage)
    } else {
      content = text
    }

    const userMsg: Message = { role: 'user', content, imagePreview: capturedImage?.preview }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setAttachedImage(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      const reply = await callClaude(newMessages, systemPrompt)
      const parsed = parseTaskJson(reply)
      if (parsed) {
        openPreview(parsed)
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: reply }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `שגיאה: ${err instanceof Error ? err.message : 'Unknown error'}` }])
    } finally {
      setLoading(false)
      isSendingRef.current = false
    }
  }

  async function generate() {
    if (isSendingRef.current) return
    isSendingRef.current = true
    setLoading(true)

    const genMsg: Message = { role: 'user', content: 'כן, אני מאשר. אנא אפיין את המשימה עכשיו — פלט JSON בלבד.' }
    const newMessages = [...messages, genMsg]
    setMessages(newMessages)

    try {
      const reply = await callClaude(newMessages, systemPrompt)
      const parsed = parseTaskJson(reply)
      if (parsed) openPreview(parsed)
      else setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `שגיאה: ${err instanceof Error ? err.message : 'Unknown error'}` }])
    } finally {
      setLoading(false)
      isSendingRef.current = false
    }
  }

  // ── File / image ──────────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const base64 = await fileToBase64(file)
    const dataUrl = `data:${file.type};base64,${base64}`
    setAttachedImage({ base64, mediaType: file.type, preview: URL.createObjectURL(file), dataUrl })
    e.target.value = ''
  }

  // ── Voice input ───────────────────────────────────────────────────────────────

  function stopListening() {
    recognitionRef.current?.stop()
    // onend will finalize
  }

  function startListening() {
    const SRClass = (
      (window as unknown as { SpeechRecognition?: new () => SR }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition
    )
    if (!SRClass) return

    // Capture current input so we can prepend it to the voice result
    inputBeforeVoiceRef.current  = input
    voiceTranscriptRef.current   = ''
    setVoiceTranscript('')

    const rec = new SRClass()
    rec.lang           = 'he-IL'
    rec.continuous     = true
    rec.interimResults = true   // show live interim text in real-time

    rec.onresult = e => {
      // Rebuild full transcript from ALL results each time (final + current interim)
      let full = ''
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript
      }
      voiceTranscriptRef.current = full
      setVoiceTranscript(full)
    }

    // Fires after stop() — commit final transcript to input state
    rec.onend = () => {
      const base  = inputBeforeVoiceRef.current
      const voice = voiceTranscriptRef.current.trim()
      setInput(voice ? (base && !base.endsWith(' ') ? base + ' ' : base) + voice : base)
      setVoiceTranscript('')
      voiceTranscriptRef.current = ''
      setIsListening(false)
      recognitionRef.current = null
    }

    rec.onerror = () => {
      setVoiceTranscript('')
      voiceTranscriptRef.current = ''
      setIsListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = rec
    rec.start()
    setIsListening(true)
  }

  // ── Task creation ─────────────────────────────────────────────────────────────

  function handleClientChange(id: string) {
    const client = clients.find(c => c.id === id)
    setPreview(p => p ? { ...p, clientId: id, clientName: client?.name ?? '' } : p)
  }

  function createTask() {
    if (!preview || !preview.board) return
    setCreating(true)

    // Build attachment from last sent image
    const attachments: Attachment[] = []
    if (lastSentImage) {
      attachments.push({
        id: Math.random().toString(36).slice(2, 10),
        type: 'file',
        name: `conversation-image.${lastSentImage.mediaType.split('/')[1] || 'png'}`,
        url: lastSentImage.dataUrl,
      })
    }

    const firstUser = messages.find(m => m.role === 'user')
    savePattern({
      userDescription: getMsgText(firstUser ?? { role: 'user', content: '' }).slice(0, 120),
      task: { title: preview.title },
      createdAt: new Date().toISOString(),
    })
    setPatterns(loadPatterns())

    onCreateTask({
      title:        preview.title,
      description:  preview.description,
      board:        preview.board,
      priority:     preview.priority,
      assignee:     preview.assignee,
      status:       'not_started',
      timeEntries:  [],
      timeEstimate: 4,
      attachments,
      ...(preview.startDate ? { startDate: preview.startDate } : {}),
      ...(preview.dueDate   ? { dueDate:   preview.dueDate   } : {}),
      ...(preview.clientId  ? { clientId:  preview.clientId, clientName: preview.clientName } : {}),
    })

    setCreated(true)
    setTimeout(() => {
      setMessages([INITIAL_MSG])
      setPhase('chat')
      setPreview(null)
      setLastSentImage(null)
      setCreated(false)
      setCreating(false)
    }, 1500)
  }

  // ── Preview phase ─────────────────────────────────────────────────────────────

  if (phase === 'preview' && preview) {
    const canCreate = !!preview.board

    return (
      <div className="flex flex-col gap-5 max-w-2xl mx-auto w-full flex-1 min-h-0 overflow-y-auto pb-6">
        <div className="flex items-center justify-between shrink-0">
          <p className="text-sm font-semibold text-gray-700">Review Generated Task</p>
          <button onClick={() => setPhase('chat')} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">← Back to chat</button>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 flex flex-col gap-4">
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Title</label>
            <input value={preview.title} onChange={e => setPreview(p => p ? { ...p, title: e.target.value } : p)}
              className="mt-1 w-full text-sm font-medium text-gray-800 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Description</label>
            <textarea value={preview.description} onChange={e => setPreview(p => p ? { ...p, description: e.target.value } : p)}
              rows={6}
              className="mt-1 w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Board" value={preview.board} onChange={v => setPreview(p => p ? { ...p, board: v } : p)} required>
              <option value="">— Select board —</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </SelectField>
            <SelectField label="Priority" value={preview.priority} onChange={v => setPreview(p => p ? { ...p, priority: v } : p)}>
              {priorityDefs.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </SelectField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Assignee" value={preview.assignee} onChange={v => setPreview(p => p ? { ...p, assignee: v } : p)}>
              <option value="">— Unassigned —</option>
              {assignees.map(a => <option key={a} value={a}>{a}</option>)}
            </SelectField>
            <SelectField label="Client (optional)" value={preview.clientId} onChange={handleClientChange}>
              <option value="">— No client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Start Date</label>
              <input type="date" value={preview.startDate}
                onChange={e => setPreview(p => p ? { ...p, startDate: e.target.value } : p)}
                className="mt-1 w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Due Date</label>
              <input type="date" value={preview.dueDate}
                onChange={e => setPreview(p => p ? { ...p, dueDate: e.target.value } : p)}
                className="mt-1 w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-primary bg-white"
              />
            </div>
          </div>

          {/* Attached image preview */}
          {lastSentImage && (
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Attachments</label>
              <img
                src={lastSentImage.dataUrl}
                alt=""
                className="mt-1 w-full rounded-xl border border-gray-200"
                style={{ maxHeight: '200px', objectFit: 'contain' }}
              />
            </div>
          )}
        </div>

        {!canCreate && (
          <p className="text-xs text-red-400 text-center shrink-0">יש לבחור בורד לפני יצירת המשימה</p>
        )}
        {canCreate && (
          <button onClick={createTask} disabled={creating || created}
            className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all shrink-0 ${created ? 'bg-green-500 text-white' : 'bg-primary text-white hover:bg-primary/90 disabled:opacity-60'}`}
          >
            {created ? <><Check size={16} /> Task Created!</> : creating ? <><Loader2 size={16} className="animate-spin" /> Creating...</> : 'Create Task →'}
          </button>
        )}
      </div>
    )
  }

  // ── Chat phase ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col max-w-2xl mx-auto w-full flex-1 min-h-0 overflow-hidden" dir="rtl">

      {patterns.length >= 3 && (
        <div className="flex items-center gap-1.5 mb-2 px-1 shrink-0">
          <Brain size={11} className="text-purple-400" />
          <span className="text-[10px] text-purple-400 font-medium">AI לומד את סגנון העבודה שלך ({patterns.length} משימות)</span>
        </div>
      )}

      {/* Messages — fills all remaining space */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 pb-4 min-h-0" style={{ minHeight: '200px' }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${m.role === 'user' ? 'bg-primary text-white' : 'bg-secondary/20 text-primary'}`}>
              {m.role === 'user' ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div className={`max-w-[82%] flex flex-col gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              {m.imagePreview && (
                <img src={m.imagePreview} alt="" className="max-w-[180px] rounded-xl border border-gray-200 shadow-sm" />
              )}
              {getMsgText(m) && (
                <div className={`px-4 py-3 rounded-2xl ${m.role === 'user' ? 'bg-primary text-white rounded-tl-none' : 'bg-white border border-gray-100 text-gray-800 rounded-tr-none shadow-sm'}`}>
                  <MarkdownMessage text={getMsgText(m)} />
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-secondary/20 text-primary flex items-center justify-center shrink-0">
              <Bot size={14} />
            </div>
            <div className="px-4 py-3 bg-white border border-gray-100 rounded-2xl rounded-tr-none shadow-sm flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '120ms' }} />
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '240ms' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Attached image preview strip */}
      {attachedImage && (
        <div className="flex items-center gap-2 mb-2 shrink-0 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <img src={attachedImage.preview} alt="" className="w-10 h-10 rounded-lg object-cover" />
          <span className="text-xs text-gray-500 flex-1">תמונה מצורפת</span>
          <button onClick={() => setAttachedImage(null)} className="p-1 text-gray-400 hover:text-gray-600 transition-colors"><X size={14} /></button>
        </div>
      )}

      {/* Recording indicator */}
      {isListening && (
        <div className="flex items-center gap-2 mb-1.5 px-1 shrink-0">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
          <span className="text-[11px] text-red-500 font-medium">מקליט...</span>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 shrink-0 pt-2 border-t border-gray-100">
        <textarea
          ref={textareaRef}
          value={isListening
            ? (inputBeforeVoiceRef.current
                ? inputBeforeVoiceRef.current + (voiceTranscript ? ' ' + voiceTranscript : '')
                : voiceTranscript)
            : input}
          rows={1}
          readOnly={isListening}
          onChange={e => { if (!isListening) setInput(e.target.value) }}
          onInput={e => {
            const t = e.currentTarget
            t.style.height = 'auto'
            t.style.height = Math.min(t.scrollHeight, 400) + 'px'
          }}
          onKeyDown={e => { if (!isListening && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder={isListening ? '' : 'כתוב כאן... (Enter לשליחה, Shift+Enter לשורה חדשה)'}
          style={{ minHeight: '40px', maxHeight: '400px', overflowY: 'auto', resize: 'none' }}
          className={`flex-1 text-sm border rounded-xl px-4 py-2.5 focus:outline-none transition text-right leading-relaxed ${
            isListening
              ? 'bg-red-50 border-red-200 text-gray-500 italic cursor-default'
              : 'bg-white border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10 placeholder:text-gray-300'
          }`}
        />

        {/* Send */}
        <button onClick={() => void send()} disabled={loading || isListening || (!input.trim() && !attachedImage)}
          title="שלח" className="p-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0 mb-0.5">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>

        {/* Mic / Stop — hidden if browser doesn't support Speech API */}
        {hasSpeechAPI && (
          <button
            onClick={isListening ? stopListening : startListening}
            disabled={loading}
            title={isListening ? 'עצור הקלטה' : 'הקלטה קולית בעברית'}
            className={`relative p-2.5 rounded-xl transition-colors disabled:opacity-40 shrink-0 mb-0.5 ${
              isListening
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {isListening ? <Square size={15} /> : <Mic size={15} />}
          </button>
        )}

        {/* Attach image */}
        <button onClick={() => fileInputRef.current?.click()} disabled={loading}
          title="צרף תמונה" className="p-2.5 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-40 shrink-0 mb-0.5">
          <Paperclip size={15} />
        </button>

        {/* Generate Task */}
        <button onClick={() => void generate()} disabled={loading}
          title="Generate Task"
          className="flex items-center gap-1.5 px-3 py-2.5 bg-secondary/20 text-primary rounded-xl hover:bg-secondary/30 transition-colors disabled:opacity-40 text-xs font-bold shrink-0 mb-0.5 whitespace-nowrap">
          <Sparkles size={13} />
          <span>Generate Task</span>
          <span className="text-[10px] opacity-60">גנרט</span>
        </button>
      </div>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </div>
  )
}
