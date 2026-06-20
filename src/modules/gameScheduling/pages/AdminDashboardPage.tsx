import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useAdminBookings } from '../hooks/useAdminBookings'
import { useTeams } from '../../../hooks/useTeams'
import LoadingSpinner from '../../../components/LoadingSpinner'
import AwayProposalReview, { type AwayVmCheck, type AwayVmUnbooked } from '../components/AwayProposalReview'
import HomeProposalReview from '../components/HomeProposalReview'
import OpponentNotes from '../components/OpponentNotes'
import ManualBookingForm, { type ManualFixtureOption } from '../components/ManualBookingForm'
import ExcelExportButton from '../components/ExcelExportButton'
import SyncNowButton from '../components/SyncNowButton'
import {
  buildScheduleRows, buildScheduleXlsx, buildSchedulePdf,
  bytesToBase64, exportFilename, XLSX_MIME, PDF_MIME,
} from '../lib/scheduleExport'
import TeamAvailabilityDialog from '../components/TeamAvailabilityDialog'
import SchedulingCalendar, { type IntraClubGame } from '../components/SchedulingCalendar'
import MailboxPanel from '../components/MailboxPanel'
import { useMailbox, messagesForOpponentThread, contactAddressSet, type MailboxMessage, type OpponentContacts } from '../hooks/useMailbox'
import { useConfirm } from '../../../components/ConfirmProvider'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '../../../components/ui/table'
import type { GameSchedulingOpponent, GameSchedulingSeason, GameSchedulingSlot, InviteStatus, InviteSource, ProposalHealthEntry } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'
import { formatSeasonShort } from '../utils/formatSeason'
import { gameStartForDate } from '../utils/slotTime'
import { formatDateCompactZurich, formatDateTimeCompact } from '../../../utils/dateHelpers'
import { buildMailtoHref } from '../../../utils/sanitizeUrl'
import { kscwApi, fetchAllItems } from '../../../lib/api'
import { useHalls } from '../../../hooks/useData'
import { isSchedulableTeam } from '../utils/schedulableTeams'

/** One SVRZ fixture for an opponent (from the svrz-clubs endpoint). */
interface OpponentGame {
  /** svrz_games.svrz_persistence_id — the key bookings attach to (multi-game pairings). */
  svrz_game_id?: string | null
  /** Official SVRZ game number (svrz_games.svrz_number), e.g. 406192. */
  number?: string | number | null
  date: string | null
  display_name: string | null
  is_home_kscw: boolean
  /** UI-only: real agreed date (dd.mm.yyyy HH:MM) overlaid from a confirmed
   *  booking, so the modal shows it instead of the unscheduled SVRZ placeholder. */
  _realDate?: string
}
interface SvrzClub {
  club_id: number
  club_name: string
  team_name: string
  game_count: number
  games: OpponentGame[]
}

/** One schedulable game of a pairing in the admin card — a pairing can be
 *  played 2-3× per season, so each side may carry several fixtures. */
interface FixtureLeg {
  key: string
  svrzGameId: string | null
  /** Official SVRZ game number, shown next to the "Game N" label. */
  number: string | number | null
  seq: number
  sideCount: number
  booking?: ExpandedBooking
}

// Legs for one side of an opponent card: one per fixture (a NULL-keyed legacy
// booking belongs to the FIRST fixture — mirrors the backend keying), plus
// bookings whose fixture is no longer in the feed so a confirmed game never
// vanishes. No fixtures and no bookings → a single empty leg (awaiting
// proposals — the pre-multi-game layout).
function buildFixtureLegs(oppGames: OpponentGame[], oppBookings: ExpandedBooking[], isHome: boolean): FixtureLeg[] {
  const side = oppGames.filter((g) => g.is_home_kscw === isHome)
  const sideBookings = oppBookings.filter((b) => b.type === (isHome ? 'home_slot_pick' : 'away_proposal'))
  const used = new Set<string>()
  const legs: FixtureLeg[] = side.map((g, i) => {
    let bk = g.svrz_game_id
      ? sideBookings.find((b) => String(b.svrz_game_id || '') === String(g.svrz_game_id))
      : undefined
    if (!bk && i === 0) bk = sideBookings.find((b) => b.svrz_game_id == null && !used.has(String(b.id)))
    if (bk) used.add(String(bk.id))
    return { key: String(g.svrz_game_id ?? `fixture-${i}`), svrzGameId: g.svrz_game_id ?? null, number: g.number ?? null, seq: i + 1, sideCount: side.length, booking: bk }
  })
  for (const b of sideBookings) {
    if (used.has(String(b.id))) continue
    legs.push({ key: `bk-${b.id}`, svrzGameId: b.svrz_game_id ?? null, number: null, seq: legs.length + 1, sideCount: side.length, booking: b })
  }
  if (legs.length === 0) {
    legs.push({ key: isHome ? 'legacy-home' : 'legacy-away', svrzGameId: null, number: null, seq: 1, sideCount: 1 })
  }
  return legs.map((l) => ({ ...l, sideCount: legs.length }))
}

// Pre-fill values for the manual-booking form when a leg already has a confirmed
// booking — selecting that fixture starts the fields at the current date/time/hall
// so an overwrite is "tweak the time", not retype from scratch.
function homeLegPrefill(leg: FixtureLeg): ManualFixtureOption['prefill'] | undefined {
  const b = leg.booking
  if (!b || b.status !== 'confirmed') return undefined
  const slot = (typeof b.slot === 'object' ? b.slot : null) as GameSchedulingSlot | null
  if (!slot) return undefined
  return {
    date: String(slot.date).slice(0, 10),
    start_time: gameStartForDate(slot.date, slot.start_time),
    hall: slot.hall != null ? String(slot.hall) : undefined,
  }
}

// Away confirmed bookings store the agreed slot as proposed_datetime_<n> (naive
// wall-clock, e.g. "2026-10-03T18:00", may come back "…Z") — slice it, don't
// tz-convert, to mirror AwayProposalReview.
function awayLegPrefill(leg: FixtureLeg): ManualFixtureOption['prefill'] | undefined {
  const b = leg.booking
  if (!b || b.status !== 'confirmed') return undefined
  const n = b.confirmed_proposal || 1
  const rec = b as unknown as Record<string, unknown>
  const dt = String(rec[`proposed_datetime_${n}`] || '')
  const m = dt.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/)
  if (!m) return undefined
  const place = String(rec[`proposed_place_${n}`] || '')
  return { date: m[1], start_time: m[2] ? `${m[2]}:${m[3]}` : undefined, place: place || undefined }
}

const normName = (s: string | null | undefined) => String(s || '').trim().toLowerCase()

// The season's offer window [start, end] (YYYY-MM-DD) — the configurable
// season_opens / season_closes when set (migration 108), else Sep 1 (first year)
// → Mar 31 (second year) derived from the season name (e.g. "2026/27"). Mirrors
// the backend `seasonOfferWindow`; used to bound the manual-booking date inputs
// so a typo like 10.02.2026 for a 2026/27 season can't be entered.
function computeSeasonWindow(season: GameSchedulingSeason | null): { start: string; end: string } | null {
  if (!season) return null
  const m = String(season.season || '').match(/(\d{4})\D+(\d{2,4})/)
  let dStart: string | null = null
  let dEnd: string | null = null
  if (m) {
    const y1 = parseInt(m[1], 10)
    let y2 = parseInt(m[2], 10)
    if (y2 < 100) y2 = 2000 + y2
    dStart = `${y1}-09-01`
    dEnd = `${y2}-03-31`
  }
  const start = (season.season_opens || dStart)?.slice(0, 10) || null
  const end = (season.season_closes || dEnd)?.slice(0, 10) || null
  return start && end ? { start, end } : null
}

