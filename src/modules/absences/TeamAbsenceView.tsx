import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, List, CheckCircle, CalendarOff } from 'lucide-react'
import { useTeamAbsences } from '../../hooks/useTeamAbsences'
import EmptyState from '../../components/EmptyState'
import AbsenceCard from './AbsenceCard'
import Modal from '@/components/Modal'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import MonthGrid from '../calendar/components/MonthGrid'
import CalendarEntryModal from '../calendar/CalendarEntryModal'
import { toISODate, getDayOfWeek } from '../../utils/dateHelpers'
import { parseDate, isSameDay, startOfMonth, eachDayOfInterval, toDateKey, formatDate } from '../../utils/dateUtils'
import { max as maxDate, min as minDate, isAfter } from 'date-fns'
import DatePicker from '@/components/ui/DatePicker'
import AbsenceMemberFilter from './AbsenceMemberFilter'
import { buildMemberOptions } from './absenceMemberOptions'
import type { CalendarEntry } from '../../types/calendar'
import type { Absence, Member } from '../../types'
import { relId, asObj } from '../../utils/relations'

interface TeamAbsenceViewProps {
  teamIds: string[]
  onEdit?: (absence: Absence) => void
  onDelete?: (absenceId: string) => void
  canEdit?: boolean
}

/**
 * Convert team absences into CalendarEntry[] for MonthGrid.
 * Standard absences render as a multi-day block. Weekly absences expand
 * into one entry per matching weekday inside the visible month range
 * (clipped to the absence's own start/end window).
 */
