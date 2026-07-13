import { fetchAllItems, updateRecord, deleteRecord, kscwApi } from '../../../lib/api'
import { getCurrentSeason, formatDateZurich } from '../../../utils/dateHelpers'

export type IssueSeverity = 'error' | 'warning'

export type FixAction = 'update' | 'delete'

/**
 * Stable, locale-independent issue identifier. Drives the translated label
 * (resolved in the component via t()) and the grouping/sort — never group or
 * label off a translated string, or grouping breaks per-locale.
 */
export type IssueKey =
  | 'missingDate'
  | 'missingAwayTeam'
  | 'missingTime'
  | 'nonPaddedTime'
  | 'noTeamAssignment'
  | 'missingSex'
  | 'clubdeskNameMatch'
  | 'clubdeskDeparted'
  | 'clubdeskDrift'
  | 'clubdeskDriftBlocked'
  | 'clubdeskFill'
  | 'clubdeskGroupMissing'
  | 'clubdeskGroupStray'
  | 'clubdeskGroupNoTeam'
  | 'clubdeskNoGroup'
  | 'clubdeskCoachGroup'
  | 'clubdeskFeeNoRoster'
  | 'clubdeskUnmappedTeam'

export interface DataIssue {
  id: string
  collection: string
  field: string
  severity: IssueSeverity
  issueKey: IssueKey
  /** Data-specific descriptor (team/member names, IDs, times) — locale-neutral. */
  detail: string
  autoFixable: boolean
  fixValue?: string
  fixAction?: FixAction
  /**
   * Non-auto fix that needs an admin choice (no single deterministic value).
   * The component renders inline controls and dispatches the matching handler.
   * 'sex' → male/female buttons (manualFix). 'clubdeskLink' → a single "Link"
   * button (linkClubdesk). Excluded from "Fix all".
   */
  manualKind?: 'sex' | 'clubdeskLink' | 'clubdeskDeactivate' | 'clubdeskDriftFlag'
  /** For manualKind 'clubdeskLink': the ClubDesk contact to link to. */
  link?: { clubdeskId: string; clubdeskEmail?: string | null }
  /** For manualKind 'clubdeskDriftFlag' aggregate (fill) rows: all member ids to flag. */
  bulkMemberIds?: number[]
}

export interface CollectionHealth {
  collection: string
  total: number
  issues: DataIssue[]
}

interface ClubdeskDrift {
  member_id: number
  member_name: string
  clubdesk_id: string
  pending: boolean
  conflicts: { field: string; wiedisync: string; clubdesk: string }[]
  fills: { field: string; wiedisync: string }[]
  blank_risk: string[]
}

interface ClubdeskFillAgg {
  count: number
  member_ids: number[]
  at_risk: number
}

interface ClubdeskNameMatch {
  member_id: number
  member_name: string
  member_email: string | null
  clubdesk_id: string
  clubdesk_email: string | null
  clubdesk_licence: string | null
  duplicate_of: { id: number; name: string } | null
}

interface ClubdeskDeparted {
  member_id: number
  member_name: string
  status: string
  austritt: string | null
  current_teams: string[]
}

interface ClubdeskGroupMissing {
  member_id: number
  member_name: string
  clubdesk_id: string
  groups: string[]
}

interface ClubdeskGroupStray {
  member_id: number
  member_name: string
  clubdesk_id: string
  group: string
  active: boolean
  is_official: boolean
  coach_of: string
  tr_of: string
}

interface ClubdeskGroupNoTeam {
  group: string
  count: number
}

// ── Helpers ──

