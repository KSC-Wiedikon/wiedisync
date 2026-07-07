export default {
  title: 'Schreiber-Zuteilung',
  subtitle: 'Automatische Zuteilung von Schreiber- und Täfeler-Teams zu Heimspielen.',

  // Actions
  runAlgorithm: 'Algorithmus starten',
  saveAll: 'Alle speichern',
  downloadXlsx: 'Excel herunterladen',
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

  // Algorithm rules (info panel)
  rulesTitle: 'Regeln des Algorithmus',
  rulesModeVb: 'Volleyball: separate Schreiber- und Täfeler-Teams. In Döltschi und in der 4L/5L macht ein Team beides (kombiniert). HU20-Heimspiele haben nur einen Schiedsrichter (kein Schreiber/Täfeler).',
  refereeCount: 'Schiedsrichter',
  refereeTag: 'SR',
  noRefereeAvailable: 'Kein Schiedsrichter verfügbar',
  rulesModeBb: 'Basketball: ein Dienst-Team pro Heimspiel stellt alle Offiziellen (Anschreiber, Zeitnehmer und bei Bedarf 24s-Operator).',
  rulesHardTitle: 'Harte Regeln – Team wird ausgeschlossen',
  rulesSoftTitle: 'Weiche Regeln – Punkte (jedes Team startet bei 100, höchste Punktzahl gewinnt)',
  rulesExisting: 'Spiele mit bereits gespeicherter Zuteilung bleiben unverändert.',
  ruleVbHardGame: 'Team spielt ein zeitlich überlappendes Spiel (ein früherer/späterer Slot am selben Tag ist ok)',
  ruleVbHardDoltschi: 'Döltschi: nur U-Teams (HU20, HU23-1, DU23-1, DU23-2)',
  ruleVbHardDuty: 'Team hat am selben Tag bereits einen Dienst',
  ruleVbHardLicence: 'Schreiber/kombiniert: Team braucht ein Mitglied mit Schreiber-Lizenz',
  ruleVbSoftSequence: 'Spielt direkt davor/danach in derselben Halle: +50',
  ruleVbSoftHu20: 'HU20 als Täfeler: +15',
  ruleVbSoftDoltschi: 'U-Team kombiniert in Döltschi: +10',
  ruleVbSoftLegends: 'Legends als Schreiber: +8',
  ruleVbSoftWeekend: 'Wochenende ohne Training: +5',
  ruleVbSoftTraining: 'Training am selben Tag: -20',
  ruleVbSoftRotation: 'Faire Rotation: -10 pro bereits erhaltenem Dienst',
  ruleBbHardGame: 'Team hat am selben Tag ein eigenes Spiel',
  ruleBbHardDuty: 'Team hat am selben Tag bereits einen Dienst',
  ruleBbHardOtr1: 'Team braucht ein Mitglied mit OTR1-Lizenz (Anschreiber/Zeitnehmer)',
  ruleBbSoftFullCrew: 'Volle Crew (Team hat auch OTR2/OTN für 24s): +25',
  ruleBbSoftSequence: 'Spielt direkt davor/danach in derselben Halle: +30',
  ruleBbSoftTraining: 'Training am selben Tag: -20',
  ruleBbSoftRotation: 'Faire Rotation: -10 pro bereits erhaltenem Dienst',
  ruleBbSoftWeekend: 'Wochenende ohne Training: +5',
} as const
