import { useState, useRef, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import ViewToggle from '../../components/ViewToggle'
import CalendarFilters from './CalendarFilters'
import { getActiveFilterCount } from './filterCount'
import { monthGridRange } from './monthRange'
import WeekGrid from './components/WeekGrid'
import MobileWeekGrid from './components/MobileWeekGrid'
import MonthSurface from './components/MonthSurface'
import DayOverflowModal from './components/DayOverflowModal'
import EntryDetailModals from './components/EntryDetailModals'
import HallenplanView from './HallenplanView'
import ICalModal from './ICalModal'
import { useCalendarData } from './hooks/useCalendarData'
import { useAuth } from '../../hooks/useAuth'
import { useAdminMode } from '../../hooks/useAdminMode'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { startOfMonth, startOfWeek, endOfWeek } from '../../utils/dateUtils'
import { SlidersHorizontal } from 'lucide-react'
import type { CalendarViewMode, CalendarFilterState, SourceFilter, CalendarEntry } from '../../types/calendar'
import type { Team } from '../../types'
import { useCollection } from '../../lib/query'
import { hasFixtureSchedule } from '../gameScheduling/utils/schedulableTeams'
import TeamScheduleCalendar from '../gameScheduling/components/TeamScheduleCalendar'
import { useReportPageLoading } from '../../hooks/usePageReady'

export default function CalendarPage() {
  const { t } = useTranslation('calendar')
  const { user, memberTeamIds, coachTeamIds, teamsLoading } = useAuth()
  const { effectiveIsAdmin, effectiveIsVorstand } = useAdminMode()
  const isMobile = useIsMobile()
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month')
  const allSources: SourceFilter[] = user
    ? ['game-home', 'game-away', 'training', 'event', 'closure', 'hall', 'absence', 'scorer-duty', 'birthday']
    : ['game-home', 'game-away', 'hall']

  // Combine member + coach teams for the user's "own teams"
  const userTeamIds = useMemo(() => {
    const set = new Set([...memberTeamIds, ...coachTeamIds])
    return [...set]
  }, [memberTeamIds, coachTeamIds])

  // The user's teams that have a fixture list — drives the optional "Schedule"
  // view. ⚠ NOT `isSchedulableTeam`: that gate is about the volleyball
  // negotiation, and using it here hid the whole tab from a basketball-only
  // member (the tab is only offered when some team passes), so a basketball
  // fixture had nowhere to appear.
  const { data: userTeamsRaw } = useCollection<Team>('teams', {
    enabled: !!user && userTeamIds.length > 0,
    filter: userTeamIds.length > 0 ? { id: { _in: userTeamIds } } : { id: { _eq: -1 } },
    fields: ['id', 'name', 'sport', 'active'],
    all: true,
  })
  const scheduleTeams = useMemo(
    () => (userTeamsRaw ?? []).filter(hasFixtureSchedule),
    [userTeamsRaw],
  )

  const [filters, setFilters] = useState<CalendarFilterState>(() => ({
    sources: [...allSources],
    selectedTeamIds: [],
  }))
  // Auto-select user's teams on initial load (non-admin only). Latched by
  // `autoSelected`, so it fires exactly once — on the first render where the team
  // IDs have resolved. Applied during render instead of in an effect
  // (react-hooks/set-state-in-effect); it settles in the same commit, and the data
  // query is unaffected either way because `effectiveFilters` below already falls
  // back to the user's own teams while the selection is empty.
  const [autoSelected, setAutoSelected] = useState(false)
  if (!autoSelected && userTeamIds.length > 0 && !effectiveIsAdmin && !effectiveIsVorstand) {
    setFilters((f) => ({ ...f, selectedTeamIds: userTeamIds }))
    setAutoSelected(true)
  }
  // Sync sources when auth state changes (e.g., user logs in → training/event/closure become available)
  const prevUserRef = useRef(user)
  useEffect(() => {
    if (user && !prevUserRef.current) {
      setFilters((f) => ({ ...f, sources: [...allSources] }))
    }
    prevUserRef.current = user
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()))
  const [mobileDay, setMobileDay] = useState<Date>(() => new Date())
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null)
  const [dayOverflow, setDayOverflow] = useState<{ entries: CalendarEntry[]; date: Date } | null>(null)
  const [icalMode, setIcalMode] = useState<'subscribe' | 'download' | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  // Allowed sources for the filter chips (all visible options)
  const allowedSources = allSources

  // Active chips = what's selected. Pass directly to data hook.
  // Non-admins: fall back to own teams when filter is empty (never show all teams).
  const effectiveFilters: CalendarFilterState = useMemo(() => {
    if (!user) {
      return { sources: ['game-home', 'game-away', 'hall'], selectedTeamIds: [] }
    }
    // Non-admins: if no teams selected, scope to their own teams.
    // ⚠ Including when they have NONE. The old `userTeamIds.length > 0` guard
    // let that case fall through to an unscoped filter, which the data hook
    // reads as "no team condition" — i.e. the whole club, the exact opposite of
    // this block's stated intent. It fired whenever the member's team list came
    // back empty (the season-guard bug in AuthProvider), so a scope collapse
    // surfaced as a calendar quietly showing everyone's fixtures. `-1` matches
    // no team; server-side policies still scope trainings/events/absences.
    if (!effectiveIsAdmin && !effectiveIsVorstand && filters.selectedTeamIds.length === 0) {
      return { ...filters, selectedTeamIds: userTeamIds.length > 0 ? userTeamIds : ['-1'] }
    }
    return filters
  }, [filters, user, effectiveIsAdmin, effectiveIsVorstand, userTeamIds])

  // Compute visible range based on view mode
  const { rangeStart, rangeEnd } = useMemo(() => {
    // The month grid paints leading/trailing days of the neighbouring months too.
    if (viewMode === 'month') return monthGridRange(month)
    if (viewMode === 'week') {
      if (isMobile) {
        // 3-day mobile view
        const end = new Date(mobileDay)
        end.setDate(end.getDate() + 2)
        return { rangeStart: mobileDay, rangeEnd: end }
      }
      return { rangeStart: startOfWeek(weekStart), rangeEnd: endOfWeek(weekStart) }
    }
    // hallenplan — don't fetch
    return { rangeStart: new Date(), rangeEnd: new Date() }
  }, [viewMode, month, weekStart, mobileDay, isMobile])

  const needsData = viewMode === 'month' || viewMode === 'week'
  // Don't fetch until user teams are resolved (prevents flash of all-team data)
  const teamsReady = !user || effectiveIsAdmin || effectiveIsVorstand || !teamsLoading
  const { entries, closedDates, isLoading } = useCalendarData({
    filters: effectiveFilters,
    rangeStart,
    rangeEnd,
    enabled: needsData && teamsReady,
  })

  // Only show full-page spinner on initial load, not on navigation.
  // While team context is still resolving, the data hook is disabled
  // (`enabled: needsData && teamsReady`) so `isLoading` is false — without
  // folding `!teamsReady` in, the empty grid would flash during that window.
  // Don't mark "loaded once" until teams are actually ready and data has landed.
  // A latched state rather than a ref — reading/writing a ref during render is
  // rejected (react-hooks/refs). The guard makes the render-phase update converge
  // immediately, so the committed render sees the same value the ref did.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  if (!hasLoadedOnce && !isLoading && needsData && teamsReady) setHasLoadedOnce(true)
  const showSpinner = needsData && (isLoading || !teamsReady) && !hasLoadedOnce

  // Report to app boot gate — see usePageReady.tsx
  useReportPageLoading(showSpinner)

  function handleViewChange(v: string) {
    setViewMode(v as CalendarViewMode)
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">{t('title')}</h1>
        <div className="flex items-center gap-2">
          {needsData && (
            <>
              <button
                data-tour="calendar-filter"
                onClick={() => setFilterOpen(true)}
                className="relative inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('filterTitle')}</span>
                {getActiveFilterCount(filters, allowedSources.length) > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold text-white">
                    {getActiveFilterCount(filters, allowedSources.length)}
                  </span>
                )}
              </button>
              <button
                data-tour="calendar-ical"
                onClick={() => setIcalMode('subscribe')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                title={t('subscribeICal')}
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span className="hidden sm:inline">{t('subscribeICal')}</span>
              </button>
              <button
                onClick={() => setIcalMode('download')}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span className="hidden sm:inline">{t('exportICal')}</span>
              </button>
            </>
          )}
          <div data-tour="calendar-view">
            <ViewToggle
              options={[
                { value: 'hallenplan', label: t('viewHall') },
                { value: 'month', label: t('viewMonth') },
                ...(scheduleTeams.length > 0 ? [{ value: 'schedule', label: t('viewSchedule') }] : []),
              ]}
              value={viewMode}
              onChange={handleViewChange}
            />
          </div>
        </div>
      </div>

      {/* Filter modal */}
      {needsData && (
        <CalendarFilters
          open={filterOpen}
          onClose={() => setFilterOpen(false)}
          filters={filters}
          onChange={setFilters}
          allowedSources={allowedSources}
          userTeamIds={userTeamIds}
          isAdmin={effectiveIsAdmin || effectiveIsVorstand}
        />
      )}

      {/* Views */}
      {viewMode === 'hallenplan' && <HallenplanView />}

      {/* Schedule view — per-team proposed + confirmed game calendars */}
      {viewMode === 'schedule' && (
        <div className="flex flex-1 flex-col gap-6">
          {scheduleTeams.map((team) => (
            <TeamScheduleCalendar key={team.id} team={team} hideWhenEmpty={false} variant="list" />
          ))}
        </div>
      )}

      {needsData && showSpinner && null}

      {needsData && !showSpinner && (
        <div data-tour="calendar-grid" className="flex flex-1 flex-col">
          {/* Month view */}
          {viewMode === 'month' && (
            <MonthSurface
              entries={entries}
              closedDates={closedDates}
              month={month}
              onMonthChange={setMonth}
              onEntryClick={setSelectedEntry}
              onOverflowClick={(items, date) => setDayOverflow({ entries: items, date })}
            />
          )}

          {/* Week view */}
          {viewMode === 'week' && (
            isMobile ? (
              <MobileWeekGrid
                entries={entries}
                closedDates={closedDates}
                dayStart={mobileDay}
                onDayChange={setMobileDay}
                onEntryClick={setSelectedEntry}
              />
            ) : (
              <WeekGrid
                entries={entries}
                closedDates={closedDates}
                weekStart={weekStart}
                onWeekChange={setWeekStart}
                onEntryClick={setSelectedEntry}
              />
            )
          )}
        </div>
      )}

      {/* Day overflow modal */}
      <DayOverflowModal
        open={!!dayOverflow}
        date={dayOverflow?.date ?? null}
        entries={dayOverflow?.entries ?? []}
        onClose={() => setDayOverflow(null)}
        onSelect={setSelectedEntry}
      />

      {/* Detail modals */}
      <EntryDetailModals entry={selectedEntry} onClose={() => setSelectedEntry(null)} />

      {/* iCal subscribe/download modal */}
      <ICalModal
        open={!!icalMode}
        mode={icalMode ?? 'subscribe'}
        onClose={() => setIcalMode(null)}
        entries={entries}
      />
    </div>
  )
}
