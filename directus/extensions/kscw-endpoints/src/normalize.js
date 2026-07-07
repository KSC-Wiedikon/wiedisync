// ── Canonical contact-data formats (wiedisync ⇄ ClubDesk) ────────────────────
// THE single spec both databases converge on. Every write path normalizes to
// these shapes; every sync direction repairs toward them (INFRA.md → "ClubDesk
// sync → Contact-data normalization rule"):
//
//   phone  CH      → "+41 79 123 45 67"  (2-3-2-2 grouping after the CC)
//   phone  foreign → "+436501234567"      (compact E.164, no grouping)
//   iban           → "CH9300762011623852957" (uppercase, no separators, mod-97 ok)
//   ahv            → "756.1234.5678.97"   (EAN-13 check digit verified)
//   email          → "someone@example.com" (trimmed, lowercased)
//
// Every function returns { ok, value, reason? }:
//   ok:true,  value:<canonical>  — parsed and normalized
//   ok:true,  value:null         — input empty (nothing to store)
//   ok:false, value:<raw trim>,  reason — NOT rewritable; caller decides
//             (registration → reject; sync fill → keep raw; backfill → report)
//
// MIRRORS — keep byte-identical behavior (parity test: src/utils/__tests__/
// contact-normalize-parity.test.ts runs BOTH against one fixture table):
//   • src/utils/contact.ts                  (frontend forms/profile)
//   • kscw_normalize_phone(text)            (SQL, migration 186 — down-sync fill
//                                            passes + members backfill)
//   • AHV SQL expression in import-clubdesk-csv.mjs (predates this module)

/** Swiss mobile/landline + international phone.
 *  Repairs: apostrophes (legacy CSV-guard corruption), ./-/() separators,
 *  00→+, missing +41 on 10-digit national, "(0)" after CC, bare 41… numbers.
 *  Rejects (ok:false): letters/Excel-notation, wrong digit counts, legacy
 *  9-digit pre-renumbering values (01 xxx xx xx — needs a human). */
export function normalizePhone(raw) {
  const s0 = String(raw ?? '').trim()
  if (!s0) return { ok: true, value: null }
  // Decorations → spaces. Apostrophes were injected by the old CSV formula
  // guard ("'+41 …", repaired on ClubDesk 2026-07-06); the rest are separators.
  const s = s0.replace(/['’/.\-()]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/[^0-9+ ]/.test(s)) return { ok: false, value: s0, reason: 'unparseable' }
  const compact = s.replace(/ /g, '')
  const plusCount = (compact.match(/\+/g) || []).length
  if (plusCount > 1 || (plusCount === 1 && !compact.startsWith('+'))) {
    return { ok: false, value: s0, reason: 'unparseable' }
  }
  let cc // digits including country code, no +
  if (compact.startsWith('+')) cc = compact.slice(1)
  else if (compact.startsWith('00')) cc = compact.slice(2)
  else if (compact.startsWith('0')) {
    const nat = compact.slice(1)
    // 10-digit Swiss national (079 …). 9-digit values are pre-2007 numbers
    // (01 451 60 38) — renumbered since, so flag instead of guessing.
    if (nat.length !== 9) return { ok: false, value: s0, reason: 'bad_length' }
    cc = '41' + nat
  } else if (compact.length === 11 && compact.startsWith('41')) {
    cc = compact // "41 76 334 99 61" — international without the +
  } else if (compact.length === 9) {
    cc = '41' + compact // "787986271" — Swiss national typed without the 0 (14 prod cases)
  } else {
    return { ok: false, value: s0, reason: 'unparseable' }
  }
  if (!/^[1-9][0-9]{7,14}$/.test(cc)) return { ok: false, value: s0, reason: 'bad_length' }
  if (cc.startsWith('41')) {
    let nat = cc.slice(2)
    if (nat.length === 10 && nat.startsWith('0')) nat = nat.slice(1) // "+41 (0)79 …"
    if (nat.length !== 9 || nat.startsWith('0')) return { ok: false, value: s0, reason: 'bad_length' }
    return { ok: true, value: `+41 ${nat.slice(0, 2)} ${nat.slice(2, 5)} ${nat.slice(5, 7)} ${nat.slice(7, 9)}` }
  }
  return { ok: true, value: '+' + cc }
}

/** ISO 13616 IBAN → compact uppercase; mod-97 verified (same math as
 *  src/utils/iban.ts / expense-upload.js isValidIban). */
export function normalizeIban(raw) {
  const s0 = String(raw ?? '').trim()
  if (!s0) return { ok: true, value: null }
  const iban = s0.replace(/[\s.'-]/g, '').toUpperCase()
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return { ok: false, value: s0, reason: 'format' }
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const val = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of val) remainder = (remainder * 10 + Number(d)) % 97
  }
  if (remainder !== 1) return { ok: false, value: s0, reason: 'checksum' }
  return { ok: true, value: iban }
}

/** Swiss AHV/AVS number → "756.1234.5678.97". Digits may arrive dot-mangled
 *  ("756.74468971.66", "7567859436260" — ClubDesk Zahl-format damage); an
 *  Excel-destroyed cell ("7.56E+12") has lost digits forever and is rejected.
 *  EAN-13 mod-10 over all 13 digits must be 0 — the SAME rule as the SQL
 *  intake in import-clubdesk-csv.mjs (audit #14: consistent on every path). */
export function normalizeAhv(raw) {
  const s0 = String(raw ?? '').trim()
  if (!s0) return { ok: true, value: null }
  if (/[eE][+-]?[0-9]/.test(s0)) return { ok: false, value: s0, reason: 'excel_mangled' }
  const d = s0.replace(/[^0-9]/g, '')
  if (!/^756[0-9]{10}$/.test(d)) return { ok: false, value: s0, reason: 'format' }
  let sum = 0
  for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3)
  if (sum % 10 !== 0) return { ok: false, value: s0, reason: 'checksum' }
  return { ok: true, value: `${d.slice(0, 3)}.${d.slice(3, 7)}.${d.slice(7, 11)}.${d.slice(11, 13)}` }
}

/** Email → trimmed + lowercased; single-@ shape with a 2+ char TLD. */
export function normalizeEmail(raw) {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return { ok: true, value: null }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { ok: false, value: s, reason: 'format' }
  return { ok: true, value: s }
}
