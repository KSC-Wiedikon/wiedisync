import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import { CheckCircle2, Calendar, Clock, MapPin, Users, LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormInput } from '@/components/FormField'
import { API_URL, isAuthenticated } from '../../lib/api'
import { TURNSTILE_SITE_KEY } from '../../lib/turnstile'
import LoadingSpinner from '../../components/LoadingSpinner'
import { formatDateZurich, formatTimeZurich } from '../../utils/dateHelpers'

/**
 * Public (no-login) signup for one event, reached at `/e/:token`.
 *
 * The guests' door. Members must NOT come through here: an external signup
 * writes no `participations` row, so the event card would read "0 going" while
 * the hall filled up (migration 310 / public-event-signup.js). Anyone with a
 * session is therefore shown a link into the app instead of the form — the app
 * is where their RSVP actually counts.
 *
 * Mirrors PublicFormPage: anonymous fetch, Turnstile-protected submit, no
 * Directus session involved.
 */

interface PublicEvent {
  id: number
  title: string
  description?: string | null
  event_type?: string | null
  start_date?: string | null
  end_date?: string | null
  all_day?: boolean
  location?: string | null
  hall?: string | null
  respond_by?: string | null
  cancelled?: boolean
  cancel_reason?: string | null
  signup_count: number
  closed: boolean
}

export default function PublicEventSignupPage() {
  const { token } = useParams()
  const { t } = useTranslation('events')
  const turnstileRef = useRef<TurnstileInstance>(null)

  const [event, setEvent] = useState<PublicEvent | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>('loading')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [guests, setGuests] = useState(0)
  const [captcha, setCaptcha] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // A member opening a shared link. Read once at mount — this only decides which
  // of two panels to render, and re-deciding mid-form would swap the UI under
  // somebody who is already typing.
  const [memberSession] = useState(() => isAuthenticated())

  // Reset to the spinner when the token changes, without a render-phase write
  // to a fetched-data effect (React #301). Mirrors PublicFormPage.
  const [loadingToken, setLoadingToken] = useState(token)
  if (loadingToken !== token) {
    setLoadingToken(token)
    setStatus('loading')
  }

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/kscw/public/events/${encodeURIComponent(token ?? '')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then((res) => { if (!cancelled) { setEvent(res.data); setStatus('ready') } })
      .catch(() => { if (!cancelled) setStatus('notfound') })
    return () => { cancelled = true }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError(t('publicSignupNameRequired'))
    if (!captcha) return setError(t('publicSignupCaptcha'))

    setSaving(true)
    try {
      const res = await fetch(`${API_URL}/kscw/public/events/${encodeURIComponent(token ?? '')}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          note: note.trim() || null,
          guest_count: guests,
          turnstile_token: captcha,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        turnstileRef.current?.reset()
        setCaptcha('')
        if (res.status === 409) setError(t('publicSignupDuplicate'))
        else if (/closed|cancelled/i.test(body.error ?? '')) setError(t('publicSignupClosed'))
        else if (/captcha/i.test(body.error ?? '')) setError(t('publicSignupCaptcha'))
        else setError(t('publicSignupError'))
        return
      }
      setDone(true)
    } catch {
      setError(t('publicSignupError'))
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading') return <div className="flex min-h-screen items-center justify-center"><LoadingSpinner /></div>

  if (status === 'notfound' || !event) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="text-xl font-semibold text-foreground">{t('publicSignupNotFoundTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('publicSignupNotFoundBody')}</p>
      </div>
    )
  }

  const when = [
    event.start_date ? formatDateZurich(event.start_date) : null,
    !event.all_day && event.start_date ? formatTimeZurich(event.start_date) : null,
  ].filter(Boolean).join(', ')

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h1 className="text-xl font-bold text-foreground">{event.title}</h1>

        <div className="mt-3 space-y-2 text-sm text-muted-foreground">
          {when && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0" />
              <span>{when}{event.all_day ? ` · ${t('allDay')}` : ''}</span>
            </div>
          )}
          {event.respond_by && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0" />
              <span>{t('publicSignupDeadline', { date: formatDateZurich(event.respond_by) })}</span>
            </div>
          )}
          {(event.location || event.hall) && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>{event.location || event.hall}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0" />
            <span>{t('publicSignupCount', { count: event.signup_count })}</span>
          </div>
        </div>

        {event.description && (
          <p className="mt-4 whitespace-pre-line text-sm text-foreground">{event.description}</p>
        )}

        {/* Members go to the app. Signing up here would leave no participation
            row and the event's own count would under-report them. */}
        {memberSession ? (
          <div className="mt-5 rounded-lg border border-border bg-accent/40 p-4">
            <p className="text-sm text-foreground">{t('publicSignupMemberNotice')}</p>
            <Button asChild className="mt-3 w-full">
              <Link to={`/events/${event.id}`}>
                <LogIn className="mr-2 h-4 w-4" />
                {t('publicSignupMemberCta')}
              </Link>
            </Button>
          </div>
        ) : event.cancelled ? (
          <p className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {event.cancel_reason || t('cancelled')}
          </p>
        ) : event.closed ? (
          <p className="mt-5 rounded-lg border border-border p-3 text-sm text-muted-foreground">
            {t('publicSignupClosed')}
          </p>
        ) : done ? (
          <div className="mt-5 flex flex-col items-center gap-2 rounded-lg border border-border p-5 text-center">
            <CheckCircle2 className="h-9 w-9 text-green-600 dark:text-green-400" />
            <p className="text-sm font-medium text-foreground">{t('publicSignupDone')}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <FormInput label={t('publicSignupName')} value={name} onChange={(e) => setName(e.target.value)} required />
            <FormInput label={t('publicSignupEmail')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FormInput label={t('publicSignupPhone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
            <FormInput label={t('publicSignupNote')} value={note} onChange={(e) => setNote(e.target.value)} />

            <div>
              <label htmlFor="guest-count" className="mb-1 block text-sm font-medium text-foreground">
                {t('publicSignupGuests')}
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGuests((g) => Math.max(0, g - 1))}
                  className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-lg hover:bg-accent"
                  aria-label={t('publicSignupGuestsMinus')}
                >−</button>
                <span id="guest-count" className="w-8 text-center text-sm font-medium">{guests}</span>
                <button
                  type="button"
                  onClick={() => setGuests((g) => Math.min(20, g + 1))}
                  className="flex h-11 w-11 items-center justify-center rounded-md border border-border text-lg hover:bg-accent"
                  aria-label={t('publicSignupGuestsPlus')}
                >+</button>
              </div>
            </div>

            <Turnstile
              ref={turnstileRef}
              siteKey={TURNSTILE_SITE_KEY}
              onSuccess={setCaptcha}
              onExpire={() => setCaptcha('')}
              options={{ theme: 'auto' }}
            />

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <Button type="submit" className="w-full" disabled={saving} loading={saving}>
              {t('publicSignupSubmit')}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
