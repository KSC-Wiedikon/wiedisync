/**
 * Unit tests for the basketball club-portal email copy (terminplanung-emails.js →
 * bbClubInviteEmail / bbClubResponseReceiptEmail).
 *
 * These emails go to ~63 opponent clubs, unattended, in the run-up to a hard
 * association deadline. The cases below are the ones that would actually cause
 * damage if they regressed:
 *  • the volleyball copy leaking in (VolleyManager / bilingual / VB signature) —
 *    the module is shared, so a careless edit is one paste away
 *  • the WSR Art. 18 framing or the 1.-Liga exclusion disappearing, which would
 *    make the mail either pointless or actively misleading
 *  • the link or the expiry not reaching the body
 *
 * Hermetic: pure string builders, no DB, no network, no mail transport.
 */
import { describe, it, expect } from 'vitest'
import { bbClubInviteEmail, bbClubResponseReceiptEmail } from '../terminplanung-emails.js'

const VARS = {
  club: 'BC Zürich 93',
  season: '2026/27',
  url: 'https://spielplanung.wiedisync.kscw.ch/terminplanung/bb/0123456789abcdef0123456789abcdef',
  expires: '30.06.2027',
}

describe('bbClubInviteEmail', () => {
  it('names the club and the season in the subject', () => {
    const { subject } = bbClubInviteEmail(VARS)
    expect(subject).toBe('Spielplanung 2026/27 – KSC Wiedikon / BC Zürich 93')
  })

  it('falls back to a club-less subject rather than rendering an empty slash', () => {
    expect(bbClubInviteEmail({ season: '2026/27' }).subject).toBe('Spielplanung 2026/27 – KSC Wiedikon')
  })

  it('carries the WSR Art. 18 reason and the Spielplansitzung date', () => {
    const { text, html } = bbClubInviteEmail(VARS)
    for (const s of [text, html]) {
      expect(s).toContain('WSR Art. 18')
      expect(s).toContain('05.09.2026')
    }
  })

  it('states the 1.-Liga exclusion with the 17.08 availability deadline', () => {
    // Anleitung Spielplanung Vorrunde 2026: those leagues are scheduled by
    // ProBasket from the Excel, so promising a negotiation there would be a lie.
    const { text, html } = bbClubInviteEmail(VARS)
    for (const s of [text, html]) {
      expect(s).toContain('Damen 1. Liga')
      expect(s).toContain('Herren 1. Liga')
      expect(s).toContain('17.08.2026')
    }
  })

  it('puts the link and the expiry in the body', () => {
    const { text, html } = bbClubInviteEmail(VARS)
    expect(text).toContain(VARS.url)
    expect(html).toContain(VARS.url)
    expect(text).toContain('bis 30.06.2027 gültig')
  })

  it('omits the validity clause when no expiry is known', () => {
    const { text } = bbClubInviteEmail({ ...VARS, expires: '' })
    expect(text).toContain('Der Link gilt für alle eure Teams gegen KSC Wiedikon.')
    expect(text).not.toContain('gültig')
  })

  it('is German only — no English half, unlike the volleyball invite', () => {
    const { text, html } = bbClubInviteEmail(VARS)
    for (const s of [text, html]) {
      expect(s).not.toContain('Best regards')
      expect(s).not.toContain('KSC Wiedikon invites you')
    }
  })

  it('never mentions VolleyManager and never signs as volleyball', () => {
    const { text, html } = bbClubInviteEmail(VARS)
    expect(text + html).not.toContain('VolleyManager')
    expect(html).toContain('spielplanung@basketball.kscw.ch')
    expect(html).not.toContain('spielplanung@volleyball.kscw.ch')
    // The volleyball scheduler names must not ride along on a basketball mail.
    expect(html).not.toContain('Luca')
  })

  it('renders the basketball layout, not the volleyball one', () => {
    const { html } = bbClubInviteEmail(VARS)
    expect(html).toContain('#F97316') // ACCENT.bb — the basketball stripe
    expect(html).toContain('Termine ansehen und bestätigen')
  })

  it('reminder variant adds the ignore hint and the Umtriebsgebühr deadline', () => {
    const plain = bbClubInviteEmail(VARS)
    const rem = bbClubInviteEmail({ ...VARS, reminder: true })
    expect(plain.text).not.toContain('ignorieren')
    expect(rem.text).toContain('ignorieren')
    expect(rem.text).toContain('ohne Umtriebsgebühr')
    expect(rem.html).toContain('Erinnerung')
  })

  it('escapes a club name that contains HTML', () => {
    const { html } = bbClubInviteEmail({ ...VARS, club: '<script>x</script>', season: '<b>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;b&gt;')
  })
})

describe('bbClubResponseReceiptEmail', () => {
  const ROWS = [
    { date: '10.10.2026', time: '13:30', hall: 'KWI A', game: 'HU16 – BC Zürich 93 HU16R', status: 'Bestätigt' },
    { date: '07.11.2026', time: '16:00', hall: 'KWI C', game: 'DU14 – BC Zürich 93 DU16', status: 'Abgelehnt' },
  ]

  it('lists every answered game in both parts', () => {
    const { text, html } = bbClubResponseReceiptEmail({ club: 'BC Zürich 93', rows: ROWS })
    for (const s of [text, html]) {
      expect(s).toContain('10.10.2026')
      expect(s).toContain('Bestätigt')
      expect(s).toContain('07.11.2026')
      expect(s).toContain('Abgelehnt')
    }
  })

  it('names the club in the subject and points at the Spielplansitzung', () => {
    const { subject, text } = bbClubResponseReceiptEmail({ club: 'BC Zürich 93', rows: ROWS })
    expect(subject).toBe('Rückmeldung erhalten – KSC Wiedikon / BC Zürich 93')
    expect(text).toContain('05.09.2026')
  })

  it('survives an empty row list without throwing', () => {
    const { text, html } = bbClubResponseReceiptEmail({ club: 'X', rows: [] })
    expect(text).toContain('Rückmeldung erhalten')
    expect(typeof html).toBe('string')
  })
})

/**
 * The invite must describe the page the club will actually see.
 *
 * Since the opponent-picks flow (migrations 289/292) most invites open on a list of FREE dates
 * with no offers at all, and the original copy told every club to "confirm or decline each
 * game" — instructions for a section that would be empty. This goes to 63 clubs, so the branch
 * is worth pinning.
 */
describe('bbClubInviteEmail — instructions match what the link shows', () => {
  const BASE = { club: 'BC Uster', season: '2026/27', url: 'https://x/y', expires: '30.06.2027' }

  it('tells a club with free pitches to pick dates, and says the pick is held', () => {
    const { text } = bbClubInviteEmail({ ...BASE, pickable: 40, offers: 0 })
    expect(text).toContain('noch frei')
    expect(text).toContain('ankreuzen')
    // Must NOT promise a reservation — a pick holds nothing (migration 296).
    expect(text).not.toContain('reserviert für')
    expect(text).toContain('noch keine Reservation')
    expect(text).toContain('Uhrzeit und Halle teilen wir euch zu')
    // Must NOT tell them to confirm games that do not exist for them yet.
    expect(text).not.toContain('Pro Spiel einen Termin bestätigen')
  })

  it('keeps the confirm/decline wording when we have offered games and nothing is pickable', () => {
    const { text } = bbClubInviteEmail({ ...BASE, pickable: 0, offers: 3 })
    expect(text).toContain('Pro Spiel einen Termin bestätigen')
    expect(text).not.toContain('ankreuzen')
  })

  it('covers both when the club has offers AND free pitches', () => {
    const { text } = bbClubInviteEmail({ ...BASE, pickable: 12, offers: 2 })
    expect(text).toContain('ankreuzen')
    expect(text).toContain('Pro Spiel einen Termin bestätigen')
  })

  it('defaults to the old confirm/decline copy when the caller passes no counts', () => {
    const { text } = bbClubInviteEmail(BASE)
    expect(text).toContain('Pro Spiel einen Termin bestätigen')
  })
})
