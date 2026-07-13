import { useCallback, useEffect, useMemo, useState } from 'react'
import { messagingApi } from '../api/messaging'
import type { ReportRow } from '../api/types'
import { useRealtime } from '../../../hooks/useRealtime'
import { useAuth } from '../../../hooks/useAuth'

export function useReports() {
  const { user, isAdmin } = useAuth()
  const enabled = !!user?.id && isAdmin
  const [reports, setReports] = useState<ReportRow[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Prime the state for the auto-load below during render instead of inside the
  // effect (react-hooks/set-state-in-effect). `enabled` is the effect's only
  // trigger, so this fires on exactly the same transitions — including mount
  // (`null` seed) — and lands the same committed state one render earlier.
  const [primedFor, setPrimedFor] = useState<boolean | null>(null)
  if (primedFor !== enabled) {
    setPrimedFor(enabled)
    if (!enabled) setReports([])
    else setIsLoading(true)
  }

  // Effect-facing loader: no synchronous setState — `isLoading` is primed above
  // and every write lives inside a `.then` callback. Errors stay swallowed and
  // `isLoading` always clears, exactly like the old try/catch/finally.
  const load = useCallback(() => {
    if (!enabled) return Promise.resolve()
    return messagingApi.listReports().then(
      ({ reports }) => { setReports(reports); setIsLoading(false) },
      () => { setIsLoading(false) },
    )
  }, [enabled])

  // Manual refetch — invoked from event handlers and the realtime callback, where
  // the eager reset + spinner is fine. Same body the old refetch() had.
  const refetch = useCallback(async () => {
    if (!enabled) { setReports([]); return }
    setIsLoading(true)
    await load()
  }, [enabled, load])

  useEffect(() => { load() }, [load])

  useRealtime<ReportRow>('reports', () => { refetch() }, undefined, !enabled)

  const resolve = useCallback(async (id: string) => {
    await messagingApi.resolveReport(id, { status: 'resolved' }); await refetch()
  }, [refetch])
  const dismiss = useCallback(async (id: string) => {
    await messagingApi.resolveReport(id, { status: 'dismissed' }); await refetch()
  }, [refetch])
  const resolveWithDelete = useCallback(async (id: string) => {
    await messagingApi.resolveReport(id, { status: 'resolved', delete_message: true }); await refetch()
  }, [refetch])
  const resolveWithBan = useCallback(async (id: string) => {
    await messagingApi.resolveReport(id, { status: 'resolved', ban: true }); await refetch()
  }, [refetch])

  const openCount = useMemo(() => reports.filter(r => r.status === 'open').length, [reports])
  return { reports, openCount, resolve, dismiss, resolveWithDelete, resolveWithBan, refetch, isLoading }
}
