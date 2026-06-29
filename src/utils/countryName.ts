import { currentLocale } from './dateHelpers'
import { COUNTRY_NAME_TO_CODE } from './countryCodes'

/**
 * Localize an ISO 3166-1 alpha-2 country code (e.g. "PL") to the country name in
 * the viewer's language ("Poland" / "Polen" / "Pologne"). The registration form
 * stores `nationalitaet` as the country name in the SUBMITTER's language, so it
 * can't be re-translated — we store the canonical ISO code alongside it and
 * resolve the display name here via Intl.DisplayNames.
 *
 * Returns `fallback` when the code is empty/invalid (caller passes the stored
 * name so legacy rows without a code still render something).
 */
export function localizeCountry(code: string | null | undefined, fallback = ''): string {
  const c = (code || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return fallback
  try {
    return new Intl.DisplayNames([currentLocale(), 'en'], { type: 'region' }).of(c) || fallback
  } catch {
    return fallback
  }
}

/**
 * Localize a stored country *name* (no ISO code available) — e.g. members whose
 * `nationalitaet` came from ClubDesk in German ("Polen") or was typed by the
 * member in their own language. Resolves the name to an ISO code via a curated
 * de+en lookup, then to the viewer's language. A 2-letter input is treated as a
 * code directly. Unknown values are returned unchanged (no worse than today).
 */
export function localizeCountryName(value: string | null | undefined): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (/^[A-Za-z]{2}$/.test(v)) return localizeCountry(v, v)
  const code = COUNTRY_NAME_TO_CODE[v.toLowerCase()]
  return code ? localizeCountry(code, v) : v
}
