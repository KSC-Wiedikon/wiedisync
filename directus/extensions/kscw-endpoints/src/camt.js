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

/**
 * ISO 20022 lets a payer omit the end-to-end id, and banks then send a literal
 * placeholder — 'NOTPROVIDED' is the standard one. It is NOT an identifier.
 * Treating it as the transaction's uid gives every such credit the same value,
 * and finance-camt.js dedupes on that uid: the first placeholder payment imports
 * and every later one is silently counted as a duplicate and dropped. With a
 * membership run of ~570 invoices largely paid by e-banking, that is most of the
 * statement disappearing without an error.
 */
const PLACEHOLDER_REF = /^(?:notprovided|notavailable|unavailable|unknown|n\/?a|none|null|-+|0+)$/i
/** Trimmed reference text, or null when it is absent or a known placeholder. */
const realRef = (x) => {
  const s = txt(x)
  const t = s == null ? '' : s.trim()
  return t && !PLACEHOLDER_REF.test(t) ? t : null
}

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

/** A transaction's own amount node: <Amt>, else <AmtDtls><TxAmt><Amt> (ISO 20022
 *  allows either) — the first that holds a number. null when it states none. */
const txAmtNode = (tx) => [tx?.Amt, tx?.AmtDtls?.TxAmt?.Amt].find((n) => num(txt(n)) != null) ?? null

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
      // A batch is split only when EVERY payment states its own amount. Otherwise
      // the entry total is the only trustworthy figure: it comes back as one credit
      // (no reference, so it lands unmatched for the treasurer) — handing the total
      // to each payment booked 300 against a 100 invoice (fixed 14.10.2026). Some
      // banks omit TxDtls altogether — entry level too. Same rule as parseStatement.
      const split = txs.length > 1 && txs.every((tx) => txAmtNode(tx) != null)
      const list = split ? txs : txs.length === 1 ? txs : [null]
      list.forEach((tx, i) => {
        const amtNode = txAmtNode(tx) ?? ntry.Amt
        const { reference, refType } = tx ? structuredRef(tx) : { reference: null, refType: null }
        const ustrd = tx ? arr(tx?.RmtInf?.Ustrd).map(txt).filter(Boolean).join(' ').trim() : ''
        // Dedupe key, in descending order of how reliably unique it is:
        //   1. the bank's own per-transaction reference — guaranteed unique
        //   2. the entry reference plus this transaction's position within it —
        //      unique per statement, and present far more often than a
        //      payer-supplied end-to-end id
        //   3. payer-supplied ids, only when they are not placeholders
        // The old order put EndToEndId ahead of the entry reference, so a
        // statement full of 'NOTPROVIDED' collapsed to a single importable row.
        const uid =
          (tx && realRef(tx?.Refs?.AcctSvcrRef))
          || (entryRef ? `${entryRef}#${i}` : null)
          || (tx && (realRef(tx?.Refs?.EndToEndId) || realRef(tx?.Refs?.InstrId)))
          || null
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

/** Counterparty of one transaction: the debtor for money in, the creditor for money out. */
function counterparty(tx, credit) {
  const p = tx?.RltdPties
  const party = credit ? p?.Dbtr : p?.Cdtr
  const acct = credit ? p?.DbtrAcct : p?.CdtrAcct
  return {
    name: txt(party?.Nm) || txt(party?.Pty?.Nm) || null,
    iban: norm(txt(acct?.Id?.IBAN)),
  }
}

/** Signed balance of one <Bal> node (+ credit, − debit). */
function balanceOf(bal) {
  const amt = num(txt(bal?.Amt))
  if (amt == null) return null
  const sign = txt(bal?.CdtDbtInd) === 'DBIT' ? -1 : 1
  return { amount: Math.round(sign * amt * 100) / 100, date: txt(bal?.Dt?.Dt) || (txt(bal?.Dt?.DtTm) || '').slice(0, 10) || null }
}

/**
 * camt.053 account statement → every BOOKED entry, money in AND out — the input of
 * bookkeeping, unlike parseCamt (incoming payments only, for invoice matching).
 *
 * One line per transaction: a batch entry (Sammelbuchung) with several <TxDtls>
 * that each carry an amount is split, so each payment can meet its own invoice;
 * otherwise the entry is one line. `bankRef` is the line's stable identity across
 * re-imports: the bank's own transaction reference, else the entry reference (or
 * statement id + entry position) plus the transaction's position.
 *
 * The statement's opening and closing balances come back too: opening + the sum of
 * its lines must equal closing, which proves nothing was dropped.
 *
 * @returns {{ statements: Array<{ id: string|null, iban: string|null,
 *   opening: {amount:number,date:string|null}|null, closing: {amount:number,date:string|null}|null,
 *   lines: Array<{ bankRef: string, bookingDate: string|null, valueDate: string|null,
 *     amount: number, currency: string|null, counterpartyName: string|null,
 *     counterpartyIban: string|null, reference: string|null, remittance: string|null }> }> }}
 */
export function parseStatement(xml) {
  if (/<!DOCTYPE/i.test(String(xml ?? ''))) {
    throw new Error('Invalid camt file: DOCTYPE is not allowed')
  }
  const root = parser.parse(xml)?.Document
  if (!root) throw new Error('Not a camt file (no <Document> root)')
  if (!root.BkToCstmrStmt) throw new Error('Not an account statement — expected camt.053 (BkToCstmrStmt)')
  const statements = []
  arr(root.BkToCstmrStmt.Stmt).forEach((st, si) => {
    const id = txt(st?.Id) || txt(st?.ElctrncSeqNb) || null
    const iban = norm(txt(st?.Acct?.Id?.IBAN))
    let opening = null, closing = null
    for (const b of arr(st?.Bal)) {
      const code = (txt(b?.Tp?.CdOrPrtry?.Cd) || txt(b?.Tp?.CdOrPrtry?.Prtry) || '').toUpperCase()
      if ((code === 'OPBD' || code === 'PRCD') && !opening) opening = balanceOf(b)
      if (code === 'CLBD') closing = balanceOf(b)
    }
    const lines = []
    arr(st?.Ntry).forEach((ntry, ni) => {
      if (!isBooked(ntry)) return
      const credit = txt(ntry.CdtDbtInd) === 'CRDT'
      const sign = credit ? 1 : -1
      const bookingDate = txt(ntry?.BookgDt?.Dt) || (txt(ntry?.BookgDt?.DtTm) || '').slice(0, 10) || null
      const valueDate = txt(ntry?.ValDt?.Dt) || (txt(ntry?.ValDt?.DtTm) || '').slice(0, 10) || null
      const entryAmt = num(txt(ntry.Amt))
      const entryRef = realRef(ntry.AcctSvcrRef) || `${id || `stmt${si}`}:${ni}`
      const extraEntry = txt(ntry.AddtlNtryInf)
      const txs = arr(ntry?.NtryDtls?.TxDtls)
      const txAmount = (tx) => num(txt(txAmtNode(tx)))
      // Split only when every transaction states its own amount — otherwise the
      // entry total is the only trustworthy figure.
      const split = txs.length > 1 && txs.every((tx) => txAmount(tx) != null)
      const list = split ? txs : [txs[0] ?? null]
      list.forEach((tx, ti) => {
        const amount = split ? txAmount(tx) : entryAmt
        if (amount == null) return
        const { reference } = tx ? structuredRef(tx) : { reference: null }
        const cp = tx ? counterparty(tx, credit) : { name: null, iban: null }
        const remittance = [
          ...(tx ? arr(tx?.RmtInf?.Ustrd).map(txt) : []),
          tx ? txt(tx?.AddtlTxInf) : null,
          extraEntry,
        ].filter(Boolean).join(' · ').trim() || null
        lines.push({
          bankRef: (tx && realRef(tx?.Refs?.AcctSvcrRef)) || `${entryRef}#${ti}`,
          bookingDate,
          valueDate,
          amount: Math.round(sign * amount * 100) / 100,
          currency: (txAmtNode(tx) ?? ntry.Amt)?.['@_Ccy'] ?? null,
          counterpartyName: cp.name,
          counterpartyIban: cp.iban,
          reference,
          remittance,
        })
      })
    })
    statements.push({ id, iban, opening, closing, lines })
  })
  return { statements }
}
