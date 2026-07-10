import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Game, Member, Team } from '../../../types'
import type { ExpandedGame } from './ScorerRow'
import { asObj } from '../../../utils/relations'
import { DutyStatus } from './ScorerRow'
import TeamChip from '../../../components/TeamChip'
import { formatTime, formatDateZurich } from '../../../utils/dateHelpers'

interface TeamOverviewProps {
  games: Game[]
  members: Member[]
  sport: 'volleyball' | 'basketball'
  // 'team' (default): one card per duty team with its list of duties.
  // 'game': one card per game with its list of duties.
  groupBy?: 'team' | 'game'
}

type DutyType = 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'

interface DutyEntry {
  game: ExpandedGame
  dutyType: DutyType
  teamName: string
  memberName: string | null
}

export default function TeamOverview({ games, members, sport, groupBy = 'team' }: TeamOverviewProps) {
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
    const out: DutyEntry[] = []
    for (const game of games) {
      const eg = game as ExpandedGame
      if (sport === 'volleyball') {
        if (game.scorer_scoreboard_duty_team) {
          const teamName = asObj<Team>(game.scorer_scoreboard_duty_team)?.name ?? '?'
          out.push({ game: eg, dutyType: 'scorer_scoreboard', teamName, memberName: getMemberName(game.scorer_scoreboard_member) })
        }
        if (game.scorer_duty_team) {
          const teamName = asObj<Team>(game.scorer_duty_team)?.name ?? '?'
          out.push({ game: eg, dutyType: 'scorer', teamName, memberName: getMemberName(game.scorer_member) })
        }
        if (game.scoreboard_duty_team) {
          const teamName = asObj<Team>(game.scoreboard_duty_team)?.name ?? '?'
          out.push({ game: eg, dutyType: 'scoreboard', teamName, memberName: getMemberName(game.scoreboard_member) })
        }
      } else {
        const scorerTeam = game.bb_scorer_duty_team || game.bb_duty_team
        const timekeeperTeam = game.bb_timekeeper_duty_team || game.bb_duty_team
        const _24sTeam = game.bb_24s_duty_team || game.bb_duty_team
        if (scorerTeam) {
          const teamName = asObj<Team>(game.bb_scorer_duty_team)?.name ?? asObj<Team>(game.bb_duty_team)?.name ?? '?'
          out.push({ game: eg, dutyType: 'bb_scorer', teamName, memberName: getMemberName(game.bb_scorer_member) })
        }
        if (timekeeperTeam) {
          const teamName = asObj<Team>(game.bb_timekeeper_duty_team)?.name ?? asObj<Team>(game.bb_duty_team)?.name ?? '?'
          out.push({ game: eg, dutyType: 'bb_timekeeper', teamName, memberName: getMemberName(game.bb_timekeeper_member) })
        }
        if (_24sTeam && game.bb_24s_official) {
          const teamName = asObj<Team>(game.bb_24s_duty_team)?.name ?? asObj<Team>(game.bb_duty_team)?.name ?? '?'
          out.push({ game: eg, dutyType: 'bb_24s_official', teamName, memberName: getMemberName(game.bb_24s_official) })
        }
      }
    }
    return out
  }, [games, memberMap, sport])

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

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      {teamGroups.map(([teamName, list]) => (
        <div key={teamName} className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <TeamChip team={teamName} />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('dutyCount', { count: list.length })}
            </span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {list.map((entry, i) => (
              <div key={`${entry.game.id}-${entry.dutyType}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDateZurich(entry.game.date)} · {entry.game.time ? formatTime(entry.game.time) : ''}
                  </div>
                  <div className="truncate text-sm font-medium dark:text-gray-200">
                    {entry.game.home_team} – {entry.game.away_team}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block text-xs text-gray-500 dark:text-gray-400">{dutyLabel[entry.dutyType]}</span>
                  <span className={`text-sm ${entry.memberName ? 'font-medium dark:text-gray-200' : 'text-red-500'}`}>
                    {entry.memberName ?? t('unassigned')}
                  </span>
                </div>
                <DutyStatus game={entry.game} sport={sport} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
