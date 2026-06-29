import { currentLocale } from './dateHelpers'

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
