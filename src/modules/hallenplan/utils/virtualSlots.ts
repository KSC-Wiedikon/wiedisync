import type { Game, Training, HallEvent, HallSlot, HallClosure, Hall, Team, SlotClaim } from '../../../types'
import { toISODate, timeToMinutes, minutesToTime } from '../../../utils/dateHelpers'
import { allGameHallIds } from '../../../utils/gameHalls'

/** Hall events matching this pattern are treated as closures */
export const CLOSURE_PATTERN = /geschlossen|gesperrt|closed/i

/** Hall events matching this pattern are basketball games */
export const BB_GAME_PATTERN = /^BB\s/i

/** Games occupy the hall from 45min before start, game itself lasts ~2h → 2h45m total */
const GAME_WARMUP_MINUTES = 45
const GAME_TOTAL_DURATION = 165

/** A recurring training template is only presented as "available/frei" within
 *  this many weeks of today — matching the backend training-generation horizon
 *  (INDEFINITE_HORIZON_WEEKS in kscw-hooks/src/slot-cascade.js). Beyond it, a
 *  surviving template means "the concrete training just hasn't been generated
 *  yet", NOT "the slot is free", so it must render as an occupied (planned)
 *  training rather than a grabbable green slot — otherwise coaches could claim
 *  a slot that will become a real training. */
export const FREED_HORIZON_WEEKS = 12

/**
 * Converts a home/away game into virtual HallSlot(s) for the Hallenplan.
 * Home games → placed on game.hall (BB games span both KWI A+B)
 * Away games → skipped (but handled separately for freed slots)
 * Returns an array because BB games may produce 2 slots (one per hall).
 */
export function gameToVirtualSlots(
  game: Game,
  weekDays: Date[],
  halls: Hall[],
  teams: Team[],
): HallSlot[] {
  const gameDate = game.date.slice(0, 10)
  const dayIndex = weekDays.findIndex((d) => toISODate(d) === gameDate)
  if (dayIndex === -1) return []

  // Hallenplan is home-only — skip away games entirely
  if (game.type === 'away') return []

  const gameTime = game.time ? (game.time.includes(' ') ? game.time.split(' ')[1].slice(0, 5) : game.time.slice(0, 5)) : undefined
  if (!gameTime) return []

  const gameMinutes = timeToMinutes(gameTime)
  const startMinutes = Math.max(gameMinutes - GAME_WARMUP_MINUTES, 0)
  const endMinutes = Math.min(startMinutes + GAME_TOTAL_DURATION, 22 * 60)

  if (!game.hall) return []

  // Multi-hall games (e.g. basketball A+B) carry `additional_halls`.
  // Legacy basketball rows without the field fall back to the name-match span
  // inside allGameHallIds — see TODO there.
  const hallIds = allGameHallIds(game, { teams, halls })
  if (hallIds.length === 0) return []

  // Single slot on the first hall, with spanHallIds when spanning multiple
  return [{
    id: `game-${game.id}`,
    collectionId: '',
    collectionName: 'virtual',
    created: '',
    updated: '',
    hall: hallIds[0],
    team: [game.kscw_team],
    day_of_week: dayIndex,
    start_time: minutesToTime(startMinutes),
    end_time: minutesToTime(endMinutes),
    slot_type: 'game',
    recurring: false,
    indefinite: false,
    valid_from: gameDate,
    valid_until: gameDate,
    label: `${game.home_team} vs ${game.away_team}`,
    notes: game.league || '',
    _virtual: {
      source: 'game',
      sourceId: game.id,
      sourceRecord: game,
      ...(hallIds.length > 1 ? { spanHallIds: hallIds } : {}),
    },
  } as HallSlot]
}

/**
 * Converts a training record into a virtual HallSlot for the Hallenplan.
 */
