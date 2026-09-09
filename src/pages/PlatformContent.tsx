import { useState, useEffect, useCallback } from 'react'
import {
  Lightbulb, PlusCircle, Trash2, ChevronDown, ChevronUp,
  Save, Loader2, RefreshCw, ToggleLeft, ToggleRight,
  ArrowUp, ArrowDown, Pencil, X, Check,
  Package, Newspaper, Layers, Users, Star, Zap,
} from 'lucide-react'
import { useLang } from '../contexts/LanguageContext'

// ─── Constants ────────────────────────────────────────────────────────────────

const CF_BASE = 'https://us-east1-dyo-courses.cloudfunctions.net'
const SECRET = 'dyo-platform-content-2026'

const PACKAGES = [
  {
    id: 'solo_pro',
    label: 'Solo Pro',
    labelHe: 'סולו פרו',
    icon: Star,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    activeBg: 'bg-blue-600',
    border: 'border-blue-200',
  },
  {
    id: 'master_class',
    label: 'Masterclass',
    labelHe: 'מאסטרקלאס',
    icon: Zap,
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    activeBg: 'bg-purple-600',
    border: 'border-purple-200',
  },
  {
    id: 'community_master',
    label: 'Community Master',
    labelHe: 'קהילה מאסטר',
    icon: Users,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    activeBg: 'bg-emerald-600',
    border: 'border-emerald-200',
  },
] as const

// ─── Types ────────────────────────────────────────────────────────────────────

interface TipItem { title: string; description: string }
interface TipStep {
  stepNumber: number
  tips: TipItem[]
  pinnedDay?: number | null
  pinnedDate?: string | null
}
interface WhatsNewItem { version: string; date: string; description: string }
interface ComponentItem { name: string; description: string; isBeta: boolean }

interface PlatformContent {
  tips: TipItem[]
  tipChain: TipStep[]
  chainEnabled: boolean
  tipsImageUrl: string
  tipsCardTitle: string
  tipsCardSubtitle: string
  whatsNew: WhatsNewItem[]
  components: ComponentItem[]
}

