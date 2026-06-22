import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, MessageSquare } from 'lucide-react'
import type { Game, Team, Hall, BaseRecord } from '../../../types'
import { formatDate, formatDateCompact, formatTime, getDeadlineDate } from '../../../utils/dateHelpers'
import { leagueShort } from '../../../utils/leagueShort'
import TeamChip from '../../../components/TeamChip'
import { teamNameToColorKey } from '../../../utils/teamColors'
import VolleyballIcon from '../../../components/VolleyballIcon'
import BasketballIcon from '../../../components/BasketballIcon'
import ParticipationSummary from '../../../components/ParticipationSummary'
import ParticipationWarningBadge from '../../../components/ParticipationWarningBadge'
import type { Warning } from '../../../utils/participationWarnings'
import { useAuth } from '../../../hooks/useAuth'
import { useAdminMode } from '../../../hooks/useAdminMode'
import { useMutation } from '../../../hooks/useMutation'
import { useMyCoveringAbsence } from '../../../hooks/useMyCoveringAbsence'
import { useAbsenceNoteText } from '../../../hooks/useAbsenceNoteText'
import type { Participation } from '../../../types'
import { asObj, relId, teamCoachIds } from '../../../utils/relations'
import CancelActivityButton from '../../../components/CancelActivityButton'

function parseSets(json: unknown): Array<{ home: number; away: number }> {
  if (!Array.isArray(json)) return []
  return json.filter(
    (s): s is { home: number; away: number } =>
      typeof s === 'object' && s !== null && 'home' in s && 'away' in s,
  )
}

interface GameCardProps {
  game: Game
  onClick?: (game: Game) => void
  variant?: 'card' | 'compact'
  /** Pre-fetched participations for this game (from batch query) */
  participations?: Participation[]
  /** Pre-fetched current user's participation (from batch query) */
  myParticipation?: Participation
  warnings?: Warning[]
  /** Called after a participation save — parent can refetch */
  onParticipationSaved?: () => void
  onOpenRoster?: (game: Game) => void
  onEdit?: (game: Game) => void
  onDelete?: (id: string) => void
}

type ExpandedGame = Game & {
  kscw_team: (Team & BaseRecord) | string
  hall: (Hall & BaseRecord) | string
}

function StatusBadge({ status }: { status: Game['status'] }) {
  const { t } = useTranslation('games')

  switch (status) {
    case 'live':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          {t('statusLive')}
        </span>
      )
    case 'postponed':
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          {t('statusPostponed')}
        </span>
      )
    case 'completed':
      return (
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
          {t('statusCompleted')}
        </span>
      )
    case 'cancelled':
      return (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {t('statusCancelled')}
        </span>
      )
    default:
      return null
  }
}

