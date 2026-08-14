// src/modules/admin/components/memberGroups.ts
//
// The Database page's member tree — the club as ClubDesk draws it, built from
// wiedisync's own columns rather than from ClubDesk's group strings.
//
// ⚠ A member appears in EVERY group they qualify for, not the first one that
// matches. ClubDesk works that way (a person is in "BB H1" and "BB Trainer" and
// "Vorstand" at once) and any single-bucket rule immediately lies: filing a
// player-coach under "players" empties the coach list, filing them under
// "coaches" empties the squad. The old tree took the first matching sport and
// that is exactly how three members with a real `sektion` ended up under
// "Other" — see `sportsForMember`.
//
// ⚠ Team NAMES LIE — "Herren 2 H3" and "Damen D-Classics 1LR" are BASKETBALL.
// Only `teams.sport` decides which sport a team belongs to. Never parse a name.
//
// Its own module rather than an export from ExplorerTree.tsx: a component file
// that also exports functions breaks React Fast Refresh
// (react-refresh/only-export-components, an ESLint *error* here).

import { resolveMemberSportDetailed, type MemberSportCache } from './memberSport'

/** A node in the member tree. Leaves carry `memberIds`; branches carry `children`. */
export interface MemberGroupNode {
  /** Stable key for expand/collapse state. Unique across the whole tree. */
  key: string
  /** i18n key for the label, or `{ raw }` for data-derived names (team names). */
  labelKey?: string
  raw?: string
  children?: MemberGroupNode[]
  memberIds?: string[]
}

/** The member fields this module reads. A structural subset of `Member`. */
export interface GroupMember {
  id: string | number
  sektion?: unknown
  beitragskategorie?: unknown
  register_status?: unknown
  role?: unknown
  kscw_membership_active?: unknown
  scorer_vb?: unknown
  referee_vb?: unknown
  otr1_bb?: unknown
  otr2_bb?: unknown
  otn1_bb?: unknown
  otn2_bb?: unknown
  referee_bb?: unknown
  is_spielplaner?: unknown
  trainer_licences?: unknown
}

export interface GroupTeam {
  id: string | number
  sport?: string | null
  name?: string | null
  active?: boolean | null
}

export interface MemberGroupCache extends MemberSportCache {
  teams: ReadonlyArray<GroupTeam>
}

type Sport = 'volleyball' | 'basketball'

const truthy = (v: unknown): boolean => v === true || v === 'true' || v === 1

/** `members.role` is jsonb — an array of role slugs, or null for most members. */
function hasRole(member: GroupMember, role: string): boolean {
  const raw = member.role
  if (Array.isArray(raw)) return raw.some((r) => String(r).toLowerCase() === role)
  // Defensive: some rows come back as a JSON string rather than a parsed array.
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) && parsed.some((r) => String(r).toLowerCase() === role)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Which sports a member belongs to, as a SET.
 *
 * ⚠ This is not `resolveMemberSport`, and the difference is deliberate. That
 * one answers a FIELD GATE and is permissive on purpose: it never returns
 * "neither", because hiding an editable column is worse than showing a spare
 * one, so club-level members (sektion KSCW, Vorstand, no signal at all) come
 * back as 'both'. A navigation tree needs the opposite: filing a Vorstand
 * member under Volleyball AND Basketball is noise, while a genuine two-sport
 * player must appear under both. So we ask the same cascade for its SOURCE and
 * only spread across both sports when the evidence is real team membership.
 *
 * Returns an empty set for club-level members — they are placed by
 * `register_status` / role instead.
 */
export function sportsForMember(
  member: GroupMember,
  cache: MemberGroupCache | null | undefined,
): Sport[] {
  const { sport, source } = resolveMemberSportDetailed(member, cache)
  if (sport === 'volleyball' || sport === 'basketball') return [sport]
  // 'both' means either two real teams, or "no idea". Only the former is a
  // statement about sport.
  if (sport === 'both' && source === 'teams') return ['volleyball', 'basketball']
  return []
}

/** Team ids a member is attached to through ANY of the three relations. */
function allTeamIds(memberId: string, cache: MemberGroupCache): Set<string> {
  const ids = new Set<string>()
  for (const map of [cache.memberTeams, cache.memberCoachTeams, cache.memberTrTeams]) {
    for (const id of map.get(memberId) ?? []) ids.add(String(id))
  }
  return ids
}

