/**
 * Swiss Basketball / FIBA licence-form pre-fill — field mappings and the text
 * guard they all run through.
 *
 * Ported from the browser copy in kscw-website `public/js/registration-form.js`,
 * which fills the same five forms from the *unsaved* inputs of the registration
 * page. That copy has to stay: it runs before a registration row exists, so it
 * has no id to fetch by. This one fills from a SAVED `registrations` row and is
 * the only filler for that job — it replaced the third copy that used to live in
 * kscw-website `src/pages/admin.astro`, which had already drifted (its Lizenzantrag
 * mapping was off by one, putting the email in the name box and the street in the
 * PLZ box).
 *
 * ⚠ Deliberately imports NOTHING — not even pdf-lib. The caller loads the PDF and
 * passes the `pdfDoc` in, so the same field mappings can run under Node here and
 * under the browser's UMD pdf-lib bundle there. Keep it that way; an import is
 * what would fork the two again.
 *
 * ⚠ The field names are the PDFs' own, read out of the shipped files, and several
 * are junk that Acrobat auto-generated ('undefined', 'undefined_2', 'Text1.0.0').
 * They are positional, NOT descriptive — see the Lizenzantrag comment. If Swiss
 * Basketball reissues a form, re-read the names; every setter no-ops silently on
 * an absent field, so a renamed box degrades to a blank the family fills by hand
 * rather than to an error.
 */

// Codepoints CP1252 carries beyond Latin-1 (Œ œ Š š Ÿ Ž ž ƒ ˆ ˜ – — ' ' ‚ " " „ † ‡ • … ‰ ‹ › € ™).
// ⚠ Must stay identical to CP1252_EXTRA in kscw-website's registration-form.js and
// to the ClubDesk name guard — the same person's name is written by all of them.
const CP1252_EXTRA = {
  338: 1, 339: 1, 352: 1, 353: 1, 376: 1, 381: 1, 382: 1, 402: 1, 710: 1, 732: 1,
  8211: 1, 8212: 1, 8216: 1, 8217: 1, 8218: 1, 8220: 1, 8221: 1, 8222: 1, 8224: 1,
  8225: 1, 8226: 1, 8230: 1, 8240: 1, 8249: 1, 8250: 1, 8364: 1, 8482: 1,
}

// Letters with no CP1252 slot AND no combining-mark decomposition — stripping
// accents gets nowhere, so they need naming. (ø/Ø are deliberately absent:
// CP1252 holds them at 0xF8/0xD8, so they never reach this table.)
const NON_DECOMPOSING = { 'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'ı': 'i', 'ħ': 'h', 'Ħ': 'H', 'ŧ': 't', 'Ŧ': 'T' }

/** True when Helvetica's WinAnsi encoding can represent `ch`. */
export function encodableInWinAnsi(ch) {
  const cp = ch.codePointAt(0)
  if (cp >= 0x20 && cp <= 0x7e) return true   // ASCII printable
  if (cp >= 0xa0 && cp <= 0xff) return true   // Latin-1 supplement (ä ö ü é à ç ß …)
  return !!CP1252_EXTRA[cp]                   // CP1252 additions (Œ Š Ž ƒ € …)
}

/**
 * Fold a name into something Helvetica can render, character by character, so
 * accents WinAnsi already covers (é ü ö à) survive verbatim and only the ones it
 * cannot (č ć ř ę ł đ ğ ő …) lose their diacritic.
 *
 * Not cosmetic: pdf-lib throws on an unencodable codepoint, and the throw lands in
 * save() — so it destroys the whole document rather than one field. One Croatian
 * name used to mean the applicant silently received a BLANK form.
 */
export function winAnsiSafe(value) {
  const str = String(value == null ? '' : value)
  let out = ''
  for (const ch of str) {
    if (encodableInWinAnsi(ch)) { out += ch; continue }
    if (NON_DECOMPOSING[ch]) { out += NON_DECOMPOSING[ch]; continue }
    let folded = ''
    try { folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '') } catch { folded = '' }
    for (const f of folded) if (encodableInWinAnsi(f)) out += f
  }
  return out
}

/** Today as DD.MM.YYYY. `now` is injectable so tests are not clock-dependent. */
export function todayDDMMYYYY(now = new Date()) {
  return `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`
}

/**
 * Current Swiss Basketball season as "YYYY/YYYY". Their administrative season
 * rolls over in July (2026-27 opened 23.07.2026) — the same July cut-off
 * bbAgeAtSeasonStart() uses — so a form generated in August already carries the
 * new season rather than the one that just ended.
 */
export function currentSeasonLabel(now = new Date()) {
  const start = (now.getMonth() + 1) >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return `${start}/${start + 1}`
}

