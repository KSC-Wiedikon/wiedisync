// src/modules/admin/hooks/useDeleteImpact.ts
//
// Fetches "what dies with this record" from GET /kscw/admin/delete-impact/…
// before the Data Explorer lets anybody delete anything.
//
// The endpoint is read-only. The contract that matters here is the FAILURE
// one: when the fetch fails, `data` stays null and `error` is set, and the
// caller MUST keep the delete button disabled. A blind delete is never
// acceptable — not knowing what depends on a record is exactly the situation
// this hook exists to prevent.

import { useCallback, useEffect, useRef, useState } from 'react'
import { kscwApi } from '../../../lib/api'

export type DeleteImpactRule =
  | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'TRIGGER_DELETE' | 'ORPHANED'

export interface DeleteImpactRow {
  table: string
  column: string | null
  rule: DeleteImpactRule
  count: number
}

export interface DeleteImpactBlocker {
  kind: 'restrict' | 'sentinel'
  table: string
  column?: string
  count?: number
}

export interface DeleteImpactLinkedUser {
  id: string
  email: string | null
  status: string | null
}

export interface DeleteImpact {
  collection: 'members' | 'events' | 'trainings' | 'games'
  id: number
  /** Non-empty ⇒ the delete button stays disabled. */
  blockers: DeleteImpactBlocker[]
  cascade: DeleteImpactRow[]
  setNull: DeleteImpactRow[]
  polymorphic: DeleteImpactRow[]
  /** members only — null for the other collections. */
  linkedUser: DeleteImpactLinkedUser | null
  /** games only — the derby sibling row that survives. 0 otherwise. */
  derbySiblings: number
  total: number
}

export function useDeleteImpact(
  collection: DeleteImpact['collection'] | null,
  id: string | null,
  enabled: boolean,
): {
  data: DeleteImpact | null
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [data, setData] = useState<DeleteImpact | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  /** Identity of the fetch that should be in flight. `null` = fetch nothing. */
  const key = enabled && collection && id ? `${collection}|${id}|${nonce}` : null

  // Prime the loading/reset state during render rather than synchronously in
  // the effect (react-hooks/set-state-in-effect is an error here). `key` is the
  // effect's only trigger, so this fires on exactly the same transitions and
  // lands the same committed state one render earlier.
  const [primedFor, setPrimedFor] = useState<string | null | undefined>(undefined)
  if (primedFor !== key) {
    setPrimedFor(key)
    setData(null)
    setError(null)
    setLoading(key !== null)
  }

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  // Guards against a stale response overwriting a newer one when the operator
  // switches records mid-flight.
  const latestKey = useRef<string | null>(null)

  const load = useCallback(() => {
    if (!key || !collection || !id) return Promise.resolve()
    const myKey = key
    return kscwApi<DeleteImpact>(`/admin/delete-impact/${collection}/${encodeURIComponent(id)}`).then(
      (res) => {
        if (latestKey.current !== myKey) return
        setData(res)
        setLoading(false)
      },
      (err: unknown) => {
        if (latestKey.current !== myKey) return
        // Leave `data` null: the caller MUST keep delete disabled on a failed
        // preview, and a null `data` is what makes that structural.
        setData(null)
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      },
    )
  }, [key, collection, id])

  useEffect(() => {
    latestKey.current = key
    void load()
  }, [key, load])

  return { data, loading, error, reload }
}