export function trainingToVirtualSlot(
  training: Training,
  weekDays: Date[],
): HallSlot | null {
  const trainingDate = training.date.slice(0, 10)
  const dayIndex = weekDays.findIndex((d) => toISODate(d) === trainingDate)
  if (dayIndex === -1) return null
  // A hall-less training can't be placed on the Hallenplan (it has no column).
  // Emitting it anyway produced an invisible ghost slot that still counted as
  // "content" on its day and defeated the all-halls-closed collapse.
  if (!training.hall) return null
  if (!training.start_time || !training.end_time) return null

  return {
    id: `training-${training.id}`,
    collectionId: '',
    collectionName: 'virtual',
    created: '',
    updated: '',
    hall: training.hall,
    team: training.team ? [training.team] : [],
    day_of_week: dayIndex,
    start_time: training.start_time.slice(0, 5),
    end_time: training.end_time.slice(0, 5),
    slot_type: 'training',
    recurring: false,
    indefinite: false,
    valid_from: trainingDate,
    valid_until: trainingDate,
    label: training.cancelled
      ? `Abgesagt${training.cancel_reason ? ': ' + training.cancel_reason : ''}`
      : (training.auto_shortened_by_game != null
          ? 'Verkürzt (Heimspiel)'
          : (training.is_trial ? 'Probetraining' : '')),
    notes: training.notes || '',
    _virtual: {
      source: 'training',
      sourceId: training.id,
      sourceRecord: training,
      isCancelled: training.cancelled,
    },
  } as HallSlot
}

/** Resolves which hall IDs a GCal event belongs to by regex on
 *  title/location — the only source there is: hall_events carries no hall
 *  relation (migration 252 dropped the never-populated M2M). */
export function resolveHallEventHalls(event: HallEvent, halls: Hall[]): string[] {
  const HALLE_PATTERNS: [RegExp, string][] = [
    [/Halle\s*(KWI\s*)?A/i, 'KWI A'],
    [/Halle\s*(KWI\s*)?B/i, 'KWI B'],
    [/Halle\s*(KWI\s*)?C/i, 'KWI C'],
  ]
  const text = `${event.title} ${event.location || ''}`
  const matched: string[] = []
  for (const [pattern, hallName] of HALLE_PATTERNS) {
    if (pattern.test(text)) {
      const hall = halls.find((h) => h.name === hallName)
      if (hall) matched.push(hall.id)
    }
  }
  if (matched.length === 0) {
    return halls.filter((h) => h.name.startsWith('KWI')).map((h) => h.id)
  }
  return matched
}

/**
 * Converts a GCal hall event into a virtual HallSlot.
 * When the event spans multiple halls, a single slot is created on the first hall
 * with spanHallIds set for visual spanning in the grid.
 */
export function hallEventToVirtualSlots(
  event: HallEvent,
  weekDays: Date[],
  halls: Hall[],
): HallSlot[] {
  const eventDate = event.date.slice(0, 10)
  const dayIndex = weekDays.findIndex((d) => toISODate(d) === eventDate)
  if (dayIndex === -1) return []

  const hallIds = resolveHallEventHalls(event, halls)
  if (hallIds.length === 0) return []

  const isBBGame = BB_GAME_PATTERN.test(event.title)
  const isClosure = CLOSURE_PATTERN.test(event.title)

  // Closures are treated as full-day regardless of actual event times
  // BB games get warmup padding like regular games
  const rawStart = isClosure || event.all_day || !event.start_time ? '10:00' : event.start_time.slice(0, 5)
  const rawEnd = isClosure || event.all_day || !event.end_time ? '22:00' : event.end_time.slice(0, 5)
  const startTime = isBBGame
    ? minutesToTime(Math.max(timeToMinutes(rawStart) - GAME_WARMUP_MINUTES, 0))
    : rawStart
  const endTime = rawEnd

  // Single slot on first hall, spanning all halls visually
  return [{
    id: `hall-event-${event.id}`,
    collectionId: '',
    collectionName: 'virtual',
    created: '',
    updated: '',
    hall: hallIds[0],
    team: [],
    day_of_week: dayIndex,
    start_time: startTime,
    end_time: endTime,
    slot_type: isBBGame ? 'game' as const : 'event' as const,
    recurring: false,
    indefinite: false,
    valid_from: eventDate,
    valid_until: eventDate,
    label: event.title,
    notes: event.location || '',
    _virtual: {
      source: 'hall_event' as const,
      sourceId: event.id,
      sourceRecord: event,
      ...(hallIds.length > 1 ? { spanHallIds: hallIds } : {}),
    },
  } as HallSlot]
}

