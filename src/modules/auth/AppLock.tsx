import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Fingerprint } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '../../hooks/useTheme'
import { useAppLock } from '../../hooks/useAppLock'
import { usePasskeyHint } from '../../hooks/usePasskeyHint'
import type { MemberUser } from '../../hooks/useAuth'
import { passkeysPossible, unlockOnThisDevice } from '../../lib/passkeys'

interface AppLockProps {
  /** The session owner (the lock is hers, also while she acts for a household member). */
  member: MemberUser | null
  /** The session was restored at a cold start (AuthProvider's init effect). */
  restored: boolean
  onSignOut: () => void
}

/**
 * The optional app lock (Profile → Passkeys → "Ask for fingerprint when opening the
 * app", off by default): a full-screen curtain after a cold start with a restored session
 * and after ≥ 5 minutes in the background (useAppLock). Unlocking is a local check on
 * this device — offline too — never a sign-in; the session behind it stays as it was.
 */
export default function AppLock({ member, restored, onSignOut }: AppLockProps) {
  const hint = usePasskeyHint(member?.id)
  const enabled = !!member && hint.lock && hint.credentialIds.length > 0 && passkeysPossible()
  const { locked, unlock } = useAppLock({ enabled, lockOnStart: restored })
  if (!locked || !member) return null
  return <LockScreen member={member} onUnlocked={unlock} onSignOut={onSignOut} />
}

function LockScreen({ member, onUnlocked, onSignOut }: { member: MemberUser; onUnlocked: () => void; onSignOut: () => void }) {
  const { t } = useTranslation('auth')
  const { theme } = useTheme()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim()

  // From the tap only: Safari refuses a passkey request without a user gesture.
  async function tryUnlock() {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const result = await unlockOnThisDevice(member.id)
      if (result === 'ok') onUnlocked()
      else if (result === 'refused') setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-lock-name"
      data-testid="app-lock"
      // Above toasts (60) and connection banners (70); opaque, so nothing shows through.
      // pointer-events-auto: an open Radix dialog underneath sets `pointer-events: none` on <body>.
      className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-gradient-to-br from-stone-100 via-stone-50 to-stone-100 p-4 pt-safe pb-safe dark:from-background dark:via-background dark:to-card"
    >
      <div className="w-full max-w-sm">
        <div className="relative w-full overflow-hidden rounded-3xl border border-hairline bg-card p-6 text-center shadow-card-lg sm:p-8">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 to-brand-400" />
          <div className="mb-6 flex justify-center">
            <img
              src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
              alt="KSC Wiedikon"
              className="h-11 w-auto"
            />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('passkeyLocked')}</p>
          <h1 id="app-lock-name" className="mt-1 break-words text-xl font-bold tracking-tight text-foreground">{name || '—'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('passkeyUnlockHint')}</p>
          {failed && (
            <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {t('passkeyUnlockFailed')}
            </p>
          )}
          <Button
            onClick={tryUnlock}
            loading={busy}
            icon={<Fingerprint />}
            autoFocus
            className="mt-6 h-12 w-full rounded-xl font-semibold shadow-sm shadow-primary/20 sm:h-12"
          >
            {busy ? t('passkeyWaiting') : t('passkeyUnlock')}
          </Button>
          <Button variant="ghost" onClick={onSignOut} disabled={busy} className="mt-2 w-full">
            {t('logout')}
          </Button>
        </div>
      </div>
    </div>
  )
}
