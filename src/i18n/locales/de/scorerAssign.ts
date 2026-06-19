export default {
  title: 'Schreiber-Zuteilung',
  subtitle: 'Automatische Zuteilung von Schreiber- und Täfeler-Teams zu Heimspielen.',

  // Actions
  runAlgorithm: 'Algorithmus starten',
  saveAll: 'Alle speichern',
  saving: 'Speichern...',
  running: 'Berechne...',

  // Season
  season: 'Saison',

  // Table headers
  date: 'Datum',
  time: 'Zeit',
  hall: 'Halle',
  home: 'Heim',
  away: 'Gast',
  league: 'Liga',
  autoScorer: 'Schreiber',
  autoTaefeler: 'Täfeler',
  score: 'Score',
  conflicts: 'Konflikte',

  // Summary
  teamSummary: 'Team-Übersicht',
  teamName: 'Team',
  scorerCount: 'Schreiber',
  scoreboardCount: 'Täfeler',
  combinedCount: 'Schreiber/Täfeler',
  ownGames: 'Spiele',
  totalCount: 'Total',

  // Status
  noGames: 'Keine Spiele geladen.',
  gamesLoaded: '{{count}} Spiele geladen.',
  assignmentsDone: 'Zuteilung abgeschlossen. {{assigned}} von {{total}} Spielen zugewiesen.',
  saveSuccess: '{{count}} Spiele aktualisiert.',
  saveError: 'Fehler beim Speichern.',

  // Existing
  existingKept: 'Bestehende Zuteilung beibehalten',
  noTeamAvailable: 'Kein Team verfügbar',
  noScorerAvailable: 'Kein Schreiber verfügbar',
  noTaefelerAvailable: 'Kein Täfeler verfügbar',

  // Reasons (hard rules)
  reason_gameSameDay: 'Spiel am selben Tag',
  reason_doltschiUnderOnly: 'Döltschi: nur U-Teams',
  reason_alreadyDuty: 'Bereits Dienst am selben Tag',
  reason_noLicence: 'Keine Schreiber-Lizenz',

  // Reasons (soft rules)
  reason_training: 'Training ({{points}})',
  reason_sequenceBonus: 'Sequenz-Bonus (+{{points}})',
  reason_rotation: 'Rotation: {{count}}x ({{points}})',
  reason_hu20Taefeler: 'HU20 Täfeler (+{{points}})',
  reason_underDoltschi: 'U-Team Döltschi (+{{points}})',
  reason_legendsScorer: 'Legends Schreiber (+{{points}})',
  reason_weekendFree: 'Wochenende frei (+{{points}})',

  // Basketball
  subtitleBb: 'Automatische Zuteilung eines Einsatzteams zu jedem Basketball-Heimspiel.',
  autoDutyTeam: 'Einsatzteam',
  dutyTeamTag: 'Einsatz',
  dutyCount: 'Einsätze',
  reason_noOtr1: 'Kein OTR1-Offizieller',
  reason_fullCrew: 'Komplettes Team (+{{points}})',

  // Override
  selectTeam: '— Team —',
} as const
