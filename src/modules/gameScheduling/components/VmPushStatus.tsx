import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../components/ui/dialog'
import { formatDateCompactZurich } from '../../../utils/dateHelpers'
import type { GameSchedulingBooking } from '../../../types'

interface Props {
  booking: GameSchedulingBooking
  onPush: (bookingId: string, svrzPersistenceId?: string) => Promise<void>
}

type Candidate = { id: string; label: string; date?: string | null }

// VolleyManager push status for a confirmed HOME game, with a manual retry and
// an ambiguous-fixture picker. Reflects booking.vm_push_status written back by
// scripts/vm-push-game.mjs.
const STYLES: Record<string, string> = {
  pushed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  pushed_no_hall: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  queued: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  needs_pick: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  no_fixture: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export default function VmPushStatus({ booking, onPush }: Props) {
  const { t } = useTranslation('gameScheduling')
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  const status = booking.vm_push_status || null

  const candidates: Candidate[] = (() => {
    if (status !== 'needs_pick' || !booking.vm_push_error) return []
    try {
      const parsed = JSON.parse(booking.vm_push_error) as { needs_pick?: Candidate[] }
      return Array.isArray(parsed?.needs_pick) ? parsed.needs_pick : []
    } catch { return [] }
  })()

  const push = async (svrzId?: string) => {
    setBusy(true)
    try { await onPush(booking.id, svrzId) } catch { /* toasted upstream */ } finally { setBusy(false); setPicking(false) }
  }

  const label = status ? t(`vmPush_${status}`) : t('vmPushNever')
  const canRetry = status === 'failed' || status === 'pushed' || status === 'pushed_no_hall' || status === 'no_fixture' || !status

  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status || ''] || 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
        title={status === 'failed' ? (booking.vm_push_error || undefined) : undefined}>
        {label}
      </span>

      {status === 'needs_pick' && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={busy} onClick={() => setPicking(true)}>
          {t('vmPushChoose')}
        </Button>
      )}
      {canRetry && (
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={busy} onClick={() => push()}>
          {status === 'pushed' || status === 'pushed_no_hall' ? t('vmPushRetry') : t('vmPushButton')}
        </Button>
      )}

      <Dialog open={picking} onOpenChange={(o) => { if (!o) setPicking(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('vmPickTitle')}</DialogTitle>
            <DialogDescription>{t('vmPickHint')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {candidates.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                onClick={() => push(c.id)}
                className="rounded-md border border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                <span className="font-medium">{c.label}</span>
                {c.date && <span className="ml-2 text-gray-500">{formatDateCompactZurich(c.date)}</span>}
              </button>
            ))}
            {candidates.length === 0 && <p className="text-sm text-gray-500">{t('vmPickNone')}</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
