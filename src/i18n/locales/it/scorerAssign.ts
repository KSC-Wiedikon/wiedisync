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

  // Algorithm rules (info panel)
  rulesTitle: 'Regole dell\'algoritmo',
  rulesModeVb: 'Pallavolo: squadre di refertista e tabellone separate. A Döltschi e in 4L/5L una squadra fa entrambi (combinato). Le partite casalinghe HU20 usano refertista + arbitro invece del tabellone.',
  refereeCount: 'Arbitro',
  refereeTag: 'Arb',
  noRefereeAvailable: 'Nessun arbitro disponibile',
  rulesModeBb: 'Basket: una squadra di servizio per partita casalinga fornisce tutti gli ufficiali (refertista, cronometrista e operatore dei 24s se necessario).',
  rulesHardTitle: 'Regole rigide — la squadra è esclusa',
  rulesSoftTitle: 'Regole flessibili — punti (ogni squadra parte da 100, vince il punteggio più alto)',
  rulesExisting: 'Le partite con un\'assegnazione già salvata restano invariate.',
  ruleVbHardGame: 'La squadra ha una propria partita lo stesso giorno',
  ruleVbHardDoltschi: 'Döltschi: solo squadre U (HU20, HU23-1, DU23-1, DU23-2)',
  ruleVbHardDuty: 'La squadra ha già un servizio lo stesso giorno',
  ruleVbHardLicence: 'Refertista / combinato: la squadra necessita di un membro con licenza da refertista',
  ruleVbSoftSequence: 'Gioca subito prima/dopo nella stessa palestra: +30',
  ruleVbSoftHu20: 'HU20 al tabellone: +15',
  ruleVbSoftDoltschi: 'Squadra U in combinato a Döltschi: +10',
  ruleVbSoftLegends: 'Legends come refertista: +8',
  ruleVbSoftWeekend: 'Weekend senza allenamento: +5',
  ruleVbSoftTraining: 'Allenamento lo stesso giorno: -20',
  ruleVbSoftRotation: 'Rotazione equa: -10 per ogni servizio già assegnato',
  ruleBbHardGame: 'La squadra ha una propria partita lo stesso giorno',
  ruleBbHardDuty: 'La squadra ha già un servizio lo stesso giorno',
  ruleBbHardOtr1: 'La squadra necessita di un membro con licenza OTR1 (refertista/cronometrista)',
  ruleBbSoftFullCrew: 'Crew completa (ha anche OTR2/OTN per i 24s): +25',
  ruleBbSoftSequence: 'Gioca subito prima/dopo nella stessa palestra: +30',
  ruleBbSoftTraining: 'Allenamento lo stesso giorno: -20',
  ruleBbSoftRotation: 'Rotazione equa: -10 per ogni servizio già assegnato',
  ruleBbSoftWeekend: 'Weekend senza allenamento: +5',
} as const
