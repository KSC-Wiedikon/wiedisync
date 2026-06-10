import { describe, it, expect } from 'vitest'
import {
  bestOpponentForMessage,
  contactAddressSet,
  messageMatchesContacts,
  type MailboxMessage,
  type OpponentContacts,
} from '../useMailbox'
import type { GameSchedulingOpponent } from '../../../../types'

const makeOpponent = (over: Partial<GameSchedulingOpponent>): GameSchedulingOpponent =>
  ({
    id: 1,
    season: 1,
    club_name: '',
    team_name: '',
    contact_name: 'Pavel Vitvera',
    contact_email: 'p.vitvera@bluewin.ch',
    kscw_team: '1',
    token: 't',
    home_game: '',
    away_game: '',
    ...over,
  }) as GameSchedulingOpponent

const makeMessage = (over: Partial<MailboxMessage>): MailboxMessage => ({
  id: 1,
  message_id: '<m1@test>',
  in_reply_to: null,
  direction: 'in',
  from_address: 'p.vitvera@bluewin.ch',
  from_name: 'Pavel Vitvera',
  to_addresses: 'volleyball@spielplanung.kscw.ch',
  cc_addresses: null,
  subject: null,
  snippet: null,
  date_sent: '2026-06-10T18:53:00Z',
  read_at: null,
  has_attachments: false,
  ...over,
})

const toContacts = (opps: GameSchedulingOpponent[]): OpponentContacts[] =>
  opps.map((opp) => ({ opp, contacts: contactAddressSet(opp) }))

describe('contactAddressSet', () => {
  it('splits comma/semicolon lists and lower-cases', () => {
    const set = contactAddressSet({ contact_email: 'A@x.ch, b@y.ch; C@z.ch' })
    expect(set).toEqual(new Set(['a@x.ch', 'b@y.ch', 'c@z.ch']))
  })
})

describe('messageMatchesContacts', () => {
  it('matches inbound by from_address and outbound by to/cc', () => {
    const contacts = new Set(['p.vitvera@bluewin.ch'])
    expect(messageMatchesContacts(makeMessage({}), contacts)).toBe(true)
    expect(
      messageMatchesContacts(
        makeMessage({ direction: 'out', from_address: null, to_addresses: 'other@x.ch, p.vitvera@bluewin.ch' }),
        contacts,
      ),
    ).toBe(true)
    expect(messageMatchesContacts(makeMessage({ from_address: 'someone@else.ch' }), contacts)).toBe(false)
  })
})

describe('bestOpponentForMessage', () => {
  // One club contact serving two opponent rows — the Tornado Adliswil case.
  const d1 = makeOpponent({ id: 'd1', club_name: 'VC Tornado Adliswil', team_name: 'VC Tornado Adliswil D1' })
  const h2 = makeOpponent({ id: 'h2', club_name: 'VC Tornado Adliswil', team_name: 'VC Tornado Adliswil H2' })
  const contacts = toContacts([d1, h2])

  it('picks the row whose team name appears in the subject, not the first address match', () => {
    const msg = makeMessage({ subject: 'VC Tornado Adliswil H2 - KSCW Legends' })
    expect(bestOpponentForMessage(msg, contacts)?.id).toBe('h2')
  })

  it('also reads the snippet when the subject is unspecific', () => {
    const msg = makeMessage({ subject: 'Spieltermine', snippet: 'Hallo, wegen VC Tornado Adliswil D1 …' })
    expect(bestOpponentForMessage(msg, contacts)?.id).toBe('d1')
  })

  it('falls back to the first address match when no team name appears', () => {
    const msg = makeMessage({ subject: 'Hallo zusammen' })
    expect(bestOpponentForMessage(msg, contacts)?.id).toBe('d1')
  })

  it('returns null when no contact matches', () => {
    const msg = makeMessage({ from_address: 'unknown@else.ch' })
    expect(bestOpponentForMessage(msg, contacts)).toBeNull()
  })

  it('matches case-insensitively', () => {
    const msg = makeMessage({ subject: 'vc tornado adliswil h2 – Termine' })
    expect(bestOpponentForMessage(msg, contacts)?.id).toBe('h2')
  })
})
