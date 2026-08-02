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
  foulsShort: 'Falli', // falli di squadra in questo periodo
  bonus: 'Bonus',
  bonusHint: 'In bonus — l’avversario ha 5 falli di squadra, questa squadra tira i tiri liberi.',
  possessionOf: 'Possesso: {{team}}',

  // Eventi del tabellone
  eventSetEnd: 'Set finito',
  eventMatchEnd: 'Partita finita',
  eventSwitch: 'Cambio campo',

  updatedAt: 'Aggiornato {{time}}',
}
