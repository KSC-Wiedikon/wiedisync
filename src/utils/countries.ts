import { COUNTRIES, type Country } from './countries.generated'
import { COUNTRY_NAME_TO_CODE } from './countryCodes'
import { currentLocale } from './dateHelpers'

export type { Country }
export { COUNTRIES }

/**
 * Pinned to the top of every country picker — the five nationalities that cover
 * the overwhelming majority of the club (314 of 383 members are Swiss alone).
 * Mirrors FAVORITE_CODES in kscw-website's registration-form.js.
 */
export const FAVORITE_CODES = ['CH', 'DE', 'FR', 'AT', 'IT'] as const

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]))

/**
 * Countries whose ClubDesk picklist value differs from the modern German name
 * we display. Verified empirically against `clubdesk_export` — ClubDesk holds
 * "Großbritannien" where the display name is "Vereinigtes Königreich". Kept in
 * lockstep with `country_codes.name_de_clubdesk` (migration 224).
 */
const CLUBDESK_NAME_OVERRIDES: Record<string, string> = {
  GB: 'Großbritannien',
}

/**
 * The ClubDesk-facing German name for a code. ClubDesk's "Nationalität" and
 * "Federation of Origin" are picklists, so this must never be swapped for
 * Intl.DisplayNames — 7 names differ from CLDR (Botswana vs Botsuana, Moldau vs
 * Republik Moldau, …) and a mismatch lands the row in ClubDesk's "nicht
 * erkannte" bucket.
 *
 * Note the backend does NOT use this — it reads `country_codes` from Postgres
 * so there is one authority per process. This exists for client-side previews.
 */
export function countryNameDe(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase()
  return CLUBDESK_NAME_OVERRIDES[c] ?? BY_CODE.get(c)?.de ?? ''
}

/**
 * Constructing an Intl.DisplayNames is not cheap and every picker asks for all
 * 196 labels, so keep one instance per locale rather than one per lookup.
 */
const displayNamesCache = new Map<string, Intl.DisplayNames | null>()

function regionNames(locale: string): Intl.DisplayNames | null {
  if (!displayNamesCache.has(locale)) {
    try {
      // gsw has no CLDR region names — fall through to German rather than English.
      displayNamesCache.set(locale, new Intl.DisplayNames([locale, 'de', 'en'], { type: 'region' }))
    } catch {
      displayNamesCache.set(locale, null)
    }
  }
  return displayNamesCache.get(locale) ?? null
}

/**
 * Display label for a code in the viewer's language, falling back to the
 * curated German name and finally the raw code.
 */
export function countryLabel(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  try {
    return regionNames(currentLocale())?.of(c) || countryNameDe(c) || c
  } catch {
    return countryNameDe(c) || c
  }
}

/**
 * Emoji flag for an ISO alpha-2 code, built from the two regional-indicator
 * symbols (A→U+1F1E6). Purely decorative — mark it `aria-hidden`, since the
 * country name is always rendered beside it.
 *
 * ⚠ Windows does not ship flag glyphs: Chrome/Edge there render the two
 * regional-indicator letters ("CH") instead of a flag. That degrades gracefully
 * precisely BECAUSE the name is always shown too — never use the flag alone.
 */
export function countryFlag(code: string | null | undefined): string {
  const c = String(code || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

export interface CountryOption {
  value: string
  /** Flag + name, for pickers that render a single string (SearchableSelect). */
  label: string
  /** The flag alone, for callers laying flag and name out separately. */
  flag: string
  /** The localized name WITHOUT the flag — sort and search on this. */
  name: string
}

const optionsCache = new Map<string, CountryOption[]>()

/**
 * Options for a country picker: favourites first (in FAVORITE_CODES order),
 * then everything else collated in the viewer's language.
 *
 * Memoized per locale — the result is 196 entries built from 196 Intl lookups
 * plus a locale-aware sort, and callers render it on every keystroke. The
 * returned array is shared, so treat it as read-only.
 */
export function countryOptions(): CountryOption[] {
  const locale = currentLocale()
  const cached = optionsCache.get(locale)
  if (cached) return cached

  // ⚠ Sort on `name`, never on `label`. A flag-prefixed label collates by the
  // regional-indicator codepoints — i.e. by ISO code — so sorting it would order
  // the list AF, AL, DZ… while displaying Afghanistan, Albania, Algeria, and the
  // moment two names disagree with their codes the list looks randomly shuffled.
  const opt = (code: string): CountryOption => {
    const name = countryLabel(code)
    const flag = countryFlag(code)
    return { value: code, name, flag, label: flag ? `${flag} ${name}` : name }
  }
  const favourites = FAVORITE_CODES.map(opt)
  const rest = COUNTRIES.filter((c) => !FAVORITE_CODES.includes(c.code as (typeof FAVORITE_CODES)[number]))
    .map((c) => opt(c.code))
    .sort((a, b) => a.name.localeCompare(b.name, locale))
  const options = [...favourites, ...rest]
  optionsCache.set(locale, options)
  return options
}

/**
 * Parse the stored comma-separated code list (`members.nationalitaet_codes`)
 * into an ordered, de-duplicated array. The FIRST code is the primary one —
 * it is what gets pushed to ClubDesk, whose field holds a single value.
 */
export function parseCountryCodes(value: string | null | undefined): string[] {
  return [...new Set(
    String(value || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => /^[A-Z]{2}$/.test(s) && BY_CODE.has(s)),
  )]
}

/** Serialize back to the stored format. Empty selection stores NULL, not ''. */
export function serializeCountryCodes(codes: string[]): string | null {
  const clean = parseCountryCodes(codes.join(','))
  return clean.length ? clean.join(',') : null
}

/** Localized, comma-joined display of a stored code list. */
export function formatCountryCodes(value: string | null | undefined): string {
  return parseCountryCodes(value).map(countryLabel).join(', ')
}

/**
 * Best-effort code for a legacy free-text country name (ClubDesk German, or a
 * member-typed name in any language). Used to migrate/repair rows that predate
 * the coded columns.
 */
export function codeFromCountryName(value: string | null | undefined): string {
  const v = String(value || '').trim()
  if (!v) return ''
  if (/^[A-Za-z]{2}$/.test(v) && BY_CODE.has(v.toUpperCase())) return v.toUpperCase()
  return COUNTRY_NAME_TO_CODE[v.toLowerCase()] ?? ''
}
