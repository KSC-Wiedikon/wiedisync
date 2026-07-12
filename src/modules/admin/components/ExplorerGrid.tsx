// src/modules/admin/components/ExplorerGrid.tsx
//
// ClubDesk-Kontakte-style spreadsheet view for the Data Explorer: a group rail
// (all members / per team, grouped by sport) next to a dense, sortable member
// grid with inline cell editing. Scalar member fields PATCH `members` directly;
// the Teams column adds/removes `member_teams` junction rows. All writes go
// through the Directus items API (auto audit-logged) and are applied to the
// explorer cache optimistically via onMutate — no full cache reload per edit.
//
// Editing is gated by canEdit (global admin + sport admins — the Vorstand
// policy is read-only on members/member_teams, so it gets a read-only grid).

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, ArrowUpDown, Check, Eye, Loader2, Plus, Settings2, Users, X,
} from 'lucide-react'
import type { Member, Team } from '../../../types'
import { createRecord, deleteRecord, updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { getCurrentSeason } from '../../../utils/dateHelpers'
import { localizeCountryName } from '../../../utils/countryName'
import { useConfirm } from '../../../components/ConfirmProvider'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import type { CacheShape, MemberTeamRow } from './explorerHelpers'
import { buildMemberTeamsMap, formatShortDate, teamLabel } from './explorerHelpers'

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

type ColKey =
  | 'last_name' | 'first_name' | 'email' | 'phone'
  | 'adresse' | 'plz' | 'ort' | 'nationalitaet' | 'birthdate' | 'teams'

const COLUMNS: Array<{ key: ColKey; labelKey: string; kind: 'text' | 'email' | 'date' | 'teams'; minW: string }> = [
  { key: 'last_name', labelKey: 'explorerGridColLastName', kind: 'text', minW: 'min-w-32' },
  { key: 'first_name', labelKey: 'explorerGridColFirstName', kind: 'text', minW: 'min-w-32' },
  { key: 'email', labelKey: 'explorerGridColEmail', kind: 'email', minW: 'min-w-52' },
  { key: 'phone', labelKey: 'explorerGridColPhone', kind: 'text', minW: 'min-w-36' },
  { key: 'adresse', labelKey: 'explorerGridColAddress', kind: 'text', minW: 'min-w-48' },
  { key: 'plz', labelKey: 'explorerGridColPlz', kind: 'text', minW: 'min-w-20' },
  { key: 'ort', labelKey: 'explorerGridColCity', kind: 'text', minW: 'min-w-32' },
  { key: 'nationalitaet', labelKey: 'explorerGridColNationality', kind: 'text', minW: 'min-w-32' },
  { key: 'birthdate', labelKey: 'explorerGridColBirthdate', kind: 'date', minW: 'min-w-28' },
  { key: 'teams', labelKey: 'explorerGridColTeams', kind: 'teams', minW: 'min-w-56' },
]

const HIDDEN_COLS_LS_KEY = 'kscw-explorer-grid-hidden-cols'

function loadHiddenCols(): Set<ColKey> {
  try {
    const raw = localStorage.getItem(HIDDEN_COLS_LS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    return new Set(Array.isArray(arr) ? (arr as ColKey[]) : [])
  } catch {
    return new Set()
  }
}

type Sport = 'volleyball' | 'basketball' | 'other'
const SPORTS: Sport[] = ['volleyball', 'basketball', 'other']

function sportOf(team: { sport?: string } | undefined): Sport {
  const s = team?.sport
  if (s === 'volleyball' || s === 'basketball') return s
  return 'other'
}

export default function ExplorerGrid({ cache, query, canEdit, onOpenDetail, onMutate }: Props) {
  const { t } = useTranslation(['admin', 'common'])
  const confirm = useConfirm()

  const [selectedGroup, setSelectedGroup] = useState<'all' | string>('all')
  const [sort, setSort] = useState<{ key: ColKey; dir: 'asc' | 'desc' } | null>(null)
  const [hiddenCols, setHiddenCols] = useState<Set<ColKey>>(loadHiddenCols)

  const teamById = useMemo(() => {
    const map = new Map<string, Team>()
    cache.teams.forEach((tm) => map.set(String(tm.id), tm))
    return map
  }, [cache.teams])

  // Junction rows per member, restricted to teams present in the (scoped,
  // active-only) teams cache — memberships to archived/out-of-scope teams are
  // neither shown nor editable here.
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

  // Group rail: teams grouped by sport, with member counts within the current
  // filtered member set.
  const teamGroups = useMemo(() => {
    const memberIds = new Set(cache.members.map((m) => String(m.id)))
    const counts = new Map<string, number>()
    for (const [mid, rows] of rowsByMember) {
      if (!memberIds.has(mid)) continue
      for (const r of rows) counts.set(r.team, (counts.get(r.team) ?? 0) + 1)
    }
    const groups: Array<{ sport: Sport; teams: Array<{ id: string; label: string; count: number }> }> = []
    for (const sport of SPORTS) {
      const teams = cache.teams
        .filter((tm) => sportOf(tm as unknown as { sport?: string }) === sport)
        .map((tm) => ({ id: String(tm.id), label: teamLabel(tm), count: counts.get(String(tm.id)) ?? 0 }))
      if (teams.length > 0) groups.push({ sport, teams })
    }
    return groups
  }, [cache.members, cache.teams, rowsByMember])

  const sportLabel = (sport: Sport): string => {
    if (sport === 'volleyball') return t('common:volleyball')
    if (sport === 'basketball') return t('common:basketball')
    return t('admin:explorerSportOther')
  }

  // Rows: group filter → quick-search filter → sort.
  const rows = useMemo(() => {
    let list = cache.members
    if (selectedGroup !== 'all') {
      list = list.filter((m) => (rowsByMember.get(String(m.id)) ?? []).some((r) => r.team === selectedGroup))
    }
    if (query) {
      const q = query.toLowerCase()
      list = list.filter((m) =>
        [m.last_name, m.first_name, m.email, m.phone, m.adresse, m.plz, m.ort, m.nationalitaet]
          .some((v) => (v ?? '').toLowerCase().includes(q)),
      )
    }
    if (sort) {
      const { key, dir } = sort
      const val = (m: Member): string => {
        if (key === 'teams') {
          return (rowsByMember.get(String(m.id)) ?? [])
            .map((r) => teamLabel(teamById.get(r.team) ?? { id: r.team } as never))
            .sort()
            .join(', ')
        }
        return String((m as unknown as Record<string, unknown>)[key] ?? '')
      }
      list = [...list].sort((a, b) => {
        const cmp = val(a).localeCompare(val(b), 'de-CH', { numeric: true, sensitivity: 'base' })
        return dir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [cache.members, selectedGroup, query, sort, rowsByMember, teamById])

  const visibleCols = COLUMNS.filter((c) => !hiddenCols.has(c.key))

  const toggleSort = (key: ColKey) => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 'asc' }
      if (prev.dir === 'asc') return { key, dir: 'desc' }
      return null
    })
  }

  const toggleCol = (key: ColKey) => {
    setHiddenCols((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      try { localStorage.setItem(HIDDEN_COLS_LS_KEY, JSON.stringify([...next])) } catch { /* quota — non-fatal */ }
      return next
    })
  }

  // ── Write paths ────────────────────────────────────────────────

  const saveCell = async (memberId: string, key: ColKey, value: string | null) => {
    await updateRecord('members', memberId, { [key]: value })
    logActivity('update', 'members', memberId, { [key]: value })
    onMutate((prev) => ({
      ...prev,
      members: prev.members.map((m) => (String(m.id) === memberId ? { ...m, [key]: value } : m)),
    }))
  }

  const addTeam = async (member: Member, teamId: string) => {
    const memberId = String(member.id)
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

  const removeTeam = async (member: Member, row: MemberTeamRow) => {
    const team = teamById.get(row.team)
    const ok = await confirm({
      message: t('admin:explorerGridRemoveFromTeam', {
        name: `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim(),
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

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1">
      {/* Group rail — md+ */}
      <aside className="hidden w-56 flex-shrink-0 overflow-y-auto border-r border-border bg-card px-2 py-2 md:block">
        <GroupButton
          active={selectedGroup === 'all'}
          label={t('admin:explorerGridAllMembers')}
          count={cache.members.length}
          onClick={() => setSelectedGroup('all')}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        {teamGroups.map((g) => (
          <div key={g.sport} className="mt-2">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {sportLabel(g.sport)}
            </div>
            {g.teams.map((tm) => (
              <GroupButton
                key={tm.id}
                active={selectedGroup === tm.id}
                label={tm.label}
                count={tm.count}
                onClick={() => setSelectedGroup(tm.id)}
              />
            ))}
          </div>
        ))}
      </aside>

      {/* Grid pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
          {/* Mobile group picker (native select — needs explicit dark bg) */}
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="max-w-[45%] rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground dark:bg-gray-800 md:hidden"
            aria-label={t('admin:explorerGridGroups')}
          >
            <option value="all">{t('admin:explorerGridAllMembers')}</option>
            {teamGroups.map((g) => (
              <optgroup key={g.sport} label={sportLabel(g.sport)}>
                {g.teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>{tm.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <span className="text-xs text-muted-foreground">
            {t('admin:explorerGridEntries', { count: rows.length })}
          </span>
          {!canEdit && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('admin:explorerGridReadOnly')}
            </span>
          )}

          {/* Column chooser */}
          <div className="ml-auto">
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('admin:explorerGridColumns')}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-2">
                <div className="space-y-1">
                  {COLUMNS.map((c) => (
                    <label
                      key={c.key}
                      className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1.5 text-sm hover:bg-muted"
                    >
                      <Checkbox
                        checked={!hiddenCols.has(c.key)}
                        onCheckedChange={() => toggleCol(c.key)}
                      />
                      {t(`admin:${c.labelKey}`)}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Table — one scroll container for both axes */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {/* Leading actions column (open detail) — sticky with the name.
                    Sticky lives on the th cells (not thead) for cross-browser
                    reliability. */}
                <TableHead className="sticky left-0 top-0 z-30 w-9 min-w-9 bg-card px-1" />
                {visibleCols.map((c, i) => (
                  <TableHead
                    key={c.key}
                    className={`${c.minW} sticky top-0 whitespace-nowrap bg-card ${i === 0 ? 'left-9 z-30' : 'z-20'}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary"
                    >
                      {t(`admin:${c.labelKey}`)}
                      {sort?.key === c.key
                        ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                        : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={visibleCols.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                    {t('admin:explorerGridEmpty')}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((m) => {
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
                            <TeamsCell
                              member={m}
                              memberRows={memberRows}
                              teamGroups={teamGroups}
                              teamById={teamById}
                              canEdit={canEdit}
                              onAdd={(teamId) => addTeam(m, teamId)}
                              onRemove={(row) => removeTeam(m, row)}
                            />
                          </TableCell>
                        )
                      }
                      const raw = (m as unknown as Record<string, unknown>)[c.key]
                      const value = raw == null ? null : String(raw)
                      return (
                        <TableCell key={c.key} className={`${c.minW} ${sticky} py-1`}>
                          <EditableCell
                            value={value}
                            kind={c.kind}
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
              })}
            </TableBody>
          </Table>
        </div>
      </div>
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

// Inline-editable cell: click to edit (when allowed), Enter/blur commits,
// Escape cancels. Only the changed value is PATCHed; a brief check flash
// confirms the save without a toast per keystroke-sized edit.
function EditableCell({
  value, kind, canEdit, display, onSave,
}: {
  value: string | null
  kind: 'text' | 'email' | 'date'
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
        type={kind === 'date' ? 'date' : kind === 'email' ? 'email' : 'text'}
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

// Teams column: player-membership chips (guest memberships dashed) with remove,
// plus a searchable add-popover listing scoped teams grouped by sport.
function TeamsCell({
  member, memberRows, teamGroups, teamById, canEdit, onAdd, onRemove,
}: {
  member: Member
  memberRows: MemberTeamRow[]
  teamGroups: Array<{ sport: Sport; teams: Array<{ id: string; label: string; count: number }> }>
  teamById: Map<string, Team>
  canEdit: boolean
  onAdd: (teamId: string) => Promise<void>
  onRemove: (row: MemberTeamRow) => Promise<void>
}) {
  const { t } = useTranslation(['admin', 'common'])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const assigned = new Set(memberRows.map((r) => r.team))

  const handleAdd = async (teamId: string) => {
    setOpen(false)
    setBusy(true)
    try {
      await onAdd(teamId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin:explorerGridSaveError'))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (row: MemberTeamRow) => {
    setBusy(true)
    try {
      await onRemove(row)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('admin:explorerGridSaveError'))
    } finally {
      setBusy(false)
    }
  }

  const sportLabel = (sport: Sport): string => {
    if (sport === 'volleyball') return t('common:volleyball')
    if (sport === 'basketball') return t('common:basketball')
    return t('admin:explorerSportOther')
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {memberRows.map((row) => {
        const team = teamById.get(row.team)
        const label = team ? teamLabel(team) : row.team
        const isGuest = row.guest_level > 0
        return (
          <span
            key={row.id}
            className={
              'inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs ' +
              (isGuest
                ? 'border-dashed border-muted-foreground/50 text-muted-foreground'
                : 'border-border bg-muted/60 text-foreground')
            }
            title={isGuest ? `${label} — ${t('admin:explorerGridGuest')} (${row.guest_level})` : label}
          >
            {label}
            {isGuest && <span className="font-semibold">G</span>}
            {canEdit && (
              <button
                type="button"
                onClick={() => { void handleRemove(row) }}
                disabled={busy}
                className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
                aria-label={`${t('admin:explorerGridRemoveFromTeam', { name: `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim(), team: label })}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        )
      })}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              title={t('admin:explorerGridAddToTeam')}
              aria-label={t('admin:explorerGridAddToTeam')}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput placeholder={t('admin:explorerGridSearchTeams')} />
              <CommandList>
                <CommandEmpty>{t('admin:explorerGridNoTeams')}</CommandEmpty>
                {teamGroups.map((g) => {
                  const available = g.teams.filter((tm) => !assigned.has(tm.id))
                  if (available.length === 0) return null
                  return (
                    <CommandGroup key={g.sport} heading={sportLabel(g.sport)}>
                      {available.map((tm) => (
                        <CommandItem
                          key={tm.id}
                          value={`${tm.label} ${sportLabel(g.sport)}`}
                          onSelect={() => { void handleAdd(tm.id) }}
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
      )}
    </div>
  )
}
