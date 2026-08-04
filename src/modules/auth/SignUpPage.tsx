import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { ExternalLink } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { useCollection } from '../../lib/query'
import { Button } from '@/components/ui/button'
import Modal from '@/components/Modal'
import DatenschutzPage from '../legal/DatenschutzPage'
import PrivacyNotice from '../../components/PrivacyNotice'
import { FormInput, FormField } from '@/components/FormField'
import { LANGUAGES, type BackendLanguage } from '../../i18n/languageConfig'
import { backendLangToI18n } from '../../utils/languageMap'
import { OtpInput } from '../../components/OtpInput'
import { Checkbox } from '@/components/ui/checkbox'
import LanguageSelect from '@/components/LanguageSelect'
import type { Team } from '../../types'
import { createRecord, kscwApi, updateRecord } from '../../lib/api'
import { checkPassword, passwordErrorKeyFromCode, passwordIssueKey } from '../../lib/passwordRules'

const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'
const CLUB_SIGNUP_URL = 'https://kscw.ch/weiteres/anmeldung'

// Since open self-registration was closed (backend `registration_closed`),
// accounts are created either by (a) redeeming a member-bound invite token
// (`/signup?invite=…`) or (b) the email-match claim flow for existing members
// (`otp-claim` → `complete-profile`). Brand-new people are pointed at the club
// website / their coach instead.
type Step =
  | 'email'
  | 'otp-claim'
  | 'complete-profile'
  | 'registration-closed'
  | 'invite-loading'
  | 'invite'
  | 'invite-error'
  | 'invite-fetch-error'

type InviteInfo = { first_name: string; email: string; expires_at: string }
type InviteErrorCode = 'invalid_token' | 'already_claimed'

