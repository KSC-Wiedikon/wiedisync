export default {
  title: 'Live',
  subtitle: 'Verfolg s Spiel live us de Halle.',

  // Verbindigs- / Spielstatus
  statusLive: 'Live',
  statusFinal: 'Fertig',
  statusIdle: 'Kes Live-Spiel',
  statusConnecting: 'Verbinde…',
  statusReconnecting: 'Nomol verbinde…',

  // Leere Zuestand
  noMatch: 'Momentan kes Live-Spiel',
  noMatchHint: 'Die Siite aktualisiert sich automatisch, sobald d Aazeigtafle es Spiel startet.',

  // Sportart uf de Aazeigtafle
  sport_volleyball: 'Volleyball',
  sport_beach: 'Beachvolleyball',
  sport_basketball: 'Basketball',

  // Aazeigtafle — Volleyball / Beach
  serving: 'Ufschlag',
  sets: 'Sätz',
  set: 'Satz {{n}}',
  teamFallback: 'Team',
  toShort: 'AZ', // Auszite
  subShort: 'W', // Wächsel

  // Aazeigtafle — Basketball
  period: 'Viertel',
  quarter: 'V{{n}}',
  overtime: 'VL',
  overtimeN: 'VL{{n}}',
  points: 'Pünkt',
  wonMatch: 'gwünnt s Spiel',
  watchLive: 'Aaluege',
  recentTitle: 'Zletscht uf de Aazeigtafle',
  recentMatch: 'Spiel',
  recentResult: 'Resultat',
  recentSets: 'Sätz',
  recentWhen: 'Fertig',
  finalNoWinner: 'Spiel goht unentschide us',
  foulsShort: 'Fouls', // Teamfouls i dem Viertel
  bonus: 'Bonus',
  bonusHint: 'Im Bonus — de Gegner het 5 Teamfouls, das Team überchunnt Freiwürf.',
  possessionOf: 'Ballbesitz: {{team}}',

  // Ereignis vo de Aazeigtafle
  eventSetEnd: 'Satz fertig',
  eventMatchEnd: 'Spiel fertig',
  eventSwitch: 'Sitewächsel',

  updatedAt: 'Aktualisiert {{time}}',

  // Final summary (match over)
  finalSetCol: 'Satz',
  finalScoreCol: 'Resultat',
  finalDurationCol: 'Duur',
  finalMatchTime: 'Spielziit',
  finalAfterRegulation: 'Nach vier Viertel',
  finalAfterOvertime: 'Nach dr Verlängerig ({{label}})',
  finalAfterQuarter: 'Fertig im {{label}}',
  recentDuration: 'Spielziit {{time}}',
  durationMin: '{{m}} Min.',
  durationHourMin: '{{h}} Std. {{m}} Min.',

  // Phone live scoring (/live/score/:gameId, migration 394)
  liveScoring: "Live-Resultat",
  scoringTitle: "Live-Resultat",
  home: "Heim",
  away: "Gascht",
  addPointFor: "Punkt für {{team}}",
  minusPoint: "Punkt",
  undo: "Rückgängig",
  nextSet: "Nächschte Satz",
  finishMatch: "Spiel beände",
  reopenMatch: "Spiel wieder öffne",
  finishEarlyConfirm: "No kei Team hät drü Sätz gwunne. Spiel glich beände?",
  scoringHint: "Tipp uf es Team, zum ihm de Punkt gäh. Alli chönd de Spielstand uf de Live-Siite verfolge.",
  scoreChangedElsewhere: "De Spielstand isch uf emne andere Handy gänderet worde — prüef en und tipp nomal.",
  backToGame: "Zrugg zum Spiel",
  sync_loading: "Wird glade…",
  sync_synced: "Gspeicheret",
  sync_saving: "Wird gspeicheret…",
  sync_offline: "Offline — neue Versuech folgt",
  cannotScoreTitle: "Du chasch das Spiel nöd erfasse",
  cannotScore_auth: "Mäld di aa, zum das Spiel erfasse.",
  cannotScore_not_found: "Das Spiel gits nöd.",
  cannotScore_no_team: "Das Spiel hät kei KSCW-Team.",
  cannotScore_sport: "Live-Resultat gits nur für Volleyballspiel.",
  cannotScore_not_played: "Das Spiel isch abgseit oder verschobe.",
  cannotScore_no_member: "Nur Clubmitglieder chönd erfasse.",
  cannotScore_no_time: "Das Spiel hät no kei Aaspielziit.",
  cannotScore_outside_window: "S Live-Resultat gaht 1 Stund vor Spielbeginn uf und 4 Stund dänoch zue.",
  cannotScore_not_participant: "Nur d Spieler uf em Matchblatt, d Trainer und de Schriiberdienst vo dem Spiel chönd s erfasse.",
}
