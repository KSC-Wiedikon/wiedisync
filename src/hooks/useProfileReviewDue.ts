import { useAuth } from './useAuth'
import { useCollection } from '../lib/query'

interface ProfileReviewSetting {
  key: string
  enabled: boolean
  value: string | null
}

/**
 * Is this member due for the annual pre-licence data check (migration 270)?
 *
 * The campaign lives in `app_settings` as
 *   key='profile_review', enabled=<on/off>, value='YYYY-MM-DD'
 * and a member is due when their own `profile_verified_at` is missing or older
 * than that cutoff. Running it again next season is two field edits in the
 * admin UI, not a deploy.
 *
 * Fails CLOSED in every uncertain direction — no row, switched off, no cutoff,
 * an unparseable cutoff: no gate. A blocking modal is the most disruptive thing
 * this app can do to someone, so it only ever appears on an unambiguous yes.
 */
export function useProfileReviewDue(): boolean {
  const { user, isApproved, isImpersonating } = useAuth()
  const { data } = useCollection<ProfileReviewSetting>('app_settings', {
    filter: { key: { _eq: 'profile_review' } },
    fields: ['key', 'enabled', 'value'],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  })

  const row = data?.[0]
  if (!row?.enabled || !row.value) return false
  if (!user || !isApproved) return false
  // "View as" renders the impersonated member's app but cannot save on their
  // behalf (assertWritable blocks the write), so the gate would be unclosable.
  // Same carve-out as the onboarding gate in Layout.
  if (isImpersonating) return false

  const cutoff = Date.parse(`${row.value}T00:00:00Z`)
  if (!Number.isFinite(cutoff)) return false

  const verified = user.profile_verified_at ? Date.parse(user.profile_verified_at) : NaN
  return !Number.isFinite(verified) || verified < cutoff
}
