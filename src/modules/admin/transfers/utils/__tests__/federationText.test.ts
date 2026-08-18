// The letter is the only thing this page produces that leaves the club, so the
// two properties defended here are about what a foreign federation receives: it
// must be ASKED a question, never accused of losing players, and the compose
// link must never claim a reason that is not the real one.
//
// ⚠ Nothing in this suite translates anything. The letter is ALWAYS ENGLISH by
// design — the recipient is a foreign national federation and the language the
// KSCW admin happens to read the app in says nothing about what they read.

import { describe, it, expect } from 'vitest'
import {
  splitEmails,
  prettyFederationName,
  memberRequestLine,
  visRequestText,
  buildRequestMailto,
} from '../federationText'
import { MAILTO_MAX } from '../../constants'
import type { TransferMember } from '../../types'

const member = (over: Partial<TransferMember> = {}): TransferMember => ({
  id: '1',
  first_name: 'Tobias',
  last_name: 'Armstrong',
  birthdate: '1994-08-07',
  email: 'to.armstr@gmail.com',
  ...over,
})

describe('splitEmails — VIS publishes a list in one column', () => {
  it('splits on semicolons and commas and drops the gaps', () => {
    expect(splitEmails('presidenza@federvolley.it; segreteria@federvolley.it'))
      .toEqual(['presidenza@federvolley.it', 'segreteria@federvolley.it'])
    expect(splitEmails('a@x.ch , b@x.ch,')).toEqual(['a@x.ch', 'b@x.ch'])
  })

  it('answers an empty list for an empty column', () => {
    expect(splitEmails(null)).toEqual([])
    expect(splitEmails('  ')).toEqual([])
  })
})

describe('prettyFederationName — VIS shouts, the letter should not', () => {
  it('title-cases an all-caps name and lowercases the connectors', () => {
    expect(prettyFederationName('FEDERACIÓN ESPAÑOLA DE VOLEIBOL'))
      .toBe('Federación Española de Voleibol')
  })

  it('keeps a leading connector capitalised', () => {
    expect(prettyFederationName('EL SALVADOR VOLLEYBALL FEDERATION'))
      .toBe('El Salvador Volleyball Federation')
  })

  it('leaves the federations that really do spell themselves in capitals alone', () => {
    expect(prettyFederationName('FIVB')).toBe('FIVB')
  })

  // The obvious "short tokens are acronyms" heuristic is wrong for this data:
  // all 69 directory rows hold long-form names, so every short token is either a
  // connector or a real word.
  it('does not mistake a short word for an acronym', () => {
    expect(prettyFederationName('VOLLEYBALL NEW ZEALAND INC.'))
      .toBe('Volleyball New Zealand Inc.')
  })

  it('trusts a name VIS already stores mixed-case', () => {
    expect(prettyFederationName('Nederlandse Volleybalbond (Nevobo)'))
      .toBe('Nederlandse Volleybalbond (Nevobo)')
  })
})

describe('memberRequestLine — the identity a federation needs to find a player', () => {
  it('gives name, Swiss-format date of birth and email', () => {
    expect(memberRequestLine(member()))
      .toBe('Tobias Armstrong, date of birth 07.08.1994, to.armstr@gmail.com')
  })

  it('drops what is missing rather than printing a gap', () => {
    expect(memberRequestLine(member({ birthdate: null, email: null })))
      .toBe('Tobias Armstrong')
  })
})

describe('visRequestText — a question, never an accusation', () => {
  it('asks about one player in the singular', () => {
    const text = visRequestText([member()], 'Federazione Italiana Pallavolo')
    expect(text).toContain('The player below plays for KSC Wiedikon')
    expect(text).toContain('Could you please confirm whether the player is registered')
    expect(text).toContain('Federazione Italiana Pallavolo')
    expect(text).toContain('Tobias Armstrong, date of birth 07.08.1994')
    expect(text).not.toContain('1. ')
  })

  it('numbers the list and switches to the plural for several', () => {
    const text = visRequestText(
      [member(), member({ id: '2', first_name: 'Anna', last_name: 'Mueller', email: null })],
      'German Volleyball Federation',
    )
    expect(text).toContain('The 2 players below play for KSC Wiedikon')
    expect(text).toContain('Could you please confirm whether they are registered')
    expect(text).toContain('1. Tobias Armstrong')
    expect(text).toContain('2. Anna Mueller')
  })

  // `in_vis === false` is a name-match miss against a federation of origin that
  // was usually only GUESSED from nationality, and never-checked members are on
  // the same list — so asserting the players are missing would frequently be
  // simply untrue.
  it('never asserts that the players are missing', () => {
    const text = visRequestText([member()], 'German Volleyball Federation')
    expect(text).not.toMatch(/missing|not registered|failed/i)
  })
})

describe('buildRequestMailto — the three genuinely different cases', () => {
  const short = visRequestText([member()], 'German Volleyball Federation')

  it('prefills the whole letter when it fits', () => {
    const r = buildRequestMailto('info@volleyball.de', 'Subject', short)
    expect(r.state).toBe('bodyIncluded')
    expect(r.href).toContain('mailto:info@volleyball.de')
    expect(r.href).toContain('&body=')
    expect(r.href.length).toBeLessThanOrEqual(MAILTO_MAX)
  })

  // Some clients TRUNCATE an over-long mailto silently, which would send a
  // letter missing its last players while looking complete. A pre-addressed
  // empty message plus "paste the text" is the honest fallback.
  it('drops the body — not the link — once the letter is too long', () => {
    const r = buildRequestMailto('info@volleyball.de', 'Subject', 'x'.repeat(2000))
    expect(r.state).toBe('tooLong')
    expect(r.href).toContain('subject=Subject')
    expect(r.href).not.toContain('&body=')
  })

  // ⚠ This case used to be reported as "too long to prefill an email", ~40px
  // below the line that already said VIS lists no address for this federation.
  it('says "no address" when there is no address, not "too long"', () => {
    expect(buildRequestMailto(undefined, 'Subject', short)).toEqual({ href: '', state: 'noAddress' })
    expect(buildRequestMailto('   ', 'Subject', short).state).toBe('noAddress')
  })
})
