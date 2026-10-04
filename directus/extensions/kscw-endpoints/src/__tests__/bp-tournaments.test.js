import { describe, it, expect } from 'vitest'
import { bpClient, bpDate, parseTournamentDetail, parseTournamentList, planTournamentGames } from '../bp-tournaments.js'

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
<table><tr class="forms"><td class="txt8b" colspan="7">Austragungen</td></tr>
<tr class="forms"><td class="txt8b">Datum [dd.mm.yyyy]</td><td class="txt8b">Von [HH:mm]</td></tr>
<tr class="forms"><td> 01.11.2026 </td><td> 08:00 </td><td> 18:00 </td><td> Wisacher </td><td> 3 </td><td></td></tr>
</table>
<!-- registrations / teams -->
<table>
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
    expect(d).toEqual({ club: 'Phönix Basket', deadline: '2026-10-25', days: [{ date: '2026-11-01', from: '08:00', to: '18:00', hall: 'Wisacher' }], teamIds: ['6053', '5104'] })
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
})
