import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Recipients + the dev suppression are read at MODULE LOAD, so every env case
// needs its own re-import (the scorer-exam pattern).
async function loadWithEnv(env) {
  const saved = {}
  for (const k of ['GCAL_SYNC_NOTIFY_EMAILS', 'GCAL_SYNC_NOTIFY_FORCE', 'PUBLIC_URL']) {
    saved[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  vi.resetModules()
  const mod = await import('../gcal-notify.js')
  return { mod, restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } } }
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function makeMail() {
  const send = vi.fn().mockResolvedValue(undefined)
  return { send }
}

beforeEach(() => { log.info.mockClear(); log.warn.mockClear() })
afterEach(() => { vi.resetModules() })

describe('hasChanges', () => {
  it('is false for an empty run — the normal nightly outcome', async () => {
    const { mod, restore } = await loadWithEnv({})
    expect(mod.hasChanges(mod.emptyChanges())).toBe(false)
    restore()
  })

  // The digest exists to report what the Hausdienst moved. Training
  // cancellations are a CONSEQUENCE of a closure, never a standalone trigger —
  // if only they were set, the closure that caused them was already reported.
  it('ignores training impact on its own', async () => {
    const { mod, restore } = await loadWithEnv({})
    const c = mod.emptyChanges()
    c.trainingsCancelled.push({ date: '2026-09-01', team: 'D2', hall: 'KWI A' })
    expect(mod.hasChanges(c)).toBe(false)
    c.closuresNew.push({ halls: ['KWI A'], start: '2026-09-01', end: '2026-09-01', reason: 'Turnier' })
    expect(mod.hasChanges(c)).toBe(true)
    restore()
  })
})

describe('recipients', () => {
  it('defaults to the club-admin box', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus.kscw.ch' })
    expect(mod.GCAL_NOTIFY_EMAILS).toEqual(['admin@wiedisync.kscw.ch'])
    expect(mod.GCAL_NOTIFY_ENABLED).toBe(true)
    restore()
  })

  // `??` not `||`: an env var set to the empty string must DISABLE the digest.
  // With `||` it would fall through to the default and silently keep mailing
  // the club — a failure that fails nothing and is invisible.
  it('an empty env value disables it rather than falling back', async () => {
    const { mod, restore } = await loadWithEnv({ GCAL_SYNC_NOTIFY_EMAILS: '', PUBLIC_URL: 'https://directus.kscw.ch' })
    expect(mod.GCAL_NOTIFY_EMAILS).toEqual([])
    expect(mod.GCAL_NOTIFY_ENABLED).toBe(false)
    restore()
  })

  it('accepts a comma list', async () => {
    const { mod, restore } = await loadWithEnv({ GCAL_SYNC_NOTIFY_EMAILS: 'a@x.ch, b@x.ch', PUBLIC_URL: 'https://directus.kscw.ch' })
    expect(mod.GCAL_NOTIFY_EMAILS).toEqual(['a@x.ch', 'b@x.ch'])
    restore()
  })
})

describe('dev suppression', () => {
  // Dev is a nightly prod clone running the same 04:00 cron against the same
  // live calendar — any digest it produces duplicates prod's, into a real inbox.
  it('is off on dev', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus-dev.kscw.ch' })
    expect(mod.GCAL_NOTIFY_ENABLED).toBe(false)
    restore()
  })

  it('can be forced on dev for a deliberate test', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus-dev.kscw.ch', GCAL_SYNC_NOTIFY_FORCE: '1' })
    expect(mod.GCAL_NOTIFY_ENABLED).toBe(true)
    restore()
  })
})

