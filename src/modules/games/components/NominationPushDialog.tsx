import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { kscwApi } from '@/lib/api'
import { hasApiErrorCode } from '@/lib/apiErrorCode'

type OfficialRole = 'coach' | 'assistant_coach_1' | 'assistant_coach_2'
type Official = { keep: true } | { member: number; name: string | null; license_nr: string | null } | null

interface Preview {
  players: { member: number; name: string; license_nr: string | null }[]
  officials: Record<OfficialRole, Official>
  officials_source: 'game' | 'team'
  status: string | null
  exists: boolean
  closed: boolean
  started: boolean
}

const ROLE_LABEL: Record<OfficialRole, string> = {
  coach: 'C',
  assistant_coach_1: 'AC1',
  assistant_coach_2: 'AC2',
}

/**
 * "Create / Update Einsatzliste" — shows what the push would send (confirmed RSVPs +
 * C/AC1/AC2) before anything reaches Volleymanager, and warns that a re-save replaces
 * the list already saved there. The push itself runs in the background worker; the
 * status box in GameDetailModal reports the outcome.
 */
export default function NominationPushDialog({ gameId, open, onClose, onStarted }: {
  gameId: string | number
  open: boolean
  onClose: () => void
  onStarted: () => void
}) {
  const { t } = useTranslation('games')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    kscwApi<{ data: Preview }>(`/games/${gameId}/nomination-preview`)
      .then((r) => { if (!cancelled) { setPreview(r.data); setLoadError(false) } })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [open, gameId])

  const exists = !!preview?.exists
  const licensed = preview?.players.filter((p) => p.license_nr) ?? []
  const unlicensed = preview?.players.filter((p) => !p.license_nr) ?? []

  async function push() {
    setSending(true)
    try {
      await kscwApi(`/games/${gameId}/nomination-push`, { method: 'POST' })
      toast.success(t('nominationPushStarted'))
      onStarted()
      onClose()
    } catch (err) {
      if (hasApiErrorCode(err, 'vm_account_busy')) toast.error(t('nominationPushBusy'))
      else if (hasApiErrorCode(err, 'push_in_flight')) toast.error(t('nominationPushInFlight'))
      else if (hasApiErrorCode(err, 'game_started')) toast.error(t('nominationPushStartedGame'))
      else toast.error(t('nominationPushFailed'))
    } finally {
      setSending(false)
    }
  }

  function officialText(o: Official): string {
    if (o === null) return t('nominationOfficialEmpty')
    if ('keep' in o) return t('nominationOfficialKeep')
    const name = o.name || t('nominationOfficialUnknown')
    return o.license_nr ? name : `${name} — ${t('nominationNoLicence')}`
  }

  return (
    <Modal open={open} onClose={onClose} title={t(exists ? 'nominationUpdateTitle' : 'nominationCreateTitle')} size="md">
      {loadError && <p className="text-sm text-destructive">{t('nominationPreviewError')}</p>}
      {!preview && !loadError && <p className="text-sm text-muted-foreground">{t('common:loading')}</p>}
      {preview && (
        <div className="space-y-4">
          {exists && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t('nominationAmendWarning')}</span>
            </div>
          )}

          <div>
            <h4 className="mb-1 text-sm font-semibold text-foreground">
              {t('nominationPreviewPlayers', { n: licensed.length })}
            </h4>
            {preview.players.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('nominationPreviewNoPlayers')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('nominationPreviewName')}</TableHead>
                    <TableHead>{t('nominationPreviewLicence')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.players.map((p) => (
                    <TableRow key={p.member} className="min-h-11">
                      <TableCell className="whitespace-normal">{p.name}</TableCell>
                      <TableCell className={p.license_nr ? 'tabular-nums' : 'text-amber-700 dark:text-amber-300'}>
                        {p.license_nr ?? t('nominationNoLicence')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {unlicensed.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">{t('nominationPreviewUnlicensedHint')}</p>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-sm font-semibold text-foreground">{t('nominationPreviewOfficials')}</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {(Object.keys(ROLE_LABEL) as OfficialRole[]).map((role) => (
                <div key={role} className="contents">
                  <dt className="font-medium text-muted-foreground">{ROLE_LABEL[role]}</dt>
                  <dd className="min-w-0 text-foreground">{officialText(preview.officials[role])}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(preview.officials_source === 'game' ? 'nominationOfficialsFromSheet' : 'nominationOfficialsFromTeam')}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">{t('nominationPreviewEligibilityHint')}</p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose}>{t('common:cancel')}</Button>
            <Button
              onClick={push}
              disabled={sending || preview.started || preview.closed || licensed.length === 0}
            >
              {t(exists ? 'nominationUpdateCta' : 'nominationCreateCta')}
            </Button>
          </div>
          {preview.started && <p className="text-xs text-muted-foreground">{t('nominationPushStartedGame')}</p>}
          {preview.closed && <p className="text-xs text-muted-foreground">{t('nominationStatusClosed')}</p>}
        </div>
      )}
    </Modal>
  )
}
