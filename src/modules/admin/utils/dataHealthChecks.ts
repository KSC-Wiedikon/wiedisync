import { fetchAllItems, updateRecord, deleteRecord } from '../../../lib/api'
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
   * The component renders inline choice buttons and calls manualFix(issue, value).
   * 'sex' → male/female. Such issues are excluded from "Fix all".
   */
  manualKind?: 'sex'
}

export interface CollectionHealth {
  collection: string
  total: number
  issues: DataIssue[]
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
    filter: { _or: [{ sex: { _null: true } }, { sex: { _empty: true } }] },
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
