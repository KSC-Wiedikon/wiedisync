/**
 * When the cron files a game's Einsatzliste (owner, 06.11.2026: the day before, it used to
 * be about an hour before kickoff). The cron itself is in kscw-hooks index.js.
 *
 * A list that was saved is final for the cron. Answers that change after that reach the
 * coaches through the kickoff −2 h comparison (einsatzliste-alert.js), and they re-save from
 * the game. The cron never does it for them: a save replaces whatever they changed by hand
 * in Volleymanager, and they have a whole day to do that now.
 */
import { gameStartMs } from '../../kscw-endpoints/src/scorer-roster.js'

/** The first attempt. A team's RSVP deadline of one day ends at this same moment. */
export const NOMINATION_LEAD_MS = 24 * 60 * 60 * 1000
/** A list that did not end 'saved' gets a second chance from here, every tick. */
export const NOMINATION_SECOND_CHANCE_MS = 65 * 60 * 1000
/** VM requires the list by about −40 min. After this the coach files it by hand. */
export const NOMINATION_FLOOR_MS = 35 * 60 * 1000
/** Until the second chance, a failed push (VM down, no head coach set) is tried this often. */
export const NOMINATION_RETRY_MS = 60 * 60 * 1000

/**
 * Should this tick file the list? Rows carry the game plus `vm_nomination_status` and
 * `vm_nomination_claimed_at`, which stays set after a push and so says when it last ran.
 *
 * 'filled' (saved, VM flags too few players) and 'skipped' (no Yes yet) wait for the second
 * chance rather than the hourly retry. 'filled' is a real list a coach may be fixing by hand
 * right now, and a day of 'skipped' retries would do the same to a list they filed themselves.
 *
 * 'pending' stays a candidate: the cron's claim decides, and it takes back a stale lease.
 */
export function nominationPushDue(game, now = Date.now()) {
  const kickoff = gameStartMs(game)
  if (kickoff == null) return false
  const lead = kickoff - now
  if (lead > NOMINATION_LEAD_MS || lead < NOMINATION_FLOOR_MS) return false
  const status = game.vm_nomination_status
  if (status === 'saved' || status === 'closed') return false
  if (!status || status === 'pending' || lead <= NOMINATION_SECOND_CHANCE_MS) return true
  if (status !== 'failed') return false
  const lastAttempt = game.vm_nomination_claimed_at ? new Date(game.vm_nomination_claimed_at).getTime() : 0
  return now - lastAttempt >= NOMINATION_RETRY_MS
}
