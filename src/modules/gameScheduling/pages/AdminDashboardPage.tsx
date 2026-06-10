import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../../hooks/useAuth'
import { useGameSchedulingSeason } from '../hooks/useGameSchedulingSeason'
import { useAdminBookings } from '../hooks/useAdminBookings'
import { useTeams } from '../../../hooks/useTeams'
import LoadingSpinner from '../../../components/LoadingSpinner'
import AwayProposalReview from '../components/AwayProposalReview'
import HomeProposalReview from '../components/HomeProposalReview'
import OpponentNotes from '../components/OpponentNotes'
import ManualBookingForm from '../components/ManualBookingForm'
import ExcelExportButton from '../components/ExcelExportButton'
import SchedulingCalendar from '../components/SchedulingCalendar'
import { Badge } from '../../../components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { Table, TableBody, TableCell, TableRow } from '../../../components/ui/table'
import type { GameSchedulingOpponent, GameSchedulingSlot, InviteStatus, InviteSource, ProposalHealthEntry } from '../../../types'
import type { ExpandedBooking } from '../hooks/useAdminBookings'
import { formatSeasonShort } from '../utils/formatSeason'
import { formatDateCompactZurich, formatDateTimeCompact } from '../../../utils/dateHelpers'
import { kscwApi } from '../../../lib/api'
import { useHalls } from '../../../hooks/useData'
import { isSchedulableTeam } from '../utils/schedulableTeams'

/** One SVRZ fixture for an opponent (from the svrz-clubs endpoint). */
interface OpponentGame {
  date: string | null
  display_name: string | null
  is_home_kscw: boolean
}
interface SvrzClub {
  club_id: number
  club_name: string
  team_name: string
  game_count: number
  games: OpponentGame[]
}

