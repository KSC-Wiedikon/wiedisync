import { describe, it, expect } from 'vitest'
import {
  bestOpponentForMessage,
  chipOpponentForMessage,
  classifyMessages,
  contactAddressSet,
  messageMatchesContacts,
  messagesForOpponentThread,
  messagesForOwner,
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
  to_addresses: 'spielplanung@volleyball.kscw.ch',
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

describe('messagesForOpponentThread', () => {
  // The reported case: Volley Uster D1 (KSCW D1) and Volley Uster H4 (KSCW
  // Legends) are two opponent rows of the same club sharing one contact set.
  const sharedEmail = 'kontakt@volleyuster.ch'
  const d1 = makeOpponent({ id: 'd1', club_name: 'Volley Uster', team_name: 'Volley Uster D1', contact_email: sharedEmail, kscw_team: '1' })
  const h4 = makeOpponent({ id: 'h4', club_name: 'Volley Uster', team_name: 'Volley Uster H4', contact_email: sharedEmail, kscw_team: '2' })
  const oc: OpponentContacts[] = [
    { opp: d1, contacts: contactAddressSet(d1), aliases: ['D1'] },
    { opp: h4, contacts: contactAddressSet(h4), aliases: ['Legends'] },
  ]
  const mail = (subject: string) => makeMessage({ subject, from_address: sharedEmail })

  it('keeps a message naming the opponent team off the sibling thread', () => {
    const msgs = [mail('Volley Uster H4 – KSC Wiedikon Legends / Spielplanung 2026/27')]
    expect(messagesForOpponentThread(msgs, h4, oc).map((m) => m.subject)).toEqual(msgs.map((m) => m.subject))
    expect(messagesForOpponentThread(msgs, d1, oc)).toEqual([])
  })

  it('routes by the KSCW pairing alias when only our team is named', () => {
    const msgs = [mail('Re: KSCW Legends 4LC')]
    expect(messagesForOpponentThread(msgs, h4, oc)).toHaveLength(1)
    expect(messagesForOpponentThread(msgs, d1, oc)).toEqual([])
  })

  it('shows genuinely ambiguous mail (no team named) on every shared thread', () => {
    const msgs = [mail('Re: KSC Wiedikon – Spielplanung / Game scheduling 2026/27')]
    expect(messagesForOpponentThread(msgs, d1, oc)).toHaveLength(1)
    expect(messagesForOpponentThread(msgs, h4, oc)).toHaveLength(1)
  })

  it('keeps a message when the opponent does not share contacts with any sibling', () => {
    const solo = makeOpponent({ id: 'solo', club_name: 'Other', team_name: 'Other 1', contact_email: 'solo@other.ch' })
    const ocSolo: OpponentContacts[] = [...oc, { opp: solo, contacts: contactAddressSet(solo), aliases: ['H1'] }]
    const msgs = [makeMessage({ subject: 'Anything at all', from_address: 'solo@other.ch' })]
    expect(messagesForOpponentThread(msgs, solo, ocSolo)).toHaveLength(1)
  })

  it('drops messages that do not match the opponent contacts at all', () => {
    const msgs = [makeMessage({ subject: 'Volley Uster D1', from_address: 'stranger@elsewhere.ch' })]
    expect(messagesForOpponentThread(msgs, d1, oc)).toEqual([])
  })
})

describe('messageMatchesContacts — Cc and Sent', () => {
  const contacts = new Set(['opp@club.ch'])

  it('matches an inbound message that only Cc’s the opponent', () => {
    const msg = makeMessage({
      from_address: 'someone@else.ch',
      to_addresses: 'spielplanung@volleyball.kscw.ch',
      cc_addresses: 'opp@club.ch',
    })
    expect(messageMatchesContacts(msg, contacts)).toBe(true)
  })

  it('matches a Sent message addressed to the opponent', () => {
    const msg = makeMessage({
      direction: 'out',
      from_address: 'spielplanung@volleyball.kscw.ch',
      to_addresses: 'opp@club.ch',
      cc_addresses: null,
    })
    expect(messageMatchesContacts(msg, contacts)).toBe(true)
  })

  it('matches a Sent message that only Cc’s the opponent', () => {
    const msg = makeMessage({
      direction: 'out',
      from_address: 'spielplanung@volleyball.kscw.ch',
      to_addresses: 'someone@else.ch',
      cc_addresses: 'opp@club.ch',
    })
    expect(messageMatchesContacts(msg, contacts)).toBe(true)
  })
})

// The reported bug: HU23 and DU23 vs VBC Limmattal are two opponent rows of one
// club sharing a single contact, and even the opponent team name ("VBC
// Limmattal 1") is identical — only the KSCW team code in the subject tells them
// apart. The whole DU23 thread was landing on the HU23 card.
describe('KSCW team code dominance (HU23 vs DU23)', () => {
  const shared = 'kontakt@vbclimmattal.ch'
  const hu23 = makeOpponent({ id: 'hu23', club_name: 'VBC Limmattal', team_name: 'VBC Limmattal 1', contact_email: shared })
  const du23 = makeOpponent({ id: 'du23', club_name: 'VBC Limmattal', team_name: 'VBC Limmattal 1', contact_email: shared })
  const oc: OpponentContacts[] = [
    { opp: hu23, contacts: contactAddressSet(hu23), aliases: ['HU23-1'] },
    { opp: du23, contacts: contactAddressSet(du23), aliases: ['DU23-1'] },
  ]
  const mail = (subject: string, over: Partial<MailboxMessage> = {}) =>
    makeMessage({ subject, from_address: shared, ...over })

  it('routes a DU23 invite to DU23 despite the identical opponent name', () => {
    expect(bestOpponentForMessage(mail('VBC Limmattal 1 – KSC Wiedikon DU23-1 / Spielplanung 2026/27'), oc)?.id).toBe('du23')
  })

  it('routes the HU23 sibling to HU23 (no DU23/HU23 substring collision)', () => {
    expect(bestOpponentForMessage(mail('VBC Limmattal 1 – KSC Wiedikon HU23-1 / Spielplanung 2026/27'), oc)?.id).toBe('hu23')
  })

  it('matches the bare gender+age code when the squad number is absent', () => {
    expect(bestOpponentForMessage(mail('Re: Fw: Spielplannung Limmattal Du23 3. Stärkeklasse'), oc)?.id).toBe('du23')
  })

  it('keeps the whole DU23 thread off the HU23 card', () => {
    const msgs = [
      mail('Re: Fw: Spielplannung Limmattal Du23 3. Stärkeklasse', { id: 1 }),
      mail('Re: VBC Limmattal 1 – KSC Wiedikon DU23-1 / Spielplanung 2026/27', { id: 2 }),
      mail('→ VBC Limmattal 1 – KSC Wiedikon DU23-1 / Spielplanung 2026/27', { id: 3, direction: 'out', to_addresses: shared }),
    ]
    const c = classifyMessages(msgs, oc)
    expect(messagesForOwner(msgs, 'du23', c)).toHaveLength(3)
    expect(messagesForOwner(msgs, 'hu23', c)).toEqual([])
  })

  it('badges the row chip with the confident owner', () => {
    const msg = mail('VBC Limmattal 1 – KSC Wiedikon DU23-1 / Spielplanung 2026/27')
    const c = classifyMessages([msg], oc)
    expect(chipOpponentForMessage(c.get(msg.id), oc)?.id).toBe('du23')
  })

  it('shows no chip when the contact is shared and nothing is named', () => {
    const msg = mail('Re: Spielplanung')
    const c = classifyMessages([msg], oc)
    expect(chipOpponentForMessage(c.get(msg.id), oc)).toBeNull()
  })
})

// The KSCW team (the code after the "KSCW" / "KSC Wiedikon" marker) is
// authoritative. Opponents constantly reuse our own codes — "VBC Embrach D1",
// "Volley S9 D2", "Wädivolley H2", "VBC Voléro Zürich Legends (H3)" — and that
// code sits BEFORE the marker, so it must never outrank our team after it.
// Subjects below are verbatim shapes seen in the live mailbox.
describe('KSCW team takes priority over the opponent designation', () => {
  const shared = 'kontakt@club.ch'
  const mail = (subject: string, over: Partial<MailboxMessage> = {}) =>
    makeMessage({ subject, from_address: shared, ...over })

  it('"KSCW D2 / VBC Embrach D1" → our D2, not our D1', () => {
    const ourD2 = makeOpponent({ id: 'our-d2', club_name: 'VBC Embrach', team_name: 'VBC Embrach D1', contact_email: shared })
    const ourD1 = makeOpponent({ id: 'our-d1', club_name: 'VBC Embrach', team_name: 'VBC Embrach D3', contact_email: shared })
    const oc: OpponentContacts[] = [
      { opp: ourD2, contacts: contactAddressSet(ourD2), aliases: ['D2'] },
      { opp: ourD1, contacts: contactAddressSet(ourD1), aliases: ['D1'] },
    ]
    expect(bestOpponentForMessage(mail('Re: Spielplanung - KSCW D2 / VBC Embrach D1'), oc)?.id).toBe('our-d2')
  })

  it('"Volley S9 D2 (KSCW D4)" → our D4, not our D2', () => {
    const ourD4 = makeOpponent({ id: 'our-d4', club_name: 'Volley S9', team_name: 'Volley S9 D2', contact_email: shared })
    const ourD2 = makeOpponent({ id: 'our-d2', club_name: 'Volley S9', team_name: 'Volley S9 D5', contact_email: shared })
    const oc: OpponentContacts[] = [
      { opp: ourD4, contacts: contactAddressSet(ourD4), aliases: ['D4'] },
      { opp: ourD2, contacts: contactAddressSet(ourD2), aliases: ['D2'] },
    ]
    expect(bestOpponentForMessage(mail('Auswärtsspiel bestätigt – Volley S9 D2 (KSCW D4)'), oc)?.id).toBe('our-d4')
  })

  it('"VBC Voléro Zürich Legends (H3) – KSC Wiedikon Legends" → our Legends, not our H3', () => {
    const ourLegends = makeOpponent({ id: 'our-leg', club_name: 'VBC Voléro Zürich', team_name: 'VBC Voléro Zürich Legends (H3)', contact_email: shared })
    const ourH3 = makeOpponent({ id: 'our-h3', club_name: 'VBC Voléro Zürich', team_name: 'VBC Voléro Zürich H5', contact_email: shared })
    const oc: OpponentContacts[] = [
      { opp: ourLegends, contacts: contactAddressSet(ourLegends), aliases: ['Legends'] },
      { opp: ourH3, contacts: contactAddressSet(ourH3), aliases: ['H3'] },
    ]
    expect(bestOpponentForMessage(mail('VBC Voléro Zürich Legends (H3) – KSC Wiedikon Legends / Spielplanung 2026/27'), oc)?.id).toBe('our-leg')
  })

  it('routes a confirmation in the "(KSCW HU23-1)" parenthetical form', () => {
    const opp = makeOpponent({ id: 'hu23', club_name: 'Volley Uster', team_name: 'Volley Uster HJA', contact_email: shared })
    const oc: OpponentContacts[] = [{ opp, contacts: contactAddressSet(opp), aliases: ['HU23-1'] }]
    expect(bestOpponentForMessage(mail('Heimspiel bestätigt – Volley Uster HJA (KSCW HU23-1)'), oc)?.id).toBe('hu23')
  })
})

describe('word-boundary matching', () => {
  const shared = 's@c.ch'
  const h2 = makeOpponent({ id: 'h2', club_name: 'Club', team_name: 'Club H2', contact_email: shared })
  const h23 = makeOpponent({ id: 'h23', club_name: 'Club', team_name: 'Club H23', contact_email: shared })
  const oc: OpponentContacts[] = [
    { opp: h2, contacts: contactAddressSet(h2), aliases: ['H2'] },
    { opp: h23, contacts: contactAddressSet(h23), aliases: ['H23'] },
  ]

  it('does not let H2 match a subject that only names H23', () => {
    const msg = makeMessage({ subject: 'Club H23 – Spielplanung', from_address: shared })
    expect(bestOpponentForMessage(msg, oc)?.id).toBe('h23')
  })
})

describe('manual assignment override', () => {
  const shared = 'kontakt@vbclimmattal.ch'
  const hu23 = makeOpponent({ id: 'hu23', club_name: 'VBC Limmattal', team_name: 'VBC Limmattal 1', contact_email: shared })
  const du23 = makeOpponent({ id: 'du23', club_name: 'VBC Limmattal', team_name: 'VBC Limmattal 1', contact_email: shared })
  const oc: OpponentContacts[] = [
    { opp: hu23, contacts: contactAddressSet(hu23), aliases: ['HU23-1'] },
    { opp: du23, contacts: contactAddressSet(du23), aliases: ['DU23-1'] },
  ]

  it('beats auto-classification', () => {
    // Subject says DU23, but the spielplaner pinned it to HU23.
    const msg = makeMessage({ subject: 'VBC Limmattal 1 – KSC Wiedikon DU23-1 / Spielplanung 2026/27', from_address: shared, assigned_opponent: 'hu23' as unknown as number })
    const c = classifyMessages([msg], oc)
    expect(c.get(msg.id)?.ownerId).toBe('hu23')
    expect(messagesForOwner([msg], 'hu23', c)).toHaveLength(1)
    expect(messagesForOwner([msg], 'du23', c)).toEqual([])
  })

  it('forces the email onto the assigned thread even with no address match', () => {
    const msg = makeMessage({ subject: 'Forwarded thing', from_address: 'random@stranger.ch', assigned_opponent: 'du23' as unknown as number })
    const c = classifyMessages([msg], oc)
    expect(c.get(msg.id)?.ownerId).toBe('du23')
    expect(messagesForOwner([msg], 'du23', c)).toHaveLength(1)
  })

  it('falls back to auto when the assigned opponent no longer exists', () => {
    const msg = makeMessage({ subject: 'VBC Limmattal 1 – KSC Wiedikon DU23-1 / Spielplanung 2026/27', from_address: shared, assigned_opponent: 'deleted-row' as unknown as number })
    const c = classifyMessages([msg], oc)
    expect(c.get(msg.id)?.ownerId).toBe('du23')
  })
})

describe('thread inheritance for stripped replies', () => {
  const shared = 'kontakt@vbclimmattal.ch'
  const hu23 = makeOpponent({ id: 'hu23', club_name: 'VBC Limmattal', team_name: 'VBC Limmattal 1', contact_email: shared })
  const du23 = makeOpponent({ id: 'du23', club_name: 'VBC Limmattal', team_name: 'VBC Limmattal 1', contact_email: shared })
  const oc: OpponentContacts[] = [
    { opp: hu23, contacts: contactAddressSet(hu23), aliases: ['HU23-1'] },
    { opp: du23, contacts: contactAddressSet(du23), aliases: ['DU23-1'] },
  ]

  it('inherits the team for a reply that dropped the code, via In-Reply-To', () => {
    const root = makeMessage({ id: 1, message_id: '<root@x>', subject: 'VBC Limmattal 1 – KSC Wiedikon DU23-1 / Spielplanung 2026/27', from_address: shared })
    const reply = makeMessage({ id: 2, message_id: '<r2@x>', in_reply_to: '<root@x>', subject: 'Re: Termine', from_address: shared })
    const c = classifyMessages([root, reply], oc)
    expect(c.get(2)?.ownerId).toBe('du23')
  })

  it('does not inherit an owner the reply has no contact link to', () => {
    const other = 'someone@unrelated.ch'
    const root = makeMessage({ id: 1, message_id: '<root@x>', subject: 'KSC Wiedikon DU23-1 / Spielplanung 2026/27', from_address: shared })
    const reply = makeMessage({ id: 2, message_id: '<r2@x>', in_reply_to: '<root@x>', subject: 'Re: Termine', from_address: other })
    const c = classifyMessages([root, reply], oc)
    expect(c.get(2)?.ownerId).toBeNull()
    expect(c.get(2)?.candidateIds).toEqual([])
  })
})
