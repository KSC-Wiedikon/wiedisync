/**
 * Reader-facing rendering of `members.federation_of_origin`,
 * `members.nationalitaet_codes` and `members.sex` for the admin emails.
 *
 * Two shapes of the same fact live side by side and must never be swapped:
 *   • the PUSH value — German, in ClubDesk's exact picklist spelling
 *     (`federationCell()` + `country_codes.name_de_clubdesk`, clubdesk-update.js).
 *     That is what lands in the legal register, and it stays German whatever
 *     language the reader speaks.
 *   • the DISPLAY value — this file. Rendered in the READER's language, and for
 *     the federation it names the BODY ("🇨🇭 Swiss Volley"), not its country,
 *     because naming the body is the question the member was actually asked.
 * Before this split an English-speaking admin got "Schweiz" for both.
 *
 * ⚠ The federation maps mirror `src/utils/federations.ts` — the picker the
 * member chose from. Add a country to both or the email names a country where
 * the picker named a federation.
 */

const VOLLEYBALL = {
  AF: 'Afghanistan Volleyball Federation', AL: 'FSHV', AT: 'ÖVV', AU: 'Volleyball Australia',
  BG: 'Bulgarian Volleyball Federation', BR: 'CBV', CH: 'Swiss Volley', CO: 'Fedevoley',
  CZ: 'Český volejbalový svaz', DE: 'DVV', ES: 'RFEVB', ET: 'Ethiopian Volleyball Federation',
  FI: 'Lentopalloliitto', FR: 'FFVB', GB: 'Volleyball England', GR: 'Hellenic Volleyball Federation',
  HU: 'Magyar Röplabda Szövetség', IQ: 'Iraqi Volleyball Federation', IR: 'IRIVF', IT: 'FIPAV',
  LK: 'Sri Lanka Volleyball Federation', MX: 'FMVB', NL: 'Nevobo', NZ: 'Volleyball New Zealand',
  PE: 'FPV', PL: 'PZPS', PT: 'FPV', RS: 'OSS', RU: 'Russian Volleyball Federation',
  SE: 'Svenska Volleybollförbundet', SI: 'OZS', US: 'USA Volleyball',
}

const BASKETBALL = {
  AF: 'Afghanistan Basketball Federation', AL: 'FSHB', AT: 'ÖBV', AU: 'Basketball Australia',
  BG: 'Bulgarian Basketball Federation', BR: 'CBB', CH: 'Swiss Basketball', CO: 'Fecolcesto',
  CZ: 'Česká basketbalová federace', DE: 'DBB', ES: 'FEB', ET: 'Ethiopian Basketball Federation',
  FI: 'Basketball Finland', FR: 'FFBB', GB: 'Basketball England', GR: 'Hellenic Basketball Federation',
  HU: 'MKOSZ', IQ: 'Iraq Basketball Federation', IR: 'IRIBF', IT: 'FIP',
  LK: 'Sri Lanka Basketball Federation', MX: 'ADEMEBA', NL: 'NBB', NZ: 'Basketball New Zealand',
  PE: 'FDPB', PL: 'PZKosz', PT: 'FPB', RS: 'KSS', RU: 'Russian Basketball Federation',
  SE: 'Svenska Basketbollförbundet', SI: 'KZS', US: 'USA Basketball',
}

/** Per-locale display of `members.sex`. ClubDesk's own value stays the German lowercase pair — see sexPushLabel(). */
const SEX_LABEL = {
  de: { m: 'Männlich', f: 'Weiblich' },
  gsw: { m: 'Männlich', f: 'Wiiblich' },
  en: { m: 'Male', f: 'Female' },
  fr: { m: 'Masculin', f: 'Féminin' },
  it: { m: 'Maschile', f: 'Femminile' },
}

const up = (v) => String(v ?? '').trim().toUpperCase()

/** The value ClubDesk's Geschlecht column expects — never localized. */
export function sexPushLabel(sex) {
  return sex === 'm' ? 'männlich' : sex === 'f' ? 'weiblich' : ''
}

/** Reader-facing sex label; '' for an unset/unknown value. */
export function sexDisplay(sex, locale = 'de') {
  return (SEX_LABEL[locale] || SEX_LABEL.de)[String(sex ?? '').trim().toLowerCase()] || ''
}

/**
 * The federation body for a country in ONE sport, or '' when unknown.
 * `sport` is undefined for members who play both — and, since the caller derives
 * it from the current season's rosters, for members with no team at all.
 */
