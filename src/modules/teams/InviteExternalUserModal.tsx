import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import Modal from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { kscwApi } from '../../lib/api'

type GuestLevel = 0 | 1 | 2 | 3

interface Props {
  open: boolean
  onClose: () => void
  teamId: string
  teamName: string
}

const GUEST_LEVELS: GuestLevel[] = [0, 1, 2, 3]

export default function InviteExternalUserModal({ open, onClose, teamId, teamName }: Props) {
  const { t } = useTranslation(['teams', 'common'])

  const [selectedLevel, setSelectedLevel] = useState<GuestLevel>(0)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const handleClose = useCallback(() => {
    setSelectedLevel(0)
    setQrUrl(null)
    setLoading(false)
    setError(null)
    setCopied(false)
    onClose()
  }, [onClose])

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    try {
      const res = await kscwApi<{ url?: string; invite_url?: string; link?: string }>('/team-invites/create', {
        method: 'POST',
        body: { team: teamId, guest_level: selectedLevel },
      })
      setQrUrl(res.url ?? res.invite_url ?? res.link ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:error'))
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!qrUrl) return
    try {
      await navigator.clipboard.writeText(qrUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('common:error'))
    }
  }

  const levelLabel = (level: GuestLevel) => {
    if (level === 0) return t('teams:player')
    return `${t('teams:guest')} L${level}`
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('teams:inviteExternalUser')}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('teams:inviteExternalUserDesc', { teamName })}
        </p>

        {!qrUrl ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('teams:joinAs')}
              </p>
              <div className="flex flex-wrap gap-2">
                {GUEST_LEVELS.map((level) => (
                  <button
                    key={level}
                    onClick={() => setSelectedLevel(level)}
                    className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                      selectedLevel === level
                        ? 'border-brand-500 bg-brand-500 text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-brand-400 hover:text-brand-600 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-brand-500 dark:hover:text-brand-400'
                    }`}
                  >
                    {levelLabel(level)}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                {t('common:close')}
              </Button>
              <Button size="sm" onClick={handleGenerate} disabled={loading}>
                {loading ? t('common:loading') : t('teams:generateQR')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 py-2">
              <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-white">
                <QRCodeSVG value={qrUrl} size={200} />
              </div>
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                {t('teams:inviteLinkExpiry')}
              </p>
              <p className="max-w-xs break-all text-center text-xs text-gray-400 dark:text-gray-500">
                {qrUrl}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={handleClose}>
                {t('common:close')}
              </Button>
              <Button size="sm" onClick={handleCopy} disabled={copied}>
                {copied ? t('common:copied') : t('teams:copyLink')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
