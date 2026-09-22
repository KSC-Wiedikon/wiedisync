import type { ExtraHall, Hall, HallSlot, Training } from '../types'
import { relId } from './relations'
import { timeToMinutes } from './dateHelpers'

/**
 * `hall_slots.extra_halls` / `trainings.extra_halls` (migration 370): the
 * additional halls a slot also occupies, each with an optional narrower
 * window. `hall` stays the primary hall everywhere.
 */

/** Normalise the stored json (array, JSON string, bare ids, null) to entries. */
export function parseExtraHalls(v: unknown): ExtraHall[] {
  let arr = v
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr) } catch { return [] }
  }
  if (!Array.isArray(arr)) return []
  const out: ExtraHall[] = []
  for (const e of arr) {
    if (e == null) continue
    if (typeof e === 'number' || typeof e === 'string') { out.push({ hall: String(e) }); continue }
    if (typeof e === 'object' && 'hall' in e && (e as ExtraHall).hall != null) {
      const x = e as ExtraHall
      out.push({ hall: String(x.hall), start_time: x.start_time || null, end_time: x.end_time || null })
    }
  }
  return out
}

/** The window an extra hall is used in, clamped to the (possibly shortened)
 *  slot range. Null when nothing of it is left. */
export function extraHallWindow(
  e: ExtraHall,
  slotStart: string,
  slotEnd: string,
): { start: string; end: string } | null {
  const s = e.start_time && timeToMinutes(e.start_time) > timeToMinutes(slotStart) ? e.start_time : slotStart
  const f = e.end_time && timeToMinutes(e.end_time) < timeToMinutes(slotEnd) ? e.end_time : slotEnd
  if (timeToMinutes(s) >= timeToMinutes(f)) return null
  return { start: s.slice(0, 5), end: f.slice(0, 5) }
}

function extraHallsOf(slot: HallSlot): ExtraHall[] {
  if (slot._virtual) {
    if (slot._virtual.source !== 'training') return []
    return parseExtraHalls((slot._virtual.sourceRecord as Training).extra_halls)
  }
  return parseExtraHalls(slot.extra_halls)
}

/**
 * Place a display copy of every slot (real template or training occurrence) in
 * each of its extra halls. Runs AFTER the virtual-slot merge, so each copy
 * inherits its primary's suppression / freed / cancelled state for the week.
 * Copies carry `_extraOf` so a click edits or opens the real slot.
 */
export function expandExtraHalls(slots: HallSlot[], selectedHallIds: string[] = []): HallSlot[] {
  const hallFilter = new Set(selectedHallIds)
  const copies: HallSlot[] = []
  for (const slot of slots) {
    for (const e of extraHallsOf(slot)) {
      const hall = relId(e.hall)
      if (!hall || hall === relId(slot.hall)) continue
      if (hallFilter.size > 0 && !hallFilter.has(hall)) continue
      const win = extraHallWindow(e, slot.start_time, slot.end_time)
      if (!win) continue
      copies.push({
        ...slot,
        id: `${slot.id}@${hall}`,
        hall,
        start_time: win.start,
        end_time: win.end,
        _extraOf: slot,
      })
    }
  }
  return copies.length === 0 ? slots : [...slots, ...copies]
}

/** "KWI A (from 18:30)" style descriptions of the extra halls, for display
 *  next to the primary hall name. `t` resolves the `common:extraHall*` keys. */
export function describeExtraHalls(
  extras: unknown,
  halls: Pick<Hall, 'id' | 'name'>[],
  t: (key: string, opts?: Record<string, string>) => string,
): string[] {
  return parseExtraHalls(extras).map((e) => {
    const name = halls.find((h) => relId(h.id) === relId(e.hall))?.name ?? `#${relId(e.hall)}`
    const s = e.start_time?.slice(0, 5)
    const f = e.end_time?.slice(0, 5)
    if (s && f) return t('common:extraHallWindow', { hall: name, start: s, end: f })
    if (s) return t('common:extraHallFrom', { hall: name, time: s })
    if (f) return t('common:extraHallUntil', { hall: name, time: f })
    return name
  })
}
