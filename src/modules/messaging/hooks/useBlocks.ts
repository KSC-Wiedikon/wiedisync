import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAllItems } from '../../../lib/api'
import { messagingApi } from '../api/messaging'
import type { BlockRow } from '../api/types'
import { useRealtime } from '../../../hooks/useRealtime'
import { useAuth } from '../../../hooks/useAuth'
import { messagingFeatureEnabled } from '../../../utils/messagingFeatureFlag'

/**
 * Outgoing blocks owned by the current caller.
 * Incoming blocks (members who have blocked ME) are enforced server-side on
 * every endpoint — the frontend doesn't need to know them for UI decisions.
 */
export function useBlocks() {
  const { user } = useAuth()
  const userId = user?.id
  const enabled = messagingFeatureEnabled(userId) && !!userId
  const [rows, setRows] = useState<BlockRow[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // The network path only. `.catch()`/`.finally()` instead of try/catch/finally
  // so no setState is synchronously reachable from the effect that calls this.
  const load = useCallback(async () => {
    if (!enabled || !userId) return
    await (async () => {
      const data = await fetchAllItems<BlockRow>('blocks', {
        filter: { blocker: { _eq: userId } },
        fields: ['id', 'blocker', 'blocked', 'created_at'],
      })
      setRows(data)
    })()
      .catch(() => { /* RBAC / network — treat as empty */ })
      .finally(() => { setIsLoading(false) })
  }, [enabled, userId])

  // The synchronous prologue that used to open `refetch` (clear when signed
  // out / feature off, spinner on otherwise), moved to React's
  // adjust-state-during-render pattern. `prevKey` starts as null so it also runs
  // on the first render — matching the mount run of the effect it replaces.
  const key = `${enabled}|${userId ?? ''}`
  const [prevKey, setPrevKey] = useState<string | null>(null)
  if (prevKey !== key) {
    setPrevKey(key)
    if (!enabled || !userId) setRows([])
    else setIsLoading(true)
  }

  useEffect(() => { load() }, [load])

  // Public refetch — keeps the original semantics for the manual/event paths.
  const refetch = useCallback(async () => {
    if (!enabled || !userId) { setRows([]); return }
    setIsLoading(true)
    await load()
  }, [enabled, userId, load])

  // `userId` read straight from the closure: useRealtime always invokes the
  // latest callback, so this is exactly as fresh as the old render-written ref.
  useRealtime<BlockRow>('blocks', (e) => {
    if (!userId) return
    if (String(e.record.blocker) !== String(userId)) return
    if (e.action === 'create') {
      setRows(prev => prev.some(r => r.id === e.record.id) ? prev : [...prev, e.record])
    } else if (e.action === 'delete') {
      setRows(prev => prev.filter(r => r.id !== e.record.id))
    }
  }, undefined, !enabled)

  const block = useCallback(async (memberId: string) => {
    if (!enabled) return
    await messagingApi.block({ member: memberId })
    await refetch()   // belt-and-suspenders: covers cases where realtime lags
  }, [enabled, refetch])

  const unblock = useCallback(async (memberId: string) => {
    if (!enabled) return
    await messagingApi.unblock(memberId)
    await refetch()
  }, [enabled, refetch])

  const blockedMemberIds = useMemo(() => rows.map(r => String(r.blocked)), [rows])
  const blockedSet = useMemo(() => new Set(blockedMemberIds), [blockedMemberIds])

  return { blockedMemberIds, blockedSet, block, unblock, isLoading, refetch }
}
