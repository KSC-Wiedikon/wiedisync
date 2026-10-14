// Year tab of the parallel books: the opening balance (taken from ClubDesk's own
// Eröffnung), the annual accounts as PDF, and the yearly archive kept 10 years.
// The year-end close itself lives in Books → Ledger → Close.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, Download, FileText, Loader2, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilePreviewDialog } from '../../../components/FilePreview'
import { useConfirm } from '../../../components/ConfirmProvider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { formatDateCompactZurich, formatDateTimeCompactZurich } from '../../../utils/dateHelpers'
import { useAuth } from '../../../hooks/useAuth'
import { formatChf, toNum } from '../../../hooks/useFinance'
import {
  useOpening, postOpening, useArchives, createArchive, archiveFileUrl, annualAccountsPdfUrl, downloadAuthenticated,
} from '../../../hooks/useFinanceBooks'

const apiErr = (e: unknown, fb: string) => (e as { body?: { error?: string } })?.body?.error || fb
const selectCls = 'h-11 rounded-lg border border-input bg-card px-3 text-sm sm:h-9 dark:bg-gray-800 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const card = 'space-y-3 rounded-2xl border border-hairline bg-card p-4 shadow-card'
const mb = (n: unknown) => `${(toNum(n) / 1024 / 1024).toFixed(1)} MB`

export default function YearEndTab({ fiscalYearId }: { fiscalYearId?: string | number | null }) {
  const { t } = useTranslation('finance')
  return (
    <div className="space-y-4">
      <OpeningBalance fiscalYearId={fiscalYearId} />
      <AnnualAccounts fiscalYearId={fiscalYearId} />
      <Archives fiscalYearId={fiscalYearId} />
      <p className="text-xs text-muted-foreground">{t('bkCloseWhere')}</p>
    </div>
  )
}

