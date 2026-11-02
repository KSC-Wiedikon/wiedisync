import { useCallback, useRef, useState } from 'react'
import { shouldOfferPasskey } from '../lib/passkeys'

export interface PasskeyOffer {
  memberId: string
}

/**
 * The "Sign in faster next time?" offer after a password sign-in, held by
 * AuthProvider: the sign-in page unmounts the moment the sign-in succeeds, so the
 * dialog cannot live there.
 *
 * Setting a passkey up needs the password, and the one just typed is the only one the
 * app ever holds in plain text. It stays in this ref — never state, never storage — for
 * exactly as long as the offer is open, and `close()` drops it.
 */
export function usePasskeyOffer() {
  const [offer, setOffer] = useState<PasskeyOffer | null>(null)
  const password = useRef<string | null>(null)
  // Only the latest sign-in's check may open the offer (a sign-out or another sign-in
  // while it was still asking the server wins).
  const seq = useRef(0)

  const consider = useCallback(async (memberId: string | number, typedPassword: string) => {
    const mine = ++seq.current
    const offerIt = await shouldOfferPasskey(memberId)
    if (!offerIt || mine !== seq.current) return
    password.current = typedPassword
    setOffer({ memberId: String(memberId) })
  }, [])

  const close = useCallback(() => {
    ++seq.current
    password.current = null
    setOffer(null)
  }, [])

  const takePassword = useCallback(() => password.current, [])

  return { offer, consider, close, password: takePassword }
}
