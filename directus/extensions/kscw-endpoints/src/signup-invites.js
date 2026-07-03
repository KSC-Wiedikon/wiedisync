/**
 * One-time signup invite tokens (member-bound) — the ONLY way to create a
 * WiediSync account since open self-registration was closed (migration 167).
 *
 * POST /kscw/signup-invites/create   (auth: admin | vorstand | coach/TR of the
 *                                     member's team) — mint + email an invite
 *                                     for an existing account-less member
 * GET  /kscw/signup-invites/info/:token  (public) — greeting data for /signup
 * POST /kscw/signup-invites/redeem   (public) — set password, create + link the
 *                                     Directus user, single-use consume
 *
 * Tokens are bound to a members row, so account creation never depends on the
 * email the person types — closing the divergent-email duplicate window.
 * Storage discipline mirrors password_reset_tokens: SHA-256 hash only, one
 * active token per member, delete-before-use, 30-day TTL. The plaintext
 * travels exclusively inside the emailed link (never in API responses to
 * staff, so a coach can't hijack a member's invite).
 */

import crypto from 'crypto'
import { FRONTEND_URL, buildEmailLayout } from './email-template.js'
import { writeUserLog } from './activity-log.js'

export const SIGNUP_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days, matches shell_expires

export function hashSignupToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/**
 * Mint a fresh single-use signup token for a member. Deletes any previous
 * token for the same member (one active invite per person). Returns the
 * PLAINTEXT token — caller must put it in an email link and nowhere else.
 * Shared with kscw-hooks (registration approval + shell reminder cron).
 */
export async function mintSignupToken(database, memberId, { mintedBy = null, mintedVia = 'staff' } = {}) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SIGNUP_TOKEN_TTL_MS).toISOString()
  await database('signup_tokens').where('member', memberId).delete()
  await database('signup_tokens').insert({
    member: memberId,
    token_hash: hashSignupToken(token),
    minted_by: mintedBy,
    minted_via: mintedVia,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  })
  return { token, expiresAt }
}

export function signupInviteUrl(token) {
  return `${FRONTEND_URL}/signup?invite=${token}`
}

// Symmetric first-name-prefix match ("Dani" ↔ "Daniel" same person; "Anna" ↔
// "Luca" not). Missing data counts as a match. Mirrors the same helper in
// kscw-hooks (which imports from THIS module — the reverse import would be
// circular, so it is duplicated here rather than shared).
function firstNamesMatch(a, b) {
  const x = String(a || '').toLowerCase().trim()
  const y = String(b || '').toLowerCase().trim()
  if (!x || !y) return true
  return x === y || x.startsWith(y) || y.startsWith(x)
}

// ── Invite email (5 locales, keyed by members.language) ─────────────────────
// `steps` is a 3-item how-to guide rendered as a numbered list in the email so
// people know exactly what to do (per the club's onboarding request).
const INVITE_T = {
  german: {
    subject: 'WiediSync – Dein Konto wartet auf dich',
    title: 'Konto erstellen',
    subtitle: 'KSC Wiedikon',
    greeting: name => `Hallo ${name},`,
    body: 'Für dich wurde ein WiediSync-Zugang vorbereitet. So aktivierst du dein Konto:',
    steps: ['Klicke unten auf «Konto erstellen».', 'Wähle ein Passwort und bestätige es.', 'Fertig — du bist angemeldet und siehst Spielpläne, Trainings und Teaminfos.'],
    button: 'Konto erstellen',
    expiry: 'Dieser Link ist 30 Tage gültig und kann nur einmal verwendet werden.',
    ignore: 'Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.',
  },
  swiss_german: {
    subject: 'WiediSync – Dis Konto wartet uf di',
    title: 'Konto erstelle',
    subtitle: 'KSC Wiedikon',
    greeting: name => `Hallo ${name},`,
    body: 'Für di isch en WiediSync-Zuegang vorbereitet worde. So aktivisch dis Konto:',
    steps: ['Klick unde uf «Konto erstelle».', 'Wähl es Passwort und bestätig s.', 'Fertig — du bisch aagmäldet und gsehsch Spielplän, Trainings und Teaminfos.'],
    button: 'Konto erstelle',
    expiry: 'De Link isch 30 Täg gültig und cha nur einisch bruucht werde.',
    ignore: 'Falls du die Yladig nöd erwartet hesch, chasch die E-Mail ignoriere.',
  },
  english: {
    subject: 'WiediSync – Your account is ready',
    title: 'Create your account',
    subtitle: 'KSC Wiedikon',
    greeting: name => `Hello ${name},`,
    body: 'A WiediSync access has been prepared for you. Here is how to activate your account:',
    steps: ['Tap "Create account" below.', 'Choose a password and confirm it.', 'Done — you are logged in and can see schedules, trainings, and team info.'],
    button: 'Create account',
    expiry: 'This link is valid for 30 days and can only be used once.',
    ignore: 'If you were not expecting this invitation, you can safely ignore this email.',
  },
  french: {
    subject: 'WiediSync – Votre compte vous attend',
    title: 'Créer votre compte',
    subtitle: 'KSC Wiedikon',
    greeting: name => `Bonjour ${name},`,
    body: 'Un accès WiediSync a été préparé pour vous. Voici comment activer votre compte :',
    steps: ['Cliquez sur « Créer le compte » ci-dessous.', 'Choisissez un mot de passe et confirmez-le.', 'C\'est fait — vous êtes connecté et voyez les calendriers, entraînements et infos d\'équipe.'],
    button: 'Créer le compte',
    expiry: 'Ce lien est valable 30 jours et ne peut être utilisé qu\'une seule fois.',
    ignore: 'Si vous n\'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.',
  },
  italian: {
    subject: 'WiediSync – Il tuo account ti aspetta',
    title: 'Crea il tuo account',
    subtitle: 'KSC Wiedikon',
    greeting: name => `Ciao ${name},`,
    body: 'Un accesso WiediSync è stato preparato per te. Ecco come attivare il tuo account:',
    steps: ['Tocca «Crea account» qui sotto.', 'Scegli una password e confermala.', 'Fatto — hai eseguito l\'accesso e vedi calendari, allenamenti e info squadra.'],
    button: 'Crea account',
    expiry: 'Questo link è valido per 30 giorni e può essere utilizzato una sola volta.',
    ignore: 'Se non ti aspettavi questo invito, puoi ignorare questa e-mail.',
  },
}

