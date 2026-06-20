import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/button'
import InlineSpinner from '../../../components/InlineSpinner'
import { kscwApi } from '../../../lib/api'
import { useSyncProgress, type SyncRun } from '../../../hooks/useSyncProgress'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'

interface SvrzStatus {
  total: number
  home: number
  away: number
  last_synced_at: string | null
}

interface Props {
  /** Season to sync (passed to the SVRZ sync + status endpoints). */
  seasonName?: string
  /** Also refresh VM team names/leagues (best-effort, admin-only). Default true. */
  alsoVm?: boolean
  /** Refresh local data once the sync settles (success or background-timeout). */
  onDone?: () => void | Promise<void>
  size?: 'sm' | 'default' | 'lg'
  variant?: 'default' | 'outline' | 'secondary'
  className?: string
}

/**
 * "Sync now" button with live progress. Triggers the SVRZ scheduling sync
 * (background, ~minutes) and shows an in-button spinner + "Sync in progress…"
 * until the `svrz_sync` heartbeat advances, then a success toast with the fresh
 * game counts (or the error). Shared by the dashboard, invites panel, and setup
 * page so all three behave identically. See {@link useSyncProgress}.
 */
export default function SyncNowButton({
  seasonName,
  alsoVm = true,
  onDone,
  size = 'sm',
  variant = 'outline',
  className,
}: Props) {
  const { t } = useTranslation('gameScheduling')

  const run = useCallback(async () => {
    await kscwApi('/admin/terminplanung/svrz-sync', {
      method: 'POST',
      body: seasonName ? { season_name: seasonName } : {},
    })
    // VM refresh is secondary (e.g. a junior team's Stärkeklasse rename). Admin-only
    // + best-effort: a non-admin spielplaner gets 403, swallowed so the SVRZ sync
    // still counts as started.
    if (alsoVm) {
      try {
        await kscwApi('/admin/vm-sync', { method: 'POST', body: {} })
      } catch { /* non-admin or VM busy — SVRZ already started */ }
    }
  }, [seasonName, alsoVm])

  const onSuccess = useCallback(
    async (info: { result?: unknown; run?: SyncRun }) => {
      if (!info.run) {
        // Polling deadline hit while the sync is still running in the background —
        // don't claim completed counts; just let the user know and refresh.
        toast.info(t('syncStillRunning'))
        await onDone?.()
        return
      }
      // Genuine completion — pull fresh counts for the toast (best-effort).
      try {
        const q = seasonName ? `?season_name=${encodeURIComponent(seasonName)}` : ''
        const s = await kscwApi<SvrzStatus>(`/admin/terminplanung/svrz-status${q}`)
        if (s && s.total > 0 && s.last_synced_at) {
          toast.success(
            t('svrzSynced', {
              date: formatDateTimeCompact(s.last_synced_at),
              total: s.total,
              home: s.home,
              away: s.away,
            }),
          )
        } else {
          toast.success(t('svrzSyncDone'))
        }
      } catch {
        toast.success(t('svrzSyncDone'))
      }
      await onDone?.()
    },
    [seasonName, onDone, t],
  )

  const onError = useCallback((msg: string) => toast.error(msg), [])

  const { start, isRunning } = useSyncProgress({
    source: 'svrz_sync',
    run,
    onSuccess,
    onError,
    maxPollMs: 600_000, // SVRZ cold runs can take several minutes
  })

  return (
    <Button size={size} variant={variant} onClick={start} disabled={isRunning} className={className}>
      {isRunning ? (
        <span className="flex items-center gap-2">
          <InlineSpinner />
          {t('syncInProgress')}
        </span>
      ) : (
        t('syncSvrzNow')
      )}
    </Button>
  )
}
