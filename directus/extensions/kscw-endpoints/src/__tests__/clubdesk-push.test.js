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
import { buildPushCsv, CD_PUSH_CREATE_HEADERS, CD_KATEGORIE_MAP, CD_BEITRAG_MAP, feeBreakdown, mapKategorie, deriveGruppen, deriveStatus, deriveMitgliederbeitrag, deriveOffiziellenLizenz, deriveSektion, deriveSchiedsrichter, federationCell, nationalityCell, gastCell, trainerLicenceCell, trainerLicenceDisplay, parseTrainerLicenceCell, parseTrainerLicenceCodes } from '../clubdesk-update.js'

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
    expect(header).toBe('[Id];E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN;Anrede;Nationalität;Federation of Origin;Trainer Lizenz;AHV Nummer;Wiedisync ID;Gast;Beitragskategorie;Eintritt;Mitgliederbeitrag;Lizenznummer;Lizenzart')
    // Names must NEVER ride on an update row: [Id] is the upsert key (spike-proven
    // 2026-07-08) and a name column would overwrite the register's legal name.
    expect(header).not.toContain('Vorname')
    expect(header).not.toContain('Nachname')
    // Groups/Status stay CREATE-only — ClubDesk-authoritative on existing contacts.
    expect(header).not.toContain('Gruppen')
    expect(header).not.toContain('Status')
    const cells = row.split(';')
    expect(cells).toHaveLength(21)
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
    expect(row[13]).toBe('756.1.2.3') // AHV Nummer — unrewritable passes through raw
    expect(row[14]).toBe('531')      // Wiedisync ID: numeric id fallback (pre-184 rows)
    // members.uuid (migration 184) wins over the numeric id
    const uuid = 'a3e1f0b2-4c5d-4e6f-8a9b-0c1d2e3f4a5b'
    const withUuid = buildPushCsv([{ ...kacper, id: 531, uuid }]).trim().split('\n')[1].split(';')
    expect(withUuid[14]).toBe(uuid)
    const empty = buildPushCsv([kacper]).trim().split('\n')[1].split(';')
    expect([empty[9], empty[10], empty[11], empty[12], empty[13]]).toEqual(['', '', '', '', '']) // /up echo-fills these
    expect(empty[14]).toBe('') // no uuid/id on the fixture → empty
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
    expect(row[13]).toBe('756.1234.5678.97')
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
  // Cells [16..18] = Beitragskategorie / Eintritt / Mitgliederbeitrag. ClubDesk's
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
    expect(cells[16]).toBe('VB Studenten/Lehrlinge') // NOT wiedisync's 'VB Erwerbstätige'
    expect(cells[17]).toBe('09.03.2025')             // NOT the registration date
    expect(cells[18]).toBe('250')                    // NOT the derived 540
  })

  it('fills from wiedisync when ClubDesk is empty — mapped Kategorie, dd.mm.yyyy Eintritt, derived Beitrag with the +100 no-licence surcharge', () => {
    // kacper: VB Erwerbstätige, no scorer_vb → adult surcharge applies (440+100).
    const cells = cellsOf({})
    expect(cells[16]).toBe('VB Erwerbstätige')
    expect(cells[17]).toBe('27.06.2026') // m.eintritt (registration submitted_at) → dd.mm.yyyy
    expect(cells[18]).toBe('540')
    // A licensed scorer pays the base fee.
    expect(cellsOf({ scorer_vb: true })[18]).toBe('440')
    // The legacy form Kategorie is MAPPED to ClubDesk's wording exactly like
    // the create path; the fee still derives from the RAW category, under BB
    // rules (a VB scorer licence does not lift the BB officials surcharge).
    const mapped = cellsOf({ beitragskategorie: 'BB Junior:innen', scorer_vb: true })
    expect(mapped[16]).toBe('BB Jugend Meisterschaft')
    expect(mapped[18]).toBe('410') // youth 310 + 100 (U16+ by birthdate, no BB officials licence)
    // A pure guest is billed the guest rate on the fill, same flag as the Gast cell.
    expect(cellsOf({ is_guest: true })[18]).toBe('330') // 440 − 110, never the surcharge
  })

  it('each cell echoes independently — a register-set Kategorie never blocks an Eintritt fill', () => {
    const cells = cellsOf({ beitragskategorie_cd: 'VB Erwerbstätige', eintritt_cd: '', mitgliederbeitrag_cd: '440' })
    expect(cells[16]).toBe('VB Erwerbstätige') // echo
    expect(cells[17]).toBe('27.06.2026')       // fill
    expect(cells[18]).toBe('440')              // echo
  })

  it('ClubDesk empty + no wiedisync value → empty cells (a harmless no-op on import)', () => {
    const cells = cellsOf({ beitragskategorie: null, eintritt: null })
    expect(cells[16]).toBe('')
    expect(cells[17]).toBe('')
    expect(cells[18]).toBe('') // unknown/empty category is never guessed at
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
    expect(echoed[19]).toBe('812847') // NOT wiedisync's 846309
    expect(echoed[20]).toBe('RLL')    // NOT wiedisync's U 10
    const filled = cellsOf({ license_nr: '846309', licence_category: 'U 10' })
    expect(filled[19]).toBe('846309')
    expect(filled[20]).toBe('U 10')
    // Each cell independent — a register-set number never blocks an art fill.
    const mixed = cellsOf({ license_nr: '846309', licence_category: 'U 10', lizenznummer_cd: '812847' })
    expect(mixed[19]).toBe('812847')
    expect(mixed[20]).toBe('U 10')
    // Nothing anywhere → empty cells, never a guess.
    const empty = cellsOf({})
    expect(empty[19]).toBe('')
    expect(empty[20]).toBe('')
  })

  it("suppresses 'Offizielle/r' from Lizenzart — an officials licence is not a playing licence", () => {
    // Basketplan files pure officials under the category 'Offizielle/r', but
    // ClubDesk models that in its own Offiziellen Lizenz field (OTR/OTN
    // levels) — pushing it as Lizenzart would misfile the qualification.
    const cells = cellsOf({ license_nr: '759984', licence_category: 'Offizielle/r' })
    expect(cells[19]).toBe('759984') // the number still fills
    expect(cells[20]).toBe('')       // the art cell stays empty
    // A register-set Lizenzart still echoes through unchanged.
    expect(cellsOf({ licence_category: 'Offizielle/r', lizenzart_cd: 'RLL' })[20]).toBe('RLL')
    // Same rule on the CREATE set.
    const createRow = buildPushCsv([{ ...kacper, license_nr: '759984', licence_category: 'Offizielle/r' }], { create: true })
      .trim().split('\n')[1].split(';')
    expect(createRow[26]).toBe('759984')
    expect(createRow[27]).toBe('')
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
    expect(header).toBe('Vorname;Nachname;E-Mail;Telefon Privat;Adresse;PLZ;Ort;Geburtsdatum;Geschlecht;IBAN;Anrede;Nationalität;Federation of Origin;Trainer Lizenz;AHV Nummer;Wiedisync ID;Gast;Telefon Mobil;Beitragskategorie;Eintritt;Gruppen;Status;Offiziellen Lizenz;Mitgliederbeitrag;Sektion;Schiedsrichter;Lizenznummer;Lizenzart')
    expect(header).toBe(CD_PUSH_CREATE_HEADERS.join(';'))
    expect(header).not.toContain('[Id]')
    // header/cell count equality — catches a header/cells drift in either direction
    expect(row.split(';')).toHaveLength(header.split(';').length)
    const cells = row.split(';')
    expect(cells).toHaveLength(28)
    expect(cells[9]).toBe('CH9300762011623852957') // IBAN
    // [10..14] = Anrede/Nationalität/Federation of Origin/Trainer Lizenz/AHV Nummer (empty on this fixture); [15] = Wiedisync ID; [16] = Gast; create extras start at [17]
    expect(cells[17]).toBe('+41 79 000 00 00')      // Telefon Mobil = Privat
    expect(cells[18]).toBe('VB Erwerbstätige')       // Beitragskategorie
    expect(cells[19]).toBe('27.06.2026')             // Eintritt
    expect(cells[20]).toBe('VB H1 (Spieler*in)')     // Gruppen
    expect(cells[21]).toBe('Aktivmitglied')          // Status
    expect(cells[22]).toBe('VB SC')                  // Offiziellen Lizenz (scorer, not VB SR)
    expect(cells[23]).toBe('440')                    // Mitgliederbeitrag
    expect(cells[24]).toBe('Volleyball')             // Sektion
    expect(cells[25]).toBe('Ja')                     // Schiedsrichter (referee)
    expect(cells[26]).toBe('183931')                 // Lizenznummer (issuing authority)
    expect(cells[27]).toBe('RLL')                    // Lizenzart
  })

  it('Telefon Mobil mirrors Telefon Privat (one number → both)', () => {
    const cells = buildPushCsv([kacper], { create: true }).trim().split('\n')[1].split(';')
    expect(cells[3]).toBe(cells[17]) // Privat === Mobil
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
    for (const i of [9, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 21, 26, 27]) expect(cells[i]).toBe('')
  })

  it('neutralises formula injection in the category cell', () => {
    const row = buildPushCsv([{ ...kacper, beitragskategorie: '=SUM(A1)' }], { create: true })
      .trim().split('\n')[1]
    expect(row.split(';')[18]).toBe("'=SUM(A1)")
  })

  it('multi-team Gruppen stays one cell (comma is safe in semicolon CSV)', () => {
    const row = buildPushCsv([{ ...kacper, gruppen: 'VB H1 (Spieler*in), VB H2 (Spieler*in)' }], { create: true })
      .trim().split('\n')[1]
    const cells = row.split(';')
    expect(cells).toHaveLength(28)
    expect(cells[20]).toBe('VB H1 (Spieler*in), VB H2 (Spieler*in)')
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

  it('picks the HIGHEST rung when a member holds several — the single-value cell must not downgrade them', () => {
    // 43 members hold both OTR rungs on prod (an upgraded official keeps the
    // lower flag; Basketplan records both `*_since` dates). ClubDesk's picklist
    // holds one value, so choosing the lower one would report a qualified OTR2
    // as an OTR1 — which is what this order exists to prevent.
    expect(deriveOffiziellenLizenz({ otr1_bb: true, otr2_bb: true })).toBe('OTR2')
    expect(deriveOffiziellenLizenz({ otn1_bb: true, otn2_bb: true })).toBe('OTN2')
    // The coarse legacy flag never wins over a resolved level.
    expect(deriveOffiziellenLizenz({ otn_bb: true, otn2_bb: true })).toBe('OTN2')
    // A referee who is also a table official still reports the OTR rung, highest first.
    expect(deriveOffiziellenLizenz({ otr1_bb: true, otr2_bb: true, otn2_bb: true, otn_bb: true })).toBe('OTR2')
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

describe('trainerLicenceCell (members.trainer_licences → the ClubDesk cell)', () => {
  it('renders the club wording, not the stored codes', () => {
    expect(trainerLicenceCell('JS')).toBe('J+S')
    expect(trainerLicenceCell('JS,B')).toBe('J+S, B')
    expect(trainerLicenceCell('A')).toBe('A')
  })

  it('imposes canonical order so the cell is stable regardless of stored order', () => {
    expect(trainerLicenceCell('B,JS')).toBe('J+S, B')
    expect(trainerLicenceCell('A,B,C,JS')).toBe('J+S, C, B, A')
    expect(trainerLicenceCell('T2,JS')).toBe('J+S, Trainer 2')
  })

  it('spells the basketball rungs the way ClubDesk already holds them (migration 281)', () => {
    expect(trainerLicenceCell('T1')).toBe('Trainer 1')
    expect(trainerLicenceCell('T2')).toBe('Trainer 2')
    expect(trainerLicenceCell('T3')).toBe('Trainer 3')
    // The two ladders coexist in one cell and neither is rewritten as the other.
    expect(trainerLicenceCell('B,T2')).toBe('B, Trainer 2')
  })

  it('yields an empty cell for the empty states — the caller echo then protects the register', () => {
    expect(trainerLicenceCell(null)).toBe('')
    expect(trainerLicenceCell(undefined)).toBe('')
    expect(trainerLicenceCell('')).toBe('')
  })

  it('drops unknown codes rather than guessing a spelling ClubDesk never had', () => {
    expect(trainerLicenceCell('D')).toBe('')
    expect(trainerLicenceCell('JS,D')).toBe('J+S')
  })
})

describe('parseTrainerLicenceCell (the ClubDesk cell → codes, for down-sync + drift)', () => {
  it('round-trips everything trainerLicenceCell can emit', () => {
    for (const codes of ['JS', 'JS,C', 'JS,C,B,A', 'B', 'A', 'JS,B',
                         'T1', 'T2', 'T3', 'JS,T2', 'C,T2', 'JS,C,B,A,T1,T2,T3']) {
      expect(parseTrainerLicenceCell(trainerLicenceCell(codes))).toBe(codes)
    }
  })

  it('survives the hand-edited spellings a free-text column invites', () => {
    expect(parseTrainerLicenceCell('J+S, B')).toBe('JS,B')
    expect(parseTrainerLicenceCell('b, j+s')).toBe('JS,B')      // order normalized
    expect(parseTrainerLicenceCell('J+S / B')).toBe('JS,B')
    expect(parseTrainerLicenceCell('J + S')).toBe('JS')
    expect(parseTrainerLicenceCell('Jugend+Sport, Trainer A')).toBe('JS,A')
    expect(parseTrainerLicenceCell('Trainer B')).toBe('B')
    expect(parseTrainerLicenceCell('Stufe C')).toBe('C')
    expect(parseTrainerLicenceCell('JS;C')).toBe('JS,C')
  })

  it('reads the basketball rungs the register actually holds today (migration 281)', () => {
    // The three live values in ClubDesk on 2026-08-05.
    expect(parseTrainerLicenceCell('Trainer 1')).toBe('T1')
    expect(parseTrainerLicenceCell('Trainer 2+')).toBe('T2')   // '+' is shorthand, not a rung
    expect(parseTrainerLicenceCell('trainer 3')).toBe('T3')
    expect(parseTrainerLicenceCell('J+S/Trainer 2')).toBe('JS,T2')
    // Both ladders in one cell, each kept as itself.
    expect(parseTrainerLicenceCell('Trainer 1, B')).toBe('B,T1')
  })

  it('keeps the word "Trainer" ambiguous between the ladders — only a digit makes it a BB rung', () => {
    // The trap: 'Trainer' is on the skip list so 'Trainer B' yields B. Lifting
    // 'Trainer <digit>' must not break that, and a bare digit is not a rung.
    expect(parseTrainerLicenceCell('Trainer B')).toBe('B')
    expect(parseTrainerLicenceCell('Trainer C')).toBe('C')
    expect(parseTrainerLicenceCell('Trainer')).toBe('')
    expect(parseTrainerLicenceCell('2')).toBe('')
    expect(parseTrainerLicenceCell('Stufe 2')).toBe('')
    expect(parseTrainerLicenceCell('Trainer 4')).toBe('')
  })

  it('does not find rungs inside ordinary words — the false-positive that would forge a qualification', () => {
    expect(parseTrainerLicenceCell('Basketball Trainer')).toBe('')
    expect(parseTrainerLicenceCell('Ausbildung')).toBe('')
    expect(parseTrainerLicenceCell('keine')).toBe('')
  })

  it('returns empty for the empty states', () => {
    expect(parseTrainerLicenceCell(null)).toBe('')
    expect(parseTrainerLicenceCell('   ')).toBe('')
  })

  it('only ever emits values migration 281 CHECK accepts', () => {
    const dbCheck = /^(JS|C|B|A|T1|T2|T3)(,(JS|C|B|A|T1|T2|T3))*$/
    for (const cell of ['J+S, B', 'Trainer A', 'j+s/c/b/a', 'Stufe C', 'JS',
                        'Trainer 1', 'Trainer 2+', 'J+S, Trainer 3', 'Trainer 1, B']) {
      expect(parseTrainerLicenceCell(cell)).toMatch(dbCheck)
    }
  })
})

describe('trainerLicenceDisplay (admin email, reader language)', () => {
  it('never translates J+S — it is a federal programme name, not a description', () => {
    for (const loc of ['de', 'gsw', 'en', 'fr', 'it']) {
      expect(trainerLicenceDisplay('JS', loc)).toBe('J+S')
    }
  })

  it('translates the ladder rungs', () => {
    expect(trainerLicenceDisplay('JS,B', 'de')).toBe('J+S, Trainer B')
    expect(trainerLicenceDisplay('JS,B', 'fr')).toBe('J+S, Entraîneur B')
    expect(trainerLicenceDisplay('JS,B', 'it')).toBe('J+S, Allenatore B')
  })

  it('translates the basketball rungs too — the number stays, the noun localizes', () => {
    expect(trainerLicenceDisplay('T2', 'de')).toBe('Trainer 2')
    expect(trainerLicenceDisplay('T2', 'fr')).toBe('Entraîneur 2')
    expect(trainerLicenceDisplay('T2', 'it')).toBe('Allenatore 2')
    expect(trainerLicenceDisplay('JS,T1', 'en')).toBe('J+S, Trainer 1')
  })

  it('falls back to English for an unknown locale rather than printing raw codes', () => {
    expect(trainerLicenceDisplay('B', 'xx')).toBe('Trainer B')
  })
})

describe('parseTrainerLicenceCodes', () => {
  it('matches the frontend helper: canonical order, de-duplicated, unknowns dropped', () => {
    expect(parseTrainerLicenceCodes('a,b,c,js')).toEqual(['JS', 'C', 'B', 'A'])
    expect(parseTrainerLicenceCodes('C,C')).toEqual(['C'])
    expect(parseTrainerLicenceCodes('D')).toEqual([])
  })
})

describe('buildPushCsv — Trainer Lizenz column', () => {
  it('sends the rendered cell, and echoes ClubDesk own value when the member has not answered', () => {
    const csv = buildPushCsv([
      { id: 1, clubdesk_id: '100', trainer_licences: 'JS,B' },
      { id: 2, clubdesk_id: '101', trainer_licences: null, trainer_licences_cd: 'J+S, C' },
      { id: 3, clubdesk_id: '102', trainer_licences: null },
    ])
    const lines = csv.split('\n')
    const header = lines[0].split(';')
    const col = header.indexOf('Trainer Lizenz')
    expect(col).toBeGreaterThan(-1)
    expect(lines[1].split(';')[col]).toBe('J+S, B')
    // Echo: an unanswered member must never blank the register.
    expect(lines[2].split(';')[col]).toBe('J+S, C')
    // Nothing on either side → empty cell, which ClubDesk treats as a no-op.
    expect(lines[3].split(';')[col]).toBe('')
  })
})

// The native dues run bills from feeBreakdown, so the itemisation is not a
// display detail — `amount` is what a member is actually invoiced. The
// deriveMitgliederbeitrag suite above already pins the arithmetic; these pin
// the two things only the dues run relies on: the split, and baseOverride.
describe('feeBreakdown', () => {
  const adultNoLic = { scorer_vb: false, otr1_bb: false }

  it('itemises base and surcharge rather than just the total', () => {
    expect(feeBreakdown('VB Erwerbstätige', adultNoLic))
      .toEqual({ category: 'VB Erwerbstätige', base: 440, surcharge: 100, guest_discount: 0, amount: 540 })
    expect(feeBreakdown('VB Erwerbstätige', { scorer_vb: true }))
      .toEqual({ category: 'VB Erwerbstätige', base: 440, surcharge: 0, guest_discount: 0, amount: 440 })
  })

  it('agrees with deriveMitgliederbeitrag on every mapped category', () => {
    // One engine or two: this is the test that says which.
    for (const k of Object.keys(CD_BEITRAG_MAP)) {
      for (const m of [null, adultNoLic, { scorer_vb: true, birthdate: '2000-01-01' }]) {
        expect(String(feeBreakdown(k, m).amount)).toBe(deriveMitgliederbeitrag(k, m))
        expect(String(feeBreakdown(k, m, { isGuest: true }).amount))
          .toBe(deriveMitgliederbeitrag(k, m, { isGuest: true }))
      }
    }
  })

  it('a guest is discounted and never surcharged', () => {
    expect(feeBreakdown('VB Erwerbstätige', adultNoLic, { isGuest: true }))
      .toEqual({ category: 'VB Erwerbstätige', base: 440, surcharge: 0, guest_discount: 110, amount: 330 })
  })

  it('caps the guest discount at the base — no negative invoice', () => {
    // 'VB Turnier KWI' is 110: the discount takes it to exactly 0, not below.
    expect(feeBreakdown('VB Turnier KWI', null, { isGuest: true }))
      .toEqual({ category: 'VB Turnier KWI', base: 110, surcharge: 0, guest_discount: 110, amount: 0 })
    // 'Gratis' is 0: reporting a 110 discount off nothing would be a lie.
    expect(feeBreakdown('Gratis', null, { isGuest: true }))
      .toEqual({ category: 'Gratis', base: 0, surcharge: 0, guest_discount: 0, amount: 0 })
  })

  it('baseOverride replaces the base but keeps the surcharge rules', () => {
    // What a season rate change looks like: schedule says 460, duty still owed.
    expect(feeBreakdown('VB Erwerbstätige', adultNoLic, { baseOverride: 460 }))
      .toEqual({ category: 'VB Erwerbstätige', base: 460, surcharge: 100, guest_discount: 0, amount: 560 })
  })

  it('accepts a Postgres numeric override, which arrives as a string', () => {
    // knex/pg hands back `numeric` as '440.00'; a typeof check would drop it
    // and silently fall through to the hardcoded map.
    expect(feeBreakdown('VB Erwerbstätige', null, { baseOverride: '460.00' }).base).toBe(460)
  })

  it('bills an override for a category outside the map, unsurcharged', () => {
    // e.g. 'VB Schüler*in Meisterschaft mit Abzug' — the treasurer sets a rate,
    // and we do not invent a surcharge for a name the rules do not know.
    expect(feeBreakdown('VB Schüler*in Meisterschaft mit Abzug', adultNoLic, { baseOverride: 200 }))
      .toEqual({ category: 'VB Schüler*in Meisterschaft mit Abzug', base: 200, surcharge: 0, guest_discount: 0, amount: 200 })
  })

  it('returns null when there is no base — never a guessed amount', () => {
    expect(feeBreakdown('Sponsor')).toBeNull()
    expect(feeBreakdown(null)).toBeNull()
    expect(feeBreakdown('Sponsor', null, { baseOverride: '' })).toBeNull()
  })
})