/**
 * Checks whether a date+hall overlaps with any hall closure.
 */
function isClosedOnDate(
  hallId: string,
  dateStr: string,
  closures: HallClosure[],
): boolean {
  return closures.some(
    (c) => c.hall === hallId && c.start_date <= dateStr && c.end_date >= dateStr,
  )
}

// Priority ladder for closure sources. Higher wins — when multiple closures
// cover the same (hall, date) we keep the highest-priority one and suppress
// the others so "Sportferien" eats a redundant "Halle geschlossen", and a
// school-holiday "Ferien" eats everything else.
const CLOSURE_SOURCE_PRIORITY: Record<HallClosure['source'], number> = {
  school_holidays: 5,
  admin: 4,
  hauswart: 3,
  gcal: 2,
  auto: 1,
}

/**
 * Dedupes closures by source priority per (hall, date). If a higher-priority
 * closure covers a given hall+date, any lower-priority closure overlapping
 * that same hall+date is dropped from the result. Non-overlapping closures
 * are preserved.
 */
export function dedupeClosuresByPriority(closures: HallClosure[]): HallClosure[] {
  if (closures.length < 2) return closures
  const prio = (c: HallClosure) => CLOSURE_SOURCE_PRIORITY[c.source] ?? 0
  return closures.filter((c) => {
    // Drop c only if another closure fully covers (hall + every date in c's span)
    // with strictly higher priority.
    for (const other of closures) {
      if (other === c || other.hall !== c.hall) continue
      if (prio(other) <= prio(c)) continue
      if (other.start_date <= c.start_date && other.end_date >= c.end_date) return false
    }
    return true
  })
}

/**
 * Annotates virtual slots with isFreed/isClaimed metadata based on
 * cancelled trainings and active claims.
 *
 * A cancelled training (with hall_slot set) → its virtual slot gets isFreed=true
 * unless an active claim exists for that date+hall_slot.
 */
export function annotateFreedSlots(
  virtualSlots: HallSlot[],
  claims: SlotClaim[],
  closures: HallClosure[],
): HallSlot[] {
  // Index active claims by hall_slot + date for fast lookup
  const claimsByKey = new Map<string, SlotClaim>()
  for (const claim of claims) {
    if (claim.status === 'active') {
      const dateStr = claim.date.slice(0, 10)
      claimsByKey.set(`${claim.hall_slot}-${dateStr}`, claim)
    }
  }

  // Index non-cancelled trainings by hall_slot + date — when a trial training
  // replaces a regular one, the original is cancelled (auto_cancelled_by_trial)
  // but the trial occupies the same slot. Without this guard, the slot would
  // render as "Available" green while a probetraining is actually scheduled.
  const replacementByKey = new Set<string>()
  for (const vs of virtualSlots) {
    if (vs._virtual?.source !== 'training') continue
    const training = vs._virtual.sourceRecord as Training
    if (training.cancelled || !training.hall_slot) continue
    const dateStr = training.date.slice(0, 10)
    replacementByKey.add(`${training.hall_slot}-${dateStr}`)
  }

  return virtualSlots.map((vs) => {
    const meta = vs._virtual
    if (!meta) return vs

    // Case 1: Cancelled training with hall_slot → freed
    if (meta.source === 'training' && meta.isCancelled) {
      const training = meta.sourceRecord as Training
      if (training.hall_slot) {
        const dateStr = training.date.slice(0, 10)
        if (isClosedOnDate(vs.hall, dateStr, closures)) return vs

        // A replacement training (typically a trial) covers this slot —
        // don't render the cancelled original as freed, the slot is taken.
        if (replacementByKey.has(`${training.hall_slot}-${dateStr}`)) return vs

        const claim = claimsByKey.get(`${training.hall_slot}-${dateStr}`)
        return {
          ...vs,
          _virtual: {
            ...meta,
            isFreed: !claim,
            isClaimed: !!claim,
            claimRecord: claim,
          },
        }
      }
    }

    return vs
  })
}

