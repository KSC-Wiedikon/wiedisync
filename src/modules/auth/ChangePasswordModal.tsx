import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import Modal from '@/components/Modal'
import { Button } from '@/components/ui/button'
import { kscwApi } from '../../lib/api'
import { rewrapPrivateKey } from '../../lib/e2ee'
import { useIdentityKeys } from '../../hooks/useIdentityKeys'
import { checkPassword, passwordErrorKeyFromCode, passwordIssueKey } from '../../lib/passwordRules'

interface ChangePasswordModalProps {
  onClose: () => void
}

/**
 * Change your password WITHOUT losing your encryption key.
 *
 * The club's other password paths — the "forgot password" email link, the OTP flow, an
 * admin reset — never hold the old plaintext, so they cannot re-wrap the key that protects
 * an identity document. They silently orphan it. For a member that means re-uploading their
 * ID; for a coach it means losing the key to every player's ID in their squad.
 *
 * This form has both plaintexts, so it re-wraps the private key HERE, in the browser, and
 * sends the new blob along with the password change. Same keypair, new wrapper: every
 * envelope ever addressed to this member keeps working.
 *
 * The server verifies the current password independently (it will not take our word for it),
 * and refuses the change outright if the account has a key and we failed to send a re-wrap —
 * better a rejected request than a quietly destroyed key.
 */
export default function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const { t } = useTranslation('auth')
  const { state, material } = useIdentityKeys()

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const hasKeys = state === 'locked' || state === 'unlocked'

  const submit = async () => {
    setError(null)
    if (next !== confirm) { setError(t('passwordMismatch')); return }
    // Same rules the server enforces (length + letter and digit/special), caught
    // here while the field is on screen. The common-password list stays
    // server-side — it comes back as the `password_too_common` code below.
    const issue = checkPassword(next)
    if (issue) { setError(issue === 'password_too_short' ? t('pwTooShort') : t(passwordIssueKey(issue))); return }

    setBusy(true)
    try {
      // Re-wrap first. If the current password is wrong, this throws on the AES-GCM auth
      // tag before we have touched anything — so a typo cannot half-apply the change.
      let e2ee
      if (hasKeys && material) {
        const rewrapped = await rewrapPrivateKey(material, current, next)
        e2ee = { private_key: rewrapped.privateKey, salt: rewrapped.salt }
      }

      await kscwApi('/change-password', {
        method: 'POST',
        body: { current_password: current, new_password: next, e2ee },
      })

      toast.success(hasKeys ? t('pwChangedKeyKept') : t('pwChanged'))
      onClose()
    } catch (err) {
      const code = (err as Error & { code?: string }).code
      // A rule the server refused (password_too_short / password_weak /
      // password_too_common) gets its own message instead of the generic one.
      const passwordKey = passwordErrorKeyFromCode(code)
      if (passwordKey) { setError(t(passwordKey)); return }
      // A wrong current password surfaces either as our local unwrap failing or as the
      // server's own check — both mean the same thing to the person typing.
      setError(code === 'bad_password' || !code ? t('pwWrongCurrent') : t('errorSaving'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={t('changePassword')} size="sm">
      <div className="space-y-3">
        {hasKeys && (
          <p className="rounded-xl border border-hairline bg-surface-sunken p-2.5 text-xs leading-relaxed text-muted-foreground">
            {t('pwKeyNotice')}
          </p>
        )}

        {([
          ['current', current, setCurrent, t('pwCurrent'), 'current-password'],
          ['next', next, setNext, t('pwNew'), 'new-password'],
          ['confirm', confirm, setConfirm, t('confirmPassword'), 'new-password'],
        ] as const).map(([key, value, set, label, autoComplete]) => (
          <div key={key}>
            <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`pw-${key}`}>
              {label}
            </label>
            <input
              id={`pw-${key}`}
              type="password"
              autoComplete={autoComplete}
              value={value}
              onChange={(e) => set(e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/20"
            />
          </div>
        ))}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!current || !next || !confirm}
          >
            {t('changePassword')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
