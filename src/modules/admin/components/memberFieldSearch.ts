// src/modules/admin/components/memberFieldSearch.ts
//
// Datapoint search — "which member FIELD am I looking for", as opposed to
// useExplorerSearch, which answers "which member RECORD".
//
// The explorer holds ~110 member columns spread over 12 groups, and both views
// hide most of them by default (the grid ships two columns; the detail view
// hides empty + technical ones). Finding `ahv_nummer` or a licence flag
// therefore meant knowing which group it lives in and which toggle reveals it.
// This ranks the whole catalog by a free-text query instead.
//
// ⚠ Labels in memberFieldSchema.ts are English-only by design (see that file's
// header), so the search has to work for a German-speaking admin typing
// "Geburtsdatum" or "Lizenz". Two things carry that:
//   1. the `members` COLUMN NAME is part of the haystack, and a good half of
//      them are already German (`ahv_nummer`, `eintritt`, `beitragskategorie`);
//   2. ALIASES below, for the rest.

import { MEMBER_FIELDS, getFieldGroup, type MemberFieldDef } from './memberFieldSchema'

export interface FieldMatch {
  def: MemberFieldDef
  /** Group label, shown as the result's subtitle. */
  groupLabel: string
  score: number
}

/**
 * Extra search terms per field key — German equivalents, the other spelling,
 * and what people actually call the thing.
 *
 * Only for fields whose label AND key would both miss a reasonable query. A
 * field whose key is already the German word (`eintritt`, `austritt`, `adresse`)
 * needs no entry.
 */
const ALIASES: Readonly<Record<string, string>> = {
  first_name: 'vorname',
  last_name: 'nachname familienname surname',
  nickname: 'spitzname rufname',
  birthdate: 'geburtsdatum geburtstag birthday dob date of birth age alter',
  sex: 'geschlecht gender',
  anrede: 'salutation title',
  email: 'mail e-mail adresse',
  phone: 'telefon handy mobile natel',
  adresse: 'address street strasse',
  plz: 'postal code zip postleitzahl',
  ort: 'city town wohnort',
  nationalitaet_codes: 'nationality staatsangehoerigkeit citizenship country',
  nationalitaet: 'nationality staatsangehoerigkeit citizenship country',
  federation_of_origin: 'herkunftsverband',
  ahv_nummer: 'ahv ahvn13 social security sozialversicherung avs versichertennummer',
  iban: 'bank account konto bankverbindung',
  beitragskategorie: 'fee category beitrag mitgliederbeitrag dues',
  eintritt: 'join date entry beitritt',
  austritt: 'leave date exit resignation kuendigung',
  register_status: 'mitgliedschaft membership status register',
  license_nr: 'licence number lizenznummer lizenz',
  licence_status: 'lizenz licence order bestellung',
  licence_category: 'lizenz licence kategorie',
  scorer_vb: 'schreiber scorer licence lizenz schreiberlizenz',
  referee_vb: 'schiedsrichter referee licence lizenz',
  referee_bb: 'schiedsrichter referee licence lizenz',
  otr1_bb: 'table official licence lizenz offizielle',
  otr2_bb: 'table official licence lizenz offizielle',
  otn1_bb: 'table official licence lizenz offizielle',
  otn2_bb: 'table official licence lizenz offizielle',
  trainer_licences: 'coach licence trainerlizenz ausbildung js j+s',
  position: 'spielposition role',
  number: 'trikotnummer jersey shirt',
  photo: 'foto bild picture avatar',
  language: 'sprache locale',
  role: 'rolle permission berechtigung admin',
  user: 'login account konto',
  wiedisync_active: 'app access zugang aktiv',
  kscw_membership_active: 'mitgliedschaft membership aktiv',
  consent_decision: 'datenschutz privacy einwilligung dsg',
  clubdesk_id: 'clubdesk register',
}

/** `license`/`licence` and `-`/`_`/spaces must not decide a match. */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/licen[cs]e/g, 'licence')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
}

interface Haystack {
  def: MemberFieldDef
  groupLabel: string
  label: string
  key: string
  rest: string
}

/** Built once — MEMBER_FIELDS is a module-level constant. */
const HAYSTACKS: readonly Haystack[] = MEMBER_FIELDS.map((def) => ({
  def,
  groupLabel: getFieldGroup(def.group).label,
  label: normalize(def.label),
  key: normalize(def.key),
  rest: normalize(
    [getFieldGroup(def.group).label, def.help ?? '', ALIASES[def.key] ?? ''].join(' '),
  ),
}))

/** All chars of `needle` appear in `haystack`, in order. */
function fuzzy(haystack: string, needle: string): boolean {
  let i = 0
  for (const c of haystack) {
    if (c === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

function scoreOne(h: Haystack, q: string): number {
  if (h.label === q || h.key === q) return 100
  if (h.label.startsWith(q)) return 85
  if (h.key.startsWith(q)) return 75
  if (h.label.includes(q)) return 65
  if (h.key.includes(q)) return 55
  // Aliases + group + help. A hit here is a real hit ("geburtsdatum"), just a
  // less direct one than the label.
  if (h.rest.includes(q)) return 40
  if (fuzzy(h.label, q) || fuzzy(h.key, q)) return 10
  return 0
}

/**
 * Rank the member field catalog against a query.
 *
 * An empty query returns nothing rather than everything: this feeds a dropdown
 * that opens under a text box, and 110 unranked rows is the same wall the
 * search exists to replace. The caller shows its own "start typing" hint.
 *
 * A multi-word query ("ahv number", "scorer licence") is AND-ed across words and
 * scored by its weakest word, so both have to hit somewhere.
 */
export function rankMemberFields(query: string, limit = 12): FieldMatch[] {
  const words = normalize(query).split(' ').filter(Boolean)
  if (words.length === 0) return []

  const out: FieldMatch[] = []
  for (const h of HAYSTACKS) {
    let worst = Infinity
    for (const w of words) {
      const s = scoreOne(h, w)
      if (s === 0) { worst = 0; break }
      if (s < worst) worst = s
    }
    if (worst > 0 && worst !== Infinity) {
      out.push({ def: h.def, groupLabel: h.groupLabel, score: worst })
    }
  }
  out.sort((a, b) =>
    b.score - a.score
    || a.groupLabel.localeCompare(b.groupLabel)
    || a.def.label.localeCompare(b.def.label))
  return out.slice(0, limit)
}

/** Label for a key, for the selected-datapoint chips. Falls back to the key. */
export function memberFieldLabel(key: string): string {
  return MEMBER_FIELDS.find((f) => f.key === key)?.label ?? key
}
