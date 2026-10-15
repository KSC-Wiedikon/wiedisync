/**
 * Sport-scoped permission rows — the `KSCW Sport Admin VB` / `KSCW Sport Admin BB`
 * policies (2026-10-11 audit M7; owner decision 2026-10-12: "enforce server side",
 * sport data only).
 *
 * WHY A MODULE
 * ------------
 * setup-permissions.mjs runs main() on import, so it cannot be unit-tested or
 * reused. These rows are imported by it AND by the dev-container harness that
 * proves them against Directus's own permission engine (/items is licence-locked
 * on dev, so the REST smoke cannot). One definition, both callers.
 *
 * THE MODEL
 * ---------
 * A vb_admin / bb_admin (every board member below full admin holds one, migration
 * 402/403) is confined to their sport. Until 2026-10-12 the `KSCW Sport Admin`
 * policy granted every one of these collections club-wide and the UI did the
 * scoping. Directus cannot tell two holders of one policy apart, so each sport
 * now has its own policy, attached PER USER from members.role (setup-permissions
 * §13, the kscw-hooks role sync), and the rows below carry the sport filter:
 *
 *   - team-bound rows        → the team's `sport` (an M2O hop)
 *   - member-bound rows      → members.sport_section (migration 406, stored)
 *   - events                 → events.sport_section (migration 406, stored)
 *   - a section of 'both'    → visible to both (club-level / dual / unknown —
 *                              member-sport.js explains why that is deliberate)
 *
 * Every filter is a scalar or an M2O hop on purpose: a policy filter that walks
 * an M2M/O2M alias silently empties a frontend query through the same junction
 * (CLAUDE.md, "M2M deep filter + policy walk").
 *
 * What stays on the shared `KSCW Sport Admin` policy (club-wide): board and
 * club-level work — forms, email wording, announcements, news, sponsors, halls,
 * hall closures/events, rankings, game scheduling, the sport tooling tables,
 * households, the audit log, files (folder-scoped), member CREATE, team
 * create/read. The board's `KSCW Vorstand` policy keeps finance, forms, email,
 * announcements, households, audit log and game scheduling; its sport-data
 * reads moved here.
 *
 * CREATE rows carry no filter: Directus has no existing row to match on create.
 * Creates are scoped by the kscw-hooks guards (actorLeadsTeam and the sport
 * create/move guard). A confined admin who also coaches a team of the other
 * sport keeps that team through the LEADER policy — Directus unions policies.
 */

export const SPORT_POLICIES = [
  { sport: 'volleyball', name: 'KSCW Sport Admin VB', appRole: 'vb_admin', label: 'SPORT ADMIN VB', icon: 'sports_volleyball' },
  { sport: 'basketball', name: 'KSCW Sport Admin BB', appRole: 'bb_admin', label: 'SPORT ADMIN BB', icon: 'sports_basketball' },
]

/**
 * Collections that left the shared Sport Admin policy for the per-sport ones.
 * setup-permissions.mjs asserts none of them is granted club-wide again.
 */
export const SPORT_SCOPED_COLLECTIONS = [
  'games', 'trainings', 'events', 'event_sessions', 'events_teams', 'events_members',
  'member_teams', 'teams_coaches', 'teams_responsibles',
  'participations', 'absences', 'game_guests', 'game_guest_teams',
  'hall_slots', 'hall_slots_teams', 'slot_claims',
  'notifications', 'push_subscriptions', 'scorer_delegations',
  'team_invites', 'team_requests', 'polls', 'poll_votes', 'registrations',
  'referee_expenses', 'fines', 'fine_rules', 'scheduling_blocks',
  'sv_vm_check',
]

/** Sport-data reads the board's `KSCW Vorstand` policy no longer grants. */
export const VORSTAND_SPORT_DATA = [
  'member_teams', 'participations', 'absences', 'game_guests', 'game_guest_teams',
  'notifications', 'scorer_delegations', 'team_invites', 'team_requests',
  'push_subscriptions', 'fines', 'fine_rules', 'referee_expenses', 'scheduling_blocks',
  'members', 'poll_votes',
]

const SECTION = (sport) => ({ _in: [sport, 'both'] })

/** Rows of a team of this sport. `nullable` admits rows with no team (club-level). */
function teamIs(sport, field, nullable) {
  const own = { [field]: { sport: { _eq: sport } } }
  return nullable ? { _or: [own, { [field]: { _null: true } }] } : own
}

/** Rows of a member whose stored section is this sport or 'both'. */
const memberIn = (sport, field = 'member') => ({ [field]: { permissions_section: SECTION(sport) } })

/** A game of this sport's team, or a game with no club team (2 rows on prod). */
const gameIs = (sport) => teamIs(sport, 'kscw_team', true)

