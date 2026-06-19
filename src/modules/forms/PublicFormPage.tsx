import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { API_URL } from '../../lib/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import FormFieldRenderer from './FormFieldRenderer'
import type { FieldDef, AnswerValue } from './types'

const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'

interface PublicForm {
  id: string
  title: string
  description?: string | null
  fields: FieldDef[]
  success_message?: string | null
  allow_multiple?: boolean
}

function isMissing(field: FieldDef, v: AnswerValue): boolean {
  if (!field.required) return false
  switch (field.type) {
    case 'multi_choice':
      return !(Array.isArray(v) && v.length > 0)
    case 'file':
      return !(v && typeof v === 'object' && 'id' in v)
    case 'number':
      return v === null || v === undefined || (v as unknown) === ''
    case 'yes_no':
      return false
    default:
      return !v || (typeof v === 'string' && v.trim() === '')
  }
}

/**
 * Public (no-login) renderer for a form flagged `is_public`. Served at
 * `/f/:slug` — the auto-generated shareable address. Fetches the definition
 * from the anonymous endpoint and submits via the Turnstile-protected one;
 * no Directus session required (mirrors SignUpPage's public Turnstile flow).
 */
export default function PublicFormPage() {
  const { slug } = useParams()
  const { t } = useTranslation('forms')
  const turnstileRef = useRef<TurnstileInstance>(null)

  const [form, setForm] = useState<PublicForm | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetch(`${API_URL}/kscw/public/forms/${encodeURIComponent(slug ?? '')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((res) => { if (!cancelled) { setForm(res.data); setStatus('ready') } })
      .catch(() => { if (!cancelled) setStatus('notfound') })
    return () => { cancelled = true }
  }, [slug])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setError('')
    const miss = form.fields.find((f) => isMissing(f, answers[f.id] ?? null))
    if (miss) return setError(t('errorRequiredMissing', { field: miss.label }))
    if (!token) return setError(t('captchaRequired'))

    setSaving(true)
    try {
      const res = await fetch(`${API_URL}/kscw/public/form-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, answers, turnstile_token: token }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        turnstileRef.current?.reset()
        setToken('')
        if (/closed/i.test(body.error ?? '')) setError(t('errorClosed'))
        else if (/captcha/i.test(body.error ?? '')) setError(t('captchaRequired'))
        else setError(t('errorSubmit'))
        return
      }
      setDone(true)
    } catch {
      setError(t('errorSubmit'))
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setAnswers({})
    setToken('')
    setError('')
    setDone(false)
    turnstileRef.current?.reset()
  }

  // Wait for the public form definition before rendering the card chrome — a
  // standalone full-page spinner (public route, no app shell around it).
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-xl">
        <p className="mb-6 text-center text-sm font-semibold tracking-wide text-brand-600 dark:text-brand-400">
          KSC Wiedikon
        </p>

        <div className="rounded-xl border border-gray-200 bg-card p-6 shadow-sm dark:border-gray-700">
          {status === 'notfound' && (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('publicNotFound')}</p>
          )}

          {status === 'ready' && form && done && (
            <div className="space-y-5 py-4 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
              <p className="whitespace-pre-line text-sm text-foreground">
                {form.success_message?.trim() || t('submitSuccess')}
              </p>
              {form.allow_multiple && (
                <Button variant="outline" onClick={reset}>{t('submitAnother')}</Button>
              )}
            </div>
          )}

          {status === 'ready' && form && !done && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h1 className="text-xl font-bold">{form.title}</h1>
              {form.description && (
                <p className="whitespace-pre-line text-sm text-muted-foreground">{form.description}</p>
              )}
              {form.fields.map((f) => (
                <FormFieldRenderer
                  key={f.id}
                  field={f}
                  value={answers[f.id] ?? (f.type === 'multi_choice' ? [] : f.type === 'yes_no' ? false : '')}
                  onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))}
                />
              ))}

              <Turnstile
                ref={turnstileRef}
                siteKey={TURNSTILE_SITE_KEY}
                onSuccess={setToken}
                onExpire={() => setToken('')}
                options={{ theme: 'auto', size: 'flexible' }}
              />

              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <Button type="submit" loading={saving} disabled={!token} className="w-full">
                {saving ? t('submitting') : t('submit')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