/** True when two [start, end) minute ranges overlap. */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart
}

/** True when two [start, end) HH:MM time ranges overlap. */
function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return rangesOverlap(timeToMinutes(aStart), timeToMinutes(aEnd), timeToMinutes(bStart), timeToMinutes(bEnd))
}

/** Extracts the HH:MM start time from a game row, tolerating both "HH:MM"
 *  and "YYYY-MM-DD HH:MM" storage formats. Returns undefined when absent. */
function parseGameTime(game: Game): string | undefined {
  return game.time ? (game.time.includes(' ') ? game.time.split(' ')[1].slice(0, 5) : game.time.slice(0, 5)) : undefined
}

/** Game occupies the hall from `warmup` before start for `GAME_TOTAL_DURATION`,
 *  clamped to a 22:00 close. Returns minutes-since-midnight bounds. */
function gameWarmupRange(gameTime: string): { startMin: number; endMin: number } {
  const startMin = Math.max(timeToMinutes(gameTime) - GAME_WARMUP_MINUTES, 0)
  const endMin = Math.min(startMin + GAME_TOTAL_DURATION, 22 * 60)
  return { startMin, endMin }
}

type HomeGameRange = { dayIndex: number; hall: string; startMin: number; endMin: number }
type ClosureRange = { dayIndex: number; hallIds: string[]; startMin: number; endMin: number }

/** Applies a game-like occupancy range to a single already-qualified recurring
 *  slot: shorten it if it merely precedes the warmup (keeping ≥15min), otherwise
 *  suppress it. Mutates the shared suppress/shorten collections. */
function suppressOrShortenForGame(
  slot: HallSlot,
  dayIndex: number,
  gameStartMin: number,
  gameEndMin: number,
  suppressedSlotDays: Set<string>,
  shortenedSlots: Map<string, string>,
): void {
  const slotStart = timeToMinutes(slot.start_time)
  const slotEnd = timeToMinutes(slot.end_time)
  if (!rangesOverlap(slotStart, slotEnd, gameStartMin, gameEndMin)) return

  const key = `${slot.id}-${dayIndex}`
  if (slotStart < gameStartMin) {
    // Slot starts before game warmup → shorten to end at warmup start
    const newEnd = gameStartMin
    if (newEnd > slotStart + 15) {
      // Keep at least 15 min of the slot; if multiple games affect it, use the earliest end
      const existing = shortenedSlots.get(key)
      if (!existing || timeToMinutes(existing) > newEnd) {
        shortenedSlots.set(key, minutesToTime(newEnd))
      }
    } else {
      suppressedSlotDays.add(key)
    }
  } else {
    // Slot starts during/after game warmup → suppress entirely
    suppressedSlotDays.add(key)
  }
}

/** Suppress recurring templates that have a concrete training instance for the
 *  same day — either linked explicitly via `hall_slot`, or (for unlinked
 *  trainings) any non-cancelled training overlapping the same hall/day. */
function collectTrainingSuppressions(
  virtualSlots: HallSlot[],
  realSlots: HallSlot[],
  suppressedSlotDays: Set<string>,
): void {
  // Training virtuals linked to a recurring hall_slot → suppress the template
  for (const vs of virtualSlots) {
    if (vs._virtual?.source === 'training') {
      const training = vs._virtual.sourceRecord as Training
      if (training.hall_slot) {
        suppressedSlotDays.add(`${training.hall_slot}-${vs.day_of_week}`)
      }
    }
  }

  // Also suppress recurring templates when a concrete (non-cancelled) training
  // overlaps in the same hall/day, even if the training is not linked via hall_slot.
  for (const vs of virtualSlots) {
    if (vs._virtual?.source !== 'training') continue
    const training = vs._virtual.sourceRecord as Training
    if (training.cancelled) continue
    for (const slot of realSlots) {
      if (
        !slot.recurring ||
        slot.slot_type !== 'training' ||
        slot.day_of_week !== vs.day_of_week ||
        slot.hall !== vs.hall
      ) continue
      if (timeRangesOverlap(slot.start_time, slot.end_time, vs.start_time, vs.end_time)) {
        suppressedSlotDays.add(`${slot.id}-${slot.day_of_week}`)
      }
    }
  }
}

