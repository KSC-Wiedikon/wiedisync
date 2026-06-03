export default {
  title: 'Absences',
  subtitle: 'Gestion centralisee des absences',

  // Tabs
  tabMyAbsences: 'Mes absences',
  tabTeamAbsences: 'Absences de l\'equipe',

  // Actions
  newAbsence: 'Nouvelle absence',
  newAbsenceForMember: 'Absence pour un membre',
  newWeeklyForMember: 'Hebdomadaire pour un membre',

  // Form
  member: 'Membre',
  startDate: 'Du',
  endDate: 'Au',
  reason: 'Motif',
  detailsOptional: 'Details (optionnel)',
  detailsPlaceholder: 'Informations supplementaires...',
  affects: 'Concerne',

  // Reason options
  reasonInjury: 'Blessure',
  reasonVacation: 'Vacances',
  reasonWork: 'Travail',
  reasonPersonal: 'Personnel',
  reasonOther: 'Autre',
  weeklyUnavailability: 'Indisponibilité hebdomadaire',

  // Affects options
  affectsTrainings: 'Entrainements',
  affectsGames: 'Matchs',
  affectsEvents: 'Evenements',
  affectsAll: 'Tout',

  // Validation
  startDateRequired: 'La date de debut est requise',
  endDateRequired: 'La date de fin est requise',
  endAfterStart: 'La date de fin doit etre posterieure a la date de debut',
  reasonRequired: 'Veuillez selectionner un motif',
  memberRequired: 'Veuillez selectionner un membre',
  errorSaving: 'Erreur lors de l\'enregistrement de l\'absence',

  // Modal titles
  newAbsenceTitle: 'Nouvelle absence',
  editAbsenceTitle: 'Modifier l\'absence',

  // Delete dialog
  deleteTitle: 'Supprimer l\'absence',
  deleteMessage: 'Voulez-vous vraiment supprimer cette absence ?',

  // Empty states
  noAbsences: 'Aucune absence',
  noAbsencesDescription: 'Aucune absence trouvee.',
  noUpcomingAbsences: 'Aucune absence en cours.',
  showOlderAbsences: 'Afficher les absences passees ({{count}})',
  noTeamAbsences: 'Aucune absence',
  noTeamAbsencesDescription: 'Aucune absence signalee pour cette periode.',

  // Team absence view
  fromTo: 'Du',
  until: 'Au',

  // Import
  importAbsences: 'Importer',
  importTitle: 'Importer des absences',
  importDescription: 'Telecharger un fichier CSV ou Excel avec plusieurs absences.',
  importDownloadTemplate: 'Telecharger le modele',
  importPreview: 'Apercu',
  importValidRows: '{{valid}} valides sur {{total}}',
  importButton: 'Importer ({{count}})',
  importSuccess: '{{count}} absences importees avec succes',
  importPartialSuccess: '{{created}} importees, {{failed}} echouees',
  importNoValidRows: 'Aucune ligne valide trouvee',
  importInvalidReason: 'Motif invalide: "{{value}}"',
  importInvalidDate: 'Format de date invalide',
  importParseError: 'Impossible de lire le fichier',

  // Indefinite
  indefinite: 'Indefini',
  indefiniteHint: 'pas de date de fin',
  untilShort: "jusqu'au {{date}}",

  // Blocking (game-scheduling relevance)
  blocking: 'Bloque la planification des matchs',
  blockingHint: 'Quand actif, ces dates deviennent indisponibles pour planifier des matchs. Désactive-le pour les absences où tu ne joueras pas de toute façon (p. ex. blessure, congé maternité), afin que le reste de l\'équipe puisse quand même être planifié.',

  // Weekly unavailability
  tabWeeklyUnavailability: 'Indisponibilite hebdomadaire',
  newWeekly: 'Nouvelle hebdomadaire',
  newWeeklyTitle: 'Nouvelle indisponibilite hebdomadaire',
  editWeeklyTitle: 'Modifier l\'indisponibilite hebdomadaire',
  daysOfWeek: 'Jours de la semaine',
  noteOptional: 'Note (optionnel)',
  editedByStaffOn: 'Modifié par le staff le {{at}}',
  editedByCoachOn: 'Modifié par le coach ({{name}}) le {{at}}',
  editedByTeamResponsibleOn: 'Modifié par le ou la responsable d\'équipe ({{name}}) le {{at}}',
  editedByAdminOn: 'Modifié par l\'admin ({{name}}) le {{at}}',
  detailsOnBehalfPlaceholder: 'Pourquoi enregistres-tu ceci au nom de la joueuse / du joueur ?',
  noteOnBehalfHint: 'Tu modifies au nom d\'une autre personne — merci de laisser une note expliquant pourquoi. La note est visible par la personne concernée.',
  notePlaceholder: 'Informations supplementaires...',
  atLeastOneDay: 'Selectionnez au moins un jour',
  noWeeklyAbsences: 'Aucune indisponibilite hebdomadaire',
  noWeeklyAbsencesDescription: 'Configurez des indisponibilites hebdomadaires recurrentes.',
  deleteWeeklyTitle: 'Supprimer l\'indisponibilite hebdomadaire',
  deleteWeeklyMessage: 'Voulez-vous vraiment supprimer cette indisponibilite hebdomadaire ?',

  // Day abbreviations
  dayMon: 'Lun',
  dayTue: 'Mar',
  dayWed: 'Mer',
  dayThu: 'Jeu',
  dayFri: 'Ven',
  daySat: 'Sam',
  daySun: 'Dim',
  // Member filter
  filterByMember: 'Filtrer par membre',
  allMembers: 'Tous les membres',
  membersSelected: '{{count}} sur {{total}} membres',
  selectAllMembers: 'Tout sélectionner',
  deselectAllMembers: 'Tout désélectionner',
  noMembersMatchFilter: 'Aucun membre ne correspond au filtre actuel.',
  // Calendar day-detail (overflow modal) status labels
  absent: 'Absent',
  unavailable: 'Indisponible',
  absentUnavailable: 'Absent / Indisponible',
  // Calendar filter toggles (flipping one ON hides that category)
  hideUnavailabilities: 'Masquer les indisponibilités',
  hideNonBlocking: 'Masquer les absences non bloquantes',
  // Calendar closure label (generic "Halle geschlossen" closures)
  hallClosed: 'Salle fermée',
} as const
