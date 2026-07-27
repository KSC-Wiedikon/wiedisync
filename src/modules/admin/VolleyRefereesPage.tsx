import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import { Search, Trash2 } from 'lucide-react'
import type { Member, Team, VbRefereeDuty } from '../../types'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import { useAuth } from '../../hooks/useAuth'
import { memberDisplayName, relId } from '../../utils/relations'
import { teamNameToColorKey } from '../../utils/teamColors'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import TeamMultiSelect from '../../components/TeamMultiSelect'
import TeamChip from '../../components/TeamChip'
import { Switch } from '@/components/ui/switch'
import LoadingSpinner from '../../components/LoadingSpinner'
import { useConfirm } from '../../components/ConfirmProvider'
import { useReportPageLoading } from '../../hooks/usePageReady'

/**
 * Volley Referees — standing referee → team duty map (migration 200).
 * Admin / VB admin assign each `referee_vb` member to the team(s) whose referee
 * obligation they cover (or "External" for duty outside Wiedikon). Many-to-many.
 * Doubles as a coverage check. Not yet wired into the scorer-assign engine.
 */
export default function VolleyRefereesPage() {
  const { t } = useTranslation('admin')
  const { user, hasAdminAccessToSport } = useAuth()
  const canVb = hasAdminAccessToSport('volleyball')

  const { data: refereesRaw, isLoading: refLoading, refetch: refetchReferees } = useCollection<Member>('members', {
    filter: { referee_vb: { _eq: true } },
    fields: ['id', 'first_name', 'last_name', 'nickname', 'referee_vb'],
    sort: ['first_name', 'last_name'],
    all: true,
    enabled: !!user && canVb,
  })
  const referees = useMemo(() => refereesRaw ?? [], [refereesRaw])

  // Active members for the add-referee picker (non-referees filtered client-side
  // so nullable `referee_vb` needs no _null-aware filter).
  const { data: activeMembersRaw } = useCollection<Member>('members', {
    filter: { wiedisync_active: { _eq: true } },
    fields: ['id', 'first_name', 'last_name', 'nickname'],
    sort: ['first_name', 'last_name'],
    all: true,
    enabled: !!user && canVb,
  })
  const activeMembers = useMemo(() => activeMembersRaw ?? [], [activeMembersRaw])

  const { data: teamsRaw, isLoading: teamsLoading } = useCollection<Team>('teams', {
    filter: { _and: [{ active: { _eq: true } }, { sport: { _eq: 'volleyball' } }] },
    fields: ['id', 'name', 'sport'],
    sort: ['name'],
    all: true,
    enabled: !!user && canVb,
  })
  const teams = useMemo(() => teamsRaw ?? [], [teamsRaw])

  const { data: dutiesRaw, isLoading: dutiesLoading, refetch } = useCollection<VbRefereeDuty>('vb_referee_duty', {
    fields: ['id', 'referee', 'team', 'external', 'external_label'],
    all: true,
    enabled: !!user && canVb,
  })
  const duties = useMemo(() => dutiesRaw ?? [], [dutiesRaw])

  const { create, update, remove } = useMutation<VbRefereeDuty>('vb_referee_duty')
  const { update: updateMember } = useMutation<Member>('members')
  const confirm = useConfirm()
  const [savingId, setSavingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const loading = refLoading || teamsLoading || dutiesLoading
  useReportPageLoading(loading)

  const teamOptions = useMemo(
    () => teams.map((tm) => ({
      value: String(tm.id),
      label: tm.name,
      colorKey: teamNameToColorKey(tm.name, tm.sport),
    })),
    [teams],
  )
  const teamNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const tm of teams) m.set(String(tm.id), tm.name)
    return m
  }, [teams])

  // referee id → their duty rows
  const dutiesByReferee = useMemo(() => {
    const m = new Map<string, VbRefereeDuty[]>()
    for (const d of duties) {
      const rid = relId(d.referee)
      const arr = m.get(rid)
      if (arr) arr.push(d)
      else m.set(rid, [d])
    }
    return m
  }, [duties])

  const teamDutiesFor = (rid: string) => (dutiesByReferee.get(rid) ?? []).filter((d) => !d.external && d.team != null)
  const externalDutyFor = (rid: string) => (dutiesByReferee.get(rid) ?? []).find((d) => d.external)

  // Coverage check
  const { teamsWithoutReferee, refereesWithoutDuty } = useMemo(() => {
    const covered = new Set<string>()
    for (const d of duties) if (!d.external && d.team != null) covered.add(relId(d.team))
    const noRef = teams.filter((tm) => !covered.has(String(tm.id)))
    const noDuty = referees.filter((r) => (dutiesByReferee.get(String(r.id)) ?? []).length === 0)
    return { teamsWithoutReferee: noRef, refereesWithoutDuty: noDuty }
  }, [duties, teams, referees, dutiesByReferee])

  const addableOptions = useMemo(() => {
    const refereeIds = new Set(referees.map((r) => String(r.id)))
    return activeMembers
      .filter((m) => !refereeIds.has(String(m.id)))
      .map((m) => ({ id: String(m.id), label: memberDisplayName(m) || `#${m.id}` }))
  }, [activeMembers, referees])

  const addReferee = async (mid: string) => {
    setAdding(true)
    try {
      await updateMember(mid, { referee_vb: true })
      await refetchReferees()
    } catch { /* useMutation logs */ }
    finally { setAdding(false) }
  }

  const removeReferee = async (r: Member) => {
    const rid = String(r.id)
    const name = memberDisplayName(r) || `#${rid}`
    const ok = await confirm({
      message: t('vbRefRemoveConfirm', {
        name,
        defaultValue: 'Remove {{name}} as a referee? Their team assignments will be deleted too. If they still hold a referee licence in ClubDesk or Volleymanager, the weekly sync will re-add them.',
      }),
      danger: true,
    })
    if (!ok) return
    setSavingId(rid)
    try {
      // Duties first: a lingering duty row would keep counting its team as covered.
      await Promise.all((dutiesByReferee.get(rid) ?? []).map((d) => remove(d.id)))
      await updateMember(rid, { referee_vb: false })
      await Promise.all([refetchReferees(), refetch()])
    } catch { /* useMutation logs; UI reverts on refetch */ }
    finally { setSavingId(null) }
  }

  const setTeamsForReferee = async (rid: string, selectedTeamIds: string[]) => {
    const current = teamDutiesFor(rid)
    const currentIds = new Set(current.map((d) => relId(d.team)))
    const next = new Set(selectedTeamIds)
    const toAdd = selectedTeamIds.filter((id) => !currentIds.has(id))
    const toRemove = current.filter((d) => !next.has(relId(d.team)))
    if (toAdd.length === 0 && toRemove.length === 0) return
    setSavingId(rid)
    try {
      await Promise.all([
        ...toAdd.map((tid) => create({ referee: rid, team: tid, external: false })),
        ...toRemove.map((d) => remove(d.id)),
      ])
      await refetch()
    } catch { /* useMutation logs; UI reverts on refetch */ }
    finally { setSavingId(null) }
  }

  const toggleExternal = async (rid: string, on: boolean) => {
    const existing = externalDutyFor(rid)
    setSavingId(rid)
    try {
      if (on && !existing) {
        await create({ referee: rid, team: null, external: true })
      } else if (!on && existing) {
        await remove(existing.id)
      }
      await refetch()
    } catch { /* ignore */ }
    finally { setSavingId(null) }
  }

  const saveExternalLabel = async (rid: string, label: string) => {
    const existing = externalDutyFor(rid)
    if (!existing) return
    const next = label.trim() || null
    if ((existing.external_label ?? null) === next) return
    try {
      await update(existing.id, { external_label: next })
      await refetch()
    } catch { /* ignore */ }
  }

  if (!canVb) return <Navigate to="/" replace />

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('vbRefTitle', { defaultValue: 'Volley referees' })}</h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {t('vbRefSubtitle', { defaultValue: 'Assign each referee to the team(s) they cover. “External” = duty outside Wiedikon.' })}
      </p>

      {loading ? (
        <div className="py-12"><LoadingSpinner /></div>
      ) : (
        <>
          <AddRefereePicker
            options={addableOptions}
            onAdd={addReferee}
            busy={adding}
            placeholder={t('vbRefAddPlaceholder', { defaultValue: 'Add a referee…' })}
          />
          {referees.length === 0 ? (
            <p className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t('vbRefNoReferees', { defaultValue: 'No VB referees yet. Add one with the search above.' })}
            </p>
          ) : (
            <>
          <div className="mt-5 overflow-x-auto rounded-lg border dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('vbRefColReferee', { defaultValue: 'Referee' })}</TableHead>
                  <TableHead>{t('vbRefColTeams', { defaultValue: 'Teams covered' })}</TableHead>
                  <TableHead className="w-[42%]">{t('vbRefColExternal', { defaultValue: 'External' })}</TableHead>
                  <TableHead className="w-12"><span className="sr-only">{t('vbRefRemove', { defaultValue: 'Remove referee' })}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referees.map((r) => {
                  const rid = String(r.id)
                  const selectedTeamIds = teamDutiesFor(rid).map((d) => relId(d.team))
                  const ext = externalDutyFor(rid)
                  const busy = savingId === rid
                  return (
                    <TableRow key={rid} className={busy ? 'opacity-60' : ''}>
                      <TableCell className="whitespace-normal break-words align-top font-medium">
                        {`${r.nickname || r.first_name || ''} ${r.last_name ?? ''}`.trim() || `#${rid}`}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="mb-1 flex flex-wrap gap-1">
                          {selectedTeamIds.map((tid) => (
                            <TeamChip key={tid} team={teamNameById.get(tid) ?? tid} size="sm" />
                          ))}
                        </div>
                        <TeamMultiSelect
                          options={teamOptions}
                          selected={selectedTeamIds}
                          onChange={(sel) => setTeamsForReferee(rid, sel)}
                          placeholder={t('vbRefTeamsPlaceholder', { defaultValue: 'Assign teams…' })}
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <Switch checked={!!ext} onCheckedChange={(v) => toggleExternal(rid, v)} disabled={busy} />
                            {t('vbRefColExternal', { defaultValue: 'External' })}
                          </label>
                          {ext && (
                            <input
                              type="text"
                              defaultValue={ext.external_label ?? ''}
                              onBlur={(e) => saveExternalLabel(rid, e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                              placeholder={t('vbRefExternalPlaceholder', { defaultValue: 'Which club / pool (optional)' })}
                              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <button
                          type="button"
                          onClick={() => removeReferee(r)}
                          disabled={busy}
                          title={t('vbRefRemove', { defaultValue: 'Remove referee' })}
                          aria-label={t('vbRefRemove', { defaultValue: 'Remove referee' })}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:h-9 sm:w-9 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Coverage check */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('vbRefTeamsWithoutReferee', { defaultValue: 'Teams with no referee' })}
              </h2>
              {teamsWithoutReferee.length === 0 ? (
                <p className="mt-2 text-sm text-green-600 dark:text-green-400">{t('vbRefAllCovered', { defaultValue: 'Every team has a referee.' })}</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1">
                  {teamsWithoutReferee.map((tm) => (
                    <TeamChip key={tm.id} team={tm.name} size="sm" />
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {t('vbRefRefereesWithoutDuty', { defaultValue: 'Referees with no assignment' })}
              </h2>
              {refereesWithoutDuty.length === 0 ? (
                <p className="mt-2 text-sm text-green-600 dark:text-green-400">{t('vbRefAllAssigned', { defaultValue: 'Every referee has a duty.' })}</p>
              ) : (
                <ul className="mt-2 space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
                  {refereesWithoutDuty.map((r) => (
                    <li key={r.id}>{`${r.nickname || r.first_name || ''} ${r.last_name ?? ''}`.trim() || `#${r.id}`}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Single-select member search — picking a member immediately flags them as referee. */
function AddRefereePicker({ options, onAdd, busy, placeholder }: {
  options: { id: string; label: string }[]
  onAdd: (id: string) => void
  busy: boolean
  placeholder: string
}) {
  const { t } = useTranslation('common')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const listboxId = useId()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, search])

  return (
    <div className="relative mt-4 max-w-sm">
      <div className={`flex items-center gap-2 rounded-md border border-gray-200 bg-transparent px-3 py-2 dark:border-gray-600 ${busy ? 'opacity-60' : ''}`}>
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          role="combobox"
          aria-expanded={open && filtered.length > 0}
          aria-controls={open && filtered.length > 0 ? listboxId : undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          value={search}
          disabled={busy}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm outline-none dark:text-gray-100"
        />
      </div>

      {open && filtered.length > 0 && (
        <div id={listboxId} role="listbox" className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          {filtered.length > 50 && (
            <div className="sticky top-0 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs text-muted-foreground dark:border-gray-700 dark:bg-gray-900">
              {t('showingFirstOf', { shown: 50, total: filtered.length })}
            </div>
          )}
          {filtered.slice(0, 50).map((o) => (
            <button
              key={o.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => { onAdd(o.id); setSearch(''); setOpen(false) }}
              className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  )
}
