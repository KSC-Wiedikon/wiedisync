export default {
  title: 'Scorer assignment',
  subtitle: 'Automatically assign scorer and scoreboard duty teams to home games.',

  // Actions
  runAlgorithm: 'Run algorithm',
  saveAll: 'Save all',
  saving: 'Saving...',
  running: 'Computing...',

  // Season
  season: 'Season',

  // Table headers
  date: 'Date',
  time: 'Time',
  hall: 'Hall',
  home: 'Home',
  away: 'Away',
  league: 'League',
  autoScorer: 'Scorer',
  autoTaefeler: 'Scoreboard',
  score: 'Score',
  conflicts: 'Conflicts',

  // Summary
  teamSummary: 'Team summary',
  teamName: 'Team',
  scorerCount: 'Scorer',
  scoreboardCount: 'Scoreboard',
  combinedCount: 'Scorer/Scoreboard',
  ownGames: 'Games',
  totalCount: 'Total',

  // Status
  noGames: 'No games loaded.',
  gamesLoaded: '{{count}} games loaded.',
  assignmentsDone: 'Assignment complete. {{assigned}} of {{total}} games assigned.',
  saveSuccess: '{{count}} games updated.',
  saveError: 'Error saving.',

  // Existing
  existingKept: 'Existing assignment kept',
  noTeamAvailable: 'No team available',
  noScorerAvailable: 'No scorer available',
  noTaefelerAvailable: 'No scoreboard operator available',

  // Reasons (hard rules)
  reason_gameSameDay: 'Game on same day',
  reason_doltschiUnderOnly: 'Döltschi: Under teams only',
  reason_alreadyDuty: 'Already assigned duty same day',
  reason_noLicence: 'No scorer licence',

  // Reasons (soft rules)
  reason_training: 'Training ({{points}})',
  reason_sequenceBonus: 'Sequence bonus (+{{points}})',
  reason_rotation: 'Rotation: {{count}}x ({{points}})',
  reason_hu20Taefeler: 'HU20 scoreboard (+{{points}})',
  reason_underDoltschi: 'Under team Döltschi (+{{points}})',
  reason_legendsScorer: 'Legends scorer (+{{points}})',
  reason_weekendFree: 'Weekend free (+{{points}})',

  // Basketball
  subtitleBb: 'Automatically assign a duty team to each basketball home game.',
  autoDutyTeam: 'Duty team',
  dutyTeamTag: 'Duty',
  dutyCount: 'Duties',
  reason_noOtr1: 'No OTR1 official',
  reason_fullCrew: 'Full crew (+{{points}})',

  // Override
  selectTeam: '— Team —',
} as const
