// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://wiedisync.kscw.ch/"}
//
// The setup that put fake errors in the live log on 2026-11-06: a test claiming to run
// on the prod hostname, reporting a failure, with no stub of its own.
import { describe, it, expect } from 'vitest'
import { sendToErrorLog } from '../lib/sentry'

describe('a test on the prod hostname', () => {
  it('has no real fetch, through either global', async () => {
    await expect(fetch('https://directus.kscw.ch/kscw/client-error')).rejects.toThrow(/A unit test tried to reach/)
    await expect(window.fetch('https://directus.kscw.ch/kscw/client-error')).rejects.toThrow(/A unit test tried to reach/)
  })

  it('cannot deliver an error report to the live log', async () => {
    localStorage.removeItem('kscw-error-log-queue')
    sendToErrorLog({ source: 'frontend', event: 'api_error', level: 'error', error: 'Fake failure from blockRealNetwork.dom.test' })
    // Refused by the guard, so the queue keeps it: nothing went out.
    await expect.poll(() => localStorage.getItem('kscw-error-log-queue')).toContain('Fake failure')
    localStorage.removeItem('kscw-error-log-queue')
  })
})
