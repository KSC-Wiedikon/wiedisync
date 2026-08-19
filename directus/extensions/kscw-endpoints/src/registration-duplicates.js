/**
 * Registration ↔ member duplicate detection.
 *
 * The public registration form used to have NO identity check at all: it
 * validated formats (email/phone/AHV/IBAN), Turnstile and documents, then
 * inserted. So an existing member could — and repeatedly did — file a second
 * registration for themselves. Five of the first 36 prod registrations came
 * from people who were already in `members` (REG-2026-7074 Oskar Fassbind is
 * the one that surfaced this, with the EXACT same email as member #195).
 *
 * Two different answers, because two different situations:
 *
 *   1. An ACTIVE member re-registering is always a mistake → blocked at the
 *      door (`already_member`), and mirrored live in the website form so they
 *      never fill 40 fields first. They should log in, or write to the club to
 *      change sport/team.
 *   2. Anything softer — a FORMER member coming back, or a stranger who shares
 *      a name/birthdate/phone with someone on file — is NOT blocked. A
 *      rejoining ehemalige genuinely has to fill the form again, and blocking
 *      would leave them no route back in. Those rows are created and FLAGGED
 *      for /admin/anmeldungen, where staff merge onto the existing record
 *      instead of minting a second one (which is what preserves the ClubDesk
 *      link and the member's history).
 *
 * ⚠ `members.email` deliberately has NO unique index — families share one
 * address (verified on prod: the Chatzichrisafis and Clüver rows are real
 * siblings/parents on one mailbox). That is why the blocking rule is
 * email AND first name AND last name, never email alone.
 */

import { normalizePhone } from './normalize.js'

/** Symmetric first-name-prefix match — the same rule the ClubDesk linker and
 *  createMemberFromRegistration use: "Dani" ↔ "Daniel" is the same person,
 *  "Anna" ↔ "Luca" is not.
 *
 *  ⚠ The linking version treats MISSING data as a match (so legacy nameless
 *  rows still link). That is the wrong default here: this decides whether to
 *  refuse a stranger's submission, so an empty name must never satisfy it.
 *  Hence `strict` — callers deciding a BLOCK pass true. */
export function firstNamesMatch(a, b, strict = false) {
  const x = nameKey(a)
  const y = nameKey(b)
  if (!x || !y) return !strict
  return x === y || x.startsWith(y) || y.startsWith(x)
}

/** Comparison key for a name: accent-folded, lowercased, punctuation-collapsed.
 *  "Clüver" ↔ "Cluver" and "Månsson" ↔ "Mansson" are the same surname to a
 *  family filling a form twice, and Postgres `unaccent` is not installed —
 *  so folding happens here, in JS, over a small candidate set. */
