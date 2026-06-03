export default {
  title: 'Absänze',
  subtitle: 'Zentrali Absänzverwautig',

  // Tabs
  tabMyAbsences: 'Mini Absänze',
  tabTeamAbsences: 'Team Absänze',

  // Actions
  newAbsence: 'Neui Absänz',
  newAbsenceForMember: 'Absänz für Mitgliid',
  newWeeklyForMember: 'Wöchentlichi für Mitgliid',

  // Form
  member: 'Mitglied',
  startDate: 'Vo',
  endDate: 'Bis',
  reason: 'Grund',
  detailsOptional: 'Details (optional)',
  detailsPlaceholder: 'Zusätzlichi Infos...',
  affects: 'Betrifft',

  // Reason options
  reasonInjury: 'Verletztig',
  reasonVacation: 'Ferie',
  reasonWork: 'Schaffe',
  reasonPersonal: 'Persönlich',
  reasonOther: 'Suscht',
  weeklyUnavailability: 'Wuchäverhinderig',

  // Affects options
  affectsTrainings: 'Trainings',
  affectsGames: 'Spiel',
  affectsEvents: 'Events',
  affectsAll: 'Alles',

  // Validation
  startDateRequired: 'Startdatum bruuchts',
  endDateRequired: 'Änddatum bruuchts',
  endAfterStart: 'S Ändi muäss nochem Start sii',
  reasonRequired: 'Bitte wähl en Grund',
  memberRequired: 'Bitte wähl es Mitglied',
  errorSaving: 'Bim Speichere vo de Absänz isch öppis schief gange',

  // Modal titles
  newAbsenceTitle: 'Neui Absänz',
  editAbsenceTitle: 'Absänz bearbeite',

  // Delete dialog
  deleteTitle: 'Absänz lösche',
  deleteMessage: 'Bisch sicher, dass du die Absänz lösche wotsch?',

  // Empty states
  noAbsences: 'Käni Absänze',
  noAbsencesDescription: 'Käni Absänze gfunde.',
  noUpcomingAbsences: 'Käni aktuelli Absänze.',
  showOlderAbsences: 'Älteri Absänze aazeige ({{count}})',
  noTeamAbsences: 'Käni Absänze',
  noTeamAbsencesDescription: 'Käni gmeldete Absänze i dem Zitraum.',

  // Team absence view
  fromTo: 'Vo',
  until: 'Bis',

  // Import
  importAbsences: 'Importiere',
  importTitle: 'Absänze importiere',
  importDescription: 'Lad e CSV- oder Excel-Datei mit mehrere Absänze ufe.',
  importDownloadTemplate: 'Vorlag abelade',
  importPreview: 'Vorschau',
  importValidRows: '{{valid}} gültig vo {{total}}',
  importButton: 'Importiere ({{count}})',
  importSuccess: '{{count}} Absänze erfolgriich importiert',
  importPartialSuccess: '{{created}} importiert, {{failed}} fählgschlage',
  importNoValidRows: 'Käni gültige Ziile gfunde',
  importInvalidReason: 'Ungültige Grund: "{{value}}"',
  importInvalidDate: 'Ungültigs Datumsformat',
  importParseError: 'Datei het nöd chönne gläse werde',

  // Indefinite
  indefinite: 'Unbefristet',
  indefiniteHint: 'käs Änddatum',
  untilShort: 'bis {{date}}',

  // Blocking (game-scheduling relevance)
  blocking: 'Blockiert d Spielplanig',
  blockingHint: 'Wenn aa, sind die Täg für d Spielplanig nöd verfüegbar. Schalts ab bi Absänze, wo du sowieso nöd spilsch (z. B. Verletztig, Mutterschaftsurlaub), so dass de Rescht vom Team trotzdem chan iiteilt werde.',

  // Weekly unavailability
  tabWeeklyUnavailability: 'Wöchentlichi Abweseheit',
  newWeekly: 'Neui Wöchentlichi',
  newWeeklyTitle: 'Neui wöchentlichi Abweseheit',
  editWeeklyTitle: 'Wöchentlichi Abweseheit bearbeite',
  daysOfWeek: 'Wuchetäg',
  noteOptional: 'Notiz (optional)',
  editedByStaffOn: 'Bearbeitet vom Trainerteam am {{at}}',
  editedByCoachOn: 'Bearbeitet vom Trainer ({{name}}) am {{at}}',
  editedByTeamResponsibleOn: 'Bearbeitet vo de Teamverantwortliche ({{name}}) am {{at}}',
  editedByAdminOn: 'Bearbeitet vom Admin ({{name}}) am {{at}}',
  detailsOnBehalfPlaceholder: 'Worum treisch du das für d Spilerin/de Spiler ii?',
  noteOnBehalfHint: 'Du bearbeitisch für e anderi Person — bitte hinterlass e Notiz mit em Grund. D Notiz isch für d betroffeni Person sichtbar.',
  notePlaceholder: 'Zusätzlichi Infos...',
  atLeastOneDay: 'Mindestens ein Tag wähle',
  noWeeklyAbsences: 'Käni wöchentlichi Abweseheite',
  noWeeklyAbsencesDescription: 'Richt regelmässigi wöchentlichi Abweseheite ii.',
  deleteWeeklyTitle: 'Wöchentlichi Abweseheit lösche',
  deleteWeeklyMessage: 'Bisch sicher, dass du die wöchentlichi Abweseheit lösche wotsch?',

  // Day abbreviations
  dayMon: 'Mä',
  dayTue: 'Zi',
  dayWed: 'Mi',
  dayThu: 'Du',
  dayFri: 'Fr',
  daySat: 'Sa',
  daySun: 'Su',
  // Member filter
  filterByMember: 'Nach Mitglied filtere',
  allMembers: 'Alli Mitglieder',
  membersSelected: '{{count}} vo {{total}} Mitglieder',
  selectAllMembers: 'Alli uswähle',
  deselectAllMembers: 'Alli abwähle',
  noMembersMatchFilter: 'Kei Mitglieder entspräched em aktuelle Filter.',
  // Calendar day-detail (overflow modal) status labels
  absent: 'Abwäsend',
  unavailable: 'Verhinderet',
  absentUnavailable: 'Abwäsend / Verhinderet',
  // Calendar filter toggles (flipping one ON hides that category)
  hideUnavailabilities: 'Verhinderige uusblände',
  hideNonBlocking: 'Nöd-blockierendi Abweseheite uusblände',
  // Calendar closure label (generic "Halle geschlossen" closures)
  hallClosed: 'Halle gschlosse',
} as const
