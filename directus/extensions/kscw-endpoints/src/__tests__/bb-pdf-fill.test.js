/**
 * Unit tests for bb-pdf-fill.js — the Swiss Basketball / FIBA licence-form field
 * mappings and their text guard.
 *
 * Hermetic: no pdf-lib, no network, no DB. `fillBbForm` takes the PDFDocument from
 * its caller precisely so it can be driven by a recorder here, which is also what
 * lets these tests assert the ONE thing a PDF diff cannot show you cheaply — which
 * value landed in which box.
 *
 * That mapping is the part that has actually broken before: the copy this module
 * replaced had the Lizenzantrag's positional 'undefined_N' fields shifted by one,
 * so the applicant's email was written into the NAME box and their street into the
 * PLZ box, on a form that goes to the national federation.
 */
import { describe, it, expect } from 'vitest'
import {
  winAnsiSafe, encodableInWinAnsi, fillBbForm, BB_PDF_TEMPLATES,
  currentSeasonLabel, todayDDMMYYYY,
} from '../bb-pdf-fill.js'

/** Minimal stand-in for a pdf-lib PDFDocument: records what was written where. */
function recorder(fieldNames = []) {
  const text = {}
  const checked = []
  const form = {
    getTextField(name) {
      return {
        setText: (v) => { text[name] = v },
        setFontSize: () => {},
        updateAppearances: () => {},
      }
    },
    getCheckBox(name) {
      return { check: () => checked.push(name) }
    },
    getFields: () => fieldNames.map((n) => ({ getName: () => n })),
  }
  return { pdfDoc: { getForm: () => form }, text, checked }
}

const APPLICANT = {
  vorname: 'Caspar Liva',
  nachname: 'Jung',
  email: 'lalainaj@web.de',
  adresse: 'Aemtlerstr 102',
  plz: '8003',
  ort: 'Zürich',
  geburtsdatum: '2013-10-31',
  nationalitaet: 'Deutschland',
  nationalitaetCodes: ['DE'],
  geschlecht: 'männlich',
  situation: '',
  federationOfOrigin: '',
}

const NOW = new Date(2026, 7, 13) // 13.08.2026 — fixed so nothing here is clock-dependent

describe('winAnsiSafe (licence-PDF text guard)', () => {
  it('keeps the accents WinAnsi already covers, verbatim', () => {
    for (const s of ['Müller', 'Étienne', 'Zoë', 'Zürich', 'François', 'Straße', 'Ægir', 'Øst']) {
      expect(winAnsiSafe(s), `${s} should survive unchanged`).toBe(s)
    }
  })

  it('keeps the CP1252-only letters that appear in Balkan names', () => {
    expect(winAnsiSafe('Šimun')).toBe('Šimun')
    expect(winAnsiSafe('Žarko')).toBe('Žarko')
  })

  it('folds the diacritics WinAnsi cannot encode', () => {
    expect(winAnsiSafe('Šarčević')).toBe('Šarcevic')
    expect(winAnsiSafe('Dvořák')).toBe('Dvorák')
    expect(winAnsiSafe('Győző')).toBe('Gyozo')
    expect(winAnsiSafe('Çağrı')).toBe('Çagri')
  })

  it('maps stroked/barred letters that NFD does not decompose', () => {
    expect(winAnsiSafe('Łąkowa')).toBe('Lakowa')
    expect(winAnsiSafe('Đoković')).toBe('Dokovic')
  })

  it('survives null/undefined rather than writing "null" onto a federation form', () => {
    expect(winAnsiSafe(null)).toBe('')
    expect(winAnsiSafe(undefined)).toBe('')
  })

  it('drops characters with no Latin fallback at all instead of throwing', () => {
    // pdf-lib would throw on these in save(), destroying the whole document.
    expect(winAnsiSafe('李雷')).toBe('')
    expect(() => winAnsiSafe('🏀')).not.toThrow()
  })

  it('agrees with encodableInWinAnsi on the boundary codepoints', () => {
    expect(encodableInWinAnsi(' ')).toBe(true)     // 0x20
    expect(encodableInWinAnsi('ÿ')).toBe(true)     // 0xff
    expect(encodableInWinAnsi('€')).toBe(true)     // CP1252 extra
    expect(encodableInWinAnsi('č')).toBe(false)
  })
})

