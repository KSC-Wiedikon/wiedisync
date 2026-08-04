/**
 * Member audience resolution — the single definition of "who is in this group".
 *
 * Lifted out of the announcements fanout in kscw-hooks (2026-08-03) so the club
 * mailbox's group send resolves the SAME audience the announcement fanout does.
 * A second copy would have drifted the moment either side changed a gate, and
 * the gates here are subtle enough that the drift would be silent (see the
 * activity-gate note in membersWithRoleTokens).
 *
 * Lives in kscw-endpoints because that is the shared direction: kscw-hooks
 * imports from here (error-log.js, email-template.js, season.js, …), never the
 * reverse.
 *
 * Every exported resolver takes `database` (knex) first and returns member IDs.
 * Channel-level filtering (has an email, opted in, has a push subscription) is
 * deliberately NOT done here — that belongs to the sender, because the same
 * audience feeds email, push and the bell.
 */

// Role tokens for audience_type='roles' (migration 219). Prefixed across three
// disjoint namespaces because "role" means three different things here: an
// app-permission value in members.role, a team function derived from a
// junction, and a qualification boolean on members.
export const ANN_ROLE_ENUM = ['admin', 'superuser', 'vb_admin', 'bb_admin', 'vorstand', 'website_admin', 'finance', 'user']
export const ANN_FUNCTIONS = ['coach', 'team_responsible', 'captain']
// `otn_bb` stays in the list alongside the levels (migration 228): it is the
// coarse "holds some OTN" flag and is still the only true one for the 6
// pre-split holders, so dropping it would silently shrink their audience.
// Targeting all OTN people = tick otn_bb + otn1_bb + otn2_bb.
export const ANN_QUAL_COLUMNS = ['is_spielplaner', 'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'otn1_bb', 'otn2_bb', 'referee_bb']

// ClubDesk `status` values that mean "is a member of the club" — the register
// the GV invitation goes to. Everything else ClubDesk carries ('Ehemaliges
// Mitglied', 'Kein Mitglied', 'Verstorben') is a contact, not a member.
// ⚠ These are ClubDesk's German spellings and must match it exactly; a renamed
// status there silently shrinks this audience rather than erroring.
export const MEMBER_REGISTER_STATUSES = ['Aktivmitglied', 'Passivmitglied', 'Ehrenmitglied', 'Zwischenjahr']

export function parseJsonArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

/**
 * Everyone attached to the given teams: players + coaches + team responsibles
 * + captains. Column names differ per junction — member_teams uses
 * member/team, the staff junctions use members_id/teams_id.
 */
export async function membersOnTeams(database, teamIds) {
  if (teamIds.length === 0) return []
  const [players, coaches, trs, captains] = await Promise.all([
    database('member_teams').whereIn('team', teamIds).select('member'),
    database('teams_coaches').whereIn('teams_id', teamIds).select('members_id'),
    database('teams_responsibles').whereIn('teams_id', teamIds).select('members_id'),
    database('teams').whereIn('id', teamIds).whereNotNull('captain').select('captain'),
  ])
  return [...new Set([
    ...players.map(r => r.member),
    ...coaches.map(r => r.members_id),
    ...trs.map(r => r.members_id),
    ...captains.map(r => r.captain),
  ].filter(Boolean))]
}

/**
 * @param {object} [opts]
 * @param {string} [opts.season] Resolve fn:* against this season's teams instead
 *   of the active ones. Omitted = current season, i.e. the historical behaviour.
 */
export async function membersWithRoleTokens(database, log, tokens, opts = {}) {
  const roleNames = []
  const functions = []
  const quals = []
  for (const raw of tokens) {
    const tok = String(raw || '')
    // Unknown/unprefixed tokens are dropped rather than treated as a wildcard —
    // a typo must never widen the audience.
    if (tok.startsWith('role:') && ANN_ROLE_ENUM.includes(tok.slice(5))) roleNames.push(tok.slice(5))
    else if (tok.startsWith('fn:') && ANN_FUNCTIONS.includes(tok.slice(3))) functions.push(tok.slice(3))
    else if (tok.startsWith('qual:') && ANN_QUAL_COLUMNS.includes(tok.slice(5))) quals.push(tok.slice(5))
    else log?.warn?.({ msg: `[audience] unknown audience_roles token "${tok}" — ignored` })
  }

  const ids = new Set()

  // Two different activity gates, deliberately:
  //
  //   role:*  → wiedisync_active. members.role IS the app-permission column,
  //             so an app concept gates on app membership. Widening it would
  //             also turn `role:user` (617 rows) into a de-facto all-members
  //             blast, which is what audience_type='all' is for.
  //
  //   fn:* / qual:*  → kscw_membership_active, matching the teams/sport
  //             branches. A Schreiber is a Schreiber whether or not they ever
  //             logged into wiedisync, and most never do: gating these on
  //             wiedisync_active silently dropped 43 of 149 scorer_vb and 7 of
  //             9 referee_bb from every send, reported as success. Real-world
  //             functions and qualifications are not app opt-ins.
  if (roleNames.length > 0) {
    const rows = await database('members')
      .where('wiedisync_active', true)
      .where(function () {
        // @> per role rather than the jsonb any-of operator ?| — knex reads a
        // bare ? as a binding placeholder, and escaping it is easy to get wrong.
        for (const name of roleNames) this.orWhereRaw('role::jsonb @> ?::jsonb', [JSON.stringify([name])])
      })
      .select('id')
    rows.forEach(r => ids.add(r.id))
  }

  if (quals.length > 0) {
    const rows = await database('members')
      .where('kscw_membership_active', true)
      .where(function () { for (const col of quals) this.orWhere(col, true) })
      .select('id')
    rows.forEach(r => ids.add(r.id))
  }

  if (functions.length > 0) {
    const staff = new Set()
    // Season scoping replaces the active-team gate rather than adding to it:
    // last season's teams are all active=false, so ANDing the two would always
    // resolve to nobody — a silent empty send, the exact failure this feature
    // exists to avoid.
    const seasonScope = (qb) => (opts.season ? qb.where('t.season', opts.season) : qb.where('t.active', true))

    if (functions.includes('coach')) {
      const rows = await seasonScope(
        database('teams_coaches as tc').join('teams as t', 't.id', 'tc.teams_id'),
      ).select('tc.members_id as id')
      rows.forEach(r => staff.add(r.id))
    }
    if (functions.includes('team_responsible')) {
      const rows = await seasonScope(
        database('teams_responsibles as tr').join('teams as t', 't.id', 'tr.teams_id'),
      ).select('tr.members_id as id')
      rows.forEach(r => staff.add(r.id))
    }
    if (functions.includes('captain')) {
      const rows = await (opts.season
        ? database('teams').where('season', opts.season)
        : database('teams').where('active', true)
      ).whereNotNull('captain').select('captain as id')
      rows.forEach(r => staff.add(r.id))
    }
    // The junctions carry no activity flag of their own, so gate on the member
    // row — kscw_membership_active, per the fn:/qual: rule above (the team
    // itself was already filtered on t.active).
    if (staff.size > 0) {
      const rows = await database('members').whereIn('id', [...staff]).where('kscw_membership_active', true).select('id')
      rows.forEach(r => ids.add(r.id))
    }
  }

  return [...ids]
}

/**
 * Per-team audience sizes for the club mailbox's group picker.
 *
 * Deliberately NOT resolveMemberAudience() in a loop — that would be 4 queries
 * per team (~120 for 29 active teams) to render one dropdown. Five queries
 * total instead, applying the same membership gate the 'teams' branch does, so
 * the number shown in the picker is the number that gets mailed.
 */
export async function teamAudienceCounts(database) {
  // `gender` rides along purely for display: the picker groups the ~29 team
  // chips by sport then gender, which is the only way that row stays scannable.
  const teams = await database('teams').where('active', true).select('id', 'name', 'sport', 'gender').orderBy('name')
  if (teams.length === 0) return []
  const teamIds = teams.map(t => t.id)
  const [players, coaches, trs, captains, active] = await Promise.all([
    database('member_teams').whereIn('team', teamIds).select('member', 'team'),
    database('teams_coaches').whereIn('teams_id', teamIds).select('members_id', 'teams_id'),
    database('teams_responsibles').whereIn('teams_id', teamIds).select('members_id', 'teams_id'),
    database('teams').whereIn('id', teamIds).whereNotNull('captain').select('id', 'captain'),
    database('members').where('kscw_membership_active', true).select('id'),
  ])
  const activeIds = new Set(active.map(r => r.id))
  const perTeam = new Map(teamIds.map(id => [id, new Set()]))
  const add = (teamId, memberId) => {
    if (!memberId || !activeIds.has(memberId)) return
    perTeam.get(teamId)?.add(memberId)
  }
  for (const r of players) add(r.team, r.member)
  for (const r of coaches) add(r.teams_id, r.members_id)
  for (const r of trs) add(r.teams_id, r.members_id)
  for (const r of captains) add(r.id, r.captain)
  return teams.map(t => ({ id: t.id, name: t.name, sport: t.sport, gender: t.gender, count: perTeam.get(t.id)?.size ?? 0 }))
}

/**
 * The fixed (non-team) groups the club mailbox offers, in display order.
 *
 * `key` is stable and is what the frontend translates — labels are NOT returned
 * from here, because every user-facing string belongs in i18n (5 locales) and
 * this module has no locale context.
 */
// `section` groups chips in the UI. `source: 'clubdesk'` reads the ClubDesk
// contact register instead of `members` — see resolveClubdeskRecipients.
export const MAILBOX_GROUPS = [
  { key: 'all', section: 'everyone', spec: { audience_type: 'all_members' } },
  // Sektion vs sport are NOT the same audience and both are wanted. Sektion is
  // the club's own structure (everyone filed under Volleyball: players, coaches,
  // staff, passive members, people between teams — 279 on prod); sport is
  // players on an active team this season (200). Offering only the latter, as
  // this first did, silently drops 79 volleyball people from "email volleyball".
  { key: 'sektion:volleyball', section: 'sektion', spec: { audience_type: 'sektion', audience_sektion: 'Volleyball' } },
  { key: 'sektion:basketball', section: 'sektion', spec: { audience_type: 'sektion', audience_sektion: 'Basketball' } },
  // The club-level section — members filed under neither sport (110 on prod),
  // who belong to no sport chip at all and were previously unreachable except
  // via "All members".
  { key: 'sektion:kscw', section: 'sektion', spec: { audience_type: 'sektion', audience_sektion: 'KSCW' } },
  { key: 'sport:volleyball', section: 'players', spec: { audience_type: 'sport', audience_sport: 'volleyball' } },
  { key: 'sport:basketball', section: 'players', spec: { audience_type: 'sport', audience_sport: 'basketball' } },
  { key: 'fn:coach', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['fn:coach'] } },
  { key: 'fn:team_responsible', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['fn:team_responsible'] } },
  { key: 'fn:captain', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['fn:captain'] } },
  { key: 'qual:scorer_vb', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['qual:scorer_vb'] } },
  { key: 'qual:referee_vb', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['qual:referee_vb'] } },
  { key: 'qual:referee_bb', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['qual:referee_bb'] } },
  // All BB officials: the coarse otn_bb flag AND the two levels — migration 228
  // split them and the 6 pre-split holders only have the coarse one, so naming
  // just the levels would drop them.
  { key: 'qual:officials_bb', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['qual:otr1_bb', 'qual:otr2_bb', 'qual:otn_bb', 'qual:otn1_bb', 'qual:otn2_bb'] } },
  { key: 'role:vorstand', section: 'roles', spec: { audience_type: 'roles', audience_roles: ['role:vorstand'] } },
  // ⚠ The ONLY group not sourced from `members`. Former members are not member
  // rows — ClubDesk holds 428 of them and wiedisync holds none once the stale
  // active flags are cleared — so this reads the contact register directly.
  //
  // ⚠ Two consequences the caller must not forget: these contacts have no
  // email_notify_announcements column, so there is NO per-person opt-out to
  // honour (only the List-Unsubscribe header), and the addresses are cold —
  // people who left as long ago as 2018. Bounces from this group land on the
  // same SES identity that sends password resets, invitations and expense mail.
  // Bounce/complaint handling is the outstanding follow-up (SECURITY/DEVLOG).
  { key: 'former_members', section: 'former', source: 'clubdesk', status: 'Ehemaliges Mitglied' },
]

