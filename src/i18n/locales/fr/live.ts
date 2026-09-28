export default {
  title: 'Live',
  subtitle: 'Suivez le match en direct depuis la salle.',

  // Statut de connexion / du match
  statusLive: 'En direct',
  statusFinal: 'Terminé',
  statusIdle: 'Aucun match en direct',
  statusConnecting: 'Connexion…',
  statusReconnecting: 'Reconnexion…',

  // État vide
  noMatch: 'Aucun match en direct pour le moment',
  noMatchHint: 'Cette page se met à jour automatiquement dès que le tableau d’affichage démarre un match.',

  // Sport affiché
  sport_volleyball: 'Volleyball',
  sport_beach: 'Beach-volley',
  sport_basketball: 'Basketball',

  // Tableau d’affichage — volleyball / beach
  serving: 'Au service',
  sets: 'Sets',
  set: 'Set {{n}}',
  teamFallback: 'Équipe',
  toShort: 'TM', // temps morts
  subShort: 'Rem', // remplacements

  // Tableau d’affichage — basketball
  period: 'Période',
  quarter: 'Q{{n}}',
  overtime: 'Prol.',
  overtimeN: 'Prol. {{n}}',
  points: 'Points',
  wonMatch: 'remporte le match',
  watchLive: 'Regarder',
  recentTitle: 'Récemment sur le tableau',
  recentMatch: 'Match',
  recentResult: 'Résultat',
  recentSets: 'Sets',
  recentWhen: 'Terminé',
  finalNoWinner: 'Match terminé à égalité',
  foulsShort: 'Fautes', // fautes d’équipe dans cette période
  bonus: 'Bonus',
  bonusHint: 'Dans le bonus — l’adversaire a 5 fautes d’équipe, cette équipe tire des lancers francs.',
  possessionOf: 'Possession : {{team}}',

  // Événements du tableau
  eventSetEnd: 'Set terminé',
  eventMatchEnd: 'Match terminé',
  eventSwitch: 'Changement de côté',

  updatedAt: 'Mis à jour {{time}}',

  // Final summary (match over)
  finalSetCol: 'Set',
  finalScoreCol: 'Score',
  finalDurationCol: 'Durée',
  finalMatchTime: 'Durée du match',
  finalAfterRegulation: 'Après quatre quart-temps',
  finalAfterOvertime: 'Après prolongation ({{label}})',
  finalAfterQuarter: 'Terminé en {{label}}',
  recentDuration: 'Durée du match {{time}}',
  durationMin: '{{m}} min',
  durationHourMin: '{{h}} h {{m}} min',

  // Phone live scoring (/live/score/:gameId, migration 394)
  liveScoring: "Score en direct",
  scoringTitle: "Score en direct",
  home: "Domicile",
  away: "Extérieur",
  addPointFor: "Point pour {{team}}",
  minusPoint: "Point",
  undo: "Annuler",
  nextSet: "Set suivant",
  finishMatch: "Terminer le match",
  reopenMatch: "Rouvrir le match",
  finishEarlyConfirm: "Aucune équipe n’a encore gagné trois sets. Terminer quand même le match ?",
  scoringHint: "Touchez une équipe pour lui donner le point. Tout le monde peut suivre le score sur la page Live.",
  scoreChangedElsewhere: "Le score a été modifié sur un autre téléphone — vérifiez-le et touchez à nouveau.",
  backToGame: "Retour au match",
  sync_loading: "Chargement…",
  sync_synced: "Enregistré",
  sync_saving: "Enregistrement…",
  sync_offline: "Hors ligne — nouvel essai à venir",
  cannotScoreTitle: "Vous ne pouvez pas saisir ce match",
  cannotScore_auth: "Connectez-vous pour saisir ce match.",
  cannotScore_not_found: "Ce match n’existe pas.",
  cannotScore_no_team: "Ce match n’a pas d’équipe KSCW.",
  cannotScore_sport: "Le score en direct n’est disponible que pour le volleyball.",
  cannotScore_not_played: "Ce match est annulé ou reporté.",
  cannotScore_no_member: "Seuls les membres du club peuvent saisir.",
  cannotScore_no_time: "Ce match n’a pas encore d’heure de début.",
  cannotScore_outside_window: "Le score en direct ouvre 1 heure avant le début et ferme 4 heures après.",
  cannotScore_not_participant: "Seuls les joueurs de la feuille de match, les entraîneurs et le service de marque de ce match peuvent le saisir.",
}
