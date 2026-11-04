// The Einsatzliste alert 2 h before a game (migration 444): when the cron reads the list, when
// it compares it, and the email. Volleymanager is never read here; no mail leaves.
import { describe, expect, it, vi } from 'vitest'

import {
  createEinsatzlisteAlert,
  EINSATZLISTE_ALERT_LEAD_MS,
  einsatzlisteAlertContent,
  einsatzlisteAlertDue,
  vmReadDue,
} from '../einsatzliste-alert.js'
import { VM_CHECK_LEAD_MS } from '../../../kscw-endpoints/src/vm-sheet-check.js'

// Sat 07.11.2026 14:00 Zurich (CET = UTC+1) = 13:00Z.
const KICKOFF = Date.UTC(2026, 10, 7, 13, 0)
const MIN = 60 * 1000
const GAME = {
  id: 509, game_id: 'vb_406300', type: 'away', date: '2026-11-07', time: '14:00:00', kscw_team: 3,
  home_team: 'VBC Stäfa H1', away_team: 'KSC Wiedikon H3', team_name: 'H3', auto_list: false,
}
const iso = (ms) => new Date(ms).toISOString()

describe('vmReadDue', () => {
  it('nothing before kickoff −2 h', () => {
    expect(vmReadDue(GAME, KICKOFF - EINSATZLISTE_ALERT_LEAD_MS - MIN)).toBe(false)
  })

  it('at kickoff −2 h, once', () => {
    const now = KICKOFF - EINSATZLISTE_ALERT_LEAD_MS
    expect(vmReadDue(GAME, now)).toBe(true)
    expect(vmReadDue({ ...GAME, vm_status: 'ok', vm_checked_at: iso(now) }, now + 5 * MIN)).toBe(false)
  })

  it('a Recheck before −2 h does not replace it', () => {
    const now = KICKOFF - EINSATZLISTE_ALERT_LEAD_MS
    expect(vmReadDue({ ...GAME, vm_status: 'ok', vm_checked_at: iso(now - 30 * MIN) }, now)).toBe(true)
  })

  it('the −2 h read does not replace the −45 min read', () => {
    const early = { ...GAME, vm_status: 'ok', vm_checked_at: iso(KICKOFF - EINSATZLISTE_ALERT_LEAD_MS) }
    expect(vmReadDue(early, KICKOFF - VM_CHECK_LEAD_MS - MIN)).toBe(false)
    expect(vmReadDue(early, KICKOFF - VM_CHECK_LEAD_MS)).toBe(true)
  })

  it('after the −45 min read: nothing more, also when it failed', () => {
    const at = KICKOFF - VM_CHECK_LEAD_MS
    expect(vmReadDue({ ...GAME, vm_status: 'ok', vm_checked_at: iso(at) }, at + 5 * MIN)).toBe(false)
    expect(vmReadDue({ ...GAME, vm_status: 'failed', vm_checked_at: iso(at) }, at + 5 * MIN)).toBe(false)
  })

  it('busy read nothing: retried at −2 h and at −45 min', () => {
    const early = KICKOFF - EINSATZLISTE_ALERT_LEAD_MS
    expect(vmReadDue({ ...GAME, vm_status: 'busy', vm_checked_at: iso(early) }, early + 5 * MIN)).toBe(true)
    const late = KICKOFF - VM_CHECK_LEAD_MS
    expect(vmReadDue({ ...GAME, vm_status: 'busy', vm_checked_at: iso(late) }, late + 5 * MIN)).toBe(true)
  })

  it('a failed −2 h read waits for −45 min', () => {
    const early = KICKOFF - EINSATZLISTE_ALERT_LEAD_MS
    const failed = { ...GAME, vm_status: 'failed', vm_checked_at: iso(early) }
    expect(vmReadDue(failed, early + 5 * MIN)).toBe(false)
    expect(vmReadDue(failed, KICKOFF - VM_CHECK_LEAD_MS)).toBe(true)
  })

  it('a team with the automatic push: no −2 h read, the −45 min read stays', () => {
    const auto = { ...GAME, auto_list: true }
    expect(vmReadDue(auto, KICKOFF - EINSATZLISTE_ALERT_LEAD_MS)).toBe(false)
    expect(vmReadDue(auto, KICKOFF - VM_CHECK_LEAD_MS)).toBe(true)
  })

  it('stops 3 h after kickoff', () => {
    expect(vmReadDue(GAME, KICKOFF + 3 * 60 * MIN)).toBe(true)
    expect(vmReadDue(GAME, KICKOFF + 3 * 60 * MIN + 1)).toBe(false)
  })
})