function absencesToEntries(
  absences: Absence[],
  memberMap: Record<string, Member>,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEntry[] {
  const out: CalendarEntry[] = []
  for (const a of absences) {
    const m = asObj<Member>(a.member) ?? memberMap[relId(a.member)]
    const memberName = [m?.first_name, m?.last_name].filter(Boolean).join(' ') || ''

    if (a.type === 'weekly') {
      const days = a.days_of_week ?? []
      if (days.length === 0) continue
      const from = maxDate([parseDate(a.start_date), rangeStart])
      const to = minDate([parseDate(a.end_date), rangeEnd])
      if (isAfter(from, to)) continue
      for (const d of eachDayOfInterval(from, to)) {
        if (!days.includes(getDayOfWeek(d))) continue
        out.push({
          id: `${a.id}:${toDateKey(d)}`,
          type: 'absence' as const,
          title: memberName,
          date: d,
          startTime: null,
          endTime: null,
          allDay: true,
          location: '',
          teamNames: [],
          description: a.reason_detail ?? '',
          source: a,
        })
      }
      continue
    }

    const start = parseDate(a.start_date)
    const end = parseDate(a.end_date)
    const isMultiDay = !isSameDay(start, end)
    out.push({
      id: a.id,
      type: 'absence' as const,
      title: memberName,
      date: start,
      endDate: isMultiDay ? end : undefined,
      startTime: null,
      endTime: null,
      allDay: true,
      location: '',
      teamNames: [],
      description: a.reason_detail ?? '',
      source: a,
    })
  }
  return out
}

export default function TeamAbsenceView({ teamIds, onEdit, onDelete, canEdit }: TeamAbsenceViewProps) {
  const { t } = useTranslation('absences')
  const today = toISODate(new Date())
  const oneYearLater = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return toISODate(d)
  })()

  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(oneYearLater)
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null)
  const [dayOverflow, setDayOverflow] = useState<{ entries: CalendarEntry[]; date: Date } | null>(null)
  const [excludedMembers, setExcludedMembers] = useState<Set<string>>(new Set())

  const { absences, memberMap, isLoading } = useTeamAbsences(teamIds, startDate, endDate)

  // Distinct members who have at least one absence in range — drives the filter
  // dropdown. Built from the full fetched set so it's stable across list/calendar.
  const memberOptions = useMemo(
    () => buildMemberOptions(absences, memberMap, t('common:unknown')),
    [absences, memberMap, t],
  )

  // Apply the member filter before deriving either view. Tracked as excluded IDs
  // so everyone is shown by default and newly-loaded members stay visible.
  const visibleAbsences = useMemo(
    () => absences.filter((a) => !excludedMembers.has(relId(a.member))),
    [absences, excludedMembers],
  )

  // Standard (date-range) absences only — weeklies live in the Unavailabilities tab.
  // Sorted ascending so the next upcoming absence appears first.
  const sortedAbsences = useMemo(() =>
    [...visibleAbsences]
      .filter((a) => a.type !== 'weekly')
      .sort((a, b) => a.start_date.localeCompare(b.start_date)),
  [visibleAbsences])

  // Calendar entries — both standard blocks and per-weekday weekly occurrences,
  // clipped to the currently displayed month so we don't pre-expand a year of dots.
  const calendarRangeStart = useMemo(() => startOfMonth(month), [month])
  const calendarRangeEnd = useMemo(() => {
    const d = new Date(month)
    d.setMonth(d.getMonth() + 1)
    d.setDate(0)
    return d
  }, [month])
  const calendarEntries = useMemo(
    () => absencesToEntries(visibleAbsences, memberMap, calendarRangeStart, calendarRangeEnd),
    [visibleAbsences, memberMap, calendarRangeStart, calendarRangeEnd],
  )

  if (isLoading) {
    return <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('common:loading')}</div>
  }

  return (
    <div>
      {/* Controls row */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <DatePicker label={t('fromTo')} value={startDate} onChange={setStartDate} />
          <DatePicker label={t('until')} value={endDate} onChange={setEndDate} />
          <AbsenceMemberFilter
            options={memberOptions}
            excluded={excludedMembers}
            onChange={setExcludedMembers}
          />
        </div>
        {/* View toggle */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
          <button
            onClick={() => setViewMode('list')}
            className={`rounded-md p-2 transition-colors ${
              viewMode === 'list'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            title={t('common:list')}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`rounded-md p-2 transition-colors ${
              viewMode === 'calendar'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
            title={t('common:calendar')}
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        /* ── List view ── */
        sortedAbsences.length === 0 ? (
          <EmptyState
            icon={<CheckCircle className="h-10 w-10" />}
            title={t('noTeamAbsences')}
            description={t('noTeamAbsencesDescription')}
          />
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-gray-500 dark:text-gray-400">{t('colMember')}</TableHead>
                  <TableHead className="text-gray-500 dark:text-gray-400">{t('colReason')}</TableHead>
                  <TableHead className="hidden md:table-cell text-gray-500 dark:text-gray-400">{t('colWhen')}</TableHead>
                  <TableHead className="hidden sm:table-cell text-gray-500 dark:text-gray-400">{t('colAffects')}</TableHead>
                  <TableHead className="w-32 text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAbsences.map((a) => {
                  const member = asObj<Member>(a.member) ?? memberMap[relId(a.member)]
                  const memberName = [member?.first_name, member?.last_name].filter(Boolean).join(' ') || t('common:unknown')
                  return (
                    <AbsenceCard
                      key={a.id}
                      absence={a}
                      memberName={memberName}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      canEdit={canEdit}
                    />
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )
      ) : (
        /* ── Calendar view ── */
        <>
          <MonthGrid
            entries={calendarEntries}
            closedDates={new Set()}
            month={month}
            onMonthChange={setMonth}
            onEntryClick={setSelectedEntry}
            onOverflowClick={(items, date) => setDayOverflow({ entries: items, date })}
          />
          <CalendarEntryModal
            entry={selectedEntry}
            onClose={() => setSelectedEntry(null)}
          />
          {/* Day overflow modal — opened when multiple people are absent on one day */}
          <Modal
            open={!!dayOverflow}
            onClose={() => setDayOverflow(null)}
            title={dayOverflow ? formatDate(dayOverflow.date, 'EEEE, d MMMM') : ''}
            size="sm"
          >
            {dayOverflow && (
              <div className="space-y-2">
                {dayOverflow.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setDayOverflow(null)
                      setSelectedEntry(entry)
                    }}
                    className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-700 dark:active:bg-gray-600"
                  >
                    <CalendarOff className="h-4 w-4 shrink-0 text-gray-700 dark:text-gray-300" strokeWidth={2.5} />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {entry.title || t('common:unknown')}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </Modal>
        </>
      )}
    </div>
  )
}
