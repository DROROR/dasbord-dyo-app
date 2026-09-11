import { createContext, useContext, useEffect, useState } from 'react'

type Lang = 'he' | 'en'
const KEY = 'appLang'

interface LangCtx {
  lang: Lang
  dir: 'rtl' | 'ltr'
  setLang: (l: Lang) => void
  toggle: () => void
  /** Pick the right string for the current language. t('שלום', 'Hello') */
  t: (he: string, en: string) => string
}

const Ctx = createContext<LangCtx | null>(null)

function initialLang(): Lang {
  try {
    const s = localStorage.getItem(KEY)
    if (s === 'en' || s === 'he') return s
    // Preserve the language selected by users before the app-wide language switch.
    const legacyWorkLang = localStorage.getItem('workLang')
    if (legacyWorkLang === 'en' || legacyWorkLang === 'he') return legacyWorkLang
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  return 'he'
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  const dir: 'rtl' | 'ltr' = lang === 'he' ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    try {
      localStorage.setItem(KEY, lang)
      localStorage.setItem('workLang', lang)
    } catch {
      // Language preference remains in memory when persistence is unavailable.
    }
  }, [lang, dir])

  const value: LangCtx = {
    lang,
    dir,
    setLang: setLangState,
    toggle: () => setLangState(p => (p === 'he' ? 'en' : 'he')),
    t: (he, en) => (lang === 'he' ? he : en),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useLang() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useLang must be used within LanguageProvider')
  return c
}