describe('BB_PDF_TEMPLATES', () => {
  it('covers the five club-issued forms and neither ID scan', () => {
    expect(Object.keys(BB_PDF_TEMPLATES).sort()).toEqual([
      'bb_doc_freibrief', 'bb_doc_lizenz', 'bb_doc_natdecl',
      'bb_doc_selfdecl', 'bb_doc_u18parents',
    ])
    // A passport photo has nothing to pre-fill; offering a "template" for it
    // would put a broken link in front of every family.
    expect(BB_PDF_TEMPLATES.id_upload_front).toBeUndefined()
    expect(BB_PDF_TEMPLATES.id_upload_back).toBeUndefined()
  })

  it('names a real .pdf and a distinguishable download name for each', () => {
    for (const [key, tpl] of Object.entries(BB_PDF_TEMPLATES)) {
      expect(tpl.file, key).toMatch(/^[a-z0-9-]+\.pdf$/)
      expect(tpl.filename, key).toMatch(/^[A-Za-z0-9-]+$/)
    }
  })
})

describe('fillBbForm — Lizenzantrag positional mapping', () => {
  it("writes each value into the box that field number actually is", () => {
    const { pdfDoc, text } = recorder()
    fillBbForm('bb_doc_lizenz', pdfDoc, APPLICANT, { now: NOW })

    // The regression that motivated this module: these are POSITIONS, and being
    // off by one silently swaps identity fields on a federation document.
    expect(text.undefined).toBe('KSC Wiedikon')
    expect(text.undefined_2).toBe('Jung')            // NAME
    expect(text.undefined_3).toBe('Caspar Liva')     // VORNAME
    expect(text.undefined_4).toBe('Aemtlerstr 102')  // STRASSE
    expect(text.undefined_5).toBe('8003')            // PLZ
    expect(text.undefined_6).toBe('Zürich')          // ORT
    expect(text.undefined_7).toBe('lalainaj@web.de') // E-MAIL
  })

  it('splits the birthdate across the day/month/year boxes', () => {
    const { pdfDoc, text } = recorder()
    fillBbForm('bb_doc_lizenz', pdfDoc, APPLICANT, { now: NOW })
    expect(text.Tag).toBe('31')
    expect(text.Monat).toBe('10')
    expect(text.Jahr).toBe('2013')
  })

  it('accepts a JS Date for the birthdate — pg `date` columns read via raw knex', () => {
    // String(date).slice(0,10) would be "Thu Jan 15"; a UTC conversion would shift
    // the day back in Europe/Zurich. Both were live bugs in sibling code.
    const { pdfDoc, text } = recorder()
    fillBbForm('bb_doc_lizenz', pdfDoc, { ...APPLICANT, geburtsdatum: new Date(2013, 9, 31) }, { now: NOW })
    expect(text.Tag).toBe('31')
    expect(text.Monat).toBe('10')
    expect(text.Jahr).toBe('2013')
  })

  it('ticks the sex box and defaults a situation-less row to new member', () => {
    const { pdfDoc, checked } = recorder()
    fillBbForm('bb_doc_lizenz', pdfDoc, APPLICANT, { now: NOW })
    expect(checked).toContain('Mann')
    // Legacy rows predate the situation question; the licence still has to say
    // something, and "new member" is the only safe default.
    expect(checked).toContain('Neues Mitglied Swiss Basketball')
  })

  it('ticks Schweiz for a dual national holding a Swiss passport', () => {
    // The form asks whether the player is Swiss, not which passport is listed
    // first — same "Swiss beats foreign" rule the document gate applies.
    const { pdfDoc, checked, text } = recorder()
    fillBbForm('bb_doc_lizenz', pdfDoc, { ...APPLICANT, nationalitaetCodes: ['IT', 'CH'] }, { now: NOW })
    expect(checked).toContain('Schweiz')
    expect(checked).not.toContain('Andere')
    expect(text['KOPIE DES PASSES ODER DER ID BEILAGEN']).toBeUndefined()
  })

  it('ticks Andere and names the country for a foreign national', () => {
    const { pdfDoc, checked, text } = recorder()
    fillBbForm('bb_doc_lizenz', pdfDoc, APPLICANT, { now: NOW })
    expect(checked).toContain('Andere')
    expect(text['KOPIE DES PASSES ODER DER ID BEILAGEN']).toBe('Deutschland')
  })

  it('maps a returning player onto the international-transfer box', () => {
    const { pdfDoc, checked } = recorder()
    fillBbForm('bb_doc_lizenz', pdfDoc, { ...APPLICANT, situation: 'rueckkehr' }, { now: NOW })
    expect(checked).toContain('Internationaler Transfer')
  })
})

