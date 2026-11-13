import { describe, it, expect } from 'vitest'
import { isTournamentLeague, TOURNAMENT_LEAGUE_SQL } from '../tournament.js'

describe('isTournamentLeague', () => {
  it.each([
    'SM Quali MU23 A', 'SM Quali M U20 B', 'SM Quali F U20', 'SM Final U18', 'Turnier DU20',
    'U20 Tournoi', 'Torneo U16', 'Finalrunde U17', 'Final Four', 'Youth tournament',
  ])('%s is a tournament', (league) => expect(isTournamentLeague(league)).toBe(true))

  it.each([
    'Männer U20', 'Männer U23 1. Stärkeklasse', 'Frauen 3. Liga Gruppe A', 'Herren 2. Liga',
    'Mobiliar Volley Cup — Runde 1, Spiel 23', 'Züri Cup — Final, Spiel 1', 'Barragespiele D 2. / 3. Liga',
    'Frauen U23 3. Stärkeklasse', '', null,
  ])('%s is not', (league) => expect(isTournamentLeague(league)).toBe(false))

  it('the SQL pattern names the same words', () => {
    expect(TOURNAMENT_LEAGUE_SQL).toContain('(SM|Turnier|Tournoi|Torneo|Tournament|Finalrunde|Final ?Four)')
  })
})
