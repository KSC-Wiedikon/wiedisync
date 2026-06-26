/**
 * camt.053 / camt.054 (ISO 20022) parser — pure, no DB, unit-testable.
 *
 * Extracts BOOKED CREDIT entries (incoming payments) with their structured
 * reference (QRR/SCOR), unstructured message, amount, value date and debtor —
 * the inputs the reconciliation engine matches against invoices.
 *
 * Handles: camt.053 (BkToCstmrStmt) and camt.054 (BkToCstmrDbtCdtNtfctn);
 * namespace prefixes (stripped); batched entries (one <Ntry> with many
 * <TxDtls> — a Swiss "Sammelbuchung"); single-vs-array nodes everywhere.
 *
 * NOTE: validated against the ISO 20022 schema shape; must be re-checked against
 * a real UBS export before trusting in prod (bank-specific nesting/ref placement).
 */
import { XMLParser } from 'fast-xml-parser'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,   // strip <ns:Ntry> → Ntry so navigation is prefix-agnostic
  parseTagValue: false,   // keep amounts/refs as strings (no float coercion)
  trimValues: true,
  processEntities: false, // no DTD/entity expansion — kills billion-laughs DoS
})

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
/** text of a node that may be a string or an object with attributes ({'#text': …}). */
const txt = (x) => {
  if (x == null) return null
  if (typeof x === 'object') return x['#text'] != null ? String(x['#text']) : null
  return String(x)
}
const num = (s) => {
  if (s == null) return null
  const n = Number(String(s).replace(/'/g, '').replace(/\s/g, ''))
  return Number.isFinite(n) ? n : null
}
const norm = (s) => (s == null ? null : String(s).replace(/\s+/g, '').toUpperCase() || null)

/** Status is BOOK either as a bare string or {Cd:'BOOK'}. Accept when absent. */
function isBooked(ntry) {
  const s = ntry?.Sts
  if (s == null) return true
  const code = typeof s === 'object' ? (txt(s.Cd) ?? txt(s)) : String(s)
  return !code || code.toUpperCase().includes('BOOK')
}

/** Debtor name across camt.053/.054 variants (Dbtr.Nm or Dbtr.Pty.Nm). */
function debtorName(tx) {
  const d = tx?.RltdPties?.Dbtr
  return txt(d?.Nm) || txt(d?.Pty?.Nm) || null
}

/** Structured creditor reference (QRR/SCOR) from one TxDtls (Strd may repeat). */
function structuredRef(tx) {
  for (const s of arr(tx?.RmtInf?.Strd)) {
    const ref = txt(s?.CdtrRefInf?.Ref)
    if (ref) {
      const tp = s?.CdtrRefInf?.Tp?.CdOrPrtry
      return { reference: norm(ref), refType: txt(tp?.Prtry) || txt(tp?.Cd) || null }
    }
  }
  return { reference: null, refType: null }
}

/**
 * @returns {{type:'053'|'054', credits: Array<{
 *   uid:string|null, amount:number|null, currency:string|null, valueDate:string|null,
 *   reference:string|null, refType:string|null, unstructured:string|null, debtor:string|null
 * }>}}
 */
export function parseCamt(xml) {
  // A legitimate ISO 20022 camt file never declares a DOCTYPE. Reject any input
  // carrying one so a crafted DTD (entity-expansion / billion-laughs) can't be
  // smuggled in — belt-and-suspenders with processEntities:false above.
  if (/<!DOCTYPE/i.test(String(xml ?? ''))) {
    throw new Error('Invalid camt file: DOCTYPE is not allowed')
  }
  const doc = parser.parse(xml)
  const root = doc?.Document
  if (!root) throw new Error('Not a camt file (no <Document> root)')

  let type, containers
  if (root.BkToCstmrDbtCdtNtfctn) { type = '054'; containers = arr(root.BkToCstmrDbtCdtNtfctn.Ntfctn) }
  else if (root.BkToCstmrStmt) { type = '053'; containers = arr(root.BkToCstmrStmt.Stmt) }
  else throw new Error('Unsupported document — expected camt.053 or camt.054')

  const credits = []
  for (const c of containers) {
    for (const ntry of arr(c.Ntry)) {
      if (txt(ntry.CdtDbtInd) !== 'CRDT') continue   // incoming payments only
      if (!isBooked(ntry)) continue
      const valueDate = txt(ntry?.ValDt?.Dt) || txt(ntry?.BookgDt?.Dt) || null
      const entryRef = txt(ntry.AcctSvcrRef)
      const txs = arr(ntry?.NtryDtls?.TxDtls)
      const list = txs.length ? txs : [null]   // some banks omit TxDtls — use entry level
      list.forEach((tx, i) => {
        const amtNode = tx?.Amt ?? ntry.Amt
        const { reference, refType } = tx ? structuredRef(tx) : { reference: null, refType: null }
        const ustrd = tx ? arr(tx?.RmtInf?.Ustrd).map(txt).filter(Boolean).join(' ').trim() : ''
        const uid =
          (tx && (txt(tx?.Refs?.AcctSvcrRef) || txt(tx?.Refs?.EndToEndId) || txt(tx?.Refs?.InstrId))) ||
          (entryRef ? `${entryRef}#${i}` : null)
        credits.push({
          uid,
          amount: num(txt(amtNode)),
          currency: amtNode?.['@_Ccy'] ?? null,
          valueDate,
          reference,
          refType,
          unstructured: ustrd || null,
          debtor: tx ? debtorName(tx) : null,
        })
      })
    }
  }
  return { type, credits }
}

/** Decode a native SCOR reference (RF + 2 check + numeric invoice id) → invoice id, or null. */
export function invoiceIdFromScor(reference) {
  const r = norm(reference)
  if (!r || !/^RF\d{2}\d+$/.test(r)) return null
  return Number(r.slice(4))
}

/**
 * Candidate invoice NUMBERS carried in the unstructured message ("Mitteilung") —
 * how ClubDesk itself reconciles ("Rechnungsnummer: 3089"). Returns explicit
 * matches first (native N-YYYY-NNNN, "Rechnung(snummer) 3089"), then bare numbers
 * as a fallback — callers validate against real finance_invoices.number (+ amount).
 */
export function invoiceNumbersFromMessage(msg) {
  if (!msg) return []
  const s = String(msg)
  const explicit = [], bare = []
  for (const m of s.matchAll(/\bN-\d{4}-\d{3,}\b/gi)) explicit.push(m[0].toUpperCase())
  for (const m of s.matchAll(/rechnung(?:s)?(?:[-\s]*nummer|[-\s]*nr\.?)?[:\s#]*([0-9]{2,})/gi)) explicit.push(m[1])
  for (const m of s.matchAll(/\b(\d{3,8})\b/g)) bare.push(m[1])
  return [...new Set([...explicit, ...bare])]
}
