/**
 * A synced game's hall: "Sync" (from Volleymanager / Basketplan) or "Overwrite"
 * (set in the app) — migration 455. The server is the gate
 * (POST /kscw/games/:id/hall-source); these helpers only decide what the editor
 * offers and how it reads.
 *
 * `games.hall` is always the EFFECTIVE hall. `synced_hall` / `synced_additional_halls`
 * say what the official source gives; they equal hall / additional_halls on Sync.
 */
import type { Game, Hall } from '../../../types'

export type HallSourceMode = 'sync' | 'override'

/** Picker value for the KWI A + B combo (hall A, additional [B]) — same as ManualGameModal. */
export const HALL_COMBO_AB = 'combo:A+B'

const SYNCED_SOURCES = new Set(['swiss_volley', 'basketplan'])

type HallSourceGame = Pick<Game, 'source' | 'type' | 'hall'> & {
  synced_hall?: Game['synced_hall']
}

const idOf = (v: unknown): string => {
  if (v == null || v === '') return ''
  if (typeof v === 'object' && 'id' in (v as Record<string, unknown>)) return String((v as { id: unknown }).id ?? '')
  return String(v)
}

/** Ids from a json hall list (strings, numbers, expanded objects, JSON text). */
export function hallIdList(raw: unknown): string[] {
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return [] }
  }
  if (!Array.isArray(v)) return []
  return [...new Set(v.map(idOf).filter(Boolean))]
}

/**
 * Does this game have a hall the switch applies to? Synced source, and a home game
 * (or a derby's away row, which carries our hall too).
 */
export function hasSyncedHall(game: HallSourceGame | null | undefined): boolean {
  if (!game || !SYNCED_SOURCES.has(String(game.source ?? ''))) return false
  return game.type === 'home' || idOf(game.hall) !== '' || idOf(game.synced_hall) !== ''
}

/** i18n key naming where the synced hall comes from. */
export function syncSourceKey(source: Game['source'] | string | null | undefined): 'hallSourceFromBasketplan' | 'hallSourceFromVm' {
  return source === 'basketplan' ? 'hallSourceFromBasketplan' : 'hallSourceFromVm'
}

/** "KWI A + KWI B" for a hall + extra halls; '' when there is no hall. */
export function courtLabel(hall: unknown, additional: unknown, halls: Pick<Hall, 'id' | 'name'>[]): string {
  const name = (id: string) => halls.find((h) => String(h.id) === id)?.name ?? ''
  const primary = idOf(hall)
  const ids = [primary, ...hallIdList(additional).filter((id) => id !== primary)].filter(Boolean)
  return ids.map(name).filter(Boolean).join(' + ')
}

/** The picker value for a court set: the combo when it is exactly KWI A + [KWI B]. */
export function pickerValue(hall: unknown, additional: unknown, kwiA?: string, kwiB?: string): string {
  const primary = idOf(hall)
  const extra = hallIdList(additional).filter((id) => id !== primary)
  if (kwiA && kwiB && primary === kwiA && extra.length === 1 && extra[0] === kwiB) return HALL_COMBO_AB
  return primary
}

/** The request body for a picker value, or null when nothing valid is chosen. */
export function overridePayload(
  value: string,
  kwiA?: string,
  kwiB?: string,
): { override: true; hall: number; additional_halls: number[] } | null {
  if (value === HALL_COMBO_AB) {
    if (!kwiA || !kwiB) return null
    return { override: true, hall: Number(kwiA), additional_halls: [Number(kwiB)] }
  }
  const hall = Number(value)
  if (!value || !Number.isInteger(hall) || hall <= 0) return null
  return { override: true, hall, additional_halls: [] }
}

/** Does saving this choice change anything? (Same mode, same court set → no.) */
export function isHallSourceChange(
  game: Pick<Game, 'hall' | 'additional_halls' | 'hall_override'>,
  mode: HallSourceMode,
  value: string,
  kwiA?: string,
  kwiB?: string,
): boolean {
  const on = game.hall_override === true
  if (mode === 'sync') return on
  if (!on) return true
  return pickerValue(game.hall, game.additional_halls, kwiA, kwiB) !== value
}
