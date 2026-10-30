export default {
  title: 'Kaländer',

  // View options
  viewHall: 'Halle',
  viewWeek: 'Wuche',
  viewMonth: 'Kaländer',
  prevDays: 'Vorderi Täg',
  nextDays: 'Nächschti Täg',
  viewSchedule: 'Spielplan',
  viewList: 'Lischte',

  // Subtitles
  subtitleHall: 'Hallebelegigsplan',
  subtitleWeek: 'Wucheübersicht vo allne Termin',
  subtitleMonth: 'Monetsübersicht vo allne Termin',
  subtitleSchedule: 'Vorgschlageni & bestätigti Spiel vo dine Teams',
  subtitleList: 'Alli Termin i chronologischer Reihefolg',

  // Filter modal
  filterTitle: 'Filter',
  filterCategories: 'Kategorie',
  showHiddenAbsences: 'Verhinderige & nöd-blockierendi Absänze aazeige',
  showHiddenAbsencesHint: 'Standardmässig us — si überladed de Kaländer und betreffed s restliche Team nöd.',

  // Filter groups
  filterGroupGames: 'Spiel',
  filterGroupActivities: 'Aktivitäte',
  filterGroupVenue: 'Halle',
  filterGroupOther: 'Anders',

  // Source filters
  sourceGames: 'Spiel',
  sourceTrainings: 'Trainings',
  sourceClosures: 'Sperrige',
  sourceEvents: 'Aaläss',

  // Game type filters
  gameTypeHome: 'Heimspiel',
  gameTypeAway: 'Uswärtsspiel',
  sourceHallHW: 'Halle HW',
  sourceAbsences: 'Absänze',
  sourceBirthdays: 'Geburtstäg',

  // Type labels
  typeGame: 'Spiel',
  typeTraining: 'Training',
  typeClosure: 'Hallesperrig',
  typeEvent: 'Aalass',
  typeHall: 'Hallebelegig',
  typeAbsence: 'Absänz',
  typeBirthday: 'Geburtstag',
  turnsLabel: 'Wird',

  // Other
  noEntries: 'Kei Iiträg gfunde',
  weekLabel: 'KW {{week}}: {{start}} – {{end}}',
  exportICal: 'iCal exportiere',
  subscribeICal: 'Abonniere',

  // iCal modal
  icalSubscribeTitle: 'Kaländer abonniere',
  icalDownloadTitle: 'Kaländer exportiere',
  icalFilterLabel: 'Was wotsch abonniere?',
  icalTeamFilter: 'Nach Team filtere',
  icalTeamHint: 'Leer = alli Teams',
  icalScopeMine: 'Min Kaländer',
  icalScopeMineHint: 'Dini Teams, Ufgebot und Iisätz. Er passt sich aa, wänn sich dini Teams ändered — du bruuchsch nie en neue Link.',
  icalScopeTeams: 'Teams uswähle',
  icalScopeTeamsHint: 'Nur d Teams, wo du uswählsch. De Link bliibt gliich, wänn sich dini Teams ändered.',
  icalMinePrivacyHint: 'Persönliche Link — bitte privat halte. Er passt sich sälber aa, wänn sich dini Teams ändered.',
  icalGenerateLink: 'Abo-Link erstelle',
  icalLinkReadyLabel: 'Abo-Link (i dini Kaländer-App kopiere):',
  icalCopyLink: 'Kopiere',
  icalLinkCopied: 'Kopiert!',
  icalCopyFailed: 'Kopiere hät nöd klappt — Link markiere und vo Hand kopiere',
  icalOpenInApp: 'Oder direkt i dinere Kaländer-App ufmache',
  icalSubscribeHint:
    'Füeg de Link i dini Kaländer-App ii, zum abonniere — er bliibt automatisch aktuell. Google Kalender: Weitere Kalender → Per URL. Apple Kalender: Ablage → Neues Kalenderabonnement.',
  colType: 'Typ',
  colTitle: 'Titel',
  colTime: 'Ziit',
  colLocation: 'Ort',
  colTeams: 'Teams',
  sourceScorerDuty: 'Mini Iisätz',
  typeScorerDuty: 'Schriiberiisatz',
  icalDutiesTitle: 'Dini Schriiberiisätz',
  icalDutiesHint: 'Abonnier en persönliche Kaländer, wo dini Schriiber- und Täfeler-Iisätz automatisch iiträit.',
  icalDutiesGenerate: 'Persönliche Link erstelle',
  icalDutiesIncludedHint: 'Dini eigete Schriiber-/Offizielle-Iisätz sind i dem Abo immer debii.',
  icalDutiesPrivacyHint: 'Persönliche Link — bitte privat halte. Er zeigt nur din Iisatzplan (kei persönliche Date).',
  icalDutiesError: 'Din persönliche Link hät nöd chöne erstellt werde.',

  // Detailmodal + Raster
  coach: 'Coach',
  cancelled: 'Abgseit',
  cancelledGameDay: 'Abgseit — Spieltag',
  moreCount: '+{{count}} meh',
  absentCount: '{{count}} abwäsend',
  eventTypeClub: 'Verein',
  eventTypeSocial: 'Social',
  eventTypeMeeting: 'Sitzig',
  eventTypeTournament: 'Turnier',
  eventTypeTrainingWeekend: 'Trainingsweekend',
  eventTypeFriendly: 'Fründschaftsspiel',
  eventTypeOther: 'Anderi',
} as const
