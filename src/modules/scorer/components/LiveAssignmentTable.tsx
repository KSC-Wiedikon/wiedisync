// Assignment tab of /admin/scorer-assign whenever no planner draft is open: every
// upcoming home game of the sport with its SAVED duties, editable in place. Each
// pick is written at once with the same fields Scorer duty → Games writes
// (ScorerRow) — sport admins fix duty teams and persons here; only a superadmin
// runs the auto-assignment (owner decision 14.10.2026).
//
// ⚠ Same rules as ScorerRow: a row locks once the game has started, a cleared
// picker writes null (the columns are integer FKs that reject ""), and changing a
// VB duty team drops a person who is not in the new team (AssignmentEditor).

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import type { Game, Member, Team } from '../../../types'
import { relId } from '../../../utils/relations'
import { updateRecord } from '../../../lib/api'
import { invalidateForCollection } from '../../../lib/query'
import { logActivity } from '../../../utils/logActivity'
import { formatDateCompact, formatTime, toUtcIsoFromDatetimeLocal } from '../../../utils/dateHelpers'
import { useNow } from '../../../hooks/useNow'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import DatePicker from '@/components/ui/DatePicker'
import { TeamPickerMulti } from '@/components/ui/TeamPicker'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import TeamSelect from '../../../components/TeamSelect'
import AssignmentEditor from './AssignmentEditor'
import { DutyStatus } from './ScorerRow'
import { isFullyAssigned, isVbCombinedMode, isVbRefereeMode } from './assignmentStatus'
import { classifyVbMode } from './AssignmentAlgorithm'
import { weekdayShort } from '../lib/dutySpots'
import { bbAllDutyTeamIds, bbDutyTeamsPayload, bbGameDutyTeamIds, bbSeatDutyTeamIds, type BbSeatRole } from '../lib/bbDutyTeams'
import { BB_OTR1_OR_HIGHER, BB_OTR2_OR_HIGHER, resolveBbRequirement } from '../lib/bbLeagueRequirements'

interface LiveAssignmentTableProps {
  /** Upcoming home games of the active sport (saved state). */
  games: Game[]
  /** All active teams — for the playing team's VB mode. */
  teams: Team[]
  /** The pickable duty teams of this sport (VB: MiniVB/DU20 excluded). */
  sportTeams: Team[]
  members: Member[]
  teamMemberIds: Map<string, Set<string>>
  guestMemberIds: Set<string>
  hallNameById: Map<string, string>
  sport: 'volleyball' | 'basketball'
}

type VbMode = 'separate' | 'combined' | 'referee'

const BB_SEAT_COL: Record<BbSeatRole, 'bb_scorer_member' | 'bb_timekeeper_member' | 'bb_24s_official'> = {
  bb_scorer: 'bb_scorer_member',
  bb_timekeeper: 'bb_timekeeper_member',
  bb_24s_official: 'bb_24s_official',
}

