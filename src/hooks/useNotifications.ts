import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { fetchItems, updateRecord, deleteRecord } from '../lib/api'
import { useAuth } from './useAuth'
import { useRealtime } from './useRealtime'
import type { Notification } from '../types'

export function useNotifications() {
  const { user, isLoading: authLoading } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  // Derived from `notifications` (the single source of truth) rather than tracked
  // as separate state — avoids the side-effect-in-updater fragility and keeps the
  // count in sync no matter which mutation path changed the list.
  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications])
  const [isLoading, setIsLoading] = useState(true)
  const userId = user?.id
  // Captured per-fetch (not per-render) so an out-of-order response from a
  // previous user — e.g. logout→login or a token refresh firing two fetches —
  // can't commit the wrong user's notifications.
  const latestUserRef = useRef<string | undefined>(user?.id)

  // The network path only. `.catch()`/`.finally()` instead of try/catch/finally
  // so no setState is synchronously reachable from the effect that calls this.
  const loadNotifications = useCallback(async () => {
    if (authLoading || !userId) return
    const uid = userId
    latestUserRef.current = uid
    await (async () => {
      const result = await fetchItems<Notification>('notifications', {
        filter: { member: { _eq: uid } },
        sort: ['-date_created'],
        limit: 30,
      })
      if (latestUserRef.current !== uid) return
      setNotifications(result)
    })()
      .catch(() => {
        // silently fail
      })
      .finally(() => {
        if (latestUserRef.current === uid) setIsLoading(false)
      })
  }, [authLoading, userId])

  // The synchronous "no user / still authenticating → empty + not loading"
  // branch that used to open `fetchNotifications`. Reproduced with React's
  // adjust-state-during-render pattern; `prevAuthKey` starts as null so it also
  // runs on the first render, matching the mount run of the effect it replaces.
  const authKey = `${authLoading}|${userId ?? ''}`
  const [prevAuthKey, setPrevAuthKey] = useState<string | null>(null)
  if (prevAuthKey !== authKey) {
    setPrevAuthKey(authKey)
    if (authLoading || !userId) {
      setNotifications([])
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()
  }, [loadNotifications])

  // Public refetch — keeps the original semantics (clears when signed out).
  const fetchNotifications = useCallback(async () => {
    if (authLoading || !userId) {
      setNotifications([])
      setIsLoading(false)
      return
    }
    await loadNotifications()
  }, [authLoading, userId, loadNotifications])

  // Listen for new notifications in realtime — skip if auth still loading.
  // `userId` is read straight from the closure: useRealtime keeps the latest
  // callback, so this is exactly as fresh as the old render-written ref was.
  useRealtime<Notification>('notifications', (e) => {
    if (e.record.member !== userId) return
    if (e.action === 'create') {
      setNotifications((prev) => [e.record, ...prev].slice(0, 30))
    } else if (e.action === 'update') {
      setNotifications((prev) => prev.map((n) => (n.id === e.record.id ? e.record : n)))
    } else if (e.action === 'delete') {
      setNotifications((prev) => prev.filter((n) => n.id !== e.record.id))
    }
  }, undefined, authLoading || !user?.id)

  const markAsRead = useCallback(async (id: string) => {
    try {
      await updateRecord('notifications', id, { read: true })
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    } catch {
      // silently fail (error already reported by updateRecord → captureApiError)
    }
  }, [])

  const markAllAsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read)
    if (unread.length === 0) return
    // allSettled + reconcile: a partial failure must leave the failed rows unread
    // instead of flipping the whole UI to "all read" on the first rejection.
    const results = await Promise.allSettled(
      unread.map((n) => updateRecord('notifications', n.id, { read: true })),
    )
    const succeeded = new Set(
      unread.filter((_, i) => results[i]?.status === 'fulfilled').map((n) => n.id),
    )
    if (succeeded.size > 0) {
      setNotifications((prev) => prev.map((n) => (succeeded.has(n.id) ? { ...n, read: true } : n)))
    }
  }, [notifications])

  const deleteNotification = useCallback(async (id: string) => {
    // Optimistic: remove first, roll back on failure
    const prev = notifications
    setNotifications((list) => list.filter((n) => n.id !== id))
    try {
      await deleteRecord('notifications', id)
    } catch {
      setNotifications(prev)
    }
  }, [notifications])

  const clearAllRead = useCallback(async () => {
    const read = notifications.filter((n) => n.read)
    if (read.length === 0) return
    const prev = notifications
    setNotifications((list) => list.filter((n) => !n.read))
    try {
      await Promise.all(read.map((n) => deleteRecord('notifications', n.id)))
    } catch {
      setNotifications(prev)
    }
  }, [notifications])

  return { notifications, unreadCount, isLoading, markAsRead, markAllAsRead, deleteNotification, clearAllRead, refetch: fetchNotifications }
}