/** Suppress/shorten recurring templates based on games:
 *  - Away games → free up the team's training slot (later shown as "FREI")
 *  - Home games → shorten the preceding slot or suppress overlapping slots. */
function collectGameSuppressions(
  games: Game[],
  realSlots: HallSlot[],
  weekDays: Date[],
  halls: Hall[],
  teams: Team[],
  suppressedSlotDays: Set<string>,
  shortenedSlots: Map<string, string>,
): void {
  for (const game of games) {
    if (game.status === 'postponed') continue
    const gameDate = game.date.slice(0, 10)
    const dayIndex = weekDays.findIndex((d) => toISODate(d) === gameDate)
    if (dayIndex === -1) continue

    if (game.type === 'away') {
      // Away game → suppress team's recurring training slot (will show as freed)
      for (const slot of realSlots) {
        if (
          slot.recurring &&
          slot.slot_type === 'training' &&
          slot.team?.includes(game.kscw_team) &&
          slot.day_of_week === dayIndex
        ) {
          suppressedSlotDays.add(`${slot.id}-${dayIndex}`)
        }
      }
    } else {
      // Home game → shorten preceding slot or suppress overlapping slots.
      // BB games span KWI A + KWI B (via allGameHallIds).
      const gameTime = parseGameTime(game)
      if (!gameTime) continue
      const { startMin: gameStartMin, endMin: gameEndMin } = gameWarmupRange(gameTime)
      const gameHallIds = allGameHallIds(game, { teams, halls })

      for (const slot of realSlots) {
        if (
          !slot.recurring ||
          !gameHallIds.includes(slot.hall) ||
          slot.day_of_week !== dayIndex
        ) continue
        suppressOrShortenForGame(slot, dayIndex, gameStartMin, gameEndMin, suppressedSlotDays, shortenedSlots)
      }
    }
  }
}

/** Suppress recurring slots overlapping closure-like hall events. */
function collectClosureEventSuppressions(
  virtualSlots: HallSlot[],
  realSlots: HallSlot[],
  suppressedSlotDays: Set<string>,
): void {
  for (const vs of virtualSlots) {
    if (vs._virtual?.source !== 'hall_event') continue
    const he = vs._virtual.sourceRecord as HallEvent
    if (!CLOSURE_PATTERN.test(he.title)) continue

    const closureHallIds = [vs.hall]
    const closureStart = timeToMinutes(vs.start_time)
    const closureEnd = timeToMinutes(vs.end_time)

    for (const slot of realSlots) {
      if (!slot.recurring || slot.day_of_week !== vs.day_of_week) continue
      if (!closureHallIds.includes(slot.hall)) continue
      if (rangesOverlap(timeToMinutes(slot.start_time), timeToMinutes(slot.end_time), closureStart, closureEnd)) {
        suppressedSlotDays.add(`${slot.id}-${vs.day_of_week}`)
      }
    }
  }
}

/** Suppress/shorten recurring slots overlapping BB game hall events. */
function collectBBGameEventSuppressions(
  virtualSlots: HallSlot[],
  realSlots: HallSlot[],
  suppressedSlotDays: Set<string>,
  shortenedSlots: Map<string, string>,
): void {
  for (const vs of virtualSlots) {
    if (vs._virtual?.source !== 'hall_event' || vs.slot_type !== 'game') continue
    const bbHallIds = vs._virtual.spanHallIds ?? [vs.hall]
    const bbStartMin = timeToMinutes(vs.start_time)
    const bbEndMin = timeToMinutes(vs.end_time)

    for (const slot of realSlots) {
      if (!slot.recurring || slot.day_of_week !== vs.day_of_week) continue
      if (!bbHallIds.includes(slot.hall)) continue
      suppressOrShortenForGame(slot, vs.day_of_week, bbStartMin, bbEndMin, suppressedSlotDays, shortenedSlots)
    }
  }
}