// Render a numbered how-to guide as inline-styled HTML (email-safe: no <ol>
// list-style quirks across clients — explicit numbered rows instead).
export function buildGuideHtml(steps) {
  const rows = steps.map((s, i) => (
    `<tr>` +
    `<td style="vertical-align:top;padding:4px 10px 4px 0"><span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;background:#4A55A2;color:#fff;border-radius:11px;font-size:12px;font-weight:700">${i + 1}</span></td>` +
    `<td style="vertical-align:top;padding:4px 0;font-size:13px;color:#cbd5e1;line-height:1.5">${s}</td>` +
    `</tr>`
  )).join('')
  return `<table cellpadding="0" cellspacing="0" style="margin:14px 0">${rows}</table>`
}

/**
 * Send the branded invite email. Shared with kscw-hooks (shell reminder cron).
 */
export async function sendSignupInviteEmail(mailService, member, token) {
  const t = INVITE_T[member.language] || INVITE_T.german
  const html = buildEmailLayout(
    `<div style="font-size:13px;color:#94a3b8;line-height:1.7"><p style="text-align:justify">${t.body}</p>${buildGuideHtml(t.steps)}<p style="text-align:justify;color:#64748b;font-size:12px">${t.expiry}<br>${t.ignore}</p></div>`,
    {
      title: t.title,
      subtitle: t.subtitle,
      greeting: t.greeting(member.first_name || ''),
      ctaUrl: signupInviteUrl(token),
      ctaLabel: t.button,
    }
  )
  const textSteps = t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  await mailService.send({
    to: member.email,
    subject: t.subject,
    html,
    text: `${t.body}\n\n${textSteps}\n\n${signupInviteUrl(token)}\n\n${t.expiry}`,
  })
}

