import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchAllItems } from '../../../lib/api'
import { messagingApi } from '../api/messaging'
import type { MessageRequestRow } from '../api/types'
import { useRealtime } from '../../../hooks/useRealtime'
import { useAuth } from '../../../hooks/useAuth'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'

export function useMessageRequests() {
  const { user } = useAuth()
  // Read out of `user` up-front: a `user?.id` dependency infers as `user` and
  // trips the compiler's manual-memoization check.
  const userId = user?.id
  const enabled = messagingFeatureEnabled(userId) && !!userId
  const [requests, setRequests] = useState<MessageRequestRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  // "Latest value" ref for the realtime callback below. Written in an effect
  // rather than during render; the callback only ever reads it asynchronously.
  const meRef = useRef<string | null>(userId ?? null)
  useEffect(() => { meRef.current = userId ?? null }, [userId])

  // The request itself. Every state write lives in a promise callback, so this
  // is safe to call straight from an effect.
  const load = useCallback((uid: string) => {
    return fetchAllItems<MessageRequestRow>('message_requests', {
      filter: { _and: [{ recipient: { _eq: uid } }, { status: { _eq: 'pending' } }] },
      fields: ['id', 'conversation', 'sender', 'recipient', 'status', 'created_at', 'resolved_at'],
      sort: ['-created_at'],
    }).then(
      (data) => {
        setRequests(data)
        setIsLoading(false)
      },
      () => { /* ignore */ setIsLoading(false) },
    )
  }, [])

  // Manual refetch — unchanged semantics.
  const refetch = useCallback(async () => {
    if (!enabled || !userId) { setRequests([]); return }
    setIsLoading(true)
    await load(userId)
  }, [enabled, userId, load])

  // User-driven load. The "clear list" / "raise loading" half of the old effect
  // is applied during render, so the effect body writes no state synchronously.
  // `prevFetchKey` starts as `null` (never a valid key) so this also fires on
  // the first render — mirroring the old effect's mount run.
  const fetchKey = enabled && userId ? String(userId) : ''
  const [prevFetchKey, setPrevFetchKey] = useState<string | null>(null)
  if (prevFetchKey !== fetchKey) {
    setPrevFetchKey(fetchKey)
    if (fetchKey) setIsLoading(true)
    else setRequests([])
  }
  useEffect(() => {
    if (!fetchKey) return
    void load(fetchKey)
  }, [fetchKey, load])

  useRealtime<MessageRequestRow>('message_requests', (e) => {
    const me = meRef.current
    if (!me) return
    const rec = e.record
    if (e.action === 'create' && String(rec.recipient) === String(me) && rec.status === 'pending') {
      setRequests(prev => prev.some(r => r.id === rec.id) ? prev : [rec, ...prev])
    }
    if (e.action === 'update' && String(rec.recipient) === String(me) && rec.status !== 'pending') {
      setRequests(prev => prev.filter(r => r.id !== rec.id))
    }
  }, undefined, !enabled)

  const accept = useCallback(async (requestId: string) => {
    await messagingApi.acceptRequest(requestId)
    setRequests(prev => prev.filter(r => r.id !== requestId))
  }, [])

  const decline = useCallback(async (requestId: string) => {
    await messagingApi.declineRequest(requestId)
    setRequests(prev => prev.filter(r => r.id !== requestId))
  }, [])

  return { requests, accept, decline, isLoading, refetch }
}
