import { useLang } from './LanguageContext'

export type WorkLang = 'en' | 'he'
export function WorkLanguageProvider({ children }: { children: React.ReactNode }) {
  return children
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkLang() {
  return useLang()
}
