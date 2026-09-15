import { describe, it, expect } from 'vitest'
import { shouldSubmitOnKeyDown } from '../utils/composerSubmit'

describe('shouldSubmitOnKeyDown', () => {
  it('submits on plain Enter', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: false })).toBe(true)
  })

  it('does NOT submit on Shift+Enter', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: true })).toBe(false)
  })

  it('does NOT submit on non-Enter keys', () => {
    expect(shouldSubmitOnKeyDown({ key: 'a', shiftKey: false })).toBe(false)
    expect(shouldSubmitOnKeyDown({ key: 'Escape', shiftKey: false })).toBe(false)
    expect(shouldSubmitOnKeyDown({ key: 'Tab', shiftKey: false })).toBe(false)
  })

  it('submits on Ctrl+Enter (no Shift)', () => {
    expect(shouldSubmitOnKeyDown({ key: 'Enter', shiftKey: false, ctrlKey: true })).toBe(true)
  })
})
