import { describe, it, expect } from 'vitest'
import { xlsxNumericColumns, toXlsx } from './exportResults'
import ExcelJS from 'exceljs'

// 2026-09-13: the SQL-workspace Excel export decided string→number PER CELL,
// so one column came out half numbers, half text ("380" → 380, "440.50" stayed
// text; "333084" → 333084, "015964" stayed text). The decision is per column.
describe('xlsxNumericColumns', () => {
  it('a column is numeric only when every non-null value is safely numeric', () => {
    const rows = [
      ['380', '015964', 'a', 5, null],
      ['440.50', '333084', 'b', null, null],
    ]
    const cols = xlsxNumericColumns(rows)
    expect(cols[0]).toEqual({ decimals: 2 })   // fee: 380 + 440.50 → numeric, 2 places
    expect(cols[1]).toBeNull()                 // licence numbers: one leading zero → whole column text
    expect(cols[2]).toBeNull()                 // text
    expect(cols[3]).toEqual({ decimals: 0 })   // real JS numbers + null
    expect(cols[4]).toBeNull()                 // all null → nothing to type
  })

  it('protects identifiers and precision: leading zeros, >15 digits, IBAN-like, phones', () => {
    expect(xlsxNumericColumns([['007'], ['8']])[0]).toBeNull()
    expect(xlsxNumericColumns([['1234567890123456']])[0]).toBeNull()
    expect(xlsxNumericColumns([['CH9300762011623852957']])[0]).toBeNull()
    expect(xlsxNumericColumns([['+41 79 000 00 00']])[0]).toBeNull()
    expect(xlsxNumericColumns([['0'], ['0.5'], ['-3']])[0]).toEqual({ decimals: 1 })
  })

  it('temporal strings are never numeric', () => {
    expect(xlsxNumericColumns([['2026-09-15'], ['2026-12-01']])[0]).toBeNull()
  })
})

describe('toXlsx', () => {
  it('writes a whole numeric column as numbers with a pinned decimal format, and a mixed id column as text', async () => {
    const blob = await toXlsx(['fee', 'license_nr', 'date'], [
      ['440.50', '015964', '2026-09-15'],
      ['380', '333084', '2026-12-01'],
    ])
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(await blob.arrayBuffer()) as unknown as Parameters<typeof wb.xlsx.load>[0])
    const ws = wb.worksheets[0]
    expect(ws.getCell('A2').value).toBe(440.5)
    expect(ws.getCell('A2').numFmt).toBe('0.00')
    expect(ws.getCell('A3').value).toBe(380)
    expect(ws.getCell('A3').numFmt).toBe('0.00')
    expect(ws.getCell('B2').value).toBe('015964')
    expect(ws.getCell('B3').value).toBe('333084')   // text too — the column is consistent
    expect(ws.getCell('C2').value).toBeInstanceOf(Date)
    expect(ws.getCell('C2').numFmt).toBe('dd.mm.yyyy')
  })
})
