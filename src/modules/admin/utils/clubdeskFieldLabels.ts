// ClubDesk field name → admin i18n label key.
//
// Extracted from ClubdeskNeedsSync when migration 338 moved value disagreements
// into the proposals queue: the decision table now shows the same columns the
// "Needs syncing" board used to, and two copies of this map would drift the
// moment one of them gained a field. Anything unmapped falls back to the raw
// column name, which is honest — a new proposable column should read oddly
// until somebody gives it a label, not silently render as something else.
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
}
