// directus/extensions/kscw-endpoints/src/member-sport.js
//
// "Which section does this member belong to" — the ONE server-side answer.
//
// Mirrors the client-side resolver in src/modules/admin/components/memberSport.ts:
// teams first (a coach has NO roster row, so a player-only join wrongly reports
// "no team"), then `sektion`, then the fee-category prefix.
//
// ⚠ Anything club-level or unknown resolves to 'both' and is ALLOWED by every
// caller. Hiding a real member behind an unknowable scope is worse than letting
// a sport admin see a club-level record — a passive member with no roster row,
// or a brand-new signup who has `requested_team` but no `member_teams` row yet,
// must not silently vanish from the section that has to process them.
//
// ⚠ Team NAMES lie: 'Herren 2 H3' is basketball, 'Damen D-Classics 1LR' is
// basketball. Only `teams.sport` counts, ever.
//
// This module exists so there is exactly one implementation. It was lifted out
// of delete-impact.js (which gates the member DELETE on it) when the members
// read-privacy hook in kscw-hooks needed the same rule over ~700 members at
// once — see `resolveMemberSports`, the batched form. Two copies of a scope rule
// is how one of them quietly stops matching the other.

/** The three answers. 'both' means club-level / unknown, and is permissive. */
export const MEMBER_SPORTS = ['volleyball', 'basketball', 'both']

/** Normalise whatever `teams.sport` held into one of the two real sports, or null. */
function normalizeSport(raw) {
  const s = String(raw || '').toLowerCase()
  return s === 'volleyball' || s === 'basketball' ? s : null
}

/**
 * The rule itself, with every input already resolved, plus WHICH input decided.
 * Pure — this is what the tests pin.
 *
 * ⚠ `sport: 'both'` is TWO different facts and callers routinely need them apart:
 * a member on a VB *and* a BB team (`source: 'teams'`) is genuinely dual, while a
 * passive member with no roster row and no VB/BB fee prefix (`source: 'unknown'`)
 * is simply unresolvable. Permission callers must keep treating BOTH as permissive
 * — hiding a real member behind an unknowable scope is the worse failure, see the
 * header — but a UI that buckets members by section needs to show the unresolvable
 * ones as their own worklist rather than silently claiming they play both sports.
 *
 * @param {object} parts
 * @param {Iterable<string>} parts.teamSports raw `teams.sport` of EVERY team the
 *   member is attached to, in any capacity (player, coach, team responsible).
 * @param {string|null} parts.sektion
 * @param {string|null} parts.beitragskategorie
 * @returns {{sport: 'volleyball'|'basketball'|'both', source: 'teams'|'sektion'|'fee'|'unknown'}}
 */
export function sportFromPartsDetailed({ teamSports = [], sektion = null, beitragskategorie = null } = {}) {
  const sports = new Set()
  for (const raw of teamSports) {
    const s = normalizeSport(raw)
    if (s) sports.add(s)
  }
  if (sports.size > 1) return { sport: 'both', source: 'teams' }
  if (sports.size === 1) return { sport: [...sports][0], source: 'teams' }

  const sek = String(sektion || '').trim().toLowerCase()
  if (sek === 'volleyball') return { sport: 'volleyball', source: 'sektion' }
  if (sek === 'basketball') return { sport: 'basketball', source: 'sektion' }
  // 'kscw' and everything else falls through.

  const kat = String(beitragskategorie || '').trim().toLowerCase()
  if (kat.startsWith('vb ')) return { sport: 'volleyball', source: 'fee' }
  if (kat.startsWith('bb ')) return { sport: 'basketball', source: 'fee' }

  return { sport: 'both', source: 'unknown' }
}

/**
 * The answer alone. This is the form every permission/scope caller wants — the
 * distinction above is deliberately invisible here so no gate can accidentally
 * start treating "unknown" as a denial.
 *
 * @returns {'volleyball'|'basketball'|'both'}
 */
export function sportFromParts(parts) {
  return sportFromPartsDetailed(parts).sport
}

