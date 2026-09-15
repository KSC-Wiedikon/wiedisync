import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HandCoins, Loader2, Eye, Check } from 'lucide-react'
import { useConfirm } from '../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { runRefereePayout, formatChf } from '../../hooks/useFinance'
import type { RefereePayoutRunResponse, RefereePayoutPlanRow } from './types'

const thCls = 'text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400'
const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb

/** Skip codes the run reports → short labels. Unknown codes fall through verbatim. */
function useSkipLabel() {
  const { t } = useTranslation('finance')
  return (code: string): string => ({
    NO_IBAN: t('refereeReimbSkipNoIban'),
    ADDRESS_INCOMPLETE: t('refereeReimbSkipAddress'),
    NON_CHF: t('refereeReimbSkipCurrency'),
  }[code] ?? code)
}

/**
 * Season-end referee reimbursement (treasurer, Teams tab): preview the one
 * payout per member the run would create, then create them. Creating marks
 * the underlying referee_expenses as reimbursed (migration 363).
 */
export default function RefereeReimbursementCard({ season }: { season: string }) {
  const { t } = useTranslation('finance')
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const skipLabel = useSkipLabel()
  const [preview, setPreview] = useState<RefereePayoutRunResponse | null>(null)
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const [error, setError] = useState('')

  async function loadPreview() {
    setBusy('preview'); setError('')
    try { setPreview(await runRefereePayout({ season, dry_run: true })) }
    catch (e) { setError(apiErr(e, t('ledActionError'))) }
    finally { setBusy(null) }
  }

  async function create() {
    if (!preview) return
    if (!(await confirm({ message: t('refereeReimbConfirm', { season }), danger: false }))) return
    setBusy('create'); setError('')
    try {
      const res = await runRefereePayout({ season, dry_run: false })
      toast.success(t('refereeReimbDone', { count: res.created }))
      setPreview(null)
      // Payouts, the per-team summary and every member's my-invoices envelope
      // all changed — the whole finance namespace is stale.
      queryClient.invalidateQueries({ queryKey: ['finance'] })
    } catch (e) { setError(apiErr(e, t('ledActionError'))) }
    finally { setBusy(null) }
  }

  const payable = (preview?.rows ?? []).filter((r: RefereePayoutPlanRow) => !r.skip)
  const rows = preview?.rows ?? []

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <HandCoins className="h-4 w-4 text-brand-600 dark:text-brand-400" /> {t('refereeReimbTitle', { season })}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy != null} onClick={loadPreview}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            {t('refereeReimbPreview')}
          </button>
          {preview && payable.length > 0 && (
            <button type="button" disabled={busy != null} onClick={create}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('refereeReimbCreate', { count: payable.length })}
            </button>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('myRefereeSubtitle')}</p>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {preview && (
        rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {t('refereeReimbEmpty', { season })}
          </p>
        ) : (
          <div className="-mx-4 mt-3 border-t border-gray-200 dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                  <TableHead className={thCls}>{t('colMember')}</TableHead>
                  <TableHead className={`text-right ${thCls}`}>{t('refereeReimbColGames')}</TableHead>
                  <TableHead className={`text-right ${thCls}`}>{t('colAmount')}</TableHead>
                  <TableHead className={`hidden sm:table-cell ${thCls}`}>IBAN</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.member} className={`min-h-[44px] border-gray-200 dark:border-gray-700 ${r.skip ? 'opacity-70' : ''}`}>
                    <TableCell className="whitespace-normal break-words text-gray-900 dark:text-gray-100">
                      {r.member_name}
                      {r.skip && (
                        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-red-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          {skipLabel(r.skip)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-gray-700 dark:text-gray-300">{r.games}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-gray-900 dark:text-gray-100">{formatChf(r.total)}</TableCell>
                    <TableCell className="hidden sm:table-cell font-mono text-xs text-gray-500 dark:text-gray-400">{r.iban ?? '–'}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-gray-300 font-semibold dark:border-gray-600">
                  <TableCell className="text-gray-900 dark:text-gray-100">{t('teamColTotal')}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-700 dark:text-gray-300">{payable.reduce((a, r) => a + r.games, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-900 dark:text-gray-100">{formatChf(payable.reduce((a, r) => a + r.total, 0))}</TableCell>
                  <TableCell className="hidden sm:table-cell" />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )
      )}
    </section>
  )
}
