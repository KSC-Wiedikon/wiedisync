/**
 * ClubDesk Data Update — sends CSV email to admin when member updates ClubDesk-relevant fields
 * POST /kscw/clubdesk-update — authenticated
 */

import { buildEmailLayout, buildInfoCard, bucketEmailsByLocale } from './email-template.js'
import { writeUserLog } from './activity-log.js'
import { normalizePhone, normalizeIban, normalizeAhv, normalizeEmail } from './normalize.js'

/** Canonical form for an outgoing push cell; unrewritable values pass raw
 *  (result.value carries the raw input when ok is false). */
const normVal = (fn, v) => fn(v).value || ''

const OWNER_EMAIL = 'luca.canepa@gmail.com'
const ADMIN_EMAIL = 'kontakt@kscw.ch'

/** Current season in Wiedisync short form, e.g. '2025/26' (matches member_teams.season). June cutover — same as src/utils/dateHelpers.ts. */
function getCurrentSeason() {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth()
  return m < 5 ? `${y - 1}/${String(y).slice(2)}` : `${y}/${String(y + 1).slice(2)}`
}

/** Per-locale display labels for DB field names */
const FIELD_LABELS = {
  de: {
    first_name: 'Vorname', last_name: 'Nachname', email: 'E-Mail', phone: 'Telefon',
    birthdate: 'Geburtsdatum', anrede: 'Anrede', adresse: 'Adresse', plz: 'PLZ', ort: 'Ort',
    nationalitaet: 'Nationalität', sex: 'Geschlecht', ahv_nummer: 'AHV-Nummer',
  },
  gsw: {
    first_name: 'Vorname', last_name: 'Nachname', email: 'E-Mail', phone: 'Telefon',
    birthdate: 'Geburtsdatum', anrede: 'Aaräde', adresse: 'Adrässe', plz: 'PLZ', ort: 'Ort',
    nationalitaet: 'Nationalität', sex: 'Gschlächt', ahv_nummer: 'AHV-Nummer',
  },
  en: {
    first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone',
    birthdate: 'Date of birth', anrede: 'Salutation', adresse: 'Address', plz: 'Zip', ort: 'City',
    nationalitaet: 'Nationality', sex: 'Sex', ahv_nummer: 'AHV number',
  },
  fr: {
    first_name: 'Prénom', last_name: 'Nom', email: 'E-mail', phone: 'Téléphone',
    birthdate: 'Date de naissance', anrede: 'Salutation', adresse: 'Adresse', plz: 'NPA', ort: 'Localité',
    nationalitaet: 'Nationalité', sex: 'Sexe', ahv_nummer: "Numéro d'AVS",
  },
  it: {
    first_name: 'Nome', last_name: 'Cognome', email: 'E-mail', phone: 'Telefono',
    birthdate: 'Data di nascita', anrede: 'Appellativo', adresse: 'Indirizzo', plz: 'CAP', ort: 'Località',
    nationalitaet: 'Nazionalità', sex: 'Sesso', ahv_nummer: 'Numero AVS',
  },
}

const T = {
  de: {
    title: 'ClubDesk Datenanpassung',
    subject: name => `[KSCW] Datenanpassung: ${name}`,
    intro: 'Folgende Daten wurden vom Mitglied aktualisiert und müssen in ClubDesk übernommen werden:',
    currentData: 'Aktuelle Daten',
    name: 'Name', email: 'E-Mail', phone: 'Telefon', team: 'Team',
    field: 'Feld', oldValue: 'Alt', newValue: 'Neu',
  },
  gsw: {
    title: 'ClubDesk Datenaapassig',
    subject: name => `[KSCW] Datenaapassig: ${name}`,
    intro: 'Folgendi Date sind vom Mitglied aktualisiert worde und müend i ClubDesk übernoh werde:',
    currentData: 'Aktuelli Date',
    name: 'Name', email: 'E-Mail', phone: 'Telefon', team: 'Team',
    field: 'Fäld', oldValue: 'Alt', newValue: 'Neu',
  },
  en: {
    title: 'ClubDesk Data Update',
    subject: name => `[KSCW] Data update: ${name}`,
    intro: 'The following data was updated by the member and needs to be applied in ClubDesk:',
    currentData: 'Current data',
    name: 'Name', email: 'Email', phone: 'Phone', team: 'Team',
    field: 'Field', oldValue: 'Old', newValue: 'New',
  },
  fr: {
    title: 'Mise à jour ClubDesk',
    subject: name => `[KSCW] Mise à jour : ${name}`,
    intro: "Les données suivantes ont été mises à jour par le membre et doivent être reportées dans ClubDesk :",
    currentData: 'Données actuelles',
    name: 'Nom', email: 'E-mail', phone: 'Téléphone', team: 'Équipe',
    field: 'Champ', oldValue: 'Ancien', newValue: 'Nouveau',
  },
  it: {
    title: 'Aggiornamento ClubDesk',
    subject: name => `[KSCW] Aggiornamento: ${name}`,
    intro: 'I seguenti dati sono stati aggiornati dal socio e devono essere riportati in ClubDesk:',
    currentData: 'Dati attuali',
    name: 'Nome', email: 'E-mail', phone: 'Telefono', team: 'Squadra',
    field: 'Campo', oldValue: 'Vecchio', newValue: 'Nuovo',
  },
}

const CD_LOCALES = ['de', 'gsw', 'en', 'fr', 'it']

const CSV_HEADERS = [
  'Anrede', 'Vorname', 'Nachname', 'E-Mail', 'Telefon',
  'Adresse', 'PLZ', 'Ort', 'Geburtsdatum', 'Nationalität',
  'Geschlecht', 'AHV', 'Team', 'Beitragskategorie',
]

function escCsv(val) {
  let s = String(val ?? '')
  // Neutralize spreadsheet formula injection: a cell that starts with =, @,
  // (or a tab/CR) is interpreted as a formula by Excel/ClubDesk. These CSVs
  // carry member-controlled fields, so prefix such cells with a single quote to
  // force literal text before applying the usual quoting. Leading '+'/'-'
  // followed by a digit, space or '(' is phone-style DATA and stays unguarded
  // (the blanket guard put literal apostrophes into ClubDesk phone fields —
  // see cdCell); any other '+'/'-' prefix (e.g. +HYPERLINK) is still escaped.
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d( ])/.test(s)) s = `'${s}`
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(data, teamNames) {
  const row = [
    data.anrede, data.first_name, data.last_name, data.email, data.phone,
    data.adresse, data.plz, data.ort, data.birthdate, data.nationalitaet,
    data.sex, data.ahv_nummer, teamNames, data.beitragskategorie,
  ]
  return CSV_HEADERS.join(',') + '\n' + row.map(escCsv).join(',')
}

