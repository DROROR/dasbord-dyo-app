import { createContext, useCallback, useContext, useState } from 'react'
import type { AppNotification, NotificationType } from '../types/work'

type AddPayload = {
  type: NotificationType
  message: string
  taskId?: string
  taskTitle?: string
  severity?: 'normal' | 'high'
  waDetails?: { clientName: string; message: string }
}

interface NotificationCtx {
  notifications: AppNotification[]
  unreadCount: number
  addNotification: (n: AddPayload) => void
  markRead: (id: string) => void
  markAllRead: () => void
}

const Ctx = createContext<NotificationCtx | null>(null)

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  const addNotification = useCallback((n: AddPayload) => {
    const entry: AppNotification = {
      id: Math.random().toString(36).slice(2),
      type: n.type,
      message: n.message,
      taskId: n.taskId,
      taskTitle: n.taskTitle,
      timestamp: new Date().toISOString(),
      read: false,
      severity: n.severity ?? 'normal',
      waDetails: n.waDetails,
    }
    setNotifications(prev => [entry, ...prev])
  }, [])

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <Ctx.Provider value={{ notifications, unreadCount, addNotification, markRead, markAllRead }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications must be inside NotificationProvider')
  return ctx
}
