import { useCallback, useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { messagingApi } from '../api/messaging'
import { resolveConsentState } from '../utils/resolveConsentState'

export function useMessagingConsent() {
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [justDecided, setJustDecided] = useState(false)

  const state = resolveConsentState({
    consentDecision: user?.consent_decision,
    consentPromptedAt: user?.consent_prompted_at,
  })
  const shouldShowModal = state === 'show' && !justDecided

  const submit = useCallback(async (decision: 'accepted' | 'declined' | 'later') => {
    setBusy(true)
    try {
      await messagingApi.recordConsent({ decision })
      setJustDecided(true)
      // Trigger a full reload so useAuth picks up the fresh user row.
      // Alternative: expose refetch() from useAuth — deferred to a future plan.
      window.location.reload()
    } finally { setBusy(false) }
  }, [])

  const accept = useCallback(() => submit('accepted'), [submit])
  const decline = useCallback(() => submit('declined'), [submit])
  const later = useCallback(() => submit('later'), [submit])

  return { shouldShowModal, accept, decline, later, busy }
}
