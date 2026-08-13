// src/modules/admin/components/ClubdeskNeedsSync.tsx
//
// "Who is out of step with ClubDesk since the last sync." The per-member verdict
// already existed (/clubdesk-sync-status) but only ever answered "what is member
// X's state" for the Data Explorer grid, which means nobody could see the LIST.
//
// `in_sync` and `excluded` are deliberately absent — this is a worklist. Their
// counts are shown anyway, so an empty table reads as "everyone is in step"
// rather than "the check stopped looking" (the false all-clear that let a 401
// print "✓ 0/80 mismatches" during the 2026-07-16 hall audit).

import { useTranslation } from 'react-i18next'
import { Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { toXlsx, downloadBlob } from '../utils/exportResults'
import LastBillCell from './LastBillCell'
import { lastBillExport, type LastBill } from '../utils/clubdeskFindings'

export type SyncStatus = 'not_linked' | 'stale' | 'departed' | 'pending' | 'drift'

export interface NeedsSyncRow {
  member_id: number
  member_name: string
  clubdesk_id: string
  status: SyncStatus
  sport: 'volleyball' | 'basketball' | 'both'
  sport_source: 'teams' | 'sektion' | 'fee' | 'unknown'
  last_bill: LastBill | null
}

/** Red = the link itself is broken or the person has left; amber = a push is owed. */
const TONE: Record<SyncStatus, string> = {
  not_linked: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  stale: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  departed: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  drift: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
}

// Presentational — the page owns the fetch and the single Rescan button in the
// header, so this card deliberately has no refresh of its own.
export default function ClubdeskNeedsSync({
  rows, inSync, lastDown, lastUp, loading,
}: {
  rows: NeedsSyncRow[]
  inSync: number
  lastDown: string | null
  lastUp: string | null
  loading: boolean
}) {
  const { t, i18n } = useTranslation('admin')

  // Exports are always English regardless of UI locale.
  const handleExport = async () => {
    try {
      const tEn = i18n.getFixedT('en', 'admin')
      const columns = ['Member ID', 'Name', 'Sport', 'Status', 'ClubDesk ID', 'Last bill', 'Bill status', 'Open amount']
      const body = rows.map((r) => [
        String(r.member_id), r.member_name,
        r.sport_source === 'unknown' ? 'Unassigned' : r.sport,
        tEn(`cdSyncStatus_${r.status}`),
        r.clubdesk_id,
        ...lastBillExport(r.last_bill),
      ])
      const blob = await toXlsx(columns, body)
      downloadBlob(blob, `clubdesk_needs_sync_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch {
      toast.error(t('dhExportFailed'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4" />{t('cdNeedsSyncTitle')}
            </CardTitle>
            <CardDescription>
              {t('cdNeedsSyncDescription')}
              {' '}
              <span className="whitespace-nowrap">
                {t('cdNeedsSyncLastDown', { time: lastDown ? formatDateZurich(lastDown) : '—' })}
                {' · '}
                {t('cdNeedsSyncLastUp', { time: lastUp ? formatDateZurich(lastUp) : '—' })}
              </span>
            </CardDescription>
          </div>
          <Button
            type="button" variant="outline" size="sm"
            onClick={() => { void handleExport() }}
            disabled={loading || rows.length === 0}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />{t('explorerGridExport')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          // The in-sync tally is the point: "0 rows" alone is indistinguishable
          // from a check that never ran.
          <p className="py-2 text-sm text-emerald-600 dark:text-emerald-400">
            {t('cdNeedsSyncAllGood', { count: inSync })}
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('clubdeskGroupColName')}</TableHead>
                  <TableHead>{t('cdSyncColStatus')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('clubdeskGroupColClubdeskId')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('cdColLastBill')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.member_id} className="min-h-11">
                    <TableCell className="whitespace-normal break-words font-medium">{r.member_name}</TableCell>
                    <TableCell className="whitespace-normal break-words">
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${TONE[r.status]}`}>
                        {t(`cdSyncStatus_${r.status}`)}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {t(`cdSyncHint_${r.status}`)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">
                      {r.clubdesk_id || '—'}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words md:table-cell">
                      <LastBillCell bill={r.last_bill} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
