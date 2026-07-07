// ── Canonical contact-data formats (frontend mirror) ─────────────────────────
// MIRROR of directus/extensions/kscw-endpoints/src/normalize.js — keep the two
// byte-identical in behavior; the parity test (src/utils/__tests__/
// contact-normalize-parity.test.ts) runs both against one fixture table.
// Canonical shapes + the up/download rule: INFRA.md → "ClubDesk sync →
// Contact-data normalization rule". IBAN helpers stay in src/utils/iban.ts;
// normalizeIban here wraps the same mod-97 math into the { ok, value } shape.

export interface NormalizeResult {
  ok: boolean
  value: string | null
  reason?: 'unparseable' | 'bad_length' | 'format' | 'checksum' | 'excel_mangled'
}

/** Swiss mobile/landline + international phone → "+41 79 123 45 67" (CH) or
 *  compact E.164 "+436501234567" (foreign). See normalize.js for the rules. */
export function normalizePhone(raw: string | null | undefined): NormalizeResult {
  const s0 = String(raw ?? '').trim()
  if (!s0) return { ok: true, value: null }
  const s = s0.replace(/['’/.\-()]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/[^0-9+ ]/.test(s)) return { ok: false, value: s0, reason: 'unparseable' }
  const compact = s.replace(/ /g, '')
  const plusCount = (compact.match(/\+/g) || []).length
  if (plusCount > 1 || (plusCount === 1 && !compact.startsWith('+'))) {
    return { ok: false, value: s0, reason: 'unparseable' }
  }
  let cc: string
  if (compact.startsWith('+')) cc = compact.slice(1)
  else if (compact.startsWith('00')) cc = compact.slice(2)
  else if (compact.startsWith('0')) {
    const nat = compact.slice(1)
    if (nat.length !== 9) return { ok: false, value: s0, reason: 'bad_length' }
    cc = '41' + nat
  } else if (compact.length === 11 && compact.startsWith('41')) {
    cc = compact
  } else if (compact.length === 9) {
    cc = '41' + compact
  } else {
    return { ok: false, value: s0, reason: 'unparseable' }
  }
  if (!/^[1-9][0-9]{7,14}$/.test(cc)) return { ok: false, value: s0, reason: 'bad_length' }
  if (cc.startsWith('41')) {
    let nat = cc.slice(2)
    if (nat.length === 10 && nat.startsWith('0')) nat = nat.slice(1)
    if (nat.length !== 9 || nat.startsWith('0')) return { ok: false, value: s0, reason: 'bad_length' }
    return { ok: true, value: `+41 ${nat.slice(0, 2)} ${nat.slice(2, 5)} ${nat.slice(5, 7)} ${nat.slice(7, 9)}` }
  }
  return { ok: true, value: '+' + cc }
}

/** ISO 13616 IBAN → compact uppercase, mod-97 verified. */
export function normalizeIbanChecked(raw: string | null | undefined): NormalizeResult {
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

/** Swiss AHV/AVS number → "756.1234.5678.97" with EAN-13 check verified. */
export function normalizeAhv(raw: string | null | undefined): NormalizeResult {
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

/** Email → trimmed + lowercased, basic shape check. */
export function normalizeEmail(raw: string | null | undefined): NormalizeResult {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return { ok: true, value: null }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { ok: false, value: s, reason: 'format' }
  return { ok: true, value: s }
}
