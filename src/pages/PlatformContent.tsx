import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import {
  Lightbulb, PlusCircle, Trash2, ChevronDown, ChevronUp,
  Save, Loader2, RefreshCw, ToggleLeft, ToggleRight,
  GripVertical, Pencil, X, Check,
  Package, Layers, Users, Star, Zap, Globe, Upload, ImageIcon, Calendar, Info,
} from 'lucide-react'
import { useLang } from '../contexts/LanguageContext'

// ─── Constants ────────────────────────────────────────────────────────────────

const CF_BASE = 'https://us-east1-dyo-courses.cloudfunctions.net'
const SECRET = 'dyo-platform-content-2026'

const LANGS = [
  { code: 'en' as const, label: 'EN', flag: '🇬🇧', dir: 'ltr' as const },
  { code: 'he' as const, label: 'HE', flag: '🇮🇱', dir: 'rtl' as const },
  { code: 'ar' as const, label: 'AR', flag: '🇸🇦', dir: 'rtl' as const },
  { code: 'es' as const, label: 'ES', flag: '🇪🇸', dir: 'ltr' as const },
]
type LangCode = 'en' | 'he' | 'ar' | 'es'

const PACKAGES = [
  {
    id: 'all_packages',
    label: 'All Packages',
    labelHe: 'כל החבילות',
    icon: Globe,
    color: 'text-gray-600',
    bg: 'bg-gray-50',
    activeBg: 'bg-gray-700',
    border: 'border-gray-200',
  },
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
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemTranslation { title?: string; description?: string }
interface CompTranslation { name?: string; description?: string }

interface TipItem {
  title: string
  description: string
  imageUrl?: string
  translations?: Record<string, ItemTranslation>
}
interface TipStep {
  stepNumber: number
  sectionTitle?: string
  tips: TipItem[]
  pinnedDay?: number | null
  pinnedDate?: string | null
}
interface ComponentItem {
  name: string
  description: string
  isBeta: boolean
  translations?: Record<string, CompTranslation>
}

interface PlatformContent {
  tips: TipItem[]
  tipChain: TipStep[]
  chainEnabled: boolean
  tipsImageUrl: string
  tipsCardTitle: string
  tipsCardSubtitle: string
  tipsCardTitleTranslations?: Record<string, string>
  tipsCardSubtitleTranslations?: Record<string, string>
  components: ComponentItem[]
}

function emptyContent(): PlatformContent {
  return {
    tips: [], tipChain: [], chainEnabled: true,
    tipsImageUrl: '', tipsCardTitle: '', tipsCardSubtitle: '',
    tipsCardTitleTranslations: {}, tipsCardSubtitleTranslations: {},
    components: [],
  }
}

// ─── Language helpers ─────────────────────────────────────────────────────────

function tipTitle(tip: TipItem, lang: LangCode) {
  return lang === 'en' ? tip.title : (tip.translations?.[lang]?.title ?? tip.title)
}
function tipDesc(tip: TipItem, lang: LangCode) {
  return lang === 'en' ? tip.description : (tip.translations?.[lang]?.description ?? tip.description)
}
function compName(c: ComponentItem, lang: LangCode) {
  return lang === 'en' ? c.name : (c.translations?.[lang]?.name ?? c.name)
}
function compDesc(c: ComponentItem, lang: LangCode) {
  return lang === 'en' ? c.description : (c.translations?.[lang]?.description ?? c.description)
}
function mergeTipTrans(tip: TipItem, lang: LangCode, title: string, desc: string): TipItem {
  return { ...tip, translations: { ...(tip.translations ?? {}), [lang]: { title, description: desc } } }
}
function mergeCompTrans(c: ComponentItem, lang: LangCode, name: string, desc: string): ComponentItem {
  return { ...c, translations: { ...(c.translations ?? {}), [lang]: { name, description: desc } } }
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
  console.log('[apiSave] tipChain:', JSON.stringify(content.tipChain.map(s => ({ step: s.stepNumber, tips: s.tips.map(t => ({ title: t.title, imageUrl: t.imageUrl ? t.imageUrl.slice(0, 80) + '…' : 'NONE' })) }))))
  const body = JSON.stringify({ packageId, content })
  console.log('[apiSave] request body size:', body.length, 'bytes')
  const res = await fetch(`${CF_BASE}/savePlatformContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': SECRET },
    body,
  })
  console.log('[apiSave] response status:', res.status)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

const TRANSLATE_MODEL = 'claude-haiku-4-5-20251001'

async function apiTranslate(items: Array<{ id: string; text: string }>): Promise<Record<string, { he: string; ar: string; es: string }>> {
  const system = 'You are a professional translator. Translate each item from English to Hebrew (he), Arabic (ar), and Spanish (es). Return ONLY valid JSON: {"translations":{"<id>":{"he":"...","ar":"...","es":"..."}, ...}}. Preserve formatting and brand names.'
  const res = await fetch('/api/claude/v1/translation-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TRANSLATE_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: JSON.stringify(items.map(i => ({ id: i.id, text: i.text }))) }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic error ${res.status}`)
  const data = await res.json() as { content: Array<{ text: string }> }
  const text = data.content?.[0]?.text ?? ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in response')
  const parsed = JSON.parse(match[0]) as { translations: Record<string, { he: string; ar: string; es: string }> }
  return parsed.translations ?? {}
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
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

function LangTabs({ active, onChange }: { active: LangCode; onChange: (l: LangCode) => void }) {
  return (
    <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
      {LANGS.map(l => (
        <button
          type="button"
          key={l.code}
          onClick={() => onChange(l.code)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            active === l.code ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <span>{l.flag}</span> {l.label}
        </button>
      ))}
    </div>
  )
}

function PushToAllButton({ onPushToAll, isPushingToAll, pushSuccess }: {
  onPushToAll: () => Promise<void>
  isPushingToAll: boolean
  pushSuccess: boolean
}) {
  return (
    <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
      <span className="text-xs text-gray-400">Push this section's content to All Packages</span>
      <button
        type="button"
        onClick={onPushToAll}
        disabled={isPushingToAll}
        className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-primary px-3 py-1.5 rounded-lg border border-gray-200 hover:border-primary/30 hover:bg-primary/5 transition-colors disabled:opacity-50 shrink-0"
      >
        {isPushingToAll
          ? <Loader2 size={12} className="animate-spin" />
          : pushSuccess
            ? <Check size={12} className="text-emerald-500" />
            : <Globe size={12} />}
        <span className={pushSuccess ? 'text-emerald-600' : ''}>
          {isPushingToAll ? 'Saving…' : pushSuccess ? 'Saved to All Packages' : 'Also save to All Packages'}
        </span>
      </button>
    </div>
  )
}

// ─── Tips Chain ───────────────────────────────────────────────────────────────

type TipsChainHandle = { flush: () => TipStep[] | null }

const TipsChainSection = forwardRef<TipsChainHandle, {
  content: PlatformContent
  onChange: (c: PlatformContent) => void
  lang: LangCode
  packageId: string
  onPushToAll?: () => Promise<void>
  isPushingToAll?: boolean
  pushSuccess?: boolean
}>(function TipsChainSection({ content, onChange, lang, packageId, onPushToAll, isPushingToAll, pushSuccess }, ref) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  type StepForm = {
    formIdx: number | null
    title: string
    desc: string
    imageUrl: string
    uploadingImg: boolean
  }
  const [stepForms, setStepForms] = useState<Record<number, StepForm>>({})
  const tipImgInputRef = useRef<HTMLInputElement>(null)
  const [pendingTipImgStep, setPendingTipImgStep] = useState<number | null>(null)

  const langMeta = LANGS.find(l => l.code === lang)!
  const isEn = lang === 'en'

  useImperativeHandle(ref, () => ({
    flush() {
      const chain = content.tipChain.map(s => ({ ...s, tips: [...s.tips] }))
      let changed = false
      Object.entries(stepForms).forEach(([idxStr, form]) => {
        const idx = Number(idxStr)
        if (idx >= chain.length || form.formIdx === null) return
        const title = form.title.trim()
        if (!title) return
        const newTip: TipItem = { title, description: form.desc.trim(), ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}) }
        if (form.formIdx === -1) {
          if (chain[idx].tips.length === 0) { chain[idx].tips = [newTip]; changed = true }
        } else if (form.formIdx >= 0 && form.formIdx < chain[idx].tips.length) {
          chain[idx].tips[form.formIdx] = { ...chain[idx].tips[form.formIdx], ...newTip }
          changed = true
        }
      })
      console.log('[flush] stepForms:', JSON.stringify(Object.fromEntries(Object.entries(stepForms).map(([k, f]) => [k, { formIdx: f.formIdx, title: f.title, imageUrl: f.imageUrl ? f.imageUrl.slice(0, 80) + '…' : 'NONE' }]))))
      console.log('[flush] chain:', JSON.stringify(chain.map(s => ({ step: s.stepNumber, tips: s.tips.map(t => ({ title: t.title, imageUrl: t.imageUrl ? t.imageUrl.slice(0, 80) + '…' : 'NONE' })) }))))
      return changed ? chain : null
    }
  }), [content.tipChain, stepForms])

  const emptyForm: StepForm = { formIdx: null, title: '', desc: '', imageUrl: '', uploadingImg: false }
  function sf(i: number): StepForm {
    return stepForms[i] ?? emptyForm
  }
  function setF(i: number, patch: Partial<StepForm>) {
    setStepForms(prev => ({ ...prev, [i]: { ...(prev[i] ?? emptyForm), ...patch } }))
  }

  // ── Drag-and-drop reorder ──────────────────────────────────────────────────

  function handleDragStart(i: number) { setDragIdx(i) }
  function handleDragOver(e: React.DragEvent, i: number) { e.preventDefault(); setDragOverIdx(i) }
  function handleDrop(i: number) {
    if (!isEn || dragIdx === null || dragIdx === i) { resetDrag(); return }
    const chain = [...content.tipChain]
    const [moved] = chain.splice(dragIdx, 1)
    chain.splice(i, 0, moved)
    chain.forEach((s, k) => { s.stepNumber = k + 1 })
    onChange({ ...content, tipChain: chain })
    resetDrag()
  }
  function resetDrag() { setDragIdx(null); setDragOverIdx(null) }

  // ── Tip image upload ───────────────────────────────────────────────────────

  async function handleTipImgUpload(e: React.ChangeEvent<HTMLInputElement>, stepIdx: number) {
    const file = e.target.files?.[0]
    if (!file) return
    setF(stepIdx, { uploadingImg: true })
    try {
      const imageBase64 = await fileToBase64(file)
      const res = await fetch(`${CF_BASE}/uploadTipItemImage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': SECRET },
        body: JSON.stringify({ packageId, imageBase64, mimeType: file.type }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { url } = await res.json()
      console.log('[tipImgUpload] step', stepIdx, 'url:', url ? url.slice(0, 80) + '…' : 'NONE')
      setF(stepIdx, { imageUrl: url, uploadingImg: false })
    } catch (err) {
      setF(stepIdx, { uploadingImg: false })
      alert(`Tip image upload failed — ${err instanceof Error ? err.message : 'please try again.'}`)
    } finally {
      if (tipImgInputRef.current) tipImgInputRef.current.value = ''
      setPendingTipImgStep(null)
    }
  }

  // ── Section management ─────────────────────────────────────────────────────

  function addSection() {
    if (!isEn) return
    const next = content.tipChain.length + 1
    onChange({ ...content, tipChain: [...content.tipChain, { stepNumber: next, sectionTitle: '', tips: [] }] })
    setExpandedStep(content.tipChain.length)
  }

  function deleteSection(i: number) {
    if (!isEn) return
    console.log('[deleteSection] deleting section', i, '— sectionTitle:', content.tipChain[i]?.sectionTitle, 'tips:', content.tipChain[i]?.tips.length)
    const chain = content.tipChain.filter((_, j) => j !== i).map((s, j) => ({ ...s, stepNumber: j + 1 }))
    console.log('[deleteSection] chain after:', chain.map(s => ({ step: s.stepNumber, tips: s.tips.length })))
    onChange({ ...content, tipChain: chain })
    if (expandedStep === i) setExpandedStep(null)
  }

  function move(i: number, dir: -1 | 1) {
    if (!isEn) return
    const j = i + dir
    if (j < 0 || j >= content.tipChain.length) return
    const chain = [...content.tipChain];
    [chain[i], chain[j]] = [chain[j], chain[i]]
    chain.forEach((s, k) => { s.stepNumber = k + 1 })
    onChange({ ...content, tipChain: chain })
    setExpandedStep(j)
  }

  function setSectionTitle(stepIdx: number, title: string) {
    if (!isEn) return
    const chain = content.tipChain.map((s, i) => i === stepIdx ? { ...s, sectionTitle: title } : s)
    onChange({ ...content, tipChain: chain })
  }

  function setPinnedDate(stepIdx: number, val: string) {
    if (!isEn) return
    const chain = content.tipChain.map((s, i) =>
      i === stepIdx ? { ...s, pinnedDate: val || null } : s
    )
    onChange({ ...content, tipChain: chain })
  }

  // ── Tip management ─────────────────────────────────────────────────────────

  function saveTip(stepIdx: number) {
    const form = sf(stepIdx)
    const chain = [...content.tipChain]
    const step = { ...chain[stepIdx], tips: [...chain[stepIdx].tips] }

    console.log('[saveTip] stepIdx:', stepIdx, 'formIdx:', form.formIdx, 'title:', form.title, 'imageUrl:', form.imageUrl ? form.imageUrl.slice(0, 60) + '…' : 'NONE')

    if (isEn) {
      const title = form.title.trim()
      if (!title) { console.log('[saveTip] ABORTED — empty title'); return }
      const newTip: TipItem = { title, description: form.desc.trim(), imageUrl: form.imageUrl || undefined }
      if (form.formIdx === -1) {
        step.tips = [...step.tips, newTip]
      } else if (form.formIdx !== null && form.formIdx >= 0) {
        step.tips = step.tips.map((t, i) =>
          i === form.formIdx ? { ...t, title: newTip.title, description: newTip.description, imageUrl: newTip.imageUrl } : t
        )
      }
    } else {
      if (form.formIdx !== null && form.formIdx >= 0) {
        step.tips = step.tips.map((t, i) =>
          i === form.formIdx ? mergeTipTrans(t, lang, form.title, form.desc) : t
        )
      }
    }

    chain[stepIdx] = step
    console.log('[saveTip] chain after:', JSON.stringify(chain.map(s => ({ step: s.stepNumber, tips: s.tips.map(t => ({ title: t.title, imageUrl: t.imageUrl ? t.imageUrl.slice(0, 60) + '…' : 'NONE' })) }))))
    onChange({ ...content, tipChain: chain })
    setF(stepIdx, { formIdx: null, title: '', desc: '', imageUrl: '' })
  }

  function deleteTip(stepIdx: number, tipIdx: number) {
    if (!isEn) return
    console.log('[deleteTip] stepIdx:', stepIdx, 'tipIdx:', tipIdx, 'title:', content.tipChain[stepIdx]?.tips[tipIdx]?.title)
    const chain = [...content.tipChain]
    chain[stepIdx] = { ...chain[stepIdx], tips: chain[stepIdx].tips.filter((_, i) => i !== tipIdx) }
    console.log('[deleteTip] chain after:', chain.map(s => ({ step: s.stepNumber, tips: s.tips.length })))
    onChange({ ...content, tipChain: chain })
    setF(stepIdx, { formIdx: null })
  }

  // ── Card appearance fields ─────────────────────────────────────────────────

  const cardTitleVal = isEn
    ? content.tipsCardTitle
    : (content.tipsCardTitleTranslations?.[lang] ?? '')
  const cardSubtitleVal = isEn
    ? content.tipsCardSubtitle
    : (content.tipsCardSubtitleTranslations?.[lang] ?? '')

  function setCardTitle(v: string) {
    if (isEn) onChange({ ...content, tipsCardTitle: v })
    else onChange({ ...content, tipsCardTitleTranslations: { ...(content.tipsCardTitleTranslations ?? {}), [lang]: v } })
  }
  function setCardSubtitle(v: string) {
    if (isEn) onChange({ ...content, tipsCardSubtitle: v })
    else onChange({ ...content, tipsCardSubtitleTranslations: { ...(content.tipsCardSubtitleTranslations ?? {}), [lang]: v } })
  }

  return (
    <SectionCard title="Tips & Tricks Chain" icon={Lightbulb}>

      {/* Hidden tip image input */}
      <input
        ref={tipImgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => pendingTipImgStep !== null && handleTipImgUpload(e, pendingTipImgStep)}
      />

      {/* Chain toggle */}
      {isEn && (
        <div className="px-5 pb-3">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Chain cycling</p>
          <button
            type="button"
            onClick={() => onChange({ ...content, chainEnabled: !content.chainEnabled })}
            className={`flex items-center gap-3 w-full px-4 py-3.5 rounded-xl border text-sm font-semibold transition-all ${
              content.chainEnabled
                ? 'bg-primary/8 border-primary/25 text-primary'
                : 'bg-gray-50 border-gray-200 text-gray-500'
            }`}
          >
            {content.chainEnabled ? <ToggleRight size={22} className="shrink-0" /> : <ToggleLeft size={22} className="shrink-0" />}
            <span>{content.chainEnabled ? 'Chain Cycling — ON' : 'Chain Cycling — OFF'}</span>
            <span className="text-xs font-normal ml-auto text-gray-400">
              {content.chainEnabled ? 'New section each visit' : 'Section 1 always shown'}
            </span>
          </button>
          {content.chainEnabled && (
            <div className="flex items-start gap-2 mt-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg">
              <Info size={13} className="text-blue-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-700 leading-relaxed">
                Each day a user opens the app, they advance to the next section. Skipping days does not skip sections — only actual visits advance the chain.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Card appearance — before sections */}
      <div className="px-5 pt-0 pb-3">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2 mt-2">
          {isEn ? 'Card appearance' : `${langMeta.flag} Card title translations`}
          {isEn && <span className="normal-case font-normal"> (optional)</span>}
        </p>
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">
              {isEn ? 'Card Heading' : `Card Heading (${langMeta.flag} ${langMeta.label})`}
            </label>
            <input
              type="text"
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
              placeholder={isEn ? 'e.g. Daily Growth Tips' : `${langMeta.flag} translation…`}
              value={cardTitleVal}
              dir={langMeta.dir}
              onChange={e => setCardTitle(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="px-5 pb-0">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
          {isEn ? 'Sections' : `${langMeta.flag} Editing ${langMeta.label} translations`}
          {isEn && <span className="normal-case font-normal"> (each section = one day's content)</span>}
        </p>

        {content.tipChain.length > 0 && (
          <div className="border border-gray-200 rounded-xl overflow-hidden mb-2">
            {content.tipChain.map((step, i) => {
              const isExpanded = expandedStep === i
              const form = sf(i)
              const displayTitle = step.sectionTitle?.trim() || `Section ${step.stepNumber}`
              const hasPinnedDate = !!step.pinnedDate
              const hasTip = step.tips.length > 0
              const isDragging = dragIdx === i
              const isDragOver = dragOverIdx === i && dragIdx !== i

              return (
                <div
                  key={i}
                  className={`border-b border-gray-100 last:border-b-0 transition-all ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'ring-2 ring-inset ring-primary/40 bg-primary/[0.02]' : ''}`}
                  draggable={isEn}
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={e => handleDragOver(e, i)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={resetDrag}
                >
                  {/* Section header */}
                  <div
                    className={`flex items-center gap-2.5 px-4 py-3 select-none transition-colors ${
                      isExpanded ? 'bg-primary/[0.04]' : 'hover:bg-gray-50'
                    }`}
                  >
                    {/* Drag handle */}
                    {isEn && (
                      <span className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0 transition-colors">
                        <GripVertical size={15} />
                      </span>
                    )}
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold shrink-0 ${hasPinnedDate ? 'bg-blue-500' : 'bg-primary'}`}
                    >
                      {step.stepNumber}
                    </div>
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => setExpandedStep(isExpanded ? null : i)}
                    >
                      <div className="flex items-center gap-1.5">
                        {!hasTip && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-red-100 text-red-500">No tip</span>
                        )}
                        <span className="text-xs text-gray-400">{hasPinnedDate ? `pinned ${formatDate(step.pinnedDate!)}` : 'auto-cycle'}</span>
                      </div>
                    </div>
                    {/* Section title on the right */}
                    <span
                      className={`text-sm font-semibold truncate max-w-[180px] shrink-0 cursor-pointer ${hasPinnedDate ? 'text-blue-600' : 'text-gray-700'}`}
                      onClick={() => setExpandedStep(isExpanded ? null : i)}
                    >
                      {displayTitle}
                    </span>
                    {isEn && (
                      <button type="button" onClick={e => { e.stopPropagation(); deleteSection(i) }}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0">
                        <Trash2 size={13} />
                      </button>
                    )}
                    <span
                      className="cursor-pointer shrink-0"
                      onClick={() => setExpandedStep(isExpanded ? null : i)}
                    >
                      {isExpanded ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
                    </span>
                  </div>

                  {/* Expanded section */}
                  {isExpanded && (
                    <div className="bg-gray-50/70 border-t border-gray-100">

                      {/* Section title field */}
                      {isEn && (
                        <div className="px-5 py-3 border-b border-gray-100">
                          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Section Title</label>
                          <input
                            type="text"
                            className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
                            placeholder={`Section ${step.stepNumber} (default)`}
                            value={step.sectionTitle ?? ''}
                            onChange={e => setSectionTitle(i, e.target.value)}
                          />
                        </div>
                      )}

                      {/* Pin to date */}
                      {isEn && (
                        <div className="px-5 py-3 border-b border-gray-100">
                          <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                            <span className="flex items-center gap-1.5"><Calendar size={12} /> Pin to specific date <span className="font-normal text-gray-400">(optional — blank = auto-cycle)</span></span>
                          </label>
                          <input
                            type="date"
                            className={`text-sm border rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white ${
                              hasPinnedDate ? 'border-blue-300 text-blue-700' : 'border-gray-200 text-gray-700'
                            }`}
                            value={step.pinnedDate ?? ''}
                            onChange={e => setPinnedDate(i, e.target.value)}
                          />
                          {hasPinnedDate && (
                            <div className="flex items-start gap-2 mt-2 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-xl">
                              <Info size={13} className="text-blue-500 shrink-0 mt-0.5" />
                              <p className="text-[11px] text-blue-700 leading-relaxed">
                                On <strong>{formatDate(step.pinnedDate!)}</strong>, this section is shown to all users regardless of their chain cycle position. The regular chain rule does <strong>not</strong> apply on this date.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Single tip per section */}
                      <div>
                        {hasTip ? (
                          // Show the single tip (edit mode or display)
                          form.formIdx === 0 ? (
                            <TipForm
                              isEn={isEn}
                              langMeta={langMeta}
                              form={form}
                              onTitleChange={v => setF(i, { title: v })}
                              onDescChange={v => setF(i, { desc: v })}
                              onImgUpload={() => { setPendingTipImgStep(i); tipImgInputRef.current?.click() }}
                              onImgClear={() => setF(i, { imageUrl: '' })}
                              onSave={() => saveTip(i)}
                              onCancel={() => setF(i, { formIdx: null, title: '', desc: '', imageUrl: '' })}
                            />
                          ) : (
                            <TipListItem
                              tip={step.tips[0]}
                              lang={lang}
                              onEdit={() => setF(i, { formIdx: 0, title: tipTitle(step.tips[0], lang), desc: tipDesc(step.tips[0], lang), imageUrl: step.tips[0].imageUrl ?? '' })}
                              onDelete={() => isEn && deleteTip(i, 0)}
                              isEn={isEn}
                              onImgClick={() => {
                                setF(i, { formIdx: 0, title: tipTitle(step.tips[0], lang), desc: tipDesc(step.tips[0], lang), imageUrl: step.tips[0].imageUrl ?? '' })
                                setPendingTipImgStep(i)
                                tipImgInputRef.current?.click()
                              }}
                            />
                          )
                        ) : (
                          // No tip yet — show add form or add button
                          isEn && (
                            form.formIdx === -1 ? (
                              <TipForm
                                isEn={isEn}
                                langMeta={langMeta}
                                form={form}
                                onTitleChange={v => setF(i, { title: v })}
                                onDescChange={v => setF(i, { desc: v })}
                                onImgUpload={() => { setPendingTipImgStep(i); tipImgInputRef.current?.click() }}
                                onImgClear={() => setF(i, { imageUrl: '' })}
                                onSave={() => saveTip(i)}
                                onCancel={() => setF(i, { formIdx: null, title: '', desc: '', imageUrl: '' })}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setF(i, { formIdx: -1, title: '', desc: '', imageUrl: '' })}
                                className="flex items-center gap-2 w-full px-5 py-3 text-sm text-primary font-medium hover:bg-primary/5 transition-colors"
                              >
                                <PlusCircle size={15} /> Add Tip
                              </button>
                            )
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {isEn && (
          <button
            type="button"
            onClick={addSection}
            className="flex items-center gap-2 text-sm text-primary font-semibold hover:underline mb-4"
          >
            <PlusCircle size={15} /> Add Section {content.tipChain.length + 1}
          </button>
        )}
      </div>

      {onPushToAll && <PushToAllButton onPushToAll={onPushToAll} isPushingToAll={!!isPushingToAll} pushSuccess={!!pushSuccess} />}
    </SectionCard>
  )
})

// ─── Tip sub-components ───────────────────────────────────────────────────────

function TipListItem({ tip, lang, onEdit, onDelete, isEn, onImgClick }: {
  tip: TipItem
  lang: LangCode
  onEdit: () => void
  onDelete: () => void
  isEn: boolean
  onImgClick?: () => void
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 border-t border-gray-100 group hover:bg-gray-50/60 transition-colors">
      {/* Tip image — click to upload (487×311 landscape ratio) */}
      <div className="shrink-0">
        {tip.imageUrl ? (
          <div className="relative overflow-hidden rounded-xl border border-gray-100" onClick={isEn ? onImgClick : undefined} style={{ width: 160, aspectRatio: '487 / 311' }}>
            <img
              src={tip.imageUrl}
              className={`w-full h-full object-cover ${isEn ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
            />
            {isEn && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <Upload size={14} className="text-white" />
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={isEn ? onImgClick : undefined}
            disabled={!isEn}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed bg-gray-50 transition-colors ${isEn ? 'border-gray-300 hover:border-primary hover:bg-primary/5 hover:text-primary cursor-pointer' : 'border-gray-200'}`}
            style={{ width: 160, aspectRatio: '487 / 311' }}
          >
            <ImageIcon size={14} className="text-gray-300" />
            {isEn && <span className="text-[9px] text-gray-300 leading-tight">Add image</span>}
          </button>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm font-semibold text-gray-800 block">{tipTitle(tip, lang)}</span>
        {tipDesc(tip, lang) && (
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
            {tipDesc(tip, lang) || (lang !== 'en' ? `(EN: ${tip.description})` : '')}
          </p>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button type="button" onClick={onEdit} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-primary transition-colors">
          <Pencil size={13} />
        </button>
        {isEn && (
          <button type="button" onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function TipForm({ isEn, langMeta, form, onTitleChange, onDescChange, onImgUpload, onImgClear, onSave, onCancel }: {
  isEn: boolean
  langMeta: typeof LANGS[0]
  form: { title: string; desc: string; imageUrl: string; uploadingImg: boolean }
  onTitleChange: (v: string) => void
  onDescChange: (v: string) => void
  onImgUpload: () => void
  onImgClear: () => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="border-t border-gray-100 bg-gradient-to-b from-primary/5 to-primary/[0.02] px-5 py-4 space-y-3">
      {/* Image upload */}
      {isEn && (
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Tip Image <span className="font-normal text-gray-400">(optional)</span></label>
          {form.imageUrl ? (
            <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
              <div style={{ aspectRatio: '487 / 311', width: '100%' }}>
                <img src={form.imageUrl} className="w-full h-full object-cover" />
              </div>
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-600">Image selected</p>
                <div className="flex gap-1">
                  <button type="button" onClick={onImgUpload} className="flex items-center gap-1 text-xs text-primary font-semibold px-2 py-1.5 rounded-lg hover:bg-primary/8 transition-colors">
                    <Upload size={11} /> Replace
                  </button>
                  <button type="button" onClick={onImgClear} className="flex items-center gap-1 text-xs text-red-400 font-semibold px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 size={11} /> Remove
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={onImgUpload}
              disabled={form.uploadingImg}
              className="flex items-center justify-center gap-2 w-full px-4 py-3.5 border border-dashed border-gray-300 rounded-xl text-xs text-gray-400 hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              {form.uploadingImg
                ? <Loader2 size={16} className="animate-spin" />
                : <ImageIcon size={16} />}
              <span>{form.uploadingImg ? 'Uploading…' : 'Upload image for this tip'}</span>
              {!form.uploadingImg && <Upload size={11} className="ml-auto opacity-50" />}
            </button>
          )}
        </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">
          {isEn ? 'Title' : `Title (${langMeta.flag} ${langMeta.label})`}
        </label>
        <input
          type="text"
          className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
          placeholder={isEn ? 'e.g. Upload your first course' : `${langMeta.flag} translation…`}
          value={form.title}
          dir={langMeta.dir}
          onChange={e => onTitleChange(e.target.value)}
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1.5">
          {isEn ? 'Description' : `Description (${langMeta.flag} ${langMeta.label})`}
        </label>
        <textarea
          className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
          rows={3}
          placeholder={isEn ? 'Optional description…' : `${langMeta.flag} translation…`}
          value={form.desc}
          dir={langMeta.dir}
          onChange={e => onDescChange(e.target.value)}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Check size={13} /> Save Tip
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
        >
          <X size={13} /> Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Components ───────────────────────────────────────────────────────────────

interface ComponentsHandle {
  flush: () => ComponentItem | null
}

const ComponentsSection = forwardRef<ComponentsHandle, {
  content: PlatformContent
  onChange: (c: PlatformContent) => void
  lang: LangCode
  onPushToAll?: () => Promise<void>
  isPushingToAll?: boolean
  pushSuccess?: boolean
}>(function ComponentsSection({ content, onChange, lang, onPushToAll, isPushingToAll, pushSuccess }, ref) {
  const [formIdx, setFormIdx] = useState<number | null>(null)
  const [f, setF] = useState({ name: '', desc: '', isBeta: false })
  const langMeta = LANGS.find(l => l.code === lang)!
  const isEn = lang === 'en'

  useImperativeHandle(ref, () => ({
    flush() {
      if (formIdx === -1 && isEn && f.name.trim()) {
        const item: ComponentItem = { name: f.name.trim(), description: f.desc.trim(), isBeta: f.isBeta }
        setFormIdx(null)
        return item
      }
      return null
    },
  }))

  function save() {
    if (isEn) {
      if (!f.name.trim()) return
      const item: ComponentItem = { name: f.name.trim(), description: f.desc.trim(), isBeta: f.isBeta }
      const list = [...content.components]
      if (formIdx === -1) list.push(item)
      else if (formIdx !== null && formIdx >= 0) list[formIdx] = item
      onChange({ ...content, components: list })
    } else {
      if (formIdx !== null && formIdx >= 0) {
        const list = content.components.map((c, i) =>
          i === formIdx ? mergeCompTrans(c, lang, f.name, f.desc) : c
        )
        onChange({ ...content, components: list })
      }
    }
    setFormIdx(null)
  }

  function del(i: number) {
    if (!isEn) return
    onChange({ ...content, components: content.components.filter((_, j) => j !== i) })
    if (formIdx === i) setFormIdx(null)
  }

  function openEdit(i: number) {
    const item = content.components[i]
    setFormIdx(i)
    setF({ name: compName(item, lang), desc: compDesc(item, lang), isBeta: item.isBeta })
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

  function renderForm(fields: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; placeholder?: string; dir?: 'ltr' | 'rtl' }[], extra?: React.ReactNode) {
    return (
      <div className="border-t border-gray-100 bg-gradient-to-b from-primary/5 to-primary/[0.02] px-5 py-4 space-y-3">
        {fields.map((field, idx) => (
          <div key={idx}>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">{field.label}</label>
            {field.multiline ? (
              <textarea
                className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
                rows={3}
                placeholder={field.placeholder}
                value={field.value}
                dir={field.dir}
                onChange={e => field.onChange(e.target.value)}
              />
            ) : (
              <input
                type="text"
                className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
                placeholder={field.placeholder}
                value={field.value}
                dir={field.dir}
                onChange={e => field.onChange(e.target.value)}
              />
            )}
          </div>
        ))}
        {extra}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={save}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Check size={13} /> Save
          </button>
          <button
            type="button"
            onClick={() => setFormIdx(null)}
            className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X size={13} /> Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <SectionCard title="New Components" icon={Layers}>
      {content.components.length === 0 && formIdx === null && <EmptyState label="No components yet. Add your first component." />}
      {content.components.map((comp, i) => {
        if (formIdx === i) {
          return renderForm(
            [
              { label: isEn ? 'Name' : `Name (${langMeta.flag} ${langMeta.label})`, value: f.name, onChange: v => setF(x => ({ ...x, name: v })), placeholder: isEn ? 'e.g. Community Forum' : `${langMeta.flag} translation…`, dir: langMeta.dir },
              { label: isEn ? 'Description' : `Description (${langMeta.flag} ${langMeta.label})`, value: f.desc, onChange: v => setF(x => ({ ...x, desc: v })), multiline: true, placeholder: isEn ? undefined : `${langMeta.flag} translation…`, dir: langMeta.dir },
            ],
            isEn ? betaToggle : undefined,
          )
        }
        return (
          <div key={i} className="flex items-start gap-3 px-5 py-3.5 border-t border-gray-100 group hover:bg-gray-50/60 transition-colors">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">{compName(comp, lang)}</span>
                {comp.isBeta && (
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/10 text-primary tracking-wide">BETA</span>
                )}
              </div>
              {compDesc(comp, lang) && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{compDesc(comp, lang)}</p>}
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button type="button" onClick={() => openEdit(i)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-primary transition-colors">
                <Pencil size={13} />
              </button>
              <button type="button" onClick={() => del(i)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )
      })}

      {isEn && (
        formIdx === -1
          ? renderForm(
              [
                { label: 'Name', value: f.name, onChange: v => setF(x => ({ ...x, name: v })), placeholder: 'e.g. Community Forum' },
                { label: 'Description', value: f.desc, onChange: v => setF(x => ({ ...x, desc: v })), multiline: true },
              ],
              betaToggle,
            )
          : (
            <button
              type="button"
              onClick={() => { setFormIdx(-1); setF({ name: '', desc: '', isBeta: false }) }}
              className="flex items-center gap-2 w-full px-5 py-3 text-sm text-primary font-medium hover:bg-primary/5 transition-colors border-t border-gray-100"
            >
              <PlusCircle size={15} /> Add Component
            </button>
          )
      )}

      {onPushToAll && <PushToAllButton onPushToAll={onPushToAll} isPushingToAll={!!isPushingToAll} pushSuccess={!!pushSuccess} />}
    </SectionCard>
  )
})

// ─── Package editor ───────────────────────────────────────────────────────────

function PackageEditor({ packageId }: { packageId: string }) {
  const [content, setContent] = useState<PlatformContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [openFormWarning, setOpenFormWarning] = useState(false)
  const [lang, setLang] = useState<LangCode>('en')
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState<string | null>(null)
  const [pushingSection, setPushingSection] = useState<string | null>(null)
  const [pushSuccessSection, setPushSuccessSection] = useState<string | null>(null)
  const tipsChainRef = useRef<TipsChainHandle>(null)
  const componentsSectionRef = useRef<ComponentsHandle>(null)

  async function pushSectionToAllPackages(section: 'tips' | 'components') {
    if (!content || packageId === 'all_packages') return
    setPushingSection(section)
    try {
      const allPkg = await apiFetch('all_packages')
      let updated = { ...allPkg }
      if (section === 'tips') {
        updated = {
          ...updated,
          tipChain: content.tipChain,
          chainEnabled: content.chainEnabled,
          tipsImageUrl: content.tipsImageUrl,
          tipsCardTitle: content.tipsCardTitle,
          tipsCardSubtitle: content.tipsCardSubtitle,
          tipsCardTitleTranslations: content.tipsCardTitleTranslations ?? {},
          tipsCardSubtitleTranslations: content.tipsCardSubtitleTranslations ?? {},
        }
      } else if (section === 'components') {
        updated = { ...updated, components: content.components }
      }
      await apiSave('all_packages', updated)
      setPushSuccessSection(section)
      setTimeout(() => setPushSuccessSection(null), 2500)
    } catch {
      // silent
    } finally {
      setPushingSection(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true); setLoadError(false)
    try { setContent(await apiFetch(packageId)) }
    catch { setLoadError(true); setContent(emptyContent()) }
    finally { setLoading(false) }
  }, [packageId])

  useEffect(() => { void load() }, [load])

  async function handleSave() {
    if (!content) return

    console.log('[handleSave] content.tipChain length:', content.tipChain.length)
    console.log('[handleSave] tipChain pre-flush:', JSON.stringify(content.tipChain.map(s => ({ step: s.stepNumber, tips: s.tips.map(t => ({ title: t.title, imageUrl: t.imageUrl ? t.imageUrl.slice(0, 80) + '…' : 'NONE' })) }))))

    // Flush any open tip form into the content before saving
    const pendingTipChain = tipsChainRef.current?.flush() ?? null
    const contentWithTips = pendingTipChain ? { ...content, tipChain: pendingTipChain } : content
    if (pendingTipChain) setContent(contentWithTips)

    // Flush any pending component form
    const pendingComp = componentsSectionRef.current?.flush() ?? null
    const contentToSave = pendingComp
      ? { ...contentWithTips, components: [...contentWithTips.components, pendingComp] }
      : contentWithTips

    if (pendingComp) setContent(contentToSave)

    // Always clear legacy fields — tipChain is the source of truth now
    const finalContent: PlatformContent = { ...contentToSave, tips: [], tipsImageUrl: '' }

    console.log('[handleSave] legacy tips in state (will be cleared):', contentToSave.tips.length)
    console.log('[handleSave] contentToSave.tipChain length:', finalContent.tipChain.length)
    console.log('[handleSave] after flush:', JSON.stringify(finalContent.tipChain.map(s => ({ step: s.stepNumber, tips: s.tips.map(t => ({ title: t.title, imageUrl: t.imageUrl ? t.imageUrl.slice(0, 80) + '…' : 'NONE' })) }))))
    setSaving(true); setSaveError(false); setOpenFormWarning(false)
    try {
      await apiSave(packageId, finalContent)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      setSaveError(true)
      setTimeout(() => setSaveError(false), 3000)
    } finally { setSaving(false) }
  }

  async function handleTranslateAll() {
    if (!content || translating) return
    setTranslating(true)
    setTranslateError(null)
    try {
      const items: Array<{ id: string; text: string }> = []

      content.tipChain.forEach((step, si) => {
        step.tips.forEach((tip, ti) => {
          if (tip.title.trim()) items.push({ id: `chain_${si}_${ti}_title`, text: tip.title })
          if (tip.description.trim()) items.push({ id: `chain_${si}_${ti}_desc`, text: tip.description })
        })
      })
      content.components.forEach((c, i) => {
        if (c.name.trim()) items.push({ id: `comp_${i}_name`, text: c.name })
        if (c.description.trim()) items.push({ id: `comp_${i}_desc`, text: c.description })
      })
      if (content.tipsCardTitle.trim()) items.push({ id: 'card_title', text: content.tipsCardTitle })
      if (content.tipsCardSubtitle.trim()) items.push({ id: 'card_subtitle', text: content.tipsCardSubtitle })

      if (items.length === 0) {
        setTranslateError('No content to translate. Add tips or components first.')
        return
      }

      const translations = await apiTranslate(items)

      const newContent = { ...content }

      newContent.tipChain = content.tipChain.map((step, si) => ({
        ...step,
        tips: step.tips.map((tip, ti) => {
          const trTitle = translations[`chain_${si}_${ti}_title`]
          const trDesc  = translations[`chain_${si}_${ti}_desc`]
          const trans: Record<string, ItemTranslation> = { ...(tip.translations ?? {}) }
          for (const l of ['he', 'ar', 'es'] as const) {
            trans[l] = {
              ...(trans[l] ?? {}),
              ...(trTitle?.[l] !== undefined ? { title: trTitle[l] } : {}),
              ...(trDesc?.[l]  !== undefined ? { description: trDesc[l]  } : {}),
            }
          }
          return { ...tip, translations: trans }
        }),
      }))

      newContent.components = content.components.map((c, i) => {
        const trName = translations[`comp_${i}_name`]
        const trDesc = translations[`comp_${i}_desc`]
        const trans: Record<string, CompTranslation> = { ...(c.translations ?? {}) }
        for (const l of ['he', 'ar', 'es'] as const) {
          trans[l] = {
            ...(trans[l] ?? {}),
            ...(trName?.[l] !== undefined ? { name: trName[l] }        : {}),
            ...(trDesc?.[l] !== undefined ? { description: trDesc[l] } : {}),
          }
        }
        return { ...c, translations: trans }
      })

      const trCardTitle    = translations['card_title']
      const trCardSubtitle = translations['card_subtitle']
      if (trCardTitle) {
        newContent.tipsCardTitleTranslations = { ...(newContent.tipsCardTitleTranslations ?? {}) }
        for (const l of ['he', 'ar', 'es'] as const) {
          if (trCardTitle[l]) newContent.tipsCardTitleTranslations![l] = trCardTitle[l]
        }
      }
      if (trCardSubtitle) {
        newContent.tipsCardSubtitleTranslations = { ...(newContent.tipsCardSubtitleTranslations ?? {}) }
        for (const l of ['he', 'ar', 'es'] as const) {
          if (trCardSubtitle[l]) newContent.tipsCardSubtitleTranslations![l] = trCardSubtitle[l]
        }
      }

      setContent(newContent)
      setLang('he')
    } catch {
      setTranslateError('Translation failed — check your connection and try again.')
    } finally {
      setTranslating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={28} className="animate-spin text-primary" />
      </div>
    )
  }

  if (!content) return null

  const langMeta = LANGS.find(l => l.code === lang)!

  return (
    <div className="flex flex-col h-full">
      {loadError && (
        <div className="mx-5 mt-5 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
          <span>Failed to load content.</span>
          <button type="button" onClick={load} className="ml-auto flex items-center gap-1 text-xs font-semibold hover:underline">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Language toolbar */}
      <div className="px-5 py-3 flex items-center justify-between gap-4 border-b border-gray-100 bg-white shrink-0">
        <LangTabs active={lang} onChange={setLang} />
        {lang === 'en' && (
          <button
            type="button"
            onClick={() => void handleTranslateAll()}
            disabled={translating}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition-colors shrink-0"
          >
            {translating ? <Loader2 size={12} className="animate-spin" /> : <span>🌐</span>}
            {translating ? 'Translating…' : 'Translate All'}
          </button>
        )}
      </div>

      {lang !== 'en' && (
        <div className="mx-5 mt-4 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 shrink-0">
          {langMeta.flag} Editing <strong>{langMeta.label}</strong> translations — empty fields fall back to English.
        </div>
      )}
      {translateError && (
        <div className="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 shrink-0">{translateError}</div>
      )}
      {openFormWarning && (
        <div className="mx-5 mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 shrink-0">
          You have an unsaved component form. It will be included automatically when you save.
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 pb-0">
        <TipsChainSection
          ref={tipsChainRef}
          content={content} onChange={setContent} lang={lang} packageId={packageId}
          onPushToAll={packageId !== 'all_packages' ? () => pushSectionToAllPackages('tips') : undefined}
          isPushingToAll={pushingSection === 'tips'}
          pushSuccess={pushSuccessSection === 'tips'}
        />
        <ComponentsSection
          ref={componentsSectionRef}
          content={content} onChange={setContent} lang={lang}
          onPushToAll={packageId !== 'all_packages' ? () => pushSectionToAllPackages('components') : undefined}
          isPushingToAll={pushingSection === 'components'}
          pushSuccess={pushSuccessSection === 'components'}
        />
      </div>

      {/* Sticky save bar */}
      <div className="px-5 py-4 bg-white border-t border-gray-100 flex items-center justify-end gap-3">
        <span aria-live="polite" className="min-w-0 text-sm font-semibold">
          {saved
            ? <span className="flex items-center gap-1.5 text-emerald-600"><Check size={14} /> Saved successfully</span>
            : saveError
              ? <span className="text-red-500">Failed to save — try again</span>
              : <span aria-hidden="true" className="text-transparent">Save status</span>}
        </span>
        <button
          type="button"
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

        <nav className="flex-1 p-3 space-y-1">
          {PACKAGES.map(pkg => {
            const Icon = pkg.icon
            const isActive = activeTab === pkg.id
            return (
              <button
                key={pkg.id}
                type="button"
                onClick={() => setActiveTab(pkg.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                  isActive ? `${pkg.activeBg} text-white shadow-sm` : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-white' : pkg.color} />
                <span className="text-sm font-semibold">{pkg.label}</span>
              </button>
            )
          })}
        </nav>

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
        <div className="bg-white border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${active.bg}`}>
              <active.icon size={18} className={active.color} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-800">{active.label}</h2>
              <p className="text-xs text-gray-500">
                {active.id === 'all_packages'
                  ? t('תוכן משותף לכל החבילות', 'Content shared across all packages')
                  : t('ניהול טיפים, עדכונים ורכיבים', 'Manage tips, updates & components')}
              </p>
            </div>
          </div>
        </div>

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
