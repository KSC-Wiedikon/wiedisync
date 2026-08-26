import { describe, it, expect } from 'vitest'
import { CD_FIELD_LABEL, cdFieldLabel } from '../../../../../src/modules/admin/utils/clubdeskFieldLabels.ts'
import { PROPOSAL_COLUMNS } from '../clubdesk-update.js'
import en from '../../../../../src/i18n/locales/en/admin.ts'

/**
 * ⚠ This test lives on the EXTENSION side although it is mostly about frontend
 * strings, because it is the only place both halves of the contract can meet:
 * tsconfig.app.json includes `src` only, so a .ts test in src importing this
 * untyped .js module fails the build gate with TS7016. Here, tsc never sees the
 * file and vitest resolves the .ts imports itself.
 */

/** The label resolver reads i18n; in tests, resolve straight out of the en bundle. */
const t = (k) => en[k] ?? `MISSING:${k}`

describe('ClubDesk field labels', () => {
  it('actually sees the backend column list — an empty import passes every test below', () => {
    // The guard below is "no column lacks a label". If the cross-package import
    // ever yields {} — a moved file, a renamed export — that assertion becomes
    // vacuously true and the suite goes green while the screen fills with raw
    // identifiers. Silence is not success.
    expect(Object.keys(PROPOSAL_COLUMNS).length).toBeGreaterThan(20)
    expect(PROPOSAL_COLUMNS.sektion).toBe('text')
  })

  it('every proposable column has a label — this is what `sektion` slipped through', () => {
    // A column reaches the decision table the moment it is added to
    // PROPOSAL_COLUMNS, and an unlabelled one renders as the bare database
    // identifier next to properly labelled rows for the same member. Nothing
    // else keeps the two lists in step.
    const missing = Object.keys(PROPOSAL_COLUMNS).filter((c) => !CD_FIELD_LABEL[c])
    expect(missing, `no label for: ${missing.join(', ')}`).toEqual([])
  })

  it('every label key exists in the English bundle', () => {
    // A key that is present but untranslated renders the raw i18n key on screen,
    // which looks exactly like a bug to the operator.
    const unresolved = Object.entries(CD_FIELD_LABEL)
      .filter(([, key]) => t(key).startsWith('MISSING:'))
      .map(([field]) => field)
    expect(unresolved, `no en string for: ${unresolved.join(', ')}`).toEqual([])
  })

  it('every label starts with a capital — sentence case, app-wide rule', () => {
    const lower = Object.values(CD_FIELD_LABEL)
      .map((k) => t(k))
      .filter((label) => label && label[0] !== label[0].toUpperCase())
    expect(lower, `lowercase labels: ${lower.join(', ')}`).toEqual([])
  })

  it('falls back to a sentence-cased column name, never raw snake_case', () => {
    expect(cdFieldLabel(t, 'some_new_column')).toBe('Some new column')
    expect(cdFieldLabel(t, 'eintritt')).toBe('Joined')
    expect(cdFieldLabel(t, 'sektion')).toBe('Section')
    expect(cdFieldLabel(t, null)).toBe('—')
    expect(cdFieldLabel(t, '')).toBe('—')
  })
})