export default function SignUpPage() {
  const { login, user, isApproved } = useAuth()
  const { theme } = useTheme()
  const { t, i18n } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const inviteToken = searchParams.get('invite')

  const [step, setStep] = useState<Step>(inviteToken ? 'invite-loading' : 'email')
  const [email, setEmail] = useState('')
  const [selectedLanguage, setSelectedLanguage] = useState<BackendLanguage>(
    LANGUAGES.find((l) => l.code === i18n.language)?.backendValue ?? 'german',
  )

  function handleLanguageChange(lang: BackendLanguage) {
    setSelectedLanguage(lang)
    i18n.changeLanguage(backendLangToI18n(lang))
  }
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [selectedSport, setSelectedSport] = useState<'volleyball' | 'basketball'>('volleyball')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const turnstileRef = useRef<TurnstileInstance>(null)

  // OTP state
  const [otpError, setOtpError] = useState('')

  // Claim flow state (for existing/ClubDesk members)
  const [existingTeams, setExistingTeams] = useState<{ id: string; name: string; league?: string; sport?: string }[]>([])
  const [additionalTeamIds, setAdditionalTeamIds] = useState<string[]>([])

  // Invite flow state (single-use, member-bound signup token)
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null)
  const [inviteErrorCode, setInviteErrorCode] = useState<InviteErrorCode>('invalid_token')
  // Bumped by the "Try again" button to re-run the info fetch after a
  // transient failure (network / 429 / 500).
  const [inviteFetchAttempt, setInviteFetchAttempt] = useState(0)

  const { data: teamsRaw } = useCollection<Team>('teams', {
    filter: { active: { _eq: true } },
    sort: ['name'],
    all: true,
  })
  const teams = teamsRaw ?? []

  const filteredTeams = teams.filter((t) => t.sport === selectedSport)

  useEffect(() => {
    // Don't redirect during OTP claim flow steps
    if (step === 'complete-profile') return
    // Invite links may open in a browser with an active session (family
    // members share devices and emails — a child's invite can land in the
    // parent's logged-in browser). Let the invite flow render instead of
    // bouncing home; post-redeem navigation is handled in handleInviteRedeem.
    if (inviteToken) return
    if (user && isApproved) navigate('/', { replace: true })
    if (user && !isApproved) navigate('/pending', { replace: true })
  }, [user, isApproved, navigate, step, inviteToken])

  // Invite flow: resolve the token to greeting data (public endpoint —
  // `anonymous` so a stale session cookie can't 401 the public handler).
  useEffect(() => {
    if (!inviteToken) return
    let cancelled = false
    kscwApi<InviteInfo>(`/signup-invites/info/${inviteToken}`, { anonymous: true })
      .then((info) => {
        if (cancelled) return
        setInviteInfo(info)
        setStep('invite')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const apiErr = err as Error & { code?: string }
        // Only a genuine 404 (invalid/expired/claimed — the endpoint tags it
        // invalid_token) means the invite is dead. Transient failures
        // (network, 429, 500) get a retryable state instead of a false
        // "Invite not valid" verdict.
        if (apiErr.code === 'invalid_token' || /: 404$/.test(apiErr.message ?? '')) {
          setInviteErrorCode('invalid_token')
          setStep('invite-error')
        } else {
          setStep('invite-fetch-error')
        }
      })
    return () => { cancelled = true }
  }, [inviteToken, inviteFetchAttempt])

  // Invite flow: set password, create the account, log in.
  async function handleInviteRedeem(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const pwIssue = checkPassword(password)
    if (pwIssue) {
      setError(t(passwordIssueKey(pwIssue)))
      return
    }
    if (password !== passwordConfirm) {
      setError(t('passwordMismatch'))
      return
    }
    if (!inviteToken || !inviteInfo) return

    setLoading(true)
    let redeemed = false
    try {
      await kscwApi('/signup-invites/redeem', {
        method: 'POST',
        anonymous: true,
        body: { token: inviteToken, password, language: selectedLanguage },
      })
      redeemed = true
      await login(inviteInfo.email, password)
      navigate('/', { replace: true })
    } catch (err) {
      if (redeemed) {
        // Account exists now but auto-login failed — hand over to the login page.
        navigate('/login', { state: { email: inviteInfo.email, accountExists: true } })
        return
      }
      const apiErr = err as Error & { code?: string; body?: { error?: string } }
      // kscwApi encodes the HTTP status at the end of the message
      // (`API <path>: <status>`); network errors carry no status (→ 0).
      const status = Number(/: (\d{3})$/.exec(apiErr.message ?? '')?.[1] ?? 0)
      const passwordKey = passwordErrorKeyFromCode(apiErr.code)
      if (passwordKey) {
        // Password rules now travel as a `password_*` code, so they no longer
        // fall into the code-less branch below that used to print the backend's
        // English text verbatim. Translated, and names the failing rule.
        setError(t(passwordKey))
      } else if (apiErr.code === 'invalid_token' || apiErr.code === 'already_claimed') {
        setInviteErrorCode(apiErr.code)
        setStep('invite-error')
      } else if (apiErr.code === 'no_email') {
        setError(t('inviteNoEmail'))
      } else if (apiErr.code === 'email_in_use') {
        setError(t('inviteEmailInUse'))
      } else if (status === 429) {
        // Rate limiter — translated instead of the raw "Too many requests".
        setError(t('tooManyRequests'))
      } else if (status === 400 && apiErr.body?.error && !apiErr.code) {
        // Backend password-rule text (400 without a code) — show verbatim.
        setError(apiErr.body.error)
      } else {
        // Network error / 500 / anything unexpected — translated generic.
        setError(t('inviteRedeemFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  // Step 1: Check if email exists
  async function handleEmailCheck(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await kscwApi<{
        exists: boolean; claimed: boolean;
        existing_teams?: { name: string; sport?: string }[];
      }>('/check-email', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), turnstile_token: turnstileToken },
      })

      if (res.exists && res.claimed) {
        // Account already claimed — redirect to login with notice
        navigate('/login', { state: { email: email.trim().toLowerCase(), accountExists: true } })
        return
      } else if (res.exists) {
        // Account exists but not claimed — show existing teams and send OTP
        if (res.existing_teams) setExistingTeams(res.existing_teams.map((t, i) => ({ ...t, id: String(i) })))
        await kscwApi('/verify-email', { method: 'POST', body: { email: email.trim().toLowerCase(), lang: selectedLanguage } })
        setStep('otp-claim')
      } else {
        // Unknown email — open self-registration is closed. Point at the club
        // website (membership signup) or a coach-sent invite instead.
        setStep('registration-closed')
      }
    } catch {
      setError(t('registrationFailed'))
      turnstileRef.current?.reset()
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  // OTP claim complete (existing member activation)
  async function handleOtpClaimComplete(code: string) {
    setOtpError('')
    try {
      await kscwApi('/verify-email/confirm', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), code },
      })
      // Name + teams already pre-filled from check-email response
      setStep('complete-profile')
    } catch {
      setOtpError(t('otpInvalid'))
    }
  }

  // OTP claim resend
  async function handleOtpClaimResend() {
    setOtpError('')
    try {
      await kscwApi('/verify-email', { method: 'POST', body: { email: email.trim().toLowerCase(), lang: selectedLanguage } })
    } catch {
      setOtpError(t('registrationFailed'))
    }
  }

  const hasExistingTeams = existingTeams.length > 0

  // Toggle additional team selection
  function toggleAdditionalTeam(teamId: string) {
    setAdditionalTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId],
    )
  }

  // Available teams for additional selection (exclude existing). The check-email
  // payload carries only {name, sport} with synthetic index ids, so matching on
  // `id` never excludes the real DB teams — key on name (+ sport when provided).
  const availableTeams = filteredTeams.filter(
    (t) => !existingTeams.some(
      (et) => et.name === t.name && (!et.sport || et.sport === t.sport),
    ),
  )

  // Complete profile handler (ClubDesk import: set password + profile + team)
  async function handleCompleteProfile(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const pwIssue = checkPassword(password)
    if (pwIssue) {
      setError(t(passwordIssueKey(pwIssue)))
      return
    }
    if (password !== passwordConfirm) {
      setError(t('passwordMismatch'))
      return
    }
    // Require at least one team (existing or new)
    if (!hasExistingTeams && additionalTeamIds.length === 0) {
      setError(t('teamRequired'))
      return
    }

    setLoading(true)
    try {
      // Set password + create Directus user (unauthenticated, OTP-verified)
      const res = await kscwApi<{ member_id?: string }>('/set-password', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
      })

      // Login with new credentials
      await login(email.trim().toLowerCase(), password)

      // Now authenticated — update profile and create team requests
      const memberId = res.member_id
      if (memberId) {
        const updateData: Record<string, string> = {
          first_name: firstName,
          last_name: lastName,
        }
        if (additionalTeamIds.length > 0) {
          updateData.requested_team = additionalTeamIds[0]
        }
        await updateRecord('members', memberId, updateData)

        // Create all team requests concurrently instead of serial round-trips.
        await Promise.all(
          additionalTeamIds.map((teamId) =>
            createRecord('team_requests', {
              member: memberId,
              team: teamId,
              status: 'pending',
            }),
          ),
        )
      }

      // If user has existing teams → auto-approved → home
      // If only new teams requested → pending
      if (hasExistingTeams) {
        navigate('/', { replace: true })
      } else {
        navigate('/pending', { replace: true })
      }
    } catch (err) {
      // A same-email login already belongs to another member (shared family
      // inbox) — /set-password returns code 'email_in_use'. Surface the
      // actionable message instead of the generic failure.
      const apiErr = err as Error & { code?: string }
      const passwordKey = passwordErrorKeyFromCode(apiErr.code)
      if (passwordKey) {
        setError(t(passwordKey))
      } else if (apiErr.code === 'email_in_use') {
        setError(t('inviteEmailInUse'))
      } else {
        setError(t('registrationFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  function handleBackToEmail() {
    setStep('email')
    setError('')
    setOtpError('')
    setExistingTeams([])
  }

  const title = (() => {
    switch (step) {
      case 'otp-claim':
      case 'complete-profile':
        return t('activateAccount')
      case 'invite-error':
        return t(inviteErrorCode === 'already_claimed' ? 'inviteClaimedTitle' : 'inviteInvalidTitle')
      case 'invite-fetch-error':
        return t('inviteFetchErrorTitle')
      case 'registration-closed':
        return t('registrationClosedTitle')
      default:
        return t('createAccount')
    }
  })()

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
          <h1 className="mb-6 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
            {title}
          </h1>

          {/* Invite flow: resolving the token */}
          {step === 'invite-loading' && (
            <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('inviteLoading')}
            </p>
          )}

          {/* Invite flow: set password + activate */}
          {step === 'invite' && inviteInfo && (
            <form onSubmit={handleInviteRedeem} className="space-y-4">
              <p className="text-center text-base font-medium text-gray-900 dark:text-gray-100">
                {t('inviteGreeting', { name: inviteInfo.first_name })}
              </p>
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('inviteIntro')}
              </p>

              {/* What happens next: 3 quick steps (unobtrusive) */}
              <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700/40">
                <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span>{t('inviteStepPassword')}</span>
                  <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">&rarr;</span>
                  <span>{t('inviteStepConfirm')}</span>
                  <span aria-hidden="true" className="text-gray-300 dark:text-gray-600">&rarr;</span>
                  <span>{t('inviteStepDone')}</span>
                </p>
              </div>

              {/* Email (bound to the invite, read-only) */}
              <FormInput
                type="email"
                label={t('email')}
                value={inviteInfo.email}
                readOnly
                className="bg-gray-50 dark:bg-gray-600"
              />

              {/* Language */}
              <FormField label={t('language')}>
                <LanguageSelect value={selectedLanguage} onChange={handleLanguageChange} />
              </FormField>

              <FormInput
                type="password"
                label={t('password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder={t('passwordPlaceholder')}
              />

              <FormInput
                type="password"
                label={t('confirmPassword')}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />

              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                {t('privacyConsent')}{' '}
                <button
                  type="button"
                  onClick={() => setShowPrivacy(true)}
                  className="font-medium text-brand-600 underline hover:text-brand-500 dark:text-brand-400"
                >
                  {t('privacyPolicy')}
                </button>.
              </p>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <Button type="submit" loading={loading} className="w-full">
                {loading ? t('settingPassword') : t('activateAccount')}
              </Button>
            </form>
          )}

          {/* Invite flow: invalid / expired / already used token */}
          {step === 'invite-error' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t(inviteErrorCode === 'already_claimed' ? 'inviteClaimedDescription' : 'inviteInvalidDescription')}
              </p>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('alreadyHaveAccount')}{' '}
                <Link to="/login" className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                  {t('signIn')}
                </Link>
              </p>
            </div>
          )}

          {/* Invite flow: transient failure while checking the token (network /
              429 / 500) — retryable, deliberately NOT the "invite dead" panel */}
          {step === 'invite-fetch-error' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('inviteFetchErrorDescription')}
              </p>

              <Button
                onClick={() => {
                  setStep('invite-loading')
                  setInviteFetchAttempt((n) => n + 1)
                }}
                className="w-full"
              >
                {t('inviteRetry')}
              </Button>
            </div>
          )}

          {/* Registration closed: unknown email, self-signup no longer possible */}
          {step === 'registration-closed' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('registrationClosedDescription')}
              </p>

              <a
                href={CLUB_SIGNUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
              >
                {t('registrationClosedWebsiteLink')}
                <ExternalLink className="h-4 w-4" />
              </a>

              <Button variant="outline" onClick={handleBackToEmail} className="w-full">
                {t('tryDifferentEmail')}
              </Button>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('alreadyHaveAccount')}{' '}
                <Link to="/login" className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                  {t('signIn')}
                </Link>
              </p>
            </div>
          )}

          {/* Step 1: Email check */}
          {step === 'email' && (
            <form onSubmit={handleEmailCheck} className="space-y-4">
              <FormInput
                type="email"
                label={t('email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder={t('emailPlaceholder')}
              />

              {/* Language */}
              <FormField label={t('language')}>
                <LanguageSelect value={selectedLanguage} onChange={handleLanguageChange} />
              </FormField>

              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setTurnstileToken}
                onExpire={() => setTurnstileToken('')}
                options={{ theme: 'auto', size: 'flexible' }}
              />

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <Button type="submit" loading={loading} disabled={!turnstileToken} className="w-full">
                {loading ? t('checkingEmail') : t('continue')}
              </Button>

              {!turnstileToken && !loading && (
                <p className="text-center text-xs text-amber-600 dark:text-amber-400">
                  {t('captchaLoading')}
                </p>
              )}

              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                {t('privacyConsent')}{' '}
                <button
                  type="button"
                  onClick={() => setShowPrivacy(true)}
                  className="font-medium text-brand-600 underline hover:text-brand-500 dark:text-brand-400"
                >
                  {t('privacyPolicy')}
                </button>.
              </p>

              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('alreadyHaveAccount')}{' '}
                <Link to="/login" className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
                  {t('signIn')}
                </Link>
              </p>
            </form>
          )}

          {/* Step 2: OTP claim for existing members */}
          {step === 'otp-claim' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('activateAccountDescription')}
              </p>

              <OtpInput
                email={email}
                onComplete={handleOtpClaimComplete}
                onResend={handleOtpClaimResend}
                error={otpError}
              />

              <Button variant="outline" onClick={handleBackToEmail} className="w-full">
                {t('tryDifferentEmail')}
              </Button>
            </div>
          )}

          {/* Step 3: Complete profile after OTP claim (ClubDesk imports) */}
          {step === 'complete-profile' && (
            <form onSubmit={handleCompleteProfile} className="space-y-4">
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('activateAccountDescription')}
              </p>

              {/* Email (read-only) */}
              <FormInput
                type="email"
                label={t('email')}
                value={email}
                readOnly
                className="bg-gray-50 dark:bg-gray-600"
              />

              <div className="grid grid-cols-2 gap-3">
                <FormInput
                  type="text"
                  label={t('firstName')}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoComplete="given-name"
                />
                <FormInput
                  type="text"
                  label={t('lastName')}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  autoComplete="family-name"
                />
              </div>

              {/* Existing teams (pre-assigned from ClubDesk) */}
              {hasExistingTeams && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('yourTeams')}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {existingTeams.map((team) => (
                      <span
                        key={team.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {team.name}{team.league ? ` — ${team.league}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional team selection */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {hasExistingTeams ? t('joinAdditionalTeams') : t('selectTeam')}
                </label>

                {/* Sport toggle */}
                <div className="mb-2 grid grid-cols-2 gap-2">
                  {(['volleyball', 'basketball'] as const).map((sport) => (
                    <button
                      key={sport}
                      type="button"
                      onClick={() => setSelectedSport(sport)}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        selectedSport === sport
                          ? 'border-gold-400 bg-gold-100 text-gold-900 dark:border-gold-400/50 dark:bg-gold-400/20 dark:text-gold-300'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
                      }`}
                    >
                      {tc(sport)}
                    </button>
                  ))}
                </div>

                {/* Team checkboxes */}
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2 dark:border-gray-600">
                  {availableTeams.length === 0 ? (
                    <p className="py-2 text-center text-sm text-gray-400">{t('noTeamsForSport')}</p>
                  ) : (
                    availableTeams.map((team) => (
                      <label
                        key={team.id}
                        className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <Checkbox
                          checked={additionalTeamIds.includes(team.id)}
                          onCheckedChange={() => toggleAdditionalTeam(team.id)}
                        />
                        <span className="text-gray-900 dark:text-gray-100">
                          {team.name}{team.league ? ` — ${team.league}` : ''}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {hasExistingTeams && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {t('additionalTeamsNote')}
                  </p>
                )}
              </div>

              <FormInput
                type="password"
                label={t('password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder={t('passwordPlaceholder')}
              />

              <FormInput
                type="password"
                label={t('confirmPassword')}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <Button type="submit" loading={loading} className="w-full">
                {loading ? t('settingPassword') : t('activateAccount')}
              </Button>
            </form>
          )}
        </div>
      </div>
      <PrivacyNotice />
      <Modal open={showPrivacy} onClose={() => setShowPrivacy(false)} title={t('privacyPolicy')} size="lg">
        <DatenschutzPage />
      </Modal>
    </div>
  )
}
