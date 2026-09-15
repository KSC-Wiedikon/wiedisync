export type ConsentModalState = 'hidden' | 'show'

export function resolveConsentState(args: {
  consentDecision: 'pending' | 'accepted' | 'declined' | undefined | null
  consentPromptedAt: string | null | undefined
  now?: Date
}): ConsentModalState {
  const decision = args.consentDecision ?? 'pending'
  if (decision === 'accepted' || decision === 'declined') return 'hidden'
  // decision === 'pending'
  if (!args.consentPromptedAt) return 'show' // first time
  const now = args.now ?? new Date()
  const elapsedMs = now.getTime() - new Date(args.consentPromptedAt).getTime()
  const SEVEN_DAYS = 7 * 24 * 3600 * 1000
  return elapsedMs > SEVEN_DAYS ? 'show' : 'hidden'
}
