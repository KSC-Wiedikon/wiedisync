// Swiss amount formatting: apostrophe thousands separator, dot decimal — 1'398.98.
// We format manually (not via Intl `de-CH`) so the separator is always a plain
// ASCII apostrophe and never a curly quote or non-breaking space.

/** Coerce a number / numeric string to a finite number, or null. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return parseAmount(value)
}

/** Format to `#'###.##` (e.g. 1398.98 → "1'398.98"). Empty input → "". */
export function formatAmountCH(value: number | string | null | undefined): string {
  const n = toNumber(value)
  if (n == null) return ''
  const neg = n < 0
  const [intPart, decPart] = Math.abs(n).toFixed(2).split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  return `${neg ? '-' : ''}${grouped}.${decPart}`
}

/**
 * Parse a possibly-grouped amount string to a number, or null.
 * Accepts Swiss "1'398.98", plain "1398.98", and European "1.398,98" / "1398,98".
 */
export function parseAmount(input: number | string | null | undefined): number | null {
  if (input == null || input === '') return null
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  // Strip apostrophes (straight + curly) and any whitespace (thousands separators).
  let s = input.trim().replace(/['’\s]/g, '')
  if (!s) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) {
    // Comma is the decimal separator → drop dots (thousands), comma → dot.
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    // Dot is the decimal separator (or no comma) → drop commas (thousands).
    s = s.replace(/,/g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
