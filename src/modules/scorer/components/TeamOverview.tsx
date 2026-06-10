import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Game, Member, Team } from '../../../types'
import type { ExpandedGame } from './ScorerRow'
import { asObj } from '../../../utils/relations'
import { DutyStatus } from './ScorerRow'
import TeamChip from '../../../components/TeamChip'
import { formatTime } from '../../../utils/dateHelpers'

interface TeamOverviewProps {
  games: Game[]
  members: Member[]
  sport: 'volleyball' | 'basketball'
}

type DutyType = 'scorer' | 'scoreboard' | 'scorer_scoreboard' | 'bb_scorer' | 'bb_timekeeper' | 'bb_24s_official'

interface DutyEntry {
  game: ExpandedGame
  dutyType: DutyType
  teamName: string
  memberName: string | null
}

function getDateFormatter(locale: string) {
  const loc = locale.startsWith('gsw') || locale === 'de' ? 'de-CH' : locale === 'en' ? 'en-GB' : locale
  return new Intl.DateTimeFormat(loc, { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function TeamOverview({ games, members, sport }: TeamOverviewProps) {
  const { t, i18n } = useTranslation('scorer')
  const dateFormatter = useMemo(() => getDateFormatter(i18n.language), [i18n.language])

  const memberMap = useMemo(() => {
    const map = new Map<string, Member>()
    for (const m of members) map.set(m.id, m)
    return map
  }, [members])

  const getMemberName = (id: string | undefined): string | null => {
    if (!id) return null
    const m = memberMap.get(id)
    return m ? `${m.first_name} ${m.last_name}` : null
  }

  // Group duties by team
  const teamDuties = useMemo(() => {
    const map = new Map<string, DutyEntry[]>()

    const addEntry = (teamName: string, entry: DutyEntry) => {
      if (!map.has(teamName)) map.set(teamName, [])
      map.get(teamName)!.push(entry)
    }

    for (const game of games) {
      const eg = game as ExpandedGame

      if (sport === 'volleyball') {
        if (game.scorer_scoreboard_duty_team) {
          const teamName = asObj<Team>(game.scorer_scoreboard_duty_team)?.name ?? '?'
          addEntry(teamName, { game: eg, dutyType: 'scorer_scoreboard', teamName, memberName: getMemberName(game.scorer_scoreboard_member) })
        }
        if (game.scorer_duty_team) {
          const teamName = asObj<Team>(game.scorer_duty_team)?.name ?? '?'
          addEntry(teamName, { game: eg, dutyType: 'scorer', teamName, memberName: getMemberName(game.scorer_member) })
        }
        if (game.scoreboard_duty_team) {
          const teamName = asObj<Team>(game.scoreboard_duty_team)?.name ?? '?'
          addEntry(teamName, { game: eg, dutyType: 'scoreboard', teamName, memberName: getMemberName(game.scoreboard_member) })
        }
      } else {
        const scorerTeam = game.bb_scorer_duty_team || game.bb_duty_team
        const timekeeperTeam = game.bb_timekeeper_duty_team || game.bb_duty_team
        const _24sTeam = game.bb_24s_duty_team || game.bb_duty_team
        if (scorerTeam) {
          const teamName = asObj<Team>(game.bb_scorer_duty_team)?.name ?? asObj<Team>(game.bb_duty_team)?.name ?? '?'
          addEntry(teamName, { game: eg, dutyType: 'bb_scorer', teamName, memberName: getMemberName(game.bb_scorer_member) })
        }
        if (timekeeperTeam) {
          const teamName = asObj<Team>(game.bb_timekeeper_duty_team)?.name ?? asObj<Team>(game.bb_duty_team)?.name ?? '?'
          addEntry(teamName, { game: eg, dutyType: 'bb_timekeeper', teamName, memberName: getMemberName(game.bb_timekeeper_member) })
        }
        if (_24sTeam && game.bb_24s_official) {
          const teamName = asObj<Team>(game.bb_24s_duty_team)?.name ?? asObj<Team>(game.bb_duty_team)?.name ?? '?'
          addEntry(teamName, { game: eg, dutyType: 'bb_24s_official', teamName, memberName: getMemberName(game.bb_24s_official) })
        }
      }
    }

    for (const entries of map.values()) {
      entries.sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.time.localeCompare(b.game.time))
    }

    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, i18n.language))
  }, [games, memberMap, sport])

  if (teamDuties.length === 0) {
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

  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      {teamDuties.map(([teamName, entries]) => (
        <div key={teamName} className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
            <TeamChip team={teamName} />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t('dutyCount', { count: entries.length })}
            </span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {entries.map((entry, i) => (
              <div key={`${entry.game.id}-${entry.dutyType}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {dateFormatter.format(new Date(entry.game.date + 'T00:00:00'))} · {entry.game.time ? formatTime(entry.game.time) : ''}
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
