import { useTranslation } from 'react-i18next'
import { Pencil, Trash2, CalendarClock } from 'lucide-react'
import { formatDate, formatDateTimeCompact } from '../../utils/dateHelpers'
import { TableCell, TableRow } from '../../components/ui/table'
import type { Absence, Member } from '../../types'
import { asObj, memberDisplayName } from '../../utils/relations'

const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'] as const

const AFFECTS_COLORS: Record<string, string> = {
  trainings: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  games: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  events: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  all: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

interface WeeklyUnavailabilityCardProps {
  absence: Absence
  onEdit: (absence: Absence) => void
  onDelete: (absenceId: string) => void
  showMemberName?: boolean
  canEdit: boolean
}

/**
 * Renders a single `<TableRow>` — must be used inside a `<Table>` whose header
 * contains 7 day columns (Mon..Sun). See WEEKLY_DAY_HEADERS in the parent page.
 */
export default function WeeklyUnavailabilityCard({ absence, onEdit, onDelete, showMemberName, canEdit }: WeeklyUnavailabilityCardProps) {
  const { t } = useTranslation('absences')
  const m = asObj<Member>(absence.member)
  const memberName = m ? memberDisplayName(m) : undefined

  const affectsLabels: Record<string, string> = {
    trainings: t('affectsTrainings'),
    games: t('affectsGames'),
    events: t('affectsEvents'),
    all: t('affectsAll'),
  }

  const dateRange = `${formatDate(absence.start_date)}${
    absence.indefinite
      ? ` — ${t('indefinite')}`
      : absence.start_date !== absence.end_date
        ? ` — ${formatDate(absence.end_date)}`
        : ''
  }`

  const activeDays = new Set(absence.days_of_week ?? [])

  return (
    <TableRow className="align-top">
      {showMemberName && (
        <TableCell className="whitespace-normal text-sm font-medium text-gray-900 dark:text-gray-100">
          <div>{memberName ?? '—'}</div>
          {!absence.indefinite && absence.end_date && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] font-normal text-gray-500 dark:text-gray-400">
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                {t('untilShort', {
                  date: formatDate(absence.end_date).replace(/(\d{4})$/, (y) => y.slice(2)),
                })}
              </span>
            </div>
          )}
        </TableCell>
      )}
      {DAY_KEYS.map((key, dow) => {
        const active = activeDays.has(dow)
        const label = t(key)
        return (
          <TableCell
            key={key}
            className={
              `w-7 px-0.5 sm:w-10 sm:px-1 text-center align-middle ` +
              (dow === 0 ? 'border-l border-gray-200 dark:border-gray-700 ' : '') +
              `border-r border-gray-200 dark:border-gray-700`
            }
            title={active ? label : undefined}
          >
            <span
              aria-label={active ? label : undefined}
              aria-hidden={!active}
              className={
                active
                  ? 'inline-flex h-5 w-5 sm:h-7 sm:w-7 items-center justify-center rounded-sm sm:rounded-full bg-brand-500 text-[10px] sm:text-[11px] font-semibold text-white'
                  : 'inline-flex h-5 w-5 sm:h-7 sm:w-7 items-center justify-center rounded-sm sm:rounded-full text-[10px] sm:text-[11px] text-gray-300 dark:text-gray-600'
              }
            >
              {active ? '•' : ''}
            </span>
          </TableCell>
        )
      })}
      <TableCell className="hidden md:table-cell whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
        {dateRange}
      </TableCell>
      <TableCell className="hidden sm:table-cell whitespace-normal">
        {absence.affects && absence.affects.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {absence.affects.map((a) => (
              <span key={a} className={`rounded px-2 py-0.5 text-xs ${AFFECTS_COLORS[a] ?? AFFECTS_COLORS.all}`}>
                {affectsLabels[a] ?? a}
              </span>
            ))}
          </div>
        )}
        {absence.reason_detail && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{absence.reason_detail}</p>
        )}
        {(() => {
          // Third-party edit attribution (migration 051 + role/name from 053).
          const editedBy = absence.last_edited_by
          const editedAt = absence.last_edited_at
          if (!editedBy || !editedAt) return null
          if (m?.user && m.user === editedBy) return null
          const role = absence.last_edited_role
          const name = absence.last_edited_name
          const at = formatDateTimeCompact(editedAt)
          const key =
            role === 'coach' && name ? 'editedByCoachOn' :
            role === 'team_responsible' && name ? 'editedByTeamResponsibleOn' :
            role === 'admin' && name ? 'editedByAdminOn' :
            'editedByStaffOn'
          return (
            <p className="mt-1 break-words text-xs italic text-gray-400 dark:text-gray-500">
              {t(key, { at, name: name ?? '' })}
            </p>
          )
        })()}
      </TableCell>
      {canEdit ? (
        <TableCell className="w-10 px-1 align-middle text-right">
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => onEdit(absence)}
              aria-label={t('common:edit')}
              title={t('common:edit')}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-brand-600 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-900/30"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(absence.id)}
              aria-label={t('common:delete')}
              title={t('common:delete')}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-red-600 hover:bg-red-50 hover:text-red-800 dark:hover:bg-red-900/30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </TableCell>
      ) : (
        <TableCell />
      )}
    </TableRow>
  )
}