const normName = (s: string | null | undefined) => String(s || '').trim().toLowerCase()

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
  const { bookings, opponents, slots, proposalHealth, isLoading, hasLoaded, confirmAwayProposal, confirmHomeProposal, requestNewSlots, saveOpponentNote, manualBooking, blockSlot, finalizeNotify } = useAdminBookings(season?.id)
  const { data: teams } = useTeams()
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null)
  const [notifyingTeam, setNotifyingTeam] = useState<string | null>(null)

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
      throw err
    }
  }
  const handleConfirmAway = async (bookingId: string, n: number, notes?: string) => {
    try {
      await confirmAwayProposal(bookingId, n, notes)
      toast.success(t('confirmed'))
    } catch (err) {
      toast.error(confirmErrMsg(err))
      throw err
    }
  }

  const handleFinalizeNotify = async (teamId: string, pendingCount: number) => {
    if (!season) return
    if (pendingCount > 0 && !window.confirm(t('finalizeNotifyConfirmPending', { count: pendingCount }))) return
    setNotifyingTeam(teamId)
    try {
      const res = await finalizeNotify(teamId, season.id)
      toast.success(t('finalizeNotifySent', { home: res.home, away: res.away }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setNotifyingTeam(null)
    }
  }

  if (!hasAdminAccessToSport('volleyball') && !is_spielplaner) {
    return <Navigate to="/" replace />
  }

  // Only the very first load blanks to a spinner. After data has loaded once,
  // confirming a proposal refetches in the background without flashing the page.
  if (seasonLoading || (isLoading && !hasLoaded)) return <LoadingSpinner />

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
    return {
      booked, total: teamSlots.length, opponents: opps.length, byStatus, toConfirm,
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/admin/terminplanung"
            className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            <span aria-hidden>←</span>
            {t('setupTitle')}
          </Link>
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('dashboardTitle')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{formatSeasonShort(season.season)}</p>
        </div>
        <ExcelExportButton bookings={bookings} opponents={opponents} slots={slots} teams={volleyballTeams} />
      </div>

      {/* Season overview calendar — all proposed/confirmed/blocked slots */}
      <SchedulingCalendar slots={slots} bookings={bookings} teams={volleyballTeams} season={season} />

      {/* Team overview accordion */}
      <div className="space-y-3">
        {volleyballTeams.map(team => {
          const stats = teamStats(team.id)
          const isExpanded = expandedTeam === team.id

          return (
            <div
              key={team.id}
              className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            >
              {/* Team header */}
              <button
                onClick={() => setExpandedTeam(isExpanded ? null : team.id)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
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
                  {stats.opponents > 0 && (
                    <span className="hidden sm:inline">
                      {t('opponentCount', { count: stats.opponents })}
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    {stats.byStatus.invited > 0 && (
                      <Badge variant="info" size="sm" title={t('statusInvited')}>
                        {stats.byStatus.invited}
                      </Badge>
                    )}
                    {stats.toConfirm > 0 && (
                      <Badge variant="warning" size="sm" title={t('statusToConfirm')}>
                        {stats.toConfirm}
                      </Badge>
                    )}
                    {stats.byStatus.booked > 0 && (
                      <Badge variant="success" size="sm" title={t('statusBooked')}>
                        {stats.byStatus.booked}
                      </Badge>
                    )}
                  </div>
                  <span className="text-lg">{isExpanded ? '▾' : '▸'}</span>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {teamPending(team.id) > 0
                        ? t('finalizeNotifyPending', { count: teamPending(team.id) })
                        : t('finalizeNotifyReady')}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleFinalizeNotify(team.id, teamPending(team.id))}
                      disabled={notifyingTeam === team.id || stats.opponents === 0}
                      className="inline-flex items-center gap-1.5 self-start rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      {notifyingTeam === team.id ? t('finalizeNotifySending') : t('finalizeNotify')}
                    </button>
                  </div>
                  {/* This team's own calendar — proposed + confirmed home/away
                      games, blocked + open slots, scoped to the team. */}
                  <div className="mb-4">
                    <SchedulingCalendar
                      slots={getTeamSlots(team.id)}
                      bookings={getTeamBookings(team.id)}
                      teams={[team]}
                      season={season}
                      title={t('teamCalendarTitle')}
                    />
                  </div>
                  <TeamBookingsContent
                    kscwTeamId={team.id}
                    kscwTeamName={team.name}
                    seasonId={season.id}
                    opponents={getTeamOpponents(team.id)}
                    bookings={bookings}
                    slots={getTeamSlots(team.id)}
                    proposalHealth={proposalHealth}
                    onConfirmAway={handleConfirmAway}
                    onConfirmHome={handleConfirmHome}
                    onRequestNewSlots={requestNewSlots}
                    onSaveOpponentNote={saveOpponentNote}
                    onManualBooking={manualBooking}
                    onBlockSlot={blockSlot}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
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
  onRequestNewSlots,
  onSaveOpponentNote,
  onManualBooking,
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
  onRequestNewSlots: (opponentId: string | number) => Promise<void>
  onSaveOpponentNote: (opponentId: string | number, kscwNote: string) => Promise<void>
  onManualBooking: (
    opponentId: string | number,
    legs: {
      home?: { date: string; start_time: string; end_time?: string; hall: number | string }
      away?: { date: string; start_time?: string; place?: string }
    },
  ) => Promise<void>
  onBlockSlot: (slotId: string, action: 'block' | 'unblock') => Promise<void>
}) {
  const { t } = useTranslation('gameScheduling')
  const { data: halls } = useHalls()
  const hallsById = new Map((halls || []).map((h) => [String(h.id), h.name]))

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
        const homeBooking = oppBookings.find(b => b.type === 'home_slot_pick')
        const awayBooking = oppBookings.find(b => b.type === 'away_proposal')
        const inviteStatus = (opp.status as InviteStatus) || 'active'
        const source = (opp.source as InviteSource) || 'self_registration'
        const oppGames = gamesByName.get(normName(opp.team_name)) || gamesByName.get(normName(opp.club_name)) || []

        // Colour the card by how far this matchup's scheduling has got:
        // both legs confirmed → green, one leg → yellow, neither → red. Subtle tints.
        const homeConfirmed = homeBooking?.status === 'confirmed'
        const awayConfirmed = awayBooking?.status === 'confirmed'
        const confirmedCount = (homeConfirmed ? 1 : 0) + (awayConfirmed ? 1 : 0)
        const cardClass =
          confirmedCount === 2
            ? 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20'
            : confirmedCount === 1
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
                  {oppGames.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setGamesFor({ label: opp.team_name || opp.club_name, games: oppGames })}
                      className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {t('gameCount', { count: oppGames.length })}
                    </button>
                  )}
                </div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {opp.contact_name && <span>{opp.contact_name} </span>}
                  <a href={`mailto:${opp.contact_email}`} className="hover:underline">
                    ({opp.contact_email})
                  </a>
                </div>
                {opp.team_name && opp.team_name !== opp.club_name && (
                  <div className="text-xs text-gray-400 dark:text-gray-500">{opp.team_name}</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Home game booking */}
              <div>
                <h4 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{t('homeBookings')}</h4>
                {homeBooking ? (
                  <HomeProposalReview
                    booking={homeBooking}
                    slotsById={slotsById}
                    hallsById={hallsById}
                    alsoProposedBy={(slotId) => homeAlsoProposedBy(slotId, oppIdOf(homeBooking))}
                    health={healthByBooking.get(String(homeBooking.id))}
                    onConfirm={onConfirmHome}
                    onRequestNewSlots={() => onRequestNewSlots(opp.id)}
                  />
                ) : opp.new_slots_requested_at ? (
                  <span className="text-sm text-amber-600 dark:text-amber-400">
                    {t('awaitingNewProposals', { date: formatDateCompactZurich(opp.new_slots_requested_at) })}
                  </span>
                ) : (
                  <span className="text-sm text-gray-400">{t('pending')}</span>
                )}
              </div>

              {/* Away game proposals */}
              <div>
                <h4 className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{t('awayProposals')}</h4>
                {awayBooking ? (
                  <AwayProposalReview
                    booking={awayBooking}
                    onConfirm={onConfirmAway}
                  />
                ) : (
                  <span className="text-sm text-gray-400">{t('pending')}</span>
                )}
              </div>
            </div>

            <OpponentNotes
              opponentNote={opp.opponent_note}
              kscwNote={opp.kscw_note}
              onSave={(note) => onSaveOpponentNote(opp.id, note)}
            />

            <ManualBookingForm
              halls={hallOptions}
              hasHome={homeConfirmed}
              hasAway={awayConfirmed}
              onSave={(legs) => onManualBooking(opp.id, legs)}
            />
          </div>
        )
      })}
    </div>

    {/* SVRZ fixtures for one opponent (the games still to schedule). */}
    <Dialog open={!!gamesFor} onOpenChange={(o) => { if (!o) setGamesFor(null) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{gamesFor?.label}</DialogTitle>
          <DialogDescription>
            {t('gameCount', { count: gamesFor?.games.length ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableBody>
              {(gamesFor?.games ?? []).map((g, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap font-medium">
                    {g.date ? formatDateTimeCompact(g.date) : '—'}
                  </TableCell>
                  <TableCell className="text-gray-600 dark:text-gray-400">
                    {g.is_home_kscw
                      ? `KSCW ${kscwTeamName} vs ${gamesFor?.label ?? ''}`
                      : `${gamesFor?.label ?? ''} vs KSCW ${kscwTeamName}`}
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
