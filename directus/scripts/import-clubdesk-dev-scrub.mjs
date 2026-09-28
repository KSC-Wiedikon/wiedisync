/**
 * import-clubdesk-dev-scrub.mjs — the dev-refresh PII scrub, applied to ClubDesk
 * rows BEFORE a dev-target import writes them (audit 2026-09-28, F14 remainder).
 *
 * WHY
 * ---
 * The nightly refresh (refresh-dev-scrub.sql) scrubs the prod clone, but a dev
 * ClubDesk sync-down ("Sync now" on dev → clubdesk-member-dispatch.sh →
 * clubdesk-sync.sh with CLUBDESK_ENV=dev, or `npm run db:clubdesk:sync:dev` /
 * `db:finance:sync:dev`) pulled the LIVE register back into dev: real AHV, IBAN,
 * phones, streets and birthdates in clubdesk_export, and `fill` proposals
 * carrying them towards members, until the next 03:00 run.
 *
 * Both importers now pass every row through this module when <env> is `dev`, so
 * the real values never reach the dev database at all (not even inside a
 * transaction). The prod path never loads this file (dynamic import behind the
 * env check), so prod behaviour is unchanged even if this file were missing.
 *
 * PARITY
 * ------
 * Every transform mirrors the SQL in refresh-dev-scrub.sql one-to-one — same
 * hash (first 32 bits of md5(salt || value)), same "Teststrasse N" street, same
 * example IBAN, same birthdate shift (keeps the birth YEAR and the side of
 * today's month/day, so age and minor/adult status are unchanged), same
 * 'scrub_<md5>@devsink.invalid' email mapping, same NULLed columns.
 * CLUBDESK_EXPORT_SCRUB below is checked against the SQL's `UPDATE
 * clubdesk_export` block by __tests__/refresh-dev-scrub.test.mjs — change both.
 *
 * The salt is per RUN and never stored (like the refresh's), so the fake street
 * / DoB cannot be inverted. Consequence: a dev import's fake values are NOT
 * equal to the ones the last refresh put into `members` (different salt). The
 * down-sync only stages `fill` proposals for these columns (never `overwrite`),
 * so this only shows where dev's member cell is empty — and then it offers a
 * fake value, which is harmless.
 */

import { createHash, randomUUID } from 'node:crypto'

/** SIX's published example IBAN (valid checksum) — the refresh uses the same. */
export const DEV_IBAN = 'CH9300762011623852957'

/**
 * clubdesk_export column → transform. Mirrors refresh-dev-scrub.sql's
 * `UPDATE clubdesk_export SET …` block exactly (the test compares them).
 *   null     → NULL
 *   email    → 'scrub_' || substr(md5(v),1,16) || '@devsink.invalid'
 *   iban     → pg_temp.kscw_iban
 *   street   → pg_temp.kscw_street
 *   ddmmyyyy → pg_temp.kscw_shift_ddmmyyyy
 */
export const CLUBDESK_EXPORT_SCRUB = Object.freeze({
  email: 'email',
  email_alternativ: 'email',
  ahv_nummer: 'null',
  iban: 'iban',
  kontoinhaber: 'null',
  adresse: 'street',
  adress_zusatz: 'null',
  telefon_geschaeft: 'null',
  telefon_mobil: 'null',
  telefon_privat: 'null',
  fax: 'null',
  bic: 'null',
  bemerkungen: 'null',
  geburtsdatum: 'ddmmyyyy',
})

const md5 = (s) => createHash('md5').update(String(s), 'utf8').digest('hex')
const blank = (v) => v == null || String(v).trim() === ''
const pad2 = (n) => String(n).padStart(2, '0')
const DAY = 86400000

/** Today's date in Europe/Zurich as {y, m, d}. */
function zurichToday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()).split('-').map(Number)
  return { y, m, d }
}

/**
 * @param {{ salt?: string, today?: { y: number, m: number, d: number } }} [opts]
 *   Both are for tests; a real run gets a random salt and today's Zurich date.
 */
export function createDevScrubber(opts = {}) {
  const salt = opts.salt ?? `${randomUUID()}${Date.now()}`
  const today = opts.today ?? zurichToday()

  /** pg_temp.kscw_h — 32-bit non-negative hash of a value under the run salt. */
  const hash = (v) => parseInt(md5(salt + v).slice(0, 8), 16)

  /** pg_temp.kscw_shift_date on an ISO 'YYYY-MM-DD' string; null on bad input. */
  function shiftIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''))
    if (!m) return null
    const y = +m[1], mo = +m[2], d = +m[3]
    const t = Date.UTC(y, mo - 1, d)
    const dt = new Date(t)
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
    const jan1 = Date.UTC(y, 0, 1)
    const dec31 = Date.UTC(y, 11, 31)
    // Today's month/day transplanted into year y (29.02. → 28.02. in a common year).
    const lastOfMonth = new Date(Date.UTC(y, today.m, 0)).getUTCDate()
    const cut = Date.UTC(y, today.m - 1, Math.min(today.d, lastOfMonth))
    const [lo, hi] = t <= cut ? [jan1, cut] : [cut + DAY, dec31]
    const span = Math.round((hi - lo) / DAY) + 1
    const out = new Date(lo + (hash(iso) % span) * DAY)
    return `${out.getUTCFullYear()}-${pad2(out.getUTCMonth() + 1)}-${pad2(out.getUTCDate())}`
  }

  /** pg_temp.kscw_shift_ddmmyyyy — unparseable → null (never abort on one cell). */
  function shiftDdmmyyyy(v) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(v ?? ''))
    if (!m) return null
    const iso = shiftIso(`${m[3]}-${m[2]}-${m[1]}`)
    if (!iso) return null
    const [y, mo, d] = iso.split('-')
    return `${d}.${mo}.${y}`
  }

  /** pg_temp.kscw_street — deterministic 'Teststrasse N' under the salt. */
  const street = (v) => (blank(v) ? v : `Teststrasse ${(hash(String(v).trim().toLowerCase()) % 200) + 1}`)
  /** pg_temp.kscw_iban */
  const iban = (v) => (blank(v) ? v : DEV_IBAN)
  /** The refresh's email mapping (unsalted md5, like the SQL). */
  const email = (v) => (v == null || v === '' ? v : `scrub_${md5(v).slice(0, 16)}@devsink.invalid`)

  const KIND = {
    null: () => '',
    email,
    iban,
    street,
    ddmmyyyy: (v) => shiftDdmmyyyy(v) ?? '',
  }

  /**
   * Scrub one staged clubdesk_export row IN PLACE.
   * @param {string[]} cols   target column names (TARGET_COLS)
   * @param {string[]} values the row's values in that order ('' = NULL)
   */
  function clubdeskExportRow(cols, values) {
    cols.forEach((col, i) => {
      const kind = CLUBDESK_EXPORT_SCRUB[col]
      if (kind && values[i] != null && values[i] !== '') values[i] = KIND[kind](values[i]) ?? ''
    })
    return values
  }

  return { hash, shiftIso, shiftDdmmyyyy, street, iban, email, clubdeskExportRow }
}
