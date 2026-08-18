/**
 * The cross-register lookups `/admin/transfers` runs against FIVB's federation
 * directory (`vis_federations`) and Swiss Volley's Volleymanager register
 * (`sv_vm_check`).
 *
 * Pure and React-free. Every ISO / FIVB code used as a map key is normalised
 * with `.trim().toUpperCase()` — an unnormalised lookup silently falls through
 * to a raw column value, which is precisely the bug this module's
 * `federationForMember` exists to close.
 */

import type { TransferMember, ValidationState, VisFederation, VmRow } from '../types'

/**
 * ISO alpha-2 → the VIS federation directory row (migration 241, 69 rows).
 *
 * The directory is fetched whole and cached, and it is deliberately OUTSIDE the
 * page's boot gate: a missing directory degrades to "no contact on file" per
 * row, and must never hold the transfer worklist hostage.
 */
export function indexFederationsByIso(
  feds: readonly VisFederation[] | undefined,
): Map<string, VisFederation> {
  const map = new Map<string, VisFederation>()
  for (const f of feds ?? []) {
    const iso = String(f.iso ?? '').trim().toUpperCase()
    if (iso) map.set(iso, f)
  }
  return map
}

/**
 * FIVB 3-letter code → ISO alpha-2, taken from FIVB's OWN federation directory
 * (`vis_federations`, migration 241) rather than a map of ours.
 *
 * That distinction is the reason this is safe to do at all: the licence cell
 * deliberately prints VM's raw values without translating them, because
 * "mapping an IOC code through our own tables would let a mapping bug
 * misreport the register being checked against". A comparison has to map
 * SOMETHING, so it maps through the authority's directory — and a code the
 * directory does not know yields no comparison rather than a wrong one.
 */
export function indexIsoByFivbCode(
  feds: readonly VisFederation[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of feds ?? []) {
    const code = String(f.code ?? '').trim().toUpperCase()
    const iso = String(f.iso ?? '').trim().toUpperCase()
    if (code && iso) map.set(code, iso)
  }
  return map
}

/**
 * Two facts per licensed member, matched on `license_nr = association_id` —
 * the first and only DETERMINISTIC step of the `vm-sync-check.mjs` cascade.
 * The email and name steps are deliberately not replicated: a wrong bind here
 * would put somebody else's transfer on the worklist, whereas a missed one
 * only leaves a member in the visible "on no team" tally.
 *
 * The rows this reads come from the UNFILTERED `sv_vm_check` query — everyone
 * Volleymanager licenses for KSC Wiedikon. Cohort-INDEPENDENT on purpose, and
 * therefore a second query rather than a reuse of the filtered one behind
 * `indexVmRows` below: that one is filtered to the licence numbers of the
 * members who are ALREADY on the page, so it can confirm a row but can never
 * admit one. Unfiltered here — the club licence list is ~260 single-column rows
 * and changes only when the weekly VM sync runs.
 *
 * Every row carries a player `licence_category` (RLL/JLL/NLL/PL/DLR/DLN);
 * `is_referee` / `is_writer` are additive flags on top of a player licence,
 * never a row of their own (verified on prod 2026-08-13: 0 of 258 rows lack a
 * category). So presence here means "holds a KSCW player licence" — which is
 * precisely the thing an ITC clears.
 *
 * ⚠ `vmLicensedMembers` is not a convenience — it is the AUTHORITATIVE half of
 * "who is on this page". A Swiss Volley licence IS the thing an ITC clears, so
 * somebody VM licenses owes the transfer whether or not the club ever got round
 * to entering a `member_teams` row. Roster bookkeeping lags reality every
 * season, and on prod 2026-08-13 that lag hid four licensed, active,
 * foreign-federation players from the worklist completely — Delucchi (PE),
 * Gatsko (RU), Nikolov (BG), Suárez Perez (CO). They sat in the "on no team"
 * tally, which nobody works.
 *
 * ⚠ It also overrides the guest exclusion in `indexSportsByMember`, and
 * correctly so: "guest" means "trains with us but holds no club licence", and a
 * VM licence is that claim being false.
 *
 * ⚠ `nationality_code` is NOT citizenship, despite the name — it is the
 * SPORTING nationality, i.e. Volleymanager's own federation of origin. The
 * citizenship is the sibling `nationality` column, and the two genuinely
 * disagree: verified on prod 2026-08-13, "Italien"→SUI, "Kolumbien"→SUI,
 * "Polen"→SUI, "Deutschland"→SUI and one reverse "Schweiz"→GER. `is_foreigner`
 * tracks the CODE, not the citizenship. This is the column to compare
 * `federation_of_origin` against; comparing against `nationality` would flag
 * every dual national as a conflict. (`federation` is a third thing again —
 * the regional association, SVRZ/SVRA/SVRGSGL. Not origin at all.)
 */
export function indexVmLicences(
  vmLicenceRows: readonly { association_id: number | string; nationality_code: string | null }[] | undefined,
  members: readonly TransferMember[],
): { vmLicensedMembers: Set<string>; vmPlaysAsByMember: Map<string, string> } {
  const byAssoc = new Map<string, string>()
  for (const r of vmLicenceRows ?? []) {
    const id = String(r.association_id ?? '').trim()
    if (id) byAssoc.set(id, String(r.nationality_code ?? '').trim().toUpperCase())
  }
  const licensed = new Set<string>()
  const playsAs = new Map<string, string>()
  for (const m of members) {
    const lic = String(m.license_nr ?? '').trim()
    if (!lic || !byAssoc.has(lic)) continue
    const id = String(m.id)
    licensed.add(id)
    const code = byAssoc.get(lic)
    if (code) playsAs.set(id, code)
  }
  return { vmLicensedMembers: licensed, vmPlaysAsByMember: playsAs }
}

