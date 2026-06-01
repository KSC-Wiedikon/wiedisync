export default {
  // Nav & page titles
  title: 'Planification des matchs',
  adminTitle: 'Planification des matchs (Admin)',
  setupTitle: 'Configuration de la saison',
  dashboardTitle: 'Tableau de bord',

  // Season config
  season: 'Saison',
  seasonStatus: 'Statut',
  statusSetup: 'Configuration',
  statusOpen: 'Ouvert',
  statusClosed: 'Ferme',
  createSeason: 'Creer une nouvelle saison',
  openForBooking: 'Ouvrir les reservations',
  closeBooking: 'Fermer les reservations',

  // Report de saison (tout le club)
  rolloverHint: 'Cette saison est vide. Reporter tout le club depuis {{from}} — cloner chaque équipe, effectif, staff, sponsor et attribution de créneaux de salle vers {{to}}, puis archiver {{from}}.',
  rolloverButton: 'Reporter depuis {{from}}',
  rolloverConfirm: 'Reporter la saison {{from}} → {{to}} ? Cela clone {{teams}} équipes et {{members}} entrées d\'effectif vers {{to}}, puis désactive les équipes de {{from}}. Continuer ?',
  rolloverSuccess: 'Reporté depuis {{from}} — {{teams}} équipes et {{members}} entrées d\'effectif clonées.',
  rolloverNoPrev: 'Impossible de déterminer la saison précédente.',
  rolloverEmptySource: 'Aucune équipe trouvée dans la saison {{from}} à reporter.',

  // Spielsamstage
  spielsamstage: 'Samedis de match',
  addSpielssamstag: 'Ajouter un samedi de match',
  removeSpielssamstag: 'Supprimer',
  timeSlot: 'Creneau horaire',
  hall: 'Salle',

  // Slot generation
  generateSlots: 'Generer les creneaux de match',
  generatingSlots: 'Generation des creneaux de match...',
  slotsGenerated: '{{count}} creneaux de match generes',
  slotSource: 'Source',
  sourceHallSlot: 'Plan de salle',
  sourceSpielsamstag: 'Samedi de match',
  sourceSpielHalle: 'Salle de match',
  sourceManual: 'Manuel',
  teamSlotConfig: 'Configuration par equipe',
  latestSlot: 'Creneau du soir (dernier)',
  spielsamstagMode: 'Mode samedi de match',

  // Slot status
  available: 'Disponible',
  booked: 'Reserve',
  blocked: 'Bloque',

  // Admin dashboard
  allTeams: 'Toutes les equipes',
  homeBookings: 'Reservations a domicile',
  awayProposals: 'Propositions a l\'exterieur',
  noBookingsYet: 'Aucune reservation pour le moment',
  confirmProposal: 'Confirmer la proposition',
  rejectProposal: 'Rejeter',
  proposal: 'Proposition',
  proposalNumber: 'Proposition {{number}}',
  confirmed: 'Confirme',
  pending: 'En attente',
  rejected: 'Rejete',
  opponent: 'Adversaire',
  contactEmail: 'Email de contact',
  adminNotes: 'Notes admin',
  override: 'Remplacer',
  sendSummary: 'Envoyer le recapitulatif',

  // Excel
  excelImport: 'Import Excel',
  excelExport: 'Export Excel',
  importGames: 'Importer des matchs',
  exportSchedule: 'Exporter le calendrier',
  uploadFile: 'Telecharger le fichier',
  preview: 'Apercu',
  importSuccess: '{{count}} matchs importes',
  downloadExcel: 'Telecharger Excel',
  downloadTemplate: 'Telecharger le modele',
  importColumnsHint: 'Colonnes: Datum, Heimteam, Gastteam, Liga, Runde',

  // Public opponent flow
  publicTitle: 'Planification des matchs KSCW',
  publicSubtitle: 'Planifiez vos matchs avec le KSCW',
  selectGender: 'Genre',
  genderMen: 'Hommes',
  genderWomen: 'Femmes',
  selectLeague: 'Ligue',
  matchingTeam: 'Votre adversaire',
  clubName: 'Nom du club',
  contactName: 'Personne de contact',
  contactEmailLabel: 'Email',
  register: 'Continuer',
  registering: 'Enregistrement...',

  // Opponent flow - home game
  homeGameTitle: 'Match a domicile KSCW',
  homeGameDesc: 'Choisissez un creneau pour le match dans notre salle',
  pickSlot: 'Choisir un creneau',
  confirmSlot: 'Confirmer le creneau',
  slotBooked: 'Creneau reserve !',
  noSlotsAvailable: 'Aucun creneau disponible',

  // Opponent flow - away game
  awayGameTitle: 'Match a l\'exterieur',
  awayGameDesc: 'Proposez 3 creneaux pour le match dans votre salle',
  proposalDate: 'Date et heure',
  proposalPlace: 'Salle / Adresse',
  submitProposals: 'Soumettre les propositions',
  submitting: 'Envoi...',
  proposalsSubmitted: 'Propositions soumises !',
  awaitingConfirmation: 'En attente de confirmation',

  // Confirmation
  confirmationTitle: 'Merci !',
  confirmationMessage: 'Vous recevrez un email de confirmation.',
  bookingStatus: 'Statut de la reservation',

  // Errors & validation
  slotUnavailable: 'Ce creneau n\'est plus disponible.',
  conflictSameDay: 'Il y a deja un match le meme jour.',
  conflictGapRule: 'Trop proche d\'un autre match (min. 1 jour d\'ecart).',
  conflictClosure: 'La salle est fermee a cette date.',
  conflictDoubleBooking: 'Ce creneau est deja pris.',
  conflictCrossTeam: 'Des joueurs de {{teams}} ont deja un match a cette date.',
  invalidEmail: 'Veuillez saisir une adresse email valide.',
  required: 'Ce champ est requis.',
  turnstileError: 'Veuillez confirmer que vous n\'etes pas un robot.',
  seasonNotOpen: 'La planification des matchs n\'est pas ouverte actuellement.',

  // Email
  emailBookingConfirmSubject: 'Creneau de match confirme – KSCW',
  emailNewBookingSubject: 'Nouvelle reservation – {{opponent}}',
}
