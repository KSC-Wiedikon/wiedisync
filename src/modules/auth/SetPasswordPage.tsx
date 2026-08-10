import { useState, type FormEvent } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { kscwApi } from '../../lib/api'
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
  const resetToken = searchParams.get('token') ?? ''

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
      })
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <img
            src={theme === 'light' ? '/wiedisync_blau.png' : '/wiedisync_weiss.png'}
            alt="KSC Wiedikon"
            className="h-16 w-auto"
          />
        </div>

        <div className="rounded-xl bg-white p-6 shadow-lg sm:p-8 dark:bg-gray-800">
          {phase === 'success' ? (
            <div className="text-center space-y-4">
              <p className="text-sm text-green-600 dark:text-green-400">{t('resetSuccess')}</p>
              <Link to="/login" className="inline-block text-sm text-brand-600 hover:text-brand-500 dark:text-brand-400">
                {t('backToLogin')}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-center text-xl font-bold text-gray-900 dark:text-gray-100">
                {phaseTitle[phase]}
              </h1>
              {phaseDescription[phase] && (
                <p className="mt-1 mb-5 text-center text-sm text-gray-500 dark:text-gray-400">
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

                  {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

                  <Button type="submit" loading={loading} className="w-full">
                    {loading ? t('resetLinkSending') : t('resetLinkButton')}
                  </Button>

                  {/* Members who have an account but never chose a password get
                      no useful link — mode 2 would mail one, but the OTP path
                      is the flow they were told about. Keep it one click away. */}
                  <button
                    type="button"
                    onClick={() => { setError(null); setPhase('email') }}
                    className="block min-h-[44px] w-full text-center text-sm text-brand-600 hover:text-brand-500 dark:text-brand-400"
                  >
                    {t('resetUseCodeInstead')}
                  </button>
                </form>
              )}

              {phase === 'link-sent' && (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {t('resetLinkSentInfo', { email: email.trim().toLowerCase() })}
                  </p>
                  <button
                    type="button"
                    onClick={() => { setError(null); setPhase('email') }}
                    className="block min-h-[44px] w-full text-center text-sm text-brand-600 hover:text-brand-500 dark:text-brand-400"
                  >
                    {t('resetUseCodeInstead')}
                  </button>
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

                  {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

                  <Button type="submit" loading={loading} disabled={!turnstileReady} className="w-full">
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
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t('passwordRequirements')}</p>

                  {error && (
                    <div className="text-sm text-red-600 dark:text-red-400">
                      <p>{error}</p>
                      {noAccount && (
                        <>
                          {/* Members whose club address differs from the one
                              they typed land here (a personal Gmail vs. the
                              address on file). Signing up would create a
                              duplicate, so offer that second. */}
                          <p className="mt-2 text-gray-500 dark:text-gray-400">{t('noAccountFoundHint')}</p>
                          <p className="mt-2">
                            <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                              {t('signUp')} →
                            </Link>
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  <Button type="submit" loading={loading} className="w-full">
                    {loading ? t('resettingPassword') : t('resetPasswordButton')}
                  </Button>
                </form>
              )}

              <div className="mt-4 text-center">
                <Link to="/login" className="text-sm text-brand-600 hover:text-brand-500 dark:text-brand-400">
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