export function nameKey(raw) {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Date-only key ("2009-02-01") from a Date or an ISO-ish string, so a
 *  `date` column and a form string compare equal. */
function dateKey(raw) {
  if (!raw) return ''
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? '' : raw.toISOString().slice(0, 10)
  return String(raw).slice(0, 10)
}

const emailKey = (raw) => String(raw ?? '').trim().toLowerCase()

/** Members columns the flag/diff/merge surfaces read. */
export const MEMBER_MATCH_FIELDS = [
  'id', 'first_name', 'last_name', 'email', 'phone', 'birthdate',
  'adresse', 'plz', 'ort', 'nationalitaet', 'nationalitaet_codes',
  'federation_of_origin', 'sex', 'anrede', 'ahv_nummer', 'iban', 'iban_confirmed',
  'beitragskategorie', 'kscw_membership_active', 'wiedisync_active', 'shell',
  'clubdesk_id', 'user', 'date_created',
  'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn1_bb', 'otn2_bb', 'referee_bb',
]

/**
 * Candidate members that might be the same person as `reg`.
 *
 * Four cheap indexed probes (email, surname, birthdate, phone) union'd, then
 * classified in JS — accent folding and the first-name-prefix rule can't be
 * expressed in the WHERE clause without unaccent. Each probe returns a handful
 * of rows on a ~700-member table.
 *
 * @param {import('knex').Knex} db
 * @param {object} reg  a registrations row (or a form payload with the same keys)
 * @param {object} [opts]
 * @param {number} [opts.excludeMemberId]  member already linked to this registration
 * @returns {Promise<{level: 'blocked'|'returning'|'possible'|'none', candidates: object[]}>}
 */
export async function findDuplicateCandidates(db, reg, opts = {}) {
  const email = emailKey(reg.email)
  const first = nameKey(reg.vorname)
  const last = nameKey(reg.nachname)
  const dob = dateKey(reg.geburtsdatum)
  const phone = normalizePhone(reg.telefon_mobil).value || ''

  const probes = []
  if (email) probes.push(db('members').whereRaw('LOWER(email) = ?', [email]).select(MEMBER_MATCH_FIELDS))
  // Surname probe is unfolded on purpose — it is a WIDENING probe, not the
  // decision. The folded comparison below is what actually classifies, and the
  // birthdate/phone/email probes cover the accent-drift rows this one misses.
  if (reg.nachname) probes.push(db('members').whereRaw('LOWER(last_name) = ?', [String(reg.nachname).trim().toLowerCase()]).select(MEMBER_MATCH_FIELDS))
  if (dob) probes.push(db('members').where('birthdate', dob).select(MEMBER_MATCH_FIELDS))
  if (phone) probes.push(db('members').where('phone', phone).select(MEMBER_MATCH_FIELDS))
  if (!probes.length) return { level: 'none', candidates: [] }

  const rows = (await Promise.all(probes)).flat()
  const byId = new Map()
  for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r)
  if (opts.excludeMemberId != null) byId.delete(Number(opts.excludeMemberId))

  const candidates = []
  for (const m of byId.values()) {
    const mFirst = nameKey(m.first_name)
    const mLast = nameKey(m.last_name)
    const sameEmail = !!email && emailKey(m.email) === email
    const sameLast = !!last && mLast === last
    const sameFirst = firstNamesMatch(m.first_name, reg.vorname, true)
    const sameDob = !!dob && dateKey(m.birthdate) === dob
    const samePhone = !!phone && String(m.phone || '') === phone

    // The reasons, strongest first. `exact` is the only one that can block.
    let match = null
    if (sameEmail && sameFirst && sameLast) match = 'exact'
    else if (sameLast && sameFirst && sameDob) match = 'name_dob'
    else if (sameLast && sameDob) match = 'surname_dob'
    else if (sameLast && sameFirst) match = 'name'
    else if (sameEmail && sameLast && sameDob) match = 'name_dob'
    else if (samePhone && sameLast) match = 'phone'
    if (!match) continue

    candidates.push({
      ...m,
      match,
      reasons: [
        sameEmail && 'email', sameFirst && mFirst && 'first_name',
        sameLast && 'last_name', sameDob && 'birthdate', samePhone && 'phone',
      ].filter(Boolean),
    })
  }

  // Strongest signal first, then the most complete record.
  const rank = { exact: 0, name_dob: 1, surname_dob: 2, name: 3, phone: 4 }
  candidates.sort((a, b) => (rank[a.match] - rank[b.match]) || (b.reasons.length - a.reasons.length) || (a.id - b.id))

  const exact = candidates.filter((c) => c.match === 'exact')
  const level = exact.some((c) => c.kscw_membership_active) ? 'blocked'
    : exact.length ? 'returning'
      : candidates.length ? 'possible'
        : 'none'

  return { level, candidates }
}

/** The blocking subset — an ACTIVE member who IS this person. Used by both the
 *  public create gate and the live form check, so the two can never disagree. */
export async function findBlockingMember(db, reg) {
  const { level, candidates } = await findDuplicateCandidates(db, reg)
  if (level !== 'blocked') return null
  return candidates.find((c) => c.match === 'exact' && c.kscw_membership_active) || null
}

// ── Merge: registration → member field map ──────────────────────────────────
//
// What "Merge with contact" in /admin/anmeldungen is allowed to write onto an
// existing member row. Deliberately a CLOSED list: the merge runs raw knex, so
// anything not named here can never be reached from that button.
//
// ⚠ MIRRORS createMemberFromRegistration (kscw-hooks/src/index.js) — same
// columns, same transforms. The difference is the DEFAULT, not the mapping:
// approval is fill-only (it never overwrites), merge pre-ticks every differing
// field because staff explicitly asked for "the registration is the newer
// truth". Both then converge on the same row, so change the two together.
//
// ⚠ `nationalitaet` (free text) is NOT here — it is TRIGGER-DERIVED from
// nationalitaet_codes (migration 223). Writing it directly is how you get a
// member whose country name and country code disagree.

/** Registration `geschlecht` → members `sex`. Mirrors normalizeSex in kscw-hooks. */
export function normalizeSex(val) {
  const v = String(val || '').toLowerCase()
  if (v === 'm' || v === 'männlich' || v === 'male') return 'm'
  if (v === 'f' || v === 'weiblich' || v === 'female') return 'f'
  return null
}

/** Registration `lizenz` free text → members licence boolean columns.
 *  Mirrors mapLicences in kscw-hooks. ADDITIVE only — a licence is never
 *  withdrawn by a merge, because the form only ever asserts what someone
 *  holds, never what they lost. */
export function mapLicences(lizenzStr, membershipType) {
  if (!lizenzStr) return []
  const mapped = []
  for (const p of String(lizenzStr).split(',').map((s) => s.trim().toLowerCase())) {
    if (membershipType === 'volleyball') {
      if (p.includes('schreiber') || p === 'scorer') mapped.push('scorer_vb')
      if (p.includes('schiedsrichter') || p === 'referee') mapped.push('referee_vb')
    } else if (membershipType === 'basketball') {
      if (p.includes('otr 1') || p === 'otr1') mapped.push('otr1_bb')
      if (p.includes('otr 2') || p === 'otr2') mapped.push('otr2_bb')
      if (p.includes('otn 1') || p.includes('otn1')) mapped.push('otn1_bb')
      if (p.includes('otn 2') || p.includes('otn2')) mapped.push('otn2_bb')
      if (p.includes('schiedsrichter') || p === 'referee') mapped.push('referee_bb')
    }
  }
  return [...new Set(mapped)]
}

