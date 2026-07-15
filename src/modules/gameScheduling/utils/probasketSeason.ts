/**
 * ProBasket (Nord-Ostschweizer BV) season windows — the candidate home-date
 * calendar for the Basketball prep view.
 *
 * Basketball scheduling is NOT the volleyball bilateral engine: the association owns
 * the schedule (physical Spielplansitzung + Basketplan). KSCW's job is to know/declare
 * which home dates it can host. Basketball plays **Fri/Sat/Sun**; weekday training
 * slots are a last resort. The prep view lists every Fri/Sat/Sun in the Vorrunde
 * (1. Phase) window and flags the ProBasket blackout ranges.
 *
 * Sourced from "Spiel und Sperrdaten_2026_2027_Provisorisch.pdf" — PROVISIONAL: the
 * association can still shift Sperrdaten until the Spielplansitzung (5 Sep 2026).
 */

export interface ProbasketBlackout {
  /** 'YYYY-MM-DD', inclusive. */
  start: string
  /** 'YYYY-MM-DD', inclusive. */
  end: string
  label: string
  /** 'ferien' = no games for interregional + 1./2. Senior; 'sperr' = blocked for all leagues. */
  kind: 'ferien' | 'sperr'
}

export interface ProbasketSeasonConfig {
  /** Matches game_scheduling_seasons.season, e.g. '2026/27'. */
  season: string
  /** Vorrunde (1. Phase) window — 'YYYY-MM-DD'. */
  vorrundeStart: string
  vorrundeEnd: string
  blackouts: ProbasketBlackout[]
}

export const PROBASKET_SEASONS: Record<string, ProbasketSeasonConfig> = {
  '2026/27': {
    season: '2026/27',
    // 1. Phase for all leagues starts 19.09.26; youth phase ends 13.12.26 (online
    // Spielplansitzung 16.12.26, 2. Phase from 09.01.27). 1. Liga runs to spring but
    // the autumn scheduling covers this window.
    vorrundeStart: '2026-09-19',
    vorrundeEnd: '2026-12-13',
    blackouts: [
      // Herbstferien — no games for interregional + 1./2. Senior leagues.
      { start: '2026-10-05', end: '2026-10-11', label: 'Herbstferien', kind: 'ferien' },
      // Weihnachtsferien — blocked for all leagues (tail overlaps the phase end).
      { start: '2026-12-21', end: '2027-01-04', label: 'Weihnachtsferien', kind: 'sperr' },
    ],
  },
}

/** Fri=5, Sat=6, Sun=0 in JS `Date.getDay()` — the days basketball plays home games. */
const PLAY_DOW = new Set([5, 6, 0])

/** Parse 'YYYY-MM-DD' at LOCAL midnight (avoids UTC drift on the day boundary). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Convert a JS `Date.getDay()` (0=Sun…6=Sat) to the DB `hall_slots.day_of_week`
 * convention (0=Mon…6=Sun). See TrainingForm.tsx / TeamSlotConfigPanel.tsx.
 */
export function jsDayToDbDow(jsDay: number): number {
  return (jsDay + 6) % 7
}

export interface CandidateDate {
  /** 'YYYY-MM-DD'. */
  date: string
  /** JS `getDay()` — 0=Sun…6=Sat. */
  dow: number
  /** The ProBasket blackout this date falls in, if any (else null). */
  blackout: ProbasketBlackout | null
}

/** Every Fri/Sat/Sun in the Vorrunde window, each annotated with any ProBasket blackout. */
export function probasketCandidateDates(cfg: ProbasketSeasonConfig): CandidateDate[] {
  const out: CandidateDate[] = []
  const end = parseYmd(cfg.vorrundeEnd)
  for (const d = parseYmd(cfg.vorrundeStart); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (!PLAY_DOW.has(dow)) continue
    const ymd = toYmd(d)
    // ISO date strings compare lexicographically, so plain string range checks work.
    const blackout = cfg.blackouts.find((b) => ymd >= b.start && ymd <= b.end) ?? null
    out.push({ date: ymd, dow, blackout })
  }
  return out
}

/** The ProBasket config for a season name (e.g. '2026/27'), or null if unmapped. */
export function probasketConfigForSeason(seasonName: string | undefined | null): ProbasketSeasonConfig | null {
  if (!seasonName) return null
  return PROBASKET_SEASONS[seasonName] ?? null
}

// ── Fixed hall slots ─────────────────────────────────────────────────────────
// Basketball plays Fri/Sat/Sun; the tip-off times differ per weekday.
export const FRIDAY_SLOTS = ['20:00'] as const
export const SATURDAY_SLOTS = ['11:00', '13:30', '16:00', '18:30'] as const
export const SUNDAY_SLOTS = ['10:00', '12:30', '15:00'] as const

/** KWI home halls. Friday offers A/B; the weekend adds C. 'KWI A+B' = the combined big court. */
export const HALL_A = 'KWI A'
export const HALL_B = 'KWI B'
export const HALL_C = 'KWI C'
export const HALL_AB = 'KWI A+B'
export const HALL_OPTIONS = [HALL_A, HALL_B, HALL_C, HALL_AB] as const

export interface DaySlots {
  times: string[]
  /** Individual halls offered that day (A+B is chosen per game in the modal, not a column). */
  halls: string[]
}

/** Fixed time slots + candidate halls for a candidate date's weekday (JS getDay: Sun=0..Sat=6). */
export function slotsForDate(dow: number): DaySlots {
  if (dow === 5) return { times: [...FRIDAY_SLOTS], halls: [HALL_A, HALL_B] } // Friday
  if (dow === 6) return { times: [...SATURDAY_SLOTS], halls: [HALL_A, HALL_B, HALL_C] } // Saturday
  if (dow === 0) return { times: [...SUNDAY_SLOTS], halls: [HALL_A, HALL_B, HALL_C] } // Sunday
  return { times: [], halls: [] }
}

/** 'HH:MM' → Excel time serial (fraction of a day), for the availability export. */
export function timeToExcelFraction(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h * 60 + m) / 1440
}

/** A game's default end time = start + 2h, as 'HH:MM' (24h clamp). */
export function slotEndTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const end = (h * 60 + m + 120) % (24 * 60)
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
}