export default function LiveAssignmentTable({
  games, teams, sportTeams, members, teamMemberIds, guestMemberIds, hallNameById, sport,
}: LiveAssignmentTableProps) {
  const { t } = useTranslation('scorerAssign')
  const { t: ts } = useTranslation('scorer')
  const now = useNow()

  // Picks show at once, before the refetch lands. Reset whenever fresh games
  // arrive (adjust-state-on-prop-change, no effect): those already carry them.
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({})
  const [seenGames, setSeenGames] = useState(games)
  if (seenGames !== games) {
    setSeenGames(games)
    setOverrides({})
  }
  const shown = useMemo(
    () => games.map((g) => (overrides[g.id] ? ({ ...g, ...overrides[g.id] } as Game) : g)),
    [games, overrides],
  )

  // BB rows whose optional 24s seat was opened by hand.
  const [open24s, setOpen24s] = useState<Set<string>>(new Set())

  // Filters
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [dutyTeam, setDutyTeam] = useState('')
  const [playingTeam, setPlayingTeam] = useState('')
  const [date, setDate] = useState('')
  const hasFilters = !!(onlyOpen || dutyTeam || playingTeam || date)
  function clearFilters() {
    setOnlyOpen(false); setDutyTeam(''); setPlayingTeam(''); setDate('')
  }

  const teamById = useMemo(() => new Map(teams.map((tm) => [String(tm.id), tm])), [teams])
  // Every team of the sport that plays a listed game — from ALL teams, not the
  // duty pool (DU20 hosts games but never takes a duty).
  const playingTeamOptions = useMemo(() => {
    const ids = new Set(games.map((g) => relId(g.kscw_team)))
    return teams.filter((tm) => tm.sport === sport && ids.has(String(tm.id)))
  }, [games, teams, sport])
  const bbTeamOptions = useMemo(
    () => sportTeams.map((tm) => ({ id: String(tm.id), label: tm.name, sport: 'basketball' as const, active: tm.active })),
    [sportTeams],
  )

  // The saved duties decide a VB game's layout; a game with none yet follows its
  // playing team, as the planner does (HU20 referee, 4L and below combined).
  const vbModeOf = (g: Game): VbMode => {
    if (isVbCombinedMode(g)) return 'combined'
    if (isVbRefereeMode(g)) return 'referee'
    if (g.scorer_duty_team || g.scorer_member || g.scoreboard_duty_team || g.scoreboard_member) return 'separate'
    const tm = teamById.get(relId(g.kscw_team))
    return classifyVbMode(tm?.name ?? '', tm?.league ?? '')
  }

  const hasStarted = (g: Game): boolean => {
    if (!g.date || !g.time) return false
    try {
      const ms = new Date(toUtcIsoFromDatetimeLocal(`${String(g.date).slice(0, 10)}T${String(g.time).slice(0, 5)}`)).getTime()
      return !Number.isNaN(ms) && ms < now
    } catch { return false }
  }

  const openCount = useMemo(() => shown.filter((g) => !isFullyAssigned(g, sport)).length, [shown, sport])
  const visible = useMemo(() => shown.filter((g) => {
    if (onlyOpen && isFullyAssigned(g, sport)) return false
    if (playingTeam && relId(g.kscw_team) !== playingTeam) return false
    if (dutyTeam) {
      const ids = sport === 'volleyball'
        ? [g.scorer_duty_team, g.scoreboard_duty_team, g.scorer_scoreboard_duty_team, g.referee_duty_team].map((x) => relId(x))
        : bbAllDutyTeamIds(g)
      if (!ids.includes(dutyTeam)) return false
    }
    if (date && String(g.date).slice(0, 10) !== date) return false
    return true
  }), [shown, sport, onlyOpen, playingTeam, dutyTeam, date])

  // Writes. A team pick that also resets the person (AssignmentEditor) or a
  // person pick that derives the team fires two callbacks back to back — merge
  // them into ONE PATCH so the game never sits half-written.
  const pending = useRef(new Map<string, Record<string, unknown>>())
  function save(game: Game, fields: Record<string, unknown>) {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(fields)) clean[k] = v === '' ? null : v
    setOverrides((prev) => ({ ...prev, [game.id]: { ...(prev[game.id] ?? {}), ...clean } }))
    const queued = pending.current.get(game.id)
    pending.current.set(game.id, { ...(queued ?? {}), ...clean })
    if (!queued) setTimeout(() => { void flush(game) }, 0)
  }
  async function flush(game: Game) {
    const fields = pending.current.get(game.id)
    pending.current.delete(game.id)
    if (!fields) return
    try {
      await updateRecord('games', game.id, fields)
      const changes: Record<string, { old: string; new: string }> = {}
      for (const [k, v] of Object.entries(fields)) {
        const old = (game as unknown as Record<string, unknown>)[k]
        if (String(old ?? '') !== String(v ?? '')) changes[k] = { old: String(old ?? ''), new: String(v ?? '') }
      }
      if (Object.keys(changes).length) logActivity('update', 'games', game.id, changes)
      toast.success(t('common:saved'))
    } catch (err) {
      console.error('Failed to update game:', err)
      toast.error(ts('errorUpdate'))
      setOverrides((prev) => { const next = { ...prev }; delete next[game.id]; return next })
    } finally {
      invalidateForCollection('games')
    }
  }

  const vbEditor = (g: Game, locked: boolean, label: string, licence: 'scorer_vb' | undefined, teamField: keyof Game, personField: keyof Game) => (
    <AssignmentEditor
      label={label}
      requiredLicence={licence}
      teamValue={relId(g[teamField])}
      personValue={relId(g[personField])}
      members={members}
      teams={sportTeams}
      teamMemberIds={teamMemberIds}
      sport="volleyball"
      onTeamChange={(v) => save(g, { [teamField]: v })}
      onPersonChange={(v) => save(g, { [personField]: v })}
      disabled={locked}
      canEdit
      guestMemberIds={guestMemberIds}
    />
  )

  // BB staffs the table per GAME: the seats share the game's duty teams, and a
  // person picked before any team makes their team the game's.
  const bbSeat = (g: Game, locked: boolean, role: BbSeatRole, label: string) => (
    <AssignmentEditor
      label={label}
      requiredLicence={role === 'bb_24s_official' ? BB_OTR2_OR_HIGHER : BB_OTR1_OR_HIGHER}
      teamValue=""
      teamPool={bbSeatDutyTeamIds(g, role)}
      hideTeam
      personValue={relId(g[BB_SEAT_COL[role]])}
      members={members}
      teams={sportTeams}
      teamMemberIds={teamMemberIds}
      sport="basketball"
      onTeamChange={(v) => { if (v) save(g, bbDutyTeamsPayload([v])) }}
      onPersonChange={(v) => save(g, { [BB_SEAT_COL[role]]: v })}
      disabled={locked}
      canEdit
      guestMemberIds={guestMemberIds}
    />
  )

  const gameCell = (g: Game) => (
    <>
      <div className="font-medium text-foreground">{g.home_team}</div>
      <div className="text-xs text-muted-foreground">{g.away_team}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {g.league && <span className="rounded bg-muted px-1.5 py-0.5">{g.league}</span>}
        {hallNameById.get(String(g.hall)) && <span className="break-words">{hallNameById.get(String(g.hall))}</span>}
      </div>
      <div className="mt-1.5"><DutyStatus game={g} sport={sport} /></div>
    </>
  )

  const filterLabelClass = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'

  return (
    <div className="mt-4">
      <div className="rounded-2xl border border-hairline bg-card p-4 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="live-assign-date" className={filterLabelClass}>{ts('filterDate')}</label>
            <DatePicker id="live-assign-date" value={date} onChange={setDate} />
          </div>
          <div>
            <span className={filterLabelClass}>{ts('filterPlayingTeam')}</span>
            <TeamSelect value={playingTeam} onChange={setPlayingTeam} teams={playingTeamOptions} placeholder={ts('filterAllTeams')} aria-label={ts('filterPlayingTeam')} />
          </div>
          <div>
            <span className={filterLabelClass}>{ts('filterDutyTeam')}</span>
            <TeamSelect value={dutyTeam} onChange={setDutyTeam} teams={sportTeams} placeholder={ts('filterAllTeams')} aria-label={ts('filterDutyTeam')} />
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 self-end text-sm text-foreground/85 sm:min-h-9">
            <Checkbox checked={onlyOpen} onCheckedChange={(v) => setOnlyOpen(v === true)} />
            {t('liveOnlyOpen')}
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className={openCount ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}>
            {t('liveCounts', { open: openCount, total: shown.length })}
          </span>
          <span className="text-muted-foreground">· {t('liveSavesImmediately')}</span>
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={clearFilters} className="ml-auto rounded-full">{ts('clearFilters')}</Button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-8 py-12 text-center text-muted-foreground">
          <p>{shown.length === 0 ? t('noGames') : t('liveNoMatch')}</p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-hairline bg-card shadow-card">
          <Table className="w-full text-left text-sm">
            <TableHeader>
              <TableRow className="border-b border-border text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <TableHead className="px-2 py-2">{t('date')}</TableHead>
                {/* Phones fold the game into the date cell — the duty pickers
                    are what must stay in view. */}
                <TableHead className="hidden px-2 py-2 sm:table-cell">{t('overviewGame')}</TableHead>
                {sport === 'volleyball' ? (
                  <>
                    <TableHead className="px-2 py-2">{t('autoScorer')}</TableHead>
                    <TableHead className="px-2 py-2">{t('autoTaefeler')}</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead className="px-2 py-2">{ts('bbDutyTeams')}</TableHead>
                    <TableHead className="px-2 py-2">{t('liveOfficials')}</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((g) => {
                const locked = hasStarted(g)
                const mode = sport === 'volleyball' ? vbModeOf(g) : null
                const requires24s = sport === 'basketball' && resolveBbRequirement(g.league).seats.length >= 3
                const show24s = requires24s || !!g.bb_24s_official || open24s.has(g.id)
                return (
                  <TableRow key={g.id} className={`border-b border-border/60 align-top ${locked ? 'opacity-60' : ''}`}>
                    <TableCell className="whitespace-normal px-2 py-2 align-top text-foreground/85">
                      <div className="whitespace-nowrap tabular-nums"><span className="text-muted-foreground/80">{weekdayShort(g.date)}</span> {formatDateCompact(g.date)}</div>
                      <div className="text-xs text-muted-foreground">{g.time ? formatTime(g.time) : ''}</div>
                      {locked && <div className="mt-1 text-xs text-muted-foreground">{t('liveStarted')}</div>}
                      <div className="mt-2 min-w-[9rem] break-words sm:hidden">{gameCell(g)}</div>
                    </TableCell>
                    <TableCell className="hidden min-w-[11rem] whitespace-normal break-words px-2 py-2 align-top sm:table-cell">
                      {gameCell(g)}
                    </TableCell>
                    {sport === 'volleyball' ? (
                      mode === 'separate' ? (
                        <>
                          <TableCell className="min-w-[13rem] px-2 py-2 align-top">
                            {vbEditor(g, locked, '', 'scorer_vb', 'scorer_duty_team', 'scorer_member')}
                          </TableCell>
                          <TableCell className="min-w-[13rem] px-2 py-2 align-top">
                            {vbEditor(g, locked, '', undefined, 'scoreboard_duty_team', 'scoreboard_member')}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={2} className="min-w-[13rem] px-2 py-2 align-top">
                          <div className="max-w-sm">
                            {mode === 'combined'
                              ? vbEditor(g, locked, ts('scorerTaefeler'), undefined, 'scorer_scoreboard_duty_team', 'scorer_scoreboard_member')
                              : vbEditor(g, locked, ts('referee'), undefined, 'referee_duty_team', 'referee_member')}
                          </div>
                        </TableCell>
                      )
                    ) : (
                      <>
                        <TableCell className="min-w-[13rem] px-2 py-2 align-top">
                          <TeamPickerMulti
                            value={bbGameDutyTeamIds(g)}
                            onChange={(ids) => save(g, bbDutyTeamsPayload(ids))}
                            teams={bbTeamOptions}
                            disabled={locked}
                            placeholder={ts('selectTeam')}
                          />
                        </TableCell>
                        <TableCell className="min-w-[14rem] px-2 py-2 align-top">
                          <div className="space-y-2">
                            {bbSeat(g, locked, 'bb_scorer', ts('bbScorer'))}
                            {bbSeat(g, locked, 'bb_timekeeper', ts('bbTimekeeper'))}
                            {show24s ? bbSeat(g, locked, 'bb_24s_official', ts('bb24sOfficial')) : !locked && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setOpen24s((prev) => new Set(prev).add(g.id))}
                                icon={<Plus aria-hidden />}
                                className="text-muted-foreground"
                              >
                                {ts('bb24sOfficial')}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
