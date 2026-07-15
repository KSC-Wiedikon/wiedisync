import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Badge } from '../../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table'
import { useConfirm } from '../../../components/ConfirmProvider'
import { kscwApi, SCHEDULING_ORIGIN } from '../../../lib/api'
import type { GameSchedulingSeason } from '../../../types'

interface ClubPortal {
  id: number
  club_id: string
  club_name: string | null
  token: string
  status: string
  contact_email: string | null
  email_sent_at: string | null
}

interface Props {
  season: GameSchedulingSeason
  onUpdateSeason: (id: string, patch: Partial<GameSchedulingSeason>) => Promise<unknown>
}

const STATUS_VARIANT: Record<string, 'neutral' | 'warning' | 'success'> = {
  invited: 'neutral', viewed: 'warning', booked: 'success',
}

export default function ClubPortalsPanel({ season, onUpdateSeason }: Props) {
  const { t } = useTranslation('gameScheduling')
  const confirm = useConfirm()
  const [portals, setPortals] = useState<ClubPortal[]>([])
  // Starts true so the effect need not setState synchronously (react-hooks
  // set-state-in-effect); flipped false only after the fetch resolves.
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const enabled = !!season.use_club_portals

  const fetchPortals = useCallback(async () => {
    if (!enabled) return
    try {
      const r = await kscwApi(`/admin/terminplanung/club-portals?season=${season.id}`) as { portals: ClubPortal[] }
      setPortals(r.portals || [])
    } catch { /* non-blocking */ } finally { setLoading(false) }
  }, [enabled, season.id])

  // Effect-local async wrapper — fetchPortals only setStates after the await, so
  // the effect body itself performs no synchronous state update (React's
  // documented data-fetching shape; mirrors InvitesPanel).
  useEffect(() => {
    async function run() { await fetchPortals() }
    void run()
  }, [fetchPortals])

  const enable = async () => {
    setBusy(true)
    try {
      await onUpdateSeason(String(season.id), { use_club_portals: true })
      toast.success(t('clubPortalsEnabledToast'))
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const ensure = async () => {
    setBusy(true)
    try {
      const r = await kscwApi('/admin/terminplanung/club-portals/ensure', { method: 'POST', body: { season: season.id } }) as { created: number; refreshed: number; portals: ClubPortal[] }
      setPortals(r.portals || [])
      toast.success(t('clubPortalsGenerated', { created: r.created, refreshed: r.refreshed }))
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const send = async (ids: number[] | null) => {
    const count = ids ? ids.length : portals.length
    if (!(await confirm({ message: t('clubPortalsSendConfirm', { count }) }))) return
    setBusy(true)
    try {
      const r = await kscwApi('/admin/terminplanung/club-portals/send', { method: 'POST', body: { season: season.id, ...(ids ? { ids } : {}) } }) as { sent: number; failed: unknown[] }
      toast.success(t('clubPortalsSent', { sent: r.sent }))
      if (r.failed?.length) toast.error(t('clubPortalsSendFailed', { count: r.failed.length }))
      await fetchPortals()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${SCHEDULING_ORIGIN}/terminplanung/club/${token}`)
      toast.success(t('clubPortalLinkCopied'))
    } catch { /* clipboard blocked */ }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{t('clubPortals')}</CardTitle>
        {enabled && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={ensure} disabled={busy}>{t('clubPortalsRefresh')}</Button>
            <Button size="sm" onClick={() => send(null)} disabled={busy || portals.length === 0}>{t('clubPortalsEmailAll')}</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('clubPortalsIntro')}</p>

        {!enabled ? (
          <div className="rounded border border-dashed border-gray-300 p-4 text-center dark:border-gray-700">
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">{t('clubPortalsEnableHint')}</p>
            <Button onClick={enable} disabled={busy}>{t('clubPortalsEnable')}</Button>
          </div>
        ) : loading ? (
          <div className="py-6 text-center text-sm text-gray-500">Laden…</div>
        ) : portals.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 py-6 text-center text-sm text-gray-500 dark:border-gray-700">
            {t('clubPortalsEmpty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('clubPortalColClub')}</TableHead>
                  <TableHead>{t('clubPortalColStatus')}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t('clubPortalColRecipients')}</TableHead>
                  <TableHead className="text-right">{t('clubPortalColActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-normal break-words font-medium">{p.club_name || p.club_id}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[p.status] || 'neutral'} size="sm">{p.status}</Badge>
                      {p.email_sent_at && <span className="ml-2 text-xs text-gray-400">✓</span>}
                    </TableCell>
                    <TableCell className="hidden whitespace-normal break-words text-xs text-gray-500 sm:table-cell dark:text-gray-400">{p.contact_email || '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => copyLink(p.token)}>{t('clubPortalCopyLink')}</Button>
                        <Button variant="outline" size="sm" onClick={() => send([p.id])} disabled={busy || !p.contact_email}>{t('clubPortalSend')}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
