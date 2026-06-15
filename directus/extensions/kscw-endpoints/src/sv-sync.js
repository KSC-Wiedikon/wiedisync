/**
 * Swiss Volley Sync — ported from sv_sync_lib.js
 *
 * Fetches games and rankings from the Swiss Volley API
 * and upserts into Directus via knex.
 */

import { sweepGameAutoConfirm } from './game-auto-confirm-sweep.js'

const SV_API_BASE = 'https://api.volleyball.ch'
const SV_API_KEY = process.env.SV_API_KEY
if (!SV_API_KEY) throw new Error('SV_API_KEY environment variable is required')

const SV_TEAM_IDS = {
  '12747': 'H3', '2743': 'H1', '541': 'H2',
  '1395': 'D1', '1393': 'D2', '4689': 'D3', '1394': 'D4',
  '7563': 'HU23-1', '2301': 'DU23-1', '14040': 'DU23-2',
  '6023': 'Legends',
}

function isKscwTeamId(id) {
  return SV_TEAM_IDS.hasOwnProperty(String(id))
}

function deriveSeason(dateStr) {
  const d = new Date(dateStr)
  const year = d.getFullYear()
  const month = d.getMonth()
  return month < 8
    ? `${year - 1}/${String(year).slice(2)}`
    : `${year}/${String(year + 1).slice(2)}`
}

function parsePlayDate(playDate) {
  const parts = playDate.split(' ')
  return { date: parts[0] || '', time: parts[1] ? parts[1].slice(0, 5) : '' }
}

function mapSetResults(setResults) {
  if (!setResults) return []
  if (Array.isArray(setResults)) {
    return setResults.map(s => ({ home: s.home || s.Home || 0, away: s.away || s.Away || 0 }))
  }
  if (typeof setResults === 'object') {
    return Object.keys(setResults).sort().map(k => {
      const s = setResults[k]
      return { home: s?.home || s?.Home || 0, away: s?.away || s?.Away || 0 }
    })
  }
  return []
}

function mapReferees(refs) {
  if (!refs || typeof refs !== 'object') return []
  return Object.keys(refs).sort()
    .map(k => refs[k])
    .filter(r => r?.firstName || r?.lastName)
    .map(r => ({
      name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      id: r.refereeId || null,
    }))
}

