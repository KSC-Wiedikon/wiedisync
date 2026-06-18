import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'

export default function LoginPage() {
  const { login, user } = useAuth()
  const { theme } = useTheme()
  const { t } = useTranslation('auth')
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as { email?: string; accountExists?: boolean } | null

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
  const [showAccountExists, setShowAccountExists] = useState(() => {
    if (locationState?.accountExists) {
      sessionStorage.setItem('login-redirect-exists', 'true')
      return true
    }
    const stored = sessionStorage.getItem('login-redirect-exists') === 'true'
    if (stored) sessionStorage.removeItem('login-redirect-exists')
    return stored
  })
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    setShowAccountExists(false)
    try {
      await login(email, password)
      sessionStorage.removeItem('login-redirect-email')
      sessionStorage.removeItem('login-redirect-exists')
      navigate('/', { replace: true })
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
            {t('signIn')}
          </h1>

          {showAccountExists && (
            <div className="mb-4 rounded-lg bg-blue-50 p-3 text-center text-sm text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
              {t('accountAlreadyExists')}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <FormInput
              type="email"
              label={t('email')}
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder={t('passwordPlaceholder')}
              />
              <div className="mt-1 text-right">
                <Link
                  to={email.trim() ? `/set-password?email=${encodeURIComponent(email.trim())}` : '/set-password'}
                  className="text-sm text-brand-600 hover:text-brand-500 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  {t('forgotPassword')}
                </Link>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <Button type="submit" loading={loading} className="w-full">
              {loading ? t('signingIn') : t('signIn')}
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('noAccountYet')}{' '}
            <Link to="/signup" className="font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400">
              {t('signUp')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
