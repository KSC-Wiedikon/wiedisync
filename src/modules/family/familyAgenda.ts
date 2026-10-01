/**
 * Family view data — the next weeks of games, trainings and events for every
 * member this login answers for (migration 348 households), in ONE list.
 *
 * ⚠ Every read goes out with that child's acting header (`actAs`), never
 * through the app-wide switch. The server resolves each request AS the child —
 * same grant check, same policies, same rows she would see after switching —
 * so this file adds no visibility of its own. The parent's own activities are
 * NOT here: Home already shows them, with her coach seats, which this per-child
 * pipeline does not know about.
 *
 * Scope mirrors Home's "my next appointments" (active teams + called-up games
 * + team / club-wide / personally-invited events), deliberately not wider.
 */
import { fetchItems } from '../../lib/api'
import { relId } from '../../utils/relations'
import { isGuestExcludedFromEvent } from '../events/eventHelpers'
import type { Participation } from '../../types'

export const FAMILY_HORIZON_DAYS = 21

export type FamilyKind = 'game' | 'training' | 'event'

export interface FamilyPerson {
  /** members.id as a string. */
  memberId: string
  /** Acting header value (members.id). */
  actAs: number
  firstName: string
  name: string
  photo: string | null
  accent: string | null
}

export interface FamilyItem {
  key: string
  kind: FamilyKind
  id: string
  person: FamilyPerson
  date: string
  /** 'HH:MM' or '' (all-day events). */
  time: string
  title: string
  /** Home/away for games, rendered as a TeamPair. */
  home?: string
  away?: string
  emphasis?: 'home' | 'away'
  teamName: string
  place: string
  respondBy: string
  /** Decline needs a note (the event's / training's own flag). */
  noteRequired: boolean
  allowMaybe: boolean
  /** Event answered per day / per session — not answerable inline. */
  perDay: boolean
  /** The member's guest tier is not invited to this one. */
  excluded: boolean
  /** Every row for this activity (all members) — totals inside the buttons. */
  participations: Participation[]
  /** The member's own whole-activity row, if any. */
  mine: Participation | null
}

interface TeamRow {
  team: { id: string | number; name?: string } | string | number
  guest_level?: number | null
}

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : '')

/** "YYYY-MM-DD" n days after `iso` (calendar arithmetic, no time zone drift). */
export function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