/**
 * The blank form behind each `registrations` document column, and the filename the
 * family receives. Columns absent here (the two ID scans) are photographs of a
 * document the club does not issue — there is nothing to pre-fill.
 *
 * `file` is resolved against the public website, which is where these PDFs are
 * published and versioned; see fetchTemplate() in registration.js.
 */
export const BB_PDF_TEMPLATES = {
  bb_doc_lizenz: { file: 'lizenzantrag-swiss-basketball.pdf', filename: 'Lizenzantrag' },
  bb_doc_selfdecl: { file: 'player-self-declaration-fiba.pdf', filename: 'Player-Self-Declaration' },
  bb_doc_natdecl: { file: 'acknowledgment-national-team-restriction-fiba.pdf', filename: 'Acknowledgment-National-Team-Restriction' },
  bb_doc_freibrief: { file: 'freibrief-swiss-basketball.pdf', filename: 'Freibrief' },
  bb_doc_u18parents: { file: 'u18-parents-authorisation-fiba.pdf', filename: 'U18-Parents-Authorisation' },
}

/** Split a YYYY-MM-DD (or Date) into [DD, MM, YYYY]; [] when unparseable. */
function dobParts(dob) {
  if (!dob) return []
  let ymd
  if (dob instanceof Date) {
    if (Number.isNaN(dob.getTime())) return []
    // Local getters: pg parses a `date` to local midnight, and toISOString would
    // shift it a day back in a positive-offset zone like Europe/Zurich.
    ymd = `${dob.getFullYear()}-${String(dob.getMonth() + 1).padStart(2, '0')}-${String(dob.getDate()).padStart(2, '0')}`
  } else {
    ymd = String(dob).slice(0, 10)
  }
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? [m[3], m[2], m[1]] : []
}

/**
 * Write one text field. Absent or read-only is NORMAL — the five forms share no
 * schema and Swiss Basketball reissues them — so a missing box is a silent no-op
 * and the family fills it by hand. An *encoding* failure is different: it means
 * winAnsiSafe missed a codepoint, so it is surfaced to the caller's logger.
 */
function setField(form, name, value, ctx) {
  const safe = winAnsiSafe(value)
  if (!safe) return
  try {
    const field = form.getTextField(name)
    field.setText(safe)
    if (ctx.fontSize) field.setFontSize(ctx.fontSize)
    if (ctx.font) field.updateAppearances(ctx.font)
  } catch (err) {
    if (err && /encode/i.test(err.message || '')) {
      ctx.onEncodeError?.(name, err)
    }
  }
}

function check(form, name) {
  try { form.getCheckBox(name).check() } catch { /* absent on this revision */ }
}

