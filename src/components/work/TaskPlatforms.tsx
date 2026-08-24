import type { TaskPlatform } from '../../types/work'

const TASK_PLATFORM_OPTIONS: { id: TaskPlatform; label: string; cls: string }[] = [
  { id: 'admin', label: 'Admin', cls: 'bg-pink-800 text-white border-pink-900' },
  { id: 'website', label: 'Website', cls: 'bg-emerald-800 text-white border-emerald-900' },
  { id: 'mobile_app', label: 'Mobile App', cls: 'bg-blue-800 text-white border-blue-900' },
  { id: 'super_admin', label: 'Super Admin', cls: 'bg-orange-800 text-white border-orange-900' },
]

export function TaskPlatformBadges({ platforms = [] }: { platforms?: TaskPlatform[] }) {
  if (!platforms.length) return null
  return <div className="flex flex-wrap gap-1">{platforms.map(id => {
    const option = TASK_PLATFORM_OPTIONS.find(item => item.id === id)
    return option ? <span key={id} className={`rounded-md border px-2 py-0.5 text-[9px] font-bold tracking-wide ${option.cls}`}>{option.label}</span> : null
  })}</div>
}

export function TaskPlatformPicker({ value = [], onChange, disabled = false }: { value?: TaskPlatform[]; onChange: (value: TaskPlatform[]) => void; disabled?: boolean }) {
  return <div className="flex flex-wrap gap-1.5">{TASK_PLATFORM_OPTIONS.map(option => {
    const selected = value.includes(option.id)
    return <button key={option.id} type="button" disabled={disabled} onClick={() => onChange(selected ? value.filter(id => id !== option.id) : [...value, option.id])}
      className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition-all disabled:cursor-default ${selected ? option.cls : 'border-gray-200 bg-white text-gray-500 hover:border-gray-400'}`}
      aria-pressed={selected}>{option.label}</button>
  })}</div>
}
