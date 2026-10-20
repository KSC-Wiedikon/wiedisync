/**
 * Edit-time ClubDesk push flag (2026-10-20) — flagClubdeskPush and the pure
 * rules around it in clubdesk-update.js, plus the conflict-staging skip that
 * makes a flagged field show up as a push (step 3) instead of a conflict
 * (step 2).
 *
 * Why it matters: on 20.10.2026 seven DU18 emails were rewritten by raw SQL
 * without a flag; the next sync-down staged all seven as conflicts and the
 * operator had to "refuse" their own edit to get it pushed. Contact edits now
 * name the field in clubdesk_push_changes at edit time, and the staging pass
 * drops fields that are already queued.
 *
 * Hermetic — a knex stand-in supporting exactly the queries the helper makes.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  flagClubdeskPush, pushFlagValue, contactValueChanged, mergePushChanges,
  dropPushQueuedConflicts, CD_PUSH_FLAG_FIELDS, CD_PUSH_FLAG_CONTACT_FIELDS,
} from '../clubdesk-update.js'

/** members rows by id; records every update and user_logs insert. */
function fakeDb(members) {
  const updates = []
  const logs = []
  const selects = []
  const db = (table) => {
    const q = {
      _where: null,
      whereIn(col, ids) { q._ids = ids.map(String); return q },
      where(a, b) { q._where = typeof a === 'object' ? a : { [a]: b }; return q },
      async select(...cols) {
        selects.push(cols)
        return Object.values(members)
          .filter((m) => q._ids.includes(String(m.id)))
          .map((m) => Object.fromEntries(cols.map((c) => [c, m[c]])))
      },
      async first() {
        if (table === 'members' && q._where?.user) return { id: 99 }
        return undefined
      },
      async update(patch) {
        updates.push({ table, where: q._where, patch })
        const m = members[q._where?.id]
        if (m) Object.assign(m, patch)
        return 1
      },
      async insert(row) { logs.push({ table, row }); return [1] },
    }
    return q
  }
  db.updates = updates
  db.logs = logs
  db.selects = selects
  return db
}

const linked = (over = {}) => ({ id: 120, clubdesk_id: '1000120', clubdesk_push_changes: null, ...over })

describe('CD_PUSH_FLAG_FIELDS', () => {
  it('names exactly the contact cells the UPDATE row pushes, plus the hook’s long-standing list', () => {
    expect(CD_PUSH_FLAG_CONTACT_FIELDS).toEqual(['email', 'phone', 'address', 'postal_code', 'city', 'birthdate'])
    for (const f of CD_PUSH_FLAG_CONTACT_FIELDS) expect(CD_PUSH_FLAG_FIELDS).toContain(f)
    for (const f of ['iban', 'ahv_number', 'register_status', 'joined_on', 'left_on', 'fee_category', 'license_nr']) {
      expect(CD_PUSH_FLAG_FIELDS).toContain(f)
    }
    // Names are never pushed on UPDATE rows ([Id]-keyed, name-less) — flagging
    // them would only make a push that carries nothing.
    expect(CD_PUSH_FLAG_FIELDS).not.toContain('first_name')
    expect(CD_PUSH_FLAG_FIELDS).not.toContain('last_name')
  })
})

describe('pushFlagValue', () => {
  it('renders a birthdate Swiss-style, from a string or a Date', () => {
    expect(pushFlagValue('birthdate', '2009-04-17')).toBe('17.04.2009')
    expect(pushFlagValue('birthdate', new Date('2009-04-17T00:00:00Z'))).toBe('17.04.2009')
  })
  it('treats empty and false as "do not flag" (the push cannot blank a cell)', () => {
    expect(pushFlagValue('email', '')).toBe('')
    expect(pushFlagValue('email', '   ')).toBe('')
    expect(pushFlagValue('email', null)).toBe('')
    expect(pushFlagValue('scorer_vb', false)).toBe('')
    expect(pushFlagValue('scorer_vb', true)).toBe('true')
  })
  it('trims everything else and leaves it as is', () => {
    expect(pushFlagValue('email', ' a@b.ch ')).toBe('a@b.ch')
    expect(pushFlagValue('joined_on', '2026-08-01')).toBe('2026-08-01')
  })
})