/** Suppress recurring slots on days when their hall has a hall_closures record. */
function collectHallClosureSuppressions(
  realSlots: HallSlot[],
  weekDays: Date[],
  closures: HallClosure[],
  suppressedSlotDays: Set<string>,
): void {
  for (const slot of realSlots) {
    if (!slot.recurring) continue
    for (let dayIdx = 0; dayIdx < weekDays.length; dayIdx++) {
      if (slot.day_of_week !== dayIdx) continue
      const dateStr = toISODate(weekDays[dayIdx])
      if (isClosedOnDate(slot.hall, dateStr, closures)) {
        suppressedSlotDays.add(`${slot.id}-${dayIdx}`)
      }
    }
  }
}

/** Drops suppressed recurring slots and applies end-time shortening to the rest.
 *  Non-recurring slots always pass through untouched. */
function applySuppressionsAndShortening(
  realSlots: HallSlot[],
  suppressedSlotDays: Set<string>,
  shortenedSlots: Map<string, string>,
): HallSlot[] {
  return realSlots
    .filter((slot) => {
      if (!slot.recurring) return true
      const key = `${slot.id}-${slot.day_of_week}`
      return !suppressedSlotDays.has(key)
    })
    .map((slot) => {
      if (!slot.recurring) return slot
      const key = `${slot.id}-${slot.day_of_week}`
      const newEnd = shortenedSlots.get(key)
      if (newEnd) return { ...slot, end_time: newEnd }
      return slot
    })
}

/** Indexes active claims by `${hall_slot}-${date}` for fast lookup. */
function indexActiveClaims(claims: SlotClaim[]): Map<string, SlotClaim> {
  const claimsByKey = new Map<string, SlotClaim>()
  for (const claim of claims) {
    if (claim.status === 'active') {
      claimsByKey.set(`${claim.hall_slot}-${claim.date.slice(0, 10)}`, claim)
    }
  }
  return claimsByKey
}

/** For each away game, surface the team's recurring training slot as a freed
 *  virtual slot (the away game itself is never rendered). */
function buildFreedFromAwaySlots(
  games: Game[],
  realSlots: HallSlot[],
  weekDays: Date[],
  closures: HallClosure[],
  claimsByKey: Map<string, SlotClaim>,
): HallSlot[] {
  const freedFromAway: HallSlot[] = []
  for (const game of games) {
    if (game.type !== 'away' || game.status === 'postponed') continue
    const gameDate = game.date.slice(0, 10)
    const dayIndex = weekDays.findIndex((d) => toISODate(d) === gameDate)
    if (dayIndex === -1) continue

    for (const slot of realSlots) {
      if (
        slot.recurring &&
        slot.slot_type === 'training' &&
        slot.team?.includes(game.kscw_team) &&
        slot.day_of_week === dayIndex
      ) {
        if (isClosedOnDate(slot.hall, gameDate, closures)) continue

        const claim = claimsByKey.get(`${slot.id}-${gameDate}`)

        freedFromAway.push({
          ...slot,
          id: `freed-away-${game.id}-${slot.id}`,
          collectionName: 'virtual',
          _virtual: {
            source: 'game',
            sourceId: game.id,
            sourceRecord: game,
            isFreed: !claim,
            isClaimed: !!claim,
            claimRecord: claim,
          },
        } as HallSlot)
      }
    }
  }
  return freedFromAway
}

/** Builds the per-(day, hall) home-game occupancy ranges used to suppress
 *  virtual trainings — from both home game rows and BB game hall events. */