describe('einsatzlisteAlertDue', () => {
  const read = KICKOFF - EINSATZLISTE_ALERT_LEAD_MS + MIN
  const fresh = { ...GAME, vm_status: 'ok', vm_list_at: iso(read), vm_alert_checked_at: null }

  it('a list read since −2 h, not compared yet', () => {
    expect(einsatzlisteAlertDue(fresh, read)).toBe(true)
    expect(einsatzlisteAlertDue({ ...fresh, vm_status: 'no_list' }, read)).toBe(true)
  })

  it('compared once', () => {
    expect(einsatzlisteAlertDue({ ...fresh, vm_alert_checked_at: iso(read) }, read + 5 * MIN)).toBe(false)
  })

  it('never on a list older than −2 h', () => {
    const old = { ...fresh, vm_list_at: iso(KICKOFF - EINSATZLISTE_ALERT_LEAD_MS - MIN) }
    expect(einsatzlisteAlertDue(old, read)).toBe(false)
  })

  it('never when the latest read got no answer', () => {
    for (const vm_status of ['busy', 'failed', 'unavailable']) {
      expect(einsatzlisteAlertDue({ ...fresh, vm_status }, read)).toBe(false)
    }
  })

  it('never for a team with the automatic push', () => {
    expect(einsatzlisteAlertDue({ ...fresh, auto_list: true }, read)).toBe(false)
  })

  it('never at or after kickoff', () => {
    expect(einsatzlisteAlertDue(fresh, KICKOFF - 1)).toBe(true)
    expect(einsatzlisteAlertDue(fresh, KICKOFF)).toBe(false)
  })
})

describe('einsatzlisteAlertContent', () => {
  const differs = {
    verdict: 'differs',
    nominated_without_yes: [{ name: 'Muster A.', rsvp: 'declined' }, { name: 'Beispiel B.', rsvp: 'none' }],
    yes_not_nominated: [{ name: 'Test T.' }],
  }
  const noList = { verdict: 'no_list', nominated_without_yes: [], yes_not_nominated: [] }

  it('differs: says who, and links to the match roster', () => {
    const c = einsatzlisteAlertContent({ locale: 'en', firstName: 'Anna', game: GAME, comparison: differs })
    expect(c.subject).toBe('WiediSync — Einsatzliste differs from RSVPs: VBC Stäfa H1 vs KSC Wiedikon H3, Sat, 07.11.2026, 14:00')
    expect(c.text).toContain('On the list, no Yes: Muster A. (No), Beispiel B. (No answer yet)')
    expect(c.text).toContain('Said Yes, not on the list: Test T.')
    expect(c.text).toContain('/games/509/roster')
    expect(c.html).toContain('Muster A. (No)')
  })

  it('no list: no name lines', () => {
    const c = einsatzlisteAlertContent({ locale: 'de', firstName: 'Anna', game: GAME, comparison: noList })
    expect(c.subject).toContain('Keine Einsatzliste')
    expect(c.text).toContain('Für H3 ist in Volleymanager keine Einsatzliste erfasst.')
    expect(c.text).not.toContain('Auf der Liste')
  })

  it.each(['de', 'gsw', 'en', 'fr', 'it'])('%s: complete for both results', (locale) => {
    for (const comparison of [differs, noList]) {
      const c = einsatzlisteAlertContent({ locale, firstName: 'Anna', game: GAME, comparison })
      expect(c.subject).toBeTruthy()
      expect(c.html).toContain('H3')
      expect(c.text).not.toContain('undefined')
    }
  })

  it('escapes a name in the HTML', () => {
    const comparison = { ...noList, verdict: 'differs', yes_not_nominated: [{ name: '<b>X</b>' }] }
    const c = einsatzlisteAlertContent({ locale: 'en', game: GAME, comparison })
    expect(c.html).not.toContain('<b>X</b>')
  })
})

