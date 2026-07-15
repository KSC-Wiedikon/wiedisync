import type { BookingData, InviteGame } from '../hooks/useAvailableSlots'
import { currentLocale } from '../../../utils/dateHelpers'

// Shared pure card helpers for the opponent-facing scheduling pages. Used by both
// the per-team OpponentFlowPage and the per-club ClubFlowPage so the two render
// the exact same home/away cards. The React form-bridge components live in
// pairingForms.tsx (kept separate so this stays a component-free util module).

// Weekday NAME follows the active UI language; the numeric part stays Swiss
// dd.mm.yyyy regardless of language (CLAUDE.md → date format).
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const wd = d.toLocaleDateString(currentLocale(), { weekday: 'short' })
  const numeric = d.toLocaleString('de-CH', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return `${wd}, ${numeric}`
}

export function fmtDate(ymd: string | undefined): string {
  if (!ymd) return ''
  const d = new Date(`${ymd}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(ymd)
  const wd = d.toLocaleDateString(currentLocale(), { weekday: 'short' })
  return `${wd}, ${d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
}

export type LegStatus = 'open' | 'proposed' | 'confirmed'

/** One schedulable game = one card. A pairing can be played 2-3× per season
 *  (junior triple round-robin), so each side (home/away) may carry several
 *  fixtures; bookings are matched per fixture via booking.svrz_game_id. */
export interface LegCard {
  key: string
  isHome: boolean
  /** Fixture to pass to propose-* (null = legacy/non-SVRZ single-game flow). */
  svrzGameId: string | null
  /** SVRZ fixture number (official game number) shown on the card; null if unknown. */
  number: number | null
  /** 1-based position within its side, and how many games that side has. */
  seq: number
  sideCount: number
  booking?: BookingData
}

// Cards for one side: one per fixture (a NULL-keyed legacy booking belongs to
// the FIRST fixture — mirrors the backend), plus bookings whose fixture is no
// longer in the feed (re-synced/finalized) so a confirmed game never vanishes.
// No fixtures and no bookings → the single legacy card (pre-multi-game flow).
// `keyPrefix` namespaces the card keys so several pairings (club portal) never
// collide on the legacy-home/legacy-away keys.
export function buildLegCards(games: InviteGame[], bookings: BookingData[], isHome: boolean, keyPrefix = ''): LegCard[] {
  const side = games.filter((g) => g.is_home_kscw === isHome)
  const sideBookings = bookings.filter((b) => b.type === (isHome ? 'home_slot_pick' : 'away_proposal'))
  const used = new Set<string>()
  const cards: LegCard[] = side.map((g, i) => {
    let bk = sideBookings.find((b) => String(b.svrz_game_id || '') === String(g.id))
    if (!bk && i === 0) bk = sideBookings.find((b) => b.svrz_game_id == null && !used.has(b.id))
    if (bk) used.add(bk.id)
    return { key: `${keyPrefix}${g.id}`, isHome, svrzGameId: g.id, number: g.number ?? null, seq: i + 1, sideCount: side.length, booking: bk }
  })
  for (const b of sideBookings) {
    if (used.has(b.id)) continue
    cards.push({ key: `${keyPrefix}bk-${b.id}`, isHome, svrzGameId: b.svrz_game_id ?? null, number: null, seq: cards.length + 1, sideCount: side.length, booking: b })
  }
  if (cards.length === 0) {
    cards.push({ key: `${keyPrefix}${isHome ? 'legacy-home' : 'legacy-away'}`, isHome, svrzGameId: null, number: null, seq: 1, sideCount: 1 })
  }
  // sideCount drives the "Game N" suffix — recompute after orphans were added.
  return cards.map((c) => ({ ...c, sideCount: cards.length }))
}
