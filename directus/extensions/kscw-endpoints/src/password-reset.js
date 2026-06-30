/**
 * Localized password reset/account claim endpoint.
 *
 * POST /kscw/password-request
 * Body: { email: string }
 *
 * Looks up the member's language, generates a single-use, 1-hour reset token
 * (stored only as a SHA-256 hash in the `password_reset_tokens` table — never
 * in `directus_users.token`), and sends a branded email in the user's language.
 * The token is consumed (and its row deleted) by POST /kscw/set-password.
 */

import crypto from 'crypto'
import { FRONTEND_URL } from './email-template.js'

// Reset tokens live for 1 hour, are single-use, and are stored only as a
// SHA-256 hash in the dedicated `password_reset_tokens` table. The plaintext
// value exists solely inside the emailed link — it is NEVER written to
// `directus_users.token` (that column is Directus's static API access token,
// i.e. a full-privilege bearer credential), so a leaked link can only reset a
// password, never act as an API credential.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const TEMPLATES = {
  german: {
    subject: 'WiediSync – Passwort festlegen',
    heading: 'Passwort festlegen',
    body: 'Klicke auf den Button unten, um dein Passwort festzulegen und dein WiediSync-Konto zu aktivieren.',
    button: 'Passwort festlegen',
    expiry: 'Dieser Link ist 1 Stunde gültig und kann nur einmal verwendet werden.',
    ignore: 'Falls du diese Anfrage nicht gestellt hast, kannst du diese E-Mail ignorieren.',
    footer: 'KSC Wiedikon — Volleyball & Basketball seit 1972',
  },
  swiss_german: {
    subject: 'WiediSync – Passwort festlege',
    heading: 'Passwort festlege',
    body: 'Klick uf de Button unde, zum dis Passwort festzlege und dis WiediSync-Konto z aktiviere.',
    button: 'Passwort festlege',
    expiry: 'De Link isch 1 Stund gültig und cha nur einisch bruucht werde.',
    ignore: 'Falls du die Afrag nöd gmacht hesch, chasch die E-Mail ignoriere.',
    footer: 'KSC Wiedikon — Volleyball & Basketball sit 1972',
  },
  english: {
    subject: 'WiediSync – Set your password',
    heading: 'Set your password',
    body: 'Click the button below to set your password and activate your WiediSync account.',
    button: 'Set password',
    expiry: 'This link expires in 1 hour and can only be used once.',
    ignore: 'If you did not request this, you can safely ignore this email.',
    footer: 'KSC Wiedikon — Volleyball & Basketball since 1972',
  },
  french: {
    subject: 'WiediSync – Définir votre mot de passe',
    heading: 'Définir votre mot de passe',
    body: 'Cliquez sur le bouton ci-dessous pour définir votre mot de passe et activer votre compte WiediSync.',
    button: 'Définir le mot de passe',
    expiry: 'Ce lien expire dans 1 heure et ne peut être utilisé qu\'une seule fois.',
    ignore: 'Si vous n\'avez pas fait cette demande, vous pouvez ignorer cet e-mail.',
    footer: 'KSC Wiedikon — Volleyball & Basketball depuis 1972',
  },
  italian: {
    subject: 'WiediSync – Imposta la tua password',
    heading: 'Imposta la tua password',
    body: 'Clicca sul pulsante qui sotto per impostare la tua password e attivare il tuo account WiediSync.',
    button: 'Imposta password',
    expiry: 'Questo link scade tra 1 ora e può essere utilizzato una sola volta.',
    ignore: 'Se non hai effettuato questa richiesta, puoi ignorare questa e-mail.',
    footer: 'KSC Wiedikon — Pallavolo & Basket dal 1972',
  },
}

