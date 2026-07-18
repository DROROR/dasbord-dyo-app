import { useEffect, useState } from 'react'
import {
  GraduationCap,
  Save,
  Plus,
  Trash2,
  Loader2,
  BookOpen,
  Check,
} from 'lucide-react'
import {
  getBotConfig,
  updateBotConfig,
  getBotTraining,
  addBotTraining,
  updateBotTraining,
  deleteBotTraining,
} from '../lib/database'
import type { DbBotConfig, DbBotTraining } from '../lib/database'

type BotId = 'support' | 'sales'

const BOTS: { id: BotId; label: string }[] = [
  { id: 'support', label: 'בוט תמיכה' },
  { id: 'sales', label: 'בוט מכירות' },
]

const KINDS: { id: DbBotTraining['kind']; label: string; badge: string }[] = [
  { id: 'rule', label: 'כלל', badge: 'bg-primary/10 text-primary' },
  { id: 'example', label: 'דוגמה', badge: 'bg-green-100 text-green-700' },
  { id: 'avoid', label: 'להימנע', badge: 'bg-red-100 text-red-700' },
]

const kindMeta = (k: string) => KINDS.find(x => x.id === k) ?? KINDS[0]

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface rounded-2xl border border-gray-100 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

export function BotTraining() {
  const [bot, setBot] = useState<BotId>('support')
  const [config, setConfig] = useState<DbBotConfig | null>(null)
  const [prompt, setPrompt] = useState('')
  const [items, setItems] = useState<DbBotTraining[]>([])
  const [loading, setLoading] = useState(true)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [promptSaved, setPromptSaved] = useState(false)

  // new item form
  const [newKind, setNewKind] = useState<DbBotTraining['kind']>('rule')
  const [newSituation, setNewSituation] = useState('')
  const [newContent, setNewContent] = useState('')
  const [adding, setAdding] = useState(false)

  async function load(b: BotId) {
    setLoading(true)
    const [cfg, list] = await Promise.all([getBotConfig(b), getBotTraining(b).catch(() => [])])
    setConfig(cfg)
    setPrompt(cfg?.base_prompt ?? '')
    setItems(list)
    setLoading(false)
  }

  useEffect(() => {
    load(bot)
  }, [bot])

  async function savePrompt() {
    setSavingPrompt(true)
    const { error } = await updateBotConfig(bot, { base_prompt: prompt })
    setSavingPrompt(false)
    if (!error) {
      setPromptSaved(true)
      setTimeout(() => setPromptSaved(false), 2000)
    }
  }

  async function addItem() {
    if (!newContent.trim()) return
    setAdding(true)
    const { error } = await addBotTraining({
      bot,
      kind: newKind,
      situation: newSituation.trim() || null,
      content: newContent.trim(),
      active: true,
    })
    setAdding(false)
    if (!error) {
      setNewSituation('')
      setNewContent('')
      setNewKind('rule')
      load(bot)
    }
  }

  async function toggle(item: DbBotTraining) {
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, active: !i.active } : i)))
    await updateBotTraining(item.id, { active: !item.active })
  }

  async function remove(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
    await deleteBotTraining(id)
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <GraduationCap size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-primary">אימון בוטים</h1>
          <p className="text-xs text-gray-500">מלמדים את הבוט מה לומר ואיך להתנהג. שינויים נכנסים לתוקף מיד.</p>
        </div>
      </div>

      {/* Bot switcher */}
      <div className="flex gap-2">
        {BOTS.map(b => (
          <button
            key={b.id}
            onClick={() => setBot(b.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              bot === b.id ? 'bg-primary text-white' : 'bg-surface border border-gray-100 text-gray-600 hover:border-primary/30'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-primary animate-spin" />
        </div>
      ) : (
        <>
          {/* Base knowledge */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={16} className="text-primary" />
              <h2 className="text-sm font-semibold text-primary">ידע בסיס (חוקי האפליקציה)</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              זהו הידע הראשי של הבוט. הדביקו כאן את קובץ הכללים של האפליקציה. הבוט מסתמך על זה בכל תשובה.
            </p>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={10}
              dir="auto"
              placeholder="הדביקו כאן את חוקי האפליקציה (קובץ ה-MD)..."
              className="w-full text-sm border border-gray-200 rounded-xl p-3 focus:outline-none focus:border-primary/50 resize-y font-mono"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-gray-400">
                {config ? `מודל: ${config.model}` : ''}
              </span>
              <button
                onClick={savePrompt}
                disabled={savingPrompt}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
              >
                {savingPrompt ? <Loader2 size={14} className="animate-spin" /> : promptSaved ? <Check size={14} /> : <Save size={14} />}
                {promptSaved ? 'נשמר' : 'שמור ידע בסיס'}
              </button>
            </div>
          </Card>

          {/* Add training item */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-primary mb-3">הוספת הנחיה חדשה</h2>
            <div className="space-y-3">
              <div className="flex gap-2">
                {KINDS.map(k => (
                  <button
                    key={k.id}
                    onClick={() => setNewKind(k.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      newKind === k.id ? k.badge + ' ring-1 ring-current' : 'bg-gray-50 text-gray-500'
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <input
                value={newSituation}
                onChange={e => setNewSituation(e.target.value)}
                dir="auto"
                placeholder="מתי זה חל? (למשל: לקוח שואל על החזר כספי) — אופציונלי"
                className="w-full text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:border-primary/50"
              />
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                rows={2}
                dir="auto"
                placeholder="מה הבוט צריך לומר או לעשות"
                className="w-full text-sm border border-gray-200 rounded-lg p-2.5 focus:outline-none focus:border-primary/50 resize-y"
              />
              <button
                onClick={addItem}
                disabled={adding || !newContent.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium hover:bg-secondary/90 disabled:opacity-50"
              >
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                הוסף
              </button>
            </div>
          </Card>

          {/* Training items list */}
          <div>
            <h2 className="text-sm font-semibold text-primary mb-3">
              הנחיות ({items.length})
            </h2>
            {items.length === 0 ? (
              <Card className="p-8 text-center text-sm text-gray-400">אין הנחיות עדיין. הוסיפו את הראשונה למעלה.</Card>
            ) : (
              <div className="space-y-2">
                {items.map(item => {
                  const km = kindMeta(item.kind)
                  return (
                    <Card key={item.id} className={`p-4 ${item.active ? '' : 'opacity-50'}`}>
                      <div className="flex items-start gap-3">
                        <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${km.badge}`}>
                          {km.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          {item.situation && (
                            <p className="text-xs text-gray-400 mb-0.5">{item.situation}</p>
                          )}
                          <p className="text-sm text-gray-800">{item.content}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => toggle(item)}
                            title={item.active ? 'פעיל' : 'כבוי'}
                            className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors ${
                              item.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {item.active ? 'פעיל' : 'כבוי'}
                          </button>
                          <button
                            onClick={() => remove(item.id)}
                            title="מחק"
                            className="p-1.5 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
