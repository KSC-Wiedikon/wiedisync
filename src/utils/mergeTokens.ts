// ── Group-send merge tokens (frontend mirror) ────────────────────────────────
//
// ⚠ MIRRORS `MERGE_TOKENS` in kscw-endpoints/src/merge-fields.js. Add a field
// to both or the composer highlights a token the send does not substitute —
// which is worse than no highlight at all, because it promises a substitution
// that will not happen.
//
// Exists so the composer can tell the operator, while they type, that a token
// was recognised. The alternative is finding out from a member who received
// "Dear {{firstname}}" — and that typo (no underscore) is exactly the kind the
// endpoint passes through untouched.

/** Accepted token spellings → the field they resolve to. */
export const MERGE_TOKENS: Record<string, string> = {
  vorname: 'first_name', first_name: 'first_name',
  nachname: 'last_name', last_name: 'last_name',
  name: 'full_name', full_name: 'full_name',
  email: 'email', e_mail: 'email',
  beitragskategorie: 'fee_category', fee_category: 'fee_category',
  mitgliederbeitrag: 'fee_amount', fee_amount: 'fee_amount',
  team: 'teams', teams: 'teams',
}

/** Anything shaped like a token, recognised or not — the unrecognised ones are
 *  the whole point: they are what gets sent verbatim. */
const ANY_TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g

export interface FoundToken {
  /** The full match, e.g. `{{first_name}}`. */
  raw: string
  /** The inner word as typed, e.g. `first_name`. */
  word: string
  /** The field it resolves to, or null when nothing will replace it. */
  field: string | null
  start: number
  end: number
}

/** Every `{{…}}` in the text, flagged as recognised or not. */
export function findMergeTokens(text: string): FoundToken[] {
  const out: FoundToken[] = []
  for (const m of String(text ?? '').matchAll(ANY_TOKEN_RE)) {
    const word = (m[1] ?? '').trim().toLowerCase()
    out.push({
      raw: m[0],
      word: (m[1] ?? '').trim(),
      field: MERGE_TOKENS[word] ?? null,
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    })
  }
  return out
}

/** Tokens that will be sent verbatim — a typo, or a field we do not have. */
export function unknownMergeTokens(text: string): FoundToken[] {
  return findMergeTokens(text).filter((t) => !t.field)
}

/** Deduplicated recognised field keys used in the text. */
export function usedMergeFields(text: string): string[] {
  return [...new Set(findMergeTokens(text).map((t) => t.field).filter((f): f is string => !!f))]
}
