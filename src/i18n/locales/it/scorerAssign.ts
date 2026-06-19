export default {
  title: 'Assegnazione segnapunti',
  subtitle: 'Assegna automaticamente le squadre di segnapunti e tabellone alle partite in casa.',

  // Actions
  runAlgorithm: 'Esegui algoritmo',
  saveAll: 'Salva tutto',
  saving: 'Salvataggio...',
  running: 'Calcolo...',

  // Season
  season: 'Stagione',

  // Table headers
  date: 'Data',
  time: 'Ora',
  hall: 'Palestra',
  home: 'Casa',
  away: 'Trasferta',
  league: 'Lega',
  autoScorer: 'Segnapunti',
  autoTaefeler: 'Tabellone',
  score: 'Punteggio',
  conflicts: 'Conflitti',

  // Summary
  teamSummary: 'Riepilogo squadre',
  teamName: 'Squadra',
  scorerCount: 'Segnapunti',
  scoreboardCount: 'Tabellone',
  combinedCount: 'Segnapunti/Tabellone',
  ownGames: 'Partite',
  totalCount: 'Totale',

  // Status
  noGames: 'Nessuna partita caricata.',
  gamesLoaded: '{{count}} partite caricate.',
  assignmentsDone: 'Assegnazione completata. {{assigned}} di {{total}} partite assegnate.',
  saveSuccess: '{{count}} partite aggiornate.',
  saveError: 'Errore durante il salvataggio.',

  // Existing
  existingKept: 'Assegnazione esistente mantenuta',
  noTeamAvailable: 'Nessuna squadra disponibile',
  noScorerAvailable: 'Nessun segnapunti disponibile',
  noTaefelerAvailable: 'Nessun addetto al tabellone disponibile',

  // Reasons (hard rules)
  reason_gameSameDay: 'Partita nello stesso giorno',
  reason_doltschiUnderOnly: 'Döltschi: solo squadre Under',
  reason_alreadyDuty: 'Già assegnato nello stesso giorno',
  reason_noLicence: 'Nessuna licenza segnapunti',

  // Reasons (soft rules)
  reason_training: 'Allenamento ({{points}})',
  reason_sequenceBonus: 'Bonus sequenza (+{{points}})',
  reason_rotation: 'Rotazione: {{count}}x ({{points}})',
  reason_hu20Taefeler: 'HU20 tabellone (+{{points}})',
  reason_underDoltschi: 'Squadra Under Döltschi (+{{points}})',
  reason_legendsScorer: 'Legends segnapunti (+{{points}})',
  reason_weekendFree: 'Fine settimana libero (+{{points}})',

  // Basketball
  subtitleBb: 'Assegna automaticamente una squadra di servizio a ogni partita di basket in casa.',
  autoDutyTeam: 'Squadra di servizio',
  dutyTeamTag: 'Servizio',
  dutyCount: 'Servizi',
  reason_noOtr1: 'Nessun ufficiale OTR1',
  reason_fullCrew: 'Squadra completa (+{{points}})',

  // Override
  selectTeam: '— Squadra —',
} as const
