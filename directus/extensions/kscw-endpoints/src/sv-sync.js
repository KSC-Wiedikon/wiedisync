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

// KSCW Swiss Volley team ids → label (label is documentation only; ONLY the keys
// are used, via isKscwTeamId, to include a fixture/ranking in the sync). Keep in
// sync with teams.team_id (`vb_<id>`) as new teams join Swiss Volley — a missing
// id silently drops that team's whole feed (games + rankings). HU20 (15103) was
// added for the 2026/27 season.
const SV_TEAM_IDS = {
  '12747': 'H3', '2743': 'H1', '541': 'H2',
  '1393': 'D1', '1395': 'D2', '4689': 'D3', '1394': 'D4',
  '7563': 'HU23-1', '15103': 'HU20', '2301': 'DU23-1', '14040': 'DU23-2',
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

  // Batch-fetch all existing SV games, grouped by game_id (1 query instead of
  // N). Grouped — not one-per-id — because an intra-club fixture (e.g. the
  // H1↔H3 derby) legitimately keeps TWO rows, one per KSCW team; a
  // one-row-per-id map made the sync rewrite the away team's row into a
  // duplicate of the home team's (2026-07-04), so the game vanished from every
  // surface scoped to the away team.
  const existingRows = await db('games').where('source', 'swiss_volley')
    .select('id', 'game_id', 'date', 'time', 'status', 'home_score', 'away_score',
      'home_team', 'away_team', 'hall', 'away_hall_json', 'league', 'round',
      'sets_json', 'referees_json', 'respond_by', 'kscw_team', 'type')
  const existingByGameId = new Map()
  for (const r of existingRows) {
    const list = existingByGameId.get(r.game_id)
    if (list) list.push(r)
    else existingByGameId.set(r.game_id, [r])
  }

  // Schedule ownership: a game scheduled through the Terminplanung tool (a
  // confirmed booking, mirrored into `games` by reconcileBookingsToGames) carries
  // its AGREED date/time/venue. The national feed often still serves such a
  // fixture at the league's unscheduled placeholder date until the opponent enters
  // it in VM (especially our AWAY games, which the opponent owns) — so syncing it
  // blindly would clobber the agreed date back to the placeholder. Treat the
  // booking as authoritative for date/time/venue until the game is actually played
  // (completed) OR the season's SV-feed takeover date (vm_authority_date) passes:
  // by then every opponent has had time to enter their away games, so the feed
  // becomes authoritative for date/time/venue too. NULL takeover date → protect
  // until completed (the pre-139 behaviour). bookings.season is the season's id
  // (stored as text), so join on ssn.id::text.
  const bookedRows = await db('game_scheduling_bookings as b')
    .join('svrz_games as s', 's.svrz_persistence_id', 'b.svrz_game_id')
    .leftJoin('game_scheduling_seasons as ssn', function () {
      this.on(db.raw('ssn.id::text'), '=', 'b.season')
    })
    .where('b.status', 'confirmed')
    .whereNotNull('s.svrz_number')
    .select('s.svrz_number', 'ssn.vm_authority_date')
  const toolScheduledIds = new Set()
  const toolTakeoverDates = new Map() // `vb_<svrz_number>` → 'YYYY-MM-DD' (when the feed takes over)
  for (const r of bookedRows) {
    const key = `vb_${r.svrz_number}`
    toolScheduledIds.add(key)
    if (r.vm_authority_date) toolTakeoverDates.set(key, new Date(r.vm_authority_date).toISOString().slice(0, 10))
  }
  const todayStr = new Date().toISOString().slice(0, 10)

  // Fields to compare — if all match, skip the update
  const COMPARE_FIELDS = [
    'date', 'time', 'status', 'home_score', 'away_score',
    'home_team', 'away_team', 'hall', 'away_hall_json',
    'league', 'round', 'sets_json', 'referees_json',
    // kscw_team: so an unchanged fixture re-points to the active team after a
    // season rollover (the team lookup is active-only) instead of staying
    // pinned to the now-archived team and vanishing from team-scoped views.
    'kscw_team',
    // type: paired with kscw_team so an intra-club row adopted by the other
    // side's intent (see the takeRow fallbacks) is actually rewritten.
    'type',
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
      // Intra-club fixture (e.g. the H1↔H3 derby): both sides are ours. Such a
      // game keeps TWO `games` rows — one per KSCW team — so each team's scoped
      // surfaces (home page, ?team= iCal, per-team calendars, RSVP) see it.
      const intraClub = isHome && isKscwTeamId(String(away.teamId))

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

      // Feed fields shared by every row of this fixture.
      const base = {
        game_id: `vb_${gameId}`,
        home_team: home.caption || '',
        away_team: away.caption || '',
        date: parsed.date,
        time: parsed.time,
        league: g.group?.caption || g.phase?.caption || g.league?.caption || '',
        round: g.group?.caption || '',
        season: deriveSeason(g.playDate),
        status: rs.winner ? 'completed' : 'scheduled',
        home_score: rs.wonSetsHomeTeam || 0,
        away_score: rs.wonSetsAwayTeam || 0,
        sets_json: JSON.stringify(mapSetResults(g.setResults)),
        referees_json: JSON.stringify(mapReferees(g.referees)),
        source: 'swiss_volley',
      }

      // One intent per row this fixture should have. Intra-club: one per team,
      // both at our hall (no away_hall_json — it's nobody's away venue).
      const intents = (intraClub
        ? [
            { team: teamLookup[`vb_${String(home.teamId)}`], type: 'home', hall: hallId, away_hall_json: null },
            { team: teamLookup[`vb_${String(away.teamId)}`], type: 'away', hall: hallId, away_hall_json: null },
          ]
        : [{
            team: teamLookup[`vb_${isHome ? String(home.teamId) : String(away.teamId)}`],
            type: isHome ? 'home' : 'away',
            hall: hallId,
            away_hall_json: awayHallJson ? JSON.stringify(awayHallJson) : null,
          }]
      ).map((it) => ({ ...it, kscw_team: it.team?.id || null }))

      // Pair existing rows to intents: same kscw_team first, then same type,
      // then any leftover. The fallbacks re-adopt a row a pre-fix sync
      // collapsed onto the wrong team, or a season-rollover archived pointer.
      // Normal games keep the old one-row behaviour (last row wins, like the
      // old one-per-id Map).
      const rows = existingByGameId.get(`vb_${gameId}`) || []
      const pool = intraClub ? [...rows] : rows.slice(-1)
      const takeRow = (pred) => {
        const i = pool.findIndex(pred)
        return i === -1 ? null : pool.splice(i, 1)[0]
      }

      const takeover = toolTakeoverDates.get(`vb_${gameId}`)
      const feedHasTakenOver = takeover && todayStr >= takeover

      for (const intent of intents) {
        const existing =
          takeRow((r) => intent.kscw_team != null && String(r.kscw_team ?? '') === String(intent.kscw_team)) ||
          takeRow((r) => String(r.type || '') === intent.type) ||
          takeRow(() => true)

        const data = {
          ...base,
          kscw_team: intent.kscw_team,
          type: intent.type,
          hall: intent.hall,
          away_hall_json: intent.away_hall_json,
        }

        if (existing) {
          // Tool-scheduled & not yet played → keep the agreed date/time/venue; don't
          // let a feed placeholder overwrite it (a real reschedule reaches these via
          // the tool). Scores/status/teams/etc. below still sync.
          //
          // Protection is lifted once the season's SV-feed takeover date passes
          // (toolTakeoverDates): from then on the feed wins date/time/venue too. No
          // takeover date set → protect until the game is completed (pre-139).
          if (toolScheduledIds.has(`vb_${gameId}`) && !feedHasTakenOver && existing.status !== 'completed' && data.status !== 'completed') {
            data.date = existing.date
            data.time = existing.time
            data.hall = existing.hall
            data.away_hall_json = existing.away_hall_json
          }
          // Skip if nothing meaningful changed — avoids trigger-based notification
          // spam. Values must be normalized before comparing: pg returns json
          // columns PARSED (String([]) is '' — never equal to the '[]' we write),
          // date columns as JS Date objects, and time columns as HH:MM:SS while
          // the feed parse gives HH:MM — naive String() coercion flags every
          // unprotected game as changed on every run.
          const cmpVal = (f, v) => {
            if (v == null) return ''
            if (f === 'sets_json' || f === 'referees_json' || f === 'away_hall_json') {
              return typeof v === 'string' ? v : JSON.stringify(v)
            }
            if (f === 'date') {
              return v instanceof Date
                ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
                : String(v).slice(0, 10)
            }
            if (f === 'time') return String(v).slice(0, 5)
            return String(v)
          }
          const changed = COMPARE_FIELDS.some(f => cmpVal(f, data[f]) !== cmpVal(f, existing[f]))
          if (!changed) { skipped++; continue }
          // Adjust respond_by if date changed (data.date, not the raw feed date, so a
          // protected tool game whose date we kept doesn't shift its respond_by).
          if (existing.respond_by && existing.date && cmpVal('date', existing.date) !== cmpVal('date', data.date)) {
            const offset = new Date(existing.date).getTime() - new Date(existing.respond_by).getTime()
            const newRb = new Date(new Date(data.date).getTime() - offset)
            data.respond_by = newRb.toISOString().split('T')[0]
          }
          await db('games').where('id', existing.id).update({ ...data, date_updated: new Date() })
          updated++
        } else {
          // Apply respond_by default on creation (per intent — the two rows of
          // an intra-club game belong to different teams).
          if (intent.team?.features_enabled) {
            const fe = typeof intent.team.features_enabled === 'string'
              ? JSON.parse(intent.team.features_enabled) : intent.team.features_enabled
            const days = fe?.game_respond_by_days
            if (days > 0 && parsed.date) {
              const rb = new Date(new Date(parsed.date).getTime() - days * 86400000)
              data.respond_by = rb.toISOString().split('T')[0]
            }
          }
          await db('games').insert({ ...data, date_created: new Date(), date_updated: new Date() })
          created++
        }
      }
      if (intraClub && pool.length) {
        log.warn(`[SV Sync] vb_${gameId}: ${pool.length} surplus intra-club row(s) left untouched — please dedupe`)
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
  // Season-year lookups (league.season is the start year as an int, e.g. 2025 = 2025/26).
  // Used to label each ranking group with ITS OWN season rather than a single
  // current-date guess — so a new season's rankings file under the right season
  // string and never overwrite the prior season's archived rows.
  const seasonYearByGroup = {}
  const seasonYearByLeague = {}
  if (gamesRes.ok) {
    const gamesData = await gamesRes.json()
    if (Array.isArray(gamesData)) {
      for (const g of gamesData) {
        if (g.league?.leagueId) {
          captions.leagues[g.league.leagueId] = g.league.caption || ''
          if (typeof g.league.season === 'number') seasonYearByLeague[g.league.leagueId] = g.league.season
        }
        if (g.phase?.phaseId) captions.phases[g.phase.phaseId] = g.phase.caption || ''
        if (g.group?.groupId) {
          captions.groups[g.group.groupId] = g.group.caption || ''
          if (typeof g.league?.season === 'number') seasonYearByGroup[g.group.groupId] = g.league.season
        }
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
  // Fallback only — used when a group has no matching game in the feed to read
  // league.season from. Format a start-year int (2025) → short season ("2025/26").
  const fmtSeason = (startYear) => `${startYear}/${String(startYear + 1).slice(2)}`
  const fallbackSeason = mo < 8 ? `${yr - 1}/${String(yr).slice(2)}` : `${yr}/${String(yr + 1).slice(2)}`
  const nowStr = now.toISOString()

  let created = 0, updated = 0, errors = 0

  for (const grp of relevantGroups) {
    const leagueStr = captions.groups[grp.groupId] || captions.phases[grp.phaseId] ||
      captions.leagues[grp.leagueId] || `Group ${grp.groupId}`
    const seasonYear = seasonYearByGroup[grp.groupId] ?? seasonYearByLeague[grp.leagueId]
    const season = typeof seasonYear === 'number' ? fmtSeason(seasonYear) : fallbackSeason

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
          .where('season', season)
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
