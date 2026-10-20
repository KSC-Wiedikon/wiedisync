// src/modules/admin/components/ClubdeskFixGroups.tsx
//
// "Fix groups" — step 5 of the sync path, and the one job that WRITES ClubDesk
// group allocations from the app.
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
// ⚠ NO TRIGGER OF ITS OWN (08.09.2026). It used to also sit as a button in a
// "ClubDesk" actions bar above the path — a second door onto the same job, on a page
// whose whole point is that the five steps happen in order. Fix groups is LAST for a
// reason (the scraper finds a contact by the wiedisync UUID, which a freshly created
// contact only carries after the push and the read-back), so a button offering it
// out of order could only ever be a way to run it too early. The path opens it now.
//
// ⚠ TWO-STEP BY DESIGN. Preview drives every UI step and then cancels (no write);
// only after a preview succeeds does the server accept a commit, and the operator
// has to click again with the per-row outcome in front of them. The 2026-07-16
// incident — 29 DU20 girls stripped out of ClubDesk by a bad departure test — is
// why nothing here is one-click.
//
// ⚠⚠ JUDGED BY ROWS WRITTEN, NOT BY THE RUN FINISHING (20.10.2026). A run whose
// every row was skipped used to read as a success at every layer: the dispatcher
// stored it as done, this dialog offered the commit, and after the commit it said
// "Done … Nothing else to do here." in green. The dispatcher now stores a run with
// no OK row as 'failed' (keeping its per-row result), the server refuses a commit
// on such a preview and commits only the preview's OK rows, and this dialog reads
// the outcome through summarizeGroupFixResult (utils/groupFixOutcome.ts).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, Check, Loader2, Wrench, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kscwApi } from '../../../lib/api'
import { useConfirm } from '../../../components/ConfirmProvider'
import { FIX_CLASSES, type FixClass } from '../utils/clubdeskFindings'
import {
  isOkStatus, statusReasonKey, summarizeGroupFixResult, NOT_ATTEMPTED, type GroupFixResult,
} from '../utils/groupFixOutcome'
import ClubdeskStepDialog from './ClubdeskStepDialog'

type JobState = 'idle' | 'queued' | 'running' | 'done' | 'failed'
const BUSY: JobState[] = ['queued', 'running']
/** A run that ended — a 'failed' one still carries its per-row result now. */
const FINISHED: JobState[] = ['done', 'failed']

interface FixStatus {
  state: JobState
  message: string | null
  mode: 'preview' | 'commit' | null
  finished_at: string | null
  requested_by: string | null
  counts: { add: number; remove: number } | null
  result: GroupFixResult | null
  down_state: JobState
  up_state: JobState
  /** Live progress of the group fix itself (migration 355) — advisory, may be null. */
  phase?: string | null
  progress?: number | null
  log?: string | null
}

interface Props {
  /** Findings counts per class, so the dialog can say what it is about to touch. */
  available: Record<FixClass, number>
  /**
   * Re-run the page's checks once a commit settles. ⚠ `unknown`, not `void`: the
   * page's refresh resolves to the sync path's gate counts, and this dialog is
   * simply not one of the callers that needs them.
   */
  onDone?: () => void | Promise<unknown>
  /**
   * A commit finished. ⚠ The sync path needs this as its OWN signal that step 5 is
   * done, because the findings it would otherwise wait on CANNOT change: they are
   * computed from `clubdesk_export.groups_bracketed`, i.e. from the last sync-DOWN,
   * and a commit writes to ClubDesk. Until the next sync down, wiedisync's copy of
   * the register still shows the old groups — so a step gated on "no findings left"
   * stays open forever after a run that did exactly what was asked (08.09.2026:
   * 7 assigned, 2 removed, zero skips, and the path still read "5. Fix groups (9)").
   * (The dispatcher's mirror patch now updates that copy for the rows it wrote, so
   * what stays listed afterwards is what was NOT written.)
   *
   * ⚠ Fired only for a commit that wrote at least one row (20.10.2026). A commit
   * that skipped all 17 rows used to fire it too, and the path then read "Done".
   */
  onCommitted?: () => void
  /** Open state — owned by the sync path, which is the only thing that opens it. */
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Position in the sync path — the shell's eyebrow reads "Step 5 of 5". */
  step: number
  total: number
  title: string
  description?: string
}

