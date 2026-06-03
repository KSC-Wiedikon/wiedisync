export default {
  title: 'Absenzen',
  subtitle: 'Zentrale Absenzverwaltung',

  // Tabs
  tabMyAbsences: 'Meine Absenzen',
  tabTeamAbsences: 'Team Absenzen',

  // Actions
  newAbsence: 'Neue Absenz',
  newAbsenceForMember: 'Absenz für Mitglied',
  newWeeklyForMember: 'Wöchentliche für Mitglied',

  // Form
  member: 'Mitglied',
  startDate: 'Von',
  endDate: 'Bis',
  reason: 'Grund',
  detailsOptional: 'Details (optional)',
  detailsPlaceholder: 'Zusätzliche Informationen...',
  affects: 'Betrifft',

  // Reason options
  reasonInjury: 'Verletzung',
  reasonVacation: 'Ferien',
  reasonWork: 'Arbeit',
  reasonPersonal: 'Persönlich',
  reasonOther: 'Sonstiges',
  weeklyUnavailability: 'Wöchentliche Verhinderung',

  // Affects options
  affectsTrainings: 'Trainings',
  affectsGames: 'Spiele',
  affectsEvents: 'Events',
  affectsAll: 'Alles',

  // Validation
  startDateRequired: 'Startdatum ist erforderlich',
  endDateRequired: 'Enddatum ist erforderlich',
  endAfterStart: 'Enddatum muss nach dem Startdatum sein',
  reasonRequired: 'Bitte wähle einen Grund',
  memberRequired: 'Bitte wähle ein Mitglied',
  errorSaving: 'Fehler beim Speichern der Absenz',

  // Modal titles
  newAbsenceTitle: 'Neue Absenz',
  editAbsenceTitle: 'Absenz bearbeiten',

  // Delete dialog
  deleteTitle: 'Absenz löschen',
  deleteMessage: 'Bist du sicher, dass du diese Absenz löschen willst?',

  // Empty states
  noAbsences: 'Keine Absenzen',
  noAbsencesDescription: 'Keine Absenzen gefunden.',
  noUpcomingAbsences: 'Keine aktuellen Absenzen.',
  showOlderAbsences: 'Ältere Absenzen anzeigen ({{count}})',
  noTeamAbsences: 'Keine Absenzen',
  noTeamAbsencesDescription: 'Keine gemeldeten Absenzen in diesem Zeitraum.',

  // Team absence view
  fromTo: 'Von',
  until: 'Bis',

  // Import
  importAbsences: 'Importieren',
  importTitle: 'Absenzen importieren',
  importDescription: 'Lade eine CSV- oder Excel-Datei mit mehreren Absenzen hoch.',
  importDownloadTemplate: 'Vorlage herunterladen',
  importPreview: 'Vorschau',
  importValidRows: '{{valid}} gültig von {{total}}',
  importButton: 'Importieren ({{count}})',
  importSuccess: '{{count}} Absenzen erfolgreich importiert',
  importPartialSuccess: '{{created}} importiert, {{failed}} fehlgeschlagen',
  importNoValidRows: 'Keine gültigen Zeilen gefunden',
  importInvalidReason: 'Ungültiger Grund: "{{value}}"',
  importInvalidDate: 'Ungültiges Datumsformat',
  importParseError: 'Datei konnte nicht gelesen werden',

  // Indefinite
  indefinite: 'Unbefristet',
  indefiniteHint: 'kein Enddatum',
  untilShort: 'bis {{date}}',

  // Blocking (game-scheduling relevance)
  blocking: 'Blockiert die Spielplanung',
  blockingHint: 'Wenn aktiv, sind diese Tage für die Spielplanung nicht verfügbar. Schalte es aus bei Absenzen, bei denen du ohnehin nicht spielst (z. B. Verletzung, Mutterschaftsurlaub), damit das restliche Team trotzdem eingeplant werden kann.',

  // Weekly unavailability
  tabWeeklyUnavailability: 'Wöchentliche Abwesenheit',
  newWeekly: 'Neue Wöchentliche',
  newWeeklyTitle: 'Neue wöchentliche Abwesenheit',
  editWeeklyTitle: 'Wöchentliche Abwesenheit bearbeiten',
  daysOfWeek: 'Wochentage',
  noteOptional: 'Notiz (optional)',
  editedByStaffOn: 'Bearbeitet vom Trainerteam am {{at}}',
  editedByCoachOn: 'Bearbeitet vom Trainer ({{name}}) am {{at}}',
  editedByTeamResponsibleOn: 'Bearbeitet von der Teamverantwortlichen ({{name}}) am {{at}}',
  editedByAdminOn: 'Bearbeitet vom Admin ({{name}}) am {{at}}',
  detailsOnBehalfPlaceholder: 'Warum trägst du das stellvertretend für die Spielerin/den Spieler ein?',
  noteOnBehalfHint: 'Du bearbeitest stellvertretend für eine andere Person — bitte hinterlasse eine Notiz mit dem Grund. Die Notiz ist für die betroffene Person sichtbar.',
  notePlaceholder: 'Zusätzliche Informationen...',
  atLeastOneDay: 'Mindestens ein Tag wählen',
  noWeeklyAbsences: 'Keine wöchentlichen Abwesenheiten',
  noWeeklyAbsencesDescription: 'Richte regelmässige wöchentliche Abwesenheiten ein.',
  deleteWeeklyTitle: 'Wöchentliche Abwesenheit löschen',
  deleteWeeklyMessage: 'Bist du sicher, dass du diese wöchentliche Abwesenheit löschen willst?',

  // Day abbreviations
  dayMon: 'Mo',
  dayTue: 'Di',
  dayWed: 'Mi',
  dayThu: 'Do',
  dayFri: 'Fr',
  daySat: 'Sa',
  daySun: 'So',
  // Table columns
  colReason: 'Grund',
  colWhen: 'Wann',
  colAffects: 'Betrifft',
  colMember: 'Mitglied',
  colDays: 'Tage',
  // 2-axis toggle
  viewAbsences: 'Absenzen',
  viewUnavailabilities: 'Wöchentliche',
  scopeMine: 'Meine',
  scopeTeam: 'Team',
  noTeamWeeklies: 'Keine wöchentlichen Abwesenheiten im Team',
  noTeamWeekliesDescription: 'Niemand in diesem Team hat eine wöchentliche Abwesenheit hinterlegt.',
  // Member filter
  filterByMember: 'Nach Mitglied filtern',
  allMembers: 'Alle Mitglieder',
  membersSelected: '{{count}} von {{total}} Mitgliedern',
  selectAllMembers: 'Alle auswählen',
  deselectAllMembers: 'Alle abwählen',
  noMembersMatchFilter: 'Keine Mitglieder entsprechen dem aktuellen Filter.',
  // Calendar day-detail (overflow modal) status labels
  absent: 'Abwesend',
  unavailable: 'Verhindert',
  absentUnavailable: 'Abwesend / Verhindert',
  // Calendar filter toggles (flipping one ON hides that category)
  hideUnavailabilities: 'Verhinderungen ausblenden',
  hideNonBlocking: 'Nicht-blockierende Abwesenheiten ausblenden',
  // Calendar closure label (generic "Halle geschlossen" closures)
  hallClosed: 'Halle geschlossen',
} as const