/**
 * Batched resolver — one set of queries for MANY members.
 *
 * Four queries total regardless of how many members are asked for, because the
 * caller may be a page reading the whole club (the Data Explorer pulls ~700
 * members in a single request, and the per-member form below would then run
 * ~3500 queries behind one HTTP call).
 *
 * @param {import('knex').Knex} database
 * @param {Array<string|number>} memberIds
 * @param {object} [opts]
 * @param {Array<{id: any, sektion?: any, beitragskategorie?: any}>} [opts.memberRows]
 *   Already-fetched member rows, to skip this function's own `members` query.
 *   Must carry `sektion` and `beitragskategorie`, or the fallbacks silently stop
 *   working and everyone resolves to 'both'.
 * @returns {Promise<Map<string, {sport: 'volleyball'|'basketball'|'both', source: 'teams'|'sektion'|'fee'|'unknown'}>>}
 *   keyed by String(id). Use `resolveMemberSports` unless you need `source`.
 */
export async function resolveMemberSportsDetailed(database, memberIds, opts = {}) {
  const ids = [...new Set((memberIds || []).filter((v) => v !== null && v !== undefined))]
  const out = new Map()
  if (ids.length === 0) return out

  const [playerRows, coachRows, trRows] = await Promise.all([
    database('member_teams').whereIn('member', ids).select('member', 'team'),
    database('teams_coaches').whereIn('members_id', ids).select('members_id', 'teams_id'),
    database('teams_responsibles').whereIn('members_id', ids).select('members_id', 'teams_id'),
  ])

  // member id → the team ids they are attached to, in any capacity.
  const teamIdsByMember = new Map()
  const addLink = (memberId, teamId) => {
    if (memberId === null || memberId === undefined || teamId === null || teamId === undefined) return
    const key = String(memberId)
    const list = teamIdsByMember.get(key)
    if (list) list.push(teamId)
    else teamIdsByMember.set(key, [teamId])
  }
  for (const r of playerRows) addLink(r.member, r.team)
  for (const r of coachRows) addLink(r.members_id, r.teams_id)
  for (const r of trRows) addLink(r.members_id, r.teams_id)

  const allTeamIds = [...new Set([...teamIdsByMember.values()].flat())]
  const sportByTeam = new Map()
  if (allTeamIds.length > 0) {
    const teams = await database('teams').whereIn('id', allTeamIds).select('id', 'sport')
    for (const t of teams) sportByTeam.set(String(t.id), t.sport)
  }

  const memberRows = opts.memberRows
    ?? await database('members').whereIn('id', ids).select('id', 'sektion', 'beitragskategorie')
  const rowById = new Map(memberRows.map((m) => [String(m.id), m]))

  for (const id of ids) {
    const key = String(id)
    const row = rowById.get(key)
    out.set(key, sportFromPartsDetailed({
      teamSports: (teamIdsByMember.get(key) ?? []).map((tid) => sportByTeam.get(String(tid))),
      sektion: row?.sektion ?? null,
      beitragskategorie: row?.beitragskategorie ?? null,
    }))
  }
  return out
}

/**
 * Batched resolver, answers only. Same queries as the detailed form — this is the
 * shape every existing caller (permission gates, the read-privacy hook, the member
 * DELETE gate) expects, and the one they should keep using.
 *
 * @returns {Promise<Map<string, 'volleyball'|'basketball'|'both'>>} keyed by String(id)
 */
export async function resolveMemberSports(database, memberIds, opts = {}) {
  const detailed = await resolveMemberSportsDetailed(database, memberIds, opts)
  const out = new Map()
  for (const [key, v] of detailed) out.set(key, v.sport)
  return out
}

/** Single-member form. Prefer `resolveMemberSports` for more than one. */
export async function resolveMemberSport(database, memberId) {
  const map = await resolveMemberSports(database, [memberId])
  return map.get(String(memberId)) ?? 'both'
}

/**
 * What section a caller is CONFINED to, from their `members.role` array.
 *
 * @returns {'volleyball'|'basketball'|null} null ⇒ unconfined. That covers a full
 *   admin/superuser, a DUAL sport admin (both flags — no section boundary can be
 *   drawn), and anybody who is not a sport admin at all. Callers must therefore
 *   check "is this person staff" separately; this answers only "confined to what".
 */
export function sportAdminScope(roles) {
  const list = Array.isArray(roles) ? roles : []
  if (list.includes('admin') || list.includes('superuser')) return null
  const vb = list.includes('vb_admin')
  const bb = list.includes('bb_admin')
  if (vb === bb) return null
  return vb ? 'volleyball' : 'basketball'
}

/**
 * May a caller confined to `scope` act on a member whose section is `targetSport`?
 * 'both' (club-level / unknown) is visible to either section — see the header.
 */
export function sportScopeAllows(scope, targetSport) {
  if (!scope) return true
  return targetSport === 'both' || targetSport === scope
}
