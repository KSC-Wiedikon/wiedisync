import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { kscwApi, logout as apiLogout } from '../../lib/api'
import { FormInput } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { useTurnstile } from '../../lib/turnstile'
import { OtpInput } from '@/components/OtpInput'
import { LANGUAGES } from '@/i18n/languageConfig'
import { PASSWORD_MIN_LENGTH, checkPassword, passwordErrorKeyFromCode, passwordIssueKey } from '@/lib/passwordRules'

type Phase = 'request-link' | 'link-sent' | 'email' | 'otp' | 'set-password' | 'success'

export default function SetPasswordPage() {
  const { t, i18n } = useTranslation('auth')
  const { theme } = useTheme()
  const [searchParams] = useSearchParams()
  const initialEmail = searchParams.get('email') ?? ''
  // Reset links mailed by /kscw/password-request land here as
  // `/set-password?token=…`. This param went unread until 2026-08-05, so every
  // emailed link silently dumped the member on the OTP form instead of the
  // password form — the backend's token mode was unreachable from the app and
  // the tokens it issued were never consumed. With a token we skip straight to
  // the password step and let the token stand in for the OTP.
  //
  // Captured ONCE into state, then stripped from the address bar (below) so the
  // live reset credential does not linger in history, screenshots, Referer
  // headers or error-tracker page URLs. Never re-read from the URL after that.
  const [resetToken] = useState(() => searchParams.get('token') ?? '')
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (!url.searchParams.has('token')) return
      url.searchParams.delete('token')
      // Keep react-router's history state (key/idx) so back/forward still work.
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    } catch { /* best effort */ }
  }, [])

  // Token → password form directly. Everyone else starts on the emailed-link
  // request, which is the only reset that works for an account that already has
  // a password: the OTP path below lands on /set-password mode 3, and mode 3 is
  // initial-password-only — it refuses with `password_already_set` (the
  // Sport-Admin-OTP-takeover fix, 2026-08-08). Until 2026-08-10 "Forgot
  // password" pointed straight at that dead end and the 400 surfaced as "link
  // invalid or expired", so members re-requested codes in a loop. The OTP flow
  // stays reachable one click down for members who never set a password at all.
  const [phase, setPhase] = useState<Phase>(resetToken ? 'set-password' : 'request-link')
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [noAccount, setNoAccount] = useState(false)
  const [loading, setLoading] = useState(false)
  const { widget: turnstileWidget, getToken: getTurnstileToken, ready: turnstileReady } = useTurnstile()

  // Mail a single-use reset link (/kscw/set-password mode 2). Always 204s, so a
  // wrong address is indistinguishable from a right one — the confirmation copy
  // is worded "if an account exists" to match, and there is nothing to reveal by
  // advancing the phase unconditionally.
  async function handleRequestLink(e?: FormEvent) {
    e?.preventDefault()
    if (!email.trim()) return
    setError(null)
    setLoading(true)
    try {
      await kscwApi('/password-request', { method: 'POST', body: { email: email.trim().toLowerCase() } })
      setPhase('link-sent')
    } catch {
      setError(t('resetLinkFailed'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSendOtp(e?: FormEvent) {
    e?.preventDefault()
    if (!email.trim()) return
    setError(null)
    setLoading(true)
    try {
      await kscwApi('/verify-email', {
        method: 'POST',
        body: {
          email: email.trim().toLowerCase(),
          lang: LANGUAGES.find((l) => l.code === i18n.language)?.backendValue ?? 'german',
          turnstile_token: await getTurnstileToken(),
        },
      })
      setPhase('otp')
    } catch {
      setError(t('otpRequestFailed'))
      setPhase('email') // Fall back to email form on failure
    } finally {
      setLoading(false)
    }
  }

  async function handleOtpComplete(code: string) {
    setError(null)
    setLoading(true)
    try {
      const res = await kscwApi<{ verified?: boolean }>('/verify-email/confirm', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), code },
      })
      if (res.verified) {
        setPhase('set-password')
      } else {
        setError(t('otpInvalid'))
      }
    } catch {
      setError(t('otpInvalid'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSetPassword(e: FormEvent) {
    e.preventDefault()
    setError(null)

    // Mirror the backend rules before spending a round trip — the server
    // enforces letter + digit/special too, and a 400 from it used to surface as
    // a bogus "link expired".
    const issue = checkPassword(password)
    if (issue) {
      setError(t(passwordIssueKey(issue)))
      return
    }
    if (password !== passwordConfirm) {
      setError(t('passwordMismatch'))
      return
    }

    setLoading(true)
    try {
      await kscwApi('/set-password', {
        method: 'POST',
        // A reset token authenticates the request on its own; the OTP flow
        // identifies the account by the address it just verified.
        body: resetToken ? { password, token: resetToken } : { password, email: email.trim().toLowerCase() },
        // Send NO session. This page is always recovering a *named* account, and
        // an ambient cookie made the endpoint resolve the logged-in user instead
        // — so a member who was still signed in reset their own password and the
        // emailed token went unused (member 263, 2026-08-10).
        anonymous: true,
      })
      // Whatever session this browser held is gone: the endpoint just changed a
      // password, which invalidates it server-side. Drop the local auth state so
      // the app shows the login form instead of loading a member page with a
      // dead token and firing a 401 per query.
      await apiLogout()
      setPhase('success')
    } catch (err) {
      const code = (err as Error & { code?: string }).code
      const passwordKey = passwordErrorKeyFromCode(code)
      if (passwordKey) {
        // A rule the mirror can't check (common-password list). Say which rule
        // failed instead of blaming the link.
        setNoAccount(false)
        setError(t(passwordKey))
      } else if (code === 'no_account') {
        setNoAccount(true)
        setError(t('noAccountFound'))
      } else if (code === 'password_already_set') {
        // The OTP path only ever sets an INITIAL password. Someone who already
        // has one belongs in the emailed-link flow — send it for them rather
        // than bouncing them back to the start with a message about codes.
        setNoAccount(false)
        try {
          await kscwApi('/password-request', { method: 'POST', body: { email: email.trim().toLowerCase() } })
        } catch { /* 204-only endpoint; the copy below is true either way */ }
        setPhase('link-sent')
      } else {
        setNoAccount(false)
        setError(t('resetError'))
      }
    } finally {
      setLoading(false)
    }
  }

  const phaseTitle = {
    'request-link': t('resetPasswordOtp'),
    'link-sent': t('resetLinkSentTitle'),
    email: t('resetPasswordOtp'),
    otp: t('resetPasswordOtp'),
    'set-password': t('resetPasswordOtp'),
    success: t('resetPasswordOtp'),
  }

  const phaseDescription = {
    'request-link': t('resetLinkDescription'),
    'link-sent': '',
    email: t('resetPasswordOtpEmailDescription'),
    otp: t('resetPasswordOtpDescription'),
    'set-password': t('resetPasswordOtpSetDescription'),
    success: '',
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 via-stone-50 to-stone-100 p-4 dark:from-background dark:via-background dark:to-card/40">
      <div className="w-full max-w-sm">
        <div className="relative w-full overflow-hidden rounded-3xl border border-hairline bg-card p-6 shadow-card-lg sm:p-8">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-600 to-brand-400" />
          <div className="mb-6 flex justify-center">
            <img
              src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
              alt="KSC Wiedikon"
              className="h-11 w-auto"
            />
          </div>
          {phase === 'success' ? (
            <div className="text-center space-y-4">
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">{t('resetSuccess')}</p>
              <Link to="/login" className="inline-block text-sm text-primary hover:text-primary/80 dark:text-brand-300 dark:hover:text-brand-200">
                {t('backToLogin')}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-center text-xl font-bold tracking-tight text-foreground">
                {phaseTitle[phase]}
              </h1>
              {phaseDescription[phase] && (
                <p className="mt-1 mb-5 text-center text-sm text-muted-foreground">
                  {phaseDescription[phase]}
                </p>
              )}

              {phase === 'request-link' && (
                <form onSubmit={handleRequestLink} className="space-y-4">
                  <FormInput
                    type="email"
                    label={t('email')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder={t('emailPlaceholder')}
                    autoFocus
                  />

                  {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

                  <Button type="submit" loading={loading} className="h-12 w-full rounded-xl font-semibold shadow-sm shadow-primary/20 sm:h-12">
                    {loading ? t('resetLinkSending') : t('resetLinkButton')}
                  </Button>

                  {/* Members who have an account but never chose a password get
                      no useful link — mode 2 would mail one, but the OTP path
                      is the flow they were told about. Keep it one click away. */}
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => { setError(null); setPhase('email') }}
                    className="w-full whitespace-normal font-normal text-primary no-underline hover:text-primary/80 hover:no-underline dark:text-brand-300 dark:hover:text-brand-200"
                  >
                    {t('resetUseCodeInstead')}
                  </Button>
                </form>
              )}

              {phase === 'link-sent' && (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t('resetLinkSentInfo', { email: email.trim().toLowerCase() })}
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => { setError(null); setPhase('email') }}
                    className="w-full whitespace-normal font-normal text-primary no-underline hover:text-primary/80 hover:no-underline dark:text-brand-300 dark:hover:text-brand-200"
                  >
                    {t('resetUseCodeInstead')}
                  </Button>
                </div>
              )}

              {phase === 'email' && (
                <form onSubmit={handleSendOtp} className="space-y-4">
                  <FormInput
                    type="email"
                    label={t('email')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder={t('emailPlaceholder')}
                    autoFocus
                  />

                  {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

                  <Button type="submit" loading={loading} disabled={!turnstileReady} className="h-12 w-full rounded-xl font-semibold shadow-sm shadow-primary/20 sm:h-12">
                    {loading ? t('sendingOtp') : t('sendOtp')}
                  </Button>
                </form>
              )}

              {/* Mounted for BOTH phases: the OTP step offers a resend, which is
                  the same captcha-gated endpoint, so unmounting the widget after
                  the first send would break it. */}
              {(phase === 'email' || phase === 'otp') && turnstileWidget}

              {phase === 'otp' && (
                <OtpInput
                  onComplete={handleOtpComplete}
                  onResend={handleSendOtp}
                  loading={loading}
                  error={error ?? undefined}
                  email={email}
                />
              )}

              {phase === 'set-password' && (
                <form onSubmit={handleSetPassword} className="space-y-4">
                  <FormInput
                    label={t('newPassword')}
                    type="password"
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={PASSWORD_MIN_LENGTH}
                    required
                    autoComplete="new-password"
                    autoFocus
                  />

                  <FormInput
                    label={t('confirmPassword')}
                    type="password"
                    placeholder={t('passwordPlaceholder')}
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    minLength={PASSWORD_MIN_LENGTH}
                    required
                    autoComplete="new-password"
                  />

                  {/* State the rules up front — they used to be discoverable
                      only by tripping over a 400 that named the wrong cause. */}
                  <p className="text-xs text-muted-foreground">{t('passwordRequirements')}</p>

                  {error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                      <p>{error}</p>
                      {noAccount && (
                        <>
                          {/* Members whose club address differs from the one
                              they typed land here (a personal Gmail vs. the
                              address on file). Signing up would create a
                              duplicate, so offer that second. */}
                          <p className="mt-2 text-muted-foreground">{t('noAccountFoundHint')}</p>
                          <p className="mt-2">
                            <Link to="/signup" className="font-medium text-primary hover:text-primary/80 dark:text-brand-300 dark:hover:text-brand-200">
                              {t('signUp')} →
                            </Link>
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  <Button type="submit" loading={loading} className="h-12 w-full rounded-xl font-semibold shadow-sm shadow-primary/20 sm:h-12">
                    {loading ? t('resettingPassword') : t('resetPasswordButton')}
                  </Button>
                </form>
              )}

              <div className="mt-4 text-center">
                <Link to="/login" className="text-sm text-primary hover:text-primary/80 dark:text-brand-300 dark:hover:text-brand-200">
                  {t('backToLogin')}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
