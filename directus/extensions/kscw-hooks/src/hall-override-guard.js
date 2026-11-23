/**
 * /items guards for the game hall source switch (migration 455).
 *
 * The switch is flipped only by POST /kscw/games/:id/hall-source, which checks who
 * may do it (admins; a sport admin for their own sport), records the actor and pushes
 * the change to the shared hall calendar at once. Through /items none of that would
 * happen — and the trigger ignores a flip without the endpoint's GUC anyway — so:
 *
 *   1. the switch's own columns are refused for EVERYONE through /items, Directus
 *      admins included (the trigger would silently keep the old values: an explicit
 *      403 beats a save that seems to work);
 *   2. hall / additional_halls on a game whose hall is overwritten are refused too:
 *      the trigger would record the new value as the "official" one, which is not what
 *      someone typing a hall means. They switch it in the game instead.
 *
 * Internal service calls (no accountability) pass: the trigger is their guard.
 */

import { HALL_OVERRIDE_COLUMNS, extraHallIds } from '../../kscw-endpoints/src/hall-override.js'

function refusal(message, code) {
  const err = new Error(message)
  err.name = 'DirectusError'
  err.status = 403
  err.code = code
  err.extensions = { code }
  return err
}

/** Throws when an /items payload writes a column of the switch. */
export function refuseHallOverrideColumns(payload, accountability) {
  if (!accountability) return payload
  if (!payload || typeof payload !== 'object') return payload
  const hit = Object.keys(payload).filter((k) => HALL_OVERRIDE_COLUMNS.includes(k))
  if (hit.length) {
    throw refusal(`Not writable here: ${hit.join(', ')} — use the hall switch in the game (Venue)`, 'FIELD_NOT_WRITABLE')
  }
  return payload
}

const sameHall = (a, b) => String(a ?? '') === String(b ?? '')
const sameExtra = (a, b) => extraHallIds(a).join(',') === extraHallIds(b).join(',')

/**
 * Throws when an /items update MOVES the hall of a game whose hall is overwritten.
 * Re-sending the value it already has (a form that posts every field) passes.
 */
export async function refuseHallEditWhileOverridden(db, keys, payload, accountability) {
  if (!accountability) return payload
  if (!payload || typeof payload !== 'object') return payload
  const touchesHall = 'hall' in payload
  const touchesExtra = 'additional_halls' in payload
  if (!touchesHall && !touchesExtra) return payload
  const ids = (Array.isArray(keys) ? keys : keys != null ? [keys] : []).filter((k) => k != null)
  if (!ids.length) return payload
  const rows = await db('games').whereIn('id', ids).where('hall_override', true).select('id', 'hall', 'additional_halls')
  const moved = (rows || []).some((r) =>
    (touchesHall && !sameHall(payload.hall, r.hall)) || (touchesExtra && !sameExtra(payload.additional_halls, r.additional_halls)))
  if (moved) {
    throw refusal("This game's hall is overwritten — change it with the hall switch in the game (Venue)", 'HALL_OVERRIDDEN')
  }
  return payload
}
