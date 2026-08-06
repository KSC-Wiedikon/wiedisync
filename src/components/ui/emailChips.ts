// ── Recipient-list parsing (mail composer) ───────────────────────────────────
//
// Turns whatever a mail client puts on the clipboard into individual addresses:
// `"Canepa, Luca" <l@x.ch>; Anna <a@y.ch>, c@z.ch` is three recipients, not one
// string. Splitting is bracket- and quote-aware, so the comma inside a quoted
// display name never starts a new recipient.
//
// Why this matters beyond convenience: the send endpoint's `cleanAddresses`
// (kscw-endpoints/src/scheduling-mailbox.js) keeps only tokens matching the
// bare-address shape and DROPS the rest silently — `Anna <a@y.ch>` pasted into
// the old plain-text field never reached anyone. Everything here normalises to
// the bare address that endpoint accepts, and what cannot be normalised is kept
// as typed and flagged (`invalid`) rather than thrown away.

/** Mirror of EMAIL_RE in kscw-endpoints/src/scheduling-mailbox.js — an address
 *  that fails here is exactly one the send endpoint would discard. */
const ADDRESS_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export interface AddressChip {
  /** Bare address, lowercased — what goes on the wire. Holds the unusable text
   *  verbatim when `invalid`. */
  email: string
  /** Display name from `Name <a@b.ch>` / `Name a@b.ch`, when the source had one. */
  name?: string
  /** The token could not be read as an address. Kept so the operator sees it. */
  invalid?: boolean
}

export function isValidAddress(value: string): boolean {
  return ADDRESS_RE.test(value.trim())
}

/**
 * Split on `,` `;` and newlines, ignoring separators inside `<…>` or `"…"`.
 */
function splitTokens(raw: string): string[] {
  const out: string[] = []
  let buf = ''
  let inAngle = false
  let inQuote = false
  for (const ch of raw) {
    if (ch === '"' && !inAngle) { inQuote = !inQuote; buf += ch; continue }
    if (ch === '<' && !inQuote) { inAngle = true; buf += ch; continue }
    if (ch === '>' && !inQuote) { inAngle = false; buf += ch; continue }
    if (!inAngle && !inQuote && (ch === ',' || ch === ';' || ch === '\n' || ch === '\r' || ch === '\t')) {
      out.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  out.push(buf)
  return out.map((s) => s.trim()).filter(Boolean)
}

const unquote = (s: string) => s.trim().replace(/^"(.*)"$/s, '$1').trim()

function makeChip(address: string, name: string): AddressChip {
  const clean = address.replace(/^mailto:/i, '').trim()
  const ok = isValidAddress(clean)
  return { email: ok ? clean.toLowerCase() : clean, name: name || undefined, invalid: ok ? undefined : true }
}

/** One token (already separator-free) → the address(es) it carries. */
function parseToken(token: string): AddressChip[] {
  const angled = /^(.*)<([^<>]*)>$/s.exec(token)
  if (angled) return [makeChip(angled[2], unquote(angled[1]))]

  // No brackets. Two shapes share it: `Luca Canepa l@x.ch` (Outlook's plain
  // paste, one recipient) and `a@x.ch b@y.ch` (space-separated list). The
  // count of @-bearing pieces tells them apart.
  if (/\s/.test(token)) {
    const pieces = token.split(/\s+/)
    const withAt = pieces.filter((p) => p.includes('@'))
    if (withAt.length > 1) return withAt.map((p) => makeChip(p, ''))
    if (withAt.length === 1) {
      return [makeChip(withAt[0], unquote(pieces.filter((p) => p !== withAt[0]).join(' ')))]
    }
  }
  return [makeChip(token, '')]
}

/**
 * Parse a recipient string into deduplicated chips. Duplicates are dropped
 * case-insensitively — the same person twice is one copy, and two identical
 * chips would read as two recipients.
 */
export function parseAddressList(raw: string | null | undefined): AddressChip[] {
  const seen = new Set<string>()
  const out: AddressChip[] = []
  for (const token of splitTokens(String(raw ?? ''))) {
    for (const chip of parseToken(token)) {
      const key = chip.email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(chip)
    }
  }
  return out
}

/** Chips → the comma-separated string the send endpoint parses. */
export function serializeChips(chips: AddressChip[]): string {
  return chips.map((c) => c.email).join(', ')
}

/** True when the list holds something the send endpoint would silently drop. */
export function hasInvalidAddress(raw: string | null | undefined): boolean {
  return parseAddressList(raw).some((c) => c.invalid)
}