export function registerSignupInvites(router, { database, logger, services, getSchema }, { validatePassword }) {
  const log = logger.child({ endpoint: 'signup-invites' })

  // Tiny in-memory IP limiter (same shape as password-reset.js — inlined to
  // avoid a circular import with index.js).
  function ipLimit(map, req, max, windowMs) {
    // Behind the Cloudflare Tunnel the only trustworthy client IP is
    // cf-connecting-ip; X-Forwarded-For is attacker-spoofable (same precedence
    // as contact-form.js / password-reset.js after the 2026-07-02 #17 fix).
    const xff = req.headers?.['x-forwarded-for']
    const ip = req.headers?.['cf-connecting-ip']
      || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
      || req.ip || 'unknown'
    const now = Date.now()
    const entry = map.get(ip)
    if (entry && now < entry.resetAt) {
      if (entry.count >= max) return false
      entry.count++
    } else {
      map.set(ip, { count: 1, resetAt: now + windowMs })
    }
    if (map.size > 1000) {
      for (const [k, v] of map) { if (now > v.resetAt) map.delete(k) }
    }
    return true
  }

  // ── Mint + email an invite for an existing account-less member ────────────
  router.post('/signup-invites/create', async (req, res) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' })
      }
      const { member_id, registration_id } = req.body || {}

      // Resolve the target member: directly by id, or via an approved
      // registration's email (AnmeldungenPage "resend invite").
      let target = null
      if (member_id) {
        target = await database('members').where('id', member_id).first()
      } else if (registration_id) {
        const reg = await database('registrations').where('id', registration_id).first('email', 'status', 'vorname')
        if (!reg) return res.status(404).json({ error: 'Registration not found' })
        if (reg.status !== 'approved') {
          return res.status(400).json({ error: 'Registration is not approved', code: 'not_approved' })
        }
        // Match on email AND first name — a family shares one email, so email
        // alone could bind the invite to the parent instead of the registrant.
        const emailRows = await database('members')
          .whereRaw('LOWER(email) = ?', [String(reg.email || '').toLowerCase().trim()])
        target = emailRows.find(r => firstNamesMatch(r.first_name, reg.vorname)) || null
      } else {
        return res.status(400).json({ error: 'member_id or registration_id required' })
      }
      if (!target) return res.status(404).json({ error: 'Member not found' })
      if (target.user) {
        return res.status(400).json({ error: 'Member already has an account', code: 'already_claimed' })
      }
      if (!target.email || !target.email.trim()) {
        return res.status(400).json({ error: 'Member has no email address', code: 'no_email' })
      }

      // Permission: Directus admin, app-role admin/superuser/vorstand, or
      // coach/TR of one of the target's teams.
      const actor = await database('members')
        .where('user', req.accountability.user)
        .first('id', 'role', 'first_name', 'last_name')
      let allowed = req.accountability.admin === true
      if (!allowed && actor) {
        const roles = Array.isArray(actor.role) ? actor.role
          : (() => { try { return JSON.parse(actor.role || '[]') } catch { return [] } })()
        allowed = roles.includes('admin') || roles.includes('superuser') || roles.includes('vorstand')
      }
      if (!allowed && actor) {
        const targetTeams = (await database('member_teams')
          .where('member', target.id).pluck('team')).filter(Boolean)
        if (target.requested_team) targetTeams.push(target.requested_team)
        if (targetTeams.length) {
          const isCoach = await database('teams_coaches')
            .whereIn('teams_id', targetTeams).where('members_id', actor.id).first()
          const isTR = await database('teams_responsibles')
            .whereIn('teams_id', targetTeams).where('members_id', actor.id).first()
          allowed = !!isCoach || !!isTR
        }
      }
      if (!allowed) return res.status(403).json({ error: 'Not authorized' })

      const { token, expiresAt } = await mintSignupToken(database, target.id, {
        mintedBy: actor?.id ?? null,
        mintedVia: 'staff',
      })

      const schema = await getSchema()
      const { MailService } = services
      const mailService = new MailService({ schema, knex: database })
      await sendSignupInviteEmail(mailService, target, token)

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'create',
        collection: 'signup_tokens',
        recordId: target.id,
        data: { member: target.id, email: target.email, expires_at: expiresAt },
      })

      log.info(`Signup invite minted for member ${target.id} by member ${actor?.id ?? 'admin'}`)
      // Return the invite URL so staff can ALSO show it as a QR code / copy
      // link in person (the member additionally receives it by email). This
      // exposes the token to the minting staff member — acceptable because the
      // minter is already an admin / vorstand / the member's own coach or TR
      // (trusted, and the mint is writeUserLog'd above), mirroring the existing
      // team-invite QR flow. See SECURITY.md 2026-07-03.
      res.json({
        success: true,
        email: target.email,
        expires_at: expiresAt,
        invite_url: signupInviteUrl(token),
        member_name: [target.first_name, target.last_name].filter(Boolean).join(' '),
      })
    } catch (err) {
      log.error({ msg: `signup-invites/create: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Public: greeting data for the /signup?invite= page ────────────────────
  const infoIp = new Map()
  router.get('/signup-invites/info/:token', async (req, res) => {
    try {
      if (!ipLimit(infoIp, req, 20, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests' })
      }
      const row = await database('signup_tokens')
        .where('token_hash', hashSignupToken(String(req.params.token || '')))
        .first()
      if (!row || (row.expires_at && new Date() > new Date(row.expires_at))) {
        return res.status(404).json({ error: 'Invalid or expired invite', code: 'invalid_token' })
      }
      const member = await database('members')
        .where('id', row.member).first('first_name', 'email', 'user')
      if (!member || member.user) {
        return res.status(404).json({ error: 'Invalid or expired invite', code: 'invalid_token' })
      }
      res.json({ first_name: member.first_name, email: member.email, expires_at: row.expires_at })
    } catch (err) {
      log.error({ msg: `signup-invites/info: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // ── Public: redeem — set password, create + link the Directus user ────────
  const redeemIp = new Map()
  router.post('/signup-invites/redeem', async (req, res) => {
    try {
      if (!ipLimit(redeemIp, req, 5, 15 * 60 * 1000)) {
        return res.status(429).json({ error: 'Too many requests' })
      }
      const { token, password, language } = req.body || {}
      if (!token) return res.status(400).json({ error: 'token required' })
      const pwError = validatePassword(password)
      if (pwError) return res.status(400).json({ error: pwError })

      const row = await database('signup_tokens')
        .where('token_hash', hashSignupToken(String(token)))
        .first()
      if (!row) {
        return res.status(400).json({ error: 'Invalid or expired invite', code: 'invalid_token' })
      }
      // Single-use: delete up-front so the link can't be replayed even if a
      // later step fails (password_reset_tokens discipline).
      await database('signup_tokens').where('id', row.id).delete()
      if (row.expires_at && new Date() > new Date(row.expires_at)) {
        return res.status(400).json({ error: 'Invalid or expired invite', code: 'invalid_token' })
      }

      const member = await database('members').where('id', row.member).first()
      if (!member) return res.status(400).json({ error: 'Invalid or expired invite', code: 'invalid_token' })
      if (member.user) {
        return res.status(400).json({ error: 'Account already exists', code: 'already_claimed' })
      }
      const email = String(member.email || '').toLowerCase().trim()
      if (!email) return res.status(400).json({ error: 'Member has no email address', code: 'no_email' })

      const schema = await getSchema()
      const { UsersService } = services
      const adminUsersService = new UsersService({ schema, knex: database, accountability: { admin: true } })

      // Link an orphan directus_user with the same email if one exists;
      // otherwise create a fresh user WITH the Member role (the /set-password
      // mode-3 bug shipped a role-less account once — never again).
      // CRITICAL: "orphan" means NO member row references this user. A
      // same-email user that ANOTHER member already owns is a family member's
      // live account (shared inbox) — adopting it would overwrite their
      // password and hand the redeemer their (possibly elevated) login. Only
      // a truly unlinked user is claimable; otherwise the redeemer needs a
      // personal email.
      const sameEmailUser = await database('directus_users')
        .whereRaw('LOWER(directus_users.email) = ?', [email])
        .whereNotExists(function () {
          this.select(database.raw('1')).from('members').whereRaw('members."user" = directus_users.id')
        })
        .first('id')
      const someoneElseHasIt = await database('directus_users')
        .whereRaw('LOWER(email) = ?', [email]).first('id')
      let userId
      if (sameEmailUser) {
        userId = sameEmailUser.id
        await adminUsersService.updateOne(userId, { password })
      } else if (someoneElseHasIt) {
        // A same-email login exists but belongs to another member.
        return res.status(400).json({
          error: 'This email already has an account — each account needs its own email address. Ask an admin to set a personal email for you first.',
          code: 'email_in_use',
        })
      } else {
        const memberRole = await database('directus_roles').where('name', 'Member').first()
        if (!memberRole) throw new Error('Member role not found in directus_roles')
        try {
          userId = await adminUsersService.createOne({
            email,
            password,
            first_name: member.first_name || '',
            last_name: member.last_name || '',
            role: memberRole.id,
          })
        } catch (createErr) {
          // Family shared-email case: two members can share an address, but
          // directus_users.email is unique — the second person needs their own
          // email before they can activate a login.
          const msg = String(createErr?.message || '')
          if (msg.includes('has to be unique') || msg.toLowerCase().includes('unique')) {
            return res.status(400).json({
              error: 'This email already has an account — each account needs its own email address. Ask an admin to set a personal email for you first.',
              code: 'email_in_use',
            })
          }
          throw createErr
        }
      }

      // Link + activate. Normalise stored email casing; wiedisync_active=true
      // fires the shell→full PG trigger for registration-born shells.
      const updates = { user: userId, wiedisync_active: true }
      if (member.email !== email) updates.email = email
      if (language && ['german', 'swiss_german', 'english', 'french', 'italian'].includes(language)) {
        updates.language = language
      }
      await database('members').where('id', member.id).update(updates)

      await writeUserLog(database, log, {
        accountability: { user: userId },
        action: 'create',
        collection: 'directus_users',
        recordId: member.id,
        data: { via: 'signup_invite', minted_via: row.minted_via },
      })

      log.info(`Signup invite redeemed: member ${member.id} → user ${userId} (via ${row.minted_via})`)
      res.json({ success: true, member_id: String(member.id), email })
    } catch (err) {
      log.error({ msg: `signup-invites/redeem: ${err.message}`, stack: err.stack })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
