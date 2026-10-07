import { useTranslation } from 'react-i18next'
import { Users, Pencil, MapPin } from 'lucide-react'
import type { Game, Team, Hall, BaseRecord } from '../../../types'
import { formatDayMonthZurich, formatTime, formatWeekday } from '../../../utils/dateHelpers'
import { gameNumberLabel } from '../../../utils/leagueShort'
import { RailLeague } from '../../../components/RailLeague'
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
import { displayResult, parseSets } from '../../../utils/gameResult'
import { ProvisionalPill } from './GameResultPanel'

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
  /** Delete lives in the edit dialog (GameDetailModal `onDelete`), not on the card. */
  onEdit?: (game: Game) => void
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
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          {t('statusLive')}
        </span>
      )
    case 'postponed':
      return (
        <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-300">
          {t('statusPostponed')}
        </span>
      )
    case 'completed':
      return (
        <span className="whitespace-nowrap rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700 dark:border-green-800/60 dark:bg-green-900/30 dark:text-green-300">
          {t('statusCompleted')}
        </span>
      )
    case 'cancelled':
      return (
        <span className="whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-300">
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
function ScoreAside({ side, game, total, sets, kscwWon, kscwLost }: {
  side: 'home' | 'away'
  game: Game
  total: number | null
  sets: Array<{ home: number; away: number }>
  kscwWon: boolean
  kscwLost: boolean
}) {
  const ours = game.type === side
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
        ours ? (kscwWon ? 'text-green-500' : kscwLost ? 'text-red-500' : 'text-muted-foreground/80') : 'text-muted-foreground/80',
      )}>
        {total}
      </span>
    </div>
  )
}

export default function GameCard({ game, onClick, variant = 'card', participations, myParticipation, warnings, onParticipationSaved, onOpenRoster, onEdit, past }: GameCardProps) {
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
  const guestExcluded = !!teamIdForPerms && isGuestIn(teamIdForPerms)
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

  // Official score once sv-sync completes the game; before that a provisional one
  // (our report / the opponent's VM report), marked as such; a live game keeps its
  // running score.
  const result = displayResult(game)
  const provisional = result.kind === 'provisional'
  const hasScore = result.kind !== 'none' || game.status === 'live'
  const homeTotal = result.kind === 'none' ? game.home_score : result.home
  const awayTotal = result.kind === 'none' ? game.away_score : result.away
  const homeWon = Number(homeTotal) > Number(awayTotal)
  const awayWon = Number(awayTotal) > Number(homeTotal)
  const kscwWon = game.type === 'home' ? homeWon : awayWon
  const kscwLost = game.type === 'home' ? awayWon : homeWon
  const sets = result.kind === 'none' ? parseSets(game.sets_json) : result.sets

  // One tone for stripe + rail date: the game's state first, then (for a
  // played game) our result, else home vs away.
  const tone: RowTone =
    game.status === 'cancelled' || game.status === 'live' ? 'red'
      : game.status === 'postponed' ? 'amber'
        : result.kind !== 'none' ? (kscwWon ? 'green' : kscwLost ? 'red' : 'gray')
          : game.type === 'home' ? 'brand' : 'sky'

  const railFor = (railTone: RowTone) => (
    <DateRail
      eyebrow={game.date ? formatWeekday(game.date) : undefined}
      main={game.date ? `${formatDayMonthZurich(game.date)}.` : '–'}
      sub={game.time ? formatTime(game.time) : undefined}
      extra={game.league ? <RailLeague league={game.league} /> : undefined}
      matchNo={gameNumberLabel(game.game_id) || undefined}
      tone={railTone}
    />
  )

  const title = (
    <TeamPair
      home={homeLabel}
      away={awayLabel}
      emphasis={game.type === 'away' ? 'away' : 'home'}
      homeAside={hasScore ? <ScoreAside side="home" game={game} total={homeTotal} sets={sets} kscwWon={kscwWon} kscwLost={kscwLost} /> : undefined}
      awayAside={hasScore ? <ScoreAside side="away" game={game} total={awayTotal} sets={sets} kscwWon={kscwWon} kscwLost={kscwLost} /> : undefined}
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
        status={provisional ? <ProvisionalPill /> : game.status !== 'completed' ? <StatusBadge status={game.status} /> : undefined}
        chips={<>{teamChip}{hallChip}</>}
        onClick={onClick ? () => onClick(game) : undefined}
      />
    )
  }

  const showCancel = !past && (game.status === 'scheduled' || game.status === 'cancelled')
  const showRoster = !!onOpenRoster
  const showEdit = !!onEdit && canManage
  const hasTools = showCancel || showRoster || showEdit
  // Cards (game / training / event) share one stripe meaning: MY answer
  // (rsvpTone), cancelled overriding in red; the rail date stays neutral so a
  // red "declined" never reads as "cancelled". The game-state/result tone above
  // is for the compact results list, where there is no answer to show.
  const cardTone: RowTone = game.status === 'cancelled' ? 'red' : user ? rsvpTone(myParticipation?.status) : 'gray'

  return (
    <div className={cn(
      // flex-col + flex-1 row: in the equal-height card grid the tools line
      // sits on the card's bottom edge instead of floating mid-card.
      'flex flex-col rounded-2xl border border-hairline bg-card px-1 shadow-card transition-shadow',
      onClick && 'hover:shadow-card-lg',
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
          // A played/cancelled game carries two badges (Home + Completed): stack
          // them on a phone so they don't squeeze the team names to a few letters.
          <span
            className={cn('flex items-center gap-1.5', (game.status !== 'scheduled' || provisional) && 'max-sm:flex-col max-sm:items-end max-sm:gap-1')}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {!past && game.status === 'scheduled' && warnings && warnings.length > 0 && (
              <ParticipationWarningBadge warnings={warnings} namespace="participation" />
            )}
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold leading-none ${
              game.type === 'home'
                ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/40 dark:text-blue-300'
                : 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800/60 dark:bg-orange-900/40 dark:text-orange-300'
            }`}>
              {game.type === 'home' ? t('typeHomeShort') : t('typeAwayShort')}
            </span>
            {game.status !== 'scheduled' && <StatusBadge status={game.status} />}
            {provisional && <ProvisionalPill />}
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
          // Answerers get Yes/Maybe/No with the team totals inside the buttons;
          // everyone else (and an excluded guest) keeps the counters-only bars.
          <div className="mt-2 space-y-2">
            {canParticipate && (
              <ActivityParticipation
                kind="game"
                activityId={game.id}
                date={game.date}
                respondBy={game.respond_by}
                activityTime={game.time}
                existingParticipation={myParticipation}
                isStaff={!!teamIdForPerms && isStaffOnly(teamIdForPerms)}
                guestExcluded={guestExcluded}
                onSaved={onParticipationSaved}
                participations={participations}
                coachMemberIds={teamCoachIds(kscwTeamObj)}
              />
            )}
            {!(canParticipate && !guestExcluded) && (
              <ParticipationSummary activityType="game" activityId={game.id} bars alwaysShow participations={participations ?? []} coachMemberIds={teamCoachIds(kscwTeamObj)} />
            )}
          </div>
        )}
      </ActivityRow>
      {/* Tools line under a hairline, full card width — same as TrainingCard /
          EventCard (an indented ActivityRow `tools` line is too narrow in the
          2–3 column card grid). */}
      {hasTools && (
        <div className="-mx-1 flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3 py-2">
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