/**
 * Build the member tree.
 *
 * `members` is the working set (the page's member filters applied).
 * `allMembers` is every member the cache holds, filters ignored — used ONLY for
 * the register-status groups. ⚠ Those groups exist to answer "who left", and
 * the page's default filter is `kscw_membership_active = yes`, so building them
 * from the filtered list would render them permanently empty and make the club
 * look like nobody has ever left. Every other group narrows with the filters,
 * which is what the filters are for.
 */
export function buildMemberGroups(
  members: ReadonlyArray<GroupMember>,
  allMembers: ReadonlyArray<GroupMember>,
  cache: MemberGroupCache,
): MemberGroupNode[] {
  const ids = (list: ReadonlyArray<GroupMember>) => list.map((m) => String(m.id))

  // ── Sport → team ────────────────────────────────────────────────────
  // Only ACTIVE teams get a subgroup. The basketball side keeps a parallel
  // inactive team set sharing `bb_source_id`, so listing both would show every
  // BB squad twice under near-identical names.
  const teamsBySport: Record<Sport, GroupTeam[]> = { volleyball: [], basketball: [] }
  for (const team of cache.teams) {
    if (team.active === false) continue
    const sport = String(team.sport ?? '').toLowerCase()
    if (sport === 'volleyball' || sport === 'basketball') teamsBySport[sport].push(team)
  }
  for (const sport of ['volleyball', 'basketball'] as const) {
    teamsBySport[sport].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
  }

  // ── Officials ───────────────────────────────────────────────────────
  // ⚠ Gated on the LICENCE FLAG, not on the member's resolved sport. The flag
  // is itself the statement that somebody officiates that sport — a scorer
  // whose section is Basketball is still a volleyball scorer, and requiring
  // both would quietly drop them off the only list that has to be complete
  // when duties are handed out.
  const flagNode = (key: string, labelKey: string, flag: keyof GroupMember): MemberGroupNode => ({
    key,
    labelKey,
    memberIds: ids(members.filter((m) => truthy(m[flag]))),
  })

  const officialsNode = (sport: Sport): MemberGroupNode => ({
    key: sport === 'volleyball' ? 'officials:vb' : 'officials:bb',
    labelKey: 'explorerGroupOfficials',
    children: sport === 'volleyball'
      ? [
          flagNode('officials:vb:scorers', 'explorerGroupScorers', 'scorer_vb'),
          flagNode('officials:vb:referees', 'explorerGroupReferees', 'referee_vb'),
        ]
      : [
          // OTR/OTN are Basketplan's official grades, not a ladder we invented —
          // a member can hold several, so these lists overlap by design.
          { key: 'officials:bb:otr1', raw: 'OTR1', memberIds: ids(members.filter((m) => truthy(m.otr1_bb))) },
          { key: 'officials:bb:otr2', raw: 'OTR2', memberIds: ids(members.filter((m) => truthy(m.otr2_bb))) },
          { key: 'officials:bb:otn1', raw: 'OTN1', memberIds: ids(members.filter((m) => truthy(m.otn1_bb))) },
          { key: 'officials:bb:otn2', raw: 'OTN2', memberIds: ids(members.filter((m) => truthy(m.otn2_bb))) },
          flagNode('officials:bb:referees', 'explorerGroupReferees', 'referee_bb'),
        ],
  })

  // ── Staff ───────────────────────────────────────────────────────────
  // ⚠ Coaches and team responsibles are NEVER in `member_teams` — that holds
  // players only. They come from their own junctions, which is precisely why
  // the sport-only tree filed a coach-without-a-roster-row under "Other".
  const staffNode = (sport: Sport): MemberGroupNode => {
    const teamIdsInSport = new Set(teamsBySport[sport].map((t) => String(t.id)))
    const inRelation = (map: ReadonlyMap<string, string[]>) => (m: GroupMember) =>
      (map.get(String(m.id)) ?? []).some((id) => teamIdsInSport.has(String(id)))

    return {
      key: `staff:${sport}`,
      labelKey: 'explorerGroupStaff',
      children: [
        {
          key: `staff:${sport}:coaches`,
          labelKey: 'explorerGroupCoaches',
          memberIds: ids(members.filter(inRelation(cache.memberCoachTeams))),
        },
        {
          key: `staff:${sport}:responsibles`,
          labelKey: 'explorerGroupTeamResponsibles',
          memberIds: ids(members.filter(inRelation(cache.memberTrTeams))),
        },
      ],
    }
  }

  // ── Sport ───────────────────────────────────────────────────────────
  // Each sport owns its own Teams / Officials / Staff / Other, so the tree
  // reads the way the club is actually organised rather than as one flat list
  // where "Volleyball staff" and "Basketball staff" sit next to "Gap year".
  const sportNode = (sport: Sport): MemberGroupNode => {
    const inSport = members.filter((m) => sportsForMember(m, cache).includes(sport))

    const teamsNode: MemberGroupNode = {
      key: `sport:${sport}:teams`,
      labelKey: 'explorerGroupTeams',
      children: teamsBySport[sport].map((team) => ({
        key: `sport:${sport}:team:${team.id}`,
        raw: String(team.name ?? team.id),
        memberIds: inSport
          .filter((m) => allTeamIds(String(m.id), cache).has(String(team.id)))
          .map((m) => String(m.id)),
      })),
    }

    const officials = officialsNode(sport)
    const staff = staffNode(sport)

    // Everyone in this sport that none of the three branches above accounts
    // for — a passive player, a new signup, somebody whose only trace is a
    // section. Deliberately a RESIDUE and not "no team": a scorer without a
    // squad is findable under Officials, so repeating them here would only
    // pad the list people scan when they are looking for the unexplained.
    const accounted = new Set<string>()
    ;[teamsNode, officials, staff].forEach((n) => collectIds(n, accounted))
    const other = inSport.filter((m) => !accounted.has(String(m.id)))

    return {
      key: `sport:${sport}`,
      labelKey: `common:${sport}`,
      children: [
        teamsNode,
        officials,
        staff,
        { key: `sport:${sport}:other`, labelKey: 'explorerGroupOther', memberIds: ids(other) },
      ],
    }
  }

  // ── Club-level ──────────────────────────────────────────────────────
  const byRegisterStatus = (status: string) =>
    ids(allMembers.filter((m) => String(m.register_status ?? '') === status))

  const clubNodes: MemberGroupNode[] = [
    {
      key: 'club:vorstand',
      labelKey: 'explorerGroupVorstand',
      memberIds: ids(allMembers.filter((m) => hasRole(m, 'vorstand'))),
    },
    { key: 'club:honorary', labelKey: 'explorerGroupHonorary', memberIds: byRegisterStatus('Ehrenmitglied') },
    { key: 'club:passive', labelKey: 'explorerGroupPassive', memberIds: byRegisterStatus('Passivmitglied') },
    { key: 'club:gapyear', labelKey: 'explorerGroupGapYear', memberIds: byRegisterStatus('Zwischenjahr') },
    { key: 'club:former', labelKey: 'explorerGroupFormer', memberIds: byRegisterStatus('Ehemaliges Mitglied') },
    { key: 'club:nonmember', labelKey: 'explorerGroupNonMember', memberIds: byRegisterStatus('Kein Mitglied') },
    {
      key: 'club:spielplaner',
      labelKey: 'explorerGroupSpielplaner',
      memberIds: ids(members.filter((m) => truthy(m.is_spielplaner))),
    },
  ]

  // ── Unassigned ──────────────────────────────────────────────────────
  // The honest residue: no sport, no register status we group on, no role. It
  // must stay visible — a member the tree cannot place is a data problem
  // somebody should see, not one to hide by dropping the group.
  const sportNodes = [sportNode('volleyball'), sportNode('basketball')]
  const placed = new Set<string>()
  ;[...sportNodes, ...clubNodes].forEach((n) => collectIds(n, placed))

  const unassigned = members.filter((m) => !placed.has(String(m.id)))

  return prune([
    ...sportNodes,
    ...clubNodes,
    { key: 'club:unassigned', labelKey: 'explorerGroupUnassigned', memberIds: ids(unassigned) },
  ])
}

/** Drop empty leaves and branches so the tree shows only groups that exist. */
function prune(nodes: MemberGroupNode[]): MemberGroupNode[] {
  const out: MemberGroupNode[] = []
  for (const node of nodes) {
    const children = node.children ? prune(node.children) : undefined
    const count = (node.memberIds?.length ?? 0) + (children?.length ?? 0)
    if (count === 0) continue
    out.push({ ...node, children })
  }
  return out
}

/**
 * How many members are under a node — DISTINCT, not the sum of its leaves.
 *
 * ⚠ Summing is wrong the moment groups overlap, which is the whole design here:
 * someone on two basketball squads, or holding both OTR1 and OTR2, appears in
 * two leaves. On prod that made "Basketball" read 494 for a section of 314, and
 * a header that overstates the club by 50% teaches people to ignore the numbers.
 */
export function countMembers(node: MemberGroupNode): number {
  return collectIds(node).size
}

function collectIds(node: MemberGroupNode, into = new Set<string>()): Set<string> {
  node.memberIds?.forEach((id) => into.add(id))
  node.children?.forEach((c) => collectIds(c, into))
  return into
}
