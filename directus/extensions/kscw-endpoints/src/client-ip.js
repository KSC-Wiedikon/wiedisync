/**
 * The one definition of "which IP is this request actually from".
 *
 * Every rate limiter in this tree keys on it, so getting it wrong does not fail
 * loudly — the limiter keeps working, it just stops limiting anyone who sets a
 * header.
 *
 * Prod runs `IP_TRUST_PROXY=true`, so Express resolves `req.ip` to the LEFT-MOST
 * `X-Forwarded-For` entry. Cloudflare **appends** to that header rather than
 * replacing it, so the left-most entry is whatever the client sent — fully
 * attacker-controlled. `req.ip || req.headers['x-forwarded-for']` therefore hands
 * every caller a free bucket per forged header value.
 *
 * `cf-connecting-ip` is written by Cloudflare and cannot be set by the client:
 * CF overwrites any inbound copy. The origin is only reachable through the CF
 * Tunnel (SECURITY.md → trust boundaries), so it is present on every real
 * request; the `x-forwarded-for` and `req.ip` fallbacks exist for local dev and
 * for tests, and are deliberately last.
 *
 * The 2026-07-02 audit migrated nine files to this precedence and missed five
 * call sites in `index.js` — including `/kscw/verify-email`, the only public
 * mail-sending route with no captcha (audit 2026-08-08, finding 12). This module
 * exists so there is nothing left to miss: import it, never re-derive it.
 */
export function clientIp(req) {
  const xff = req?.headers?.['x-forwarded-for']
  return req?.headers?.['cf-connecting-ip']
    || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
    || req?.ip
    || 'unknown'
}
