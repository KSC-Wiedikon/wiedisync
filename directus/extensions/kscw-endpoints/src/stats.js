/**
 * Club statistics endpoints — query Postgres VIEWs for dashboard data
 *
 * Views defined in: directus/scripts/003-stat-views.sql
 *
 * Endpoints (all require admin/superuser role):
 *   GET /kscw/stats/overview          — single-row club summary
 *   GET /kscw/stats/members           — member/licence/role counts
 *   GET /kscw/stats/team-roster       — per-team roster size & leadership
 *   GET /kscw/stats/schreiber         — per-team schreiber coverage
 *   GET /kscw/stats/missing-schreiber — upcoming games missing duties
 *   GET /kscw/stats/participation     — per-team RSVP rates (90 days)
 *   GET /kscw/stats/results           — per-team W/L by season
 *   GET /kscw/stats/delegations       — scorer delegation activity
 *   GET /kscw/stats/all               — everything in one call
 */

import { callerSportScope, parseRoles } from './sport-scope.js'

/**
 * Confine a per-team stats view (every one carries `teams.sport`) to one section.
 * A row whose team has no sport is club-level ('both') and stays visible to
 * either section, as member-sport.js has it.
 */
export function scopeStatsQuery(query, sportScope) {
  return query.where((q) => q.where('sport', sportScope).orWhereNull('sport'))
}

export function registerStats(router, { database, getSchema, services, logger }) {

  // Auth middleware: require admin or sport-admin role
  async function requireAdmin(req, res, next) {
    if (!req.accountability?.user) {
      return res.status(401).json({ error: 'Authentication required' })
    }
    try {
      // Check Directus role first (Administrator = full access)
      if (req.accountability.admin === true) {
        req.kscwSportScope = null
        return next()
      }

      // Check app-level roles in members table
      const member = await database('members')
        .where({ user: req.accountability.user })
        .first()

      const memberRoles = parseRoles(member?.role)
      const isAdmin = memberRoles.includes('admin')
        || memberRoles.includes('superuser')
        || memberRoles.includes('vb_admin')
        || memberRoles.includes('bb_admin')

      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' })
      // A sport-confined admin (M7, 2026-10-12) gets the per-team views of their
      // own section only. The two single-row club summaries stay club-wide: they
      // are counts, with no team, game or member behind any one number.
      req.kscwSportScope = callerSportScope(memberRoles)
      next()
    } catch (err) {
      logger.error('Stats auth check failed:', err.message)
      return res.status(500).json({ error: 'Auth check failed' })
    }
  }

  async function queryView(viewName, filters = {}, sportScope = null) {
    let query = database(viewName)
    if (sportScope) query = scopeStatsQuery(query, sportScope)
    if (filters.sport) query = query.where('sport', filters.sport)
    if (filters.season) query = query.where('season', filters.season)
    if (filters.team_id) query = query.where('team_id', filters.team_id)
    return query.select('*')
  }

  router.get('/stats/overview', requireAdmin, async (req, res) => {
    try {
      const rows = await database('stats_club_overview').select('*')
      res.json({ data: rows[0] || {} })
    } catch (err) {
      logger.error('Stats overview error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/stats/members', requireAdmin, async (req, res) => {
    try {
      const rows = await database('stats_members').select('*')
      res.json({ data: rows[0] || {} })
    } catch (err) {
      logger.error('Stats members error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/stats/team-roster', requireAdmin, async (req, res) => {
    try {
      const rows = await queryView('stats_team_roster', req.query, req.kscwSportScope)
      res.json({ data: rows })
    } catch (err) {
      logger.error('Stats team-roster error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/stats/schreiber', requireAdmin, async (req, res) => {
    try {
      const rows = await queryView('stats_schreiber_coverage', req.query, req.kscwSportScope)
      res.json({ data: rows })
    } catch (err) {
      logger.error('Stats schreiber error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/stats/missing-schreiber', requireAdmin, async (req, res) => {
    try {
      const rows = await queryView('stats_games_missing_schreiber', req.query, req.kscwSportScope)
      res.json({ data: rows })
    } catch (err) {
      logger.error('Stats missing-schreiber error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/stats/participation', requireAdmin, async (req, res) => {
    try {
      const rows = await queryView('stats_participation', req.query, req.kscwSportScope)
      res.json({ data: rows })
    } catch (err) {
      logger.error('Stats participation error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/stats/results', requireAdmin, async (req, res) => {
    try {
      const rows = await queryView('stats_game_results', req.query, req.kscwSportScope)
      res.json({ data: rows })
    } catch (err) {
      logger.error('Stats results error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/stats/delegations', requireAdmin, async (req, res) => {
    try {
      const rows = await queryView('stats_delegations', req.query, req.kscwSportScope)
      res.json({ data: rows })
    } catch (err) {
      logger.error('Stats delegations error:', err.message)
      res.status(500).json({ error: err.message })
    }
  })

  // All stats in one call (for dashboard)
  router.get('/stats/all', requireAdmin, async (req, res) => {
    try {
      const [overview, members, roster, schreiber, missing, participation, results, delegations] = await Promise.all([
        database('stats_club_overview').select('*').then(r => r[0] || {}),
        database('stats_members').select('*').then(r => r[0] || {}),
        queryView('stats_team_roster', req.query, req.kscwSportScope),
        queryView('stats_schreiber_coverage', req.query, req.kscwSportScope),
        queryView('stats_games_missing_schreiber', req.query, req.kscwSportScope),
        queryView('stats_participation', req.query, req.kscwSportScope),
        queryView('stats_game_results', req.query, req.kscwSportScope),
        queryView('stats_delegations', req.query, req.kscwSportScope),
      ])
      res.json({ data: { overview, members, roster, schreiber, missing, participation, results, delegations } })
    } catch (err) {
      logger.error('Stats all error:', err.message || err)
      res.status(500).json({ error: err.message || 'Internal error' })
    }
  })
}
