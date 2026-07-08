import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { House, Plane } from 'lucide-react'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../../components/ui/table'
import { fetchAllItems } from '../../../lib/api'
import type { GameSchedulingSeason, GameSchedulingSlot, GameSchedulingOpponent, Team } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'

// Member-facing, read-only LIST of a single team's games — the chronological
// alternative to SchedulingCalendar's month grid, shown on the calendar page's
// "Schedule" tab. Confirmed games (home + away) render as a scannable table;
// still-open proposals get a compact secondary table so a member can see what's
// being negotiated. Same data shape as SchedulingCalendar (from
// GET /kscw/terminplanung/team-calendar/:teamId), just presented as a list.

interface Props {
  slots: GameSchedulingSlot[]
  bookings: ExpandedBooking[]
  team: Team
  season: GameSchedulingSeason
}

// 'YYYY-MM-DD' (or ISO) → local-midnight Date (no TZ shift).
const parseYmd = (s: string | null | undefined): Date | null => {
  if (!s) return null
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
// 'HH:MM:SS' → 'HH:MM'.
const hhmm = (s: string | null | undefined): string => (s ? String(s).slice(0, 5) : '')
// 'YYYY-MM-DD HH:MM:SS' or ISO 'YYYY-MM-DDTHH:MM:SS' → 'HH:MM'.
const dtTime = (s: string | null | undefined): string => {
  const m = String(s ?? '').match(/[T ](\d{2}:\d{2})/)
  return m ? m[1] : ''
}
// Weekday (Mon–Fri) home games play at 20:00 — the slot only reserves the hall
// window (e.g. 19:30–21:30). Weekend slots keep their real start time.
const slotTime = (d: Date | null, startTime: string | null | undefined): string => {
  if (!d) return hhmm(startTime)
  const dow = d.getDay() // 0=Sun..6=Sat
  return dow >= 1 && dow <= 5 ? '20:00' : hhmm(startTime)
}
// Swiss weekday + dd.mm.yyyy, e.g. "Sa, 06.12.2026". Always de-CH per the
// app-wide date rule, regardless of UI language.
const fmtDate = (d: Date): string =>
  new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)

interface ConfirmedRow {
  id: string
  date: Date
  sortKey: string
  time: string
  isHome: boolean
  opponent: string
  venue: string
}
interface ProposedRow {
  id: string
  isHome: boolean
  opponent: string
  dates: string[]
  sortKey: string
}

export default function TeamScheduleList({ slots, bookings, team }: Props) {
  const { t } = useTranslation('gameScheduling')

  const [halls, setHalls] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    let cancelled = false
    fetchAllItems<{ id: number; name: string }>('halls', { fields: ['id', 'name'] })
      .then((r) => { if (!cancelled) setHalls(r) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const hallName = useMemo(() => {
    const m = new Map<string, string>()
    for (const h of halls) m.set(String(h.id), h.name)
    return (id: string | number | null | undefined) => (id == null ? '' : m.get(String(id)) || '')
  }, [halls])

  const slotsById = useMemo(() => {
    const m = new Map<string, GameSchedulingSlot>()
    for (const s of slots) m.set(String(s.id), s)
    return m
  }, [slots])

  // Confirmed home game → its opponent label, from confirmed home bookings.
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

  const oppLabel = (b: ExpandedBooking): string => {
    const o = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent) : null
    return o?.team_name || o?.club_name || '—'
  }

  const { confirmed, proposed } = useMemo(() => {
    const confirmedRows: ConfirmedRow[] = []
    const proposedRows: ProposedRow[] = []

    // Home confirmed games — booked slots.
    for (const s of slots) {
      if (s.status !== 'booked') continue
      const d = parseYmd(s.date)
      if (!d) continue
      confirmedRows.push({
        id: `slot-${s.id}`,
        date: d,
        sortKey: String(s.date).slice(0, 10),
        time: slotTime(d, s.start_time),
        isHome: true,
        opponent: oppBySlot.get(String(s.id)) || '—',
        venue: hallName(s.hall) || '—',
      })
    }

    // Bookings — away confirmed + home/away proposals.
    for (const b of bookings) {
      const opp = oppLabel(b)
      if (b.type === 'away_proposal' && b.status === 'confirmed' && b.confirmed_proposal) {
        const dt = (b as Record<string, unknown>)[`proposed_datetime_${b.confirmed_proposal}`] as string | undefined
        const d = parseYmd(dt)
        if (d) confirmedRows.push({
          id: `awc-${b.id}`, date: d, sortKey: String(dt).slice(0, 10), time: dtTime(dt),
          isHome: false, opponent: opp, venue: '—',
        })
      } else if (b.type === 'away_proposal' && b.status === 'pending') {
        const dates = [1, 2, 3]
          .map((n) => (b as Record<string, unknown>)[`proposed_datetime_${n}`] as string | undefined)
          .map((dt) => parseYmd(dt))
          .filter((d): d is Date => !!d)
          .sort((a, b2) => a.getTime() - b2.getTime())
        if (dates.length) proposedRows.push({
          id: `awp-${b.id}`, isHome: false, opponent: opp,
          dates: dates.map(fmtDate), sortKey: dates[0].toISOString().slice(0, 10),
        })
      } else if (b.type === 'home_slot_pick' && b.status === 'pending') {
        const dates = [1, 2, 3]
          .map((n) => (b as Record<string, unknown>)[`proposed_slot_${n}`])
          .map((sid) => (sid == null ? null : parseYmd(slotsById.get(String(sid))?.date)))
          .filter((d): d is Date => !!d)
          .sort((a, b2) => a.getTime() - b2.getTime())
        if (dates.length) proposedRows.push({
          id: `hmp-${b.id}`, isHome: true, opponent: opp,
          dates: dates.map(fmtDate), sortKey: dates[0].toISOString().slice(0, 10),
        })
      }
    }

    confirmedRows.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    proposedRows.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    return { confirmed: confirmedRows, proposed: proposedRows }
  }, [slots, bookings, oppBySlot, slotsById, hallName])

  const MatchCell = ({ isHome, opponent }: { isHome: boolean; opponent: string }) => (
    <span
      className="inline-flex items-center gap-1.5 whitespace-normal break-words"
      title={isHome ? t('homeGameLabel') : t('awayGameLabel')}
    >
      {isHome
        ? <House className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
        : <Plane className="h-3.5 w-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />}
      <span>{isHome ? t('vsOpponent', { opponent }) : t('atOpponent', { opponent })}</span>
    </span>
  )

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{team.name}</h2>

      {confirmed.length === 0 && proposed.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('listEmpty')}</p>
      ) : (
        <div className="space-y-6">
          {/* Confirmed games */}
          {confirmed.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">{t('listConfirmedHeading')}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('colTime')}</TableHead>
                    <TableHead>{t('colMatch')}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t('colVenue')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {confirmed.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap font-medium">{fmtDate(r.date)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{r.time || '—'}</TableCell>
                      <TableCell><MatchCell isHome={r.isHome} opponent={r.opponent} /></TableCell>
                      <TableCell className="hidden sm:table-cell">{r.venue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pending proposals — still being negotiated, dates not yet fixed. */}
          {proposed.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
                {t('listProposedHeading')}
                <span className="rounded-full border border-dashed border-amber-500 bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {t('statusProposed')}
                </span>
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colMatch')}</TableHead>
                    <TableHead>{t('proposedDatesLabel')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {proposed.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><MatchCell isHome={r.isHome} opponent={r.opponent} /></TableCell>
                      <TableCell className="whitespace-normal break-words text-sm text-gray-600 dark:text-gray-300">
                        {r.dates.join(' · ')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
