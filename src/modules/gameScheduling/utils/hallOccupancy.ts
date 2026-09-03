/**
 * Hall occupancy maths for the Basketball prep view.
 *
 * Pure — no React, no network — so every rule below is unit-testable and shared by
 * the on-screen slot grid (`useBasketballPlan`) and the ProBasket availability
 * workbook (`basketballAvailabilityExport`). The two used to disagree, which is how
 * a fully-booked volleyball Saturday could silently blank a whole date card.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 * `game_scheduling_slots` is the VOLLEYBALL booking table. A booked row holds one KWI
 * court for a concrete window (start_time … end_time). The first version of the prep
 * view threw the time away and marked the hall busy for the entire day, so
 * Sat 07.11.2026 — volleyball in KWI A, B and C at 13:30 — rendered as an empty card
 * even though every court is free from 18:30. Basketball routinely plays after a
 * volleyball afternoon; the block has to be time-aware.
 */

import { HALL_A, HALL_B, HALL_C, HALL_AB, slotEndTime, slotsForDate } from './probasketSeason'

// ── Durations ────────────────────────────────────────────────────────────────

/**
 * How long a basketball game holds the court, in minutes. 4×10' running time plus
 * breaks, timeouts and the post-game handshake lands at ~2h in ProBasket practice,
 * and the fixed KWI weekend grid (11:00 / 13:30 / 16:00 / 18:30) is built on 2h30
 * pitches, so 120 min is both realistic and never wider than one grid pitch.
 * Same figure `slotEndTime()` uses for the export's "Zeit bis".
 */
export const BB_GAME_MINUTES = 120

/**
 * Fallback length of a volleyball booking whose `end_time` is missing. Prod has an
 * end_time on all 80 booked rows today, but the column is nullable, so a null must
 * degrade to "a normal match", never to "zero minutes".
 */
export const VB_DEFAULT_MINUTES = 120

/**
 * Dead time reserved either side of a volleyball booking, in minutes.
 *
 * A court is not handed over at the final whistle: the outgoing sport warms up
 * beforehand and has to strike the net, poles and scorer's table afterwards, and the
 * incoming sport needs the floor swept and the baskets lowered. 30 minutes is the
 * changeover the KWI hall plan already assumes between two events in the same hall,
 * and it makes the arithmetic land exactly on the fixed grid: a 13:30–15:30
 * volleyball match occupies 13:00–16:00, which blocks the 13:30 basketball pitch and
 * leaves the 11:00 and 16:00 pitches untouched.
 */
export const VB_CHANGEOVER_MINUTES = 30

// ── Time helpers ─────────────────────────────────────────────────────────────

