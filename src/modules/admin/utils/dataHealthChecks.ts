import { fetchAllItems, updateRecord, deleteRecord } from '../../../lib/api'
import { getCurrentSeason } from '../../../utils/dateHelpers'

export type IssueSeverity = 'error' | 'warning'

export type FixAction = 'update' | 'delete'

export interface DataIssue {
  id: string
  collection: string
  field: string
  severity: IssueSeverity
  label: string
  detail: string
  autoFixable: boolean
  fixValue?: string
  fixAction?: FixAction
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
    const label = gameLabel(g)

    // Missing date → delete the game (unscheduled placeholder)
    if (!date) {
      issues.push({
        id: String(g['id']),
        collection: 'games',
        field: 'date',
        severity: 'error',
        label: `Missing date`,
        detail: `${label} (${gameId})`,
        autoFixable: true,
        fixAction: 'delete',
      })
    }

    // Missing away team → set "Opponent TBD"
    if (!awayTeam || !awayTeam.trim() || awayTeam.trim() === '?') {
      issues.push({
        id: String(g['id']),
        collection: 'games',
        field: 'away_team',
        severity: 'error',
        label: `Missing away team`,
        detail: `home: ${g['home_team'] || '?'} (${gameId})`,
        autoFixable: true,
        fixValue: 'Opponent TBD',
      })
    }

    // Missing time (when date exists) → set 00:00
    if (date && (!time || !time.trim())) {
      issues.push({
        id: String(g['id']),
        collection: 'games',
        field: 'time',
        severity: 'warning',
        label: `Missing time`,
        detail: `${date} | ${label}`,
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
        label: `Non-padded time`,
        detail: `${time} → ${padTime(time)} | ${label}`,
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

  const [memberTeams, teamCoaches, teamResponsibles] = await Promise.all([
    fetchAllItems<{ member: string | number }>('member_teams', {
      fields: ['member'],
      filter: { season: { _eq: season } },
    }),
    fetchAllItems<{ members_id: string | number }>('teams_coaches', {
      fields: ['members_id'],
    }).catch(() => [] as { members_id: string | number }[]),
    fetchAllItems<{ members_id: string | number }>('teams_responsibles', {
      fields: ['members_id'],
    }).catch(() => [] as { members_id: string | number }[]),
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
        label: `No team assignment`,
        detail: name,
        autoFixable: false,
      })
    }
  }

  return { collection: 'members', total: members.length, issues }
}

// ── Public API ──

export async function runAllChecks(): Promise<CollectionHealth[]> {
  const [games, members] = await Promise.all([checkGames(), checkMembers()])
  return [games, members]
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

export async function autoFixAll(issues: DataIssue[]): Promise<{ fixed: number; failed: number }> {
  const fixable = issues.filter((i) => i.autoFixable)
  let fixed = 0
  let failed = 0
  for (const issue of fixable) {
    try {
      await autoFix(issue)
      fixed++
    } catch {
      failed++
    }
  }
  return { fixed, failed }
}