export async function syncSvGames(db, log) {
  log.info('[SV Sync] Fetching games...')

  const res = await fetch(`${SV_API_BASE}/indoor/games`, {
    headers: { Authorization: SV_API_KEY },
  })
  if (!res.ok) { log.error(`[SV Sync] Games API: ${res.status}`); return { created: 0, updated: 0, errors: 0 } }

  const allGames = await res.json()
  if (!Array.isArray(allGames)) { log.error('[SV Sync] Unexpected format'); return { created: 0, updated: 0, errors: 0 } }

  const kscwGames = allGames.filter(g => {
    const hId = String(g.teams.home.teamId)
    const aId = String(g.teams.away.teamId)
    return isKscwTeamId(hId) || isKscwTeamId(aId)
  })
  log.info(`[SV Sync] ${kscwGames.length} KSCW games / ${allGames.length} total`)

  // Build lookups
  // active=true so the lookup resolves to the current season's team — after a
  // season rollover the same team_id exists on both the new (active) and the
  // archived (inactive) team, and an unfiltered map would non-deterministically
  // mislink games to the archived row.
  const teamRows = await db('teams').where('active', true).whereNot('team_id', '').select('id', 'team_id', 'features_enabled')
  const teamLookup = Object.fromEntries(teamRows.map(t => [t.team_id, t]))
  const hallRows = await db('halls').whereNot('sv_hall_id', '').select('id', 'sv_hall_id')
  const hallLookup = Object.fromEntries(hallRows.map(h => [h.sv_hall_id, h.id]))

  // Batch-fetch all existing SV games into a Map (1 query instead of N)
  const existingRows = await db('games').where('source', 'swiss_volley')
    .select('id', 'game_id', 'date', 'time', 'status', 'home_score', 'away_score',
      'home_team', 'away_team', 'hall', 'away_hall_json', 'league', 'round',
      'sets_json', 'referees_json', 'respond_by', 'kscw_team')
  const existingMap = new Map(existingRows.map(r => [r.game_id, r]))

  // Schedule ownership: a game scheduled through the Terminplanung tool (a
  // confirmed booking, mirrored into `games` by reconcileBookingsToGames) carries
  // its AGREED date/time/venue. The national feed often still serves such a
  // fixture at the league's unscheduled placeholder date until the opponent enters
  // it in VM (especially our AWAY games, which the opponent owns) — so syncing it
  // blindly would clobber the agreed date back to the placeholder. Treat the
  // booking as authoritative for date/time/venue until the game is actually played
  // (completed); scores, status and everything else still sync normally.
  const bookedRows = await db('game_scheduling_bookings as b')
    .join('svrz_games as s', 's.svrz_persistence_id', 'b.svrz_game_id')
    .where('b.status', 'confirmed')
    .whereNotNull('s.svrz_number')
    .distinct('s.svrz_number')
  const toolScheduledIds = new Set(bookedRows.map(r => `vb_${r.svrz_number}`))

  // Fields to compare — if all match, skip the update
  const COMPARE_FIELDS = [
    'date', 'time', 'status', 'home_score', 'away_score',
    'home_team', 'away_team', 'hall', 'away_hall_json',
    'league', 'round', 'sets_json', 'referees_json',
    // kscw_team: so an unchanged fixture re-points to the active team after a
    // season rollover (the team lookup is active-only) instead of staying
    // pinned to the now-archived team and vanishing from team-scoped views.
    'kscw_team',
  ]

  let created = 0, updated = 0, skipped = 0, errors = 0

  for (const g of kscwGames) {
    try {
      const gameId = String(g.gameId)
      const home = g.teams.home
      const away = g.teams.away
      if (!away.caption?.trim()) { errors++; continue }

      const parsed = parsePlayDate(g.playDate)
      const rs = g.resultSummary || {}
      const isHome = isKscwTeamId(String(home.teamId))
      const kscwSvId = isHome ? String(home.teamId) : String(away.teamId)
      const kscwTeam = teamLookup[`vb_${kscwSvId}`]
      const kscwTeamId = kscwTeam?.id || null

      let hallId = null, awayHallJson = null
      if (g.hall?.hallId) {
        if (isHome) {
          hallId = hallLookup[String(g.hall.hallId)] || null
        } else {
          awayHallJson = {
            name: g.hall.caption || '',
            address: `${g.hall.street || ''} ${g.hall.number || ''}`.trim(),
            city: g.hall.city || '',
            plus_code: g.hall.plusCode || '',
          }
        }
      }

      const data = {
        game_id: `vb_${gameId}`,
        home_team: home.caption || '',
        away_team: away.caption || '',
        kscw_team: kscwTeamId,
        hall: hallId,
        away_hall_json: awayHallJson ? JSON.stringify(awayHallJson) : null,
        date: parsed.date,
        time: parsed.time,
        league: g.group?.caption || g.phase?.caption || g.league?.caption || '',
        round: g.group?.caption || '',
        season: deriveSeason(g.playDate),
        type: isHome ? 'home' : 'away',
        status: rs.winner ? 'completed' : 'scheduled',
        home_score: rs.wonSetsHomeTeam || 0,
        away_score: rs.wonSetsAwayTeam || 0,
        sets_json: JSON.stringify(mapSetResults(g.setResults)),
        referees_json: JSON.stringify(mapReferees(g.referees)),
        source: 'swiss_volley',
      }

      const existing = existingMap.get(`vb_${gameId}`)
      if (existing) {
        // Tool-scheduled & not yet played → keep the agreed date/time/venue; don't
        // let a feed placeholder overwrite it (a real reschedule reaches these via
        // the tool). Scores/status/teams/etc. below still sync.
        if (toolScheduledIds.has(`vb_${gameId}`) && existing.status !== 'completed' && data.status !== 'completed') {
          data.date = existing.date
          data.time = existing.time
          data.hall = existing.hall
          data.away_hall_json = existing.away_hall_json
        }
        // Skip if nothing meaningful changed — avoids trigger-based notification spam
        const changed = COMPARE_FIELDS.some(f =>
          String(data[f] ?? '') !== String(existing[f] ?? '')
        )
        if (!changed) { skipped++; continue }
        // Adjust respond_by if date changed (data.date, not the raw feed date, so a
        // protected tool game whose date we kept doesn't shift its respond_by).
        if (existing.respond_by && existing.date && existing.date !== data.date) {
          const offset = new Date(existing.date).getTime() - new Date(existing.respond_by).getTime()
          const newRb = new Date(new Date(data.date).getTime() - offset)
          data.respond_by = newRb.toISOString().split('T')[0]
        }
        await db('games').where('id', existing.id).update({ ...data, date_updated: new Date() })
        updated++
      } else {
        // Apply respond_by default on creation
        if (kscwTeam?.features_enabled) {
          const fe = typeof kscwTeam.features_enabled === 'string'
            ? JSON.parse(kscwTeam.features_enabled) : kscwTeam.features_enabled
          const days = fe?.game_respond_by_days
          if (days > 0 && parsed.date) {
            const rb = new Date(new Date(parsed.date).getTime() - days * 86400000)
            data.respond_by = rb.toISOString().split('T')[0]
          }
        }
        await db('games').insert({ ...data, date_created: new Date(), date_updated: new Date() })
        created++
      }
    } catch (e) {
      errors++
      log.warn(`[SV Sync] Game error: ${e.message}`)
    }
  }

  log.info(`[SV Sync] Games: ${created} created, ${updated} updated, ${skipped} unchanged, ${errors} errors`)
  if (created > 0) await sweepGameAutoConfirm(db, log)
  return { created, updated, skipped, errors }
}

