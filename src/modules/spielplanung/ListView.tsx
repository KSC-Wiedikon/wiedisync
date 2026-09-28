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
    scheduled: 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
    live: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    completed: 'bg-muted text-muted-foreground',
    postponed: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  }
  const labelKey = `status.${status}`
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? 'bg-muted text-muted-foreground'}`}>
      {t(labelKey, status)}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        type === 'home'
          ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
          : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
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
    <TableRow className="align-top">
      {showDate && (
        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          {formatDate(parseDate(dateStr), 'dd.MM.yyyy')}
        </TableCell>
      )}
      <TableCell className="whitespace-nowrap text-sm font-medium tabular-nums text-foreground/85 w-14">
        {game.time ? formatTime(game.time) : '–'}
      </TableCell>
      {showTeam && (
        <TableCell className="hidden sm:table-cell">
          <TeamChip team={teamName} size="sm" />
        </TableCell>
      )}
      <TableCell className="whitespace-normal text-sm text-foreground">
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
      <TableCell className="hidden md:table-cell whitespace-nowrap text-xs text-muted-foreground truncate max-w-[10rem]" title={hallName}>
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
    return <div className="py-8 text-center text-muted-foreground">{t('emptyState')}</div>
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.date} className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
          <div className="border-b border-border/60 bg-surface-sunken px-4 py-2">
            <h3 className="text-sm font-semibold text-foreground/85">{group.label}</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">{t('colTime')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('colTeam')}</TableHead>
                <TableHead>{t('colMatchup')}</TableHead>
                <TableHead>{t('colType')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('colHall')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
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
    return <div className="py-8 text-center text-muted-foreground">{t('emptyState')}</div>
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.team.id} className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
          <div className="flex items-center gap-3 border-b border-border/60 bg-surface-sunken px-4 py-2">
            <TeamChip team={group.team.name} />
            <span className="text-sm text-muted-foreground">{group.team.league}</span>
            <span className="text-xs text-muted-foreground/80">({t('gamesCount', { count: group.games.length })})</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colDate')}</TableHead>
                <TableHead className="w-14">{t('colTime')}</TableHead>
                <TableHead>{t('colMatchup')}</TableHead>
                <TableHead>{t('colType')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('colHall')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
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
