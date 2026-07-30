/**
 * Unit tests for the sync-up push CSV builder (clubdesk-update.js) — the two-set
 * split introduced with migration 173: UPDATE rows carry contact fields only,
 * CREATE rows additionally carry Beitragskategorie + Eintritt + Gruppen.
 *
 * Primary invariants (legal-register safety):
 *   • UPDATE rows are [Id]-KEYED and NAME-LESS (2026-07-08, spike-proven:
 *     ClubDesk's import consumes a `[Id]` column as the record identity and
 *     touches only the columns present). Vorname/Nachname must NEVER appear in
 *     the update set — they would overwrite the register's legal names.
 *   • An UPDATE CSV must NEVER contain a category/groups column
 *     (ClubDesk-authoritative on existing contacts). The same spike proved an
 *     empty mapped cell is a no-op on import — the echo-back/blank-risk guards
 *     stay as defense-in-depth regardless.
 *   • CREATE rows carry the real wiedisync name and never an [Id] (an unknown
 *     [Id] hard-aborts ClubDesk's whole import).
 *
 * Hermetic — pure functions, no DB or network.
 */
import { describe, it, expect } from 'vitest'
import { buildPushCsv, CD_PUSH_CREATE_HEADERS, CD_KATEGORIE_MAP, mapKategorie, deriveGruppen, deriveStatus, deriveMitgliederbeitrag, deriveOffiziellenLizenz, deriveSektion, deriveSchiedsrichter, federationCell, nationalityCell, gastCell } from '../clubdesk-update.js'

const kacper = {
  first_name: 'Kacper', last_name: 'Krawczyński', email: 'k@example.com',
  phone: '+41 79 000 00 00', adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
  birthdate: '1999-03-15', sex: 'm', clubdesk_id: '1001283',
  beitragskategorie: 'VB Erwerbstätige', eintritt: '2026-06-27T18:22:00.000Z',
  gruppen: 'VB H1 (Spieler*in)', cd_status: 'Aktivmitglied',
}

