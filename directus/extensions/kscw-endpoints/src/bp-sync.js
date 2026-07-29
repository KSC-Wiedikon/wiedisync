/**
 * Basketplan Sync — ported from bp_sync_lib.js
 *
 * Fetches basketball games and rankings from Basketplan XML API
 * and upserts into Directus via knex.
 */

import { sweepGameAutoConfirm } from './game-auto-confirm-sweep.js'

const BP_BASE = 'https://www.basketplan.ch'
const BP_CLUB_ID = 166

/** Normalize season string to short format: "2025/2026" → "2025/26" */
function normalizeSeason(s) {
  if (!s) return s
  const m = s.match(/^(\d{4})\/(\d{4})$/)
  return m ? `${m[1]}/${m[2].slice(2)}` : s
}

const HALL_MAP = {
  'Kantonsschule Wiedikon 2fach': 'KWI A',
  'Kantonsschule Wiedikon 1fach': 'KWI C',
}

const STATUS_MAP = {
  upcoming: 'scheduled',
  played: 'completed',
  postponed: 'postponed',
  cancelled: 'postponed',
}

// ── XML helpers ─────────────────────────────────────────────────────

function getAttr(xml, attr) {
  const re = new RegExp(attr + '="([^"]*)"')
  const m = xml.match(re)
  return m ? m[1] : ''
}

function parseGames(teamXml, teamIdSet) {
  const games = []
  const gameBlocks = teamXml.split('<GameVO ').slice(1)

  for (const block of gameBlocks) {
    const fullBlock = block.split('</GameVO>')[0] || block
    const id = getAttr(fullBlock, ' id')
    if (!id) continue

    const gameNumber = getAttr(fullBlock, 'gameNumber')
    const yearMonthDay = getAttr(fullBlock, 'yearMonthDay')
    const timeOfDay = getAttr(fullBlock, 'timeOfDay')
    const withdrawn = getAttr(fullBlock, 'withdrawn') === 'true'

    const homeBlock = fullBlock.match(/<homeTeam\s[^>]*\/>|<homeTeam\s[\s\S]*?<\/homeTeam>/)?.[0] || ''
    const homeTeamName = getAttr(homeBlock, ' name')
    const homeTeamId = getAttr(homeBlock, ' id')

    const guestBlock = fullBlock.match(/<guestTeam\s[^>]*\/>|<guestTeam\s[\s\S]*?<\/guestTeam>/)?.[0] || ''
    const guestTeamName = getAttr(guestBlock, ' name')
    const guestTeamId = getAttr(guestBlock, ' id')

    const locBlock = fullBlock.match(/<location\s[^>]*\/>|<location\s[\s\S]*?<\/location>/)?.[0] || ''
    const locName = getAttr(locBlock, ' name') || getAttr(locBlock, 'shortName')
    const locCity = getAttr(locBlock, 'city')
    const locAddr = getAttr(locBlock, 'line1')

    const lhBlock = fullBlock.match(/<leagueHolding\s[\s\S]*?<\/leagueHolding>/)?.[0] || ''
    const leagueBlock = lhBlock.match(/<league\s[\s\S]*?<\/league>/)?.[0] || ''
    const leagueName = getAttr(leagueBlock, 'shortName') || getAttr(lhBlock, 'fullName')
    const seasonBlock = lhBlock.match(/<season\s[^>]*\/>|<season\s[\s\S]*?<\/season>/)?.[0] || ''
    const seasonName = getAttr(seasonBlock, ' name')

    const resultBlock = fullBlock.match(/<result\s[^>]*\/?>/)?.[0] || ''
    const scoreHome = resultBlock ? getAttr(resultBlock, 'homeTeamScore') : ''
    const scoreGuest = resultBlock ? getAttr(resultBlock, 'guestTeamScore') : ''

    const rescheduleRequested = getAttr(fullBlock, 'rescheduleRequested') === 'true'
    const hasScore = scoreHome !== '' && scoreGuest !== ''
    let status = 'upcoming'
    if (withdrawn) status = 'cancelled'
    else if (rescheduleRequested) status = 'postponed'
    else if (hasScore) status = 'played'

    games.push({
      id, gameNumber, date: yearMonthDay, time: timeOfDay,
      homeTeam: homeTeamName, homeTeamId,
      guestTeam: guestTeamName, guestTeamId,
      location: locName, locationCity: locCity, locationAddress: locAddr,
      league: (leagueName || '').trim(), season: normalizeSeason(seasonName),
      status,
      scoreHome: scoreHome !== '' ? parseInt(scoreHome, 10) : 0,
      scoreGuest: scoreGuest !== '' ? parseInt(scoreGuest, 10) : 0,
      isHome: teamIdSet[homeTeamId] === true,
    })
  }
  return games
}

