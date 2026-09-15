/**
 * finance-payout.js — the payee precedence both payout flows depend on, the
 * skip codes, and the referee-run grouping.
 *
 * resolvePayee was lifted verbatim from expense-upload.js's auto-payout; these
 * tests pin the precedence so the extraction cannot drift:
 *   preferredIban (CH/LI-valid) > billing_iban (billing_different) > members.iban
 * with the billing ADDRESS riding only with the billing IBAN.
 */
import { describe, it, expect } from 'vitest'
import { resolvePayee, planRefereePayouts, isValidIban, cleanIban, isChLiIban, PAYOUT_SKIP, insertPayout } from '../finance-payout.js'

// Valid test IBANs (mod-97 checked).
const CH = 'CH93 0076 2011 6238 5295 7'
const CH_CLEAN = 'CH9300762011623852957'
const LI = 'LI21 0881 0000 2324 013A A'
const LI_CLEAN = 'LI21088100002324013AA'
const DE = 'DE89 3704 0044 0532 0130 00'
const DE_CLEAN = 'DE89370400440532013000'

const member = (over = {}) => ({
  first_name: 'Anna', last_name: 'Muster',
  iban: CH, adresse: 'Weg 1', plz: '8003', ort: 'Zürich',
  billing_different: false, billing_iban: null, billing_name: null,
  billing_address: null, billing_plz: null, billing_ort: null,
  ...over,
})

describe('IBAN helpers', () => {
  it('cleanIban strips whitespace and upper-cases', () => {
    expect(cleanIban(' ch93 0076 2011 6238 5295 7 ')).toBe(CH_CLEAN)
    expect(cleanIban(null)).toBe('')
  })
  it('isValidIban accepts real IBANs and rejects a flipped digit', () => {
    expect(isValidIban(CH)).toBe(true)
    expect(isValidIban(DE)).toBe(true)
    expect(isValidIban('CH9300762011623852958')).toBe(false)
    expect(isValidIban('')).toBe(false)
  })
  it('isChLiIban is CH/LI-only and expects a CLEANED input', () => {
    expect(isChLiIban(CH_CLEAN)).toBe(true)
    expect(isChLiIban(LI_CLEAN)).toBe(true)
    expect(isChLiIban(DE_CLEAN)).toBe(false)
  })
  it('PAYOUT_SKIP carries the four codes the frontend maps', () => {
    expect(PAYOUT_SKIP).toEqual({ NON_CHF: 'NON_CHF', NO_IBAN: 'NO_IBAN', ADDRESS_INCOMPLETE: 'ADDRESS_INCOMPLETE', FAILED: 'FAILED' })
  })
})

