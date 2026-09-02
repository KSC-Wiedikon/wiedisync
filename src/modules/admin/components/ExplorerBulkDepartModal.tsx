// src/modules/admin/components/ExplorerBulkDepartModal.tsx
//
// "Mark as departed" for every member selected in the Data Explorer grid.
//
// Its own action rather than a field in the bulk-edit modal, because departing
// the club is never one column. What it writes lives in departMember.ts, shared
// with the single-member button in the danger zone (MemberDepartModal) so the
// two surfaces cannot answer differently — four `members` columns plus the
// member's roster rows on ACTIVE teams.
//
// ⚠ The two active flags are danger-zone fields everywhere else in the explorer.
// Writing them here is the same deliberate exception the single-member save
// makes (ExplorerMemberFields.handleSave), and for the same reason: they are not
// a separate decision from the status, they are what the status MEANS.
//
// ⚠ `affected` tests the four COLUMNS only. A member whose columns already match
// is skipped entirely, so a stale roster row on somebody departed long ago is
// not swept up here — bulk cannot afford a roster read per selected member. The
// single-member dialog counts rosters and does catch that case.
//
// ⚠ `register_status` and `austritt` are pushed into the club's LEGAL member
// register by the next approved sync-up. This action therefore ends with a
// confirm that names the count — it is the most consequential thing this page
// can do to a hundred rows at once.

import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import DatePicker from '@/components/ui/DatePicker'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { Member } from '../../../types'
import { todayLocal } from '../../../utils/dateHelpers'
import { useConfirm } from '../../../components/ConfirmProvider'
import {
  DEPARTED_ORDERED, alreadyDeparted, buildDepartPatch, departMember, fetchActiveTeamIds,
} from './departMember'
import { runBulk, type BulkRunSummary } from './bulkEdit'
import type { CacheShape } from './explorerHelpers'

interface Props {
  open: boolean
  onClose: () => void
  members: Member[]
  onMutate: (fn: (prev: CacheShape) => CacheShape) => void
  onApplied: () => void
}

function memberName(m: Member): string {
  return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || String(m.id)
}

export default function ExplorerBulkDepartModal({ open, onClose, members, onMutate, onApplied }: Props) {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()

  const [status, setStatus] = useState<string>(DEPARTED_ORDERED[0] ?? 'Ehemaliges Mitglied')
  const [exitDate, setExitDate] = useState<string>(() => todayLocal())
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<BulkRunSummary | null>(null)
  const cancelledRef = useRef(false)

  /**
   * Members this would actually change.
   *
   * All four columns are in the explorer cache's own field list, so unlike the
   * generic bulk edit this needs no extra read — `register_status` and the two
   * active flags are fetched for every row the grid shows. `austritt` is too,
   * which is what makes the "already departed on this date" skip honest.
   */
  const affected = useMemo(() => {
    const patch = buildDepartPatch(status, exitDate)
    return members.filter((m) => !alreadyDeparted(m as unknown as Record<string, unknown>, patch))
  }, [members, status, exitDate])

  const handleApply = useCallback(async () => {
    const targets = affected
    if (targets.length === 0 || !exitDate) return

    const ok = await confirm({
      title: t('explorerBulkDepartConfirmTitle'),
      message: t('explorerBulkDepartConfirmMessage', {
        count: targets.length,
        status,
        date: exitDate.split('-').reverse().join('.'),
      }),
      danger: true,
    })
    if (!ok) return

    cancelledRef.current = false
    setRunning(true)
    setProgress({ done: 0, total: targets.length })
    setSummary(null)

    // The active-team list is read ONCE for the whole run — a departure over 120
    // people must not re-read it 120 times. A failure here aborts before
    // anything is written: the roster drop is half of what "departed" means, and
    // silently skipping it across a bulk run is not inspectable afterwards.
    let activeTeamIds: string[]
    try {
      activeTeamIds = await fetchActiveTeamIds()
    } catch {
      setRunning(false)
      setProgress(null)
      toast.error(t('explorerDepartRostersUnavailable'))
      return
    }

    // One payload for everybody: unlike a field edit, every column here is the
    // same decision applied to the whole selection, and the two active flags are
    // written unconditionally rather than "only if still on" — a member already
    // switched off takes the same value and the write is idempotent.
    const patch = buildDepartPatch(status, exitDate)

    const result = await runBulk(
      targets,
      async (member): Promise<'changed'> => {
        const id = String(member.id)
        await departMember(id, patch, activeTeamIds)
        onMutate((prev) => ({
          ...prev,
          members: prev.members.map((m) => (String(m.id) === id ? { ...m, ...patch } : m)),
        }))
        return 'changed'
      },
      {
        idOf: (m) => String(m.id),
        labelOf: memberName,
        concurrency: 4,
        onProgress: (done, total) => setProgress({ done, total }),
        isCancelled: () => cancelledRef.current,
      },
    )

    setRunning(false)
    setProgress(null)
    setSummary(result)
    if (result.changed.length > 0) {
      toast.success(t('explorerBulkDepartApplied', { count: result.changed.length }))
      onApplied()
    }
    if (result.failed.length > 0) toast.error(t('explorerBulkFailed', { count: result.failed.length }))
  }, [affected, exitDate, status, confirm, t, onMutate, onApplied])

  return (
    <Modal
      open={open}
      onClose={running ? () => { /* a run in flight must finish */ } : onClose}
      title={t('explorerBulkDepartTitle', { count: members.length })}
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            {t('explorerBulkDepartWarning')}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-muted-foreground">
            {t('explorerBulkSelected', { count: members.length })}
          </p>
          <p className="mt-1 text-sm text-foreground">
            {members.slice(0, 8).map(memberName).join(', ')}
            {members.length > 8 ? t('explorerBulkAndMore', { count: members.length - 8 }) : ''}
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">{t('explorerBulkDepartStatus')}</label>
          <Select value={status} onValueChange={setStatus} disabled={running}>
            <SelectTrigger className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPARTED_ORDERED.map((v) => (
                <SelectItem key={v} value={v}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">{t('explorerBulkDepartDate')}</label>
          <DatePicker value={exitDate} onChange={(v) => setExitDate(v || '')} disabled={running} />
          <p className="text-xs text-muted-foreground">{t('explorerBulkDepartDateHint')}</p>
        </div>

        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          {running ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('explorerBulkRunning', { done: progress?.done ?? 0, total: progress?.total ?? members.length })}
            </p>
          ) : (
            <p className="text-foreground">
              {t('explorerBulkPreview', { changed: affected.length, total: members.length })}
              {affected.length < members.length && (
                <span className="text-muted-foreground">
                  {' '}
                  {t('explorerBulkPreviewSkipped', { count: members.length - affected.length })}
                </span>
              )}
            </p>
          )}
        </div>

        {summary && summary.failed.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive">
              {t('explorerBulkFailed', { count: summary.failed.length })}
            </p>
            <ul className="mt-2 space-y-1 text-xs text-destructive">
              {summary.failed.slice(0, 10).map((f) => (
                <li key={f.id}><span className="font-medium">{f.label}</span> — {f.error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={running} className="min-h-[44px]">
            {t('explorerBulkClose')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleApply}
            disabled={running || affected.length === 0 || !exitDate}
            className="min-h-[44px]"
          >
            {running && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t('explorerBulkDepartApply', { count: affected.length })}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
