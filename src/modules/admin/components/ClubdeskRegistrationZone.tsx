import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, CircleAlert, Link2, ArrowUpFromLine, Clock, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { kscwApi } from '../../../lib/api'
import { useAuth } from '../../../hooks/useAuth'

interface RegStatus {
  status: 'linked' | 'match_unlinked' | 'pushed_pending' | 'not_in_clubdesk' | 'no_member'
  member_id?: number
  clubdesk_id?: string
  clubdesk_name?: string | null
  clubdesk_email?: string | null
  ambiguous?: boolean
  duplicate_of?: { id: number; name: string } | null
  pushed_at?: string | null
}

interface UpStatus {
  state: 'idle' | 'queued' | 'running' | 'done' | 'failed'
  message: string | null
}

/**
 * Per-registration "ClubDesk sync" zone (Anmeldungen expanded details, approved
 * registrations only). Shows whether the person behind the registration exists
 * in ClubDesk and, when they don't, offers a single-person push through the
 * existing sync-up pipeline (POST /clubdesk-member-sync/up with one member id,
 * then poll up-status — same contract as ClubdeskSyncUpModal). When the contact
 * exists in the ClubDesk snapshot but the member isn't linked, offers the
 * one-click /clubdesk-link instead — pushing in that state would duplicate the
 * contact. Superadmin only (the backend enforces the same gate).
 */
