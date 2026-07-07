export default {
  title: 'Calendar',

  // View options
  viewHall: 'Hall',
  viewWeek: 'Week',
  viewMonth: 'Calendar',
  viewSchedule: 'Schedule',
  viewList: 'List',

  // Subtitles
  subtitleHall: 'Hall occupancy plan',
  subtitleWeek: 'Weekly overview of all events',
  subtitleMonth: 'Monthly overview of all events',
  subtitleSchedule: 'Proposed & confirmed games for your teams',
  subtitleList: 'All events in chronological order',

  // Filter modal
  filterTitle: 'Filter',
  filterCategories: 'Categories',
  showHiddenAbsences: 'Show unavailabilities & non-blocking absences',
  showHiddenAbsencesHint: 'Off by default — these clutter the calendar and don\'t affect the rest of the team.',

  // Filter groups
  filterGroupGames: 'Games',
  filterGroupActivities: 'Activities',
  filterGroupVenue: 'Venue',
  filterGroupOther: 'Other',

  // Source filters
  sourceGames: 'Games',
  sourceTrainings: 'Trainings',
  sourceClosures: 'Closures',
  sourceEvents: 'Events',

  // Game type filters
  gameTypeHome: 'Home games',
  gameTypeAway: 'Away games',
  sourceHallHW: 'Halle HW',
  sourceAbsences: 'Absences',
  sourceBirthdays: 'Birthdays',

  // Type labels
  typeGame: 'Game',
  typeTraining: 'Training',
  typeClosure: 'Hall closure',
  typeEvent: 'Event',
  typeHall: 'Hall booking',
  typeAbsence: 'Absence',
  typeBirthday: 'Birthday',
  turnsLabel: 'Turns',

  // Other
  noEntries: 'No entries found',
  weekLabel: 'CW {{week}}: {{start}} – {{end}}',
  exportICal: 'Export iCal',
  subscribeICal: 'Subscribe',

  // iCal modal
  icalSubscribeTitle: 'Subscribe to calendar',
  icalDownloadTitle: 'Export calendar',
  icalFilterLabel: 'What do you want to subscribe to?',
  icalTeamFilter: 'Filter by team',
  icalTeamHint: 'Empty = all teams',
  icalGenerateLink: 'Generate subscription link',
  icalLinkReadyLabel: 'Subscription link (copy into your calendar app):',
  icalCopyLink: 'Copy',
  icalLinkCopied: 'Copied!',
  icalCopyFailed: 'Could not copy — select the link and copy it manually',
  icalOpenInApp: 'Or open directly in your calendar app',
  icalSubscribeHint:
    'Paste this link into your calendar app to subscribe — it stays up to date automatically. Google Calendar: Other calendars → From URL. Apple Calendar: File → New Calendar Subscription.',
  // Table columns
  colType: 'Type',
  colTitle: 'Title',
  colTime: 'Time',
  colLocation: 'Location',
  colTeams: 'Teams',

  // Scorer duties (personal)
  sourceScorerDuty: 'My duties',
  typeScorerDuty: 'Scoring duty',
  icalDutiesTitle: 'Your scoring duties',
  icalDutiesHint: 'Subscribe to a personal calendar that auto-fills your scorer and scoreboard duties.',
  icalDutiesGenerate: 'Generate my duties link',
  icalDutiesPrivacyHint: 'Personal link — keep it private. It only shows your duty schedule (no personal data).',
  icalDutiesError: 'Could not create your personal link.',

  // Entry detail modal + grid overlays
  coach: 'Coach',
  cancelled: 'Cancelled',
  moreCount: '+{{count}} more',
  absentCount: '{{count}} absent',
  eventTypeVerein: 'Club',
  eventTypeSocial: 'Social',
  eventTypeMeeting: 'Meeting',
  eventTypeTournament: 'Tournament',
  eventTypeTrainingsweekend: 'Trainingsweekend',
  eventTypeFriendly: 'Friendly game',
  eventTypeOther: 'Other',
} as const
