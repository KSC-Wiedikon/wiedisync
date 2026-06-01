export default {
  // Nav & page titles
  title: 'Terminplanig',
  adminTitle: 'Terminplanig (Admin)',
  setupTitle: 'Saison iirichtte',
  dashboardTitle: 'Übersicht',

  // Season config
  season: 'Saison',
  seasonStatus: 'Status',
  statusSetup: 'Iirichtig',
  statusOpen: 'Offe',
  statusClosed: 'Gschlosse',
  createSeason: 'Neui Saison erstelle',
  openForBooking: 'Für Buechige ufmache',
  closeBooking: 'Buechige schliesse',

  // Saison-Übernahm (clubwiit)
  rolloverHint: 'Die Saison isch läär. Ganze Club vo {{from}} übernäh — alli Teams, Kader, Staff, Sponsore und Hallepläng-Zuteilige uf {{to}} klone, denn {{from}} archiviere.',
  rolloverButton: 'Vo {{from}} übernäh',
  rolloverConfirm: 'Saison {{from}} → {{to}} übernäh? Das klont {{teams}} Teams und {{members}} Kaderiiträg uf {{to}} und deaktiviert denn d Teams vo {{from}}. Wiiter?',
  rolloverSuccess: 'Vo {{from}} übernoh — {{teams}} Teams und {{members}} Kaderiiträg klont.',
  rolloverNoPrev: 'D vorherig Saison het mer nöd chöne bestimme.',
  rolloverEmptySource: 'Kei Teams i de Saison {{from}} zum übernäh gfunde.',

  // Spielsamstage
  spielsamstage: 'Spielsamschtig',
  addSpielssamstag: 'Spielsamschtig dezuetuä',
  removeSpielssamstag: 'Entferne',
  timeSlot: 'Zitfänschter',
  hall: 'Halle',

  // Slot generation
  generateSlots: 'Spieltermin generiere',
  generatingSlots: 'Generiere Spieltermin...',
  slotsGenerated: '{{count}} Spieltermin generiert',
  slotSource: 'Quelle',
  sourceHallSlot: 'Halleplan',
  sourceSpielsamstag: 'Spielsamschtig',
  sourceSpielHalle: 'Spielhalle',
  sourceManual: 'Manuell',
  teamSlotConfig: 'Team-Konfiguration',
  latestSlot: 'Standard-Slot',
  spielsamstagMode: 'Samschtig',
  latestSlotHint: 'De spötischt wüchentlich Slot vom Team (Ändi 21:30) i de Doltschi- oder KWI-Halle, jedi Wuche Sep–Mär.',
  spielsamstagModeHint: 'De zentral Spielsamschtig-Pool (KWI A/B/C · 11:00 / 13:30 / 16:00).',
  manualHint: 'Standardmässig beidi a. Beidi us = kei Slots (vo Hand abmache; Gägner chönd trotzdem Auswärtstermin vorschlah).',

  // Slot status
  available: 'Verfüegbar',
  booked: 'Gbuecht',
  blocked: 'Gsperrt',

  // Admin dashboard
  allTeams: 'Alli Teams',
  homeBookings: 'Heimspiel',
  awayProposals: 'Uswärtsvorschläg',
  noBookingsYet: 'No käni Buechige',
  confirmProposal: 'Vorschlag bestätige',
  rejectProposal: 'Ablehne',
  proposal: 'Vorschlag',
  proposalNumber: 'Vorschlag {{number}}',
  confirmed: 'Bestätigt',
  pending: 'Usstehend',
  rejected: 'Abglehnt',
  opponent: 'Gegner',
  contactEmail: 'Kontakt-E-Mail',
  adminNotes: 'Admin-Notize',
  override: 'Überschriibe',
  sendSummary: 'Zämefassig schicke',

  // Excel
  excelImport: 'Excel-Import',
  excelExport: 'Excel-Export',
  importGames: 'Spiel importiere',
  exportSchedule: 'Spielplan exportiere',
  uploadFile: 'Datei ufelade',
  preview: 'Vorschau',
  importSuccess: '{{count}} Spiel importiert',
  downloadExcel: 'Excel abelade',
  downloadTemplate: 'Vorlag abelade',
  importColumnsHint: 'Spalte: Datum, Heimteam, Gastteam, Liga, Runde',

  // Public opponent flow
  publicTitle: 'Spieltermin KSCW',
  publicSubtitle: 'Vereinbar d Spieltermin mit em KSCW',
  selectGender: 'Gschlächt',
  genderMen: 'Herre',
  genderWomen: 'Dame',
  selectLeague: 'Liga',
  matchingTeam: 'Dis Gegner',
  clubName: 'Vereinsname',
  contactName: 'Kontaktperson',
  contactEmailLabel: 'E-Mail',
  register: 'Wiiter',
  registering: 'Wird registriert...',

  // Opponent flow - home game
  homeGameTitle: 'Heimspiel KSCW',
  homeGameDesc: 'Wähl en Termin für s Spiel i eusere Halle',
  pickSlot: 'Termin wähle',
  confirmSlot: 'Termin bestätige',
  slotBooked: 'Termin gbuecht!',
  noSlotsAvailable: 'Käni Termin verfüegbar',

  // Opponent flow - away game
  awayGameTitle: 'Uswärtsspiel',
  awayGameDesc: 'Schlag 3 Termin für s Spiel i eunere Halle vor',
  proposalDate: 'Datum & Zit',
  proposalPlace: 'Halle / Adrässe',
  submitProposals: 'Vorschläg iireichne',
  submitting: 'Wird iigreichne...',
  proposalsSubmitted: 'Vorschläg iigrichnet!',
  awaitingConfirmation: 'Wartet uf Bestätigung',

  // Confirmation
  confirmationTitle: 'Merci vilmal!',
  confirmationMessage: 'Du bechunnsch e E-Mail-Bestätigung.',
  bookingStatus: 'Buechigsstatus',

  // Errors & validation
  slotUnavailable: 'De Termin isch leider nümm verfüegbar.',
  conflictSameDay: 'Am gliiche Tag findet scho es Spiel statt.',
  conflictGapRule: 'Z nöch a emne andere Spiel (mind. 1 Tag Abstand).',
  conflictClosure: 'D Halle isch a dem Datum gschlosse.',
  conflictDoubleBooking: 'De Termin isch scho beleit.',
  conflictCrossTeam: 'Spieler us {{teams}} händ a dem Datum es anders Spiel.',
  invalidEmail: 'Bitte gib e gültigi E-Mail-Adrässe ii.',
  required: 'Das Feld muäss usgfüllt werde.',
  turnstileError: 'Bitte bestätig, dass du käs Roboter bisch.',
  seasonNotOpen: 'D Terminplanig isch im Momänt nöd offe.',

  // Email
  emailBookingConfirmSubject: 'Spieltermin bestätigt – KSCW',
  emailNewBookingSubject: 'Neui Terminbuechig – {{opponent}}',
}
