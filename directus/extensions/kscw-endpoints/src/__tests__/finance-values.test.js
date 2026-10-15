// Finance values (migration 419): slugs in wiedisync, ClubDesk wording at the
// border — and the JS dictionary must say what clubdesk_value_map says.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  INVOICE_STATUS_VALUES, NATIVE_INVOICE_STATUSES, normalizeInvoiceStatus, invoiceStatusToClubdesk,
  ENTRY_TYPE_VALUES, normalizeEntryType, entryTypeLabel, YEAR_END_ENTRY_TYPES, RECEIPT_EXEMPT_ENTRY_TYPES,
  normalizePaymentMethod, paymentMethodLabel, dunningLevelFromText,
} from '../finance-values.js'

const scripts = path.resolve(import.meta.dirname, '../../../../scripts')
const read = (f) => fs.readFileSync(path.join(scripts, f), 'utf8')
const mapRows = (sql, domain) => [...sql.matchAll(new RegExp(`\\('${domain}',\\s*'([^']+)',\\s*'([^']+)',\\s*(true|false)\\)`, 'g'))]
  .map(([, slug, cd, canonical]) => ({ slug, cd, canonical: canonical === 'true' }))
// 419 renames two of 412's invoice_status slugs onto the native ones.
const RENAMED_IN_419 = { issued: 'open', partially_paid: 'partial' }

describe('clubdesk_value_map ↔ finance-values.js', () => {
  const seed = read('412-clubdesk-maps.sql') + '\n' + read('419-finance-english.sql')

  it('invoice_status', () => {
    const rows = mapRows(seed, 'invoice_status')
    expect(rows.length).toBe(7)
    for (const r of rows) {
      const slug = RENAMED_IN_419[r.slug] ?? r.slug
      expect(normalizeInvoiceStatus(r.cd), r.cd).toBe(slug)
      expect(invoiceStatusToClubdesk(slug), slug).toBe(r.cd)
      expect(INVOICE_STATUS_VALUES).toContain(slug)
    }
    for (const [from, to] of Object.entries(RENAMED_IN_419)) {
      expect(read('419-finance-english.sql')).toMatch(new RegExp(`SET app_value = '${to}'\\s+WHERE domain = 'invoice_status' AND app_value = '${from}'`))
    }
  })

  it('booking_type', () => {
    const rows = mapRows(seed, 'booking_type')
    expect(rows.length).toBe(8)
    for (const r of rows) {
      expect(normalizeEntryType(r.cd), r.cd).toBe(r.slug)
      if (r.canonical) expect(entryTypeLabel(r.slug), r.slug).toBe(r.cd)
    }
    expect(new Set(rows.map((r) => r.slug))).toEqual(new Set(ENTRY_TYPE_VALUES))
  })

  it('payment_method', () => {
    const rows = mapRows(seed, 'payment_method')
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(normalizePaymentMethod(r.cd), r.cd).toBe(r.slug)
      expect(paymentMethodLabel(r.slug)).toBe(r.cd)
    }
  })

  it('the migration CHECKs list exactly the JS vocabularies', () => {
    const sql = read('419-finance-english.sql')
    const list = (name) => {
      const m = sql.match(new RegExp(`${name}\\s+CHECK \\([a-z_]+ IS NULL OR [a-z_]+ IN \\(([^)]*)\\)`))
      return m[1].split(',').map((x) => x.trim().replace(/'/g, ''))
    }
    expect(new Set(list('finance_invoices_status_values'))).toEqual(new Set(INVOICE_STATUS_VALUES))
    expect(new Set(list('finance_transactions_entry_type_values'))).toEqual(new Set(ENTRY_TYPE_VALUES))
  })
})

describe('finance values', () => {
  it('native statuses are a subset; unknown values pass through for display', () => {
    for (const s of NATIVE_INVOICE_STATUSES) expect(INVOICE_STATUS_VALUES).toContain(s)
    expect(invoiceStatusToClubdesk('pending_confirmation')).toBe('pending_confirmation')
    expect(invoiceStatusToClubdesk(null)).toBe('')
    expect(normalizeInvoiceStatus('bezahlt')).toBe('paid')
    expect(normalizeInvoiceStatus('Neu')).toBeNull()
  })
  it('booking types: the old native Eroeffnung is an opening', () => {
    expect(normalizeEntryType('Eroeffnung')).toBe('opening')
    expect(entryTypeLabel('opening')).toBe('Eröffnung')
    expect(YEAR_END_ENTRY_TYPES).toEqual(['opening', 'closing'])
    expect(RECEIPT_EXEMPT_ENTRY_TYPES).toEqual(['opening', 'closing', 'reversal'])
  })
  it('dunning level', () => {
    expect(dunningLevelFromText('2. Mahnung')).toBe(2)
    expect(dunningLevelFromText('Mahnung 3')).toBe(3)
    expect(dunningLevelFromText('')).toBe(0)
  })
})
