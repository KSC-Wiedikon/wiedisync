// public/boot-watchdog.js reports a stalled boot before the app bundle (and its own
// redactor) exists, so it carries a copy of the token rules. That copy knew only hex,
// and the public event share page is `/e/<base64url token>` (security audit 2026-10).
// Run the real file in a sandbox and read what it would post.
import { describe, it, expect } from 'vitest'
import SOURCE from '../../public/boot-watchdog.js?raw'

// The script's free globals, bound to fakes by running it as a function body.
const GLOBALS = ['window', 'performance', 'navigator', 'document', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout'] as const
const shareToken = 'Zk3_q9-LmN0pQrStUvWxYz012345AbCdEfGhIjKlMnO' // gitleaks:allow — synthetic fixture

function stalledBoot(pathname: string, resources: string[] = []) {
  const posted: Array<Record<string, unknown>> = []
  const ctx: Record<string, unknown> = {
    location: { hostname: 'wiedisync.kscw.ch', pathname, origin: 'https://wiedisync.kscw.ch' },
    // 20 s since navigation: the 15 s stall timer is already due.
    performance: {
      now: () => 20_000,
      getEntriesByType: (type: string) => (type === 'resource' ? resources.map((name) => ({ name, duration: 1, transferSize: 0 })) : []),
    },
    navigator: { userAgent: 'test', onLine: true },
    document: { visibilityState: 'visible', readyState: 'complete', querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {},
    setTimeout: (fn: () => void) => { fn(); return 1 },
    clearTimeout() {},
    fetch: (_url: string, init: { body: string }) => {
      posted.push(JSON.parse(init.body))
      return Promise.resolve({ ok: true, status: 204 })
    },
  }
  ctx.window = ctx
  new Function(...GLOBALS, SOURCE)(...GLOBALS.map((g) => ctx[g]))
  return posted
}

describe('boot-watchdog scrubUrl', () => {
  it('redacts the event share token in the page and in resource URLs', () => {
    const [entry] = stalledBoot(`/e/${shareToken}`, [
      `https://directus.kscw.ch/kscw/public/events/${shareToken}`,
      'https://wiedisync.kscw.ch/assets/SpielplanungAdminPage-Dk3j4kLm.js',
      'https://directus.kscw.ch/kscw/terminplanung/slots/a1b2c3d4e5f60718a9b0c1d2e3f40516',
    ])
    expect(entry.event).toBe('boot_stall')
    expect(entry.page).toBe('/e/:token')
    const res = (entry.payload as { res: Array<{ u: string }> }).res.map((r) => r.u)
    expect(res).toEqual([
      'https://directus.kscw.ch/kscw/public/events/:token',
      '/assets/SpielplanungAdminPage-Dk3j4kLm.js',
      'https://directus.kscw.ch/kscw/terminplanung/slots/:token',
    ])
    expect(JSON.stringify(entry)).not.toContain(shareToken)
  })

  it('redacts any random-looking whole segment, leaves slugs alone', () => {
    expect(stalledBoot(`/some/new-flow/${shareToken}`)[0].page).toBe('/some/new-flow/:token')
    expect(stalledBoot('/admin/clubdesk-registration-status')[0].page).toBe('/admin/clubdesk-registration-status')
  })
})