function emptyContent(): PlatformContent {
  return {
    tips: [], tipChain: [], chainEnabled: true,
    tipsImageUrl: '', tipsCardTitle: '', tipsCardSubtitle: '',
    whatsNew: [], components: [],
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiFetch(packageId: string): Promise<PlatformContent> {
  const res = await fetch(`${CF_BASE}/getPlatformContent?packageId=${packageId}`, {
    headers: { 'x-webhook-secret': SECRET },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function apiSave(packageId: string, content: PlatformContent): Promise<void> {
  const res = await fetch(`${CF_BASE}/savePlatformContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': SECRET },
    body: JSON.stringify({ packageId, content }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionCard({ title, icon: Icon, children }: {
  title: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-5">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
        <span className="p-1.5 rounded-lg bg-primary/10">
          <Icon size={15} className="text-primary" />
        </span>
        <span className="text-sm font-bold text-gray-800">{title}</span>
      </div>
      {children}
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="py-8 text-center text-gray-400 text-sm">{label}</div>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-5 py-3 text-sm text-primary font-medium hover:bg-primary/5 transition-colors border-t border-gray-100"
    >
      <PlusCircle size={15} />
      {label}
    </button>
  )
}

interface FormField {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  placeholder?: string
}

function InlineForm({ fields, extra, onSave, onCancel }: {
  fields: FormField[]
  extra?: React.ReactNode
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="border-t border-gray-100 bg-gradient-to-b from-primary/5 to-primary/[0.02] px-5 py-4 space-y-3">
      {fields.map((f, i) => (
        <div key={i}>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">{f.label}</label>
          {f.multiline ? (
            <textarea
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              rows={3}
              placeholder={f.placeholder}
              value={f.value}
              onChange={e => f.onChange(e.target.value)}
            />
          ) : (
            <input
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              placeholder={f.placeholder}
              value={f.value}
              onChange={e => f.onChange(e.target.value)}
            />
          )}
        </div>
      ))}
      {extra}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Check size={13} /> Save
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
        >
          <X size={13} /> Cancel
        </button>
      </div>
    </div>
  )
}

function ListItem({ title, subtitle, badge, onEdit, onDelete }: {
  title: string
  subtitle?: string
  badge?: string | null
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5 border-t border-gray-100 group hover:bg-gray-50/60 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          {badge && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary tracking-wide">{badge}</span>
          )}
        </div>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{subtitle}</p>}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-primary transition-colors">
          <Pencil size={13} />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ─── Tips Chain ───────────────────────────────────────────────────────────────

function TipsChainSection({ content, onChange }: {
  content: PlatformContent
  onChange: (c: PlatformContent) => void
}) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const [stepForms, setStepForms] = useState<Record<number, { formIdx: number | null; title: string; desc: string }>>({})

  function sf(i: number) { return stepForms[i] ?? { formIdx: null, title: '', desc: '' } }
  function setF(i: number, patch: Partial<typeof stepForms[0]>) {
    setStepForms(prev => ({ ...prev, [i]: { ...sf(i), ...patch } }))
  }

  function addSection() {
    const next = content.tipChain.length + 1
    onChange({ ...content, tipChain: [...content.tipChain, { stepNumber: next, tips: [] }] })
    setExpandedStep(content.tipChain.length)
  }

  function deleteSection(i: number) {
    const chain = content.tipChain.filter((_, j) => j !== i).map((s, j) => ({ ...s, stepNumber: j + 1 }))
    onChange({ ...content, tipChain: chain })
    if (expandedStep === i) setExpandedStep(null)
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= content.tipChain.length) return
    const chain = [...content.tipChain];
    [chain[i], chain[j]] = [chain[j], chain[i]]
    chain.forEach((s, k) => { s.stepNumber = k + 1 })
    onChange({ ...content, tipChain: chain })
    setExpandedStep(j)
  }

  function saveTip(stepIdx: number) {
    const form = sf(stepIdx)
    const title = form.title.trim()
    if (!title) return
    const chain = [...content.tipChain]
    const step = { ...chain[stepIdx], tips: [...chain[stepIdx].tips] }
    if (form.formIdx === -1) step.tips = [...step.tips, { title, description: form.desc.trim() }]
    else if (form.formIdx !== null && form.formIdx >= 0)
      step.tips = step.tips.map((t, i) => i === form.formIdx ? { title, description: form.desc.trim() } : t)
    chain[stepIdx] = step
    onChange({ ...content, tipChain: chain })
    setF(stepIdx, { formIdx: null, title: '', desc: '' })
  }

  function deleteTip(stepIdx: number, tipIdx: number) {
    const chain = [...content.tipChain]
    chain[stepIdx] = { ...chain[stepIdx], tips: chain[stepIdx].tips.filter((_, i) => i !== tipIdx) }
    onChange({ ...content, tipChain: chain })
    setF(stepIdx, { formIdx: null })
  }

  function setPinnedDay(stepIdx: number, val: string) {
    const n = parseInt(val, 10)
    const chain = [...content.tipChain]
    chain[stepIdx] = { ...chain[stepIdx], pinnedDay: isNaN(n) || n <= 0 ? null : n }
    onChange({ ...content, tipChain: chain })
  }

  return (
    <SectionCard title="Tips & Tricks Chain" icon={Lightbulb}>

      {/* Chain toggle */}
      <div className="px-5 pt-4 pb-0">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Step 1 — Enable chain cycling</p>
        <button
          onClick={() => onChange({ ...content, chainEnabled: !content.chainEnabled })}
          className={`flex items-center gap-3 w-full px-4 py-3.5 rounded-xl border text-sm font-semibold transition-all ${
            content.chainEnabled
              ? 'bg-primary/8 border-primary/25 text-primary'
              : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}
        >
          {content.chainEnabled
            ? <ToggleRight size={22} className="shrink-0" />
            : <ToggleLeft size={22} className="shrink-0" />}
          <span>{content.chainEnabled ? 'Chain Cycling — ON' : 'Chain Cycling — OFF'}</span>
          <span className="text-xs font-normal ml-auto text-gray-400">
            {content.chainEnabled ? 'New section each day' : 'Section 1 always shown'}
          </span>
        </button>
      </div>

      {/* Sections */}
      <div className="px-5 pt-4 pb-0">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
          Step 2 — Sections <span className="normal-case font-normal">(each section = one day's tips)</span>
        </p>

        {content.tipChain.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-xl py-8 text-center mb-3">
            <Lightbulb size={28} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400 font-medium">No sections yet</p>
            <p className="text-xs text-gray-400 mt-0.5">Click the button below to add your first section</p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden mb-2">
            {content.tipChain.map((step, i) => {
              const isExpanded = expandedStep === i
              const form = sf(i)
              return (
                <div key={i} className="border-b border-gray-100 last:border-b-0">
                  <div
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors ${
                      isExpanded ? 'bg-primary/[0.04]' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => setExpandedStep(isExpanded ? null : i)}
                  >
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0 ${step.pinnedDay ? 'bg-orange-400' : 'bg-primary'}`}>
                      {step.stepNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-gray-700">Section {step.stepNumber}</span>
                        {step.pinnedDay && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-orange-100 text-orange-600">Day {step.pinnedDay}</span>
                        )}
                        {step.pinnedDate && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-blue-100 text-blue-600">{step.pinnedDate}</span>
                        )}
                        {step.tips.length === 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-red-100 text-red-500">Empty</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">{step.tips.length} tip{step.tips.length !== 1 ? 's' : ''} · {step.pinnedDay ? 'pinned' : 'auto-cycle'}</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button onClick={e => { e.stopPropagation(); move(i, -1) }} disabled={i === 0}
                        className="p-1.5 rounded-lg disabled:opacity-25 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                        <ArrowUp size={13} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); move(i, 1) }} disabled={i === content.tipChain.length - 1}
                        className="p-1.5 rounded-lg disabled:opacity-25 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                        <ArrowDown size={13} />
                      </button>
                      <button onClick={e => { e.stopPropagation(); deleteSection(i) }}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 size={13} />
                      </button>
                      {isExpanded ? <ChevronUp size={15} className="text-gray-400 ml-1" /> : <ChevronDown size={15} className="text-gray-400 ml-1" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="bg-gray-50/70">
                      {/* Pin to day */}
                      <div className="flex items-center gap-3 px-5 py-2.5 border-t border-gray-100">
                        <span className="text-xs text-gray-500 flex-1">Pin to cycle day <span className="text-gray-400">(optional — blank = auto)</span></span>
                        <input
                          type="number"
                          min={1}
                          className="w-20 text-sm text-center border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
                          placeholder="Day #"
                          defaultValue={step.pinnedDay ?? ''}
                          onChange={e => setPinnedDay(i, e.target.value)}
                        />
                      </div>

                      {/* Tips */}
                      {step.tips.length === 0 && form.formIdx !== -1 && (
                        <div className="py-5 text-center text-sm text-gray-400 border-t border-gray-100">No tips in this section yet.</div>
                      )}
                      {step.tips.map((tip, j) => {
                        if (form.formIdx === j) {
                          return (
                            <InlineForm key={j}
                              fields={[
                                { label: 'Title', value: form.title, onChange: v => setF(i, { title: v }), placeholder: 'e.g. Upload your first course' },
                                { label: 'Description', value: form.desc, onChange: v => setF(i, { desc: v }), multiline: true, placeholder: 'Optional description…' },
                              ]}
                              onSave={() => saveTip(i)}
                              onCancel={() => setF(i, { formIdx: null })}
                            />
                          )
                        }
                        return (
                          <ListItem key={j} title={tip.title} subtitle={tip.description}
                            onEdit={() => setF(i, { formIdx: j, title: tip.title, desc: tip.description })}
                            onDelete={() => deleteTip(i, j)}
                          />
                        )
                      })}
                      {form.formIdx === -1 ? (
                        <InlineForm
                          fields={[
                            { label: 'Title', value: form.title, onChange: v => setF(i, { title: v }), placeholder: 'e.g. Upload your first course' },
                            { label: 'Description', value: form.desc, onChange: v => setF(i, { desc: v }), multiline: true, placeholder: 'Optional description…' },
                          ]}
                          onSave={() => saveTip(i)}
                          onCancel={() => setF(i, { formIdx: null })}
                        />
                      ) : (
                        <AddButton label={`Add Tip to Section ${step.stepNumber}`} onClick={() => setF(i, { formIdx: -1, title: '', desc: '' })} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <button onClick={addSection}
          className="flex items-center gap-2 text-sm text-primary font-semibold hover:underline mb-4">
          <PlusCircle size={15} /> Add Section {content.tipChain.length + 1}
        </button>
      </div>

      {/* Card appearance */}
      <div className="px-5 pt-0 pb-4">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 mt-2">Step 3 — Card appearance <span className="normal-case font-normal">(optional)</span></p>
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Card Heading</label>
            <input
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              placeholder="Tips & Tricks (default)"
              value={content.tipsCardTitle}
              onChange={e => onChange({ ...content, tipsCardTitle: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Card Sub-heading</label>
            <input
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              placeholder="Best practices for your app (default)"
              value={content.tipsCardSubtitle}
              onChange={e => onChange({ ...content, tipsCardSubtitle: e.target.value })}
            />
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── What's New ───────────────────────────────────────────────────────────────

function WhatsNewSection({ content, onChange }: { content: PlatformContent; onChange: (c: PlatformContent) => void }) {
  const [formIdx, setFormIdx] = useState<number | null>(null)
  const [f, setF] = useState({ version: '', date: '', desc: '' })

  function save() {
    if (!f.version.trim() && !f.date.trim()) return
    const item: WhatsNewItem = { version: f.version.trim(), date: f.date.trim(), description: f.desc.trim() }
    const list = [...content.whatsNew]
    if (formIdx === -1) list.push(item)
    else if (formIdx !== null && formIdx >= 0) list[formIdx] = item
    onChange({ ...content, whatsNew: list })
    setFormIdx(null)
  }

  function del(i: number) {
    onChange({ ...content, whatsNew: content.whatsNew.filter((_, j) => j !== i) })
    if (formIdx === i) setFormIdx(null)
  }

  function openEdit(i: number) {
    const item = content.whatsNew[i]
    setFormIdx(i); setF({ version: item.version, date: item.date, desc: item.description })
  }

  return (
    <SectionCard title="What's New" icon={Newspaper}>
      {content.whatsNew.length === 0 && formIdx === null && <EmptyState label="No updates yet. Add your first entry." />}
      {content.whatsNew.map((item, i) => {
        if (formIdx === i) return (
          <InlineForm key={i}
            fields={[
              { label: 'Version', value: f.version, onChange: v => setF(x => ({ ...x, version: v })), placeholder: 'e.g. v2.5.0' },
              { label: 'Date', value: f.date, onChange: v => setF(x => ({ ...x, date: v })), placeholder: 'e.g. Aug 2025' },
              { label: 'Description', value: f.desc, onChange: v => setF(x => ({ ...x, desc: v })), multiline: true },
            ]}
            onSave={save} onCancel={() => setFormIdx(null)} />
        )
        return <ListItem key={i} title={`${item.version}  ·  ${item.date}`} subtitle={item.description} onEdit={() => openEdit(i)} onDelete={() => del(i)} />
      })}
      {formIdx === -1 ? (
        <InlineForm
          fields={[
            { label: 'Version', value: f.version, onChange: v => setF(x => ({ ...x, version: v })), placeholder: 'e.g. v2.5.0' },
            { label: 'Date', value: f.date, onChange: v => setF(x => ({ ...x, date: v })), placeholder: 'e.g. Aug 2025' },
            { label: 'Description', value: f.desc, onChange: v => setF(x => ({ ...x, desc: v })), multiline: true },
          ]}
          onSave={save} onCancel={() => setFormIdx(null)} />
      ) : (
        <AddButton label="Add Entry" onClick={() => { setFormIdx(-1); setF({ version: '', date: '', desc: '' }) }} />
      )}
    </SectionCard>
  )
}

// ─── Components ───────────────────────────────────────────────────────────────

function ComponentsSection({ content, onChange }: { content: PlatformContent; onChange: (c: PlatformContent) => void }) {
  const [formIdx, setFormIdx] = useState<number | null>(null)
  const [f, setF] = useState({ name: '', desc: '', isBeta: false })

  function save() {
    if (!f.name.trim()) return
    const item: ComponentItem = { name: f.name.trim(), description: f.desc.trim(), isBeta: f.isBeta }
    const list = [...content.components]
    if (formIdx === -1) list.push(item)
    else if (formIdx !== null && formIdx >= 0) list[formIdx] = item
    onChange({ ...content, components: list })
    setFormIdx(null)
  }

  function del(i: number) {
    onChange({ ...content, components: content.components.filter((_, j) => j !== i) })
    if (formIdx === i) setFormIdx(null)
  }

  function openEdit(i: number) {
    const item = content.components[i]
    setFormIdx(i); setF({ name: item.name, desc: item.description, isBeta: item.isBeta })
  }

  const betaToggle = (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        className={`relative w-9 h-5 rounded-full transition-colors ${f.isBeta ? 'bg-primary' : 'bg-gray-200'}`}
        onClick={() => setF(x => ({ ...x, isBeta: !x.isBeta }))}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${f.isBeta ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-gray-600">Mark as Beta</span>
    </label>
  )

  return (
    <SectionCard title="New Components" icon={Layers}>
      {content.components.length === 0 && formIdx === null && <EmptyState label="No components yet. Add your first component." />}
      {content.components.map((comp, i) => {
        if (formIdx === i) return (
          <InlineForm key={i}
            fields={[
              { label: 'Name', value: f.name, onChange: v => setF(x => ({ ...x, name: v })), placeholder: 'e.g. Community Forum' },
              { label: 'Description', value: f.desc, onChange: v => setF(x => ({ ...x, desc: v })), multiline: true },
            ]}
            extra={betaToggle} onSave={save} onCancel={() => setFormIdx(null)} />
        )
        return <ListItem key={i} title={comp.name} subtitle={comp.description} badge={comp.isBeta ? 'BETA' : null} onEdit={() => openEdit(i)} onDelete={() => del(i)} />
      })}
      {formIdx === -1 ? (
        <InlineForm
          fields={[
            { label: 'Name', value: f.name, onChange: v => setF(x => ({ ...x, name: v })), placeholder: 'e.g. Community Forum' },
            { label: 'Description', value: f.desc, onChange: v => setF(x => ({ ...x, desc: v })), multiline: true },
          ]}
          extra={betaToggle} onSave={save} onCancel={() => setFormIdx(null)} />
      ) : (
        <AddButton label="Add Component" onClick={() => { setFormIdx(-1); setF({ name: '', desc: '', isBeta: false }) }} />
      )}
    </SectionCard>
  )
}

// ─── Package editor ───────────────────────────────────────────────────────────

function PackageEditor({ packageId }: { packageId: string }) {
  const [content, setContent] = useState<PlatformContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false)
    try { setContent(await apiFetch(packageId)) }
    catch { setLoadError(true); setContent(emptyContent()) }
    finally { setLoading(false) }
  }, [packageId])

  useEffect(() => { void load() }, [load])

  async function handleSave() {
    if (!content) return
    setSaving(true); setSaveError(false)
    try {
      await apiSave(packageId, content)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError(true)
      setTimeout(() => setSaveError(false), 3000)
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    )
  }

  if (!content) return null

  return (
    <div className="flex flex-col h-full">
      {loadError && (
        <div className="mx-5 mt-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
          <span>Failed to load content.</span>
          <button onClick={load} className="ml-auto flex items-center gap-1 text-xs font-semibold hover:underline">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 pb-0">
        <TipsChainSection content={content} onChange={setContent} />
        <WhatsNewSection content={content} onChange={setContent} />
        <ComponentsSection content={content} onChange={setContent} />
      </div>

      {/* Sticky save bar */}
      <div className="px-5 py-4 bg-white border-t border-gray-100 flex items-center justify-end gap-3">
        <span aria-live="polite" className="min-w-0 text-sm font-semibold">
          {saved ? <span className="flex items-center gap-1.5 text-emerald-600"><Check size={14} /> Saved successfully</span> : saveError ? <span className="text-red-500">Failed to save — try again</span> : <span aria-hidden="true" className="text-transparent">Save status</span>}
        </span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors shadow-sm"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PlatformContent() {
  const [activeTab, setActiveTab] = useState<string>(PACKAGES[0].id)
  const { t } = useLang()

  const active = PACKAGES.find(p => p.id === activeTab) ?? PACKAGES[0]

  return (
    <div translate="no" className="notranslate flex h-full">
      {/* Left sidebar — package list */}
      <div className="w-56 shrink-0 border-r border-gray-100 bg-white flex flex-col">
        {/* Sidebar header */}
        <div className="px-4 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Package size={16} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800">{t('תוכן', 'Content')}</p>
              <p className="text-[11px] text-gray-400">{t('לפי חבילה', 'By package')}</p>
            </div>
          </div>
        </div>

        {/* Package nav */}
        <nav className="flex-1 p-3 space-y-1">
          {PACKAGES.map(pkg => {
            const Icon = pkg.icon
            const isActive = activeTab === pkg.id
            return (
              <button
                key={pkg.id}
                onClick={() => setActiveTab(pkg.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                  isActive
                    ? `${pkg.activeBg} text-white shadow-sm`
                    : `text-gray-600 hover:${pkg.bg} hover:${pkg.color}`
                }`}
              >
                <Icon size={16} className={isActive ? 'text-white' : pkg.color} />
                <span className="text-sm font-semibold">{pkg.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Sidebar footer info */}
        <div className="p-3 border-t border-gray-100">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            {t(
              'שינויים נשמרים ב-Firestore ומסונכרנים לכל האפליקציות של החבילה',
              'Changes are saved to Firestore and synced across all apps on this package',
            )}
          </p>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-50">
        {/* Content header */}
        <div className="bg-white border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${active.bg}`}>
              <active.icon size={18} className={active.color} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-800">{active.label}</h2>
              <p className="text-xs text-gray-500">
                {t('ניהול טיפים, עדכונים ורכיבים', 'Manage tips, updates & components')}
              </p>
            </div>
          </div>
        </div>

        {/* Package editor — remount on tab change to reset state */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {PACKAGES.map(pkg => (
            <div key={pkg.id} className={`flex-1 flex flex-col overflow-hidden ${activeTab === pkg.id ? '' : 'hidden'}`}>
              <PackageEditor packageId={pkg.id} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
