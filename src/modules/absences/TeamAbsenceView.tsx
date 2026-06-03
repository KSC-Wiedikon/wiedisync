import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, List, CheckCircle, CalendarOff, Star, CircleX } from 'lucide-react'
import { useTeamAbsences } from '../../hooks/useTeamAbsences'
import { useCollection } from '../../lib/query'
import EmptyState from '../../components/EmptyState'
import AbsenceCard from './AbsenceCard'
import Modal from '@/components/Modal'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import MonthGrid from '../calendar/components/MonthGrid'
import CalendarEntryModal from '../calendar/CalendarEntryModal'
import { useCalendarData } from '../calendar/hooks/useCalendarData'
import { CLOSURE_PATTERN } from '../hallenplan/utils/virtualSlots'
import { toISODate, getDayOfWeek } from '../../utils/dateHelpers'
import { parseDate, isSameDay, startOfMonth, eachDayOfInterval, toDateKey, formatDate } from '../../utils/dateUtils'
import { max as maxDate, min as minDate, isAfter } from 'date-fns'
import DatePicker from '@/components/ui/DatePicker'
import { Switch } from '@/components/ui/switch'
import AbsenceMemberFilter from './AbsenceMemberFilter'
import { buildMemberOptions } from './absenceMemberOptions'
import type { CalendarEntry, SourceFilter } from '../../types/calendar'
import type { Absence, Member, HallClosure } from '../../types'
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
  // Exclude toggles — everything shows by default; flipping a toggle ON HIDES that
  // category. One for weekly unavailabilities, one for non-blocking absences (those
  // flagged "doesn't block scheduling", e.g. injury).
  const [hideUnavailabilities, setHideUnavailabilities] = useState(false)
  const [hideNonBlocking, setHideNonBlocking] = useState(false)

  const { absences, memberMap, isLoading } = useTeamAbsences(teamIds, startDate, endDate)

  // School-holiday closures (Schulferien) overlapping the viewed window. Rendered by
  // MonthGrid as a faint red background on each covered day so members see when the
  // halls are closed for the holidays. Scoped to source='school_holidays' on purpose:
  // away games and one-off maintenance closures may still be in scope for a team, so
  // only the canton-wide school holidays shade the calendar.
  const { data: closuresRaw } = useCollection<HallClosure>('hall_closures', {
    filter: {
      _and: [
        { source: { _eq: 'school_holidays' } },
        { start_date: { _lte: endDate } },
        { end_date: { _gte: startDate } },
      ],
    },
    sort: ['start_date'],
    fields: ['start_date', 'end_date', 'reason'],
    limit: 500,
  })
  const closedDates = useMemo(() => {
    const dates = new Set<string>()
    for (const c of closuresRaw ?? []) {
      if (!c.start_date || !c.end_date) continue
      const start = parseDate(c.start_date)
      const end = parseDate(c.end_date)
      if (isAfter(start, end)) continue
      for (const day of eachDayOfInterval(start, end)) dates.add(toDateKey(day))
    }
    return dates
  }, [closuresRaw])
  // date → school-holiday reason, surfaced as the cell tooltip so staff see *why*
  // the hall is closed (e.g. "Sommerferien 2026") rather than a bare red day.
  const closedReasons = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of closuresRaw ?? []) {
      if (!c.start_date || !c.end_date || !c.reason) continue
      const start = parseDate(c.start_date)
      const end = parseDate(c.end_date)
      if (isAfter(start, end)) continue
      for (const day of eachDayOfInterval(start, end)) map.set(toDateKey(day), c.reason)
    }
    return map
  }, [closuresRaw])

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
      .filter((a) => !hideNonBlocking || a.blocking !== false)
      .sort((a, b) => a.start_date.localeCompare(b.start_date)),
  [visibleAbsences, hideNonBlocking])

  // Calendar entries — both standard blocks and per-weekday weekly occurrences,
  // clipped to the currently displayed month so we don't pre-expand a year of dots.
  const calendarRangeStart = useMemo(() => startOfMonth(month), [month])
  const calendarRangeEnd = useMemo(() => {
    const d = new Date(month)
    d.setMonth(d.getMonth() + 1)
    d.setDate(0)
    return d
  }, [month])
  // Calendar source: weeklies drop when hideUnavailabilities is on; non-blocking
  // one-off absences drop when hideNonBlocking is on. Weeklies are governed solely
  // by hideUnavailabilities (the blocking flag doesn't apply to them).
  const calendarAbsences = useMemo(
    () => visibleAbsences.filter((a) => {
      if (a.type === 'weekly') return !hideUnavailabilities
      return !hideNonBlocking || a.blocking !== false
    }),
    [visibleAbsences, hideUnavailabilities, hideNonBlocking],
  )
  // Overlay the team's events (tinted blue) and hall closures (red) on the
  // calendar so staff see the full availability picture. Reuses the main
  // calendar's data hook — it already team-scopes events correctly (club-wide +
  // events_teams) and fetches hall_closures. Only fetched in calendar view.
  const overlayFilters = useMemo(
    () => ({ sources: ['event', 'closure'] as SourceFilter[], selectedTeamIds: teamIds }),
    [teamIds],
  )
  const { entries: overlayRaw } = useCalendarData({
    filters: overlayFilters,
    rangeStart: calendarRangeStart,
    rangeEnd: calendarRangeEnd,
    enabled: viewMode === 'calendar',
  })
  const calendarEntries = useMemo(() => {
    const absenceEntries = absencesToEntries(calendarAbsences, memberMap, calendarRangeStart, calendarRangeEnd)
    const overlay: CalendarEntry[] = []
    const seenClosure = new Set<string>()
    for (const e of overlayRaw) {
      if (e.type === 'event') {
        overlay.push({ ...e, colorOverride: 'blue' })
        continue
      }
      if (e.type === 'closure') {
        const src = e.source as HallClosure
        // School-holiday closures render as the red background (closedDates) — never a bar.
        if (src.source === 'school_holidays') continue
        const dateKey = toDateKey(e.date)
        const generic = CLOSURE_PATTERN.test(src.reason ?? '')
        // A school holiday already explains why the hall is closed → the generic
        // "Halle geschlossen" closure is redundant; the holiday wins.
        if (generic && closedDates.has(dateKey)) continue
        // Localise the generic German "Halle geschlossen"; keep specific reasons as-is.
        const title = generic ? t('hallClosed') : e.title
        // Collapse the casing / trailing-space variants into one bar per day.
        const key = `${dateKey}|${e.endDate ? toDateKey(e.endDate) : ''}|${title}`
        if (seenClosure.has(key)) continue
        seenClosure.add(key)
        overlay.push({ ...e, title })
        continue
      }
      overlay.push(e)
    }
    return [...absenceEntries, ...overlay]
  }, [calendarAbsences, memberMap, calendarRangeStart, calendarRangeEnd, overlayRaw, closedDates, t])

  // Day-overflow modal rows. Absences collapse per member (a member can have BOTH a
  // one-off absence and a weekly unavailability on a day → one "Absent / Unavailable"
  // row; absence overrides unavailability so the merged row opens the one-off entry).
  // Events/closures (which can land here too via MonthGrid's overflow) render as their
  // own rows with a type-appropriate icon — never mislabelled as an absence.
  const dayOverflowGroups = useMemo<{ id: string; name: string; detail: string; kind: 'absence' | 'event' | 'closure' | 'other'; entry: CalendarEntry }[]>(() => {
    if (!dayOverflow) return []
    const byMember = new Map<string, { id: string; name: string; hasAbsence: boolean; hasWeekly: boolean; entry: CalendarEntry }>()
    const others: { id: string; name: string; detail: string; kind: 'event' | 'closure' | 'other'; entry: CalendarEntry }[] = []
    for (const entry of dayOverflow.entries) {
      if (entry.type === 'absence') {
        const src = entry.source as Absence
        const memberId = relId(src.member) || entry.id
        const isWeekly = src.type === 'weekly'
        const existing = byMember.get(memberId)
        if (existing) {
          existing.hasAbsence = existing.hasAbsence || !isWeekly
          existing.hasWeekly = existing.hasWeekly || isWeekly
          if (!isWeekly) existing.entry = entry // absence overrides unavailability
        } else {
          byMember.set(memberId, { id: memberId, name: entry.title, hasAbsence: !isWeekly, hasWeekly: isWeekly, entry })
        }
      } else {
        others.push({
          id: entry.id,
          name: entry.title,
          detail: entry.location ?? '',
          kind: entry.type === 'event' ? 'event' : entry.type === 'closure' ? 'closure' : 'other',
          entry,
        })
      }
    }
    const absenceRows = [...byMember.values()].map((g) => ({
      id: g.id,
      name: g.name,
      detail: g.hasAbsence && g.hasWeekly ? t('absentUnavailable') : g.hasWeekly ? t('unavailable') : t('absent'),
      kind: 'absence' as const,
      entry: g.entry,
    }))
    return [...absenceRows, ...others]
  }, [dayOverflow, t])

  if (isLoading) {
    return <div className="py-8 text-center text-gray-500 dark:text-gray-400">{t('common:loading')}</div>
  }

  return (
    <div>
      {/* Controls row */}
      <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
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
      {/* Exclude toggles — flipping one ON hides that category */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Switch id="abs-hide-unavailabilities" checked={hideUnavailabilities} onCheckedChange={setHideUnavailabilities} />
          <label htmlFor="abs-hide-unavailabilities" className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('hideUnavailabilities')}
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="abs-hide-nonblocking" checked={hideNonBlocking} onCheckedChange={setHideNonBlocking} />
          <label htmlFor="abs-hide-nonblocking" className="cursor-pointer text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('hideNonBlocking')}
          </label>
        </div>
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
            closedDates={closedDates}
            closedReasons={closedReasons}
            closedClassName="bg-red-100/70 dark:bg-red-900/30"
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
                {dayOverflowGroups.map((g) => {
                  const Icon = g.kind === 'event' ? Star : g.kind === 'closure' ? CircleX : CalendarOff
                  const iconClass = g.kind === 'event'
                    ? 'text-blue-500'
                    : g.kind === 'closure'
                      ? 'text-red-500'
                      : 'text-gray-700 dark:text-gray-300'
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setDayOverflow(null)
                        setSelectedEntry(g.entry)
                      }}
                      className="flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-700 dark:active:bg-gray-600"
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} strokeWidth={2.5} {...(g.kind === 'event' ? { fill: 'currentColor' } : {})} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                          {g.name || t('common:unknown')}
                        </p>
                        {g.detail && <p className="truncate text-xs text-gray-500 dark:text-gray-400">{g.detail}</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Modal>
        </>
      )}
    </div>
  )
}
