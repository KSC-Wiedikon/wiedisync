import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Fingerprint } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'
import { cn } from '@/lib/utils'
import { safeReturnPath } from '../../utils/activityLinks'
import { safeWieplayReturn } from '../../utils/wieplayReturn'
import { API_URL } from '../../lib/api'
import SupportContact from '@/components/SupportContact'
import LanguageDropdown from '@/components/LanguageDropdown'
import { anyPasskeyHere, isPasskeyCancel, passkeyErrorText, passkeysPossible } from '../../lib/passkeys'

export default function LoginPage() {
  const { login, loginWithPasskey, user } = useAuth()
  const { theme } = useTheme()
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as { email?: string; accountExists?: boolean; sharedEmail?: boolean } | null

  // Where to land after a successful login. AuthRoute puts the attempted path
  // here so a shared deep link (`/events/42`) survives the detour through the
  // login screen; validated against AuthRoute's own rule, never trusted raw.
  const nextParam = new URLSearchParams(location.search).get('next')
  const returnTo = safeReturnPath(nextParam) ?? '/'
  // WiePlay (wieplay.kscw.ch) sends people here to log in, then back to its bridge on the
  // API host — the only absolute `next` accepted (see utils/wieplayReturn.ts).
  const wieplayReturn = safeWieplayReturn(nextParam, API_URL)

  const [email, setEmail] = useState(() => {
    if (locationState?.email) {
      sessionStorage.setItem('login-redirect-email', locationState.email)
      return locationState.email
    }
    return sessionStorage.getItem('login-redirect-email') ?? ''
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Passkeys (lib/passkeys.ts): only on the club's own hosts with WebAuthn. Decided once
  // per visit. Somebody set one up or used one in this browser → the passkey leads.
  const [canPasskey] = useState(() => passkeysPossible())
  const [passkeyFirst] = useState(() => canPasskey && anyPasskeyHere())
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [passkeyError, setPasskeyError] = useState('')
  const [showAccountExists, setShowAccountExists] = useState(() => {
    if (locationState?.accountExists) {
      sessionStorage.setItem('login-redirect-exists', 'true')
      return true
    }
    const stored = sessionStorage.getItem('login-redirect-exists') === 'true'
    if (stored) sessionStorage.removeItem('login-redirect-exists')
    return stored
  })
  // Same lifetime as showAccountExists: a family address whose login belongs
  // to a sibling/parent. Explains the household switch instead of a bare
  // "account exists", which read as "register the child with another email".
  const [showSharedEmail] = useState(() => {
    if (locationState?.sharedEmail) {
      sessionStorage.setItem('login-redirect-shared', 'true')
      return true
    }
    const stored = sessionStorage.getItem('login-redirect-shared') === 'true'
    if (stored) sessionStorage.removeItem('login-redirect-shared')
    return stored
  })
  useEffect(() => {
    if (!user) return
    if (wieplayReturn) window.location.assign(wieplayReturn)
    else navigate(returnTo, { replace: true })
  }, [user, navigate, returnTo, wieplayReturn])

  // Where a successful sign-in goes — the same for the password and the passkey.
  function finishSignIn() {
    sessionStorage.removeItem('login-redirect-email')
    sessionStorage.removeItem('login-redirect-exists')
    sessionStorage.removeItem('login-redirect-shared')
    if (wieplayReturn) window.location.assign(wieplayReturn)
    else navigate(returnTo, { replace: true })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setPasskeyError('')
    setLoading(true)
    setShowAccountExists(false)
    try {
      await login(email, password)
      finishSignIn()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      if (!navigator.onLine || msg.includes('fetch') || msg.includes('network')) {
        setError(t('networkError'))
      } else if (msg.includes('429') || msg.includes('too many')) {
        setError(t('tooManyRequests'))
      } else {
        setError(t('invalidCredentials'))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handlePasskey() {
    if (passkeyBusy || loading) return
    setError('')
    setPasskeyError('')
    setShowAccountExists(false)
    setPasskeyBusy(true)
    try {
      await loginWithPasskey()
      finishSignIn()
    } catch (err: unknown) {
      // Closing the device's sheet is not an error. Anything else: say so; the password form stays.
      if (!isPasskeyCancel(err)) setPasskeyError(passkeyErrorText(t, err))
    } finally {
      setPasskeyBusy(false)
    }
  }

  const passkeyBlock = canPasskey && (
    <div>
      <Button
        type="button"
        variant={passkeyFirst ? 'default' : 'outline'}
        onClick={handlePasskey}
        loading={passkeyBusy}
        disabled={loading}
        icon={<Fingerprint />}
        className={cn('h-12 w-full rounded-xl font-semibold sm:h-12', passkeyFirst && 'shadow-sm shadow-primary/20')}
        data-testid="passkey-sign-in"
      >
        {passkeyBusy ? t('passkeyWaiting') : t('passkeySignIn')}
      </Button>
      {passkeyError && (
        <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {passkeyError}
        </p>
      )}
    </div>
  )
  const orDivider = (
    <div className="my-5 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('passkeyOr')}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 via-stone-50 to-stone-100 p-4 dark:from-background dark:via-background dark:to-card/40">
      <div className="w-full max-w-sm">
        <div className="mb-2 flex justify-end">
          <LanguageDropdown size="sm" />
        </div>
        <div className="relative w-full overflow-hidden rounded-3xl border border-hairline bg-card p-6 shadow-card-lg sm:p-8">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 to-brand-400" />
          <div className="mb-6 flex justify-center">
            <img
              src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
              alt="KSC Wiedikon"
              className="h-11 w-auto"
            />
          </div>
          <h1 className="mb-6 text-center text-xl font-bold tracking-tight text-foreground">
            {t('signIn')}
          </h1>

          {showAccountExists && (
            <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-center text-sm font-medium text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300">
              {t('accountAlreadyExists')}
              {showSharedEmail && (
                <p className="mt-1 text-xs font-normal">{t('sharedEmailHouseholdHint')}</p>
              )}
            </div>
          )}

          {passkeyFirst && (
            <>
              {passkeyBlock}
              {orDivider}
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <FormInput
              type="email"
              label={t('email')}
              className="h-12 rounded-xl bg-surface-sunken focus:bg-card sm:h-12 dark:bg-surface-sunken dark:focus:bg-card"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder={t('emailPlaceholder')}
            />

            <div>
              <FormInput
                type="password"
                label={t('password')}
                className="h-12 rounded-xl bg-surface-sunken focus:bg-card sm:h-12 dark:bg-surface-sunken dark:focus:bg-card"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder={t('passwordPlaceholder')}
              />
              <div className="mt-1 text-right">
                <Link
                  to={email.trim() ? `/set-password?email=${encodeURIComponent(email.trim())}` : '/set-password'}
                  className="text-sm font-medium text-primary hover:text-primary/80 dark:text-brand-300 dark:hover:text-brand-200"
                >
                  {t('forgotPassword')}
                </Link>
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</p>
            )}

            {/* One filled button per card: when the passkey leads, the password button steps back. */}
            <Button
              type="submit"
              variant={passkeyFirst ? 'outline' : 'default'}
              loading={loading}
              disabled={passkeyBusy}
              className={cn('h-12 w-full rounded-xl font-semibold sm:h-12', !passkeyFirst && 'shadow-sm shadow-primary/20')}
            >
              {loading ? t('signingIn') : t('signIn')}
            </Button>
          </form>

          {canPasskey && !passkeyFirst && (
            <>
              {orDivider}
              {passkeyBlock}
            </>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t('noAccountYet')}{' '}
            <Link to="/signup" className="font-medium text-primary hover:text-primary/80 dark:text-brand-300 dark:hover:text-brand-200">
              {t('signUp')}
            </Link>
          </p>
        </div>
        <SupportContact className="mt-4" />
      </div>
    </div>
  )
}
