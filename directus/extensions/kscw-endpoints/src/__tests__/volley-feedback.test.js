/**
 * volley-feedback.js — the rating columns became English in migration 421,
 * but the kscw-website form still posts the German keys.
 */
import { describe, it, expect } from 'vitest'
import { ratingInput, LEGACY_RATING_KEYS } from '../volley-feedback.js'

describe('ratingInput', () => {
  it('reads the English key', () => {
    expect(ratingInput({ rating_club: 4 }, 'rating_club')).toBe(4)
    expect(ratingInput({ rating_training: 3 }, 'rating_training')).toBe(3)
  })

  it('falls back to the pre-421 German key the website form posts', () => {
    const body = { rating_verein: 5, rating_vorstand: 4, rating_tk_leitung: 3, rating_kommunikation: 2 }
    expect(ratingInput(body, 'rating_club')).toBe(5)
    expect(ratingInput(body, 'rating_board')).toBe(4)
    expect(ratingInput(body, 'rating_technical_committee')).toBe(3)
    expect(ratingInput(body, 'rating_communication')).toBe(2)
  })

  it('prefers the English key when both are sent', () => {
    expect(ratingInput({ rating_club: 1, rating_verein: 5 }, 'rating_club')).toBe(1)
  })

  it('maps every legacy key to a distinct column', () => {
    expect(new Set(Object.values(LEGACY_RATING_KEYS)).size).toBe(4)
    expect(ratingInput({}, 'rating_club')).toBeUndefined()
  })
})
