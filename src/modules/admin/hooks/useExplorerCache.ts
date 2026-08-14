import { useCallback, useEffect, useState } from 'react'
import { fetchAllItems, kscwApi } from '../../../lib/api'
import type { Member, Team, Event as EventRec, Training, Game } from '../../../types'
import type {
  ExplorerScope, CacheShape, MemberTeamRow, StaffRow, ClubdeskInfo,
  ClubdeskSyncStatus, RegFileInfo, RegFileDoc,
} from '../components/explorerHelpers'
import { buildMemberTeamsMap, buildStaffMap } from '../components/explorerHelpers'

// Registration document columns retained after approval (mirrors the backend
// SELF_DOC_FIELDS / REGISTRATION_FILE_COLS). Drives the "Reg. files" column.
const REG_DOC_FIELDS = [
  'id_upload_front', 'id_upload_back',
  'bb_doc_lizenz', 'bb_doc_freibrief', 'bb_doc_selfdecl',
  'bb_doc_natdecl', 'bb_doc_u18parents', 'bb_doc_schoolcert',
] as const

export interface CacheFilters {
  members: Record<string, unknown> | undefined
  teams: Record<string, unknown>
  events: Record<string, unknown> | undefined
  trainings: Record<string, unknown>
  games: Record<string, unknown> | undefined
}

/** Build Directus filter objects per bucket based on sport scope. */
export function buildFilters(scope: ExplorerScope): CacheFilters {
  const teams: Record<string, unknown> = { active: { _eq: true } }
  const trainings: Record<string, unknown> = {}
  let events: Record<string, unknown> | undefined = undefined
  let games: Record<string, unknown> | undefined = undefined

  if (scope !== 'all') {
    teams.sport = { _eq: scope }
    ;(trainings as { team?: unknown }).team = { sport: { _eq: scope } }
    games = { kscw_team: { sport: { _eq: scope } } }
    events = {
      _or: [
        { teams: { teams_id: { sport: { _eq: scope } } } },
        { teams: { _null: true } },
      ],
    }
  }

  return {
    // ⚠ No `kscw_membership_active` filter. It used to be here, and it meant
    // the page could not answer "who left the club" at all: 22 of 26
    // "Ehemaliges Mitglied" and 12 of 13 "Kein Mitglied" were never fetched, so
    // the tree's former/non-member groups would have shown 4 of 26 and looked
    // complete. The active-only default now lives in `EMPTY_FILTERS` instead —
    // same rows on screen, but it is a filter the operator can see and clear.
    members: undefined,
    teams,
    events,
    trainings,
    games,
  }
}