describe('contactValueChanged', () => {
  it('ignores case and whitespace on email', () => {
    expect(contactValueChanged('email', 'Anna@Example.ch', ' anna@example.ch')).toBe(false)
    expect(contactValueChanged('email', 'parent@example.ch', 'anna@example.ch')).toBe(true)
  })
  it('compares a birthdate on its calendar day (Date from knex vs ISO string from the payload)', () => {
    expect(contactValueChanged('birthdate', new Date('2009-04-17T00:00:00Z'), '2009-04-17')).toBe(false)
    expect(contactValueChanged('birthdate', '2009-04-17', '2009-04-18')).toBe(true)
  })
  it('null and empty are the same; a re-sent unchanged address is no change', () => {
    expect(contactValueChanged('address', null, '')).toBe(false)
    expect(contactValueChanged('address', 'Weg 1', 'Weg 1')).toBe(false)
    expect(contactValueChanged('city', 'Zürich', 'Zurich')).toBe(true)
  })
})

describe('mergePushChanges', () => {
  it('replaces the same field, keeps the others, reads both jsonb shapes', () => {
    const prev = [{ field: 'iban', old_value: null, new_value: 'CH00' }, { field: 'email', old_value: null, new_value: 'old@x.ch' }]
    const next = [{ field: 'email', old_value: 'old@x.ch', new_value: 'new@x.ch' }]
    for (const raw of [prev, JSON.stringify(prev)]) {
      expect(mergePushChanges(raw, next)).toEqual([prev[0], next[0]])
    }
    expect(mergePushChanges('not json', next)).toEqual(next)
  })
})

