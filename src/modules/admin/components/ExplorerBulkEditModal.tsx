// src/modules/admin/components/ExplorerBulkEditModal.tsx
//
// Write one composed change to every member selected in the Data Explorer grid.
//
// Everything about a field — its label, its help, which control edits it, and
// whether it may be written to several people at once — comes from
// `memberFieldSchema.ts`, and the control itself is the very same `FieldEditor`
// the single-member detail renders. A second catalog or a second set of inputs
// here is how a `select` becomes a text box for one caller and starts writing
// values the column has never held.
//
// Three rules this file exists to hold:
//   • Nothing is written before the operator has seen the count. A bulk apply is
//     not undoable, so the primary button says how many members it changes and
//     the confirm names the fields — "Apply" on its own is a dialog you dismiss
//     without reading.
//   • The count is computed from the members' CURRENT values, fetched for
//     exactly the picked columns. The explorer cache carries ~60 of the 111
//     `members` columns, so a preview built from it would report every member as
//     changing for any column it does not hold — and the apply would then send a
//     no-op write, which is a false line in the club's audit trail and, for the
//     register columns, a ClubDesk push flag carrying nothing.
//   • A member who fails does not stop the rest. A sport admin reaching outside
//     their section gets a 403 for THAT member; the other 11 still land, and the
//     failures are listed by name.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, Plus, X } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { TeamPickerOption } from '@/components/ui/TeamPicker'
import type { Member } from '../../../types'
import { createRecord, deleteRecord, fetchAllItems, updateRecord } from '../../../lib/api'
import { logActivity } from '../../../utils/logActivity'
import { getCurrentSeason } from '../../../utils/dateHelpers'
import { useConfirm } from '../../../components/ConfirmProvider'
import { FieldEditor } from './ExplorerMemberFields'
import {
  MEMBER_FIELD_GROUPS, TEAMS_VIRTUAL_KEY, bulkEditableFields,
  type MemberFieldDef, type MemberFieldKind,
} from './memberFieldSchema'
import { resolveMemberSport, type MemberSport } from './memberSport'
import {
  computeMemberPatch, computeRosterDelta, runBulk,
  type BulkFieldChange, type BulkMode, type BulkRunSummary,
} from './bulkEdit'
import type { CacheShape, MemberTeamRow } from './explorerHelpers'
import { buildMemberTeamsMap, teamLabel } from './explorerHelpers'

interface Props {
  open: boolean
  onClose: () => void
  /** The selected member records, in grid order. */
  members: Member[]
  cache: CacheShape
  /** Unlocks the `privileged` fields (role, is_spielplaner) — same gate as the detail. */
  isGlobalAdmin: boolean
  onMutate: (fn: (prev: CacheShape) => CacheShape) => void
  /** Fired after a run that changed at least one member, so the page can refresh. */
  onApplied: () => void
}

/**
 * Kinds whose value is a list, so `add` / `remove` mean something.
 *
 * For everything else the mode switch offers Set and Clear only: "add" to a
 * date is not an operation, and offering it would be a control that does
 * whatever `set` does while reading as something else.
 */
const LIST_KINDS: ReadonlySet<MemberFieldKind> = new Set<MemberFieldKind>(['multiselect', 'teamMulti'])

/** The one column reachable here that a sync-up writes into the legal register. */
const REGISTER_PUSH_KEYS: ReadonlySet<string> = new Set(['eintritt'])

const GROUP_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  MEMBER_FIELD_GROUPS.map((g) => [g.id, g.label]),
)

function memberName(m: Member): string {
  return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || String(m.id)
}

/** Modes offered for a field, in the order the switch renders them. */
function modesFor(def: MemberFieldDef): BulkMode[] {
  if (LIST_KINDS.has(def.kind)) return ['add', 'remove', 'set', 'clear']
  return ['set', 'clear']
}

