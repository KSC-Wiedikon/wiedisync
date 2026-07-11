import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Game, Member, Team } from '../../../types'
import type { ExpandedGame } from './ScorerRow'
import { asObj } from '../../../utils/relations'
import { DutyStatus } from './ScorerRow'
import TeamChip from '../../../components/TeamChip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatTime, formatDateZurich } from '../../../utils/dateHelpers'

interface TeamOverviewProps {
  games: Game[]
  members: Member[]
  teams: Team[]
  sport: 'volleyball' | 'basketball'
  // 'team' (default): one card per duty team with its list of duties.
  // 'game': one card per game with its list of duties.
  groupBy?: 'team' | 'game'
  // When set (non-admins), restrict the overview to these team ids: duties owned
  // by the member's team(s), and games where the member's team plays. null/undefined
  // (admins) shows everything.
  scopeTeamIds?: string[] | null
}

type DutyType = 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'referee' | 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'

interface DutyEntry {
  game: ExpandedGame
  dutyType: DutyType
  teamId: string
  teamName: string
  memberName: string | null
}

export default function TeamOverview({ games, members, teams, sport, groupBy = 'team', scopeTeamIds }: TeamOverviewProps) {
  const { t, i18n } = useTranslation('scorer')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (name: string) =>
    setExpanded((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n })

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>()
    for (const m of members) map.set(m.id, m)
    return map
  }, [members])

  const scopeSet = useMemo(() => (scopeTeamIds ? new Set(scopeTeamIds.map(String)) : null), [scopeTeamIds])

  // Flat list of every duty across all games — the source for both groupings.
  const entries = useMemo(() => {
    const getMemberName = (id: string | undefined): string | null => {
      if (!id) return null
      const m = memberMap.get(id)
      return m ? `${m.first_name} ${m.last_name}` : null
    }
    // The games carry the duty-team fields as BARE IDs (not expanded), so resolve
    // names from the teams list by id; fall back to an expanded object then '?'.
    const nameById = new Map<string, string>()
    for (const tm of teams) nameById.set(String(tm.id), tm.name)
    const idOf = (val: string | number | Team | null | undefined): string =>
      !val ? '' : typeof val === 'object' ? String(val.id) : String(val)
    const nameOf = (val: string | number | Team | null | undefined): string => {
      if (!val) return '?'
      const obj = asObj<Team>(val)
      return obj?.name ?? nameById.get(idOf(val)) ?? '?'
    }
    const push = (out: DutyEntry[], game: ExpandedGame, dutyType: DutyType, teamVal: string | number | Team | null | undefined, member: string | undefined) => {
      out.push({ game, dutyType, teamId: idOf(teamVal), teamName: nameOf(teamVal), memberName: getMemberName(member) })
    }
    const out: DutyEntry[] = []
    for (const game of games) {
      const eg = game as ExpandedGame
      if (sport === 'volleyball') {
        if (game.scorer_scoreboard_duty_team) push(out, eg, 'scorer_scoreboard', game.scorer_scoreboard_duty_team, game.scorer_scoreboard_member)
        if (game.scorer_duty_team) push(out, eg, 'scorer', game.scorer_duty_team, game.scorer_member)
        if (game.scoreboard_duty_team) push(out, eg, 'scoreboard', game.scoreboard_duty_team, game.scoreboard_member)
        if (game.referee_duty_team) push(out, eg, 'referee', game.referee_duty_team, game.referee_member)
      } else {
        const scorerTeam = game.bb_scorer_duty_team || game.bb_duty_team
        const timekeeperTeam = game.bb_timekeeper_duty_team || game.bb_duty_team
        const _24sTeam = game.bb_24s_duty_team || game.bb_duty_team
        if (scorerTeam) push(out, eg, 'bb_scorer', scorerTeam, game.bb_scorer_member)
        if (timekeeperTeam) push(out, eg, 'bb_timekeeper', timekeeperTeam, game.bb_timekeeper_member)
        if (_24sTeam && game.bb_24s_official) push(out, eg, 'bb_24s_official', _24sTeam, game.bb_24s_official)
      }
    }
    return out
  }, [games, memberMap, teams, sport])

  const playingIdOf = (game: ExpandedGame): string => {
    const obj = asObj<Team>(game.kscw_team)
    return obj?.id != null ? String(obj.id) : String(game.kscw_team ?? '')
  }

  // Grouping A: one card/row per duty team. Scoped (non-admin) to the member's
  // own team(s) — their duties.
  const teamGroups = useMemo(() => {
    const map = new Map<string, DutyEntry[]>()
    for (const e of entries) {
      if (scopeSet && !scopeSet.has(e.teamId)) continue
      if (!map.has(e.teamName)) map.set(e.teamName, [])
      map.get(e.teamName)!.push(e)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.time.localeCompare(b.game.time))
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, i18n.language))
  }, [entries, scopeSet, i18n])

  // Grouping B: one card per game, chronological. Scoped (non-admin) to games the
  // member's team plays OR has a duty at — so they can check their own games.
  const gameGroups = useMemo(() => {
    const map = new Map<string, { game: ExpandedGame; list: DutyEntry[] }>()
    for (const e of entries) {
      const key = String(e.game.id)
      if (!map.has(key)) map.set(key, { game: e.game, list: [] })
      map.get(key)!.list.push(e)
    }
    let groups = Array.from(map.values())
    if (scopeSet) {
      groups = groups.filter(({ game, list }) => scopeSet.has(playingIdOf(game)) || list.some((e) => scopeSet.has(e.teamId)))
    }
    return groups.sort((a, b) => a.game.date.localeCompare(b.game.date) || (a.game.time || '').localeCompare(b.game.time || ''))
  }, [entries, scopeSet])

  const dutyLabel: Record<DutyType, string> = {
    scorer: t('scorer'),
    scoreboard: t('scoreboard'),
    scorer_scoreboard: t('scorerTaefeler'),
    referee: t('referee'),
    bb_scorer: t('bbScorer'),
    bb_timekeeper: t('bbTimekeeper'),
    bb_24s_official: t('bb24sOfficial'),
  }

  const isEmpty = groupBy === 'game' ? gameGroups.length === 0 : teamGroups.length === 0
  if (isEmpty) {
    return (
      <div className="py-12 text-center text-gray-500 dark:text-gray-400">
        <p>{t('overviewEmpty')}</p>
      </div>
    )
  }

  if (groupBy === 'game') {
    return (
      <div className="mt-6 grid gap-4 sm:gap-6 md:grid-cols-2">
        {gameGroups.map(({ game, list }) => (
          <div key={game.id} className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDateZurich(game.date)} · {game.time ? formatTime(game.time) : ''}
                </div>
                <div className="truncate text-sm font-semibold dark:text-gray-200">
                  {game.home_team} – {game.away_team}
                </div>
              </div>
              <DutyStatus game={game} sport={sport} />
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {list.map((entry, i) => (
                <div key={`${entry.dutyType}-${i}`} className="flex items-center gap-2 px-4 py-2.5">
                  {/* Fixed narrow, truncating so a long "Scorer/Scoreboard" can't
                      overflow into the team chip. */}
                  <span className="w-20 shrink-0 truncate text-xs text-gray-500 dark:text-gray-400" title={dutyLabel[entry.dutyType]}>
                    {dutyLabel[entry.dutyType]}
                  </span>
                  <div className="shrink-0"><TeamChip team={entry.teamName} size="sm" /></div>
                  <span className={`ml-auto truncate pl-2 text-right text-sm ${entry.memberName ? 'font-medium dark:text-gray-200' : 'text-red-500'}`}>
                    {entry.memberName ?? t('unassigned')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // "By duty team" summary: one row per team (team · duties · open). Click a row
  // to expand its games. Open (unfilled) duties dominate the sort.
  const summaryRows = teamGroups
    .map(([teamName, list]) => ({ teamName, list, total: list.length, open: list.filter((e) => !e.memberName).length }))
    .sort((a, b) => b.open - a.open || b.total - a.total || a.teamName.localeCompare(b.teamName, i18n.language))

  return (
    <div className="mt-6 overflow-x-auto">
      <Table className="w-full text-left text-sm">
        <TableHeader>
          <TableRow className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <TableHead className="px-3 py-2">{t('overviewColTeam')}</TableHead>
            <TableHead className="px-3 py-2 text-center">{t('overviewColDuties')}</TableHead>
            <TableHead className="px-3 py-2 text-center">{t('overviewColOpen')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summaryRows.map((r) => {
            const isOpen = expanded.has(r.teamName)
            return (
              <Fragment key={r.teamName}>
                <TableRow
                  className="cursor-pointer border-b border-gray-100 hover:bg-gray-50 dark:border-gray-700/50 dark:hover:bg-gray-800/50"
                  onClick={() => toggle(r.teamName)}
                >
                  <TableCell className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
                      <TeamChip team={r.teamName} size="sm" />
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2 text-center font-medium text-gray-900 dark:text-gray-100">{r.total}</TableCell>
                  <TableCell className={`px-3 py-2 text-center ${r.open ? 'font-semibold text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
                    {r.open || '—'}
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="border-b border-gray-100 dark:border-gray-700/50">
                    <TableCell colSpan={3} className="bg-gray-50/60 px-3 py-2 dark:bg-gray-800/40">
                      <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
                        {r.list.map((entry, i) => (
                          <div key={`${entry.game.id}-${entry.dutyType}-${i}`} className="py-1.5">
                            {/* Two lines so it never overflows a narrow phone: the
                                game on top, duty + assignee below. */}
                            <div className="flex items-start gap-2 text-xs">
                              <span className="shrink-0 text-gray-500 dark:text-gray-400">{formatDateZurich(entry.game.date)}</span>
                              <span className="min-w-0 flex-1 break-words text-gray-700 dark:text-gray-300">
                                {entry.game.home_team} – {entry.game.away_team}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs">
                              <span className="shrink-0 text-gray-400 dark:text-gray-500">{dutyLabel[entry.dutyType]}:</span>
                              <span className={`min-w-0 truncate ${entry.memberName ? 'font-medium text-gray-800 dark:text-gray-200' : 'text-red-500'}`}>
                                {entry.memberName ?? t('unassigned')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
