import { useTranslation } from 'react-i18next'
import { Users, Pencil, Trash2, MapPin } from 'lucide-react'
import type { Game, Team, Hall, BaseRecord } from '../../../types'
import { formatDayMonthZurich, formatTime, formatWeekday } from '../../../utils/dateHelpers'
import { leagueShort } from '../../../utils/leagueShort'
import TeamChip from '../../../components/TeamChip'
import { teamNameToColorKey } from '../../../utils/teamColors'
import VolleyballIcon from '../../../components/VolleyballIcon'
import BasketballIcon from '../../../components/BasketballIcon'
import ParticipationSummary from '../../../components/ParticipationSummary'
import ParticipationWarningBadge from '../../../components/ParticipationWarningBadge'
import type { Warning } from '../../../utils/participationWarnings'
import { useAuth } from '../../../hooks/useAuth'
import { useTeamPermissions } from '../../../hooks/useTeamPermissions'
import { useIsCalledUpToGame } from '../../../hooks/useUserVisibleGameIds'
import type { Participation } from '../../../types'
import { asObj, relId, teamCoachIds } from '../../../utils/relations'
import CancelActivityButton from '../../../components/CancelActivityButton'
import ActivityParticipation from '../../../components/ActivityParticipation'
import CarpoolChip from '../../carpool/CarpoolChip'
import { ActivityRow, DateRail, RowChip, TeamPair } from '../../../components/ActivityRow'
import type { RowTone } from '../../../components/activityRowTokens'
import { rsvpTone } from '../../../utils/rsvpTone'
import TruncatedText from '../../../components/TruncatedText'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
  /** Already-played fixture shown under the upcoming ones: greyed, no RSVP/cancel. */
  past?: boolean
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
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          {t('statusLive')}
        </span>
      )
    case 'postponed':
      return (
        <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          {t('statusPostponed')}
        </span>
      )
    case 'completed':
      return (
        <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
          {t('statusCompleted')}
        </span>
      )
    case 'cancelled':
      return (
        <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {t('statusCancelled')}
        </span>
      )
    default:
      return null
  }
}

/**
 * One side's result: per-set points then the total, right-aligned so that
 * totals line up down a list regardless of how many sets were played. Set
 * chips are coloured from KSCW's point of view (green = a set we won).
 */
