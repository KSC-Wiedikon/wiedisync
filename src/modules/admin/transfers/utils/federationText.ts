/**
 * The federation-facing text of `/admin/transfers`: how VIS's directory rows are
 * read, and the letter an admin copies into their own mail client.
 *
 * ⚠ NO i18n IN THIS FILE, ever. The letter and its subject are ALWAYS ENGLISH by
 * design (see `visRequestText`), so nothing here takes a `t` parameter and
 * nothing here may be translated. It is pure — no React either.
 */

import { FED_KEEP_UPPER, FED_LOWER, MAILTO_MAX } from '../constants'
import type { TransferMember } from '../types'
import { formatDateZurich } from '../../../../utils/dateHelpers'

/**
 * VIS publishes federation contacts as a SEMICOLON-SEPARATED LIST
 * ("presidenza@federvolley.it; segreteria@federvolley.it") and migration 241
 * keeps that verbatim, so anything reading `email` has to split it. Which of
 * them is the right addressee for a transfer request is a judgement the club
 * makes — hence all of them are shown, not just the first.
 */
export function splitEmails(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * VIS stores federation names in ALL CAPS ("GERMAN VOLLEYBALL FEDERATION").
 * Acceptable as a table label, but it shouts in a letter we send to that
 * federation — so it is title-cased for display, lowercasing the connectors
 * title case would otherwise capitalise ("FEDERACIÓN ESPAÑOLA DE VOLEIBOL" →
 * "Federación Española de Voleibol"). A name VIS already stores mixed-case
 * ("Nederlandse Volleybalbond (Nevobo)") is trusted exactly as it is.
 *
 * ⚠ Deliberately NO "short tokens are acronyms" rule. It is the obvious guess
 * and it is wrong for this data: across all 69 rows the directory holds long-
 * form names only, so every short token is either a connector or a real word —
 * "VOLLEYBALL NEW ZEALAND INC." and "SRI LANKA …" would come out as "NEW" and
 * "SRI". Federations that genuinely spell themselves in capitals go in
 * `FED_KEEP_UPPER` by name; both sets live in `../constants` and this is their
 * only consumer.
 */
export function prettyFederationName(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s || s !== s.toUpperCase()) return s
  return s.replace(/[\p{L}\p{M}'’]+/gu, (word, offset: number) => {
    if (FED_KEEP_UPPER.has(word)) return word
    // A connector only reads as one mid-sentence; leading it stays capitalised.
    if (offset > 0 && FED_LOWER.has(word)) return word.toLowerCase()
    return word[0] + word.slice(1).toLowerCase()
  })
}

/** "Tobias Armstrong, date of birth 07.08.1994, to.armstr@gmail.com" — exactly
 *  the identity a federation needs to find or create the player. */
export function memberRequestLine(m: TransferMember): string {
  const name = [m.first_name, m.last_name].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ')
  const parts = [name || '(name)']
  const dob = formatDateZurich(m.birthdate)
  if (dob) parts.push(`date of birth ${dob}`)
  const email = String(m.email ?? '').trim()
  if (email) parts.push(email)
  return parts.join(', ')
}

/**
 * The text an admin copies into their own mail client to ask a federation to
 * enter players in VIS. Nothing is ever sent from this page.
 *
 * ONE letter per federation, listing every player of theirs we cannot open a
 * transfer for yet — a federation that has to answer 24 near-identical emails
 * about the same club answers none of them.
 *
 * ⚠ ALWAYS ENGLISH, deliberately not translated (same reasoning as the exports
 * rule): the recipient is a foreign national federation, and the language the
 * KSCW admin happens to read the app in says nothing about what that federation
 * reads. English is the FIVB working language.
 *
 * ⚠ The wording ASKS whether the players are registered rather than asserting
 * they are missing. `in_vis === false` is a name-match miss against a federation
 * we usually only GUESSED (seeded from nationality), and never-checked members
 * are on the same list — so an accusatory "your players are missing from VIS"
 * would frequently be simply untrue.
 */
export function visRequestText(rows: readonly TransferMember[], federationName: string): string {
  const one = rows.length === 1
  const list = one
    ? [memberRequestLine(rows[0])]
    : rows.map((m, i) => `${i + 1}. ${memberRequestLine(m)}`)
  return [
    'Dear Sir or Madam',
    '',
    one
      ? 'The player below plays for KSC Wiedikon in Zurich, Switzerland, and we would like to request an international transfer to Swiss Volley.'
      : `The ${rows.length} players below play for KSC Wiedikon in Zurich, Switzerland, and we would like to request international transfers to Swiss Volley for them.`,
    `Could you please confirm whether ${one ? 'the player is' : 'they are'} registered in the FIVB VIS player index of ${federationName}, and enter ${one ? 'them if they are not' : 'those who are not'}? We cannot open a transfer request before a player appears in VIS.`,
    '',
    ...list,
    '',
    'Thank you very much and kind regards',
    'KSC Wiedikon, Zurich (Switzerland)',
  ].join('\n')
}

/**
 * Why the compose link is what it is — the three cases are genuinely different
 * and the footer says a different thing for each:
 *
 *  - `bodyIncluded` — the whole letter is prefilled. The nice case.
 *  - `tooLong`      — a 16-name letter blows past what Windows will hand to a
 *                     mail client, and some clients TRUNCATE silently, which
 *                     would send a letter missing its last players while looking
 *                     complete. Rather than drop the link (the big federations
 *                     are exactly the ones worth writing to), fall back to a
 *                     pre-addressed EMPTY message and tell the admin to paste.
 *  - `noAddress`    — VIS lists no address for this federation, so there is no
 *                     link at all. ⚠ This case USED to be reported as "too long
 *                     to prefill an email", ~40px below the line that already
 *                     said VIS has no address — the footer contradicted itself.
 *                     Hence a three-way state instead of a boolean.
 */
export type MailtoResult = { href: string; state: 'bodyIncluded' | 'tooLong' | 'noAddress' }

/**
 * Build the compose link for ONE address.
 *
 * ⚠ The caller passes the FIRST address only — VIS lists several for many
 * federations and which one is right for a transfer is the club's call, so the
 * rest are copied but never pre-picked.
 */
export function buildRequestMailto(
  email: string | undefined,
  subject: string,
  body: string,
): MailtoResult {
  const to = String(email ?? '').trim()
  if (!to) return { href: '', state: 'noAddress' }
  const addressed = `mailto:${to}?subject=${encodeURIComponent(subject)}`
  const withBody = `${addressed}&body=${encodeURIComponent(body)}`
  if (withBody.length <= MAILTO_MAX) return { href: withBody, state: 'bodyIncluded' }
  return { href: addressed, state: 'tooLong' }
}
