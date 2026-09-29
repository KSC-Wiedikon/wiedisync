/**
 * The Einsatzliste, read from Volleymanager ONCE per game and stored (migration 396).
 *
 * Every match-sheet surface — the scorer's and coach's sheet, Show IDs, live scoring, the
 * result participant check — reads the stored row (`loadVmCheck`), never VM. VM is read
 * only here, on the SHARED account (CLAUDE.md → "The shared VolleyManager account"):
 *   - by the kscw-hooks cron at kickoff −45 min (after the auto-filing push's T-65…T-35
 *     window has had its go), deferred out of svrz_rc's windows;
 *   - by a coach or admin pressing "Recheck" (POST /kscw/scorer/game/:gameId/vm-check).
 * Both go through readOwnNominationList, which claims the account and never waits.
 */
import { readOwnNominationList } from './vm-nomination-list.js'

/** The automatic read happens this long before kickoff. */
export const VM_CHECK_LEAD_MS = 45 * 60 * 1000

/**
 * VM game UUID for one of our games — MATCHED BY GAME NUMBER.
 *
 * `games.game_id` is `vb_<SwissVolley gameId>` and `svrz_games.svrz_number` is that same
 * number (the equivalence sv-sync.js already relies on), so the number is the join key —
 * no team-name matching, no UUID guessing. Returns null for basketball (`bb_` prefix, no
 * VM) and for games with no VM fixture.
 *
 * No home/away flag is passed on: VM's call is scoped to the active party and only ever
 * returns OUR list, so the reader takes whichever side is populated. Nothing here needs
 * to know which side we are on — and shouldn't, since a stale home_club_id in our own DB
 * would then silently degrade the sheet to the RSVP fallback.
 */
export async function vmGameUuid(database, game) {
  const gid = String(game.game_id ?? '')
  if (!gid.startsWith('vb_')) return null
  const number = Number(gid.slice(3))
  if (!Number.isInteger(number)) return null

  const row = await database('svrz_games')
    .where('svrz_number', number)
    .first('svrz_persistence_id')
  return row?.svrz_persistence_id ?? null
}

/** The stored check for a game, or null while none was made. */
export async function loadVmCheck(database, gameId) {
  return (await database('game_vm_sheets').where('game', gameId).first()) ?? null
}

/**
 * Read the list from VM now and store it.
 *
 * `by` = { id, name } of the member who pressed Recheck, or null for the cron.
 * A `busy` answer read nothing at all: the cron stores it (the sheet says so and the next
 * tick retries), a Recheck does not overwrite anything with it. A failed attempt never
 * wipes the last list VM answered with — see migration 396.
 */
export async function runVmCheck(database, log, game, { by = null } = {}) {
  const uuid = await vmGameUuid(database, game)
  const res = uuid
    // The side only matters for an intra-club derby, where both lists are ours (see
    // readOwnNominationList). Each derby leg is its own games row with its own `type`.
    ? await readOwnNominationList(uuid, log, { side: game.type === 'away' ? 'away' : 'home' })
    : { status: 'unavailable', error: 'no Volleymanager fixture for this game' }

  if (res.status === 'busy' && by) return { ...res, stored: false }

  const now = new Date()
  const attempt = {
    status: res.status,
    error: res.error ?? null,
    checked_at: now,
    checked_by: by?.id ?? null,
    checked_by_name: by?.name ?? null,
  }
  // VM answered (a list, or "none filed") → that is the new truth. Anything else keeps
  // the last list and only records the attempt.
  const answered = res.status === 'ok' || res.status === 'no_list'
  const listPart = answered
    ? { list: res.status === 'ok' ? JSON.stringify(res.list) : null, list_at: now }
    : {}

  await database('game_vm_sheets')
    .insert({ game: game.id, ...attempt, ...listPart })
    .onConflict('game')
    .merge(Object.keys({ ...attempt, ...listPart }))

  log.info(`[vm-sheet] game ${game.id}: ${res.status}${res.error ? ` (${res.error})` : ''}`
    + `${res.status === 'ok' ? ` — ${res.list.players.length} players, ${res.list.coaches.length} officials` : ''}`
    + ` · ${by ? `recheck by member ${by.id}` : 'kickoff −45 min'}`)
  return { ...res, stored: true }
}
