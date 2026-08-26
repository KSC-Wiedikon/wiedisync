import { describe, it, expect } from 'vitest'
import { tidyLocationLabel, formatLocationLabel } from '../locationLabel'
import type { LocationResult } from '../../types'

/** A Google Places hit: `address` is `formattedAddress`, i.e. already complete. */
function google(name: string, address: string, city: string): LocationResult {
  return { name, address, city, lat: null, lon: null, source: 'google' }
}

/** A hall out of our own table: three genuinely separate columns. */
function hall(name: string, address: string, city: string): LocationResult {
  return { name, address, city, lat: null, lon: null, source: 'directus' }
}

describe('tidyLocationLabel', () => {
  it('drops a trailing city the formatted address already carries', () => {
    expect(tidyLocationLabel('MNG Rämibühl, Rämistrasse 58, 8001 Zürich, Schweiz, Zürich'))
      .toBe('MNG Rämibühl, Rämistrasse 58, 8001 Zürich')
  })

  it('drops a venue name the address repeats verbatim', () => {
    expect(tidyLocationLabel('Zürichbergstrasse 10, Zürichbergstrasse 10, 8032 Zürich, Schweiz, Zürich'))
      .toBe('Zürichbergstrasse 10, 8032 Zürich')
  })

  it('handles the real prod rows', () => {
    expect(tidyLocationLabel('Kantonsschule Limmattal, In der Luberzen, 8902 Urdorf, Schweiz, Urdorf'))
      .toBe('Kantonsschule Limmattal, In der Luberzen, 8902 Urdorf')
    expect(tidyLocationLabel('Mehrzweckhalke Egg, 8620 Wetzikon, Schweiz, Wetzikon'))
      .toBe('Mehrzweckhalke Egg, 8620 Wetzikon')
    expect(tidyLocationLabel('Turnhalle, Oberlunkhofen, 8917 Oberlunkhofen, Schweiz, Oberlunkhofen'))
      .toBe('Turnhalle, Oberlunkhofen, 8917 Oberlunkhofen')
  })

  // ⚠ The whole reason this is segment-wise and not a substring test.
  it('does not let a city cancel a street that merely starts with it', () => {
    expect(tidyLocationLabel('Zürichbergstrasse 10, 8032 Zürich, Zürich'))
      .toBe('Zürichbergstrasse 10, 8032 Zürich')
    expect(tidyLocationLabel('Zürichstrasse 5, 8600 Dübendorf'))
      .toBe('Zürichstrasse 5, 8600 Dübendorf')
  })

  it('compares without diacritics or case', () => {
    expect(tidyLocationLabel('Halle, 8001 Zürich, ZURICH')).toBe('Halle, 8001 Zürich')
    expect(tidyLocationLabel('Halle, 8001 Zurich, Zürich')).toBe('Halle, 8001 Zurich')
  })

  // ⚠ Swiss country names are noise; a foreign one is information.
  it('keeps a non-Swiss country', () => {
    expect(tidyLocationLabel('Sporthalle, Hauptstrasse 2, 79576 Weil am Rhein, Deutschland'))
      .toBe('Sporthalle, Hauptstrasse 2, 79576 Weil am Rhein, Deutschland')
  })

  it('drops every Swiss spelling of the country', () => {
    for (const country of ['Schweiz', 'Switzerland', 'Suisse', 'Svizzera', 'Svizra', 'CH']) {
      expect(tidyLocationLabel(`Halle, 8001 Zürich, ${country}`)).toBe('Halle, 8001 Zürich')
    }
  })

  it('leaves an already-clean label alone', () => {
    expect(tidyLocationLabel('KWI A, Steinstrasse 20, Zürich'))
      .toBe('KWI A, Steinstrasse 20, Zürich')
    expect(tidyLocationLabel('Freilager')).toBe('Freilager')
  })

  it('never returns empty when every segment would be dropped', () => {
    expect(tidyLocationLabel('Schweiz')).toBe('Schweiz')
    expect(tidyLocationLabel('')).toBe('')
  })

  it('tolerates stray whitespace and empty segments', () => {
    expect(tidyLocationLabel('Halle ,, 8001 Zürich ,  Schweiz , Zürich'))
      .toBe('Halle, 8001 Zürich')
  })
})

describe('formatLocationLabel', () => {
  it('de-duplicates a Google Places result', () => {
    expect(formatLocationLabel(google('MNG Rämibühl', 'Rämistrasse 58, 8001 Zürich, Schweiz', 'Zürich')))
      .toBe('MNG Rämibühl, Rämistrasse 58, 8001 Zürich')
  })

  // ⚠ The case the old three-field join got right, and which must stay right.
  it('keeps all three parts of a hall row', () => {
    expect(formatLocationLabel(hall('KWI A', 'Steinstrasse 20', 'Zürich')))
      .toBe('KWI A, Steinstrasse 20, Zürich')
  })

  it('handles a hall with no address or city', () => {
    expect(formatLocationLabel(hall('Freilager', '', ''))).toBe('Freilager')
  })

  it('collapses a hall whose city is also its whole address', () => {
    expect(formatLocationLabel(hall('Turnhalle', 'Zürich', 'Zürich')))
      .toBe('Turnhalle, Zürich')
  })
})
