// src/modules/admin/components/ExplorerGrid.tsx
//
// ClubDesk-Kontakte-style spreadsheet view for the Data Explorer, with two
// sub-views behind a toggle:
//   Members — rows = members; inline cell editing of member fields, Teams
//             chip column edits member_teams junction rows.
//   Teams   — rows = teams; inline cell editing of team fields, plus editable
//             Members (member_teams), Coach (teams_coaches) and Team
//             responsible (teams_responsibles) chip columns.
//
// Shared features: group rail (per sport → gender, alphabetical), column
// show/hide per view (persisted), sort by any column, quick-search, group-by
// (members view), and Excel/PDF export of the current view (English headers +
// filename, per the exports-always-English convention).
//
// Derived member columns (sport, referee, officials licence, passive /
// honorary / former member) come from the teams cache and the narrow
// clubdesk_export info map; viewers whose policy can't read clubdesk_export
// simply see those flags empty (the cache fetch is caught).
//
// All writes go through the Directus items API (auto audit-logged) and are
// applied to the explorer cache optimistically via onMutate. Editing is gated
// by canEdit (global admin + sport admins — the Vorstand policy is read-only
// on members/member_teams/teams, so it gets a read-only grid).

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, ArrowUpDown, Check, Download, Eye, FileText, Layers, Loader2, Plus, Settings2, Users, X,
} from 'lucide-react'
import type { Member, Team } from '../../../types'
import { assetUrl, createRecord, deleteRecord, updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { getCurrentSeason } from '../../../utils/dateHelpers'
import { localizeCountryName } from '../../../utils/countryName'
import { LANGUAGES } from '../../../i18n/languageConfig'
import { useConfirm } from '../../../components/ConfirmProvider'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { toXlsx, downloadBlob } from '../utils/exportResults'
import type { CacheShape, MemberTeamRow, StaffRow, ClubdeskSyncStatus, RegFileInfo } from './explorerHelpers'
import { buildMemberTeamsMap, buildStaffMap, formatShortDate, formatShortDateTime, teamLabel } from './explorerHelpers'

interface Props {
  /** Filtered cache from the page (member filters already applied). */
  cache: CacheShape
  /** Header quick-search query — filters grid rows client-side. */
  query: string
  /** Whether the viewer may edit (global admin or sport admin). */
  canEdit: boolean
  /** Jump to the tree/detail view for a member. */
  onOpenDetail: (memberId: string) => void
  /** Apply an optimistic update to the underlying explorer cache. */
  onMutate: (updater: (prev: CacheShape) => CacheShape) => void
}

type GridView = 'members' | 'teams'

// ── Member-view columns ──────────────────────────────────────────

type ColKey =
  | 'last_name' | 'first_name' | 'teams' | 'email' | 'phone'
  | 'adresse' | 'plz' | 'ort' | 'nationalitaet' | 'birthdate'
  | 'sex' | 'language' | 'number' | 'position' | 'license_nr'
  | 'vm_email' | 'ahv_nummer' | 'beitragskategorie' | 'role'
  | 'sport' | 'scorer_vb' | 'referee' | 'officials'
  | 'wiedisync_active' | 'last_online_at' | 'passive' | 'honorary' | 'former'
  | 'clubdesk_sync' | 'reg_files'

type ColKind = 'text' | 'email' | 'date' | 'number' | 'teams' | 'ro' | 'bool' | 'select'
  | 'clubdesk_sync' | 'reg_files'

interface SelectOption { value: string; label: string }

interface ColDef<K extends string = ColKey> {
  key: K
  labelKey: string
  kind: ColKind
  minW: string
  /** Whether the group-by select offers this column (members view only). */
  groupable?: boolean
  /** For kind 'select' — the fixed option list (value → display label). */
  options?: SelectOption[]
  /** For kind 'bool' — a directly-writable member field (click to toggle).
   *  Derived flags (passive / honorary / former, referee, officials) omit this
   *  and stay read-only. */
  write?: boolean
}

// Enum option lists for inline-editable select cells. Sex is stored m/f;
// language is stored as the backend value (german / english / …) shown by its
// native name.
const SEX_OPTIONS: SelectOption[] = [
  { value: 'm', label: 'm' },
  { value: 'f', label: 'f' },
]
const LANGUAGE_OPTIONS: SelectOption[] = LANGUAGES.map((l) => ({ value: l.backendValue, label: l.nativeName }))

// ClubDesk sync status → i18n label + chip colour. Derived read-only column.
const SYNC_LABEL_KEY: Record<ClubdeskSyncStatus, string> = {
  in_sync: 'explorerGridSyncInSync',
  drift: 'explorerGridSyncDrift',
  pending: 'explorerGridSyncPending',
  not_linked: 'explorerGridSyncNotLinked',
  stale: 'explorerGridSyncStale',
  departed: 'explorerGridSyncDeparted',
  excluded: 'explorerGridSyncExcluded',
}
const SYNC_CHIP_CLASS: Record<ClubdeskSyncStatus, string> = {
  in_sync: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  drift: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  not_linked: 'bg-muted text-muted-foreground',
  stale: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  departed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  excluded: 'bg-muted text-muted-foreground',
}

// Registration document field → existing admin i18n label (reused from
// AnmeldungenPage — no new strings). Drives the reg-files popover.
const REG_DOC_LABEL_KEY: Record<string, string> = {
  id_upload_front: 'anmeldungenDocIdFront',
  id_upload_back: 'anmeldungenDocIdBack',
  bb_doc_lizenz: 'anmeldungenDocLizenz',
  bb_doc_freibrief: 'anmeldungenDocFreibrief',
  bb_doc_selfdecl: 'anmeldungenDocSelfDecl',
  bb_doc_natdecl: 'anmeldungenDocNatDecl',
  bb_doc_u18parents: 'anmeldungenDocU18Parents',
  bb_doc_schoolcert: 'anmeldungenDocSchoolCert',
}

// Fetch a private file (cookie auth) and open it in a new tab via a blob URL —
// avoids relying on cross-site top-level asset navigation.
async function openPrivateFile(url: string, onError: () => void): Promise<void> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const obj = URL.createObjectURL(blob)
    window.open(obj, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(obj), 60_000)
  } catch {
    onError()
  }
}

