/**
 * ClubdeskSyncPath — the ClubDesk sync order, as a thing you follow rather than
 * a thing you have to remember.
 *
 * The order is not a convention, it is forced by how the pieces read each other:
 *
 *   1. Sync down    refreshes `clubdesk_export` (TRUNCATE + reload) and stages
 *                   proposals. EVERYTHING downstream reads that table — the
 *                   sync-up preview computes drift against it and its stale-link
 *                   guard checks membership in it; the group checks read
 *                   `gruppen_bracketed` from it. Run anything on a stale export
 *                   and it acts on yesterday's register.
 *   2. Decide       accept/refuse. A refusal flags the member for push, so it has
 *                   to happen BEFORE the up or the refusal misses that push.
 *                   ⚠ The sync-down also SKIPS members with a pending push, so a
 *                   queued member raises no proposals until the push lands —
 *                   which is why decide-then-push is one unit, not two.
 *   3. Sync up      pushes wiedisync → ClubDesk and clears the pending flags.
 *   4. Sync down    REQUIRED again, and not just for freshness: a CREATE only
 *                   closes its loop here. The new contact gets a ClubDesk [Id],
 *                   and the linker reads the pushed Wiedisync ID back to set
 *                   members.clubdesk_id. Until then the member sits at
 *                   "pushed, awaiting link" and is deliberately excluded from the
 *                   create set so it cannot be duplicated.
 *   5. Fix groups   LAST. The scraper finds a contact by typing the wiedisync
 *                   UUID into ClubDesk's Filtern box, which needs the contact to
 *                   exist AND carry that ID — i.e. after the create was pushed
 *                   and linked. Earlier it fails with `uuid did not resolve`,
 *                   silently, every run.
 *
 * ⚠ Deliberately NOT a single automatic button. Step 2 is a human decision, and
 * step 5 writes group allocations into the club's legal register behind its own
 * preview→commit gate. This component runs what can be run and stops where a
 * person is actually required — it never advances past those two on its own.
 *
 * ⚠ The three jobs are mutually exclusive server-side (409 down_in_progress /
 * up_in_progress / grp_in_progress) — one ClubDesk login, one lock. The runner
 * therefore polls one step to completion before offering the next.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowDownToLine, ArrowUpFromLine, Check, ListChecks, Loader2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { kscwApi } from '../../../lib/api'

export type PathStep = 'down1' | 'decide' | 'up' | 'down2' | 'groups' | 'done'

const STEPS: PathStep[] = ['down1', 'decide', 'up', 'down2', 'groups']

const ICON: Record<PathStep, typeof Check> = {
  down1: ArrowDownToLine,
  decide: ListChecks,
  up: ArrowUpFromLine,
  down2: ArrowDownToLine,
  groups: Wrench,
  done: Check,
}

interface SyncStatus { state: string; up_state?: string }

export default function ClubdeskSyncPath({
  pendingProposals, fixableCount, onRunUp, onRunGroups, onDone,
}: {
  /** Open proposals — step 2 cannot pass while this is non-zero. */
  pendingProposals: number
  /** Group findings the fix can act on — step 5 is skipped when zero. */
  fixableCount: number
  /** Hand control to the existing sync-up modal (reused, not reimplemented). */
  onRunUp: () => void
  /** Hand control to the existing Fix groups dialog (preview → commit lives there). */
  onRunGroups: () => void
  /** Re-run the page's checks after a step settles. */
  onDone?: () => void | Promise<void>
}) {
  const { t } = useTranslation('admin')
  const [step, setStep] = useState<PathStep>('down1')
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  // Poll a job to completion. The server refuses concurrent jobs, so the runner
  // must not offer the next step until this settles.
  const runSyncDown = useCallback(async (): Promise<boolean> => {
    setRunning(true)
    try {
      await kscwApi('/clubdesk-member-sync', { method: 'POST' })
      const deadline = Date.now() + 300_000
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000))
        if (!alive.current) return false
        const s = await kscwApi<SyncStatus>('/clubdesk-member-sync')
        if (s.state === 'done') return true
        if (s.state === 'failed') { toast.error(t('dhPathFailed')); return false }
        if (Date.now() > deadline) { toast.error(t('dhPathTimeout')); return false }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      if (alive.current) setRunning(false)
    }
  }, [t])

  // ⚠ DERIVED, not corrected in an effect. The decision gate opens the moment
  // nothing is pending, and writing that back through setState inside an effect
  // is the cascading-render bug react-hooks/set-state-in-effect exists to catch
  // (the same trap ClubdeskProposals hit). `step` stores how far the user has
  // got; `current` is what that means given live counts.
  const current: PathStep = step === 'decide' && pendingProposals === 0 ? 'up' : step

  const advance = useCallback(async () => {
    setActive(true)
    if (current === 'down1' || current === 'down2') {
      const ok = await runSyncDown()
      if (!ok) return
      await onDone?.()
      // After the FIRST down the decision gate is next; after the second, groups.
      // The gate then opens by itself through `current` once nothing is pending.
      setStep(current === 'down1' ? 'decide' : 'groups')
      return
    }
    // Both of these hand off to the component that already owns that job — the
    // sync-up modal and the Fix groups preview→commit dialog. Reused, not
    // reimplemented: the group commit in particular must keep its own gate.
    if (current === 'up') { onRunUp(); return }
    if (current === 'groups') { onRunGroups(); return }
  }, [current, runSyncDown, onRunUp, onRunGroups, onDone])

  const label = useMemo(() => ({
    down1: t('dhPathStep1'),
    decide: t('dhPathStep2', { count: pendingProposals }),
    up: t('dhPathStep3'),
    down2: t('dhPathStep4'),
    groups: t('dhPathStep5', { count: fixableCount }),
    done: t('dhPathDone'),
  }), [t, pendingProposals, fixableCount])

  const stepIndex = STEPS.indexOf(current)
  const blocked = current === 'decide' && pendingProposals > 0

  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">{t('dhPathTitle')}</h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t('dhPathHint')}</p>
        </div>
        {current !== 'done' && (
          <Button
            type="button" size="sm"
            variant={active ? 'default' : 'outline'}
            disabled={running || blocked}
            aria-busy={running}
            onClick={() => void advance()}
            className="gap-1.5"
          >
            {running
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {running ? t('dhPathRunning') : blocked ? t('dhPathWaiting') : t('dhPathNext')}
          </Button>
        )}
      </div>

      <ol className="mt-3 flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        {STEPS.map((s, i) => {
          const Icon = ICON[s]
          const done = i < stepIndex
          const current = i === stepIndex
          return (
            <li
              key={s}
              aria-current={current ? 'step' : undefined}
              className={`flex min-h-11 items-center gap-1.5 text-xs sm:min-h-0 ${
                current
                  ? 'font-medium text-gray-900 dark:text-white'
                  : done
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-400 dark:text-gray-500'
              }`}
            >
              {done
                ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
                : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
              <span>{label[s]}</span>
              {current && blocked && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  {t('dhPathYourTurn')}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