export default function ClubdeskRegistrationZone({ registrationId }: { registrationId: string }) {
  const { t } = useTranslation('admin')
  const { isGlobalAdmin } = useAuth()
  const [status, setStatus] = useState<RegStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'push' | 'link' | null>(null)
  const [failed, setFailed] = useState(false)
  // Stops the long push-poll loop when the row is collapsed / page left.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const [fetchKey, setFetchKey] = useState(0)

  // Refetch trigger for event handlers (retry, after push, after link). The
  // effect below only sets state in async callbacks — never synchronously.
  const refetch = useCallback(() => {
    setLoading(true)
    setFailed(false)
    setFetchKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!isGlobalAdmin) return
    let alive = true
    kscwApi<RegStatus>(`/clubdesk-registration-status?registration_id=${encodeURIComponent(registrationId)}`)
      .then((s) => { if (alive) { setStatus(s); setLoading(false) } })
      .catch(() => { if (alive) { setFailed(true); setLoading(false) } })
    return () => { alive = false }
  }, [isGlobalAdmin, registrationId, fetchKey])

  const push = useCallback(async () => {
    if (busy || !status?.member_id) return
    setBusy('push')
    try {
      // Re-check right before pushing — the expanded row's status can be stale
      // (another admin's push, a sync-down link). The backend refuses ineligible
      // ids too (409 not_eligible); this keeps the common case a clean UI update
      // instead of an error.
      const fresh = await kscwApi<RegStatus>(
        `/clubdesk-registration-status?registration_id=${encodeURIComponent(registrationId)}`,
      )
      if (fresh.status !== 'not_in_clubdesk') {
        setStatus(fresh)
        toast.info(t('cdRegStatusChanged'))
        return
      }
      await kscwApi('/clubdesk-member-sync/up', { method: 'POST', body: { member_ids: [status.member_id] } })
      const deadline = Date.now() + 240_000
      for (;;) {
        await new Promise((r) => setTimeout(r, 5_000))
        if (!aliveRef.current) return
        const s = await kscwApi<UpStatus>('/clubdesk-member-sync/up-status')
        if (s.state === 'done') break
        if (s.state === 'failed') throw new Error(s.message || t('clubdeskUpFailed'))
        if (Date.now() > deadline) {
          toast.info(t('clubdeskUpTimeout'))
          refetch()
          return
        }
      }
      toast.success(t('cdRegPushDone'))
      refetch()
    } catch (e) {
      const body = (e as { body?: { state?: string; code?: string; error?: string } })?.body
      // `code` before `state`: a sync-down block also reports a queued/running
      // state (the DOWN one), which would otherwise read as "sync-up running".
      if (body?.code === 'down_in_progress') {
        toast.info(t('clubdeskUpBlockedByDown'))
      } else if (body?.state === 'queued' || body?.state === 'running') {
        toast.info(t('clubdeskUpInProgress'))
      } else if (body?.code === 'not_eligible') {
        toast.info(t('cdRegStatusChanged'))
        refetch()
      } else {
        toast.error(body?.error || (e as Error).message || t('clubdeskUpFailed'))
      }
    } finally {
      setBusy(null)
    }
  }, [busy, status, registrationId, t, refetch])

  const link = useCallback(async () => {
    if (busy || !status?.member_id || !status.clubdesk_id) return
    setBusy('link')
    try {
      await kscwApi('/clubdesk-link', {
        method: 'POST',
        body: { member_id: status.member_id, clubdesk_id: status.clubdesk_id },
      })
      toast.success(t('cdRegLinkDone'))
      refetch()
    } catch (e) {
      toast.error((e as { body?: { error?: string } })?.body?.error || (e as Error).message || t('cdRegLinkFailed'))
    } finally {
      setBusy(null)
    }
  }, [busy, status, t, refetch])

  if (!isGlobalAdmin) return null

  let content
  if (loading) {
    content = (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('cdRegChecking')}
      </div>
    )
  } else if (failed || !status) {
    content = (
      <div className="flex flex-wrap items-center gap-2 text-sm text-red-600 dark:text-red-400">
        <CircleAlert className="h-4 w-4 shrink-0" />
        {t('cdRegCheckFailed')}
        <Button type="button" variant="outline" size="sm" onClick={refetch} className="ml-auto min-h-[44px] gap-1.5 sm:min-h-0">
          <RefreshCw className="h-3.5 w-3.5" />
          {t('cdRegRetry')}
        </Button>
      </div>
    )
  } else if (status.status === 'linked') {
    content = (
      <div className="flex flex-wrap items-center gap-2 text-sm text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {t('cdRegLinked')}
        {status.clubdesk_id && (
          <span className="text-xs text-gray-500 dark:text-gray-400">({status.clubdesk_id})</span>
        )}
      </div>
    )
  } else if (status.status === 'match_unlinked') {
    const contactHint = [status.clubdesk_name, status.clubdesk_email].filter(Boolean).join(' · ')
    content = status.duplicate_of ? (
      <div className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
        <CircleAlert className="h-4 w-4 shrink-0" />
        {t('cdRegDuplicate', { name: status.duplicate_of.name })}
      </div>
    ) : status.ambiguous ? (
      <div className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
        <CircleAlert className="h-4 w-4 shrink-0" />
        {t('cdRegAmbiguous')}
      </div>
    ) : (
      <div className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
        <CircleAlert className="h-4 w-4 shrink-0" />
        <span>
          {t('cdRegMatchUnlinked')}
          {contactHint && (
            <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">({contactHint})</span>
          )}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={link} disabled={!!busy} className="ml-auto min-h-[44px] gap-1.5 sm:min-h-0">
          {busy === 'link' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
          {t('cdRegLink')}
        </Button>
      </div>
    )
  } else if (status.status === 'pushed_pending') {
    content = (
      <div className="flex flex-wrap items-center gap-2 text-sm text-blue-700 dark:text-blue-400">
        <Clock className="h-4 w-4 shrink-0" />
        {t('cdRegPushedPending')}
      </div>
    )
  } else if (status.status === 'no_member') {
    content = (
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <CircleAlert className="h-4 w-4 shrink-0" />
        {t('cdRegNoMember')}
      </div>
    )
  } else {
    // not_in_clubdesk
    content = (
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <CircleAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        {busy === 'push' ? t('clubdeskUpPushing') : t('cdRegNotIn')}
        <Button type="button" variant="outline" size="sm" onClick={push} disabled={!!busy} className="ml-auto min-h-[44px] gap-1.5 sm:min-h-0">
          {busy === 'push' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpFromLine className="h-3.5 w-3.5" />}
          {t('cdRegSync')}
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {t('cdRegZoneTitle')}
      </h4>
      <div className="rounded-md border border-gray-200 px-3 py-2.5 dark:border-gray-700">{content}</div>
    </div>
  )
}