describe('notifyGCalChanges', () => {
  it('sends nothing when the feed did not move', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus.kscw.ch' })
    const mail = makeMail()
    const r = await mod.notifyGCalChanges({ changes: mod.emptyChanges(), trigger: 'cron', mail, log })
    expect(mail.send).not.toHaveBeenCalled()
    expect(r).toEqual({ sent: false, reason: 'no-changes' })
    restore()
  })

  it('does not send on dev even with real changes', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus-dev.kscw.ch' })
    const mail = makeMail()
    const c = mod.emptyChanges()
    c.eventsNew.push({ title: 'Halle geschlossen', date: '2026-09-04', allDay: true })
    const r = await mod.notifyGCalChanges({ changes: c, trigger: 'cron', mail, log })
    expect(mail.send).not.toHaveBeenCalled()
    expect(r.reason).toBe('dev-suppressed')
    restore()
  })

  it('builds a Swiss-format digest naming every change', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus.kscw.ch' })
    const mail = makeMail()
    const c = mod.emptyChanges()
    c.eventsNew.push({ title: 'ASVZ Volleynight', date: '2026-11-14', time: '18:00:00', endTime: '23:00:00', allDay: false, location: 'KWI' })
    c.eventsChanged.push({ title: 'Handballturnier', date: '2026-10-03', diffs: [{ field: 'start_time', from: '09:00', to: '08:00' }] })
    c.eventsRemoved.push({ title: 'Pfadi', date: '2026-12-06' })
    c.closuresNew.push({ halls: ['KWI A', 'KWI B'], start: '2026-11-14', end: '2026-11-15', reason: 'ASVZ Volleynight' })
    c.trainingsCancelled.push({ date: '2026-11-14', start_time: '20:00:00', team: 'D2', hall: 'KWI A' })

    const r = await mod.notifyGCalChanges({ changes: c, trigger: 'cron', mail, log })
    expect(r.sent).toBe(true)
    const arg = mail.send.mock.calls[0][0]
    expect(arg.to).toBe('admin@wiedisync.kscw.ch')
    expect(arg.subject).toBe('Hallenkalender KWI: 1 neu, 1 geändert, 1 entfernt, 1 Hallensperrung')

    // Swiss dd.mm.yyyy + 24h HH:MM everywhere, never ISO or en-US.
    expect(arg.text).toContain('14.11.2026, 18:00–23:00')
    expect(arg.html).toContain('ASVZ Volleynight')
    expect(arg.html).toContain('14.11.2026 – 15.11.2026')
    expect(arg.text).toContain('06.12.2026 Pfadi')
    expect(arg.text).not.toMatch(/2026-11-14/)

    // The cancelled training is what somebody has to act on → warning styling.
    expect(arg.html).toContain('1 Training abgesagt')
    // The sync reads the column as `start_time` — reading `time` here silently
    // dropped the kickoff from every cancelled-training line.
    expect(arg.text).toContain('14.11.2026, 20:00 · D2 · KWI A')
    restore()
  })

  it('labels the trigger so a manual re-run is distinguishable from the cron', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus.kscw.ch' })
    const mail = makeMail()
    const c = mod.emptyChanges()
    c.eventsNew.push({ title: 'X', date: '2026-09-04', allDay: true })
    await mod.notifyGCalChanges({ changes: c, trigger: 'manual', mail, log })
    expect(mail.send.mock.calls[0][0].html).toContain('Manuell')
    restore()
  })

  // A whole-season re-import must not produce an unreadable wall of text.
  it('caps each section and says how many were dropped', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus.kscw.ch' })
    const mail = makeMail()
    const c = mod.emptyChanges()
    for (let i = 1; i <= 40; i++) c.eventsNew.push({ title: `E${i}`, date: '2026-09-04', allDay: true })
    await mod.notifyGCalChanges({ changes: c, trigger: 'cron', mail, log })
    const html = mail.send.mock.calls[0][0].html
    expect(html).toContain('E25')
    expect(html).not.toContain('>E26<')
    expect(html).toContain('und 15 weitere')
    restore()
  })

  // It runs AFTER the sync has committed. A dead SES must cost a log line, never
  // a 500 that would invite a retry re-writing every row.
  it('never throws when the mail send fails', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus.kscw.ch' })
    const mail = { send: vi.fn().mockRejectedValue(new Error('SES down')) }
    const c = mod.emptyChanges()
    c.eventsNew.push({ title: 'X', date: '2026-09-04', allDay: true })
    const r = await mod.notifyGCalChanges({ changes: c, trigger: 'cron', mail, log })
    expect(r).toMatchObject({ sent: false, reason: 'error' })
    expect(log.warn).toHaveBeenCalled()
    restore()
  })

  // Titles come from a calendar the club does not control.
  it('escapes calendar text into the HTML body', async () => {
    const { mod, restore } = await loadWithEnv({ PUBLIC_URL: 'https://directus.kscw.ch' })
    const mail = makeMail()
    const c = mod.emptyChanges()
    c.eventsNew.push({ title: '<script>alert(1)</script>', date: '2026-09-04', allDay: true })
    await mod.notifyGCalChanges({ changes: c, trigger: 'cron', mail, log })
    const html = mail.send.mock.calls[0][0].html
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    restore()
  })
})
