export default {
  title: 'Live',
  subtitle: 'Segui la partita in diretta dalla palestra.',

  // Stato della connessione / della partita
  statusLive: 'In diretta',
  statusFinal: 'Finita',
  statusIdle: 'Nessuna partita in diretta',
  statusConnecting: 'Connessione…',
  statusReconnecting: 'Riconnessione…',

  // Stato vuoto
  noMatch: 'Al momento nessuna partita in diretta',
  noMatchHint: 'Questa pagina si aggiorna automaticamente non appena il tabellone avvia una partita.',

  // Sport sul tabellone
  sport_volleyball: 'Pallavolo',
  sport_beach: 'Beach volley',
  sport_basketball: 'Pallacanestro',

  // Tabellone — pallavolo / beach
  serving: 'Al servizio',
  sets: 'Set',
  set: 'Set {{n}}',
  teamFallback: 'Squadra',
  toShort: 'TO', // timeout
  subShort: 'Sost', // sostituzioni

  // Tabellone — pallacanestro
  period: 'Periodo',
  quarter: 'Q{{n}}',
  overtime: 'TS',
  overtimeN: 'TS{{n}}',
  points: 'Punti',
  wonMatch: 'vince la partita',
  watchLive: 'Guarda',
  recentTitle: 'Di recente sul tabellone',
  recentMatch: 'Partita',
  recentResult: 'Risultato',
  recentSets: 'Set',
  recentWhen: 'Finita',
  finalNoWinner: 'Partita finita in parità',
  foulsShort: 'Falli', // falli di squadra in questo periodo
  bonus: 'Bonus',
  bonusHint: 'In bonus — l’avversario ha 5 falli di squadra, questa squadra tira i tiri liberi.',
  possessionOf: 'Possesso: {{team}}',

  // Eventi del tabellone
  eventSetEnd: 'Set finito',
  eventMatchEnd: 'Partita finita',
  eventSwitch: 'Cambio campo',

  updatedAt: 'Aggiornato {{time}}',

  // Final summary (match over)
  finalSetCol: 'Set',
  finalScoreCol: 'Punteggio',
  finalDurationCol: 'Durata',
  finalMatchTime: 'Durata della partita',
  finalAfterRegulation: 'Dopo quattro quarti',
  finalAfterOvertime: 'Dopo i supplementari ({{label}})',
  finalAfterQuarter: 'Terminata nel {{label}}',
  recentDuration: 'Durata della partita {{time}}',
  durationMin: '{{m}} min',
  durationHourMin: '{{h}} h {{m}} min',

  // Phone live scoring (/live/score/:gameId, migration 394)
  liveScoring: "Punteggio live",
  scoringTitle: "Punteggio live",
  home: "Casa",
  away: "Ospiti",
  addPointFor: "Punto per {{team}}",
  minusPoint: "Punto",
  undo: "Annulla",
  nextSet: "Set successivo",
  finishMatch: "Termina partita",
  reopenMatch: "Riapri partita",
  finishEarlyConfirm: "Nessuna squadra ha ancora vinto tre set. Terminare comunque la partita?",
  scoringHint: "Tocca una squadra per assegnarle il punto. Tutti possono seguire il punteggio sulla pagina Live.",
  scoreChangedElsewhere: "Il punteggio è stato modificato su un altro telefono — controllalo e tocca di nuovo.",
  backToGame: "Torna alla partita",
  sync_loading: "Caricamento…",
  sync_synced: "Salvato",
  sync_saving: "Salvataggio…",
  sync_offline: "Offline — nuovo tentativo in arrivo",
  cannotScoreTitle: "Non puoi segnare questa partita",
  cannotScore_auth: "Accedi per segnare questa partita.",
  cannotScore_not_found: "Questa partita non esiste.",
  cannotScore_no_team: "Questa partita non ha una squadra KSCW.",
  cannotScore_sport: "Il punteggio live è disponibile solo per la pallavolo.",
  cannotScore_not_played: "Questa partita è annullata o rinviata.",
  cannotScore_no_member: "Solo i membri del club possono segnare.",
  cannotScore_no_time: "Questa partita non ha ancora un orario d’inizio.",
  cannotScore_outside_window: "Il punteggio live apre 1 ora prima dell’inizio e chiude 4 ore dopo.",
  cannotScore_not_participant: "Solo i giocatori sul referto, gli allenatori e il servizio segnapunti di questa partita possono segnarla.",
}