export async function loadFamilyAgenda(person: FamilyPerson, today: string): Promise<FamilyItem[]> {
  const scope = { actAs: person.actAs }
  const until = plusDays(today, FAMILY_HORIZON_DAYS)
  const memberId = person.memberId

  // Gate on the TEAM being active, not member_teams.season (see HomePage).
  const teamRows = await fetchItems<TeamRow>('member_teams', {
    filter: { _and: [{ member: { _eq: memberId } }, { team: { active: { _eq: true } } }] },
    fields: ['guest_level', 'team.id', 'team.name'],
    limit: -1,
    ...scope,
  })
  const teams = new Map<string, { name: string; guestLevel: number }>()
  for (const r of teamRows) {
    const id = relId(r.team)
    if (!id) continue
    const obj = typeof r.team === 'object' ? r.team : null
    teams.set(id, {
      name: obj?.name ?? '',
      guestLevel: Number(r.guest_level ?? 0),
    })
  }
  const teamIds = [...teams.keys()]
  const guestLevel = (teamId: string) => teams.get(teamId)?.guestLevel ?? 0

  // Junction-first, never a filter walking the M2M alias the policy also walks
  // (CLAUDE.md → "M2M deep filter + policy walk = silent empty").
  const [guestRows, teamEventRows, invitedRows] = await Promise.all([
    fetchItems<{ game: string | number }>('game_guests', {
      filter: { member: { _eq: memberId } }, fields: ['game'], limit: -1, ...scope,
    }),
    teamIds.length
      ? fetchItems<{ events_id: string | number }>('events_teams', {
          filter: { teams_id: { _in: teamIds } }, fields: ['events_id'], limit: -1, ...scope,
        })
      : Promise.resolve([]),
    fetchItems<{ events_id: string | number }>('events_members', {
      filter: { members_id: { _eq: memberId } }, fields: ['events_id'], limit: -1, ...scope,
    }),
  ])
  const guestGameIds = [...new Set(guestRows.map((r) => relId(r.game)).filter(Boolean))]
  const eventIds = [...new Set([...teamEventRows, ...invitedRows].map((r) => relId(r.events_id)).filter(Boolean))]

  const gameScope: Record<string, unknown>[] = []
  if (teamIds.length) gameScope.push({ kscw_team: { _in: teamIds } })
  if (guestGameIds.length) gameScope.push({ id: { _in: guestGameIds } })

  const [games, trainings, events] = await Promise.all([
    gameScope.length
      ? fetchItems<Record<string, unknown>>('games', {
          filter: { _and: [
            { status: { _eq: 'scheduled' } },
            { date: { _gte: today } },
            { date: { _lte: until } },
            { away_team: { _nnull: true } },
            gameScope.length === 1 ? gameScope[0] : { _or: gameScope },
          ] },
          fields: ['id', 'date', 'time', 'home_team', 'away_team', 'type', 'kscw_team', 'respond_by', 'hall.name', 'away_hall_json'],
          sort: ['date', 'time'],
          limit: -1,
          ...scope,
        })
      : Promise.resolve([]),
    teamIds.length
      ? fetchItems<Record<string, unknown>>('trainings', {
          filter: { _and: [
            { team: { _in: teamIds } },
            { date: { _gte: today } },
            { date: { _lte: until } },
            { cancelled: { _eq: false } },
          ] },
          fields: ['id', 'date', 'start_time', 'team', 'hall.name', 'hall_name', 'respond_by', 'require_note_if_absent', 'excluded_guest_levels'],
          sort: ['date', 'start_time'],
          limit: -1,
          ...scope,
        })
      : Promise.resolve([]),
    fetchItems<Record<string, unknown>>('events', {
      filter: { _and: [
        { end_date: { _gte: today } },
        { start_date: { _lte: `${until}T23:59:59` } },
        { cancelled: { _eq: false } },
        { _or: [
          { teams: { _null: true } },
          { id: { _in: eventIds.length ? eventIds : [-1] } },
        ] },
      ] },
      fields: ['id', 'title', 'start_date', 'all_day', 'location', 'respond_by', 'participation_mode', 'require_note_if_absent', 'allow_maybe', 'invite_guests', 'teams.teams_id', 'invited_members.members_id'],
      sort: ['start_date'],
      limit: -1,
      ...scope,
    }),
  ])

  const items: FamilyItem[] = []
  const base = { person, participations: [] as Participation[], mine: null }

  for (const g of games) {
    const teamId = relId(g.kscw_team as string)
    const hall = (g.hall as { name?: string } | null)?.name
      ?? (g.away_hall_json as { name?: string } | null)?.name ?? ''
    const calledUp = guestGameIds.includes(String(g.id))
    items.push({
      ...base,
      key: `${memberId}:game:${g.id}`,
      kind: 'game',
      id: String(g.id),
      date: String(g.date ?? '').slice(0, 10),
      time: hhmm(g.time as string),
      title: `${g.home_team} – ${g.away_team}`,
      home: String(g.home_team ?? ''),
      away: String(g.away_team ?? ''),
      emphasis: g.type === 'away' ? 'away' : 'home',
      teamName: teams.get(teamId)?.name ?? '',
      place: hall,
      respondBy: String(g.respond_by ?? ''),
      // No game surface enforces the team's game_require_note_if_absent switch
      // today, so this one does not invent it either.
      noteRequired: false,
      allowMaybe: true,
      perDay: false,
      // Same rule as GameCard: a guest on the fixture's team does not answer
      // it — unless she was called up to this very game.
      excluded: !calledUp && guestLevel(teamId) > 0,
    })
  }

  for (const tr of trainings) {
    const teamId = relId(tr.team as string)
    const excludedLevels = Array.isArray(tr.excluded_guest_levels) ? (tr.excluded_guest_levels as unknown[]).map(Number) : []
    const lvl = guestLevel(teamId)
    items.push({
      ...base,
      key: `${memberId}:training:${tr.id}`,
      kind: 'training',
      id: String(tr.id),
      date: String(tr.date ?? '').slice(0, 10),
      time: hhmm(tr.start_time as string),
      title: teams.get(teamId)?.name ?? '',
      teamName: teams.get(teamId)?.name ?? '',
      place: (tr.hall as { name?: string } | null)?.name ?? String(tr.hall_name ?? ''),
      respondBy: String(tr.respond_by ?? ''),
      // The training's own column — the team setting is only its create-time default.
      noteRequired: !!tr.require_note_if_absent,
      allowMaybe: true,
      perDay: false,
      excluded: lvl > 0 && excludedLevels.includes(lvl),
    })
  }

  for (const ev of events) {
    const start = String(ev.start_date ?? '')
    const mode = String(ev.participation_mode ?? '')
    items.push({
      ...base,
      key: `${memberId}:event:${ev.id}`,
      kind: 'event',
      id: String(ev.id),
      date: start.slice(0, 10),
      time: ev.all_day ? '' : start.slice(11, 16),
      title: String(ev.title ?? ''),
      teamName: '',
      place: String(ev.location ?? ''),
      respondBy: String(ev.respond_by ?? ''),
      noteRequired: !!ev.require_note_if_absent,
      allowMaybe: ev.allow_maybe !== false,
      perDay: mode === 'per_day' || mode === 'per_session',
      excluded: isGuestExcludedFromEvent(
        ev as { invite_guests?: boolean; teams?: unknown[] | null; invited_members?: unknown[] | null },
        { memberId, memberTeamIds: teamIds, getGuestLevel: guestLevel },
      ),
    })
  }

  if (items.length === 0) return items

  // All rows of these activities (totals inside the buttons), read as the child.
  const idsByType = new Map<FamilyKind, string[]>()
  for (const it of items) idsByType.set(it.kind, [...(idsByType.get(it.kind) ?? []), it.id])
  const groups = [...idsByType.entries()].map(([type, ids]) => ({
    _and: [{ activity_type: { _eq: type } }, { activity_id: { _in: ids } }],
  }))
  const rows = await fetchItems<Participation>('participations', {
    filter: groups.length === 1 ? groups[0] : { _or: groups },
    limit: -1,
    ...scope,
  })
  const byActivity = new Map<string, Participation[]>()
  for (const p of rows) {
    const k = `${p.activity_type}:${p.activity_id}`
    byActivity.set(k, [...(byActivity.get(k) ?? []), p])
  }
  for (const it of items) {
    it.participations = byActivity.get(`${it.kind}:${it.id}`) ?? []
    it.mine = it.participations.find((p) => String(p.member) === memberId && !p.session_id) ?? null
  }
  return items
}
