/**
 * When the cron files a game's Einsatzliste (owner, 06.11.2026: the day before, it used to
 * be about an hour before kickoff). The cron itself is in kscw-hooks index.js.
 *
 * A list that reached Volleymanager is final for the cron, also one it flags ('filled'): a
 * save replaces whatever was changed by hand there, and from the same answers it would only
 * flag the same thing again. Answers that change after that reach the coaches through the
 * kickoff −2 h comparison, a flagged list by email (einsatzliste-alert.js), and they fix it
 * on the match sheet, which saves the list itself.
 *
 * The exception is a change on that sheet no push has seen yet: the cron sends it.
 */
import { gameStartMs } from '../../kscw-endpoints/src/scorer-roster.js'

/** The first attempt. A team's RSVP deadline of one day ends at this same moment. */
export const NOMINATION_LEAD_MS = 24 * 60 * 60 * 1000
/** A list that never reached Volleymanager gets a second chance from here, every tick. */
export const NOMINATION_SECOND_CHANCE_MS = 65 * 60 * 1000
/** VM requires the list by about −40 min. After this the coach files it by hand. */
export const NOMINATION_FLOOR_MS = 35 * 60 * 1000
/** Until the second chance, a failed push (VM down, no head coach set) is tried this often. */
export const NOMINATION_RETRY_MS = 60 * 60 * 1000

const ms = (value) => (value ? new Date(value).getTime() : null)

/**
 * Should this tick file the list? Rows carry the game plus `vm_nomination_status`,
 * `vm_nomination_claimed_at` (stays set after a push, so it says when one last started) and
 * `vm_nomination_sheet_changed_at` (migration 446).
 *
 * 'skipped' (no Yes yet) waits for the second chance rather than the hourly retry: a day of
 * retries could replace a list the coach filed by hand in the meantime.
 *
 * 'pending' stays a candidate: the cron's claim decides, and it takes back a stale lease.
 */
export function nominationPushDue(game, now = Date.now()) {
  const kickoff = gameStartMs(game)
  if (kickoff == null) return false
  const lead = kickoff - now
  if (lead > NOMINATION_LEAD_MS || lead < NOMINATION_FLOOR_MS) return false
  const status = game.vm_nomination_status
  if (status === 'closed') return false
  const lastAttempt = ms(game.vm_nomination_claimed_at)
  const sheetChanged = ms(game.vm_nomination_sheet_changed_at)
  if (sheetChanged != null && (lastAttempt == null || sheetChanged > lastAttempt)) return true
  if (status === 'saved' || status === 'filled') return false
  if (!status || status === 'pending' || lead <= NOMINATION_SECOND_CHANCE_MS) return true
  if (status !== 'failed') return false
  return now - (lastAttempt ?? 0) >= NOMINATION_RETRY_MS
}
