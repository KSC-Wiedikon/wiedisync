import { useState, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { kscwApi } from '../../../lib/api'
import type { Game, Member, Team, Hall, LicenceType, MemberTeam, ScorerDelegation, Absence } from '../../../types'
import { absenceCoversActivity } from '../../../utils/absenceHelpers'
import TeamChip from '../../../components/TeamChip'
import AssignmentEditor from './AssignmentEditor'
import DelegationModal from './DelegationModal'
import { downloadICal } from '../../../utils/icalGenerator'
import type { CalendarEntry } from '../../../types/calendar'
import { currentLocale, formatTime, toUtcIsoFromDatetimeLocal, isWithinGameContactWindow, DUTY_ARRIVAL_MIN } from '../../../utils/dateHelpers'
import { Calendar, MapPin, Clock, AlertTriangle, Users } from 'lucide-react'
import { sanitizeUrl } from '../../../utils/sanitizeUrl'
import RosterModal from './RosterModal'

interface ScorerRowProps {
  game: Game
  members: Member[]
  teams: Team[]
  teamMemberIds: Map<string, Set<string>>
  memberTeams: MemberTeam[]
  onUpdate: (gameId: string, fields: Partial<Game>) => void
  /** Refetch games after a member self-claims via the duty-claim endpoint (the
   *  raw-knex write doesn't emit a realtime event, so we refresh explicitly). */
  onRefetch?: () => void
  canEdit: boolean
  /** Sport/global admin — gates admin-only metadata (who confirmed the duty). */
  isAdmin?: boolean
  showContact: boolean
  userId?: string
  userTeamIds?: string[]
  userLicences?: LicenceType[]
  sport: 'volleyball' | 'basketball'
  guestMemberIds?: Set<string>
  onDelegate?: (gameId: string, role: ScorerDelegation['role'], toMemberId: string, fromTeamId: string, toTeamId: string) => void
  getPendingForRole: (gameId: string, role: string) => ScorerDelegation | undefined
  getDelegationTargetName: (delegation: ScorerDelegation, members: Member[]) => string
  /** The current user's own absences — used to warn (not block) on self-claim. */
  myAbsences?: Absence[]
}

import { asObj } from '../../../utils/relations'

export type ExpandedGame = Game

// Named weekday/month parts follow the active UI language; the strict de-CH
// rule (CLAUDE.md) applies to numeric dd.mm.yyyy dates only.
function getDateFormatter() {
  return new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── VB helpers ──

function isVbSeparateMode(game: Game): boolean {
  return !!(game.scorer_duty_team || game.scorer_member || game.scoreboard_duty_team || game.scoreboard_member)
}

function isVbCombinedMode(game: Game): boolean {
  return !!(game.scorer_scoreboard_duty_team || game.scorer_scoreboard_member)
}

// HU20 home games: scorer + referee (instead of Täfeler). Detected from the
// referee columns; the admin-assign page writes referee_duty_team for HU20.
function isVbRefereeMode(game: Game): boolean {
  return !!(game.referee_duty_team || game.referee_member)
}

export function hasAnyVbAssignment(game: Game): boolean {
  return !!(game.scorer_member || game.scoreboard_member || game.scorer_scoreboard_member || game.referee_member)
}

function isVbFullyAssigned(game: Game): boolean {
  if (isVbCombinedMode(game)) return !!game.scorer_scoreboard_member
  // Referee mode (HU20): referee only, no scorer/Täfeler. Check before separate.
  if (isVbRefereeMode(game)) return !!game.referee_member
  if (isVbSeparateMode(game)) return !!(game.scorer_member && game.scoreboard_member)
  return false
}

// ── BB helpers ──

export function hasAnyBbAssignment(game: Game): boolean {
  return !!(game.bb_scorer_member || game.bb_timekeeper_member || game.bb_24s_official)
}

function isBbFullyAssigned(game: Game): boolean {
  return !!(game.bb_scorer_member && game.bb_timekeeper_member)
}

// ── Generic helpers ──

export function hasAnyAssignment(game: Game): boolean {
  return hasAnyVbAssignment(game) || hasAnyBbAssignment(game)
}

export function isFullyAssigned(game: Game, sport: 'volleyball' | 'basketball'): boolean {
  return sport === 'basketball' ? isBbFullyAssigned(game) : isVbFullyAssigned(game)
}

export function DutyStatus({ game, sport }: { game: Game; sport: 'volleyball' | 'basketball' }) {
  const { t } = useTranslation('scorer')
  // A duty is confirmed once it has a person; the game badge is "Confirmed" only
  // when every applicable duty is filled, otherwise "Open". No "Assigned" state.
  if (isFullyAssigned(game, sport)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        {t('statusConfirmed')}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
      {t('statusOpen')}
    </span>
  )
}

function handleExportICal(game: ExpandedGame, title: string) {
  const hallName = asObj<Hall>(game.hall)?.name ?? ''
  const entry: CalendarEntry = {
    id: `duty-${game.id}`,
    type: 'game',
    title,
    date: new Date(game.date + 'T00:00:00'),
    startTime: game.time ? formatTime(game.time) : null,
    endTime: null,
    allDay: false,
    location: hallName,
    teamNames: [],
    description: `${game.home_team} vs ${game.away_team}\n${game.league}`,
    source: game,
  }
  downloadICal([entry], `scorer-duty-${game.date}.ics`)
}

type VbAssignRole = 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'referee'
type BbAssignRole = 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'
type AssignRole = VbAssignRole | BbAssignRole

// Per-role "confirmed by"/at columns (migration 123/182), keyed by assign role.
const CONFIRM_COLS: Record<AssignRole, { byName: keyof Game; at: keyof Game }> = {
  scorer: { byName: 'scorer_confirmed_by_name', at: 'scorer_confirmed_at' },
  scoreboard: { byName: 'scoreboard_confirmed_by_name', at: 'scoreboard_confirmed_at' },
  scorer_scoreboard: { byName: 'scorer_scoreboard_confirmed_by_name', at: 'scorer_scoreboard_confirmed_at' },
  referee: { byName: 'referee_confirmed_by_name', at: 'referee_confirmed_at' },
  bb_scorer: { byName: 'bb_scorer_confirmed_by_name', at: 'bb_scorer_confirmed_at' },
  bb_timekeeper: { byName: 'bb_timekeeper_confirmed_by_name', at: 'bb_timekeeper_confirmed_at' },
  bb_24s_official: { byName: 'bb_24s_confirmed_by_name', at: 'bb_24s_confirmed_at' },
}

export default function ScorerRow({
  game,
  members,
  teams,
  teamMemberIds,
  memberTeams,
  onUpdate,
  onRefetch,
  canEdit,
  isAdmin = false,
  showContact,
  userId,
  userTeamIds = [],
  userLicences = [],
  sport,
  guestMemberIds,
  onDelegate,
  getPendingForRole,
  getDelegationTargetName,
  myAbsences = [],
}: ScorerRowProps) {
  const { t } = useTranslation('scorer')
  const expanded = game as ExpandedGame
  const kscwTeamObj = asObj<Team>(expanded.kscw_team)
  const kscwTeam = kscwTeamObj?.name ?? ''
  const hall = asObj<Hall>(expanded.hall)
  const dateStr = game.date ? getDateFormatter().format(new Date(game.date + 'T00:00:00')) : ''
  const gameNumber = game.game_id?.replace(/^(vb_|bb_)/, '') ?? ''

  // A game is "past" once its Zurich kickoff has passed (covers same-day games
  // already played — those still sit in the upcoming list). Past games are
  // read-only: admins can't re-assign / de-confirm a duty after the game starts.
  const isGamePast = (() => {
    if (!game.date || !game.time) return false
    try {
      const ms = new Date(toUtcIsoFromDatetimeLocal(`${String(game.date).slice(0, 10)}T${String(game.time).slice(0, 5)}`)).getTime()
      return !Number.isNaN(ms) && ms < Date.now()
    } catch { return false }
  })()
  // Admins assign/clear duties via the dropdowns; clearing a person de-confirms
  // that one duty. Disabled once the game has started.
  const effectiveCanEdit = canEdit && !isGamePast

  const vbCombined = isVbCombinedMode(game)
  // HU20 games are scorer + referee (data-driven: referee_duty_team is written
  // by the admin-assign page). kscw_team isn't expanded here, so no name check.
  const vbReferee = isVbRefereeMode(game)

  // The user has an absence on this game's date — self-claim is still allowed,
  // but we warn them in the confirmation dialog.
  const hasAbsenceOnGameDate = myAbsences.some((a) => absenceCoversActivity(a, 'game', String(game.date).slice(0, 10)))

  // Self-assign confirmation state
  const [confirmRole, setConfirmRole] = useState<AssignRole | null>(null)
  // Delegation modal state
  const [delegateRole, setDelegateRole] = useState<AssignRole | null>(null)
  // 24s official toggle — auto-open if already assigned
  const [show24s, setShow24s] = useState(!!game.bb_24s_official)
  // Home-team roster modal (Schreiber only, ±1h around kickoff)
  const [showRoster, setShowRoster] = useState(false)

  // Close the self-assign confirmation dialog on Escape (parity with GameDetailModal).
  useEffect(() => {
    if (!confirmRole) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setConfirmRole(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [confirmRole])

  // The assigned Schreiber (scorer / scorer_scoreboard / bb_scorer — NOT the
  // pure Täfeler/timekeeper roles) may view the home team's roster, but only
  // from 1h before until 1h after the game. The endpoint re-checks both; this
  // just gates the button. Matches ROSTER_ROLE_COLS in scorer-roster.js.
  const canViewRoster = !!userId
    && (sport === 'volleyball'
      ? game.scorer_member === userId || game.scorer_scoreboard_member === userId
      : game.bb_scorer_member === userId)
    && isWithinGameContactWindow(game.date, game.time)

  // Can this user self-assign to a role? (A role is takeable only while it has
  // no person — per-role checks below; there is no game-level confirmed lock.)
  function canSelfAssign(role: AssignRole): boolean {
    if (!userId) return false

    if (sport === 'volleyball') {
      const vbRole = role as VbAssignRole
      // Separate-mode scorer (3L and up / HU23) needs a scorer licence; the
      // combined scorer/Täfeler, the pure Täfeler and the referee need none.
      if (vbRole === 'scorer' && !userLicences.includes('scorer_vb')) return false
      let dutyTeamId: string | undefined
      let currentPerson: string | undefined
      if (vbRole === 'scorer') {
        dutyTeamId = game.scorer_duty_team
        currentPerson = game.scorer_member
      } else if (vbRole === 'scoreboard') {
        dutyTeamId = game.scoreboard_duty_team
        currentPerson = game.scoreboard_member
      } else if (vbRole === 'referee') {
        dutyTeamId = game.referee_duty_team
        currentPerson = game.referee_member
      } else {
        dutyTeamId = game.scorer_scoreboard_duty_team
        currentPerson = game.scorer_scoreboard_member
      }
      if (currentPerson) return false
      if (!dutyTeamId) return false
      return userTeamIds.includes(dutyTeamId)
    } else {
      const bbRole = role as BbAssignRole
      if (bbRole === 'bb_scorer' && !userLicences.includes('otr1_bb')) return false
      if (bbRole === 'bb_timekeeper' && !userLicences.includes('otr1_bb')) return false
      if (bbRole === 'bb_24s_official' && !userLicences.includes('otr2_bb') && !userLicences.includes('otn_bb')) return false
      const currentPerson = game[bbRole]
      if (currentPerson) return false
      const dutyTeam = getDutyTeamForRole(bbRole)
      if (!dutyTeam) return false
      return userTeamIds.includes(dutyTeam)
    }
  }

  // Members have no games.update permission, so self-claim goes through the
  // duty-claim endpoint (validates open + duty-team membership + licence, writes
  // + stamps confirmed-by server-side). Raw-knex write → refetch explicitly.
  async function handleSelfAssign(role: AssignRole) {
    if (!userId) return
    setConfirmRole(null)
    try {
      await kscwApi(`/games/${game.id}/duty-claim`, { method: 'POST', body: { role } })
      toast.success(t('selfAssignSuccess'))
    } catch {
      // 409 (someone else just took it), 403 (licence/team), etc.
      toast.error(t('selfAssignError'))
    } finally {
      onRefetch?.()
    }
  }

  function handleAdminUpdate(gameId: string, fields: Partial<Game>) {
    // Assigning/clearing a role's member is the confirm/de-confirm; the hook
    // stamps (or wipes) that role's actor + time. A cleared dropdown emits '' —
    // coerce to null, since the *_member / *_duty_team columns are integer FKs
    // that reject "" (Postgres 500: invalid input syntax for type integer).
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) clean[k] = v === '' ? null : v
    onUpdate(gameId, clean as Partial<Game>)
  }

  const roleLabel = (role: AssignRole) => {
    if (role === 'scorer') return t('scorer')
    if (role === 'scoreboard') return t('scoreboard')
    if (role === 'scorer_scoreboard') return t('scorerTaefeler')
    if (role === 'referee') return t('referee')
    if (role === 'bb_scorer') return t('bbScorer')
    if (role === 'bb_timekeeper') return t('bbTimekeeper')
    if (role === 'bb_24s_official') return t('bb24sOfficial')
    return role
  }

  // Get the duty team ID for a role
  function getDutyTeamForRole(role: AssignRole): string {
    if (sport === 'volleyball') {
      if (role === 'scorer') return game.scorer_duty_team ?? ''
      if (role === 'scoreboard') return game.scoreboard_duty_team ?? ''
      if (role === 'referee') return game.referee_duty_team ?? ''
      return game.scorer_scoreboard_duty_team ?? ''
    }
    if (role === 'bb_scorer') return game.bb_scorer_duty_team ?? game.bb_duty_team ?? ''
    if (role === 'bb_timekeeper') return game.bb_timekeeper_duty_team ?? game.bb_duty_team ?? ''
    if (role === 'bb_24s_official') return game.bb_24s_duty_team ?? game.bb_duty_team ?? ''
    return game.bb_duty_team ?? ''
  }

  // Check if current user is the assigned member for a role
  function isUserAssigned(role: AssignRole): boolean {
    if (!userId) return false
    if (sport === 'volleyball') {
      if (role === 'scorer') return game.scorer_member === userId
      if (role === 'scoreboard') return game.scoreboard_member === userId
      if (role === 'referee') return game.referee_member === userId
      return game.scorer_scoreboard_member === userId
    }
    return game[role as BbAssignRole] === userId
  }

  // Get pending delegation name for a role
  function pendingNameForRole(role: AssignRole): string | undefined {
    const pending = getPendingForRole(game.id, role)
    if (!pending) return undefined
    return getDelegationTargetName(pending, members)
  }

  function handleDelegateConfirm(toMemberId: string, toTeamId: string) {
    if (!delegateRole || !onDelegate) return
    const fromTeamId = getDutyTeamForRole(delegateRole)
    onDelegate(game.id, delegateRole as ScorerDelegation['role'], toMemberId, fromTeamId, toTeamId)
    setDelegateRole(null)
  }

  const gameLabel = `${game.home_team} – ${game.away_team}`

  const sportBorder = sport === 'basketball'
    ? 'border-l-orange-400 dark:border-l-orange-500'
    : 'border-l-brand-400 dark:border-l-brand-500'

  // Helper to render a VB assignment editor
  const renderVbEditor = (role: VbAssignRole, labelKey: string, requiredLicence: LicenceType | undefined, teamField: keyof Game, personField: keyof Game) => (
    <AssignmentEditor
      label={t(labelKey)}
      requiredLicence={requiredLicence}
      teamValue={(game[teamField] as string) ?? ''}
      personValue={(game[personField] as string) ?? ''}
      members={members}
      teams={teams}
      teamMemberIds={teamMemberIds}
      sport={sport}
      onTeamChange={(v) => handleAdminUpdate(game.id, { [teamField]: v })}
      onPersonChange={(v) => handleAdminUpdate(game.id, { [personField]: v })}
      disabled={!effectiveCanEdit}
      showContact={showContact}
      selfAssignButton={canSelfAssign(role)}
      onSelfAssign={() => setConfirmRole(role)}
      guestMemberIds={guestMemberIds}
      canEdit={effectiveCanEdit}
      isCurrentUserAssigned={isUserAssigned(role)}
      onDelegate={onDelegate ? () => setDelegateRole(role) : undefined}
      pendingDelegationName={pendingNameForRole(role)}
      dutyConfirmed={!!game[personField]}
      confirmedByName={game[CONFIRM_COLS[role].byName] as string | null}
      confirmedAt={game[CONFIRM_COLS[role].at] as string | null}
      showConfirmedBy={isAdmin}
    />
  )

  return (
    <div className={`flex h-full flex-col rounded-lg border border-gray-200 border-l-4 ${sportBorder} bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800`}>
      {/* Game info */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-400">
          {dateStr} · {game.time ? formatTime(game.time) : ''}
        </div>
        {kscwTeam && <TeamChip team={kscwTeam} size="sm" />}
        <div className="min-w-0 break-words text-sm font-semibold text-gray-900 dark:text-gray-100">
          {gameLabel}
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
          {game.league}
        </span>
        <DutyStatus game={game} sport={sport} />
        {hall && (
          <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
            <MapPin className="h-3 w-3" />
            {hall.maps_url && sanitizeUrl(hall.maps_url) ? (
              <a href={sanitizeUrl(hall.maps_url)} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-600 dark:hover:text-brand-400">
                {hall.name}
              </a>
            ) : (
              hall.name
            )}
          </span>
        )}
        {gameNumber && (
          <span className="text-xs text-gray-400 dark:text-gray-500">#{gameNumber}</span>
        )}
        <button
          data-tour="ical-export"
          onClick={() => handleExportICal(expanded, t('scorerDutyIcal', { home: game.home_team, away: game.away_team }))}
          title={t('exportICal')}
          aria-label={t('exportICal')}
          className="ml-auto flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        >
          <Calendar className="h-4 w-4" />
        </button>
        {canViewRoster && (
          <button
            onClick={() => setShowRoster(true)}
            title={t('viewRoster')}
            aria-label={t('viewRoster')}
            className="flex min-h-[44px] items-center gap-1.5 rounded-lg bg-brand-50 px-3 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50"
          >
            <Users className="h-4 w-4" />
            {t('viewRoster')}
          </button>
        )}
      </div>

      {/* Arrival reminder — how early each duty must be in the hall */}
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Clock className="h-3.5 w-3.5 shrink-0" />
        {sport === 'basketball'
          ? t('arrivalHintSingle', { min: DUTY_ARRIVAL_MIN.bb_scorer })
          : vbCombined
            ? t('arrivalHintSingle', { min: DUTY_ARRIVAL_MIN.scorer_scoreboard })
            : vbReferee
              ? t('arrivalHintReferee', { min: DUTY_ARRIVAL_MIN.referee })
              : t('arrivalHintSplit', { scorer: DUTY_ARRIVAL_MIN.scorer, board: DUTY_ARRIVAL_MIN.scoreboard })}
      </div>

      {/* Assignment editors */}
      <div className="mt-3 flex-1 space-y-3">
        {sport === 'volleyball' ? (
          vbCombined ? (
            renderVbEditor('scorer_scoreboard', 'scorerTaefeler', undefined, 'scorer_scoreboard_duty_team', 'scorer_scoreboard_member')
          ) : vbReferee ? (
            renderVbEditor('referee', 'referee', undefined, 'referee_duty_team', 'referee_member')
          ) : (
            <>
              {renderVbEditor('scorer', 'scorer', 'scorer_vb', 'scorer_duty_team', 'scorer_member')}
              {renderVbEditor('scoreboard', 'scoreboard', undefined, 'scoreboard_duty_team', 'scoreboard_member')}
            </>
          )
        ) : (
          <>
            <AssignmentEditor
              label={t('bbScorer')}
              requiredLicence="otr1_bb"
              teamValue={game.bb_scorer_duty_team ?? game.bb_duty_team ?? ''}
              personValue={game.bb_scorer_member ?? ''}
              members={members}
              teams={teams}
              teamMemberIds={teamMemberIds}
              sport={sport}
              onTeamChange={(v) => handleAdminUpdate(game.id, { bb_scorer_duty_team: v })}
              onPersonChange={(v) => handleAdminUpdate(game.id, { bb_scorer_member: v })}
              disabled={!effectiveCanEdit}
              showContact={showContact}
              selfAssignButton={canSelfAssign('bb_scorer')}
              onSelfAssign={() => setConfirmRole('bb_scorer')}
              guestMemberIds={guestMemberIds}
              canEdit={effectiveCanEdit}
              isCurrentUserAssigned={isUserAssigned('bb_scorer')}
              onDelegate={onDelegate ? () => setDelegateRole('bb_scorer') : undefined}
              pendingDelegationName={pendingNameForRole('bb_scorer')}
              dutyConfirmed={!!game.bb_scorer_member}
              confirmedByName={game.bb_scorer_confirmed_by_name}
              confirmedAt={game.bb_scorer_confirmed_at}
              showConfirmedBy={isAdmin}
            />
            <AssignmentEditor
              label={t('bbTimekeeper')}
              requiredLicence="otr1_bb"
              teamValue={game.bb_timekeeper_duty_team ?? game.bb_duty_team ?? ''}
              personValue={game.bb_timekeeper_member ?? ''}
              members={members}
              teams={teams}
              teamMemberIds={teamMemberIds}
              sport={sport}
              onTeamChange={(v) => handleAdminUpdate(game.id, { bb_timekeeper_duty_team: v })}
              onPersonChange={(v) => handleAdminUpdate(game.id, { bb_timekeeper_member: v })}
              disabled={!effectiveCanEdit}
              showContact={showContact}
              selfAssignButton={canSelfAssign('bb_timekeeper')}
              onSelfAssign={() => setConfirmRole('bb_timekeeper')}
              guestMemberIds={guestMemberIds}
              canEdit={effectiveCanEdit}
              isCurrentUserAssigned={isUserAssigned('bb_timekeeper')}
              onDelegate={onDelegate ? () => setDelegateRole('bb_timekeeper') : undefined}
              pendingDelegationName={pendingNameForRole('bb_timekeeper')}
              dutyConfirmed={!!game.bb_timekeeper_member}
              confirmedByName={game.bb_timekeeper_confirmed_by_name}
              confirmedAt={game.bb_timekeeper_confirmed_at}
              showConfirmedBy={isAdmin}
            />
            {show24s ? (
              <AssignmentEditor
                label={t('bb24sOfficial')}
                requiredLicence={['otr2_bb', 'otn_bb']}
                teamValue={game.bb_24s_duty_team ?? game.bb_duty_team ?? ''}
                personValue={game.bb_24s_official ?? ''}
                members={members}
                teams={teams}
                teamMemberIds={teamMemberIds}
                sport={sport}
                onTeamChange={(v) => handleAdminUpdate(game.id, { bb_24s_duty_team: v })}
                onPersonChange={(v) => handleAdminUpdate(game.id, { bb_24s_official: v })}
                disabled={!effectiveCanEdit}
                showContact={showContact}
                selfAssignButton={canSelfAssign('bb_24s_official')}
                onSelfAssign={() => setConfirmRole('bb_24s_official')}
                guestMemberIds={guestMemberIds}
                canEdit={effectiveCanEdit}
                isCurrentUserAssigned={isUserAssigned('bb_24s_official')}
                onDelegate={onDelegate ? () => setDelegateRole('bb_24s_official') : undefined}
                pendingDelegationName={pendingNameForRole('bb_24s_official')}
                dutyConfirmed={!!game.bb_24s_official}
                confirmedByName={game.bb_24s_confirmed_by_name}
                confirmedAt={game.bb_24s_confirmed_at}
                showConfirmedBy={isAdmin}
                onHide={!game.bb_24s_official ? () => setShow24s(false) : undefined}
              />
            ) : (
              <button
                onClick={() => setShow24s(true)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('bb24sOfficial')}
              </button>
            )}
          </>
        )}

        {/* Per-duty "Confirmed by … · time" is shown inside each AssignmentEditor
            (admins only). De-confirming a duty = clearing its person dropdown
            (disabled on past games via effectiveCanEdit). */}
      </div>

      {/* Self-assign confirmation popup */}
      {confirmRole && (() => {
        const arrivalKey = sport === 'basketball'
          ? 'confirmSelfAssignArrival_bb'
          : `confirmSelfAssignArrival_${confirmRole}` as const
        return (
          <div role="dialog" aria-modal="true" aria-label={t('confirmSelfAssignTitle')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmRole(null)}>
            <div className="mx-4 w-full max-w-sm rounded-xl bg-white shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="border-b border-gray-100 px-5 pb-4 pt-5 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('confirmSelfAssignTitle')}
                </h3>
                {/* Hardcoded i18n string, DOMPurify-sanitized before injection */}
                <p
                  className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400 [&_strong]:font-semibold [&_strong]:text-gray-900 dark:[&_strong]:text-gray-100"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(t('confirmSelfAssignMessage', {
                      role: roleLabel(confirmRole),
                      game: gameLabel,
                      date: dateStr,
                      interpolation: { escapeValue: false },
                    })),
                  }}
                />
              </div>

              {/* Info items */}
              <div className="space-y-0 px-5 py-3">
                {/* Arrival time — hardcoded i18n string, DOMPurify-sanitized before injection */}
                <div className="flex gap-3 rounded-lg px-1 py-2.5">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400" />
                  <p
                    className="text-sm leading-relaxed text-gray-600 dark:text-gray-400 [&_strong]:font-semibold [&_strong]:text-gray-900 dark:[&_strong]:text-gray-100"
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(t(arrivalKey, { interpolation: { escapeValue: false } })),
                    }}
                  />
                </div>

                {/* Absence alert — the user is marked absent on this date. Does
                    NOT block the claim, just warns. */}
                {hasAbsenceOnGameDate && (
                  <div className="flex gap-3 rounded-lg bg-red-50/80 px-3 py-2.5 dark:bg-red-900/10">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                    <p className="text-sm leading-relaxed text-red-700 dark:text-red-400">
                      {t('confirmSelfAssignAbsence')}
                    </p>
                  </div>
                )}

                {/* Warning: final — delegation only */}
                <div className="flex gap-3 rounded-lg bg-amber-50/80 px-3 py-2.5 dark:bg-amber-900/10">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                  {/* Hardcoded i18n string, DOMPurify-sanitized before injection */}
                  <p
                    className="text-sm leading-relaxed text-amber-700 dark:text-amber-400 [&_strong]:font-semibold"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('confirmSelfAssignWarning')) }}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 border-t border-gray-100 px-5 pb-5 pt-4 dark:border-gray-700">
                <button
                  onClick={() => setConfirmRole(null)}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  {t('cancelAction')}
                </button>
                <button
                  onClick={() => handleSelfAssign(confirmRole)}
                  className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                >
                  {t('confirmAction')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Delegation modal */}
      {delegateRole && (
        <DelegationModal
          role={delegateRole as ScorerDelegation['role']}
          roleLabel={roleLabel(delegateRole)}
          gameLabel={`${gameLabel} · ${dateStr}`}
          dutyTeamId={getDutyTeamForRole(delegateRole)}
          members={members}
          teams={teams}
          memberTeams={memberTeams}
          currentUserId={userId ?? ''}
          onDelegate={handleDelegateConfirm}
          onClose={() => setDelegateRole(null)}
        />
      )}

      {/* Home-team roster (Schreiber only, ±1h around kickoff) */}
      {showRoster && (
        <RosterModal key={game.id} gameId={game.id} onClose={() => setShowRoster(false)} />
      )}
    </div>
  )
}
