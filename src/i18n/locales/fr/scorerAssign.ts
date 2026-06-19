export default {
  title: 'Attribution des marqueurs',
  subtitle: 'Attribuer automatiquement les equipes de marqueur et de tableau d\'affichage aux matchs a domicile.',

  // Actions
  runAlgorithm: 'Lancer l\'algorithme',
  saveAll: 'Tout enregistrer',
  saving: 'Enregistrement...',
  running: 'Calcul...',

  // Season
  season: 'Saison',

  // Table headers
  date: 'Date',
  time: 'Heure',
  hall: 'Salle',
  home: 'Domicile',
  away: 'Exterieur',
  league: 'Ligue',
  autoScorer: 'Marqueur',
  autoTaefeler: 'Tableau',
  score: 'Score',
  conflicts: 'Conflits',

  // Summary
  teamSummary: 'Resume par equipe',
  teamName: 'Equipe',
  scorerCount: 'Marqueur',
  scoreboardCount: 'Tableau',
  combinedCount: 'Marqueur/Tableau',
  ownGames: 'Matchs',
  totalCount: 'Total',

  // Status
  noGames: 'Aucun match charge.',
  gamesLoaded: '{{count}} matchs charges.',
  assignmentsDone: 'Attribution terminee. {{assigned}} sur {{total}} matchs attribues.',
  saveSuccess: '{{count}} matchs mis a jour.',
  saveError: 'Erreur lors de l\'enregistrement.',

  // Existing
  existingKept: 'Attribution existante conservee',
  noTeamAvailable: 'Aucune equipe disponible',
  noScorerAvailable: 'Aucun marqueur disponible',
  noTaefelerAvailable: 'Aucun operateur de tableau disponible',

  // Reasons (hard rules)
  reason_gameSameDay: 'Match le meme jour',
  reason_doltschiUnderOnly: 'Doltschi : equipes Under uniquement',
  reason_alreadyDuty: 'Deja en service le meme jour',
  reason_noLicence: 'Pas de licence de marqueur',

  // Reasons (soft rules)
  reason_training: 'Entrainement ({{points}})',
  reason_sequenceBonus: 'Bonus de sequence (+{{points}})',
  reason_rotation: 'Rotation : {{count}}x ({{points}})',
  reason_hu20Taefeler: 'HU20 tableau (+{{points}})',
  reason_underDoltschi: 'Equipe Under Doltschi (+{{points}})',
  reason_legendsScorer: 'Legends marqueur (+{{points}})',
  reason_weekendFree: 'Weekend libre (+{{points}})',

  // Basketball
  subtitleBb: 'Attribuer automatiquement une equipe de service a chaque match de basket a domicile.',
  autoDutyTeam: 'Equipe de service',
  dutyTeamTag: 'Service',
  dutyCount: 'Services',
  reason_noOtr1: 'Pas d\'officiel OTR1',
  reason_fullCrew: 'Equipe complete (+{{points}})',

  // Override
  selectTeam: '— Equipe —',
} as const
