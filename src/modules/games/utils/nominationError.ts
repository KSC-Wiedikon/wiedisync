/** Volleymanager's identifiers for what it flags on a saved list → our words. */
const ISSUE_KEY: Record<string, string> = {
  nominationList_hasTooManyNominations: 'nominationIssueTooMany',
  nominationList_hasTooFewNominations: 'nominationIssueTooFew',
  nominationList_isMissingCoachPerson: 'nominationIssueNoCoach',
}

const FLAGS = 'Volleymanager flags: '

/**
 * The worker's note on a game (`vm_nomination_error`) for reading: 'Volleymanager flags: a, b;
 * other note'. What VM flagged becomes our words; other notes are already readable.
 */
export function nominationErrorText(error: string, t: (key: string) => string): string {
  return error
    .split('; ')
    .map((part) => (part.startsWith(FLAGS)
      ? part.slice(FLAGS.length).split(', ').map((id) => t(ISSUE_KEY[id] ?? 'nominationIssueOther')).join(', ')
      : part))
    .join('; ')
}
