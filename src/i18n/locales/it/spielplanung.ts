export default {
  title: 'Pianificazione partite',
  subtitleSeason: 'Panoramica stagione {{season}}',
  seasonPicker: 'Stagione',

  // View options
  viewCalendar: 'Calendario',
  viewWeek: 'Week',
  viewByDate: 'Per data',
  viewByTeam: 'Per squadra',

  // Week view
  weekPrev: 'Previous week',
  weekNext: 'Next week',
  weekToday: 'Today',
  weekMoveSuccess: 'Game moved.',
  weekMoveFailed: 'Could not move game: {{message}}',

  // Filters
  filterAll: 'Tutti',
  filterVolleyball: 'Pallavolo',
  filterBasketball: 'Pallacanestro',
  filterHome: 'Casa',
  filterAway: 'Trasferta',
  showAbsences: 'Mostra assenze',

  // Absence overlay badge (calendar day cells)
  absenceBadge: {
    title: '{{count}} assenti',
    aria: 'Assenze: {{count}}',
  },

  // Day overflow popover (month view)
  overflow: {
    more: '+{{count}} altre',
  },

  // Manual game creation modal
  manualGame: {
    title: 'Aggiungi partita manuale',
    subtitle: 'Salta il flusso di invito — admin / Spielplaner imposta tutto.',
    sport: 'Sport',
    team: 'Squadra',
    teamPlaceholder: 'Seleziona squadra',
    homeAway: 'Casa / Trasferta',
    home: 'Casa',
    away: 'Trasferta',
    opponent: 'Avversario',
    opponentPlaceholder: 'es. Goldcoast Wadenswil 1',
    date: 'Data',
    time: 'Ora',
    hall: 'Palestra',
    hallPlaceholder: 'Seleziona palestra',
    awayVenue: 'Sede trasferta',
    venueName: 'Nome della palestra',
    venueAddress: 'Indirizzo',
    venueCity: 'CAP / Citta',
    venuePlusCode: 'Plus code (opzionale)',
    league: 'Lega',
    leaguePlaceholder: 'Opzionale',
    round: 'Turno',
    create: 'Crea partita',
    conflict: {
      sameTeamSameDay: 'Questa squadra gioca gia lo stesso giorno ({{time}} contro {{opponent}}).',
      hallOverlap: 'La palestra e gia occupata in un orario sovrapposto ({{time}}–{{endTime}}).',
      sameTeamWithinTwoDays: 'Questa squadra gioca anche il {{date}} alle {{time}} ({{daysDelta}} giorni di distanza).',
    },
  },

  // Game detail drawer
  // List/row status labels
  status: {
    scheduled: 'Planned',
    live: 'Live',
    completed: 'Played',
    postponed: 'Postponed',
  },
  emptyState: 'No games found',

  drawer: {
    vs: 'vs',
    hall: 'Palestra',
    league: 'Lega',
    round: 'Turno',
    svrzPush: 'Invio a SVRZ',
    notInVolleymanager: 'Non ancora in Volleymanager',
    copySvrz: 'Copia dettagli SVRZ',
    copied: 'Copiato!',
    sourceSVRZ: 'Gestito da SVRZ',
    sourceBasketplan: 'Gestito da Basketplan',
    sourceManual: 'Manuale',
  },
} as const