const FILLERS = {
  // Swiss Basketball Lizenzantrag.
  // ⚠ The 'undefined_N' names are Acrobat's auto-numbering, mapping to the form's
  // rows top-to-bottom — verified against the field rectangles in the shipped PDF:
  // _2 = NAME, _3 = VORNAME, _4 = STRASSE, _5/_6 = the narrow PLZ and wide ORT
  // boxes, _7 = E-MAIL. They are positions, not names; the copy this file replaced
  // had the mapping shifted by one and wrote the email into the name box.
  bb_doc_lizenz(form, d, ctx) {
    setField(form, 'undefined', 'KSC Wiedikon', ctx)
    setField(form, 'undefined_2', d.nachname, ctx)
    setField(form, 'undefined_3', d.vorname, ctx)
    setField(form, 'undefined_4', d.adresse, ctx)
    setField(form, 'undefined_5', d.plz, ctx)
    setField(form, 'undefined_6', d.ort, ctx)
    setField(form, 'undefined_7', d.email, ctx)

    const [dd, mm, yyyy] = dobParts(d.geburtsdatum)
    if (yyyy) {
      setField(form, 'Tag', dd, ctx)
      setField(form, 'Monat', mm, ctx)
      setField(form, 'Jahr', yyyy, ctx)
    }

    if (d.geschlecht === 'männlich') check(form, 'Mann')
    else if (d.geschlecht === 'weiblich') check(form, 'Frau')

    // Holding a Swiss passport alongside another still ticks "Schweiz" — the form
    // asks whether the player is Swiss, not which passport is listed first.
    if ((d.nationalitaetCodes || []).includes('CH')) {
      check(form, 'Schweiz')
    } else if (d.nationalitaet) {
      check(form, 'Andere')
      setField(form, 'KOPIE DES PASSES ODER DER ID BEILAGEN', d.nationalitaet, ctx)
    }

    check(form, {
      neu: 'Neues Mitglied Swiss Basketball',
      transfer_ch: 'Klubtransfer',
      transfer_intl: 'Internationaler Transfer',
      rueckkehr: 'Internationaler Transfer',
    }[d.situation] || 'Neues Mitglied Swiss Basketball')

    const today = todayDDMMYYYY(ctx.now)
    setField(form, 'Datum', today, ctx)
    setField(form, 'Datum_2', today, ctx)
    setField(form, 'Datum_3', today, ctx)
  },

  // FIBA Player's Self Declaration.
  bb_doc_selfdecl(form, d, ctx) {
    setField(form, 'Last Name', d.nachname, ctx)
    setField(form, 'First Name', d.vorname, ctx)
    setField(form, 'Nationality', d.nationalitaet, ctx)
    setField(form, 'Current Club', 'KSC Wiedikon', ctx)
    setField(form, 'Season', currentSeasonLabel(ctx.now), ctx)
    const [dd, mm, yyyy] = dobParts(d.geburtsdatum)
    if (yyyy) {
      setField(form, 'Text1.0.0', dd, ctx)
      setField(form, 'Text1.0.1', mm, ctx)
      setField(form, 'Text1.1.1', yyyy, ctx)
    }
    setField(form, 'Text2', `${d.vorname} ${d.nachname}`.trim(), ctx)
    setField(form, 'Text3', todayDDMMYYYY(ctx.now), ctx)
  },

  // FIBA Acknowledgment of National Team Restriction. Replaced the former
  // "National Team Declaration", which FIBA stopped accepting for 2026-27
  // (Swiss Basketball licence mail, 22.07.2026).
  // The transfer-date box is deliberately left blank — Swiss Basketball / FIBA
  // set that date, not the club.
  bb_doc_natdecl(form, d, ctx) {
    const fullName = `${d.vorname} ${d.nachname}`.trim()
    setField(form, 'Player full name', fullName, ctx)
    setField(form, 'Nationality  nationalities', d.nationalitaet, ctx)
    setField(form, 'National Member Federation of origin', d.federationOfOrigin, ctx)
    setField(form, 'National Member Federation of destination', 'Swiss Basketball', ctx)
    const [dd, mm, yyyy] = dobParts(d.geburtsdatum)
    if (yyyy) setField(form, 'Date of birth DDMMYYYY', `${dd}/${mm}/${yyyy}`, ctx)
    // Signature block: the player's half. The parent / legal representative
    // fills their own by hand.
    setField(form, 'Name', fullName, ctx)
    setField(form, 'Date', todayDDMMYYYY(ctx.now), ctx)
  },

  // Swiss Basketball Freibrief / lettre de sortie. The release is signed by the
  // PREVIOUS club — only the player's identity is pre-filled, so they hand that
  // club a partly-completed form.
  bb_doc_freibrief(form, d, ctx) {
    setField(form, 'undefined', d.nachname, ctx)  // NOM / NAME
    // The first-name box carries an accented multi-language label, so it is looked
    // up by substring: a codepoint mismatch must not silently skip the field.
    // (Nationality is left blank on purpose — that box wants a 3-letter FIBA
    // country code the old club fills, not our full country name.)
    try {
      for (const f of form.getFields()) {
        const name = f.getName()
        if (/PR.NOM|VORNAME/i.test(name)) { setField(form, name, d.vorname, ctx); break }
      }
    } catch { /* getFields unavailable on a malformed form */ }
    const [dd, mm, yyyy] = dobParts(d.geburtsdatum)
    if (yyyy) setField(form, 'undefined_2', `${dd}.${mm}.${yyyy}`, ctx)  // DATE DE NAISSANCE
  },

  // FIBA U18 parental authorisation. Signed by the parent; the child's name and
  // the new club are pre-filled.
  bb_doc_u18parents(form, d, ctx) {
    setField(form, 'Surname First Name', `${d.nachname} ${d.vorname}`.trim(), ctx)
    setField(form, 'to new club', 'KSC Wiedikon', ctx)
  },
}

/**
 * Fill one licence form in place.
 *
 * @param field    a `registrations` document column (key of BB_PDF_TEMPLATES)
 * @param pdfDoc   a loaded pdf-lib PDFDocument — supplied by the caller so this
 *                 module never imports pdf-lib (see the file header)
 * @param data     { vorname, nachname, email, adresse, plz, ort, geburtsdatum,
 *                   nationalitaet, nationalitaetCodes[], geschlecht, situation,
 *                   federationOfOrigin }
 * @param ctx      { font, fontSize, now, onEncodeError }
 * @returns        true when a filler ran; false for a field with no template
 */
export function fillBbForm(field, pdfDoc, data, ctx = {}) {
  const filler = FILLERS[field]
  if (!filler) return false
  // One try/catch around the whole form, matching the browser copy: a half-filled
  // form the family completes by hand beats no form at all, so a mid-way failure
  // still yields a document.
  try {
    filler(pdfDoc.getForm(), data, ctx)
  } catch (err) {
    ctx.onEncodeError?.(field, err)
  }
  return true
}
