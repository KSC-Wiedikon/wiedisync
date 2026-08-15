/**
 * ClubdeskProposals — the sync-down review queue.
 *
 * Since migration 321 the ClubDesk sync-down does not write to `members` at all.
 * It stages every change it wants to make as a row in `clubdesk_sync_proposals`,
 * and this table is where a superadmin resolves them:
 *
 *   Accept — ClubDesk's value is written into wiedisync.
 *   Refuse — ours stands. The proposal becomes a tombstone so detection never
 *            asks again, and (when we actually hold a value to assert) the member
 *            is flagged so the next sync-up corrects ClubDesk instead of leaving
 *            the two systems knowingly divergent.
 *
 * ⚠ The two actions are NOT symmetric and the UI should not pretend otherwise:
 * accepting changes our database, refusing changes ClubDesk's — eventually, and
 * only via a push somebody still has to approve.
 *
 * `rule` is shown as a "why" column because it is the only thing that makes the
 * decision informed: a `fill` is the register offering something we lack, an
 * `overwrite` is a genuine disagreement, and a `set_true` is a qualification the
 * register asserts.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kscwApi } from '../../../lib/api'
import { formatDateZurich } from '../../../utils/dateHelpers'

export interface Proposal {
  id: number
  member_id: number | null
  member_name: string
  clubdesk_id: string
  field: string | null
  current_value: string | null
  proposed_value: string | null
  rule: 'fill' | 'overwrite' | 'set_true' | 'create'
  email: string | null
  detected_at: string
}

interface ProposalsResp {
  proposals: Proposal[]
  counts: Record<string, number>
  total: number
}

// Dates arrive ISO (the detection pass stores them that way so the accept path
// never has to guess a locale) but must READ Swiss — CLAUDE.md date rule.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
function display(v: string | null): string {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  return ISO_DATE.test(s) ? formatDateZurich(s) : s
}

export default function ClubdeskProposals({ onDone, onCountChange }: {
  onDone?: () => void | Promise<void>
  /** Reported upward so the sync path can gate its decision step on the count. */
  onCountChange?: (n: number) => void
}) {
  const { t } = useTranslation('admin')
  const [data, setData] = useState<ProposalsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<number | 'bulk' | null>(null)

  // ⚠ The state updates live in an async IIFE inside the effect rather than in a
  // function the effect calls. A synchronous setState from an effect body is the
  // cascading-render bug react-hooks/set-state-in-effect exists to catch, and the
  // rule reads the call site, not what the callee does first. `alive` is the
  // usual unmount guard.
  const apply = useCallback((r: ProposalsResp) => {
    setData(r)
    setError(null)
    onCountChange?.(r.total)
    // Drop selections for rows that no longer exist, or a bulk action would send
    // ids the server has already decided.
    setSelected((prev) => {
      const live = new Set(r.proposals.map((p) => p.id))
      return new Set([...prev].filter((id) => live.has(id)))
    })
  }, [onCountChange])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const r = await kscwApi<ProposalsResp>('/clubdesk-sync/proposals')
        if (alive) apply(r)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [apply])

  // Manual refetch after a decision — never called from an effect, so it may set
  // state directly. It deliberately leaves `loading` alone: the table stays on
  // screen and swaps its rows.
  const load = useCallback(async () => {
    try {
      apply(await kscwApi<ProposalsResp>('/clubdesk-sync/proposals'))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [apply])

  const rows = data?.proposals ?? []
  const allSelected = rows.length > 0 && selected.size === rows.length

  const decide = useCallback(async (ids: number[], decision: 'accept' | 'refuse') => {
    if (!ids.length) return
    setBusy(ids.length === 1 ? ids[0] : 'bulk')
    try {
      const r = await kscwApi<{ decided: number; skipped: number; flagged_for_push: number }>(
        '/clubdesk-sync/proposals/decide',
        { method: 'POST', body: { ids, decision } },
      )
      toast.success(decision === 'accept'
        ? t('dhProposalAccepted', { count: r.decided })
        : t('dhProposalRefused', { count: r.decided }))
      // Refusing only queues a push when we hold a value worth asserting, so this
      // count is genuinely different from `decided` and worth surfacing.
      if (r.flagged_for_push > 0) toast.info(t('dhProposalFlagged', { count: r.flagged_for_push }))
      if (r.skipped > 0) toast.warning(t('dhProposalSkipped', { count: r.skipped }))
      setSelected(new Set())
      await load()
      await onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [load, onDone, t])

  const ruleLabel = useMemo(() => ({
    fill: t('dhProposalRuleFill'),
    overwrite: t('dhProposalRuleOverwrite'),
    set_true: t('dhProposalRuleSetTrue'),
    create: t('dhProposalRuleCreate'),
  }), [t])

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('dhProposalLoading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-400">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {error}
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-gray-200 px-4 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        {t('dhProposalNone')}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            {t('dhProposalTitle', { count: rows.length })}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t('dhProposalHint')}
          </p>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              type="button" size="sm" variant="outline"
              disabled={busy !== null} aria-busy={busy === 'bulk'}
              onClick={() => void decide([...selected], 'accept')}
              className="gap-1.5"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dhProposalAcceptN', { count: selected.size })}
            </Button>
            <Button
              type="button" size="sm" variant="outline"
              disabled={busy !== null} aria-busy={busy === 'bulk'}
              onClick={() => void decide([...selected], 'refuse')}
              className="gap-1.5"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t('dhProposalRefuseN', { count: selected.size })}
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  aria-label={t('dhProposalSelectAll')}
                  onCheckedChange={(v) =>
                    setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <TableHead>{t('dhProposalColMember')}</TableHead>
              <TableHead>{t('dhProposalColField')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('dhProposalColOurs')}</TableHead>
              <TableHead>{t('dhProposalColClubdesk')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('dhProposalColWhy')}</TableHead>
              <TableHead className="w-32 text-right">{t('dhProposalColAction')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id} className="min-h-11">
                <TableCell>
                  <Checkbox
                    checked={selected.has(p.id)}
                    aria-label={t('dhProposalSelectOne', { name: p.member_name })}
                    onCheckedChange={(v) => setSelected((prev) => {
                      const next = new Set(prev)
                      if (v) next.add(p.id); else next.delete(p.id)
                      return next
                    })}
                  />
                </TableCell>
                <TableCell className="whitespace-normal break-words font-medium">
                  {p.member_name || '—'}
                  {p.rule === 'create' && p.email && (
                    <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">{p.email}</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal break-words">
                  {p.rule === 'create' ? t('dhProposalNewMember') : p.field}
                </TableCell>
                <TableCell className="hidden whitespace-normal break-words text-gray-500 sm:table-cell dark:text-gray-400">
                  {display(p.current_value)}
                </TableCell>
                <TableCell className="whitespace-normal break-words">{display(p.proposed_value)}</TableCell>
                <TableCell className="hidden text-xs text-gray-500 md:table-cell dark:text-gray-400">
                  {ruleLabel[p.rule]}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex flex-col justify-end gap-1 sm:flex-row">
                    <Button
                      type="button" size="sm" variant="outline"
                      disabled={busy !== null} aria-busy={busy === p.id}
                      onClick={() => void decide([p.id], 'accept')}
                    >
                      {t('dhProposalAccept')}
                    </Button>
                    <Button
                      type="button" size="sm" variant="ghost"
                      disabled={busy !== null} aria-busy={busy === p.id}
                      onClick={() => void decide([p.id], 'refuse')}
                    >
                      {t('dhProposalRefuse')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
