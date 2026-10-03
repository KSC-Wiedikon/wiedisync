import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Car } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateCompact, formatWeekday } from '../../utils/dateHelpers'
import { useCarpoolUpcoming, type CarpoolActivityType, type CarpoolUpcoming } from './carpoolApi'
import CarpoolDialog from './CarpoolDialog'

/**
 * Home: the next three weeks' activities that have car pooling switched on and
 * concern the member (their teams' games and trainings, events they can see,
 * or anything they already have a ride on). Renders nothing when there are
 * none, so it costs no space until a coach switches a board on.
 */
export default function HomeCarpoolCard() {
  const { t } = useTranslation('carpool')
  const { data: rows = [] } = useCarpoolUpcoming()
  const [openFor, setOpenFor] = useState<{ type: CarpoolActivityType; id: number } | null>(null)

  if (rows.length === 0) return null

  const typeLabel = (r: CarpoolUpcoming) => t(r.type === 'game' ? 'typeGame' : r.type === 'training' ? 'typeTraining' : 'typeEvent')

  return (
    <div className="mb-6 lg:flex lg:flex-col lg:items-center">
      <div className="w-full overflow-hidden rounded-2xl border border-sky-200 bg-card shadow-card lg:max-w-2xl dark:border-sky-900">
        <div className="flex items-center gap-2 border-b border-sky-200 bg-sky-50/70 px-4 py-2.5 dark:border-sky-900 dark:bg-sky-950/30">
          <Car className="h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" />
          <h2 className="text-sm font-semibold text-foreground">{t('homeTitle')}</h2>
          <span className="ml-auto rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">
            {rows.length}
          </span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colActivity')}</TableHead>
              <TableHead className="text-center">{t('homeRides')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={`${r.type}-${r.id}`}
                onClick={() => setOpenFor({ type: r.type, id: r.id })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenFor({ type: r.type, id: r.id }) } }}
                tabIndex={0}
                role="button"
                className="cursor-pointer"
              >
                <TableCell className="min-h-[44px] whitespace-normal py-2.5">
                  <div className="text-sm font-medium text-foreground">{r.label || typeLabel(r)}</div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      typeLabel(r),
                      r.type === 'game' && r.team ? r.team : null,
                      r.date ? `${formatWeekday(r.date)}, ${formatDateCompact(r.date)}` : null,
                      r.time,
                    ].filter(Boolean).join(' · ')}
                  </div>
                  {r.my_role && (
                    <span className="mt-1 inline-block rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-sky-500 dark:text-sky-950">
                      {t(`role_${r.my_role}`)}
                    </span>
                  )}
                </TableCell>
                <TableCell className="py-2.5 text-center">
                  <div className="text-sm font-semibold tabular-nums text-foreground">{r.offers}</div>
                  <div className="text-[11px] text-muted-foreground">{t('freeSeats', { count: r.seats_free })}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {openFor && (
        <CarpoolDialog type={openFor.type} id={openFor.id} open onOpenChange={(o) => { if (!o) setOpenFor(null) }} />
      )}
    </div>
  )
}