describe('buildPushCsv (update set)', () => {
  it('is [Id]-keyed and name-less — 15 contact columns + 5 fill-only cells, no groups/status', () => {
    const csv = buildPushCsv([kacper])
    const [header, row] = csv.trim().split('\n')
    // Beitragskategorie/Eintritt/Mitgliederbeitrag joined the UPDATE set
    // 2026-07-27 as FILL-ONLY extras at the END (after Gast) — ClubDesk's own
    // value always wins, so they can only ever fill an empty register cell.
    // Lizenznummer/Lizenzart followed the same day under the same rule.
    expect(header).toBe('[Id];E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN;Anrede;Nationalität;Federation of Origin;AHV Nummer;Wiedisync ID;Gast;Beitragskategorie;Eintritt;Mitgliederbeitrag;Lizenznummer;Lizenzart')
    // Names must NEVER ride on an update row: [Id] is the upsert key (spike-proven
    // 2026-07-08) and a name column would overwrite the register's legal name.
    expect(header).not.toContain('Vorname')
    expect(header).not.toContain('Nachname')
    // Groups/Status stay CREATE-only — ClubDesk-authoritative on existing contacts.
    expect(header).not.toContain('Gruppen')
    expect(header).not.toContain('Status')
    const cells = row.split(';')
    expect(cells).toHaveLength(20)
    expect(cells[0]).toBe('1001283')  // ClubDesk's own [Id] = members.clubdesk_id
    expect(row).not.toContain('Kacper')
    expect(row).not.toContain('Krawczyński')
    // The fixture's gruppen/cd_status must never leak onto an update row.
    expect(row).not.toContain('VB H1')
    expect(row).not.toContain('Aktivmitglied')
  })

  it('emits an empty [Id] cell when clubdesk_id is missing (guarded upstream by /up)', () => {
    const cells = buildPushCsv([{ ...kacper, clubdesk_id: null }]).trim().split('\n')[1].split(';')
    expect(cells[0]).toBe('')
  })

  it('carries the echo-protected fields + the Wiedisync ID (uuid, id fallback) after IBAN', () => {
    const row = buildPushCsv([{ ...kacper, id: 531, iban: 'CH93', anrede: 'Herr', nationalitaet: 'Schweiz', ahv_nummer: '756.1.2.3' }])
      .trim().split('\n')[1].split(';')
    expect(row[8]).toBe('CH93')      // IBAN — invalid (mod-97 fail) passes through raw, never blanked
    expect(row[9]).toBe('Herr')      // Anrede
    expect(row[10]).toBe('Schweiz')  // Nationalität
    expect(row[12]).toBe('756.1.2.3') // AHV Nummer — unrewritable passes through raw
    expect(row[13]).toBe('531')      // Wiedisync ID: numeric id fallback (pre-184 rows)
    // members.uuid (migration 184) wins over the numeric id
    const uuid = 'a3e1f0b2-4c5d-4e6f-8a9b-0c1d2e3f4a5b'
    const withUuid = buildPushCsv([{ ...kacper, id: 531, uuid }]).trim().split('\n')[1].split(';')
    expect(withUuid[13]).toBe(uuid)
    const empty = buildPushCsv([kacper]).trim().split('\n')[1].split(';')
    expect([empty[9], empty[10], empty[11], empty[12]]).toEqual(['', '', '', '']) // /up echo-fills these
    expect(empty[13]).toBe('') // no uuid/id on the fixture → empty
  })

  it('maps Federation of Origin to ClubDesk German, keeps the NONE sentinel, echoes when unanswered', () => {
    // wiedisync stores an ISO code; ClubDesk's picklist wants its OWN German
    // spelling (country_codes.name_de_clubdesk — "Großbritannien", not CLDR's
    // "Vereinigtes Königreich"), so the map is passed in, never guessed.
    const countryNames = new Map([['IT', 'Italien'], ['GB', 'Großbritannien']])
    const cell = (m) => buildPushCsv([{ ...kacper, ...m }], { countryNames }).trim().split('\n')[1].split(';')[11]
    expect(cell({ federation_of_origin: 'IT' })).toBe('Italien')
    expect(cell({ federation_of_origin: 'GB' })).toBe('Großbritannien')
    // 'NONE' = "never licensed elsewhere" — a real answer, pushed as Keiner.
    expect(cell({ federation_of_origin: 'NONE' })).toBe('Keiner')
    // Not answered → /up's echo of ClubDesk's own cell, never an empty cell
    // that could blank the register (the echo can't ride on the code column).
    expect(cell({ federation_of_origin: null, federation_of_origin_cd: 'Frankreich' })).toBe('Frankreich')
    expect(cell({ federation_of_origin: null })).toBe('')
    // An unknown code is never guessed at — empty, and the echo takes over.
    expect(cell({ federation_of_origin: 'ZZ', federation_of_origin_cd: 'Italien' })).toBe('Italien')
  })

  it('sends Gast as a TOTAL Ja/Nein — a non-guest asserts Nein, never an empty cell', () => {
    // Wiedisync owns guest status outright (it derives from member_teams, which
    // ClubDesk has no source for), so unlike every other contact column there is
    // no echo and no empty state: leaving the cell blank would let the register
    // stay ambiguous between "not a guest" and "nobody ever said".
    const gastOf = (m, opts) => {
      const csv = buildPushCsv([{ ...kacper, ...m }], opts)
      const [header, row] = csv.trim().split('\n')
      return row.split(';')[header.split(';').indexOf('Gast')]
    }
    expect(gastOf({ is_guest: true })).toBe('Ja')
    expect(gastOf({ is_guest: false })).toBe('Nein')
    // Unresolved (a caller that forgot /up's guestMemberIdSet pass) must NOT
    // read as a guest — 'Nein' is the safe assertion, 'Ja' would invent one.
    expect(gastOf({})).toBe('Nein')
    expect(gastOf({ is_guest: null })).toBe('Nein')
    // Truthy-but-not-true values are not a guest flag either (=== true).
    expect(gastOf({ is_guest: 1 })).toBe('Nein')
    // Same column, same rule, on the CREATE set — where it must agree with the
    // guest Mitgliederbeitrag computed off the very same flag.
    expect(gastOf({ is_guest: true }, { create: true })).toBe('Ja')
  })

  it('exposes gastCell as the single Ja/Nein mapper (drift + push must not diverge)', () => {
    expect(gastCell(true)).toBe('Ja')
    expect(gastCell(false)).toBe('Nein')
    expect(gastCell(undefined)).toBe('Nein')
  })

  it('repairs outgoing contact cells to the canonical formats (normalize.js)', () => {
    const row = buildPushCsv([{
      ...kacper,
      email: ' K@Example.COM ',
      phone: '0791234567',
      iban: 'ch93 0076 2011 6238 5295 7',
      ahv_nummer: '7561234567897',
    }]).trim().split('\n')[1].split(';')
    expect(row[1]).toBe('k@example.com')
    expect(row[2]).toBe('+41 79 123 45 67')
    expect(row[8]).toBe('CH9300762011623852957')
    expect(row[12]).toBe('756.1234.5678.97')
    // unrewritable values pass through raw — the push never blanks what it can't parse
    const raw = buildPushCsv([{ ...kacper, phone: '01 451 60 38' }]).trim().split('\n')[1].split(';')
    expect(raw[2]).toBe('01 451 60 38')
  })

  it('formats birthdate dd.mm.yyyy and maps sex to ClubDesk wording', () => {
    const row = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(row).toContain('15.03.1999')
    expect(row.split(';')[7]).toBe('männlich')
  })

  it('carries the member IBAN (or the /up-resolved ClubDesk echo) at index 8', () => {
    const withIban = buildPushCsv([{ ...kacper, iban: 'CH9300762011623852957' }]).trim().split('\n')[1]
    expect(withIban.split(';')[8]).toBe('CH9300762011623852957')
    const withoutIban = buildPushCsv([kacper]).trim().split('\n')[1]
    expect(withoutIban.split(';')[8]).toBe('')
  })

  it('leaves phone-style leading + unguarded but escapes +formula (2026-07-06 apostrophe bug)', () => {
    const cells = buildPushCsv([{ ...kacper, phone: '+41 79 000 00 00', adresse: '+HYPERLINK(1)' }])
      .trim().split('\n')[1].split(';')
    expect(cells[2]).toBe('+41 79 000 00 00') // Telefon Privat
    expect(cells[3]).toBe("'+HYPERLINK(1)")   // Adresse
  })
})

