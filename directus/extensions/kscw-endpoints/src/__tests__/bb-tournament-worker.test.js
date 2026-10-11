import { describe, it, expect, vi } from 'vitest'
import { createBbTournamentWorker, effectiveMode, inWindow, KICK_GAP_MS, parseRegisterForm, pendingPicks, shouldRun, WORKER_PATHS } from '../bb-tournament-worker.js'
import { bpClient, WITHDRAW_PATH } from '../bp-tournaments.js'

// Shape copied from basketplan.ch (04.10.2026).
const FORM = `<form name="tournamentRegistrationForm" method="post" action="/registerTeamForTournament.do">
<input type="hidden" name="tournamentId" value="437"> <tr><td><table><tr><td>
<select name="teamId" style="width:150" class="ip8"><option value="-1">Team wählen...</option> <option value="6724">KSC Wiedikon MU8</option></select>
</td><td class="psydoLink" onclick="submitRegisterTeam()">Anmelden</td></tr></table></td></tr></form>`

describe('bb tournament worker', () => {
  it('reads the team ids the registration form offers', () => {
    expect(parseRegisterForm(FORM)).toEqual({ ok: true, teamIds: ['6724'] })
    expect(parseRegisterForm('<html>no form</html>')).toEqual({ ok: false, teamIds: [] })
  })

  it('runs live only where the container allows it', () => {
    expect(effectiveMode('live', true)).toBe('live')
    expect(effectiveMode('live', false)).toBe('dry')
    expect(effectiveMode('dry', true)).toBe('dry')
    expect(effectiveMode('off', true)).toBe('off')
    expect(effectiveMode('bogus', true)).toBe('off')
  })

  it('ticks every 10 minutes, or every minute inside the opening window', () => {
    const s = { mode: 'dry', rush_from: '2026-11-02T17:25:00Z', rush_until: '2026-11-02T18:30:00Z' }
    expect(shouldRun(s, new Date('2026-11-02T12:10:00Z'), false)).toBe(true)
    expect(shouldRun(s, new Date('2026-11-02T12:11:00Z'), false)).toBe(false)
    expect(shouldRun(s, new Date('2026-11-02T17:31:00Z'), false)).toBe(true)
    expect(inWindow(s, new Date('2026-11-02T18:30:00Z'))).toBe(false)
    expect(shouldRun({ ...s, mode: 'off' }, new Date('2026-11-02T17:31:00Z'), true)).toBe(false)
  })

  it('pending = picked, not registered, not blocked by a live attempt, deadline not past', () => {
    const tournaments = new Map([
      [437, { id: 437, deadline: '2026-10-24', kscw_bp_team_ids: [] }],
      [438, { id: 438, deadline: '2026-10-25', kscw_bp_team_ids: ['5104'] }],
      [435, { id: 435, deadline: '2026-09-27', kscw_bp_team_ids: [] }],
    ])
    const teams = new Map([[88, { bb_source_id: '6724' }], [70, { bb_source_id: '5104' }], [87, { bb_source_id: '5287' }]])
    const picks = [
      { tournament: 437, team: 88 }, // pending
      { tournament: 438, team: 70 }, // already registered
      { tournament: 435, team: 70 }, // deadline past
      { tournament: 438, team: 87 }, // a live attempt exists
      { tournament: 999, team: 88 }, // unknown tournament
    ]
    expect(pendingPicks(picks, tournaments, teams, new Set(['438:87']), '2026-10-04'))
      .toEqual([{ tournament: 437, team: 88, bp: '6724' }])
  })

  it('may post the registration form but can never reach the withdraw link', async () => {
    const calls = []
    const fetchImpl = async (url) => { calls.push(url); return new Response('<a>Logout</a>', { status: 200 }) }
    const c = bpClient(fetchImpl, { allow: [...WORKER_PATHS, WITHDRAW_PATH] })
    await expect(c.getHtml(`${WITHDRAW_PATH}?tournamentId=437&teamId=6724`)).rejects.toThrow(/refusing/)
    await expect(c.request('/registerTeamForTournament.do', { method: 'POST' })).resolves.toMatchObject({ status: 200 })
    expect(WORKER_PATHS).not.toContain(WITHDRAW_PATH)
    expect(calls.some((u) => u.includes('withdraw'))).toBe(false)
  })

  describe('one run at a time', () => {
    const ENV = { PUBLIC_URL: 'https://directus.kscw.ch', BASKETPLAN_USERNAME: 'u', BASKETPLAN_PASSWORD: 'p' }
    const quiet = { info() {}, warn() {}, error() {} }
    // 04:00 Zurich: outside the wish-watch hours, so a forced run reads no wishes.
    const NIGHT = new Date('2026-11-02T03:00:00Z')
    /** Every run starts by reading the settings row — so those reads count the runs. */
    function workerDb(settings = Promise.resolve({ id: 1, mode: 'off' })) {
      const reads = []
      const db = (name) => {
        reads.push(name)
        const q = { where: () => q, whereIn: () => q, orderBy: () => q, select: () => Promise.resolve([]) }
        q.first = () => (name === 'bb_tournament_worker' ? settings : Promise.resolve(undefined))
        return q
      }
      return { db, runs: () => reads.filter((n) => n === 'bb_tournament_worker').length }
    }

    it('two runs at once: the second answers busy and reads nothing', async () => {
      let release
      const { db, runs } = workerDb(new Promise((r) => { release = r }))
      const w = createBbTournamentWorker({ database: db, log: quiet, env: ENV })
      const first = w.run({ force: true, now: NIGHT })
      const second = w.run({ force: true, now: NIGHT })
      await expect(second).resolves.toEqual({ skipped: 'busy' })
      release({ id: 1, mode: 'dry' })
      await expect(first).resolves.toMatchObject({ mode: 'dry', pending: 0 })
      expect(runs()).toBe(1)
      // Released once settled: the next call runs.
      await w.run({ force: true, now: NIGHT })
      expect(runs()).toBe(2)
    })

    it('kicks: one run now, then one more per gap however often it is kicked', async () => {
      vi.useFakeTimers()
      try {
        const { db, runs } = workerDb()
        const w = createBbTournamentWorker({ database: db, log: quiet, env: ENV })
        w.kick()
        await vi.advanceTimersByTimeAsync(0)
        expect(runs()).toBe(1)
        w.kick()
        w.kick()
        await vi.advanceTimersByTimeAsync(KICK_GAP_MS - 1)
        expect(runs()).toBe(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(runs()).toBe(2)
        await vi.advanceTimersByTimeAsync(10 * KICK_GAP_MS)
        expect(runs()).toBe(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('a kick during a running tick waits for it instead of being dropped as busy', async () => {
      let release
      const { db, runs } = workerDb(new Promise((r) => { release = r }))
      const w = createBbTournamentWorker({ database: db, log: quiet, env: ENV })
      const tick = w.run()
      w.kick()
      expect(runs()).toBe(1)
      release({ id: 1, mode: 'off' })
      await tick
      await new Promise((r) => setImmediate(r))
      expect(runs()).toBe(2)
    })
  })
})