function extractLeagueHoldingIds(teamXml) {
  const ids = {}
  const lhMatches = teamXml.match(/<leagueHolding[^>]*>/g)
  if (lhMatches) {
    const now = new Date()
    // ⚠ Sep 1, NOT the club's Jun 1 cutover (season.js) — deliberate. This matches
    // BASKETPLAN's season convention against their `from` dates; it is their
    // calendar, not ours, so it must not follow our rollover.
    const seasonPrefix = String(now.getMonth() < 8 ? now.getFullYear() - 1 : now.getFullYear())
    for (const tag of lhMatches) {
      const id = getAttr(tag, ' id')
      const from = getAttr(tag, 'from')
      if (id && from?.startsWith(seasonPrefix)) ids[id] = true
    }
  }
  return ids
}

function parseRankings(rankingXml) {
  const rankings = []
  const lhMatch = rankingXml.match(/<leagueHolding[^>]*fullName="([^"]*)"/)
  const leagueName = lhMatch ? lhMatch[1] : ''
  const seasonMatch = rankingXml.match(/<season[^>]*name="([^"]*)"/)
  const season = seasonMatch ? seasonMatch[1] : ''

  const rankBlocks = rankingXml.split('<Ranking>').slice(1)
  for (const block of rankBlocks) {
    const chunk = block.split('</Ranking>')[0] || block
    const rdMatch = chunk.match(/<rankingDataVO[^>]*\/>/)
    if (!rdMatch) continue
    const rd = rdMatch[0]
    const teamMatch = chunk.match(/<team[^>]*\/>|<team[^>]*>[\s\S]*?<\/team>/)
    if (!teamMatch) continue
    const teamBlock = teamMatch[0]

    rankings.push({
      bpTeamId: getAttr(teamBlock, ' id'),
      teamName: getAttr(teamBlock, ' name'),
      league: leagueName, season: normalizeSeason(season),
      rank: parseInt(getAttr(rd, 'currentRanking'), 10) || 0,
      played: parseInt(getAttr(rd, 'gamesPlayed'), 10) || 0,
      won: parseInt(getAttr(rd, 'victories'), 10) || 0,
      lost: parseInt(getAttr(rd, 'defeats'), 10) || 0,
      pointsFor: parseInt(getAttr(rd, 'totalScoreFor'), 10) || 0,
      pointsAgainst: parseInt(getAttr(rd, 'totalScoreAgainst'), 10) || 0,
      totalPoints: parseInt(getAttr(rd, 'totalPoints'), 10) || 0,
    })
  }
  return rankings
}

// ── Main sync functions ─────────────────────────────────────────────