describe('buildPushCsv (update set — fill-only billing cells, 2026-07-27)', () => {
  // Cells [15..17] = Beitragskategorie / Eintritt / Mitgliederbeitrag. ClubDesk's
  // own value (the /up-stashed *_cd mirror) ALWAYS wins — sending it back is a
  // no-op on import — and wiedisync's value goes out only when the register's
  // cell is empty (the contact-created-ClubDesk-side-then-linked case, member
  // 525 / contact 1001301). Per-person Mitgliederbeitrag overrides
  // ("Speziallizenz, einmalig so tief") are sacred.
  const cellsOf = (m) => buildPushCsv([{ ...kacper, ...m }]).trim().split('\n')[1].split(';')

  it("echoes ClubDesk's own value VERBATIM when the register has one (no-op)", () => {
    const cells = cellsOf({
      beitragskategorie_cd: 'VB Studenten/Lehrlinge',
      eintritt_cd: '09.03.2025', // ClubDesk export string, dd.mm.yyyy — never reparsed
      mitgliederbeitrag_cd: '250', // manual per-person override — sacred
    })
    expect(cells[15]).toBe('VB Studenten/Lehrlinge') // NOT wiedisync's 'VB Erwerbstätige'
    expect(cells[16]).toBe('09.03.2025')             // NOT the registration date
    expect(cells[17]).toBe('250')                    // NOT the derived 540
  })

  it('fills from wiedisync when ClubDesk is empty — mapped Kategorie, dd.mm.yyyy Eintritt, derived Beitrag with the +100 no-licence surcharge', () => {
    // kacper: VB Erwerbstätige, no scorer_vb → adult surcharge applies (440+100).
    const cells = cellsOf({})
    expect(cells[15]).toBe('VB Erwerbstätige')
    expect(cells[16]).toBe('27.06.2026') // m.eintritt (registration submitted_at) → dd.mm.yyyy
    expect(cells[17]).toBe('540')
    // A licensed scorer pays the base fee.
    expect(cellsOf({ scorer_vb: true })[17]).toBe('440')
    // The legacy form Kategorie is MAPPED to ClubDesk's wording exactly like
    // the create path; the fee still derives from the RAW category, under BB
    // rules (a VB scorer licence does not lift the BB officials surcharge).
    const mapped = cellsOf({ beitragskategorie: 'BB Junior:innen', scorer_vb: true })
    expect(mapped[15]).toBe('BB Jugend Meisterschaft')
    expect(mapped[17]).toBe('410') // youth 310 + 100 (U16+ by birthdate, no BB officials licence)
    // A pure guest is billed the guest rate on the fill, same flag as the Gast cell.
    expect(cellsOf({ is_guest: true })[17]).toBe('330') // 440 − 110, never the surcharge
  })

  it('each cell echoes independently — a register-set Kategorie never blocks an Eintritt fill', () => {
    const cells = cellsOf({ beitragskategorie_cd: 'VB Erwerbstätige', eintritt_cd: '', mitgliederbeitrag_cd: '440' })
    expect(cells[15]).toBe('VB Erwerbstätige') // echo
    expect(cells[16]).toBe('27.06.2026')       // fill
    expect(cells[17]).toBe('440')              // echo
  })

  it('ClubDesk empty + no wiedisync value → empty cells (a harmless no-op on import)', () => {
    const cells = cellsOf({ beitragskategorie: null, eintritt: null })
    expect(cells[15]).toBe('')
    expect(cells[16]).toBe('')
    expect(cells[17]).toBe('') // unknown/empty category is never guessed at
  })

  // Cells [18..19] = Lizenznummer / Lizenzart (2026-07-27) — same precedence:
  // the register's own cell (the /up-stashed *_cd mirror) always wins, and the
  // authority-sourced members.license_nr / licence_category (Volleymanager /
  // Basketplan) only ever fill an EMPTY register cell. A divergent register
  // value is a manual decision, never an automated overwrite.
  it('licence cells echo ClubDesk verbatim when set, fill from members when empty', () => {
    const echoed = cellsOf({
      license_nr: '846309', licence_category: 'U 10',
      lizenznummer_cd: '812847', lizenzart_cd: 'RLL',
    })
    expect(echoed[18]).toBe('812847') // NOT wiedisync's 846309
    expect(echoed[19]).toBe('RLL')    // NOT wiedisync's U 10
    const filled = cellsOf({ license_nr: '846309', licence_category: 'U 10' })
    expect(filled[18]).toBe('846309')
    expect(filled[19]).toBe('U 10')
    // Each cell independent — a register-set number never blocks an art fill.
    const mixed = cellsOf({ license_nr: '846309', licence_category: 'U 10', lizenznummer_cd: '812847' })
    expect(mixed[18]).toBe('812847')
    expect(mixed[19]).toBe('U 10')
    // Nothing anywhere → empty cells, never a guess.
    const empty = cellsOf({})
    expect(empty[18]).toBe('')
    expect(empty[19]).toBe('')
  })

  it("suppresses 'Offizielle/r' from Lizenzart — an officials licence is not a playing licence", () => {
    // Basketplan files pure officials under the category 'Offizielle/r', but
    // ClubDesk models that in its own Offiziellen Lizenz field (OTR/OTN
    // levels) — pushing it as Lizenzart would misfile the qualification.
    const cells = cellsOf({ license_nr: '759984', licence_category: 'Offizielle/r' })
    expect(cells[18]).toBe('759984') // the number still fills
    expect(cells[19]).toBe('')       // the art cell stays empty
    // A register-set Lizenzart still echoes through unchanged.
    expect(cellsOf({ licence_category: 'Offizielle/r', lizenzart_cd: 'RLL' })[19]).toBe('RLL')
    // Same rule on the CREATE set.
    const createRow = buildPushCsv([{ ...kacper, license_nr: '759984', licence_category: 'Offizielle/r' }], { create: true })
      .trim().split('\n')[1].split(';')
    expect(createRow[25]).toBe('759984')
    expect(createRow[26]).toBe('')
  })
})

