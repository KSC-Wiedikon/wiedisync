export default {
  title: 'Live',
  subtitle: 'Verfolge das Spiel live aus der Halle.',

  // Verbindungs- / Spielstatus
  statusLive: 'Live',
  statusFinal: 'Beendet',
  statusIdle: 'Kein Live-Spiel',
  statusConnecting: 'Verbinden…',
  statusReconnecting: 'Neu verbinden…',

  // Leerer Zustand
  noMatch: 'Zurzeit kein Live-Spiel',
  noMatchHint: 'Diese Seite aktualisiert sich automatisch, sobald die Anzeigetafel ein Spiel startet.',

  // Sportart auf der Anzeigetafel
  sport_volleyball: 'Volleyball',
  sport_beach: 'Beachvolleyball',
  sport_basketball: 'Basketball',

  // Anzeigetafel — Volleyball / Beach
  serving: 'Aufschlag',
  sets: 'Sätze',
  set: 'Satz {{n}}',
  teamFallback: 'Team',
  toShort: 'AZ', // Auszeiten
  subShort: 'W', // Wechsel

  // Anzeigetafel — Basketball
  period: 'Viertel',
  quarter: 'V{{n}}',
  overtime: 'VL',
  overtimeN: 'VL{{n}}',
  points: 'Punkte',
  wonMatch: 'gewinnt das Spiel',
  watchLive: 'Ansehen',
  recentTitle: 'Zuletzt auf der Anzeigetafel',
  recentMatch: 'Spiel',
  recentResult: 'Resultat',
  recentSets: 'Sätze',
  recentWhen: 'Beendet',
  finalNoWinner: 'Spiel endet unentschieden',
  foulsShort: 'Fouls', // Teamfouls in diesem Viertel
  bonus: 'Bonus',
  bonusHint: 'Im Bonus — der Gegner hat 5 Teamfouls, dieses Team erhält Freiwürfe.',
  possessionOf: 'Ballbesitz: {{team}}',

  // Ereignisse der Anzeigetafel
  eventSetEnd: 'Satz beendet',
  eventMatchEnd: 'Spiel beendet',
  eventSwitch: 'Seitenwechsel',

  updatedAt: 'Aktualisiert {{time}}',

  // Final summary (match over)
  finalSetCol: 'Satz',
  finalScoreCol: 'Resultat',
  finalDurationCol: 'Dauer',
  finalMatchTime: 'Spielzeit',
  finalAfterRegulation: 'Nach vier Vierteln',
  finalAfterOvertime: 'Nach Verlängerung ({{label}})',
  finalAfterQuarter: 'Beendet im {{label}}',
  recentDuration: 'Spielzeit {{time}}',
  durationMin: '{{m}} Min.',
  durationHourMin: '{{h}} Std. {{m}} Min.',

  // Phone live scoring (/live/score/:gameId, migration 394)
  liveScoring: "Live-Resultat",
  scoringTitle: "Live-Resultat",
  home: "Heim",
  away: "Gast",
  addPointFor: "Punkt für {{team}}",
  minusPoint: "Punkt",
  undo: "Rückgängig",
  nextSet: "Nächster Satz",
  finishMatch: "Spiel beenden",
  reopenMatch: "Spiel wieder öffnen",
  finishEarlyConfirm: "Noch hat kein Team drei Sätze gewonnen. Spiel trotzdem beenden?",
  scoringHint: "Tippe auf ein Team, um ihm den Punkt zu geben. Alle können den Spielstand auf der Live-Seite verfolgen.",
  scoreChangedElsewhere: "Der Spielstand wurde auf einem anderen Handy geändert — prüfe ihn und tippe nochmals.",
  backToGame: "Zurück zum Spiel",
  sync_loading: "Wird geladen…",
  sync_synced: "Gespeichert",
  sync_saving: "Wird gespeichert…",
  sync_offline: "Offline — neuer Versuch folgt",
  cannotScoreTitle: "Du kannst dieses Spiel nicht erfassen",
  cannotScore_auth: "Melde dich an, um dieses Spiel zu erfassen.",
  cannotScore_not_found: "Dieses Spiel gibt es nicht.",
  cannotScore_no_team: "Dieses Spiel hat kein KSCW-Team.",
  cannotScore_sport: "Live-Resultate gibt es nur für Volleyballspiele.",
  cannotScore_not_played: "Dieses Spiel ist abgesagt oder verschoben.",
  cannotScore_no_member: "Nur Clubmitglieder können erfassen.",
  cannotScore_no_time: "Dieses Spiel hat noch keine Anspielzeit.",
  cannotScore_outside_window: "Das Live-Resultat öffnet 1 Stunde vor Spielbeginn und schliesst 4 Stunden danach.",
  cannotScore_not_participant: "Nur die Spieler auf dem Matchblatt, die Trainer und der Schreiberdienst dieses Spiels können es erfassen.",
}
