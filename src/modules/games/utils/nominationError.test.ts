import { describe, expect, it } from 'vitest'
import { nominationErrorText } from './nominationError'

const t = (key: string) => `[${key}]`

describe('nominationErrorText', () => {
  it('puts what Volleymanager flags in our words', () => {
    expect(nominationErrorText('Volleymanager flags: nominationList_hasTooManyNominations', t)).toBe('[nominationIssueTooMany]')
    expect(nominationErrorText('Volleymanager flags: nominationList_hasTooFewNominations, nominationList_isMissingCoachPerson', t))
      .toBe('[nominationIssueTooFew], [nominationIssueNoCoach]')
  })

  it('never shows an identifier it does not know', () => {
    expect(nominationErrorText('Volleymanager flags: issue#99', t)).toBe('[nominationIssueOther]')
  })

  it('keeps the notes after it', () => {
    expect(nominationErrorText('Volleymanager flags: nominationList_hasTooManyNominations; no licence number: A B', t))
      .toBe('[nominationIssueTooMany]; no licence number: A B')
  })

  it('leaves any other note alone', () => {
    expect(nominationErrorText('not named, no Yes: A B', t)).toBe('not named, no Yes: A B')
  })
})
