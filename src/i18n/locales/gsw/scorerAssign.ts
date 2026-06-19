export default {
  title: 'Schriiber-Zueteilig',
  subtitle: 'Automatischi Zueteilig vo Schriiber- und Täfeler-Teams zu Heimspiel.',

  // Actions
  runAlgorithm: 'Algorithmus starte',
  saveAll: 'Alli speichere',
  saving: 'Speichere...',
  running: 'Berechne...',

  // Season
  season: 'Saison',

  // Table headers
  date: 'Datum',
  time: 'Zit',
  hall: 'Halle',
  home: 'Heim',
  away: 'Gascht',
  league: 'Liga',
  autoScorer: 'Schriiber',
  autoTaefeler: 'Täfeler',
  score: 'Score',
  conflicts: 'Konflikt',

  // Summary
  teamSummary: 'Team-Übersicht',
  teamName: 'Team',
  scorerCount: 'Schriiber',
  scoreboardCount: 'Täfeler',
  combinedCount: 'Schriiber/Täfeler',
  ownGames: 'Spiel',
  totalCount: 'Total',

  // Status
  noGames: 'Käni Spiel glade.',
  gamesLoaded: '{{count}} Spiel glade.',
  assignmentsDone: 'Zueteilig abgschlosse. {{assigned}} vo {{total}} Spiel zuewise.',
  saveSuccess: '{{count}} Spiel aktualisiert.',
  saveError: 'Fähler bim Speichere.',

  // Existing
  existingKept: 'Bestehendi Zueteilig biibehalte',
  noTeamAvailable: 'Käs Team verfüegbar',
  noScorerAvailable: 'Käs Schriiber verfüegbar',
  noTaefelerAvailable: 'Käs Täfeler verfüegbar',

  // Reasons (hard rules)
  reason_gameSameDay: 'Spiel am gliiche Tag',
  reason_doltschiUnderOnly: 'Döltschi: nur U-Teams',
  reason_alreadyDuty: 'Scho Dienst am gliiche Tag',
  reason_noLicence: 'Käni Schriiber-Lizänz',

  // Reasons (soft rules)
  reason_training: 'Training ({{points}})',
  reason_sequenceBonus: 'Sequänz-Bonus (+{{points}})',
  reason_rotation: 'Rotation: {{count}}x ({{points}})',
  reason_hu20Taefeler: 'HU20 Täfeler (+{{points}})',
  reason_underDoltschi: 'U-Team Döltschi (+{{points}})',
  reason_legendsScorer: 'Legends Schriiber (+{{points}})',
  reason_weekendFree: 'Wucheänd frei (+{{points}})',

  // Basketball
  subtitleBb: 'Automatischi Zueteilig vom Iisatz-Team zu jedem Basketball-Heimspiel.',
  autoDutyTeam: 'Iisatz-Team',
  dutyTeamTag: 'Iisatz',
  dutyCount: 'Iisätz',
  reason_noOtr1: 'Kä OTR1-Offizielle',
  reason_fullCrew: 'Komplett-Team (+{{points}})',

  // Override
  selectTeam: '— Team —',
} as const
