import { useState, useEffect, useRef } from 'react'
import { captureApiError } from '../lib/sentry'
import type { LocationResult } from '../types'

// Minimal shapes for the Places API responses we consume — a field rename on
// Google's side now surfaces at compile time instead of yielding empty results.
interface PlacePrediction {
  placeId?: string
  place?: string
  text?: { text?: string }
  structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } }
}
interface AutocompleteSuggestion { placePrediction?: PlacePrediction }
interface AutocompleteResponse { suggestions?: AutocompleteSuggestion[] }
interface AddressComponent { longText?: string; types?: string[] }
interface PlaceDetails {
  displayName?: { text?: string }
  formattedAddress?: string
  location?: { latitude?: number; longitude?: number }
  addressComponents?: AddressComponent[]
}

// SECURITY: This Google Places API key is inherently client-side — Places
// Autocomplete runs in the browser, so the key is inlined into the static bundle
// and CANNOT be hidden here. It MUST be locked down in the Google Cloud Console:
//   1. Application restriction: HTTP referrers, limited to the app's domains only
//      (wiedisync.kscw.ch, *.wiedisync.pages.dev) — no wildcard "*".
//   2. API restriction: Places API only — the key must NOT carry scope for any
//      other Google API.
//   3. Billing: set a daily quota cap so a leaked key cannot rack up unbounded
//      cost; the key must NOT grant access to other billable services.
// Without these restrictions the bundled key is an open billing/financial-DoS hole.
// (Referrer restrictions are bypassable; the proper long-term fix is to proxy
//  Places lookups through an authenticated server-side endpoint that holds the key.)
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

export function useGooglePlacesSearch(query: string, options?: { enabled?: boolean }) {
  const [results, setResults] = useState<LocationResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const sessionTokenRef = useRef(crypto.randomUUID())
  const enabled = options?.enabled ?? true

  useEffect(() => {
    if (!enabled || !API_KEY || query.length < 3) {
      setResults([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': API_KEY,
          },
          body: JSON.stringify({
            input: query,
            locationBias: {
              circle: { center: { latitude: 47.37, longitude: 8.55 }, radius: 50000 },
            },
            languageCode: 'de',
            sessionToken: sessionTokenRef.current,
          }),
          signal: controller.signal,
        })

        if (!res.ok) throw new Error(`Places API: ${res.status}`)
        const data: AutocompleteResponse = await res.json()
        const suggestions = data.suggestions ?? []

        // Fetch place details for each suggestion to get coordinates
        const mapped: (LocationResult | null)[] = await Promise.all(
          suggestions.slice(0, 5).map(async (s: AutocompleteSuggestion) => {
            const place = s.placePrediction
            if (!place) return null

            try {
              const detailRes = await fetch(
                `https://places.googleapis.com/v1/${place.placeId ? `places/${place.placeId}` : place.place}?languageCode=de&sessionToken=${sessionTokenRef.current}`,
                {
                  headers: {
                    'X-Goog-Api-Key': API_KEY,
                    'X-Goog-FieldMask': 'displayName,formattedAddress,location,addressComponents',
                  },
                  signal: controller.signal,
                },
              )

              if (!detailRes.ok) return fallbackResult(place)
              const detail: PlaceDetails = await detailRes.json()

              const city = detail.addressComponents?.find(
                (c: AddressComponent) => c.types?.includes('locality'),
              )?.longText || ''

              return {
                name: detail.displayName?.text || place.structuredFormat?.mainText?.text || '',
                address: detail.formattedAddress || '',
                city,
                lat: detail.location?.latitude ?? null,
                lon: detail.location?.longitude ?? null,
                source: 'google' as const,
              }
            } catch {
              return fallbackResult(place)
            }
          }),
        )

        // Reset session token after Place Details call (session ends)
        sessionTokenRef.current = crypto.randomUUID()

        setResults(mapped.filter((r): r is LocationResult => r !== null))
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Capture non-abort failures (over-quota / mis-restricted key / network)
        // so the billing-DoS risk the file header warns about is diagnosable
        // instead of silently yielding "no results".
        captureApiError(err, { operation: 'useGooglePlacesSearch', endpoint: 'places.googleapis.com' })
        setResults([])
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      abortRef.current?.abort()
    }
  }, [query, enabled])

  return { results, isLoading }
}

function fallbackResult(place: PlacePrediction): LocationResult {
  return {
    name: place.structuredFormat?.mainText?.text || place.text?.text || '',
    address: place.structuredFormat?.secondaryText?.text || '',
    city: '',
    lat: null,
    lon: null,
    source: 'google',
  }
}
