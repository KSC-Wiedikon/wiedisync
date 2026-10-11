import { describe, it, expect, vi } from 'vitest'
import { bpClient, bpDate, parseTournamentDetail, parseTournamentList, planRemovals, planTournamentGames, planTournamentRows, syncBpTournaments } from '../bp-tournaments.js'

// Shapes copied from basketplan.ch (04.10.2026), names/contacts replaced.
const LIST = `
<table><tr><td class="txt8b">Datum</td><td class="txt8b">Verein</td></tr>
<tr onMouseOver="x">
  <td class="txt8"><a href="/findTournamentById.do?tournamentId=438"><span>01.11.26</span></a></td>
  <td class="txt8"><a href="/findTournamentById.do?tournamentId=438"><span>Phönix Basket</span></a></td>
  <td class="txt8"><a href="/findTournamentById.do?tournamentId=438"><span>Org Person</span></a></td>
  <td class="txt8"><span>Sportanlage Wisacher</span></td>
  <td class="txt8"><span>08:00</span></td><td class="txt8"><span>18:00</span></td>
  <td class="txt8"><span>34</span></td><td class="txt8"><span>Definitiv</span></td>
  <td><a href='selectTeamForClubRegistration.do?tournamentId=438&amp;loggedInAsClubWithId=166'>Anmelden</a></td>
</tr></table>`

const DETAIL = `
<tr><td></td><td class="txt8b" >
                Verein
            </td><td class="txt8b" colspan='2'>Phönix Basket </td><td></td></tr>
<input type="text" name="deadline" size="10" value="25.10.2026" disabled>
<tr class="forms" height="35"> <td width="1%"></td> <td class="txt8b" align="left"> Ligen </td> </tr>
<tr class="forms" height="35"> <td width="1%"></td> <td class="txt8" colspan="3" align="left"> <tr class="forms"> <td> Name </td> <td> Geschlecht </td> <td> max Alter Liga </td> <td></td> <td></td> </tr>
<tr class="forms" onMouseOver="x"> <td> DU12Tu </td> <td> F </td> <td> </td> <td > Spiele anzeigen </td> <td class="psydoLink"> </td> </tr>
<tr class="forms" onMouseOver="x"> <td> MixU 8M </td> <td> X </td> <td> </td> <td > Spiele anzeigen </td> <td class="psydoLink"> </td> </tr>
</td> </tr>
<table><tr class="forms"><td class="txt8b" colspan="7">Austragungen</td></tr>
<tr class="forms"><td class="txt8b">Datum [dd.mm.yyyy]</td><td class="txt8b">Von [HH:mm]</td></tr>
<tr class="forms"><td> 01.11.2026 </td><td> 08:00 </td><td> 18:00 </td><td> Wisacher </td><td> 3 </td><td></td></tr>
</table>
<!-- registrations / teams -->
<table><tr><td class="txt8b">Anmeldungen</td><td><a class="a_txt8" href='selectTeamForClubRegistration.do?tournamentId=438&amp;loggedInAsClubWithId=166'>Anmelden</a></td></tr>
<tr class="forms"><td>Other Club</td><td> <a href="/findTeamById.do?teamId=6053" class="a_txt8">Other MU10</a></td><td>Coach</td><td>p: coach@example.ch</td><td>079 000 00 00</td><td></td></tr>
<tr class="forms"><td>KSC Wiedikon</td><td> <a href="/findTeamById.do?teamId=5104" class="a_txt8">KSC Wiedikon DU12</a></td><td></td><td></td><td></td>
<td><a class="a_txt8" href='withdrawTeamFromTournament.do?tournamentId=438&amp;teamId=5104'>Zurückziehen</a></td></tr>
</table>`

