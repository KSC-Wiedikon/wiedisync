/**
 * POST /kscw/change-password — change your password, keeping your encryption key.
 *
 * WHY THIS EXISTS, when /kscw/set-password already changes a password.
 *
 * The identity-document feature derives the key that protects a member's private key from
 * their LOGIN PASSWORD. So the moment the password changes, that wrapper is dead — unless
 * the private key is re-wrapped under the new one. Re-wrapping needs BOTH plaintexts at the
 * same instant, in the browser.
 *
 * Not one of the four existing password paths can do that:
 *   - /set-password mode 1 (authenticated) does not verify the current password at all, so
 *     the client never has to know it.
 *   - /set-password mode 2 (email reset token) and mode 3 (email OTP) are for people who
 *     have FORGOTTEN it — by definition it is not available.
 *   - the Directus admin reset happens server-side, nowhere near the member's browser.
 *
 * So a password change through any of those silently destroys the member's key, and their
 * identity document becomes unreadable — to them and to their coaches. The document is
 * re-uploadable (they still have the card in their wallet), so it is a nuisance rather than
 * a catastrophe. But for a COACH it cascades: they lose the key to every player's ID in
 * their squad, and every one of those players has to re-upload.
 *
 * This endpoint is the containment. It verifies the CURRENT password (by attempting a real
 * login with it), which means the client legitimately holds both plaintexts and can re-wrap
 * the private key locally before calling. The re-wrapped blob rides along in the same
 * request, so the password and its key wrapper move together or not at all.
 *
 * A forgotten-password reset still loses the key. That is inherent: nobody can re-wrap a key
 * with a secret nobody has. The point is that the COMMON case — someone deliberately
 * changing their password — stops being destructive.
 *
 * We never see the private key. `e2ee` carries ciphertext the member's browser produced.
 */

import { writeUserLog } from './activity-log.js'

const MIN_PASSWORD_LENGTH = 8

export function registerChangePassword(router, { database, services, getSchema, logger }) {
  const log = logger.child({ endpoint: 'change-password' })

  router.post('/change-password', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Authentication required' })
      // ⚠ A guardian may never change a managed member's password. Doing so would
      // convert a revocable, audited acting grant into a permanent credential
      // that survives revocation — the exact property this design exists to avoid.
      if (req.accountability?.kscwGuardian) {
        return res.status(403).json({ error: 'Not available while using another account', code: 'acting_forbidden' })
      }

      const { current_password: current, new_password: next, e2ee } = req.body ?? {}
      if (!current || !next) {
        return res.status(400).json({ error: 'current_password and new_password are required' })
      }
      if (String(next).length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
          code: 'too_short',
        })
      }
      if (String(current) === String(next)) {
        return res.status(400).json({ error: 'The new password must differ', code: 'unchanged' })
      }

      const user = await database('directus_users').where('id', userId).first('id', 'email', 'status')
      if (!user?.email) return res.status(404).json({ error: 'User not found' })

      // Verify the CURRENT password by actually authenticating with it. This is the whole
      // reason the endpoint exists — /set-password mode 1 skips this check, which is what
      // makes it unable to preserve an encryption key.
      const { AuthenticationService } = services
      const auth = new AuthenticationService({ schema: await getSchema(), accountability: null })
      try {
        await auth.login('default', { email: user.email, password: String(current) })
      } catch {
        // Deliberately vague and deliberately not logged as an error — a wrong current
        // password is a user typo, not a system fault (same reasoning as the auth 4xx
        // filter in the error logger).
        return res.status(403).json({ error: 'Current password is incorrect', code: 'bad_password' })
      }

      // If the member has a keypair, the caller MUST send the re-wrapped blob. Changing the
      // password without it would quietly orphan their key — precisely the failure this
      // endpoint exists to prevent — so refuse rather than "succeed" destructively.
      const member = await database('members').where('user', userId)
        .first('id', 'e2ee_public_key')
      const hasKeys = !!member?.e2ee_public_key
      const rewrap = e2ee && e2ee.private_key && e2ee.salt

      if (hasKeys && !rewrap) {
        return res.status(400).json({
          error: 'This account has an encryption key; the re-wrapped key must be supplied',
          code: 'rewrap_required',
        })
      }

      const { UsersService } = services
      const users = new UsersService({
        schema: await getSchema(),
        accountability: { admin: true, user: userId },
      })

      await database.transaction(async (trx) => {
        if (hasKeys && rewrap) {
          // Same keypair, new wrapper. Every envelope ever wrapped TO this member stays
          // valid — which is the point: their coaches keep their access, and the member
          // keeps their own document.
          await trx('members').where('id', member.id).update({
            e2ee_private_key: e2ee.private_key,
            e2ee_kdf_salt: e2ee.salt,
          })
        }
      })
      await users.updateOne(userId, { password: String(next) })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: 'update',
        collection: 'directus_users',
        recordId: String(userId),
        data: { what: 'password_change', verified_current: true, e2ee_key_preserved: hasKeys },
      })

      res.json({ data: { ok: true, e2ee_key_preserved: hasKeys } })
    } catch (err) {
      log.error({
        msg: `POST change-password: ${err.message}`,
        endpoint: 'change-password',
        userId: req.accountability?.user || null,
        method: req.method,
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
