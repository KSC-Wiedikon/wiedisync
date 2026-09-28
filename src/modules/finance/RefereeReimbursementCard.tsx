import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HandCoins, Loader2, Eye, Check } from 'lucide-react'
import { useConfirm } from '../../components/ConfirmProvider'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { runRefereePayout, formatChf } from '../../hooks/useFinance'
import type { RefereePayoutRunResponse, RefereePayoutPlanRow } from './types'

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
    <section className="rounded-2xl border border-hairline bg-card shadow-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
          <HandCoins className="h-4 w-4 shrink-0 text-primary dark:text-brand-300" /> {t('refereeReimbTitle', { season })}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* The filled primary leads (/kscw-ui → Action placement); it only appears once a preview exists. */}
          {preview && payable.length > 0 && (
            <Button type="button" disabled={busy != null} onClick={create}>
              {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t('refereeReimbCreate', { count: payable.length })}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy != null} onClick={loadPreview}>
            {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            {t('refereeReimbPreview')}
          </Button>
        </div>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{t('myRefereeSubtitle')}</p>

      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {preview && (
        rows.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            {t('refereeReimbEmpty', { season })}
          </p>
        ) : (
          <div className="-mx-4 mt-3 border-t border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colMember')}</TableHead>
                  <TableHead className={"text-right"}>{t('refereeReimbColGames')}</TableHead>
                  <TableHead className={"text-right"}>{t('colAmount')}</TableHead>
                  <TableHead className={"hidden sm:table-cell"}>IBAN</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.member} className={`min-h-[44px] ${r.skip ? 'opacity-70' : ''}`}>
                    <TableCell className="whitespace-normal break-words text-foreground">
                      {r.member_name}
                      {r.skip && (
                        <span className="ml-1 inline-block whitespace-nowrap rounded-full bg-red-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                          {skipLabel(r.skip)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-foreground/85">{r.games}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-foreground">{formatChf(r.total)}</TableCell>
                    <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">{r.iban ?? '–'}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-border font-semibold">
                  <TableCell className="text-foreground">{t('teamColTotal')}</TableCell>
                  <TableCell className="text-right tabular-nums text-foreground/85">{payable.reduce((a, r) => a + r.games, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">{formatChf(payable.reduce((a, r) => a + r.total, 0))}</TableCell>
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
