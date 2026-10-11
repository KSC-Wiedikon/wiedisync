/**
 * Credentialed-CORS allow-list (audit 2026-09-28, F43): only the cookie-session
 * app origins may be told Access-Control-Allow-Credentials; the website and any
 * reflected origin keep Access-Control-Allow-Origin but lose credentials.
 * Since the 2026-10-11 audit the list is per instance (prod vs dev).
 */
import { describe, it, expect } from 'vitest'
import { createCorsCredentialsMiddleware, credentialedOrigins, mayUseCredentials } from '../cors-credentials.js'

const PROD = { PUBLIC_URL: 'https://directus.kscw.ch' }
const DEV = { PUBLIC_URL: 'https://directus-dev.kscw.ch' }

function run(origin, env) {
  const headers = {}
  const res = { setHeader(n, v) { headers[n.toLowerCase()] = v; return this } }
  const req = { headers: origin ? { origin } : {} }
  let called = false
  createCorsCredentialsMiddleware(env)(req, res, () => { called = true })
  // What Directus's cors middleware does next:
  res.setHeader('Access-Control-Allow-Origin', origin || '*')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  return { headers, called }
}

describe('cors credentials allow-list', () => {
  it('prod keeps credentials only for the prod app origins', () => {
    for (const o of ['https://wiedisync.kscw.ch', 'https://spielplanung.wiedisync.kscw.ch']) {
      const { headers, called } = run(o, PROD)
      expect(called).toBe(true)
      expect(headers['access-control-allow-credentials']).toBe('true')
    }
  })

  it('prod drops credentials for dev hosts and local dev servers', () => {
    for (const o of ['https://spielplanung-dev.kscw.ch', 'https://dev.kscw-wiedisync.pages.dev', 'https://wiedisync-dev.kscw.ch', 'http://localhost:5173', 'http://100.76.39.66:1234']) {
      expect(run(o, PROD).headers['access-control-allow-credentials']).toBeUndefined()
    }
  })

  it('dev keeps credentials for the dev app origins and local dev servers', () => {
    for (const o of ['https://spielplanung-dev.kscw.ch', 'https://dev.kscw-wiedisync.pages.dev', 'https://wiedisync-dev.kscw.ch', 'http://localhost:5173', 'http://100.76.39.66:1234']) {
      expect(run(o, DEV).headers['access-control-allow-credentials']).toBe('true')
    }
    expect(run('https://wiedisync.kscw.ch', DEV).headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('an unset or look-alike PUBLIC_URL gets the dev list, never the prod one', () => {
    for (const env of [{}, { PUBLIC_URL: 'https://directus.kscw.ch.evil.example' }]) {
      expect(credentialedOrigins(env).has('https://wiedisync.kscw.ch')).toBe(false)
    }
  })

  it('drops credentials for the website, but keeps the origin header', () => {
    for (const env of [PROD, DEV]) {
      for (const o of ['https://kscw.ch', 'https://kscw-website.pages.dev', 'https://evil.example', 'https://forms.kscw.ch']) {
        const { headers } = run(o, env)
        expect(headers['access-control-allow-credentials']).toBeUndefined()
        expect(headers['access-control-allow-origin']).toBe(o)
      }
    }
  })

  it('leaves requests without an Origin alone', () => {
    expect(run(null, PROD).headers['access-control-allow-credentials']).toBe('true')
  })

  it('honours KSCW_CREDENTIALED_ORIGINS', () => {
    const allowed = credentialedOrigins({ ...PROD, KSCW_CREDENTIALED_ORIGINS: 'https://a.kscw.ch, https://b.kscw.ch' })
    expect(mayUseCredentials('https://a.kscw.ch', allowed)).toBe(true)
    expect(mayUseCredentials('https://wiedisync.kscw.ch', allowed)).toBe(false)
  })

  it('does not match look-alike local origins', () => {
    const allowed = credentialedOrigins(DEV)
    expect(mayUseCredentials('http://localhost.evil.example', allowed)).toBe(false)
    expect(mayUseCredentials('https://localhost:5173', allowed)).toBe(false)
  })
})
