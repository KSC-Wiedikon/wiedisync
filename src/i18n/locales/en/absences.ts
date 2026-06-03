export default {
  title: 'Absences',
  subtitle: 'Centralized absence management',

  // Tabs
  tabMyAbsences: 'My Absences',
  tabTeamAbsences: 'Team Absences',

  // Actions
  newAbsence: 'New absence',
  newAbsenceForMember: 'New absence for member',
  newWeeklyForMember: 'New weekly for member',

  // Form
  member: 'Member',
  startDate: 'From',
  endDate: 'To',
  reason: 'Reason',
  detailsOptional: 'Details (optional)',
  detailsPlaceholder: 'Additional information...',
  affects: 'Affects',

  // Reason options
  reasonInjury: 'Injury',
  reasonVacation: 'Vacation',
  reasonWork: 'Work',
  reasonPersonal: 'Personal',
  reasonOther: 'Other',
  weeklyUnavailability: 'Weekly unavailability',

  // Affects options
  affectsTrainings: 'Trainings',
  affectsGames: 'Games',
  affectsEvents: 'Events',
  affectsAll: 'All',

  // Validation
  startDateRequired: 'Start date is required',
  endDateRequired: 'End date is required',
  endAfterStart: 'End date must be after start date',
  reasonRequired: 'Please select a reason',
  memberRequired: 'Please select a member',
  errorSaving: 'Error saving absence',

  // Modal titles
  newAbsenceTitle: 'New Absence',
  editAbsenceTitle: 'Edit Absence',

  // Delete dialog
  deleteTitle: 'Delete Absence',
  deleteMessage: 'Are you sure you want to delete this absence?',

  // Empty states
  noAbsences: 'No absences',
  noAbsencesDescription: 'No absences found.',
  noUpcomingAbsences: 'No upcoming absences.',
  showOlderAbsences: 'Show older absences ({{count}})',
  noTeamAbsences: 'No absences',
  noTeamAbsencesDescription: 'No reported absences in this period.',

  // Team absence view
  fromTo: 'From',
  until: 'To',

  // Import
  importAbsences: 'Import',
  importTitle: 'Import Absences',
  importDescription: 'Upload a CSV or Excel file with multiple absences.',
  importDownloadTemplate: 'Download template',
  importPreview: 'Preview',
  importValidRows: '{{valid}} valid of {{total}}',
  importButton: 'Import ({{count}})',
  importSuccess: '{{count}} absences imported successfully',
  importPartialSuccess: '{{created}} imported, {{failed}} failed',
  importNoValidRows: 'No valid rows found',
  importInvalidReason: 'Invalid reason: "{{value}}"',
  importInvalidDate: 'Invalid date format',
  importParseError: 'Could not read file',

  // Indefinite
  indefinite: 'Indefinite',
  indefiniteHint: 'no end date',
  untilShort: 'until {{date}}',

  // Blocking (game-scheduling relevance)
  blocking: 'Blocks game scheduling',
  blockingHint: 'When on, these dates become unavailable for scheduling games. Turn it off for absences where you won\'t play anyway (e.g. injury, maternity leave) so the rest of the team can still be scheduled.',

  // Weekly unavailability
  tabWeeklyUnavailability: 'Weekly Unavailability',
  newWeekly: 'New Weekly',
  newWeeklyTitle: 'New Weekly Unavailability',
  editWeeklyTitle: 'Edit Weekly Unavailability',
  daysOfWeek: 'Days of week',
  noteOptional: 'Note (optional)',
  editedByStaffOn: 'Edited by team staff on {{at}}',
  editedByCoachOn: 'Edited by coach ({{name}}) on {{at}}',
  editedByTeamResponsibleOn: 'Edited by team responsible ({{name}}) on {{at}}',
  editedByAdminOn: 'Edited by admin ({{name}}) on {{at}}',
  detailsOnBehalfPlaceholder: 'Why are you logging this on behalf of the player?',
  noteOnBehalfHint: 'You\'re editing on behalf of another player — please leave a note explaining why. The note is visible to the player.',
  notePlaceholder: 'Additional information...',
  atLeastOneDay: 'Select at least one day',
  noWeeklyAbsences: 'No weekly unavailabilities',
  noWeeklyAbsencesDescription: 'Set up recurring weekly unavailabilities.',
  deleteWeeklyTitle: 'Delete Weekly Unavailability',
  deleteWeeklyMessage: 'Are you sure you want to delete this weekly unavailability?',

  // Day abbreviations
  dayMon: 'Mon',
  dayTue: 'Tue',
  dayWed: 'Wed',
  dayThu: 'Thu',
  dayFri: 'Fri',
  daySat: 'Sat',
  daySun: 'Sun',
  // Table columns
  colReason: 'Reason',
  colWhen: 'When',
  colAffects: 'Affects',
  colMember: 'Member',
  colDays: 'Days',
  // 2-axis toggle
  viewAbsences: 'Absences',
  viewUnavailabilities: 'Unavailabilities',
  scopeMine: 'Mine',
  scopeTeam: 'Team',
  noTeamWeeklies: 'No team weekly unavailabilities',
  noTeamWeekliesDescription: 'Nobody on this team has set up a recurring weekly unavailability yet.',
  // Member filter
  filterByMember: 'Filter by member',
  allMembers: 'All members',
  membersSelected: '{{count}} of {{total}} members',
  selectAllMembers: 'Select all',
  deselectAllMembers: 'Deselect all',
  noMembersMatchFilter: 'No members match the current filter.',
  // Calendar day-detail (overflow modal) status labels
  absent: 'Absent',
  unavailable: 'Unavailable',
  absentUnavailable: 'Absent / Unavailable',
  // Calendar filter toggles (flipping one ON hides that category)
  hideUnavailabilities: 'Hide unavailabilities',
  hideNonBlocking: 'Hide non-blocking absences',
  // Calendar closure label (generic "Halle geschlossen" closures)
  hallClosed: 'Gym closed',
} as const
