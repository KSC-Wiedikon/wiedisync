import type { Event } from '../../types'

/**
 * `events.event_type` → its i18n key in the `calendar` namespace.
 *
 * An event's title is free text, so it carries no signal about what kind of
 * thing it is. A friendly entered as "VBC Limmattal - D4" reads exactly like a
 * league fixture, and the generic purple event icon does not tell them apart —
 * which is what prompted this: a D4 friendly in the home ticker was indis-
 * tinguishable from a real game.
 *
 * Cards and modals already show the type as a `StatusBadge`. The single-line
 * surfaces (home ticker, "My next appointments") use this instead, so the three
 * cannot drift on what a type is called.
 *
 * ⚠ Every key here already exists in all five locales
 * (`src/i18n/locales/<lang>/calendar.ts`) — this is a re-use of
 * `CalendarEntryModal`'s former inline map, not a new string set. Add a locale
 * entry for any type added to the enum.
 */
const EVENT_TYPE_LABEL_KEYS: Record<Event['event_type'], string> = {
  verein: 'eventTypeVerein',
  social: 'eventTypeSocial',
  meeting: 'eventTypeMeeting',
  tournament: 'eventTypeTournament',
  trainingsweekend: 'eventTypeTrainingsweekend',
  friendly: 'eventTypeFriendly',
  other: 'eventTypeOther',
}

/**
 * The `calendar`-namespace key for an event type, or null when there is nothing
 * useful to say — an unset type, or a value the enum has outgrown.
 *
 * ⚠ Returns null rather than falling back to `eventTypeOther`: labelling an
 * unknown type "Other" asserts something the data never said. The caller renders
 * the title alone, which is what it did before this existed.
 */
export function eventTypeLabelKey(type: Event['event_type'] | null | undefined): string | null {
  if (!type) return null
  return EVENT_TYPE_LABEL_KEYS[type] ?? null
}