describe('basketplan tournaments', () => {
  it('reads dates both ways', () => {
    expect(bpDate('01.11.26')).toBe('2026-11-01')
    expect(bpDate('01.11.2026')).toBe('2026-11-01')
    expect(bpDate('1.11.26')).toBeNull()
  })
  it('parses the list, one row per tournament', () => {
    expect(parseTournamentList(LIST)).toEqual([
      { id: 438, date: '2026-11-01', club: 'Phönix Basket', hall: 'Sportanlage Wisacher', from: '08:00', to: '18:00', status: 'Anmelden' },
    ])
  })
  it('parses a detail page: host, deadline, days, registered team ids only', () => {
    const d = parseTournamentDetail(DETAIL)
    expect(d).toEqual({ club: 'Phönix Basket', deadline: '2026-10-25', leagues: ['DU12Tu', 'MixU 8M'], open: true, days: [{ date: '2026-11-01', from: '08:00', to: '18:00', hall: 'Wisacher' }], teamIds: ['6053', '5104'] })
    expect(JSON.stringify(d)).not.toMatch(/coach@|079/) // no contact data leaves the parser
  })
  it('plans one away row per tournament day and registered KSCW team', () => {
    const t = { ...parseTournamentList(LIST)[0], ...parseTournamentDetail(DETAIL) }
    const rows = planTournamentGames([t], { 5104: { id: 70, name: 'KSC Wiedikon DU12', league: 'DU12Tu', season: '2026/27' } })
    expect(rows).toEqual([{
      game_id: 'bpt_438_20261101', source: 'basketplan_tournament', kscw_team: 70, type: 'away',
      home_team: 'Turnier · Phönix Basket', away_team: 'KSC Wiedikon DU12', date: '2026-11-01', time: '08:00',
      league: 'DU12Tu', season: '2026/27', status: 'scheduled', away_hall_json: JSON.stringify({ name: 'Sportanlage Wisacher' }),
    }])
    expect(planTournamentGames([t], {})).toEqual([])
  })
  it('mirrors each tournament for the picking page, with only KSCW team ids', () => {
    const t = { ...parseTournamentList(LIST)[0], ...parseTournamentDetail(DETAIL) }
    expect(planTournamentRows([t], ['5104', '5287'])).toEqual([{
      id: 438, date: '2026-11-01', end_date: null, host_club: 'Phönix Basket', hall: 'Sportanlage Wisacher',
      time_from: '08:00', time_to: '18:00', leagues: ['DU12Tu', 'MixU 8M'], deadline: '2026-10-25',
      registration_open: true, list_status: 'Anmelden', registered_count: 2, kscw_bp_team_ids: ['5104'],
    }])
    expect(planTournamentRows([{ ...t, status: 'Anmeldefrist abgelaufen' }], [])[0].registration_open).toBe(false)
  })
  it('never requests anything but the four read pages (withdraw is a GET link)', async () => {
    const calls = []
    const c = bpClient(async (url) => { calls.push(url); return new Response('<a>Logout</a>', { status: 200 }) })
    await expect(c.getHtml('/withdrawTeamFromTournament.do?tournamentId=438&teamId=5104')).rejects.toThrow(/refusing/)
    await expect(c.getHtml('https://evil.example/findAllTournaments.do')).rejects.toThrow(/refusing/)
    await expect(c.getHtml('/registerTeamForTournament.do')).rejects.toThrow(/refusing/)
    expect(calls).toEqual([])
    await c.getHtml('/findTournamentById.do?tournamentId=438')
    expect(calls).toHaveLength(1)
  })

  it('the deletion floor: a broken-looking parse keeps the rows only it wants gone', () => {
    const row = (id, team, date) => ({ id, game_id: `bpt_${id}_${date.replace(/-/g, '')}`, kscw_team: team, date })
    const existing = [
      row(1, 70, '2026-11-01'), row(2, 70, '2026-11-08'), row(3, 70, '2026-11-15'), row(4, 70, '2026-11-22'),
      row(5, 70, '2026-11-29'), // bp-sync has the real games for this day
      row(6, 99, '2026-11-01'), // team 99 is no longer synced
      row(7, 70, '2026-09-20'), // history
    ]
    const ctx = (wanted, desiredCount) => ({
      wantedKeys: new Set(wanted.map((id) => `${existing[id - 1].game_id}:70`)), desiredCount,
      realKeys: new Set(['70:2026-11-29']), syncedTeamIds: new Set([70]), today: '2026-10-12',
    })
    const ids = (rows) => rows.map((r) => r.id)

    // Ordinary withdrawal: one day of four goes.
    let p = planRemovals(existing, ctx([1, 2, 3], 4))
    expect([p.suspicious, ids(p.remove), ids(p.held)]).toEqual([null, [4, 5, 6], []])
    // Three of the five synced future days at once: held; the two sure ones still go.
    p = planRemovals(existing, ctx([1], 2))
    expect([p.suspicious, ids(p.remove), ids(p.held)]).toEqual(['mass_drop', [5, 6], [2, 3, 4]])
    // No KSCW day parsed at all: held, however few rows.
    p = planRemovals([existing[0], existing[6]], ctx([], 0))
    expect([p.suspicious, ids(p.remove), ids(p.held)]).toEqual(['empty_parse', [], [1]])
    // Nothing stored that the parse could drop: nothing to flag.
    expect(planRemovals([existing[6]], ctx([], 0)).suspicious).toBeNull()
  })

  describe('syncBpTournaments end to end', () => {
    const TODAY = '2026-10-12'
    const stored = (id, tournament, date) => ({
      id, game_id: `bpt_${tournament}_${date.replace(/-/g, '')}`, source: 'basketplan_tournament', kscw_team: 70, type: 'away',
      home_team: 'Turnier · Phönix Basket', away_team: 'KSC Wiedikon DU12', date, time: '08:00', league: 'DU12Tu', season: '2026/27',
      status: 'scheduled', away_hall_json: JSON.stringify({ name: 'Sportanlage Wisacher' }),
    })
    const setup = (games) => ({
      teams: [{ id: 70, name: 'DU12', league: 'DU12Tu', season: '2026/27', bb_source_id: '5104', features_enabled: null, sport: 'basketball', active: true }],
      games,
    })
    /** Logged-in Basketplan: login succeeds, every page carries "Logout". */
    const basketplan = (pages) => async (url) => {
      const u = new URL(url)
      if (u.pathname === '/showLogin.do' || u.pathname === '/authenticate.do') return new Response('<p>Willkommen</p>', { status: 200 })
      return new Response(`<a href="/logout.do">Logout</a>${pages[u.pathname] ?? ''}`, { status: 200 })
    }
    const sync = (db, pages, log) => syncBpTournaments(db, log, { fetchImpl: basketplan(pages), username: 'u', password: 'p', today: TODAY, delayMs: 0 })
    const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })

    it('an empty tournament list deletes nothing and journals the run as suspicious', async () => {
      const tables = setup([stored(1, 438, '2026-11-01'), stored(2, 439, '2026-11-08'), stored(3, 440, '2026-11-15'), stored(4, 401, '2026-09-20')])
      const log = makeLog()
      // A logged-in page whose table no longer parses (layout change, error page).
      const res = await sync(makeDb(tables), { '/findAllTournaments.do': '<table><tr><td>Keine Turniere</td></tr></table>' }, log)
      expect(res).toMatchObject({ tournaments: 0, kscwDays: 0, removed: 0, held: 3, suspicious: 'empty_parse' })
      expect(tables.games.map((g) => g.id)).toEqual([1, 2, 3, 4])
      expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/suspicious parse \(empty_parse\): kept 3/))
      expect(tables.sync_runs).toEqual([expect.objectContaining({ source: 'bp_tournaments', status: 'error', error_message: expect.stringMatching(/empty_parse/) })])
    })

    it('an ordinary withdrawal still removes the day', async () => {
      const tables = setup([stored(1, 438, '2026-11-01'), stored(2, 439, '2026-11-08')])
      const res = await sync(makeDb(tables), { '/findAllTournaments.do': LIST, '/findTournamentById.do': DETAIL }, makeLog())
      expect(res).toMatchObject({ tournaments: 1, kscwDays: 1, created: 0, unchanged: 1, removed: 1, held: 0, suspicious: null })
      expect(tables.games.map((g) => g.id)).toEqual([1])
      expect(tables.sync_runs).toEqual([expect.objectContaining({ source: 'bp_tournaments', status: 'ok', rows_changed: 1, error_message: null })])
    })
  })
})