// Read an ISO timestamp's WALL-CLOCK lexically (no tz conversion) as
// dd.mm.yyyy HH:MM — matches how the away date is mirrored into `games`
// (reconcileBookingsToGames extracts the time lexically too), so the modal
// agrees with the member calendar (e.g. 18:00, not a tz-shifted 19:00).
function fixtureWallClock(iso: string | null | undefined): string {
  const s = String(iso || '')
  const d = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!d) return ''
  const tm = s.match(/[T ](\d{2}:\d{2})/)
  return `${d[3]}.${d[2]}.${d[1]}${tm ? ` ${tm[1]}` : ''}`
}

// The "N games" modal lists SVRZ fixtures at their feed date — but an away game
// we've already agreed sits at the unscheduled placeholder until the opponent
// enters it in VM. Overlay the confirmed away booking's agreed date so the modal
// shows the real date, not the placeholder. (Home games keep their feed date —
// it's real once pushed to VM.)
function overlayBookedDates(games: OpponentGame[], bookings: ExpandedBooking[]): OpponentGame[] {
  return games.map((g) => {
    if (g.is_home_kscw || !g.svrz_game_id) return g
    const b = bookings.find((bk) =>
      bk.type === 'away_proposal' && bk.status === 'confirmed' &&
      String(bk.svrz_game_id || '') === String(g.svrz_game_id))
    if (!b) return g
    const dt = (b as unknown as Record<string, string>)[`proposed_datetime_${b.confirmed_proposal || 1}`]
    const real = fixtureWallClock(dt)
    return real ? { ...g, _realDate: real } : g
  })
}

const INVITE_STATUS_VARIANT: Record<InviteStatus, 'info' | 'warning' | 'success' | 'danger' | 'neutral' | 'secondary'> = {
  invited: 'info',
  viewed: 'warning',
  booked: 'success',
  revoked: 'danger',
  expired: 'neutral',
  active: 'secondary',
}

const SOURCE_VARIANT: Record<InviteSource, 'brand' | 'neutral' | 'outline'> = {
  svrz: 'brand',
  self_registration: 'neutral',
  manual: 'outline' as 'neutral',
}

function inviteStatusKey(status: InviteStatus | undefined): string {
  const s = status || 'active'
  return `status${s.charAt(0).toUpperCase()}${s.slice(1)}`
}

function sourceKey(source: InviteSource | undefined): string {
  if (source === 'svrz') return 'sourceSvrz'
  if (source === 'manual') return 'sourceManual'
  return 'sourceSelfRegistration'
}