describe('resolvePayee — precedence', () => {
  it('profile IBAN + profile address when nothing else is set', () => {
    expect(resolvePayee(member())).toEqual({
      iban: CH_CLEAN, name: 'Anna Muster', street: 'Weg 1', zip: '8003', city: 'Zürich', skip: null,
    })
  })

  it('preferred IBAN wins over billing and profile — with the PROFILE address', () => {
    const r = resolvePayee(member({
      billing_different: true, billing_iban: LI, billing_name: 'Firma AG',
      billing_address: 'Bahnhofstrasse 9', billing_plz: '8001', billing_ort: 'Zürich',
    }), 'ch93 0076 2011 6238 5295 7')
    expect(r.iban).toBe(CH_CLEAN)
    expect(r.name).toBe('Anna Muster')
    expect(r.street).toBe('Weg 1')
    expect(r.skip).toBeNull()
  })

  it('a non-CH/LI preferred IBAN is ignored (falls through to billing)', () => {
    const r = resolvePayee(member({
      billing_different: true, billing_iban: LI, billing_name: 'Firma AG',
      billing_address: 'Bahnhofstrasse 9', billing_plz: '8001', billing_ort: 'Zürich',
    }), DE)
    expect(r.iban).toBe(LI_CLEAN)
    expect(r.name).toBe('Firma AG')
    expect(r.street).toBe('Bahnhofstrasse 9')
    expect(r.zip).toBe('8001')
  })

  it('billing IBAN + billing address when billing_different is set', () => {
    const r = resolvePayee(member({
      billing_different: true, billing_iban: LI, billing_name: 'Firma AG',
      billing_address: 'Bahnhofstrasse 9', billing_plz: '8001', billing_ort: 'Zürich',
    }))
    expect(r).toEqual({ iban: LI_CLEAN, name: 'Firma AG', street: 'Bahnhofstrasse 9', zip: '8001', city: 'Zürich', skip: null })
  })

  it('billing name blank → member name, billing address still wins', () => {
    const r = resolvePayee(member({
      billing_different: true, billing_iban: LI, billing_name: '  ',
      billing_address: 'Bahnhofstrasse 9', billing_plz: '8001', billing_ort: 'Bern',
    }))
    expect(r.name).toBe('Anna Muster')
    expect(r.city).toBe('Bern')
  })

  it('billing_different with an INVALID billing IBAN falls back to the profile IBAN + profile address', () => {
    const r = resolvePayee(member({
      billing_different: true, billing_iban: DE, billing_name: 'Firma AG',
      billing_address: 'Bahnhofstrasse 9', billing_plz: '8001', billing_ort: 'Zürich',
    }))
    expect(r.iban).toBe(CH_CLEAN)
    expect(r.name).toBe('Anna Muster')
    expect(r.street).toBe('Weg 1')
  })

  it('billing_different false ignores a valid billing IBAN', () => {
    const r = resolvePayee(member({ billing_different: false, billing_iban: LI }))
    expect(r.iban).toBe(CH_CLEAN)
  })
})

describe('resolvePayee — skip codes', () => {
  it('NO_IBAN when no level yields a CH/LI IBAN', () => {
    expect(resolvePayee(member({ iban: null })).skip).toBe(PAYOUT_SKIP.NO_IBAN)
    expect(resolvePayee(member({ iban: DE })).skip).toBe(PAYOUT_SKIP.NO_IBAN)
    expect(resolvePayee(member({ iban: 'garbage' }), 'more garbage').skip).toBe(PAYOUT_SKIP.NO_IBAN)
  })
  it('ADDRESS_INCOMPLETE when the IBAN is fine but zip / city / name is missing', () => {
    expect(resolvePayee(member({ plz: null })).skip).toBe(PAYOUT_SKIP.ADDRESS_INCOMPLETE)
    expect(resolvePayee(member({ ort: '' })).skip).toBe(PAYOUT_SKIP.ADDRESS_INCOMPLETE)
    expect(resolvePayee(member({ first_name: null, last_name: null })).skip).toBe(PAYOUT_SKIP.ADDRESS_INCOMPLETE)
  })
  it('a missing street is NOT a skip (the QR creditor block only needs name + zip + city)', () => {
    const r = resolvePayee(member({ adresse: null }))
    expect(r.skip).toBeNull()
    expect(r.street).toBeNull()
  })
  it('NO_IBAN beats ADDRESS_INCOMPLETE', () => {
    expect(resolvePayee(member({ iban: null, plz: null })).skip).toBe(PAYOUT_SKIP.NO_IBAN)
  })
  it('tolerates a null payee', () => {
    expect(resolvePayee(null).skip).toBe(PAYOUT_SKIP.NO_IBAN)
  })
})

