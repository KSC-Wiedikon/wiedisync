/**
 * Newsletter Subscribe/Verify/Unsubscribe endpoints
 * POST /kscw/newsletter/subscribe — public, Turnstile protected
 * POST /kscw/newsletter/verify — public
 * POST /kscw/newsletter/unsubscribe — public
 */

import crypto from 'crypto';

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
// kscw.ch is the live domain. The old default (kscw-website.pages.dev) still resolves —
// it serves the same CF Pages deploy — but it is the bare project domain, so every
// newsletter link showed members a *.pages.dev hostname and bounced them through the
// transitional 302 in the website's functions/_middleware.js. A pages.dev URL in a
// double-opt-in mail is exactly the shape a recipient is trained to distrust.
const WEBSITE_URL = process.env.KSCW_WEBSITE_URL || 'https://kscw.ch';

async function verifyTurnstile(token, remoteip) {
  // Fail closed when the secret is missing — a misconfigured container would
  // otherwise turn this public endpoint into an unauthenticated email-relay.
  if (!TURNSTILE_SECRET) {
    console.error('[newsletter] TURNSTILE_SECRET not configured — rejecting request');
    return false;
  }
  const params = new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token) });
  if (remoteip) params.set('remoteip', String(remoteip));
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return (await resp.json()).success === true;
}

export function registerNewsletter(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'newsletter' });

  // Anti-email-bomb throttle (defense-in-depth behind Turnstile): 5 subscribe
  // attempts / hour / IP and 3 / hour / target email. Each subscribe triggers a
  // verification email, so an unthrottled endpoint could be abused to mail-bomb
  // an arbitrary address even with a valid Turnstile token.
  const subscribeIp = new Map();    // ip → { count, resetAt }
  const subscribeEmail = new Map(); // email → { count, resetAt }

  // POST /kscw/newsletter/subscribe
  router.post('/newsletter/subscribe', async (req, res) => {
    try {
      const { email, locale, categories, turnstile_token } = req.body;
      if (!email) return res.status(400).json({ error: 'email required' });

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email' });

      // cf-connecting-ip is the real client IP: CF appends the client to XFF, so
      // the leftmost XFF value is attacker-spoofable and would hand each spoofed
      // header a fresh limiter bucket (and a spoofed Turnstile remoteip below).
      const xff = req.headers['x-forwarded-for'];
      const ip = req.headers['cf-connecting-ip']
        || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
        || req.ip || 'unknown';
      const now = Date.now();
      const ipEntry = subscribeIp.get(ip);
      if (ipEntry && now < ipEntry.resetAt) {
        if (ipEntry.count >= 5) return res.status(429).json({ error: 'Too many requests' });
        ipEntry.count++;
      } else {
        subscribeIp.set(ip, { count: 1, resetAt: now + 3600000 });
      }
      if (subscribeIp.size > 1000) {
        for (const [k, v] of subscribeIp) { if (now > v.resetAt) subscribeIp.delete(k); }
      }

      const emailKey = email.toLowerCase();
      const emEntry = subscribeEmail.get(emailKey);
      if (emEntry && now < emEntry.resetAt) {
        if (emEntry.count >= 3) return res.status(429).json({ error: 'Too many requests' });
        emEntry.count++;
      } else {
        subscribeEmail.set(emailKey, { count: 1, resetAt: now + 3600000 });
      }
      if (subscribeEmail.size > 5000) {
        for (const [k, v] of subscribeEmail) { if (now > v.resetAt) subscribeEmail.delete(k); }
      }

      if (!turnstile_token || !(await verifyTurnstile(turnstile_token, ip))) {
        return res.status(400).json({ error: 'Captcha verification failed' });
      }

      const validLocales = ['de', 'en'];
      const loc = validLocales.includes(locale) ? locale : 'de';
      const cats = Array.isArray(categories) ? categories.filter(c => ['volleyball', 'basketball', 'club'].includes(c)) : ['volleyball', 'basketball', 'club'];

      // Check existing
      const existing = await database('newsletter_subscribers').where('email', email.toLowerCase()).first();
      if (existing) {
        if (existing.verified) {
          return res.json({ success: true, already_subscribed: true });
        }
        // Resend verification
        const schema = await getSchema();
        const { MailService } = services;
        const mail = new MailService({ schema, knex: database });
        // No locale prefix: the site is single-URL and public/_redirects 301s /de|/en/*
        // onto the bare path, so the prefix only ever bought a second redirect hop. The
        // page reads ?verify= off the query string and picks its language from
        // localStorage/navigator (public/js/i18n.js) — the path never carried it.
        const verifyUrl = `${WEBSITE_URL}/news/?verify=${existing.verify_token}`;
        await mail.send({
          to: email,
          subject: loc === 'de' ? 'KSCW Newsletter — Bestätigung' : 'KSCW Newsletter — Confirmation',
          text: loc === 'de'
            ? `Bitte bestätige dein Newsletter-Abo: ${verifyUrl}`
            : `Please confirm your newsletter subscription: ${verifyUrl}`,
        });
        return res.json({ success: true });
      }

      const verifyToken = crypto.randomBytes(32).toString('hex');
      const unsubToken = crypto.randomBytes(32).toString('hex');

      await database('newsletter_subscribers').insert({
        id: crypto.randomUUID(),
        email: email.toLowerCase(),
        locale: loc,
        categories: JSON.stringify(cats),
        verified: false,
        verify_token: verifyToken,
        unsubscribe_token: unsubToken,
      });

      // Send verification email
      const schema = await getSchema();
      const { MailService } = services;
      const mail = new MailService({ schema, knex: database });
      const verifyUrl = `${WEBSITE_URL}/news/?verify=${verifyToken}`;

      await mail.send({
        to: email,
        subject: loc === 'de' ? 'KSCW Newsletter — Bestätigung' : 'KSCW Newsletter — Confirmation',
        text: loc === 'de'
          ? `Bitte bestätige dein Newsletter-Abo: ${verifyUrl}`
          : `Please confirm your newsletter subscription: ${verifyUrl}`,
      });

      log.info(`Newsletter subscribe: ${email}`);
      res.json({ success: true });
    } catch (err) {
      log.error({ msg: `newsletter/subscribe: ${err.message}`, stack: err.stack });
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // POST /kscw/newsletter/verify
  router.post('/newsletter/verify', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'token required' });

      const updated = await database('newsletter_subscribers')
        .where('verify_token', token)
        .where('verified', false)
        .update({ verified: true });

      if (!updated) return res.status(404).json({ error: 'Invalid or expired token' });

      log.info('Newsletter verified');
      res.json({ success: true });
    } catch (err) {
      log.error({ msg: `newsletter/verify: ${err.message}`, stack: err.stack });
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // POST /kscw/newsletter/unsubscribe
  router.post('/newsletter/unsubscribe', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'token required' });

      const deleted = await database('newsletter_subscribers')
        .where('unsubscribe_token', token)
        .delete();

      if (!deleted) return res.status(404).json({ error: 'Invalid token' });

      log.info('Newsletter unsubscribed');
      res.json({ success: true });
    } catch (err) {
      log.error({ msg: `newsletter/unsubscribe: ${err.message}`, stack: err.stack });
      res.status(500).json({ error: 'Internal error' });
    }
  });
}