export default function ExplorerBulkEditModal({
  open, onClose, members, cache, isGlobalAdmin, onMutate, onApplied,
}: Props) {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()

  const [changes, setChanges] = useState<BulkFieldChange[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<BulkRunSummary | null>(null)
  const cancelledRef = useRef(false)

  /**
   * The last completed read of the picked columns, stamped with the (columns ×
   * members) signature it answers for.
   *
   * Carrying the signature rather than clearing the state when the picked set
   * changes is what keeps this out of "set state in an effect": a result whose
   * signature no longer matches simply is not the current answer, so the derived
   * `current` below reads as loading without anything having to reset it.
   */
  const [values, setValues] = useState<
    { sig: string; map: Map<string, Record<string, unknown>> | null } | null
  >(null)

  const catalog = useMemo(() => bulkEditableFields({ isGlobalAdmin }), [isGlobalAdmin])
  const pickedKeys = useMemo(() => changes.map((c) => c.key), [changes])
  const columnKeys = useMemo(
    () => changes.map((c) => c.key).filter((k) => k !== TEAMS_VIRTUAL_KEY).sort(),
    [changes],
  )
  const columnKeysSig = columnKeys.join(',')
  const memberIds = useMemo(() => members.map((m) => String(m.id)), [members])
  const memberIdsSig = memberIds.join(',')
  const sig = `${columnKeysSig}|${memberIdsSig}`

  /** The read that answers for the CURRENT picked set, or null while it is out. */
  const loaded = values?.sig === sig ? values : null
  const current = loaded?.map ?? null
  const valuesError = loaded !== null && loaded.map === null

  /**
   * Read the picked columns for the selected members.
   *
   * Chunked at 100 ids: `_in` travels in the query string and a club-wide
   * selection would otherwise build a URL long enough to be refused by the
   * proxy rather than by Directus, which reads as an unexplained failure.
   */
  useEffect(() => {
    if (!open || columnKeys.length === 0 || memberIds.length === 0) return
    let cancelled = false
    void (async () => {
      try {
        const map = new Map<string, Record<string, unknown>>()
        for (let i = 0; i < memberIds.length; i += 100) {
          const slice = memberIds.slice(i, i + 100)
          const rows = await fetchAllItems<Record<string, unknown>>('members', {
            filter: { id: { _in: slice } },
            fields: ['id', ...columnKeys],
          })
          for (const row of rows) map.set(String(row.id), row)
        }
        if (!cancelled) setValues({ sig, map })
      } catch {
        // A policy that withholds one of the picked columns 403s the whole read.
        // The apply still works (and reports per member); only the preview count
        // is unavailable, and saying so beats printing a made-up number.
        if (!cancelled) setValues({ sig, map: null })
      }
    })()
    return () => { cancelled = true }
    // `sig` stands in for columnKeys / memberIds — both arrays are rebuilt every
    // render, so depending on them directly would refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sig])

  const rosterByMember = useMemo(() => {
    const map = new Map<string, MemberTeamRow[]>()
    for (const row of cache.memberTeamRows) {
      const list = map.get(row.member)
      if (list) list.push(row)
      else map.set(row.member, [row])
    }
    return map
  }, [cache.memberTeamRows])

  const teamOptions = useMemo<TeamPickerOption[]>(
    () => cache.teams.map((tm) => ({
      id: String(tm.id),
      // ⚠ The sport comes from `teams.sport`, never from the name: 'Herren 2 H3'
      // and 'Damen D-Classics 1LR' are basketball teams.
      label: teamLabel(tm),
      sport: tm.sport === 'volleyball' || tm.sport === 'basketball' ? tm.sport : null,
      season: tm.season ?? null,
      active: tm.active ?? undefined,
    })),
    [cache.teams],
  )

  /**
   * The sport used to narrow the sport-aware editors (positions, coaching
   * qualification).
   *
   * A mixed selection resolves to 'both', which OFFERS every option rather than
   * hiding one sport's. Guessing a single sport for a mixed set is the mistake
   * that matters here: it would leave the operator unable to pick the position
   * half their selection actually plays.
   */
  const selectionSport = useMemo<MemberSport>(() => {
    const sports = new Set(members.map((m) => resolveMemberSport(m, cache)))
    return sports.size === 1 ? [...sports][0] : 'both'
  }, [members, cache])

  // ── Per-member effect of the composed changes ──────────────────────

  /**
   * Members this apply would actually write to.
   *
   * Undefined while the current values are unknown (loading, or the read was
   * refused) — the button then falls back to the whole selection and says so,
   * rather than claiming a number it cannot support.
   */
  const affected = useMemo((): Member[] | undefined => {
    if (changes.length === 0) return []
    if (columnKeys.length > 0 && !current) return undefined
    return members.filter((m) => {
      const id = String(m.id)
      const record = current?.get(id) ?? {}
      if (Object.keys(computeMemberPatch(record, changes)).length > 0) return true
      const teamsChange = changes.find((c) => c.key === TEAMS_VIRTUAL_KEY)
      if (!teamsChange) return false
      const held = (rosterByMember.get(id) ?? []).map((r) => r.team)
      const delta = computeRosterDelta(held, teamsChange)
      return delta.add.length > 0 || delta.remove.length > 0
    })
  }, [changes, columnKeys.length, current, members, rosterByMember])

  const affectedCount = affected?.length ?? members.length

  /**
   * Apply is held while the current values are still coming back, but NOT when
   * the read was refused.
   *
   * The two look the same from `affected` (both undefined) and are opposite
   * decisions: a moment more and the real count arrives, whereas a 403 is never
   * going to resolve, and blocking on it would make the whole action unusable
   * for a viewer who can write a column they cannot read back.
   */
  const previewLoading = columnKeys.length > 0 && loaded === null
  const canApply = changes.length > 0 && !running && !previewLoading && affectedCount > 0

  // ── Composition ────────────────────────────────────────────────────

  const addField = useCallback((def: MemberFieldDef) => {
    setPickerOpen(false)
    setSummary(null)
    setChanges((prev) => {
      if (prev.some((c) => c.key === def.key)) return prev
      const mode: BulkMode = LIST_KINDS.has(def.kind) ? 'add' : 'set'
      return [...prev, { key: def.key, mode, value: LIST_KINDS.has(def.kind) ? [] : null }]
    })
  }, [])

  const removeField = useCallback((key: string) => {
    setChanges((prev) => prev.filter((c) => c.key !== key))
    setSummary(null)
  }, [])

  const patchChange = useCallback((key: string, patch: Partial<BulkFieldChange>) => {
    setChanges((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)))
    setSummary(null)
  }, [])

  // ── Apply ──────────────────────────────────────────────────────────

  const handleApply = useCallback(async () => {
    if (changes.length === 0) return
    const targets = affected ?? members
    if (targets.length === 0) return

    const labels = changes
      .map((c) => {
        const def = catalog.find((d) => d.key === c.key)
        return `${def?.label ?? c.key} (${t(`explorerBulkMode_${c.mode}`)})`
      })
      .join(', ')

    const ok = await confirm({
      title: t('explorerBulkConfirmTitle'),
      message: t('explorerBulkConfirmMessage', { count: targets.length, fields: labels }),
      danger: true,
    })
    if (!ok) return

    cancelledRef.current = false
    setRunning(true)
    setProgress({ done: 0, total: targets.length })
    setSummary(null)

    const teamsChange = changes.find((c) => c.key === TEAMS_VIRTUAL_KEY)

    // Re-read rather than trust the preview map: composing a change is not
    // instantaneous and another admin may have moved one of these rows in the
    // meantime. Skipping on a stale value is the one way this could silently
    // fail to write something the operator was told it would write.
    let fresh = current
    if (columnKeys.length > 0) {
      try {
        const map = new Map<string, Record<string, unknown>>()
        const ids = targets.map((m) => String(m.id))
        for (let i = 0; i < ids.length; i += 100) {
          const rows = await fetchAllItems<Record<string, unknown>>('members', {
            filter: { id: { _in: ids.slice(i, i + 100) } },
            fields: ['id', ...columnKeys],
          })
          for (const row of rows) map.set(String(row.id), row)
        }
        fresh = map
      } catch {
        // Unreadable — fall through and let each member's write answer for
        // itself. Every patch is still correct; some are simply no-ops.
        fresh = null
      }
    }

    const result = await runBulk(
      targets,
      async (member): Promise<'changed' | 'skipped'> => {
        const id = String(member.id)
        let touched = false

        const patch = computeMemberPatch(fresh?.get(id) ?? {}, changes)
        if (Object.keys(patch).length > 0) {
          await updateRecord('members', id, patch)
          logActivity('update', 'members', id, patch)
          onMutate((prev) => ({
            ...prev,
            members: prev.members.map((m) => (String(m.id) === id ? { ...m, ...patch } : m)),
          }))
          touched = true
        }

        if (teamsChange) {
          const held = (rosterByMember.get(id) ?? [])
          const delta = computeRosterDelta(held.map((r) => r.team), teamsChange)
          for (const teamId of delta.add) {
            // The TARGET TEAM's own season, never the wall clock — the same rule
            // addRoster() follows in the grid. getCurrentSeason() disagrees with
            // it for all of May and between the Jun-1 cutover and the manual
            // rollover, and a mis-stamped row is silently orphaned by the clone.
            const season = cache.teamLookup.get(teamId)?.season ?? getCurrentSeason()
            const created = await createRecord<{ id: string | number; guest_level: number | null; season: string | null }>(
              'member_teams', { member: id, team: teamId, season },
            )
            const row: MemberTeamRow = {
              id: String(created.id),
              member: id,
              team: teamId,
              guest_level: created.guest_level ?? 0,
              season: created.season ?? season,
            }
            logActivity('create', 'member_teams', row.id, { member: id, team: teamId })
            onMutate((prev) => {
              const memberTeamRows = [...prev.memberTeamRows, row]
              return { ...prev, memberTeamRows, memberTeams: buildMemberTeamsMap(memberTeamRows) }
            })
            touched = true
          }
          for (const teamId of delta.remove) {
            for (const row of held.filter((r) => r.team === teamId)) {
              await deleteRecord('member_teams', row.id)
              logActivity('delete', 'member_teams', row.id, { member: id, team: teamId })
              onMutate((prev) => {
                const memberTeamRows = prev.memberTeamRows.filter((r) => r.id !== row.id)
                return { ...prev, memberTeamRows, memberTeams: buildMemberTeamsMap(memberTeamRows) }
              })
              touched = true
            }
          }
        }

        return touched ? 'changed' : 'skipped'
      },
      {
        idOf: (m) => String(m.id),
        labelOf: memberName,
        concurrency: 4,
        onProgress: (done, total) => setProgress({ done, total }),
        isCancelled: () => cancelledRef.current,
      },
    )

    setRunning(false)
    setProgress(null)
    setSummary(result)
    if (result.changed.length > 0) {
      toast.success(t('explorerBulkApplied', { count: result.changed.length }))
      onApplied()
    }
    if (result.failed.length > 0) toast.error(t('explorerBulkFailed', { count: result.failed.length }))
  }, [
    changes, affected, members, catalog, confirm, t, current, columnKeys,
    rosterByMember, cache.teamLookup, onMutate, onApplied,
  ])

  const remaining = useMemo(
    () => catalog.filter((def) => !pickedKeys.includes(def.key)),
    [catalog, pickedKeys],
  )

  return (
    <Modal
      open={open}
      onClose={running ? () => { /* a run in flight must finish */ } : onClose}
      title={t('explorerBulkTitle', { count: members.length })}
      size="lg"
    >
      <div className="space-y-4">
        {/* Who is selected */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t('explorerBulkSelected', { count: members.length })}
          </p>
          <p className="mt-1 text-sm text-foreground">
            {members.slice(0, 8).map(memberName).join(', ')}
            {members.length > 8 ? t('explorerBulkAndMore', { count: members.length - 8 }) : ''}
          </p>
        </div>

        {/* Composed changes */}
        <div className="space-y-3">
          {changes.map((change) => {
            const def = catalog.find((d) => d.key === change.key)
            if (!def) return null
            return (
              <ChangeCard
                key={change.key}
                def={def}
                change={change}
                disabled={running}
                sport={selectionSport}
                teamOptions={teamOptions}
                onModeChange={(mode) => patchChange(change.key, {
                  mode,
                  // A list value composed for `add` is meaningless as a `set`
                  // payload only when it is empty; keeping it is what lets the
                  // operator flip add ↔ remove without re-picking the teams.
                  value: mode === 'clear' ? null : change.value,
                })}
                onValueChange={(value) => patchChange(change.key, { value })}
                onRemove={() => removeField(change.key)}
              />
            )
          })}

          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" disabled={running} className="min-h-[44px]">
                <Plus className="mr-1.5 h-4 w-4" />
                {t('explorerBulkAddField')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[22rem] p-0" align="start">
              <Command>
                <CommandInput placeholder={t('explorerBulkFieldSearch')} />
                <CommandList className="max-h-72">
                  <CommandEmpty>{t('explorerBulkNoField')}</CommandEmpty>
                  {MEMBER_FIELD_GROUPS.map((group) => {
                    const fields = remaining.filter((d) => d.group === group.id)
                    if (fields.length === 0) return null
                    return (
                      <CommandGroup key={group.id} heading={GROUP_LABEL[group.id]}>
                        {fields.map((def) => (
                          <CommandItem
                            key={def.key}
                            value={`${def.label} ${def.key}`}
                            onSelect={() => addField(def)}
                          >
                            <span className="truncate">{def.label}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )
                  })}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Preview / result */}
        {changes.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-3 text-sm">
            {running ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('explorerBulkRunning', { done: progress?.done ?? 0, total: progress?.total ?? members.length })}
              </p>
            ) : valuesError ? (
              <p className="text-amber-700 dark:text-amber-400">{t('explorerBulkPreviewUnavailable')}</p>
            ) : affected === undefined ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('explorerBulkPreviewLoading')}
              </p>
            ) : (
              <p className="text-foreground">
                {t('explorerBulkPreview', { changed: affected.length, total: members.length })}
                {affected.length < members.length && (
                  <span className="text-muted-foreground">
                    {' '}
                    {t('explorerBulkPreviewSkipped', { count: members.length - affected.length })}
                  </span>
                )}
              </p>
            )}
          </div>
        )}

        {summary && summary.failed.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {t('explorerBulkFailed', { count: summary.failed.length })}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-destructive">
              {summary.failed.slice(0, 10).map((f) => (
                <li key={f.id}>
                  <span className="font-medium">{f.label}</span> — {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={running} className="min-h-[44px]">
            {t('explorerBulkClose')}
          </Button>
          <Button type="button" onClick={handleApply} disabled={!canApply} className="min-h-[44px]">
            {running && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('explorerBulkApply', { count: affectedCount })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ── One composed change ──────────────────────────────────────────────

function ChangeCard({
  def, change, disabled, sport, teamOptions, onModeChange, onValueChange, onRemove,
}: {
  def: MemberFieldDef
  change: BulkFieldChange
  disabled: boolean
  sport: MemberSport
  teamOptions: TeamPickerOption[]
  onModeChange: (mode: BulkMode) => void
  onValueChange: (value: unknown) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('admin')
  const modes = modesFor(def)
  const isTeams = def.key === TEAMS_VIRTUAL_KEY
  const listValue = Array.isArray(change.value) ? (change.value as string[]) : []

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{def.label}</p>
          {def.help && <p className="mt-0.5 text-xs text-muted-foreground">{def.help}</p>}
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('explorerBulkRemoveField')}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mode switch */}
      <div className="mt-2 flex flex-wrap gap-1" role="group">
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            onClick={() => onModeChange(mode)}
            aria-pressed={change.mode === mode}
            className={
              'rounded-md px-2.5 py-1.5 text-xs font-medium ' +
              (change.mode === mode
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground')
            }
          >
            {t(`explorerBulkMode_${mode}`)}
          </button>
        ))}
      </div>

      {/* Value */}
      {change.mode !== 'clear' && (
        <div className="mt-2">
          <FieldEditor
            def={def}
            value={change.value}
            onChange={onValueChange}
            ctx={{
              sport,
              teamOptions,
              // For the roster the picker IS the composed value, not a member's
              // own teams — nothing is busy because nothing has been written yet.
              rosterTeamIds: isTeams ? listValue : [],
              busyTeamIds: EMPTY_BUSY,
              onTeamsChange: (ids) => onValueChange(ids),
              disabled,
            }}
          />
        </div>
      )}

      {change.mode === 'clear' && (
        <p className="mt-2 text-xs text-muted-foreground">{t('explorerBulkClearHint')}</p>
      )}

      {def.overwrittenBy && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {def.overwrittenBy}
        </p>
      )}
      {REGISTER_PUSH_KEYS.has(def.key) && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {t('explorerBulkRegisterPush')}
        </p>
      )}
    </div>
  )
}

const EMPTY_BUSY: ReadonlySet<string> = new Set<string>()