export default function GameCard({ game, onClick, variant = 'card', participations, myParticipation, warnings, onParticipationSaved, onOpenRoster, onEdit, onDelete }: GameCardProps) {
  const { t } = useTranslation('games')
  const { user, canParticipateIn, isCoachOf, teamResponsibleIds } = useAuth()
  const { effectiveIsAdmin } = useAdminMode()
  const canParticipate = !!user && !!game.kscw_team && canParticipateIn(game.kscw_team)
  const teamIdForPerms = relId(game.kscw_team)
  const canManage = !!user && (effectiveIsAdmin || isCoachOf(teamIdForPerms) || teamResponsibleIds.includes(teamIdForPerms))
  const canDelete = canManage && game.source === 'manual'
  const expanded = game as unknown as ExpandedGame
  const expandedHall = asObj<Hall & BaseRecord>(expanded.hall)
  const hallInfo = expandedHall
    ? [expandedHall.name, expandedHall.city].filter(Boolean).join(', ')
    : game.away_hall_json
      ? [game.away_hall_json.name, game.away_hall_json.city].filter(Boolean).join(', ')
      : ''
  const kscwTeamObj = asObj<Team & BaseRecord>(expanded.kscw_team)
  const rawTeamName = kscwTeamObj?.name ?? ''
  const teamSport = kscwTeamObj?.sport as 'volleyball' | 'basketball' | undefined
  const isBB = teamSport === 'basketball' || game.source === 'basketplan'
  const kscwTeamName = rawTeamName && teamSport ? teamNameToColorKey(rawTeamName, teamSport) : rawTeamName
  // Show OUR side from the linked team's VM-owned name (teams.full_name) so the
  // games list mirrors VM even when the SV API caption lags — e.g. a junior team
  // moving Stärkeklasse (DU23-1 → DU23-2). Opponent side keeps the SV caption.
  // Falls back to the stored string when kscw_team isn't expanded.
  const kscwFullLabel = kscwTeamObj?.full_name || (rawTeamName ? `KSC Wiedikon ${rawTeamName}` : '')
  const homeLabel = game.type === 'home' && kscwFullLabel ? kscwFullLabel : game.home_team
  const awayLabel = game.type === 'away' && kscwFullLabel ? kscwFullLabel : game.away_team

  if (variant === 'compact') {
    const short = game.date ? formatDateCompact(game.date) : ''
    const hasScore = game.status === 'completed' || game.status === 'live'
    const homeWon = Number(game.home_score) > Number(game.away_score)
    const awayWon = Number(game.away_score) > Number(game.home_score)
    const kscwWon = game.type === 'home' ? homeWon : awayWon
    const kscwLost = game.type === 'home' ? awayWon : homeWon
    const sets = parseSets(game.sets_json)

    return (
      <>
        {/* Mobile: flex row */}
        <div
          onClick={() => onClick?.(game)}
          className={`border-b border-gray-100 dark:border-gray-700 md:hidden ${onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700' : ''}`}
        >
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="w-16 shrink-0 text-xs text-gray-500 dark:text-gray-400">
              <div>{short}</div>
              {game.time && <div>{formatTime(game.time)}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {isBB
                ? <BasketballIcon className="h-5 w-5" filled />
                : <VolleyballIcon className="h-5 w-5" filled />}
              {kscwTeamName && <TeamChip team={kscwTeamName} size="xs" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm text-gray-900 dark:text-gray-100 ${game.type === 'home' ? 'font-bold' : ''}`}>
                {homeLabel}
              </p>
              <p className={`truncate text-sm text-gray-900 dark:text-gray-100 ${game.type === 'away' ? 'font-bold' : ''}`}>
                {awayLabel}
              </p>
            </div>
            {hasScore && (
              <div className="shrink-0 text-right font-mono text-sm font-bold leading-snug">
                <div className={game.type === 'home' ? (kscwWon ? 'text-green-500' : kscwLost ? 'text-red-500' : 'text-gray-400') : 'text-gray-400'}>{game.home_score}</div>
                <div className={game.type === 'away' ? (kscwWon ? 'text-green-500' : kscwLost ? 'text-red-500' : 'text-gray-400') : 'text-gray-400'}>{game.away_score}</div>
              </div>
            )}
            {game.status !== 'completed' && <StatusBadge status={game.status} />}
          </div>
        </div>

        {/* Desktop: uses display:contents so cells participate in parent grid */}
        <div
          onClick={() => onClick?.(game)}
          className={`col-span-full hidden md:grid md:grid-cols-subgrid items-center gap-x-3 border-b border-gray-100 px-5 py-3 dark:border-gray-700 ${onClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700' : ''}`}
        >
          {/* Col 1: Date + time */}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            <div>{short}</div>
            {game.time && <div>{formatTime(game.time)}</div>}
          </div>

          {/* Col 2: Sport icon */}
          <div>
            {isBB
              ? <BasketballIcon className="h-5 w-5" filled />
              : <VolleyballIcon className="h-5 w-5" filled />}
          </div>

          {/* Col 3: Team chip */}
          <div>
            {kscwTeamName ? <TeamChip team={kscwTeamName} size="xs" /> : null}
          </div>

          {/* Col 4: Total score (left of team names) */}
          <div className="text-right font-mono text-sm font-bold">
            {hasScore ? (
              <>
                <p className={`leading-5 ${game.type === 'home' ? (kscwWon ? 'text-green-500' : kscwLost ? 'text-red-500' : 'text-gray-400') : 'text-gray-400'}`}>{game.home_score}</p>
                <p className={`leading-5 ${game.type === 'away' ? (kscwWon ? 'text-green-500' : kscwLost ? 'text-red-500' : 'text-gray-400') : 'text-gray-400'}`}>{game.away_score}</p>
              </>
            ) : (
              game.status !== 'completed' && <StatusBadge status={game.status} />
            )}
          </div>

          {/* Col 5: Team names */}
          <div className="min-w-0">
            <p className={`truncate text-sm leading-5 text-gray-900 dark:text-gray-100 ${game.type === 'home' ? 'font-bold' : ''}`}>
              {homeLabel}
            </p>
            <p className={`truncate text-sm leading-5 text-gray-900 dark:text-gray-100 ${game.type === 'away' ? 'font-bold' : ''}`}>
              {awayLabel}
            </p>
          </div>

          {/* Col 6: Set scores — two rows aligned with teams */}
          <div>
            {hasScore && sets.length > 0 && (
              <>
                <div className="flex items-center gap-1 leading-5">
                  {sets.map((s, i) => {
                    const homeSetWon = s.home > s.away
                    return (
                      <span
                        key={i}
                        className={`inline-flex h-5 w-7 items-center justify-center rounded text-xs font-mono tabular-nums ${
                          homeSetWon === (game.type === 'home')
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {s.home}
                      </span>
                    )
                  })}
                </div>
                <div className="flex items-center gap-1 leading-5">
                  {sets.map((s, i) => {
                    const homeSetWon = s.home > s.away
                    return (
                      <span
                        key={i}
                        className={`inline-flex h-5 w-7 items-center justify-center rounded text-xs font-mono tabular-nums ${
                          homeSetWon !== (game.type === 'home')
                            ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}
                      >
                        {s.away}
                      </span>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Col 7: League */}
          <div>
            {game.league && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                {leagueShort(game.league)}
              </span>
            )}
          </div>

          {/* Col 8: Hall */}
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
            {hallInfo}
          </div>
        </div>
      </>
    )
  }

  const statusBorderColor: Record<string, string> = {
    confirmed: 'bg-green-500 dark:bg-green-400',
    tentative: 'bg-yellow-500 dark:bg-yellow-400',
    declined: 'bg-red-500 dark:bg-red-400',
    waitlisted: 'bg-orange-500 dark:bg-orange-400',
    absent: 'bg-gray-400 dark:bg-gray-500',
  }
  const myStatus = myParticipation?.status ?? null

  return (
    <div
      data-tour="game-card"
      onClick={() => onClick?.(game)}
      className={`flex items-stretch overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-card transition-shadow ${onClick ? 'cursor-pointer hover:shadow-card-hover' : ''}${game.status === 'cancelled' ? ' opacity-60' : ''}`}
    >
      {/* Participation status vertical banner */}
      {user && myStatus && (
        <div className={`w-1 shrink-0 ${statusBorderColor[myStatus] ?? ''}`} />
      )}
      <div className="flex-1 p-3">
      {/* Top-right action bar: warning + H/A badge + roster/edit/delete */}
      <div className="flex shrink-0 items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {game.status === 'scheduled' && warnings && warnings.length > 0 && (
          <ParticipationWarningBadge warnings={warnings} namespace="participation" />
        )}
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
          game.type === 'home'
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
            : 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
        }`}>
          {game.type === 'home' ? t('typeHomeShort') : t('typeAwayShort')}
        </span>
        {(game.status === 'scheduled' || game.status === 'cancelled') && (
          <CancelActivityButton
            kind="game"
            activityId={game.id}
            isCancelled={game.status === 'cancelled'}
            teamIds={teamIdForPerms ? [teamIdForPerms] : []}
            variant="icon"
            onDone={onParticipationSaved}
          />
        )}
        {onOpenRoster && (
          <button
            onClick={() => onOpenRoster(game)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            title={t('viewRoster')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </button>
        )}
        {onEdit && canManage && (
          <button
            onClick={() => onEdit(game)}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            title={t('editGame')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
            </svg>
          </button>
        )}
        {onDelete && canDelete && (
          <button
            onClick={() => onDelete(game.id)}
            className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:text-gray-400 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            title={t('deleteGame')}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex gap-3">
        {/* Left: date, time, league, chip */}
        <div className="w-20 shrink-0 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
          <div className="font-medium text-gray-700 dark:text-gray-300">{game.date ? formatDateCompact(game.date) : ''}</div>
          {game.time && <div>{formatTime(game.time)}</div>}
          <div className="whitespace-pre-line">{leagueShort(game.league)}</div>
          {kscwTeamName && (
            <div className="flex items-center gap-1 pt-0.5">
              {isBB
                ? <BasketballIcon className="h-3.5 w-3.5" filled />
                : <VolleyballIcon className="h-3.5 w-3.5" filled />}
              <TeamChip team={kscwTeamName} size="xs" />
            </div>
          )}
        </div>

        {/* Right: teams stacked + hall */}
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm text-gray-900 dark:text-gray-100 ${game.type === 'home' ? 'font-bold' : ''}`}>
            {homeLabel}
          </p>
          <p className={`truncate text-sm text-gray-900 dark:text-gray-100 ${game.type === 'away' ? 'font-bold' : ''}`}>
            {awayLabel}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <StatusBadge status={game.status} />
            {hallInfo && <span className="truncate text-xs text-gray-500 dark:text-gray-400">{hallInfo}</span>}
          </div>
          {game.status === 'scheduled' && (
            <div className="mt-1.5 flex flex-wrap items-end gap-2">
              {canParticipate && (
                <GameCardParticipation game={game} existingParticipation={myParticipation} onSaved={onParticipationSaved} />
              )}
              <ParticipationSummary activityType="game" activityId={game.id} bars alwaysShow participations={participations ?? []} coachMemberIds={teamCoachIds(kscwTeamObj)} />
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

function GameCardParticipation({ game, existingParticipation, onSaved }: { game: Game; existingParticipation?: Participation; onSaved?: () => void }) {
  const { t } = useTranslation('participation')
  const { t: tGames } = useTranslation('games')
  const { user, isStaffOnly, isGuestIn } = useAuth()
  const isStaff = !!game.kscw_team && isStaffOnly(game.kscw_team)
  const guestExcluded = !!game.kscw_team && isGuestIn(game.kscw_team)
  const { create, update } = useMutation<Participation>('participations')
  const { absence, hasAbsence } = useMyCoveringAbsence('game', game.date)
  const absenceLabel = absence?.type === 'weekly' ? 'declinedUnavailable' : 'absent'
  const absenceNoteText = useAbsenceNoteText(absence)

  const deadlinePassed = game.respond_by
    ? getDeadlineDate(game.respond_by, game.time) < new Date()
    : false

  const [optimisticStatus, setOptimisticStatus] = useState<Participation['status'] | null>(null)
  const [saveConfirmed, setSaveConfirmed] = useState(false)
  const [guestCount, setGuestCount] = useState(existingParticipation?.guest_count ?? 0)
  const [noteText, setNoteText] = useState(existingParticipation?.note ?? '')
  const [noteSaved, setNoteSaved] = useState(false)
  const noteInitRef = useRef(existingParticipation?.note ?? '')

  // Sync guest count when participation data changes
  useEffect(() => {
    setGuestCount(existingParticipation?.guest_count ?? 0)
  }, [existingParticipation?.guest_count])

  // Sync note when participation data changes. When there is no server-saved
  // note but a covering absence applies, prefill with the absence-derived
  // label (Vacation / Weekly unavailability / etc.) so the user sees and can
  // edit the implicit reason.
  const serverNote = existingParticipation?.note ?? ''
  const effectiveSync = serverNote || absenceNoteText
  if (effectiveSync !== noteInitRef.current) {
    noteInitRef.current = effectiveSync
    setNoteText(effectiveSync)
  }

  const serverStatus = existingParticipation?.status ?? null
  const displayStatus = optimisticStatus ?? serverStatus

  // Auto-dismiss confirmation after 2s
  useEffect(() => {
    if (!saveConfirmed) return
    const timer = setTimeout(() => setSaveConfirmed(false), 2000)
    return () => clearTimeout(timer)
  }, [saveConfirmed])

  // Auto-dismiss note confirmation after 2s
  useEffect(() => {
    if (!noteSaved) return
    const timer = setTimeout(() => setNoteSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [noteSaved])

  const setStatus = useCallback(async (status: Participation['status'], guests?: number, note?: string) => {
    if (!user) return
    const gc = guests ?? guestCount
    const n = note ?? noteText
    setOptimisticStatus(status)
    setSaveConfirmed(false)
    try {
      if (existingParticipation) {
        await update(existingParticipation.id, { status, guest_count: gc, note: n })
      } else {
        await create({
          member: user.id,
          activity_type: 'game' as const,
          activity_id: game.id,
          status,
          note: n,
          guest_count: gc,
          is_staff: isStaff,
        })
      }
      setSaveConfirmed(true)
      onSaved?.()
    } catch {
      setOptimisticStatus(null)
    }
  }, [user, existingParticipation, game.id, isStaff, guestCount, noteText, create, update, onSaved])

  const saveNote = () => {
    if (noteText !== serverNote && displayStatus) {
      setStatus(displayStatus, guestCount, noteText)
      setNoteSaved(true)
    }
  }

  async function handleGuestChange(delta: number) {
    const newCount = Math.max(0, guestCount + delta)
    setGuestCount(newCount)
    if (displayStatus) {
      await setStatus(displayStatus, newCount)
    }
  }

  const isLocked = deadlinePassed

  if (guestExcluded) {
    return <p className="text-xs italic text-gray-500 dark:text-gray-400">{tGames('guestsCannotParticipate')}</p>
  }

  return (
    <div data-tour="game-rsvp" className="space-y-1.5">
      {hasAbsence && (
        <p className="text-xs italic text-gray-500 dark:text-gray-400">{t(absenceLabel)}</p>
      )}
      <div className="relative flex flex-wrap items-center gap-1.5">
        {(['confirmed', 'tentative', 'declined'] as const)
          // When deadline has passed: only render the user's selected choice (if any) in its color.
          .filter((s) => !isLocked || displayStatus === s)
          .map((status) => {
            const active = displayStatus === status
            const colorMap = {
              confirmed: active ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-green-900/30 dark:hover:text-green-400',
              tentative: active ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-yellow-100 hover:text-yellow-700 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-yellow-900/30 dark:hover:text-yellow-400',
              declined: active ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-red-900/30 dark:hover:text-red-400',
            }
            const label = { confirmed: t('yes'), tentative: t('maybe'), declined: t('no') }
            return (
              <button
                key={status}
                onClick={(e) => { e.stopPropagation(); if (!isLocked) setStatus(status) }}
                disabled={isLocked}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${isLocked ? 'cursor-not-allowed' : ''} ${colorMap[status]}`}
              >
                {label[status]}
              </button>
            )
          })}

        {/* Inline guest counter — coaches/TR only */}
        {displayStatus && isStaff && (
          <div className="flex items-center gap-1 ml-1 border-l border-gray-200 pl-2 dark:border-gray-600" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={(e) => { e.stopPropagation(); handleGuestChange(-1) }}
              disabled={guestCount <= 0}
              className="flex h-5 w-5 items-center justify-center rounded text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              −
            </button>
            <span className="min-w-[1rem] text-center text-xs font-medium text-gray-700 dark:text-gray-300">
              {guestCount}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); handleGuestChange(1) }}
              className="flex h-5 w-5 items-center justify-center rounded text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              +
            </button>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{t('guests')}</span>
          </div>
        )}

        {/* Save confirmation popover */}
        {saveConfirmed && (
          <span className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 whitespace-nowrap rounded-md bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg animate-fade-in">
            <Check className="h-3 w-3" />
            {t('saved')}
          </span>
        )}
      </div>

      {/* Deadline info */}
      {game.respond_by && (
        deadlinePassed ? (
          <p className="text-[10px] leading-tight text-red-500 dark:text-red-400">
            {t('deadlinePassed')}
          </p>
        ) : (
          <p className="text-[10px] leading-tight text-gray-400 dark:text-gray-500">
            {tGames('respondBy')}: {formatDate(game.respond_by)}, {formatTime(game.respond_by) || formatTime(game.time)}
          </p>
        )
      )}

      {/* Note input */}
      {displayStatus && (
        <div className="relative flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={saveNote}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveNote()
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder={t('notePlaceholder')}
            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-transparent px-2 py-0.5 text-xs text-gray-700 placeholder:text-gray-400 focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:text-gray-300 dark:placeholder:text-gray-500 dark:focus:border-brand-500"
          />
          <button
            onClick={(e) => { e.stopPropagation(); saveNote() }}
            disabled={noteText === serverNote}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-green-600 disabled:opacity-30 dark:hover:bg-gray-700 dark:hover:text-green-400"
          >
            <Check className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}
