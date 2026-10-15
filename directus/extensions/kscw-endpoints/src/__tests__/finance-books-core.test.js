import { describe, it, expect } from 'vitest'
import {
  ruleMatches, firstMatchingRule, bankLineText, bankPostingLegs, proposeForLine, statementBalanceCheck,
  compareBooks, monthsOfYear, monthEnd, monthlyComparison, openingLegsFromClubdesk, openingEntries,
  needsReceipt, evaluateReadiness,
} from '../finance-books-core.js'
import { parseStatement } from '../camt.js'
import { buildZip, crc32 } from '../zip-store.js'
import { financeAccessFor } from '../finance-access.js'

const line = (o = {}) => ({ amount: 100, counterparty_name: 'Stadt Zürich Finanzverwaltung', counterparty_iban: 'CH93 0076 2011 6238 5295 7', remittance: 'J+S Beitrag VB', reference: null, booking_date: '2026-06-23', ...o })

describe('bank rules', () => {
  it('requires every condition the rule sets', () => {
    const r = { id: 1, active: true, direction: 'in', match_name: 'stadt zürich', match_text: 'j+s' }
    expect(ruleMatches(r, line())).toBe(true)
    expect(ruleMatches(r, line({ remittance: 'Hallenmiete' }))).toBe(false)
    expect(ruleMatches(r, line({ amount: -100 }))).toBe(false) // direction
  })
  it('matches an IBAN ignoring spaces and case', () => {
    expect(ruleMatches({ id: 1, active: true, direction: 'any', match_iban: 'ch9300762011623852957' }, line())).toBe(true)
  })
  it('never matches a rule without a condition, or an inactive rule', () => {
    expect(ruleMatches({ id: 1, active: true, direction: 'any' }, line())).toBe(false)
    expect(ruleMatches({ id: 1, active: false, direction: 'any', match_name: 'stadt' }, line())).toBe(false)
  })
  it('takes the lowest priority first', () => {
    const rules = [{ id: 1, priority: 50, active: true, direction: 'any', match_name: 'stadt', account: 10 },
      { id: 2, priority: 10, active: true, direction: 'any', match_text: 'j+s', account: 20 }]
    expect(firstMatchingRule(rules, line()).id).toBe(2)
  })
  it('builds the booking text from a template', () => {
    expect(bankLineText(line(), '{name}: {text} ({date})')).toBe('Stadt Zürich Finanzverwaltung: J+S Beitrag VB (2026-06-23)')
    expect(bankLineText(line())).toBe('Stadt Zürich Finanzverwaltung · J+S Beitrag VB')
  })
  it('books money in as Bank / account and money out as account / Bank', () => {
    expect(bankPostingLegs(line({ amount: 250 }), 1, 9)).toEqual({ debit: 1, credit: 9, amount: 250 })
    expect(bankPostingLegs(line({ amount: -15.5 }), 1, 9)).toEqual({ debit: 9, credit: 1, amount: 15.5 })
  })
})

describe('proposals', () => {
  const invoice = { number: '3089', subject: 'Mitgliederbeitrag Basketball 2026/2027', recipient_name: 'Muster Anna', fee_category: 'BB Erwerbstätige', source: 'clubdesk' }
  const ctx = { rules: [{ id: 7, active: true, direction: 'any', match_name: 'stadt', account: 55, text_template: null }], incomeAccountFor: () => 33, arAccountId: 11, autopost: false }
  it('books a matched ClubDesk invoice to its income account (cash basis)', () => {
    expect(proposeForLine(line({ amount: 310 }), { ...ctx, invoice })).toMatchObject({ account: 33, by: 'invoice:3089', invoiceNumber: '3089' })
  })
  it('books a native invoice to Debitoren while auto-posting is on', () => {
    expect(proposeForLine(line({ amount: 310 }), { ...ctx, invoice: { ...invoice, source: 'native' }, autopost: true }).account).toBe(11)
  })
  it('falls back to a rule, then to nothing', () => {
    expect(proposeForLine(line(), { ...ctx, invoice: null })).toMatchObject({ account: 55, by: 'rule:7' })
    expect(proposeForLine(line({ counterparty_name: 'Migros' }), { ...ctx, invoice: null })).toBeNull()
  })
  it('never matches an invoice to money going out', () => {
    expect(proposeForLine(line({ amount: -310, counterparty_name: 'Migros' }), { ...ctx, invoice })).toBeNull()
  })
})

