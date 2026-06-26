import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import TeamChip from '../../components/TeamChip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import type { Game, Team } from '../../types'
import { parseDate, formatDate } from '../../utils/dateUtils'
import { formatTime } from '../../utils/dateHelpers'
import { asObj } from '../../utils/relations'

interface ListViewProps {
  games: Game[]
  mode: 'date' | 'team'
  teams: Team[]
}

function getTeamName(game: Game, teams: Team[]): string {
  const expanded = asObj<Team>(game.kscw_team)
  if (expanded) return expanded.name
  const team = teams.find((t) => t.id === game.kscw_team)
  return team?.name ?? ''
}

function getHallName(game: Game): string {
  const expanded = asObj<{ name: string }>(game.hall)
  return expanded?.name ?? ''
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('spielplanung')
  const styles: Record<string, string> = {
    scheduled: 'bg-brand-50 text-brand-700',
    live: 'bg-green-50 text-green-700',
    completed: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
    postponed: 'bg-amber-50 text-amber-700',
  }
  const labelKey = `status.${status}`
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
      {t(labelKey, status)}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        type === 'home' ? 'bg-green-50 text-green-700' : 'bg-orange-50 text-orange-700'
      }`}
    >
      {type === 'home' ? 'H' : 'A'}
    </span>
  )
}

function GameTableRow({ game, teams, showTeam, showDate }: { game: Game; teams: Team[]; showTeam: boolean; showDate?: boolean }) {
  const teamName = getTeamName(game, teams)
  const hallName = getHallName(game)
  const dateStr = game.date.split(' ')[0] ?? game.date

  return (
    <TableRow data-tour="spielplanung-game-card" className="align-top">
      {showDate && (
        <TableCell className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
          {formatDate(parseDate(dateStr), 'dd.MM.yyyy')}
        </TableCell>
      )}
      <TableCell className="whitespace-nowrap text-sm font-medium text-gray-700 dark:text-gray-300 w-14">
        {game.time ? formatTime(game.time) : '–'}
      </TableCell>
      {showTeam && (
        <TableCell className="hidden sm:table-cell">
          <TeamChip team={teamName} size="sm" />
        </TableCell>
      )}
      <TableCell className="whitespace-normal text-sm text-gray-900 dark:text-gray-100">
        <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
          <span>{game.home_team}</span>
          <span className="hidden sm:inline">–</span>
          <span>{game.away_team}</span>
        </div>
        {showTeam && (
          <div className="sm:hidden mt-1 inline-block"><TeamChip team={teamName} size="xs" /></div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap"><TypeBadge type={game.type} /></TableCell>
      <TableCell className="hidden md:table-cell whitespace-nowrap text-xs text-gray-500 truncate max-w-[10rem]">
        {hallName}
      </TableCell>
      <TableCell className="whitespace-nowrap"><StatusBadge status={game.status} /></TableCell>
    </TableRow>
  )
}

function ByDateView({ games, teams }: { games: Game[]; teams: Team[] }) {
  const { t } = useTranslation('spielplanung')
  const grouped = useMemo(() => {
    const sorted = [...games].sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date)
      if (dateCmp !== 0) return dateCmp
      return (a.time ?? '').localeCompare(b.time ?? '')
    })

    const groups: { date: string; label: string; games: Game[] }[] = []
    let currentDate = ''
    for (const game of sorted) {
      const dateStr = game.date.split(' ')[0] ?? game.date
      if (dateStr !== currentDate) {
        currentDate = dateStr
        const d = parseDate(dateStr)
        groups.push({
          date: dateStr,
          label: formatDate(d, 'EEEE, d. MMMM yyyy'),
          games: [],
        })
      }
      groups[groups.length - 1].games.push(game)
    }
    return groups
  }, [games])

  if (games.length === 0) {
    return <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('emptyState')}</div>
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.date} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="border-b border-gray-100 bg-gray-50 dark:bg-gray-900 px-4 py-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{group.label}</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-xs uppercase text-gray-400">{t('colTime')}</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase text-gray-400">{t('colTeam')}</TableHead>
                <TableHead className="text-xs uppercase text-gray-400">{t('colMatchup')}</TableHead>
                <TableHead className="text-xs uppercase text-gray-400">{t('colType')}</TableHead>
                <TableHead className="hidden md:table-cell text-xs uppercase text-gray-400">{t('colHall')}</TableHead>
                <TableHead className="text-xs uppercase text-gray-400">{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.games.map((game) => (
                <GameTableRow key={game.id} game={game} teams={teams} showTeam />
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}

function ByTeamView({ games, teams }: { games: Game[]; teams: Team[] }) {
  const { t } = useTranslation('spielplanung')
  const grouped = useMemo(() => {
    const byTeam = new Map<string, { team: Team; games: Game[] }>()

    for (const game of games) {
      const teamId = game.kscw_team
      if (!byTeam.has(teamId)) {
        const team = teams.find((t) => t.id === teamId)
        const expanded = asObj<Team>(game.kscw_team)
        byTeam.set(teamId, { team: team ?? expanded ?? ({ name: '?' } as Team), games: [] })
      }
      byTeam.get(teamId)!.games.push(game)
    }

    for (const group of byTeam.values()) {
      group.games.sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date)
        if (dateCmp !== 0) return dateCmp
        return (a.time ?? '').localeCompare(b.time ?? '')
      })
    }

    return [...byTeam.values()].sort((a, b) => a.team.name.localeCompare(b.team.name))
  }, [games, teams])

  if (games.length === 0) {
    return <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('emptyState')}</div>
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.team.id} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50 dark:bg-gray-900 px-4 py-2">
            <TeamChip team={group.team.name} />
            <span className="text-sm text-gray-500 dark:text-gray-400">{group.team.league}</span>
            <span className="text-xs text-gray-400">({group.games.length} games)</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs uppercase text-gray-400">{t('colDate')}</TableHead>
                <TableHead className="w-14 text-xs uppercase text-gray-400">{t('colTime')}</TableHead>
                <TableHead className="text-xs uppercase text-gray-400">{t('colMatchup')}</TableHead>
                <TableHead className="text-xs uppercase text-gray-400">{t('colType')}</TableHead>
                <TableHead className="hidden md:table-cell text-xs uppercase text-gray-400">{t('colHall')}</TableHead>
                <TableHead className="text-xs uppercase text-gray-400">{t('colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.games.map((game) => (
                <GameTableRow key={game.id} game={game} teams={teams} showTeam={false} showDate />
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}

export default function ListView({ games, mode, teams }: ListViewProps) {
  if (mode === 'team') {
    return <ByTeamView games={games} teams={teams} />
  }
  return <ByDateView games={games} teams={teams} />
}