export async function syncSvRankings(db, log) {
  log.info('[SV Sync] Fetching rankings...')

  const res = await fetch(`${SV_API_BASE}/indoor/ranking`, {
    headers: { Authorization: SV_API_KEY },
  })
  if (!res.ok) { log.error(`[SV Sync] Rankings API: ${res.status}`); return { created: 0, updated: 0, errors: 0 } }

  const allGroups = await res.json()
  if (!Array.isArray(allGroups)) return { created: 0, updated: 0, errors: 0 }

  // Build caption lookups from games endpoint
  const gamesRes = await fetch(`${SV_API_BASE}/indoor/games`, {
    headers: { Authorization: SV_API_KEY },
  })
  const captions = { groups: {}, leagues: {}, phases: {} }
  if (gamesRes.ok) {
    const gamesData = await gamesRes.json()
    if (Array.isArray(gamesData)) {
      for (const g of gamesData) {
        if (g.league?.leagueId) captions.leagues[g.league.leagueId] = g.league.caption || ''
        if (g.phase?.phaseId) captions.phases[g.phase.phaseId] = g.phase.caption || ''
        if (g.group?.groupId) captions.groups[g.group.groupId] = g.group.caption || ''
      }
    }
  }

  const relevantGroups = allGroups.filter(grp =>
    (grp.ranking || []).some(r => isKscwTeamId(String(r.teamId || '')))
  )
  log.info(`[SV Sync] ${relevantGroups.length} relevant ranking groups / ${allGroups.length} total`)

  const now = new Date()
  const yr = now.getFullYear()
  const mo = now.getMonth()
  const season = mo < 8 ? `${yr - 1}/${String(yr).slice(2)}` : `${yr}/${String(yr + 1).slice(2)}`
  const nowStr = now.toISOString()

  let created = 0, updated = 0, errors = 0

  for (const grp of relevantGroups) {
    const leagueStr = captions.groups[grp.groupId] || captions.phases[grp.phaseId] ||
      captions.leagues[grp.leagueId] || `Group ${grp.groupId}`

    for (const r of (grp.ranking || [])) {
      try {
        const teamId = `vb_${r.teamId || ''}`
        const data = {
          team_id: teamId,
          team_name: r.teamCaption || '',
          league: leagueStr,
          rank: r.rank || 0,
          played: r.games || 0,
          won: r.wins || 0,
          lost: r.defeats || 0,
          wins_clear: r.winsClear || 0,
          wins_narrow: r.winsNarrow || 0,
          defeats_clear: r.defeatsClear || 0,
          defeats_narrow: r.defeatsNarrow || 0,
          sets_won: r.setsWon || 0,
          sets_lost: r.setsLost || 0,
          points_won: r.ballsWon || 0,
          points_lost: r.ballsLost || 0,
          points: r.points || 0,
          season,
          updated_at: nowStr,
        }

        const existing = await db('rankings')
          .where('team_id', teamId)
          .where('league', leagueStr)
          .first()

        if (existing) {
          await db('rankings').where('id', existing.id).update({ ...data, date_updated: new Date() })
          updated++
        } else {
          await db('rankings').insert({ ...data, date_created: new Date(), date_updated: new Date() })
          created++
        }
      } catch (e) {
        errors++
        log.warn(`[SV Sync] Ranking error: ${e.message}`)
      }
    }
  }

  log.info(`[SV Sync] Rankings: ${created} created, ${updated} updated, ${errors} errors`)
  return { created, updated, errors }
}
