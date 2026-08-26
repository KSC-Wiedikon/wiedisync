import type { Game, Training, Event, HallClosure, HallEvent, Absence } from './index'

/** Synthetic source for birthday entries — they have no backing collection row
 *  (they're derived from `members.birthdate`), but every `CalendarEntry.source`
 *  needs an `id` for the iCal UID and for generic handling. */
export interface BirthdaySource {
  id: string
  member_id: string
  /** Age the member turns on this occurrence. */
  age: number
  birthday: true
}

/** Unified calendar entry for rendering and iCal export */
export interface CalendarEntry {
  id: string
  type: 'game' | 'training' | 'event' | 'closure' | 'hall' | 'absence' | 'scorer-duty' | 'birthday'
  title: string
  date: Date
  /** End date for multi-day entries (closures, multi-day events). Undefined = single-day. */
  endDate?: Date
  startTime: string | null
  endTime: string | null
  allDay: boolean
  location: string
  teamNames: string[]
  description: string
  source: Game | Training | Event | HallClosure | HallEvent | Absence | BirthdaySource
  /**
   * The underlying activity was called off — a cancelled training (including
   * the automatic game-day cancel, migration 261), a cancelled event, or a game
   * with `status = 'cancelled'`. Cancelled entries stay ON the calendar by
   * design (a member needs to see that the slot is dead, not just find it
   * missing), so every view MUST render them struck through — see
   * `cancelledClasses()`. Absent the flag they are indistinguishable from live
   * entries, which is exactly the bug this field exists to prevent.
   */
  cancelled?: boolean
  /** Only set for game entries */
  gameType?: 'home' | 'away'
  /** Opponent team name — set for game entries (the non-KSCW side). */
  opponent?: string
  /** Sport type — set for game entries to show correct ball icon */
  sport?: 'volleyball' | 'basketball'
  /**
   * Only set for event entries — the `events.event_type` behind the row.
   *
   * An event's title is free text, so nothing in it says what KIND of thing it
   * is: a friendly titled "VBC Limmattal - D4" reads exactly like a league
   * fixture, and the generic event icon does not disambiguate it. Views that
   * show an event as a single line of text (the home ticker, the appointments
   * list) render the translated type alongside the title — the cards and modals
   * already carry it as a `StatusBadge`. Translate via `calendar:eventType*`.
   */
  eventType?: Event['event_type']
  /**
   * Optional MonthGrid palette-key override (e.g. 'blue'). Recolours the entry
   * without changing its `type` — the icon shape still follows `type`. Used to
   * tint events blue on the team absence calendar.
   */
  colorOverride?: string
}

export type ViewMode = 'calendar' | 'week' | 'list-date' | 'list-team'
export type CalendarViewMode = 'hallenplan' | 'month' | 'week' | 'schedule'

export type SportFilter = 'volleyball' | 'basketball' | 'all'
export type GameTypeFilter = 'home' | 'away' | 'all'
export type SourceFilter = 'game-home' | 'game-away' | 'training' | 'event' | 'closure' | 'hall' | 'absence' | 'scorer-duty' | 'birthday'

export interface SpielplanungFilterState {
  sport: SportFilter
  selectedTeamIds: string[]
  gameType: GameTypeFilter
  showAbsences: boolean
  /** Overlay days a roster-sharing team plays (those block home slots). Scoped to
   *  the selected team(s); needs at least one team picked. */
  showCrossTeam: boolean
}

export interface CalendarFilterState {
  sources: SourceFilter[]
  selectedTeamIds: string[]
  /**
   * Show unavailabilities (weekly) + non-blocking absences. Default (undefined/false)
   * hides them — they clutter the calendar without affecting the rest of the team.
   */
  showHiddenAbsences?: boolean
}