// ── A knex-shaped fake, only as wide as syncBpTournaments (and logCronRun) use ──
function makeDb(tables) {
  class QB {
    constructor(name) { this.name = name; this.tests = [] }
    where(k, op, v) {
      if (v === undefined) [op, v] = ['=', op]
      this.tests.push((r) => (op === '>=' ? String(r[k]) >= String(v) : r[k] === v))
      return this
    }
    whereNot(k, v) { this.tests.push((r) => r[k] !== v); return this }
    whereIn(k, arr) { this.tests.push((r) => arr.map(String).includes(String(r[k]))); return this }
    rows() { return (tables[this.name] || []).filter((r) => this.tests.every((t) => t(r))) }
    select() { return Promise.resolve(this.rows().map((r) => ({ ...r }))) }
    then(res, rej) { return this.select().then(res, rej) }
    update(patch) { const rs = this.rows(); rs.forEach((r) => Object.assign(r, patch)); return Promise.resolve(rs.length) }
    del() {
      const rs = this.rows()
      tables[this.name] = tables[this.name].filter((r) => !rs.includes(r))
      return Promise.resolve(rs.length)
    }
    insert(row) {
      const t = (tables[this.name] ||= [])
      return {
        onConflict: (col) => ({
          merge: (patch = row) => {
            const cur = t.find((r) => r[col] === row[col])
            if (cur) Object.assign(cur, patch)
            else t.push({ ...row })
            return Promise.resolve([1])
          },
        }),
        then: (res, rej) => { t.push({ ...row }); return Promise.resolve([1]).then(res, rej) },
      }
    }
  }
  const db = (name) => new QB(name)
  db.fn = { now: () => new Date() }
  return db
}