describe('comparing the books', () => {
  const accounts = [
    { id: 1, number: '1000', name: 'Bank', type: 'asset' },
    { id: 2, number: '3300', name: 'Aktivmitglieder', type: 'income' },
    { id: 3, number: '4120', name: 'Admin und EDV', type: 'expense' },
  ]
  const cd = [
    { debit_account: 1, credit_account: null, amount_chf: 1000, booking_date: '2026-06-01' }, // ClubDesk opening, one side
    { debit_account: 1, credit_account: 2, amount_chf: 310, booking_date: '2026-06-18' },
    { debit_account: 3, credit_account: 1, amount_chf: 15, booking_date: '2026-07-03' },
  ]
  const nv = [
    { debit_account: 1, credit_account: 9, amount_chf: 1000, booking_date: '2026-06-01' },
    { debit_account: 1, credit_account: 2, amount_chf: 310, booking_date: '2026-06-18' },
  ]
  it('reports per-account differences up to a date', () => {
    const june = compareBooks({ clubdesk: cd, native: nv, accounts, throughISO: '2026-06-30', ignore: [9] })
    expect(june.accountsDifferent).toBe(0)
    const july = compareBooks({ clubdesk: cd, native: nv, accounts, throughISO: '2026-07-31', ignore: [9] })
    expect(july.accountsDifferent).toBe(2) // Bank and 4120
    expect(july.rows.find((r) => r.number === '4120')).toMatchObject({ clubdesk: 15, native: 0, diff: -15 })
    expect(july.differenceTotal).toBe(30)
  })
  it('walks the fiscal year month by month', () => {
    expect(monthsOfYear('2026-06-01', '2027-05-31', '2026-08-15')).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(monthsOfYear('2026-06-01', '2027-05-31', '2028-01-01')).toHaveLength(12)
    expect(monthEnd('2027-02-10')).toBe('2027-02-28')
    const m = monthlyComparison({ clubdesk: cd, native: nv, accounts, startsOn: '2026-06-01', endsOn: '2027-05-31', untilISO: '2026-07-20', ignore: [9] })
    expect(m.map((x) => [x.month, x.accountsDifferent])).toEqual([['2026-06', 0], ['2026-07', 2]])
  })
})

describe('opening balance', () => {
  it('takes ClubDesk opening rows per account and side and checks they balance', () => {
    const rows = [
      { debit_account: 1, credit_account: null, amount_chf: '5095.00' },
      { debit_account: 4, credit_account: null, amount_chf: '12885.55' },
      { debit_account: null, credit_account: 5, amount_chf: '47572.30' },
      { debit_account: null, credit_account: 6, amount_chf: '33753.03' },
      { debit_account: 7, credit_account: null, amount_chf: '2794.82' },
      { debit_account: 8, credit_account: null, amount_chf: '60549.96' },
    ]
    const o = openingLegsFromClubdesk(rows)
    expect(o.debit).toBe(81325.33)
    expect(o.credit).toBe(81325.33)
    expect(o.balanced).toBe(true)
    expect(openingEntries([{ account: 1, side: 'debit', amount: 5 }, { account: 5, side: 'credit', amount: 5 }], 99))
      .toEqual([{ debit: 1, credit: 99, amount: 5 }, { debit: 99, credit: 5, amount: 5 }])
  })
})

describe('receipts and readiness', () => {
  it('exempts close and Storno entries from needing a receipt', () => {
    expect(needsReceipt({ entry_type: 'standard' })).toBe(true)
    expect(needsReceipt({ entry_type: 'opening' })).toBe(false)
    expect(needsReceipt({ entry_type: 'closing' })).toBe(false)
    expect(needsReceipt({ entry_type: 'reversal' })).toBe(false)
  })
  it('is ready only when every check passes', () => {
    const facts = {
      mirrorYears: 7, clubdeskYears: 7, syncHealthy: true, openingPosted: true, parallelStartLabel: '2026/27',
      openBankLines: 0, bankLines: 120, monthsSigned: 12, monthsDue: 12, lastDifferenceTotal: 0,
      closedYearsMatching: 1, nativeEntries: 400, entriesNeedingReceipt: 50, entriesMissingReceipt: 0,
      archives: 1, archivedOffsite: 1, revisors: 2, treasurers: 1,
    }
    expect(evaluateReadiness(facts).ready).toBe(true)
    const notYet = evaluateReadiness({ ...facts, monthsSigned: 4 })
    expect(notYet.ready).toBe(false)
    expect(notYet.checks.find((c) => c.key === 'signoffs').status).toBe('fail')
    expect(evaluateReadiness({ ...facts, archives: 0, archivedOffsite: 0 }).checks.find((c) => c.key === 'archive').status).toBe('pending')
  })
})

