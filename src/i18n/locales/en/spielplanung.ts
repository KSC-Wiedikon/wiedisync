export default {
  title: 'Game planning',
  subtitleSeason: 'Season overview {{season}}',
  seasonPicker: 'Season',

  // View options
  viewCalendar: 'Calendar',
  viewWeek: 'Week',
  viewByDate: 'By date',
  viewByTeam: 'By team',

  // Week view
  weekPrev: 'Previous week',
  weekNext: 'Next week',
  weekToday: 'Today',
  weekMoveSuccess: 'Game moved.',
  weekMoveFailed: 'Could not move game: {{message}}',

  // Filters
  filterAll: 'All',
  filterVolleyball: 'Volleyball',
  filterBasketball: 'Basketball',
  filterHome: 'Home',
  filterAway: 'Away',
  showAbsences: 'Show absences',

  // Absence overlay badge (calendar day cells)
  absenceBadge: {
    title: '{{count}} absent',
    aria: 'Absences: {{count}}',
  },

  showCrossTeam: 'Show cross-team conflicts',
  crossTeamNeedsTeam: 'Pick a team first to see its cross-team conflicts',
  crossTeamBadge: {
    title: 'Cross-team conflicts: {{count}}',
    aria: 'Cross-team conflicts: {{count}}',
    hint: 'A team sharing players plays this day — it blocks a home slot here.',
    kind: {
      game: 'Game',
      home: 'Home game',
      away: 'Away game',
    },
  },

  // Day overflow popover (month view)
  overflow: {
    more: '+{{count}} more',
  },

  // Admin-only Spielplaner assignments accordion
  assignments: {
    title: 'Spielplaner assignments',
    hint: 'Assign members to specific teams so they can manage those teams\' manual games. Members flagged as club-wide Spielplaner (★) already have access to all teams.',
    member: 'Member',
    memberPlaceholder: 'Select member',
    team: 'Team',
    teamPlaceholder: 'Select team',
    add: 'Add',
    remove: 'Remove assignment',
    loading: 'Loading assignments…',
    empty: 'No scoped assignments yet. Add one above.',
    clubWide: '(club-wide Spielplaner)',
  },

  // Bulk import panel
  import: {
    title: 'Bulk import',
    hint: 'Download the template, fill in one game per row, then upload to preview. Rows with missing / unknown data will be skipped.',
    downloadTemplate: 'Download Excel template',
    importing: 'Importing…',
    importNValid: 'Import {{count}} valid game(s)',
    nSkipped: '{{count}} row(s) will be skipped',
    result: 'Imported {{created}} game(s). {{failed}} failed.',
    col: {
      team: 'Team',
      type: 'H/A',
      opponent: 'Opponent',
      date: 'Date',
      time: 'Time',
      hall: 'Hall',
      status: 'Status',
    },
    ok: 'OK',
    error: {
      unknownTeam: 'Unknown team',
      outOfScope: 'Out of scope',
      missingOpponent: 'Missing opponent',
      missingDate: 'Missing date',
      unknownHall: 'Unknown hall',
    },
  },

  // Manual game creation modal
  manualGame: {
    title: 'Add manual game',
    subtitle: 'Skips the opponent-invite flow — admin / Spielplaner sets all details.',
    sport: 'Sport',
    team: 'Team',
    teamPlaceholder: 'Select team',
    homeAway: 'Home / Away',
    home: 'Home',
    away: 'Away',
    opponent: 'Opponent',
    opponentPlaceholder: 'e.g. Goldcoast Wadenswil 1',
    date: 'Date',
    time: 'Time',
    hall: 'Hall',
    hallPlaceholder: 'Select hall',
    hallComboAB: 'KWI A + B',
    saturdayHint: 'Prefilled: {{hall}} — Saturday prefers KWI C / own training over A/B',
    awayVenue: 'Away venue',
    venueName: 'Venue name',
    venueAddress: 'Address',
    venueCity: 'City / ZIP',
    venuePlusCode: 'Plus code (optional)',
    league: 'League',
    leaguePlaceholder: 'Optional',
    round: 'Round',
    autoConfirmRsvp: 'Auto-confirm RSVP',
    autoConfirmRsvpHint: 'Override team default ({{def}}). All eligible members start as confirmed; they must opt out.',
    useTeamDefault: 'Use team default',
    on: 'On',
    off: 'Off',
    create: 'Create game',
    editTitle: 'Edit manual game',
    save: 'Save changes',
    conflict: {
      sameTeamSameDay: 'This team is already scheduled on the same day ({{time}} vs {{opponent}}).',
      hallOverlap: 'Hall is already booked at an overlapping time ({{time}}–{{endTime}}).',
      sameTeamWithinTwoDays: 'This team also plays {{date}} at {{time}} ({{daysDelta}} days apart).',
    },
  },

  // List/row status labels
  status: {
    scheduled: 'Planned',
    live: 'Live',
    completed: 'Played',
    postponed: 'Postponed',
  },
  emptyState: 'No games found',

  // Game detail drawer
  drawer: {
    vs: 'vs',
    hall: 'Hall',
    league: 'League',
    round: 'Round',
    svrzPush: 'SVRZ push',
    notInVolleymanager: 'Not yet in Volleymanager',
    copySvrz: 'Copy SVRZ details',
    copied: 'Copied!',
    sourceSVRZ: 'Managed by SVRZ',
    sourceBasketplan: 'Managed by Basketplan',
    sourceManual: 'Manual',
    edit: 'Edit',
    delete: 'Delete',
    deleteConfirmTitle: 'Delete manual game?',
    deleteConfirmBody: 'This cannot be undone.',
    confirmDelete: 'Delete',
    cancel: 'Cancel',
    svrzReadOnlyHint: 'Official details come from SVRZ. Edit those on Volleymanager.',
    markAsComboAB: 'Mark as KWI A + B',
    unmarkCombo: 'Back to single hall',
  },
  colDate: 'Date',
  colTime: 'Time',
  colTeam: 'Team',
  colMatchup: 'Matchup',
  colType: 'H/A',
  colHall: 'Hall',
  colStatus: 'Status',
  gamesCount: '{{count}} games',
} as const
