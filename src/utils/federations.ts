import { countryFlag, countryLabel, countryOptions, type CountryOption } from './countries'

/**
 * National federation names for the federation-of-origin picker.
 *
 * "Federation of origin" asks which BODY first licensed the member, so naming the
 * body is more precise than naming its country — and it is sport-specific: an
 * Italian volleyballer came from FIPAV, an Italian basketballer from FIP. Showing
 * only "Italy" makes the member guess which one we mean.
 *
 * Deliberately NOT exhaustive. It covers every nationality currently held by a
 * member (32 codes) plus the pinned favourites; anything else falls back to the
 * plain country name, which is still a correct answer to "which federation" —
 * just less specific. Adding a country here is safe and needs no migration.
 *
 * The stored value is unchanged either way: an ISO code (or the 'NONE' sentinel).
 * These strings are display only and never reach ClubDesk or the DB.
 */
type Sport = 'volleyball' | 'basketball'

const VOLLEYBALL: Record<string, string> = {
  AF: 'Afghanistan Volleyball Federation', AL: 'FSHV', AT: 'ÖVV', AU: 'Volleyball Australia',
  BG: 'Bulgarian Volleyball Federation', BR: 'CBV', CH: 'Swiss Volley', CO: 'Fedevoley',
  CZ: 'Český volejbalový svaz', DE: 'DVV', ES: 'RFEVB', ET: 'Ethiopian Volleyball Federation',
  FI: 'Lentopalloliitto', FR: 'FFVB', GB: 'Volleyball England', GR: 'Hellenic Volleyball Federation',
  HU: 'Magyar Röplabda Szövetség', IQ: 'Iraqi Volleyball Federation', IR: 'IRIVF', IT: 'FIPAV',
  LK: 'Sri Lanka Volleyball Federation', MX: 'FMVB', NL: 'Nevobo', NZ: 'Volleyball New Zealand',
  PE: 'FPV', PL: 'PZPS', PT: 'FPV', RS: 'OSS', RU: 'Russian Volleyball Federation',
  SE: 'Svenska Volleybollförbundet', SI: 'OZS', US: 'USA Volleyball',
}

const BASKETBALL: Record<string, string> = {
  AF: 'Afghanistan Basketball Federation', AL: 'FSHB', AT: 'ÖBV', AU: 'Basketball Australia',
  BG: 'Bulgarian Basketball Federation', BR: 'CBB', CH: 'Swiss Basketball', CO: 'Fecolcesto',
  CZ: 'Česká basketbalová federace', DE: 'DBB', ES: 'FEB', ET: 'Ethiopian Basketball Federation',
  FI: 'Basketball Finland', FR: 'FFBB', GB: 'Basketball England', GR: 'Hellenic Basketball Federation',
  HU: 'MKOSZ', IQ: 'Iraq Basketball Federation', IR: 'IRIBF', IT: 'FIP',
  LK: 'Sri Lanka Basketball Federation', MX: 'ADEMEBA', NL: 'NBB', NZ: 'Basketball New Zealand',
  PE: 'FDPB', PL: 'PZKosz', PT: 'FPB', RS: 'KSS', RU: 'Russian Basketball Federation',
  SE: 'Svenska Basketbollförbundet', SI: 'KZS', US: 'USA Basketball',
}

/**
 * The federation name for a country in ONE sport, or '' when unknown.
 * `sport` is undefined for members who play both — and, because `primarySport`
 * collapses "no team at all" into 'both', for members who play neither yet.
 * Use `federationNames` unless you specifically need a single sport.
 */
export function federationName(code: string | null | undefined, sport: Sport | undefined): string {
  const c = String(code || '').trim().toUpperCase()
  if (!sport || !/^[A-Z]{2}$/.test(c)) return ''
  return (sport === 'volleyball' ? VOLLEYBALL : BASKETBALL)[c] ?? ''
}

/**
 * The federation name(s) to show a member, e.g. "FIPAV" — or "FIPAV / FIP" when
 * we don't know which sport they mean. Naming both beats naming neither: without
 * a sport this used to fall through to the bare country, so anyone on two teams
 * (and every member with no team yet) was asked "which federation licensed you?"
 * under a list of plain country names.
 */
export function federationNames(code: string | null | undefined, sport: Sport | undefined): string {
  const c = String(code || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  if (sport) return federationName(c, sport)
  return [...new Set([VOLLEYBALL[c], BASKETBALL[c]].filter(Boolean))].join(' / ')
}

/** Flag + federation(s), falling back to the country name, e.g. "🇮🇹 FIPAV". */
export function federationDisplay(code: string | null | undefined, sport: Sport | undefined): string {
  const c = String(code || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(c)) return ''
  const flag = countryFlag(c)
  const name = federationNames(c, sport) || countryLabel(c)
  return flag ? `${flag} ${name}` : name
}

export interface FederationOption extends CountryOption {
  /** Country name, kept so the picker can still be searched by country. */
  country: string
}

/**
 * Options for the federation-of-origin picker: same order as the country picker
 * (favourites pinned), but labelled with the federation for the member's sport.
 *
 * `name` carries "Federation (Country)" so a substring search matches BOTH — a
 * member who knows only "Italy" and a member who knows only "FIPAV" both find it.
 */
export function federationOptions(sport: Sport | undefined): FederationOption[] {
  return countryOptions().map((o) => {
    const fed = federationNames(o.value, sport)
    const name = fed ? `${fed} (${o.name})` : o.name
    return { ...o, country: o.name, name, label: o.flag ? `${o.flag} ${name}` : name }
  })
}
