import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import { fetchClubdeskSyncStatus, triggerClubdeskSync, useFinanceImports } from '../../../hooks/useFinance'
import { useReportPageLoading } from '../../../hooks/usePageReady'
import InvoiceManager from '../InvoiceManager'
import DuesRunManager from '../DuesRunManager'
import DunningConsole from '../DunningConsole'
import TeamFinance from '../TeamFinance'
import ExpensesTab from '../ExpensesTab'
import FinanceMemberExplorer from '../FinanceMemberExplorer'
import { LedgerSection } from '../LedgerTab'
import BankTab from '../books/BankTab'
import ParallelTab from '../books/ParallelTab'
import YearEndTab from '../books/YearEndTab'
import SwitchTab from '../books/SwitchTab'
import { useAccountingFy } from './fyContext'

/* The accounting app's pages that reuse an existing finance component as is. Each
 * waits for the fiscal-year list first (until it lands the id is ''). */

function useFyPage() {
  const fy = useAccountingFy()
  useReportPageLoading(fy.loading)
  return fy
}

export function DuesPage() {
  const { fyId, fyLabel, loading } = useFyPage()
  return loading ? null : <DuesRunManager fiscalYearId={fyId} fiscalYearLabel={fyLabel} />
}
export function InvoicesPage() {
  const { fyId, fyLabel, loading } = useFyPage()
  return loading ? null : <InvoiceManager fiscalYearId={fyId} fiscalYearLabel={fyLabel} />
}
export function RemindersPage() { return <DunningConsole /> }
export function BankPage() {
  const { fyId, loading } = useFyPage()
  return loading ? null : <BankTab fiscalYearId={fyId} />
}
export function JournalPage() {
  const { fyId, loading } = useFyPage()
  return loading ? null : <LedgerSection section="journal" fiscalYearId={fyId} />
}
export function TrialBalancePage() {
  const { fyId, loading } = useFyPage()
  return loading ? null : <LedgerSection section="trial" fiscalYearId={fyId} />
}
/** Once a year, in order: close the old year, open the new one, the annual accounts, the archive. */
export function YearEndPage() {
  const { t } = useTranslation('finance')
  const { fyId, loading } = useFyPage()
  if (loading) return null
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t('ledClose')}</h2>
        <LedgerSection section="close" fiscalYearId={fyId} />
      </section>
      <YearEndTab fiscalYearId={fyId} />
    </div>
  )
}
export function MembersPage() { return <FinanceMemberExplorer /> }
export function TeamsPage() {
  const { fyId, fyLabel, loading } = useFyPage()
  return loading ? null : <TeamFinance fiscalYearId={fyId} fiscalYearLabel={fyLabel} />
}
export function ExpensesPage() { return <ExpensesTab /> }
export function ParallelPage() {
  const { fyId, loading } = useFyPage()
  return loading ? null : <ParallelTab fiscalYearId={fyId} />
}
export function SwitchPage() { return <SwitchTab /> }
export function ChartOfAccountsPage() { return <LedgerSection section="accounts" /> }
export function AutopostPage() { return <LedgerSection section="settings" /> }

/** ClubDesk mirror: when it last arrived, a "Sync now", and the import history. */
export function SyncPage() {
  const { t } = useTranslation('finance')
  const { data: imports, isLoading } = useFinanceImports()
  useReportPageLoading(isLoading)
  if (isLoading) return null
  const list = imports ?? []
  const importTypeLabel = (ty: string) => ty === 'invoices' ? t('typeInvoices') : ty === 'bookings' ? t('typeBookings') : ty
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-hairline bg-card p-4 shadow-card">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('lastSync')}</div>
        <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{list[0] ? formatDateTimeCompactZurich(list[0].imported_at) : '–'}</div>
        <div className="mt-1 text-xs text-muted-foreground">{t('autoSyncNote')}</div>
        <SyncNowButton />
      </div>
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t('noSyncs')}</div>
      ) : (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('syncHistory')}</h2>
          <div className="overflow-hidden rounded-2xl border border-hairline bg-card shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colWhen')}</TableHead>
                  <TableHead>{t('colType')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('colBy')}</TableHead>
                  <TableHead className="text-right">{t('colRows')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('colPeriod')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.slice(0, 50).map((im) => (
                  <TableRow key={im.id}>
                    <TableCell className="whitespace-nowrap text-foreground">{formatDateTimeCompactZurich(im.imported_at)}</TableCell>
                    <TableCell className="text-foreground/85">{importTypeLabel(im.import_type)}</TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-muted-foreground sm:table-cell">{im.imported_by_name || '–'}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{im.row_count ?? '–'}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{im.fiscal_year_label || '–'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  )
}

/** Requests a ClubDesk finance import and polls until the host dispatcher reports
 *  done/failed (state changes in the handler, not an effect). */
function SyncNowButton() {
  const { t } = useTranslation('finance')
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  // The polling loop must not set state after the page unmounts mid-poll.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  async function go() {
    setSyncing(true); setError('')
    try {
      await triggerClubdeskSync()
      const deadline = Date.now() + 240000
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000))
        if (!mountedRef.current) return
        const s = await fetchClubdeskSyncStatus()
        if (!mountedRef.current) return
        if (s.state === 'done') break
        if (s.state === 'failed') throw new Error(s.message || t('syncFailed'))
        if (Date.now() > deadline) throw new Error(t('syncTimeout'))
      }
      await qc.invalidateQueries({ queryKey: ['finance'] })
    } catch (e) {
      if (!mountedRef.current) return
      setError((e as { body?: { error?: string } })?.body?.error || (e as Error)?.message || t('syncFailed'))
    } finally { if (mountedRef.current) setSyncing(false) }
  }
  return (
    <div className="mt-3">
      <Button type="button" disabled={syncing} onClick={go}>
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{syncing ? t('syncing') : t('syncNow')}
      </Button>
      {syncing && <p className="mt-1.5 text-xs text-muted-foreground">{t('syncingNote')}</p>}
      {error && <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