describe('finance access', () => {
  it('lets the auditor read but never write', () => {
    expect(financeAccessFor(['user', 'revisor'])).toEqual({ write: false, read: true })
    expect(financeAccessFor(['finance'])).toEqual({ write: true, read: true })
    expect(financeAccessFor(['user'])).toEqual({ write: false, read: false })
    expect(financeAccessFor([], true)).toEqual({ write: true, read: true })
  })
})

const STMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>M1</MsgId></GrpHdr>
    <Stmt>
      <Id>STMT-2026-06</Id>
      <Acct><Id><IBAN>CH65 0027 0270 N661 5228 0</IBAN></Id></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-05-31</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="CHF">1584.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-06-30</Dt></Dt></Bal>
      <Ntry>
        <Amt Ccy="CHF">620.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-06-18</Dt></BookgDt><ValDt><Dt>2026-06-18</Dt></ValDt>
        <AcctSvcrRef>E1</AcctSvcrRef>
        <NtryDtls>
          <TxDtls><Refs><AcctSvcrRef>T1</AcctSvcrRef></Refs><Amt Ccy="CHF">310.00</Amt>
            <RltdPties><Dbtr><Pty><Nm>Muster Anna</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>CH11 1111</IBAN></Id></DbtrAcct></RltdPties>
            <RmtInf><Strd><CdtrRefInf><Ref>210000000003139471430009017</Ref></CdtrRefInf></Strd></RmtInf></TxDtls>
          <TxDtls><Refs><AcctSvcrRef>T2</AcctSvcrRef></Refs><Amt Ccy="CHF">310.00</Amt>
            <RltdPties><Dbtr><Nm>Beispiel Ben</Nm></Dbtr></RltdPties>
            <RmtInf><Ustrd>Rechnungsnummer: 3089</Ustrd></RmtInf></TxDtls>
        </NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">35.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts>
        <BookgDt><Dt>2026-06-03</Dt></BookgDt>
        <NtryDtls><TxDtls><RltdPties><Cdtr><Nm>Hostpoint AG</Nm></Cdtr><CdtrAcct><Id><IBAN>CH22 2222</IBAN></Id></CdtrAcct></RltdPties>
          <RmtInf><Ustrd>Webhosting</Ustrd></RmtInf></TxDtls></NtryDtls>
        <AddtlNtryInf>e-banking order</AddtlNtryInf>
      </Ntry>
      <Ntry>
        <Amt Ccy="CHF">99.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>PDNG</Sts>
        <BookgDt><Dt>2026-06-30</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`

describe('camt.053 statement parser', () => {
  const { statements } = parseStatement(STMT)
  const s = statements[0]
  it('reads the account, balances and every booked entry in both directions', () => {
    expect(s.iban).toBe('CH6500270270N66152280')
    expect(s.opening).toEqual({ amount: 1000, date: '2026-05-31' })
    expect(s.lines).toHaveLength(3) // batch split in two + one debit; pending skipped
    expect(s.lines.map((l) => l.amount)).toEqual([310, 310, -35.5])
  })
  it('keeps the counterparty, message and a stable reference per line', () => {
    expect(s.lines[0]).toMatchObject({ bankRef: 'T1', counterpartyName: 'Muster Anna', counterpartyIban: 'CH111111', reference: '210000000003139471430009017' })
    expect(s.lines[1]).toMatchObject({ bankRef: 'T2', counterpartyName: 'Beispiel Ben', remittance: 'Rechnungsnummer: 3089' })
    expect(s.lines[2]).toMatchObject({ bankRef: 'STMT-2026-06:1#0', counterpartyName: 'Hostpoint AG', remittance: 'Webhosting · e-banking order' })
  })
  it('proves completeness with the balances', () => {
    expect(statementBalanceCheck(s)).toEqual({ ok: true, expected: 1584.5, actual: 1584.5 })
    expect(statementBalanceCheck({ ...s, lines: s.lines.slice(1) }).ok).toBe(false)
  })
  it('refuses a notification (camt.054) as a statement', () => {
    expect(() => parseStatement('<Document><BkToCstmrDbtCdtNtfctn/></Document>')).toThrow(/camt\.053/)
  })
})

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789')).toString(16)).toBe('cbf43926')
  })
  it('writes local headers, a central directory and the end record', () => {
    const z = buildZip([{ name: 'a.csv', data: 'x;y\n' }, { name: 'b/c.txt', data: Buffer.from('hi') }])
    expect(z.readUInt32LE(0)).toBe(0x04034b50)
    const end = z.length - 22
    expect(z.readUInt32LE(end)).toBe(0x06054b50)
    expect(z.readUInt16LE(end + 10)).toBe(2)
  })
  it('refuses duplicate names', () => {
    expect(() => buildZip([{ name: 'a', data: '' }, { name: 'a', data: '' }])).toThrow(/Duplicate/)
  })
})