// Full catalog — everything the explorer cache already loads (plus derived
// columns). Default view shows only the name; the rest is opt-in via the
// column chooser.
const COLUMNS: ColDef[] = [
  { key: 'last_name', labelKey: 'explorerGridColLastName', kind: 'text', minW: 'min-w-32' },
  { key: 'first_name', labelKey: 'explorerGridColFirstName', kind: 'text', minW: 'min-w-32' },
  { key: 'teams', labelKey: 'explorerGridColTeams', kind: 'teams', minW: 'min-w-56', groupable: true },
  { key: 'sport', labelKey: 'explorerGridColSport', kind: 'ro', minW: 'min-w-28', groupable: true },
  { key: 'email', labelKey: 'explorerGridColEmail', kind: 'email', minW: 'min-w-52' },
  { key: 'phone', labelKey: 'explorerGridColPhone', kind: 'text', minW: 'min-w-36' },
  { key: 'adresse', labelKey: 'explorerGridColAddress', kind: 'text', minW: 'min-w-48' },
  { key: 'plz', labelKey: 'explorerGridColPlz', kind: 'text', minW: 'min-w-20', groupable: true },
  { key: 'ort', labelKey: 'explorerGridColCity', kind: 'text', minW: 'min-w-32', groupable: true },
  { key: 'nationalitaet', labelKey: 'explorerGridColNationality', kind: 'text', minW: 'min-w-32', groupable: true },
  { key: 'birthdate', labelKey: 'explorerGridColBirthdate', kind: 'date', minW: 'min-w-28', groupable: true },
  { key: 'sex', labelKey: 'explorerGridColSex', kind: 'select', minW: 'min-w-20', groupable: true, options: SEX_OPTIONS },
  { key: 'language', labelKey: 'explorerGridColLanguage', kind: 'select', minW: 'min-w-28', groupable: true, options: LANGUAGE_OPTIONS },
  { key: 'number', labelKey: 'explorerGridColNumber', kind: 'number', minW: 'min-w-20' },
  { key: 'position', labelKey: 'explorerGridColPosition', kind: 'ro', minW: 'min-w-32' },
  { key: 'license_nr', labelKey: 'explorerGridColLicense', kind: 'ro', minW: 'min-w-28' },
  { key: 'scorer_vb', labelKey: 'explorerGridColScorerVb', kind: 'bool', minW: 'min-w-24', write: true },
  { key: 'referee', labelKey: 'explorerGridColReferee', kind: 'ro', minW: 'min-w-24' },
  { key: 'officials', labelKey: 'explorerGridColOfficials', kind: 'ro', minW: 'min-w-36' },
  { key: 'vm_email', labelKey: 'explorerGridColVmEmail', kind: 'email', minW: 'min-w-52' },
  { key: 'ahv_nummer', labelKey: 'explorerGridColAhv', kind: 'text', minW: 'min-w-36' },
  { key: 'beitragskategorie', labelKey: 'explorerGridColFeeCategory', kind: 'text', minW: 'min-w-36', groupable: true },
  { key: 'passive', labelKey: 'explorerGridColPassive', kind: 'bool', minW: 'min-w-24', groupable: true },
  { key: 'honorary', labelKey: 'explorerGridColHonorary', kind: 'bool', minW: 'min-w-24', groupable: true },
  { key: 'former', labelKey: 'explorerGridColFormer', kind: 'bool', minW: 'min-w-24', groupable: true },
  { key: 'clubdesk_sync', labelKey: 'explorerGridColClubdeskSync', kind: 'clubdesk_sync', minW: 'min-w-32', groupable: true },
  { key: 'reg_files', labelKey: 'explorerGridColRegFiles', kind: 'reg_files', minW: 'min-w-28' },
  { key: 'role', labelKey: 'explorerGridColRoles', kind: 'ro', minW: 'min-w-32' },
  { key: 'wiedisync_active', labelKey: 'explorerGridColWiedisyncActive', kind: 'bool', minW: 'min-w-24', write: true },
  { key: 'last_online_at', labelKey: 'explorerGridColLastOnline', kind: 'ro', minW: 'min-w-32' },
]

const COL_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]))
const DEFAULT_VISIBLE: ColKey[] = ['last_name', 'first_name']
const VISIBLE_COLS_LS_KEY = 'kscw-explorer-grid-cols-v1'

// ── Team-view columns ────────────────────────────────────────────

type TeamColKey =
  | 'name' | 'full_name' | 'sport' | 'gender' | 'league' | 'season'
  | 'members' | 'coach' | 'team_responsible'

const TEAM_COLUMNS: ColDef<TeamColKey>[] = [
  { key: 'name', labelKey: 'explorerGridTeamColName', kind: 'text', minW: 'min-w-28' },
  { key: 'full_name', labelKey: 'explorerGridTeamColFullName', kind: 'text', minW: 'min-w-40' },
  { key: 'sport', labelKey: 'explorerGridColSport', kind: 'ro', minW: 'min-w-24' },
  { key: 'gender', labelKey: 'explorerGridTeamColGender', kind: 'ro', minW: 'min-w-24' },
  { key: 'league', labelKey: 'explorerGridTeamColLeague', kind: 'text', minW: 'min-w-28' },
  { key: 'season', labelKey: 'explorerGridTeamColSeason', kind: 'text', minW: 'min-w-24' },
  { key: 'members', labelKey: 'explorerGridTeamColMembers', kind: 'ro', minW: 'min-w-96' },
  { key: 'coach', labelKey: 'explorerGridTeamColCoach', kind: 'ro', minW: 'min-w-48' },
  { key: 'team_responsible', labelKey: 'explorerGridTeamColTr', kind: 'ro', minW: 'min-w-48' },
]

const TEAM_COL_BY_KEY = new Map(TEAM_COLUMNS.map((c) => [c.key, c]))
const TEAM_DEFAULT_VISIBLE: TeamColKey[] = ['name', 'league', 'members', 'coach', 'team_responsible']
const TEAM_VISIBLE_COLS_LS_KEY = 'kscw-explorer-grid-team-cols-v1'
const VIEW_LS_KEY = 'kscw-explorer-grid-view'

function loadVisible<K extends string>(lsKey: string, all: Map<K, unknown>, fallback: K[]): K[] {
  try {
    const raw = localStorage.getItem(lsKey)
    if (!raw) return fallback
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return fallback
    const valid = (arr as K[]).filter((k) => all.has(k))
    return valid.length > 0 ? valid : fallback
  } catch {
    return fallback
  }
}

type Sport = 'volleyball' | 'basketball' | 'other'
const SPORTS: Sport[] = ['volleyball', 'basketball', 'other']

function sportOf(team: { sport?: string } | undefined): Sport {
  const s = team?.sport
  if (s === 'volleyball' || s === 'basketball') return s
  return 'other'
}

// Rail sections: per sport, teams sub-grouped by gender (women → men → mixed →
// ungendered) and alphabetically sorted within each sub-group.
type GenderKey = 'f' | 'm' | 'mixed' | 'other'
const GENDER_ORDER: GenderKey[] = ['f', 'm', 'mixed', 'other']
const GENDER_LABEL_KEY: Record<GenderKey, string | null> = {
  f: 'explorerGridGenderWomen',
  m: 'explorerGridGenderMen',
  mixed: 'explorerGridGenderMixed',
  other: null,
}

interface TeamSection {
  sport: Sport
  gender: GenderKey
  teams: Array<{ id: string; label: string; count: number }>
}

function genderOf(team: { gender?: string | null } | undefined): GenderKey {
  const g = team?.gender
  if (g === 'f' || g === 'm' || g === 'mixed') return g
  return 'other'
}

/** Raw field access — the catalogs are wider than the types guarantee. */
function rawField(rec: Member | Team, key: string): unknown {
  return (rec as unknown as Record<string, unknown>)[key]
}

function shortMemberName(m: Member | undefined, fallback: string): string {
  if (!m) return fallback
  return `${m.last_name ?? ''} ${m.first_name ?? ''}`.trim() || fallback
}

