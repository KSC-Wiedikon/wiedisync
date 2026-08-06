/**
 * Unit tests for the group-send merge fields (merge-fields.js) — the {{token}}
 * substitution applied per recipient to the subject, HTML body and text body.
 *
 * The interesting cases are not "does it replace a name": they are the ways a
 * substitution can go wrong on member data the club really holds — a `&` in a
 * surname, a category nobody priced, and the two replacement hazards ($& in a
 * value, and a value being re-scanned as if it were a token).
 */
import { describe, it, expect } from 'vitest'
import { applyMergeFields, mergeValues, usedMergeFields } from '../merge-fields.js'

const r = {
  first_name: 'Luca', last_name: 'Canepa', email: 'l@x.ch',
  fee_category: 'VB Erwerbstätige', fee_amount: '440', teams: 'D1, D2',
}

describe('applyMergeFields', () => {
  it('substitutes the German spellings', () => {
    expect(applyMergeFields('Hallo {{vorname}} {{nachname}}', r, false)).toBe('Hallo Luca Canepa')
  })

  it('substitutes the English spellings — both are accepted', () => {
    expect(applyMergeFields('Dear {{first_name}} {{last_name}}', r, false)).toBe('Dear Luca Canepa')
  })

  it('is case-insensitive and tolerates inner spaces', () => {
    expect(applyMergeFields('{{ VorName }}', r, false)).toBe('Luca')
  })

  it('resolves the fields beyond the name', () => {
    expect(applyMergeFields('{{name}} · {{email}} · {{beitragskategorie}} · {{mitgliederbeitrag}} · {{team}}', r, false))
      .toBe('Luca Canepa · l@x.ch · VB Erwerbstätige · 440 · D1, D2')
    expect(applyMergeFields('{{full_name}} {{fee_amount}}', r, false)).toBe('Luca Canepa 440')
  })

  it('does not let {{name}} match inside {{nachname}}', () => {
    expect(applyMergeFields('{{nachname}}', r, false)).toBe('Canepa')
  })

  it('renders a value the member does not have as empty, never as the raw token', () => {
    const blank = { first_name: 'A', last_name: 'B', email: 'a@x.ch' }
    expect(applyMergeFields('Fee: {{mitgliederbeitrag}}.', blank, false)).toBe('Fee: .')
  })

  it('leaves an unrecognised token alone rather than blanking it', () => {
    expect(applyMergeFields('{{iban}}', r, false)).toBe('{{iban}}')
  })

  it('treats $& in a VALUE as literal text', () => {
    // A string replacement would splice the matched token in here instead.
    const odd = { first_name: 'A$&B', last_name: 'C$1D', email: 'x@x.ch' }
    expect(applyMergeFields('{{vorname}}/{{nachname}}', odd, false)).toBe('A$&B/C$1D')
  })

  it('never re-scans a substituted value', () => {
    const sneaky = { first_name: '{{email}}', last_name: 'X', email: 'secret@x.ch' }
    expect(applyMergeFields('{{vorname}}', sneaky, false)).toBe('{{email}}')
  })

  it('escapes HTML when asked, so a value cannot inject markup', () => {
    const evil = { first_name: '<script>x</script>', last_name: 'Ruiz & Sons', email: 'e@x.ch' }
    const out = applyMergeFields('<p>{{vorname}} {{nachname}}</p>', evil, true)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&amp;')
  })

  it('does not escape for the text part', () => {
    expect(applyMergeFields('{{nachname}}', { last_name: 'Ruiz & Sons' }, false)).toBe('Ruiz & Sons')
  })
})

describe('usedMergeFields', () => {
  it('reports only the fields the message references, deduped across spellings', () => {
    expect(usedMergeFields('Fee {{mitgliederbeitrag}}', '<p>Hi {{vorname}}, {{first_name}}</p>').sort())
      .toEqual(['fee_amount', 'first_name'])
  })

  it('is empty when nothing is referenced', () => {
    expect(usedMergeFields('Plain subject', '<p>Plain body</p>')).toEqual([])
  })
})

describe('mergeValues', () => {
  it('joins the full name and tolerates a missing half', () => {
    expect(mergeValues({ first_name: 'Cher' }).full_name).toBe('Cher')
    expect(mergeValues({ last_name: 'Legends' }).full_name).toBe('Legends')
    expect(mergeValues({}).full_name).toBe('')
  })
})
