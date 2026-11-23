/**
 * Game hall source switch — "Sync" / "Overwrite" (migration 455, owner 23.11.2026).
 *
 * `games.hall` (+ `additional_halls`) is always the EFFECTIVE court set: every reader
 * (app, Hallenplan, sweeps, floor claims, duty recheck, iCal, public endpoints,
 * kscw.ch, the Google Calendar push) keeps reading it. While `hall_override` is on,
 * what the official source says lives in `synced_hall` / `synced_additional_halls`.
 *
 * The trigger trg_games_0_hall_override enforces that in Postgres for every writer.
 * The two helpers below let a sync work against the OFFICIAL value on purpose, so it
 * keeps recording what VolleyManager / Basketplan / the booking mirror says even when
 * the source moves the game into the very hall it was overwritten to (the trigger
 * alone would see "no change" there and keep a stale synced_hall).
 *
 * Pure: shared by sv-sync, bp-sync, game-scheduling, the endpoint and kscw-hooks.
 */

/** Every column of the switch. None is writable through /items (kscw-hooks). */
export const HALL_OVERRIDE_COLUMNS = Object.freeze([
  'hall_override', 'synced_hall', 'synced_additional_halls', 'hall_override_by_name', 'hall_override_at',
])

/** What a sync has to read next to `hall` / `additional_halls`. */
export const HALL_OVERRIDE_READ = Object.freeze(['hall_override', 'synced_hall', 'synced_additional_halls'])

/** Sources whose hall comes from outside the app — the only ones the switch applies to. */
export const SYNCED_GAME_SOURCES = Object.freeze(['swiss_volley', 'basketplan'])

/** The transaction-local GUC that lets a write flip the switch (see migration 455). */
export const HALL_OVERRIDE_GUC = 'kscw.hall_override_write'

export const isHallOverridden = (row) => row?.hall_override === true

/**
 * The row as the official source last saw it: with the switch on, `hall` and
 * `additional_halls` read the synced copies. A sync compares and resolves against
 * this, never against the overwritten value. Switch off (or no row): unchanged.
 */
export function hallSourceView(existing) {
  if (!isHallOverridden(existing)) return existing
  return {
    ...existing,
    hall: existing.synced_hall ?? null,
    additional_halls: existing.synced_additional_halls ?? null,
  }
}

/**
 * The UPDATE payload a sync may send for `existing`. With the switch on, the
 * official court set goes to the synced copies and the effective one is left
 * alone. A key the sync did not set stays absent.
 */
export function overrideAwareWrite(data, existing) {
  if (!isHallOverridden(existing)) return data
  const out = { ...data }
  if ('hall' in out) {
    out.synced_hall = out.hall
    delete out.hall
  }
  if ('additional_halls' in out) {
    out.synced_additional_halls = out.additional_halls
    delete out.additional_halls
  }
  return out
}

/** json column value (parsed array, JSON text, null, junk) → sorted unique hall ids. */
export function extraHallIds(raw) {
  let v = raw
  if (typeof v === 'string') {
    try { v = JSON.parse(v) } catch { return [] }
  }
  if (!Array.isArray(v)) return []
  const ids = v
    .map((x) => (x && typeof x === 'object' && 'id' in x ? x.id : x))
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0)
  return [...new Set(ids)].sort((a, b) => a - b)
}

/** The court set of `hall` + `additional_halls` as one comparable key ('' = none). */
export function courtSetKey(hall, additionalHalls) {
  const ids = new Set(extraHallIds(additionalHalls))
  const h = Number(hall)
  if (Number.isInteger(h) && h > 0) ids.add(h)
  return [...ids].sort((a, b) => a - b).join('+')
}