function buildHtml(t, url) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#1a1a2e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a2e;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#16213e;border-radius:12px;overflow:hidden">
  <tr><td style="background:linear-gradient(135deg,#4A55A2,#3a4592);padding:30px;text-align:center">
    <h1 style="color:#FFC832;margin:0;font-size:24px">WiediSync</h1>
    <p style="color:rgba(255,255,255,0.7);margin:5px 0 0;font-size:14px">KSC Wiedikon</p>
  </td></tr>
  <tr><td style="padding:40px 30px">
    <h2 style="color:#ffffff;margin:0 0 15px;font-size:20px">${t.heading}</h2>
    <p style="color:#b0b0c0;line-height:1.6;margin:0 0 25px">${t.body}</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 25px">
    <tr><td style="background:#FFC832;border-radius:8px;padding:14px 32px">
      <a href="${url}" style="color:#1a1a2e;text-decoration:none;font-weight:600;font-size:16px">${t.button}</a>
    </td></tr>
    </table>
    <p style="color:#808090;font-size:13px;line-height:1.5;margin:0">
      ${t.expiry}<br>${t.ignore}
    </p>
  </td></tr>
  <tr><td style="border-top:1px solid #2a2a4a;padding:20px 30px;text-align:center">
    <p style="color:#606070;font-size:12px;margin:0">${t.footer}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

export function registerPasswordReset(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'password-request' })

  // Rate limit: max 3 password reset requests per hour per IP
  const pwResetIp = new Map()

  router.post('/password-request', async (req, res) => {
    try {
      const { email } = req.body
      if (!email) return res.status(400).json({ error: 'Email required' })

      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
      const now = Date.now()
      const ipEntry = pwResetIp.get(ip)
      if (ipEntry && now < ipEntry.resetAt) {
        if (ipEntry.count >= 3) return res.status(204).end()
        ipEntry.count++
      } else {
        pwResetIp.set(ip, { count: 1, resetAt: now + 3600000 })
      }
      if (pwResetIp.size > 500) {
        for (const [k, v] of pwResetIp) { if (now > v.resetAt) pwResetIp.delete(k) }
      }

      const normalizedEmail = email.toLowerCase().trim()

      // Find directus user by their login email.
      let user = await database('directus_users')
        .where('email', normalizedEmail)
        .select('id', 'email')
        .first()

      // Fallback: the typed address may be a member's SECONDARY email
      // (members.vm_email / members.email — e.g. the ClubDesk address kept after
      // a duplicate merge). Resolve it to that member's actual login so people
      // can recover with either of their known emails. Reset link still goes to
      // the real login address only.
      if (!user) {
        const m = await database('members')
          .whereRaw('LOWER(vm_email) = ?', [normalizedEmail])
          .orWhereRaw('LOWER(email) = ?', [normalizedEmail])
          .whereNotNull('user')
          .select('user')
          .first()
        if (m?.user) {
          user = await database('directus_users')
            .where('id', m.user)
            .select('id', 'email')
            .first()
        }
      }

      // Always return 204 (don't reveal if email exists)
      if (!user) return res.status(204).end()

      // Find linked member for language
      const member = await database('members')
        .where('user', user.id)
        .select('language')
        .first()

      const lang = member?.language || 'german'
      const t = TEMPLATES[lang] || TEMPLATES.german

      const schema = await getSchema()
      const { MailService } = services

      // Generate a high-entropy single-use reset secret. It is NOT a Directus
      // API token: we store only its SHA-256 hash in `password_reset_tokens`
      // and never touch `directus_users.token`. The plaintext goes only into
      // the emailed link and is consumed (and the row deleted) by
      // POST /kscw/set-password.
      const token = crypto.randomBytes(32).toString('hex')
      const tokenHash = hashResetToken(token)
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString()

      // Invalidate any previous outstanding tokens for this user, then store
      // the new hash. Single active token per user keeps the flow single-use.
      await database('password_reset_tokens').where('user', user.id).delete()
      await database('password_reset_tokens').insert({
        user: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      })

      // Build reset URL pointing to frontend
      const resetUrl = `${FRONTEND_URL}/set-password?token=${token}`

      // Send localized email
      const mailService = new MailService({ schema, knex: database })
      await mailService.send({
        to: user.email,
        subject: t.subject,
        html: buildHtml(t, resetUrl),
      })

      log.info(`Password reset email sent to user ${user.id} (${lang})`)
      res.status(204).end()
    } catch (err) {
      log.error({
        msg: `password-request: ${err.message}`,
        endpoint: 'password-request',
        userId: null,
        method: req.method,
        stack: err.stack,
      })
      // Always 204 to not leak info
      res.status(204).end()
    }
  })
}
