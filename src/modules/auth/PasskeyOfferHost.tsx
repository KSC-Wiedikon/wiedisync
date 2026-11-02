import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Fingerprint } from 'lucide-react'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'
import { useAuth } from '../../hooks/useAuth'
import type { PasskeyOffer } from '../../hooks/usePasskeyOffer'
import {
  dismissPasskeyOffer, isPasskeyAlreadyHere, isPasskeyCancel, passkeyErrorCode, passkeyErrorText,
  rememberPasskeyHere, setUpPasskey,
} from '../../lib/passkeys'

interface PasskeyOfferHostProps {
  offer: PasskeyOffer | null
  /** The password just typed at sign-in (usePasskeyOffer holds it; null once closed). */
  password: () => string | null
  onClose: () => void
}

/**
 * "Sign in faster next time?" — shown once after a password sign-in on a device that
 * can keep a passkey (usePasskeyOffer decides). Rendered by AuthProvider, so it outlives
 * the sign-in page and works in all three apps.
 */
export default function PasskeyOfferHost({ offer, password, onClose }: PasskeyOfferHostProps) {
  const { isActingForOther } = useAuth()
  if (!offer || isActingForOther) return null
  return <PasskeyOfferDialog key={offer.memberId} memberId={offer.memberId} password={password} onClose={onClose} />
}

function PasskeyOfferDialog({ memberId, password, onClose }: { memberId: string; password: () => string | null; onClose: () => void }) {
  const { t } = useTranslation('auth')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The account has an authenticator app: the server wants its code too.
  const [needCode, setNeedCode] = useState(false)
  const [code, setCode] = useState('')

  const decline = () => {
    dismissPasskeyOffer(memberId)
    onClose()
  }

  async function accept(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const typed = password()
    if (!typed) { onClose(); return }
    setError('')
    setBusy(true)
    try {
      const { passkey, onDevice } = await setUpPasskey({ password: typed, otp: needCode ? code.trim() : undefined })
      rememberPasskeyHere(memberId, passkey.credential_id, onDevice)
      toast.success(t('passkeySetUpDone'))
      onClose()
    } catch (err) {
      if (isPasskeyCancel(err)) return
      if (isPasskeyAlreadyHere(err)) {
        // A key for this account is already on this device (e.g. synced from a phone).
        rememberPasskeyHere(memberId, null, false)
        toast(t('passkeyErrAlreadyHere'))
        onClose()
        return
      }
      if (passkeyErrorCode(err) === 'otp_required') {
        setNeedCode(true)
        return
      }
      setError(passkeyErrorText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      // Swiping the sheet away or Escape is a "Not now" too — but not while the device's sheet is up.
      onClose={() => { if (!busy) decline() }}
      title={t('passkeyOfferTitle')}
      size="sm"
      hideClose={busy}
    >
      <form onSubmit={accept} className="space-y-4" data-testid="passkey-offer">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-primary dark:bg-brand-900/30 dark:text-brand-300">
            <Fingerprint className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="min-w-0 text-sm text-muted-foreground">{t('passkeyOfferBody')}</p>
        </div>
        {needCode && (
          <FormInput
            id="passkey-offer-otp"
            label={t('passkeyOtpLabel')}
            helperText={t('passkeyOtpNeeded')}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
          />
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground/80">{t('passkeyPrivacy')}</p>
        <div className="flex flex-col-reverse gap-2 border-t border-hairline pt-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={decline} disabled={busy}>
            {t('passkeyNotNow')}
          </Button>
          <Button type="submit" loading={busy} icon={<Fingerprint />} disabled={needCode && code.length < 6}>
            {busy ? t('passkeyWaiting') : t('passkeySetUp')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
