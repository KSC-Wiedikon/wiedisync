import type { Game, Training, Event, HallClosure, HallEvent, Absence } from './index'

/** Unified calendar entry for rendering and iCal export */
export interface CalendarEntry {
  id: string
  type: 'game' | 'training' | 'event' | 'closure' | 'hall' | 'absence' | 'scorer-duty'
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
  source: Game | Training | Event | HallClosure | HallEvent | Absence
  /** Only set for game entries */
  gameType?: 'home' | 'away'
  /** Opponent team name — set for game entries (the non-KSCW side). */
  opponent?: string
  /** Sport type — set for game entries to show correct ball icon */
  sport?: 'volleyball' | 'basketball'
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
export type SourceFilter = 'game-home' | 'game-away' | 'training' | 'event' | 'closure' | 'hall' | 'absence' | 'scorer-duty'

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
