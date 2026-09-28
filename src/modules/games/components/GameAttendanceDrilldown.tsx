import { useTranslation } from 'react-i18next'
import { formatDate } from '../../../utils/dateHelpers'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import type { Game } from '../../../types'
import type { GamePlayerStats } from './useGameAttendanceStats'

interface Props {
  memberId: string
  stats: GamePlayerStats[]
  gamesById: Map<string, Game>
}

export default function GameAttendanceDrilldown({ memberId, stats, gamesById }: Props) {
  const { t } = useTranslation('games')
  const player = stats.find((s) => s.memberId === memberId)
  if (!player) return null

  const rows = player.gameStatuses
    .map((gs) => ({ gs, game: gamesById.get(gs.gameId) }))
    .filter((r): r is { gs: typeof r.gs; game: Game } => !!r.game)
    .sort((a, b) => a.gs.dateKey.localeCompare(b.gs.dateKey))

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('drilldownEmpty')}</p>
  }

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow className="border-border">
          <TableHead className="text-muted-foreground">{t('date')}</TableHead>
          <TableHead className="text-muted-foreground">{t('drilldownColOpponent')}</TableHead>
          <TableHead className="hidden text-muted-foreground sm:table-cell">{t('hallLabel')}</TableHead>
          <TableHead className="text-muted-foreground">{t('drilldownColStatus')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ gs, game }) => {
          const opponent = game.type === 'home' ? game.away_team : game.home_team
          const hall = (game.hall as { name?: string } | null | undefined)?.name ?? ''
          const statusLabel = gs.status === 'present' ? t('drilldownStatusConfirmed') : t('drilldownStatusDeclined')
          const statusColor = gs.status === 'present'
            ? 'text-green-700 dark:text-green-400'
            : 'text-red-700 dark:text-red-400'
          return (
            <TableRow key={gs.gameId} className="border-border/60">
              <TableCell className="font-medium tabular-nums text-muted-foreground">{formatDate(gs.dateKey)}</TableCell>
              <TableCell className="text-muted-foreground">{opponent || '?'}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">{hall || '–'}</TableCell>
              <TableCell className={`font-medium ${statusColor}`}>{statusLabel}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
