/**
 * Unit + fixture tests for the camt.053/.054 parser (camt.js).
 *
 * Two jobs:
 *  1. Lock the parser's known-tricky paths with synthetic ISO-20022 fixtures
 *     (Sammelbuchung batching, SCOR refs, namespace prefixes, CRDT/booked
 *     filtering, entry-level amount fallback, Swiss apostrophe amounts).
 *  2. THE VALIDATION GATE — drop a real UBS export at
 *     src/__tests__/fixtures/real-ubs-camt054.xml and the last describe block
 *     un-skips and asserts the real file parses. That closes the long-standing
 *     "parser never validated against a real bank export" gap.
 *
 * Run:  npx vitest run directus/extensions/kscw-endpoints/src/__tests__/camt.test.js
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseCamt, invoiceIdFromScor, invoiceNumbersFromMessage } from '../camt.js'

// A native KSCW SCOR reference for invoice 539: RF + 2 check digits + zero-padded id.
const SCOR_539 = 'RF18000000000000000000539'

// ── camt.054 — single credit with a SCOR reference ──────────────────────────
const FIX_054_SCOR = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.04">
  <BkToCstmrDbtCdtNtfctn>
    <GrpHdr><MsgId>MSG-1</MsgId></GrpHdr>
    <Ntfctn>
      <Id>NTFCTN-1</Id>
      <Acct><Id><IBAN>CH6500270270N66152280</IBAN></Id></Acct>
      <Ntry>
        <Amt Ccy="CHF">150.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-06-19</Dt></BookgDt>
        <ValDt><Dt>2026-06-20</Dt></ValDt>
        <AcctSvcrRef>ENTRY-1</AcctSvcrRef>
        <NtryDtls>
          <TxDtls>
            <Refs><AcctSvcrRef>ACCTSVCR-1</AcctSvcrRef></Refs>
            <Amt Ccy="CHF">150.00</Amt>
            <RmtInf>
              <Ustrd>Rechnungsnummer: 539</Ustrd>
              <Strd>
                <CdtrRefInf>
                  <Tp><CdOrPrtry><Cd>SCOR</Cd></CdOrPrtry></Tp>
                  <Ref>${SCOR_539}</Ref>
                </CdtrRefInf>
              </Strd>
            </RmtInf>
            <RltdPties><Dbtr><Nm>Max Muster</Nm></Dbtr></RltdPties>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`

// ── camt.054 — one Sammelbuchung entry carrying two TxDtls ──────────────────
const FIX_054_BATCH = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.04">
  <BkToCstmrDbtCdtNtfctn>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="CHF">300.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts><Cd>BOOK</Cd></Sts>
        <ValDt><Dt>2026-06-21</Dt></ValDt>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>E2E-1</EndToEndId></Refs>
            <Amt Ccy="CHF">150.00</Amt>
            <RmtInf><Strd><CdtrRefInf><Ref>${SCOR_539}</Ref></CdtrRefInf></Strd></RmtInf>
            <RltdPties><Dbtr><Nm>Anna A</Nm></Dbtr></RltdPties>
          </TxDtls>
          <TxDtls>
            <Refs><EndToEndId>E2E-2</EndToEndId></Refs>
            <Amt Ccy="CHF">150.00</Amt>
            <RmtInf><Ustrd>Rechnungsnummer: 540</Ustrd></RmtInf>
            <RltdPties><Dbtr><Pty><Nm>Beat B</Nm></Pty></Dbtr></RltdPties>
          </TxDtls>
        </NtryDtls>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`

// ── camt.054 — debit + pending-credit must drop; one booked credit survives ─
const FIX_054_FILTERS = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.04">
  <BkToCstmrDbtCdtNtfctn>
    <Ntfctn>
      <Ntry>
        <Amt Ccy="CHF">99.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">50.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>PDNG</Sts>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">75.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <AcctSvcrRef>ENTRY-3</AcctSvcrRef>
      </Ntry>
    </Ntfctn>
  </BkToCstmrDbtCdtNtfctn>
</Document>`

// ── camt.053 — namespace-prefixed; Swiss apostrophe amount ──────────────────
const FIX_053_NS = `<?xml version="1.0" encoding="UTF-8"?>
<ns:Document xmlns:ns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">
  <ns:BkToCstmrStmt>
    <ns:Stmt>
      <ns:Ntry>
        <ns:Amt Ccy="CHF">1'234.50</ns:Amt>
        <ns:CdtDbtInd>CRDT</ns:CdtDbtInd>
        <ns:Sts>BOOK</ns:Sts>
        <ns:ValDt><ns:Dt>2026-05-31</ns:Dt></ns:ValDt>
      </ns:Ntry>
    </ns:Stmt>
  </ns:BkToCstmrStmt>
</ns:Document>`

describe('parseCamt — camt.054', () => {
  it('extracts a single SCOR credit with amount, currency, value date, debtor', () => {
    const { type, credits } = parseCamt(FIX_054_SCOR)
    expect(type).toBe('054')
    expect(credits).toHaveLength(1)
    const c = credits[0]
    expect(c.amount).toBe(150)
    expect(c.currency).toBe('CHF')
    expect(c.valueDate).toBe('2026-06-20') // ValDt preferred over BookgDt
    expect(c.reference).toBe(SCOR_539)
    expect(c.refType).toBe('SCOR')
    expect(c.unstructured).toBe('Rechnungsnummer: 539')
    expect(c.debtor).toBe('Max Muster')
    expect(c.uid).toBe('ACCTSVCR-1') // tx Refs.AcctSvcrRef wins
  })

  it('splits a Sammelbuchung entry into one credit per TxDtls', () => {
    const { credits } = parseCamt(FIX_054_BATCH)
    expect(credits).toHaveLength(2)
    expect(credits.map((c) => c.uid)).toEqual(['E2E-1', 'E2E-2'])
    expect(credits.map((c) => c.amount)).toEqual([150, 150])
    expect(credits[0].reference).toBe(SCOR_539)
    expect(credits[1].unstructured).toBe('Rechnungsnummer: 540')
    expect(credits[1].debtor).toBe('Beat B') // Dbtr.Pty.Nm variant
  })

  it('drops debit and non-booked entries; falls back to entry-level amount when TxDtls is absent', () => {
    const { credits } = parseCamt(FIX_054_FILTERS)
    expect(credits).toHaveLength(1)
    expect(credits[0].amount).toBe(75)
    expect(credits[0].reference).toBeNull()
    expect(credits[0].uid).toBe('ENTRY-3#0') // entryRef#index fallback
  })
})

describe('parseCamt — camt.053', () => {
  it('strips namespace prefixes and parses Swiss apostrophe amounts', () => {
    const { type, credits } = parseCamt(FIX_053_NS)
    expect(type).toBe('053')
    expect(credits).toHaveLength(1)
    expect(credits[0].amount).toBe(1234.5)
    expect(credits[0].currency).toBe('CHF')
    expect(credits[0].valueDate).toBe('2026-05-31')
  })
})

describe('parseCamt — rejects non-camt input', () => {
  it('throws without a <Document> root', () => {
    expect(() => parseCamt('<foo/>')).toThrow(/no <Document> root/)
  })
  it('throws on an unsupported camt flavour (e.g. camt.052)', () => {
    const camt052 = `<Document><BkToCstmrAcctRpt><Rpt/></BkToCstmrAcctRpt></Document>`
    expect(() => parseCamt(camt052)).toThrow(/Unsupported document/)
  })
})

describe('invoiceIdFromScor', () => {
  it('decodes the zero-padded invoice id after RF + 2 check digits', () => {
    expect(invoiceIdFromScor(SCOR_539)).toBe(539)
    expect(invoiceIdFromScor('RF71 0000 0123')).toBe(123) // spaces normalised away
  })
  it('returns null for QRR / non-SCOR / junk', () => {
    expect(invoiceIdFromScor('210000000003139471430009017')).toBeNull() // 27-digit QRR
    expect(invoiceIdFromScor('not-a-ref')).toBeNull()
    expect(invoiceIdFromScor(null)).toBeNull()
  })
})

describe('invoiceNumbersFromMessage', () => {
  it('pulls explicit native + Rechnungsnummer numbers first, bare numbers as fallback', () => {
    expect(invoiceNumbersFromMessage('Rechnungsnummer: 3089')).toContain('3089')
    expect(invoiceNumbersFromMessage('Zahlung N-2026-0042')).toContain('N-2026-0042')
    const mixed = invoiceNumbersFromMessage('Rechnung Nr. 540 / Mitgliederbeitrag')
    expect(mixed[0]).toBe('540')
  })
  it('returns an empty list for an empty/short message', () => {
    expect(invoiceNumbersFromMessage('')).toEqual([])
    expect(invoiceNumbersFromMessage(null)).toEqual([])
  })
})

// ── THE VALIDATION GATE ─────────────────────────────────────────────────────
// Drop a redacted real UBS export at src/__tests__/fixtures/real-ubs-camt054.xml
// (keep <Ntry> blocks intact; scrub balances / account numbers). This block
// then un-skips and proves the parser handles UBS's real nesting.
const REAL_FILE = fileURLToPath(new URL('./fixtures/real-ubs-camt054.xml', import.meta.url))
const hasReal = existsSync(REAL_FILE)

;(hasReal ? describe : describe.skip)('REAL UBS camt (fixtures/real-ubs-camt054.xml)', () => {
  it('parses with at least one credit and well-formed amounts', () => {
    const parsed = parseCamt(readFileSync(REAL_FILE, 'utf8'))
    expect(['053', '054']).toContain(parsed.type)
    expect(parsed.credits.length).toBeGreaterThan(0)
    for (const c of parsed.credits) {
      expect(c.amount === null || typeof c.amount === 'number').toBe(true)
      expect(c.currency === null || typeof c.currency === 'string').toBe(true)
    }
    // Eyeball during validation: how many credits carried a structured ref?
    const withRef = parsed.credits.filter((c) => c.reference).length
    console.log(`[real camt] type=${parsed.type} credits=${parsed.credits.length} withStructuredRef=${withRef}`)
  })
})
