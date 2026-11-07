import { useCollection } from '../lib/query'
import type { EventSession } from '../types'

const NO_SESSIONS: EventSession[] = []

/**
 * The days of a per-day / per-session event.
 *
 * ⚠ `keepPreviousData` is a global query default (lib/query.tsx) and these screens are
 * not remounted between events, so the raw query can still hold the PREVIOUS event's
 * rows, even while disabled. Those are never this event's: taking them made EventForm
 * delete the sessions of the event edited before, and sent an answer to another
 * event's day.
 *
 * `isLoading` is true only while this event's rows are really on their way, so a screen
 * can wait instead of taking "no sessions yet" for a whole-event activity. `rows` stays
 * undefined until then.
 */
export function useEventSessions(eventId: string | undefined, enabled: boolean) {
  const on = enabled && !!eventId
  const query = useCollection<EventSession>('event_sessions', {
    filter: eventId ? { event: { _eq: eventId } } : { id: { _eq: -1 } },
    sort: ['sort_order', 'date', 'start_time'],
    limit: 100,
    enabled: on,
  })
  const rows = query.isPlaceholderData ? undefined : query.data
  return {
    sessions: rows ?? NO_SESSIONS,
    rows,
    isLoading: on && !query.isError && rows === undefined,
  }
}