export default function AdminDashboardPage() {
  const { t } = useTranslation('gameScheduling')
  const { hasAdminAccessToSport, is_spielplaner } = useAuth()
  const { season, isLoading: seasonLoading } = useGameSchedulingSeason()
  const { bookings, opponents, slots, proposalHealth, isLoading, hasLoaded, confirmAwayProposal, confirmHomeProposal, requestNewSlots, saveOpponentNote, manualBooking, deleteBooking, blockSlot, finalizeNotify, vmPush, refetch } = useAdminBookings(season?.id)
  const { data: teams, isLoading: teamsLoading } = useTeams()
  const confirm = useConfirm()
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [notifyingTeam, setNotifyingTeam] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const mailbox = useMailbox(hasAdminAccessToSport('volleyball') || is_spielplaner)

  // Intra-club games (e.g. the H1↔H3 derby) — not bookings, so they don't come
  // through useAdminBookings. Surface them on the overview + per-team calendars.
  const [derbyGames, setDerbyGames] = useState<IntraClubGame[]>([])
  // Tracks the first derby fetch so the page can wait for it before rendering
  // (otherwise the intra-club games pop into the calendars after the spinner).
  const [derbyLoaded, setDerbyLoaded] = useState(false)
  useEffect(() => {
    if (!season?.season) { setDerbyGames([]); setDerbyLoaded(true); return }
    let cancelled = false
    fetchAllItems<IntraClubGame>('games', {
      filter: { season: { _eq: season.season }, home_team: { _starts_with: 'KSC Wiedikon' }, away_team: { _starts_with: 'KSC Wiedikon' } },
      fields: ['id', 'game_id', 'date', 'time', 'home_team', 'away_team', 'kscw_team', 'type'],
    }).then((g) => { if (!cancelled) setDerbyGames(g) })
      .catch(() => { if (!cancelled) setDerbyGames([]) })
      .finally(() => { if (!cancelled) setDerbyLoaded(true) })
    return () => { cancelled = true }
  }, [season?.season])

  // VolleyManager cross-check for confirmed away games (green/yellow/red), keyed
  // by booking id. Re-fetched when bookings change (e.g. after a confirm).
  const [awayVmChecks, setAwayVmChecks] = useState<Record<string, AwayVmCheck>>({})
  // Away fixtures VolleyManager has scheduled but we hold no confirmed booking.
  const [awayVmUnbooked, setAwayVmUnbooked] = useState<AwayVmUnbooked[]>([])
  useEffect(() => {
    if (!season?.id) { setAwayVmChecks({}); setAwayVmUnbooked([]); return }
    let cancelled = false
    kscwApi<{ checks: Record<string, AwayVmCheck>; unbooked?: AwayVmUnbooked[] }>(`/admin/terminplanung/away-vm-check?season=${season.id}`)
      .then((r) => { if (!cancelled) { setAwayVmChecks(r.checks || {}); setAwayVmUnbooked(r.unbooked || []) } })
      .catch(() => { if (!cancelled) { setAwayVmChecks({}); setAwayVmUnbooked([]) } })
    return () => { cancelled = true }
  }, [season?.id, bookings])

  const [mailboxFocus, setMailboxFocus] = useState<GameSchedulingOpponent | null>(null)

  // Wrap confirm so a rejected booking (Saturday cap, cross-team, gap, Döltschi,
  // slot taken, hall closure…) surfaces its reason instead of failing silently.
  const confirmErrMsg = (err: unknown) => {
    const body = (err as { body?: { error?: string } })?.body
    return body?.error || (err instanceof Error ? err.message : String(err))
  }
  const handleConfirmHome = async (bookingId: string, n: number, notes?: string) => {
    try {
      await confirmHomeProposal(bookingId, n, notes)
      toast.success(t('confirmed'))
    } catch (err) {
      toast.error(confirmErrMsg(err))
      // Refetch so a stale booking id (opponent re-proposed → new id) or a slot
      // that changed underneath self-heals instead of staying broken.
      void refetch()
      throw err
    }
  }
  const handleConfirmAway = async (bookingId: string, n: number, notes?: string) => {
    try {
      await confirmAwayProposal(bookingId, n, notes)
      toast.success(t('confirmed'))
    } catch (err) {
      toast.error(confirmErrMsg(err))
      void refetch()
      throw err
    }
  }
  // Delete a confirmed game (frees the slot + clears the member calendar) so the
  // matchup can be rescheduled. Warns when the game was already pushed to VM,
  // since deletion here can't remove it from VolleyManager.
  const handleDeleteBooking = async (booking: ExpandedBooking) => {
    const pushed = booking.type === 'home_slot_pick'
      && ['pushed', 'pushed_no_hall'].includes(String(booking.vm_push_status || ''))
    const message = pushed
      ? `${t('deleteGameConfirm')}\n\n${t('deleteGameVmWarning')}`
      : t('deleteGameConfirm')
    if (!(await confirm({ message }))) return
    try {
      await deleteBooking(booking.id)
      toast.success(t('gameDeleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      void refetch()
    }
  }

  // Adopt VolleyManager's date/time (+gym) for one away game — overwrite an
  // existing confirmed slot (bookingId) or create one from VM (opponentId +
  // svrzGameId). refetch() updates `bookings`, which re-runs away-vm-check.
  const [vmSyncing, setVmSyncing] = useState<string | null>(null)
  const handleSyncFromVm = async (args: { key: string; bookingId?: string; opponentId?: string; svrzGameId?: string | null }) => {
    setVmSyncing(args.key)
    try {
      await kscwApi('/admin/terminplanung/sync-away-from-vm', {
        method: 'POST',
        body: args.bookingId
          ? { booking_id: args.bookingId }
          : { opponent_id: args.opponentId, svrz_game_id: args.svrzGameId },
      })
      toast.success(t('vmSynced'))
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setVmSyncing(null)
    }
  }

  // One-click refresh (SVRZ fixtures/contacts + VM team names/leagues) with live
  // progress — see SyncNowButton / useSyncProgress. refetch() pulls the fresh
  // bookings once the background sync settles.

  // Send a reminder invite to every opponent still missing a home/away game.
  // Two-step: a dry run lists who would be emailed (so the admin confirms the
  // exact set), then the real send. Fully-scheduled opponents are skipped.
  const [reminding, setReminding] = useState(false)
  const [remindingTeam, setRemindingTeam] = useState<string | null>(null)
  // teamId omitted → season-wide (all teams). teamId set → only that team's
  // opponents (the remind endpoint accepts an optional team_id).
  const handleSendReminders = async (teamId?: string) => {
    if (!season) return
    if (teamId) setRemindingTeam(teamId); else setReminding(true)
    const body: { season_id: string; team_id?: string } = { season_id: season.id }
    if (teamId) body.team_id = teamId
    try {
      const preview = await kscwApi<{ previews: Array<{ team_name: string; kscw: string; missing: { home: number; away: number } }> }>(
        '/admin/terminplanung/invites/remind', { method: 'POST', body: { ...body, dry_run: true } })
      const list = preview.previews || []
      if (list.length === 0) { toast.info(t('remindNonePending')); return }
      const lines = list.map((p) => {
        const miss = [p.missing.home ? `${p.missing.home}H` : '', p.missing.away ? `${p.missing.away}A` : ''].filter(Boolean).join('+')
        return `• KSCW ${p.kscw} / ${p.team_name} (${miss})`
      }).join('\n')
      if (!(await confirm({ message: `${t('remindConfirm', { count: list.length })}\n\n${lines}` }))) return
      const res = await kscwApi<{ sent: number; failed: unknown[] }>(
        '/admin/terminplanung/invites/remind', { method: 'POST', body })
      toast.success(t('remindSent', { count: res.sent }))
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      if (teamId) setRemindingTeam(null); else setReminding(false)
    }
  }

  const handleFinalizeNotify = async (teamId: string, pendingCount: number) => {
    if (!season) return
    if (pendingCount > 0 && !(await confirm({ message: t('finalizeNotifyConfirmPending', { count: pendingCount }) }))) return
    setNotifyingTeam(teamId)
    try {
      // Attach the team's schedule as Excel + PDF so coaches can check the dates
      // directly. Best-effort: a generation hiccup must not block the email — the
      // body already lists every game.
      let attachments: { filename: string; content_base64: string; content_type: string }[] = []
      try {
        const teamName = volleyballTeams.find((tm) => String(tm.id) === String(teamId))?.name
        const rows = await buildScheduleRows({ bookings, opponents, slots, teams: volleyballTeams, season, teamId })
        if (rows.length) {
          const title = teamName ? `KSCW ${teamName} schedule` : 'KSCW game schedule'
          const [xlsx, pdf] = await Promise.all([buildScheduleXlsx(rows), buildSchedulePdf(rows, title)])
          attachments = [
            { filename: exportFilename('xlsx', teamName), content_base64: bytesToBase64(xlsx), content_type: XLSX_MIME },
            { filename: exportFilename('pdf', teamName), content_base64: bytesToBase64(pdf), content_type: PDF_MIME },
          ]
        }
      } catch { /* fall through — send the email without attachments */ }
      const res = await finalizeNotify(teamId, season.id, attachments)
      toast.success(t('finalizeNotifySent', { home: res.home, away: res.away }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setNotifyingTeam(null)
    }
  }

  // Contact sets for every opponent (across all teams), each tagged with its
  // KSCW pairing short name. Mailbox matching disambiguates opponent rows that
  // share a club's contacts (e.g. Volley Uster D1 vs H4) by these needles, so a
  // "Volley Uster H4 – KSC Wiedikon Legends" mail no longer lands on D1's thread.
  // Declared before the early returns below so the hook order stays stable.
  const opponentContacts = useMemo<OpponentContacts[]>(
    () => opponents.map((o) => {
      const team = (teams || []).find((tm) => String(tm.id) === String(o.kscw_team))
      return { opp: o, contacts: contactAddressSet(o), aliases: team?.name ? [team.name] : [] }
    }),
    [opponents, teams],
  )

  // Selectable date window for manual bookings — guards against date typos
  // (e.g. 10.02.2026 for a 2026/27 season).
  const manualDateWindow = useMemo(() => computeSeasonWindow(season), [season])

  if (!hasAdminAccessToSport('volleyball') && !is_spielplaner) {
    return <Navigate to="/" replace />
  }

  // Only the very first load blanks to a spinner. After data has loaded once,
  // confirming a proposal refetches in the background without flashing the page.
  // Wait for ALL the content data (season, bookings, teams, intra-club games) so
  // the tables/cards render fully formed instead of popping in piecemeal.
  if (seasonLoading || (isLoading && !hasLoaded) || teamsLoading || !derbyLoaded) return <LoadingSpinner />

  if (!season) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400">
        <p>{t('noSeasonConfigured')}</p>
      </div>
    )
  }

  const volleyballTeams = (teams || []).filter(isSchedulableTeam)

  const getTeamOpponents = (teamId: string) =>
    opponents.filter(o => String(o.kscw_team) === String(teamId))

  const getTeamSlots = (teamId: string) =>
    slots.filter(s => String(s.kscw_team) === String(teamId))

  // Bookings belonging to this team — both legs reference the opponent, whose
  // kscw_team is the team. Scopes the per-team calendar to its own games.
  const getTeamBookings = (teamId: string) =>
    bookings.filter(b => {
      const opp = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent) : null
      return opp ? String(opp.kscw_team) === String(teamId) : false
    })

  // Dashboard search: matches opponent/club/contact names and any booking date
  // of the opponent (booked or proposed, home or away) in dd.mm.yyyy, dd.mm.yy
  // and yyyy-mm-dd forms. Active search filters the accordion to matching
  // opponent cards and force-expands the teams that still have matches.
  const searchQuery = search.trim().toLowerCase()
  const slotByIdAll = new Map(slots.map(s => [String(s.id), s]))
  const dateForms = (ymd: unknown): string[] => {
    const m = String(ymd ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    return m ? [`${m[3]}.${m[2]}.${m[1]}`, `${m[3]}.${m[2]}.${m[1].slice(2)}`, `${m[1]}-${m[2]}-${m[3]}`] : []
  }
  const opponentSearchText = (opp: GameSchedulingOpponent): string => {
    const parts: string[] = [opp.team_name || '', opp.club_name || '', opp.contact_name || '', opp.contact_email || '']
    for (const b of bookings) {
      const oid = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent
      if (String(oid) !== String(opp.id)) continue
      const rec = b as unknown as Record<string, unknown>
      if (b.type === 'home_slot_pick') {
        for (const key of ['slot', 'proposed_slot_1', 'proposed_slot_2', 'proposed_slot_3']) {
          const ref = rec[key]
          if (ref == null) continue
          const sl = typeof ref === 'object' ? (ref as GameSchedulingSlot) : slotByIdAll.get(String(ref))
          if (sl?.date) parts.push(...dateForms(sl.date))
        }
      } else {
        for (const n of [1, 2, 3]) {
          const dt = rec[`proposed_datetime_${n}`]
          if (dt) parts.push(...dateForms(String(dt)))
        }
      }
    }
    return parts.join(' ').toLowerCase()
  }
  const opponentMatches = (opp: GameSchedulingOpponent) => !searchQuery || opponentSearchText(opp).includes(searchQuery)
  const teamMatchedOpponents = (teamId: string) => getTeamOpponents(teamId).filter(opponentMatches)
  const visibleTeams = searchQuery
    ? volleyballTeams.filter(team => teamMatchedOpponents(team.id).length > 0)
    : volleyballTeams

  // Opponents (excluding revoked/expired) still missing a confirmed home or away
  // leg — mirrors the backend's "Noch offen" count for the finalize warning.
  const teamPending = (teamId: string) =>
    getTeamOpponents(teamId)
      .filter(o => !['revoked', 'expired'].includes(String(o.status)))
      .filter(o => {
        const ob = bookings.filter(b => {
          const oid = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent
          return String(oid) === String(o.id)
        })
        const home = ob.find(b => b.type === 'home_slot_pick')?.status === 'confirmed'
        const away = ob.find(b => b.type === 'away_proposal')?.status === 'confirmed'
        return !home || !away
      }).length

  const teamStats = (teamId: string) => {
    const teamSlots = getTeamSlots(teamId)
    const booked = teamSlots.filter(s => s.status === 'booked').length
    const opps = getTeamOpponents(teamId)
    const byStatus = {
      invited: 0, viewed: 0, booked: 0, revoked: 0, expired: 0, active: 0,
    } as Record<InviteStatus, number>
    for (const o of opps) {
      const s = (o.status as InviteStatus) || 'active'
      if (s in byStatus) byStatus[s]++
    }
    // Actions awaiting the spielplaner: opponent proposals (home slot pick /
    // away proposal) still `pending` — each is one slot left to confirm.
    const activeOppIds = new Set(
      opps
        .filter(o => !['revoked', 'expired'].includes(String(o.status)))
        .map(o => String(o.id))
    )
    const toConfirm = bookings.filter(b => {
      if (b.status !== 'pending') return false
      const oid = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent
      return activeOppIds.has(String(oid))
    }).length
    // Traffic light: blue = opponents who haven't proposed yet (ball in their
    // court), yellow = proposals awaiting confirmation (toConfirm), green =
    // confirmed games.
    const oppWithBooking = new Set(
      bookings.map(b => String(typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent))
    )
    const notProposed = [...activeOppIds].filter(id => !oppWithBooking.has(id)).length
    const confirmedLeg = (type: 'home_slot_pick' | 'away_proposal') =>
      bookings.filter(b => {
        if (b.type !== type || b.status !== 'confirmed') return false
        const oid = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent
        return activeOppIds.has(String(oid))
      }).length
    const homeConfirmed = confirmedLeg('home_slot_pick')
    const awayConfirmed = confirmedLeg('away_proposal')
    const confirmed = homeConfirmed + awayConfirmed
    // Each active opponent = one home leg + one away leg to schedule.
    const gamesTotal = activeOppIds.size
    // Saturday game counters: confirmed HOME games are booked slots on a
    // Saturday; confirmed AWAY games are confirmed away_proposals whose chosen
    // datetime is a Saturday. Total = home + away.
    const isSat = (d: string | null | undefined) =>
      !!d && new Date(`${String(d).slice(0, 10)}T00:00:00Z`).getUTCDay() === 6
    const homeSat = teamSlots.filter(s => s.status === 'booked' && isSat(s.date)).length
    const oppIdSet = new Set(opps.map(o => String(o.id)))
    const awaySat = bookings.filter(b => {
      if (b.type !== 'away_proposal' || b.status !== 'confirmed' || !b.confirmed_proposal) return false
      const oid = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent
      if (!oppIdSet.has(String(oid))) return false
      const dt = (b as unknown as Record<string, unknown>)[`proposed_datetime_${b.confirmed_proposal}`] as string | undefined
      return isSat(dt)
    }).length
    return {
      booked, total: teamSlots.length, opponents: opps.length, byStatus, toConfirm,
      notProposed, confirmed, homeConfirmed, awayConfirmed, gamesTotal,
      homeSat, awaySat, satTotal: homeSat + awaySat,
    }
  }

  // Season-wide rollup across all schedulable teams — drives the top summary.
  const summary = volleyballTeams.reduce((acc, team) => {
    const s = teamStats(team.id)
    acc.homeConfirmed += s.homeConfirmed
    acc.awayConfirmed += s.awayConfirmed
    acc.gamesTotal += s.gamesTotal
    acc.toConfirm += s.toConfirm
    acc.notProposed += s.notProposed
    return acc
  }, { homeConfirmed: 0, awayConfirmed: 0, gamesTotal: 0, toConfirm: 0, notProposed: 0 })

  // Confirmed away games whose agreed date/time DIFFERS from VolleyManager (red).
  // "Not updated yet" (unset) is fine and excluded — only genuine conflicts. The
  // away-vm-check endpoint already scopes this to the teams the user manages.
  const awayMismatches = (() => {
    const entries = Object.entries(awayVmChecks).filter(([, c]) => c.status === 'mismatch')
    if (!entries.length) return []
    const oppById = new Map(opponents.map((o) => [String(o.id), o]))
    const teamNameById = new Map(volleyballTeams.map((tm) => [String(tm.id), tm.name]))
    const bookingById = new Map(bookings.map((b) => [String(b.id), b]))
    return entries.map(([bid, c]) => {
      const b = bookingById.get(bid)
      const oid = b ? String(typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent) : ''
      const opp = oid ? oppById.get(oid) : null
      return {
        bid,
        opp: opp ? (opp.team_name || opp.club_name) : `#${bid}`,
        team: opp ? (teamNameById.get(String(opp.kscw_team)) || '') : '',
        agreed: c.agreed,
        vm: c.vm,
      }
    })
  })()

  // Away fixtures VolleyManager has scheduled but we never confirmed a slot —
  // shown in the same alert with a one-click "create from VM" Sync button.
  const awayUnbooked = (() => {
    if (!awayVmUnbooked.length) return []
    const oppById = new Map(opponents.map((o) => [String(o.id), o]))
    const teamNameById = new Map(volleyballTeams.map((tm) => [String(tm.id), tm.name]))
    return awayVmUnbooked.map((u) => {
      const opp = oppById.get(String(u.opponent_id))
      return {
        key: `${u.opponent_id}:${u.svrz_game_id}`,
        opponentId: String(u.opponent_id),
        svrzGameId: String(u.svrz_game_id),
        opp: opp ? (opp.team_name || opp.club_name) : `#${u.opponent_id}`,
        team: opp ? (teamNameById.get(String(opp.kscw_team)) || '') : '',
        vm: u.vm,
      }
    })
  })()

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('dashboardTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{formatSeasonShort(season.season)}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SyncNowButton seasonName={season.season} onDone={refetch} />
          <Button size="sm" variant="outline" onClick={() => handleSendReminders()} disabled={reminding}>
            {reminding ? '…' : t('sendReminders')}
          </Button>
          <ExcelExportButton bookings={bookings} opponents={opponents} slots={slots} teams={volleyballTeams} season={season} />
        </div>
      </div>

      {/* Season summary — confirmed home/away vs total, plus what's outstanding */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('summaryHome')}</p>
          <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">
            {summary.homeConfirmed}<span className="text-base font-medium text-gray-400 dark:text-gray-500">/{summary.gamesTotal}</span>
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('summaryAway')}</p>
          <p className="mt-1 text-2xl font-bold text-green-600 dark:text-green-400 tabular-nums">
            {summary.awayConfirmed}<span className="text-base font-medium text-gray-400 dark:text-gray-500">/{summary.gamesTotal}</span>
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('summaryToConfirm')}</p>
          <p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">{summary.toConfirm}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('summaryAwaiting')}</p>
          <p className="mt-1 text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{summary.notProposed}</p>
        </div>
      </div>

      {/* Away games that diverge from VolleyManager (red) or that VM has scheduled
          but we never booked (amber) — each with a one-click "Sync with VM".
          "VM not updated yet" (unset/placeholder) is intentionally NOT flagged. */}
      {(awayMismatches.length > 0 || awayUnbooked.length > 0) && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
          <p className="flex items-center gap-2 text-sm font-semibold text-red-700 dark:text-red-300">
            <span aria-hidden>⚠</span>
            {t('awayVmMismatchAlert', { count: awayMismatches.length + awayUnbooked.length })}
          </p>
          <ul className="mt-2 space-y-1.5">
            {awayMismatches.map((m) => (
              <li key={m.bid} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-red-700 dark:text-red-300">
                <span className="font-medium">{[m.team, m.opp].filter(Boolean).join(' · ')}</span>
                <span className="text-red-600/80 dark:text-red-400/80">{t('awayVmMismatchRow', { agreed: m.agreed || '—', vm: m.vm || '—' })}</span>
                <button
                  type="button"
                  onClick={() => handleSyncFromVm({ key: `b:${m.bid}`, bookingId: m.bid })}
                  disabled={vmSyncing === `b:${m.bid}`}
                  className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-gray-700"
                >
                  {vmSyncing === `b:${m.bid}` ? '…' : t('syncWithVm')}
                </button>
              </li>
            ))}
            {awayUnbooked.map((u) => (
              <li key={u.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-red-700 dark:text-red-300">
                <span className="font-medium">{[u.team, u.opp].filter(Boolean).join(' · ')}</span>
                <span className="text-red-600/80 dark:text-red-400/80">{t('awayVmUnbookedRow', { vm: u.vm })}</span>
                <button
                  type="button"
                  onClick={() => handleSyncFromVm({ key: `u:${u.key}`, opponentId: u.opponentId, svrzGameId: u.svrzGameId })}
                  disabled={vmSyncing === `u:${u.key}`}
                  className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-gray-800 dark:text-red-300 dark:hover:bg-gray-700"
                >
                  {vmSyncing === `u:${u.key}` ? '…' : t('syncWithVm')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Season overview calendar — all proposed/confirmed/blocked slots */}
      <SchedulingCalendar slots={slots} bookings={bookings} teams={volleyballTeams} season={season} games={derbyGames} showAbsences />

      {/* Search across all teams: opponent / club / contact / booking dates */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none sm:max-w-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500"
        />
        {searchQuery && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('searchMatchCount', { count: visibleTeams.reduce((n, team) => n + teamMatchedOpponents(team.id).length, 0) })}
          </span>
        )}
      </div>

      {/* Team overview accordion */}
      <div className="space-y-3">
        {searchQuery && visibleTeams.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('searchNoResults')}</p>
        )}
        {visibleTeams.map(team => {
          const stats = teamStats(team.id)
          const isExpanded = searchQuery ? true : expandedTeam === team.id
          // Matchups still missing a confirmed game — the canonical "is this team
          // done?" metric (same one driving the finalize-ready text). A team can
          // have all its existing bookings confirmed yet still be missing legs that
          // were never proposed, so this is the truthful "remaining" count.
          const pending = teamPending(team.id)
          const finished = stats.gamesTotal > 0 && pending === 0

          return (
            <div
              key={team.id}
              className={`overflow-hidden rounded-lg border ${
                finished
                  ? 'border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-900/20'
                  : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'
              }`}
            >
              {/* Team header */}
              <button
                onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                className={`flex w-full items-center justify-between px-4 py-3 text-left ${
                  finished
                    ? 'hover:bg-green-100 dark:hover:bg-green-900/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: team.color || '#6b7280' }}
                  />
                  <span className="truncate font-semibold text-gray-900 dark:text-gray-100">{team.name}</span>
                  {team.full_name && (
                    <span className="hidden truncate text-sm text-gray-500 sm:inline dark:text-gray-400">
                      {team.full_name}
                    </span>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-3 text-xs text-gray-600 sm:text-sm dark:text-gray-400">
                  {stats.gamesTotal > 0 && (
                    <span className="hidden whitespace-nowrap sm:inline" title={t('homeAwayCounterHint')}>
                      {t('homeAwayCounter', { hc: stats.homeConfirmed, ac: stats.awayConfirmed, total: stats.gamesTotal })}
                    </span>
                  )}
                  {stats.satTotal > 0 && (
                    <span className="whitespace-nowrap" title={t('saturdayCounterHint')}>
                      {t('saturdayCounter', { home: stats.homeSat, away: stats.awaySat })}
                    </span>
                  )}
                  {stats.opponents > 0 && (
                    <span className="hidden sm:inline">
                      {t('opponentCount', { count: stats.opponents })}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {pending > 0 && (
                      <Badge variant="info" size="sm" title={t('remainingGamesHint')}>
                        {pending}
                      </Badge>
                    )}
                    {stats.toConfirm > 0 && (
                      <Badge variant="warning" size="sm" title={t('statusToConfirm')}>
                        {stats.toConfirm}
                      </Badge>
                    )}
                  </div>
                  <span className="text-lg">{isExpanded ? '▾' : '▸'}</span>
                </div>
              </button>

              {/* Expanded content — while searching, skip the calendar +
                  finalize row so the matching opponent cards stand alone. */}
              {isExpanded && (
                <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700">
                  {!searchQuery && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {teamPending(team.id) > 0
                        ? t('finalizeNotifyPending', { count: teamPending(team.id) })
                        : t('finalizeNotifyReady')}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <TeamAvailabilityDialog
                        kscwTeamId={team.id}
                        kscwTeamName={team.name}
                        seasonId={season.id}
                        seasonName={season.season}
                      />
                      <button
                        type="button"
                        onClick={() => handleFinalizeNotify(team.id, teamPending(team.id))}
                        disabled={notifyingTeam === team.id || stats.opponents === 0}
                        className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        {notifyingTeam === team.id ? t('finalizeNotifySending') : t('finalizeNotify')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSendReminders(team.id)}
                        disabled={remindingTeam === team.id || stats.opponents === 0}
                        className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      >
                        {remindingTeam === team.id ? '…' : t('sendReminder')}
                      </button>
                      {/* Per-team Excel / PDF export of just this team's games. */}
                      <ExcelExportButton
                        bookings={bookings}
                        opponents={opponents}
                        slots={slots}
                        teams={volleyballTeams}
                        season={season}
                        teamId={team.id}
                        teamName={team.name}
                        compact
                      />
                    </div>
                  </div>
                  )}
                  {/* This team's own calendar — proposed + confirmed home/away
                      games, blocked + open slots, scoped to the team. */}
                  {!searchQuery && (
                  <div className="mb-4">
                    <SchedulingCalendar
                      slots={getTeamSlots(team.id)}
                      bookings={getTeamBookings(team.id)}
                      teams={[team]}
                      season={season}
                      games={derbyGames.filter((g) => String(g.kscw_team) === String(team.id))}
                      title={t('teamCalendarTitle')}
                      showAbsences
                    />
                  </div>
                  )}
                  <TeamBookingsContent
                    kscwTeamId={team.id}
                    kscwTeamName={team.name}
                    seasonId={season.id}
                    opponents={searchQuery ? teamMatchedOpponents(team.id) : getTeamOpponents(team.id)}
                    bookings={bookings}
                    slots={getTeamSlots(team.id)}
                    proposalHealth={proposalHealth}
                    onConfirmAway={handleConfirmAway}
                    onConfirmHome={handleConfirmHome}
                    onDeleteBooking={handleDeleteBooking}
                    onVmPush={vmPush}
                    onRequestNewSlots={requestNewSlots}
                    onSaveOpponentNote={saveOpponentNote}
                    onManualBooking={manualBooking}
                    dateWindow={manualDateWindow}
                    onBlockSlot={blockSlot}
                    mailboxConfigured={mailbox.configured === true}
                    emailsFor={(opp) => messagesForOpponentThread(mailbox.messages, opp, opponentContacts)}
                    onOpenMailbox={setMailboxFocus}
                    awayVmChecks={awayVmChecks}
                    awayVmUnbooked={awayVmUnbooked}
                    onSyncVm={handleSyncFromVm}
                    vmSyncing={vmSyncing}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Spielplanung mailbox — synced volleyball@spielplanung.kscw.ch */}
      <MailboxPanel
        mailbox={mailbox}
        opponentContacts={opponentContacts}
        focusOpponent={mailboxFocus}
        onClearFocus={() => setMailboxFocus(null)}
        seasonName={season.season}
        kscwTeamLabelFor={(opp) => {
          const team = volleyballTeams.find((tm) => String(tm.id) === String(opp.kscw_team))
          return team?.full_name || (team?.name ? `KSC Wiedikon ${team.name}` : 'KSC Wiedikon')
        }}
      />
    </div>
  )
}

function TeamBookingsContent({
  kscwTeamId,
  kscwTeamName,
  seasonId,
  opponents: teamOpponents,
  bookings: allBookings,
  slots: teamSlots,
  proposalHealth,
  onConfirmAway,
  onConfirmHome,
  onDeleteBooking,
  onVmPush,
  onRequestNewSlots,
  onSaveOpponentNote,
  onManualBooking,
  dateWindow,
  mailboxConfigured,
  emailsFor,
  onOpenMailbox,
  awayVmChecks,
  awayVmUnbooked,
  onSyncVm,
  vmSyncing,
}: {
  kscwTeamId: string
  kscwTeamName: string
  seasonId: string
  opponents: GameSchedulingOpponent[]
  bookings: ExpandedBooking[]
  slots: GameSchedulingSlot[]
  proposalHealth: ProposalHealthEntry[]
  onConfirmAway: (bookingId: string, proposalNumber: number, notes?: string) => Promise<void>
  onConfirmHome: (bookingId: string, proposalNumber: number, notes?: string) => Promise<void>
  onDeleteBooking: (booking: ExpandedBooking) => Promise<void>
  onVmPush: (bookingId: string, svrzPersistenceId?: string) => Promise<void>
  onRequestNewSlots: (opponentId: string | number, bookingId?: string | number) => Promise<void>
  onSaveOpponentNote: (opponentId: string | number, kscwNote: string) => Promise<void>
  onManualBooking: (
    opponentId: string | number,
    legs: {
      home?: { date: string; start_time: string; end_time?: string; hall: number | string; svrz_game_id?: string }
      away?: { date: string; start_time?: string; place?: string; svrz_game_id?: string }
    },
  ) => Promise<void>
  dateWindow: { start: string; end: string } | null
  onBlockSlot: (slotId: string, action: 'block' | 'unblock') => Promise<void>
  mailboxConfigured: boolean
  emailsFor: (opp: GameSchedulingOpponent) => MailboxMessage[]
  onOpenMailbox: (opp: GameSchedulingOpponent) => void
  awayVmChecks: Record<string, AwayVmCheck>
  awayVmUnbooked: AwayVmUnbooked[]
  onSyncVm: (args: { key: string; bookingId?: string; opponentId?: string; svrzGameId?: string | null }) => Promise<void>
  vmSyncing: string | null
}) {
  const { t } = useTranslation('gameScheduling')
  // VM fixtures with a date but no booking, keyed `${opponent}:${svrz_game_id}`
  // so an unbooked away leg can offer a one-click "create from VM".
  const unbookedByKey = new Map(awayVmUnbooked.map((u) => [`${u.opponent_id}:${u.svrz_game_id}`, u]))
  const { data: halls } = useHalls()
  const hallsById = new Map((halls || []).map((h) => [String(h.id), h.name]))

  // Copy this opponent's tokenized scheduling link — mirrors the invites
  // section's "Copy link" (the per-opponent /terminplanung/<token> URL the
  // opponent uses to view + propose dates).
  const copyOpponentLink = async (opp: GameSchedulingOpponent) => {
    const url = `${window.location.origin}/terminplanung/${opp.token}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('linkCopied'))
    } catch {
      toast.error(url)
    }
  }

  // Per-opponent inline email thread — collapsed by default so a long mail
  // history doesn't bloat the card. Full read/reply still opens the bottom panel.
  const [openEmails, setOpenEmails] = useState<Set<string>>(new Set())
  const toggleEmails = (id: string) =>
    setOpenEmails((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // Clubs can carry a dozen+ Spielplan contacts (comma-joined) — collapse the
  // list by default so it doesn't balloon the card.
  const [openContacts, setOpenContacts] = useState<Set<string>>(new Set())
  const toggleContacts = (id: string) =>
    setOpenContacts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  // SVRZ fixtures per opponent (the games still to schedule) — loaded lazily when
  // this team's accordion expands. Matched to opponent rows by normalised team
  // name. Best-effort: a hiccup just hides the "N games" buttons.
  const [gamesByName, setGamesByName] = useState<Map<string, OpponentGame[]>>(new Map())
  const [gamesFor, setGamesFor] = useState<{ label: string; games: OpponentGame[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const resp = await kscwApi(`/admin/terminplanung/invites/svrz-clubs?kscw_team=${kscwTeamId}&season=${seasonId}`) as { clubs?: SvrzClub[] }
        if (cancelled) return
        const map = new Map<string, OpponentGame[]>()
        for (const c of resp?.clubs || []) {
          if (c.team_name) map.set(normName(c.team_name), c.games || [])
          if (c.club_name) map.set(normName(c.club_name), c.games || [])
        }
        setGamesByName(map)
      } catch { /* games disclosure just won't show */ }
    })()
    return () => { cancelled = true }
  }, [kscwTeamId, seasonId])
  const hallOptions = (halls || []).map((h) => ({ id: h.id, name: h.name }))
  const slotsById = new Map(teamSlots.map((s) => [String(s.id), s]))
  // The gym this team plays its home games in — the hall its currently-open slots
  // use (most common among available slots). Pre-selected + floated to the top of
  // the manual-booking hall dropdown so a new home game defaults to the right gym.
  const defaultHomeHall = (() => {
    const counts = new Map<string, number>()
    for (const s of teamSlots) {
      if (s.status !== 'available') continue
      const h = s.hall != null ? String(s.hall) : ''
      if (h) counts.set(h, (counts.get(h) || 0) + 1)
    }
    let best: string | undefined; let bestN = 0
    for (const [h, n] of counts) if (n > bestN) { best = h; bestN = n }
    return best
  })()
  // Home slots are KSCW-hall, shared across this team's opponents and NOT held
  // until confirmed — so the real contention is "another club proposed this same
  // slot". Index: home slot id -> set of opponent ids that proposed it (pending).
  // Scoped to this team's opponents (cross-team home slots can't collide).
  const teamOpponentIds = new Set(teamOpponents.map((o) => String(o.id)))
  const oppIdOf = (b: ExpandedBooking): string =>
    String(typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent)
  const homeSlotProposers = new Map<string, Set<string>>()
  for (const b of allBookings) {
    if (b.status !== 'pending' || b.type !== 'home_slot_pick') continue
    const oid = oppIdOf(b)
    if (!teamOpponentIds.has(oid)) continue
    for (const sid of [b.proposed_slot_1, b.proposed_slot_2, b.proposed_slot_3]) {
      if (sid == null) continue
      const key = String(sid)
      if (!homeSlotProposers.has(key)) homeSlotProposers.set(key, new Set())
      homeSlotProposers.get(key)!.add(oid)
    }
  }
  // Count distinct OTHER opponents (≠ this one) who proposed this exact home slot.
  const homeAlsoProposedBy = (slotId: string | number | null | undefined, opponentId: string) => {
    if (slotId == null) return 0
    const set = homeSlotProposers.get(String(slotId))
    if (!set) return 0
    let n = 0
    for (const oid of set) if (oid !== opponentId) n++
    return n
  }

  // Live proposal validity, keyed by booking id (Item 3).
  const healthByBooking = new Map<string, ProposalHealthEntry>()
  for (const h of proposalHealth) healthByBooking.set(String(h.booking_id), h)

  if (teamOpponents.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">{t('noBookingsYet')}</p>
  }

  return (
    <>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {teamOpponents.map(opp => {
        const oppBookings = allBookings.filter(b => {
          const oid = typeof b.opponent === 'object' ? (b.opponent as GameSchedulingOpponent).id : b.opponent
          return String(oid) === String(opp.id)
        })
        const inviteStatus = (opp.status as InviteStatus) || 'active'
        const source = (opp.source as InviteSource) || 'self_registration'
        const oppGames = gamesByName.get(normName(opp.team_name)) || gamesByName.get(normName(opp.club_name)) || []

        // One leg per fixture — a pairing can be played 2-3× (junior triple
        // round-robin), so each side may carry several games to schedule.
        const homeLegs = buildFixtureLegs(oppGames, oppBookings, true)
        const awayLegs = buildFixtureLegs(oppGames, oppBookings, false)

        // Colour the card by how far this matchup's scheduling has got: ALL
        // games confirmed → green, some → yellow, none → red. Subtle tints.
        const allLegs = [...homeLegs, ...awayLegs]
        const confirmedCount = allLegs.filter(l => l.booking?.status === 'confirmed').length
        const cardClass =
          confirmedCount === allLegs.length
            ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20'
            : confirmedCount >= 1
              ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-900/20'
              : 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-900/20'

        return (
          <div
            key={opp.id}
            className={`rounded-md border p-3 ${cardClass}`}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{opp.club_name || opp.team_name}</span>
                  <Badge variant={INVITE_STATUS_VARIANT[inviteStatus]} size="sm">
                    {t(inviteStatusKey(inviteStatus))}
                  </Badge>
                  <Badge variant={SOURCE_VARIANT[source]} size="sm">
                    {t(sourceKey(source))}
                  </Badge>
                  {opp.token && (
                    <button
                      type="button"
                      onClick={() => copyOpponentLink(opp)}
                      className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {t('copyLink')}
                    </button>
                  )}
                  {oppGames.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setGamesFor({ label: opp.team_name || opp.club_name, games: overlayBookedDates(oppGames, oppBookings) })}
                      className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {t('gameCount', { count: oppGames.length })}
                    </button>
                  )}
                  {mailboxConfigured && (
                    emailsFor(opp).length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleEmails(String(opp.id))}
                        aria-expanded={openEmails.has(String(opp.id))}
                        className="inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {t('opponentEmails', { count: emailsFor(opp).length })}
                        <span aria-hidden>{openEmails.has(String(opp.id)) ? '▾' : '▸'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenMailbox(opp)}
                        className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                      >
                        {t('mailboxCompose')}
                      </button>
                    )
                  )}
                </div>
                {(() => {
                  const contactEmails = String(opp.contact_email || '').split(',').map((s) => s.trim()).filter(Boolean)
                  const idStr = String(opp.id)
                  const collapsible = contactEmails.length > 1
                  const open = openContacts.has(idStr)
                  // Two labelled groups when the split is stored; otherwise fall
                  // back to the merged blob (rows not re-synced since migration 110).
                  const hasSplit = !!(String(opp.calendar_contact_email || '').trim() || String(opp.team_contact_email || '').trim())
                  const renderGroup = (label: string, names?: string | null, emails?: string | null) => {
                    const e = String(emails || '').trim()
                    if (!e) return null
                    return (
                      <div className="break-words">
                        <span className="font-medium text-gray-600 dark:text-gray-300">{label}:</span>{' '}
                        {names && <span>{names} </span>}
                        <a href={buildMailtoHref(e)} className="hover:underline">({e})</a>
                      </div>
                    )
                  }
                  return (
                    <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {collapsible && (
                        <button
                          type="button"
                          onClick={() => toggleContacts(idStr)}
                          aria-expanded={open}
                          className="inline-flex items-center gap-0.5 font-medium text-brand-600 hover:underline dark:text-brand-400"
                        >
                          {t('contactCount', { count: contactEmails.length })}
                          <span aria-hidden>{open ? '▾' : '▸'}</span>
                        </button>
                      )}
                      {(!collapsible || open) && (
                        hasSplit ? (
                          <div className={`space-y-1 ${collapsible ? 'mt-1' : ''}`}>
                            {renderGroup(t('calendarResponsibles'), opp.calendar_contact_name, opp.calendar_contact_email)}
                            {renderGroup(t('teamResponsibles'), opp.team_contact_name, opp.team_contact_email)}
                          </div>
                        ) : (
                          <div className={`break-words ${collapsible ? 'mt-1' : ''}`}>
                            {opp.contact_name && <span>{opp.contact_name} </span>}
                            {opp.contact_email && (
                              <a href={buildMailtoHref(opp.contact_email)} className="hover:underline">
                                ({opp.contact_email})
                              </a>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  )
                })()}
                {opp.team_name && opp.team_name !== opp.club_name && (
                  <div className="text-xs text-gray-400 dark:text-gray-500">{opp.team_name}</div>
                )}
              </div>
            </div>

            {mailboxConfigured && openEmails.has(String(opp.id)) && emailsFor(opp).length > 0 && (
              <div className="mb-3 divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                {emailsFor(opp).map((m) => {
                  const unread = m.direction === 'in' && !m.read_at
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onOpenMailbox(opp)}
                      className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    >
                      <span className="whitespace-nowrap text-xs text-gray-400 dark:text-gray-500">
                        {m.date_sent ? formatDateTimeCompact(m.date_sent) : ''}
                      </span>
                      <span className={`min-w-0 flex-1 truncate text-xs ${unread ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-400'}`}>
                        {m.direction === 'out' ? '→ ' : ''}{m.subject || t('mailboxNoSubject')}
                      </span>
                      {unread && <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-600" />}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Home game bookings — one block per fixture */}
              <div className="flex flex-col">
                <h4 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{t('homeBookings')}</h4>
                <div className="flex flex-1 flex-col gap-3">
                  {homeLegs.map((leg) => (
                    <div key={leg.key} className="flex flex-1 flex-col">
                      {(leg.sideCount > 1 || leg.number != null) && (
                        <p className="mb-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {leg.sideCount > 1 ? t('gameN', { number: leg.seq }) : t('manualHomeGame')}
                          {leg.number != null && <span className="font-normal"> · #{leg.number}</span>}
                        </p>
                      )}
                      {leg.booking ? (
                        <HomeProposalReview
                          booking={leg.booking}
                          slotsById={slotsById}
                          hallsById={hallsById}
                          alsoProposedBy={(slotId) => homeAlsoProposedBy(slotId, oppIdOf(leg.booking!))}
                          health={healthByBooking.get(String(leg.booking.id))}
                          onConfirm={onConfirmHome}
                          onVmPush={onVmPush}
                          onRequestNewSlots={() => onRequestNewSlots(opp.id, leg.booking!.id)}
                          onDelete={() => onDeleteBooking(leg.booking!)}
                        />
                      ) : opp.new_slots_requested_at ? (
                        <span className="text-sm text-amber-600 dark:text-amber-400">
                          {t('awaitingNewProposals', { date: formatDateCompactZurich(opp.new_slots_requested_at) })}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-400">{t('pending')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Away game proposals — one block per fixture */}
              <div className="flex flex-col">
                <h4 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{t('awayProposals')}</h4>
                <div className="flex flex-1 flex-col gap-3">
                  {awayLegs.map((leg) => (
                    <div key={leg.key} className="flex flex-1 flex-col">
                      {(leg.sideCount > 1 || leg.number != null) && (
                        <p className="mb-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {leg.sideCount > 1 ? t('gameN', { number: leg.seq }) : t('manualAwayGame')}
                          {leg.number != null && <span className="font-normal"> · #{leg.number}</span>}
                        </p>
                      )}
                      {leg.booking ? (
                        <AwayProposalReview
                          booking={leg.booking}
                          onConfirm={onConfirmAway}
                          vmCheck={awayVmChecks[String(leg.booking.id)] ?? null}
                          onSyncVm={() => onSyncVm({ key: `b:${leg.booking!.id}`, bookingId: String(leg.booking!.id) })}
                          vmSyncing={vmSyncing === `b:${leg.booking.id}`}
                          health={healthByBooking.get(String(leg.booking.id))}
                          onDelete={() => onDeleteBooking(leg.booking!)}
                        />
                      ) : unbookedByKey.has(`${opp.id}:${leg.svrzGameId}`) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-amber-700 dark:text-amber-400">
                            {t('awayVmUnbookedRow', { vm: unbookedByKey.get(`${opp.id}:${leg.svrzGameId}`)!.vm })}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSyncVm({ key: `u:${opp.id}:${leg.svrzGameId}`, opponentId: String(opp.id), svrzGameId: leg.svrzGameId })}
                            disabled={vmSyncing === `u:${opp.id}:${leg.svrzGameId}`}
                            className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:bg-gray-800 dark:text-amber-300 dark:hover:bg-gray-700"
                          >
                            {vmSyncing === `u:${opp.id}:${leg.svrzGameId}` ? '…' : t('syncWithVm')}
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-gray-400">{t('pending')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <OpponentNotes
              opponentNote={opp.opponent_note}
              kscwNote={opp.kscw_note}
              onSave={(note) => onSaveOpponentNote(opp.id, note)}
            />

            <ManualBookingForm
              halls={hallOptions}
              defaultHomeHall={defaultHomeHall}
              homeFixtures={homeLegs.map((leg) => ({
                id: leg.svrzGameId,
                label: leg.sideCount > 1 ? t('gameN', { number: leg.seq }) : t('manualHomeGame'),
                booked: leg.booking?.status === 'confirmed',
                prefill: homeLegPrefill(leg),
              }))}
              awayFixtures={awayLegs.map((leg) => ({
                id: leg.svrzGameId,
                label: leg.sideCount > 1 ? t('gameN', { number: leg.seq }) : t('manualAwayGame'),
                booked: leg.booking?.status === 'confirmed',
                prefill: awayLegPrefill(leg),
              }))}
              minDate={dateWindow?.start}
              maxDate={dateWindow?.end}
              fetchDateContext={async (date) => {
                try {
                  const resp = await kscwApi(`/admin/terminplanung/date-context?kscw_team=${kscwTeamId}&dates=${date}`) as {
                    context?: Record<string, { absences: number; absent_names: string[]; prev_game: { date: string; days: number } | null; next_game: { date: string; days: number } | null }>
                  }
                  const c = resp.context?.[date]
                  return c ? { num: 0, slot_id: 0, valid: true, reason: null, absences: c.absences, absent_names: c.absent_names, prev_game: c.prev_game, next_game: c.next_game } : null
                } catch { return null }
              }}
              onSave={(legs) => onManualBooking(opp.id, legs)}
            />
          </div>
        )
      })}
    </div>

    {/* SVRZ fixtures for one opponent (the games still to schedule). Each row
        stacks date+number / matchup on separate lines so nothing is squeezed
        into a wide single line. */}
    <Dialog open={!!gamesFor} onOpenChange={(o) => { if (!o) setGamesFor(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{gamesFor?.label}</DialogTitle>
          <DialogDescription>
            {t('gameCount', { count: gamesFor?.games.length ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto">
          <Table>
            <TableBody>
              {(gamesFor?.games ?? []).map((g, i) => (
                <TableRow key={i}>
                  <TableCell className="py-2.5">
                    <p className="font-medium">
                      {g._realDate || (g.date ? formatDateTimeCompact(g.date) : '—')}
                      {g.number != null && (
                        <span className="ml-2 font-normal text-gray-400 dark:text-gray-500" title={t('gameNumberHint')}>
                          #{g.number}
                        </span>
                      )}
                    </p>
                    <p className="break-words whitespace-normal text-gray-600 dark:text-gray-400">
                      {g.is_home_kscw
                        ? `KSCW ${kscwTeamName} vs ${gamesFor?.label ?? ''}`
                        : `${gamesFor?.label ?? ''} vs KSCW ${kscwTeamName}`}
                    </p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
