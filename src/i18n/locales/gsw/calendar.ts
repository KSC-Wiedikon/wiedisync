export default {
  title: 'Kaländer',

  // View options
  viewHall: 'Halle',
  viewWeek: 'Wuche',
  viewMonth: 'Kaländer',
  viewSchedule: 'Spielplan',
  viewList: 'Lischtä',

  // Subtitles
  subtitleHall: 'Hallebelegungsplan',
  subtitleWeek: 'Wucheübersicht vo allne Termin',
  subtitleMonth: 'Monetsübersicht vo allne Termin',
  subtitleSchedule: 'Plante & bestätigti Spiel vo dine Teams',
  subtitleList: 'Alli Termin in chronologischer Reihefolg',

  // Filter modal
  filterTitle: 'Filter',
  filterCategories: 'Kategorie',
  showHiddenAbsences: 'Nöd-Verfüegbarkeite & nöd-blockierendi Absänze zeige',
  showHiddenAbsencesHint: 'Standardmässig us — si überladed de Kalender und betreffed s restliche Team nöd.',

  // Filter groups
  filterGroupGames: 'Spiel',
  filterGroupActivities: 'Aktivitäte',
  filterGroupVenue: 'Halle',
  filterGroupOther: 'Suscht',

  // Source filters
  sourceGames: 'Spiel',
  sourceTrainings: 'Trainings',
  sourceClosures: 'Sperrige',
  sourceEvents: 'Events',

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
  typeEvent: 'Event',
  typeHall: 'Hallebelegig',
  typeAbsence: 'Absänz',
  typeBirthday: 'Geburtstag',
  turnsLabel: 'Wird',

  // Other
  noEntries: 'Käni Iiträg gfunde',
  weekLabel: 'KW {{week}}: {{start}} – {{end}}',
  exportICal: 'iCal exportiere',
  subscribeICal: 'Abonniere',

  // iCal modal
  icalSubscribeTitle: 'Kaländer abonniere',
  icalDownloadTitle: 'Kaländer exportiere',
  icalFilterLabel: 'Was wotsch abonniere?',
  icalTeamFilter: 'Nach Team filtere',
  icalTeamHint: 'Leer = alli Teams',
  icalGenerateLink: 'Abo-Link erstelle',
  icalLinkReadyLabel: 'Abo-Link (i dini Kaländer-App kopiere):',
  icalCopyLink: 'Kopiere',
  icalLinkCopied: 'Kopiert!',
  icalCopyFailed: 'Kopiere het nöd klappt — Link markiere und vo Hand kopiere',
  icalOpenInApp: 'Oder direkt i dinere Kaländer-App ufmache',
  icalSubscribeHint:
    'Füeg de Link i dini Kaländer-App ii zum abonniere — er bliibt automatisch aktuell. Google Kaländer: Wytteri Kaländer → Per URL. Apple Kaländer: Ablag → Kaländerabo hinzuefüege.',

  // Detailmodal + Raster
  coach: 'Trainer',
  cancelled: 'Abgseit',
  moreCount: '+{{count}} meh',
  absentCount: '{{count}} abwäsend',
  eventTypeVerein: 'Verein',
  eventTypeSocial: 'Social',
  eventTypeMeeting: 'Sitzig',
  eventTypeTournament: 'Turnier',
  eventTypeTrainingsweekend: 'Trainingsweekend',
  eventTypeFriendly: 'Fründschaftsspiel',
  eventTypeOther: 'Anderi',
} as const
