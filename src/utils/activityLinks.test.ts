import { describe, it, expect } from 'vitest'
import { safeReturnPath, activityPath } from './activityLinks'

describe('safeReturnPath', () => {
  it('accepts an in-app path, with or without a query', () => {
    expect(safeReturnPath('/events/42')).toBe('/events/42')
    expect(safeReturnPath('/games/7?tab=results')).toBe('/games/7?tab=results')
  })

  it('rejects absolute URLs', () => {
    expect(safeReturnPath('https://evil.com')).toBeNull()
    expect(safeReturnPath('http://evil.com/events/1')).toBeNull()
  })

  it('rejects protocol-relative URLs, which start with a slash and still leave the site', () => {
    expect(safeReturnPath('//evil.com')).toBeNull()
    expect(safeReturnPath('//evil.com/events/1')).toBeNull()
    // Browsers that normalise backslashes read this one the same way.
    expect(safeReturnPath('/\\evil.com')).toBeNull()
  })

  it('rejects the auth gates, which would bounce the user in a loop', () => {
    expect(safeReturnPath('/login')).toBeNull()
    expect(safeReturnPath('/login?next=/login')).toBeNull()
    expect(safeReturnPath('/pending')).toBeNull()
    expect(safeReturnPath('/signup')).toBeNull()
    expect(safeReturnPath('/set-password')).toBeNull()
  })

  it('does not reject a real route that merely starts with a gate name', () => {
    expect(safeReturnPath('/loginhistory')).toBe('/loginhistory')
  })

  it('rejects empty input', () => {
    expect(safeReturnPath(null)).toBeNull()
    expect(safeReturnPath(undefined)).toBeNull()
    expect(safeReturnPath('')).toBeNull()
  })
})

describe('activityPath', () => {
  it('maps each activity type to its route', () => {
    expect(activityPath('event', 42)).toBe('/events/42')
    expect(activityPath('training', '7')).toBe('/trainings/7')
    expect(activityPath('game', 900)).toBe('/games/900')
  })

  // The round trip that makes a shared link survive the login screen: whatever
  // the share button writes, AuthRoute stores in `?next=` and LoginPage must
  // hand back unchanged.
  it('produces paths safeReturnPath accepts', () => {
    for (const path of [activityPath('event', 42), activityPath('training', 7), activityPath('game', 9)]) {
      expect(safeReturnPath(path)).toBe(path)
    }
  })
})
