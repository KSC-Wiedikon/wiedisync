import { useEffect, useRef, useState } from 'react'
import type { Connection, Envelope } from './types'

/**
 * Resolve the relay base URL. Mirrors the host-detection pattern in
 * src/lib/api.ts: an explicit env var wins; otherwise pick by hostname. There is
 * a SINGLE physical scoreboard, so dev + prod frontends point at the same relay
 * unless overridden.
 *
 * NOTE: whichever origin this resolves to MUST be present in the CSP
 * `connect-src` allowlist in public/_headers, or EventSource is blocked. See
 * .planning/live-scoring-DESIGN.md § CSP.
 */
function relayBase(): string {
  const fromEnv = import.meta.env.VITE_LIVE_RELAY_URL as string | undefined
  if (fromEnv) return fromEnv.replace(/\/$/, '')
  // Placeholder default — replace with the deployed Worker URL (or a custom
  // route such as https://live.kscw.ch) once the relay ships.
  return 'https://kscw-live-relay.lucanepa.workers.dev'
}

export interface LiveMatch {
  /** Latest envelope from the relay, or null before the first frame arrives. */
  envelope: Envelope | null
  /** EventSource lifecycle. */
  connection: Connection
  /** ms epoch of the last frame the client received (for "updated at HH:MM"). */
  lastReceivedAt: number | null
}

/**
 * Subscribe to a live-scoring channel over Server-Sent Events.
 *
 * EventSource gives us automatic reconnection with Last-Event-ID resume for free
 * — ideal for spectators on flaky hall wifi. We never reconnect by hand; on a
 * transient error the browser retries and we surface `connection: 'reconnecting'`.
 */
export function useLiveMatch(channel: string): LiveMatch {
  const [envelope, setEnvelope] = useState<Envelope | null>(null)
  const [connection, setConnection] = useState<Connection>('connecting')
  const [lastReceivedAt, setLastReceivedAt] = useState<number | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const url = `${relayBase()}/subscribe/${encodeURIComponent(channel)}`
    // Public read — no credentials, so no CORS-credentials handshake needed.
    const es = new EventSource(url)
    esRef.current = es

    const onFrame = (e: MessageEvent) => {
      try {
        setEnvelope(JSON.parse(e.data) as Envelope)
        setLastReceivedAt(Date.now())
        setConnection('open')
      } catch {
        /* ignore a malformed frame — the next one will replace it */
      }
    }

    es.addEventListener('open', () => setConnection('open'))
    // Frames are named ('event: snapshot' / 'event: update'), so onmessage never
    // fires — listen for the named events explicitly.
    es.addEventListener('snapshot', onFrame as EventListener)
    es.addEventListener('update', onFrame as EventListener)
    es.addEventListener('error', () => {
      // readyState CONNECTING (0) means the browser is already retrying.
      setConnection(es.readyState === EventSource.CLOSED ? 'connecting' : 'reconnecting')
    })

    return () => {
      es.close()
      esRef.current = null
    }
  }, [channel])

  return { envelope, connection, lastReceivedAt }
}