/**
 * Resolve an audience descriptor to member IDs.
 *
 * `spec` is the announcement row shape ({ audience_type, audience_sport,
 * audience_teams, audience_roles }) so the hook can pass a row straight in; the
 * mailbox builds the same shape from its group picker. `label` is only used to
 * tag warnings.
 *
 * An explicit switch, not an `!== 'all'` fallthrough: the old shape sent every
 * non-'all' type down the sport branch, so a teams/roles post found no
 * audience_sport, returned [], and was stamped fanned-out having mailed nobody.
 * Every path must resolve deliberately, and an unrecognised type must fail
 * closed rather than land in a neighbouring branch.
 */
export async function resolveMemberAudience(database, log, spec, label = 'audience', opts = {}) {
  switch (spec.audience_type) {
    case 'all': {
      const rows = await database('members').where('wiedisync_active', true).select('id')
      return rows.map(r => r.id).filter(Boolean)
    }
    // Every CLUB member, not every app user. 'all' above means the latter —
    // right for an announcement, which is a post in an app you must be able to
    // open, but wrong for email: on prod that is 204 of 695 active members, so
    // a mailbox group labelled "All members" would quietly reach 29% of the
    // club. Kept as its own type rather than loosening 'all', which would
    // silently widen every existing audience_type='all' announcement.
    //
    // Membership is taken from the ClubDesk register (the club's legal member
    // list), not from kscw_membership_active alone, because the two drift and
    // this group is what a GV invitation goes to — the register is what decides
    // who is a member. Measured 2026-08-03: the flag alone gives 695, of which
    // 19 are people ClubDesk records as 'Ehemaliges Mitglied' (all paying
    // 'Kein Beitrag', 16 with no roster spot) who would have been invited to a
    // general assembly they left the club before. The register gives 671.
    //
    // ⚠ The drift runs BOTH ways — 4 people ClubDesk calls 'Kein Mitglied' hold
    // active roster spots and real fee categories. They are deliberately out of
    // this group (a non-member does not vote at the GV) but they are NOT a data
    // error to "fix" by flipping them to member.
    case 'all_members': {
      const rows = await database('members as m')
        .join('clubdesk_people as cp', database.raw('cp.clubdesk_id::text = m.clubdesk_id::text'))
        .where('m.kscw_membership_active', true)
        .whereIn('cp.status', MEMBER_REGISTER_STATUSES)
        .distinct('m.id')
        .select('m.id')
      return rows.map(r => r.id).filter(Boolean)
    }
    case 'sport': {
      // Sport-scoped fanout REQUIRES an explicit sport. A null audience_sport
      // must NOT fall through to the all-members blast — return an empty
      // audience so the caller completes without club-wide mail.
      if (!spec.audience_sport) {
        log?.warn?.({ msg: `[${label}] audience_type=sport but audience_sport is null — skipping fanout` })
        return []
      }
      // Reach EVERY member on an ACTIVE team of that sport in the current
      // season, regardless of wiedisync_active. Club-wide sport comms
      // (tournaments, discounts, federation news) should hit the whole sport,
      // not just app opt-ins — but NOT ex-members or archived-season rosters
      // (member_teams/teams have no season guard otherwise).
      const rows = await database('member_teams as mt')
        .join('teams as t', 't.id', 'mt.team')
        .join('members as m', 'm.id', 'mt.member')
        .where('t.sport', spec.audience_sport)
        // See the note in membersWithRoleTokens: season REPLACES the active
        // gate, it does not narrow it — an archived season has active=false.
        .where(function () { if (opts.season) this.where('t.season', opts.season); else this.where('t.active', true) })
        .where('m.kscw_membership_active', true)
        .distinct('m.id')
        .select('m.id')
      return rows.map(r => r.id).filter(Boolean)
    }
    // A whole club section (members.sektion), inside the register. Broader than
    // 'sport' on purpose: 'sport' walks active rosters and so reaches players
    // only, while a section holds its coaches, staff, passive members and
    // everyone currently between teams too.
    case 'sektion': {
      if (!spec.audience_sektion) {
        log?.warn?.({ msg: `[${label}] audience_type=sektion but audience_sektion is null — skipping fanout` })
        return []
      }
      const rows = await database('members as m')
        .join('clubdesk_people as cp', database.raw('cp.clubdesk_id::text = m.clubdesk_id::text'))
        .where('m.kscw_membership_active', true)
        .whereIn('cp.status', MEMBER_REGISTER_STATUSES)
        .where('m.sektion', spec.audience_sektion)
        .distinct('m.id')
        .select('m.id')
      return rows.map(r => r.id).filter(Boolean)
    }
    case 'teams': {
      const teamIds = parseJsonArray(spec.audience_teams).map(Number).filter(Number.isFinite)
      if (teamIds.length === 0) {
        log?.warn?.({ msg: `[${label}] audience_type=teams but audience_teams is empty — skipping fanout` })
        return []
      }
      const candidates = await membersOnTeams(database, teamIds)
      if (candidates.length === 0) return []
      // Same activity gate as the sport branch: a targeted team's whole roster,
      // app opt-in or not, but never ex-members.
      const rows = await database('members')
        .whereIn('id', candidates)
        .where('kscw_membership_active', true)
        .select('id')
      return rows.map(r => r.id).filter(Boolean)
    }
    case 'roles': {
      const tokens = parseJsonArray(spec.audience_roles)
      if (tokens.length === 0) {
        log?.warn?.({ msg: `[${label}] audience_type=roles but audience_roles is empty — skipping fanout` })
        return []
      }
      // The activity gate is per-namespace, not per-audience-type — role:* is
      // an app concept (wiedisync_active), fn:*/qual:* are real-world ones
      // (kscw_membership_active). See membersWithRoleTokens.
      return await membersWithRoleTokens(database, log, tokens, opts)
    }
    default: {
      log?.warn?.({ msg: `[${label}] unrecognised audience_type "${spec.audience_type}" — skipping fanout` })
      return []
    }
  }
}

