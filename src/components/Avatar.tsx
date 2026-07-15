const AVATAR_CLR: Record<string, string> = {
  Fahad:     'bg-[#1F3272] text-white',
  Alexander: 'bg-[#6ECFCA] text-[#1F3272]',
  Dana:      'bg-pink-500 text-white',
  Roi:       'bg-purple-500 text-white',
  Dror:      'bg-[#FF7F50] text-white',
}

export function Avatar({ name, size = 'sm' }: { name: string; size?: 'xs' | 'sm' | 'md' }) {
  const sz    = size === 'xs' ? 'w-5 h-5 text-[9px]' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-6 h-6 text-[10px]'
  const color = AVATAR_CLR[name] ?? 'bg-gray-400 text-white'
  return (
    <div className={`${sz} ${color} rounded-full flex items-center justify-center font-bold shrink-0 select-none`}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  )
}
