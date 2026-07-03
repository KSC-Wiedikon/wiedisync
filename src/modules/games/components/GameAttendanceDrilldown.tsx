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
    return <p className="text-xs text-gray-500 dark:text-gray-400">{t('drilldownEmpty')}</p>
  }

  return (
    <Table className="text-xs">
      <TableHeader>
        <TableRow className="border-gray-200 dark:border-gray-700">
          <TableHead className="text-gray-500 dark:text-gray-400">{t('date')}</TableHead>
          <TableHead className="text-gray-500 dark:text-gray-400">{t('drilldownColOpponent')}</TableHead>
          <TableHead className="hidden text-gray-500 sm:table-cell dark:text-gray-400">{t('hallLabel')}</TableHead>
          <TableHead className="text-gray-500 dark:text-gray-400">{t('drilldownColStatus')}</TableHead>
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
            <TableRow key={gs.gameId} className="border-gray-100 dark:border-gray-700/50">
              <TableCell className="font-medium text-gray-600 dark:text-gray-300">{formatDate(gs.dateKey)}</TableCell>
              <TableCell className="text-gray-600 dark:text-gray-300">{opponent || '?'}</TableCell>
              <TableCell className="hidden text-gray-600 sm:table-cell dark:text-gray-300">{hall || '–'}</TableCell>
              <TableCell className={`font-medium ${statusColor}`}>{statusLabel}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
