export default {
  title: 'Absänze',
  subtitle: 'Zentrali Absänzverwaltig',

  // Tabs
  tabMyAbsences: 'Mini Absänze',
  tabTeamAbsences: 'Team-Absänze',

  // Actions
  newAbsence: 'Neui Absänz',
  newAbsenceForMember: 'Neui Absänz für Mitglied',
  newWeeklyForMember: 'Neui Wöchentlichi für Mitglied',

  // Form
  member: 'Mitglied',
  startDate: 'Vo',
  endDate: 'Bis',
  reason: 'Grund',
  detailsOptional: 'Details (optional)',
  detailsPlaceholder: 'Zuesätzlichi Infos...',
  affects: 'Betrifft',

  // Reason options
  reasonInjury: 'Verletzig',
  reasonVacation: 'Ferie',
  reasonWork: 'Arbet',
  reasonPersonal: 'Persönlich',
  reasonOther: 'Anders',
  weeklyUnavailability: 'Wöchentlichi Verhinderig',

  // Affects options
  affectsTrainings: 'Trainings',
  affectsGames: 'Spiel',
  affectsEvents: 'Aaläss',
  affectsAll: 'Alles',

  // Validation
  startDateRequired: 'Startdatum bruuchts',
  endDateRequired: 'Änddatum bruuchts',
  endAfterStart: 'S Änd mues nach em Start sii',
  reasonRequired: 'Bitte wähl en Grund us',
  memberRequired: 'Bitte wähl es Mitglied us',
  pickerStaffCoach: 'Coach',
  pickerStaffTeamResponsible: 'Teamverantwortliche/r',
  errorSaving: 'Fähler bim Speichere vo de Absänz',

  // Modal titles
  newAbsenceTitle: 'Neui Absänz',
  editAbsenceTitle: 'Absänz bearbeite',

  // Delete dialog
  deleteTitle: 'Absänz lösche',
  deleteMessage: 'Bisch sicher, dass du die Absänz lösche wotsch?',

  // Empty states
  noAbsences: 'Kei Absänze',
  noAbsencesDescription: 'Kei Absänze gfunde.',
  noUpcomingAbsences: 'Kei aastehendi Absänze.',
  showOlderAbsences: 'Älteri Absänze aazeige ({{count}})',
  noTeamAbsences: 'Kei Absänze',
  noTeamAbsencesDescription: 'Kei gmäldeti Absänze i dem Ziitruum.',

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
  importNoValidRows: 'Kei gültigi Ziile gfunde',
  importInvalidReason: 'Ungültige Grund: "{{value}}"',
  importInvalidDate: 'Ungültigs Datumsformat',
  importParseError: 'D Datei hät nöd chöne gläse werde',

  // Indefinite
  indefinite: 'Unbefristet',
  indefiniteHint: 'kei Änddatum',
  untilShort: 'bis {{date}}',

  // Blocking (game-scheduling relevance)
  blocking: 'Blockiert d Spielplanig',
  blockingHint: 'Wänn das aa isch, sind die Täg für d Spielplanig nöd verfüegbar. Schalts ab bi Absänze, wo du sowieso nöd spielsch (z. B. Verletztig, Mutterschaftsurlaub), damit de Rescht vom Team trotzdem cha iiteilt werde.',

  // Weekly unavailability
  tabWeeklyUnavailability: 'Wöchentlichi Verhinderig',
  newWeekly: 'Neui Wöchentlichi',
  newWeeklyTitle: 'Neui wöchentlichi Verhinderig',
  editWeeklyTitle: 'Wöchentlichi Verhinderig bearbeite',
  daysOfWeek: 'Wuchetäg',
  noteOptional: 'Notiz (optional)',
  editedByStaffOn: 'Bearbeitet vom Trainerteam am {{at}}',
  editedByCoachOn: 'Bearbeitet vom Coach ({{name}}) am {{at}}',
  editedByTeamResponsibleOn: 'Bearbeitet vo de Teamverantwortliche ({{name}}) am {{at}}',
  editedByAdminOn: 'Bearbeitet vom Admin ({{name}}) am {{at}}',
  detailsOnBehalfPlaceholder: 'Worum treisch du das für d Spielerin/de Spieler ii?',
  noteOnBehalfHint: 'Du bearbeitisch für e anderi Person — bitte hinterlass e Notiz mit em Grund. D Notiz isch für d betroffeni Person sichtbar.',
  notePlaceholder: 'Zusätzlichi Infos...',
  atLeastOneDay: 'Mindestens en Tag uswähle',
  noWeeklyAbsences: 'Kei wöchentliche Verhinderige',
  noWeeklyAbsencesDescription: 'Richt regelmässigi wöchentlichi Verhinderige ii.',
  deleteWeeklyTitle: 'Wöchentlichi Verhinderig lösche',
  deleteWeeklyMessage: 'Bisch sicher, dass du die wöchentlichi Verhinderig lösche wotsch?',

  // Day abbreviations
  dayMon: 'Mä',
  dayTue: 'Zi',
  dayWed: 'Mi',
  dayThu: 'Du',
  dayFri: 'Fr',
  daySat: 'Sa',
  daySun: 'Su',
  colReason: 'Grund',
  colWhen: 'Wänn',
  colAffects: 'Betrifft',
  colMember: 'Mitglied',
  colDays: 'Täg',
  viewAbsences: 'Absänze',
  viewUnavailabilities: 'Verhinderige',
  scopeMine: 'Mini',
  scopeTeam: 'Team',
  noTeamWeeklies: 'Kei wöchentliche Verhinderige im Team',
  noTeamWeekliesDescription: 'Im Team hät no niemert e regelmässigi wöchentlichi Verhinderig iigrichtet.',
  // Member filter
  filterByMember: 'Nach Mitglied filtere',
  allMembers: 'Alli Mitglieder',
  membersSelected: '{{count}} vo {{total}} Mitglieder',
  selectAllMembers: 'Alli uswähle',
  deselectAllMembers: 'Alli abwähle',
  noMembersMatchFilter: 'Kei Mitglieder passed zum aktuelle Filter.',
  // Calendar day-detail (overflow modal) status labels
  absent: 'Abwäsend',
  unavailable: 'Verhinderet',
  absentUnavailable: 'Abwäsend / Verhinderet',
  // Calendar filter toggles (flipping one ON hides that category)
  hideUnavailabilities: 'Verhinderige usblände',
  hideNonBlocking: 'Nöd-blockierendi Absänze usblände',
  // Badge shown next to an absence whose blocking flag is off
  nonBlocking: 'Nöd blockierend',
  dayCount_one: '{{count}} Tag',
  dayCount_other: '{{count}} Täg',
  // Calendar closure label (generic "Halle geschlossen" closures)
  hallClosed: 'Halle gschlosse',
  // Team blocking (migration 085) — coach/TR scheduling blackouts
  teamBlocks: 'Team-Sperre',
  teamBlocksHint: 'Sperrt d Spielplanig für es Team a dene Täg — e harti Sperre, au wänn nur wenig Spieler fähle.',
  addTeamBlock: 'Team-Sperre hinzuefüege',
  noTeamBlocks: 'Kei bevorstehendi Team-Sperre.',
  teamBlocking: 'Team-Sperre',
  teamBlockTitle: 'Neui Team-Sperre',
  teamBlockHint: 'Für das Team werded a de gwählte Täg kei Spiel aagsetzt (Heim oder Uswärts).',
  blockTeam: 'Team',
  blockTeamRequired: 'Bitte wähl es Team',
  blockReason: 'Grund (optional)',
  blockReasonPlaceholder: 'z. B. Prüefigsziit, Turniervorbereitig',
  deleteTeamBlockTitle: 'Team-Sperre lösche',
  deleteTeamBlockMessage: 'Bisch sicher, dass du die Team-Sperre lösche wotsch?',
} as const