describe('fillBbForm — the FIBA forms', () => {
  it('fills the Self Declaration, with the season in Swiss Basketball form', () => {
    const { pdfDoc, text } = recorder()
    fillBbForm('bb_doc_selfdecl', pdfDoc, APPLICANT, { now: NOW })
    expect(text['Last Name']).toBe('Jung')
    expect(text['First Name']).toBe('Caspar Liva')
    expect(text['Current Club']).toBe('KSC Wiedikon')
    expect(text.Season).toBe('2026/2027')
    expect(text.Text2).toBe('Caspar Liva Jung')
  })

  it('fills the Acknowledgment and leaves the transfer date to FIBA', () => {
    const { pdfDoc, text } = recorder()
    fillBbForm('bb_doc_natdecl', pdfDoc, { ...APPLICANT, federationOfOrigin: 'DBB (Germany)' }, { now: NOW })
    expect(text['Player full name']).toBe('Caspar Liva Jung')
    expect(text['Date of birth DDMMYYYY']).toBe('31/10/2013')
    expect(text['National Member Federation of origin']).toBe('DBB (Germany)')
    expect(text['National Member Federation of destination']).toBe('Swiss Basketball')
  })

  it('leaves the origin federation blank rather than inventing one', () => {
    // Empty means the applicant never answered — asserting a federation on a
    // FIBA eligibility document is worse than a box they complete by hand.
    const { pdfDoc, text } = recorder()
    fillBbForm('bb_doc_natdecl', pdfDoc, APPLICANT, { now: NOW })
    expect(text['National Member Federation of origin']).toBeUndefined()
  })

  it('fills only the child and the new club on the U18 authorisation', () => {
    const { pdfDoc, text } = recorder()
    fillBbForm('bb_doc_u18parents', pdfDoc, APPLICANT, { now: NOW })
    expect(text['Surname First Name']).toBe('Jung Caspar Liva')
    expect(text['to new club']).toBe('KSC Wiedikon')
  })

  it('finds the Freibrief first-name box through its accented label', () => {
    // The real form labels it "PRÉNOM / VORNAME"; matching by substring keeps a
    // codepoint mismatch from silently skipping the field.
    const { pdfDoc, text } = recorder(['undefined', 'PRÉNOM / VORNAME', 'undefined_2'])
    fillBbForm('bb_doc_freibrief', pdfDoc, APPLICANT, { now: NOW })
    expect(text.undefined).toBe('Jung')
    expect(text['PRÉNOM / VORNAME']).toBe('Caspar Liva')
    expect(text.undefined_2).toBe('31.10.2013')
  })
})

describe('fillBbForm — contract', () => {
  it('returns false for a document with no form, without touching the doc', () => {
    const { pdfDoc } = recorder()
    expect(fillBbForm('id_upload_front', pdfDoc, APPLICANT, { now: NOW })).toBe(false)
    expect(fillBbForm('bb_doc_schoolcert', pdfDoc, APPLICANT, { now: NOW })).toBe(false)
  })

  it('still returns a usable document when a box is missing from the form', () => {
    // Swiss Basketball reissues these; an absent field must degrade to a blank
    // the family fills in, never to a failed download.
    const { pdfDoc, text } = recorder()
    pdfDoc.getForm().getTextField = (name) => {
      if (name === 'undefined_4') throw new Error('no such field')
      return { setText: (v) => { text[name] = v }, setFontSize: () => {}, updateAppearances: () => {} }
    }
    expect(() => fillBbForm('bb_doc_lizenz', pdfDoc, APPLICANT, { now: NOW })).not.toThrow()
    expect(text.undefined_2).toBe('Jung')
    expect(text.undefined_4).toBeUndefined()
  })

  it('reports an encoding failure instead of swallowing it', () => {
    // An encode error means winAnsiSafe missed a codepoint — the one failure here
    // that is a bug in this module rather than a form revision.
    const seen = []
    const { pdfDoc, text } = recorder()
    pdfDoc.getForm().getTextField = (name) => ({
      setText: (v) => {
        if (name === 'undefined_2') throw new Error('WinAnsi cannot encode "Ā"')
        text[name] = v
      },
      setFontSize: () => {}, updateAppearances: () => {},
    })
    fillBbForm('bb_doc_lizenz', pdfDoc, APPLICANT, { now: NOW, onEncodeError: (n) => seen.push(n) })
    expect(seen).toContain('undefined_2')
  })
})

describe('date helpers', () => {
  it('rolls the season over in July, matching Swiss Basketball', () => {
    expect(currentSeasonLabel(new Date(2026, 6, 1))).toBe('2026/2027')  // 01.07
    expect(currentSeasonLabel(new Date(2026, 5, 30))).toBe('2025/2026') // 30.06
  })

  it('formats today the Swiss way', () => {
    expect(todayDDMMYYYY(new Date(2026, 7, 3))).toBe('03.08.2026')
  })
})