const LICENCE_LABELS = {
  scorer_vb: 'Scorer (VB)', referee_vb: 'Referee (VB)',
  otr1_bb: 'OTR 1 (BB)', otr2_bb: 'OTR 2 (BB)',
  otn1_bb: 'OTN 1 (BB)', otn2_bb: 'OTN 2 (BB)', referee_bb: 'Referee (BB)',
}

/** The ISO code list a registration should hand a member, in order of trust —
 *  form code list → legacy singular code → free-text country resolved through
 *  `country_name_aliases`. Mirrors registrationNatCodes in kscw-hooks.
 *  Returns null when nothing resolves, so a merge simply leaves the column
 *  alone rather than tripping members_nationalitaet_codes_fmt. */
export async function registrationNatCodes(db, reg) {
  const clean = (v) => [...new Set(
    String(v || '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)),
  )]
  const codes = clean(reg.nationalitaet_codes)
  if (codes.length) return codes.join(',')
  const single = clean(reg.nationalitaet_code)
  if (single.length) return single[0]
  const name = String(reg.nationalitaet || '').trim().toLowerCase()
  if (!name) return null
  const alias = await db('country_name_aliases').where('alias', name).first('code')
  return alias?.code || null
}

const normFederation = (raw) => {
  const v = String(raw ?? '').trim().toUpperCase()
  if (v === 'NONE') return 'NONE'
  return /^[A-Z]{2}$/.test(v) ? v : null
}

const isEmpty = (v) => v === null || v === undefined || v === ''

/**
 * Field-by-field comparison of a registration against one member row.
 *
 * Every row carries `differs` (would this write change anything) and
 * `member_empty` (is this a gap-fill rather than an overwrite), so the admin
 * UI can colour an overwrite differently from a fill without re-deriving the
 * rule client-side.
 *
 * @returns {Promise<Array<{key,label,kind,member_value,registration_value,differs,member_empty}>>}
 */
export async function buildMergeDiff(db, reg, member) {
  const natCodes = await registrationNatCodes(db, reg)
  const scalar = [
    ['first_name', 'First name', reg.vorname],
    ['last_name', 'Last name', reg.nachname],
    ['email', 'Email', reg.email],
    ['phone', 'Phone', reg.telefon_mobil],
    ['adresse', 'Address', reg.adresse],
    ['plz', 'Postcode', reg.plz],
    ['ort', 'City', reg.ort],
    ['birthdate', 'Date of birth', reg.geburtsdatum ? dateKey(reg.geburtsdatum) : null],
    ['nationalitaet_codes', 'Nationality', natCodes],
    ['federation_of_origin', 'Federation of origin', normFederation(reg.federation_of_origin)],
    ['sex', 'Sex', normalizeSex(reg.geschlecht)],
    ['anrede', 'Salutation', ['Herr', 'Frau'].includes(reg.anrede) ? reg.anrede : null],
    ['ahv_nummer', 'AHV number', reg.ahv_nummer],
    ['iban', 'IBAN', reg.iban],
    ['beitragskategorie', 'Fee category', reg.beitragskategorie],
  ]

  const out = []
  for (const [key, label, rawValue] of scalar) {
    // Nothing to offer: the form left it blank. Never propose clearing a
    // member column from an unanswered field.
    if (isEmpty(rawValue)) continue
    const current = key === 'birthdate' ? (member.birthdate ? dateKey(member.birthdate) : null) : member[key]
    out.push({
      key, label, kind: 'scalar',
      member_value: isEmpty(current) ? null : String(current),
      registration_value: String(rawValue),
      differs: String(current ?? '') !== String(rawValue),
      member_empty: isEmpty(current),
    })
  }

  // Licences are additive booleans — only ever offered as false → true.
  for (const lic of mapLicences(reg.lizenz, reg.membership_type)) {
    if (member[lic]) continue
    out.push({
      key: lic, label: LICENCE_LABELS[lic] || lic, kind: 'licence',
      member_value: 'no', registration_value: 'yes', differs: true, member_empty: true,
    })
  }
  return out
}

/**
 * Turn the admin's chosen field keys into a members UPDATE patch.
 * Only keys the diff actually offered are honoured — an unknown or
 * non-differing key is dropped rather than trusted.
 */
export function buildMergePatch(diff, selectedKeys) {
  const wanted = new Set(selectedKeys || [])
  const patch = {}
  for (const row of diff) {
    if (!wanted.has(row.key) || !row.differs) continue
    patch[row.key] = row.kind === 'licence' ? true : row.registration_value
  }
  // The member typed the IBAN themselves on the form and it arrived mod-97
  // validated + normalized (registration.js) — same reasoning as the approval
  // hook, which is why that path also stamps it confirmed.
  if (patch.iban) patch.iban_confirmed = true
  return patch
}
