/**
 * Server-side check of a registration's fee category (`beitragskategorie`)
 * (audit 2026-09-28, F-32).
 *
 * `beitragskategorie` arrives from the public signup form as free text: the
 * select lists the allowed options, but until F-32 nothing on the server looked
 * at the value. At approval it is copied onto the member (and, for a linked
 * member, recorded as a ClubDesk push change), and from there it decides the
 * invoice. A crafted POST could therefore name a category of the other sport, a
 * category that bills nothing, or garbage that finance only notices when the
 * dues run misfires.
 *
 * What is checked: the category is one the fee engine knows (CD_BEITRAG_MAP —
 * both the signup-form names and the ClubDesk names) and belongs to the
 * registration's sport. `Gratis` stays valid for every sport — the admin grants
 * it to coaches in review, and the website offers it to coaches and to passive
 * officials — and is therefore the one value this cannot police; the review UI
 * is where that is caught. 'Kein Beitrag' is the non-member bucket and never a
 * valid registration answer.
 *
 * Two callers, one rule:
 *   - kscw-endpoints/src/registration.js, at SUBMIT: a non-empty value that fails
 *     is refused with 400 `invalid_fee_category`.
 *   - kscw-hooks (re-exported from kscw-hooks/src/fee-category.js), at APPROVAL:
 *     a value that fails is not copied onto the member and a warning is logged —
 *     the second line for rows an admin edited, or rows submitted before the
 *     submit check existed.
 *
 * Lives in kscw-endpoints because kscw-hooks already imports shared code across
 * the package boundary in that direction (season.js, error-log.js, …) and both
 * extension builds bundle relative imports; kscw-endpoints never imports from
 * kscw-hooks.
 */

import { CD_BEITRAG_MAP } from './clubdesk-update.js'

const SPORT_PREFIX = { volleyball: 'VB ', basketball: 'BB ' }
const ANY_SPORT = new Set(['Gratis'])

/**
 * The category to accept / copy onto the member, or null when the value must not
 * be used.
 * @param {unknown} raw            registrations.beitragskategorie
 * @param {unknown} membershipType registrations.membership_type
 */
export function approvedFeeCategory(raw, membershipType) {
  const k = String(raw ?? '').trim()
  if (!k) return null
  if (!Object.prototype.hasOwnProperty.call(CD_BEITRAG_MAP, k)) return null
  if (ANY_SPORT.has(k)) return k
  const type = String(membershipType ?? '').trim().toLowerCase()
  if (type === 'passive') return k === 'Passivmitglied' ? k : null
  const prefix = SPORT_PREFIX[type]
  if (!prefix) return null
  return k.startsWith(prefix) ? k : null
}
