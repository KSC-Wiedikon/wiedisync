import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { House, Plane } from 'lucide-react'
import CalendarGrid from '../../../components/CalendarGrid'
import Modal from '../../../components/Modal'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../../components/ui/table'
import { fetchAllItems } from '../../../lib/api'
import { toDateKey, getSeasonYear, formatDate } from '../../../utils/dateUtils'
import { relId } from '../../../utils/relations'
import type { GameSchedulingSeason, GameSchedulingSlot, GameSchedulingOpponent, Team, Absence, MemberTeam, SchedulingBlock } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'
import CrossTeamBadge from '../../spielplanung/CrossTeamBadge'
import { useCrossTeamConflicts } from '../../spielplanung/hooks/useCrossTeamConflicts'

// Season-wide overview of the Terminplanung for all teams: confirmed + proposed
// home and away games, blocked slots, and a count of remaining open home slots,
// rendered on the same month calendar the rest of the app uses. Read-only.

type EntryKind =
  | 'home_confirmed'
  | 'away_confirmed'
  | 'home_proposed'
  | 'away_proposed'
  | 'blocked'      // a reserved KWI court (derby hall hold / BB Friday split)
  | 'team_block'   // a scheduling_blocks "no games" period for the team
  | 'team_event'   // a team event that blocks games that day

/** An intra-club game (e.g. the H1↔H3 derby) — not a booking; comes from `games`.
 *  Rendered as a normal confirmed home/away game per the team's perspective. */
export interface IntraClubGame {
  id: number
  game_id?: string | null
  date: string
  time?: string | null
  home_team: string
  away_team: string
  kscw_team: number
  type?: string | null
}

interface SchedEntry {
  id: string
  date: Date
  kind: EntryKind
  label: string
  title: string
  teamId: string
  /** HH:MM — for the day-detail table + chip prefix. */
  time?: string
  /** Opponent label (games only). */
  opponent?: string
  /** Hall / venue name. */
  hallName?: string
  /** Why this date is blocked (reserved-for reason, block reason, event title) —
   *  shown in the chip tooltip + the day-detail "Not available" list. */
  detail?: string
}

// One row in the day-detail modal table (games + open slots for a day).
interface DayRow {
  id: string
  time: string
  team: string
  /** Matchup in home-team-first order: home game → "KSCW – opp", away → "opp – KSCW". */
  match: string
  hall: string
  kind: EntryKind | 'open'
}

interface Props {
  slots: GameSchedulingSlot[]
  bookings: ExpandedBooking[]
  teams: Team[]
  season: GameSchedulingSeason
  /** Intra-club games (derby) to surface on the calendar — not bookings. */
  games?: IntraClubGame[]
  // Heading text — defaults to the season-wide overview title. Pass a
  // team-scoped title when rendering this inside a single team's panel.
  title?: string
  // Show per-day absent players (dashboard only). Per-team concern, so it only
  // renders on a single-team calendar (teams=[one]) — never on the all-teams
  // season overview, even when filtered to one team.
  showAbsences?: boolean
}

