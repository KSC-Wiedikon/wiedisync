import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, X, Check, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import type { Game, Team, Hall, Member, BaseRecord } from '../../../types'
import { Button } from '@/components/ui/button'
import TeamChip from '../../../components/TeamChip'
import { teamNameToColorKey } from '../../../utils/teamColors'
import ParticipationSummary from '../../../components/ParticipationSummary'
import { rsvpButtonClass } from '../../../utils/participationColors'
import ParticipationRosterModal from '../../../components/ParticipationRosterModal'
import RosterModal from '../../scorer/components/RosterModal'
import { useAuth } from '../../../hooks/useAuth'
import { useParticipation } from '../../../hooks/useParticipation'
import { useMyCoveringAbsence } from '../../../hooks/useMyCoveringAbsence'
import { useAbsenceNoteText } from '../../../hooks/useAbsenceNoteText'
import { useMutation } from '../../../hooks/useMutation'
import { fetchItem, kscwApi } from '../../../lib/api'
import { useConfirm } from '../../../components/ConfirmProvider'
import { sanitizeUrl } from '../../../utils/sanitizeUrl'
import DatePicker from '@/components/ui/DatePicker'
import { currentLocale, formatDate, formatTime, parseRespondByTime, toUtcIsoFromDatetimeLocal, isWithinDutyLateWindow } from '../../../utils/dateHelpers'
import RefereeExpenseSection from './RefereeExpenseSection'
import TasksSection from '../../tasks/TasksSection'
import CarpoolSection from '../../carpool/CarpoolSection'
import BroadcastButton from '../../broadcast/BroadcastButton'
import { isFeatureEnabled } from '../../../utils/featureToggles'
import { asObj, relId, teamCoachIds } from '../../../utils/relations'
import CancelActivityButton from '../../../components/CancelActivityButton'

const GAME_EXPAND = 'kscw_team,hall,scorer_member,scoreboard_member,scorer_scoreboard_member,referee_member,scorer_duty_team,scoreboard_duty_team,scorer_scoreboard_duty_team,referee_duty_team,bb_scorer_member,bb_timekeeper_member,bb_24s_official,bb_duty_team,bb_scorer_duty_team,bb_timekeeper_duty_team,bb_24s_duty_team'

/** Late-report state for a game's duties, from GET /kscw/games/:id/duty-late. */
type DutyLateReport = { at: string; by_name: string }
type DutyLateContact = { phone: string | null; email: string | null; hide_phone: boolean; hide_email: boolean }
type DutyLateData = { reports: Record<string, DutyLateReport>; contacts: Record<string, DutyLateContact> }

interface GameDetailModalProps {
  game: Game | null
  onClose: () => void
  readOnly?: boolean
}

type ExpandedGame = Game & {
  kscw_team: (Team & BaseRecord) | string
  hall: (Hall & BaseRecord) | string
  scorer_member: (Member & BaseRecord) | string
  scoreboard_member: (Member & BaseRecord) | string
  scorer_scoreboard_member: (Member & BaseRecord) | string
  referee_member: (Member & BaseRecord) | string
  scorer_duty_team: (Team & BaseRecord) | string
  scoreboard_duty_team: (Team & BaseRecord) | string
  scorer_scoreboard_duty_team: (Team & BaseRecord) | string
  referee_duty_team: (Team & BaseRecord) | string
  bb_scorer_member: (Member & BaseRecord) | string
  bb_timekeeper_member: (Member & BaseRecord) | string
  bb_24s_official: (Member & BaseRecord) | string
  bb_duty_team: (Team & BaseRecord) | string
  bb_scorer_duty_team: (Team & BaseRecord) | string
  bb_timekeeper_duty_team: (Team & BaseRecord) | string
  bb_24s_duty_team: (Team & BaseRecord) | string
}

function parseSets(json: unknown): Array<{ home: number; away: number }> {
  if (!Array.isArray(json)) return []
  return json.filter(
    (s): s is { home: number; away: number } =>
      typeof s === 'object' && s !== null && 'home' in s && 'away' in s,
  )
}

const dateFormatOptions: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
}

