import { useEffect } from 'react'
import { useAuth } from './useAuth'
import { getActingMemberId, kscwApi } from '../lib/api'
import { unwrapContentKey, wrapContentKeyFor, type Envelope } from '../lib/e2ee'
import { loadDeviceKey } from '../lib/e2eeStore'

interface HeldGap {
  document: number
  member: number
  envelope: Envelope
  missing: { member: number; public_key: string }[]
}

const NEXT = (memberId: number) => `kscw:id-repair-next:${memberId}`
const EVERY_MS = 15 * 60 * 1000

function due(memberId: number): boolean {
  try { return Number(localStorage.getItem(NEXT(memberId)) ?? 0) <= Date.now() } catch { return true }
}
function later(memberId: number): void {
  try { localStorage.setItem(NEXT(memberId), String(Date.now() + EVERY_MS)) } catch { /* private mode: we just run again */ }
}

let running: Promise<number> | null = null

/**
 * Pass the keys this device holds along to every entitled reader who has none yet — the
 * member's own document and every document a colleague wrapped to them.
 *
 * WHY: a key is wrapped per reader at upload time. Whoever becomes entitled LATER — a coach
 * who set up their key after the upload, or the other team's coaches/TRs once a game is
 * shared (game_guest_teams) — holds nothing until a key holder passes it on. Until now that
 * was a button (profile, team page) that nobody pressed until a referee was waiting: on
 * 27.10.2026 H3's TR could not open H1's TR's ID at the table. Now any key holder's app does
 * it in the background, so the keys are there before the match.
 *
 * ⚠ This does NOT widen access: the server only lists — and only accepts envelopes for —
 * readers `recipientsFor()` already names (never superadmins). Never throws, never toasts.
 * `force` skips the 15-minute spacing (Show IDs runs it on open). Returns how many documents
 * got new keys.
 */
export function repairHeldIdentityKeys(memberId: number, { force = false } = {}): Promise<number> {
  if (running) return running
  running = (async () => {
    if (!force && !due(memberId)) return 0
    // Acting for a household member would send their id with every call; keys follow the
    // session owner, so leave it for a session that is not acting.
    if (navigator.onLine === false || getActingMemberId() != null) return 0
    const device = await loadDeviceKey(memberId)
    if (!device) return 0
    later(memberId)
    let repaired = 0
    try {
      const res = await kscwApi<{ data: { documents: HeldGap[] } }>('/identity/gaps/held')
      for (const d of res.data?.documents ?? []) {
        try {
          // Unwrap with MY envelope, re-wrap per missing reader. The ciphertext is never fetched.
          const key = await unwrapContentKey(d.envelope, device.privateKey)
          const envelopes = await Promise.all(d.missing.map(async (r) => ({
            recipient: r.member,
            ...(await wrapContentKeyFor(key, r.public_key)),
          })))
          await kscwApi('/identity/envelopes', { method: 'POST', body: { member: d.member, envelopes } })
          repaired += 1
        } catch (err) {
          // One document this device cannot unwrap (a stale envelope) must not stop the rest.
          console.info('[ids]', `key repair #${d.member} failed:`, err)
        }
      }
      if (repaired) console.info('[ids]', `key repair: ${repaired} documents now open for everyone entitled`)
    } catch (err) {
      console.info('[ids]', 'key repair check failed, retrying later:', err)
    }
    return repaired
  })().finally(() => { running = null })
  return running
}

/** Mounted once in the app shell. */
export function useIdentityAutoRepair(): void {
  const { realUser } = useAuth()
  const memberId = realUser?.id ? Number(realUser.id) : null
  useEffect(() => {
    if (memberId == null) return
    const run = () => { void repairHeldIdentityKeys(memberId) }
    const timer = setTimeout(run, 5_000)
    // Back to the app (a PWA is resumed far more often than it is reloaded).
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [memberId])
}