export default function ExplorerGrid({ cache, query, canEdit, onOpenDetail, onMutate }: Props) {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const confirm = useConfirm()

  const [view, setView] = useState<GridView>(() => {
    try { return localStorage.getItem(VIEW_LS_KEY) === 'teams' ? 'teams' : 'members' } catch { return 'members' }
  })
  const [selectedGroup, setSelectedGroup] = useState<'all' | string>('all')
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' } | null>(null)
  const [teamSort, setTeamSort] = useState<{ key: TeamColKey; dir: 'asc' | 'desc' } | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<ColKey[]>(() => loadVisible(VISIBLE_COLS_LS_KEY, COL_BY_KEY, DEFAULT_VISIBLE))
  const [teamVisibleKeys, setTeamVisibleKeys] = useState<TeamColKey[]>(() => loadVisible(TEAM_VISIBLE_COLS_LS_KEY, TEAM_COL_BY_KEY, TEAM_DEFAULT_VISIBLE))
  const [groupBy, setGroupBy] = useState<ColKey | 'none'>('none')
  const [exporting, setExporting] = useState(false)

  const changeView = (next: GridView) => {
    setView(next)
    try { localStorage.setItem(VIEW_LS_KEY, next) } catch { /* quota — non-fatal */ }
  }

  const teamById = useMemo(() => {
    const map = new Map<string, Team>()
    cache.teams.forEach((tm) => map.set(String(tm.id), tm))
    return map
  }, [cache.teams])

  const memberById = useMemo(() => {
    const map = new Map<string, Member>()
    cache.members.forEach((m) => map.set(String(m.id), m))
    return map
  }, [cache.members])

  // Junction rows per member / per team, restricted to teams present in the
  // (scoped, active-only) teams cache.
  const rowsByMember = useMemo(() => {
    const map = new Map<string, MemberTeamRow[]>()
    for (const r of cache.memberTeamRows) {
      if (!teamById.has(r.team)) continue
      const existing = map.get(r.member)
      if (existing) existing.push(r)
      else map.set(r.member, [r])
    }
    return map
  }, [cache.memberTeamRows, teamById])

  const rosterByTeam = useMemo(() => {
    const map = new Map<string, MemberTeamRow[]>()
    for (const r of cache.memberTeamRows) {
      if (!teamById.has(r.team)) continue
      const existing = map.get(r.team)
      if (existing) existing.push(r)
      else map.set(r.team, [r])
    }
    return map
  }, [cache.memberTeamRows, teamById])

  const coachByTeam = useMemo(() => {
    const map = new Map<string, StaffRow[]>()
    for (const r of cache.coachRows) {
      if (!teamById.has(r.team)) continue
      const existing = map.get(r.team)
      if (existing) existing.push(r)
      else map.set(r.team, [r])
    }
    return map
  }, [cache.coachRows, teamById])

  const trByTeam = useMemo(() => {
    const map = new Map<string, StaffRow[]>()
    for (const r of cache.trRows) {
      if (!teamById.has(r.team)) continue
      const existing = map.get(r.team)
      if (existing) existing.push(r)
      else map.set(r.team, [r])
    }
    return map
  }, [cache.trRows, teamById])

  // Group rail: teams sectioned by sport → gender, alphabetical within each
  // section, with member counts within the current filtered member set.
  const teamSections = useMemo((): TeamSection[] => {
    const memberIds = new Set(cache.members.map((m) => String(m.id)))
    const counts = new Map<string, number>()
    for (const [mid, rows] of rowsByMember) {
      if (!memberIds.has(mid)) continue
      for (const r of rows) counts.set(r.team, (counts.get(r.team) ?? 0) + 1)
    }
    const sections: TeamSection[] = []
    for (const sport of SPORTS) {
      for (const gender of GENDER_ORDER) {
        const teams = cache.teams
          .filter((tm) => {
            const meta = tm as unknown as { sport?: string; gender?: string | null }
            return sportOf(meta) === sport && genderOf(meta) === gender
          })
          .map((tm) => ({ id: String(tm.id), label: teamLabel(tm), count: counts.get(String(tm.id)) ?? 0 }))
          .sort((a, b) => a.label.localeCompare(b.label, 'de-CH', { numeric: true, sensitivity: 'base' }))
        if (teams.length > 0) sections.push({ sport, gender, teams })
      }
    }
    return sections
  }, [cache.members, cache.teams, rowsByMember])

  const sportLabel = useMemo(() => (sport: Sport): string => {
    if (sport === 'volleyball') return t('common:volleyball')
    if (sport === 'basketball') return t('common:basketball')
    return t('admin:explorerSportOther')
  }, [t])

  const genderLabel = useMemo(() => (g: GenderKey): string => {
    const key = GENDER_LABEL_KEY[g]
    return key ? t(`admin:${key}`) : ''
  }, [t])

  const syncLabel = useMemo(() => (status: ClubdeskSyncStatus | undefined): string => {
    if (!status) return ''
    return t(`admin:${SYNC_LABEL_KEY[status]}`)
  }, [t])

  // ── Members view: cell text (search / sort / group / export / display) ──

  const cellText = useMemo(() => {
    return (m: Member, key: ColKey): string => {
      const memberId = String(m.id)
      switch (key) {
        case 'teams':
          return (rowsByMember.get(memberId) ?? [])
            .map((r) => {
              const label = teamLabel(teamById.get(r.team) ?? ({ id: r.team } as never))
              return r.guest_level > 0 ? `${label} (G)` : label
            })
            .sort()
            .join(', ')
        case 'sport': {
          // Any relation to a team (player / coach / TR) counts toward the sport.
          const teamIds = [
            ...(rowsByMember.get(memberId) ?? []).map((r) => r.team),
            ...(cache.memberCoachTeams.get(memberId) ?? []),
            ...(cache.memberTrTeams.get(memberId) ?? []),
          ]
          const sports = new Set<Sport>()
          for (const tid of teamIds) {
            const tm = teamById.get(tid)
            if (tm) sports.add(sportOf(tm as unknown as { sport?: string }))
          }
          return SPORTS.filter((s) => sports.has(s) && s !== 'other').map(sportLabel).join(', ')
        }
        case 'referee': {
          const tokens: string[] = []
          if (rawField(m, 'referee_vb')) tokens.push('VB')
          if (rawField(m, 'referee_bb')) tokens.push('BB')
          return tokens.join(', ')
        }
        case 'officials': {
          // ClubDesk's Offiziellen Lizenz is DERIVED from these same booleans on
          // push (deriveOffiziellenLizenz in clubdesk-update.js), so a BB official
          // yields the identical token twice ("OTR1, OTR1") — dedupe.
          const tokens: string[] = []
          if (rawField(m, 'otr1_bb')) tokens.push('OTR1')
          if (rawField(m, 'otr2_bb')) tokens.push('OTR2')
          if (rawField(m, 'otn_bb')) tokens.push('OTN')
          const cd = m.clubdesk_id ? cache.clubdeskInfo.get(String(m.clubdesk_id)) : undefined
          if (cd?.offiziellenLizenz) tokens.push(cd.offiziellenLizenz)
          return [...new Set(tokens)].join(', ')
        }
        case 'scorer_vb':
        case 'wiedisync_active':
          return rawField(m, key) ? 'Yes' : ''
        case 'passive': {
          const cd = m.clubdesk_id ? cache.clubdeskInfo.get(String(m.clubdesk_id)) : undefined
          const inGroup = /passiv/i.test(cd?.gruppen ?? '')
          return inGroup || m.beitragskategorie === 'Passivmitglied' ? 'Yes' : ''
        }
        case 'honorary': {
          const cd = m.clubdesk_id ? cache.clubdeskInfo.get(String(m.clubdesk_id)) : undefined
          return /ehren/i.test(cd?.gruppen ?? '') ? 'Yes' : ''
        }
        case 'former': {
          const cd = m.clubdesk_id ? cache.clubdeskInfo.get(String(m.clubdesk_id)) : undefined
          return /ehemalig/i.test(cd?.gruppen ?? '') ? 'Yes' : ''
        }
        case 'last_online_at': {
          const raw = rawField(m, key)
          return raw ? formatShortDateTime(String(raw)) : ''
        }
        case 'clubdesk_sync':
          return syncLabel(cache.clubdeskSync.get(memberId))
        case 'reg_files': {
          const n = cache.regFiles.get(memberId)?.docs.length ?? 0
          return n > 0 ? String(n) : ''
        }
        default: {
          const raw = rawField(m, key)
          if (raw == null || raw === '') return ''
          if (Array.isArray(raw)) return raw.map(String).join(', ')
          if (key === 'nationalitaet') return localizeCountryName(String(raw))
          return String(raw)
        }
      }
    }
  }, [rowsByMember, teamById, cache.memberCoachTeams, cache.memberTrTeams, cache.clubdeskInfo, cache.clubdeskSync, cache.regFiles, sportLabel, syncLabel])

  // ── Teams view: cell text ────────────────────────────────────────

  const teamCellText = useMemo(() => {
    return (tm: Team, key: TeamColKey): string => {
      const teamId = String(tm.id)
      switch (key) {
        case 'sport':
          return sportLabel(sportOf(tm as unknown as { sport?: string }))
        case 'gender':
          return genderLabel(genderOf(tm as unknown as { gender?: string | null }))
        case 'members':
          return (rosterByTeam.get(teamId) ?? [])
            .map((r) => shortMemberName(memberById.get(r.member), r.member) + (r.guest_level > 0 ? ' (G)' : ''))
            .sort()
            .join(', ')
        case 'coach':
          return (coachByTeam.get(teamId) ?? [])
            .map((r) => shortMemberName(memberById.get(r.member), r.member))
            .sort()
            .join(', ')
        case 'team_responsible':
          return (trByTeam.get(teamId) ?? [])
            .map((r) => shortMemberName(memberById.get(r.member), r.member))
            .sort()
            .join(', ')
        default: {
          const raw = rawField(tm, key)
          return raw == null ? '' : String(raw)
        }
      }
    }
  }, [rosterByTeam, coachByTeam, trByTeam, memberById, sportLabel, genderLabel])

  // ── Rows (members view) ──────────────────────────────────────────

  const rows = useMemo(() => {
    let list = cache.members
    if (selectedGroup !== 'all') {
      list = list.filter((m) => (rowsByMember.get(String(m.id)) ?? []).some((r) => r.team === selectedGroup))
    }
    if (query) {
      const q = query.toLowerCase()
      list = list.filter((m) => COLUMNS.some((c) => cellText(m, c.key).toLowerCase().includes(q)))
    }
    if (sort) {
      const { key, dir } = sort
      list = [...list].sort((a, b) => {
        const cmp = cellText(a, key).localeCompare(cellText(b, key), 'de-CH', { numeric: true, sensitivity: 'base' })
        return dir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [cache.members, selectedGroup, query, sort, rowsByMember, cellText])

  const sections = useMemo((): Array<{ label: string | null; rows: Member[] }> => {
    if (groupBy === 'none') return [{ label: null, rows }]
    if (groupBy === 'teams') {
      const out: Array<{ label: string | null; rows: Member[] }> = []
      for (const sec of teamSections) {
        for (const tm of sec.teams) {
          const members = rows.filter((m) => (rowsByMember.get(String(m.id)) ?? []).some((r) => r.team === tm.id))
          if (members.length > 0) out.push({ label: `${tm.label} · ${sportLabel(sec.sport)}`, rows: members })
        }
      }
      const noTeam = rows.filter((m) => (rowsByMember.get(String(m.id)) ?? []).length === 0)
      if (noTeam.length > 0) out.push({ label: t('admin:explorerGridNoTeam'), rows: noTeam })
      return out
    }
    const byValue = new Map<string, Member[]>()
    for (const m of rows) {
      // Birthdate groups by birth year — per-day groups would be useless.
      let v = cellText(m, groupBy)
      if (groupBy === 'birthdate') v = v ? String(rawField(m, 'birthdate')).slice(0, 4) : ''
      const label = v || '—'
      const existing = byValue.get(label)
      if (existing) existing.push(m)
      else byValue.set(label, [m])
    }
    return [...byValue.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'de-CH', { numeric: true }))
      .map(([label, members]) => ({ label, rows: members }))
  }, [groupBy, rows, teamSections, rowsByMember, cellText, t, sportLabel])

  // ── Rows (teams view) — sections by sport → gender ───────────────

  const teamSectionsWithRows = useMemo(() => {
    const q = query.toLowerCase()
    const matches = (tm: Team) =>
      (!q || ['name', 'full_name', 'league', 'season', 'members', 'coach', 'team_responsible'].some(
        (k) => teamCellText(tm, k as TeamColKey).toLowerCase().includes(q),
      ))
    const sortTeams = (list: Team[]) => {
      if (!teamSort) return list
      const { key, dir } = teamSort
      return [...list].sort((a, b) => {
        const cmp = teamCellText(a, key).localeCompare(teamCellText(b, key), 'de-CH', { numeric: true, sensitivity: 'base' })
        return dir === 'asc' ? cmp : -cmp
      })
    }
    return teamSections
      .map((sec) => {
        const label = sec.gender !== 'other'
          ? `${sportLabel(sec.sport)} · ${genderLabel(sec.gender)}`
          : sportLabel(sec.sport)
        const teams = sortTeams(
          sec.teams
            .map((entry) => teamById.get(entry.id))
            .filter((tm): tm is Team => !!tm)
            .filter((tm) => (selectedGroup === 'all' || String(tm.id) === selectedGroup))
            .filter(matches),
        )
        return { label, teams }
      })
      .filter((sec) => sec.teams.length > 0)
  }, [teamSections, teamById, selectedGroup, query, teamSort, teamCellText, sportLabel, genderLabel])

  const visibleCols = visibleKeys.map((k) => COL_BY_KEY.get(k)).filter((c): c is ColDef => !!c)
  const teamVisibleCols = teamVisibleKeys.map((k) => TEAM_COL_BY_KEY.get(k)).filter((c): c is ColDef<TeamColKey> => !!c)
  const totalShown = view === 'members'
    ? sections.reduce((n, s) => n + s.rows.length, 0)
    : teamSectionsWithRows.reduce((n, s) => n + s.teams.length, 0)

  const toggleSort = (key: ColKey) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const toggleTeamSort = (key: TeamColKey) => {
    setTeamSort((prev) => {
      if (prev?.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const toggleCol = (key: ColKey) => {
    setVisibleKeys((prev) => {
      if (prev.includes(key) && prev.length === 1) return prev // never hide the last column
      const nextSet = new Set(prev)
      if (nextSet.has(key)) nextSet.delete(key)
      else nextSet.add(key)
      const next = COLUMNS.map((c) => c.key).filter((k) => nextSet.has(k))
      try { localStorage.setItem(VISIBLE_COLS_LS_KEY, JSON.stringify(next)) } catch { /* quota — non-fatal */ }
      return next
    })
  }

  const toggleTeamCol = (key: TeamColKey) => {
    setTeamVisibleKeys((prev) => {
      if (prev.includes(key) && prev.length === 1) return prev
      const nextSet = new Set(prev)
      if (nextSet.has(key)) nextSet.delete(key)
      else nextSet.add(key)
      const next = TEAM_COLUMNS.map((c) => c.key).filter((k) => nextSet.has(k))
      try { localStorage.setItem(TEAM_VISIBLE_COLS_LS_KEY, JSON.stringify(next)) } catch { /* quota — non-fatal */ }
      return next
    })
  }

  // ── Write paths ────────────────────────────────────────────────

  const saveCell = async (memberId: string, key: ColKey, value: string | boolean | null) => {
    const payload = key === 'number' ? (value == null || value === '' ? null : Number(value)) : value
    await updateRecord('members', memberId, { [key]: payload })
    logActivity('update', 'members', memberId, { [key]: payload })
    onMutate((prev) => ({
      ...prev,
      members: prev.members.map((m) => (String(m.id) === memberId ? { ...m, [key]: payload } : m)),
    }))
  }

  const saveTeamCell = async (teamId: string, key: TeamColKey, value: string | null) => {
    await updateRecord('teams', teamId, { [key]: value })
    logActivity('update', 'teams', teamId, { [key]: value })
    onMutate((prev) => ({
      ...prev,
      teams: prev.teams.map((tm) => (String(tm.id) === teamId ? { ...tm, [key]: value } : tm)),
    }))
  }

  const addRoster = async (memberId: string, teamId: string) => {
    const existing = rowsByMember.get(memberId) ?? []
    if (existing.some((r) => r.team === teamId)) return
    const created = await createRecord<{ id: string | number; guest_level: number | null; season: string | null }>(
      'member_teams',
      { member: memberId, team: teamId, season: getCurrentSeason() },
    )
    const newRow: MemberTeamRow = {
      id: String(created.id),
      member: memberId,
      team: teamId,
      guest_level: created.guest_level ?? 0,
      season: created.season ?? getCurrentSeason(),
    }
    logActivity('create', 'member_teams', newRow.id, { member: memberId, team: teamId })
    onMutate((prev) => {
      const memberTeamRows = [...prev.memberTeamRows, newRow]
      return { ...prev, memberTeamRows, memberTeams: buildMemberTeamsMap(memberTeamRows) }
    })
  }

  const removeRoster = async (row: MemberTeamRow) => {
    const team = teamById.get(row.team)
    const member = memberById.get(row.member)
    const ok = await confirm({
      message: t('admin:explorerGridRemoveFromTeam', {
        name: member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() : row.member,
        team: team ? teamLabel(team) : row.team,
      }),
      danger: true,
    })
    if (!ok) return
    await deleteRecord('member_teams', row.id)
    logActivity('delete', 'member_teams', row.id, { member: row.member, team: row.team })
    onMutate((prev) => {
      const memberTeamRows = prev.memberTeamRows.filter((r) => r.id !== row.id)
      return { ...prev, memberTeamRows, memberTeams: buildMemberTeamsMap(memberTeamRows) }
    })
  }

  // Coach / TR junction writes. M2M junction-object rule: we create directly in
  // the junction collections (Sport Admin has CRUD on both).
  const addStaff = async (kind: 'coach' | 'tr', teamId: string, memberId: string) => {
    const collection = kind === 'coach' ? 'teams_coaches' : 'teams_responsibles'
    const existing = (kind === 'coach' ? coachByTeam : trByTeam).get(teamId) ?? []
    if (existing.some((r) => r.member === memberId)) return
    const created = await createRecord<{ id: string | number }>(collection, {
      teams_id: teamId, members_id: memberId,
    })
    const newRow: StaffRow = { id: String(created.id), member: memberId, team: teamId }
    logActivity('create', collection, newRow.id, { teams_id: teamId, members_id: memberId })
    onMutate((prev) => {
      if (kind === 'coach') {
        const coachRows = [...prev.coachRows, newRow]
        return { ...prev, coachRows, memberCoachTeams: buildStaffMap(coachRows) }
      }
      const trRows = [...prev.trRows, newRow]
      return { ...prev, trRows, memberTrTeams: buildStaffMap(trRows) }
    })
  }

  const removeStaff = async (kind: 'coach' | 'tr', row: StaffRow) => {
    const collection = kind === 'coach' ? 'teams_coaches' : 'teams_responsibles'
    const team = teamById.get(row.team)
    const member = memberById.get(row.member)
    const ok = await confirm({
      message: t(kind === 'coach' ? 'admin:explorerGridRemoveCoach' : 'admin:explorerGridRemoveTr', {
        name: member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() : row.member,
        team: team ? teamLabel(team) : row.team,
      }),
      danger: true,
    })
    if (!ok) return
    await deleteRecord(collection, row.id)
    logActivity('delete', collection, row.id, { teams_id: row.team, members_id: row.member })
    onMutate((prev) => {
      if (kind === 'coach') {
        const coachRows = prev.coachRows.filter((r) => r.id !== row.id)
        return { ...prev, coachRows, memberCoachTeams: buildStaffMap(coachRows) }
      }
      const trRows = prev.trRows.filter((r) => r.id !== row.id)
      return { ...prev, trRows, memberTrTeams: buildStaffMap(trRows) }
    })
  }

  // ── Export (English headers + filename — exports-always-English) ─

  const buildExportData = () => {
    const tEn = i18n.getFixedT('en', 'admin')
    if (view === 'teams') {
      const columns = [tEn('explorerGridGroupBy'), ...teamVisibleCols.map((c) => tEn(c.labelKey))]
      const dataRows: string[][] = []
      for (const sec of teamSectionsWithRows) {
        for (const tm of sec.teams) {
          dataRows.push([sec.label, ...teamVisibleCols.map((c) => teamCellText(tm, c.key))])
        }
      }
      return { columns, dataRows }
    }
    const grouped = groupBy !== 'none'
    const columns = [
      ...(grouped ? [tEn('explorerGridGroupBy')] : []),
      ...visibleCols.map((c) => tEn(c.labelKey)),
    ]
    const dataRows: string[][] = []
    for (const section of sections) {
      for (const m of section.rows) {
        dataRows.push([
          ...(grouped ? [section.label ?? ''] : []),
          ...visibleCols.map((c) => {
            if (c.kind === 'date') {
              const raw = rawField(m, c.key)
              if (!raw) return ''
              const [yyyy, mm, dd] = String(raw).slice(0, 10).split('-')
              return dd && mm && yyyy ? `${dd}.${mm}.${yyyy}` : String(raw)
            }
            return cellText(m, c.key)
          }),
        ])
      }
    }
    return { columns, dataRows }
  }

  const exportName = (ext: string) => `${view === 'teams' ? 'teams' : 'members'}_export_${new Date().toISOString().slice(0, 10)}.${ext}`

  const handleExportExcel = async () => {
    setExporting(true)
    try {
      const { columns, dataRows } = buildExportData()
      const blob = await toXlsx(columns, dataRows)
      downloadBlob(blob, exportName('xlsx'))
    } catch {
      toast.error(t('admin:explorerGridExportFailed'))
    } finally {
      setExporting(false)
    }
  }

  const handleExportPdf = async () => {
    setExporting(true)
    try {
      const { columns, dataRows } = buildExportData()
      const { jsPDF } = await import('jspdf')
      const autoTable = (await import('jspdf-autotable')).default
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
      const now = new Date()
      const stamp = `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`
      doc.setFontSize(12)
      doc.text(`KSCW ${view} export — ${stamp} (${dataRows.length} entries)`, 14, 12)
      autoTable(doc, {
        head: [columns],
        body: dataRows,
        startY: 16,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [74, 85, 162] }, // KSCW brand blue
      })
      doc.save(exportName('pdf'))
    } catch {
      toast.error(t('admin:explorerGridExportFailed'))
    } finally {
      setExporting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  const groupableCols = COLUMNS.filter((c) => c.groupable)

  const renderMemberRow = (m: Member) => {
    const memberId = String(m.id)
    const memberRows = rowsByMember.get(memberId) ?? []
    return (
      <TableRow key={memberId} className="group min-h-11 hover:bg-muted/60">
        <TableCell className="sticky left-0 z-10 w-9 min-w-9 bg-background px-1 group-hover:bg-muted">
          <button
            type="button"
            onClick={() => onOpenDetail(memberId)}
            className="flex h-8 w-8 min-h-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t('admin:explorerGridOpenDetail')}
            aria-label={t('admin:explorerGridOpenDetail')}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </TableCell>
        {visibleCols.map((c, i) => {
          const sticky = i === 0 ? 'sticky left-9 z-10 bg-background group-hover:bg-muted' : ''
          if (c.kind === 'teams') {
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky}`}>
                <div className="flex flex-wrap items-center gap-1">
                  {memberRows.map((row) => {
                    const team = teamById.get(row.team)
                    const label = team ? teamLabel(team) : row.team
                    return (
                      <Chip
                        key={row.id}
                        label={label}
                        guest={row.guest_level > 0}
                        guestTitle={t('admin:explorerGridGuest')}
                        canEdit={canEdit}
                        onRemove={() => removeRoster(row)}
                      />
                    )
                  })}
                  {canEdit && (
                    <TeamPicker
                      teamSections={teamSections}
                      excludeIds={new Set(memberRows.map((r) => r.team))}
                      sportLabel={sportLabel}
                      genderLabel={genderLabel}
                      onPick={(teamId) => addRoster(memberId, teamId)}
                    />
                  )}
                </div>
              </TableCell>
            )
          }
          if (c.kind === 'clubdesk_sync') {
            const status = cache.clubdeskSync.get(memberId)
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1 text-sm`} title={t('admin:explorerGridReadOnly')}>
                {status
                  ? <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${SYNC_CHIP_CLASS[status]}`}>{syncLabel(status)}</span>
                  : <span className="text-muted-foreground">—</span>}
              </TableCell>
            )
          }
          if (c.kind === 'reg_files') {
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
                <RegFilesCell info={cache.regFiles.get(memberId)} />
              </TableCell>
            )
          }
          if (c.kind === 'bool') {
            const on = !!cellText(m, c.key)
            const label = t(`admin:${c.labelKey}`)
            // Writable flag → click-to-toggle; derived flags → read-only.
            // Either way, false shows no mark (only ✓ for true) for easy scanning.
            if (c.write && canEdit) {
              return (
                <TableCell key={c.key} className={`${c.minW} ${sticky} py-1 text-sm`}>
                  <BoolToggleCell on={on} label={label} onSave={(next) => saveCell(memberId, c.key, next)} />
                </TableCell>
              )
            }
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1 text-sm`} title={t('admin:explorerGridReadOnly')}>
                {on ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label={label} /> : null}
              </TableCell>
            )
          }
          if (c.kind === 'select') {
            const raw = rawField(m, c.key)
            const value = raw == null || raw === '' ? null : String(raw)
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
                <EditableSelectCell
                  value={value}
                  options={c.options ?? []}
                  canEdit={canEdit}
                  onSave={(v) => saveCell(memberId, c.key, v)}
                />
              </TableCell>
            )
          }
          if (c.kind === 'ro') {
            // Derived / system-managed columns (sport, referee, officials, role,
            // licence nr, last online) — no direct field to edit.
            const text = cellText(m, c.key)
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1 text-sm`} title={t('admin:explorerGridReadOnly')}>
                {text || <span className="text-muted-foreground">—</span>}
              </TableCell>
            )
          }
          const raw = rawField(m, c.key)
          const value = raw == null ? null : String(raw)
          return (
            <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
              <EditableCell
                value={value}
                kind={c.kind as 'text' | 'email' | 'date' | 'number'}
                canEdit={canEdit}
                display={
                  c.kind === 'date'
                    ? formatShortDate
                    : c.key === 'nationalitaet'
                      ? (v) => localizeCountryName(v)
                      : undefined
                }
                onSave={(v) => saveCell(memberId, c.key, v)}
              />
            </TableCell>
          )
        })}
      </TableRow>
    )
  }

  const renderTeamRow = (tm: Team) => {
    const teamId = String(tm.id)
    const roster = rosterByTeam.get(teamId) ?? []
    const coaches = coachByTeam.get(teamId) ?? []
    const trs = trByTeam.get(teamId) ?? []
    const staffCell = (kind: 'coach' | 'tr', rowsFor: StaffRow[]) => (
      <div className="flex flex-wrap items-center gap-1">
        {rowsFor.map((row) => (
          <Chip
            key={row.id}
            label={shortMemberName(memberById.get(row.member), row.member)}
            canEdit={canEdit}
            onRemove={() => removeStaff(kind, row)}
          />
        ))}
        {canEdit && (
          <MemberPicker
            members={cache.members}
            excludeIds={new Set(rowsFor.map((r) => r.member))}
            label={t('admin:explorerGridAddMember')}
            placeholder={t('admin:explorerGridSearchMembers')}
            empty={t('admin:explorerGridNoMembers')}
            onPick={(memberId) => addStaff(kind, teamId, memberId)}
          />
        )}
      </div>
    )
    return (
      <TableRow key={teamId} className="group min-h-11 hover:bg-muted/60">
        <TableCell className="sticky left-0 z-10 w-9 min-w-9 bg-background px-1 group-hover:bg-muted" />
        {teamVisibleCols.map((c, i) => {
          const sticky = i === 0 ? 'sticky left-9 z-10 bg-background group-hover:bg-muted' : ''
          if (c.key === 'members') {
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky}`}>
                <div className="flex max-w-2xl flex-wrap items-center gap-1">
                  {roster
                    .slice()
                    .sort((a, b) => shortMemberName(memberById.get(a.member), a.member)
                      .localeCompare(shortMemberName(memberById.get(b.member), b.member), 'de-CH'))
                    .map((row) => (
                      <Chip
                        key={row.id}
                        label={shortMemberName(memberById.get(row.member), row.member)}
                        guest={row.guest_level > 0}
                        guestTitle={t('admin:explorerGridGuest')}
                        canEdit={canEdit}
                        onRemove={() => removeRoster(row)}
                      />
                    ))}
                  {canEdit && (
                    <MemberPicker
                      members={cache.members}
                      excludeIds={new Set(roster.map((r) => r.member))}
                      label={t('admin:explorerGridAddMember')}
                      placeholder={t('admin:explorerGridSearchMembers')}
                      empty={t('admin:explorerGridNoMembers')}
                      onPick={(memberId) => addRoster(memberId, teamId)}
                    />
                  )}
                </div>
              </TableCell>
            )
          }
          if (c.key === 'coach') {
            return <TableCell key={c.key} className={`${c.minW} ${sticky}`}>{staffCell('coach', coaches)}</TableCell>
          }
          if (c.key === 'team_responsible') {
            return <TableCell key={c.key} className={`${c.minW} ${sticky}`}>{staffCell('tr', trs)}</TableCell>
          }
          if (c.kind === 'ro') {
            const text = teamCellText(tm, c.key)
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1 text-sm`}>
                {text || <span className="text-muted-foreground">—</span>}
              </TableCell>
            )
          }
          const raw = rawField(tm, c.key)
          return (
            <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
              <EditableCell
                value={raw == null ? null : String(raw)}
                kind="text"
                canEdit={canEdit}
                onSave={(v) => saveTeamCell(teamId, c.key, v)}
              />
            </TableCell>
          )
        })}
      </TableRow>
    )
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Group rail — md+ */}
      <aside className="hidden w-56 flex-shrink-0 overflow-y-auto border-r border-border bg-card px-2 py-2 md:block">
        <GroupButton
          active={selectedGroup === 'all'}
          label={view === 'teams' ? t('admin:explorerGridAllTeams') : t('admin:explorerGridAllMembers')}
          count={view === 'teams' ? cache.teams.length : cache.members.length}
          onClick={() => setSelectedGroup('all')}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        {teamSections.map((sec, i) => {
          const newSport = i === 0 || teamSections[i - 1].sport !== sec.sport
          const genderKey = GENDER_LABEL_KEY[sec.gender]
          return (
            <div key={`${sec.sport}-${sec.gender}`} className={newSport ? 'mt-2' : 'mt-1'}>
              {newSport && (
                <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {sportLabel(sec.sport)}
                </div>
              )}
              {genderKey && (
                <div className="px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {t(`admin:${genderKey}`)}
                </div>
              )}
              {sec.teams.map((tm) => (
                <GroupButton
                  key={tm.id}
                  active={selectedGroup === tm.id}
                  label={tm.label}
                  count={tm.count}
                  onClick={() => setSelectedGroup(tm.id)}
                />
              ))}
            </div>
          )
        })}
      </aside>

      {/* Grid pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-1.5">
          {/* Member / team view toggle */}
          <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label={t('admin:explorerViewToggle')}>
            <button
              type="button"
              onClick={() => changeView('members')}
              className={
                'px-2 py-1 text-xs font-medium ' +
                (view === 'members' ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted')
              }
              aria-pressed={view === 'members'}
            >
              {t('admin:explorerGridViewMembers')}
            </button>
            <button
              type="button"
              onClick={() => changeView('teams')}
              className={
                'px-2 py-1 text-xs font-medium ' +
                (view === 'teams' ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted')
              }
              aria-pressed={view === 'teams'}
            >
              {t('admin:explorerGridViewTeams')}
            </button>
          </div>

          {/* Mobile group picker (native select — needs explicit dark bg) */}
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="max-w-[35%] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground dark:bg-gray-800 md:hidden"
            aria-label={t('admin:explorerGridGroups')}
          >
            <option value="all">{view === 'teams' ? t('admin:explorerGridAllTeams') : t('admin:explorerGridAllMembers')}</option>
            {teamSections.map((sec) => {
              const genderKey = GENDER_LABEL_KEY[sec.gender]
              const label = genderKey ? `${sportLabel(sec.sport)} · ${t(`admin:${genderKey}`)}` : sportLabel(sec.sport)
              return (
                <optgroup key={`${sec.sport}-${sec.gender}`} label={label}>
                  {sec.teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>{tm.label}</option>
                  ))}
                </optgroup>
              )
            })}
          </select>

          <span className="text-xs text-muted-foreground">
            {t('admin:explorerGridEntries', { count: totalShown })}
          </span>
          {!canEdit && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('admin:explorerGridReadOnly')}
            </span>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            {/* Group by — members view only */}
            {view === 'members' && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('admin:explorerGridGroupBy')}</span>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as ColKey | 'none')}
                  className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground dark:bg-gray-800"
                  aria-label={t('admin:explorerGridGroupBy')}
                >
                  <option value="none">{t('admin:explorerGridGroupNone')}</option>
                  {groupableCols.map((c) => (
                    <option key={c.key} value={c.key}>{t(`admin:${c.labelKey}`)}</option>
                  ))}
                </select>
              </label>
            )}

            {/* Export */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={exporting || totalShown === 0}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{t('admin:explorerGridExport')}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { void handleExportExcel() }}>
                  {t('admin:explorerGridExportExcel')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => { void handleExportPdf() }}>
                  {t('admin:explorerGridExportPdf')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Column chooser */}
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('admin:explorerGridColumns')}</span>
                  <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {view === 'teams' ? teamVisibleCols.length : visibleCols.length}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="max-h-80 w-56 overflow-y-auto p-2">
                <div className="space-y-1">
                  {view === 'teams'
                    ? TEAM_COLUMNS.map((c) => (
                      <label key={c.key} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-muted">
                        <Checkbox checked={teamVisibleKeys.includes(c.key)} onCheckedChange={() => toggleTeamCol(c.key)} />
                        {t(`admin:${c.labelKey}`)}
                      </label>
                    ))
                    : COLUMNS.map((c) => (
                      <label key={c.key} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-muted">
                        <Checkbox checked={visibleKeys.includes(c.key)} onCheckedChange={() => toggleCol(c.key)} />
                        {t(`admin:${c.labelKey}`)}
                      </label>
                    ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Table — this div is the single scroll container for both axes.
            shadcn's <Table> wraps the <table> in its own overflow-x-auto div;
            left as-is that inner wrapper becomes the scroll context and the
            sticky header (top-0) sticks to it instead of here → header scrolls
            away. Neutralise it with [&>div]:overflow-visible so sticky top-0 /
            left-0 anchor to this scroller and the header + first column freeze. */}
        <div className="min-h-0 flex-1 overflow-auto [&>div]:overflow-visible">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {/* Leading actions column — sticky with the first data column.
                    Sticky lives on the th cells (not thead) for cross-browser
                    reliability. */}
                <TableHead className="sticky left-0 top-0 z-30 w-9 min-w-9 bg-card px-1" />
                {(view === 'teams' ? teamVisibleCols : visibleCols).map((c, i) => (
                  <TableHead
                    key={c.key}
                    className={`${c.minW} sticky top-0 whitespace-nowrap bg-card ${i === 0 ? 'left-9 z-30' : 'z-20'}`}
                  >
                    <button
                      type="button"
                      onClick={() => (view === 'teams' ? toggleTeamSort(c.key as TeamColKey) : toggleSort(c.key as ColKey))}
                      className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary"
                    >
                      {t(`admin:${c.labelKey}`)}
                      {(view === 'teams' ? teamSort?.key === c.key : sort?.key === c.key)
                        ? ((view === 'teams' ? teamSort?.dir : sort?.dir) === 'asc'
                          ? <ArrowUp className="h-3 w-3" />
                          : <ArrowDown className="h-3 w-3" />)
                        : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {totalShown === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={(view === 'teams' ? teamVisibleCols.length : visibleCols.length) + 1}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {t('admin:explorerGridEmpty')}
                  </TableCell>
                </TableRow>
              )}
              {view === 'members'
                ? sections.map((section, si) => (
                  <SectionRows
                    key={section.label ?? `s${si}`}
                    label={section.label}
                    colSpan={visibleCols.length + 1}
                    count={section.rows.length}
                  >
                    {section.rows.map(renderMemberRow)}
                  </SectionRows>
                ))
                : teamSectionsWithRows.map((section) => (
                  <SectionRows
                    key={section.label}
                    label={section.label}
                    colSpan={teamVisibleCols.length + 1}
                    count={section.teams.length}
                  >
                    {section.teams.map(renderTeamRow)}
                  </SectionRows>
                ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}

/** A group-by / sport section: optional header row + its rows. */
function SectionRows({ label, colSpan, count, children }: {
  label: string | null
  colSpan: number
  count: number
  children: ReactNode
}) {
  return (
    <>
      {label != null && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colSpan} className="bg-muted/60 py-1.5 text-xs font-semibold text-foreground">
            {label}
            <span className="ml-2 font-normal text-muted-foreground">{count}</span>
          </TableCell>
        </TableRow>
      )}
      {children}
    </>
  )
}

function GroupButton({
  active, label, count, onClick, icon,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex w-full min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm ' +
        (active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted')
      }
    >
      {icon}
      <span className="truncate">{label}</span>
      <span className={'ml-auto text-xs ' + (active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
        {count}
      </span>
    </button>
  )
}

/** Removable chip used by the Teams / Members / Coach / TR columns. */
function Chip({
  label, guest, guestTitle, canEdit, onRemove,
}: {
  label: string
  guest?: boolean
  guestTitle?: string
  canEdit: boolean
  onRemove: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const handleRemove = async () => {
    setBusy(true)
    try {
      await onRemove()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span
      className={
        'inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs ' +
        (guest
          ? 'border-dashed border-muted-foreground/50 text-muted-foreground'
          : 'border-border bg-muted/60 text-foreground')
      }
      title={guest && guestTitle ? `${label} — ${guestTitle}` : label}
    >
      {label}
      {guest && <span className="font-semibold">G</span>}
      {canEdit && (
        <button
          type="button"
          onClick={() => { void handleRemove() }}
          disabled={busy}
          className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
          aria-label={`× ${label}`}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </span>
  )
}

/** Searchable team-add popover (members view Teams column). */
function TeamPicker({
  teamSections, excludeIds, sportLabel, genderLabel, onPick,
}: {
  teamSections: TeamSection[]
  excludeIds: Set<string>
  sportLabel: (s: Sport) => string
  genderLabel: (g: GenderKey) => string
  onPick: (teamId: string) => Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const handlePick = async (teamId: string) => {
    setOpen(false)
    setBusy(true)
    try {
      await onPick(teamId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('explorerGridSaveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          title={t('explorerGridAddToTeam')}
          aria-label={t('explorerGridAddToTeam')}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t('explorerGridSearchTeams')} />
          <CommandList>
            <CommandEmpty>{t('explorerGridNoTeams')}</CommandEmpty>
            {teamSections.map((sec) => {
              const available = sec.teams.filter((tm) => !excludeIds.has(tm.id))
              if (available.length === 0) return null
              const heading = sec.gender !== 'other'
                ? `${sportLabel(sec.sport)} · ${genderLabel(sec.gender)}`
                : sportLabel(sec.sport)
              return (
                <CommandGroup key={`${sec.sport}-${sec.gender}`} heading={heading}>
                  {available.map((tm) => (
                    <CommandItem
                      key={tm.id}
                      value={`${tm.label} ${heading}`}
                      onSelect={() => { void handlePick(tm.id) }}
                    >
                      {tm.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** Searchable member-add popover (team view Members / Coach / TR columns). */
function MemberPicker({
  members, excludeIds, label, placeholder, empty, onPick,
}: {
  members: Member[]
  excludeIds: Set<string>
  label: string
  placeholder: string
  empty: string
  onPick: (memberId: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const handlePick = async (memberId: string) => {
    setOpen(false)
    setBusy(true)
    try {
      await onPick(memberId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  const available = members.filter((m) => !excludeIds.has(String(m.id)))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          title={label}
          aria-label={label}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{empty}</CommandEmpty>
            {available.map((m) => {
              const name = `${m.last_name ?? ''} ${m.first_name ?? ''}`.trim() || `#${m.id}`
              return (
                <CommandItem
                  key={String(m.id)}
                  value={`${name} ${m.email ?? ''}`}
                  onSelect={() => { void handlePick(String(m.id)) }}
                >
                  {name}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Inline-editable cell: click to edit (when allowed), Enter/blur commits,
// Escape cancels. Only the changed value is PATCHed; a brief check flash
// confirms the save without a toast per keystroke-sized edit.
function EditableCell({
  value, kind, canEdit, display, onSave,
}: {
  value: string | null
  kind: 'text' | 'email' | 'date' | 'number'
  canEdit: boolean
  display?: (v: string) => string
  onSave: (v: string | null) => Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)
  // Guards the unmount blur: Enter commits then blur fires again (double PATCH),
  // and Escape's unmount blur would commit a cancelled draft.
  const doneRef = useRef(false)

  const startEdit = () => {
    if (!canEdit || editing || saving) return
    doneRef.current = false
    setDraft(value ?? '')
    setEditing(true)
  }

  const commit = async () => {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    const next = draft.trim() === '' ? null : draft.trim()
    if (next === (value ?? null)) return
    setSaving(true)
    try {
      await onSave(next)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 1200)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('explorerGridSaveError'))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <input
        type={kind === 'text' ? 'text' : kind}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { void commit() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit() }
          if (e.key === 'Escape') { e.preventDefault(); doneRef.current = true; setEditing(false) }
        }}
        className="w-full min-w-24 rounded border border-primary bg-background px-1.5 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:bg-gray-800"
      />
    )
  }

  const shown = value == null || value === ''
    ? null
    : display
      ? display(value)
      : value

  return (
    <div
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={startEdit}
      onKeyDown={(e) => { if (canEdit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startEdit() } }}
      className={
        'flex min-h-7 items-center gap-1 rounded px-1 -mx-1 text-sm ' +
        (canEdit ? 'cursor-text hover:bg-muted/80 hover:ring-1 hover:ring-border ' : '') +
        (flash ? 'ring-1 ring-emerald-500/70 ' : '')
      }
    >
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {flash && !saving && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
      {shown ?? <span className="text-muted-foreground">—</span>}
    </div>
  )
}

// Inline enum cell (sex / language): click to reveal a native <select>; picking
// commits immediately. At rest it shows the option's display label. Native
// <select> needs an explicit dark bg so its dropdown isn't white in dark mode.
function EditableSelectCell({
  value, options, canEdit, onSave,
}: {
  value: string | null
  options: SelectOption[]
  canEdit: boolean
  onSave: (v: string | null) => Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)

  const label = value != null ? (options.find((o) => o.value === value)?.label ?? value) : null

  const commit = async (next: string | null) => {
    setEditing(false)
    if (next === (value ?? null)) return
    setSaving(true)
    try {
      await onSave(next)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 1000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('explorerGridSaveError'))
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <select
        autoFocus
        value={value ?? ''}
        onChange={(e) => { void commit(e.target.value === '' ? null : e.target.value) }}
        onBlur={() => setEditing(false)}
        className="w-full min-w-16 rounded border border-primary bg-background px-1 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary dark:bg-gray-800"
      >
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )
  }

  return (
    <div
      role={canEdit ? 'button' : undefined}
      tabIndex={canEdit ? 0 : undefined}
      onClick={() => { if (canEdit && !saving) setEditing(true) }}
      onKeyDown={(e) => { if (canEdit && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditing(true) } }}
      className={
        'flex min-h-7 items-center gap-1 rounded px-1 -mx-1 text-sm ' +
        (canEdit ? 'cursor-pointer hover:bg-muted/80 hover:ring-1 hover:ring-border ' : '') +
        (flash ? 'ring-1 ring-emerald-500/70 ' : '')
      }
    >
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {flash && !saving && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
      {label ?? <span className="text-muted-foreground">—</span>}
    </div>
  )
}

// Inline boolean cell for directly-writable member flags (scorer_vb,
// wiedisync_active). True renders ✓; false renders nothing (only a faint box on
// hover) so the checked rows stand out at a glance. Click toggles + saves.
function BoolToggleCell({
  on, label, onSave,
}: {
  on: boolean
  label: string
  onSave: (next: boolean) => Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)

  const toggle = async () => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(!on)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 1000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('explorerGridSaveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={saving}
      onClick={() => { void toggle() }}
      className={
        'group/bool flex h-6 w-8 items-center justify-center rounded hover:bg-muted/70 disabled:opacity-50 ' +
        (flash ? 'ring-1 ring-emerald-500/70 ' : '')
      }
    >
      {saving
        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        : on
          ? <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          : <span className="h-3.5 w-3.5 rounded-sm border border-muted-foreground/50 opacity-0 transition-opacity group-hover/bool:opacity-100" />}
    </button>
  )
}

// Read-only reg-files cell: a popover of the member's retained registration
// documents (post-approval). Each opens via the admin asset URL (board/admin
// folder-scoped read). Blank when the member has none / the viewer can't read
// registrations.
function RegFilesCell({ info }: { info: RegFileInfo | undefined }) {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const docs = info?.docs ?? []
  if (docs.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs text-foreground hover:bg-muted"
          title={info?.referenceNumber ? `${t('explorerGridColRegFiles')} · ${info.referenceNumber}` : t('explorerGridColRegFiles')}
        >
          <FileText className="h-3.5 w-3.5" />
          {docs.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="space-y-0.5">
          {docs.map((d) => {
            const label = REG_DOC_LABEL_KEY[d.field] ? t(REG_DOC_LABEL_KEY[d.field]) : d.field
            return (
              <button
                key={d.fileId}
                type="button"
                onClick={() => { void openPrivateFile(assetUrl(d.fileId), () => toast.error(t('explorerGridFileError'))) }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