describe('buildPushCsv (create set)', () => {
  it('appends the create-set columns (Telefon Mobil … Schiedsrichter) in order', () => {
    const csv = buildPushCsv([{ ...kacper, scorer_vb: true, referee_vb: true, iban: 'CH9300762011623852957', cd_sektion: 'Volleyball', license_nr: '183931', licence_category: 'RLL' }], { create: true })
    const [header, row] = csv.trim().split('\n')
    // FULL literal pin — `toBe(CD_PUSH_CREATE_HEADERS.join(';'))` alone is
    // self-referential (a header deleted from the array would still pass while
    // the cells shift against ClubDesk's mapper). CREATE rows carry the real
    // wiedisync name (a new contact needs one) and never an [Id] (an unknown
    // [Id] hard-aborts ClubDesk's whole import).
    expect(header).toBe('Vorname;Nachname;E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN;Anrede;Nationalität;Federation of Origin;AHV Nummer;Wiedisync ID;Gast;Telefon Mobil;Beitragskategorie;Eintritt;Gruppen;Status;Offiziellen Lizenz;Mitgliederbeitrag;Sektion;Schiedsrichter;Lizenznummer;Lizenzart')
    expect(header).toBe(CD_PUSH_CREATE_HEADERS.join(';'))
    expect(header).not.toContain('[Id]')
    // header/cell count equality — catches a header/cells drift in either direction
    expect(row.split(';')).toHaveLength(header.split(';').length)
    const cells = row.split(';')
    expect(cells).toHaveLength(27)
    expect(cells[9]).toBe('CH9300762011623852957') // IBAN
    // [10..13] = Anrede/Nationalität/Federation of Origin/AHV Nummer (empty on this fixture); [14] = Wiedisync ID; [15] = Gast; create extras start at [16]
    expect(cells[16]).toBe('+41 79 000 00 00')      // Telefon Mobil = Privat
    expect(cells[17]).toBe('VB Erwerbstätige')       // Beitragskategorie
    expect(cells[18]).toBe('27.06.2026')             // Eintritt
    expect(cells[19]).toBe('VB H1 (Spieler*in)')     // Gruppen
    expect(cells[20]).toBe('Aktivmitglied')          // Status
    expect(cells[21]).toBe('VB SC')                  // Offiziellen Lizenz (scorer, not VB SR)
    expect(cells[22]).toBe('440')                    // Mitgliederbeitrag
    expect(cells[23]).toBe('Volleyball')             // Sektion
    expect(cells[24]).toBe('Ja')                     // Schiedsrichter (referee)
    expect(cells[25]).toBe('183931')                 // Lizenznummer (issuing authority)
    expect(cells[26]).toBe('RLL')                    // Lizenzart
  })

  it('Telefon Mobil mirrors Telefon Privat (one number → both)', () => {
    const cells = buildPushCsv([kacper], { create: true }).trim().split('\n')[1].split(';')
    expect(cells[3]).toBe(cells[16]) // Privat === Mobil
  })

  it('empty create-set optional cells stay empty (safe on a new contact)', () => {
    const row = buildPushCsv([{ ...kacper, phone: '', beitragskategorie: null, eintritt: null, gruppen: '', cd_status: '' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    // IBAN, Anrede, Nationalität, Federation of Origin, AHV, Wiedisync ID (no id),
    // Telefon Mobil, Beitragskategorie, Eintritt, Gruppen, Status, Lizenznummer,
    // Lizenzart. 15 (Gast) is deliberately NOT in this list — it is the one
    // contact column that is never empty (gastCell asserts 'Nein'), asserted
    // separately below.
    for (const i of [9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 25, 26]) expect(cells[i]).toBe('')
  })

  it('neutralises formula injection in the category cell', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: '=SUM(A1)' }], { create: true })
      .trim().split('\n')[1]
    expect(row.split(';')[17]).toBe("'=SUM(A1)")
  })

  it('multi-team Gruppen stays one cell (comma is safe in semicolon CSV)', () => {
    const row = buildPushCsv([{ ...kacper, gruppen: 'VB H1 (Spieler*in), VB H2 (Spieler*in)' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    expect(cells).toHaveLength(27)
    expect(cells[19]).toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
  })
})

describe('deriveOffiziellenLizenz', () => {
  it('VB scorer OR referee → VB SC (VB referee is auto a scorer), BB by level, none → empty', () => {
    expect(deriveOffiziellenLizenz({ referee_vb: true, scorer_vb: true })).toBe('VB SC')
    expect(deriveOffiziellenLizenz({ referee_vb: true })).toBe('VB SC') // VB referee ⇒ auto scorer
    expect(deriveOffiziellenLizenz({ referee_bb: true })).toBe('') // BB referee is NOT auto a scorer
    expect(deriveOffiziellenLizenz({ scorer_vb: true })).toBe('VB SC')
    expect(deriveOffiziellenLizenz({ otr1_bb: true })).toBe('OTR1')
    expect(deriveOffiziellenLizenz({ otr2_bb: true })).toBe('OTR2')
    expect(deriveOffiziellenLizenz({ otn_bb: true })).toBe('OTN')
    expect(deriveOffiziellenLizenz({})).toBe('')
    expect(deriveOffiziellenLizenz(null)).toBe('')
  })
})

describe('deriveSchiedsrichter', () => {
  it('Ja for a VB or BB referee, Nein otherwise', () => {
    expect(deriveSchiedsrichter({ referee_vb: true })).toBe('Ja')
    expect(deriveSchiedsrichter({ referee_bb: true })).toBe('Ja')
    expect(deriveSchiedsrichter({ scorer_vb: true })).toBe('Nein')
    expect(deriveSchiedsrichter({})).toBe('Nein')
    expect(deriveSchiedsrichter(null)).toBe('Nein')
  })
})

describe('deriveGruppen officials', () => {
  it('VB scorer → VB Schreiber*innen group; referees are NOT grouped', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', lizenz: 'Schreiber' })).toBe('VB Schreiber*innen')
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1', rolle: 'Spieler*in', lizenz: 'Schreiber' }))
      .toBe('VB H1 (Spieler*in), VB Schreiber*innen')
    expect(deriveGruppen({ membership_type: 'volleyball', lizenz: 'Schiedsrichter' })).toBe('')
    expect(deriveGruppen({ membership_type: 'basketball', lizenz: 'Schiedsrichter' })).toBe('')
  })
})

describe('deriveSektion', () => {
  it('sektion from sport, passive uses approver choice (default KSCW)', () => {
    expect(deriveSektion({ membership_type: 'volleyball' })).toBe('Volleyball')
    expect(deriveSektion({ membership_type: 'basketball' })).toBe('Basketball')
    expect(deriveSektion({ membership_type: 'passive', sektion_choice: 'Volleyball' })).toBe('Volleyball')
    expect(deriveSektion({ membership_type: 'passive' })).toBe('KSCW')
    expect(deriveSektion(null)).toBe('')
  })
  // The Passivmitglied Ja/Nein checkbox was deleted in ClubDesk on 2026-07-30 —
  // passive membership rides on Status alone (see deriveStatus below).
  it('passive registrations are marked via Status, not a checkbox', () => {
    expect(CD_PUSH_CREATE_HEADERS).not.toContain('Passivmitglied')
    expect(deriveStatus({ membership_type: 'passive' }, { wiedisync_active: true })).toBe('Passivmitglied')
  })
})

describe('deriveMitgliederbeitrag', () => {
  it('maps the confirmed fees for both name families', () => {
    expect(deriveMitgliederbeitrag('VB Erwerbstätige')).toBe('440')
    expect(deriveMitgliederbeitrag('VB Student*in Meisterschaft')).toBe('380')
    expect(deriveMitgliederbeitrag('VB Studenten/Lehrlinge')).toBe('380')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige')).toBe('510')
    expect(deriveMitgliederbeitrag('BB Erwerbstätig 1. Liga')).toBe('560')
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft')).toBe('310')
    expect(deriveMitgliederbeitrag('BB Minis Turnier')).toBe('210')
    expect(deriveMitgliederbeitrag('Gratis')).toBe('0')
    expect(deriveMitgliederbeitrag('Passivmitglied')).toBe('40')
  })

  it('unknown or empty category yields an empty cell, never a guess', () => {
    expect(deriveMitgliederbeitrag('Sponsor')).toBe('')
    expect(deriveMitgliederbeitrag('')).toBe('')
    expect(deriveMitgliederbeitrag(null)).toBe('')
  })

  it('a guest pays base − 110 (floored at 0), never the no-Schreiber surcharge', () => {
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', null, { isGuest: true })).toBe('330')
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', null, { isGuest: true })).toBe('200')
    expect(deriveMitgliederbeitrag('VB Turnier KWI', null, { isGuest: true })).toBe('0') // 110 − 110
    // The guest flag short-circuits the surcharge: an adult non-scorer (normally
    // 540) is billed 330, not 540 − 110.
    const adultNoLic = { scorer_vb: false, otr1_bb: false, otr2_bb: false, otn_bb: false, birthdate: '1990-01-01' }
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', adultNoLic, { isGuest: true })).toBe('330')
    // An unknown category is still empty even for a guest.
    expect(deriveMitgliederbeitrag('Sponsor', null, { isGuest: true })).toBe('')
  })

  it('surcharges adult categories (inherently U16+) on a missing licence, regardless of birthdate', () => {
    const adultNoLic = { scorer_vb: false, otr1_bb: false, otr2_bb: false, otn_bb: false }
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', adultNoLic)).toBe('540')
    expect(deriveMitgliederbeitrag('VB Erwerbstätige', { scorer_vb: true })).toBe('440')
    expect(deriveMitgliederbeitrag('VB Student*in Meisterschaft', adultNoLic)).toBe('480')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige', adultNoLic)).toBe('610')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige', { otr1_bb: true })).toBe('510')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige 1. Liga', adultNoLic)).toBe('660')
    expect(deriveMitgliederbeitrag('BB Lernende/Studierende', adultNoLic)).toBe('510')
  })

  it('surcharges youth categories ONLY when the member is U16+ (born <= year-15)', () => {
    const youngVb = { scorer_vb: false, birthdate: '2013-05-01' } // ~13 → below U16
    const olderVb = { scorer_vb: false, birthdate: '2009-05-01' } // ~17 → U16+
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', youngVb)).toBe('310')
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', olderVb)).toBe('410')
    const youngBb = { otr1_bb: false, otr2_bb: false, otn_bb: false, birthdate: '2014-05-01' }
    const olderBb = { otr1_bb: false, otr2_bb: false, otn_bb: false, birthdate: '2008-05-01' }
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', youngBb)).toBe('310')
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', olderBb)).toBe('410')
    expect(deriveMitgliederbeitrag('BB Minis Turnier', youngBb)).toBe('210')
  })

  it('unknown birthdate on a youth category → base (never over-charge without the age)', () => {
    expect(deriveMitgliederbeitrag('BB Jugend Meisterschaft', { otr1_bb: false })).toBe('310')
    expect(deriveMitgliederbeitrag('VB Schüler*in Meisterschaft', { scorer_vb: false })).toBe('310')
  })

  it('does NOT surcharge VB intro tiers, passive or gratis (even for adults)', () => {
    const bare = { scorer_vb: false, otr1_bb: false, birthdate: '1990-01-01' }
    expect(deriveMitgliederbeitrag('VB Turnier KWI', bare)).toBe('110')
    expect(deriveMitgliederbeitrag('VB Schüler*in 1. Jahr', bare)).toBe('110')
    expect(deriveMitgliederbeitrag('Passivmitglied', bare)).toBe('40')
    expect(deriveMitgliederbeitrag('Gratis', bare)).toBe('0')
  })

  it('no member arg → base amount (safe default)', () => {
    expect(deriveMitgliederbeitrag('VB Erwerbstätige')).toBe('440')
    expect(deriveMitgliederbeitrag('BB Erwerbstätige')).toBe('510')
  })
})

