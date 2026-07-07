import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Cake, Star, TrafficCone, CircleX, ClipboardList } from 'lucide-react'
import { Marquee } from '@/components/magicui/marquee'
import VolleyballIcon from '../../../components/VolleyballIcon'
import BasketballIcon from '../../../components/BasketballIcon'
import { useCalendarData } from '../../calendar/hooks/useCalendarData'
import { entryIconColor } from '../../calendar/entryStyle'
import type { CalendarEntry, CalendarFilterState, BirthdaySource } from '../../../types/calendar'
import { addDays, formatWeekdayZurich } from '../../../utils/dateHelpers'
import { toDateKey } from '../../../utils/dateUtils'

/** Sources surfaced in the homepage ticker — the "what's happening" set. Absences
 *  and external hall bookings are intentionally left out (noise); birthdays are
 *  in (and are team-scoped + authed inside useCalendarData). */
const TICKER_SOURCES: CalendarFilterState['sources'] = [
  'game-home', 'game-away', 'training', 'event', 'closure', 'scorer-duty', 'birthday',
]

/** Small type icon for a ticker pill, coloured to match the calendar palette. */
function TickerIcon({ entry }: { entry: CalendarEntry }) {
  const cls = `h-4 w-4 shrink-0 ${entryIconColor(entry)}`
  switch (entry.type) {
    case 'birthday': return <Cake className={cls} strokeWidth={2.5} />
    case 'training': return <TrafficCone className={cls} strokeWidth={2.5} />
    case 'event': return <Star className={cls} fill="currentColor" strokeWidth={2} />
    case 'closure': return <CircleX className={cls} strokeWidth={2.5} />
    case 'scorer-duty': return <ClipboardList className={cls} strokeWidth={2.5} />
    case 'game':
      return entry.sport === 'basketball'
        ? <BasketballIcon className="h-4 w-4 shrink-0" filled />
        : <VolleyballIcon className="h-4 w-4 shrink-0" filled />
    default: return <CalendarClock className={cls} />
  }
}

function TickerPill({ entry, todayKey }: { entry: CalendarEntry; todayKey: string }) {
  const { t } = useTranslation('home')
  const isToday = toDateKey(entry.date) === todayKey
  const when = isToday ? t('today') : formatWeekdayZurich(entry.date)
  const time = entry.startTime ? ` ${entry.startTime}` : ''

  let main = entry.title
  if (entry.type === 'birthday') {
    main = `${entry.title} · ${t('turnsAge', { age: (entry.source as BirthdaySource).age })}`
  } else if (entry.location && entry.type !== 'game') {
    main = `${entry.title} · ${entry.location}`
  }

  return (
    <div className="flex items-center gap-2 whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <TickerIcon entry={entry} />
      <span className="font-semibold text-gray-900 dark:text-gray-100">{when}{time}</span>
      <span className="text-gray-600 dark:text-gray-300">{main}</span>
    </div>
  )
}

/**
 * Homepage "next 7 days" ticker — an auto-scrolling, ~95vw-wide horizontal
 * marquee of everything coming up for the given teams: games, trainings, events,
 * hall closures, the member's own scoring duties, and team birthdays. Reuses the
 * calendar's data engine (team-scoped, authed) over a 7-day window. Renders
 * nothing when there's nothing coming up.
 *
 * `teamIds` is the caller's scope: a member's own teams, or every team an admin
 * can see (all of them for a global admin, sport-scoped for VB/BB admins).
 */
export default function UpcomingTicker({ teamIds }: { teamIds: string[] }) {
  const { t } = useTranslation('home')

  const { rangeStart, rangeEnd, todayKey } = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return { rangeStart: start, rangeEnd: addDays(start, 7), todayKey: toDateKey(start) }
  }, [])

  const filters = useMemo<CalendarFilterState>(
    () => ({ sources: TICKER_SOURCES, selectedTeamIds: teamIds }),
    [teamIds],
  )

  const { entries } = useCalendarData({
    filters,
    rangeStart,
    rangeEnd,
    enabled: teamIds.length > 0,
  })

  // Cap the DOM cost; entries are already chronological.
  const items = useMemo(() => entries.slice(0, 24), [entries])
  if (items.length === 0) return null

  return (
    <div className="mb-6">
      <div className="mb-1.5 flex items-center justify-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">
        <CalendarClock className="h-3.5 w-3.5" />
        {t('next7Days')}
      </div>
      {/* Full-bleed: break out of the constrained page container to ~95vw. */}
      <div className="relative left-1/2 w-screen max-w-[95vw] -translate-x-1/2">
        <Marquee
          pauseOnHover
          repeat={items.length <= 8 ? 4 : 2}
          className="[--duration:45s] [--gap:0.75rem] py-1 [mask-image:linear-gradient(to_right,transparent,black_4%,black_96%,transparent)]"
        >
          {items.map((entry) => (
            <TickerPill key={entry.id} entry={entry} todayKey={todayKey} />
          ))}
        </Marquee>
      </div>
    </div>
  )
}
