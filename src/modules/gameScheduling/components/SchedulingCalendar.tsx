import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CalendarGrid from '../../../components/CalendarGrid'
import { fetchAllItems } from '../../../lib/api'
import { toDateKey, getSeasonMonths, getSeasonYear, formatDate } from '../../../utils/dateUtils'
import type { GameSchedulingSeason, GameSchedulingSlot, GameSchedulingOpponent, Team } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'

// Season-wide overview of the Terminplanung for all teams: confirmed + proposed
// home and away games, blocked slots, and a count of remaining open home slots,
// rendered on the same month calendar the rest of the app uses. Read-only.

type EntryKind =
  | 'home_confirmed'
  | 'away_confirmed'
  | 'home_proposed'
  | 'away_proposed'
  | 'blocked'

interface SchedEntry {
  id: string
  date: Date
  kind: EntryKind
  label: string
  title: string
}

interface Props {
  slots: GameSchedulingSlot[]
  bookings: ExpandedBooking[]
  teams: Team[]
  season: GameSchedulingSeason
}

// Parse a 'YYYY-MM-DD' (or ISO) string into a LOCAL Date (no TZ shift) so the
// calendar-day key matches what CalendarGrid computes per cell.
const parseYmd = (s: string | null | undefined): Date | null => {
  if (!s) return null
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

const CHIP: Record<EntryKind, string> = {
  home_confirmed: 'bg-green-600 text-white',
  away_confirmed: 'bg-blue-600 text-white',
  home_proposed: 'border border-dashed border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  away_proposed: 'border border-dashed border-orange-500 bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  blocked: 'bg-gray-300 text-gray-600 line-through dark:bg-gray-600 dark:text-gray-300',
}

export default function SchedulingCalendar({ slots, bookings, teams, season }: Props) {
  const { t } = useTranslation('gameScheduling')

  const teamName = useMemo(() => {
    const m = new Map<string, string>()
    for (const tm of teams) m.set(String(tm.id), tm.name)
    return (id: string | number | null | undefined) => m.get(String(id)) || '—'
  }, [teams])

  // Season start year drives the initial month + the month pill strip.
  const startYear = useMemo(() => {
    const y = parseInt(String(season.season).slice(0, 4), 10)
    return Number.isFinite(y) ? y : getSeasonYear(new Date())
  }, [season.season])

  const [month, setMonth] = useState(() => new Date(startYear, 8, 1)) // September
  const seasonMonths = useMemo(() => getSeasonMonths(startYear), [startYear])

  const slotsById = useMemo(() => {
    const m = new Map<string, GameSchedulingSlot>()
    for (const s of slots) m.set(String(s.id), s)
    return m
  }, [slots])

  // Hall closures (gcal + school holidays) for the season — block home games, so
  // they render as a red day background. Fetched from this season's August on.
  const [closures, setClosures] = useState<{ start_date: string; end_date: string }[]>([])
  useEffect(() => {
    fetchAllItems<{ start_date: string; end_date: string }>('hall_closures', {
      fields: ['start_date', 'end_date'],
      filter: { end_date: { _gte: `${startYear}-08-01` } },
    })
      .then(setClosures)
      .catch(() => {})
  }, [startYear])

  const closedDates = useMemo(() => {
    const s = new Set<string>()
    for (const c of closures) {
      const start = parseYmd(c.start_date)
      const end = parseYmd(c.end_date)
      if (!start || !end) continue
      const cur = new Date(start)
      for (let guard = 0; cur <= end && guard < 400; guard++) {
        s.add(toDateKey(cur))
        cur.setDate(cur.getDate() + 1)
      }
    }
    return s
  }, [closures])

  // slot id -> opponent label, from confirmed home bookings (so a booked slot
  // shows who it's against).
  const oppBySlot = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of bookings) {
      if (b.type !== 'home_slot_pick' || b.status !== 'confirmed' || !b.slot) continue
      const opp = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent) : null
      const slotId = typeof b.slot === 'object' ? String((b.slot as GameSchedulingSlot).id) : String(b.slot)
      m.set(slotId, opp?.team_name || opp?.club_name || '')
    }
    return m
  }, [bookings])

  const entries = useMemo<SchedEntry[]>(() => {
    const out: SchedEntry[] = []
    const oppLabel = (b: ExpandedBooking) => {
      const o = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent) : null
      return o?.team_name || o?.club_name || ''
    }

    // Slots: booked = confirmed home game; blocked = blocked.
    for (const s of slots) {
      const d = parseYmd(s.date)
      if (!d) continue
      const team = teamName(s.kscw_team)
      if (s.status === 'booked') {
        const opp = oppBySlot.get(String(s.id))
        out.push({
          id: `slot-${s.id}`,
          date: d,
          kind: 'home_confirmed',
          label: team,
          title: `${t('legendHomeConfirmed')}: ${team}${opp ? ` vs ${opp}` : ''} · ${String(s.start_time).slice(0, 5)}`,
        })
      } else if (s.status === 'blocked') {
        out.push({ id: `slot-${s.id}`, date: d, kind: 'blocked', label: team, title: `${t('legendBlocked')}: ${team}` })
      }
    }

    // Bookings: away confirmed + home/away proposals (pending).
    for (const b of bookings) {
      const opp = oppLabel(b)
      const team = typeof b.opponent === 'object' ? teamName((b.opponent as GameSchedulingOpponent).kscw_team) : '—'
      if (b.type === 'away_proposal' && b.status === 'confirmed' && b.confirmed_proposal) {
        const dt = (b as Record<string, unknown>)[`proposed_datetime_${b.confirmed_proposal}`] as string | undefined
        const d = parseYmd(dt)
        if (d) out.push({ id: `awc-${b.id}`, date: d, kind: 'away_confirmed', label: `@${team}`, title: `${t('legendAwayConfirmed')}: ${team}${opp ? ` @ ${opp}` : ''}` })
      } else if (b.type === 'away_proposal' && b.status === 'pending') {
        for (const n of [1, 2, 3]) {
          const dt = (b as Record<string, unknown>)[`proposed_datetime_${n}`] as string | undefined
          const d = parseYmd(dt)
          if (d) out.push({ id: `awp-${b.id}-${n}`, date: d, kind: 'away_proposed', label: `@${team}`, title: `${t('legendAwayProposed')}: ${team}${opp ? ` @ ${opp}` : ''}` })
        }
      } else if (b.type === 'home_slot_pick' && b.status === 'pending') {
        for (const n of [1, 2, 3]) {
          const sid = (b as Record<string, unknown>)[`proposed_slot_${n}`]
          if (sid == null) continue
          const sl = slotsById.get(String(sid))
          const d = parseYmd(sl?.date)
          if (d) out.push({ id: `hmp-${b.id}-${n}`, date: d, kind: 'home_proposed', label: team, title: `${t('legendHomeProposed')}: ${team}${opp ? ` vs ${opp}` : ''}` })
        }
      }
    }
    return out
  }, [slots, bookings, slotsById, oppBySlot, teamName, t])

  // Remaining open home slots per day (de-emphasised count, not chips).
  const openByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of slots) {
      if (s.status !== 'available') continue
      const d = parseYmd(s.date)
      if (!d) continue
      const k = toDateKey(d)
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }, [slots])

  const itemsByDate = useMemo(() => {
    const map = new Map<string, SchedEntry[]>()
    for (const e of entries) {
      const k = toDateKey(e.date)
      const arr = map.get(k) ?? []
      arr.push(e)
      map.set(k, arr)
    }
    return map
  }, [entries])

  // Highlight configured game-Saturdays (Spielsamstage) like the other calendars.
  const highlightedDates = useMemo(() => {
    const s = new Set<string>()
    for (const sat of season.spielsamstage || []) {
      const d = parseYmd(sat?.date)
      if (d) s.add(toDateKey(d))
    }
    return s
  }, [season.spielsamstage])

  const legend: { kind: EntryKind; label: string }[] = [
    { kind: 'home_confirmed', label: t('legendHomeConfirmed') },
    { kind: 'away_confirmed', label: t('legendAwayConfirmed') },
    { kind: 'home_proposed', label: t('legendHomeProposed') },
    { kind: 'away_proposed', label: t('legendAwayProposed') },
    { kind: 'blocked', label: t('legendBlocked') },
  ]

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('overviewTitle')}</h2>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-600 dark:text-gray-300">
        {legend.map((l) => (
          <span key={l.kind} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded ${CHIP[l.kind]}`} />
            {l.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-gray-100 ring-1 ring-gray-300 dark:bg-gray-700 dark:ring-gray-500" />
          {t('legendOpen')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-gold-200 dark:bg-gold-500/40" />
          {t('spielsamstag')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-red-200 dark:bg-red-900" />
          {t('legendClosed')}
        </span>
      </div>

      {/* Season month quick navigation */}
      <div className="mb-3 flex flex-wrap gap-1">
        {seasonMonths.map((m) => {
          const isActive = m.getMonth() === month.getMonth() && m.getFullYear() === month.getFullYear()
          return (
            <button
              key={m.toISOString()}
              onClick={() => setMonth(m)}
              className={`rounded px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-2 sm:py-1 sm:text-xs ${
                isActive
                  ? 'bg-gold-400 text-brand-900'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {formatDate(m, 'MMM')}
            </button>
          )
        })}
      </div>

      <CalendarGrid
        month={month}
        onMonthChange={setMonth}
        itemsByDate={itemsByDate}
        closedDates={closedDates}
        highlightedDates={highlightedDates}
        highlightClassName="bg-gold-100 dark:bg-gold-500/20"
        highlightLabel={t('spielsamstag')}
        renderDayContent={(date, items) => {
          const visible = items.slice(0, 3)
          const hidden = items.length - visible.length
          const open = openByDate.get(toDateKey(date)) || 0
          return (
            <div className="flex flex-col gap-0.5">
              {visible.map((e) => (
                <span
                  key={e.id}
                  title={e.title}
                  className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${CHIP[e.kind]}`}
                >
                  {e.label}
                </span>
              ))}
              {hidden > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400">+{hidden}</span>
              )}
              {open > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500" title={t('legendOpen')}>
                  {t('openCount', { count: open })}
                </span>
              )}
            </div>
          )
        }}
      />
    </div>
  )
}
