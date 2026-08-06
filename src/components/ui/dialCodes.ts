// ── E.164 calling codes ──────────────────────────────────────────────────────
//
// Data module behind `PhoneInput`'s country prefix picker. Pure — no JSX, no
// i18n, no DOM — so the parsing half (`splitDialCode`) is unit-testable in the
// `node` vitest environment.
//
// The country NAMES are not duplicated here: they come from
// `src/utils/countries.generated.ts`, the same list that seeded ClubDesk's
// "Nationalität" picklist. This file only adds the calling code per ISO-2, so a
// country added there flows through automatically (and the unit test fails if
// its dial code is missing).
//
// ⚠ `dial` is the calling code WITHOUT the leading plus, because that is what
// `+${dial}${national}` composition needs and what `normalizePhone` parses.

// Relative, not the `@/` alias: vitest.config.ts declares no path alias, and
// this module's parsing half is unit-tested in the `node` environment.
import { COUNTRIES } from '../../utils/countries.generated'

export interface DialCode {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: string
  /** E.164 calling code WITHOUT the plus, e.g. '41'. */
  dial: string
  /** English country name. */
  name: string
  /** Emoji flag. */
  flag: string
}

/**
 * ISO-2 → calling code. Countries sharing a code (US/CA on 1, RU/KZ on 7) are
 * both listed; the split helper only ever returns the code itself, so the
 * ambiguity never reaches a stored value.
 *
 * Caribbean +1 members carry their full NANP area code (AG 1268, BB 1246, …) so
 * the longest-prefix match resolves them ahead of the bare '1'.
 */
const DIAL_BY_ISO: Readonly<Record<string, string>> = {
  AD: '376', AE: '971', AF: '93', AG: '1268', AL: '355', AM: '374', AO: '244',
  AR: '54', AT: '43', AU: '61', AZ: '994', BA: '387', BB: '1246', BD: '880',
  BE: '32', BF: '226', BG: '359', BH: '973', BI: '257', BJ: '229', BN: '673',
  BO: '591', BR: '55', BS: '1242', BT: '975', BW: '267', BY: '375', BZ: '501',
  CA: '1', CD: '243', CF: '236', CG: '242', CH: '41', CI: '225', CL: '56',
  CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238', CY: '357',
  CZ: '420', DE: '49', DJ: '253', DK: '45', DM: '1767', DO: '1809', DZ: '213',
  EC: '593', EE: '372', EG: '20', ER: '291', ES: '34', ET: '251', FI: '358',
  FJ: '679', FM: '691', FR: '33', GA: '241', GB: '44', GD: '1473', GE: '995',
  GH: '233', GM: '220', GN: '224', GQ: '240', GR: '30', GT: '502', GW: '245',
  GY: '592', HN: '504', HR: '385', HT: '509', HU: '36', ID: '62', IE: '353',
  IL: '972', IN: '91', IQ: '964', IR: '98', IS: '354', IT: '39', JM: '1876',
  JO: '962', JP: '81', KE: '254', KG: '996', KH: '855', KI: '686', KM: '269',
  KN: '1869', KP: '850', KR: '82', KW: '965', KZ: '7', LA: '856', LB: '961',
  LC: '1758', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370', LU: '352',
  LV: '371', LY: '218', MA: '212', MC: '377', MD: '373', ME: '382', MG: '261',
  MH: '692', MK: '389', ML: '223', MM: '95', MN: '976', MR: '222', MT: '356',
  MU: '230', MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258', NA: '264',
  NE: '227', NG: '234', NI: '505', NL: '31', NO: '47', NP: '977', NR: '674',
  NZ: '64', OM: '968', PA: '507', PE: '51', PG: '675', PH: '63', PK: '92',
  PL: '48', PS: '970', PT: '351', PW: '680', PY: '595', QA: '974', RO: '40',
  RS: '381', RU: '7', RW: '250', SA: '966', SB: '677', SC: '248', SD: '249',
  SE: '46', SG: '65', SI: '386', SK: '421', SL: '232', SM: '378', SN: '221',
  SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SY: '963', SZ: '268',
  TD: '235', TG: '228', TH: '66', TJ: '992', TL: '670', TM: '993', TN: '216',
  TO: '676', TR: '90', TT: '1868', TV: '688', TW: '886', TZ: '255', UA: '380',
  UG: '256', US: '1', UY: '598', UZ: '998', VA: '379', VC: '1784', VE: '58',
  VN: '84', VU: '678', WS: '685', XK: '383', YE: '967', ZA: '27', ZM: '260',
  ZW: '263',
}

