import { useMemo, useSyncExternalStore } from 'react'
import { passkeyHintSnapshot, subscribePasskeyHints, type PasskeyHint } from '../lib/passkeys'

/**
 * What this device remembers about one member's passkeys (lib/passkeys.ts), kept
 * current when the Profile card, the offer, a sign-in or another tab changes it.
 */
export function usePasskeyHint(memberId: string | number | null | undefined): PasskeyHint {
  const snapshot = useSyncExternalStore(
    subscribePasskeyHints,
    () => passkeyHintSnapshot(memberId),
    () => passkeyHintSnapshot(null),
  )
  return useMemo(() => JSON.parse(snapshot) as PasskeyHint, [snapshot])
}
