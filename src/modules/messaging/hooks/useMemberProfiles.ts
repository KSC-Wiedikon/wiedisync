import { useEffect, useState } from 'react'
import { fetchAllItems } from '../../../lib/api'
import { memberDisplayName } from '../../../utils/relations'

export type MemberProfile = { id: string; name: string; photo: string | null; nickname: string | null }

/**
 * Batch-fetch display name + photo uuid for a set of member ids.
 * Returns a Map keyed by string id. Re-fetches when the set changes.
 *
 * Parallel to useMemberDisplayNames but carries photos too — used by the
 * Inbox list + ThreadView avatars.
 */
export function useMemberProfiles(memberIds: string[]): Map<string, MemberProfile> {
  const [map, setMap] = useState<Map<string, MemberProfile>>(() => new Map())
  const key = memberIds.slice().sort().join(',')

  // Clearing on an empty id set is a reset-on-input-change, not a subscription —
  // done during render (React's sanctioned adjust-state-during-render pattern)
  // rather than in the effect below. Same trigger (`key` changed), same result.
  const [prevKey, setPrevKey] = useState(key)
  if (prevKey !== key) {
    setPrevKey(key)
    if (memberIds.length === 0) setMap(new Map())
  }

  useEffect(() => {
    if (memberIds.length === 0) return
    let alive = true
    ;(async () => {
      try {
        const rows = await fetchAllItems<{ id: string; first_name: string; last_name: string; photo: string | null; nickname: string | null }>(
          'members',
          { filter: { id: { _in: memberIds } }, fields: ['id', 'first_name', 'last_name', 'photo', 'nickname'] },
        )
        if (!alive) return
        const m = new Map<string, MemberProfile>()
        for (const r of rows) {
          // On-screen UI shows the member's chosen nickname (falls back to first_name).
          const full = memberDisplayName(r) || String(r.id)
          m.set(String(r.id), { id: String(r.id), name: full, photo: r.photo ?? null, nickname: r.nickname ?? null })
        }
        setMap(m)
      } catch { /* empty map — caller falls back */ }
    })()
    return () => { alive = false }
  }, [key])   // eslint-disable-line react-hooks/exhaustive-deps
  return map
}
