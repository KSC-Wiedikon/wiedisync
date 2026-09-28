import { describe, it, expect } from 'vitest'
import { apiErrorCode, hasApiErrorCode } from './apiErrorCode'
import { toError } from '../utils/toError'

const sdkError = (code: string) => ({
  errors: [{ message: 'Denied', extensions: { code } }],
  response: { status: 403 },
})

describe('apiErrorCode', () => {
  it('reads the Directus SDK shape', () => {
    expect(apiErrorCode(sdkError('MEMBER_INACTIVE'))).toBe('MEMBER_INACTIVE')
  })

  it('reads a kscwApi error code', () => {
    const e = Object.assign(new Error('API /x: 422'), { code: 'review_required' })
    expect(apiErrorCode(e)).toBe('review_required')
  })

  it('reads the code through toError (useMutation) wrapping', () => {
    expect(apiErrorCode(toError(sdkError('ROSTER_ADD_RATE_LIMITED')))).toBe('ROSTER_ADD_RATE_LIMITED')
  })

  it('returns undefined for plain errors and non-objects', () => {
    expect(apiErrorCode(new Error('boom'))).toBeUndefined()
    expect(apiErrorCode(null)).toBeUndefined()
    expect(apiErrorCode('FILE_NOT_YOURS')).toBeUndefined()
  })

  it('hasApiErrorCode compares exactly', () => {
    expect(hasApiErrorCode(sdkError('FILE_NOT_YOURS'), 'FILE_NOT_YOURS')).toBe(true)
    expect(hasApiErrorCode(sdkError('FILE_NOT_YOURS'), 'NOT_EVENT_MANAGER')).toBe(false)
  })
})
