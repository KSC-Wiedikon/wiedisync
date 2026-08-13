// src/modules/admin/components/LastBillCell.tsx
//
// The "last bill" column, shared by every table on the merged Data Health page.
//
// ⚠ It reports the most recent invoice from EVERY source, not just the ClubDesk
// mirror. Dues are mid-migration off ClubDesk onto native wiedisync invoices, so a
// source filter would show a freshly-billed member as "never billed" the moment
// their invoice is issued here instead of there — the exact failure the column
// exists to catch.
//
// "Never billed" is a real finding, not an empty cell: on the rows this column
// appears next to (billed as a player with no roster, in a group with no team) the
// interesting member is usually the one with no invoice at all.

import { useTranslation } from 'react-i18next'
import { formatDateZurich } from '../../../utils/dateHelpers'
import type { LastBill } from '../utils/clubdeskFindings'

/** CHF with no decimals — dues are whole francs and the column is narrow. */
function chf(n: number): string {
  return new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 }).format(n)
}

/** Is there money still owed on this invoice? */
function isOpen(bill: LastBill): boolean {
  return typeof bill.open === 'number' && bill.open > 0
}

export default function LastBillCell({ bill }: { bill: LastBill | null }) {
  const { t } = useTranslation('admin')
  if (!bill || !bill.date) {
    return (
      <span className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
        {t('cdBillNever')}
      </span>
    )
  }
  const open = isOpen(bill)
  return (
    <span className="text-xs" title={bill.number ? `${bill.number}${bill.source ? ` · ${bill.source}` : ''}` : undefined}>
      <span className="whitespace-nowrap text-foreground">{formatDateZurich(bill.date)}</span>
      <span className="mx-1 text-muted-foreground" aria-hidden="true">·</span>
      <span
        className={
          'whitespace-nowrap rounded px-1.5 py-0.5 font-medium '
          + (open
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300')
        }
      >
        {open
          ? t('cdBillOpen', { amount: chf(bill.open as number) })
          : (bill.status || t('cdBillSettled'))}
      </span>
    </span>
  )
}
