import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { kscwApi } from '../lib/api'
import { FormInput } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { PASSWORD_MIN_LENGTH, checkPassword, passwordErrorKeyFromCode, passwordIssueKey } from '@/lib/passwordRules'

interface SetPasswordFormProps {
  title: string
  description?: string
  /** Email for unauthenticated set-password (OTP-verified). Omit if user is already authenticated. */
  email?: string
  onSuccess: () => void
}

export function SetPasswordForm({ title, description, email, onSuccess }: SetPasswordFormProps) {
  const { t } = useTranslation('auth')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

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
        body: { password, ...(email ? { email } : {}) },
      })
      onSuccess()
    } catch (err: unknown) {
      // Directus/API errors come back in English and are often unfriendly —
      // show a localized generic message instead of the raw server text. The
      // exception is a rejected password: a generic "something went wrong"
      // there leaves the member with no idea what to change, so translate the
      // specific rule off the backend's code.
      const passwordKey = passwordErrorKeyFromCode((err as Error & { code?: string }).code)
      if (passwordKey) {
        setError(t(passwordKey))
        return
      }
      console.error('Set-password failed:', err)
      setError(t('common:error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>}
      </div>

      <FormInput
        label={t('newPassword')}
        type="password"
        placeholder={t('passwordPlaceholder')}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={PASSWORD_MIN_LENGTH}
        required
        autoComplete="new-password"
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

      <p className="text-xs text-gray-500 dark:text-gray-400">{t('passwordRequirements')}</p>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" className="w-full" loading={loading}>
        {loading ? t('settingPassword') : t('setPasswordButton')}
      </Button>
    </form>
  )
}