// Change-detection normalizer, mirrored from sv-sync.js (keep the two in
// sync): values must be normalized before comparing feed data against a pg
// row — pg returns json columns PARSED (String([]) is '' — never equal to the
// '[]' we write), date columns as JS Date objects, and time columns as
// HH:MM:SS while the feed gives HH:MM — the old naive String() coercion
// flagged every BB game as changed on every run, rewriting all rows nightly.
// Exported for tests.
export function cmpVal(f, v) {
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

// Update-path guards for fields whose current value the APP owns, not the
// feed. Mutates `data` in place and must run BEFORE the change comparison, so
// a preserved value never registers as a diff that rewrites (and re-notifies)
// the row on every run. Exported for tests.
export function applyLocalGuards(data, existing) {
  // A game cancelled in the app stays cancelled: the feed has no notion of a
  // local cancel and keeps serving the fixture, which used to silently
  // resurrect a game the team was already told is gone. Only an actual
  // result (completed) overrides the cancel. 'cancelled' can only come from
  // the app — a Basketplan withdrawal lands as 'postponed' via STATUS_MAP.
  if (existing.status === 'cancelled' && data.status !== 'completed') {
    data.status = 'cancelled'
  }
  // HALL_MAP resolves only the two KWI home mappings — when it misses, keep
  // the existing (possibly hand-set) hall rather than leaving the key absent,
  // where the comparison reads '' against the real value as a change every
  // run. Same for the away venue json. The feed still wins whenever it
  // resolves a value.
  if (data.hall === undefined) data.hall = existing.hall
  if (data.away_hall_json === undefined) data.away_hall_json = existing.away_hall_json
}

export async function syncBpGames(db, log) {
  log.info('[BP Sync] Starting games sync...')

  // Build lookups
  const pbTeams = await db('teams')
    .where('sport', 'basketball')
    .where('active', true) // current-season team only (post-rollover the bb_source_id collides with the archived row)
    .whereNot('bb_source_id', '')
    .select('id', 'bb_source_id', 'features_enabled')
  const bpToPb = Object.fromEntries(pbTeams.map(t => [t.bb_source_id, t]))
  const teamIdSet = Object.fromEntries(pbTeams.map(t => [t.bb_source_id, true]))
  const teamIds = pbTeams.map(t => t.bb_source_id)

  if (teamIds.length === 0) {
    log.warn('[BP Sync] No basketball teams with bb_source_id')
    return { created: 0, updated: 0, errors: 0, leagueHoldingIds: {} }
  }
  log.info(`[BP Sync] ${teamIds.length} basketball teams`)

  const hallRows = await db('halls').select('id', 'name')
  const hallByName = Object.fromEntries(hallRows.map(h => [h.name, h.id]))

  const allGames = []
  const seenIds = {}
  const allLhIds = {}

  for (const teamId of teamIds) {
    try {
      const res = await fetch(
        `${BP_BASE}/findTeamById.do?teamId=${teamId}&clubId=${BP_CLUB_ID}&federationId=10&xmlView=true`,
        { headers: { 'User-Agent': 'KSCW-Sync/1.0' } },
      )
      const xml = await res.text()
      if (!xml || xml.length < 100) continue

      const lhIds = extractLeagueHoldingIds(xml)
      Object.assign(allLhIds, lhIds)

      const games = parseGames(xml, teamIdSet)
      let newCount = 0
      for (const g of games) {
        if (!seenIds[g.id]) { seenIds[g.id] = true; allGames.push(g); newCount++ }
      }
      log.info(`[BP Sync] Team ${teamId}: ${games.length} games (${newCount} new)`)
    } catch (err) {
      log.warn(`[BP Sync] Team ${teamId} fetch error: ${err.message}`)
    }
  }

  log.info(`[BP Sync] ${allGames.length} unique games`)

  // Batch-fetch all existing BB games into a Map (1 query instead of N)
  const existingRows = await db('games').where('source', 'basketplan')
    .select('id', 'game_id', 'date', 'time', 'status', 'home_score', 'away_score',
      'home_team', 'away_team', 'hall', 'away_hall_json', 'league',
      'referees_json', 'respond_by', 'kscw_team')
  const existingMap = new Map(existingRows.map(r => [r.game_id, r]))

  const COMPARE_FIELDS = [
    'date', 'time', 'status', 'home_score', 'away_score',
    'home_team', 'away_team', 'hall', 'away_hall_json', 'league',
    // kscw_team: re-point an unchanged fixture to the active team after a season
    // rollover (lookup is active-only) instead of leaving it on the archived team.
    'kscw_team',
  ]

  let created = 0, updated = 0, skipped = 0, errors = 0

  for (const g of allGames) {
    const gameId = `bb_${g.gameNumber}`
    const kscwBpId = g.isHome ? g.homeTeamId : g.guestTeamId
    const pbTeam = bpToPb[kscwBpId]
    if (!pbTeam) { errors++; continue }
    if (!g.date?.trim()) { log.warn(`[BP Sync] Game ${gameId}: missing date, skipping`); errors++; continue }
    const awayTeam = (!g.guestTeam?.trim() || g.guestTeam.trim() === '?') ? 'Opponent TBD' : g.guestTeam

    let hallId = null, awayHallJson = null
    if (g.isHome && g.location) {
      const mapped = HALL_MAP[g.location]
      if (mapped) hallId = hallByName[mapped] || null
    }
    if (!g.isHome && g.location) {
      awayHallJson = { name: g.location, address: g.locationAddress, city: g.locationCity }
    }

    const data = {
      game_id: gameId, source: 'basketplan',
      kscw_team: pbTeam.id,
      home_team: g.homeTeam, away_team: awayTeam,
      date: g.date, time: g.time || '00:00',
      type: g.isHome ? 'home' : 'away',
      status: STATUS_MAP[g.status] || 'scheduled',
      home_score: g.scoreHome, away_score: g.scoreGuest,
      league: g.league, season: normalizeSeason(g.season),
      referees_json: '[]',
    }
    if (hallId) data.hall = hallId
    if (awayHallJson) data.away_hall_json = JSON.stringify(awayHallJson)

    try {
      const existing = existingMap.get(gameId)
      if (existing) {
        // Fields the app owns (local cancel, hand-set halls) — must run
        // before the change comparison below.
        applyLocalGuards(data, existing)
        // Skip if nothing meaningful changed — avoids trigger-based
        // notification spam (values normalized via cmpVal — see its comment).
        const changed = COMPARE_FIELDS.some(f => cmpVal(f, data[f]) !== cmpVal(f, existing[f]))
        if (!changed) { skipped++; continue }
        // data.date, not raw string-vs-Date (existing.date !== g.date was
        // always true against a pg Date, recomputing respond_by on every
        // real update).
        if (existing.respond_by && existing.date && cmpVal('date', existing.date) !== cmpVal('date', data.date)) {
          const offset = new Date(existing.date).getTime() - new Date(existing.respond_by).getTime()
          data.respond_by = new Date(new Date(g.date).getTime() - offset).toISOString().split('T')[0]
        }
        await db('games').where('id', existing.id).update({ ...data, date_updated: new Date() })
        updated++
      } else {
        const fe = typeof pbTeam.features_enabled === 'string'
          ? JSON.parse(pbTeam.features_enabled || '{}') : (pbTeam.features_enabled || {})
        const days = fe?.game_respond_by_days
        if (days > 0 && g.date) {
          data.respond_by = new Date(new Date(g.date).getTime() - days * 86400000).toISOString().split('T')[0]
        }
        await db('games').insert({ ...data, date_created: new Date(), date_updated: new Date() })
        created++
      }
    } catch (e) {
      errors++
      log.warn(`[BP Sync] Game ${gameId}: ${e.message}`)
    }
  }

  log.info(`[BP Sync] Games: ${created} created, ${updated} updated, ${skipped} unchanged, ${errors} errors`)
  if (created > 0) await sweepGameAutoConfirm(db, log)
  return { created, updated, skipped, errors, leagueHoldingIds: allLhIds }
}

export async function syncBpRankings(db, log, leagueHoldingIds = {}) {
  const pbTeams = await db('teams')
    .where('sport', 'basketball')
    .where('active', true) // current-season team only (post-rollover the bb_source_id collides with the archived row)
    .whereNot('bb_source_id', '')
    .select('id', 'bb_source_id')
  const bpToPb = Object.fromEntries(pbTeams.map(t => [t.bb_source_id, t.id]))

  let lhIds = Object.keys(leagueHoldingIds)
  if (lhIds.length === 0) {
    log.info('[BP Sync] No cached leagueHoldingIds, fetching from team XMLs...')
    for (const t of pbTeams) {
      try {
        const res = await fetch(
          `${BP_BASE}/findTeamById.do?teamId=${t.bb_source_id}&clubId=${BP_CLUB_ID}&federationId=10&xmlView=true`,
          { headers: { 'User-Agent': 'KSCW-Sync/1.0' } },
        )
        const xml = await res.text()
        Object.assign(leagueHoldingIds, extractLeagueHoldingIds(xml))
      } catch (e) { /* skip */ }
    }
    lhIds = Object.keys(leagueHoldingIds)
  }

  log.info(`[BP Sync] Fetching rankings for ${lhIds.length} leagues...`)
  const nowStr = new Date().toISOString()
  let created = 0, updated = 0, errors = 0

  for (const lhId of lhIds) {
    try {
      const res = await fetch(
        `${BP_BASE}/showRankingForLeague.do?leagueHoldingId=${lhId}&xmlView=true`,
        { headers: { 'User-Agent': 'KSCW-Sync/1.0' } },
      )
      const xml = await res.text()
      if (!xml || xml.length < 100) continue

      const rankings = parseRankings(xml)
      if (!rankings.some(r => bpToPb[r.bpTeamId])) continue

      for (const r of rankings) {
        try {
          const teamId = `bb_${r.bpTeamId}`
          const data = {
            team_id: teamId, team_name: r.teamName, league: r.league,
            rank: r.rank, played: r.played, won: r.won, lost: r.lost,
            sets_won: 0, sets_lost: 0,
            points_won: r.pointsFor, points_lost: r.pointsAgainst,
            points: r.totalPoints, season: normalizeSeason(r.season), updated_at: nowStr,
          }
          const pbTeamId = bpToPb[r.bpTeamId]
          if (pbTeamId) data.team = pbTeamId

          const existing = await db('rankings').where('team_id', teamId).where('league', r.league).where('season', data.season).first()
          if (existing) { await db('rankings').where('id', existing.id).update({ ...data, date_updated: new Date() }); updated++ }
          else { await db('rankings').insert({ ...data, date_created: new Date(), date_updated: new Date() }); created++ }
        } catch (e) { errors++; log.warn(`[BP Sync] Ranking: ${e.message}`) }
      }
    } catch (e) { log.warn(`[BP Sync] League ${lhId}: ${e.message}`) }
  }

  log.info(`[BP Sync] Rankings: ${created} created, ${updated} updated, ${errors} errors`)
  return { created, updated, errors }
}
