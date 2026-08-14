// src/modules/admin/components/memberSport.ts
//
// "Which sport is this member in?" — the one answer the Data Explorer needs
// before it can decide whether to show the Swiss Volley block, the Basketplan
// block, or both, and which positions / coaching rungs to offer.
//
// There is no `members.sport` column and there never was. The answer is a
// cascade, and every step of it exists because a simpler version was wrong:
//
//   1. The member's teams — via ALL THREE relations. A coach has no roster row
//      (member_teams holds players only), so a player-only join reports "no
//      team" for every coach in the club and hides their sport's fields.
//      ⚠ Team NAMES LIE. "Herren 2 H3" and "Damen D-Classics 1LR" are
//      BASKETBALL teams. Only `teams.sport` is authoritative — never parse a
//      name, a league string or a "Damen"/"Herren" prefix.
//   2. `members.sektion` — ClubDesk's section, the answer for members with no
//      team at all (Passiv, Ehrenmitglieder, referees, new signups).
//   3. The `VB ` / `BB ` prefix on `members.beitragskategorie` — the last
//      machine-readable hint, and the only one for members whose sektion is
//      empty.
//
// The function NEVER returns "neither". Sektion=KSCW, Passivmitglied, Gratis,
// Kein Beitrag and "nothing at all" are club-level: they carry no sport, and
// answering "neither" would hide a real, editable column behind a gate the
// admin cannot open. Those all resolve to 'both'.
//
// Its own module rather than an export from a .tsx: a component file that also
// exports functions/constants breaks React Fast Refresh
// (react-refresh/only-export-components, an ESLint *error* here).

/** The sport gate a member falls under. 'both' = club-level / two-sport / unknown. */
export type MemberSport = 'volleyball' | 'basketball' | 'both'

/**
 * Structural subset of the explorer's `CacheShape`. Declared structurally
 * rather than importing CacheShape so this module carries no dependency on
 * explorerHelpers.ts — CacheShape is assignable to it as-is.
 */
export interface MemberSportCache {
  teams: ReadonlyArray<{ id: string | number; sport?: string | null }>
  /** memberId → team ids (member_teams — players) */
  memberTeams: ReadonlyMap<string, string[]>
  /** memberId → team ids (teams_coaches) */
  memberCoachTeams: ReadonlyMap<string, string[]>
  /** memberId → team ids (teams_responsibles) */
  memberTrTeams: ReadonlyMap<string, string[]>
}

export interface MemberSportInput {
  id: string | number
  sektion?: unknown
  beitragskategorie?: unknown
}

function asTrimmedLower(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/** Step 1 — the union of the three team relations, mapped through `teams.sport`. */
function sportFromTeams(
  memberId: string,
  cache: MemberSportCache,
): MemberSport | null {
  const teamIds = new Set<string>()
  for (const map of [cache.memberTeams, cache.memberCoachTeams, cache.memberTrTeams]) {
    for (const id of map.get(memberId) ?? []) teamIds.add(String(id))
  }
  if (teamIds.size === 0) return null

  // Index once — a member can sit on a dozen teams and `teams` is the full club.
  const sportById = new Map<string, string>()
  for (const team of cache.teams) sportById.set(String(team.id), asTrimmedLower(team.sport))

  let vb = false
  let bb = false
  for (const id of teamIds) {
    const sport = sportById.get(id)
    if (sport === 'volleyball') vb = true
    else if (sport === 'basketball') bb = true
    // 'other', '', null and ids missing from `teams` (a team outside the
    // explorer's sport scope, or an inactive one) contribute nothing.
  }

  if (vb && bb) return 'both'
  if (vb) return 'volleyball'
  if (bb) return 'basketball'
  return null
}

/** Step 2 — `members.sektion`. */
function sportFromSektion(sektion: unknown): MemberSport | null {
  switch (asTrimmedLower(sektion)) {
    case 'volleyball': return 'volleyball'
    case 'basketball': return 'basketball'
    // KSCW is the club-level section (Vorstand, Ehrenmitglieder, staff without
    // a sport). It carries no sport, so it shows both.
    case 'kscw': return 'both'
    default: return null
  }
}

/** Step 3 — the `VB ` / `BB ` prefix on the fee category. */
function sportFromFeeCategory(category: unknown): MemberSport | null {
  const value = asTrimmedLower(category)
  if (value.startsWith('vb ')) return 'volleyball'
  if (value.startsWith('bb ')) return 'basketball'
  // 'Passivmitglied', 'Gratis', 'Kein Beitrag' and anything unrecognised carry
  // no sport — handled by the caller's 'both' default, not claimed here.
  return null
}

/** Which step of the cascade produced the answer. `unknown` = nothing matched. */
export type MemberSportSource = 'teams' | 'sektion' | 'fee' | 'unknown'

/**
 * Resolve a member's sport AND say which step answered.
 *
 * The source matters because 'both' is two different facts wearing one label:
 * a real two-sport player (source `teams`), and "we have no idea" (source
 * `unknown`, or `sektion` = KSCW). A field gate is right to treat them alike —
 * showing a spare column beats hiding a real one. A navigation tree is not:
 * see `sportsForMember` in memberGroups.ts, which files the first under both
 * sports and the second under none.
 *
 * Mirrors `sportFromPartsDetailed` in `kscw-endpoints/src/member-sport.js`. The
 * two are independent copies of one rule (frontend has the explorer cache,
 * backend has knex) — change one, check the other.
 */
export function resolveMemberSportDetailed(
  member: MemberSportInput,
  cache: MemberSportCache | null | undefined,
): { sport: MemberSport; source: MemberSportSource } {
  const memberId = String(member.id)

  if (cache) {
    const fromTeams = sportFromTeams(memberId, cache)
    if (fromTeams) return { sport: fromTeams, source: 'teams' }
  }

  const fromSektion = sportFromSektion(member.sektion)
  if (fromSektion) return { sport: fromSektion, source: 'sektion' }

  const fromCategory = sportFromFeeCategory(member.beitragskategorie)
  if (fromCategory) return { sport: fromCategory, source: 'fee' }

  return { sport: 'both', source: 'unknown' }
}

/**
 * Resolve a member's sport. First step that yields an answer wins; the
 * function never returns "neither" (see the module header).
 *
 * `cache == null` (rendered before the explorer cache landed) skips step 1 and
 * starts at `sektion`.
 */
export function resolveMemberSport(
  member: MemberSportInput,
  cache: MemberSportCache | null | undefined,
): MemberSport {
  return resolveMemberSportDetailed(member, cache).sport
}

/**
 * Does a member's resolved sport cover a given gate? 'both' covers everything.
 * Used by the field schema to decide whether a sport subsection is hidden.
 */
export function sportCovers(
  sport: MemberSport,
  gate: 'volleyball' | 'basketball',
): boolean {
  return sport === 'both' || sport === gate
}