function buildHomeGameRanges(
  games: Game[],
  virtualSlots: HallSlot[],
  weekDays: Date[],
  halls: Hall[],
  teams: Team[],
): HomeGameRange[] {
  const homeGameRanges: HomeGameRange[] = []
  for (const game of games) {
    if (game.type === 'away' || game.status === 'postponed') continue
    const gameDate = game.date.slice(0, 10)
    const dayIndex = weekDays.findIndex((d) => toISODate(d) === gameDate)
    if (dayIndex === -1) continue
    const gameTime = parseGameTime(game)
    if (!gameTime || !game.hall) continue
    const { startMin: gStart, endMin: gEnd } = gameWarmupRange(gameTime)

    const gameHallIds = allGameHallIds(game, { teams, halls })

    for (const hid of gameHallIds) {
      homeGameRanges.push({ dayIndex, hall: hid, startMin: gStart, endMin: gEnd })
    }
  }

  // Add BB game hall events so they also suppress virtual trainings
  for (const vs of virtualSlots) {
    if (vs._virtual?.source !== 'hall_event' || vs.slot_type !== 'game') continue
    const bbHallIds = vs._virtual.spanHallIds ?? [vs.hall]
    const bbStart = timeToMinutes(vs.start_time)
    const bbEnd = timeToMinutes(vs.end_time)
    for (const hid of bbHallIds) {
      homeGameRanges.push({ dayIndex: vs.day_of_week, hall: hid, startMin: bbStart, endMin: bbEnd })
    }
  }
  return homeGameRanges
}

/** Builds closure occupancy ranges from closure-like hall events. */
function buildClosureRanges(virtualSlots: HallSlot[]): ClosureRange[] {
  const closureRanges: ClosureRange[] = []
  for (const vs of virtualSlots) {
    if (vs._virtual?.source !== 'hall_event') continue
    const he = vs._virtual.sourceRecord as HallEvent
    if (!CLOSURE_PATTERN.test(he.title)) continue
    const closureHallIds = [vs.hall]
    closureRanges.push({
      dayIndex: vs.day_of_week,
      hallIds: closureHallIds,
      startMin: timeToMinutes(vs.start_time),
      endMin: timeToMinutes(vs.end_time),
    })
  }
  return closureRanges
}

/** Removes annotated virtual slots that are redundant or overlap with closures/games:
 *  - GCal "Halle geschlossen" events already covered by a hall_closures record
 *  - virtual trainings overlapping a home game, closure event, or hall_closures record. */
function filterAnnotatedSlots(
  annotated: HallSlot[],
  weekDays: Date[],
  closures: HallClosure[],
  homeGameRanges: HomeGameRange[],
  closureRanges: ClosureRange[],
): HallSlot[] {
  return annotated.filter((vs) => {
    const dateStr = toISODate(weekDays[vs.day_of_week])

    // Suppress GCal "Halle geschlossen" events when a hall_closures record covers the same hall+date
    if (vs._virtual?.source === 'hall_event') {
      const he = vs._virtual.sourceRecord as HallEvent
      if (CLOSURE_PATTERN.test(he.title)) {
        const hallIds = vs._virtual.spanHallIds ?? [vs.hall]
        if (hallIds.every((hid) => isClosedOnDate(hid, dateStr, closures))) return false
      }
    }

    // Remove virtual trainings that overlap with a home game, closure event, or hall_closures record
    if (vs._virtual?.source === 'training') {
      if (dateStr && isClosedOnDate(vs.hall, dateStr, closures)) return false
      const vsStart = timeToMinutes(vs.start_time)
      const vsEnd = timeToMinutes(vs.end_time)
      if (homeGameRanges.some(
        (g) => g.dayIndex === vs.day_of_week && g.hall === vs.hall && vsStart < g.endMin && vsEnd > g.startMin,
      )) return false
      if (closureRanges.some(
        (c) => c.dayIndex === vs.day_of_week && c.hallIds.includes(vs.hall) && vsStart < c.endMin && vsEnd > c.startMin,
      )) return false
    }

    return true
  })
}

/** Any recurring training template that survives suppression has no concrete
 *  training/home-game replacement for that day → present it as available.
 *  Returns the freed virtual slots plus the set of `${id}-${day}` keys they
 *  cover (so the originals can be dropped from the real-slot list). */