describe('flagClubdeskPush', () => {
  it('flags a linked member and names the field in clubdesk_push_changes, merging what was queued', async () => {
    const db = fakeDb({ 120: linked({ clubdesk_push_changes: [{ field: 'iban', old_value: null, new_value: 'CH00' }] }) })
    const r = await flagClubdeskPush(db, [120], ['email'], {
      values: { email: 'player@example.ch' }, before: { email: 'parent@example.ch' },
    })
    expect(r).toEqual({ flagged: 1, members: [120] })
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].patch.clubdesk_push_pending).toBe(true)
    // The up dispatcher keeps a flag only for members edited after its stash
    // (date_updated > up_requested_at); raw writers never bump date_updated, so
    // the flag has to — or an edit landing mid-push is cleared with it.
    expect(db.updates[0].patch.date_updated).toBeInstanceOf(Date)
    expect(JSON.parse(db.updates[0].patch.clubdesk_push_changes)).toEqual([
      { field: 'iban', old_value: null, new_value: 'CH00' },
      { field: 'email', old_value: 'parent@example.ch', new_value: 'player@example.ch' },
    ])
  })

  it('reads the stored value back when no values are passed (raw-SQL callers update first)', async () => {
    const db = fakeDb({
      120: linked({ email: 'a@x.ch', birthdate: '2009-04-17' }),
      229: { id: 229, clubdesk_id: '1000229', clubdesk_push_changes: null, email: 'b@x.ch', birthdate: null },
    })
    const r = await flagClubdeskPush(db, [120, 229], ['email', 'birthdate'], { source: 'admin SQL' })
    expect(r.flagged).toBe(2)
    // The fallback read selects only whitelisted columns.
    expect(db.selects[0]).toEqual(['id', 'clubdesk_id', 'clubdesk_push_changes', 'email', 'birthdate'])
    const byId = Object.fromEntries(db.updates.map((u) => [u.where.id, JSON.parse(u.patch.clubdesk_push_changes)]))
    expect(byId[120]).toEqual([
      { field: 'email', old_value: null, new_value: 'a@x.ch' },
      { field: 'birthdate', old_value: null, new_value: '17.04.2009' },
    ])
    // An empty birthdate never flags — only the email is named.
    expect(byId[229]).toEqual([{ field: 'email', old_value: null, new_value: 'b@x.ch' }])
  })

  it('skips unlinked members — their values ride the CREATE push', async () => {
    const db = fakeDb({ 735: { id: 735, clubdesk_id: null, clubdesk_push_changes: null } })
    const r = await flagClubdeskPush(db, [735], ['email'], { values: { email: 'x@y.ch' } })
    expect(r.flagged).toBe(0)
    expect(db.updates).toHaveLength(0)
  })

  it('never flags an empty value (a cleared field cannot blank the register)', async () => {
    const db = fakeDb({ 120: linked() })
    const r = await flagClubdeskPush(db, [120], ['phone', 'address'], { values: { phone: '', address: '  ' } })
    expect(r.flagged).toBe(0)
    expect(db.updates).toHaveLength(0)
  })

  it('refuses fields outside the whitelist, and fields the payload did not carry', async () => {
    const db = fakeDb({ 120: linked() })
    const r = await flagClubdeskPush(db, [120], ['first_name', 'password', 'email'], { values: { first_name: 'A', password: 'x' } })
    expect(r.flagged).toBe(0)
    expect(db.selects).toHaveLength(0) // nothing to do → no query at all
  })

  it('writes a user_logs row when there is an acting user, and none for a system caller', async () => {
    const db = fakeDb({ 120: linked() })
    await flagClubdeskPush(db, [120], ['city'], {
      values: { city: 'Zürich' }, source: 'test', accountability: { user: 'u-1' }, log: { warn: vi.fn() },
    })
    expect(db.logs).toHaveLength(1)
    const data = JSON.parse(db.logs[0].row.data)
    expect(data).toMatchObject({ kind: 'clubdesk_push_flag', fields: ['city'], source: 'test', actor_user: 'u-1' })

    const db2 = fakeDb({ 120: linked() })
    await flagClubdeskPush(db2, [120], ['city'], { values: { city: 'Zürich' } })
    expect(db2.logs).toHaveLength(0)
  })

  it('dedupes member ids', async () => {
    const db = fakeDb({ 120: linked() })
    await flagClubdeskPush(db, [120, '120'], ['email'], { values: { email: 'a@x.ch' } })
    expect(db.updates).toHaveLength(1)
  })
})

describe('dropPushQueuedConflicts', () => {
  const wanted = [
    { member_id: 120, field: 'email' },
    { member_id: 120, field: 'phone' },
    { member_id: 229, field: 'email' },
  ]
  it('drops a conflict whose field is already queued for that member — it is a push, not a decision', () => {
    const staged = new Map([[120, new Set(['email'])]])
    expect(dropPushQueuedConflicts(wanted, staged)).toEqual([
      { member_id: 120, field: 'phone' },
      { member_id: 229, field: 'email' },
    ])
  })
  it('keeps everything when nothing is queued', () => {
    expect(dropPushQueuedConflicts(wanted, new Map())).toBe(wanted)
    expect(dropPushQueuedConflicts(wanted, null)).toBe(wanted)
  })
  it('end to end: a flagged email is skipped by the staging rule', async () => {
    const db = fakeDb({ 120: linked() })
    await flagClubdeskPush(db, [120], ['email'], { values: { email: 'player@example.ch' } })
    const { changedPushFields } = await import('../clubdesk-update.js')
    const staged = new Map([[120, changedPushFields(db.updates[0].patch.clubdesk_push_changes)]])
    expect(dropPushQueuedConflicts(wanted, staged).some((w) => w.member_id === 120 && w.field === 'email')).toBe(false)
  })
})