function padTime(time: string): string {
  // "9:00" → "09:00", "8:30" → "08:30"
  const match = time.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return time
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

function gameLabel(record: Record<string, unknown>): string {
  const home = (record['home_team'] as string) || '?'
  const away = (record['away_team'] as string) || '?'
  return `${home} vs ${away}`
}

// ── Checks ──

async function checkGames(): Promise<CollectionHealth> {
  const games = await fetchAllItems<Record<string, unknown>>('games', {
    fields: ['id', 'game_id', 'date', 'time', 'home_team', 'away_team', 'status'],
    sort: ['date', 'time'],
  })

  const issues: DataIssue[] = []

  for (const g of games) {
    const gameId = (g['game_id'] as string) || String(g['id'])
    const date = g['date'] as string
    const time = g['time'] as string
    const awayTeam = g['away_team'] as string
    const status = (g['status'] as string) || ''
    const label = gameLabel(g)
    // Cancelled games may legitimately carry an empty date/time — don't flag them.
    const isCancelled = status === 'cancelled'

    // Missing date → manual review only, NEVER auto-deleted. The Swiss Volley
    // sync legitimately inserts real future fixtures with an empty date while
    // the opponent's agreed date is still pending; deleting them destroys
    // genuine games (and the next sync just re-creates them). Surface it so an
    // admin can decide in the Games UI, but don't offer a destructive one-click.
    if (!date && !isCancelled) {
      issues.push({
        id: String(g['id']),
        collection: 'games',
        field: 'date',
        severity: 'warning',
        issueKey: 'missingDate',
        detail: `${label} (${gameId})`,
        autoFixable: false,
      })
    }

    // Missing away team → set "Opponent TBD"
    if (!awayTeam || !awayTeam.trim() || awayTeam.trim() === '?') {
      issues.push({
        id: String(g['id']),
        collection: 'games',
        field: 'away_team',
        severity: 'error',
        issueKey: 'missingAwayTeam',
        detail: `${g['home_team'] || '?'} (${gameId})`,
        autoFixable: true,
        fixValue: 'Opponent TBD',
      })
    }

    // Missing time (when date exists) → set 00:00
    if (date && !isCancelled && (!time || !time.trim())) {
      issues.push({
        id: String(g['id']),
        collection: 'games',
        field: 'time',
        severity: 'warning',
        issueKey: 'missingTime',
        detail: `${formatDateZurich(date)} · ${label}`,
        autoFixable: true,
        fixValue: '00:00',
      })
    }

    // Non-padded time
    if (time && /^\d:\d{2}$/.test(time)) {
      issues.push({
        id: String(g['id']),
        collection: 'games',
        field: 'time',
        severity: 'warning',
        issueKey: 'nonPaddedTime',
        detail: `${time} → ${padTime(time)} · ${label}`,
        autoFixable: true,
        fixValue: padTime(time),
      })
    }
  }

  return { collection: 'games', total: games.length, issues }
}

async function checkMembers(): Promise<CollectionHealth> {
  // Get all coach-approved, active members
  const members = await fetchAllItems<Record<string, unknown>>('members', {
    fields: ['id', 'first_name', 'last_name', 'coach_approved_team', 'wiedisync_active'],
    filter: { _and: [{ coach_approved_team: { _eq: true } }, { wiedisync_active: { _eq: true } }] },
    sort: ['last_name', 'first_name'],
  })

  // Pass members who have ANY team responsibility: player (current season),
  // coach (teams_coaches), or team-responsible (teams_responsibles). The
  // junctions have no season column — current-state is the truth.
  // Use the shared June-1 cutover helper — a local Sept cutover here would, for
  // Jun–Aug, query last season's string and false-flag the whole roster as
  // "no team assignment" once teams exist only in the new (rolled-over) season.
  const season = getCurrentSeason()

  // teams_coaches / teams_responsibles expose a real `members_id` column (not a
  // junction-id alias), so these direct junction reads are correct. Do NOT wrap
  // them in .catch(() => []) — a failed integrity query must surface (via the
  // top-level toast), not silently masquerade as "these members have no team"
  // and flood the page with false "No team assignment" warnings.
  const [memberTeams, teamCoaches, teamResponsibles] = await Promise.all([
    fetchAllItems<{ member: string | number }>('member_teams', {
      fields: ['member'],
      filter: { season: { _eq: season } },
    }),
    fetchAllItems<{ members_id: string | number }>('teams_coaches', {
      fields: ['members_id'],
    }),
    fetchAllItems<{ members_id: string | number }>('teams_responsibles', {
      fields: ['members_id'],
    }),
  ])

  const assignedMemberIds = new Set<string>()
  for (const mt of memberTeams) assignedMemberIds.add(String(mt.member))
  for (const tc of teamCoaches) assignedMemberIds.add(String(tc.members_id))
  for (const tr of teamResponsibles) assignedMemberIds.add(String(tr.members_id))

  const issues: DataIssue[] = []

  for (const m of members) {
    if (!assignedMemberIds.has(String(m['id']))) {
      const name = `${m['first_name'] || ''} ${m['last_name'] || ''}`.trim() || String(m['id'])
      issues.push({
        id: String(m['id']),
        collection: 'members',
        field: 'member_teams',
        severity: 'warning',
        issueKey: 'noTeamAssignment',
        detail: name,
        autoFixable: false,
      })
    }
  }

  // Missing sex → manual review (m/f is a choice, not a deterministic auto-fix).
  // Independent of the team-assignment filter above: surface EVERY member without
  // a sex so it can be set by hand. The Volleymanager sync only ever set sex for
  // licensed volleyball players, and ClubDesk sync-down never propagated it — so
  // anyone outside that path (basketball, passive, new signups) lands here.
  // Skip the service/system account(s) — they aren't people and would be permanent
  // un-fixable noise (same heuristic as the ClubDesk sync's non-member guard).
  const sexless = await fetchAllItems<Record<string, unknown>>('members', {
    fields: ['id', 'first_name', 'last_name', 'email'],
    // _empty matches NULL and '' — Directus rejects _eq: '' outright (400 INVALID_QUERY).
    filter: { sex: { _empty: true } },
    sort: ['last_name', 'first_name'],
  })
  for (const m of sexless) {
    const email = String(m['email'] || '').toLowerCase()
    if (email.startsWith('system@') || email.includes('@kscw.clubdesk.com')) continue
    const name = `${m['first_name'] || ''} ${m['last_name'] || ''}`.trim() || String(m['id'])
    issues.push({
      id: String(m['id']),
      collection: 'members',
      field: 'sex',
      severity: 'warning',
      issueKey: 'missingSex',
      detail: name,
      autoFixable: false,
      manualKind: 'sex',
    })
  }

  // Members whose name matches a ClubDesk contact but whose email + licence
  // diverge — the auto-linker can't safely link these, so they surface here for
  // a manual decision. Free contact → one-click "Link" (sets clubdesk_id + keeps
  // the ClubDesk email as a secondary). Already-linked contact → flagged as a
  // likely duplicate that needs a merge (no one-click). Backend join: it reads
  // the clubdesk_export staging table, which isn't exposed via the items API.
  try {
    const { candidates } = await kscwApi<{ candidates: ClubdeskNameMatch[] }>('/clubdesk-name-matches')
    for (const c of candidates || []) {
      if (c.duplicate_of) {
        issues.push({
          id: String(c.member_id),
          collection: 'members',
          field: 'clubdesk_id',
          severity: 'warning',
          issueKey: 'clubdeskNameMatch',
          detail: `${c.member_name} — duplicate of #${c.duplicate_of.id} ${c.duplicate_of.name} (ClubDesk ${c.clubdesk_id})`,
          autoFixable: false,
        })
      } else {
        issues.push({
          id: String(c.member_id),
          collection: 'members',
          field: 'clubdesk_id',
          severity: 'warning',
          issueKey: 'clubdeskNameMatch',
          detail: `${c.member_name} → ClubDesk ${c.clubdesk_id}${c.clubdesk_email ? ` (${c.clubdesk_email})` : ''}`,
          autoFixable: false,
          manualKind: 'clubdeskLink',
          link: { clubdeskId: c.clubdesk_id, clubdeskEmail: c.clubdesk_email },
        })
      }
    }
  } catch {
    // Non-fatal: if the name-match endpoint is unavailable, the rest of the
    // members check still reports. (Surfaced via the page-level toast only if
    // the whole check throws — this one is best-effort.)
  }

  // Members still active in wiedisync but who LEFT ClubDesk (non-active status +
  // an Austritt date). They linger with rosters; flag for a manual deactivate
  // (sets not-a-member + drops current-season teams). Best-effort.
  try {
    const { candidates } = await kscwApi<{ candidates: ClubdeskDeparted[] }>('/clubdesk-departed')
    for (const c of candidates || []) {
      const teams = c.current_teams.length ? ` · ${c.current_teams.join(', ')}` : ''
      issues.push({
        id: String(c.member_id),
        collection: 'members',
        field: 'kscw_membership_active',
        severity: 'warning',
        issueKey: 'clubdeskDeparted',
        detail: `${c.member_name} — ${c.status}${c.austritt ? ` (${c.austritt})` : ''}${teams}`,
        autoFixable: false,
        manualKind: 'clubdeskDeactivate',
      })
    }
  } catch {
    // Best-effort — see above.
  }

  // Linked members whose wiedisync contact data (push scope: names, email,
  // phone, address, birthdate, sex) no longer matches the ClubDesk snapshot —
  // edits made outside the profile modal never set the sync-up dirty flag, so
  // wiedisync and ClubDesk silently diverge. "Mark for sync-up" sets the flag
  // (+ field diff) so the sync-up modal picks the member up; already-pending
  // members are skipped here (they're in the modal's changed list already).
  // Best-effort.
  try {
    const { candidates, fills } = await kscwApi<{
      candidates: ClubdeskDrift[]
      fills: Record<string, ClubdeskFillAgg>
    }>('/clubdesk-drift')
    // Real conflicts: one row per member with the field-level diff. Members
    // with blank_risk fields (wiedisync empty where ClubDesk has data) get NO
    // one-click flag — pushing them would send empty cells for ClubDesk-owned
    // values; the next sync-down fills those fields and unblocks them. Their
    // issueKey carries the explanation ("run sync down first") via its label.
    for (const c of candidates || []) {
      const diffTxt = c.conflicts
        .map((d) => `${d.field}: ${d.clubdesk} → ${d.wiedisync}`)
        .join(' · ')
      const fillTxt = c.fills.length ? ` · +${c.fills.map((f) => f.field).join(', ')}` : ''
      const blocked = c.blank_risk.length > 0
      const blank = blocked ? ` · ⚠ ${c.blank_risk.join(', ')}` : ''
      issues.push({
        // Prefixed id: avoids manualFixingId collisions with missingSex /
        // departed rows for the same member; the member id travels in
        // bulkMemberIds instead.
        id: `cd-drift-${c.member_id}`,
        collection: 'members',
        field: 'clubdesk_id',
        severity: 'warning',
        issueKey: blocked ? 'clubdeskDriftBlocked' : 'clubdeskDrift',
        detail: `${c.member_name} — ${diffTxt}${fillTxt}${blank}`,
        autoFixable: false,
        ...(blocked ? {} : { manualKind: 'clubdeskDriftFlag' as const, bulkMemberIds: [c.member_id] }),
      })
    }
    // Mass fills (wiedisync has data ClubDesk lacks): ONE aggregate row per
    // field with a bulk "mark for sync-up" — e.g. 100+ members whose sex is
    // only set in wiedisync would otherwise flood the list. member_ids only
    // contains blank-risk-free members; at_risk counts the held-back ones.
    for (const [field, agg] of Object.entries(fills || {})) {
      if (!agg.count && !agg.at_risk) continue
      const atRisk = agg.at_risk ? ` (+${agg.at_risk} ⚠)` : ''
      issues.push({
        id: `cd-fill-${field}`,
        collection: 'members',
        field,
        severity: 'warning',
        issueKey: 'clubdeskFill',
        detail: `${field} — ${agg.count}${atRisk}`,
        autoFixable: false,
        ...(agg.count ? { manualKind: 'clubdeskDriftFlag' as const, bulkMemberIds: agg.member_ids } : {}),
      })
    }
  } catch {
    // Best-effort — see above.
  }

  // ClubDesk GROUP drift (read-only — group membership is manual in ClubDesk, the
  // CSV import can't set it). Players missing their team's ClubDesk group, strays
  // sitting in a ClubDesk group with no current-season Wiedisync roster (annotated
  // active/official/coach so the "remove from ClubDesk vs add to Wiedisync" call
  // is visible inline), and ClubDesk groups with no Wiedisync team. Best-effort.
  try {
    const {
      missing, strays, no_team_groups,
      no_group, coach_no_group, fee_no_roster, unmapped_teams,
    } = await kscwApi<{
      missing: ClubdeskGroupMissing[]
      strays: ClubdeskGroupStray[]
      no_team_groups: ClubdeskGroupNoTeam[]
      no_group?: { member_id: number; has_team: boolean }[]
      coach_no_group?: { member_id: number }[]
      fee_no_roster?: { member_id: number; severity: 'never' | 'lapsed' | 'older' }[]
      unmapped_teams?: { team_id: number; name: string }[]
    }>('/clubdesk-group-sync')

    // These four are AGGREGATED into a single row each: per-member rows would add
    // ~250 entries and drown the page (same reason clubdesk drift `fills` are
    // aggregated). Data Health is the alarm — the full, exportable lists live on
    // the ClubDesk sync page. Exception: unmapped teams are rare and each one
    // silently blinds every group check, so they get a row apiece.
    const noGroupOnTeam = (no_group || []).filter((r) => r.has_team).length
    if ((no_group || []).length > 0) {
      issues.push({
        id: 'cd-no-group',
        collection: 'members',
        field: 'clubdesk_id',
        severity: noGroupOnTeam > 0 ? 'error' : 'warning',
        issueKey: 'clubdeskNoGroup',
        detail: `${(no_group || []).length} · ${noGroupOnTeam} on a team`,
        autoFixable: false,
      })
    }
    if ((coach_no_group || []).length > 0) {
      issues.push({
        id: 'cd-coach-group',
        collection: 'members',
        field: 'clubdesk_id',
        severity: 'warning',
        issueKey: 'clubdeskCoachGroup',
        detail: `${(coach_no_group || []).length}`,
        autoFixable: false,
      })
    }
    const neverRostered = (fee_no_roster || []).filter((r) => r.severity === 'never').length
    if ((fee_no_roster || []).length > 0) {
      issues.push({
        id: 'cd-fee-no-roster',
        collection: 'members',
        field: 'beitragskategorie',
        severity: neverRostered > 0 ? 'error' : 'warning',
        issueKey: 'clubdeskFeeNoRoster',
        detail: `${(fee_no_roster || []).length} · ${neverRostered} never rostered`,
        autoFixable: false,
      })
    }
    for (const tm of unmapped_teams || []) {
      issues.push({
        id: `cd-unmapped-team-${tm.team_id}`,
        collection: 'teams',
        field: 'clubdesk_group',
        severity: 'error',
        issueKey: 'clubdeskUnmappedTeam',
        detail: tm.name,
        autoFixable: false,
      })
    }

    for (const m of missing || []) {
      issues.push({
        id: `cd-grp-missing-${m.member_id}`,
        collection: 'members',
        field: 'clubdesk_id',
        severity: 'warning',
        issueKey: 'clubdeskGroupMissing',
        detail: `${m.member_name} → ${m.groups.join(', ')}`,
        autoFixable: false,
      })
    }
    for (const s of strays || []) {
      const tags = [
        s.active ? 'active' : 'inactive',
        ...(s.is_official ? ['official'] : []),
        ...(s.coach_of ? [`coach: ${s.coach_of}`] : []),
        ...(s.tr_of ? [`TR: ${s.tr_of}`] : []),
      ].join(' · ')
      issues.push({
        id: `cd-grp-stray-${s.member_id}-${s.group}`,
        collection: 'members',
        field: 'clubdesk_id',
        severity: 'warning',
        issueKey: 'clubdeskGroupStray',
        detail: `${s.member_name} — ${s.group} · ${tags}`,
        autoFixable: false,
      })
    }
    for (const g of no_team_groups || []) {
      issues.push({
        id: `cd-grp-noteam-${g.group}`,
        collection: 'members',
        field: 'clubdesk_id',
        severity: 'warning',
        issueKey: 'clubdeskGroupNoTeam',
        detail: `${g.group} — ${g.count}`,
        autoFixable: false,
      })
    }
  } catch {
    // Best-effort — see above.
  }

  return { collection: 'members', total: members.length, issues }
}

// ── Public API ──

export async function runAllChecks(): Promise<CollectionHealth[]> {
  const [games, members] = await Promise.all([checkGames(), checkMembers()])
  return [games, members]
}

/**
 * Apply an admin-chosen value for a manual-fix issue (e.g. sex → 'm' | 'f').
 * Separate from autoFix because there is no single deterministic fixValue.
 */
export async function manualFix(issue: DataIssue, value: string): Promise<void> {
  await updateRecord(issue.collection, issue.id, { [issue.field]: value })
}

/**
 * Confirm a name-only ClubDesk match: link the member to the ClubDesk contact
 * (sets clubdesk_id + keeps the ClubDesk email as a secondary, server-side).
 */
export async function linkClubdesk(issue: DataIssue): Promise<void> {
  if (!issue.link) return
  await kscwApi('/clubdesk-link', {
    method: 'POST',
    body: { member_id: Number(issue.id), clubdesk_id: issue.link.clubdeskId },
  })
}

/**
 * Deactivate a member who left ClubDesk: sets not-a-member + inactive and drops
 * their current-season team assignments (keeps prior-season history).
 */
export async function deactivateMember(issue: DataIssue): Promise<void> {
  await kscwApi('/clubdesk-deactivate', {
    method: 'POST',
    body: { member_id: Number(issue.id) },
  })
}

/**
 * Mark drifted member(s) for the next ClubDesk sync-up push (sets the dirty
 * flag + field diff server-side; the actual push happens in the sync-up modal
 * on the Anmeldungen page). Bulk rows carry all their member ids.
 */
export async function flagClubdeskDrift(issue: DataIssue): Promise<void> {
  const memberIds = issue.bulkMemberIds ?? [Number(issue.id)]
  await kscwApi('/clubdesk-drift/flag', {
    method: 'POST',
    body: { member_ids: memberIds },
  })
}

export async function autoFix(issue: DataIssue): Promise<void> {
  if (!issue.autoFixable) return
  if (issue.fixAction === 'delete') {
    await deleteRecord(issue.collection, issue.id)
    return
  }
  if (issue.fixValue === undefined) return
  await updateRecord(issue.collection, issue.id, {
    [issue.field]: issue.fixValue,
  })
}

export async function autoFixAll(
  issues: DataIssue[],
): Promise<{ fixed: number; failed: number; failedIds: string[] }> {
  // Every remaining auto-fix is a non-destructive update on a distinct record,
  // so they're safe to run in parallel. allSettled keeps one failure from
  // aborting the rest and lets us report exactly which records still need help.
  const fixable = issues.filter((i) => i.autoFixable)
  const results = await Promise.allSettled(fixable.map((i) => autoFix(i)))

  let fixed = 0
  let failed = 0
  const failedIds: string[] = []
  results.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      fixed++
    } else {
      failed++
      failedIds.push(fixable[idx].id)
    }
  })
  return { fixed, failed, failedIds }
}
