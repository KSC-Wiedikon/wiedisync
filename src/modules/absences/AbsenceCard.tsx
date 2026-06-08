import { useTranslation } from 'react-i18next'
import StatusBadge from '../../components/StatusBadge'
import { formatDate, formatDateTimeCompact } from '../../utils/dateHelpers'
import { TableCell, TableRow } from '../../components/ui/table'
import { asObj } from '../../utils/relations'
import type { Absence, Member } from '../../types'

/**
 * Inclusive day count between two ISO date strings (YYYY-MM-DD).
 * Same start/end → 1. Parsed as UTC midnight so DST/local offsets never shift it.
 * Returns null if either date is missing/unparseable.
 */
function inclusiveDays(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null
  const s = Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`)
  const e = Date.parse(`${String(end).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(s) || Number.isNaN(e)) return null
  return Math.round((e - s) / 86_400_000) + 1
}

interface AbsenceCardProps {
  absence: Absence
  onEdit?: (absence: Absence) => void
  onDelete?: (absenceId: string) => void
  /** Show member name (for team view) */
  memberName?: string
  canEdit?: boolean
}

/**
 * Renders a single `<TableRow>` — must be used inside a `<Table>`.
 * See AbsencesPage / TeamAbsenceView for the wrapping `<Table>`.
 */
export default function AbsenceCard({ absence, onEdit, onDelete, memberName, canEdit }: AbsenceCardProps) {
  const { t } = useTranslation('absences')

  const affectsLabels: Record<string, string> = {
    trainings: t('affectsTrainings'),
    games: t('affectsGames'),
    events: t('affectsEvents'),
    all: t('affectsAll'),
  }

  const isMultiDay = absence.indefinite || absence.start_date !== absence.end_date
  const dateRange = absence.indefinite
    ? `${formatDate(absence.start_date)} – ${t('indefinite')}`
    : isMultiDay
      ? `${formatDate(absence.start_date)} – ${formatDate(absence.end_date)}`
      : formatDate(absence.start_date)

  // Inclusive day span (same start/end = 1 day). Skipped for weekly
  // unavailabilities (recurring, not a contiguous span) and indefinite absences.
  const dayCount =
    absence.type !== 'weekly' && !absence.indefinite
      ? inclusiveDays(absence.start_date, absence.end_date)
      : null

  return (
    <TableRow className="align-top">
      {memberName !== undefined && (
        <TableCell className="whitespace-normal text-sm font-medium text-gray-900 dark:text-gray-100">
          {memberName}
        </TableCell>
      )}
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={absence.reason} />
          {absence.type !== 'weekly' && absence.blocking === false && (
            <span
              title={t('blockingHint')}
              className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-300"
            >
              {t('nonBlocking')}
            </span>
          )}
          <span className="sm:hidden text-sm text-gray-600 dark:text-gray-400">
            {dateRange}
            {dayCount != null && <span className="text-gray-400 dark:text-gray-500"> · {t('dayCount', { count: dayCount })}</span>}
          </span>
        </div>
        {absence.reason_detail && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{absence.reason_detail}</p>
        )}
        {(() => {
          // Third-party edit attribution (migration 051 + role/name from 053).
          const m = asObj<Member>(absence.member)
          const editedBy = absence.last_edited_by
          const editedAt = absence.last_edited_at
          if (!editedBy || !editedAt) return null
          if (m?.user && m.user === editedBy) return null
          const role = absence.last_edited_role
          const name = absence.last_edited_name
          const at = formatDateTimeCompact(editedAt)
          // Per-role i18n key so each locale renders capitalisation/grammar
          // naturally. Pre-053 rows have no role/name → legacy fallback.
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
      <TableCell className="hidden md:table-cell whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
        {dateRange}
        {dayCount != null && (
          <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">· {t('dayCount', { count: dayCount })}</span>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell whitespace-normal">
        {absence.affects && absence.affects.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {absence.affects.map((a) => (
              <span key={a} className="rounded bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">
                {affectsLabels[a] ?? a}
              </span>
            ))}
          </div>
        )}
      </TableCell>
      {canEdit && onEdit && onDelete ? (
        <TableCell className="text-right">
          <div data-tour="edit-absence" className="flex flex-col items-stretch gap-1 sm:flex-row sm:justify-end sm:gap-2">
            <button
              onClick={() => onEdit(absence)}
              className="min-h-[36px] rounded px-3 py-1.5 text-sm text-brand-600 hover:bg-brand-50 hover:text-brand-700"
            >
              {t('common:edit')}
            </button>
            <button
              onClick={() => onDelete(absence.id)}
              className="min-h-[36px] rounded px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 hover:text-red-800"
            >
              {t('common:delete')}
            </button>
          </div>
        </TableCell>
      ) : (
        <TableCell />
      )}
    </TableRow>
  )
}