/**
 * Recipients drawn from the ClubDesk contact register rather than `members`.
 *
 * Exists for one audience: former members. They are not member rows — the club
 * carries 428 of them in ClubDesk and (once the stale active flags are cleared)
 * none in wiedisync — so there is nothing to resolve to a member ID.
 *
 * ⚠ Returns the SAME shape as the members path so the caller can union and
 * dedupe the two, but the guarantees differ and the difference matters:
 *
 *   - There is no `email_notify_announcements` here, so no per-person opt-out
 *     exists to honour. The List-Unsubscribe header is the only opt-out these
 *     recipients get.
 *   - `status='Verstorben'` is excluded explicitly. It is a single row today,
 *     and mailing it is the kind of mistake a club does not get to take back.
 *   - The addresses are cold (departures back to 2018), so this is the audience
 *     most likely to bounce, on the same SES identity that carries password
 *     resets and invitations.
 */
/**
 * Resolve explicitly-picked addresses back to register contacts.
 *
 * The composer lets an operator expand an audience into individual chips and
 * drop the ones they don't want; what comes back is a list of plain addresses.
 * An address arriving from a client is NOT a recipient. Accepting it verbatim
 * would turn an admin-only club endpoint into a general-purpose mail relay that
 * merely happens to be authenticated — and one that sends with the club's SES
 * identity, the same identity that carries password resets.
 *
 * So every address is matched back against the ClubDesk register and anything
 * unknown is dropped rather than mailed. Callers get back the register's own
 * name for the contact, so the merge fields stay trustworthy too.
 */
export async function resolveRegisterEmails(database, emails) {
  const wanted = [...new Set(
    (emails || []).map(e => String(e || '').trim().toLowerCase()).filter(Boolean),
  )]
  if (wanted.length === 0) return []
  const rows = await database('clubdesk_people')
    .whereNot('status', 'Verstorben')
    .whereNotNull('email')
    .whereIn(database.raw('LOWER(BTRIM(email))'), wanted)
    .select('clubdesk_id', 'email', 'vorname', 'nachname')
  return rows.map(r => ({
    id: `cd:${r.clubdesk_id}`,
    email: String(r.email).trim(),
    first_name: r.vorname || '',
    last_name: r.nachname || '',
  }))
}

export async function resolveClubdeskRecipients(database, status) {
  const rows = await database('clubdesk_people')
    .where('status', status)
    .whereNot('status', 'Verstorben')
    .whereNotNull('email')
    .whereRaw("BTRIM(email) <> ''")
    .select('clubdesk_id', 'email', 'vorname', 'nachname')
  return rows.map(r => ({
    id: `cd:${r.clubdesk_id}`,
    email: String(r.email).trim(),
    first_name: r.vorname || '',
    last_name: r.nachname || '',
  }))
}
