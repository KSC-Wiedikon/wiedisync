import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
}

type DutyType = 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'referee' | 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'

interface DutyEntry {
  game: ExpandedGame
  dutyType: DutyType
  teamName: string
  memberName: string | null
}

export default function TeamOverview({ games, members, teams, sport, groupBy = 'team' }: TeamOverviewProps) {
  const { t, i18n } = useTranslation('scorer')

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>()
    for (const m of members) map.set(m.id, m)
    return map
  }, [members])

  // Flat list of every duty across all games — the source for both groupings.
  // The name lookup is defined INSIDE the memo (not a render-scoped closure) so
  // the React Compiler can infer its deps as exactly [games, memberMap, sport].
  const entries = useMemo(() => {
    const getMemberName = (id: string | undefined): string | null => {
      if (!id) return null
      const m = memberMap.get(id)
      return m ? `${m.first_name} ${m.last_name}` : null
    }
    // The games here carry the duty-team fields as BARE IDs (not expanded), so
    // resolve names from the teams list by id; fall back to an expanded object
    // (asObj) if a caller ever passes expanded games, then to '?'.
    const nameById = new Map<string, string>()
    for (const tm of teams) nameById.set(String(tm.id), tm.name)
    const teamNameOf = (val: string | number | Team | null | undefined): string => {
      if (!val) return '?'
      const obj = asObj<Team>(val)
      if (obj?.name) return obj.name
      const id = typeof val === 'object' ? String(val.id) : String(val)
      return nameById.get(id) ?? '?'
    }
    const out: DutyEntry[] = []
    for (const game of games) {
      const eg = game as ExpandedGame
      if (sport === 'volleyball') {
        if (game.scorer_scoreboard_duty_team) {
          out.push({ game: eg, dutyType: 'scorer_scoreboard', teamName: teamNameOf(game.scorer_scoreboard_duty_team), memberName: getMemberName(game.scorer_scoreboard_member) })
        }
        if (game.scorer_duty_team) {
          out.push({ game: eg, dutyType: 'scorer', teamName: teamNameOf(game.scorer_duty_team), memberName: getMemberName(game.scorer_member) })
        }
        if (game.scoreboard_duty_team) {
          out.push({ game: eg, dutyType: 'scoreboard', teamName: teamNameOf(game.scoreboard_duty_team), memberName: getMemberName(game.scoreboard_member) })
        }
        if (game.referee_duty_team) {
          out.push({ game: eg, dutyType: 'referee', teamName: teamNameOf(game.referee_duty_team), memberName: getMemberName(game.referee_member) })
        }
      } else {
        const scorerTeam = game.bb_scorer_duty_team || game.bb_duty_team
        const timekeeperTeam = game.bb_timekeeper_duty_team || game.bb_duty_team
        const _24sTeam = game.bb_24s_duty_team || game.bb_duty_team
        if (scorerTeam) {
          out.push({ game: eg, dutyType: 'bb_scorer', teamName: teamNameOf(scorerTeam), memberName: getMemberName(game.bb_scorer_member) })
        }
        if (timekeeperTeam) {
          out.push({ game: eg, dutyType: 'bb_timekeeper', teamName: teamNameOf(timekeeperTeam), memberName: getMemberName(game.bb_timekeeper_member) })
        }
        if (_24sTeam && game.bb_24s_official) {
          out.push({ game: eg, dutyType: 'bb_24s_official', teamName: teamNameOf(_24sTeam), memberName: getMemberName(game.bb_24s_official) })
        }
      }
    }
    return out
  }, [games, memberMap, teams, sport])

  // Grouping A: one card per duty team (default).
  const teamGroups = useMemo(() => {
    const map = new Map<string, DutyEntry[]>()
    for (const e of entries) {
      if (!map.has(e.teamName)) map.set(e.teamName, [])
      map.get(e.teamName)!.push(e)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.time.localeCompare(b.game.time))
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, i18n.language))
  }, [entries, i18n])

  // Grouping B: one card per game, in chronological order.
  const gameGroups = useMemo(() => {
    const map = new Map<string, { game: ExpandedGame; list: DutyEntry[] }>()
    for (const e of entries) {
      const key = String(e.game.id)
      if (!map.has(key)) map.set(key, { game: e.game, list: [] })
      map.get(key)!.list.push(e)
    }
    return Array.from(map.values()).sort(
      (a, b) => a.game.date.localeCompare(b.game.date) || (a.game.time || '').localeCompare(b.game.time || ''),
    )
  }, [entries])

  if (entries.length === 0) {
    return (
      <div className="py-12 text-center text-gray-500 dark:text-gray-400">
        <p>{t('overviewEmpty')}</p>
      </div>
    )
  }

  const dutyLabel: Record<DutyType, string> = {
    scorer: t('scorer'),
    scoreboard: t('scoreboard'),
    scorer_scoreboard: t('scorerTaefeler'),
    referee: t('referee'),
    bb_scorer: t('bbScorer'),
    bb_timekeeper: t('bbTimekeeper'),
    bb_24s_official: t('bb24sOfficial'),
  }

  if (groupBy === 'game') {
    return (
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {gameGroups.map(({ game, list }) => (
          <div key={game.id} className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
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
                <div key={`${entry.dutyType}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0 text-xs text-gray-500 dark:text-gray-400">{dutyLabel[entry.dutyType]}</span>
                  <div className="min-w-0 flex-1"><TeamChip team={entry.teamName} size="sm" /></div>
                  <span className={`shrink-0 text-right text-sm ${entry.memberName ? 'font-medium dark:text-gray-200' : 'text-red-500'}`}>
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

  // "By duty team" is a summary: one row per team with its total duties and how
  // many still need a person (open). The per-game detail lives in the "By game"
  // view. Open (unfilled) duties dominate the sort so gaps float to the top.
  const summaryRows = teamGroups
    .map(([teamName, list]) => ({ teamName, total: list.length, open: list.filter((e) => !e.memberName).length }))
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
          {summaryRows.map((r) => (
            <TableRow key={r.teamName} className="border-b border-gray-100 dark:border-gray-700/50">
              <TableCell className="px-3 py-2"><TeamChip team={r.teamName} size="sm" /></TableCell>
              <TableCell className="px-3 py-2 text-center font-medium text-gray-900 dark:text-gray-100">{r.total}</TableCell>
              <TableCell className={`px-3 py-2 text-center ${r.open ? 'font-semibold text-red-500' : 'text-gray-400 dark:text-gray-500'}`}>
                {r.open || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