describe('deriveStatus', () => {
  it('registration → Aktivmitglied, passive registration → Passivmitglied', () => {
    expect(deriveStatus({ membership_type: 'volleyball' }, { wiedisync_active: false })).toBe('Aktivmitglied')
    expect(deriveStatus({ membership_type: 'basketball' }, null)).toBe('Aktivmitglied')
    expect(deriveStatus({ membership_type: 'passive' }, { wiedisync_active: true })).toBe('Passivmitglied')
  })

  it('no registration → Aktivmitglied only when wiedisync_active, else empty', () => {
    expect(deriveStatus(null, { wiedisync_active: true })).toBe('Aktivmitglied')
    expect(deriveStatus(null, { wiedisync_active: false })).toBe('')
    expect(deriveStatus(null, null)).toBe('')
    expect(deriveStatus(undefined, { wiedisync_active: 1 })).toBe('')
  })
})

describe('deriveGruppen', () => {
  it('derives sport-prefixed player groups from an approved registration', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1', rolle: 'Spieler*in' }))
      .toBe('VB H1 (Spieler*in)')
    expect(deriveGruppen({ membership_type: 'basketball', team: 'HU14', rolle: 'Trainer*in' }))
      .toBe('BB HU14 (Trainer*in)')
  })

  it('derives a (Guest) group for a guest registration (VB and BB)', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H2', rolle: 'Guest' }))
      .toBe('VB H2 (Guest)')
    expect(deriveGruppen({ membership_type: 'basketball', team: 'HU16', rolle: 'Guest' }))
      .toBe('BB HU16 (Guest)')
  })

  it('joins multiple teams into one comma-separated cell', () => {
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1, H2', rolle: 'Spieler*in' }))
      .toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
  })

  it('returns empty for passive, unknown funktion or missing team', () => {
    expect(deriveGruppen({ membership_type: 'passive', team: '', rolle: 'VB Schiedsrichter' })).toBe('')
    expect(deriveGruppen({ membership_type: 'volleyball', team: 'H1', rolle: 'Andere' })).toBe('')
    expect(deriveGruppen({ membership_type: 'volleyball', team: '', rolle: 'Spieler*in' })).toBe('')
    expect(deriveGruppen(null)).toBe('')
  })
})

