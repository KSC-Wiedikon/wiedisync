import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TOUR_STORAGE_KEY, DEFAULT_TOUR_STATE } from './types'
import type { TourState } from './types'

// Minimal localStorage mock for node environment
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value },
  removeItem: (key: string) => { delete store[key] },
  clear: () => { Object.keys(store).forEach(k => delete store[k]) },
}
vi.stubGlobal('localStorage', localStorageMock)

describe('Tour state persistence', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns default state when no saved state', () => {
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBeNull()
  })

  it('saves and loads state correctly', () => {
    const state: TourState = { completed: ['getting-started'], dismissed: ['training-coach'], firstVisitDone: true }
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(state))
    const loaded = JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY)!)
    expect(loaded.completed).toEqual(['getting-started'])
    expect(loaded.dismissed).toEqual(['training-coach'])
    expect(loaded.firstVisitDone).toBe(true)
  })

  it('handles corrupted localStorage gracefully', () => {
    localStorage.setItem(TOUR_STORAGE_KEY, 'not json')
    expect(() => JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY)!)).toThrow()
    expect(DEFAULT_TOUR_STATE.completed).toEqual([])
  })

  it('completed and dismissed are separate lists', () => {
    const state: TourState = { completed: ['getting-started'], dismissed: ['training-coach'], firstVisitDone: true }
    expect(state.completed.includes('training-coach')).toBe(false)
    expect(state.dismissed.includes('getting-started')).toBe(false)
  })
})

describe('Tour registry', () => {
  it('exports all 15 tours', async () => {
    const { tourRegistry } = await import('./tours')
    expect(tourRegistry).toHaveLength(15)
  })

  it('every step target has a matching data-tour attribute in src/', async () => {
    const { tourRegistry } = await import('./tours')
    // Superset extraction: plain data-tour="x" plus every quoted string inside
    // conditional data-tour={cond ? 'x' : undefined} expressions.
    const modules = import.meta.glob('../../**/*.{ts,tsx}', { query: '?raw', import: 'default' })
    const attrs = new Set<string>()
    for (const load of Object.values(modules)) {
      const text = (await load()) as string
      for (const m of text.matchAll(/data-tour=(?:"([^"]+)"|\{([^}]*)\})/g)) {
        if (m[1]) attrs.add(m[1])
        else if (m[2]) for (const q of m[2].matchAll(/'([^']+)'/g)) attrs.add(q[1])
      }
    }
    for (const tour of tourRegistry) {
      for (const step of tour.steps) {
        const name = step.target.match(/^\[data-tour="([^"]+)"\]$/)?.[1]
        expect(name, `${tour.id}: unparsable target ${step.target}`).toBeTruthy()
        expect(attrs.has(name!), `${tour.id}: no data-tour="${name}" anywhere in src/`).toBe(true)
      }
    }
  })

  it('each tour has required fields', async () => {
    const { tourRegistry } = await import('./tours')
    for (const tour of tourRegistry) {
      expect(tour.id).toBeTruthy()
      expect(tour.titleKey).toBeTruthy()
      expect(tour.descriptionKey).toBeTruthy()
      expect(tour.section).toMatch(/^(basics|member|coach|admin)$/)
      expect(typeof tour.canAccess).toBe('function')
      expect(tour.route).toMatch(/^\//)
      expect(tour.steps.length).toBeGreaterThan(0)
    }
  })

  it('each step has target and i18n keys', async () => {
    const { tourRegistry } = await import('./tours')
    for (const tour of tourRegistry) {
      for (const step of tour.steps) {
        expect(step.target).toMatch(/^\[data-tour=/)
        expect(step.titleKey).toBeTruthy()
        expect(step.bodyKey).toBeTruthy()
      }
    }
  })

  it('tour IDs are unique', async () => {
    const { tourRegistry } = await import('./tours')
    const ids = tourRegistry.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
