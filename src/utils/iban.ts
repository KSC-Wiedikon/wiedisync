/**
 * IBAN helpers — ISO 13616 format + mod-97 checksum validation.
 *
 * Used by the profile editor (member's own IBAN) and the expense-reimbursement
 * upload page (payout IBAN). Members may hold foreign accounts, so this is a
 * generic IBAN check, not CH/LI-only. Stored normalised (uppercase, no spaces).
 */

/** Strip spaces and uppercase — the canonical stored form. */
export function normalizeIban(raw: string): string {
  return (raw || '').replace(/\s+/g, '').toUpperCase()
}

/** Group into blocks of 4 for display (e.g. "CH93 0076 2011 6238 5295 7"). */
export function formatIban(raw: string): string {
  return normalizeIban(raw).replace(/(.{4})/g, '$1 ').trim()
}

/**
 * Validate an IBAN: ISO 13616 shape (2 letters, 2 check digits, then 11–30
 * alphanumerics) plus the mod-97 checksum. Empty string is treated as invalid
 * here — callers decide whether IBAN is required (it's optional on the profile).
 */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  // Move the first 4 chars to the end, map letters to numbers (A=10 … Z=35),
  // then compute the big-integer mod 97 in chunks (must equal 1).
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let remainder = 0
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97
  }
  return remainder === 1
}
