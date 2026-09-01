import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { AppNotification, NotificationType } from '../types/work'
import {
  getNotifications,
  createNotification,
  markNotificationRead,
  markAllNotificationsRead,
} from '../lib/database'

type AddPayload = {
  type: NotificationType
  message: string
  taskId?: string
  taskTitle?: string
  recipientId?: string
  subtaskId?: string
  severity?: 'normal' | 'high'
  waDetails?: { clientName: string; message: string }
  /** Set on recurring scan alerts so the same alert is only raised once. */
  dedupeKey?: string
}

interface NotificationCtx {
  notifications: AppNotification[]
  unreadCount: number
  addNotification: (n: AddPayload) => void
  markRead: (id: string) => void
  markAllRead: () => void
  browserPermission: NotificationPermission | 'unsupported'
  enableBrowserNotifications: () => Promise<void>
}

const Ctx = createContext<NotificationCtx | null>(null)

/** How often to pick up notifications raised outside this browser (n8n). */
const POLL_MS = 30_000

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const pending = useRef(false)
  const knownIds = useRef<Set<string> | null>(null)

  const refresh = useCallback(async () => {
    if (pending.current) return
    pending.current = true
    try {
      const fresh = await getNotifications()
      if (knownIds.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        fresh.filter(n => !n.read && !knownIds.current!.has(n.id)).forEach(n => {
          const notification = new Notification(n.taskTitle || 'Dyo Planner', { body: n.message, icon: '/pwa-192.png', tag: n.id })
          notification.onclick = () => { window.focus(); if (n.taskId) window.location.hash = `work/task/${n.taskId}`; notification.close() }
        })
      }
      knownIds.current = new Set(fresh.map(n => n.id))
      setNotifications(fresh)
    } catch (err) {
      console.warn('Notification refresh failed:', err)
    } finally {
      pending.current = false
    }
  }, [])

  // Load once, then poll so support-bot escalations appear without a reload.
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const addNotification = useCallback((n: AddPayload) => {
    createNotification(n)
      .then(created => {
        // A deduped alert that already exists returns null — nothing to add.
        if (created) setNotifications(prev => [created, ...prev])
      })
      .catch(err => console.warn('Notification save failed:', err))
  }, [])

  const markRead = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    markNotificationRead(id).catch(err => console.warn('Mark read failed:', err))
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    markAllNotificationsRead().catch(err => console.warn('Mark all read failed:', err))
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  const enableBrowserNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    setBrowserPermission(await Notification.requestPermission())
  }, [])

  // Installed PWAs can surface the personal unread count directly on the app
  // icon. Unsupported browsers simply keep the in-app bell badge.
  useEffect(() => {
    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    const request = unreadCount > 0
      ? badgeNavigator.setAppBadge?.(unreadCount)
      : badgeNavigator.clearAppBadge?.()
    request?.catch(() => {})
  }, [unreadCount])

  return (
    <Ctx.Provider value={{ notifications, unreadCount, addNotification, markRead, markAllRead, browserPermission, enableBrowserNotifications }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications must be inside NotificationProvider')
  return ctx
}
