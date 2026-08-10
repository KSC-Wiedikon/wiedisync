import { useCallback, useRef, useState } from 'react'
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'

/**
 * Cloudflare Turnstile site key. Public by design (it is rendered into the page);
 * the matching SECRET lives only in the Directus container env and is what
 * `verifyTurnstile` checks server-side.
 *
 * It was copy-pasted into four page components before this module existed. That
 * is survivable for a constant, but the *usage* around it was not — see below.
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAACoYmx3xiDfRbmv9'

/**
 * A Turnstile widget plus a `getToken()` that always yields a FRESH token.
 *
 * The subtlety this exists to encapsulate: **a Turnstile token is single-use.**
 * Cloudflare's siteverify rejects the second presentation of the same token
 * (`timeout-or-duplicate`). Every existing call site captured one token via
 * `onSuccess` and sent that captured value, which is correct only as long as the
 * page makes exactly ONE protected call. The signup flow makes several —
 * `/check-email`, then `/verify-email`, then an OTP resend — so reusing the
 * captured token would have failed on the second one, and "add the captcha to
 * /verify-email" would have broken signup rather than protected it
 * (audit 2026-08-08, finding 12).
 *
 * `getToken()` therefore resets the widget and awaits a newly issued token on
 * every call. `getResponsePromise()` resolves once the widget has solved again;
 * with a non-interactive challenge that is automatic, and with an interactive
 * one it resolves when the user completes it.
 *
 * Usage:
 *   const { widget, getToken, ready } = useTurnstile()
 *   ...
 *   <Button disabled={!ready} onClick={async () => {
 *     await api('/x', { body: { turnstile_token: await getToken() } })
 *   }}>
 *   {widget}
 */
export function useTurnstile() {
  const ref = useRef<TurnstileInstance>(null)
  const [ready, setReady] = useState(false)
  const firstTokenRef = useRef<string>('')

  /**
   * A fresh, unused token. The first call hands back the token the widget
   * already solved on mount (resetting it immediately would throw away a
   * perfectly good unused token and make the user wait); every later call
   * resets first, because by then the previous one has been spent.
   */
  const getToken = useCallback(async (): Promise<string> => {
    if (firstTokenRef.current) {
      const first = firstTokenRef.current
      firstTokenRef.current = ''
      return first
    }
    ref.current?.reset()
    setReady(false)
    try {
      const token = await ref.current?.getResponsePromise()
      return token ?? ''
    } catch {
      // A failed/expired challenge resolves to no token. The caller surfaces
      // its own error; returning '' makes the server reject it, which is the
      // correct outcome — never fabricate a token.
      return ''
    }
  }, [])

  const widget = (
    <Turnstile
      ref={ref}
      siteKey={TURNSTILE_SITE_KEY}
      onSuccess={(token) => {
        firstTokenRef.current = token
        setReady(true)
      }}
      onExpire={() => {
        firstTokenRef.current = ''
        setReady(false)
      }}
      onError={() => {
        firstTokenRef.current = ''
        setReady(false)
      }}
      options={{ theme: 'auto', size: 'flexible' }}
    />
  )

  return { widget, getToken, ready }
}
