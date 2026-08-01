/**
 * "Buy the developer a coffee" — configuration + visibility rule.
 *
 * This is a PERSONAL support link for the maintainer, not a club donation
 * channel, so it is deliberately quiet: one row in the options menu and one
 * line under the changelog, never a push, an email, or a home-screen card.
 *
 * Both rails are optional. An empty constant hides that rail; if BOTH are
 * empty the entry point disappears entirely, so this ships safely before the
 * Payrexx account exists.
 */
import { useAuth } from '../../hooks/useAuth'
import { useCollection } from '../../lib/query'

/**
 * Payrexx paylink — CHF, TWINT and card in one hosted page (~1.35–1.65% fee,
 * Swiss-hosted). Chosen over Buy Me a Coffee / Ko-fi because neither of those
 * settles in CHF or offers TWINT, which is what Swiss members actually reach
 * for. Paste the paylink here once the Payrexx page is live.
 */
export const PAYREXX_URL = ''

/**
 * Mobile number for person-to-person TWINT. TWINT offers private individuals
 * no payment link or QR code at all (that is a business-customer product), so
 * the free rail is necessarily "type this number into the app".
 * Format for display, e.g. '+41 79 123 45 67'.
 */
export const TWINT_NUMBER = ''

/** True when at least one rail is configured — otherwise nothing is rendered. */
export function donateConfigured(): boolean {
  return PAYREXX_URL.trim() !== '' || TWINT_NUMBER.trim() !== ''
}

/**
 * Age in whole years, or null when the birthdate is missing/unparseable.
 * `birthdate` is a plain `YYYY-MM-DD` date column — parsed by hand rather than
 * via `new Date()` so a UTC-vs-Zurich shift can never move someone across the
 * boundary on their birthday.
 */
export function ageInYears(birthdate: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthdate ?? ''))
  if (!m) return null
  const [, y, mo, d] = m
  const now = new Date()
  const hadBirthday =
    now.getMonth() + 1 > Number(mo) ||
    (now.getMonth() + 1 === Number(mo) && now.getDate() >= Number(d))
  const age = now.getFullYear() - Number(y) - (hadBirthday ? 0 : 1)
  return Number.isFinite(age) ? age : null
}

/**
 * Whether to show the support entry point to the current user.
 *
 * Fails CLOSED on an unknown birthdate: a large share of the club are juniors
 * and asking a 13-year-old for money is the one version of this that could
 * actually blow back on the club, so "we cannot prove they are an adult"
 * means "do not show it".
 */
export function useDonateVisible(): boolean {
  const { user, isImpersonating } = useAuth()
  // Members can read `app_settings` (MEMBER_READ_ALL). A row keyed
  // `donate_enabled` with enabled=false is the board's kill switch; NO row at
  // all means "on", so the feature needs no seed data to work.
  const { data: settings } = useCollection<{ key: string; enabled: boolean }>('app_settings', {
    filter: { key: { _eq: 'donate_enabled' } },
    fields: ['key', 'enabled'],
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  })

  if (!donateConfigured()) return false
  // "View as" sessions render the impersonated member's app; a support link
  // there would be asking the wrong person for money.
  if (isImpersonating) return false
  const age = ageInYears(user?.birthdate)
  if (age === null || age < 18) return false
  const row = settings?.[0]
  return row ? row.enabled : true
}