describe('mapKategorie', () => {
  it('passes unmapped values through verbatim (trimmed)', () => {
    expect(mapKategorie('  VB Erwerbstätige ')).toBe('VB Erwerbstätige')
    expect(mapKategorie(null)).toBe('')
    expect(mapKategorie(undefined)).toBe('')
  })

  it('applies the ClubDesk mapping when an entry exists', () => {
    CD_KATEGORIE_MAP['__test__'] = 'Mapped'
    try {
      expect(mapKategorie('__test__')).toBe('Mapped')
    } finally {
      delete CD_KATEGORIE_MAP.__test__
    }
  })

  it('translates the legacy BB youth form values (2026-07-06 rename)', () => {
    expect(mapKategorie('BB Junior:innen')).toBe('BB Jugend Meisterschaft')
    expect(mapKategorie('BB Minis')).toBe('BB Minis Turnier')
    // the new form values pass through untouched
    expect(mapKategorie('BB Jugend Meisterschaft')).toBe('BB Jugend Meisterschaft')
    expect(mapKategorie('BB Minis Turnier')).toBe('BB Minis Turnier')
  })
})

describe('federationCell / nationalityCell (the PUSH shape of the coded fields)', () => {
  // ClubDesk's picklists, NOT the display names — "Großbritannien" is the value
  // its Nationalität field accepts; "Vereinigtes Königreich" lands the row in the
  // "nicht erkannte" bucket. The reader-facing counterparts live in
  // federations.js and must never be substituted here.
  const CD_NAMES = new Map([
    ['CH', 'Schweiz'], ['DE', 'Deutschland'], ['GB', 'Großbritannien'],
  ])

  it('maps a federation code to ClubDesk German, and NONE to its sentinel word', () => {
    expect(federationCell('CH', CD_NAMES)).toBe('Schweiz')
    expect(federationCell('NONE', CD_NAMES)).toBe('Keiner')
    expect(federationCell('', CD_NAMES)).toBe('')
    // An unknown code yields '' so the echo-back fills ClubDesk's own value
    // rather than a guessed spelling the import would reject.
    expect(federationCell('ZZ', CD_NAMES)).toBe('')
  })

  it('maps the nationality code list to ClubDesk German', () => {
    expect(nationalityCell('DE,CH', CD_NAMES)).toBe('Deutschland, Schweiz')
    expect(nationalityCell('GB', CD_NAMES)).toBe('Großbritannien')
    expect(nationalityCell('', CD_NAMES)).toBe('')
    // Legacy free text (or an older frontend's label) passes through rather than
    // vanishing from the change preview.
    expect(nationalityCell('Deutschland', CD_NAMES)).toBe('Deutschland')
  })
})
