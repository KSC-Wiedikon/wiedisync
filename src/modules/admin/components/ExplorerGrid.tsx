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

import { useCallback, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ChevronRight, Download, Eye, FileText,
  Layers, Loader2, Lock, Pencil, Plus, Settings2, Unlock, UserMinus, Users, X,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import DatePicker from '@/components/ui/DatePicker'
import { buildMemberGroups, countMembers, type MemberGroupNode } from './memberGroups'
import { MEMBER_FIELDS, getFieldGroup } from './memberFieldSchema'
import { rankMemberFields } from './memberFieldSearch'
import type { Member, Team } from '../../../types'
import { assetUrl, createRecord, deleteRecord, updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { getCurrentSeason } from '../../../utils/dateHelpers'
import { localizeCountryName } from '../../../utils/countryName'
import {
  NO_FEDERATION, countryLabel, countryOptions, formatCountryCodes,
  parseCountryCodes, serializeCountryCodes,
} from '../../../utils/countries'
import { LANGUAGES } from '../../../i18n/languageConfig'
import { coercePositions, getPositionI18nKey } from '../../../utils/memberPositions'
import { MEMBER_MULTI_FIELDS, optionLabel } from './memberFieldOptions'
import { useConfirm } from '../../../components/ConfirmProvider'
import CountryMultiSelect from '../../../components/CountryMultiSelect'
import { FilePreviewDialog } from '../../../components/FilePreview'
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
import { memberFieldLabel } from './memberFieldSearch'
import ExplorerBulkEditModal from './ExplorerBulkEditModal'
import ExplorerBulkDepartModal from './ExplorerBulkDepartModal'
import type { CacheShape, MemberTeamRow, StaffRow, ClubdeskSyncStatus, RegFileInfo } from './explorerHelpers'
import { buildMemberTeamsMap, buildStaffMap, formatShortDate, formatShortDateTime, teamLabel } from './explorerHelpers'

interface Props {
  /** Filtered cache from the page (member filters already applied). */
  cache: CacheShape
  /**
   * Every member the page loaded, filters ignored. Feeds the rail's
   * register-status groups only — see the note on ExplorerTree's same prop.
   */
  allMembers: ReadonlyArray<Member>
  /** Header quick-search query — filters grid rows client-side. */
  query: string
  /** Whether the viewer may edit (global admin or sport admin). */
  canEdit: boolean
  /** Unlocks the `privileged` fields in bulk edit — same gate as the detail view. */
  isGlobalAdmin: boolean
  /**
   * Datapoint focus from the header picker. Every key that HAS a member column
   * here is force-shown next to the name, on top of the saved column set and
   * without touching it — a focus is a look, not a preference change.
   */
  focusFields?: string[]
  /** Jump to the tree/detail view for a member. */
  onOpenDetail: (memberId: string) => void
  /** Apply an optimistic update to the underlying explorer cache. */
  onMutate: (updater: (prev: CacheShape) => CacheShape) => void
  /**
   * Lets the page drive the selection from the header search box — see
   * ExplorerGridHandle. A plain prop rather than a forwarded `ref` so the
   * channel is named for what it carries.
   */
  apiRef?: RefObject<ExplorerGridHandle | null>
}

/**
 * What the page may ask the grid to do.
 *
 * `addShownToSelection` exists so typing a name in the header search and
 * pressing Enter banks that person and clears the box, ready for the next one.
 * The grid owns both the selection and the filtered row list, and neither
 * belongs in the page — so the page asks rather than computes.
 */
export interface ExplorerGridHandle {
  /** Adds every currently-listed member. Returns how many were added. */
  addShownToSelection: () => number
}

type GridView = 'members' | 'teams'

// ── Member-view columns ──────────────────────────────────────────

/**
 * The hand-written columns, plus any other `members` column key.
 *
 * ⚠ `(string & {})` keeps autocomplete on the named ones while admitting the
 * generated ones (see `extraColumns`) — the picker offers every datapoint the
 * page actually fetched, and those keys are only known at runtime.
 */
type ColKey =
  | (string & {})
  | 'last_name' | 'first_name' | 'teams' | 'email' | 'phone'
  // `nationalitaet_codes` replaces the old free-text `nationalitaet` column:
  // that one is now trigger-derived (migration 223) and must never be editable.
  | 'adresse' | 'plz' | 'ort' | 'nationalitaet_codes'
  | 'federation_of_origin' | 'birthdate'
  | 'sex' | 'language' | 'number' | 'position' | 'license_nr'
  | 'vm_email' | 'ahv_nummer' | 'beitragskategorie' | 'role'
  // The club register's own membership facts (migration 302).
  | 'register_status' | 'eintritt' | 'austritt' | 'kantonsschule'
  | 'sport' | 'scorer_vb' | 'referee' | 'officials'
  | 'wiedisync_active' | 'last_online_at' | 'passive' | 'honorary' | 'former'
  | 'clubdesk_sync' | 'reg_files'

type ColKind = 'text' | 'email' | 'date' | 'number' | 'teams' | 'ro' | 'bool' | 'select'
  | 'countries' | 'federation' | 'clubdesk_sync' | 'reg_files'

interface SelectOption { value: string; label: string }

interface ColDef<K extends string = ColKey> {
  key: K
  /** i18n key. Absent on generated columns, which carry `rawLabel` instead. */
  labelKey?: string
  /** English label straight from the member field schema (generated columns). */
  rawLabel?: string
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
  /** Display-only, even where the kind would otherwise be inline-editable.
   *  For columns whose value is only valid in combination with another one, so
   *  the single editing surface has to be the member detail — see
   *  `register_status` / `austritt` (migration 302). */
  readOnly?: boolean
}

// Enum option lists for inline-editable select cells. Sex is stored m/f;
// language is stored as the backend value (german / english / …) shown by its
// native name.
//
// The labels are the ones MEMBER_SELECT_FIELDS uses in the member detail, so
// the same column reads the same way in both places — and neither shows the
// stored code, which is lowercase in the database and would break the
// sentence-case rule the moment it reached the screen.
const SEX_OPTIONS: SelectOption[] = [
  { value: 'm', label: 'Male' },
  { value: 'f', label: 'Female' },
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

// Full catalog — everything the explorer cache already loads (plus derived
// columns). Default view shows only the name; the rest is opt-in via the
// column chooser.
/**
 * A column's header text. Hand-written columns carry an i18n key; generated
 * ones carry the member schema's English label, which is also exactly what an
 * export wants — every export is English regardless of UI locale.
 */
function colLabel(c: { labelKey?: string; rawLabel?: string; key: string }, translate: (k: string) => string): string {
  return c.labelKey ? translate(c.labelKey) : (c.rawLabel ?? c.key)
}

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
  { key: 'nationalitaet_codes', labelKey: 'explorerGridColNationality', kind: 'countries', minW: 'min-w-40', groupable: true },
  { key: 'federation_of_origin', labelKey: 'explorerGridColFederation', kind: 'federation', minW: 'min-w-40', groupable: true },
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
  // Read-only here on purpose. Changing a status is never a one-cell edit: it
  // prefills or clears the exit date and switches off club membership + app
  // access behind a confirm, and the DB refuses the mismatched pair outright
  // (members_austritt_needs_departed_status). A free-text grid cell would offer
  // none of that and would fail a CHECK on the first typo, so both move
  // together in the member detail. `eintritt` stands alone and stays editable.
  { key: 'register_status', labelKey: 'explorerGridColRegisterStatus', kind: 'text', minW: 'min-w-40', groupable: true, readOnly: true },
  { key: 'eintritt', labelKey: 'explorerGridColEintritt', kind: 'date', minW: 'min-w-28', groupable: true },
  { key: 'austritt', labelKey: 'explorerGridColAustritt', kind: 'date', minW: 'min-w-28', groupable: true, readOnly: true },
  { key: 'beitragskategorie', labelKey: 'explorerGridColFeeCategory', kind: 'text', minW: 'min-w-36', groupable: true },
  // Groupable on purpose: "how many of ours are at KS Wiedikon" is the whole
  // reason the column exists (migration 315).
  { key: 'kantonsschule', labelKey: 'explorerGridColKantonsschule', kind: 'text', minW: 'min-w-44', groupable: true },
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
const MEMBER_FIELD_KEYS: ReadonlySet<string> = new Set(MEMBER_FIELDS.map((f) => f.key))
/**
 * What the grid opens with. Two columns (name only) was a placeholder that made
 * every fresh browser useless until you went column-shopping; this is the set
 * the club actually works in — who they are, how to reach them, and the two
 * register facts that decide what they owe.
 *
 * ⚠ Bumping the storage key below RESETS everyone's saved choice. Done
 * deliberately when this default changed: the whole point was that the saved
 * two-column set was the thing being complained about.
 */
const DEFAULT_VISIBLE: ColKey[] = [
  'last_name', 'first_name', 'teams', 'email', 'phone',
  'adresse', 'plz', 'ort', 'birthdate', 'register_status',
]
const VISIBLE_COLS_LS_KEY = 'kscw-explorer-grid-cols-v2'

/**
 * Datapoints that exist but make no sense as a grid column: a file id renders
 * as a uuid, and the E2EE material is unreadable by design — the club genuinely
 * cannot decrypt it, so a column of ciphertext would only invite the question.
 */
const SKIP_AS_COLUMN: ReadonlySet<string> = new Set([
  'photo', 'e2ee_public_key', 'e2ee_private_key', 'e2ee_kdf_salt', 'e2ee_key_created',
])

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

/**
 * `known` is a predicate, not the column map: a saved set may name a GENERATED
 * column, and those are only known once the cache has landed. Validating
 * against the hand-written map alone would silently drop every datapoint column
 * the operator had chosen, on every reload.
 */
function loadVisible<K extends string>(lsKey: string, known: (k: string) => boolean, fallback: K[]): K[] {
  try {
    const raw = localStorage.getItem(lsKey)
    if (!raw) return fallback
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return fallback
    const valid = (arr as K[]).filter((k) => known(k))
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
  return `${m.last_name ?? ''} ${m.nickname || m.first_name || ''}`.trim() || fallback
}

export default function ExplorerGrid({
  cache, allMembers, query, canEdit, isGlobalAdmin, focusFields, onOpenDetail, onMutate, apiRef,
}: Props) {
  const { t, i18n } = useTranslation(['admin', 'common'])
  const confirm = useConfirm()

  const [view, setView] = useState<GridView>(() => {
    try { return localStorage.getItem(VIEW_LS_KEY) === 'teams' ? 'teams' : 'members' } catch { return 'members' }
  })
  /**
   * Inline editing is OPT-IN and never persisted.
   *
   * ⚠ Deliberately not remembered across sessions: this grid is mostly read —
   * scrolling 700 members across 100 datapoints — and a mode that silently
   * survives a reload turns a stray click on a cell into an edit of the club's
   * legal register. Off every time you arrive; one click when you mean it.
   */
  const [editMode, setEditMode] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<'all' | string>('all')
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' } | null>(null)
  const [teamSort, setTeamSort] = useState<{ key: TeamColKey; dir: 'asc' | 'desc' } | null>(null)
  const [visibleKeys, setVisibleKeys] = useState<ColKey[]>(() => loadVisible(VISIBLE_COLS_LS_KEY, (k) => COL_BY_KEY.has(k) || MEMBER_FIELD_KEYS.has(k), DEFAULT_VISIBLE))
  const [teamVisibleKeys, setTeamVisibleKeys] = useState<TeamColKey[]>(() => loadVisible(TEAM_VISIBLE_COLS_LS_KEY, (k) => TEAM_COL_BY_KEY.has(k as TeamColKey), TEAM_DEFAULT_VISIBLE))
  const [groupBy, setGroupBy] = useState<ColKey | 'none'>('none')
  const [exporting, setExporting] = useState(false)

  /**
   * Multi-select for the bulk actions — the member RECORD, not just the id.
   *
   * ⚠ The record is captured at tick time on purpose. `cache` here is already
   * filtered by the page (member filters are applied before the grid sees it),
   * so an id-only selection would silently lose every member the operator ticks
   * and then filters away — which is exactly the workflow this exists for
   * ("search A, tick some, search B, tick some more, edit all of them").
   * `selectedMembers` still prefers the live cache row when there is one, so a
   * value edited in between is not stale.
   */
  const [selection, setSelection] = useState<Map<string, Member>>(() => new Map())
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkDepartOpen, setBulkDepartOpen] = useState(false)
  /**
   * Bumped on every open and used as the modal's `key`, so each one starts on a
   * blank composition instead of the last one's. Remounting on OPEN rather than
   * unmounting on close keeps the dialog's exit animation, and beats resetting
   * the state in an effect (`react-hooks/set-state-in-effect`).
   */
  const [bulkSession, setBulkSession] = useState(0)
  const openBulk = useCallback((which: 'edit' | 'depart') => {
    setBulkSession((n) => n + 1)
    if (which === 'edit') setBulkEditOpen(true)
    else setBulkDepartOpen(true)
  }, [])

  const changeView = (next: GridView) => {
    setView(next)
    // The rail means different things in the two views — a member group key
    // ("officials:bb:otr1") matches no team, and a team id matches no member
    // group, so a carried-over selection would silently empty the grid.
    setSelectedGroup('all')
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

  // The member rail draws the SAME tree as the Tree view — Volleyball /
  // Basketball each owning Teams · Officials · Staff · Other, then the
  // club-level groups. Built from the shared builder so the two views can never
  // disagree about who is in a group.
  const memberGroups = useMemo(
    () => buildMemberGroups(cache.members, allMembers, cache),
    [cache, allMembers],
  )

  /** group key → member ids, flattened once for the row filter. */
  const groupMemberIds = useMemo(() => {
    const map = new Map<string, Set<string>>()
    const walk = (n: MemberGroupNode): Set<string> => {
      const own = new Set<string>(n.memberIds ?? [])
      n.children?.forEach((c) => walk(c).forEach((id) => own.add(id)))
      map.set(n.key, own)
      return own
    }
    memberGroups.forEach(walk)
    return map
  }, [memberGroups])

  const [railOpen, setRailOpen] = useState<Set<string>>(new Set())
  const toggleRail = (key: string) =>
    setRailOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

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

  /** A group's own label — an i18n key, or a raw name (team, OTR1) as-is. */
  /**
   * Every other member datapoint the page holds, offered as a read-only column.
   *
   * ⚠ Gated on the keys PRESENT IN THE FETCHED ROWS, not on the schema alone.
   * `useExplorerCache` requests ~60 of the ~110 member columns — some are left
   * out because they 403 the whole batch for a Vorstand or coach audience — and
   * Directus returns only what was asked for. Offering a column the page never
   * fetched would render an empty cell for all 700 members, which reads as
   * "nobody has an AHV number" rather than "this page did not ask".
   */
  const extraColumns = useMemo((): ColDef[] => {
    const present = new Set<string>()
    for (const m of cache.members.slice(0, 20)) for (const k of Object.keys(m)) present.add(k)
    return MEMBER_FIELDS
      .filter((f) => present.has(f.key) && !COL_BY_KEY.has(f.key) && !SKIP_AS_COLUMN.has(f.key))
      .map((f) => ({ key: f.key, rawLabel: f.label, kind: 'ro' as const, minW: 'min-w-36' }))
  }, [cache.members])

  const memberColumns = useMemo(() => [...COLUMNS, ...extraColumns], [extraColumns])
  const memberColByKey = useMemo(
    () => new Map(memberColumns.map((c) => [c.key, c])),
    [memberColumns],
  )

  /** `t` narrowed to the admin namespace, for `colLabel`. */
  const tCol = useCallback((k: string) => t(`admin:${k}`), [t])

  const groupLabel = useCallback(
    (node: MemberGroupNode): string => node.raw ?? (node.labelKey ? t(node.labelKey) : node.key),
    [t],
  )

  const genderLabel = useMemo(() => (g: GenderKey): string => {
    const key = GENDER_LABEL_KEY[g]
    return key ? t(`admin:${key}`) : ''
  }, [t])

  const syncLabel = useMemo(() => (status: ClubdeskSyncStatus | undefined): string => {
    if (!status) return ''
    return t(`admin:${SYNC_LABEL_KEY[status]}`)
  }, [t])

  // 'NONE' is an explicit answer ("never licensed elsewhere") and must read as
  // such — null is simply unanswered and stays blank.
  const federationLabel = useMemo(() => (code: string | null | undefined): string => {
    const v = String(code ?? '').trim().toUpperCase()
    if (!v) return ''
    return v === NO_FEDERATION ? t('admin:federationNone') : (countryLabel(v) || v)
  }, [t])

  // Positions ARE localized (the roster and the profile picker show the same
  // names), unlike the role / sex lists, whose one label set in
  // memberFieldOptions is English everywhere the explorer renders it.
  const positionLabel = useMemo(() => (position: string): string => {
    const key = getPositionI18nKey(position)
    return key ? t(`teams:${key}`) : position
  }, [t])

  // Options for the inline federation select — localized, so rebuilt on a
  // language switch. 'None' leads; the rest is favourites-first countryOptions.
  const federationOptions = useMemo<SelectOption[]>(
    () => [{ value: NO_FEDERATION, label: t('admin:federationNone') }, ...countryOptions()],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- countryOptions() is locale-derived
    [t, i18n.language],
  )

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
          // otn1_bb/otn2_bb are the Basketplan levels (migration 228). A member
          // can hold both — Basketplan records `otn1_since` AND `otn2_since` for
          // an upgraded official — so emit each independently and let the dedupe
          // run. (The coarse `otn_bb` they replaced was dropped by migration
          // 303; every one of its 8 holders also held a level.)
          if (rawField(m, 'otn1_bb')) tokens.push('OTN1')
          if (rawField(m, 'otn2_bb')) tokens.push('OTN2')
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
        case 'nationalitaet_codes': {
          // Localized names, never raw codes — this feeds search, sort, group-by
          // AND the Excel/PDF export.
          const coded = formatCountryCodes(rawField(m, 'nationalitaet_codes') as string | null)
          if (coded) return coded
          // Fallback for rows migration 223's backfill could not resolve: show
          // the trigger-derived ClubDesk name rather than an empty cell.
          const legacy = rawField(m, 'nationalitaet')
          return legacy ? localizeCountryName(String(legacy)) : ''
        }
        case 'federation_of_origin':
          return federationLabel(rawField(m, 'federation_of_origin') as string | null)
        // The four columns whose stored value is a lowercase code. Without a
        // label they reach the screen — and the Excel export — as `staff_only`,
        // `["user", "vorstand"]`, `m` and `german`. Each already has exactly one
        // label list elsewhere in the app, and these reuse it rather than
        // inventing a second: positions from memberPositions.ts (the same names
        // the roster and the profile picker show), roles and sex from
        // memberFieldOptions (the same labels the member detail shows), and
        // languages from languageConfig, by native name.
        case 'position':
          return coercePositions(rawField(m, 'position'))
            .map((p) => positionLabel(p))
            .join(', ')
        case 'role': {
          const raw = rawField(m, 'role')
          const codes = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : []
          return codes.map((c) => optionLabel(MEMBER_MULTI_FIELDS.role, c)).join(', ')
        }
        case 'sex':
          return optionLabel(SEX_OPTIONS, String(rawField(m, 'sex') ?? ''))
        case 'language': {
          const code = String(rawField(m, 'language') ?? '')
          return code ? optionLabel(LANGUAGE_OPTIONS, code) : ''
        }
        default: {
          const raw = rawField(m, key)
          if (raw == null || raw === '') return ''
          if (Array.isArray(raw)) return raw.map(String).join(', ')
          return String(raw)
        }
      }
    }
  }, [rowsByMember, teamById, cache.memberCoachTeams, cache.memberTrTeams, cache.clubdeskInfo, cache.clubdeskSync, cache.regFiles, sportLabel, syncLabel, federationLabel, positionLabel])

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
    let list: ReadonlyArray<Member> = cache.members
    if (selectedGroup !== 'all') {
      // The rail selects a GROUP now (a team, an officials grade, "Former
      // members", …), so membership comes from the same tree the Tree view
      // draws rather than from a team-id match — one definition of "who is in
      // this group", not two that drift.
      //
      // ⚠ Resolved against ALL members, not the filtered working set. The
      // register-status groups are built from the unfiltered list by design, so
      // intersecting them with an active-only default made the rail say
      // "Former members 29" and the grid show 7 — a count that disagrees with
      // the rows under it is worse than either number alone. For every other
      // group the ids already come from the filtered list, so this is a no-op.
      const inGroup = groupMemberIds.get(selectedGroup)
      list = inGroup ? allMembers.filter((m) => inGroup.has(String(m.id))) : list
    }
    if (query) {
      const q = query.toLowerCase()
      // ⚠ COLUMNS, not every datapoint: the generated columns take the
      // catalog to ~100, and rebuilding 700 × 100 cell strings on each
      // keystroke is not what a search box should cost.
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
  }, [cache.members, allMembers, selectedGroup, query, sort, groupMemberIds, cellText])

  // ── Multi-select ───────────────────────────────────────────────────

  /**
   * May the operator change anything right now. `canEdit` is the permission;
   * `editMode` is the intent. Both are required — see the note on `editMode`.
   */
  const canEditNow = canEdit && editMode

  /** Selection is a members-view feature; the teams view has no bulk actions.
   *  Gated on edit mode too: the ticks exist to feed bulk edit and departure,
   *  so offering them while the grid is in read mode promises an action the
   *  mode is meant to withhold. */
  const selectable = view === 'members' && canEditNow

  // The leading actions column holds the eye button alone, or a tick box next to
  // it. Both the column and the first data column's sticky offset have to move
  // together — they are the two frozen columns, and a mismatch leaves the name
  // column overlapping the tick boxes as soon as the grid scrolls sideways.
  const leadWidth = selectable ? 'w-16 min-w-16' : 'w-9 min-w-9'
  const leadOffset = selectable ? 'left-16' : 'left-9'

  /**
   * The selected members, refreshed from the live cache where it still carries
   * them. A member ticked and then filtered out of `cache.members` keeps the
   * record captured at tick time — see the `selection` state.
   */
  const selectedMembers = useMemo(
    () => [...selection.entries()].map(([id, captured]) => memberById.get(id) ?? captured),
    [selection, memberById],
  )

  const toggleRow = useCallback((member: Member) => {
    setSelection((prev) => {
      const next = new Map(prev)
      const id = String(member.id)
      if (next.has(id)) next.delete(id)
      else next.set(id, member)
      return next
    })
  }, [])

  /**
   * Header tick box: adds every row currently shown, or — when they are all
   * already in — removes exactly those, leaving selections made under an
   * earlier search untouched.
   */
  const shownAllSelected = rows.length > 0 && rows.every((m) => selection.has(String(m.id)))
  const shownSomeSelected = !shownAllSelected && rows.some((m) => selection.has(String(m.id)))

  const toggleAllShown = useCallback(() => {
    setSelection((prev) => {
      const next = new Map(prev)
      const allIn = rows.length > 0 && rows.every((m) => next.has(String(m.id)))
      for (const m of rows) {
        const id = String(m.id)
        if (allIn) next.delete(id)
        else next.set(id, m)
      }
      return next
    })
  }, [rows])

  const clearSelection = useCallback(() => setSelection(new Map()), [])

  /**
   * Bank every row the current search leaves on screen.
   *
   * Returns the number of rows that were NOT already selected, which is what
   * tells the page whether to clear the search box: pressing Enter on a query
   * that adds nothing new must not wipe what you typed, or a mistyped name
   * looks like it was accepted.
   */
  const addShownToSelection = useCallback((): number => {
    if (!selectable) return 0
    const fresh = rows.filter((m) => !selection.has(String(m.id)))
    if (fresh.length === 0) return 0
    setSelection((prev) => {
      const next = new Map(prev)
      for (const m of fresh) next.set(String(m.id), m)
      return next
    })
    return fresh.length
  }, [selectable, rows, selection])

  useImperativeHandle(apiRef, () => ({ addShownToSelection }), [addShownToSelection])

  const sections = useMemo((): Array<{ label: string | null; rows: Member[] }> => {
    if (groupBy === 'none') return [{ label: null, rows: [...rows] }]
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

  /** Focused datapoints that exist as a column here — see `focusWithoutColumn`. */
  const focusColKeys = useMemo(
    () => (focusFields ?? []).filter((k): k is ColKey => memberColByKey.has(k)),
    [focusFields, memberColByKey],
  )
  const focusColSet = useMemo(() => new Set<ColKey>(focusColKeys), [focusColKeys])

  /**
   * Focused datapoints with no column here. COLUMNS covers ~35 of the ~110
   * `members` columns, so the picker can legitimately hand us `iban` — and a
   * focus that silently changes nothing reads as a broken feature.
   */
  const focusWithoutColumn = useMemo(
    () => (focusFields ?? []).filter((k) => !memberColByKey.has(k)),
    [focusFields, memberColByKey],
  )

  /**
   * Columns actually rendered. With a focus active the focused ones sit
   * immediately after the name so they need no horizontal scrolling to reach,
   * and the operator's saved set follows underneath — the saved set is never
   * rewritten, so clearing the focus restores exactly the grid they had.
   */
  const effectiveVisibleKeys = useMemo(() => {
    if (focusColKeys.length === 0) return visibleKeys
    const ordered: ColKey[] = []
    const push = (k: ColKey) => { if (memberColByKey.has(k) && !ordered.includes(k)) ordered.push(k) }
    push('last_name')
    push('first_name')
    focusColKeys.forEach(push)
    visibleKeys.forEach(push)
    return ordered
  }, [visibleKeys, focusColKeys, memberColByKey])

  const visibleCols = effectiveVisibleKeys.map((k) => memberColByKey.get(k)).filter((c): c is ColDef => !!c)
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
      const next = memberColumns.map((c) => c.key).filter((k) => nextSet.has(k))
      try { localStorage.setItem(VISIBLE_COLS_LS_KEY, JSON.stringify(next)) } catch { /* quota — non-fatal */ }
      return next
    })
  }

  /**
   * Show or hide a whole batch at once — what "Show all" / "Hide all" apply to
   * the CURRENT search, so "type ahv, show all" is two clicks instead of
   * hunting one checkbox in a list of a hundred.
   *
   * ⚠ Never empties the set: a grid with no columns has no rows to read and no
   * obvious way back, so a hide-all that would clear it keeps the first column.
   */
  const setManyCols = (keys: ColKey[], show: boolean) => {
    setVisibleKeys((prev) => {
      const nextSet = new Set(prev)
      for (const k of keys) {
        if (show) nextSet.add(k)
        else nextSet.delete(k)
      }
      let next = memberColumns.map((c) => c.key).filter((k) => nextSet.has(k))
      if (next.length === 0) next = [DEFAULT_VISIBLE[0]]
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
    // Stamp the TARGET TEAM's own season, not the wall clock. A team belongs to
    // exactly one season by construction; getCurrentSeason() disagrees with it
    // for all of May (the season picker offers next season from 1 May) and
    // between the Jun-1 cutover and the manually-run rollover. A mis-stamped row
    // is then skipped by the rollover's clone and silently orphaned.
    const rosterSeason = teamById.get(teamId)?.season ?? getCurrentSeason()
    const created = await createRecord<{ id: string | number; guest_level: number | null; season: string | null }>(
      'member_teams',
      { member: memberId, team: teamId, season: rosterSeason },
    )
    const newRow: MemberTeamRow = {
      id: String(created.id),
      member: memberId,
      team: teamId,
      guest_level: created.guest_level ?? 0,
      season: created.season ?? rosterSeason,
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
        name: member ? `${member.nickname || member.first_name || ''} ${member.last_name ?? ''}`.trim() : row.member,
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
        name: member ? `${member.nickname || member.first_name || ''} ${member.last_name ?? ''}`.trim() : row.member,
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
      const columns = [tEn('explorerGridGroupBy'), ...teamVisibleCols.map((c) => colLabel(c, tEn))]
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
      ...visibleCols.map((c) => colLabel(c, tEn)),
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
      <TableRow
        key={memberId}
        className="group min-h-11 hover:bg-muted/60"
        data-state={selection.has(memberId) ? 'selected' : undefined}
      >
        <TableCell className={`sticky left-0 z-10 ${leadWidth} bg-background px-1 group-hover:bg-muted group-data-[state=selected]:bg-muted`}>
          <div className="flex items-center gap-0.5">
            {selectable && (
              // The 44px tap target is the wrapper, not the 16px box. The box
              // itself is pointer-events-none so a tap cannot toggle twice by
              // bubbling; keyboard still reaches the checkbox, which stays
              // focusable and fires on Space.
              <span
                role="presentation"
                onClick={() => toggleRow(m)}
                className="flex h-11 w-7 cursor-pointer items-center justify-center"
              >
                <Checkbox
                  checked={selection.has(memberId)}
                  onCheckedChange={() => toggleRow(m)}
                  className="pointer-events-none"
                  aria-label={t('admin:explorerGridSelectRow', { name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() })}
                />
              </span>
            )}
            <button
              type="button"
              onClick={() => onOpenDetail(memberId)}
              className="flex h-8 w-8 min-h-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title={t('admin:explorerGridOpenDetail')}
              aria-label={t('admin:explorerGridOpenDetail')}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </div>
        </TableCell>
        {visibleCols.map((c, i) => {
          const sticky = i === 0
            ? `sticky ${leadOffset} z-10 bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted`
            : ''
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
                        canEdit={canEditNow}
                        onRemove={() => removeRoster(row)}
                      />
                    )
                  })}
                  {canEditNow && (
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
            const label = colLabel(c, tCol)
            // Writable flag → click-to-toggle; derived flags → read-only.
            // Either way, false shows no mark (only ✓ for true) for easy scanning.
            if (c.write && canEditNow) {
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
          if (c.kind === 'countries') {
            // Multi-value + order-significant (first code is the ClubDesk one),
            // so this gets a chip picker rather than the free-text cell.
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
                <EditableCountriesCell
                  value={(rawField(m, c.key) as string | null) ?? null}
                  text={cellText(m, c.key)}
                  canEdit={canEditNow}
                  onSave={(v) => saveCell(memberId, c.key, v)}
                />
              </TableCell>
            )
          }
          if (c.kind === 'select' || c.kind === 'federation') {
            const raw = rawField(m, c.key)
            const value = raw == null || raw === '' ? null : String(raw)
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
                <EditableSelectCell
                  value={value}
                  options={c.kind === 'federation' ? federationOptions : (c.options ?? [])}
                  canEdit={canEditNow}
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
          if (c.kind === 'date') {
            return (
              <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
                <EditableDateCell
                  value={value ? value.slice(0, 10) : null}
                  canEdit={canEditNow && !c.readOnly}
                  onSave={(v) => saveCell(memberId, c.key, v)}
                />
              </TableCell>
            )
          }
          return (
            <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
              <EditableCell
                value={value}
                kind={c.kind as 'text' | 'email' | 'number'}
                canEdit={canEditNow && !c.readOnly}
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
            canEdit={canEditNow}
            onRemove={() => removeStaff(kind, row)}
          />
        ))}
        {canEditNow && (
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
        <TableCell className={`sticky left-0 z-10 ${leadWidth} bg-background px-1 group-hover:bg-muted`} />
        {teamVisibleCols.map((c, i) => {
          const sticky = i === 0 ? `sticky ${leadOffset} z-10 bg-background group-hover:bg-muted` : ''
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
                        canEdit={canEditNow}
                        onRemove={() => removeRoster(row)}
                      />
                    ))}
                  {canEditNow && (
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
                canEdit={canEditNow}
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
        {view === 'members'
          ? memberGroups.map((n) => (
              <RailNode
                key={n.key}
                node={n}
                depth={0}
                selectedGroup={selectedGroup}
                open={railOpen}
                onToggle={toggleRail}
                onSelect={setSelectedGroup}
                label={groupLabel}
              />
            ))
          : teamSections.map((sec, i) => {
              const newSport = i === 0 || teamSections[i - 1].sport !== sec.sport
              const genderKey = GENDER_LABEL_KEY[sec.gender]
              return (
                <div key={`${sec.sport}-${sec.gender}`} className={newSport ? 'mt-2' : 'mt-1'}>
                  {newSport && (
                    <div className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
                      {sportLabel(sec.sport)}
                    </div>
                  )}
                  {genderKey && (
                    <div className="px-2 pb-0.5 text-[10px] font-medium tracking-wide text-muted-foreground/70">
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
            {view === 'members' && flattenRail(memberGroups).map(({ node, depth }) => (
              // A native <option> cannot nest, and optgroup is one level deep —
              // so depth is drawn with figure spaces rather than lost.
              <option key={node.key} value={node.key}>
                {'\u2007'.repeat(depth * 2)}{groupLabel(node)} ({countMembers(node)})
              </option>
            ))}
            {view === 'teams' && teamSections.map((sec) => {
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
          {/* What Enter in the header search will do, and to how many. Shown
              only while a search is active — the count is the whole point, so
              nobody presses Enter on "a" and banks 600 people by surprise. */}
          {selectable && query.trim() !== '' && rows.length > 0 && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              <kbd className="rounded border border-border px-1 py-0.5 text-[10px]">↵</kbd>
              {t('admin:explorerGridEnterAdds', { count: rows.length })}
            </span>
          )}
          {/* Edit mode — only offered to somebody who could edit anyway. When
              they cannot, the badge says so and there is nothing to toggle. */}
          {canEdit ? (
            <Button
              size="sm"
              variant={editMode ? 'default' : 'outline'}
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setEditMode((v) => !v)}
              aria-pressed={editMode}
            >
              {editMode ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">
                {editMode ? t('admin:explorerGridEditModeOn') : t('admin:explorerGridEditModeOff')}
              </span>
            </Button>
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tracking-wide text-muted-foreground">
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
                    <option key={c.key} value={c.key}>{colLabel(c, tCol)}</option>
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
              <PopoverContent align="end" className="flex max-h-[70vh] w-72 flex-col p-2">
                {/* A focused datapoint is shown without being ticked here — the
                    saved set is a preference, the focus is a temporary look. */}
                {view === 'members' && focusColKeys.length > 0 && (
                  <p className="mb-2 border-b border-border pb-2 text-[11px] text-muted-foreground">
                    {t('admin:explorerGridFocusNote', { count: focusColKeys.length })}
                  </p>
                )}
                {view === 'teams' ? (
                  <div className="space-y-1 overflow-y-auto">
                    {TEAM_COLUMNS.map((c) => (
                      <label key={c.key} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-muted">
                        <Checkbox checked={teamVisibleKeys.includes(c.key)} onCheckedChange={() => toggleTeamCol(c.key)} />
                        {colLabel(c, tCol)}
                      </label>
                    ))}
                  </div>
                ) : (
                  <ColumnPicker
                    columns={memberColumns}
                    visibleKeys={visibleKeys}
                    onToggle={toggleCol}
                    onSetMany={setManyCols}
                    label={(c) => colLabel(c, tCol)}
                  />
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {view === 'members' && focusWithoutColumn.length > 0 && (
          <div className="border-b border-amber-500/40 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {t('admin:explorerGridFocusNoColumn', {
              fields: focusWithoutColumn.map(memberFieldLabel).join(', '),
            })}
          </div>
        )}

        {/* Selection bar — only while something is ticked, so it costs no height
            in the normal reading state. It counts the WHOLE selection, which can
            legitimately be larger than what the current search shows. */}
        {selectable && selection.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-xs font-medium text-foreground">
              {t('admin:explorerGridSelectedCount', { count: selection.size })}
            </span>
            {selection.size > rows.length && (
              <span className="text-[11px] text-muted-foreground">
                {t('admin:explorerGridSelectedOutsideView')}
              </span>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <Button size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => openBulk('edit')}>
                <Pencil className="h-3.5 w-3.5" />
                {t('admin:explorerGridBulkEdit')}
              </Button>
              {isGlobalAdmin && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 border-destructive/40 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => openBulk('depart')}
                >
                  <UserMinus className="h-3.5 w-3.5" />
                  {t('admin:explorerGridBulkDepart')}
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 px-2.5 text-xs" onClick={clearSelection}>
                {t('admin:explorerGridClearSelection')}
              </Button>
            </div>
          </div>
        )}

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
                <TableHead className={`sticky left-0 top-0 z-30 ${leadWidth} bg-card px-1`}>
                  {selectable && (
                    <span
                      role="presentation"
                      onClick={() => { if (rows.length > 0) toggleAllShown() }}
                      title={t('admin:explorerGridSelectAllShown', { count: rows.length })}
                      className="flex h-11 w-7 cursor-pointer items-center justify-center"
                    >
                      <Checkbox
                        checked={shownAllSelected ? true : shownSomeSelected ? 'indeterminate' : false}
                        onCheckedChange={toggleAllShown}
                        disabled={rows.length === 0}
                        className="pointer-events-none"
                        aria-label={t('admin:explorerGridSelectAllShown', { count: rows.length })}
                      />
                    </span>
                  )}
                </TableHead>
                {(view === 'teams' ? teamVisibleCols : visibleCols).map((c, i) => (
                  <TableHead
                    key={c.key}
                    className={`${c.minW} sticky top-0 whitespace-nowrap bg-card ${i === 0 ? `${leadOffset} z-30` : 'z-20'}`
                      // Focused columns are marked with a rule under the header,
                      // never a tinted background: this cell is sticky and has to
                      // stay opaque or the rows scroll through it.
                      + (view === 'members' && focusColSet.has(c.key as ColKey)
                        ? ' border-b-2 border-primary'
                        : '')}
                  >
                    <button
                      type="button"
                      onClick={() => (view === 'teams' ? toggleTeamSort(c.key as TeamColKey) : toggleSort(c.key as ColKey))}
                      className={'inline-flex items-center gap-1 font-semibold hover:text-primary '
                        + (view === 'members' && focusColSet.has(c.key as ColKey) ? 'text-primary' : 'text-foreground')}
                    >
                      {colLabel(c, tCol)}
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

      {selectable && (
        <>
          <ExplorerBulkEditModal
            key={`bulk-edit-${bulkSession}`}
            open={bulkEditOpen}
            onClose={() => setBulkEditOpen(false)}
            members={selectedMembers}
            cache={cache}
            isGlobalAdmin={isGlobalAdmin}
            onMutate={onMutate}
            // The selection survives the apply on purpose: composing a second
            // change for the same people is the common follow-up, and re-ticking
            // 40 rows to do it is the reason bulk tools get abandoned.
            onApplied={() => { /* cache already updated optimistically */ }}
          />
          <ExplorerBulkDepartModal
            key={`bulk-depart-${bulkSession}`}
            open={bulkDepartOpen}
            onClose={() => setBulkDepartOpen(false)}
            members={selectedMembers}
            onMutate={onMutate}
            onApplied={() => { /* cache already updated optimistically */ }}
          />
        </>
      )}
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

/**
 * The member column chooser: a search box over every datapoint the page holds,
 * results grouped the way the member detail groups them.
 *
 * ⚠ Search goes through `rankMemberFields`, the same ranker the header's
 * datapoint search uses — it carries the German aliases. Labels in
 * memberFieldSchema are English by design, so a plain label match would fail
 * every "Geburtsdatum" and "Lizenz" a German-speaking admin types.
 */
function ColumnPicker({
  columns, visibleKeys, onToggle, onSetMany, label,
}: {
  columns: ColDef[]
  visibleKeys: ColKey[]
  onToggle: (key: ColKey) => void
  onSetMany: (keys: ColKey[], show: boolean) => void
  label: (c: ColDef) => string
}) {
  const { t } = useTranslation(['admin'])
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const query = q.trim()
    if (!query) return columns
    // Rank the whole datapoint catalog, then keep the ones that are columns
    // here — plus a plain label match, which catches the grid-only columns
    // (Teams, Sport, ClubDesk sync) that have no schema entry to rank.
    const ranked = rankMemberFields(query, 500).map((m) => m.def.key)
    const order = new Map(ranked.map((k, i) => [k, i]))
    const lower = query.toLowerCase()
    return columns
      .filter((c) => order.has(c.key) || label(c).toLowerCase().includes(lower))
      .sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999))
  }, [columns, q, label])

  /** Group header for a column — the schema's group, or a catch-all for the
   *  grid-only ones (Teams, Sport, ClubDesk sync) that have no schema entry. */
  const groupOf = (c: ColDef): string => {
    const def = MEMBER_FIELDS.find((f) => f.key === c.key)
    return def ? getFieldGroup(def.group).label : t('admin:explorerGridColGroupOther')
  }

  const sections = useMemo(() => {
    const map = new Map<string, ColDef[]>()
    for (const c of shown) {
      const g = groupOf(c)
      map.set(g, [...(map.get(g) ?? []), c])
    }
    return [...map.entries()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, t])

  const shownKeys = shown.map((c) => c.key)
  const allShown = shownKeys.length > 0 && shownKeys.every((k) => visibleKeys.includes(k))

  return (
    <>
      <Input
        value={q}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
        placeholder={t('admin:explorerGridColumnSearch')}
        className="mb-2 h-8 text-sm"
        aria-label={t('admin:explorerGridColumnSearch')}
      />
      <div className="mb-1 flex items-center justify-between border-b border-border pb-1">
        <span className="text-[11px] text-muted-foreground">
          {t('admin:explorerGridColumnCount', { shown: shown.length, total: columns.length })}
        </span>
        <button
          type="button"
          onClick={() => onSetMany(shownKeys, !allShown)}
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-muted"
        >
          {allShown ? t('admin:explorerGridColumnHideAll') : t('admin:explorerGridColumnShowAll')}
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {sections.map(([group, cols]) => (
          <div key={group}>
            <div className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </div>
            {cols.map((c) => (
              <label key={c.key} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-muted">
                <Checkbox checked={visibleKeys.includes(c.key)} onCheckedChange={() => onToggle(c.key)} />
                <span className="min-w-0 flex-1 break-words">{label(c)}</span>
              </label>
            ))}
          </div>
        ))}
        {shown.length === 0 && (
          <p className="px-1.5 py-2 text-sm text-muted-foreground">{t('admin:explorerGridColumnNoMatch')}</p>
        )}
      </div>
    </>
  )
}

/** Depth-first list of the rail tree, for the mobile <select>. */
function flattenRail(nodes: MemberGroupNode[], depth = 0): { node: MemberGroupNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flattenRail(n.children ?? [], depth + 1)])
}

/**
 * One row of the member rail.
 *
 * ⚠ ONE button, which both selects the group and (for a branch) opens it — not
 * a chevron button beside a label button. Those two would carry the same
 * accessible name, so a screen reader announces "Volleyball, button" twice with
 * nothing to tell them apart, and a Playwright `getByRole('button', {name})`
 * picks whichever comes first. Selecting a branch showing its children is also
 * the behaviour people expect from a file tree.
 */
function RailNode({
  node, depth, selectedGroup, open, onToggle, onSelect, label,
}: {
  node: MemberGroupNode
  depth: number
  selectedGroup: string
  open: ReadonlySet<string>
  onToggle: (key: string) => void
  onSelect: (key: string) => void
  label: (node: MemberGroupNode) => string
}) {
  const isOpen = open.has(node.key)
  const active = selectedGroup === node.key
  return (
    <div className={depth === 0 ? 'mt-1' : undefined}>
      <button
        type="button"
        onClick={() => {
          onSelect(node.key)
          if (node.children) onToggle(node.key)
        }}
        aria-expanded={node.children ? isOpen : undefined}
        style={{ paddingLeft: depth * 10 }}
        className={
          'flex w-full min-h-8 items-center rounded-md py-1 pr-2 text-left text-sm ' +
          (active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted')
        }
      >
        <span className="flex h-4 w-5 shrink-0 items-center justify-center">
          {node.children
            ? (isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)
            : null}
        </span>
        <span className="truncate">{label(node)}</span>
        <span className={'ml-auto pl-1 text-xs ' + (active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
          {countMembers(node)}
        </span>
      </button>
      {isOpen && node.children?.map((c) => (
        <RailNode
          key={c.key}
          node={c}
          depth={depth + 1}
          selectedGroup={selectedGroup}
          open={open}
          onToggle={onToggle}
          onSelect={onSelect}
          label={label}
        />
      ))}
    </div>
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
              const name = `${m.last_name ?? ''} ${m.nickname || m.first_name || ''}`.trim() || `#${m.id}`
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
  value, kind, canEdit, onSave,
}: {
  value: string | null
  // No 'date' — dates get their own cell below, because a native date input
  // draws in the browser's locale (see EditableDateCell).
  kind: 'text' | 'email' | 'number'
  canEdit: boolean
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

  const shown = value == null || value === '' ? null : value

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

// Inline date cell (birthdate, Eintritt, Austritt).
//
// ⚠ NEVER a native `<input type="date">` here — that is what this cell used to
// be. The value it carries is ISO, but the value it DRAWS is the browser's
// locale, so an English-language browser rendered a birthdate as `01/12/2011`
// with nothing on screen saying whether that is 1 December or 12 January. No
// attribute and no CSS can change it; the only fix is not to use the control.
// The shared DatePicker draws dd.mm.yyyy via formatDateZurich and emits the
// same `YYYY-MM-DD` string. `fromYear` matters for a birthdate — the year
// dropdown has to reach back past 1900 for the oldest members.
//
// Unlike the text cells there is no separate click-to-edit step: the trigger IS
// the cell, and picking a day commits. It is styled borderless so a row of
// dates still reads as a spreadsheet rather than a row of buttons.
function EditableDateCell({
  value, canEdit, onSave,
}: {
  value: string | null
  canEdit: boolean
  onSave: (v: string | null) => Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)

  const commit = async (next: string) => {
    const v = next.trim() === '' ? null : next.trim()
    if (v === (value ?? null)) return
    setSaving(true)
    try {
      await onSave(v)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 1200)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('explorerGridSaveError'))
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return (
      <div className="flex min-h-7 items-center px-1 -mx-1 text-sm">
        {formatShortDate(value) || <span className="text-muted-foreground">—</span>}
      </div>
    )
  }

  return (
    <div className={`flex min-h-7 items-center gap-1 rounded ${flash ? 'ring-1 ring-emerald-500/70' : ''}`}>
      {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
      <DatePicker
        value={value ?? ''}
        onChange={(v) => { void commit(v) }}
        fromYear={1900}
        disabled={saving}
        placeholder="—"
        className="min-h-7 w-full min-w-0 gap-1 rounded border-transparent px-1 py-0 text-sm shadow-none hover:bg-muted/80 hover:ring-1 hover:ring-border"
      />
    </div>
  )
}

// Inline nationality cell (members.nationalitaet_codes). Nationality is
// multi-valued AND order-significant — the first code is the one pushed to
// ClubDesk — so a text input or a single <select> cannot express it. Click
// opens a popover holding the shared CountryMultiSelect; the edit commits when
// the popover closes, and only if the serialized value actually changed.
//
// Note `members.nationalitaet` (the German ClubDesk name) is NOT written here:
// a DB trigger derives it from the first code on every write.
function EditableCountriesCell({
  value, text, canEdit, onSave,
}: {
  /** Stored comma-separated code list, e.g. "CH,IT". */
  value: string | null
  /** Localized display text (already falls back to the derived legacy name). */
  text: string
  canEdit: boolean
  onSave: (v: string | null) => Promise<void>
}) {
  const { t } = useTranslation(['admin', 'auth'])
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)

  const commit = async (codes: string[]) => {
    const next = serializeCountryCodes(codes)
    if (next === (value ?? null)) return
    setSaving(true)
    try {
      await onSave(next)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 1200)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin:explorerGridSaveError'))
    } finally {
      setSaving(false)
    }
  }

  const body = (
    <>
      {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      {flash && !saving && <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />}
      {text || <span className="text-muted-foreground">—</span>}
    </>
  )

  if (!canEdit) {
    return (
      <div className="-mx-1 flex min-h-7 items-center gap-1 rounded px-1 text-sm" title={t('admin:explorerGridReadOnly')}>
        {body}
      </div>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(parseCountryCodes(value))
        else void commit(draft)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          className={
            '-mx-1 flex min-h-7 w-full items-center gap-1 rounded px-1 text-left text-sm ' +
            'hover:bg-muted/80 hover:ring-1 hover:ring-border disabled:opacity-50 ' +
            (flash ? 'ring-1 ring-emerald-500/70 ' : '')
          }
        >
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <CountryMultiSelect
          label={t('admin:explorerGridColNationality')}
          selected={draft}
          onChange={setDraft}
          helperText={t('auth:nationalitaetHint')}
        />
      </PopoverContent>
    </Popover>
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
// documents (post-approval). Picking one previews it in place (images inline,
// PDFs in the native viewer) off the admin asset URL (board/admin folder-scoped
// read). Blank when the member has none / the viewer can't read registrations.
function RegFilesCell({ info }: { info: RegFileInfo | undefined }) {
  const { t } = useTranslation('admin')
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<{ fileId: string; label: string } | null>(null)
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
                onClick={() => { setOpen(false); setPreview({ fileId: d.fileId, label }) }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
      <FilePreviewDialog
        key={preview?.fileId}
        open={!!preview}
        onOpenChange={(o) => { if (!o) setPreview(null) }}
        url={preview ? assetUrl(preview.fileId) : null}
        label={preview?.label}
        filename={preview?.label}
      />
    </Popover>
  )
}
