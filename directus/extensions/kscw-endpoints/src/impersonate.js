/**
 * Superadmin read-only impersonation audit trail.
 * POST /kscw/admin/impersonate  { action: 'start' | 'stop', target: <memberId>, target_name? }
 *
 * The "View as member" feature is entirely client-side and READ-ONLY (the app
 * blocks every write while it's active), so this endpoint does NOT mint a token
 * or change auth in any way — it ONLY records who viewed whom, into `user_logs`,
 * so the superadmin audit page (`/admin/audit-log`) shows every start/stop.
 * Gated to the 'superuser' member role (Directus admins bypass the role check).
 */

import { writeUserLog } from './activity-log.js'

function callerRoles(row) {
  if (!row) return []
  if (Array.isArray(row.role)) return row.role
  try { return JSON.parse(row.role || '[]') } catch { return [] }
}

export function registerImpersonate(router, { database, logger }) {
  const log = logger.child({ endpoint: 'impersonate' })

  router.post('/admin/impersonate', async (req, res) => {
    try {
      const isAdmin = req.accountability?.admin === true
      const userId = req.accountability?.user
      if (!userId && !isAdmin) {
        return res.status(401).json({ error: 'Authentication required' })
      }

      // Gate: caller must be a superuser member (or a Directus admin).
      if (!isAdmin) {
        const caller = userId ? await database('members').where('user', userId).first('role') : null
        if (!callerRoles(caller).includes('superuser')) {
          return res.status(403).json({ error: 'Superadmin only', code: 'not_superadmin' })
        }
      }

      const action = req.body?.action === 'stop' ? 'stop' : 'start'
      const target = req.body?.target != null ? String(req.body.target) : null
      if (!target) return res.status(400).json({ error: 'target required' })

      await writeUserLog(database, log, {
        accountability: req.accountability,
        action: action === 'stop' ? 'impersonate_stop' : 'impersonate_start',
        collection: 'members',
        recordId: target,
        data: { target, target_name: req.body?.target_name ?? null, mode: 'read_only_view_as' },
      })

      res.json({ data: { ok: true } })
    } catch (err) {
      log.error({
        msg: `admin/impersonate: ${err.message}`,
        endpoint: 'admin/impersonate',
        userId: req.accountability?.user || null,
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
