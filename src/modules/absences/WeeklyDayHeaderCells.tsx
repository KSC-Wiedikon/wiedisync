import { useTranslation } from 'react-i18next'
import { TableHead } from '@/components/ui/table'

const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'] as const

/**
 * Renders 7 narrow `<TableHead>` cells (Mon..Sun) shared between the personal
 * and team weekly-unavailability tables. Must be rendered inside a `<TableRow>`.
 */
export default function WeeklyDayHeaderCells() {
  const { t } = useTranslation('absences')
  return (
    <>
      {DAY_KEYS.map((key, i) => {
        const label = t(key)
        return (
          <TableHead
            key={key}
            className={
              `w-7 px-0.5 sm:w-10 sm:px-1 text-center text-[10px] sm:text-[11px] font-medium uppercase tracking-wide text-muted-foreground ` +
              (i === 0 ? 'border-l border-border ' : '') +
              `border-r border-border`
            }
          >
            <span className="sm:hidden">{label.charAt(0)}</span>
            <span className="hidden sm:inline">{label}</span>
          </TableHead>
        )
      })}
    </>
  )
}
