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

  // Algorithm rules (info panel)
  rulesTitle: 'Règles de l\'algorithme',
  rulesModeVb: 'Volleyball : équipes de marqueur et de tableau séparées. À Döltschi et en 4L/5L, une seule équipe fait les deux (combiné). Les matchs à domicile HU20 utilisent marqueur + arbitre au lieu du tableau.',
  refereeCount: 'Arbitre',
  refereeTag: 'Arb',
  noRefereeAvailable: 'Aucun arbitre disponible',
  rulesModeBb: 'Basketball : une équipe de service par match à domicile fournit tous les officiels (marqueur, chronométreur et opérateur des 24s si nécessaire).',
  rulesHardTitle: 'Règles strictes — l\'équipe est exclue',
  rulesSoftTitle: 'Règles souples — points (chaque équipe démarre à 100, le meilleur score gagne)',
  rulesExisting: 'Les matchs avec une attribution déjà enregistrée restent inchangés.',
  ruleVbHardGame: 'L\'équipe joue un match qui chevauche celui-ci (un créneau plus tôt/tard le même jour est ok)',
  ruleVbHardDoltschi: 'Döltschi : équipes U uniquement (HU20, HU23-1, DU23-1, DU23-2)',
  ruleVbHardDuty: 'L\'équipe a déjà un service le même jour',
  ruleVbHardLicence: 'Marqueur / combiné : l\'équipe a besoin d\'un membre avec licence de marqueur',
  ruleVbSoftSequence: 'Joue juste avant/après dans la même salle : +50',
  ruleVbSoftHu20: 'HU20 au tableau : +15',
  ruleVbSoftDoltschi: 'Équipe U en combiné à Döltschi : +10',
  ruleVbSoftLegends: 'Legends comme marqueur : +8',
  ruleVbSoftWeekend: 'Week-end sans entraînement : +5',
  ruleVbSoftTraining: 'Entraînement le même jour : -20',
  ruleVbSoftRotation: 'Rotation équitable : -10 par service déjà attribué',
  ruleBbHardGame: 'L\'équipe a son propre match le même jour',
  ruleBbHardDuty: 'L\'équipe a déjà un service le même jour',
  ruleBbHardOtr1: 'L\'équipe a besoin d\'un membre avec licence OTR1 (marqueur/chronométreur)',
  ruleBbSoftFullCrew: 'Équipe complète (a aussi OTR2/OTN pour les 24s) : +25',
  ruleBbSoftSequence: 'Joue juste avant/après dans la même salle : +30',
  ruleBbSoftTraining: 'Entraînement le même jour : -20',
  ruleBbSoftRotation: 'Rotation équitable : -10 par service déjà attribué',
  ruleBbSoftWeekend: 'Week-end sans entraînement : +5',
} as const