describe('createEinsatzlisteAlert', () => {
  /** Only the calls run() makes: the stored list, members, RSVPs, the squad, recipients. */
  function fakeDb({ check, members = [], rsvps = [], roster = [], staff = [] }) {
    const updates = []
    const rowsFor = { members, participations: rsvps, member_teams: roster, game_guests: [] }
    const db = (table) => {
      const b = {
        where: () => b, whereIn: () => b, join: () => b,
        first: async () => (table === 'game_vm_sheets' ? check : undefined),
        select: async () => rowsFor[table] ?? [],
        update: async (row) => { updates.push({ table, row }) },
      }
      return b
    }
    db.raw = async () => ({ rows: staff })
    return { db, updates }
  }

  const list = { players: [{ license_nr: '111', last_name: 'Muster', first_initial: 'A.' }], coaches: [] }
  const staff = [{ member: 8, email: 'coach@example.ch', first_name: 'Cora', language: 'english' }]
  const answered = { status: 'ok', list, list_at: iso(KICKOFF - EINSATZLISTE_ALERT_LEAD_MS) }

  it('a matching list: no email, marked compared', async () => {
    const { db, updates } = fakeDb({
      check: answered,
      members: [{ id: 12, license_nr: '111' }],
      rsvps: [{ member: 12, status: 'confirmed' }],
      roster: [{ id: 12, first_name: 'Anna', last_name: 'Muster' }],
      staff,
    })
    const sendJobs = vi.fn()
    const r = await createEinsatzlisteAlert({ database: db, emailReminders: { sendJobs } }).run(GAME)
    expect(r.verdict).toBe('matches')
    expect(sendJobs).not.toHaveBeenCalled()
    expect(updates).toHaveLength(1)
    expect(updates[0].row.alert_checked_at).toBeInstanceOf(Date)
  })

  it('no list: one email per coach or team responsible, logged under the game', async () => {
    const { db, updates } = fakeDb({ check: { status: 'no_list', list: null, list_at: answered.list_at }, staff })
    const sendJobs = vi.fn(async (_kind, jobs) => ({ emails: jobs.length, sent: jobs.length, skipped: 0, failed: 0 }))
    const r = await createEinsatzlisteAlert({ database: db, emailReminders: { sendJobs } }).run(GAME)
    expect(r).toMatchObject({ verdict: 'no_list', sent: 1, failed: 0 })
    const [kind, jobs, build] = sendJobs.mock.calls[0]
    expect(kind).toBe('einsatzliste')
    expect(jobs).toEqual([{ memberId: 8, items: [expect.objectContaining({ activity_type: 'game', activity_id: '509', email: 'coach@example.ch' })] }])
    expect(build({ locale: 'en', firstName: 'Cora' }).subject).toContain('No Einsatzliste')
    expect(updates).toHaveLength(1)
  })

  it('a failed send is not marked, so the next tick retries', async () => {
    const { db, updates } = fakeDb({ check: { status: 'no_list', list: null, list_at: answered.list_at }, staff })
    const sendJobs = vi.fn(async () => ({ emails: 1, sent: 0, skipped: 0, failed: 1 }))
    const r = await createEinsatzlisteAlert({ database: db, emailReminders: { sendJobs } }).run(GAME)
    expect(r.failed).toBe(1)
    expect(updates).toEqual([])
  })
})
