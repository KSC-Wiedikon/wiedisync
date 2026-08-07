import { describe, it, expect } from 'vitest'
import { toError, serverDenialMessage } from '../toError'

/**
 * Shape of what @directus/sdk actually throws: `class RequestError extends
 * Error` with `name = 'RequestError'`, `message` copied from `errors[0].message`
 * and the raw `errors` array attached. Reproduced here rather than imported so
 * the tests pin the contract we rely on, not the SDK's current internals.
 */
function requestError(message: string, errors: unknown): Error {
  const err = new Error(message) as Error & { errors?: unknown }
  err.name = 'RequestError'
  err.errors = errors
  return err
}

describe('toError', () => {
  it('passes through an Error that already has a usable message', () => {
    const original = new Error('Boom')
    expect(toError(original)).toBe(original)
  })

  it('recovers the Directus message from an object-shaped throw', () => {
    const thrown = { errors: [{ message: 'Nope', extensions: { code: 'NOT_OWNER' } }] }
    expect(toError(thrown).message).toBe('Nope')
  })

  it('never produces a bare "[object Object]"', () => {
    expect(toError({ some: 'payload' }).message).not.toBe('[object Object]')
  })
})

describe('serverDenialMessage', () => {
  it('surfaces a guard refusal so the user learns why the action was blocked', () => {
    const err = requestError('You can only remove members from teams you coach or are responsible for', [
      {
        message: 'You can only remove members from teams you coach or are responsible for',
        extensions: { code: 'NOT_OWNER' },
      },
    ])
    expect(serverDenialMessage(err)).toBe(
      'You can only remove members from teams you coach or are responsible for',
    )
  })

  it('returns null for the opaque INTERNAL_SERVER_ERROR fallback', () => {
    // What a guard that forgets `name = "DirectusError"` produces: Directus
    // discards the real reason and answers 500 for every non-admin. There is
    // nothing here worth showing over a translated generic.
    const err = requestError('An unexpected error occurred.', [
      { message: 'An unexpected error occurred.', extensions: { code: 'INTERNAL_SERVER_ERROR' } },
    ])
    expect(serverDenialMessage(err)).toBeNull()
  })

  it('returns null for a network failure carrying no Directus errors array', () => {
    expect(serverDenialMessage(new TypeError('Failed to fetch'))).toBeNull()
  })

  it('returns null when the error is not an object at all', () => {
    expect(serverDenialMessage('nope')).toBeNull()
    expect(serverDenialMessage(null)).toBeNull()
    expect(serverDenialMessage(undefined)).toBeNull()
  })

  it('reads through .cause, since toError re-wraps object-shaped throws', () => {
    const wrapped = toError({
      errors: [{ message: 'Sent emails are a record and cannot be deleted.', extensions: { code: 'READ_ONLY' } }],
    })
    expect(serverDenialMessage(wrapped)).toBe('Sent emails are a record and cannot be deleted.')
  })

  it('ignores a coded error whose message is blank', () => {
    expect(serverDenialMessage(requestError('', [{ message: '   ', extensions: { code: 'NOT_OWNER' } }]))).toBeNull()
  })

  it('ignores an errors array with no extensions code (not a deliberate refusal)', () => {
    expect(serverDenialMessage(requestError('Weird', [{ message: 'Weird' }]))).toBeNull()
  })
})
