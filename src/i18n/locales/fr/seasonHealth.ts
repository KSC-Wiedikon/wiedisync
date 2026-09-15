// Santé de la saison — chrome only; the check texts and columns fall back to English.
export default {
  title: 'Santé de la saison',
  subtitle: 'Cette saison est-elle correctement configurée ? Joueurs, licences, staff, cotisations, matchs, tâches, réponses, entraînements et événements — chaque constat comme liste des lignes concernées.',
  seasonLine: 'Saison {{season}} · généré à {{time}}',
  rescan: 'Relancer',
  scanning: 'Analyse…',
  retry: 'Réessayer',
  loadFailed: 'Le rapport de santé de la saison n\'a pas pu être chargé.',
  notDeployed: 'Le point de terminaison n\'est pas encore déployé sur ce backend — réessayez après le prochain déploiement.',

  tab_volleyball: 'Volleyball',
  tab_basketball: 'Basketball',
  tab_club: 'Tout le club',

  section_teams: 'Équipes et staff',
  section_players: 'Joueurs et licences',
  section_finance: 'Cotisations et finances',
  section_games: 'Matchs',
  section_duties: 'Tâches',
  section_rsvp: 'Réponses',
  section_trainings: 'Entraînements',
  section_events: 'Événements',

  teamsTitle: 'Équipes',
  playersTitle: 'Joueurs',
  showClean: 'Afficher les contrôles sans constat',
  export: 'Exporter',
  exportFailed: 'Échec de l\'export',
  checkFailed: 'Contrôle échoué',
  registers: 'Registres',
} as const