function ScoreAside({ side, game, sets, kscwWon, kscwLost }: {
  side: 'home' | 'away'
  game: Game
  sets: Array<{ home: number; away: number }>
  kscwWon: boolean
  kscwLost: boolean
}) {
  const ours = game.type === side
  const total = side === 'home' ? game.home_score : game.away_score
  return (
    <div className="flex items-center justify-end gap-1 leading-5">
      {sets.map((s, i) => {
        const homeSetWon = s.home > s.away
        const kscwSetWon = side === 'home' ? homeSetWon === (game.type === 'home') : homeSetWon !== (game.type === 'home')
        return (
          <span
            key={i}
            className={`inline-flex h-5 w-7 items-center justify-center rounded font-mono text-xs tabular-nums ${
              kscwSetWon
                ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}
          >
            {side === 'home' ? s.home : s.away}
          </span>
        )
      })}
      <span className={cn(
        'w-6 text-right font-mono text-sm font-bold tabular-nums',
        ours ? (kscwWon ? 'text-green-500' : kscwLost ? 'text-red-500' : 'text-gray-400') : 'text-gray-400',
      )}>
        {total}
      </span>
    </div>
  )
}

export default function GameCard({ game, onClick, variant = 'card', participations, myParticipation, warnings, onParticipationSaved, onOpenRoster, onEdit, onDelete, past }: GameCardProps) {
  const { t } = useTranslation('games')
  const { t: tc } = useTranslation('common')
  const { user, canParticipateIn, isStaffOnly, isGuestIn } = useAuth()
  const { canManageTeam } = useTeamPermissions()
  // A called-up player (migration 271) has no member_teams row on the team whose
  // fixture this is, so canParticipateIn — which is team-scoped — says no. They were
  // borrowed precisely so they can answer it, hence the OR.
  const isCalledUp = useIsCalledUpToGame(user?.id, game.id)
  // relId, not the raw value: surfaces that expand `kscw_team.*` (the games list)
  // hand us the team OBJECT, and every one of these checks compares against an
  // array of id strings — so they all quietly answered false there.
  const teamIdForPerms = relId(game.kscw_team)
  const canParticipate = !!user && !!teamIdForPerms && (canParticipateIn(teamIdForPerms) || isCalledUp)
  const canManage = !!user && canManageTeam(teamIdForPerms)
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

  const hasScore = game.status === 'completed' || game.status === 'live'
  const homeWon = Number(game.home_score) > Number(game.away_score)
  const awayWon = Number(game.away_score) > Number(game.home_score)
  const kscwWon = game.type === 'home' ? homeWon : awayWon
  const kscwLost = game.type === 'home' ? awayWon : homeWon
  const sets = parseSets(game.sets_json)

  // One tone for stripe + rail date: the game's state first, then (for a
  // played game) our result, else home vs away.
  const tone: RowTone =
    game.status === 'cancelled' || game.status === 'live' ? 'red'
      : game.status === 'postponed' ? 'amber'
        : game.status === 'completed' ? (kscwWon ? 'green' : kscwLost ? 'red' : 'gray')
          : game.type === 'home' ? 'brand' : 'sky'

  const railFor = (railTone: RowTone) => (
    <DateRail
      eyebrow={game.date ? formatWeekday(game.date) : undefined}
      main={game.date ? `${formatDayMonthZurich(game.date)}.` : '–'}
      sub={game.time ? formatTime(game.time) : undefined}
      // leagueShort can hold a newline (league + group) — keep it.
      extra={game.league ? <span className="whitespace-pre-line">{leagueShort(game.league)}</span> : undefined}
      tone={railTone}
    />
  )

  const title = (
    <TeamPair
      home={homeLabel}
      away={awayLabel}
      emphasis={game.type === 'away' ? 'away' : 'home'}
      homeAside={hasScore ? <ScoreAside side="home" game={game} sets={sets} kscwWon={kscwWon} kscwLost={kscwLost} /> : undefined}
      awayAside={hasScore ? <ScoreAside side="away" game={game} sets={sets} kscwWon={kscwWon} kscwLost={kscwLost} /> : undefined}
    />
  )

  const teamChip = kscwTeamName ? (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      {isBB
        ? <BasketballIcon className="h-4 w-4 shrink-0" filled />
        : <VolleyballIcon className="h-4 w-4 shrink-0" filled />}
      <TeamChip team={kscwTeamName} size="xs" />
    </span>
  ) : null

  // Hall is secondary text: a chip that truncates (with title) rather than
  // pushing the card wider on a long "Sporthalle …, Zürich".
  const hallChip = hallInfo ? (
    <RowChip className="min-w-0 max-w-full">
      <MapPin aria-hidden />
      <TruncatedText text={hallInfo} />
    </RowChip>
  ) : null

  if (variant === 'compact') {
    return (
      <ActivityRow
        rail={railFor(tone)}
        tone={tone}
        title={title}
        status={game.status !== 'completed' ? <StatusBadge status={game.status} /> : undefined}
        chips={<>{teamChip}{hallChip}</>}
        onClick={onClick ? () => onClick(game) : undefined}
      />
    )
  }

  const showCancel = !past && (game.status === 'scheduled' || game.status === 'cancelled')
  const showRoster = !!onOpenRoster
  const showEdit = !!onEdit && canManage
  const showDelete = !!onDelete && canDelete
  const hasTools = showCancel || showRoster || showEdit || showDelete
  // Cards (game / training / event) share one stripe meaning: MY answer
  // (rsvpTone), cancelled overriding in red; the rail date stays neutral so a
  // red "declined" never reads as "cancelled". The game-state/result tone above
  // is for the compact results list, where there is no answer to show.
  const cardTone: RowTone = game.status === 'cancelled' ? 'red' : user ? rsvpTone(myParticipation?.status) : 'gray'

  return (
    <div className={cn(
      // flex-col + flex-1 row: in the equal-height card grid the tools line
      // sits on the card's bottom edge instead of floating mid-card.
      'flex flex-col rounded-xl border border-gray-200 bg-white px-1 shadow-card transition-shadow dark:border-gray-700 dark:bg-gray-800',
      onClick && 'hover:shadow-card-hover',
    )}>
      <ActivityRow
        rail={railFor(game.status === 'cancelled' ? 'red' : 'gray')}
        tone={cardTone}
        title={title}
        muted={game.status === 'cancelled' || past}
        className="flex-1 content-start"
        onClick={onClick ? () => onClick(game) : undefined}
        status={
          // The warning badge is a popover trigger — keep its click from also
          // opening the game detail behind it.
          <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {!past && game.status === 'scheduled' && warnings && warnings.length > 0 && (
              <ParticipationWarningBadge warnings={warnings} namespace="participation" />
            )}
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${
              game.type === 'home'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                : 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
            }`}>
              {game.type === 'home' ? t('typeHomeShort') : t('typeAwayShort')}
            </span>
            {game.status !== 'scheduled' && <StatusBadge status={game.status} />}
          </span>
        }
        chips={
          <>
            {teamChip}
            {hallChip}
            {/* Car pooling (migration 378) — straight to the rides board. */}
            {!past && game.status === 'scheduled' && game.carpool_enabled && user && (
              <CarpoolChip type="game" id={game.id} scope={game.carpool_teams} />
            )}
          </>
        }
      >
        {!past && game.status === 'scheduled' && (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {canParticipate && (
              <ActivityParticipation
                kind="game"
                activityId={game.id}
                date={game.date}
                respondBy={game.respond_by}
                activityTime={game.time}
                existingParticipation={myParticipation}
                isStaff={!!teamIdForPerms && isStaffOnly(teamIdForPerms)}
                guestExcluded={!!teamIdForPerms && isGuestIn(teamIdForPerms)}
                onSaved={onParticipationSaved}
              />
            )}
            <ParticipationSummary activityType="game" activityId={game.id} bars alwaysShow participations={participations ?? []} coachMemberIds={teamCoachIds(kscwTeamObj)} />
          </div>
        )}
      </ActivityRow>
      {/* Tools line under a hairline, full card width — same as TrainingCard /
          EventCard (an indented ActivityRow `tools` line is too narrow in the
          2–3 column card grid). */}
      {hasTools && (
        <div className="-mx-1 flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-3 py-2 dark:border-gray-700">
          {showRoster && (
            <Button
              type="button"
              size="tool"
              variant="outline"
              onClick={() => onOpenRoster(game)}
              title={t('viewRoster')}
              aria-label={t('viewRoster')}
            >
              <Users aria-hidden />{t('viewRoster', { ns: 'scorer' })}
            </Button>
          )}
          {showEdit && (
            <Button
              type="button"
              size="tool"
              variant="outline"
              onClick={() => onEdit(game)}
              title={t('editGame')}
              aria-label={t('editGame')}
            >
              <Pencil aria-hidden />{tc('edit')}
            </Button>
          )}
          {showDelete && (
            <Button
              type="button"
              size="tool"
              variant="outline"
              onClick={() => onDelete(game.id)}
              title={t('deleteGame')}
              aria-label={t('deleteGame')}
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Trash2 aria-hidden />{tc('delete')}
            </Button>
          )}
          {showCancel && (
            <CancelActivityButton
              kind="game"
              activityId={game.id}
              isCancelled={game.status === 'cancelled'}
              teamIds={teamIdForPerms ? [teamIdForPerms] : []}
              variant="icon"
              onDone={onParticipationSaved}
            />
          )}
        </div>
      )}
    </div>
  )
}
