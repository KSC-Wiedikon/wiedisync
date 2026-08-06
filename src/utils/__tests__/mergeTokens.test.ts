import { describe, it, expect } from 'vitest'
import { findMergeTokens, unknownMergeTokens, usedMergeFields, MERGE_TOKENS } from '../mergeTokens'

describe('findMergeTokens', () => {
  it('recognises both spellings of a field', () => {
    expect(findMergeTokens('{{vorname}} {{first_name}}').map((t) => t.field))
      .toEqual(['first_name', 'first_name'])
  })

  it('flags a near-miss typo as unrecognised — the case this exists for', () => {
    // No underscore: the endpoint sends this verbatim.
    const [tok] = findMergeTokens('Dear {{firstname}}')
    expect(tok.field).toBeNull()
    expect(tok.raw).toBe('{{firstname}}')
  })

  it('is case-insensitive and tolerates inner spaces', () => {
    expect(findMergeTokens('{{ First_Name }}')[0].field).toBe('first_name')
  })

  it('reports positions so the text can be decorated', () => {
    const [tok] = findMergeTokens('ab {{email}} cd')
    expect([tok.start, tok.end]).toEqual([3, 12])
    expect('ab {{email}} cd'.slice(tok.start, tok.end)).toBe('{{email}}')
  })

  it('finds nothing in text without braces', () => {
    expect(findMergeTokens('Dear first_name')).toEqual([])
  })

  it('does not treat a single brace pair as a token', () => {
    expect(findMergeTokens('{first_name}')).toEqual([])
  })
})

describe('unknownMergeTokens', () => {
  it('returns only what would be sent verbatim', () => {
    expect(unknownMergeTokens('{{vorname}} {{iban}} {{fee_amount}}').map((t) => t.raw))
      .toEqual(['{{iban}}'])
  })

  it('is empty when every token resolves', () => {
    expect(unknownMergeTokens('{{name}} {{team}} {{email}}')).toEqual([])
  })
})

describe('usedMergeFields', () => {
  it('dedupes across spellings of the same field', () => {
    expect(usedMergeFields('{{vorname}} {{first_name}} {{team}}').sort())
      .toEqual(['first_name', 'teams'])
  })
})

describe('MERGE_TOKENS', () => {
  // The mirror is the risk, and a hardcoded expectation would drift with it.
  // This compares against the ENDPOINT's own table: a field added server-side
  // but not here would render a valid token struck through in red, which reads
  // as "this will not work" — worse than showing nothing.
  it('matches the endpoint table token for token', async () => {
    // @ts-expect-error — plain-JS endpoint module, deliberately untyped; the
    // point of this test is to compare the runtime tables, not their types.
    const server = await import('../../../directus/extensions/kscw-endpoints/src/merge-fields.js')
    expect(MERGE_TOKENS).toEqual(server.MERGE_TOKENS as Record<string, string>)
  })
})