/**
 * The `_in` keys for the FILTERED `sv_vm_check` query — the licence-validation
 * cross-check. Only the cohorts that render a licence cell are looked up (tens
 * of rows, not the whole register) so the `_in` filter stays a short URL.
 *
 * ⚠ Pass `needs.concat(notNeeded)`, not `needs` alone. The "ruled out" table
 * renders the same licence cell, and with the narrow scope its VM evidence line
 * (`licence_validation_date`, the "VM: Italien (SUI)" origin) rendered empty —
 * the ruling was made from exactly that evidence. The blocked-eligibility alarm
 * spans both cohorts for the same reason.
 *
 * ⚠ `sv_vm_check.association_id` is an INTEGER column — a non-numeric
 * `license_nr` (they exist: hand-typed placeholders) in the `_in` list makes
 * Postgres throw on the whole query, taking the indicator down for everyone.
 * Numeric-only in, unmatched members just show "unknown". This is a crash
 * guard, not a tidy-up.
 */
export function vmMatchKeys(rows: readonly TransferMember[]): { licences: string[]; emails: string[] } {
  const licences = new Set<string>()
  const emails = new Set<string>()
  for (const m of rows) {
    const lic = String(m.license_nr ?? '').trim()
    if (/^\d+$/.test(lic)) licences.add(lic)
    const email = String(m.email ?? '').trim().toLowerCase()
    if (email) emails.add(email)
  }
  return { licences: [...licences], emails: [...emails] }
}

/**
 * Volleymanager row per member, matched on the two DETERMINISTIC steps of the
 * `vm-sync-check.mjs` cascade: `association_id = license_nr`, then email. The
 * name-based tail of that cascade is deliberately NOT replicated here — it can
 * bind the wrong VM person, and a *wrong* validation date on a transfer page is
 * worse than no date at all. The boolean itself comes from `members`
 * (mirrored by the sync), so an unmatched row still shows its real status —
 * only the date goes missing.
 *
 * ⚠ `rows` must be the SAME set `vmMatchKeys` was built from — anything wider
 * silently yields rows with no match rather than a wrong one, anything narrower
 * drops evidence that was fetched.
 */
export function indexVmRows(
  vmRows: readonly VmRow[] | undefined,
  rows: readonly TransferMember[],
): Map<string, VmRow> {
  const byLicence = new Map<string, VmRow>()
  const byEmail = new Map<string, VmRow>()
  for (const r of vmRows ?? []) {
    const assoc = String(r.association_id ?? '').trim()
    if (assoc) byLicence.set(assoc, r)
    const email = String(r.email ?? '').trim().toLowerCase()
    if (email && !byEmail.has(email)) byEmail.set(email, r)
  }
  const map = new Map<string, VmRow>()
  for (const m of rows) {
    const lic = String(m.license_nr ?? '').trim()
    const email = String(m.email ?? '').trim().toLowerCase()
    const row = (lic && byLicence.get(lic)) || (email && byEmail.get(email)) || null
    if (row) map.set(String(m.id), row)
  }
  return map
}

/** Validation state shown per row. `unknown` = Volleymanager has no licence for
 *  this person at all, which is NOT the same as an explicit "not validated". */
export function validationStateOf(m: TransferMember, vmRow: VmRow | undefined): ValidationState {
  if (m.licence_validated === true) return 'validated'
  if (m.licence_validated === false) return 'not_validated'
  return vmRow?.licence_validated === true ? 'validated' : 'unknown'
}

/**
 * "Swiss Volley licences this member as Swiss" — the register's own answer,
 * mapped through the VIS federation directory rather than string-matching
 * 'SUI', so an IOC code the directory does not know yields no claim instead of
 * a wrong one.
 *
 * ⚠ `code` is the licence's PLAYING nationality, not citizenship (see `VmRow`).
 * That is exactly the right column here: it is what Swiss Volley enforces
 * eligibility on, so 'SUI' means they will not ask us for an ITC — whether
 * because none was ever required, or because one already completed. Both land
 * on "nothing to chase", which is all this predicate claims.
 *
 * ⚠ It removes members from the worklist, so it must never fire on absence.
 * No VM row, no code, or a code the directory cannot resolve all yield false.
 * The code is already `.trim().toUpperCase()` — `indexVmLicences` normalises it
 * where it is read out of the register — and this deliberately does not
 * re-derive it: an extra normalisation step here could only ever turn a false
 * into a true, i.e. take somebody OFF the worklist.
 */
export function playsAsSwiss(
  code: string | undefined,
  isoByFivbCode: ReadonlyMap<string, string>,
): boolean {
  return !!code && isoByFivbCode.get(code) === 'CH'
}

/**
 * The member's federation of origin as VIS publishes it, or null when the
 * column is empty or the directory does not know that ISO.
 *
 * ⚠ The normalisation is the point. `federationByIso` is keyed
 * `.trim().toUpperCase()`, and the manual-link "unconfirmed" warning used to
 * look the member up with the RAW column — so a stored ' de' or 'de' fell
 * through and printed the raw ISO instead of the FIVB code, in the one sentence
 * that tells an operator which index the link failed against. Every consumer
 * goes through here now.
 */
export function federationForMember(
  m: TransferMember,
  federationByIso: ReadonlyMap<string, VisFederation>,
): VisFederation | null {
  return federationByIso.get(String(m.federation_of_origin ?? '').trim().toUpperCase()) ?? null
}
