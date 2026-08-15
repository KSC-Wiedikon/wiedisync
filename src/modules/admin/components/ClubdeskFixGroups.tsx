// src/modules/admin/components/ClubdeskFixGroups.tsx
//
// "Fix groups" — the one button that WRITES ClubDesk group allocations from the app.
//
// ClubDesk has no API and its CSV import treats `Gruppen` as a no-op, so the only
// way to set an allocation is to drive the real UI. Two proven Playwright tools do
// that on the VPS (clubdesk-scrape-groups.mjs = add, clubdesk-remove-group.mjs =
// remove); Directus runs in a container and cannot launch either, so this button
// queues a job and polls, exactly like the sync-down button.
//
// ⚠ THE WORKLIST IS NEVER SENT FROM HERE. This posts only which CLASSES of finding
// to act on; the server recomputes every row from the same SQL that produced the
// on-screen findings. A client-supplied worklist would turn this component into an
// arbitrary write channel into the club's LEGAL member register.
//
// ⚠ TWO-STEP BY DESIGN. Preview drives every UI step and then cancels (no write);
// only after a preview succeeds does the server accept a commit, and the operator
// has to click again with the per-row outcome in front of them. The 2026-07-16
// incident — 29 DU20 girls stripped out of ClubDesk by a bad departure test — is
// why nothing here is one-click.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, Loader2, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kscwApi } from '../../../lib/api'
import { useConfirm } from '../../../components/ConfirmProvider'
import { FIX_CLASSES, type FixClass } from '../utils/clubdeskFindings'

type JobState = 'idle' | 'queued' | 'running' | 'done' | 'failed'
const BUSY: JobState[] = ['queued', 'running']

interface ScrapeRow {
  name?: string
  group?: string
  funktion?: string
  group_label?: string
  status?: string
  detail?: string
}
interface ScrapeSummary {
  mode?: string
  count?: number
  tally?: Record<string, number>
  results?: ScrapeRow[]
}
interface FixStatus {
  state: JobState
  message: string | null
  mode: 'preview' | 'commit' | null
  finished_at: string | null
  requested_by: string | null
  counts: { add: number; remove: number } | null
  result: { mode?: string; add: ScrapeSummary | null; remove: ScrapeSummary | null } | null
  down_state: JobState
  up_state: JobState
}

/** Statuses the scrapers report for a row that did NOT do what was asked. */
const OK_STATUSES = new Set(['assigned', 'previewed', 'removed', 'preview_ok'])

interface Props {
  /** Findings counts per class, so the dialog can say what it is about to touch. */
  available: Record<FixClass, number>
  /** Re-run the page's checks once a commit settles. */
  onDone?: () => void | Promise<void>
  /**
   * Optional external open control, so the sync path can hand the user straight
   * into this dialog at its last step. Uncontrolled (own button) when omitted —
   * which is how it is still mounted in the ClubDesk actions bar.
   */
  open?: boolean
  onOpenChange?: (v: boolean) => void
  /** Hide the component's own trigger when something else opens it. */
  hideTrigger?: boolean
}

