import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarOff, Plus, Trash2, Loader2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { kscwApi } from '../../../lib/api'
import { formatDateZurich } from '../../../utils/dateHelpers'
import { useConfirm } from '../../../components/ConfirmProvider'

interface ClubBlock {
  id: number
  start_date: string
  end_date: string
  reason: string | null
}

/**
 * Superadmin-only club-wide "blocked dates" (blackout). Blocking a date range stops
 * HOME games for EVERY team on those days — club holidays, AGM, tournaments. Layers
 * on top of the per-team blocks coaches set in the Absences view. Backed by
 * /terminplanung/admin/club-blocked-dates (POST/DELETE are superadmin-gated).
 */
export default function ClubBlockedDatesPanel() {
  const { t } = useTranslation('gameScheduling')
  const confirm = useConfirm()
  const [blocks, setBlocks] = useState<ClubBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  // Manual refresh used by the add/remove handlers (event handlers — allowed to setState).
  const load = useCallback(async () => {
    try {
      const { blocks } = await kscwApi<{ blocks: ClubBlock[] }>('/terminplanung/admin/club-blocked-dates')
      setBlocks(blocks || [])
    } catch {
      /* leave the list as-is on a transient error */
    }
  }, [])

  // Initial load — setState only in async callbacks, never synchronously in the effect body.
  useEffect(() => {
    let alive = true
    kscwApi<{ blocks: ClubBlock[] }>('/terminplanung/admin/club-blocked-dates')
      .then(({ blocks }) => { if (alive) setBlocks(blocks || []) })
      .catch(() => { /* transient */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const add = useCallback(async () => {
    if (!start) return
    setSaving(true)
    try {
      await kscwApi('/terminplanung/admin/club-blocked-dates', {
        method: 'POST',
        body: { start_date: start, end_date: end || start, reason: reason.trim() || undefined },
      })
      setStart(''); setEnd(''); setReason('')
      toast.success(t('clubBlockAdded'))
      await load()
    } catch (e) {
      toast.error((e as { body?: { error?: string } })?.body?.error || t('clubBlockError'))
    } finally {
      setSaving(false)
    }
  }, [start, end, reason, t, load])

  const remove = useCallback(async (b: ClubBlock) => {
    const ok = await confirm({ message: t('clubBlockRemoveConfirm'), danger: true })
    if (!ok) return
    try {
      await kscwApi(`/terminplanung/admin/club-blocked-dates/${b.id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      toast.error((e as { body?: { error?: string } })?.body?.error || t('clubBlockError'))
    }
  }, [confirm, t, load])

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-1 flex items-center gap-2">
        <CalendarOff className="h-5 w-5 text-gray-500 dark:text-gray-400" />
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('clubBlockTitle')}</h2>
      </div>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">{t('clubBlockDescription')}</p>

      {/* Add form — dates on one row, reason + button below (fits a half-width card) */}
      <div className="mb-4 space-y-2">
        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col text-xs text-gray-500 dark:text-gray-400 sm:max-w-[10rem]">
            {t('clubBlockFrom')}
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
          </label>
          <label className="flex min-w-0 flex-1 flex-col text-xs text-gray-500 dark:text-gray-400 sm:max-w-[10rem]">
            {t('clubBlockTo')}
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}
              className="mt-0.5 w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
          </label>
        </div>
        <div className="flex gap-2">
          <input type="text" value={reason} maxLength={120} placeholder={t('clubBlockReasonPlaceholder')}
            onChange={(e) => setReason(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
          <Button type="button" size="sm" onClick={add} disabled={!start || saving} className="shrink-0 gap-1.5">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('clubBlockAdd')}
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>
      ) : blocks.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">{t('clubBlockEmpty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('clubBlockColDates')}</TableHead>
              <TableHead>{t('clubBlockColReason')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {blocks.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="whitespace-normal break-words font-medium tabular-nums">
                  {b.start_date === b.end_date
                    ? formatDateZurich(b.start_date)
                    : `${formatDateZurich(b.start_date)} – ${formatDateZurich(b.end_date)}`}
                </TableCell>
                <TableCell className="whitespace-normal break-words text-gray-500 dark:text-gray-400">{b.reason || '–'}</TableCell>
                <TableCell>
                  <button type="button" onClick={() => remove(b)} title={t('clubBlockRemove')}
                    className="text-gray-400 hover:text-red-600 dark:hover:text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