// Parse a 'YYYY-MM-DD' (or ISO) string into a LOCAL Date (no TZ shift) so the
// calendar-day key matches what CalendarGrid computes per cell.
const parseYmd = (s: string | null | undefined): Date | null => {
  if (!s) return null
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

// 'HH:MM:SS' (a slot time) → 'HH:MM'.
const hhmm = (s: string | null | undefined): string => (s ? String(s).slice(0, 5) : '')
// A proposed datetime ('YYYY-MM-DD HH:MM:SS' or ISO 'YYYY-MM-DDTHH:MM:SS') → 'HH:MM'.
const dtTime = (s: string | null | undefined): string => {
  const m = String(s ?? '').match(/[T ](\d{2}:\d{2})/)
  return m ? m[1] : ''
}
// Weekday (Mon-Fri) game slots show 20:00 — the slot is just the hall window
// (e.g. 19:30-21:30), the weekday game is at 20:00. Weekend slots (Spielsamstag
// / junior Sunday) keep their actual start time. d is a local-midnight Date.
const slotTime = (d: Date | null | undefined, startTime: string | null | undefined): string => {
  if (!d) return hhmm(startTime)
  const dow = d.getDay() // 0=Sun..6=Sat
  return dow >= 1 && dow <= 5 ? '20:00' : hhmm(startTime)
}

const CHIP: Record<EntryKind, string> = {
  home_confirmed: 'bg-green-600 text-white',
  away_confirmed: 'bg-blue-600 text-white',
  home_proposed: 'border border-dashed border-amber-500 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  away_proposed: 'border border-dashed border-orange-500 bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  blocked: 'bg-gray-300 text-gray-600 line-through dark:bg-gray-600 dark:text-gray-300',
  team_block: 'bg-rose-200 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
  team_event: 'bg-purple-200 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
}

// Kinds that represent "a game can't happen here" rather than a game itself.
const isBlockerKind = (k: EntryKind) => k === 'blocked' || k === 'team_block' || k === 'team_event'

export default function SchedulingCalendar({ slots, bookings, teams, season, games = [], title, showAbsences }: Props) {
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
  // Terminplanung runs Sep → Mar only — games are scheduled within that window,
  // so drop Apr/May and clamp navigation to the two boundary months.
  const firstMonth = useMemo(() => new Date(startYear, 8, 1), [startYear]) // September
  const lastMonth = useMemo(() => new Date(startYear + 1, 2, 1), [startYear]) // March
  // Configurable season offer window (mirrors backend seasonOfferWindow): days
  // before it opens / after it closes render black with "Season not open".
  const seasonWindow = useMemo(() => ({
    start: season.season_opens ? String(season.season_opens).slice(0, 10) : `${startYear}-09-01`,
    end: season.season_closes ? String(season.season_closes).slice(0, 10) : `${startYear + 1}-03-31`,
  }), [season.season_opens, season.season_closes, startYear])
  const outOfSeasonDates = useMemo(() => {
    const set = new Set<string>()
    const end = new Date(startYear + 1, 3, 30) // Apr 30 — covers trailing grid days
    for (const d = new Date(startYear, 7, 1); d <= end; d.setDate(d.getDate() + 1)) { // from Aug 1
      const k = toDateKey(d)
      if (k < seasonWindow.start || k > seasonWindow.end) set.add(k)
    }
    return set
  }, [seasonWindow, startYear])
  const seasonMonths = useMemo(() => {
    const out: Date[] = []
    for (let m = 8; m <= 11; m++) out.push(new Date(startYear, m, 1)) // Sep–Dec
    for (let m = 0; m <= 2; m++) out.push(new Date(startYear + 1, m, 1)) // Jan–Mar
    return out
  }, [startYear])
  // Clamp so the prev/next arrows (and pill clicks) can't leave the Sep–Mar range.
  const goMonth = (d: Date) => setMonth(d < firstMonth ? firstMonth : d > lastMonth ? lastMonth : d)

  const slotsById = useMemo(() => {
    const m = new Map<string, GameSchedulingSlot>()
    for (const s of slots) m.set(String(s.id), s)
    return m
  }, [slots])

  // Hall id → name, for the day-detail table (members + admins can read halls).
  const [halls, setHalls] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    fetchAllItems<{ id: number; name: string }>('halls', { fields: ['id', 'name'] })
      .then(setHalls)
      .catch(() => {})
  }, [])
  const hallName = useMemo(() => {
    const m = new Map<string, string>()
    for (const h of halls) m.set(String(h.id), h.name)
    return (id: string | number | null | undefined) => (id == null ? '' : m.get(String(id)) || '')
  }, [halls])

  // Day the user clicked → detail modal (its teamFilter-applied entries).
  const [dayDetail, setDayDetail] = useState<{ date: Date; entries: SchedEntry[] } | null>(null)

  // Hall closures (gcal + school holidays) for the season — block home games, so
  // they render as a red day background. Fetched from this season's August on.
  const [closures, setClosures] = useState<{ start_date: string; end_date: string; reason?: string }[]>([])
  useEffect(() => {
    fetchAllItems<{ start_date: string; end_date: string; reason?: string }>('hall_closures', {
      fields: ['start_date', 'end_date', 'reason'],
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

  // date key -> closure reason (first one wins on overlapping closures).
  const closureReasons = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of closures) {
      const reason = (c.reason || '').trim()
      if (!reason) continue
      const start = parseYmd(c.start_date)
      const end = parseYmd(c.end_date)
      if (!start || !end) continue
      const cur = new Date(start)
      for (let guard = 0; cur <= end && guard < 400; guard++) {
        const key = toDateKey(cur)
        if (!m.has(key)) m.set(key, reason)
        cur.setDate(cur.getDate() + 1)
      }
    }
    return m
  }, [closures])

  const teamIds = useMemo(() => teams.map((tm) => String(tm.id)), [teams])

  // Team blocks (scheduling_blocks) — "no games" periods a coach/spielplaner set
  // for a team (e.g. "Keine Spiele (Daniela Imhof)"). The backend hard-blocks
  // every slot in the range, so without surfacing them here a date silently has
  // no slots and it's impossible to see why. Members can read scheduling_blocks.
  const [blocks, setBlocks] = useState<SchedulingBlock[]>([])
  useEffect(() => {
    // Per-team only — never on the all-teams overview (teamIds.length > 1).
    if (teamIds.length !== 1) return
    let cancelled = false
    fetchAllItems<SchedulingBlock>('scheduling_blocks', {
      fields: ['id', 'team', 'start_date', 'end_date', 'reason'],
      filter: { _and: [{ team: { _in: teamIds } }, { end_date: { _gte: `${startYear}-08-01` } }] },
    })
      .then((r) => { if (!cancelled) setBlocks(r) })
      .catch(() => { if (!cancelled) setBlocks([]) })
    return () => { cancelled = true }
  }, [teamIds, startYear])

  // Team events that block games (a tournament weekend, a team trip). The backend
  // drops every slot whose date falls in a linked event, so they too vanish
  // silently — surface them. M2M-safe: fetch the junction first (events_teams by
  // teams_id), then the events by id (never walk the alias in a filter).
  const [teamEvents, setTeamEvents] = useState<{ id: string; title: string; start_date: string; end_date?: string | null; teamId: string }[]>([])
  useEffect(() => {
    // Per-team only — never on the all-teams overview (teamIds.length > 1).
    if (teamIds.length !== 1) return
    let cancelled = false
    ;(async () => {
      try {
        const links = await fetchAllItems<{ events_id: unknown; teams_id: unknown }>('events_teams', {
          fields: ['events_id', 'teams_id'], filter: { teams_id: { _in: teamIds } },
        })
        const eventToTeams = new Map<string, Set<string>>()
        for (const l of links) {
          const eid = String(relId(l.events_id as never)); const tid = String(relId(l.teams_id as never))
          if (!eid || eid === 'null') continue
          const set = eventToTeams.get(eid) ?? new Set<string>(); set.add(tid); eventToTeams.set(eid, set)
        }
        const eventIds = [...eventToTeams.keys()]
        if (eventIds.length === 0) { if (!cancelled) setTeamEvents([]); return }
        const evs = await fetchAllItems<{ id: string; title: string; start_date: string; end_date?: string | null }>('events', {
          fields: ['id', 'title', 'start_date', 'end_date'],
          filter: { _and: [{ id: { _in: eventIds } }, { start_date: { _lte: `${startYear + 1}-04-30` } }, { start_date: { _gte: `${startYear}-08-01` } }] },
        })
        const flat: { id: string; title: string; start_date: string; end_date?: string | null; teamId: string }[] = []
        for (const ev of evs) {
          for (const tid of eventToTeams.get(String(ev.id)) ?? []) {
            flat.push({ id: String(ev.id), title: ev.title, start_date: ev.start_date, end_date: ev.end_date, teamId: tid })
          }
        }
        if (!cancelled) setTeamEvents(flat)
      } catch {
        if (!cancelled) setTeamEvents([])
      }
    })()
    return () => { cancelled = true }
  }, [teamIds, startYear])

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

  // Team filter — empty Set = all teams shown.
  const [teamFilter, setTeamFilter] = useState<Set<string>>(new Set())

  // The single team to show absences for (dashboard only): the lone team when
  // this calendar is team-scoped, or the one selected in the filter. null when
  // absences are off or more/less than one team is in view.
  const absenceTeamId = useMemo(() => {
    if (!showAbsences) return null
    if (teams.length === 1) return String(teams[0].id)
    return null
  }, [showAbsences, teams])

  // Roster-sharing teams that already play a given day block a home slot for this
  // team — surfaced per-day as a sky badge, exactly like absences. Same gate as
  // absences (single team-scoped calendar); the hook no-ops on an empty id list,
  // so the season overview never fetches.
  const crossTeamIds = useMemo(() => (absenceTeamId ? [absenceTeamId] : []), [absenceTeamId])
  const { byDate: crossTeamByDate } = useCrossTeamConflicts(crossTeamIds)

  // Per-team blockers (team blocks "no games", team events, absences, wishes) are
  // ONLY meaningful on a single team's calendar — showing them on the all-teams
  // season overview is misleading noise. True only when this calendar is scoped
  // to exactly one team (the per-team admin panel + the member team calendar).
  const isTeamScoped = teams.length === 1

  // date key -> number of distinct team members unavailable that day (blocking
  // absences affecting games). Fetched per-team via a single-level junction walk
  // (member_teams → members) then absences by member, per the M2M-safe pattern.
  // date key -> sorted names of members unavailable that day (so a click/hover
  // can show WHO, not just how many).
  const [absencesByDate, setAbsencesByDate] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    if (!absenceTeamId) { setAbsencesByDate(new Map()); return }
    let cancelled = false
    ;(async () => {
      try {
        const links = await fetchAllItems<MemberTeam>('member_teams', {
          fields: ['member'], filter: { team: { _eq: absenceTeamId } },
        })
        const memberIds = [...new Set(links.map((l) => relId(l.member)).filter(Boolean))]
        if (memberIds.length === 0) { if (!cancelled) setAbsencesByDate(new Map()); return }
        const winStart = `${startYear}-08-01`
        const winEnd = `${startYear + 1}-03-31`
        const [members, abs] = await Promise.all([
          fetchAllItems<{ id: string; first_name?: string; last_name?: string }>('members', {
            fields: ['id', 'first_name', 'last_name'], filter: { id: { _in: memberIds } },
          }),
          fetchAllItems<Absence & { member?: string | { id: string } }>('absences', {
            fields: ['id', 'member', 'start_date', 'end_date', 'type', 'days_of_week', 'affects', 'blocking'],
            filter: { _and: [{ member: { _in: memberIds } }, { end_date: { _gte: winStart } }, { start_date: { _lte: winEnd } }] },
          }),
        ])
        const nameById = new Map<string, string>()
        for (const m of members) {
          const nm = `${m.first_name || ''} ${m.last_name || ''}`.trim()
          nameById.set(String(m.id), nm || String(m.id))
        }
        const lo = new Date(startYear, 7, 1) // Aug 1
        const hi = new Date(startYear + 1, 2, 31) // Mar 31
        const byDate = new Map<string, Set<string>>()
        const add = (key: string, mid: string) => {
          const set = byDate.get(key) ?? new Set<string>()
          set.add(mid); byDate.set(key, set)
        }
        for (const a of abs) {
          // Count only real, blocking absences: skip not-blocking ones and skip
          // weekly recurring "unavailabilities" (those aren't absences).
          if ((a as { blocking?: boolean }).blocking === false) continue
          if (a.type === 'weekly') continue
          const affects = (a as { affects?: string[] }).affects
          if (Array.isArray(affects) && affects.length > 0 && !affects.includes('all') && !affects.includes('games')) continue
          const mid = String(relId(a.member as never))
          const s0 = parseYmd(a.start_date); const e0 = parseYmd(a.end_date)
          if (!s0 || !e0) continue
          const from = s0 < lo ? lo : s0
          const to = e0 > hi ? hi : e0
          for (let d = new Date(from), guard = 0; d <= to && guard < 400; d.setDate(d.getDate() + 1), guard++) {
            add(toDateKey(d), mid)
          }
        }
        const names = new Map<string, string[]>()
        for (const [k, set] of byDate) {
          names.set(k, [...set].map((mid) => nameById.get(mid) || mid).sort((a, b) => a.localeCompare(b)))
        }
        if (!cancelled) setAbsencesByDate(names)
      } catch {
        if (!cancelled) setAbsencesByDate(new Map())
      }
    })()
    return () => { cancelled = true }
  }, [absenceTeamId, startYear])

  const entries = useMemo<SchedEntry[]>(() => {
    const out: SchedEntry[] = []
    const oppLabel = (b: ExpandedBooking) => {
      const o = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent) : null
      return o?.team_name || o?.club_name || ''
    }

    // Dates on which an intra-club derby reserves the gym (a source='derby' slot).
    // On those evenings the whole KWI gym (A+B) is held for the derby, so a blocked
    // KWI court there is a derby reservation — NOT the basketball Friday split.
    const derbyDates = new Set(
      slots
        .filter((s) => (s as { source?: string }).source === 'derby')
        .map((s) => { const dd = parseYmd(s.date); return dd ? toDateKey(dd) : '' })
        .filter(Boolean),
    )

    // Slots: booked = confirmed home game; blocked = blocked.
    for (const s of slots) {
      const d = parseYmd(s.date)
      if (!d) continue
      // 'derby' slots only RESERVE the hall — the matchup is shown via the games
      // table (intra-club), so don't render them here (would double the entry).
      if ((s as { source?: string }).source === 'derby') continue
      const team = teamName(s.kscw_team)
      const tid = String(s.kscw_team ?? '')
      if (s.status === 'booked') {
        const opp = oppBySlot.get(String(s.id))
        out.push({
          id: `slot-${s.id}`,
          date: d,
          kind: 'home_confirmed',
          label: team,
          teamId: tid,
          time: slotTime(d, s.start_time),
          opponent: opp,
          hallName: hallName(s.hall),
          title: `${t('legendHomeConfirmed')}: ${team}${opp ? ` vs ${opp}` : ''} · ${slotTime(d, s.start_time)}`,
        })
      } else if (s.status === 'blocked') {
        // A blocked slot is either a derby hall reservation (the gym is held A+B for
        // an intra-club derby that evening) or the KWI VB/BB Friday alternation.
        // Chip just says "Reserved"; the tooltip/detail says what it's reserved for.
        const reason = derbyDates.has(toDateKey(d)) ? t('reservedForDerby') : t('reservedForBB')
        out.push({ id: `slot-${s.id}`, date: d, kind: 'blocked', label: t('reserved'), teamId: tid, time: slotTime(d, s.start_time), hallName: hallName(s.hall), detail: reason, title: `${reason} · ${team}` })
      }
    }

    // Bookings: away confirmed + home/away proposals (pending).
    for (const b of bookings) {
      const opp = oppLabel(b)
      const tid = typeof b.opponent === 'object' ? String((b.opponent as GameSchedulingOpponent).kscw_team ?? '') : ''
      const team = typeof b.opponent === 'object' ? teamName((b.opponent as GameSchedulingOpponent).kscw_team) : '—'
      const place = (n: number) => (b as Record<string, unknown>)[`proposed_place_${n}`] as string | undefined
      if (b.type === 'away_proposal' && b.status === 'confirmed' && b.confirmed_proposal) {
        const dt = (b as Record<string, unknown>)[`proposed_datetime_${b.confirmed_proposal}`] as string | undefined
        const d = parseYmd(dt)
        if (d) out.push({ id: `awc-${b.id}`, date: d, kind: 'away_confirmed', label: team, teamId: tid, time: dtTime(dt), opponent: opp, hallName: place(b.confirmed_proposal) || '', title: `${t('legendAwayConfirmed')}: ${team}${opp ? ` @ ${opp}` : ''}` })
      } else if (b.type === 'away_proposal' && b.status === 'pending') {
        for (const n of [1, 2, 3]) {
          const dt = (b as Record<string, unknown>)[`proposed_datetime_${n}`] as string | undefined
          const d = parseYmd(dt)
          if (d) out.push({ id: `awp-${b.id}-${n}`, date: d, kind: 'away_proposed', label: team, teamId: tid, time: dtTime(dt), opponent: opp, hallName: place(n) || '', title: `${t('legendAwayProposed')}: ${team}${opp ? ` @ ${opp}` : ''}` })
        }
      } else if (b.type === 'home_slot_pick' && b.status === 'pending') {
        for (const n of [1, 2, 3]) {
          const sid = (b as Record<string, unknown>)[`proposed_slot_${n}`]
          if (sid == null) continue
          const sl = slotsById.get(String(sid))
          const d = parseYmd(sl?.date)
          if (d) out.push({ id: `hmp-${b.id}-${n}`, date: d, kind: 'home_proposed', label: team, teamId: tid, time: slotTime(d, sl?.start_time), opponent: opp, hallName: hallName(sl?.hall), title: `${t('legendHomeProposed')}: ${team}${opp ? ` vs ${opp}` : ''}` })
        }
      }
    }

    // Intra-club games (e.g. the H1↔H3 derby) — not bookings, so they arrive via
    // `games` (one row per team's perspective). Render each as a normal confirmed
    // home/away game so they look like every other game on the calendar.
    const shortName = (n: string) => String(n).replace(/^KSC Wiedikon\s+/, '')
    for (const g of games) {
      const d = parseYmd(g.date)
      if (!d) continue
      const me = teamName(g.kscw_team)
      const isHome = g.type !== 'away'
      const opp = shortName(isHome ? g.away_team : g.home_team)
      const time = g.time ? hhmm(g.time) : ''
      if (isHome) {
        out.push({ id: `g-${g.id}`, date: d, kind: 'home_confirmed', label: me, teamId: String(g.kscw_team), time, opponent: opp, title: `${t('legendHomeConfirmed')}: ${me} vs ${opp}` })
      } else {
        out.push({ id: `g-${g.id}`, date: d, kind: 'away_confirmed', label: me, teamId: String(g.kscw_team), time, opponent: opp, title: `${t('legendAwayConfirmed')}: ${me} @ ${opp}` })
      }
    }

    // Team blocks (scheduling_blocks) — one chip per day in the range so the whole
    // "no games" period is visible and the reason is one click/hover away.
    for (const bl of blocks) {
      const start = parseYmd(bl.start_date); const end = parseYmd(bl.end_date)
      if (!start || !end) continue
      const tid = String(bl.team)
      const team = teamName(bl.team)
      const reason = (bl.reason || '').trim()
      for (let d = new Date(start), guard = 0; d <= end && guard < 400; d.setDate(d.getDate() + 1), guard++) {
        out.push({
          id: `blk-${bl.id}-${toDateKey(d)}`, date: new Date(d), kind: 'team_block', label: t('blockNoGames'),
          teamId: tid, detail: reason || undefined,
          title: `${t('blockNoGames')}${reason ? `: ${reason}` : ''} · ${team}`,
        })
      }
    }

    // Team events that block games (tournament weekend, team trip).
    for (const ev of teamEvents) {
      const start = parseYmd(ev.start_date); const end = parseYmd(ev.end_date || ev.start_date)
      if (!start || !end) continue
      const team = teamName(ev.teamId)
      const ttl = (ev.title || '').trim()
      for (let d = new Date(start), guard = 0; d <= end && guard < 400; d.setDate(d.getDate() + 1), guard++) {
        out.push({
          id: `ev-${ev.id}-${ev.teamId}-${toDateKey(d)}`, date: new Date(d), kind: 'team_event', label: ttl || t('teamEventLabel'),
          teamId: ev.teamId, detail: ttl || undefined,
          title: `${t('teamEventLabel')}${ttl ? `: ${ttl}` : ''} · ${team}`,
        })
      }
    }
    return out
  }, [slots, bookings, slotsById, oppBySlot, teamName, hallName, t, games, blocks, teamEvents])

  // Teams that actually appear in the calendar, for the filter chips.
  const filterableTeams = useMemo(() => {
    const ids = new Set(entries.map((e) => e.teamId).filter(Boolean))
    return teams.filter((tm) => ids.has(String(tm.id))).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }, [entries, teams])

  // Remaining open home slots per day (de-emphasised count, not chips).
  const openByDate = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of slots) {
      if (s.status !== 'available') continue
      if (!(teamFilter.size === 0 || teamFilter.has(String(s.kscw_team)))) continue
      const d = parseYmd(s.date)
      if (!d) continue
      const k = toDateKey(d)
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }, [slots, teamFilter])

  const itemsByDate = useMemo(() => {
    const map = new Map<string, SchedEntry[]>()
    for (const e of entries) {
      if (!(teamFilter.size === 0 || teamFilter.has(e.teamId))) continue
      const k = toDateKey(e.date)
      const arr = map.get(k) ?? []
      arr.push(e)
      map.set(k, arr)
    }
    return map
  }, [entries, teamFilter])

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
    { kind: 'blocked', label: t('reserved') },
    // "No games" + event blockers are per-team only — keep them out of the
    // all-teams overview legend too.
    ...(isTeamScoped ? [
      { kind: 'team_block' as EntryKind, label: t('blockNoGames') },
      { kind: 'team_event' as EntryKind, label: t('teamEventLabel') },
    ] : []),
  ]

  const KIND_LABEL = useMemo<Record<EntryKind | 'open', string>>(() => ({
    home_confirmed: t('legendHomeConfirmed'),
    away_confirmed: t('legendAwayConfirmed'),
    home_proposed: t('legendHomeProposed'),
    away_proposed: t('legendAwayProposed'),
    blocked: t('reserved'),
    team_block: t('blockNoGames'),
    team_event: t('teamEventLabel'),
    open: t('legendOpen'),
  }), [t])

  // Rows for the day-detail modal: the day's games, the things that block a game
  // that day (reserved courts, team blocks, events), the still-open slots, and who
  // is absent.
  const dayRows = useMemo<{ games: DayRow[]; blockers: { id: string; team: string; label: string; detail: string }[]; open: DayRow[]; absent: string[] }>(() => {
    if (!dayDetail) return { games: [], blockers: [], open: [], absent: [] }
    const key = toDateKey(dayDetail.date)
    const games: DayRow[] = dayDetail.entries
      .filter((e) => !isBlockerKind(e.kind))
      .map((e) => {
        const team = teamName(e.teamId)
        const opp = e.opponent || ''
        // Home-team first: for an away game the opponent hosts, so it goes left.
        const isAway = e.kind === 'away_confirmed' || e.kind === 'away_proposed'
        const match = opp ? (isAway ? `${opp} – ${team}` : `${team} – ${opp}`) : team
        return { id: e.id, time: e.time || '', team, match, hall: e.hallName || '', kind: e.kind }
      })
      .sort((a, b) => a.time.localeCompare(b.time))
    const blockers = dayDetail.entries
      .filter((e) => isBlockerKind(e.kind))
      .map((e) => ({ id: e.id, team: teamName(e.teamId), label: KIND_LABEL[e.kind], detail: e.detail || '' }))
    const open: DayRow[] = slots
      .filter((s) => s.status === 'available'
        && (teamFilter.size === 0 || teamFilter.has(String(s.kscw_team)))
        && toDateKey(parseYmd(s.date) ?? new Date(0)) === key)
      .map((s) => { const team = teamName(s.kscw_team); return { id: `open-${s.id}`, time: slotTime(parseYmd(s.date), s.start_time), team, match: team, hall: hallName(s.hall), kind: 'open' as const } })
      .sort((a, b) => a.team.localeCompare(b.team) || a.time.localeCompare(b.time))
    const absent = absencesByDate.get(key) || []
    return { games, blockers, open, absent }
  }, [dayDetail, slots, teamFilter, teamName, hallName, absencesByDate, KIND_LABEL])

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{title ?? t('overviewTitle')}</h2>

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

      {/* Team filter (multi-select; none selected = all shown) */}
      {filterableTeams.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setTeamFilter(new Set())}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              teamFilter.size === 0
                ? 'bg-gold-400 text-brand-900'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {t('allTeams')}
          </button>
          {filterableTeams.map((tm) => {
            const on = teamFilter.has(String(tm.id))
            return (
              <button
                key={tm.id}
                onClick={() =>
                  setTeamFilter((prev) => {
                    const next = new Set(prev)
                    if (next.has(String(tm.id))) next.delete(String(tm.id))
                    else next.add(String(tm.id))
                    return next
                  })
                }
                aria-pressed={on}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  on
                    ? 'bg-gold-400 text-brand-900'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {tm.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Season month quick navigation */}
      <div className="mb-3 flex flex-wrap gap-1">
        {seasonMonths.map((m) => {
          const isActive = m.getMonth() === month.getMonth() && m.getFullYear() === month.getFullYear()
          return (
            <button
              key={m.toISOString()}
              onClick={() => goMonth(m)}
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
        onMonthChange={goMonth}
        minMonth={firstMonth}
        maxMonth={lastMonth}
        itemsByDate={itemsByDate}
        closedDates={closedDates}
        closedLabel={t('hallClosure')}
        closureReasons={closureReasons}
        highlightedDates={highlightedDates}
        highlightClassName="bg-gold-100 dark:bg-gold-500/20"
        highlightLabel={t('spielsamstag')}
        outOfSeasonDates={outOfSeasonDates}
        outOfSeasonLabel={t('outsideSeasonLabel')}
        onDayClick={(date, items) => {
          const open = openByDate.get(toDateKey(date)) || 0
          const absent = absencesByDate.get(toDateKey(date))?.length || 0
          if (items.length === 0 && open === 0 && absent === 0) return
          setDayDetail({ date, entries: items })
        }}
        renderDayContent={(date, items) => {
          const key = toDateKey(date)
          const visible = items.slice(0, 3)
          const hidden = items.length - visible.length
          const open = openByDate.get(key) || 0
          const absentNames = absencesByDate.get(key) || []
          const crossTeam = crossTeamByDate.get(key) || []
          return (
            <div className="flex flex-col gap-0.5">
              {visible.map((e) => {
                // Home/away games get a glyph instead of the old "@" prefix:
                // a house for home legs, a plane (travel) for away legs.
                const isHomeKind = e.kind === 'home_confirmed' || e.kind === 'home_proposed'
                const isAwayKind = e.kind === 'away_confirmed' || e.kind === 'away_proposed'
                return (
                  <span
                    key={e.id}
                    title={e.title}
                    className={`flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] leading-tight ${CHIP[e.kind]}`}
                  >
                    {e.time && <span className="shrink-0 tabular-nums">{e.time}</span>}
                    {isHomeKind && <House className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                    {isAwayKind && <Plane className="h-2.5 w-2.5 shrink-0" aria-hidden />}
                    <span className="truncate">{e.label}</span>
                  </span>
                )
              })}
              {hidden > 0 && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400">+{hidden}</span>
              )}
              {open > 0 && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500" title={t('legendOpen')}>
                  {t('openCount', { count: open })}
                </span>
              )}
              {absentNames.length > 0 && (
                <span className="text-[10px] text-rose-500 dark:text-rose-400" title={t('absentPlayers', { names: absentNames.join(', ') })}>
                  {t('absentCount', { count: absentNames.length })}
                </span>
              )}
              {crossTeam.length > 0 && (
                <div className="flex">
                  <CrossTeamBadge conflicts={crossTeam} />
                </div>
              )}
            </div>
          )
        }}
      />

      {/* Day-detail modal — time / team / opponent / hall in a table */}
      <Modal
        open={!!dayDetail}
        onClose={() => setDayDetail(null)}
        title={dayDetail ? formatDate(dayDetail.date, 'EEEE, d MMMM yyyy') : ''}
        size="lg"
      >
        {dayDetail && (
          <div className="space-y-4">
            {dayRows.games.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colTime')}</TableHead>
                    <TableHead>{t('colMatch')}</TableHead>
                    <TableHead>{t('colHall')}</TableHead>
                    <TableHead>{t('colType')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayRows.games.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">{r.time || '—'}</TableCell>
                      <TableCell className="font-medium">{r.match}</TableCell>
                      <TableCell>{r.hall || '—'}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className={`inline-block h-2.5 w-2.5 rounded ${CHIP[r.kind as EntryKind]}`} />
                          <span className="text-xs">{KIND_LABEL[r.kind]}</span>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('dayNoGames')}</p>
            )}

            {/* Anything that blocks a game that day: reserved courts, team blocks, events. */}
            {dayRows.blockers.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-900/20">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{t('blockedHeading')}</p>
                <ul className="mt-1.5 space-y-1">
                  {dayRows.blockers.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-rose-700 dark:text-rose-300">
                      <span className="font-medium">{b.team}</span>
                      <span>{b.label}{b.detail ? ` — ${b.detail}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Who is unavailable that day (single-team calendars only). */}
            {dayRows.absent.length > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-900/20">
                <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{t('absentPlayers', { names: dayRows.absent.join(', ') })}</p>
              </div>
            )}

            {dayRows.open.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('openSlotsHeading', { count: dayRows.open.length })}
                </summary>
                <div className="mt-2 max-h-72 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('colTime')}</TableHead>
                        <TableHead>{t('colTeam')}</TableHead>
                        <TableHead>{t('colHall')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayRows.open.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap tabular-nums">{r.time || '—'}</TableCell>
                          <TableCell className="font-medium">{r.team}</TableCell>
                          <TableCell>{r.hall || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