// ClubDesk's CSV interface is Windows-1252, not UTF-8 (its export is CP1252 and
// the scripted sync-up push iconv-transcodes before upload — see
// clubdesk-member-up-dispatch.sh). The emailed CSVs get imported into ClubDesk by
// hand, so a UTF-8 attachment mangles every accented name (ü → Ã¼). Encode CP1252
// and transliterate the few letters CP1252 can't hold (ć → c, ń → n) instead of
// shipping mojibake into the legal member register.
const CP1252_EXTRA = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A,
  '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C,
  'ž': 0x9E, 'Ÿ': 0x9F,
}
// Letters with no CP1252 slot and no combining-mark decomposition.
const CP1252_TRANSLIT = { 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L' }
export function toCp1252Buffer(str) {
  const bytes = []
  const pushChar = (ch) => {
    const cp = ch.codePointAt(0)
    if (cp <= 0x7F || (cp >= 0xA0 && cp <= 0xFF)) { bytes.push(cp); return true }
    if (CP1252_EXTRA[ch] !== undefined) { bytes.push(CP1252_EXTRA[ch]); return true }
    return false
  }
  for (const ch of str) {
    if (pushChar(ch)) continue
    const base = CP1252_TRANSLIT[ch] || ch.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    let ok = base.length > 0
    const mark = bytes.length
    for (const b of base) if (!pushChar(b)) { ok = false; break }
    if (!ok) { bytes.length = mark; bytes.push(0x3F) } // '?'
  }
  return Buffer.from(bytes)
}

// ── Sync-up push CSV (member → ClubDesk import) ─────────────────────────────
// Headers are the EXACT ClubDesk field names so the import wizard auto-maps every
// column (verified live 2026-06-27 — "Telefon Privat" not "Telefon"). Semicolon-
// delimited (ClubDesk's import default). UPDATE rows carry CONTACT fields only —
// never groups/teams/membership category/status (ClubDesk-managed on existing
// contacts); CREATE rows additionally carry Beitragskategorie + Eintritt +
// Gruppen + Status (see CD_PUSH_CREATE_HEADERS below).
//
// wiedisync is NOT the source of truth for Anrede, Nationalität or AHV Nummer:
// the down-sync (import-clubdesk-csv.mjs) never populates members.anrede/
// nationalitaet/ahv_nummer, so they are always NULL here. Pushing them would send
// BLANK cells and — if ClubDesk overwrites on import — wipe the authoritative
// Anrede/Nationalität/AHV in the legal register. They are therefore DELIBERATELY
// omitted from the push; do NOT re-add without a matching down-sync that fills them.
// ⚠ VALIDATION: the remaining columns still push the full wiedisync value — how
// ClubDesk's import wizard treats an empty cell (skip vs. blank the field) must be
// validated against a live import before enabling commit on prod (see up-dispatch).
// IBAN joined the push scope 2026-07-06 (user: members enter it in their
// profile via PayoutIbanCard, finance edits it too — wiedisync owns it once
// set). The down-sync deliberately does NOT fill members.iban (deleted-IBAN
// resurrection, see import-clubdesk-csv.mjs), so most members are empty here
// while ClubDesk holds a value → /up ECHOES ClubDesk's own IBAN back into the
// cell when wiedisync's is empty (no-op on import, nothing blanked, no member
// dropped). A member-entered IBAN always wins.
const CD_PUSH_HEADERS = [
  'Vorname', 'Nachname', 'E-Mail', 'Telefon Privat', 'Adresse',
  'PLZ', 'Ort', 'Geburtsdatum', 'Geschlecht', 'IBAN',
  // Anrede/Nationalität/AHV Nummer joined the push scope 2026-07-07: the
  // down-sync now fills members.anrede/nationalitaet/ahv_nummer, so wiedisync
  // holds them, and /up ECHOES ClubDesk's own value back into any empty cell
  // (like IBAN) — an empty wiedisync field can never blank the register. Anrede
  // and Nationalität are ClubDesk PICKLISTS (values come from the down-sync so
  // they already match); AHV Nummer is free text (pushing wiedisync's clean
  // value also repairs ClubDesk cells the Zahl-format once mangled).
  'Anrede', 'Nationalität', 'AHV Nummer',
  // Wiedisync ID (custom ClubDesk text field, 2026-07-07): wiedisync's member
  // UUID (members.uuid, migration 184 — globally unique, visually distinct from
  // ClubDesk's own numeric [Id]; pre-184 stamps carried the numeric members.id
  // and stay valid — the linker accepts both). Pushed on EVERY create + update;
  // wiedisync fully owns it (never echo, never empty), so the down-sync can
  // link contact↔member by this exact key — immune to the name/email/accent
  // drift that email+name matching suffers. This closes the create round-trip
  // (up → new [Id] → down-link) with zero ambiguity. ClubDesk's import can't
  // MATCH on it (no ID upsert), but the down-sync linker reads it back as the
  // authoritative key.
  'Wiedisync ID',
]

// ── CREATE-set extras (new ClubDesk contacts only) ───────────────────────────
// A brand-new contact has no ClubDesk-owned category, entry date, groups or
// status to protect, so the CREATE-set CSV additionally carries
// Beitragskategorie (captured by the signup form →
// registrations.beitragskategorie → members.beitragskategorie via the approval
// hook), Eintritt (the registration submission date — per user rule 2026-07-06
// "the date the registration is sent", NOT approved_at), Gruppen (derived
// from the registration's team + funktion: `VB H1 (Spieler*in)`,
// `BB HU14 (Trainer*in)` — ClubDesk's group naming, verified against the export
// snapshot 2026-07-05), Status (Aktiv-/Passivmitglied — see deriveStatus) and
// Offiziellen Lizenz (scorer/officials licence — see deriveOffiziellenLizenz).
// UPDATE pushes NEVER send these columns — ClubDesk stays authoritative on
// existing contacts, and its empty-cell import behavior is unvalidated (a blank
// cell could wipe the value in the legal register). That is why /up stashes TWO
// CSVs (up_csv + up_csv_create) instead of one.
// ⚠ Gruppen maps in the import wizard as free TEXT and a commit does NOT
// create the group membership (PROVEN 2026-07-06: Månsson/Clüver creates
// carried Gruppen, landed with empty groups). The column stays as harmless
// self-documentation in the import preview — group assignment is manual in
// ClubDesk.
// CREATE rows also duplicate the single member phone into Telefon Mobil (user
// 2026-07-06: "unless present, Privat and Mobil the same"), and carry the
// Passivmitglied Ja/Nein checkbox + Sektion (Volleyball/Basketball/KSCW). These
// are CREATE-only — an UPDATE never overwrites a distinct Mobil / ClubDesk-owned
// Sektion on an existing contact.
export const CD_PUSH_CREATE_HEADERS = [...CD_PUSH_HEADERS, 'Telefon Mobil', 'Beitragskategorie', 'Eintritt', 'Gruppen', 'Status', 'Offiziellen Lizenz', 'Mitgliederbeitrag', 'Passivmitglied', 'Sektion', 'Schiedsrichter']

// Sport prefix for ClubDesk group names (`VB H1 (Spieler*in)`), keyed by
// registrations.membership_type. Passive registrations have no team → no group.
const CD_GRUPPEN_SPORT_PREFIX = { volleyball: 'VB', basketball: 'BB' }
// Funktionen that map to a ClubDesk group suffix. Anything else (passive
// licence lists, "Andere") gets NO group — never drop someone into a player
// group they don't belong to.
const CD_GRUPPEN_FUNKTIONEN = ['Spieler*in', 'Trainer*in']

// Derive the ClubDesk Gruppen cell from an approved registration: one group per
// team, `<VB|BB> <team> (<funktion>)`, PLUS the officials groups the person's
// licence puts them in (user 2026-07-06): a VB Schreiber → "VB Schreiber:innen",
// a VB Schiedsrichter → "VB Schiedsrichter:innen", a BB referee → "Schiedsrichter
// BB". Returns '' when nothing resolves — empty is safe on a CREATE row. Note:
// Gruppen import is a no-op (proven), so this cell is assignment DOCUMENTATION;
// the actual membership is set manually / by the group-batch tool.
export function deriveGruppen(reg) {
  if (!reg) return ''
  const prefix = CD_GRUPPEN_SPORT_PREFIX[String(reg.membership_type || '').trim().toLowerCase()]
  const groups = []
  const funktion = String(reg.rolle || '').trim()
  if (prefix && CD_GRUPPEN_FUNKTIONEN.includes(funktion)) {
    for (const t of String(reg.team || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      groups.push(`${prefix} ${t} (${funktion})`)
    }
  }
  // VB scorers go in the "VB Schreiber*innen" group (user 2026-07-07, exact
  // ClubDesk group name). Referees are NOT grouped here — they are marked by
  // the Schiedsrichter Ja/Nein field instead (deriveSchiedsrichter).
  const lic = String(reg.lizenz || '').toLowerCase()
  if (prefix === 'VB' && lic.includes('schreiber')) groups.push('VB Schreiber*innen')
  return groups.join(', ')
}

// Derive the ClubDesk Status for a NEW contact (per user rule 2026-07-05:
// "active for new registrations, active if wiedisync_active true"): a fresh
// approved registration makes an Aktivmitglied (Passivmitglied when the
// registration is the passive path); without a registration, only a member the
// app considers active (wiedisync_active) gets Aktivmitglied. Everything else
// stays empty → ClubDesk's default ("Kein Mitglied"), never guessed.
export function deriveStatus(reg, member) {
  if (reg) {
    return String(reg.membership_type || '').trim().toLowerCase() === 'passive'
      ? 'Passivmitglied' : 'Aktivmitglied'
  }
  return member?.wiedisync_active === true ? 'Aktivmitglied' : ''
}

// Derive the ClubDesk "Offiziellen Lizenz" cell from the member's licence
// booleans (VB flags authoritative from Volleymanager, BB from ClubDesk).
// ClubDesk's picklist (user-revised 2026-07-06): VB SR / VB SC for volleyball,
// OTR1 / OTR2 / OTN / Keine / Sammelt Unterschriften for basketball.
//   • VB referee → "VB SR"  (a referee is also a Schreiber — SR is the superset)
//   • VB scorer  → "VB SC"
//   • BB OTR1/OTR2/OTN → same
//   • none → empty (never guessed, ClubDesk stays unset)
// Cross-sport dual holders can't happen at create time (one registration = one
// sport) — first match in this order wins.
export function deriveOffiziellenLizenz(m) {
  // VB referees are marked by the separate Schiedsrichter Ja/Nein field now
  // (user 2026-07-07). Offiziellen Lizenz carries the scorer/table-officials
  // licence: a VB referee is AUTOMATICALLY a scorer (user 2026-07-07), so
  // scorer_vb OR referee_vb → VB SC. BB officials by level. Nothing → empty.
  if (m?.scorer_vb === true || m?.referee_vb === true) return 'VB SC'
  if (m?.otr1_bb === true) return 'OTR1'
  if (m?.otr2_bb === true) return 'OTR2'
  if (m?.otn_bb === true) return 'OTN'
  return ''
}

// The ClubDesk "Schiedsrichter" Ja/Nein field (user 2026-07-07): Ja when the
// member holds a referee licence (VB or BB), else Nein. Referees are marked
// here instead of via a referee group.
export function deriveSchiedsrichter(m) {
  return (m?.referee_vb === true || m?.referee_bb === true) ? 'Ja' : 'Nein'
}

// Derive the ClubDesk Sektion for a NEW contact from the registration's sport:
// volleyball → Volleyball, basketball → Basketball. Passive registrations have
// no sport — the registration approver picks Volleyball/Basketball/KSCW in
// wiedisync (registrations.sektion_choice), so use that; fall back to KSCW when
// unset (a passive member always belongs to the club).
export function deriveSektion(reg) {
  if (!reg) return ''
  const mt = String(reg.membership_type || '').trim().toLowerCase()
  if (mt === 'volleyball') return 'Volleyball'
  if (mt === 'basketball') return 'Basketball'
  // passive (or unknown) → approver's choice, default KSCW
  return String(reg.sektion_choice || '').trim() || 'KSCW'
}

// Derive the ClubDesk Passivmitglied Ja/Nein checkbox from the registration.
export function derivePassivmitglied(reg) {
  return reg && String(reg.membership_type || '').trim().toLowerCase() === 'passive' ? 'Ja' : 'Nein'
}

// Signup-form category → ClubDesk Beitragskategorie picklist name. The form's
// names only partially match ClubDesk's configured categories (e.g. the form
// says "BB Lernende/Studierende", ClubDesk has "BB Student/Lehrling"; "VB
// Turnier KWI" has no ClubDesk category yet). ClubDesk's import treatment of
// an UNKNOWN category value is unvalidated — fill this map as the
// ClubDesk-side names are confirmed. Unmapped values pass through verbatim
// (visible in the dry-run preview before any commit).
// BB youth decided 2026-07-06 (user): the two ClubDesk categories are
// "BB Minis Turnier" (U12 and under, CHF 210) and "BB Jugend Meisterschaft"
// (older youth, CHF 310) — the form now submits those names directly; the two
// entries below only translate LEGACY rows captured under the pre-2026-07-06
// form values.
export const CD_KATEGORIE_MAP = {
  'BB Junior:innen': 'BB Jugend Meisterschaft',
  'BB Minis': 'BB Minis Turnier',
  // 'VB Student*in Meisterschaft': '…',
  // 'BB Lernende/Studierende': '…',
  // 'VB Turnier KWI': '…',
}
export function mapKategorie(v) {
  const k = String(v ?? '').trim()
  return Object.prototype.hasOwnProperty.call(CD_KATEGORIE_MAP, k) ? CD_KATEGORIE_MAP[k] : k
}

// Category → Mitgliederbeitrag (CHF/season), confirmed by the user 2026-07-06:
// VB = published website fees (matched ClubDesk exactly); BB = the ClubDesk
// values (website was CHF 10 high, corrected the same day); BB youth = the two
// new age-split categories. Keys cover BOTH name families because
// members.beitragskategorie can hold either: signup-form names (registration
// path) or ClubDesk names (the CD-authoritative Kategorie fill in
// import-clubdesk-csv.mjs). Pushed on CREATE rows only — on existing contacts
// Mitgliederbeitrag is a per-person field with manual overrides (e.g.
// "Speziallizenz, einmalig so tief"), never ours to overwrite. The map holds
// the WITH-scorer-licence BASE amount; the CHF 100 no-Schreiber surcharge is
// applied on top by deriveMitgliederbeitrag (user rule 2026-07-06).
export const CD_BEITRAG_MAP = {
  'VB Erwerbstätige': 440,
  'VB Student*in Meisterschaft': 380, 'VB Studenten/Lehrlinge': 380,
  'VB Schüler*in Meisterschaft': 310, 'VB Schüler Meisterschaft': 310,
  'VB Schüler*in Turnier': 210, 'VB Schüler Turnier': 210,
  'VB Turnier KWI': 110, 'VB Schüler*in 1. Jahr': 110,
  'BB Erwerbstätige': 510, 'BB Erwerbstätig': 510,
  'BB Erwerbstätige 1. Liga': 560, 'BB Erwerbstätig 1. Liga': 560,
  'BB Lernende/Studierende': 410, 'BB Student/Lehrling': 410, 'BB Studenten/Lehrlinge': 410,
  'BB Lernende/Studierende 1. Liga': 460, 'BB Student/Lehrling 1. Liga': 460,
  'BB Jugend Meisterschaft': 310, 'BB Junior:innen': 310, 'BB 2 Trainings': 310,
  'BB Minis Turnier': 210, 'BB Minis': 210, 'BB 1 Trainings': 210,
  'Passivmitglied': 40,
  'Gratis': 0,
}
// The CHF 100 no-licence surcharge (VB: website "Mitgliederbeitrag für aktive
// Mitglieder ohne Schreiberlizenz um CHF 100 erhöht"; BB: user rule 2026-07-06
// replacing the deleted ClubDesk "Offiziellen 100er" field). The map amounts
// are the WITH-licence base; +100 for a member with the duty but no licence.
// Confirmed against the export (VB Erwerbstätige 440/540, Student 380/480, Schüler Meisterschaft
// 310/410, Schüler Turnier 210/310; BB Erwerbstätig 510/610, 1.Liga 560/660,
// Student 410/510, Jugend 310/410, Minis 210/310). Duty applies from U16 AND
// ABOVE ONLY (user 2026-07-06) — younger players never pay it.
//
// ADULT categories are inherently U16+ → surcharge on a missing licence
// regardless of birthdate. Both ClubDesk name families listed.
const SURCHARGE_ADULT = new Set([
  'VB Erwerbstätige',
  'VB Student*in Meisterschaft', 'VB Studenten/Lehrlinge',
  'BB Erwerbstätige', 'BB Erwerbstätig',
  'BB Erwerbstätige 1. Liga', 'BB Erwerbstätig 1. Liga',
  'BB Lernende/Studierende', 'BB Student/Lehrling', 'BB Studenten/Lehrlinge',
  'BB Lernende/Studierende 1. Liga', 'BB Student/Lehrling 1. Liga',
])
// YOUTH categories are mixed-age → surcharge ONLY when the member is U16+ by
// birthdate (isU16Plus). U14/Minis players never pay it. The intro tiers
// "VB Turnier KWI" / "VB Schüler*in 1. Jahr" and Passiv/Gratis are in NEITHER
// set → never surcharged.
const SURCHARGE_YOUTH = new Set([
  'VB Schüler*in Meisterschaft', 'VB Schüler Meisterschaft',
  'VB Schüler*in Turnier', 'VB Schüler Turnier',
  'BB Jugend Meisterschaft', 'BB Junior:innen', 'BB 2 Trainings',
  'BB Minis Turnier', 'BB Minis', 'BB 1 Trainings',
])
// U16-and-above age gate (user 2026-07-06: surcharge only for U16+). "U16" is a
// birth-year band, so approximate by age — a player who turns at least 15 in
// the current calendar year (birthYear <= thisYear - 15) counts as U16+.
// Unknown birthdate → null (caller treats youth as NOT U16+, so a young member
// is never over-charged without knowing the age).
export function isU16Plus(member, refYear = new Date().getFullYear()) {
  const bd = member?.birthdate
  if (!bd) return null
  const iso = bd instanceof Date ? bd.toISOString().slice(0, 10) : String(bd)
  const y = Number(iso.slice(0, 4))
  if (!Number.isInteger(y) || y < 1900) return null
  return (refYear - y) >= 15
}

export function deriveMitgliederbeitrag(kategorie, member = null) {
  const k = String(kategorie ?? '').trim()
  if (!Object.prototype.hasOwnProperty.call(CD_BEITRAG_MAP, k)) return '' // unknown → empty, never guessed
  let amount = CD_BEITRAG_MAP[k]
  // member===null (flags unavailable) → base only, a safe default. Adult
  // category → surcharge on missing licence; youth category → surcharge only
  // when the member is U16+ (isU16Plus() === true).
  if (member) {
    const isVb = k.startsWith('VB ')
    const hasLicence = isVb
      ? member.scorer_vb === true
      : (member.otr1_bb === true || member.otr2_bb === true || member.otn_bb === true)
    const eligible = SURCHARGE_ADULT.has(k) || (SURCHARGE_YOUTH.has(k) && isU16Plus(member) === true)
    if (eligible && !hasLicence) amount += 100
  }
  return String(amount)
}

function fmtBirthdateDDMMYYYY(v) {
  if (!v) return ''
  const iso = (v instanceof Date) ? v.toISOString().slice(0, 10) : String(v)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

// Semicolon-CSV cell: neutralise spreadsheet-formula injection, then quote.
// Leading '+'/'-' followed by a digit, space or '(' is DATA, not a formula —
// the blanket guard used to land a literal apostrophe in ClubDesk's phone
// fields on every committed push ('+41 …; found 2026-07-06 on 10 contacts,
// repaired via the backfill import). '=', '@', tab, CR and '+'/'-' followed by
// anything else (e.g. +HYPERLINK(…)) stay guarded.
function cdCell(val) {
  let s = String(val ?? '')
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d( ])/.test(s)) s = `'${s}`
  return (s.includes(';') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildPushCsv(members, { create = false } = {}) {
  // Column order MUST match CD_PUSH_HEADERS (+ create extras). Create rows also
  // carry Beitragskategorie + Eintritt + Gruppen + Status (see
  // CD_PUSH_CREATE_HEADERS); m.eintritt, m.gruppen and m.cd_status are resolved
  // by /up from the person's approved registration (+ wiedisync_active for the
  // status fallback). anrede/nationalitaet/ahv_nummer are echo-resolved by /up
  // for UPDATE rows (empty → ClubDesk's own value) — see CD_PUSH_HEADERS.
  const headers = create ? CD_PUSH_CREATE_HEADERS : CD_PUSH_HEADERS
  const rows = members.map((m) => {
    // Outgoing repair: push the CANONICAL form (normalize.js) so every commit
    // also standardizes ClubDesk's copy (INFRA.md → "Contact-data normalization
    // rule"). Values that don't normalize (legacy 9-digit numbers, mangled
    // cells) pass through raw — the push must never blank or reshape a value it
    // can't parse.
    const phoneOut = normVal(normalizePhone, m.phone)
    const ibanOut = normVal(normalizeIban, m.iban)
    const ahvOut = normVal(normalizeAhv, m.ahv_nummer)
    const emailOut = normVal(normalizeEmail, m.email)
    const cells = [
      m.first_name, m.last_name, emailOut, phoneOut, m.adresse, m.plz, m.ort,
      fmtBirthdateDDMMYYYY(m.birthdate),
      m.sex === 'm' ? 'männlich' : m.sex === 'f' ? 'weiblich' : '',
      // /up pre-resolves m.iban / m.anrede / m.nationalitaet / m.ahv_nummer to
      // ClubDesk's own value when wiedisync's is empty (UPDATE rows only — see
      // CD_PUSH_HEADERS). Creates push their own values (a new contact has no
      // ClubDesk value to blank).
      ibanOut,
      m.anrede || '', m.nationalitaet || '', ahvOut,
      // Wiedisync ID — the member UUID (migration 184), wiedisync-owned: never
      // echoed, never blank. Pre-184 pushes carried the numeric members.id; the
      // down-sync linker accepts both.
      m.uuid ? String(m.uuid) : (m.id != null ? String(m.id) : ''),
    ]
    if (create) {
      cells.push(
        phoneOut, // Telefon Mobil = same as Privat (user: one number → both)
        mapKategorie(m.beitragskategorie), fmtBirthdateDDMMYYYY(m.eintritt),
        m.gruppen || '', m.cd_status || '', deriveOffiziellenLizenz(m),
        deriveMitgliederbeitrag(m.beitragskategorie, m),
        m.cd_passiv || '', m.cd_sektion || '', // resolved by /up from the registration
        deriveSchiedsrichter(m),
      )
    }
    return cells.map(cdCell).join(';')
  })
  return headers.join(';') + '\n' + rows.join('\n') + '\n'
}

// Member fields the push CSV reads (also the preview fetch set). anrede/
// nationalitaet/ahv_nummer joined the push 2026-07-07 (echo-protected for
// updates — see CD_PUSH_HEADERS). beitragskategorie/wiedisync_active and the
// licence booleans are only ever used on CREATE rows (buildPushCsv /
// deriveStatus / deriveOffiziellenLizenz).
const PUSH_FIELDS = [
  'id', 'uuid', 'first_name', 'last_name', 'email', 'phone', 'adresse', 'plz',
  'ort', 'birthdate', 'sex', 'iban', 'anrede', 'nationalitaet', 'ahv_nummer',
  'clubdesk_id', 'clubdesk_push_changes',
  'beitragskategorie', 'wiedisync_active',
  'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb',
]

// Escape user-controlled strings before interpolating into the admin email
// body. Without this, a member could submit `<img src=x onerror=…>` as one of
// the changed values and the admin's webmail client would render the payload.
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildChangesTable(changes, locale = 'de') {
  const labels = FIELD_LABELS[locale] || FIELD_LABELS.de
  const t = T[locale] || T.de
  const rows = changes.map(c => {
    const label = labels[c.field] || c.field
    const oldVal = c.old_value ? escHtml(c.old_value) : '—'
    const newVal = c.new_value ? escHtml(c.new_value) : '—'
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#e2e8f0;font-size:13px">${escHtml(label)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#ef4444;font-size:13px;text-decoration:line-through">${oldVal}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #334155;color:#22c55e;font-size:13px">${newVal}</td>
    </tr>`
  }).join('')

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:8px;overflow:hidden;margin:12px 0">
  <tr>
    <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #334155">${t.field}</th>
    <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #334155">${t.oldValue}</th>
    <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:1px solid #334155">${t.newValue}</th>
  </tr>
  ${rows}
</table>`
}

export function registerClubdeskUpdate(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'clubdesk-update' })

  // Per-member throttle for the member-facing /clubdesk-update route (2026-07-05
  // audit #12): each call emails a CSV attachment to the admin mailbox + rewrites
  // the push diff, so an unthrottled loop could flood the mailbox and churn the
  // sync-up modal. 5 / hour / member (in-memory — same accepted model as the
  // other kscw-endpoints limiters, safe behind the CF Tunnel).
  const clubdeskUpdateRl = new Map()

  // ── Superadmin gate (ClubDesk member sync is a top-tier, club-wide action) ──
  // Directus admins pass straight through; otherwise the caller must hold the
  // 'superuser' or 'admin' member role. Mirrors finance-ledger.js gate(), tighter.
  async function superGate(req) {
    if (req.accountability?.admin) return true
    const userId = req.accountability?.user
    if (!userId) return false
    const m = await database('members').where('user', userId).first('role')
    if (!m) return false
    const roles = Array.isArray(m.role)
      ? m.role
      : (m.role ? (() => { try { return JSON.parse(m.role) } catch { return [] } })() : [])
    return ['superuser', 'admin'].some((r) => roles.includes(r))
  }

  // ── On-demand ClubDesk MEMBER sync (superadmin "Sync down" button) ──────────
  // POST sets a request flag on the singleton clubdesk_member_sync row; a host
  // dispatcher cron (clubdesk-member-dispatch.sh) claims it, runs clubdesk-sync.sh,
  // and writes back down_state. GET is polled by the button. Sync-up lands later.
  router.get('/clubdesk-member-sync', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('clubdesk_member_sync').where('id', 1)
        .first('down_state', 'down_message', 'down_requested_at', 'down_finished_at')
      return res.json({
        state: s?.down_state || 'idle',
        message: s?.down_message || null,
        requested_at: s?.down_requested_at || null,
        finished_at: s?.down_finished_at || null,
      })
    } catch (err) {
      log.error({ msg: `clubdesk-member-sync status: ${err.message}`, endpoint: 'clubdesk-member-sync', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/clubdesk-member-sync', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('clubdesk_member_sync').where('id', 1).first('down_state')
      if (['queued', 'running'].includes(s?.down_state)) {
        return res.status(409).json({ error: 'A sync is already in progress', state: s.down_state })
      }
      await database('clubdesk_member_sync').where('id', 1).update({
        down_requested_at: new Date(), down_state: 'queued', down_message: null, down_finished_at: null,
      })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'clubdesk_member_sync', recordId: 1, data: { kind: 'clubdesk_member_sync_request', direction: 'down' },
      })
      return res.json({ state: 'queued' })
    } catch (err) {
      log.error({ msg: `clubdesk-member-sync trigger: ${err.message}`, endpoint: 'clubdesk-member-sync', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Sync-UP: mute/unmute a member (clubdesk_sync_exclude, migration 190) ────
  // A muted member disappears from both preview lists and is refused by /up —
  // for technical rows (System KSCW) and deliberate never-sync members.
  router.post('/clubdesk-member-sync/mute', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const memberId = Number(req.body?.member_id)
      if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'member_id required' })
      const muted = req.body?.muted !== false // default true
      const n = await database('members').where('id', memberId)
        .update({ clubdesk_sync_exclude: muted })
      if (!n) return res.status(404).json({ error: 'Member not found' })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'members', recordId: memberId,
        data: { kind: 'clubdesk_sync_mute', clubdesk_sync_exclude: muted },
      })
      return res.json({ ok: true, member_id: memberId, muted })
    } catch (err) {
      log.error({ msg: `clubdesk mute: ${err.message}`, endpoint: 'clubdesk-member-sync/mute', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Sync-UP: preview what would be pushed to ClubDesk ───────────────────────
  // changed  = members edited in wiedisync since the last push AND linked to a
  //            ClubDesk contact (clubdesk_id) → ClubDesk will UPDATE them.
  // unlinked = members with no clubdesk_id (new registrations + divergent-email /
  //            non-member rows) → the superadmin decides per-member whether to
  //            create them (a divergent-email member would otherwise duplicate).
  router.get('/clubdesk-member-sync/up-preview', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const changedRows = await database('members')
        .where('clubdesk_push_pending', true).whereNotNull('clubdesk_id')
        // Muted members (clubdesk_sync_exclude, migration 190 — e.g. the System
        // KSCW technical account) never appear in either preview list.
        .where('clubdesk_sync_exclude', false)
        .select('id', 'first_name', 'last_name', 'email', 'clubdesk_id', 'clubdesk_push_changes')
        .orderBy('last_name')
      const changed = changedRows.map((m) => {
        let changes = []
        try { changes = Array.isArray(m.clubdesk_push_changes) ? m.clubdesk_push_changes : (m.clubdesk_push_changes ? JSON.parse(m.clubdesk_push_changes) : []) } catch { changes = [] }
        return { id: m.id, first_name: m.first_name, last_name: m.last_name, email: m.email, clubdesk_id: m.clubdesk_id, changes }
      })
      // Exclude members already pushed as "new" but not yet linked back: the
      // up-dispatcher stamps clubdesk_pushed_at on every pushed row, so an unlinked
      // (clubdesk_id IS NULL) member with a clubdesk_pushed_at is "pushed, awaiting
      // link" — offering it again would DUPLICATE the contact in ClubDesk. It
      // reappears here only once a write-back sets its clubdesk_id (TODO: scrape the
      // new ClubDesk [Id] back — see clubdesk-member-up-dispatch.sh).
      const unlinkedRows = await database('members')
        .whereNull('clubdesk_id')
        .whereNull('clubdesk_pushed_at')
        .where('clubdesk_sync_exclude', false)
        .select('id', 'first_name', 'last_name', 'email', 'beitragskategorie',
          'scorer_vb', 'referee_vb', 'otr1_bb', 'otr2_bb', 'otn_bb', 'referee_bb')
        .orderBy('last_name')
      // Flag unlinked members who ALREADY exist in ClubDesk under a divergent
      // email (exact first+last name match) so the modal can warn before a CREATE
      // push duplicates the contact in the legal register (2026-07-05 audit #11).
      // Name-only is a heuristic — the superadmin still decides per-member — but
      // the server no longer stays silent about a likely duplicate.
      const cdKey = (f, l) => `${(f || '').trim().toLowerCase()} ${(l || '').trim().toLowerCase()}`.trim()
      const wantNames = [...new Set(unlinkedRows.map((m) => cdKey(m.first_name, m.last_name)).filter(Boolean))]
      const cdNames = new Set()
      if (wantNames.length) {
        const rows = await database('clubdesk_export')
          .whereRaw("LOWER(BTRIM(vorname)) || ' ' || LOWER(BTRIM(nachname)) = ANY(?)", [wantNames])
          .distinct(database.raw("LOWER(BTRIM(vorname)) || ' ' || LOWER(BTRIM(nachname)) AS nm"))
        for (const r of rows) cdNames.add(r.nm)
      }
      const unlinked = unlinkedRows.map((m) => {
        const e = (m.email || '').toLowerCase()
        const likelyNonMember = e.includes('@kscw.clubdesk.com') || e.startsWith('system@') || e.endsWith('@kscw.ch')
        return {
          id: m.id, first_name: m.first_name, last_name: m.last_name, email: m.email,
          likely_non_member: likelyNonMember,
          // A ClubDesk contact with this exact name already exists (divergent
          // email) → pushing CREATE would duplicate it. Warn in the modal.
          would_duplicate: cdNames.has(cdKey(m.first_name, m.last_name)),
          // What the CREATE push will send as Beitragskategorie (post-mapping),
          // Offiziellen Lizenz and Mitgliederbeitrag — shown in the modal so
          // the superadmin sees them before approving.
          beitragskategorie: mapKategorie(m.beitragskategorie) || null,
          offiziellen_lizenz: deriveOffiziellenLizenz(m) || null,
          mitgliederbeitrag: deriveMitgliederbeitrag(m.beitragskategorie, m) || null,
        }
      })
      return res.json({ changed, unlinked })
    } catch (err) {
      log.error({ msg: `up-preview: ${err.message}`, endpoint: 'clubdesk-member-sync/up-preview', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Sync-UP: commit — stash the approved CSV + member ids, enqueue the push ──
  // The host up-dispatcher reads up_csv, runs the import scraper (commit), clears
  // clubdesk_push_pending for up_member_ids, and writes up_result.
  router.post('/clubdesk-member-sync/up', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const ids = Array.isArray(req.body?.member_ids) ? req.body.member_ids.map(Number).filter((n) => Number.isInteger(n)) : []
      if (!ids.length) return res.status(400).json({ error: 'member_ids required' })
      const s = await database('clubdesk_member_sync').where('id', 1).first('up_state')
      if (['queued', 'running'].includes(s?.up_state)) {
        return res.status(409).json({ error: 'A sync-up is already in progress', state: s.up_state })
      }
      const fetched = await database('members').whereIn('id', ids)
        .select([...PUSH_FIELDS, 'clubdesk_push_pending', 'clubdesk_pushed_at', 'clubdesk_sync_exclude'])
      // Server-side eligibility re-check — mirrors up-preview: an UPDATE push needs
      // a linked contact with pending changes; a CREATE push must be neither linked
      // nor already pushed (a pushed-awaiting-link member would DUPLICATE the
      // contact in ClubDesk). Muted members (clubdesk_sync_exclude) are refused
      // outright. The preview enforced this only client-side, but /up callers can
      // act on stale state (per-registration zone, second admin), so refuse
      // ineligible ids here.
      const members = fetched.filter((m) =>
        !m.clubdesk_sync_exclude &&
        ((m.clubdesk_push_pending && m.clubdesk_id) || (!m.clubdesk_id && !m.clubdesk_pushed_at)))
      if (!members.length) {
        return res.status(409).json({ error: 'No eligible members — already in ClubDesk or awaiting link-back', code: 'not_eligible' })
      }
      // Split into the two push sets: linked members get a contact-fields-only
      // UPDATE row; unlinked members get a CREATE row that additionally carries
      // Beitragskategorie + Eintritt + Gruppen (see CD_PUSH_CREATE_HEADERS for
      // why the sets must never share a CSV).
      const updates0 = members.filter((m) => m.clubdesk_id)
      const creates = members.filter((m) => !m.clubdesk_id)
      // Blank-risk guard (2026-07-05 audit #5). An UPDATE row carries the FULL
      // contact scope, so a linked member whose wiedisync side is EMPTY where
      // ClubDesk still holds a value would blank the authoritative register on
      // import. /clubdesk-drift/flag already refuses these, but the member-facing
      // POST /clubdesk-update sets clubdesk_push_pending with no such check, so a
      // profile edit that clears a field can reach here. Re-run the SAME drift
      // computation over the UPDATE set and drop blank-risk members — they
      // self-heal after a "Sync down" fills the empty field.
      let blankRiskSkipped = []
      let updates = updates0
      if (updates0.length) {
        const drift = await computeClubdeskDrift(updates0.map((m) => m.id))
        const riskyIds = new Set(drift.filter((d) => d.blank_risk.length).map((d) => d.member_id))
        if (riskyIds.size) {
          blankRiskSkipped = updates0.filter((m) => riskyIds.has(m.id)).map((m) => m.id)
          updates = updates0.filter((m) => !riskyIds.has(m.id))
        }
      }
      const pushMembers = [...updates, ...creates]
      if (!pushMembers.length) {
        return res.status(409).json({
          error: 'Every eligible member would blank ClubDesk data (empty fields ClubDesk still owns) — run "Sync down" first',
          code: 'blank_risk', skipped_blank_risk: blankRiskSkipped,
        })
      }
      // Echo-back (see CD_PUSH_HEADERS): an UPDATE row whose wiedisync value is
      // empty gets ClubDesk's own current value so the import can never blank
      // the register. Covers iban + anrede + nationalitaet + ahv_nummer — the
      // fields wiedisync does not exclusively own (blank cell could otherwise
      // wipe an authoritative value). Member-set values pass unchanged. The
      // drift blank-risk guard deliberately skips these four — this makes them
      // structurally safe instead of dropping the member from the push.
      if (updates.length) {
        const cdids = updates.map((m) => String(m.clubdesk_id)).filter(Boolean)
        const echoRows = cdids.length ? await database.raw(`
          SELECT DISTINCT ON (BTRIM(clubdesk_id)) BTRIM(clubdesk_id) AS cdid,
                 iban, anrede, nationalitaet, ahv_nummer
          FROM clubdesk_export WHERE BTRIM(clubdesk_id) = ANY(?) ORDER BY BTRIM(clubdesk_id), row_id
        `, [cdids]) : { rows: [] }
        const cdEcho = new Map(echoRows.rows.map((r) => [r.cdid, r]))
        for (const m of updates) {
          const cd = cdEcho.get(String(m.clubdesk_id)) || {}
          if (!String(m.iban || '').trim()) m.iban = String(cd.iban || '').trim()
          if (!String(m.anrede || '').trim()) m.anrede = String(cd.anrede || '').trim()
          if (!String(m.nationalitaet || '').trim()) m.nationalitaet = String(cd.nationalitaet || '').trim()
          if (!String(m.ahv_nummer || '').trim()) m.ahv_nummer = String(cd.ahv_nummer || '').trim()
        }
      }
      // Eintritt = the registration SUBMISSION date — user rule 2026-07-06:
      // "the date the registration is sent" (approved_at was dropped; it is
      // also not stamped on every approval path). Gruppen = deriveGruppen(reg)
      // from the same registration (team +
      // funktion). Registration → member resolution uses the same email +
      // symmetric first-name-prefix rule as cdStatusForRegistration, so a child
      // on the parent's shared address never inherits the parent's date or
      // teams. No match (legacy/manual member) → empty cells; a new contact has
      // no ClubDesk Eintritt/Gruppen to blank, so empty is safe there.
      if (creates.length) {
        const emails = [...new Set(creates.map((m) => String(m.email || '').toLowerCase().trim()).filter(Boolean))]
        const regs = emails.length
          ? await database('registrations').where('status', 'approved')
            .whereRaw('LOWER(BTRIM(email)) = ANY(?)', [emails])
            .select('email', 'vorname', 'submitted_at', 'membership_type', 'team', 'rolle', 'sektion_choice', 'lizenz')
          : []
        for (const m of creates) {
          const em = String(m.email || '').toLowerCase().trim()
          const reg = regs
            .filter((r) => String(r.email || '').toLowerCase().trim() === em && firstNamesMatchCd(r.vorname, m.first_name))
            .sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0))[0]
          m.eintritt = reg ? reg.submitted_at : null
          m.gruppen = deriveGruppen(reg)
          m.cd_status = deriveStatus(reg, m)
          m.cd_passiv = derivePassivmitglied(reg)
          m.cd_sektion = deriveSektion(reg)
        }
      }
      await database('clubdesk_member_sync').where('id', 1).update({
        up_requested_at: new Date(), up_state: 'queued', up_message: null, up_finished_at: null,
        up_csv: updates.length ? buildPushCsv(updates) : null,
        up_csv_create: creates.length ? buildPushCsv(creates, { create: true }) : null,
        up_member_ids: JSON.stringify(pushMembers.map((m) => m.id)),
        up_member_ids_create: JSON.stringify(creates.map((m) => m.id)),
        up_result: null,
      })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'clubdesk_member_sync', recordId: 1,
        data: { kind: 'clubdesk_member_sync_request', direction: 'up', member_count: pushMembers.length, create_count: creates.length, skipped_blank_risk: blankRiskSkipped.length },
      })
      return res.json({ state: 'queued', count: pushMembers.length, skipped_blank_risk: blankRiskSkipped })
    } catch (err) {
      log.error({ msg: `up-commit: ${err.message}`, endpoint: 'clubdesk-member-sync/up', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  router.get('/clubdesk-member-sync/up-status', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const s = await database('clubdesk_member_sync').where('id', 1)
        .first('up_state', 'up_message', 'up_requested_at', 'up_finished_at', 'up_result')
      let result = null
      try { result = s?.up_result ? (typeof s.up_result === 'object' ? s.up_result : JSON.parse(s.up_result)) : null } catch { result = null }
      return res.json({
        state: s?.up_state || 'idle',
        message: s?.up_message || null,
        requested_at: s?.up_requested_at || null,
        finished_at: s?.up_finished_at || null,
        result,
      })
    } catch (err) {
      log.error({ msg: `up-status: ${err.message}`, endpoint: 'clubdesk-member-sync/up-status', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Name-only ClubDesk matches (Data Health manual-link check) ──────────────
  // Members whose first+last name matches a ClubDesk contact but whose email AND
  // licence both DIVERGE — so the automatic linker (licence / email+name) can't
  // safely link them. Surfaced in Data Health for a human to confirm: link sets
  // clubdesk_id and stores the ClubDesk email as a secondary (vm_email). If the
  // matched ClubDesk contact is already linked to a DIFFERENT member, it's a
  // likely duplicate-member case (needs a merge, not a link) — flagged, not
  // offered as a one-click link. clubdesk_export is a staging table not exposed
  // via the items API, so this join lives server-side. Superadmin only.
  router.get('/clubdesk-name-matches', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const rows = await database
        .select(
          'm.id as member_id', 'm.first_name', 'm.last_name', 'm.email as member_email',
          'cd.clubdesk_id', 'cd.email as cd_email', 'cd.email_alternativ as cd_email_alt',
          'cd.lizenznummer as cd_lic', 'linked.id as linked_member_id',
          'linked.first_name as linked_first', 'linked.last_name as linked_last',
        )
        .from('members as m')
        .join('clubdesk_export as cd', function () {
          this.on(database.raw('LOWER(BTRIM(cd.vorname)) = LOWER(BTRIM(m.first_name))'))
            .andOn(database.raw('LOWER(BTRIM(cd.nachname)) = LOWER(BTRIM(m.last_name))'))
            .andOn(database.raw("NULLIF(BTRIM(cd.clubdesk_id), '') IS NOT NULL"))
        })
        .leftJoin('members as linked', database.raw('linked.clubdesk_id = BTRIM(cd.clubdesk_id)'))
        .whereNull('m.clubdesk_id')
        .andWhereRaw("LOWER(BTRIM(m.email)) NOT IN (LOWER(BTRIM(cd.email)), LOWER(BTRIM(COALESCE(cd.email_alternativ,''))))")
        .andWhereRaw("(NULLIF(BTRIM(m.license_nr),'') IS NULL OR LOWER(BTRIM(m.license_nr)) <> LOWER(BTRIM(COALESCE(cd.lizenznummer,''))))")
        .orderBy(['m.last_name', 'm.first_name'])
      const candidates = rows.map((r) => ({
        member_id: r.member_id,
        member_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        member_email: r.member_email,
        clubdesk_id: String(r.clubdesk_id).trim(),
        clubdesk_email: r.cd_email || r.cd_email_alt || null,
        clubdesk_licence: r.cd_lic || null,
        // When set, the ClubDesk contact is already linked to another member →
        // duplicate, needs a merge (no one-click link).
        duplicate_of: r.linked_member_id
          ? { id: r.linked_member_id, name: `${r.linked_first || ''} ${r.linked_last || ''}`.trim() }
          : null,
      }))
      return res.json({ candidates })
    } catch (err) {
      log.error({ msg: `clubdesk-name-matches: ${err.message}`, endpoint: 'clubdesk-name-matches', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // Confirm a name-only match: set the member's clubdesk_id and keep the ClubDesk
  // email as a secondary (vm_email, fill-only). Refuses if the ClubDesk contact is
  // already linked to another member (that's a merge, handled elsewhere).
  router.post('/clubdesk-link', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const memberId = Number(req.body?.member_id)
      const clubdeskId = String(req.body?.clubdesk_id || '').trim()
      if (!Number.isInteger(memberId) || !clubdeskId) {
        return res.status(400).json({ error: 'member_id and clubdesk_id required' })
      }
      const member = await database('members').where('id', memberId).first('id', 'clubdesk_id', 'vm_email', 'email')
      if (!member) return res.status(404).json({ error: 'Member not found' })
      if (member.clubdesk_id) return res.status(409).json({ error: 'Member already linked' })
      const taken = await database('members').where('clubdesk_id', clubdeskId).whereNot('id', memberId).first('id')
      if (taken) return res.status(409).json({ error: 'ClubDesk contact already linked to another member', code: 'duplicate' })
      const cd = await database('clubdesk_export').whereRaw('BTRIM(clubdesk_id) = ?', [clubdeskId])
        .first('email', 'email_alternativ')
      const cdEmail = (cd?.email || cd?.email_alternativ || '').trim() || null
      const patch = { clubdesk_id: clubdeskId }
      // Keep the ClubDesk email as secondary unless the member already has a
      // distinct one. Never overwrite their primary.
      if (cdEmail && (!member.vm_email || member.vm_email.toLowerCase() === (member.email || '').toLowerCase())) {
        patch.vm_email = cdEmail
      }
      await database('members').where('id', memberId).update(patch)
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'members', recordId: memberId,
        data: { kind: 'clubdesk_link', clubdesk_id: clubdeskId, vm_email: patch.vm_email || null },
      })
      return res.json({ success: true, member_id: memberId, clubdesk_id: clubdeskId, vm_email: patch.vm_email || null })
    } catch (err) {
      log.error({ msg: `clubdesk-link: ${err.message}`, endpoint: 'clubdesk-link', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Per-registration ClubDesk status (Anmeldungen "ClubDesk sync" zone) ─────
  // Resolves an approved registration to its member row (same email +
  // symmetric first-name-prefix rule as createMemberFromRegistration in
  // kscw-hooks) and reports where that person stands relative to ClubDesk:
  //   linked          — member.clubdesk_id set → contact exists in ClubDesk
  //   match_unlinked  — a clubdesk_export contact matches by email or exact name
  //                     but the member isn't linked yet (offer /clubdesk-link);
  //                     `duplicate_of` is set when that contact is already linked
  //                     to a DIFFERENT member (needs a merge, no one-click action)
  //   pushed_pending  — pushed to ClubDesk (clubdesk_pushed_at) awaiting link-back
  //   not_in_clubdesk — nowhere to be found → offer the single-member sync-up push
  //   no_member       — no member row yet (not approved, or the approval hook failed)
  // clubdesk_export is the last sync-down snapshot, so "in ClubDesk" is as of the
  // last sync down. Read-only. Superadmin only (same gate as the sync surface).
  function firstNamesMatchCd(a, b) {
    const x = String(a || '').toLowerCase().trim()
    const y = String(b || '').toLowerCase().trim()
    if (!x || !y) return true
    return x === y || x.startsWith(y) || y.startsWith(x)
  }

  async function cdStatusForRegistration(reg) {
      if (!reg || !reg.email) return { status: 'no_member' }

      const email = reg.email.toLowerCase().trim()
      const emailRows = await database('members').whereRaw('LOWER(email) = ?', [email])
        .select('id', 'first_name', 'last_name', 'clubdesk_id', 'clubdesk_pushed_at')
      const member = emailRows.find((r) => firstNamesMatchCd(r.first_name, reg.vorname)) || null
      if (!member) return { status: 'no_member' }

      const base = { member_id: member.id }
      if (member.clubdesk_id) {
        return { ...base, status: 'linked', clubdesk_id: member.clubdesk_id }
      }

      // Unlinked → look for the person in the ClubDesk snapshot. Candidates come
      // from an email or exact-name SQL match, but an email hit only COUNTS when
      // the contact's name also matches the member — same family-shared-email rule
      // as createMemberFromRegistration and the sync-down auto-linker: a child
      // registering with the parent's address must never be offered a one-click
      // link to the parent's contact. clubdesk_export holds one row per contact
      // PER GROUP, so dedupe by clubdesk_id; email+name beats name-only; two
      // DIFFERENT contacts at the same precedence → ambiguous, no one-click link.
      // Checked BEFORE pushed_pending so a contact that appeared via sync-down
      // without linking offers the link action instead of waiting forever.
      const lastNamesEqual = (a, b) => {
        const x = String(a || '').toLowerCase().trim()
        const y = String(b || '').toLowerCase().trim()
        return !!x && !!y && x === y
      }
      const cdRows = await database('clubdesk_export as cd')
        .whereRaw("NULLIF(BTRIM(cd.clubdesk_id), '') IS NOT NULL")
        .andWhere(function () {
          this.whereRaw('LOWER(BTRIM(cd.email)) = ?', [email])
            .orWhereRaw("LOWER(BTRIM(COALESCE(cd.email_alternativ, ''))) = ?", [email])
            .orWhere(function () {
              this.whereRaw('LOWER(BTRIM(cd.vorname)) = LOWER(BTRIM(?))', [member.first_name || ''])
                .andWhereRaw('LOWER(BTRIM(cd.nachname)) = LOWER(BTRIM(?))', [member.last_name || ''])
            })
        })
        .select('cd.clubdesk_id', 'cd.vorname', 'cd.nachname', 'cd.email', 'cd.email_alternativ')
      const seen = new Set()
      const candidates = []
      for (const r of cdRows) {
        const cdid = String(r.clubdesk_id).trim()
        if (seen.has(cdid)) continue
        const nameHit = lastNamesEqual(r.nachname, member.last_name)
          && firstNamesMatchCd(r.vorname, member.first_name)
        if (!nameHit) continue // email-only hit = different person on a shared address
        seen.add(cdid)
        const emailHit = [r.email, r.email_alternativ]
          .some((e) => String(e || '').toLowerCase().trim() === email)
        candidates.push({ cdid, emailHit, vorname: r.vorname, nachname: r.nachname, email: r.email || r.email_alternativ || null })
      }
      candidates.sort((a, b) => Number(b.emailHit) - Number(a.emailHit))
      const cd = candidates[0] || null
      const ambiguous = candidates.length > 1 && candidates[1].emailHit === candidates[0].emailHit

      if (cd) {
        const linked = await database('members').where('clubdesk_id', cd.cdid)
          .first('id', 'first_name', 'last_name')
        return {
          ...base,
          status: 'match_unlinked',
          clubdesk_id: cd.cdid,
          clubdesk_name: `${(cd.vorname || '').trim()} ${(cd.nachname || '').trim()}`.trim() || null,
          clubdesk_email: cd.email,
          ambiguous,
          duplicate_of: linked && linked.id !== member.id
            ? { id: linked.id, name: `${linked.first_name || ''} ${linked.last_name || ''}`.trim() }
            : null,
        }
      }

      if (member.clubdesk_pushed_at) {
        return { ...base, status: 'pushed_pending', pushed_at: member.clubdesk_pushed_at }
      }
      return { ...base, status: 'not_in_clubdesk' }
  }

  router.get('/clubdesk-registration-status', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const regId = Number(String(req.query.registration_id || '').trim())
      if (!Number.isInteger(regId)) return res.status(400).json({ error: 'registration_id required' })
      const reg = await database('registrations').where('id', regId)
        .first('id', 'email', 'vorname', 'status')
      if (!reg) return res.status(404).json({ error: 'Registration not found' })
      return res.json(await cdStatusForRegistration(reg))
    } catch (err) {
      log.error({ msg: `clubdesk-registration-status: ${err.message}`, endpoint: 'clubdesk-registration-status', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // Batch variant for the Anmeldungen OVERVIEW: one call resolves the ClubDesk
  // status badge for every approved registration in the table (the per-row GET
  // stays for the expanded zone's fresh check before actions).
  router.post('/clubdesk-registration-status/batch', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const ids = Array.isArray(req.body?.registration_ids)
        ? req.body.registration_ids.map(Number).filter((n) => Number.isInteger(n)).slice(0, 200)
        : []
      if (!ids.length) return res.status(400).json({ error: 'registration_ids required' })
      const regs = await database('registrations').whereIn('id', ids)
        .select('id', 'email', 'vorname', 'status')
      const statuses = {}
      for (const reg of regs) {
        statuses[reg.id] = await cdStatusForRegistration(reg)
      }
      return res.json({ statuses })
    } catch (err) {
      log.error({ msg: `clubdesk-registration-status/batch: ${err.message}`, endpoint: 'clubdesk-registration-status/batch', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── ClubDesk drift (Data Health) ────────────────────────────────────────────
  // Linked members whose wiedisync PUSH-SCOPE contact data no longer matches the
  // ClubDesk snapshot. Catches every edit path that does NOT set the dirty flag
  // (Data Explorer, finance/billing edits, approval backfills, raw items-API) —
  // the /clubdesk-update profile path already flags itself. Compared fields =
  // exactly the sync-up push scope (CD_PUSH_HEADERS): names, email, phone,
  // address, birthdate, sex. A field counts as drift only when the WIEDISYNC
  // side is non-empty (wiedisync is authoritative once filled — the sync-down
  // fill-only COALESCE in import-clubdesk-csv.mjs encodes the same rule);
  // wiedisync-empty + ClubDesk-non-empty is reported as blank_risk instead,
  // because pushing that member would send an empty cell and could blank the
  // authoritative ClubDesk value (empty-cell import behavior unvalidated).
  // Snapshot-based: "ClubDesk says" = as of the last sync-down.
  const driftNorm = (v) => String(v ?? '').trim()
  const driftLower = (v) => driftNorm(v).toLowerCase()
  const driftPhone = (v) => {
    const d = String(v ?? '').replace(/\D/g, '')
    // Equate +41 79…, 0041 79…, 079… — compare the last 9 digits (CH format).
    return d.length > 9 ? d.slice(-9) : d
  }
  const driftDateCd = (v) => {
    const m = String(v ?? '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''
  }
  const driftDateMember = (v) => {
    if (!v) return ''
    const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : ''
  }

  async function computeClubdeskDrift(memberIds = null) {
    // clubdesk_people lacks adresse/plz/ort/telefon_privat → dedupe the raw
    // per-group staging table ourselves (contact fields are identical across a
    // contact's group rows, so any row per clubdesk_id works).
    const params = []
    let memberFilter = ''
    if (Array.isArray(memberIds) && memberIds.length) {
      memberFilter = `AND m.id = ANY(?)`
      params.push(memberIds)
    }
    const res = await database.raw(`
      SELECT m.id, m.first_name, m.last_name, m.email, m.phone, m.adresse, m.plz, m.ort,
             m.birthdate, m.sex, m.iban, m.anrede, m.nationalitaet, m.ahv_nummer,
             m.clubdesk_id, m.clubdesk_push_pending,
             cd.vorname AS cd_vorname, cd.nachname AS cd_nachname, cd.email AS cd_email,
             cd.email_alternativ AS cd_email_alt, cd.telefon_privat AS cd_tel_priv,
             cd.telefon_mobil AS cd_tel_mob, cd.adresse AS cd_adresse, cd.plz AS cd_plz,
             cd.ort AS cd_ort, cd.geburtsdatum AS cd_geburtsdatum, cd.geschlecht AS cd_geschlecht,
             cd.iban AS cd_iban, cd.anrede AS cd_anrede, cd.nationalitaet AS cd_nationalitaet,
             cd.ahv_nummer AS cd_ahv_nummer
      FROM members m
      JOIN (
        SELECT DISTINCT ON (BTRIM(clubdesk_id)) BTRIM(clubdesk_id) AS cdid, vorname, nachname,
               email, email_alternativ, telefon_privat, telefon_mobil, adresse, plz, ort,
               geburtsdatum, geschlecht, iban, anrede, nationalitaet, ahv_nummer
        FROM clubdesk_export
        WHERE NULLIF(BTRIM(clubdesk_id), '') IS NOT NULL
        ORDER BY BTRIM(clubdesk_id), row_id
      ) cd ON cd.cdid = m.clubdesk_id
      WHERE m.clubdesk_id IS NOT NULL ${memberFilter}
      ORDER BY m.last_name, m.first_name
    `, params)
    const candidates = []
    for (const r of res.rows) {
      // conflicts = both sides non-empty and different (per-member row in Data
      // Health); fills = wiedisync set, ClubDesk empty (aggregated per field —
      // 100+ legitimate mass-fills like `sex` would otherwise flood the page);
      // blankRisk = wiedisync empty, ClubDesk set (push would blank it — warn).
      const conflicts = []
      const fills = []
      const blankRisk = []
      const cmp = (field, wiediRaw, cdRaw, wiediNorm, cdNorm) => {
        if (wiediNorm && cdNorm) {
          if (wiediNorm !== cdNorm) conflicts.push({ field, wiedisync: driftNorm(wiediRaw), clubdesk: driftNorm(cdRaw) })
        } else if (wiediNorm) {
          fills.push({ field, wiedisync: driftNorm(wiediRaw) })
        } else if (cdNorm) {
          blankRisk.push(field)
        }
      }
      cmp('first_name', r.first_name, r.cd_vorname, driftLower(r.first_name), driftLower(r.cd_vorname))
      cmp('last_name', r.last_name, r.cd_nachname, driftLower(r.last_name), driftLower(r.cd_nachname))
      // Email matches when it equals EITHER ClubDesk address (primary or alt).
      const em = driftLower(r.email)
      const cdEm = driftLower(r.cd_email) || driftLower(r.cd_email_alt)
      if (em && cdEm) {
        if (em !== driftLower(r.cd_email) && em !== driftLower(r.cd_email_alt)) {
          conflicts.push({ field: 'email', wiedisync: driftNorm(r.email), clubdesk: driftNorm(r.cd_email) || driftNorm(r.cd_email_alt) })
        }
      } else if (em) {
        fills.push({ field: 'email', wiedisync: driftNorm(r.email) })
      } else if (cdEm) {
        blankRisk.push('email')
      }
      // Phone matches when it equals EITHER ClubDesk number (privat or mobil).
      const ph = driftPhone(r.phone)
      const cdPhones = [driftPhone(r.cd_tel_priv), driftPhone(r.cd_tel_mob)].filter(Boolean)
      if (ph && cdPhones.length) {
        if (!cdPhones.includes(ph)) {
          conflicts.push({ field: 'phone', wiedisync: driftNorm(r.phone), clubdesk: driftNorm(r.cd_tel_priv) || driftNorm(r.cd_tel_mob) })
        }
      } else if (ph) {
        fills.push({ field: 'phone', wiedisync: driftNorm(r.phone) })
      } else if (cdPhones.length) {
        blankRisk.push('phone')
      }
      cmp('adresse', r.adresse, r.cd_adresse, driftLower(r.adresse), driftLower(r.cd_adresse))
      cmp('plz', r.plz, r.cd_plz, driftNorm(r.plz), driftNorm(r.cd_plz))
      cmp('ort', r.ort, r.cd_ort, driftLower(r.ort), driftLower(r.cd_ort))
      // Display both sides Swiss-style (dd.mm.yyyy); compare on ISO.
      const bdIso = driftDateMember(r.birthdate)
      const bdDisp = bdIso ? `${bdIso.slice(8, 10)}.${bdIso.slice(5, 7)}.${bdIso.slice(0, 4)}` : ''
      cmp('birthdate', bdDisp, r.cd_geburtsdatum, bdIso, driftDateCd(r.cd_geburtsdatum))
      const sexCd = r.sex === 'm' ? 'männlich' : r.sex === 'f' ? 'weiblich' : ''
      cmp('sex', sexCd, r.cd_geschlecht, sexCd, driftLower(r.cd_geschlecht))
      // IBAN: conflict/fill detection only — deliberately NEVER blank_risk.
      // The /up echo-back sends ClubDesk's own IBAN when wiedisync's is empty,
      // so an empty wiedisync IBAN cannot blank the register; flagging it as
      // blank_risk would only drop the member from pushes for no reason.
      const ibanNorm = (v) => String(v ?? '').replace(/\s/g, '').toUpperCase()
      const wIban = ibanNorm(r.iban)
      const cIban = ibanNorm(r.cd_iban)
      if (wIban && cIban) {
        if (wIban !== cIban) conflicts.push({ field: 'iban', wiedisync: driftNorm(r.iban), clubdesk: driftNorm(r.cd_iban) })
      } else if (wIban) {
        fills.push({ field: 'iban', wiedisync: driftNorm(r.iban) })
      }
      // Anrede / Nationalität / AHV: echo-protected like IBAN — conflict/fill
      // only, NEVER blank_risk (the /up echo-back sends ClubDesk's own value
      // when wiedisync's is empty, so an empty wiedisync field cannot blank it).
      // AHV compares digits-only (dot formatting differs between the systems).
      const cmpEcho = (field, wRaw, cRaw, wNorm, cNorm) => {
        if (wNorm && cNorm) {
          if (wNorm !== cNorm) conflicts.push({ field, wiedisync: driftNorm(wRaw), clubdesk: driftNorm(cRaw) })
        } else if (wNorm) {
          fills.push({ field, wiedisync: driftNorm(wRaw) })
        }
      }
      cmpEcho('anrede', r.anrede, r.cd_anrede, driftLower(r.anrede), driftLower(r.cd_anrede))
      cmpEcho('nationalitaet', r.nationalitaet, r.cd_nationalitaet, driftLower(r.nationalitaet), driftLower(r.cd_nationalitaet))
      const ahvDigits = (v) => String(v ?? '').replace(/\D/g, '')
      cmpEcho('ahv_nummer', r.ahv_nummer, r.cd_ahv_nummer, ahvDigits(r.ahv_nummer), ahvDigits(r.cd_ahv_nummer))
      if (!conflicts.length && !fills.length) continue
      candidates.push({
        member_id: r.id,
        member_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
        clubdesk_id: r.clubdesk_id,
        pending: r.clubdesk_push_pending === true,
        conflicts,
        fills,
        blank_risk: blankRisk,
      })
    }
    return candidates
  }

  router.get('/clubdesk-drift', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const all = await computeClubdeskDrift()
      // Per-member rows only for real CONFLICTS; fill-only members (wiedisync
      // has data ClubDesk lacks) are aggregated per field so 100+ legit fills
      // (e.g. sex, set only in wiedisync) don't flood Data Health. Members
      // already marked for sync-up are excluded from both.
      const active = all.filter((c) => !c.pending)
      const candidates = active.filter((c) => c.conflicts.length)
      // blank_risk members are EXCLUDED from the bulk member_ids: their push
      // would send empty cells for fields ClubDesk still owns (unvalidated
      // import semantics — could blank the legal register). They self-heal:
      // the next sync-down fills the empty wiedisync fields from ClubDesk,
      // the risk disappears, and they join the bulk. at_risk = how many are
      // currently held back per field.
      const fills = {}
      for (const c of active) {
        if (c.conflicts.length) continue
        for (const f of c.fills) {
          if (!fills[f.field]) fills[f.field] = { count: 0, member_ids: [], at_risk: 0 }
          if (c.blank_risk.length) {
            fills[f.field].at_risk++
          } else {
            fills[f.field].count++
            fills[f.field].member_ids.push(c.member_id)
          }
        }
      }
      return res.json({ candidates, fills })
    } catch (err) {
      log.error({ msg: `clubdesk-drift: ${err.message}`, endpoint: 'clubdesk-drift', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // Mark drifted members for the next sync-up push: sets the dirty flag +
  // stores the field diff (old = ClubDesk, new = wiedisync) so the sync-up
  // modal echoes exactly what will change. Diffs are recomputed server-side —
  // the client's list may be stale. The actual push still goes through the
  // sync-up modal (preview → confirm → dispatcher), nothing moves here.
  router.post('/clubdesk-drift/flag', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const ids = Array.isArray(req.body?.member_ids) ? req.body.member_ids.map(Number).filter((n) => Number.isInteger(n)) : []
      if (!ids.length) return res.status(400).json({ error: 'member_ids required' })
      const computed = await computeClubdeskDrift(ids)
      if (!computed.length) return res.status(409).json({ error: 'No drift found for these members — refresh Data health', code: 'no_drift' })
      // Refuse members whose push would blank ClubDesk-owned data (empty
      // wiedisync field + non-empty ClubDesk value): buildPushCsv always sends
      // the full row, and ClubDesk's empty-cell import behavior is unvalidated.
      // These heal via sync-down (fills the empty wiedisync fields), so the
      // admin's fix is "run sync down first", not an override.
      const candidates = computed.filter((c) => !c.blank_risk.length)
      const skipped = computed.length - candidates.length
      if (!candidates.length) {
        return res.status(409).json({ error: 'Push would blank ClubDesk data (member has empty fields ClubDesk still owns) — run "Sync down" first', code: 'blank_risk' })
      }
      for (const c of candidates) {
        const changes = [
          ...c.conflicts.map((d) => ({ field: d.field, old_value: d.clubdesk, new_value: d.wiedisync })),
          ...c.fills.map((d) => ({ field: d.field, old_value: null, new_value: d.wiedisync })),
        ]
        await database('members').where('id', c.member_id).update({
          clubdesk_push_pending: true,
          clubdesk_push_changes: JSON.stringify(changes),
        })
        await writeUserLog(database, log, {
          accountability: req.accountability, action: 'update',
          collection: 'members', recordId: c.member_id,
          data: { kind: 'clubdesk_drift_flag', fields: changes.map((d) => d.field) },
        })
      }
      return res.json({ flagged: candidates.length, skipped_blank_risk: skipped })
    } catch (err) {
      log.error({ msg: `clubdesk-drift/flag: ${err.message}`, endpoint: 'clubdesk-drift/flag', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Departed-in-ClubDesk detection (Data Health) ────────────────────────────
  // Members still active in wiedisync whose linked ClubDesk contact has a
  // non-active status (Kein Mitglied / Ehemaliges Mitglied / Verstorben) AND an
  // Austritt date — i.e. they left the club but linger here with rosters. The
  // Austritt guard excludes legit non-members with no exit date (volunteer
  // coaches marked "Kein Mitglied", or new signups whose contact isn't activated
  // yet) so they aren't false-flagged. Manual deactivate only. Superadmin.
  const DEPARTED_STATUSES = ['Kein Mitglied', 'Ehemaliges Mitglied', 'Verstorben']
  router.get('/clubdesk-departed', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const season = getCurrentSeason()
      const rows = await database
        .select('m.id as member_id', 'm.first_name', 'm.last_name', 'cd.status', 'cd.austritt')
        .from('members as m')
        .join('clubdesk_export as cd', database.raw('BTRIM(cd.clubdesk_id) = m.clubdesk_id'))
        .where('m.kscw_membership_active', true)
        .whereIn(database.raw('BTRIM(cd.status)'), DEPARTED_STATUSES)
        .whereRaw("NULLIF(BTRIM(cd.austritt), '') IS NOT NULL")
        .orderBy(['m.last_name', 'm.first_name'])
      const candidates = []
      for (const r of rows) {
        const teams = await database('member_teams as mt').join('teams as t', 't.id', 'mt.team')
          .where('mt.member', r.member_id).andWhere('mt.season', season).distinct('t.name')
        candidates.push({
          member_id: r.member_id,
          member_name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
          status: (r.status || '').trim(),
          austritt: (r.austritt || '').trim() || null,
          current_teams: teams.map((t) => t.name),
        })
      }
      return res.json({ candidates, season })
    } catch (err) {
      log.error({ msg: `clubdesk-departed: ${err.message}`, endpoint: 'clubdesk-departed', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // Deactivate a departed member: not-a-member + inactive, and drop their
  // current-season team assignments (keep prior-season history). Superadmin.
  router.post('/clubdesk-deactivate', async (req, res) => {
    try {
      if (!(await superGate(req))) return res.status(403).json({ error: 'Forbidden' })
      const memberId = Number(req.body?.member_id)
      if (!Number.isInteger(memberId)) return res.status(400).json({ error: 'member_id required' })
      const member = await database('members').where('id', memberId).first('id', 'clubdesk_id')
      if (!member) return res.status(404).json({ error: 'Member not found' })
      // Re-verify the departed condition server-side before mutating — the Data
      // Health list the caller acted on can be stale, and a mis-linked clubdesk_id
      // shared by two members must never deactivate the wrong person. Require: the
      // member is linked, the clubdesk_id maps 1:1 (exactly one member holds it),
      // and the linked ClubDesk contact is STILL in a departed status with an
      // Austritt date (same predicate as /clubdesk-departed).
      if (!member.clubdesk_id) {
        return res.status(409).json({ error: 'Member is not linked to a ClubDesk contact', code: 'not_linked' })
      }
      const sharing = await database('members').where('clubdesk_id', member.clubdesk_id).count('id as n').first()
      if (Number(sharing?.n) !== 1) {
        return res.status(409).json({ error: 'clubdesk_id is shared by multiple members — resolve the duplicate link first', code: 'ambiguous_link' })
      }
      const departed = await database('clubdesk_export')
        .whereRaw('BTRIM(clubdesk_id) = ?', [member.clubdesk_id])
        .whereIn(database.raw('BTRIM(status)'), DEPARTED_STATUSES)
        .whereRaw("NULLIF(BTRIM(austritt), '') IS NOT NULL")
        .first('clubdesk_id')
      if (!departed) {
        return res.status(409).json({ error: 'ClubDesk contact is not in a departed status — refresh Data Health', code: 'not_departed' })
      }
      const season = getCurrentSeason()
      const dropped = await database('member_teams').where('member', memberId).andWhere('season', season).del()
      await database('members').where('id', memberId)
        .update({ kscw_membership_active: false, wiedisync_active: false })
      await writeUserLog(database, log, {
        accountability: req.accountability, action: 'update',
        collection: 'members', recordId: memberId,
        data: { kind: 'clubdesk_deactivate', season, rosters_dropped: dropped },
      })
      return res.json({ success: true, member_id: memberId, rosters_dropped: dropped })
    } catch (err) {
      log.error({ msg: `clubdesk-deactivate: ${err.message}`, endpoint: 'clubdesk-deactivate', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  router.post('/clubdesk-update', async (req, res) => {
    try {
      // Auth check
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })

      const { member_id, changes } = req.body
      if (!member_id || !changes?.length) {
        return res.status(400).json({ error: 'member_id, changes required' })
      }

      // Verify ownership + fetch the caller's OWN row from the DB. The emailed CSV
      // and the change diff are built from THESE authoritative values, never from
      // client-supplied current_data (2026-07-05 audit #9): a member could
      // otherwise forge an AHV / Beitragskategorie / Anrede into an
      // official-looking "apply this in ClubDesk" email + CSV. ClubDesk-owned
      // fields (anrede / nationalitaet / ahv_nummer / beitragskategorie) are never
      // sent from here — mirrors CD_PUSH_HEADERS dropping them from the push.
      const member = await database('members').where('user', userId)
        .first('id', 'first_name', 'last_name', 'email', 'phone', 'adresse', 'plz', 'ort', 'birthdate', 'sex')
      if (!member || String(member.id) !== String(member_id)) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      // Rate limit (audit #12) — 5 / hour / member.
      const nowMs = Date.now()
      const rl = clubdeskUpdateRl.get(member.id)
      if (rl && nowMs < rl.resetAt) {
        if (rl.count >= 5) return res.status(429).json({ error: 'Too many update requests — try again later' })
        rl.count++
      } else {
        clubdeskUpdateRl.set(member.id, { count: 1, resetAt: nowMs + 60 * 60 * 1000 })
      }
      if (clubdeskUpdateRl.size > 5000) { for (const [k, v] of clubdeskUpdateRl) if (nowMs > v.resetAt) clubdeskUpdateRl.delete(k) }

      // Whitelist the change diff to member-editable fields (drop any client-sent
      // ClubDesk-authoritative field) and rebuild each "new" value from the DB row
      // so the email shows the real stored value, not a client claim.
      const EDITABLE = new Set(['first_name', 'last_name', 'email', 'phone', 'birthdate', 'adresse', 'plz', 'ort', 'sex'])
      const sexLabel = member.sex === 'm' ? 'männlich' : member.sex === 'f' ? 'weiblich' : ''
      const safeChanges = (Array.isArray(changes) ? changes : [])
        .filter((c) => c && EDITABLE.has(c.field))
        .map((c) => ({
          field: c.field,
          // Old birthdate arrives as ISO from the modal — render it Swiss like
          // the new value (the Lasse email showed "2024-04-17" vs "17.04.1998").
          old_value: c.field === 'birthdate' && /^\d{4}-\d{2}-\d{2}/.test(String(c.old_value ?? ''))
            ? fmtBirthdateDDMMYYYY(c.old_value)
            : c.old_value,
          new_value: c.field === 'birthdate' ? fmtBirthdateDDMMYYYY(member.birthdate)
            : c.field === 'sex' ? sexLabel
              : (member[c.field] ?? ''),
        }))
      if (!safeChanges.length) {
        return res.status(400).json({ error: 'No editable fields to update' })
      }

      // Get team names for CSV
      const schema = await getSchema()
      const { ItemsService, MailService } = services
      const mtService = new ItemsService('member_teams', { schema, knex: database })
      const memberTeams = await mtService.readByQuery({
        filter: { member: { _eq: member_id }, season: { _eq: getCurrentSeason() } },
        fields: ['team.name', 'team.sport'],
      })
      // Dedupe by team name (defensive — a member can hold the same team across
      // multiple seasons; the season filter already scopes to the current one).
      const teamNames = [...new Set(
        memberTeams.map(mt => mt.team?.name).filter(Boolean)
      )].join(', ')

      // Determine sport for email accent
      const teamSports = memberTeams.map(mt => mt.team?.sport).filter(Boolean)
      const sport = teamSports.includes('volleyball') ? 'volleyball'
        : teamSports.includes('basketball') ? 'basketball' : null

      // Build email — per-recipient locale via members.language. Authoritative
      // CSV from the DB row; ClubDesk-owned fields (anrede/nationalitaet/ahv/
      // beitragskategorie) blanked so they can never be forged or overwritten.
      const safeData = {
        anrede: '', first_name: member.first_name, last_name: member.last_name,
        email: member.email, phone: member.phone, adresse: member.adresse,
        plz: member.plz, ort: member.ort, birthdate: fmtBirthdateDDMMYYYY(member.birthdate),
        nationalitaet: '', sex: sexLabel, ahv_nummer: '', beitragskategorie: '',
      }
      const name = `${member.first_name} ${member.last_name}`
      const csvString = buildCsv(safeData, teamNames)
      const dateStr = new Date().toISOString().slice(0, 10)
      const filename = `clubdesk-update-${member.last_name}-${member.first_name}-${dateStr}.csv`

      const mail = new MailService({ schema, knex: database })

      // OWNER_EMAIL is a real admin's mailbox (resolves via members.language).
      // ADMIN_EMAIL is a forwarding alias (kontakt@kscw.ch) without a member
      // record, so the bucketing helper would fall it into `de`. To prevent
      // a duplicate German copy reaching the same admin via the alias, we
      // mirror ADMIN_EMAIL into the same locale bucket as OWNER_EMAIL.
      const ownerBuckets = await bucketEmailsByLocale(database, [OWNER_EMAIL])
      const ownerLocale = CD_LOCALES.find(l => ownerBuckets[l].length) || 'de'
      const buckets = await bucketEmailsByLocale(database, [OWNER_EMAIL])
      // Add ADMIN_EMAIL to the owner's resolved bucket (deduplicated)
      const adminLower = ADMIN_EMAIL.toLowerCase()
      if (adminLower !== OWNER_EMAIL.toLowerCase() && !buckets[ownerLocale].includes(adminLower)) {
        buckets[ownerLocale].push(adminLower)
      }

      for (const loc of CD_LOCALES) {
        const tos = buckets[loc]
        if (!tos.length) continue
        const tt = T[loc] || T.de
        const summaryCard = buildInfoCard([
          { label: tt.name, value: name, halfWidth: true },
          { label: tt.email, value: member.email, halfWidth: true },
          { label: tt.phone, value: member.phone || '—', halfWidth: true },
          { label: tt.team, value: teamNames || '—', halfWidth: true },
        ])
        const body = `
<div style="font-size:13px;color:#94a3b8;margin-bottom:12px">${tt.intro}</div>
${buildChangesTable(safeChanges, loc)}
<div style="margin-top:16px">
  <div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:8px;font-weight:700">${tt.currentData}</div>
  ${summaryCard}
</div>`
        const emailHtml = buildEmailLayout(body, { title: tt.title, subtitle: name, sport })
        await mail.send({
          to: tos,
          subject: tt.subject(name),
          html: emailHtml,
          attachments: [{ filename, content: toCp1252Buffer(csvString), contentType: 'text/csv; charset=windows-1252' }],
        })
      }

      // Flag the member for the next ClubDesk sync-up push and remember the field
      // diff (the superadmin modal echoes it). The email-to-admin path stays as the
      // manual fallback; the flag enables the automated push. Best-effort — a flag
      // failure must not fail the member's edit.
      try {
        await database('members').where('id', member_id).update({
          clubdesk_push_pending: true,
          clubdesk_push_changes: JSON.stringify(safeChanges),
        })
        // Audit: this raw-knex write bypasses Directus's activity/revision trail,
        // so record WHO flagged the member for the next ClubDesk sync-up push.
        await writeUserLog(database, log, {
          accountability: req.accountability, action: 'update',
          collection: 'members', recordId: member_id,
          data: { kind: 'clubdesk_push_flag', fields: safeChanges.map((c) => c.field) },
        })
      } catch (flagErr) {
        log.warn({ msg: `clubdesk push-flag failed: ${flagErr.message}`, member_id })
      }

      log.info({ msg: 'ClubDesk update email sent', member_id, changes: safeChanges.length })
      res.json({ success: true })
    } catch (err) {
      log.error({
        msg: `clubdesk-update: ${err.message}`,
        endpoint: 'clubdesk-update',
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
