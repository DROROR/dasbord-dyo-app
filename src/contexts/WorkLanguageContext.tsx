import { createContext, useContext, useEffect, useState } from 'react'

export type WorkLang = 'en' | 'he'
const KEY = 'workLang'

interface WorkLanguageValue {
  lang: WorkLang
  dir: 'rtl' | 'ltr'
  setLang: (l: WorkLang) => void
  toggle: () => void
  /** Pick the right string for the current language. t('שלום', 'Hello') */
  t: (he: string, en: string) => string
}

const Ctx = createContext<WorkLanguageValue | null>(null)

function initialWorkLang(): WorkLang {
  try {
    const s = localStorage.getItem(KEY)
    if (s === 'en' || s === 'he') return s
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  return 'en'
}

export function WorkLanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<WorkLang>(initialWorkLang)
  const dir: 'rtl' | 'ltr' = lang === 'he' ? 'rtl' : 'ltr'

  useEffect(() => {
    try {
      localStorage.setItem(KEY, lang)
    } catch {
      // Language preference remains in memory when persistence is unavailable.
    }
  }, [lang, dir])

  const value: WorkLanguageValue = {
    lang,
    dir,
    setLang: setLangState,
    toggle: () => setLangState(p => (p === 'he' ? 'en' : 'he')),
    t: (he, en) => (lang === 'he' ? he : en),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkLang() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWorkLang must be used within WorkLanguageProvider')
  return c
}
