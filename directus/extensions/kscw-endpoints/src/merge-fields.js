// ── Group-send merge fields ──────────────────────────────────────────────────
//
// ClubDesk-style {{tokens}} substituted per recipient. Every field accepts a
// German and an English spelling, because the composing admin may be writing in
// either — the composer's tip advertised only the German half for a long time,
// which is how an English-speaking operator concluded the feature was
// German-only.
//
// Extracted from scheduling-mailbox.js so the substitution rules can be tested
// without standing up a router.

import { escHtml } from './email-template.js'

/** Token → field key. Both spellings of each field map to the same key. */
export const MERGE_TOKENS = {
  vorname: 'first_name', first_name: 'first_name',
  nachname: 'last_name', last_name: 'last_name',
  name: 'full_name', full_name: 'full_name',
  email: 'email', e_mail: 'email',
  beitragskategorie: 'fee_category', fee_category: 'fee_category',
  mitgliederbeitrag: 'fee_amount', fee_amount: 'fee_amount',
  team: 'teams', teams: 'teams',
}

/** Every token is anchored by {{ }}, so `{{nachname}}` can never be matched by
 *  the `name` alternative — the braces make ordering irrelevant. */
const TOKEN_RE = new RegExp(`\\{\\{\\s*(${Object.keys(MERGE_TOKENS).join('|')})\\s*\\}\\}`, 'gi')

/**
 * The value each token resolves to for one recipient. Always a string: a token
 * the recipient has no value for renders EMPTY rather than leaving a raw
 * `{{…}}` in a message a member reads. The dry run reports how many recipients
 * that happens to, so an empty is a decision rather than a surprise.
 */
export function mergeValues(r) {
  const first = r?.first_name || ''
  const last = r?.last_name || ''
  return {
    first_name: first,
    last_name: last,
    full_name: [first, last].filter(Boolean).join(' '),
    email: r?.email || '',
    fee_category: r?.fee_category || '',
    fee_amount: r?.fee_amount || '',
    teams: r?.teams || '',
  }
}

/**
 * Substitute in ONE pass with a function replacer.
 *
 * Both properties matter and neither is incidental:
 *  - a function replacer means `$&` / `$1` in a VALUE stay literal. String
 *    replacements interpret those, so a member called `A$&B` would otherwise
 *    have the matched token spliced into their own name.
 *  - one pass means a value can never be re-scanned. Sequential per-token
 *    passes would substitute a member whose name literally contained
 *    `{{email}}` into their address on the following pass.
 *
 * `esc` is set for the HTML part and cleared for the text part and subject, so
 * a value can never inject markup where markup is honoured.
 */
export function applyMergeFields(str, r, esc) {
  const values = mergeValues(r)
  return String(str).replace(TOKEN_RE, (_match, token) => {
    const v = values[MERGE_TOKENS[String(token).toLowerCase()]] ?? ''
    return esc ? escHtml(v) : v
  })
}

/** Which field keys the given texts reference, so the dry run only reports gaps
 *  for fields the message actually depends on. Deduped, in token order. */
export function usedMergeFields(...texts) {
  const joined = texts.filter(Boolean).join('\n')
  const seen = new Set()
  for (const m of joined.matchAll(new RegExp(TOKEN_RE.source, 'gi'))) {
    seen.add(MERGE_TOKENS[String(m[1]).toLowerCase()])
  }
  return [...seen]
}
