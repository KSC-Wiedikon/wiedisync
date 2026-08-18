/**
 * The on-demand VIS player check: `POST /kscw/admin/vis-player-check`, then poll
 * `GET` until it stops running.
 *
 * The monthly cron (`/opt/vis-sync/vis-sync.sh`, 1st of the month) used to be
 * the ONLY writer of `in_vis` — so for 30 days of every 31 this page was
 * frozen, and the header's Refresh button (a plain refetch of `members`)
 * could not change that no matter how often it was pressed. This runs the
 * real check.
 *
 * 202 + poll, not a request we hold open: a full pass pulls one whole
 * federation roster per federation of origin in the cohort (VIS ignores name
 * filters), Swiss Volley's being the largest, so it takes minutes — well past
 * what the Cloudflare tunnel will keep alive.
 *
 * ⚠⚠ INSTANTIATE THIS IN THE PAGE (the composition root), never inside the
 * header or the diagnostics panel. `visCancelled`'s only writer is the unmount
 * effect below and it is the ONLY thing that stops the `for (;;)` loop — there
 * is no AbortController — and both of those surfaces render conditionally, so a
 * component-scoped copy would abort a live run on remount or start a second
 * concurrent poll. Both surfaces take `visRunning` + `runVisCheck` as props.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { kscwApi } from '../../../../lib/api'
import type { VisCheckStatus } from '../types'

export function useVisCheckRun(
  onFinished: () => Promise<unknown> | void,
): { visRunning: boolean; runVisCheck: () => Promise<void> } {
  const { t } = useTranslation('admin')
  const [visRunning, setVisRunning] = useState(false)

  // Set on unmount so the poll loop stops touching state after the page is
  // gone. A ref, not state: the loop must read the CURRENT value, and a stale
  // closure over a state variable would keep polling forever.
  const visCancelled = useRef(false)
  useEffect(() => () => { visCancelled.current = true }, [])

  // ⚠ `onFinished` is read through a ref that is refreshed on every render, and
  // is deliberately NOT a dependency of `runVisCheck`. The caller passes an
  // inline arrow (`data.refetch`), and a changed identity mid-poll would
  // re-create `runVisCheck` while the loop is still closed over the old copy.
  const onFinishedRef = useRef(onFinished)
  useEffect(() => { onFinishedRef.current = onFinished })

  const runVisCheck = useCallback(async () => {
    setVisRunning(true)
    try {
      await kscwApi('/admin/vis-player-check', { method: 'POST' })
      toast.info(t('trVisCheckStarted'))
    } catch (err) {
      const code = (err as { code?: string }).code
      // Another admin (or this same page before a reload) already has a run in
      // flight — follow that one rather than reporting a failure.
      if (code !== 'vis_check_running') {
        setVisRunning(false)
        toast.error(code === 'vis_credentials_missing' ? t('trVisCheckUnavailable') : t('trVisCheckFailed'))
        return
      }
    }

    // Poll to completion. 2s, because a measured run is ~4s (24 federation
    // rosters, ~460 members) — a lazier cadence would spend most of the wait
    // idling after the job had already finished. The deadline mirrors the
    // endpoint's own run timeout plus a minute of slack, so the UI gives up
    // slightly AFTER the server does rather than leaving a spinner that
    // outlives the job.
    const deadline = Date.now() + 16 * 60_000
    for (;;) {
      await new Promise((resolve) => { setTimeout(resolve, 2000) })
      if (visCancelled.current) return
      let status: VisCheckStatus
      try {
        status = await kscwApi<VisCheckStatus>('/admin/vis-player-check')
      } catch {
        setVisRunning(false)
        toast.error(t('trVisCheckFailed'))
        return
      }
      if (visCancelled.current) return
      if (!status.running) {
        setVisRunning(false)
        // Pull the freshly written in_vis / vis_player_no / in_vis_checked_at.
        await onFinishedRef.current()
        if (status.result?.ok) {
          toast.success(t('trVisCheckDone', {
            checked: status.result.checked ?? 0,
            inVis: status.result.inVis ?? 0,
            notFound: status.result.notFound ?? 0,
          }))
        } else {
          toast.error(t('trVisCheckFailed'))
        }
        return
      }
      if (Date.now() > deadline) {
        setVisRunning(false)
        toast.info(t('trVisCheckSlow'))
        return
      }
    }
  }, [t])

  return { visRunning, runVisCheck }
}
