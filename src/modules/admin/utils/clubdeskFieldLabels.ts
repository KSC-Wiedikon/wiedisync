// ClubDesk field name → admin i18n label key, plus the resolver.
//
// Extracted from ClubdeskNeedsSync when migration 338 moved value disagreements
// into the proposals queue: the decision table now shows the same columns the
// "Needs syncing" board used to, and two copies of this map would drift the
// moment one of them gained a field. Anything unmapped falls back to the raw
// column name — sentence-cased, never raw `snake_case`, because every
// user-facing string in this app starts with a capital.
//
// ⚠ EVERY key of PROPOSAL_COLUMNS needs an entry here. `sektion` did not have
// one and rendered as the bare column name in the decision table, next to
// properly labelled rows for the same member. A test asserts the two stay in
// step, because nothing else does.
export const CD_FIELD_LABEL: Record<string, string> = {
  first_name: 'cdFieldFirstName',
  last_name: 'cdFieldLastName',
  email: 'cdFieldEmail',
  phone: 'cdFieldPhone',
  adresse: 'cdFieldAdresse',
  plz: 'cdFieldPlz',
  ort: 'cdFieldOrt',
  birthdate: 'cdFieldBirthdate',
  sex: 'cdFieldSex',
  iban: 'cdFieldIban',
  anrede: 'cdFieldAnrede',
  nationalitaet: 'cdFieldNationalitaet',
  federation_of_origin: 'cdFieldFederation',
  ahv_nummer: 'cdFieldAhv',
  register_status: 'cdFieldRegisterStatus',
  beitragskategorie: 'cdFieldKategorie',
  eintritt: 'cdFieldEintritt',
  austritt: 'cdFieldAustritt',
  trainer_licences: 'cdFieldTrainerLicences',
  gast: 'cdFieldGast',
  sektion: 'cdFieldSektion',
  js_id: 'cdFieldJsId',
  scorer_vb: 'clubStatsScorerVB',
  referee_vb: 'clubStatsRefereeVB',
  referee_bb: 'clubStatsRefereeBB',
  otr1_bb: 'clubStatsOTR1BB',
  otr2_bb: 'clubStatsOTR2BB',
  otn1_bb: 'cdFieldOtn1Bb',
  otn2_bb: 'cdFieldOtn2Bb',
}

/**
 * `beitragskategorie` → "Fee category"; an unmapped `some_new_column` →
 * "Some new column" rather than the raw identifier.
 *
 * The fallback is deliberately still legible as the column name — a missing
 * label should look like an oversight to whoever sees it, not quietly pass for a
 * designed string.
 */
export function cdFieldLabel(t: (k: string) => string, field: string | null | undefined): string {
  if (!field) return '—'
  const key = CD_FIELD_LABEL[field]
  if (key) return t(key)
  const words = field.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
