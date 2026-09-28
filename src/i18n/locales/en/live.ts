export default {
  title: 'Live',
  subtitle: 'Follow the match live from the hall.',

  // Connection / match status
  statusLive: 'Watching live',
  statusFinal: 'Final',
  statusIdle: 'No live match',
  statusConnecting: 'Connecting…',
  statusReconnecting: 'Reconnecting…',

  // Empty state
  noMatch: 'No live match right now',
  noMatchHint: 'This page updates automatically when the scoreboard starts a match.',

  // Sport on the board
  sport_volleyball: 'Volleyball',
  sport_beach: 'Beach volleyball',
  sport_basketball: 'Basketball',

  // Scoreboard — volleyball / beach
  serving: 'Serving',
  sets: 'Sets',
  set: 'Set {{n}}',
  teamFallback: 'Team',
  toShort: 'TO', // timeouts
  subShort: 'Sub', // substitutions

  // Scoreboard — basketball
  period: 'Period',
  quarter: 'Q{{n}}',
  overtime: 'OT',
  overtimeN: 'OT{{n}}',
  points: 'Points',
  wonMatch: 'won the match',
  watchLive: 'Watch',
  recentTitle: 'Recent on the scoreboard',
  recentMatch: 'Match',
  recentResult: 'Result',
  recentSets: 'Sets',
  recentWhen: 'Finished',
  finalNoWinner: 'Match ended level',
  foulsShort: 'Fouls', // team fouls this period
  bonus: 'Bonus',
  bonusHint: 'In the bonus — the opponent has 5 team fouls, so this team shoots free throws.',
  possessionOf: 'Possession: {{team}}',

  // Board events
  eventSetEnd: 'Set finished',
  eventMatchEnd: 'Match finished',
  eventSwitch: 'Teams change sides',

  updatedAt: 'Updated {{time}}',

  // Final summary (match over)
  finalSetCol: 'Set',
  finalScoreCol: 'Score',
  finalDurationCol: 'Duration',
  finalMatchTime: 'Match time',
  finalAfterRegulation: 'After four quarters',
  finalAfterOvertime: 'After overtime ({{label}})',
  finalAfterQuarter: 'Ended in {{label}}',
  recentDuration: 'Match time {{time}}',
  durationMin: '{{m}} min',
  durationHourMin: '{{h}} h {{m}} min',

  // Phone live scoring (/live/score/:gameId, migration 394)
  liveScoring: "Live scoring",
  scoringTitle: "Live scoring",
  home: "Home",
  away: "Away",
  addPointFor: "Point for {{team}}",
  minusPoint: "Point",
  undo: "Undo",
  nextSet: "Next set",
  finishMatch: "End match",
  reopenMatch: "Reopen match",
  finishEarlyConfirm: "No team has won three sets yet. End the match anyway?",
  scoringHint: "Tap a team to give it the point. Everyone can follow the score on the Live page.",
  scoreChangedElsewhere: "The score was changed on another phone — check it and tap again.",
  backToGame: "Back to the game",
  sync_loading: "Loading…",
  sync_synced: "Saved",
  sync_saving: "Saving…",
  sync_offline: "Offline — will retry",
  cannotScoreTitle: "You cannot score this game",
  cannotScore_auth: "Log in to score this game.",
  cannotScore_not_found: "This game does not exist.",
  cannotScore_no_team: "This game has no KSCW team.",
  cannotScore_sport: "Live scoring is available for volleyball games only.",
  cannotScore_not_played: "This game is cancelled or postponed.",
  cannotScore_no_member: "Only club members can score.",
  cannotScore_no_time: "This game has no kickoff time yet.",
  cannotScore_outside_window: "Live scoring opens 1 hour before kickoff and closes 4 hours after.",
  cannotScore_not_participant: "Only the players on the match sheet, the coaches and the scorer duty of this game can score it.",
}
