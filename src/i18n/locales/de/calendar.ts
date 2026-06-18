export default {
  title: 'Kalender',

  // View options
  viewHall: 'Halle',
  viewWeek: 'Woche',
  viewMonth: 'Kalender',
  viewSchedule: 'Spielplan',
  viewList: 'Liste',

  // Subtitles
  subtitleHall: 'Hallenbelegungsplan',
  subtitleWeek: 'Wochenübersicht aller Termine',
  subtitleMonth: 'Monatsübersicht aller Termine',
  subtitleSchedule: 'Geplante & bestätigte Spiele deiner Teams',
  subtitleList: 'Alle Termine in chronologischer Reihenfolge',

  // Filter modal
  filterTitle: 'Filter',
  filterCategories: 'Kategorien',

  // Filter groups
  filterGroupGames: 'Spiele',
  filterGroupActivities: 'Aktivitäten',
  filterGroupVenue: 'Halle',
  filterGroupOther: 'Sonstiges',

  // Source filters
  sourceGames: 'Spiele',
  sourceTrainings: 'Trainings',
  sourceClosures: 'Sperrungen',
  sourceEvents: 'Events',

  // Game type filters
  gameTypeHome: 'Heimspiele',
  gameTypeAway: 'Auswärtsspiele',
  sourceHallHW: 'Halle HW',
  sourceAbsences: 'Absenzen',

  // Type labels
  typeGame: 'Spiel',
  typeTraining: 'Training',
  typeClosure: 'Hallensperrung',
  typeEvent: 'Event',
  typeHall: 'Hallenbelegung',
  typeAbsence: 'Absenz',

  // Other
  noEntries: 'Keine Einträge gefunden',
  weekLabel: 'KW {{week}}: {{start}} – {{end}}',
  exportICal: 'iCal exportieren',
  subscribeICal: 'Abonnieren',

  // iCal modal
  icalSubscribeTitle: 'Kalender abonnieren',
  icalDownloadTitle: 'Kalender exportieren',
  icalFilterLabel: 'Was möchtest du abonnieren?',
  icalTeamFilter: 'Nach Team filtern',
  icalTeamHint: 'Leer = alle Teams',
  icalGenerateLink: 'Abo-Link erstellen',
  icalLinkReadyLabel: 'Abo-Link (in deine Kalender-App kopieren):',
  icalCopyLink: 'Kopieren',
  icalLinkCopied: 'Kopiert!',
  icalCopyFailed: 'Kopieren fehlgeschlagen — Link markieren und manuell kopieren',
  icalOpenInApp: 'Oder direkt in deiner Kalender-App öffnen',
  icalSubscribeHint:
    'Füge diesen Link in deine Kalender-App ein, um zu abonnieren — er bleibt automatisch aktuell. Google Kalender: Weitere Kalender → Per URL. Apple Kalender: Ablage → Kalenderabo hinzufügen.',
  // Table columns
  colType: 'Typ',
  colTitle: 'Titel',
  colTime: 'Zeit',
  colLocation: 'Ort',
  colTeams: 'Teams',
} as const