describe('planRefereePayouts', () => {
  const row = (expense_id, memberId, amount, over = {}) => ({
    expense_id, amount, currency: 'CHF', member: memberId,
    ...member(), ...over,
  })

  it('groups fee rows per member, sums the total and counts games', () => {
    const plan = planRefereePayouts([
      row(1, 7, '60.00'), row(2, 7, '60.00'), row(3, 7, '45.50'),
      row(4, 9, '60', { first_name: 'Ben', last_name: 'Ammann' }),
    ])
    expect(plan).toHaveLength(2)
    const anna = plan.find((p) => p.member === 7)
    expect(anna).toMatchObject({ member: 7, member_name: 'Anna Muster', games: 3, total: 165.5, iban: CH_CLEAN, skip: null, expense_ids: [1, 2, 3] })
    expect(anna.payee).toMatchObject({ iban: CH_CLEAN, name: 'Anna Muster' })
    // sorted by LAST name — Ammann before Muster
    expect(plan[0].member).toBe(9)
  })

  it('NON_CHF when ANY of the member\'s fees is not CHF, and it beats the payee skips', () => {
    const plan = planRefereePayouts([
      row(1, 7, '60', { iban: null }),
      row(2, 7, '20', { currency: 'EUR', iban: null }),
    ])
    expect(plan[0].skip).toBe(PAYOUT_SKIP.NON_CHF)
    expect(plan[0].total).toBe(80)
  })

  it('carries the payee skip when currencies are all CHF', () => {
    const plan = planRefereePayouts([row(1, 7, '60', { iban: null }), row(2, 8, '60', { plz: null })])
    expect(plan.find((p) => p.member === 7).skip).toBe(PAYOUT_SKIP.NO_IBAN)
    expect(plan.find((p) => p.member === 8).skip).toBe(PAYOUT_SKIP.ADDRESS_INCOMPLETE)
  })

  it('the first row of a member supplies the payee (all rows carry the same member columns)', () => {
    const plan = planRefereePayouts([row(1, 7, '60'), row(2, 7, '60')])
    expect(plan[0].iban).toBe(CH_CLEAN)
  })

  it('skips rows with no integer member and handles empty input', () => {
    expect(planRefereePayouts([])).toEqual([])
    expect(planRefereePayouts([row(1, null, '60')])).toEqual([])
    expect(planRefereePayouts(undefined)).toEqual([])
  })

  it('coerces numeric strings and rounds the total', () => {
    const plan = planRefereePayouts([row(1, 7, '0.1'), row(2, 7, '0.2')])
    expect(plan[0].total).toBe(0.3)
  })
})

describe('insertPayout', () => {
  function fakeTrx(returning) {
    const calls = []
    const trx = (table) => ({
      insert(row) { calls.push({ table, row }); return { returning: () => Promise.resolve([returning]) } },
    })
    trx.calls = calls
    return trx
  }

  const payee = { iban: CH_CLEAN, name: 'Anna Muster', street: 'Weg 1', zip: '8003', city: 'Zürich', skip: null }
  const createdBy = { name: 'Treasurer', email: 't@kscw.ch', user: 'uuid-1' }

  it('writes the QR-bill snapshot with status paid and returns the id (object form)', async () => {
    const trx = fakeTrx({ id: 42 })
    const id = await insertPayout(trx, { member: 7, amount: '165.50', message: 'Schiedsrichterspesen 2026/27 (3 Spiele)', payee, createdBy })
    expect(id).toBe(42)
    expect(trx.calls[0].table).toBe('finance_payouts')
    expect(trx.calls[0].row).toEqual({
      member: 7, amount: 165.5, currency: 'CHF', message: 'Schiedsrichterspesen 2026/27 (3 Spiele)',
      iban: CH_CLEAN, payee_name: 'Anna Muster', payee_address: 'Weg 1', payee_zip: '8003', payee_ort: 'Zürich',
      status: 'paid', created_by_name: 'Treasurer', created_by_email: 't@kscw.ch', user_created: 'uuid-1',
    })
  })

  it('handles a scalar returning value and nulls an absent street', async () => {
    const trx = fakeTrx(43)
    const id = await insertPayout(trx, { member: 7, amount: 60, message: 'x', payee: { ...payee, street: undefined }, createdBy: {} })
    expect(id).toBe(43)
    expect(trx.calls[0].row.payee_address).toBeNull()
    expect(trx.calls[0].row.created_by_name).toBeNull()
    expect(trx.calls[0].row.user_created).toBeNull()
  })
})
