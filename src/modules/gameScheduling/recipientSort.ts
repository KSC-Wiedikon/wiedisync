// ── Recipient chip ordering + labelling (group send) ─────────────────────────
//
// A pasted list arrives in whatever order the spreadsheet had it, and an
// expanded audience in whatever order the query returned. Neither is checkable
// against a register, so the chips are sorted by surname — the order ClubDesk
// and every club list uses.

import type { MailboxRecipient } from './hooks/useMailbox'

/** Swiss German collation, so Ä/Ö/Ü sort with A/O/U rather than after Z, and
 *  the order matches every other list in the app. */
const collator = new Intl.Collator('de-CH', { sensitivity: 'base', numeric: false })

/** Surname when we know one. Empty for a contact we only have an address for. */
export function recipientSurname(r: MailboxRecipient): string {
  if (r.last_name?.trim()) return r.last_name.trim()
  // Older responses (and any caller that only set `name`) carry the joined
  // form. Falling back to its last token is wrong for compound surnames, which
  // is why the endpoint sends the parts — but a degraded sort beats none.
  const joined = (r.name ?? '').trim()
  if (!joined || joined === r.email) return ''
  return joined.split(/\s+/).slice(-1)[0] ?? ''
}

/** What the chip shows: the person's name, or their address when that is all
 *  we know. Surname first, so the visible order matches the sort. */
export function recipientLabel(r: MailboxRecipient): string {
  const last = (r.last_name ?? '').trim()
  const first = (r.first_name ?? '').trim()
  if (last || first) return [last, first].filter(Boolean).join(' ')
  const joined = (r.name ?? '').trim()
  return joined && joined !== r.email ? joined : r.email
}

/**
 * Sort by surname, then first name, then address.
 *
 * Address-only contacts go LAST as a block rather than being interleaved by
 * their address: they are the entries the operator may still need to fix, and
 * scattering them alphabetically among 117 names hides them.
 */
export function compareRecipients(a: MailboxRecipient, b: MailboxRecipient): number {
  const sa = recipientSurname(a)
  const sb = recipientSurname(b)
  if (!sa !== !sb) return sa ? -1 : 1
  if (sa && sb) {
    const bySurname = collator.compare(sa, sb)
    if (bySurname !== 0) return bySurname
    const byFirst = collator.compare((a.first_name ?? '').trim(), (b.first_name ?? '').trim())
    if (byFirst !== 0) return byFirst
  }
  return collator.compare(a.email, b.email)
}

/** Non-mutating sorted copy — the source array is compose state. */
export function sortRecipients(list: MailboxRecipient[]): MailboxRecipient[] {
  return [...list].sort(compareRecipients)
}
