import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import type { Team } from '../../types'
import type { CalendarEntry, CalendarFilterState, SourceFilter } from '../../types/calendar'
import { useCalendarData } from './hooks/useCalendarData'
import { useTeamGuestGameIds } from '../../hooks/useTeamGuestGameIds'
import { monthGridRange } from './monthRange'
import { getActiveFilterCount } from './filterCount'
import CalendarFilters from './CalendarFilters'
import MonthSurface from './components/MonthSurface'
import DayOverflowModal from './components/DayOverflowModal'
import EntryDetailModals from './components/EntryDetailModals'

/**
 * One team's calendar, in the member calendar's own language.
 *
 * This is deliberately the SAME stack as /calendar — same `useCalendarData`, same
 * month grids, same palette, same entry modals — just scoped to one team instead of
 * to the viewer's own. The team page used to render the Terminplanung planner's
 * calendar, which spoke of reserved courts, open slots and proposals: true things,
 * but a planner's working view, not a player's schedule.
 *
 * SOURCES SHOWN (`TEAM_SOURCES`): the team's home and away fixtures, its trainings,
 * its events, and hall closures.
 *
 * ⚠ `scorer-duty` is deliberately OUT. That source resolves the VIEWER'S OWN duty
 * assignments across six FKs and ignores the team filter entirely, so on a page
 * headed "H1" it would happily paint a D3 fixture the viewer is scoring.
 *
 * ⚠ `closure` is IN even though a hall closure is venue-wide rather than this
 * team's: the red day tint is only computed when closures were fetched, and "the
 * hall is shut" is exactly the context that explains a gap in a team's week.
 *
 * ⚠ `absence` and `birthday` are OFFERED but OFF by default. Both are per-member
 * facts about teammates rather than this team's schedule, and neither has ever been
 * on this page; a coach who wants "who is out this week" can switch them on, and the
 * dedicated absence view is still where that question really belongs. Nothing is
 * newly exposed either way — the same policies govern them on /calendar.
 *
 * ⚠ Fixtures this team was INVITED to (`game_guest_teams`) are included even though
 * `games.kscw_team` names another team. The Mobiliar Cup is registered for H1 and
 * D1 only, so an H1 cup tie is played by the H3 squad — scoping on `kscw_team`
 * alone hides from a team the match it is actually playing.
 *
 * ⚠ Club-wide events (those with no team junction at all) DO appear here, because
 * the events filter treats "belongs to no team" as "belongs to everyone". That is
 * right for a club fixture like the Weihnachtsessen and wrong for a role-targeted
 * one (a coaches' meeting), which carries no team link either. Accepted as club
 * context; revisit if role-only events start showing up as noise.
 *
 * ⚠ Safe only behind TeamDetail's `canViewTeam` gate. Five of these sources are
 * policy-scoped to the viewer, so lifting this component onto a public page or an
 * embed would quietly render an empty calendar rather than refusing.
 */
const TEAM_SOURCES: SourceFilter[] = ['game-home', 'game-away', 'training', 'event', 'closure']
/** Offered in the filter modal — the schedule, plus the two opt-ins. */
const TEAM_ALLOWED_SOURCES: SourceFilter[] = [...TEAM_SOURCES, 'absence', 'birthday']

export default function TeamCalendar({ team }: { team: Team }) {
  const { t } = useTranslation('calendar')
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null)
  const [dayOverflow, setDayOverflow] = useState<{ entries: CalendarEntry[]; date: Date } | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<CalendarFilterState>({
    sources: TEAM_SOURCES,
    selectedTeamIds: [String(team.id)],
  })

  // The team is the page, so it is not the viewer's to change — whatever the filter
  // modal does, the scope stays this team.
  const effectiveFilters = useMemo<CalendarFilterState>(
    () => ({ ...filters, selectedTeamIds: [String(team.id)] }),
    [filters, team.id],
  )

  const { rangeStart, rangeEnd } = useMemo(() => monthGridRange(month), [month])

  // Cup ties and the like, entered under another team's name — see the hook.
  const { guestGameIds } = useTeamGuestGameIds(team.id)

  const { entries, closedDates, isLoading } = useCalendarData({
    filters: effectiveFilters,
    rangeStart,
    rangeEnd,
    enabled: !!team.id,
    // A fixture the VIEWER was borrowed for belongs on their own calendar, not on
    // a page headed by a team they may not even play for.
    includeViewerGuestGames: false,
    // Team-scoped, unlike the option above: every member of this team sees these,
    // not just whoever happens to be called up.
    extraGameIds: guestGameIds,
  })

  // Latched exactly like /calendar: show the grid once, then never blank it again on
  // navigation. Without it, paging into an uncached quarter repaints an empty month
  // for a beat, which reads as "nothing scheduled".
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  if (!hasLoadedOnce && !isLoading) setHasLoadedOnce(true)

  // Only the sources count — the team chip is imposed, not chosen, so counting it
  // would pin a permanent "1" on the badge.
  const activeFilterCount = getActiveFilterCount(
    { ...filters, selectedTeamIds: [] },
    TEAM_ALLOWED_SOURCES.length,
  )

  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          className="relative inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 sm:min-h-0 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">{t('filterTitle')}</span>
          {activeFilterCount > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-xs font-semibold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <CalendarFilters
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onChange={setFilters}
        allowedSources={TEAM_ALLOWED_SOURCES}
        showTeamFilter={false}
      />

      {/* No card chrome on phones: MobileMonthView draws its own bordered card, and
          wrapping it in another produces a border inside a border. */}
      <div className="flex flex-col sm:min-h-[30rem] sm:rounded-lg sm:border sm:border-gray-200 sm:bg-white sm:p-4 sm:dark:border-gray-700 sm:dark:bg-gray-800">
        <MonthSurface
          entries={entries}
          closedDates={closedDates}
          month={month}
          onMonthChange={setMonth}
          onEntryClick={setSelectedEntry}
          onOverflowClick={(items, date) => setDayOverflow({ entries: items, date })}
        />
        {hasLoadedOnce && !isLoading && entries.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('noEntries')}
          </p>
        )}
      </div>

      <DayOverflowModal
        open={!!dayOverflow}
        date={dayOverflow?.date ?? null}
        entries={dayOverflow?.entries ?? []}
        onClose={() => setDayOverflow(null)}
        onSelect={setSelectedEntry}
      />

      <EntryDetailModals entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  )
}
