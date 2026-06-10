import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchItems, updateRecord, deleteRecord } from '../lib/api'
import { useAuth } from './useAuth'
import { useRealtime } from './useRealtime'
import type { Notification } from '../types'

export function useNotifications() {
  const { user, isLoading: authLoading } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const userIdRef = useRef(user?.id)
  userIdRef.current = user?.id
  // Captured per-fetch (not per-render) so an out-of-order response from a
  // previous user — e.g. logout→login or a token refresh firing two fetches —
  // can't commit the wrong user's notifications.
  const latestUserRef = useRef<string | undefined>(user?.id)

  const fetchNotifications = useCallback(async () => {
    if (authLoading || !user?.id) {
      setNotifications([])
      setUnreadCount(0)
      setIsLoading(false)
      return
    }
    const uid = user.id
    latestUserRef.current = uid
    try {
      const result = await fetchItems<Notification>('notifications', {
        filter: { member: { _eq: user.id } },
        sort: ['-date_created'],
        limit: 30,
      })
      if (latestUserRef.current !== uid) return
      setNotifications(result)
      setUnreadCount(result.filter((n: Notification) => !n.read).length)
    } catch {
      // silently fail
    } finally {
      if (latestUserRef.current === uid) setIsLoading(false)
    }
  }, [authLoading, user?.id])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  // Listen for new notifications in realtime — skip if auth still loading
  useRealtime<Notification>('notifications', (e) => {
    if (e.record.member !== userIdRef.current) return
    if (e.action === 'create') {
      setNotifications((prev) => [e.record, ...prev].slice(0, 30))
      setUnreadCount((c) => c + 1)
    } else if (e.action === 'update') {
      setNotifications((prev) => prev.map((n) => (n.id === e.record.id ? e.record : n)))
      // Recalculate unread
      setNotifications((prev) => {
        setUnreadCount(prev.filter((n) => !n.read).length)
        return prev
      })
    } else if (e.action === 'delete') {
      setNotifications((prev) => prev.filter((n) => n.id !== e.record.id))
      setUnreadCount((c) => Math.max(0, c - 1))
    }
  }, undefined, authLoading || !user?.id)

  const markAsRead = useCallback(async (id: string) => {
    try {
      await updateRecord('notifications', id, { read: true })
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setUnreadCount((c) => Math.max(0, c - 1))
    } catch {
      // silently fail
    }
  }, [])

  const markAllAsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read)
    try {
      await Promise.all(unread.map((n) => updateRecord('notifications', n.id, { read: true })))
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch {
      // silently fail
    }
  }, [notifications])

  const deleteNotification = useCallback(async (id: string) => {
    // Optimistic: remove first, roll back on failure
    const prev = notifications
    const target = prev.find((n) => n.id === id)
    setNotifications((list) => list.filter((n) => n.id !== id))
    if (target && !target.read) setUnreadCount((c) => Math.max(0, c - 1))
    try {
      await deleteRecord('notifications', id)
    } catch {
      setNotifications(prev)
      if (target && !target.read) setUnreadCount((c) => c + 1)
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
