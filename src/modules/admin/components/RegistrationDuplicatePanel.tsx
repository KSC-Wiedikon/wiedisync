import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, CircleAlert, UserCheck, ExternalLink, Merge } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { kscwApi } from '../../../lib/api'
import { useConfirm } from '../../../components/ConfirmProvider'

export type DupLevel = 'blocked' | 'returning' | 'possible' | 'none'

export interface DupFlag {
  level: DupLevel
  count: number
  member_id: number
  member_name: string
  match: string
  active: boolean
}

interface DiffRow {
  key: string
  label: string
  kind: 'scalar' | 'licence'
  member_value: string | null
  registration_value: string
  differs: boolean
  member_empty: boolean
}

interface Candidate {
  member_id: number
  name: string
  email: string | null
  match: string
  reasons: string[]
  active: boolean
  has_account: boolean
  clubdesk_id: string | null
  shell: boolean
  diff: DiffRow[]
}

/**
 * "Possible duplicate" zone in the Anmeldungen expanded details.
 *
 * The public form hard-blocks an ACTIVE member from re-registering as
 * themselves, so those rows never get here. What DOES get here is everything
 * the door deliberately lets through: a former member coming back, and anyone
 * who re-registered under a new email address — cases no email match can see.
 * Approving one of those blind mints a SECOND member row for a person the club
 * already has, which is how a ClubDesk link and a member's history get orphaned.
 *
 * So this panel names the candidate, diffs the two records field by field, and
 * merges: it stamps `registrations.member` (which the approval hook now honours
 * ahead of its own email heuristic) and writes the ticked fields onto the
 * existing member. It does NOT approve — the normal approve button still runs
 * afterwards for the roster, the ClubDesk push and the email.
 */