export default function GameDetailModal({ game, onClose, readOnly }: GameDetailModalProps) {
  const { t } = useTranslation('games')
  const { user, isCoachOf, isStaffOnly, canParticipateIn, isGuestIn, coachTeamIds, teamResponsibleIds, hasAdminAccessToTeam } = useAuth()
  const confirm = useConfirm()
  const [rosterOpen, setRosterOpen] = useState(false)
  const [editingDeadline, setEditingDeadline] = useState(false)
  const [deadlineValue, setDeadlineValue] = useState(() => {
    const parsed = parseRespondByTime(game?.respond_by, game?.time)
    return parsed?.date ?? ''
  })
  const [deadlineTime, setDeadlineTime] = useState(() => {
    const parsed = parseRespondByTime(game?.respond_by, game?.time)
    return parsed?.time ?? ''
  })
  const [fullGame, setFullGame] = useState<Game | null>(null)
  const [lateData, setLateData] = useState<DutyLateData | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const { update: updateGame } = useMutation<Game>('games')
  const canParticipate = !!user && !!game?.kscw_team && canParticipateIn(relId(game.kscw_team))
  const isStaffParticipant = !!game?.kscw_team && isStaffOnly(relId(game.kscw_team))
  const { effectiveStatus, hasAbsence, note: savedNote, setStatus, saveConfirmed, dismissConfirmed } = useParticipation(
    'game',
    game?.id ?? '',
    game?.date,
    undefined,
    isStaffParticipant,
  )
  const { absence } = useMyCoveringAbsence('game', game?.date)
  const absenceLabel = absence?.type === 'weekly' ? 'participation:declinedUnavailable' : 'participation:absent'
  const absenceNoteText = useAbsenceNoteText(absence)
  const [noteText, setNoteText] = useState(savedNote)
  const [noteSaved, setNoteSaved] = useState(false)
  const noteInitRef = useRef(savedNote)
  // Sync note text — fall back to absence label when no server note.
  const effectiveSync = savedNote || absenceNoteText
  if (effectiveSync !== noteInitRef.current) {
    noteInitRef.current = effectiveSync
    setNoteText(effectiveSync)
  }

  // Auto-dismiss status confirmation after 2s
  useEffect(() => {
    if (!saveConfirmed) return
    const timer = setTimeout(dismissConfirmed, 2000)
    return () => clearTimeout(timer)
  }, [saveConfirmed, dismissConfirmed])

  // Auto-dismiss note confirmation after 2s
  useEffect(() => {
    if (!noteSaved) return
    const timer = setTimeout(() => setNoteSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [noteSaved])

  const saveNote = () => {
    if (noteText !== savedNote && effectiveStatus) {
      setStatus(effectiveStatus as 'confirmed' | 'tentative' | 'declined', noteText)
      setNoteSaved(true)
    }
  }

  // Re-fetch with full expand when opened from calendar (which only expands kscw_team,hall)
  useEffect(() => {
    setFullGame(null)
    if (!game) return
    const exp = game as unknown as ExpandedGame
    const needsExpand =
      (game.scorer_member && !asObj(exp.scorer_member)) ||
      (game.scoreboard_member && !asObj(exp.scoreboard_member)) ||
      (game.scorer_scoreboard_member && !asObj(exp.scorer_scoreboard_member)) ||
      (game.scorer_duty_team && !asObj(exp.scorer_duty_team)) ||
      (game.scoreboard_duty_team && !asObj(exp.scoreboard_duty_team)) ||
      (game.scorer_scoreboard_duty_team && !asObj(exp.scorer_scoreboard_duty_team)) ||
      (game.bb_scorer_member && !asObj(exp.bb_scorer_member)) ||
      (game.bb_timekeeper_member && !asObj(exp.bb_timekeeper_member)) ||
      (game.bb_24s_official && !asObj(exp.bb_24s_official)) ||
      (game.bb_duty_team && !asObj(exp.bb_duty_team)) ||
      (game.bb_scorer_duty_team && !asObj(exp.bb_scorer_duty_team)) ||
      (game.bb_timekeeper_duty_team && !asObj(exp.bb_timekeeper_duty_team)) ||
      (game.bb_24s_duty_team && !asObj(exp.bb_24s_duty_team))
    if (needsExpand) {
      fetchItem<Game>('games', game.id, { fields: ['*', ...GAME_EXPAND.split(',').map(r => `${r}.*`)] }).then(r => setFullGame(r)).catch(() => {})
    }
  }, [game])

  // Late-report state — only for coaches/TRs/admins of the PLAYING team, on home
  // games. Lets the "duty is late" reveal survive a reload without re-emailing.
  useEffect(() => {
    setLateData(null)
    if (!game?.id || game.type !== 'home') return
    const teamId = relId(game.kscw_team)
    const canSee = hasAdminAccessToTeam(teamId) || coachTeamIds.includes(teamId) || teamResponsibleIds.includes(teamId)
    if (!canSee) return
    let cancelled = false
    kscwApi<DutyLateData>(`/games/${game.id}/duty-late`)
      .then((r) => { if (!cancelled) setLateData(r) })
      .catch(() => { /* non-fatal — alarm still works, reveal just won't pre-populate */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per game open; auth read via closure
  }, [game?.id, game?.type])

  useEffect(() => {
    if (!game) return
    const dialog = dialogRef.current
    const focusables = () => dialog
      ? Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null)
      : []
    // Initial-focus management: move focus into the dialog on open.
    focusables()[0]?.focus()
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialog) return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      // Only wrap at the dialog's own edges. When focus is elsewhere (e.g. the
      // nested roster sub-modal), leave it alone so we don't hijack its tabbing.
      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [game, onClose])

  if (!game) return null

  const expanded = (fullGame ?? game) as unknown as ExpandedGame
  const expandedHall = asObj<Hall & BaseRecord>(expanded.hall)
  const awayHall = game.away_hall_json
  const awayMapsUrl = awayHall
    ? awayHall.plus_code
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(awayHall.plus_code)}`
      : awayHall.address && awayHall.city
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${awayHall.address}, ${awayHall.city}`)}`
        : ''
    : ''
  const hall = expandedHall ?? (awayHall ? { name: awayHall.name, address: awayHall.address, city: awayHall.city, maps_url: awayMapsUrl } : null)
  const kscwTeamObj = asObj<Team & BaseRecord>(expanded.kscw_team)
  const kscwTeamId = relId(game?.kscw_team)
  const rawKscwTeam = kscwTeamObj?.name ?? ''
  const kscwSport = kscwTeamObj?.sport as 'volleyball' | 'basketball' | undefined
  const kscwTeam = rawKscwTeam && kscwSport ? teamNameToColorKey(rawKscwTeam, kscwSport) : rawKscwTeam
  // Show OUR side from the linked team's VM-owned name (teams.full_name) so it
  // mirrors VM even when the SV API caption lags (e.g. DU23-1 → DU23-2). Opponent
  // keeps the SV caption; falls back to the stored string if kscw_team is bare.
  const kscwFullLabel = kscwTeamObj?.full_name || (rawKscwTeam ? `KSC Wiedikon ${rawKscwTeam}` : '')
  const homeLabel = game.type === 'home' && kscwFullLabel ? kscwFullLabel : game.home_team
  const awayLabel = game.type === 'away' && kscwFullLabel ? kscwFullLabel : game.away_team
  const sets = parseSets(game.sets_json)
  // Long date with weekday/month NAMES — follow the active UI language. The
  // strict de-CH rule (CLAUDE.md) applies to numeric dd.mm.yyyy dates only.
  const dateStr = game.date ? new Intl.DateTimeFormat(currentLocale(), dateFormatOptions).format(new Date(game.date)) : ''
  // Contact reveal: admins (sport/global) still see it anytime via the items
  // API. Coaches/TRs no longer see it automatically — it's kept out of sight and
  // revealed only behind the per-role "duty is late" alarm (handled per row).
  const adminSeesContact = hasAdminAccessToTeam(kscwTeamId)
  // Staff of the playing team — coach, team-responsible, or admin. Gates the
  // referee-expenses panel (hidden from everyone else).
  const isTeamStaff = adminSeesContact || isCoachOf(kscwTeamId) || teamResponsibleIds.includes(kscwTeamId)
  // The assigned Schreiber (scorer roles only — pure Täfeler excluded, mirroring
  // the roster endpoint). For them "View roster" opens the confirmed match sheet
  // (jersey #, DoB, coaches, ±window) instead of the RSVP roster. `user.id` is a
  // member id here (useAuth().user is a Member), so it compares to the duty FKs.
  const myMemberId = user?.id ? String(user.id) : ''
  const isAssignedScorer = !!myMemberId && [game.scorer_member, game.scorer_scoreboard_member, game.bb_scorer_member]
    .some((v) => v != null && String(relId(v)) === myMemberId)
  const canReportLate = !!user && game.status === 'scheduled' && game.type === 'home'
    && (adminSeesContact || coachTeamIds.includes(kscwTeamId) || teamResponsibleIds.includes(kscwTeamId))
  const sportWord = kscwSport === 'basketball' ? t('scoreboardBasketball') : t('scoreboardVolleyball')

  // Flag a duty official as late: confirm → email (official + sport TK + admin)
  // via the endpoint → reveal their contact until kickoff (+ grace). Idempotent
  // server-side, so a second press won't re-email.
  const gameId = game.id
  async function reportLate(role: string, roleLabel: string, personName: string) {
    const ok = await confirm({
      title: t('dutyLateConfirmTitle', { role: roleLabel }),
      message: t('dutyLateConfirmMessage', { name: personName || roleLabel, sport: sportWord }),
      confirmLabel: t('dutyLateConfirmCta'),
      danger: true,
    })
    if (!ok) return
    try {
      const res = await kscwApi<{ report: DutyLateReport; contact: DutyLateContact }>(
        `/games/${gameId}/duty-late`, { method: 'POST', body: { role } },
      )
      setLateData((prev) => ({
        reports: { ...(prev?.reports ?? {}), [role]: res.report },
        contacts: { ...(prev?.contacts ?? {}), [role]: res.contact },
      }))
      toast.success(t('dutyLateReported', { name: personName || roleLabel }))
    } catch {
      toast.error(t('common:error'))
    }
  }

  const lateProps = (role: string) => ({
    role,
    gameDate: game.date,
    gameTime: game.time,
    adminSeesContact,
    canReportLate,
    reported: lateData?.reports?.[role] ?? null,
    revealedContact: lateData?.contacts?.[role] ?? null,
    onReport: reportLate,
  })
  const homeWon = Number(game.home_score) > Number(game.away_score)
  const awayWon = Number(game.away_score) > Number(game.home_score)
  const kscwWon = game.type === 'home' ? homeWon : awayWon
  const kscwLost = game.type === 'home' ? awayWon : homeWon
  const scoreColor = kscwWon ? 'text-green-600 dark:text-green-400' : kscwLost ? 'text-red-500 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'

  return (
    <>
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — meta on row 1, actions on their own row so the top never
            smushes on mobile (league name + chip + actions used to fight for space). */}
        <div className="border-b dark:border-gray-700 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {kscwTeam && <TeamChip team={kscwTeam} size="sm" />}
            </div>
            <button
              onClick={onClose}
              aria-label={t('common:close', 'Close')}
              className="-mr-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 sm:-mr-1 sm:min-h-0 sm:min-w-0 sm:p-1 dark:hover:bg-gray-700"
            >
            <X className="h-5 w-5" />
            </button>
          </div>

          {/* Actions row — hidden when the viewer can neither broadcast nor cancel
              (both sub-components render null in that case → :empty). */}
          {(game.status === 'scheduled' || game.status === 'cancelled') && (
            <div className="mt-3 flex flex-wrap items-center gap-2 empty:hidden">
              {game.status === 'scheduled' && (
                <BroadcastButton
                  labelAlwaysVisible
                  activity={{
                    type: 'game',
                    id: Number(game.id),
                    title: `${homeLabel} vs ${awayLabel}`,
                    start_date: game.date && game.time ? `${game.date}T${game.time}` : game.date,
                    location: hall?.name ?? undefined,
                    teamName: rawKscwTeam || undefined,
                    sport: kscwSport ?? null,
                    teamId: kscwTeamId ? Number(kscwTeamId) : undefined,
                  }}
                  member={user ? {
                    id: user.id,
                    role: user.role ?? null,
                    isCoachOf: coachTeamIds,
                    isResponsibleOf: teamResponsibleIds,
                  } : null}
                />
              )}
              <CancelActivityButton
                kind="game"
                activityId={game.id}
                isCancelled={game.status === 'cancelled'}
                teamIds={kscwTeamId ? [kscwTeamId] : []}
                variant="inline"
                onDone={onClose}
              />
            </div>
          )}
        </div>

        {/* Teams & Score */}
        <div className="px-6 py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 text-right">
              <p className={`text-base text-gray-900 dark:text-gray-100 ${game.type === 'home' ? 'font-semibold' : ''}`}>
                {homeLabel}
              </p>
            </div>

            <div className="shrink-0 text-center">
              {game.status === 'completed' || game.status === 'live' ? (
                <div className="font-mono text-3xl font-bold">
                  <span className={game.type === 'home' ? scoreColor : 'text-gray-500 dark:text-gray-400'}>{game.home_score}</span>
                  <span className="mx-1 text-gray-400 dark:text-gray-500">:</span>
                  <span className={game.type === 'away' ? scoreColor : 'text-gray-500 dark:text-gray-400'}>{game.away_score}</span>
                </div>
              ) : (
                <div className="text-base font-light text-gray-400 dark:text-gray-500">vs</div>
              )}
            </div>

            <div className="flex-1">
              <p className={`text-base text-gray-900 dark:text-gray-100 ${game.type === 'away' ? 'font-semibold' : ''}`}>
                {awayLabel}
              </p>
            </div>
          </div>

          {/* Sets breakdown */}
          {sets.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-center text-sm tabular-nums" style={{ tableLayout: 'fixed' }}>
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400">
                    <th className="px-3 py-2 w-20 text-left"></th>
                    {sets.map((_, i) => (
                      <th key={i} className="px-3 py-2">
                        {t('set')} {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t dark:border-gray-700">
                    <td className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">{t('home')}</td>
                    {sets.map((s, i) => {
                      const kscwWonSet = (s.home > s.away) === (game.type === 'home')
                      return (
                        <td
                          key={i}
                          className={`px-3 py-2 font-bold ${kscwWonSet ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}
                        >
                          {s.home}
                        </td>
                      )
                    })}
                  </tr>
                  <tr className="border-t dark:border-gray-700">
                    <td className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">{t('away')}</td>
                    {sets.map((s, i) => {
                      const kscwWonSet = (s.home > s.away) === (game.type === 'home')
                      return (
                        <td
                          key={i}
                          className={`px-3 py-2 font-bold ${kscwWonSet ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}
                        >
                          {s.away}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Participation — only for own team's scheduled games */}
        {game.status === 'scheduled' && canParticipate && (
          isGuestIn(kscwTeamId) ? (
            <div className="border-t dark:border-gray-700 px-6 py-3">
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t('games:guestsCannotParticipate')}
              </p>
            </div>
          ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t dark:border-gray-700 px-6 py-3">
            {hasAbsence && (
              <span className="w-full text-xs italic text-gray-500 dark:text-gray-400">{t(absenceLabel)}</span>
            )}
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('participation:attending')}</span>
                <div className="relative flex gap-2">
                  <button
                    onClick={() => setStatus('confirmed', noteText)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${rsvpButtonClass('confirmed', effectiveStatus === 'confirmed')}`}
                  >
                    {t('participation:yes')}
                  </button>
                  <button
                    onClick={() => setStatus('tentative', noteText)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${rsvpButtonClass('tentative', effectiveStatus === 'tentative')}`}
                  >
                    {t('participation:maybe')}
                  </button>
                  <button
                    onClick={() => setStatus('declined', noteText)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${rsvpButtonClass('declined', effectiveStatus === 'declined')}`}
                  >
                    {t('participation:no')}
                  </button>
                  {/* Save confirmation popover — colored by response */}
                  {saveConfirmed && (() => {
                    const popoverColor = effectiveStatus === 'declined'
                      ? 'bg-red-600 text-white'
                      : effectiveStatus === 'tentative'
                        ? 'bg-yellow-500 text-black'
                        : 'bg-green-600 text-white'
                    return (
                      <span className={`absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium shadow-lg animate-fade-in ${popoverColor}`}>
                        <Check className="h-3 w-3" />
                        {t('participation:saved')}
                      </span>
                    )
                  })()}
                </div>
            </div>
            {/* RSVP tallies on their own full-width row, centred under the buttons */}
            <div className="flex w-full justify-center pt-1">
              <ParticipationSummary activityType="game" activityId={game.id} bars coachMemberIds={teamCoachIds(kscwTeamObj)} />
            </div>
            {/* Participation note */}
            {effectiveStatus && (
              <div className="relative flex w-full items-center gap-2 pt-1">
                <MessageSquare className="h-4 w-4 shrink-0 text-gray-400" />
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveNote()
                  }}
                  placeholder={t('participation:notePlaceholder')}
                  className="min-w-0 flex-1 rounded-md border border-gray-200 bg-transparent px-2.5 py-1 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand-400 focus:outline-none dark:border-gray-600 dark:text-gray-300 dark:placeholder:text-gray-500 dark:focus:border-brand-500"
                />
                <button
                  onClick={saveNote}
                  disabled={noteText === savedNote}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-green-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-green-400"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          )
        )}

        {/* Show roster — directly beneath the RSVP tallies, visible for any
            scheduled game (also for guests / non-participants, who don't see
            the Attending? block above). */}
        {game.status === 'scheduled' && (
          <div className="border-t dark:border-gray-700 px-6 py-3">
            <Button
              variant="outline"
              onClick={() => setRosterOpen(true)}
              className="w-full"
            >
              {t('participationRoster')}
            </Button>
          </div>
        )}

        {/* Game info */}
        <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('gameInfo')}
          </h4>
          {game.league && <DetailRow label={t('league')} value={game.league} />}
          <DetailRow label={t('date')} value={dateStr} />
          <DetailRow label={t('kickoff')} value={game.time ? formatTime(game.time) : '–'} />
          <DetailRow label={t('gameType')} value={game.type === 'home' ? t('typeHome') : t('typeAway')} />
          {game.game_id && <DetailRow label={t('gameNumber')} value={game.game_id.replace(/^(vb_|bb_)/, '')} />}
          {game.season && <DetailRow label={t('season')} value={game.season} />}
        </div>

        {/* Venue */}
        {hall && (
          <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('venue')}
            </h4>
            <DetailRow label={t('hallLabel')} value={hall.name} />
            {hall.address && (() => {
              const mapsUrl = (hall.maps_url && sanitizeUrl(hall.maps_url))
                || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([hall.address, hall.city].filter(Boolean).join(', '))}`
              return (
                <div className="flex items-start gap-3 text-sm">
                  <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">{t('address')}</span>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {[hall.address, hall.city].filter(Boolean).join(', ')} ↗
                  </a>
                </div>
              )
            })()}
          </div>
        )}

        {/* Referees */}
        {game.referees_json && game.referees_json.length > 0 && (
          <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('referees')}
            </h4>
            {game.referees_json.map((ref, i) => (
              <DetailRow key={i} label={t((['referee1st', 'referee2nd', 'referee3rd'] as const)[i] ?? 'referee')} value={ref.name} />
            ))}
          </div>
        )}

        {/* Referee expenses — volleyball home games, staff only (coach/TR/admin) */}
        {kscwSport === 'volleyball' && game.type === 'home' && isTeamStaff && (
          <div className="border-t dark:border-gray-700 px-6 py-4">
            <RefereeExpenseSection
              gameId={game.id}
              teamId={kscwTeamId}
              canEdit={!readOnly && isCoachOf(kscwTeamId)}
            />
          </div>
        )}

        {/* Scorer duties — Volleyball */}
        {kscwSport !== 'basketball' &&
        (game.scorer_member || game.scoreboard_member || game.scorer_scoreboard_member || game.referee_member) && (
          <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('scorerDuties')}
            </h4>
            {asObj<Member & BaseRecord>(expanded.scorer_scoreboard_member) ? (
              <DutyPersonRow
                label={t('scorerTaefeler')}
                member={asObj<Member & BaseRecord>(expanded.scorer_scoreboard_member)}
                dutyTeam={asObj<Team & BaseRecord>(expanded.scorer_scoreboard_duty_team)}
                {...lateProps('scorer_scoreboard')}
              />
            ) : (
              <>
                {asObj<Member & BaseRecord>(expanded.scorer_member) && (
                  <DutyPersonRow
                    label={t('scorer')}
                    member={asObj<Member & BaseRecord>(expanded.scorer_member)}
                    dutyTeam={asObj<Team & BaseRecord>(expanded.scorer_duty_team)}
                    {...lateProps('scorer')}
                  />
                )}
                {asObj<Member & BaseRecord>(expanded.scoreboard_member) && (
                  <DutyPersonRow
                    label={t('scoreboard')}
                    member={asObj<Member & BaseRecord>(expanded.scoreboard_member)}
                    dutyTeam={asObj<Team & BaseRecord>(expanded.scoreboard_duty_team)}
                    {...lateProps('scoreboard')}
                  />
                )}
              </>
            )}
            {asObj<Member & BaseRecord>(expanded.referee_member) && (
              <DutyPersonRow
                label={t('referee')}
                member={asObj<Member & BaseRecord>(expanded.referee_member)}
                dutyTeam={asObj<Team & BaseRecord>(expanded.referee_duty_team)}
                {...lateProps('referee')}
              />
            )}
          </div>
        )}

        {/* Scorer duties — Basketball */}
        {kscwSport === 'basketball' &&
        (game.bb_scorer_member || game.bb_timekeeper_member || game.bb_24s_official || game.bb_duty_team || game.bb_scorer_duty_team || game.bb_timekeeper_duty_team || game.bb_24s_duty_team) && (
          <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('officialsDuties')}
            </h4>
            {(asObj<Member & BaseRecord>(expanded.bb_scorer_member) || game.bb_scorer_member) && (
              <DutyPersonRow
                label={t('bbScorer', { ns: 'scorer' })}
                member={asObj<Member & BaseRecord>(expanded.bb_scorer_member)}
                dutyTeam={asObj<Team & BaseRecord>(expanded.bb_scorer_duty_team) ?? asObj<Team & BaseRecord>(expanded.bb_duty_team)}
                {...lateProps('bb_scorer')}
              />
            )}
            {(asObj<Member & BaseRecord>(expanded.bb_timekeeper_member) || game.bb_timekeeper_member) && (
              <DutyPersonRow
                label={t('bbTimekeeper', { ns: 'scorer' })}
                member={asObj<Member & BaseRecord>(expanded.bb_timekeeper_member)}
                dutyTeam={asObj<Team & BaseRecord>(expanded.bb_timekeeper_duty_team) ?? asObj<Team & BaseRecord>(expanded.bb_duty_team)}
                {...lateProps('bb_timekeeper')}
              />
            )}
            {(asObj<Member & BaseRecord>(expanded.bb_24s_official) || game.bb_24s_official) && (
              <DutyPersonRow
                label={t('bb24sOfficial')}
                member={asObj<Member & BaseRecord>(expanded.bb_24s_official)}
                dutyTeam={asObj<Team & BaseRecord>(expanded.bb_24s_duty_team) ?? asObj<Team & BaseRecord>(expanded.bb_duty_team)}
                {...lateProps('bb_24s_official')}
              />
            )}
          </div>
        )}

        {/* Tasks */}
        {game.status === 'scheduled' && user && isFeatureEnabled(kscwTeamObj?.features_enabled, 'tasks') && (
          <div className="border-t dark:border-gray-700 px-6 py-4">
            <TasksSection
              activityType="game"
              activityId={game.id}
              teamId={kscwTeamId}
              canManage={isCoachOf(kscwTeamId)}
            />
          </div>
        )}

        {/* Carpool — away games only */}
        {game.type === 'away' && game.status === 'scheduled' && user && isFeatureEnabled(kscwTeamObj?.features_enabled, 'carpool') && (
          <div className="border-t dark:border-gray-700 px-6 py-4">
            <CarpoolSection gameId={game.id} />
          </div>
        )}

        {/* Participation details (respond-by deadline — coach only). The roster
            button moved up beneath the RSVP tallies; this section now renders
            only when it has content (a deadline to show, or a coach who can
            set one) so it never leaves an empty bordered strip. */}
        {game.status === 'scheduled' && (game.respond_by || (!readOnly && isCoachOf(kscwTeamId))) && (
          <div className="space-y-3 border-t dark:border-gray-700 px-6 py-4">
            {game.respond_by && !editingDeadline && (
              <DetailRow label={t('respondBy')} value={`${formatDate(game.respond_by)}${(() => { const p = parseRespondByTime(game.respond_by, game.time); return p?.time ? `, ${p.time}` : '' })()}`} />
            )}
            {!readOnly && isCoachOf(kscwTeamId) && (
              editingDeadline ? (
                <div className="flex items-center gap-2">
                  <DatePicker
                    value={deadlineValue}
                    onChange={setDeadlineValue}
                    max={game.date?.split(' ')[0]}
                  />
                  <input
                    type="time"
                    value={deadlineTime || game?.time?.slice(0, 5) || ''}
                    onChange={(e) => setDeadlineTime(e.target.value)}
                    className="w-24 rounded-lg border px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      await updateGame(game.id, { respond_by: deadlineValue ? toUtcIsoFromDatetimeLocal(`${deadlineValue}T${deadlineTime || game?.time?.slice(0, 5) || '23:59'}`) : null })
                      setEditingDeadline(false)
                    }}
                  >
                    OK
                  </Button>
                  <button
                    onClick={() => setEditingDeadline(false)}
                    className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const parsed = parseRespondByTime(game.respond_by, game.time)
                    setDeadlineValue(parsed?.date ?? '')
                    setDeadlineTime(parsed?.time ?? '')
                    setEditingDeadline(true)
                  }}
                  className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                >
                  {t('setDeadline')}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
    {isAssignedScorer ? (
      rosterOpen && <RosterModal key={game.id} gameId={game.id} onClose={() => setRosterOpen(false)} />
    ) : (
      <ParticipationRosterModal
        open={rosterOpen}
        onClose={() => setRosterOpen(false)}
        activityType="game"
        activityId={game?.id ?? ''}
        activityDate={game?.date ?? ''}
        teamIds={kscwTeamId ? [kscwTeamId] : []}
        title={t('participationRoster')}
        activityKind={game ? `${homeLabel ?? ''} vs ${awayLabel ?? ''}`.trim() : undefined}
        respondBy={game?.respond_by}
        activityStartTime={game?.time}
        showRsvpTime={isFeatureEnabled(kscwTeamObj?.features_enabled, 'show_rsvp_time')}
      />
    )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-gray-100">{value}</span>
    </div>
  )
}

function DutyPersonRow({
  label, member, dutyTeam, role, gameDate, gameTime,
  adminSeesContact, canReportLate, reported, revealedContact, onReport,
}: {
  label: string
  member?: (Member & BaseRecord) | null
  dutyTeam?: (Team & BaseRecord) | null
  role: string
  gameDate?: string
  gameTime?: string
  adminSeesContact: boolean
  canReportLate: boolean
  reported: DutyLateReport | null
  revealedContact: DutyLateContact | null
  onReport: (role: string, roleLabel: string, personName: string) => void
}) {
  const { t } = useTranslation('games')
  const name = member ? `${member.first_name} ${member.last_name}` : ''
  const teamName = dutyTeam?.name
  const inWindow = isWithinDutyLateWindow(gameDate, gameTime, role)

  // Contact source: admins read it straight off the expanded member (items API);
  // coaches/TRs only after they've flagged the official late (endpoint payload).
  const contact: DutyLateContact | null = adminSeesContact
    ? (member ? { phone: member.phone ?? null, email: member.email ?? null, hide_phone: !!member.hide_phone, hide_email: !!member.hide_email } : null)
    : (reported ? revealedContact : null)
  const showPhone = !!(contact && !contact.hide_phone && contact.phone)
  const showEmail = !!(contact && !contact.hide_email && contact.email)

  // Coaches/TRs (not admins, who already see contact) get the alarm while inside
  // the role window and it hasn't been flagged yet.
  const showAlarm = canReportLate && !adminSeesContact && !reported && inWindow && !!member

  const reportedTime = reported?.at
    ? new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(reported.at))
    : ''

  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="w-28 shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-gray-900 dark:text-gray-100">
          {name}
          {teamName && <TeamChip team={teamName} size="xs" />}
        </span>

        {showAlarm && (
          <button
            type="button"
            onClick={() => onReport(role, label, name)}
            className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:bg-red-600 dark:hover:bg-red-500"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('dutyLateButton', { role: label })}
          </button>
        )}

        {!adminSeesContact && reported && (
          <div className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {t('dutyLateBanner', { time: reportedTime, name: reported.by_name })}
          </div>
        )}

        {(showPhone || showEmail) && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
            {showPhone && (
              <a href={`tel:${contact!.phone}`} className="font-medium hover:text-brand-600 dark:hover:text-brand-400">{contact!.phone}</a>
            )}
            {showEmail && (
              <a href={`mailto:${contact!.email}`} className="font-medium hover:text-brand-600 dark:hover:text-brand-400">{contact!.email}</a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