function OpeningBalance({ fiscalYearId }: { fiscalYearId?: string | number | null }) {
  const { t } = useTranslation('finance')
  const { canAccessFinance: canWrite } = useAuth()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const { data, isLoading } = useOpening(fiscalYearId)
  const [clearing, setClearing] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const suggested = useMemo(() => {
    if (!data) return ''
    if (data.opening_account) return data.opening_account
    return data.clearing_candidates.find((c) => /er.ffnung|opening/i.test(c.name))?.id ?? ''
  }, [data])
  const chosen = clearing || suggested

  async function post() {
    if (!data || !chosen) return
    if (!(await confirm({ message: t('bkOpeningSure', { year: data.fiscal_year.label, total: formatChf(data.proposal.debit) }) }))) return
    setBusy(true)
    try {
      const r = await postOpening(data.fiscal_year.id, Number(chosen))
      toast.success(t('bkOpeningPosted', { count: r.posted }))
      qc.invalidateQueries({ queryKey: ['finance'] })
    } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(false) }
  }

  return (
    <section className={card}>
      <h3 className="text-sm font-semibold text-foreground"><Scale className="mr-1 inline h-4 w-4" />{t('bkOpening')}</h3>
      <p className="text-xs text-muted-foreground">{t('bkOpeningIntro')}</p>
      {isLoading || !data ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : !data.proposal.legs.length ? (
        <p className="text-sm text-muted-foreground">{t('bkOpeningNone', { year: data.fiscal_year.label })}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-hairline">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colAccount')}</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">{t('colDebit')}</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">{t('colCredit')}</TableHead>
                  <TableHead className="text-right sm:hidden">{t('colAmount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.proposal.legs.map((l) => (
                  <TableRow key={`${l.account}-${l.side}`}>
                    <TableCell className="whitespace-normal break-words text-foreground"><span className="tabular-nums text-muted-foreground">{l.number}</span> {l.name}</TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-right tabular-nums text-foreground">{l.side === 'debit' ? formatChf(l.amount) : ''}</TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap text-right tabular-nums text-foreground">{l.side === 'credit' ? formatChf(l.amount) : ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-foreground sm:hidden">
                      {formatChf(l.amount)}
                      <span className="block text-[11px] text-muted-foreground">{l.side === 'debit' ? t('colDebit') : t('colCredit')}</span>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-input font-semibold">
                  <TableCell className="text-foreground">{t('bkTotal')}</TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap text-right tabular-nums text-foreground">{formatChf(data.proposal.debit)}</TableCell>
                  <TableCell className="hidden sm:table-cell whitespace-nowrap text-right tabular-nums text-foreground">{formatChf(data.proposal.credit)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-foreground sm:hidden">
                    {t('colDebit')} {formatChf(data.proposal.debit)}
                    <span className="block">{t('colCredit')} {formatChf(data.proposal.credit)}</span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {!data.proposal.balanced && <p className="text-sm text-red-600 dark:text-red-400">{t('bkOpeningUnbalanced')}</p>}
          {data.native_posted ? (
            <p className="text-sm text-green-700 dark:text-green-400">{t('bkOpeningDone', { year: data.fiscal_year.label })}</p>
          ) : canWrite && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('bkOpeningAccount')}
                <select className={`${selectCls} mt-1 block`} value={chosen} onChange={(e) => setClearing(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">{t('bkChooseAccount')}</option>
                  {data.clearing_candidates.map((c) => <option key={c.id} value={c.id}>{c.number} {c.name}</option>)}
                </select>
              </label>
              <Button type="button" disabled={busy || !chosen || !data.proposal.balanced} onClick={post} icon={busy ? <Loader2 className="animate-spin" /> : undefined}>
                {t('bkOpeningPost')}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function AnnualAccounts({ fiscalYearId }: { fiscalYearId?: string | number | null }) {
  const { t } = useTranslation('finance')
  const [book, setBook] = useState<'native' | 'clubdesk' | null>(null)
  if (!fiscalYearId) return null
  return (
    <section className={card}>
      <h3 className="text-sm font-semibold text-foreground"><FileText className="mr-1 inline h-4 w-4" />{t('bkAnnual')}</h3>
      <p className="text-xs text-muted-foreground">{t('bkAnnualIntro')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setBook('native')}>{t('bkBookNative')}</Button>
        <Button type="button" variant="outline" onClick={() => setBook('clubdesk')}>{t('bkBookClubdesk')}</Button>
      </div>
      <FilePreviewDialog
        open={!!book}
        onOpenChange={(o) => { if (!o) setBook(null) }}
        url={book ? annualAccountsPdfUrl(fiscalYearId, book) : null}
        label={t('bkAnnual')}
        filename={`jahresrechnung_${book ?? ''}.pdf`}
      />
    </section>
  )
}

function Archives({ fiscalYearId }: { fiscalYearId?: string | number | null }) {
  const { t } = useTranslation('finance')
  const { canAccessFinance: canWrite } = useAuth()
  const qc = useQueryClient()
  const { data: archives, isLoading } = useArchives(fiscalYearId, !!fiscalYearId)
  const [busy, setBusy] = useState(false)
  async function create() {
    setBusy(true)
    try {
      const r = await createArchive(Number(fiscalYearId))
      const changed = (r.contents?.documents_changed as string[] | undefined) ?? []
      toast.success(t('bkArchiveCreated'))
      if (changed.length) toast.error(t('bkArchiveChanged', { count: changed.length }))
      qc.invalidateQueries({ queryKey: ['finance'] })
    } catch (e) { toast.error(apiErr(e, t('ledActionError'))) } finally { setBusy(false) }
  }
  const offsiteText = (o: Record<string, string> | null, at: string | null) => {
    if (at) return t('bkOffsiteDone', { date: formatDateCompactZurich(at) })
    if (!o) return t('bkOffsitePending')
    if (o.error) return t('bkOffsiteError')
    return ['gdrive', 'r2', 'nas'].map((k) => `${k === 'gdrive' ? 'Drive' : k.toUpperCase()} ${o[k] === 'ok' ? '✓' : '✗'}`).join(' · ')
  }
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground"><Archive className="mr-1 inline h-4 w-4" />{t('bkArchive')}</h3>
        {canWrite && fiscalYearId && (
          <Button type="button" size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={create} icon={busy ? <Loader2 className="animate-spin" /> : <Archive />}>{t('bkArchiveCreate')}</Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('bkArchiveIntro')}</p>
      {isLoading ? null : !archives?.length ? (
        <p className="text-sm text-muted-foreground">{t('bkArchiveNone')}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-hairline">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ledColDate')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('bkArchiveSize')}</TableHead>
                <TableHead>{t('bkArchiveOffsite')}</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archives.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-foreground">{formatDateTimeCompactZurich(a.date_created)}
                    <span className="block text-[11px] text-muted-foreground">{a.created_by_name}</span></TableCell>
                  <TableCell className="hidden sm:table-cell tabular-nums text-muted-foreground">{mb(a.size_bytes)}</TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">{offsiteText(a.offsite, a.offsite_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="ghost" icon={<Download />}
                      onClick={() => downloadAuthenticated(archiveFileUrl(a.id), `kscw_finanzarchiv_${(a.fiscal_year_label || '').replace(/\W+/g, '-')}_${a.id}.zip`).catch((e) => toast.error((e as Error).message))}>
                      <span className="hidden sm:inline">{t('bkDownload')}</span>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