/** Two regional-indicator letters. Windows renders the letters, which still reads. */
function flagFor(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(
    ...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65),
  )
}

/** Every country with a calling code, sorted by name. */
export const DIAL_CODES: readonly DialCode[] = COUNTRIES
  .filter((c) => DIAL_BY_ISO[c.code])
  .map((c) => ({
    code: c.code,
    dial: DIAL_BY_ISO[c.code],
    name: c.en,
    flag: flagFor(c.code),
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'))

/**
 * Rendered above the separator in the picker. Mirrors `FAVORITE_CODES` in
 * `src/utils/countries.ts` plus Liechtenstein, which shares Switzerland's
 * dialling area and turns up in the register.
 */
export const FAVORITE_DIAL_CODES: readonly string[] = ['CH', 'DE', 'FR', 'AT', 'IT', 'LI']

const BY_CODE = new Map(DIAL_CODES.map((d) => [d.code, d]))

export function dialCodeFor(iso2: string | null | undefined): DialCode | undefined {
  return BY_CODE.get(String(iso2 ?? '').trim().toUpperCase())
}

/** Default prefix — the club is Swiss and 96% of the register is a +41 number. */
const DEFAULT_DIAL = '41'

/** Longest dial first, so '1268' beats '1' on an Antiguan number. */
const DIALS_BY_LENGTH: readonly DialCode[] = [...DIAL_CODES].sort(
  (a, b) =>
    b.dial.length - a.dial.length ||
    // Ties are the SAME digits (equal length + both a prefix ⇒ identical), so
    // this only makes the pick deterministic: favourites first, then by name.
    Number(FAVORITE_DIAL_CODES.includes(b.code)) - Number(FAVORITE_DIAL_CODES.includes(a.code)) ||
    a.name.localeCompare(b.name, 'en'),
)

/**
 * Split a stored phone value into picker state.
 *  '+41 79 123 45 67' → { dial: '41', national: '79 123 45 67' }
 *  '079 123 45 67'    → { dial: '41', national: '079 123 45 67' }  (CH default)
 *  ''/null            → { dial: '41', national: '' }
 * Longest-prefix match against DIAL_CODES; ties break toward the FAVORITE list.
 *
 * Separators inside the national part are preserved verbatim — the canonical
 * Swiss shape is '+41 79 123 45 67' and re-splitting it must not collapse the
 * grouping the member is used to reading.
 */
export function splitDialCode(
  value: string | null | undefined,
): { dial: string; national: string } {
  const raw = String(value ?? '').trim()
  if (!raw) return { dial: DEFAULT_DIAL, national: '' }

  // Only an explicit international prefix carries a country code. A bare
  // national number ('079 …') keeps the trunk zero and rides the default.
  let rest: string
  if (raw.startsWith('+')) rest = raw.slice(1)
  else if (raw.startsWith('00')) rest = raw.slice(2)
  else return { dial: DEFAULT_DIAL, national: raw }

  const digits = rest.replace(/\D/g, '')
  const match = DIALS_BY_LENGTH.find((d) => digits.startsWith(d.dial))
  // Unknown calling code: hand the whole thing back with its '+' intact so the
  // caller's compose step leaves it alone and normalizePhone still sees E.164.
  if (!match) return { dial: DEFAULT_DIAL, national: raw }

  // Walk `rest` consuming `match.dial.length` digits, so separators that follow
  // the prefix stay attached to the national part rather than the code.
  let consumed = 0
  let i = 0
  for (; i < rest.length && consumed < match.dial.length; i++) {
    if (/[0-9]/.test(rest[i])) consumed++
  }
  return { dial: match.dial, national: rest.slice(i).trim() }
}
