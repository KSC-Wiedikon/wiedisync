import { describe, expect, it, vi } from 'vitest'

vi.mock('../email-suppression.js', () => ({
  loadSuppressed: async () => new Set(),
  normaliseEmail: (e) => (e ? String(e).trim().toLowerCase() : ''),
}))

const { sendFineIssuedEmail, fineRef } = await import('../fine-email.js')

function setup(language = 'english') {
  const sent = []
  const database = () => ({
    where: () => ({ first: async () => ({ email: 'player@example.invalid', first_name: 'Pat', language }) }),
  })
  class MailService { async send(m) { sent.push(m) } }
  const log = { warn: vi.fn() }
  return { sent, log, args: { database, services: { MailService }, getSchema: async () => ({}), log } }
}

describe('fine email payment reference', () => {
  it('fineRef is F-<id>', () => {
    expect(fineRef(56)).toBe('F-56')
  })

  it('puts the reference in the card, the note and the text part', async () => {
    const { sent, log, args } = setup()
    await sendFineIssuedEmail({ ...args, teamName: 'H3', fine: { id: 56, member: 1, amount: 5, category: 'late_signin' } })
    expect(log.warn).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
    expect(sent[0].html).toContain('Payment reference')
    expect(sent[0].html).toContain('<strong>F-56</strong>')
    expect(sent[0].text).toContain('Payment reference: F-56')
    expect(sent[0].text).toContain('please put the reference in the payment message: F-56')
  })

  it('speaks the member language', async () => {
    const { sent, args } = setup('german')
    await sendFineIssuedEmail({ ...args, teamName: 'H3', fine: { id: 7, member: 1, amount: 5, category: 'no_show' } })
    expect(sent[0].text).toContain('Zahlungsreferenz: F-7')
  })
})