export default function ClubdeskFixGroups({
  available, onDone, onCommitted, open, onOpenChange, step, total, title, description,
}: Props) {
  const { t } = useTranslation('admin')
  const confirm = useConfirm()
  const setOpen = onOpenChange
  const [status, setStatus] = useState<FixStatus | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [classes, setClasses] = useState<Set<FixClass>>(new Set(FIX_CLASSES))
  // ⚠ Which classes the preview on screen actually covered. The commit posts the
  // CURRENT selection and the server recomputes the worklist from it, so ticking
  // another class after a preview used to commit rows nobody had reviewed — with
  // the confirm dialog still counting the old preview's rows. The server refuses
  // that now (`preview_stale`); this is so the operator sees it before clicking.
  const [previewedClasses, setPreviewedClasses] = useState<Set<FixClass> | null>(null)
  // Held in a ref so the poller can fire onDone exactly once per finished commit
  // without re-subscribing the interval on every status change.
  const lastFinished = useRef<string | null>(null)
  // ⚠ The FIRST poll only records where things stood; it never fires. Without this
  // a commit finished days ago (the row keeps its last result) reads as one that
  // just landed the moment the page opens — a spurious rescan before, and now a
  // spurious "step 5 complete".
  const primed = useRef(false)
  // ⚠⚠ `finished_at` of a run THIS dialog watched finish. The job row keeps its
  // last result forever, so without this every render below described a run from
  // days ago as if it had just happened: opening the dialog showed yesterday's
  // "Done — 4 group allocations written to ClubDesk. Nothing else to do here."
  // over yesterday's log, next to a path still reading "5. Fix groups (9)"
  // (09.09.2026 — the two on screen at once is what made it obvious). The
  // completion notice, the result table and the log all belong to a run you
  // watched; a stale one is not a notice, it is a claim that the work is done.
  const [sessionRunAt, setSessionRunAt] = useState<string | null>(null)

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
      if (!primed.current) { primed.current = true; lastFinished.current = s.finished_at; return }
      // ⚠ 'failed' counts as finished too. A run with no OK row is stored as failed
      // WITH its per-row result (20.10.2026), and the table of why is the whole
      // point; watching only 'done' left a failed run looking like an earlier one's.
      if (FINISHED.includes(s.state) && s.finished_at && s.finished_at !== lastFinished.current) {
        lastFinished.current = s.finished_at
        // Every finish this dialog witnessed, preview or commit — that is what
        // makes the panels below this run's rather than some earlier one's.
        setSessionRunAt(s.finished_at)
        if (s.mode !== 'commit') return
        // ⚠ Only a commit that WROTE something closes step 5 and rescans. One that
        // skipped every row changed nothing in ClubDesk or in our mirror of it.
        if (summarizeGroupFixResult(s.result).ok === 0) return
        onCommitted?.()
        void onDone?.()
      }
    }
    void tick()
    // 3s while the dialog is open — it is showing this job's own phase and log now,
    // and a ten-second gap between lines reads as a stall in a live log.
    const id = setInterval(() => { void tick() }, open ? 3_000 : 10_000)
    return () => { alive = false; clearInterval(id) }
  }, [poll, onDone, onCommitted, open])

  const busy = BUSY.includes(status?.state as JobState)
  const blockedBy = BUSY.includes(status?.down_state as JobState)
    ? 'down'
    : BUSY.includes(status?.up_state as JobState) ? 'up' : null
  const totalAvailable = FIX_CLASSES.reduce((n, c) => n + (available[c] || 0), 0)
  // The selection moved since the preview, so the preview no longer describes what
  // a commit would write. Null = we did not run the preview in this page load, and
  // the server's own row-level check is the backstop.
  const selectionChanged = !!previewedClasses && (
    previewedClasses.size !== classes.size || [...classes].some((c) => !previewedClasses.has(c))
  )
  /** Did THIS dialog watch the run whose result is on the row right now? */
  const ownRun = !!status?.finished_at && status.finished_at === sessionRunAt
  /** A run this dialog watched end, with a per-row result to show. */
  const finishedOwn = FINISHED.includes(status?.state as JobState) && ownRun && !!status?.result
  // What the run on the row actually did — rows, not "it finished".
  const outcome = summarizeGroupFixResult(status?.result)
  const resultRows = outcome.rows
  const failedRows = resultRows.filter((r) => !isOkStatus(r.status))
  // Skipped + never reached + held back from the commit by the server — the same
  // number the sync path's Done card reads (groupRowsNotWritten), by construction.
  const notWritten = outcome.notWritten
  /** A preview we watched that found NOTHING writable — the 20.10.2026 run. */
  const previewNothingWritable = finishedOwn && status?.mode === 'preview' && outcome.ok === 0
  // A commit is only offered once a preview of the *current* job succeeded — the
  // server enforces this too ('preview_required', 'preview_nothing_writable', and
  // row-by-row 'preview_stale'); this just makes it visible. ⚠ `ownRun` is part of
  // that: a preview from an earlier session enabled the commit button off results
  // the operator had not watched being produced, and the server would then refuse
  // the write as stale — a button that is offered and then bounces is worse than
  // one that is not there. ⚠⚠ And the preview must have found at least one row it
  // COULD write: on 20.10.2026 a 17/17 skip_filter_failed preview offered the
  // commit, which ran for eight minutes and skipped the same 17 rows.
  const canCommit = status?.state === 'done' && status.mode === 'preview' && !!status.result
    && ownRun && !selectionChanged && outcome.ok > 0
  /** A commit this dialog watched end, whatever it managed to write. */
  const commitFinished = finishedOwn && status?.mode === 'commit'
  // ⚠ A finished commit had NO terminal state: the result table rendered, the
  // commit button greyed out (canCommit needs a FRESH preview), and the footer
  // still offered only "Run preview" / "Commit to ClubDesk" — so the operator
  // was left asking "why doesn't it say complete, what do I click?" (2026-08-30)
  // with the work already done. A commit that wrote something says so and offers
  // the way out. ⚠ One that wrote NOTHING is not "done" (20.10.2026): it stays on
  // the preview stage, under a red notice, so the next thing on offer is another
  // preview once the cause is fixed — not a Close button over a green banner.
  const committed = commitFinished && outcome.ok > 0

  // ⚠ THE DIALOG HAS THREE STAGES, and used to render as one flat panel that never
  // moved: after a preview succeeded it still read "Preview first, then commit",
  // still said "Review the preview before you commit", and still offered "Run
  // preview" as a peer of the commit button — so the step you had just completed
  // was still the instruction on screen (08.09.2026). Now exactly one action is
  // the obvious next one at any moment.
  //   choose  — pick the classes, run the preview. No commit offered.
  //   review  — the preview is on screen and wrote nothing; commit or preview again.
  //   done    — it is written; the only thing left is to close.
  const stage: 'choose' | 'review' | 'done' = committed ? 'done' : canCommit ? 'review' : 'choose'

  const toggleClass = (c: FixClass) => {
    setClasses((prev) => {
      const n = new Set(prev)
      if (n.has(c)) n.delete(c)
      else n.add(c)
      return n
    })
  }

  /** One line of explanation for a status, or none for one we do not know. */
  const reason = (s: string) => {
    const key = statusReasonKey(s)
    return key ? t(key) : ''
  }

  async function run(mode: 'preview' | 'commit') {
    if (mode === 'commit') {
      // ⚠ Counted from the preview's OK rows, because that is exactly what the
      // server will write: it cuts the commit down to the rows the preview could
      // write and holds back the ones it skipped (20.10.2026). This used to fall
      // back to EVERY previewed row — skips included — so the dialog asked "Write 17
      // group changes?" over a preview that could write none. (`counts` is no help
      // here: the dispatcher nulls grp_worklist on write-back, it carries names +
      // uuids.) Still an upper bound: the server recomputes the worklist from the
      // current findings at queue time and never trusts a client-supplied one.
      const n = outcome.ok
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
      if (mode === 'preview') setPreviewedClasses(new Set(classes))
      await poll()
    } catch (e) {
      const body = (e as { body?: { error?: string; code?: string } })?.body
      const code = body?.code
      if (code === 'empty_worklist') toast.info(t('cdFixNothingToDo'))
      else if (code === 'cap_exceeded') toast.error(body?.error || t('cdFixCapExceeded'))
      else if (code === 'preview_required') toast.warning(t('cdFixPreviewRequired'))
      else if (code === 'preview_stale') toast.warning(t('cdFixPreviewStale'))
      else if (code === 'preview_nothing_writable') toast.warning(t('cdFixPreviewNothingWritable'))
      else if (code === 'down_in_progress' || code === 'up_in_progress') toast.info(t('cdFixBlockedBySync'))
      else if (code === 'grp_in_progress') toast.info(t('cdFixAlreadyRunning'))
      else toast.error(body?.error || (e as Error)?.message || t('cdFixFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ClubdeskStepDialog
      open={open}
      onOpenChange={setOpen}
      step={step}
      total={total}
      title={title}
      description={description || t('cdFixDescription')}
      icon={Wrench}
      // ⚠ Only while a run is in flight or has just finished. A bar over the class
      // checkboxes would be a progress claim about a person choosing what to fix.
      job={busy || ((status?.state === 'done' || status?.state === 'failed') && ownRun)
        ? {
          running: busy,
          done: status?.state === 'done',
          progress: status?.progress ?? null,
          phase: status?.phase ?? null,
          log: status?.log ?? null,
          error: status?.state === 'failed' ? (status.message || t('cdFixFailed')) : null,
        }
        : undefined}
      dismissible={!busy}
    >

          {/* Which of the three stages this is, said in words. The eyebrow says
              "Step 5 of 5" — that is where you are in the PATH, not where you are
              inside this job, and the two were being confused. */}
          {stage !== 'done' && (
            <p className="rounded-xl border border-hairline bg-surface-sunken px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {stage === 'review' ? t('cdFixStage2Title') : t('cdFixStage1Title')}
              </span>
              {' — '}
              {stage === 'review' ? t('cdFixStage2Hint') : t('cdFixStage1Hint')}
            </p>
          )}

          {/* What to act on. Counts come from the findings already on screen; the
              server recomputes the actual rows, so these are an estimate, not the
              payload. */}
          <fieldset className="space-y-2 rounded-xl border border-hairline p-3">
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
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {stage === 'review' ? t('cdFixRegisterWarningReview') : t('cdFixRegisterWarning')}
          </p>

          {blockedBy && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{t('cdFixBlockedBySync')}</p>
          )}

          {/* The preview on screen no longer matches what a commit would write. */}
          {selectionChanged && status?.state === 'done' && status.mode === 'preview' && (
            <p className="text-xs text-amber-700 dark:text-amber-300">{t('cdFixSelectionChanged')}</p>
          )}

          {/* The bar above carries the phase and the log; this says which of the
              two runs it is, which the phase alone does not make obvious. */}
          {busy && (
            <p className="text-xs text-muted-foreground">
              {status?.mode === 'commit' ? t('cdFixRunningCommit') : t('cdFixRunningPreview')}
            </p>
          )}

          {/* ⚠⚠ THE OUTCOME, IN ONE OF THREE COLOURS (20.10.2026). Green only when
              every row was written. It used to be green for ANY finished commit —
              "Done — 0 group allocations written to ClubDesk. Nothing else to do
              here." over 17 skipped rows — next to a line telling the operator the
              page would catch up at the next sync down, so they synced down and ran
              everything again. That line is gone: the dispatcher's mirror patch
              updates wiedisync's copy of the groups for every row it wrote, so
              what is still listed afterwards really was not written. */}
          {committed && notWritten === 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('cdFixCommitted', { count: outcome.ok })}</span>
            </p>
          )}
          {committed && notWritten > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('cdFixCommittedPartial', { written: outcome.ok, notWritten })}</span>
            </p>
          )}
          {/* Nothing written / nothing writable: red, the cause in words, and no
              commit button (canCommit needs an OK row). */}
          {(previewNothingWritable || (commitFinished && outcome.ok === 0)) && (
            <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {previewNothingWritable ? t('cdFixPreviewNothingWritable') : t('cdFixCommitNothingWritten')}
                </p>
                {outcome.dominant && (
                  <p className="text-xs">
                    {t(outcome.dominant === 'skip_filter_failed' || outcome.dominant === NOT_ATTEMPTED
                      ? `cdFixCause_${outcome.dominant}`
                      : 'cdFixCause_other', { status: outcome.dominant })}
                  </p>
                )}
                {/* The tool's own words, unparaphrased — same reasoning as the sync
                    path's raw failure line. */}
                {outcome.fatal && (
                  <p className="break-words text-[11px] opacity-80">{outcome.fatal}</p>
                )}
              </div>
            </div>
          )}

          {/* Per-row outcome — this IS what the operator approves before committing. */}
          {finishedOwn && (resultRows.length > 0 || outcome.notWritten > 0) && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {status?.mode === 'commit' ? t('cdFixResultCommit') : t('cdFixResultPreview')}
                {failedRows.length > 0 && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {t('cdFixSkippedCount', { count: failedRows.length })}
                  </span>
                )}
              </p>
              {/* The run in one glance, grouped by outcome, BEFORE the row-by-row
                  table: "17 skip_filter_failed — the contact grid never filtered"
                  says in one line what seventeen identical rows only imply. */}
              <ul className="space-y-0.5 rounded-xl border border-hairline bg-surface-sunken px-3 py-2 text-xs">
                <li className={outcome.ok > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}>
                  {status?.mode === 'commit'
                    ? t('cdFixSummaryWritten', { count: outcome.ok })
                    : t('cdFixSummaryWritable', { count: outcome.ok })}
                </li>
                {outcome.byStatus.map(({ status: s, count }) => (
                  <li key={s} className="text-amber-700 dark:text-amber-300">
                    <span className="font-medium">{count} × {s}</span>
                    {reason(s) && <span className="block text-muted-foreground">{reason(s)}</span>}
                  </li>
                ))}
              </ul>
              {resultRows.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-hairline">
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
                        const ok = isOkStatus(r.status)
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
              )}
            </div>
          )}

          {/* ⚠ ONE primary action per stage. The commit button is not rendered at
              all before a preview — a permanently-disabled "Commit to ClubDesk"
              next to an enabled "Run preview" reads as a choice, and the choice it
              offers is the one that writes to the register. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {stage === 'done' ? (
              <Button type="button" onClick={() => setOpen(false)} className="gap-1.5">
                {t('cdFixCloseButton')}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant={stage === 'review' ? 'outline' : 'default'}
                  onClick={() => { void run('preview') }}
                  disabled={submitting || busy || !!blockedBy || totalAvailable === 0 || classes.size === 0}
                  className="gap-1.5"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {stage === 'review' ? t('cdFixPreviewAgainButton') : t('cdFixPreviewButton')}
                </Button>
                {stage === 'review' && (
                  <Button
                    type="button"
                    onClick={() => { void run('commit') }}
                    disabled={submitting || busy || !!blockedBy}
                    className="gap-1.5"
                  >
                    {t('cdFixCommitButton')}
                  </Button>
                )}
              </>
            )}
          </div>
  </ClubdeskStepDialog>
  )
}
