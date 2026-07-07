export default {
  title: 'Scorer assignment',
  subtitle: 'Automatically assign scorer and scoreboard duty teams to home games.',

  // Actions
  runAlgorithm: 'Run algorithm',
  saveAll: 'Save all',
  downloadXlsx: 'Download Excel',
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

  // Algorithm rules (info panel)
  rulesTitle: 'Algorithm rules',
  rulesModeVb: 'Volleyball: separate scorer and scoreboard teams. At Döltschi and in 4L/5L one team does both (combined). HU20 home games use only a referee (no scorer or scoreboard).',
  refereeCount: 'Referee',
  refereeTag: 'Ref',
  noRefereeAvailable: 'No referee available',
  rulesModeBb: 'Basketball: one duty team per home game supplies all officials (scorer, timekeeper, and 24s operator when required).',
  rulesHardTitle: 'Hard rules — team is excluded',
  rulesSoftTitle: 'Soft rules — points (each team starts at 100, highest score wins)',
  rulesExisting: 'Games that already have a saved assignment are kept unchanged.',
  ruleVbHardGame: 'Team plays a game overlapping this one (an earlier/later slot the same day is fine)',
  ruleVbHardDoltschi: 'Döltschi: Under teams only (HU20, HU23-1, DU23-1, DU23-2)',
  ruleVbHardDuty: 'Team already has a duty the same day',
  ruleVbHardLicence: 'Scorer / combined: team needs a member with a scorer licence',
  ruleVbSoftSequence: 'Plays right before/after in the same hall: +50',
  ruleVbSoftHu20: 'HU20 as scoreboard: +15',
  ruleVbSoftDoltschi: 'Under team combined at Döltschi: +10',
  ruleVbSoftLegends: 'Legends as scorer: +8',
  ruleVbSoftWeekend: 'Weekend without training: +5',
  ruleVbSoftTraining: 'Training the same day: -20',
  ruleVbSoftRotation: 'Fair rotation: -10 per duty already assigned',
  ruleBbHardGame: 'Team has its own game the same day',
  ruleBbHardDuty: 'Team already has a duty the same day',
  ruleBbHardOtr1: 'Team needs a member with an OTR1 licence (scorer/timekeeper)',
  ruleBbSoftFullCrew: 'Full crew (team also has OTR2/OTN for the 24s): +25',
  ruleBbSoftSequence: 'Plays right before/after in the same hall: +30',
  ruleBbSoftTraining: 'Training the same day: -20',
  ruleBbSoftRotation: 'Fair rotation: -10 per duty already assigned',
  ruleBbSoftWeekend: 'Weekend without training: +5',
} as const