export function federationName(code, sport) {
  const c = up(code)
  if (!sport || !/^[A-Z]{2}$/.test(c)) return ''
  return (sport === 'volleyball' ? VOLLEYBALL : BASKETBALL)[c] || ''
}

/**
 * The federation name(s) to print, e.g. "FIPAV" — or "FIPAV / FIP" where the
 * member's sport is ambiguous. Naming both beats naming neither, and keeps the
 * email in step with the picker the member answered
 * (`federationNames` in src/utils/federations.ts).
 */
export function federationNames(code, sport) {
  const c = up(code)
  if (!/^[A-Z]{2}$/.test(c)) return ''
  if (sport) return federationName(c, sport)
  return [...new Set([VOLLEYBALL[c], BASKETBALL[c]].filter(Boolean))].join(' / ')
}

/**
 * Emoji flag from the two regional-indicator symbols (A → U+1F1E6). Decorative
 * only — Windows ships no flag glyphs and renders the bare letters there, which
 * degrades gracefully precisely because the name is always printed beside it.
 */
export function countryFlag(code) {
  const c = up(code)
  if (!/^[A-Z]{2}$/.test(c)) return ''
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65))
}

/**
 * code → { de, en } from `country_codes`. Loaded ONCE per email/run and threaded
 * through, same as loadCountryPushNames(). Note this reads name_de/name_en (the
 * display names), NOT name_de_clubdesk (the picklist spellings) — mixing them up
 * is how "Großbritannien" ends up in a sentence meant for a human.
 */
export async function loadCountryDisplayNames(database) {
  const rows = await database('country_codes').select('code', 'name_de', 'name_en')
  return new Map(rows.map((r) => [up(r.code), { de: String(r.name_de || '').trim(), en: String(r.name_en || '').trim() }]))
}

const regionNamesCache = new Map()

function regionNames(locale) {
  if (!regionNamesCache.has(locale)) {
    try {
      regionNamesCache.set(locale, new Intl.DisplayNames([locale, 'en'], { type: 'region' }))
    } catch {
      regionNamesCache.set(locale, null)
    }
  }
  return regionNamesCache.get(locale)
}

/**
 * Country name in the reader's language. de/gsw and en come from `country_codes`
 * (the club's curated spellings); fr/it fall back to CLDR, then to English, then
 * to the bare code — a code is at least unambiguous.
 */
export function countryDisplay(code, locale = 'de', names = null) {
  const c = up(code)
  if (!/^[A-Z]{2}$/.test(c)) return ''
  const row = names && names.get(c)
  if (locale === 'de' || locale === 'gsw') return (row && row.de) || (row && row.en) || c
  if (locale === 'en') return (row && row.en) || (row && row.de) || c
  try {
    return regionNames(locale)?.of(c) || (row && row.en) || c
  } catch {
    return (row && row.en) || c
  }
}

/**
 * `members.nationalitaet_codes` ("DE,CH") → ordered, de-duplicated codes.
 * Empty when the value is not a code list — a legacy free-text name, or a label
 * from a still-cached older frontend — which the callers pass through verbatim
 * rather than dropping.
 */
export function parseCodeList(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return []
  return [...new Set(raw.split(',').map(up).filter((s) => /^[A-Z]{2}$/.test(s)))]
}

/**
 * `members.nationalitaet_codes` in the reader's language. The full list is shown
 * even though ClubDesk's single-valued field only takes the FIRST code — the
 * member edited a list, so a list is what the admin has to check against.
 */
export function countryCodesDisplay(value, locale = 'de', names = null) {
  const codes = parseCodeList(value)
  if (!codes.length) return String(value ?? '').trim()
  return codes.map((c) => countryDisplay(c, locale, names)).join(', ')
}

/**
 * Federation of origin for a human: "🇨🇭 Swiss Volley" (or the localized country
 * name where no federation is mapped for the member's sport), '' for
 * unanswered. There is no "none" answer — a first-ever licence is issued by
 * Swiss Volley / Swiss Basketball, so that case is 'CH' (migration 342).
 */
export function federationDisplay(code, sport, locale = 'de', names = null) {
  const v = up(code)
  if (!v) return ''
  if (!/^[A-Z]{2}$/.test(v)) return String(code).trim()
  const name = federationNames(v, sport) || countryDisplay(v, locale, names)
  const flag = countryFlag(v)
  return flag ? `${flag} ${name}` : name
}
