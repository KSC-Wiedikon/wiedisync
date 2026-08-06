import { describe, it, expect } from 'vitest'
import { compareRecipients, recipientLabel, recipientSurname, sortRecipients } from '../recipientSort'
import type { MailboxRecipient } from '../hooks/useMailbox'

const person = (first: string, last: string, email: string): MailboxRecipient => ({
  id: email, kind: 'member', name: [first, last].filter(Boolean).join(' ') || email,
  first_name: first, last_name: last, email,
})
const addressOnly = (email: string): MailboxRecipient => ({
  id: email, kind: 'clubdesk', name: email, first_name: '', last_name: '', email,
})

describe('sortRecipients', () => {
  it('orders by surname', () => {
    const sorted = sortRecipients([
      person('Luca', 'Canepa', 'c@x.ch'),
      person('Anna', 'Berke-Wenger', 'b@x.ch'),
      person('Theo', 'Alder', 'a@x.ch'),
    ])
    expect(sorted.map((r) => r.last_name)).toEqual(['Alder', 'Berke-Wenger', 'Canepa'])
  })

  it('breaks a shared surname on the first name', () => {
    const sorted = sortRecipients([
      person('Olivia', 'Uhlmann', 'o@x.ch'),
      person('Anouk', 'Uhlmann', 'a@x.ch'),
    ])
    expect(sorted.map((r) => r.first_name)).toEqual(['Anouk', 'Olivia'])
  })

  it('sorts umlauts with their base letter, not after Z', () => {
    const sorted = sortRecipients([
      person('Z', 'Zwygart', 'z@x.ch'),
      person('A', 'Ärni', 'ae@x.ch'),
      person('B', 'Bühler', 'b@x.ch'),
    ])
    expect(sorted.map((r) => r.last_name)).toEqual(['Ärni', 'Bühler', 'Zwygart'])
  })

  it('puts address-only contacts last as a block, not interleaved', () => {
    const sorted = sortRecipients([
      addressOnly('aaa@x.ch'),
      person('Luca', 'Canepa', 'c@x.ch'),
      addressOnly('zzz@x.ch'),
      person('Theo', 'Alder', 'a@x.ch'),
    ])
    expect(sorted.map((r) => r.email)).toEqual(['a@x.ch', 'c@x.ch', 'aaa@x.ch', 'zzz@x.ch'])
  })

  it('does not mutate the source array', () => {
    const src = [person('B', 'Beta', 'b@x.ch'), person('A', 'Alpha', 'a@x.ch')]
    const before = src.map((r) => r.email)
    sortRecipients(src)
    expect(src.map((r) => r.email)).toEqual(before)
  })

  it('degrades to the last token when only the joined name is present', () => {
    const legacy = { id: 1, kind: 'member', name: 'Luca Canepa', email: 'l@x.ch' } as MailboxRecipient
    expect(recipientSurname(legacy)).toBe('Canepa')
    expect(compareRecipients(legacy, person('Theo', 'Alder', 'a@x.ch'))).toBeGreaterThan(0)
  })
})

describe('recipientLabel', () => {
  it('shows surname first, so the order is visible', () => {
    expect(recipientLabel(person('Luca', 'Canepa', 'l@x.ch'))).toBe('Canepa Luca')
  })

  it('falls back to the address when there is no name', () => {
    expect(recipientLabel(addressOnly('nobody@x.ch'))).toBe('nobody@x.ch')
  })

  it('handles a name with only one part', () => {
    expect(recipientLabel(person('', 'Legends', 'team@x.ch'))).toBe('Legends')
    expect(recipientLabel(person('Cher', '', 'cher@x.ch'))).toBe('Cher')
  })
})
