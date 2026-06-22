import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNowStrict } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useReports } from '../messaging/hooks/useReports'
import { useReportPageLoading } from '../../hooks/usePageReady'
import type { ReportRow } from '../messaging/api/types'

type Tab = 'open' | 'resolved' | 'dismissed'

export default function AdminReportsPage() {
  const { t } = useTranslation('messaging')
  const { reports, openCount, resolve, dismiss, resolveWithDelete, resolveWithBan, isLoading } = useReports()
  const [tab, setTab] = useState<Tab>('open')

  // Report to the app boot gate — see usePageReady.tsx
  useReportPageLoading(isLoading)

  const filtered = useMemo(() => reports.filter(r => r.status === tab), [reports, tab])

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-lg font-semibold text-foreground mb-4">{t('adminReportsTitle')}</h1>
      <div role="tablist" className="flex gap-2 mb-4 border-b border-border">
        {(['open', 'resolved', 'dismissed'] as Tab[]).map(key => (
          <button
            key={key} role="tab" aria-selected={tab === key}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab(key)}
          >
            {t(`adminReportsTab_${key}`)}
            {key === 'open' && openCount > 0 && (
              <span className="ml-1 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 min-w-[18px]">
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">{t('loading')}</p>}
      {!isLoading && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">{t('adminReportsEmpty')}</p>
      )}
      {!isLoading && filtered.length > 0 && (
        <div className="rounded-lg border border-border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">{t('adminReportsColParties')}</TableHead>
                <TableHead className="hidden sm:table-cell text-muted-foreground">{t('adminReportsColReason')}</TableHead>
                <TableHead className="hidden md:table-cell text-muted-foreground">{t('adminReportsColWhen')}</TableHead>
                {tab === 'open' && <TableHead className="text-right text-muted-foreground">{t('adminReportsColActions')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <ReportRowItem
                  key={r.id} report={r} showActions={tab === 'open'}
                  onResolve={() => resolve(r.id)}
                  onDismiss={() => dismiss(r.id)}
                  onResolveWithDelete={() => resolveWithDelete(r.id)}
                  onResolveWithBan={() => resolveWithBan(r.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function ReportRowItem(props: {
  report: ReportRow
  showActions: boolean
  onResolve: () => void
  onDismiss: () => void
  onResolveWithDelete: () => void
  onResolveWithBan: () => void
}) {
  const { t } = useTranslation('messaging')
  const r = props.report
  const rel = formatDistanceToNowStrict(new Date(r.created_at), { addSuffix: true })
  return (
    <TableRow className="align-top">
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium text-foreground">{r.reporter_name ?? '—'}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium text-foreground">{r.reported_name ?? '—'}</span>
        </div>
        <div className="sm:hidden mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-block rounded bg-muted px-2 py-0.5">{t(`reportReason_${r.reason}`)}</span>
          <span className="text-muted-foreground">{rel}</span>
        </div>
        {r.note && <p className="mt-1 text-xs text-foreground">{r.note}</p>}
        {r.message_snapshot && (
          <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-xs text-muted-foreground italic">
            {r.message_snapshot}
          </blockquote>
        )}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <span className="inline-block rounded bg-muted px-2 py-0.5 text-xs">{t(`reportReason_${r.reason}`)}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell text-xs text-muted-foreground whitespace-nowrap">{rel}</TableCell>
      {props.showActions && (
        <TableCell className="text-right">
          <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button size="sm" variant="outline" onClick={props.onResolve}>{t('adminResolve')}</Button>
            <Button size="sm" variant="outline" onClick={props.onResolveWithDelete}>{t('adminResolveDelete')}</Button>
            <Button size="sm" variant="destructive" onClick={props.onResolveWithBan}>{t('adminResolveBan')}</Button>
            <Button size="sm" variant="ghost" onClick={props.onDismiss}>{t('adminDismiss')}</Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  )
}
