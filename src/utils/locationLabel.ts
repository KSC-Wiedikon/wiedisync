import type { LocationResult } from '../types'

/**
 * Tidy a composed location label.
 *
 * `LocationCombobox` builds its display string from three fields of a
 * `LocationResult` — `name`, `address`, `city`. That is right for a hall out of
 * our own `halls` table, where the three are genuinely separate columns
 * ("KWI A" / "Steinstrasse 20" / "Zürich"). It is wrong for a Google Places
 * result, where `address` is `formattedAddress` — a COMPLETE address that
 * already carries the street, the postcode, the city and the country. Appending
 * `city` to that restates it:
 *
 *     MNG Rämibühl, Rämistrasse 58, 8001 Zürich, Schweiz, Zürich
 *                                        ^^^^^^           ^^^^^^
 *
 * and when the place is a plain street address rather than a named venue,
 * `displayName` IS the street, so the front of the string doubles too:
 *
 *     Zürichbergstrasse 10, Zürichbergstrasse 10, 8032 Zürich, Schweiz, Zürich
 *
 * Rather than branch on `source` — which would leave the two paths free to drift,
 * and would not help the rows already written — this normalises the composed
 * string itself: drop a segment that an earlier segment already says.
 *
 * ⚠ Only SWISS country names are dropped. "Schweiz" on a Zürich address is
 * noise; "Deutschland" on an away fixture in Weil am Rhein is information, and
 * stripping it would quietly make a foreign venue read as a local one.
 *
 * ⚠ Comparison is diacritic- and case-insensitive, so "Zurich" cancels "Zürich"
 * (Places answers in German, our `halls` rows are hand-typed). It is also
 * SEGMENT-wise, never a substring test: "Zürichbergstrasse" must not be
 * cancelled by the city "Zürich".
 */

/** Swiss country names, in the four national languages + Romansh + the ISO code. */
const SWISS_COUNTRY_SEGMENTS = new Set([
  'schweiz', 'switzerland', 'suisse', 'svizzera', 'svizra', 'ch',
])

/** Fold case and diacritics so "Zurich" and "Zürich" compare equal. */
function fold(segment: string): string {
  return segment
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * The locality inside a segment, when the segment is a `<postcode> <city>` pair —
 * "8001 Zürich" → "Zürich". Returns null otherwise, so a bare street number
 * ("Rämistrasse 58") is never mistaken for a postcode + city.
 */
function localityOf(segment: string): string | null {
  const match = /^\d{4,5}\s+(.+)$/.exec(segment.trim())
  return match ? match[1] : null
}

/** True when something already kept says what `segment` says. */
function alreadyStated(kept: string[], segment: string): boolean {
  const folded = fold(segment)
  return kept.some((k) => {
    if (fold(k) === folded) return true
    const locality = localityOf(k)
    return locality !== null && fold(locality) === folded
  })
}

export function tidyLocationLabel(raw: string): string {
  if (!raw) return ''

  const segments = raw.split(',').map((s) => s.trim()).filter(Boolean)
  const kept: string[] = []

  for (const segment of segments) {
    if (SWISS_COUNTRY_SEGMENTS.has(fold(segment))) continue
    if (alreadyStated(kept, segment)) continue
    kept.push(segment)
  }

  // Never hand back less than we were given: a label made ENTIRELY of dropped
  // segments (a lone "Schweiz", a venue literally called "Zürich, Zürich") would
  // otherwise vanish, and an empty location is worse than a redundant one.
  return kept.length > 0 ? kept.join(', ') : raw.trim()
}

/** The display string for a picked location — name, address, city, de-duplicated. */
export function formatLocationLabel(result: LocationResult): string {
  return tidyLocationLabel(
    [result.name, result.address, result.city].filter(Boolean).join(', '),
  )
}
