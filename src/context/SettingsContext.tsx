import { createContext, useContext, useState, type ReactNode } from 'react'
import { DEFAULTS, type AppSettings } from '../config/defaults'

interface SettingsContextType {
  settings: AppSettings
  updateSettings: (s: AppSettings) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

const STORAGE_KEY = 'admin-platform-settings'

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  const updateSettings = (s: AppSettings) => {
    setSettings(s)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
