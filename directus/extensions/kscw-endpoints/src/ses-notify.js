/**
 * AWS SES bounce/complaint webhook (delivered via SNS).
 *
 *   POST /kscw/ses/notify   — public, but cryptographically authenticated
 *
 * SES publishes delivery events to an SNS topic; SNS POSTs them here. Permanent
 * bounces and complaints are written to `email_suppressions` (migration 277) and
 * every send path then skips those addresses.
 *
 * ⚠ THIS ENDPOINT IS UNAUTHENTICATED BY NECESSITY — SNS cannot present a bearer
 * token. It is therefore authenticated by verifying Amazon's RSA signature on
 * every message, and that verification is the ONLY thing standing between the
 * open internet and "suppress any address you like". A forged POST that skipped
 * verification could silently stop mail to the entire club, one address at a
 * time, with no error anywhere. Do not add a fast path around verifySnsMessage.
 *
 * Setup (one-off, in the AWS console — not automatable from here):
 *   1. SNS → create topic, e.g. `kscw-ses-events`
 *   2. SES → the noreply.kscw.ch identity → Notifications → set Bounce and
 *      Complaint destinations to that topic (Delivery is not needed)
 *   3. SNS → subscribe the topic, protocol HTTPS, endpoint
 *      https://directus.kscw.ch/kscw/ses/notify
 *   4. Optionally set SES_SNS_TOPIC_ARN in the container env to pin the topic —
 *      without it any *validly signed* Amazon topic is accepted, which is a much
 *      weaker guarantee than it sounds (anyone with an AWS account can sign).
 *      Set it.
 */

import crypto from 'crypto'
import { suppress } from './email-suppression.js'

// SNS signs a specific field set, in a specific order, per message type.
const SIGNED_FIELDS = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
}

// Cache fetched signing certs — SNS reuses one for long stretches and we do not
// want a network round-trip per notification. Keyed by URL, which is safe
// because the URL itself is validated before use.
const certCache = new Map()

/**
 * The cert URL must be an Amazon host over TLS. Without this check an attacker
 * points SigningCertURL at their own server, serves their own cert, signs their
 * own payload, and every signature "verifies" — the single most common way SNS
 * verification is got wrong.
 */
function validCertUrl(raw) {
  let u
  try { u = new URL(String(raw)) } catch { return false }
  if (u.protocol !== 'https:') return false
  // Exactly sns.<region>.amazonaws.com — not merely *ending* in amazonaws.com,
  // which "evil-amazonaws.com" also satisfies under a naive endsWith().
  return /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)
}

async function fetchCert(url) {
  if (certCache.has(url)) return certCache.get(url)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`cert fetch ${res.status}`)
  const pem = await res.text()
  if (certCache.size > 20) certCache.clear()
  certCache.set(url, pem)
  return pem
}

/** Canonical string SNS signed: "Key\nValue\n" for each present signed field. */
function canonicalString(msg) {
  const fields = SIGNED_FIELDS[msg.Type]
  if (!fields) return null
  let out = ''
  for (const f of fields) {
    // Subject is optional; absent fields are omitted entirely, not blanked.
    if (msg[f] === undefined || msg[f] === null) continue
    out += `${f}\n${msg[f]}\n`
  }
  return out
}

async function verifySnsMessage(msg) {
  const canonical = canonicalString(msg)
  if (!canonical) return false
  if (!validCertUrl(msg.SigningCertURL)) return false
  if (!msg.Signature) return false
  // SignatureVersion 1 = SHA1, 2 = SHA256. Anything else is not something we
  // know how to check, so it fails rather than passes.
  const algo = String(msg.SignatureVersion) === '2' ? 'RSA-SHA256'
    : String(msg.SignatureVersion) === '1' ? 'RSA-SHA1'
      : null
  if (!algo) return false
  const pem = await fetchCert(msg.SigningCertURL)
  const verifier = crypto.createVerify(algo)
  verifier.update(canonical, 'utf8')
  return verifier.verify(pem, msg.Signature, 'base64')
}

