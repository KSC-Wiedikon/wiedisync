/**
 * Credentialed-CORS allow-list (audit 2026-09-28, F43): only the cookie-session
 * app origins may be told Access-Control-Allow-Credentials; the website and any
 * reflected origin keep Access-Control-Allow-Origin but lose credentials.
 */
import { describe, it, expect } from 'vitest'
import { createCorsCredentialsMiddleware, credentialedOrigins, mayUseCredentials } from '../cors-credentials.js'

function run(origin, env = {}) {
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
  it('keeps credentials for the app origins', () => {
    for (const o of ['https://wiedisync.kscw.ch', 'https://spielplanung.wiedisync.kscw.ch', 'https://spielplanung-dev.kscw.ch', 'http://localhost:5173', 'http://100.76.39.66:1234']) {
      const { headers, called } = run(o)
      expect(called).toBe(true)
      expect(headers['access-control-allow-credentials']).toBe('true')
    }
  })

  it('drops credentials for the website, but keeps the origin header', () => {
    for (const o of ['https://kscw.ch', 'https://kscw-website.pages.dev', 'https://evil.example', 'https://forms.kscw.ch']) {
      const { headers } = run(o)
      expect(headers['access-control-allow-credentials']).toBeUndefined()
      expect(headers['access-control-allow-origin']).toBe(o)
    }
  })

  it('leaves requests without an Origin alone', () => {
    expect(run(null).headers['access-control-allow-credentials']).toBe('true')
  })

  it('honours KSCW_CREDENTIALED_ORIGINS', () => {
    const allowed = credentialedOrigins({ KSCW_CREDENTIALED_ORIGINS: 'https://a.kscw.ch, https://b.kscw.ch' })
    expect(mayUseCredentials('https://a.kscw.ch', allowed)).toBe(true)
    expect(mayUseCredentials('https://wiedisync.kscw.ch', allowed)).toBe(false)
  })

  it('does not match look-alike local origins', () => {
    const allowed = credentialedOrigins({})
    expect(mayUseCredentials('http://localhost.evil.example', allowed)).toBe(false)
    expect(mayUseCredentials('https://localhost:5173', allowed)).toBe(false)
  })
})