function buildFreedRecurringSlots(
  filteredReal: HallSlot[],
  weekDays: Date[],
  closures: HallClosure[],
  claimsByKey: Map<string, SlotClaim>,
  freedHorizonDate?: string,
): { freedRecurringSlots: HallSlot[]; recurringFreedKeys: Set<string> } {
  const freedRecurringSlots: HallSlot[] = []
  const recurringFreedKeys = new Set<string>()
  for (const slot of filteredReal) {
    if (!slot.recurring || slot.slot_type !== 'training') continue
    // Slots with a label but no team are external bookings — show as occupied, not available
    if (slot.label && !slot.team?.length) continue
    const dayIdx = slot.day_of_week
    const dateStr = weekDays[dayIdx] ? toISODate(weekDays[dayIdx]) : ''
    if (!dateStr) continue
    // Beyond the training-generation horizon a surviving template means the
    // concrete training simply hasn't been generated yet — leave it as an
    // occupied (planned) training instead of a claimable "Frei" slot.
    if (freedHorizonDate && dateStr > freedHorizonDate) continue
    if (isClosedOnDate(slot.hall, dateStr, closures)) continue
    const claim = claimsByKey.get(`${slot.id}-${dateStr}`)
    recurringFreedKeys.add(`${slot.id}-${dayIdx}`)
    freedRecurringSlots.push({
      ...slot,
      id: `freed-recurring-${slot.id}-${dayIdx}`,
      collectionName: 'virtual',
      _virtual: {
        source: 'training',
        sourceId: slot.id,
        sourceRecord: {} as Training,
        isFreed: !claim,
        isClaimed: !!claim,
        claimRecord: claim,
        isTemplateFreed: true,
      },
    } as HallSlot)
  }
  return { freedRecurringSlots, recurringFreedKeys }
}

/**
 * Merges real hall_slots with virtual slots, deduplicating recurring slots
 * that have a corresponding training instance for the same day.
 * Also checks for away games that free up recurring training slots without
 * an explicit training record.
 */
export function mergeVirtualSlots(
  realSlots: HallSlot[],
  virtualSlots: HallSlot[],
  claims: SlotClaim[],
  closures: HallClosure[],
  games: Game[],
  weekDays: Date[],
  halls: Hall[],
  teams: Team[],
  freedHorizonDate?: string,
): HallSlot[] {
  // Phase 1 — collect which recurring templates to suppress or shorten this week.
  const suppressedSlotDays = new Set<string>()
  const shortenedSlots = new Map<string, string>() // key: `${slot.id}-${dayIndex}`, value: new end_time
  collectTrainingSuppressions(virtualSlots, realSlots, suppressedSlotDays)
  collectGameSuppressions(games, realSlots, weekDays, halls, teams, suppressedSlotDays, shortenedSlots)
  collectClosureEventSuppressions(virtualSlots, realSlots, suppressedSlotDays)
  collectBBGameEventSuppressions(virtualSlots, realSlots, suppressedSlotDays, shortenedSlots)
  collectHallClosureSuppressions(realSlots, weekDays, closures, suppressedSlotDays)

  const filteredReal = applySuppressionsAndShortening(realSlots, suppressedSlotDays, shortenedSlots)

  // Phase 2 — build the derived virtual slot sets.
  const claimsByKey = indexActiveClaims(claims)
  const freedFromAway = buildFreedFromAwaySlots(games, realSlots, weekDays, closures, claimsByKey)

  const annotated = annotateFreedSlots(virtualSlots, claims, closures)
  const homeGameRanges = buildHomeGameRanges(games, virtualSlots, weekDays, halls, teams)
  const closureRanges = buildClosureRanges(virtualSlots)
  const filteredAnnotated = filterAnnotatedSlots(annotated, weekDays, closures, homeGameRanges, closureRanges)

  const { freedRecurringSlots, recurringFreedKeys } = buildFreedRecurringSlots(filteredReal, weekDays, closures, claimsByKey, freedHorizonDate)
  const filteredRealWithoutFreed = filteredReal.filter((slot) => !recurringFreedKeys.has(`${slot.id}-${slot.day_of_week}`))

  return [...filteredRealWithoutFreed, ...filteredAnnotated, ...freedFromAway, ...freedRecurringSlots]
}
