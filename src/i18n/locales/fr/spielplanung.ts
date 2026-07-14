export default {
  title: 'Planning des matchs',
  subtitleSeason: 'Apercu de la saison {{season}}',
  seasonPicker: 'Saison',

  // View options
  blockedDate: 'Bloqué',
  viewCalendar: 'Calendrier',
  viewWeek: 'Week',
  viewByDate: 'Par date',
  viewByTeam: 'Par equipe',

  // Week view
  weekPrev: 'Previous week',
  weekNext: 'Next week',
  weekToday: 'Today',
  weekMoveSuccess: 'Game moved.',
  weekMoveFailed: 'Could not move game: {{message}}',

  // Filters
  filterAll: 'Tout',
  filterVolleyball: 'Volleyball',
  filterBasketball: 'Basketball',
  filterHome: 'Domicile',
  filterAway: 'Exterieur',
  showAbsences: 'Afficher les absences',

  // Absence overlay badge (calendar day cells)
  absenceBadge: {
    title: '{{count}} absent(s)',
    aria: 'Absences : {{count}}',
  },

  showCrossTeam: 'Afficher les conflits inter-équipes',
  crossTeamNeedsTeam: 'Choisissez d’abord une équipe pour voir ses conflits inter-équipes',
  crossTeamBadge: {
    title: 'Conflits inter-équipes : {{count}}',
    aria: 'Conflits inter-équipes : {{count}}',
    hint: 'Une équipe partageant des joueurs joue ce jour-là — cela bloque un créneau à domicile ici.',
    kind: {
      game: 'Match',
      home: 'Match à domicile',
      away: 'Match à l’extérieur',
    },
  },

  // Day overflow popover (month view)
  overflow: {
    more: '+{{count}} autres',
  },

  // Manual game creation modal
  manualGame: {
    title: 'Ajouter un match manuel',
    subtitle: 'Contourne le flux d\'invitation — l\'admin / Spielplaner saisit tout.',
    sport: 'Sport',
    team: 'Equipe',
    teamPlaceholder: 'Choisir une equipe',
    homeAway: 'Domicile / Exterieur',
    home: 'Domicile',
    away: 'Exterieur',
    opponent: 'Adversaire',
    opponentPlaceholder: 'p.ex. Goldcoast Wadenswil 1',
    date: 'Date',
    time: 'Heure',
    hall: 'Salle',
    hallPlaceholder: 'Choisir une salle',
    awayVenue: 'Lieu exterieur',
    venueName: 'Nom de la salle',
    venueAddress: 'Adresse',
    venueCity: 'NPA / Ville',
    venuePlusCode: 'Plus code (optionnel)',
    league: 'Ligue',
    leaguePlaceholder: 'Optionnel',
    round: 'Tour',
    create: 'Creer le match',
    conflict: {
      sameTeamSameDay: 'Cette equipe joue deja le meme jour ({{time}} contre {{opponent}}).',
      hallOverlap: 'La salle est deja occupee a un horaire qui chevauche ({{time}}–{{endTime}}).',
      sameTeamWithinTwoDays: 'Cette equipe joue aussi le {{date}} a {{time}} ({{daysDelta}} jours d\'ecart).',
      clubBlocked: 'Ce jour est bloque pour tout le club ({{reason}}) — aucun match a domicile.',
      clubBlockedNoReason: 'Ce jour est bloque pour tout le club — aucun match a domicile.',
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
    hall: 'Salle',
    league: 'Ligue',
    round: 'Tour',
    svrzPush: 'Envoi SVRZ',
    notInVolleymanager: 'Pas encore dans Volleymanager',
    copySvrz: 'Copier les details SVRZ',
    copied: 'Copie !',
    sourceSVRZ: 'Gere par SVRZ',
    sourceBasketplan: 'Gere par Basketplan',
    sourceManual: 'Manuel',
  },
  import: {
    ok: 'OK',
    error: {
      unknownTeam: 'Equipe inconnue',
      outOfScope: 'Hors perimetre',
      missingOpponent: 'Adversaire manquant',
      missingDate: 'Date manquante',
      unknownHall: 'Salle inconnue',
    },
  },
  gamesCount: '{{count}} matchs',
} as const
