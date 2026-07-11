export default {
  title: 'Calendrier',

  // View options
  viewHall: 'Salle',
  viewWeek: 'Semaine',
  viewMonth: 'Calendrier',
  viewSchedule: 'Matchs',
  viewList: 'Liste',

  // Subtitles
  subtitleHall: 'Plan d\'occupation de la salle',
  subtitleWeek: 'Apercu hebdomadaire de tous les evenements',
  subtitleMonth: 'Apercu mensuel de tous les evenements',
  subtitleSchedule: 'Matchs proposés et confirmés de vos équipes',
  subtitleList: 'Tous les evenements par ordre chronologique',

  // Filter modal
  filterTitle: 'Filtrer',
  filterCategories: 'Categories',
  showHiddenAbsences: 'Afficher les indisponibilités et absences non bloquantes',
  showHiddenAbsencesHint: 'Désactivé par défaut — elles encombrent le calendrier et n\'affectent pas le reste de l\'équipe.',

  // Filter groups
  filterGroupGames: 'Matchs',
  filterGroupActivities: 'Activités',
  filterGroupVenue: 'Salle',
  filterGroupOther: 'Autre',

  // Source filters
  sourceGames: 'Matchs',
  sourceTrainings: 'Entrainements',
  sourceClosures: 'Fermetures',
  sourceEvents: 'Evenements',

  // Game type filters
  gameTypeHome: 'Matchs a domicile',
  gameTypeAway: 'Matchs a l\'exterieur',
  sourceHallHW: 'Halle HW',
  sourceAbsences: 'Absences',
  sourceBirthdays: 'Anniversaires',

  // Type labels
  typeGame: 'Match',
  typeTraining: 'Entrainement',
  typeClosure: 'Fermeture de salle',
  typeEvent: 'Evenement',
  typeHall: 'Reservation de salle',
  typeAbsence: 'Absence',
  typeBirthday: 'Anniversaire',
  turnsLabel: 'Fête ses',

  // Other
  noEntries: 'Aucune entree trouvee',
  weekLabel: 'SC {{week}} : {{start}} – {{end}}',
  exportICal: 'Exporter iCal',
  subscribeICal: 'S\'abonner',

  // iCal modal
  icalSubscribeTitle: 'S\'abonner au calendrier',
  icalDownloadTitle: 'Exporter le calendrier',
  icalFilterLabel: 'A quoi souhaitez-vous vous abonner ?',
  icalTeamFilter: 'Filtrer par equipe',
  icalTeamHint: 'Vide = toutes les equipes',
  icalGenerateLink: 'Generer le lien d\'abonnement',
  icalLinkReadyLabel: 'Lien d\'abonnement (a copier dans votre app de calendrier) :',
  icalCopyLink: 'Copier',
  icalLinkCopied: 'Copie !',
  icalCopyFailed: 'Impossible de copier — selectionnez le lien et copiez-le manuellement',
  icalOpenInApp: 'Ou ouvrir directement dans votre app de calendrier',
  icalSubscribeHint:
    'Collez ce lien dans votre application de calendrier pour vous abonner — il se met a jour automatiquement. Google Agenda : Autres agendas → A partir de l\'URL. Apple Calendrier : Fichier → Nouvel abonnement a un calendrier.',

  // Engagements au marquage (personnels)
  sourceScorerDuty: 'Mes engagements',
  typeScorerDuty: 'Engagement au marquage',
  icalDutiesTitle: 'Vos engagements au marquage',
  icalDutiesHint: 'Abonnez-vous a un calendrier personnel qui ajoute automatiquement vos engagements de marqueur et de tableau.',
  icalDutiesGenerate: 'Generer mon lien d\'engagements',
  icalDutiesIncludedHint: 'Tes propres services de marqueur / officiel sont toujours inclus dans cet abonnement.',
  icalDutiesPrivacyHint: 'Lien personnel — gardez-le prive. Il n\'affiche que votre planning d\'engagements (aucune donnee personnelle).',
  icalDutiesError: 'Impossible de creer votre lien personnel.',

  // Modale de detail + superpositions
  coach: 'Entraineur',
  cancelled: 'Annulé',
  moreCount: '+{{count}} de plus',
  absentCount: '{{count}} absent(s)',
  eventTypeVerein: 'Club',
  eventTypeSocial: 'Social',
  eventTypeMeeting: 'Reunion',
  eventTypeTournament: 'Tournoi',
  eventTypeTrainingsweekend: 'Trainingsweekend',
  eventTypeFriendly: 'Match amical',
  eventTypeOther: 'Autre',
} as const
