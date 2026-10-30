export default {
  /** Migration 354: trainings_hall_slot_date_uq rejected a concurrent create. */
  duplicateSlotDate: 'Für dä Halleslot gits a dem Datum scho es Training. Aktualisier und probiers nomal — öpper häts villicht grad erstellt.',
  title: 'Trainings',
  subtitle: 'Trainingsübersicht mit Aawäseheitskontrolle',

  // Tabs
  tabTrainings: 'Trainings',
  tabCoachDashboard: 'Coach-Dashboard',

  // Training card
  attendance: 'Aawäseheit',
  cancelled: 'Abgseit',

  // Attendance sheet
  attendanceTitle: 'Aawäseheit — {{date}}',
  attendanceTitleShort: 'Aawäseheit',
  noPlayers: 'Kei Spieler',
  noPlayersAssigned: 'Dem Team sind no kei Spieler zuegwise worde.',

  // Coach dashboard
  seasonLabel: 'Saison',
  rangeFromLabel: 'Vo',
  rangeToLabel: 'Bis',
  resetRange: 'Zruggsetze',
  rangeInvalid: '«Vo» mues am oder vor «Bis» sii',
  noDataAvailable: 'Kei Date verfüegbar',
  noDataDescription: 'Kei Aawäseheitsdate vorhande.',

  // Table headers
  playerCol: 'Spieler',
  numberCol: '#',
  trainingsCol: 'Trainings',
  presentCol: 'Da',
  absentCol: 'Nöd da',
  rateCol: 'Quote',
  trendCol: 'Trend',

  // Filter
  showPast: 'Älteri Trainings aazeige',
  hidePast: 'Älteri Trainings usblände',

  // Empty states
  noTrainings: 'Kei Trainings',
  noTrainingsDescription: 'Kei Trainings für di usgwählte Filter gfunde.',

  // CRUD
  newTraining: 'Neus Training',
  newSingleTraining: 'Einzels Training',
  newRecurringTraining: 'Wiederkehrendi Trainings',
  editTraining: 'Training bearbeite',
  deleteTraining: 'Training lösche',
  deleteConfirm: 'Bisch sicher, dass du das Training lösche wotsch?',
  cancelTraining: 'Training absäge',
  trainingCancelled: 'Training abgseit',
  cancelReason: 'Grund für d Absag',

  // Recurring
  recurringTitle: 'Wiederkehrendi Trainings erstelle',
  selectSlot: 'Halleslot uswähle',
  dateRange: 'Ziitruum',
  generatePreview: 'Date-Vorschau',
  generate: 'Erstelle',
  trainingsGenerated: '{{count}} Trainings erstellt',
  trainingsSkipped: '{{count}} übersprunge (scho vorhande)',
  respondBy: 'Antwort bis',
  respondByHint: 'Erinnerig 1 Tag vorher',
  respondByTime: 'Uhrziit vo de Frischt',
  respondByHours: 'Stunde',
  respondByDays: 'Täg',
  respondByWeeks: 'Wuche',
  respondByMonths: 'Monet',
  respondByBefore: 'vorher',
  participation: 'Teilnahm',
  minParticipants: 'Min. Teilnehmer',
  maxParticipants: 'Max. Teilnehmer',
  maxParticipantsHint: 'Wänn voll, chömed wiiteri Aamäldige uf d Wartelischte. Villicht zellt als Aamäldig und wird bim Aamäldeschluss zu Nei. Gastspieler mached Teamspieler Platz.',
  untilSeasonEnd: 'Unbefristet',
  slotFrom: 'ab',
  slotUntil: 'bis',

  // Recurring edit
  editRecurringTitle: 'Wiederkehrends Training bearbeite',
  editRecurringDescription: 'Das Training ghört zu einere wiederkehrende Serie. Was wotsch bearbeite?',
  editThisOnly: 'Nur das Training',
  editSameDay: 'Alli Trainings am gliiche Wuchetag',
  editAllRecurring: 'Alli wiederkehrende Trainings',
  cancelEdit: 'Abbräche',

  // Slot mode
  slotDetected: 'Halleslot erkennt',
  claimedSlot: 'Beanspruchte Slot',
  regularSlot: 'Reguläre Slot',
  noSlotForDay: 'Kei Halleslot a dem Tag',
  useSlot: 'Halleslot bruuche',
  enterManually: 'Manuell iigäh',
  slotModeAuto: 'Auto Halleslot',
  slotModeManual: 'Manuell',
  autoCancelOnMin: 'Automatisch absäge',
  autoCancelOnMinHint: 'Training wird bim Frischtablauf automatisch abgseit, wänn weniger Zuesage als s Minimum vorlieged',
  excludedGuestLevels: 'Usgschlosseni Gäscht',
  excludedGuestLevelsHint: 'Gäscht vo de gwählte Stufe chönd nöd zuesäge oder sich als unsicher markiere',
  excludeAllGuests: 'Alli Gäscht',
  guestExcluded: 'Dini Gascht-Stufe isch vo dem Training usgschlosse',
  autoConfirmRsvp: 'Automatisch bestätige',
  autoConfirmRsvpHint: 'Team-Standard überschriibe ({{default}}). Alli berächtigte Mitglieder started als zuegseit; si müend sich aktiv abmälde.',
  useTeamDefault: 'Team-Standard',
  on: 'Aa',
  off: 'Us',
  isTrialTraining: 'Probetraining',
  isTrialTrainingHint: 'Uf de Teamsiite öffentlich sichtbar, wänn s Team für neui Spieler offe isch.',
  trialBadge: 'Probetraining',
  shortenedBadge: 'Verchürzt',
  shortenedHint: 'Ändet früener — nachane isch es Heimspiel i de Halle',
  shortenedHallHint: 'Chürzer als suscht ({{usual}}) — d Halle isch teilwiis bsetzt',

  // Serie — manuell (ohni Halleslot)
  weekday: 'Wuchetag',
  manualStartTime: 'Startziit',
  manualEndTime: 'Ändziit',
  manualHint: 'Es wird kei Halleslot bruucht. Wuchetag, Ziite und Halle sälber wähle — d Serie hanget a keim Slot, drum git es Absäge kei Halleziit für anderi Teams frei.',
  manualEndAfterStart: 'D Ändziit mues nach de Startziit sii.',
  noSlotsForTeam: 'Das Team hät kei Halleslots. Uf manuelli Iigab wächsle, zum trotzdem e Serie z mache.',
} as const
