import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'
import type { Member, Team, VbRefereeDuty } from '../../types'
import { useCollection } from '../../lib/query'
import { useMutation } from '../../hooks/useMutation'
import { useAuth } from '../../hooks/useAuth'
import { relId } from '../../utils/relations'
import { teamNameToColorKey } from '../../utils/teamColors'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import TeamMultiSelect from '../../components/TeamMultiSelect'
import TeamChip from '../../components/TeamChip'
import { Switch } from '@/components/ui/switch'
import LoadingSpinner from '../../components/LoadingSpinner'
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

  const { data: refereesRaw, isLoading: refLoading } = useCollection<Member>('members', {
    filter: { referee_vb: { _eq: true } },
    fields: ['id', 'first_name', 'last_name', 'nickname', 'referee_vb'],
    sort: ['first_name', 'last_name'],
    all: true,
    enabled: !!user && canVb,
  })
  const referees = useMemo(() => refereesRaw ?? [], [refereesRaw])

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
  const [savingId, setSavingId] = useState<string | null>(null)

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
      ) : referees.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {t('vbRefNoReferees', { defaultValue: 'No VB referees found. Set “Referee VB” on members first.' })}
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
    </div>
  )
}