/**
 * @param {'volleyball'|'basketball'} sport
 * @param {object} ctx
 * @param {string[]} ctx.memberReadFields   members READ field list (all but secrets)
 * @param {string[]} ctx.memberWriteFields  members UPDATE field list (also no derived)
 * @param {string[]} ctx.eventWriteFields   events CREATE/UPDATE field list
 * @param {object}   ctx.refereeUnpaid      referee_expenses update/delete row filter
 * @returns {Array<{collection: string, action: string, permissions: object|null, fields: string[]|null}>}
 */
export function sportScopedPermissions(sport, ctx) {
  if (sport !== 'volleyball' && sport !== 'basketball') throw new Error(`unknown sport ${sport}`)
  const rows = []
  const add = (collection, action, permissions = null, fields = null) =>
    rows.push({ collection, action, permissions, fields })
  /** create (no filter) + read/update/delete with `filter`. */
  const crud = (collection, filter) => {
    add(collection, 'create')
    for (const action of ['read', 'update', 'delete']) add(collection, action, filter)
  }

  crud('games', gameIs(sport))
  crud('trainings', teamIs(sport, 'team', true))
  crud('game_guests', { game: gameIs(sport) })
  crud('game_guest_teams', { game: gameIs(sport) })
  crud('scorer_delegations', { game: gameIs(sport) })

  // events: create/update field-scoped (endpoint-owned + derived columns out).
  add('events', 'create', null, ctx.eventWriteFields)
  add('events', 'read', { permissions_section: SECTION(sport) })
  add('events', 'update', { permissions_section: SECTION(sport) }, ctx.eventWriteFields)
  add('events', 'delete', { permissions_section: SECTION(sport) })
  crud('event_sessions', { event: { permissions_section: SECTION(sport) } })
  crud('events_teams', teamIs(sport, 'teams_id', false))
  crud('events_members', { events_id: { permissions_section: SECTION(sport) } })

  crud('member_teams', teamIs(sport, 'team', false))
  crud('teams_coaches', teamIs(sport, 'teams_id', false))
  crud('teams_responsibles', teamIs(sport, 'teams_id', false))
  crud('team_invites', teamIs(sport, 'team', false))
  crud('team_requests', teamIs(sport, 'team', true))
  crud('polls', teamIs(sport, 'team', false))
  // poll_votes: non-anonymous polls only for reading (2026-07-02 audit #5/#14);
  // anonymous results come as counts from /kscw/polls/:id/results.
  add('poll_votes', 'create')
  add('poll_votes', 'read', { poll: { _and: [{ anonymous: { _eq: false } }, teamIs(sport, 'team', false)] } })
  add('poll_votes', 'update', { poll: teamIs(sport, 'team', false) })
  add('poll_votes', 'delete', { poll: teamIs(sport, 'team', false) })

  // A member's RSVP to a game/training is theirs; an event RSVP also counts for
  // the event's section, so a club event's admin sees every answer to it.
  crud('participations', { _or: [memberIn(sport), { event: { permissions_section: SECTION(sport) } }] })
  crud('absences', memberIn(sport))
  crud('notifications', memberIn(sport))
  crud('push_subscriptions', memberIn(sport))

  crud('hall_slots', { _or: [{ sport: { _eq: sport } }, { sport: { _null: true } }] })
  crud('hall_slots_teams', teamIs(sport, 'teams_id', false))
  crud('slot_claims', teamIs(sport, 'claimed_by_team', true))

  // Registrations: the applicant's chosen section; passive / unset is club-level.
  crud('registrations', {
    _or: [
      { membership_type: { _eq: sport } },
      { membership_type: { _nin: ['volleyball', 'basketball'] } },
      { membership_type: { _null: true } },
    ],
  })

  // referee_expenses: update/delete only while unpaid (migration 363).
  add('referee_expenses', 'create')
  add('referee_expenses', 'read', teamIs(sport, 'team', true))
  add('referee_expenses', 'update', { _and: [teamIs(sport, 'team', true), ctx.refereeUnpaid] })
  add('referee_expenses', 'delete', { _and: [teamIs(sport, 'team', true), ctx.refereeUnpaid] })

  crud('fines', teamIs(sport, 'team', true))
  crud('fine_rules', teamIs(sport, 'team', true))
  crud('scheduling_blocks', teamIs(sport, 'team', true))

  // Members: the full register of the own section (AHV, IBAN, address …); the
  // other section is read through the Member policy's club-public field list.
  // No CREATE here — that stays on the shared policy (a new member has no section
  // yet). No DELETE anywhere (POST /kscw/admin/delete-member, sport-gated).
  add('members', 'read', { permissions_section: SECTION(sport) }, ctx.memberReadFields)
  add('members', 'update', { permissions_section: SECTION(sport) }, ctx.memberWriteFields)
  // Teams: read and create stay shared; editing is the own sport's teams only.
  add('teams', 'update', { sport: { _eq: sport } })

  // Swiss Volley licence mirror (names, e-mail, birthdate) — volleyball only;
  // /admin/transfers, its one reader, is volleyball-only too.
  if (sport === 'volleyball') {
    add('sv_vm_check', 'create')
    for (const action of ['read', 'update', 'delete']) add('sv_vm_check', action)
  }

  return rows
}
