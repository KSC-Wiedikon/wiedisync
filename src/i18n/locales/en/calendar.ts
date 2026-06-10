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

  // Type labels
  typeGame: 'Game',
  typeTraining: 'Training',
  typeClosure: 'Hall closure',
  typeEvent: 'Event',
  typeHall: 'Hall booking',
  typeAbsence: 'Absence',

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
  // Table columns
  colType: 'Type',
  colTitle: 'Title',
  colTime: 'Time',
  colLocation: 'Location',
  colTeams: 'Teams',
} as const