/** SNS posts as text/plain, which no JSON body parser touches, so the body may
 *  arrive already-parsed, as a string, or still on the wire. Handle all three. */
async function readMessage(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) return req.body
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body)
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    // SNS messages are small; anything larger is not a notification.
    if (total > 256 * 1024) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function registerSesNotify(router, { database, logger }) {
  const log = logger.child({ extension: 'kscw-ses-notify' })
  const pinnedTopic = (process.env.SES_SNS_TOPIC_ARN || '').trim()

  router.post('/ses/notify', async (req, res) => {
    try {
      const msg = await readMessage(req)

      if (pinnedTopic && msg.TopicArn !== pinnedTopic) {
        log.warn({ msg: `[ses-notify] rejected message from unexpected topic ${msg.TopicArn}` })
        return res.status(403).json({ error: 'Unexpected topic' })
      }

      if (!(await verifySnsMessage(msg))) {
        log.warn({ msg: '[ses-notify] SNS signature verification FAILED — message discarded' })
        return res.status(403).json({ error: 'Invalid signature' })
      }

      // Confirming the subscription is what makes SNS start delivering. It is
      // only ever done for a signature-verified message on the pinned topic.
      if (msg.Type === 'SubscriptionConfirmation') {
        if (!validCertUrl(msg.SigningCertURL)) return res.status(403).json({ error: 'Invalid signature' })
        const sub = new URL(String(msg.SubscribeURL))
        if (sub.protocol !== 'https:' || !/^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(sub.hostname)) {
          return res.status(403).json({ error: 'Invalid SubscribeURL' })
        }
        await fetch(sub.toString())
        log.info(`[ses-notify] SNS subscription confirmed for ${msg.TopicArn}`)
        return res.json({ success: true, confirmed: true })
      }

      if (msg.Type !== 'Notification') return res.json({ success: true, ignored: msg.Type })

      let event
      try { event = JSON.parse(msg.Message) } catch { return res.json({ success: true, ignored: 'unparseable' }) }

      const sesMessageId = event?.mail?.messageId || null
      let added = 0

      if (event.notificationType === 'Bounce' || event.eventType === 'Bounce') {
        const b = event.bounce || {}
        // ONLY permanent bounces suppress. A Transient bounce is a full mailbox
        // or a temporary server problem — suppressing on those would quietly
        // erode the club's own mailing list over time.
        if (b.bounceType === 'Permanent') {
          for (const r of b.bouncedRecipients || []) {
            if (await suppress(database, {
              email: r.emailAddress,
              reason: 'bounce',
              subtype: b.bounceSubType,
              detail: r.diagnosticCode || r.status || null,
              sesMessageId,
            })) added++
          }
        } else {
          log.info(`[ses-notify] transient bounce (${b.bounceSubType}) — not suppressed`)
        }
      } else if (event.notificationType === 'Complaint' || event.eventType === 'Complaint') {
        const c = event.complaint || {}
        // Complaints always suppress: someone pressed "this is spam", and the
        // complaint rate is the metric that actually costs a sender its identity.
        for (const r of c.complainedRecipients || []) {
          if (await suppress(database, {
            email: r.emailAddress,
            reason: 'complaint',
            subtype: c.complaintFeedbackType,
            detail: c.userAgent || null,
            sesMessageId,
          })) added++
        }
      } else {
        return res.json({ success: true, ignored: event.notificationType || event.eventType || 'unknown' })
      }

      if (added > 0) log.info(`[ses-notify] suppressed ${added} address(es)`)
      res.json({ success: true, suppressed: added })
    } catch (err) {
      log.error({ msg: `[ses-notify] ${err.message}`, endpoint: 'ses/notify', stack: err.stack })
      // 200 on our own internal failure: a non-2xx makes SNS retry, and retrying
      // will hit the same bug. The log is the signal, not the response code.
      res.json({ success: false })
    }
  })
}
