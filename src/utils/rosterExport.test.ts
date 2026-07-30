import { describe, it, expect } from 'vitest'
import { nextSliceEnd } from './rosterExport'

/**
 * The PDF pager slices one tall snapshot into A4 pages. Slicing at a fixed
 * height cut the last row of every page in half (name on page 1, status on
 * page 2), so the end of a page must land on a row boundary.
 */
describe('nextSliceEnd', () => {
  // Rows 100px tall, page fits 350px → the page must end at 300, not 350.
  const rows = [100, 200, 300, 400, 500, 600]

  it('ends the page on the last row boundary that fits', () => {
    expect(nextSliceEnd(0, 350, 600, rows)).toBe(300)
  })

  it('continues from the previous boundary', () => {
    expect(nextSliceEnd(300, 350, 600, rows)).toBe(600)
  })

  it('takes the whole remainder when it fits on the page', () => {
    expect(nextSliceEnd(400, 350, 600, rows)).toBe(600)
  })

  it('uses an exact boundary rather than overshooting it', () => {
    expect(nextSliceEnd(0, 300, 600, rows)).toBe(300)
  })

  it('falls back to a hard cut when a single row is taller than the page', () => {
    // One 500px row on a 350px page: no boundary fits, so cut — otherwise the
    // loop would never advance.
    expect(nextSliceEnd(0, 350, 1000, [500, 1000])).toBe(350)
  })

  it('never returns a non-advancing end', () => {
    // Boundaries entirely behind the cursor must be ignored.
    expect(nextSliceEnd(500, 350, 1000, [100, 200, 300])).toBe(850)
  })

  it('degrades to fixed-height slicing with no boundaries', () => {
    expect(nextSliceEnd(0, 350, 1000, [])).toBe(350)
    expect(nextSliceEnd(700, 350, 1000, [])).toBe(1000)
  })

  it('never runs past the image', () => {
    expect(nextSliceEnd(0, 350, 200, rows)).toBe(200)
  })
})
