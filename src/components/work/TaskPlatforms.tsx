import type { TaskPlatform } from '../../types/work'

const TASK_PLATFORM_OPTIONS: { id: TaskPlatform; label: string; cls: string }[] = [
  { id: 'admin', label: 'Admin', cls: 'bg-pink-600 text-white border-pink-700 shadow-sm shadow-pink-300' },
  { id: 'website', label: 'Website', cls: 'bg-emerald-600 text-white border-emerald-700 shadow-sm shadow-emerald-300' },
  { id: 'mobile_app', label: 'Mobile App', cls: 'bg-blue-600 text-white border-blue-700 shadow-sm shadow-blue-300' },
  { id: 'super_admin', label: 'Super Admin', cls: 'bg-orange-600 text-white border-orange-700 shadow-sm shadow-orange-300' },
]

export function TaskPlatformBadges({ platforms = [] }: { platforms?: TaskPlatform[] }) {
  if (!platforms.length) return null
  return <div className="flex flex-wrap gap-1">{platforms.map(id => {
    const option = TASK_PLATFORM_OPTIONS.find(item => item.id === id)
    return option ? <span key={id} className={`rounded-md border px-2.5 py-1 text-[10px] font-extrabold tracking-wide ${option.cls}`}>{option.label}</span> : null
  })}</div>
}

export function TaskPlatformPicker({ value = [], onChange, disabled = false }: { value?: TaskPlatform[]; onChange: (value: TaskPlatform[]) => void; disabled?: boolean }) {
  return <div className="flex flex-wrap gap-1.5">{TASK_PLATFORM_OPTIONS.map(option => {
    const selected = value.includes(option.id)
    return <button key={option.id} type="button" disabled={disabled} onClick={() => onChange(selected ? value.filter(id => id !== option.id) : [...value, option.id])}
      className={`rounded-lg border px-3 py-2 text-[11px] font-extrabold transition-all disabled:cursor-default ${selected ? option.cls : 'border-gray-300 bg-white text-gray-600 hover:border-gray-500'}`}
      aria-pressed={selected}>{option.label}</button>
  })}</div>
}