export default function ClubdeskFixGroups({ available, onDone, open: openProp, onOpenChange, hideTrigger }: Props) {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()
  const [openSelf, setOpenSelf] = useState(false)
  const open = openProp ?? openSelf
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v)
    else setOpenSelf(v)
  }
  const [status, setStatus] = useState<FixStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [classes, setClasses] = useState<Set<FixClass>>(new Set(FIX_CLASSES))
  // Held in a ref so the poller can fire onDone exactly once per finished commit
  // without re-subscribing the interval on every status change.
  const lastFinished = useRef<string | null>(null)

  const poll = useCallback(async () => {
    try {
      const s = await kscwApi<FixStatus>('/clubdesk-group-fix')
      setStatus(s)
      return s
    } catch {
      // Not a superadmin, or transient — leave the button in its last known state.
      return null
    }
  }, [])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const s = await poll()
      if (!alive || !s) return
      // Refresh the page's findings when a COMMIT lands: the rows it fixed should
      // disappear. A preview changes nothing, so it must not trigger a rescan.
      if (s.state === 'done' && s.mode === 'commit' && s.finished_at
        && s.finished_at !== lastFinished.current) {
        lastFinished.current = s.finished_at
        void onDone?.()
      }
    }
    void tick()
    const id = setInterval(() => { void tick() }, 10_000)
    return () => { alive = false; clearInterval(id) }
  }, [poll, onDone])

  const busy = BUSY.includes(status?.state as JobState)
  const blockedBy = BUSY.includes(status?.down_state as JobState)
    ? 'down'
    : BUSY.includes(status?.up_state as JobState) ? 'up' : null
  const totalAvailable = FIX_CLASSES.reduce((n, c) => n + (available[c] || 0), 0)
  // A commit is only offered once a preview of the *current* job succeeded — the
  // server enforces this too (code 'preview_required'); this just makes it visible.
  const canCommit = status?.state === 'done' && status.mode === 'preview' && !!status.result

  const toggleClass = (c: FixClass) => {
    setClasses((prev) => {
      const n = new Set(prev)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })
  }

  // Flatten both scrapers' per-row results into one reviewable table. `kind` keeps
  // an add and a removal of the same group on the same member distinguishable.
  const resultRows: (ScrapeRow & { kind: 'add' | 'remove' })[] = [
    ...(status?.result?.remove?.results || []).map((r) => ({ ...r, kind: 'remove' as const })),
    ...(status?.result?.add?.results || []).map((r) => ({ ...r, kind: 'add' as const })),
  ]
  const failedRows = resultRows.filter((r) => !OK_STATUSES.has(r.status || ''))

  async function run(mode: 'preview' | 'commit') {
    if (mode === 'commit') {
      // ⚠ `counts` is null on a FINISHED job: the host dispatcher nulls
      // grp_worklist on write-back (it carries names + uuids), so the column the
      // endpoint counts is gone by the time a commit is offered — which made this
      // dialog say "0 changes" over a table of 6. Fall back to the previewed rows,
      // which are what the operator is actually approving. Either way the number
      // is an ESTIMATE: the server recomputes the worklist from the current
      // findings at queue time and never trusts a client-supplied one.
      const n = status?.counts
        ? status.counts.add + status.counts.remove
        : resultRows.length
      const ok = await confirm({
        message: t('cdFixConfirmCommit', { count: n }),
        danger: true,
      })
      if (!ok) return
    }
    setSubmitting(true)
    try {
      await kscwApi('/clubdesk-group-fix', {
        method: 'POST',
        body: { mode, classes: [...classes] },
      })
      toast.success(mode === 'preview' ? t('cdFixQueuedPreview') : t('cdFixQueuedCommit'))
      await poll()
    } catch (e) {
      const body = (e as { body?: { error?: string; code?: string } })?.body
      const code = body?.code
      if (code === 'empty_worklist') toast.info(t('cdFixNothingToDo'))
      else if (code === 'cap_exceeded') toast.error(body?.error || t('cdFixCapExceeded'))
      else if (code === 'preview_required') toast.warning(t('cdFixPreviewRequired'))
      else if (code === 'down_in_progress' || code === 'up_in_progress') toast.info(t('cdFixBlockedBySync'))
      else if (code === 'grp_in_progress') toast.info(t('cdFixAlreadyRunning'))
      else toast.error(body?.error || (e as Error)?.message || t('cdFixFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {!hideTrigger && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="gap-1.5"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
          {busy ? t('cdFixRunning') : t('cdFixButton')}
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />{t('cdFixTitle')}
            </DialogTitle>
            <DialogDescription>{t('cdFixDescription')}</DialogDescription>
          </DialogHeader>

          {/* What to act on. Counts come from the findings already on screen; the
              server recomputes the actual rows, so these are an estimate, not the
              payload. */}
          <fieldset className="space-y-2 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              {t('cdFixClassesLegend')}
            </legend>
            {FIX_CLASSES.map((c) => (
              <label key={c} className="flex min-h-11 cursor-pointer items-start gap-2 text-sm sm:min-h-0">
                <Checkbox
                  checked={classes.has(c)}
                  onCheckedChange={() => toggleClass(c)}
                  aria-label={t(`cdFixClass_${c}`)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground">{t(`cdFixClass_${c}`)}</span>
                  <span className="ml-1.5 text-muted-foreground">({available[c] || 0})</span>
                  <span className="block text-xs text-muted-foreground">{t(`cdFixClassHint_${c}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {/* The safety note is not decoration: this dialog writes to the club's
              legal member register. */}
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('cdFixRegisterWarning')}
          </p>

          {blockedBy && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{t('cdFixBlockedBySync')}</p>
          )}

          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {status?.mode === 'commit' ? t('cdFixRunningCommit') : t('cdFixRunningPreview')}
            </p>
          )}

          {status?.state === 'failed' && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {status.message || t('cdFixFailed')}
            </p>
          )}

          {/* Per-row outcome — this IS what the operator approves before committing. */}
          {status?.state === 'done' && resultRows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {status.mode === 'commit' ? t('cdFixResultCommit') : t('cdFixResultPreview')}
                {failedRows.length > 0 && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {t('cdFixSkippedCount', { count: failedRows.length })}
                  </span>
                )}
              </p>
              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t('cdFixColAction')}</TableHead>
                      <TableHead>{t('clubdeskGroupColName')}</TableHead>
                      <TableHead>{t('clubdeskColGroup')}</TableHead>
                      <TableHead>{t('cdFixColOutcome')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultRows.map((r, i) => {
                      const ok = OK_STATUSES.has(r.status || '')
                      return (
                        <TableRow key={`${r.kind}-${r.name}-${r.group || r.group_label}-${i}`} className="min-h-11">
                          <TableCell className="whitespace-nowrap">
                            {r.kind === 'add' ? t('cdFixActionAdd') : t('cdFixActionRemove')}
                          </TableCell>
                          <TableCell className="whitespace-normal break-words font-medium">{r.name}</TableCell>
                          <TableCell className="whitespace-normal break-words">
                            {r.group_label || [r.group, r.funktion].filter(Boolean).join(' · ')}
                          </TableCell>
                          <TableCell className="whitespace-normal break-words">
                            <span className={`inline-flex items-center gap-1 text-xs ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'}`}>
                              {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                              {r.status}
                            </span>
                            {r.detail && (
                              <span className="block text-xs text-muted-foreground">{r.detail}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => { void run('preview') }}
              disabled={submitting || busy || !!blockedBy || totalAvailable === 0 || classes.size === 0}
              className="gap-1.5"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('cdFixPreviewButton')}
            </Button>
            <Button
              type="button"
              onClick={() => { void run('commit') }}
              disabled={submitting || busy || !!blockedBy || !canCommit}
              className="gap-1.5"
              title={canCommit ? undefined : t('cdFixPreviewRequired')}
            >
              {t('cdFixCommitButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
