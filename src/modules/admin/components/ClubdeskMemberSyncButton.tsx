import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { kscwApi } from '../../../lib/api'
import { formatDateTimeCompact } from '../../../utils/dateHelpers'

type SyncState = 'idle' | 'queued' | 'running' | 'done' | 'failed'
interface SyncStatus {
  state: SyncState
  message: string | null
  requested_at: string | null
  finished_at: string | null
}

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

  // Show the last successful sync time on mount (best-effort — silent for non-superadmins).
  useEffect(() => {
    let alive = true
    kscwApi<SyncStatus>('/clubdesk-member-sync')
      .then((s) => { if (alive && s.finished_at) setLastSync(s.finished_at) })
      .catch(() => { /* not a superadmin or transient — leave blank */ })
    return () => { alive = false }
  }, [])

  const go = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await kscwApi('/clubdesk-member-sync', { method: 'POST', body: {} })
      const deadline = Date.now() + 240_000
      for (;;) {
        await new Promise((r) => setTimeout(r, 5_000))
        const s = await kscwApi<SyncStatus>('/clubdesk-member-sync')
        if (s.state === 'done') { setLastSync(s.finished_at); break }
        if (s.state === 'failed') throw new Error(s.message || t('clubdeskSyncFailed'))
        if (Date.now() > deadline) { toast.info(t('clubdeskSyncTimeout')); await onDone?.(); return }
      }
      toast.success(t('clubdeskSyncDone'))
      await onDone?.()
    } catch (e) {
      const state = (e as { body?: { state?: string } })?.body?.state
      if (state === 'queued' || state === 'running') {
        toast.info(t('clubdeskSyncInProgress'))
      } else {
        const msg = (e as { body?: { error?: string } })?.body?.error || (e as Error)?.message || t('clubdeskSyncFailed')
        toast.error(msg)
      }
    } finally {
      setSyncing(false)
    }
  }, [syncing, onDone, t])

  return (
    <div className={className}>
      <Button type="button" variant="outline" size="sm" disabled={syncing} onClick={go} className="gap-2">
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {syncing ? t('clubdeskSyncing') : t('clubdeskSyncDown')}
      </Button>
      {syncing ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('clubdeskSyncNote')}</p>
      ) : lastSync ? (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('clubdeskLastSync', { time: formatDateTimeCompact(lastSync) })}</p>
      ) : null}
    </div>
  )
}