export default function RegistrationDuplicatePanel({
  registrationId,
  onMerged,
}: {
  registrationId: string
  onMerged?: () => void
}) {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()
  const [data, setData] = useState<{ level: DupLevel; linked_member: number | null; candidates: Candidate[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [fetchKey, setFetchKey] = useState(0)
  const [openId, setOpenId] = useState<number | null>(null)
  // key → ticked. Seeded per candidate the first time its diff is opened.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [merging, setMerging] = useState(false)

  // ⚠ This effect sets state ONLY inside the async callbacks. A synchronous
  // setState here (the obvious `setLoading(true)` at the top) triggers a
  // cascading render and fails the lint gate — same reason
  // ClubdeskRegistrationZone routes its reset through the refetch callback.
  useEffect(() => {
    let alive = true
    kscwApi<{ level: DupLevel; linked_member: number | null; candidates: Candidate[] }>(
      `/registration/${encodeURIComponent(registrationId)}/duplicates`,
    )
      .then((d) => { if (alive) { setData(d); setFailed(false); setLoading(false) } })
      .catch(() => { if (alive) { setFailed(true); setLoading(false) } })
    return () => { alive = false }
  }, [registrationId, fetchKey])

  const refetch = useCallback(() => {
    setLoading(true)
    setFailed(false)
    setFetchKey((k) => k + 1)
  }, [])

  const openCandidate = data?.candidates.find((c) => c.member_id === openId) ?? null

  // Staff chose "the registration is the newer truth", so every differing field
  // starts ticked — including overwrites. The diff still marks which rows are
  // overwrites so nothing is applied unseen.
  const selectCandidate = useCallback((c: Candidate) => {
    setOpenId(c.member_id)
    setPicked(Object.fromEntries(c.diff.filter((d) => d.differs).map((d) => [d.key, true])))
  }, [])

  const pickedCount = useMemo(
    () => (openCandidate?.diff ?? []).filter((d) => d.differs && picked[d.key]).length,
    [openCandidate, picked],
  )

  const doMerge = useCallback(async () => {
    if (!openCandidate || merging) return
    const overwrites = openCandidate.diff.filter((d) => d.differs && picked[d.key] && !d.member_empty).length
    if (!(await confirm({
      message: overwrites
        ? t('anmeldungenDupMergeConfirmOverwrite', { name: openCandidate.name, count: pickedCount, overwrites })
        : t('anmeldungenDupMergeConfirm', { name: openCandidate.name, count: pickedCount }),
      danger: overwrites > 0,
    }))) return
    setMerging(true)
    try {
      const res = await kscwApi<{ member_id: number; applied: string[] }>(
        `/registration/${encodeURIComponent(registrationId)}/merge`,
        { method: 'POST', body: { member_id: openCandidate.member_id, fields: Object.keys(picked).filter((k) => picked[k]) } },
      )
      toast.success(t('anmeldungenDupMerged', { name: openCandidate.name, count: res.applied.length }))
      setOpenId(null)
      refetch()
      onMerged?.()
    } catch {
      toast.error(t('anmeldungenDupMergeError'))
    } finally {
      setMerging(false)
    }
  }, [openCandidate, merging, picked, pickedCount, registrationId, confirm, t, onMerged, refetch])

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('anmeldungenDupChecking')}
      </div>
    )
  }
  if (failed) {
    return (
      <button
        onClick={refetch}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-left text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
      >
        <CircleAlert className="h-4 w-4" />
        {t('anmeldungenDupCheckFailed')}
      </button>
    )
  }
  // Already merged/approved onto a member, and nothing else resembles it.
  if (!data || data.level === 'none') {
    if (data?.linked_member) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          <UserCheck className="h-4 w-4 text-green-600 dark:text-green-400" />
          {t('anmeldungenDupLinked', { id: data.linked_member })}
        </div>
      )
    }
    return null
  }

  const tone = data.level === 'returning'
    ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
    : 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-start gap-2">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {data.level === 'returning' ? t('anmeldungenDupReturningTitle') : t('anmeldungenDupPossibleTitle')}
          </p>
          <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
            {data.level === 'returning' ? t('anmeldungenDupReturningHint') : t('anmeldungenDupPossibleHint')}
          </p>
        </div>
      </div>

      {/* Candidates */}
      <div className="mt-3 space-y-2">
        {data.candidates.map((c) => (
          <div key={c.member_id} className="rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{c.name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">#{c.member_id}</span>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    c.active
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {c.active ? t('anmeldungenDupActive') : t('anmeldungenDupFormer')}
                  </span>
                  {c.clubdesk_id && (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">CD {c.clubdesk_id}</span>
                  )}
                </div>
                <div className="mt-0.5 break-all text-xs text-gray-500 dark:text-gray-400">{c.email || '—'}</div>
                <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {t('anmeldungenDupMatchedOn')}{' '}
                  {c.reasons.map((r) => t(`anmeldungenDupReason_${r}`, { defaultValue: r })).join(', ')}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={`/admin/explore?t=members&id=${c.member_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('anmeldungenDupOpenMember')}
                </a>
                <Button
                  size="sm"
                  variant={openId === c.member_id ? 'secondary' : 'default'}
                  onClick={() => (openId === c.member_id ? setOpenId(null) : selectCandidate(c))}
                >
                  <Merge className="mr-1 h-3.5 w-3.5" />
                  {t('anmeldungenDupReview')}
                </Button>
              </div>
            </div>

            {openId === c.member_id && (
              <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                {c.diff.filter((d) => d.differs).length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('anmeldungenDupNoDiff')}</p>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10" />
                            <TableHead className="text-gray-500 dark:text-gray-400">{t('anmeldungenDupColField')}</TableHead>
                            <TableHead className="text-gray-500 dark:text-gray-400">{t('anmeldungenDupColMember')}</TableHead>
                            <TableHead className="text-gray-500 dark:text-gray-400">{t('anmeldungenDupColRegistration')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {c.diff.filter((d) => d.differs).map((d) => (
                            <TableRow key={d.key} className="align-top">
                              <TableCell>
                                <input
                                  type="checkbox"
                                  checked={!!picked[d.key]}
                                  onChange={() => setPicked((p) => ({ ...p, [d.key]: !p[d.key] }))}
                                  className="h-4 w-4 rounded border-gray-300 text-blue-600 dark:border-gray-600"
                                />
                              </TableCell>
                              <TableCell className="whitespace-normal break-words text-xs text-gray-700 dark:text-gray-200">
                                {d.label}
                                {!d.member_empty && (
                                  <span className="ml-1 text-[10px] font-medium uppercase text-amber-600 dark:text-amber-400">
                                    {t('anmeldungenDupOverwrite')}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="whitespace-normal break-words text-xs text-gray-500 dark:text-gray-400">
                                {d.member_value ?? '—'}
                              </TableCell>
                              <TableCell className="whitespace-normal break-words text-xs font-medium text-gray-900 dark:text-gray-100">
                                {d.registration_value}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      <span className="mr-auto text-[11px] text-gray-500 dark:text-gray-400">
                        {t('anmeldungenDupMergeNote')}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => setOpenId(null)} disabled={merging}>
                        {t('anmeldungenDupCancel')}
                      </Button>
                      <Button size="sm" onClick={doMerge} disabled={merging}>
                        {merging && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                        {t('anmeldungenDupMergeAction', { count: pickedCount })}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