const EMPTY: CacheShape = {
  members: [], teams: [], events: [], trainings: [], games: [],
  teamLookup: new Map(),
  memberTeams: new Map(), memberTeamRows: [], memberCoachTeams: new Map(), memberTrTeams: new Map(),
  coachRows: [], trRows: [], clubdeskInfo: new Map(),
  clubdeskSync: new Map(), regFiles: new Map(),
  loadedAt: null,
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

function ninetyDaysAgoISO(): string {
  return new Date(Date.now() - NINETY_DAYS_MS).toISOString().slice(0, 10)
}

/**
 * Batched page-load cache: fires 5 parallel fetches and stores the result.
 * Refresh() re-runs the batch. Sport scope is applied via buildFilters.
 * Member-sport filtering for non-'all' scope is done client-side (keep
 * members with ≥ 1 team in scope) to avoid a complex server-side filter.
 */
export function useExplorerCache(scope: ExplorerScope) {
  const [data, setData] = useState<CacheShape>(EMPTY)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const f = buildFilters(scope)
      const cutoff = ninetyDaysAgoISO()
      const [members, teams, allTeams, events, trainings, games, junctions, coachJunctions, trJunctions, clubdeskRows, regRows, syncResp] = await Promise.all([
        fetchAllItems<Member>('members', {
          filter: f.members,
          fields: [
            'id', 'first_name', 'last_name', 'nickname', 'email', 'sex', 'kscw_membership_active', 'role', 'user',
            // Fields used by ExplorerMemberFilters (multiselect/multiselect-chip/tri-state/presence)
            'phone', 'license_nr', 'birthdate', 'photo', 'number', 'position', 'language',
            // Per-flag licence booleans (migration 067) — what the filter reads.
            // otn1_bb/otn2_bb are the OTN levels added by migration 228; the
            // coarse `otn_bb` they replaced was dropped by migration 303.
            'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb', 'referee_bb',
            // Coaching education (migration 274) — comma-separated JS/C/B/A.
            'trainer_licences',
            'birthdate_visibility', 'consent_decision', 'consent_prompted_at',
            'requested_team', 'coach_approved_team', 'is_spielplaner', 'wiedisync_active',
            'shell', 'shell_expires', 'shell_reminder_sent',
            'licence_activated', 'licence_validated', 'licence_category',
            // Club licence-ordering workflow (migration 301). Own-readable +
            // Sport Admin fields='*', which is exactly this page's audience —
            // unlike licence_activation_date below, so these are safe to batch.
            'licence_status', 'licence_status_season',
            'licence_status_updated_at', 'licence_status_by_name',
            // licence_activation_date / licence_validation_date intentionally
            // omitted — admin-only field perms; including them 403s the whole
            // Promise.all batch for Vorstand/Coach/etc. on /admin/explore.
            'hide_phone', 'hide_email', 'website_visible',
            'communications_team_chat_enabled', 'communications_dm_enabled', 'communications_banned',
            'push_preview_content', 'last_online_at',
            'adresse', 'plz', 'ort', 'vm_email', 'ahv_nummer', 'beitragskategorie',
            // Club register status + the dates that bracket it (migration 302).
            // In the same read lists as beitragskategorie above, so batching
            // them here cannot 403 an audience that already gets that column.
            'register_status', 'eintritt', 'austritt',
            // Coded nationality + federation of origin (migrations 223/224).
            // `nationalitaet` is the trigger-derived German name kept for the
            // ClubDesk push — read-only, but still fetched as the display
            // fallback for rows whose codes were never resolved.
            'nationalitaet', 'nationalitaet_codes', 'federation_of_origin',
            // Which Kantonsschule (migration 315). Same read audience as
            // sektion above — admin / sport admin fields='*'.
            'kantonsschule', 'sektion',
            'clubdesk_id',
          ],
          sort: ['last_name', 'first_name'],
        }),
        fetchAllItems<Team>('teams', {
          filter: f.teams,
          fields: ['id', 'name', 'full_name', 'sport', 'gender', 'season', 'active', 'league', 'captain', 'coach', 'team_responsible'],
          sort: ['sport', 'name'],
        }),
        // Label lookup only — every team, active or not, in either sport. A
        // roster row from a closed season points at an inactive team that the
        // scoped fetch above drops, and the member detail then rendered the
        // chip as a bare "#412" (394 active members have such a row on prod).
        // Narrow field set: this never feeds a picker or the tree.
        fetchAllItems<Team>('teams', {
          fields: ['id', 'name', 'full_name', 'sport', 'season', 'active'],
          sort: ['sport', 'name'],
        }).catch(() => [] as Team[]),
        fetchAllItems<EventRec>('events', {
          filter: { _and: [{ end_date: { _gte: cutoff } }, ...(f.events ? [f.events] : [])] },
          fields: ['id', 'title', 'event_type', 'start_date', 'end_date', 'participation_mode', 'teams.teams_id'],
          sort: ['start_date'],
        }),
        fetchAllItems<Training>('trainings', {
          filter: { _and: [{ date: { _gte: cutoff } }, ...(Object.keys(f.trainings).length ? [f.trainings] : [])] },
          fields: ['id', 'team', 'date', 'start_time', 'end_time', 'hall', 'cancelled'],
          sort: ['date'],
        }),
        fetchAllItems<Game>('games', {
          filter: { _and: [{ date: { _gte: cutoff } }, ...(f.games ? [f.games] : [])] },
          fields: [
            'id', 'kscw_team', 'home_team', 'away_team', 'date', 'time', 'hall', 'home_score', 'away_score',
            'scorer_member', 'scoreboard_member', 'scorer_scoreboard_member',
            'bb_scorer_member', 'bb_timekeeper_member', 'bb_24s_official',
          ],
          sort: ['date'],
        }),
        fetchAllItems<{ id: string | number; member: string | number; team: string | number; guest_level: number | null; season: string | null }>('member_teams', {
          fields: ['id', 'member', 'team', 'guest_level', 'season'],
        }),
        fetchAllItems<{ id: string | number; members_id: string | number; teams_id: string | number }>('teams_coaches', {
          fields: ['id', 'members_id', 'teams_id'],
        }).catch(() => [] as { id: string | number; members_id: string | number; teams_id: string | number }[]),
        fetchAllItems<{ id: string | number; members_id: string | number; teams_id: string | number }>('teams_responsibles', {
          fields: ['id', 'members_id', 'teams_id'],
        }).catch(() => [] as { id: string | number; members_id: string | number; teams_id: string | number }[]),
        // Narrow ClubDesk register info (groups → passive/honorary/former flags,
        // officials licence). Policy-gated — caught so viewers without
        // clubdesk_export read (until the perms run lands) just get no flags.
        fetchAllItems<{ clubdesk_id: string | null; gruppen_bracketed: string | null; offiziellen_lizenz: string | null }>('clubdesk_export', {
          fields: ['clubdesk_id', 'gruppen_bracketed', 'offiziellen_lizenz'],
        }).catch(() => [] as { clubdesk_id: string | null; gruppen_bracketed: string | null; offiziellen_lizenz: string | null }[]),
        // Retained registration documents (post-approval), keyed by member.
        // Policy-gated (board/admin read registrations) — caught so sport-admin
        // viewers just get no reg-files column data.
        fetchAllItems<Record<string, unknown>>('registrations', {
          filter: { member: { _nnull: true } },
          fields: ['member', 'reference_number', 'status', ...REG_DOC_FIELDS],
        }).catch(() => [] as Record<string, unknown>[]),
        // Per-member ClubDesk sync verdict (status-only, no PII). 403s for
        // viewers below the sport-admin bar — caught to an empty map.
        kscwApi<{ statuses: Record<string, ClubdeskSyncStatus> }>('/clubdesk-sync-status')
          .catch(() => ({ statuses: {} as Record<string, ClubdeskSyncStatus> })),
      ])

      // Keep raw junction rows (with ids) for the grid's team-membership editing,
      // and derive the memberId → [teamId, ...] map from them.
      const memberTeamRows: MemberTeamRow[] = junctions.map((j) => ({
        id: String(j.id),
        member: String(j.member),
        team: String(j.team),
        guest_level: j.guest_level ?? 0,
        season: j.season ?? null,
      }))
      const memberTeams = buildMemberTeamsMap(memberTeamRows)

      const coachRows: StaffRow[] = coachJunctions.map((j) => ({
        id: String(j.id), member: String(j.members_id), team: String(j.teams_id),
      }))
      const trRows: StaffRow[] = trJunctions.map((j) => ({
        id: String(j.id), member: String(j.members_id), team: String(j.teams_id),
      }))
      const memberCoachTeams = buildStaffMap(coachRows)
      const memberTrTeams = buildStaffMap(trRows)

      const clubdeskInfo = new Map<string, ClubdeskInfo>()
      for (const r of clubdeskRows) {
        if (!r.clubdesk_id) continue
        clubdeskInfo.set(String(r.clubdesk_id), {
          gruppen: r.gruppen_bracketed ?? '',
          offiziellenLizenz: r.offiziellen_lizenz ?? '',
        })
      }

      const clubdeskSync = new Map<string, ClubdeskSyncStatus>()
      for (const [mid, status] of Object.entries(syncResp?.statuses ?? {})) {
        clubdeskSync.set(String(mid), status)
      }

      // Registration files → per-member map. A member can have >1 registration;
      // merge their docs (dedup by file id) and keep the newest reference.
      const regFiles = new Map<string, RegFileInfo>()
      for (const reg of regRows) {
        const mid = reg.member == null ? '' : String(reg.member)
        if (!mid) continue
        const docs: RegFileDoc[] = []
        for (const field of REG_DOC_FIELDS) {
          const fileId = reg[field]
          if (fileId) docs.push({ field, fileId: String(fileId) })
        }
        if (docs.length === 0) continue
        const existing = regFiles.get(mid)
        if (existing) {
          const seen = new Set(existing.docs.map((d) => d.fileId))
          for (const d of docs) if (!seen.has(d.fileId)) existing.docs.push(d)
        } else {
          regFiles.set(mid, {
            referenceNumber: (reg.reference_number as string | null) ?? null,
            status: (reg.status as string | null) ?? null,
            docs,
          })
        }
      }

      // Build teamSportMap for sport-scoping
      const teamSportMap = new Map<string, string>()
      for (const tm of teams) {
        teamSportMap.set(String(tm.id), String((tm as unknown as { sport?: string }).sport ?? ''))
      }

      // Member sport-filter: keep those with ≥1 team in scope (across any role)
      const filteredMembers = scope === 'all'
        ? members
        : members.filter((m) => {
            const mid = String(m.id)
            const allTeamIds = [
              ...(memberTeams.get(mid) ?? []),
              ...(memberCoachTeams.get(mid) ?? []),
              ...(memberTrTeams.get(mid) ?? []),
              ...teams.filter((tm) => String((tm as unknown as { captain?: unknown }).captain) === mid).map((tm) => String(tm.id)),
            ]
            return allTeamIds.some((teamId) => teamSportMap.get(teamId) === scope)
          })

      // Every team by id. `allTeams` is the superset; the scoped `teams` rows
      // are written last so a team present in both keeps the richer field set
      // (captain / coach / league) the scoped fetch asks for.
      const teamLookup = new Map<string, Team>()
      for (const tm of allTeams) teamLookup.set(String(tm.id), tm)
      for (const tm of teams) teamLookup.set(String(tm.id), tm)

      setData({
        members: filteredMembers,
        teams,
        teamLookup,
        events,
        trainings,
        games,
        memberTeams,
        memberTeamRows,
        memberCoachTeams,
        memberTrTeams,
        coachRows,
        trRows,
        clubdeskInfo,
        clubdeskSync,
        regFiles,
        loadedAt: Date.now(),
      })
    } catch (err) {
      setError(err as Error)
    } finally {
      setIsLoading(false)
    }
  }, [scope])

  // Load on mount and whenever the sport scope changes. The call is made from an
  // effect-local async function (React's documented data-fetching shape) so the
  // effect body itself stays free of state updates.
  useEffect(() => {
    async function run() { await load() }
    void run()
  }, [load])

  // Optimistic in-place cache update — the grid applies successful single-cell /
  // junction writes here instead of re-running the full 8-query batch per edit.
  const mutate = useCallback((updater: (prev: CacheShape) => CacheShape) => {
    setData(updater)
  }, [])

  return { data, isLoading, error, refresh: load, mutate }
}
