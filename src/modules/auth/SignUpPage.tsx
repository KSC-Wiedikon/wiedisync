import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { useCollection } from '../../lib/query'
import { logActivity } from '../../utils/logActivity'
import { Button } from '@/components/ui/button'
import Modal from '@/components/Modal'
import DatenschutzPage from '../legal/DatenschutzPage'
import PrivacyNotice from '../../components/PrivacyNotice'
import { FormInput, FormField } from '@/components/FormField'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LANGUAGES, type BackendLanguage } from '../../i18n/languageConfig'
import { backendLangToI18n } from '../../utils/languageMap'
import { OtpInput } from '../../components/OtpInput'
import { Checkbox } from '@/components/ui/checkbox'
import LanguageSelect from '@/components/LanguageSelect'
import type { Team } from '../../types'
import { createRecord, kscwApi, updateRecord } from '../../lib/api'

const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'

type Step = 'email' | 'otp-verify' | 'otp-claim' | 'register' | 'complete-profile'

export default function SignUpPage() {
  const { login, user, isApproved } = useAuth()
  const { theme } = useTheme()
  const { t, i18n } = useTranslation('auth')
  const { t: tc } = useTranslation('common')
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('email')
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
  const [selectedTeam, setSelectedTeam] = useState('')
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
    if (user && isApproved) navigate('/', { replace: true })
    if (user && !isApproved) navigate('/pending', { replace: true })
  }, [user, isApproved, navigate, step])

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
        // New member — send verification email OTP
        await kscwApi('/verify-email', {
          method: 'POST',
          body: { email: email.trim().toLowerCase(), lang: selectedLanguage },
        })
        setStep('otp-verify')
      }
    } catch {
      setError(t('registrationFailed'))
      turnstileRef.current?.reset()
      setTurnstileToken('')
    } finally {
      setLoading(false)
    }
  }

  // OTP verify complete (new member email verification)
  async function handleOtpVerifyComplete(code: string) {
    setOtpError('')
    try {
      await kscwApi('/verify-email/confirm', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), code },
      })
      setStep('register')
    } catch {
      setOtpError(t('otpInvalid'))
    }
  }

  // OTP verify resend
  async function handleOtpVerifyResend() {
    setOtpError('')
    try {
      await kscwApi('/verify-email', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), lang: selectedLanguage },
      })
    } catch {
      setOtpError(t('registrationFailed'))
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

  // Existing team IDs for filtering
  const existingTeamIds = existingTeams.map((t) => t.id)
  const hasExistingTeams = existingTeams.length > 0

  // Toggle additional team selection
  function toggleAdditionalTeam(teamId: string) {
    setAdditionalTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId],
    )
  }

  // Available teams for additional selection (exclude existing)
  const availableTeams = filteredTeams.filter((t) => !existingTeamIds.includes(t.id))

  // Complete profile handler (ClubDesk import: set password + profile + team)
  async function handleCompleteProfile(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError(t('passwordTooShort'))
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
    } catch {
      setError(t('registrationFailed'))
    } finally {
      setLoading(false)
    }
  }

  // Register new member
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password !== passwordConfirm) {
      setError(t('passwordMismatch'))
      return
    }

    if (!selectedTeam) {
      setError(t('teamRequired'))
      return
    }

    setLoading(true)
    try {
      // Create Directus user + member via backend (OTP-verified)
      const res = await kscwApi<{ member_id: string }>('/register', {
        method: 'POST',
        body: {
          email: email.trim().toLowerCase(),
          password,
          first_name: firstName,
          last_name: lastName,
          team: selectedTeam,
          language: selectedLanguage,
        },
      })
      await login(email.trim().toLowerCase(), password)
      logActivity('create', 'members', res.member_id, { first_name: firstName, last_name: lastName, requested_team: selectedTeam })
      navigate('/pending', { replace: true })
    } catch (err) {
      if ((err as Error & { code?: string }).code === 'email_exists') {
        navigate('/login', { state: { email: email.trim().toLowerCase(), accountExists: true } })
        return
      }
      setError(t('registrationFailed'))
      turnstileRef.current?.reset()
      setTurnstileToken('')
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
            {step === 'otp-verify' && t('verifyEmail')}
            {step === 'otp-claim' && t('activateAccount')}
            {step === 'complete-profile' && t('activateAccount')}
            {(step === 'email' || step === 'register') && t('createAccount')}
          </h1>

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

          {/* Step 2: OTP verification for new members */}
          {step === 'otp-verify' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-gray-500 dark:text-gray-400">
                {t('verifyEmailDescription')}
              </p>

              <OtpInput
                email={email}
                onComplete={handleOtpVerifyComplete}
                onResend={handleOtpVerifyResend}
                error={otpError}
              />

              <Button variant="outline" onClick={handleBackToEmail} className="w-full">
                {t('tryDifferentEmail')}
              </Button>
            </div>
          )}

          {/* Step 3: OTP claim for existing members */}
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

          {/* Step 4: Complete profile after OTP claim (ClubDesk imports) */}
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

          {/* Step 5: New member registration */}
          {step === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              {/* Email (read-only) */}
              <div>
                <div className="flex items-center gap-2">
                  <FormInput
                    type="email"
                    label={t('email')}
                    value={email}
                    readOnly
                    className="bg-gray-50 dark:bg-gray-600"
                  />
                  <button
                    type="button"
                    onClick={handleBackToEmail}
                    className="mt-6 shrink-0 text-sm text-brand-600 hover:text-brand-500 dark:text-brand-400"
                  >
                    {t('change')}
                  </button>
                </div>
              </div>

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

              {/* Sport toggle */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {tc('sport')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['volleyball', 'basketball'] as const).map((sport) => (
                    <button
                      key={sport}
                      type="button"
                      onClick={() => { setSelectedSport(sport); setSelectedTeam('') }}
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
              </div>

              <FormField label={t('selectTeam')}>
                <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder={t('selectTeamPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredTeams.map((team) => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}{team.league ? ` — ${team.league}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                {loading ? t('creatingAccount') : t('signUp')}
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
