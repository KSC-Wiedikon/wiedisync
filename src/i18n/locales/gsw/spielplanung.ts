export default {
  title: 'Spielplanig',
  subtitleSeason: 'Saisonübersicht {{season}}',
  seasonPicker: 'Saison',

  // View options
  viewCalendar: 'Kaländer',
  viewWeek: 'Week',
  viewByDate: 'Nach Datum',
  viewByTeam: 'Nach Team',

  // Week view
  weekPrev: 'Previous week',
  weekNext: 'Next week',
  weekToday: 'Today',
  weekMoveSuccess: 'Game moved.',
  weekMoveFailed: 'Could not move game: {{message}}',

  // Filters
  filterAll: 'Alli',
  filterVolleyball: 'Volleyball',
  filterBasketball: 'Basketball',
  filterHome: 'Heim',
  filterAway: 'Uswärts',
  showAbsences: 'Absänze aazeige',

  // Absence overlay badge (calendar day cells)
  absenceBadge: {
    title: '{{count}} abwäsend',
    aria: 'Absänze: {{count}}',
  },

  showCrossTeam: 'Team-Konflikt aazeige',
  crossTeamNeedsTeam: 'Zerscht es Team uswähle, zum d Team-Konflikt gseh',
  crossTeamBadge: {
    title: 'Team-Konflikt: {{count}}',
    aria: 'Team-Konflikt: {{count}}',
    hint: 'Es Team mit gmeinsame Spiler spilt a dem Tag — das blockiert da en Heimslot.',
    kind: {
      game: 'Spiel',
      home: 'Heimspiel',
      away: 'Uswärtsspiel',
    },
  },

  // Day overflow popover (month view)
  overflow: {
    more: '+{{count}} meh',
  },

  // Manual game creation modal
  manualGame: {
    title: 'Manuells Spiel erfasse',
    subtitle: 'Übergoht de Ilade-Flow — Admin / Spielplaner setzt alli Details sälber.',
    sport: 'Sportart',
    team: 'Team',
    teamPlaceholder: 'Team usläse',
    homeAway: 'Heim / Uswärts',
    home: 'Heim',
    away: 'Uswärts',
    opponent: 'Gägner',
    opponentPlaceholder: 'z.B. Goldcoast Wädenswil 1',
    date: 'Datum',
    time: 'Ziit',
    hall: 'Halle',
    hallPlaceholder: 'Halle usläse',
    awayVenue: 'Uswärts-Spielort',
    venueName: 'Name vo de Halle',
    venueAddress: 'Adrässe',
    venueCity: 'PLZ / Ort',
    venuePlusCode: 'Plus-Code (optional)',
    league: 'Liga',
    leaguePlaceholder: 'Optional',
    round: 'Rundi',
    create: 'Spiel erstelle',
    conflict: {
      sameTeamSameDay: 'Das Team spilt scho am gliiche Tag ({{time}} gäge {{opponent}}).',
      hallOverlap: 'Halle isch scho zu äre überlappende Ziit bsetzt ({{time}}–{{endTime}}).',
      sameTeamWithinTwoDays: 'Das Team spilt au am {{date}} um {{time}} ({{daysDelta}} Täg Abschtand).',
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
    vs: 'gege',
    hall: 'Halle',
    league: 'Liga',
    round: 'Rundi',
    svrzPush: 'SVRZ-Übertragig',
    notInVolleymanager: 'Nonig im Volleymanager',
    copySvrz: 'SVRZ-Details kopiere',
    copied: 'Kopiert!',
    sourceSVRZ: 'Verwaltet vo SVRZ',
    sourceBasketplan: 'Verwaltet vo Basketplan',
    sourceManual: 'Manuell',
  },
} as const