/** 'HH:MM' or 'HH:MM:SS' → minutes since midnight. Returns null for anything else. */
export function minutesOfDay(hhmm: string | null | undefined): number | null {
  const m = String(hhmm ?? '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** Half-open interval overlap: touching at a boundary is NOT an overlap. */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

// ── Hall identity ────────────────────────────────────────────────────────────

/**
 * Do two hall names fight over the same floor?
 *
 * 'KWI A+B' is the combined big court — the same physical space as KWI A plus KWI B
 * with the divider open. So an A+B booking blocks A and B, and an A (or B) booking
 * blocks A+B. KWI C is a separate hall and never collides with either.
 */
export function hallsCollide(a: string, b: string): boolean {
  if (a === b) return true
  const isHalf = (h: string) => h === HALL_A || h === HALL_B
  if (a === HALL_AB && isHalf(b)) return true
  if (b === HALL_AB && isHalf(a)) return true
  return false
}

// ── Volleyball occupancy ─────────────────────────────────────────────────────

/** One booked volleyball slot, already resolved to a hall NAME. */
export interface VbBooking {
  hall: string
  /** 'HH:MM(:SS)'. **null/blank blocks the whole day** — never treat it as "free". */
  start: string | null
  /** 'HH:MM(:SS)'. Missing → `start` + `VB_DEFAULT_MINUTES`. */
  end?: string | null
}

/** The minute window a volleyball booking takes a court out of service, changeover included. */
export function vbBusyWindow(booking: VbBooking): { start: number; end: number } | null {
  const start = minutesOfDay(booking.start)
  if (start == null) return null // caller must treat this as an all-day block
  const rawEnd = minutesOfDay(booking.end)
  // An end at or before the start is corrupt (or crosses midnight) — fall back to a
  // normal match length rather than producing a zero-width, blocking-nothing window.
  const end = rawEnd != null && rawEnd > start ? rawEnd : start + VB_DEFAULT_MINUTES
  return { start: start - VB_CHANGEOVER_MINUTES, end: end + VB_CHANGEOVER_MINUTES }
}

/**
 * Is `hall` unusable for a basketball game starting at `bbStart` on this date?
 *
 * @param bookings every booked volleyball slot on that date (any hall).
 * @param hall     the KWI court the basketball game would use.
 * @param bbStart  'HH:MM' tip-off. The game runs `BB_GAME_MINUTES`.
 */
export function vbBlocksSlot(bookings: readonly VbBooking[], hall: string, bbStart: string): boolean {
  const gameStart = minutesOfDay(bbStart)
  if (gameStart == null) return false
  const gameEnd = gameStart + BB_GAME_MINUTES
  for (const b of bookings) {
    if (!hallsCollide(b.hall, hall)) continue
    const win = vbBusyWindow(b)
    // No parsable start time → we cannot know when the court is free, so the
    // conservative reading is "busy all day". Never silently frees the hall.
    if (!win) return true
    if (intervalsOverlap(win.start, win.end, gameStart, gameEnd)) return true
  }
  return false
}

// ── Basketball occupancy (the other direction) ───────────────────────────────

/**
 * The physical KWI floors a hall name occupies. Mirrors `bb_hall_floors()` (migration
 * 295) and its SQL sibling `vb_slot_floors()` (migration 346).
 *
 * A hall outside KWI claims NO floor and therefore never collides — Döltschi, Rebhügel
 * and the rest are not our floor to protect. That is why the volleyball direction below
 * intersects floors instead of calling `hallsCollide()`: the two agree on every KWI
 * name, but `hallsCollide('Rebhügel', 'Rebhügel')` is true, and a stray basketball row
 * naming a hall we do not map must not delete a volleyball slot there.
 */
export function hallFloors(hall: string): readonly string[] {
  switch (hall) {
    case HALL_A: return ['A']
    case HALL_B: return ['B']
    case HALL_AB: return ['A', 'B']
    case HALL_C: return ['C']
    default: return []
  }
}

/** A basketball game placed on a KWI court (`basketball_slot_plan`). */
export interface BbPlacement {
  /** 'KWI A' | 'KWI B' | 'KWI C' | 'KWI A+B'. Anything else claims no floor. */
  hall: string
  /** 'HH:MM' tip-off. The game runs `BB_GAME_MINUTES`. */
  time: string | null
}

/**
 * Is a volleyball slot standing on a court basketball has already taken?
 *
 * The exact mirror of `vbBlocksSlot()` — same windows, same arithmetic, arguments
 * swapped — so the two sports can never disagree about who owns the floor. The backend
 * computes the same predicate in SQL (`bb_vb_time_overlap`, migration 346); this copy
 * exists so the planner's calendar can count open slots without a round trip.
 *
 * ⚠ Every placement blocks, DRAFT included (migration 295: a draft occupies the
 * physical court exactly as much as a confirmed game). What keeps that from being
 * invisible is the "Home game (BB)" chip on the same calendar, which names the court.
 */
export function bbBlocksVbSlot(placements: readonly BbPlacement[], slot: VbBooking): boolean {
  const floors = hallFloors(slot.hall)
  if (floors.length === 0) return false // not a KWI court — basketball never claims it
  const win = vbBusyWindow(slot)
  for (const p of placements) {
    if (!hallFloors(p.hall).some((f) => floors.includes(f))) continue
    // An unknown window on either side must fail SAFE (busy), never silently free
    // the court — same contract as vbBlocksSlot().
    if (!win) return true
    const tip = minutesOfDay(p.time)
    if (tip == null) return true
    if (intervalsOverlap(win.start, win.end, tip, tip + BB_GAME_MINUTES)) return true
  }
  return false
}

/**
 * A basketball game that already exists as a `games` row, resolved to a KWI hall name.
 *
 * ⚠ NOT a `basketball_slot_plan` placement. Home basketball games reach the database by
 * two roads — the planner's grid writes a placement, the Spielplanung editor and
 * bp-sync write a `games` row — and until 03.09.2026 only the first road took the court
 * away from anybody. The backend mirror of this is migration 351 (`bb_floor_claims_all`).
 */
export interface BbGame extends BbPlacement {
  /** "Herren 1 vs BC Winterthur 2" — so the blocked cell can name what holds it. */
  label?: string
}

/**
 * The basketball game holding `hall` over the pitch starting at `bbStart`, or null.
 *
 * Two basketball games need no changeover between them (same sport, same floor
 * markings), so this is a plain BB_GAME_MINUTES-vs-BB_GAME_MINUTES overlap: an 11:00
 * game takes the 11:00 pitch and leaves 13:30 alone, exactly as the fixed ProBasket
 * grid assumes.
 *
 * Returns the game rather than a boolean so the grid can say WHICH one — "taken" with
 * no name reads as a bug in the tool.
 */
export function bbGameBlocksPitch(
  games: readonly BbGame[],
  hall: string,
  bbStart: string,
): BbGame | null {
  const floors = hallFloors(hall)
  if (floors.length === 0) return null // not a KWI court — no basketball game claims it
  const pitch = minutesOfDay(bbStart)
  if (pitch == null) return null
  for (const g of games) {
    if (!hallFloors(g.hall).some((f) => floors.includes(f))) continue
    const tip = minutesOfDay(g.time)
    // An unknown tip-off must fail SAFE (holds the court all day) — the same contract
    // vbBusyWindow() and migration 346's bb_vb_time_overlap() keep on the other side.
    if (tip == null) return g
    if (intervalsOverlap(tip, tip + BB_GAME_MINUTES, pitch, pitch + BB_GAME_MINUTES)) return g
  }
  return null
}

// ── Per-date blockers ────────────────────────────────────────────────────────

/**
 * Everything that can take a KWI court away from basketball on a given date, in the
 * raw per-date shape both the slot grid and the export consume. Kept season-wide (not
 * limited to one league's candidate dates) so a workbook containing a junior team
 * (grid ends 13.12.2026) and a 1.-Liga team (grid ends 09.05.2027) resolves both.
 */
export interface HallBlockers {
  /** date → closed hall names; '*' means every hall that day. */
  closedHallsByDate: Map<string, Set<string>>
  /** Club-wide blackout days (superadmin "no home games at all"). */
  clubBlockedDates: Set<string>
  /** date → booked volleyball slots. */
  vbBusyByDate: Map<string, VbBooking[]>
  /**
   * date → basketball games that already exist as `games` rows (the Spielplanung
   * editor's manual home games + everything bp-sync scrapes out of Basketplan).
   *
   * Optional so every existing caller keeps compiling, but leaving it out means the
   * grid and the ProBasket export will offer a court a real fixture is standing on —
   * which is the bug this field was added for (03.09.2026).
   */
  bbGameBusyByDate?: Map<string, BbGame[]>
}

export const EMPTY_HALL_BLOCKERS: HallBlockers = {
  closedHallsByDate: new Map(),
  clubBlockedDates: new Set(),
  vbBusyByDate: new Map(),
  bbGameBusyByDate: new Map(),
}

/** Why a date (or a single hall on it) cannot host a basketball game. */
export type DateBlockReason = 'blackout' | 'club_block' | 'hall_closed' | 'volleyball' | 'basketball'

export type HallSlotStatus = 'unavailable' | 'vb' | 'bbgame' | 'free'

/**
 * Status of one (date, time, hall) pitch, ignoring basketball PLACEMENTS (the caller
 * resolves those — they are editable and win over every blocker).
 *
 * 'unavailable' — a ProBasket blackout, a club-wide block or a hall closure. Nothing
 *                 can be planned; the planner cannot change it from here.
 * 'vb'          — volleyball holds that court over the pitch window (changeover included).
 * 'bbgame'      — a basketball game that already exists in `games` holds it. Not
 *                 editable from the grid (it lives on the game calendar), but it is a
 *                 fixture, so the court is genuinely gone.
 * 'free'        — placeable.
 */
export function hallStatusAt(
  date: string,
  time: string,
  hall: string,
  blockers: HallBlockers,
  isBlackout: boolean,
): HallSlotStatus {
  if (isBlackout) return 'unavailable'
  if (blockers.clubBlockedDates.has(date)) return 'unavailable'
  const closed = blockers.closedHallsByDate.get(date)
  if (closed && (closed.has('*') || closed.has(hall))) return 'unavailable'
  // Basketball's own fixtures before volleyball's: when both hold one floor the plan is
  // already broken, and the one the planner can act on from here is the basketball one.
  if (bbGameBlocksPitch(blockers.bbGameBusyByDate?.get(date) ?? [], hall, time)) return 'bbgame'
  if (vbBlocksSlot(blockers.vbBusyByDate.get(date) ?? [], hall, time)) return 'vb'
  return 'free'
}

export interface DayHallAvailability {
  /** The weekday's ordered pitch times (empty on a non-play weekday). */
  times: string[]
  /** Per hall offered that weekday: the pitch times where it is free. */
  freeByHall: { hall: string; free: string[] }[]
  /** No hall is free at any pitch — the date is effectively unavailable. */
  noneFree: boolean
  /** Best explanation for `noneFree`, strongest cause first. */
  reason: DateBlockReason | null
}

/** Free pitches per hall for one candidate date, plus why the date is dead when it is. */
export function dayHallAvailability(
  date: string,
  dow: number,
  blockers: HallBlockers,
  isBlackout: boolean,
): DayHallAvailability {
  const { times, halls } = slotsForDate(dow)
  // Resolve every pitch once: `reason` below needs to know WHY a hall lost its times,
  // not merely that it did.
  const statusByHall = halls.map((hall) => ({
    hall,
    statuses: times.map((time) => hallStatusAt(date, time, hall, blockers, isBlackout)),
  }))
  const freeByHall = statusByHall.map(({ hall, statuses }) => ({
    hall,
    free: times.filter((_, i) => statuses[i] === 'free'),
  }))
  // A weekday basketball never plays offers no pitches at all — that is "not a
  // candidate date", not "blocked", so it must not claim a blocking reason.
  const noneFree = halls.length > 0 && times.length > 0 && freeByHall.every((h) => h.free.length === 0)
  let reason: DateBlockReason | null = null
  if (noneFree) {
    const closed = blockers.closedHallsByDate.get(date)
    reason = isBlackout
      ? 'blackout'
      : blockers.clubBlockedDates.has(date)
        ? 'club_block'
        : closed && halls.every((h) => closed.has('*') || closed.has(h))
          ? 'hall_closed'
          // Only when basketball alone did it — a day both sports hold keeps naming
          // volleyball, which is the side the planner has to negotiate with.
          : statusByHall.some((h) => h.statuses.includes('bbgame')) &&
              !statusByHall.some((h) => h.statuses.includes('vb'))
            ? 'basketball'
            : 'volleyball'
  }
  return { times, freeByHall, noneFree, reason }
}

// ── Free-window grouping (ProBasket export) ──────────────────────────────────

/**
 * Split `freeTimes` into MAXIMAL CONTIGUOUS runs against the day's ordered pitch list.
 *
 * The export used to write `from = free[0] … to = end(free[last])`, which declares the
 * blocked middle available: KWI B on Sat 12.12.2026 is free at 11:00, busy at 13:30 and
 * free again at 16:00/18:30 — one window would have offered ProBasket 11:00–20:30 and
 * booked us a game we cannot host.
 */
export function contiguousRuns(orderedTimes: readonly string[], freeTimes: Iterable<string>): string[][] {
  const free = new Set(freeTimes)
  const runs: string[][] = []
  let current: string[] = []
  for (const time of orderedTimes) {
    if (free.has(time)) {
      current.push(time)
    } else if (current.length) {
      runs.push(current)
      current = []
    }
  }
  if (current.length) runs.push(current)
  return runs
}

/** One "Zeit von / Zeit bis / Halle" triple in the ProBasket template. */
export interface AvailabilityWindow {
  hall: string
  /** 'HH:MM' — first free pitch of the run. */
  from: string
  /** 'HH:MM' — end of the last free pitch of the run. */
  to: string
  /** Number of pitches the run covers (used to rank when we must drop windows). */
  pitches: number
}

/** The template holds exactly three (Zeit von, Zeit bis, Halle) column groups. */
export const MAX_AVAILABILITY_WINDOWS = 3

/**
 * Every hall's free runs as template windows, capped at `max`.
 *
 * When more runs exist than the sheet can carry we keep the LONGEST ones (they give
 * ProBasket the most room) and then print them in chronological order so the row reads
 * left to right.
 */
export function availabilityWindows(
  orderedTimes: readonly string[],
  freeByHall: readonly { hall: string; free: readonly string[] }[],
  max: number = MAX_AVAILABILITY_WINDOWS,
): AvailabilityWindow[] {
  const all: AvailabilityWindow[] = []
  for (const { hall, free } of freeByHall) {
    for (const run of contiguousRuns(orderedTimes, free)) {
      all.push({ hall, from: run[0], to: slotEndTime(run[run.length - 1]), pitches: run.length })
    }
  }
  if (all.length <= max) return all.sort(byStartThenHall)
  return all
    .slice()
    .sort((a, b) => b.pitches - a.pitches || a.from.localeCompare(b.from) || a.hall.localeCompare(b.hall))
    .slice(0, max)
    .sort(byStartThenHall)
}

function byStartThenHall(a: AvailabilityWindow, b: AvailabilityWindow): number {
  return a.from.localeCompare(b.from) || a.hall.localeCompare(b.hall)
}
