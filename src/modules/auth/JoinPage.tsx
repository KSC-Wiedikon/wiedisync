import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { Button } from '@/components/ui/button'
import { useTurnstile } from '../../lib/turnstile'
import { FormInput } from '@/components/FormField'
import { OtpInput } from '../../components/OtpInput'
import { SetPasswordForm } from '../../components/SetPasswordForm'
import LoadingSpinner from '../../components/LoadingSpinner'
import { kscwApi, logout as apiLogout } from '../../lib/api'

interface InviteInfo {
  team_name: string
  role: 'player' | 'guest'
}

type Phase = 'loading' | 'error' | 'form' | 'otp' | 'set-password' | 'success'

/** Invite header shown on form, OTP, and set-password phases */
function InviteHeader({ inviteInfo }: { inviteInfo: InviteInfo | null }) {
  const { t } = useTranslation(['join', 'teams'])
  if (!inviteInfo) return null
  return (
    <div className="text-center">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
        {t('join:title', { teamName: inviteInfo.team_name })}
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">KSC Wiedikon</p>
      <span className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
        inviteInfo.role === 'player'
          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
          : 'bg-gold-100 text-gold-800 dark:bg-gold-400/20 dark:text-gold-300'
      }`}>
        {t('join:joiningAs', {
          role: inviteInfo.role === 'player' ? t('teams:player') : t('teams:guest'),
        })}
      </span>
    </div>
  )
}

export default function JoinPage() {
  const { token } = useParams<{ token: string }>()
  const { theme } = useTheme()
  const { t } = useTranslation(['join', 'teams', 'auth', 'common'])
  const navigate = useNavigate()

  // No token in the URL → nothing to load, the invite is invalid on arrival. The
  // route (`join/:token`) can't match without one, so this can only be the case
  // from the very first render — hence a lazy initial value, not an effect.
  const [phase, setPhase] = useState<Phase>(() => (token ? 'loading' : 'error'))
  // /verify-email is captcha-gated (audit finding 12). The invite token in the
  // URL is itself a strong gate, but the endpoint cannot see it — it only ever
  // receives an email address — so this page presents a challenge like the
  // other two callers do.
  const { widget: turnstileWidget, getToken: getTurnstileToken, ready: turnstileReady } = useTurnstile()
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [claimedEmail, setClaimedEmail] = useState('')
  const [otpError, setOtpError] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)

  useEffect(() => {
    if (!token) return
    kscwApi<InviteInfo>('/team-invites/info/' + token)
      .then((res) => {
        setInviteInfo(res)
        setPhase('form')
      })
      .catch(() => {
        setPhase('error')
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError('')
    setSubmitting(true)
    try {
      const res = await kscwApi<{ email?: string }>('/team-invites/claim', {
        method: 'POST',
        body: { token, first_name: firstName, last_name: lastName, email: email.trim().toLowerCase() },
      })
      const finalEmail = res.email ?? email.trim().toLowerCase()
      setClaimedEmail(finalEmail)

      // Send OTP for email verification
      await kscwApi('/verify-email', { method: 'POST', body: { email: finalEmail, turnstile_token: await getTurnstileToken() } })
      setPhase('otp')
    } catch {
      setSubmitError(t('join:error'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleOtpComplete(code: string) {
    setOtpError('')
    setOtpLoading(true)
    try {
      await kscwApi('/verify-email/confirm', { method: 'POST', body: { email: claimedEmail, code } })
      setPhase('set-password')
    } catch {
      setOtpError(t('auth:otpInvalid'))
    } finally {
      setOtpLoading(false)
    }
  }

  async function handleOtpResend() {
    setOtpError('')
    try {
      await kscwApi('/verify-email', { method: 'POST', body: { email: claimedEmail, turnstile_token: await getTurnstileToken() } })
    } catch {
      setOtpError(t('auth:otpResendError'))
    }
  }

  function handlePasswordSuccess() {
    apiLogout()
    setPhase('success')
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
          {/* Loading */}
          {phase === 'loading' && <LoadingSpinner size="sm" />}

          {/* Error — invalid / expired invite */}
          {phase === 'error' && (
            <div className="space-y-3 text-center">
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
                  <svg className="h-7 w-7 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
              </div>
              <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('join:error')}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('join:invalidLink')}
              </p>
            </div>
          )}

          {/* Form — enter name + email */}
          {phase === 'form' && inviteInfo && (
            <div className="space-y-5">
              <InviteHeader inviteInfo={inviteInfo} />

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FormInput
                    type="text"
                    label={t('auth:firstName')}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    autoComplete="given-name"
                  />
                  <FormInput
                    type="text"
                    label={t('auth:lastName')}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    autoComplete="family-name"
                  />
                </div>

                <FormInput
                  type="email"
                  label={t('auth:email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="name@example.com"
                />

                {submitError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
                )}

                {turnstileWidget}

                <Button type="submit" loading={submitting} disabled={!turnstileReady} className="w-full">
                  {t('join:joinTeam')}
                </Button>
              </form>
            </div>
          )}

          {/* OTP — verify email with one-time code */}
          {phase === 'otp' && (
            <div className="space-y-5">
              <InviteHeader inviteInfo={inviteInfo} />

              <div className="text-center">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('auth:setPasswordTitle')}
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {t('auth:setPasswordDescription')}
                </p>
              </div>

              <OtpInput
                onComplete={handleOtpComplete}
                onResend={handleOtpResend}
                loading={otpLoading}
                error={otpError}
                email={claimedEmail}
              />
            </div>
          )}

          {/* Set password — after OTP verified */}
          {phase === 'set-password' && (
            <div className="space-y-5">
              <InviteHeader inviteInfo={inviteInfo} />

              <SetPasswordForm
                title={t('auth:setPasswordTitle')}
                email={claimedEmail}
                onSuccess={handlePasswordSuccess}
              />
            </div>
          )}

          {/* Success — password set, go to login */}
          {phase === 'success' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <svg className="h-7 w-7 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('join:success')}
                </h2>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {t('join:successDesc', { teamName: inviteInfo?.team_name })}
                </p>
                {claimedEmail && (
                  <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                    {claimedEmail}
                  </p>
                )}
              </div>
              <Button onClick={() => navigate('/login', { replace: true })} className="w-full">
                {t('join:goToLogin')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
