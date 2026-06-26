import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import TeamChip from '../../components/TeamChip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import type { CalendarEntry } from '../../types/calendar'
import { toDateKey, formatDate } from '../../utils/dateUtils'

interface UnifiedListViewProps {
  entries: CalendarEntry[]
  onEntryClick?: (entry: CalendarEntry) => void
}

const typeDots: Record<string, string> = {
  game: 'bg-brand-500',
  'game-home': 'bg-brand-500',
  'game-away': 'bg-amber-500',
  training: 'bg-green-500',
  closure: 'bg-red-500',
  event: 'bg-purple-500',
  hall: 'bg-cyan-500',
  absence: 'bg-gray-900 dark:bg-gray-100',
  'scorer-duty': 'bg-indigo-500',
}

function entryDot(entry: CalendarEntry): string {
  if (entry.type === 'game' && entry.gameType) {
    return typeDots[`game-${entry.gameType}`]
  }
  return typeDots[entry.type]
}

export default function UnifiedListView({ entries, onEntryClick }: UnifiedListViewProps) {
  const { t } = useTranslation('calendar')

  const typeLabels: Record<CalendarEntry['type'], string> = {
    game: t('typeGame'),
    training: t('typeTraining'),
    closure: t('typeClosure'),
    event: t('typeEvent'),
    hall: t('typeHall'),
    absence: t('typeAbsence'),
    'scorer-duty': t('typeScorerDuty'),
  }
  const grouped = useMemo(() => {
    const groups: { dateKey: string; label: string; entries: CalendarEntry[] }[] = []
    let currentKey = ''

    for (const entry of entries) {
      const key = toDateKey(entry.date)
      if (key !== currentKey) {
        currentKey = key
        groups.push({
          dateKey: key,
          label: formatDate(entry.date, 'EEEE, d. MMMM yyyy'),
          entries: [],
        })
      }
      groups[groups.length - 1].entries.push(entry)
    }

    return groups
  }, [entries])

  if (entries.length === 0) {
    return <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('noEntries')}</div>
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.dateKey} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="border-b border-gray-100 bg-gray-50 dark:bg-gray-900 px-4 py-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{group.label}</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 text-xs uppercase text-gray-400">{t('colType')}</TableHead>
                <TableHead className="text-xs uppercase text-gray-400">{t('colTitle')}</TableHead>
                <TableHead className="text-right text-xs uppercase text-gray-400 whitespace-nowrap">{t('colTime')}</TableHead>
                <TableHead className="hidden md:table-cell text-xs uppercase text-gray-400">{t('colLocation')}</TableHead>
                <TableHead className="hidden sm:table-cell text-xs uppercase text-gray-400">{t('colTeams')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  onClick={() => onEntryClick?.(entry)}
                  className="cursor-pointer align-top"
                >
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 shrink-0 rounded-full ${entryDot(entry)}`} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{typeLabels[entry.type]}</span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal text-sm text-gray-900 dark:text-gray-100">
                    <span>{entry.title}</span>
                    {entry.description && (
                      <span className="ml-2 text-xs text-gray-400">{entry.description}</span>
                    )}
                    <div className="md:hidden mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      {entry.location && <span className="truncate">{entry.location}</span>}
                      {entry.teamNames.length > 0 && (
                        <div className="sm:hidden flex flex-wrap gap-1">
                          {entry.teamNames.map((name) => (
                            <TeamChip key={name} team={name} size="xs" />
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {entry.allDay
                      ? t('common:allDay')
                      : entry.startTime
                        ? entry.endTime
                          ? `${entry.startTime}–${entry.endTime}`
                          : entry.startTime
                        : ''}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-gray-500 truncate max-w-[10rem]">
                    {entry.location}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {entry.teamNames.map((name) => (
                        <TeamChip key={name} team={name} size="sm" />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
