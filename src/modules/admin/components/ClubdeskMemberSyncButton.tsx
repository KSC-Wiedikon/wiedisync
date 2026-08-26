import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { kscwApi } from '../../../lib/api'
import { classifySyncFailure, SYNC_FAILURE_KEY } from '../utils/syncFailure'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'
import { detectClubdeskConflicts } from '../utils/clubdeskConflicts'

type SyncState = 'idle' | 'queued' | 'running' | 'done' | 'failed'
interface SyncStatus {
  state: SyncState
  message: string | null
  requested_at: string | null
  /** When the last run FINISHED — either outcome. Not a "last sync" time. */
  finished_at: string | null
  /**
   * When a run last SUCCEEDED (migration 336). ⚠ This is the only field a UI may
   * label "last sync": `finished_at` is stamped on failure too.
   */
  last_success_at: string | null
  /** Sync-up direction — the two are mutually exclusive (see the note on `go`). */
  up_state?: SyncState
}

const BUSY: SyncState[] = ['queued', 'running']

interface Props {
  /** Refresh local member data once the sync settles (success or background-timeout). */
  onDone?: () => void | Promise<void>
  className?: string
}

/**
 * Superadmin "Sync down from ClubDesk" — requests a ClubDesk member import and
 * polls until the host dispatcher reports done/failed. The Directus container
 * can't launch the headless scrape (it runs in a Docker container on the host),
 * so the POST only sets a request flag; a cron dispatcher does the work and writes
 * back `down_state`, which we poll here. Twin of the finance "Sync now" button.
 */
export default function ClubdeskMemberSyncButton({ onDone, className }: Props) {
  const { t } = useTranslation('admin')
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [upBusy, setUpBusy] = useState(false)
  // ⚠ Kept in state, not just toasted: a toast is gone in seconds and the reason a
  // sync failed is the thing the operator needs while deciding what to do next.
  const [failure, setFailure] = useState<string | null>(null)

  // Show the last successful sync time on mount, and keep the sync-up state
  // fresh so the button greys out for as long as a push holds the pipeline.
  // Polled rather than lifted into the parent because this button and the
  // sync-up modal are mounted side by side on three different pages with no
  // shared owner (ClubDesk sync, Anmeldungen, Data health) — the singleton-row
  // read is cheap and the poll is the one thing all three get for free.
  // Best-effort: silent for non-superadmins.
  useEffect(() => {
    let alive = true
    const poll = () => {
      kscwApi<SyncStatus>('/clubdesk-member-sync')
        .then((s) => {
          if (!alive) return
          // ⚠⚠ The LAST SUCCESS, never merely the last finish. The dispatcher
          // stamps `down_finished_at` on failure too, so reading that painted
          // "Last sync: <a minute ago>" straight after a FAILED sync — which is
          // indistinguishable from success, and is exactly how a ClubDesk outage
          // on 25.08.2026 was reported as "it worked, slow but did" while all
          // three attempts had failed and the snapshot was five days stale.
          // Migration 336 gives us the honest field.
          if (s.last_success_at) setLastSync(s.last_success_at)
          // ⚠ Carry a failed LAST run onto the panel on mount. The failure the
          // operator needs to read most is the one they navigated away from and
          // came back to — a toast they already dismissed helps nobody. Cleared
          // whenever the last run is not a failure, so a later success removes it.
          setFailure(s.state === 'failed' ? (s.message || null) : null)
          setUpBusy(BUSY.includes(s.up_state as SyncState))
        })
        .catch(() => { /* not a superadmin or transient — leave blank */ })
    }
    poll()
    const id = setInterval(poll, 20_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  // Sync-down and sync-up are mutually exclusive server-side: a down run that
  // lands between the push's dry-run preview and its commit would swap the
  // ClubDesk snapshot out from under a set that already passed review. The POST
  // returns 409 `up_in_progress`; this disabled state just makes it visible.
  const go = useCallback(async () => {
    setFailure(null)   // a new attempt must not sit under the previous one's error
    if (syncing || upBusy) return
    setSyncing(true)
    try {
      await kscwApi('/clubdesk-member-sync', { method: 'POST', body: {} })
      const deadline = Date.now() + 240_000
      for (;;) {
        await new Promise((r) => setTimeout(r, 5_000))
        const s = await kscwApi<SyncStatus>('/clubdesk-member-sync')
        if (s.state === 'done') {
          setLastSync(s.finished_at)
          // Same staging step the sync path runs — a sync-down started from this
          // button must not leave the value conflicts undetected just because it
          // took the other door. ⚠ Never fatal: the import already succeeded.
          try {
            const staged = await detectClubdeskConflicts()
            if (staged > 0) toast.info(t('dhPathConflictsStaged', { count: staged }))
          } catch { /* reported by the proposals table on next load */ }
          break
        }
        if (s.state === 'failed') { setFailure(s.message || null); throw new Error(s.message || t('clubdeskSyncFailed')) }
        if (Date.now() > deadline) { toast.info(t('clubdeskSyncTimeout')); await onDone?.(); return }
      }
      toast.success(t('clubdeskSyncDone'))
      await onDone?.()
    } catch (e) {
      const body = (e as { body?: { state?: string; code?: string; error?: string } })?.body
      // Check `code` before `state`: the sync-up block also carries a
      // queued/running state (the UP one), so a bare state check would report
      // "a sync is already in progress" about the wrong direction.
      if (body?.code === 'up_in_progress') {
        setUpBusy(true)
        toast.info(t('clubdeskSyncBlockedByUp'))
      } else if (body?.state === 'queued' || body?.state === 'running') {
        toast.info(t('clubdeskSyncInProgress'))
      } else {
        // Lead with the explanation, not the Chromium error code.
        const raw = body?.error || (e as Error)?.message || null
        toast.error(t(SYNC_FAILURE_KEY[classifySyncFailure(raw)]))
      }
    } finally {
      setSyncing(false)
    }
  }, [syncing, upBusy, onDone, t])

  return (
    <div className={className}>
      <Button type="button" variant="outline" size="sm" disabled={syncing || upBusy} onClick={go} className="gap-2">
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {syncing ? t('clubdeskSyncing') : t('clubdeskSyncDown')}
      </Button>
      {syncing ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('clubdeskSyncNote')}</p>
      ) : upBusy ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('clubdeskSyncBlockedByUp')}</p>
      ) : failure ? (
        // ⚠ Explanation AND the raw line. A classifier that swallowed the original
        // would be a prettier version of the problem it exists to solve — when the
        // guess is wrong, the operator still needs what the scraper actually said.
        <div className="mt-1 space-y-0.5">
          <p className="text-xs text-red-600 dark:text-red-400">
            {t(SYNC_FAILURE_KEY[classifySyncFailure(failure)])}
          </p>
          <p className="break-words text-[11px] text-gray-500 dark:text-gray-400" title={failure}>
            {failure}
          </p>
        </div>
      ) : lastSync ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('clubdeskLastSync', { time: formatDateTimeCompact(lastSync) })}</p>
      ) : null}
    </div>
  )
}
