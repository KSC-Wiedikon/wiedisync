#!/usr/bin/env node
/**
 * Backfill historical Swiss Volley rankings into the `rankings` table.
 *
 * The live ranking sync (kscw-endpoints/src/sv-sync.js) only ever reads the
 * Swiss Volley API's *current-season* ranking endpoint, so once a season ends
 * its standings are no longer re-fetched — and prior to the season-scoped
 * upsert fix they were overwritten in place anyway. This one-time script
 * reconstructs a completed season's tables from the per-group ranking endpoint,
 * which DOES serve historical groups.
 *
 * Resolution chain (all reachable with the club-scoped SV_API_KEY):
 *   games?clubId&dateStart&dateEnd  → distinct group.groupId + captions + league.season
 *   ranking/{groupId}               → full standings (all teams in the group)
 *
 * Output: idempotent SQL on stdout — a single transaction that DELETEs the
 * target season(s) then re-INSERTs them. Apply with the same ssh+psql pattern
 * as the other db:* backfills, dev first:
 *
 *   SV_API_KEY=… node directus/scripts/backfill-rankings-history.mjs 2024 > /tmp/bf.sql
 *   cat /tmp/bf.sql | ssh hetzner 'sudo docker exec -i <db> psql -U supabase_admin -d directus_kscw_dev -X -v ON_ERROR_STOP=1'
 *
 * Row shape + field mapping mirror sv-sync.js exactly (team_id `vb_<id>`,
 * league = group||phase||league caption, season = league.season as YYYY/YY,
 * `team` FK left null like the live vb sync). All teams in each KSCW group are
 * stored, so the league tables are complete; the frontend filters cup/tournament
 * groups at display time, identically across seasons.
 */

const SV_API_BASE = 'https://api.volleyball.ch'
const SV_API_KEY = process.env.SV_API_KEY
const CLUB_ID = process.env.SV_CLUB_ID || '912530' // KSC Wiedikon

if (!SV_API_KEY) {
  console.error('SV_API_KEY env var is required (read it from the directus container).')
  process.exit(1)
}

const years = (process.argv.slice(2).map(Number).filter(n => Number.isInteger(n) && n > 2000))
const targetYears = years.length ? years : [2024]

const fmtSeason = (startYear) => `${startYear}/${String(startYear + 1).slice(2)}`
const sqlStr = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
const sqlInt = (v) => (v == null || v === '') ? '0' : String(Math.trunc(Number(v)) || 0)

async function svGet(path) {
  const res = await fetch(`${SV_API_BASE}${path}`, { headers: { Authorization: SV_API_KEY } })
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}

async function collectGroupsForYear(year) {
  // Indoor season spans roughly Sep→May; widen to Jul→Jun to catch cup/playoff edges.
  const dateStart = `${year}-07-01`
  const dateEnd = `${year + 1}-06-30`
  const games = await svGet(`/indoor/games?clubId=${CLUB_ID}&dateStart=${dateStart}&dateEnd=${dateEnd}`)
  const groups = new Map() // groupId → { leagueStr, seasonYear }
  const capByPhase = {}, capByLeague = {}
  if (Array.isArray(games)) {
    for (const g of games) {
      if (g.phase?.phaseId) capByPhase[g.phase.phaseId] = g.phase.caption || ''
      if (g.league?.leagueId) capByLeague[g.league.leagueId] = g.league.caption || ''
    }
    for (const g of games) {
      const gid = g.group?.groupId
      if (!gid || groups.has(gid)) continue
      const leagueStr = (g.group?.caption || capByPhase[g.phase?.phaseId] ||
        capByLeague[g.league?.leagueId] || `Group ${gid}`)
      const seasonYear = typeof g.league?.season === 'number' ? g.league.season : year
      groups.set(gid, { leagueStr, seasonYear })
    }
  }
  return groups
}

async function main() {
  const rows = []
  const nowIso = new Date().toISOString()
  const seasonsTouched = new Set()

  for (const year of targetYears) {
    const groups = await collectGroupsForYear(year)
    process.stderr.write(`[backfill] ${fmtSeason(year)}: ${groups.size} groups\n`)
    for (const [gid, { leagueStr, seasonYear }] of groups) {
      const season = fmtSeason(seasonYear)
      seasonsTouched.add(season)
      let ranking
      try {
        ranking = await svGet(`/indoor/ranking/${gid}`)
      } catch (e) {
        process.stderr.write(`[backfill]   group ${gid} (${leagueStr}): ${e.message} — skipped\n`)
        continue
      }
      if (!Array.isArray(ranking)) continue
      for (const r of ranking) {
        rows.push({
          team_id: `vb_${r.teamId || ''}`,
          team_name: r.teamCaption || '',
          league: leagueStr,
          rank: r.rank, played: r.games, won: r.wins, lost: r.defeats,
          wins_clear: r.winsClear, wins_narrow: r.winsNarrow,
          defeats_clear: r.defeatsClear, defeats_narrow: r.defeatsNarrow,
          sets_won: r.setsWon, sets_lost: r.setsLost,
          points_won: r.ballsWon, points_lost: r.ballsLost,
          points: r.points, season,
        })
      }
    }
  }

  process.stderr.write(`[backfill] ${rows.length} ranking rows across seasons: ${[...seasonsTouched].join(', ')}\n`)
  if (!rows.length) { process.stderr.write('[backfill] nothing to write — aborting\n'); process.exit(2) }

  const cols = ['team_id','team_name','league','rank','played','won','lost','wins_clear','wins_narrow','defeats_clear','defeats_narrow','sets_won','sets_lost','points_won','points_lost','points','season','updated_at','date_created','date_updated']
  // Columns refreshed on conflict — everything except the conflict key and the
  // immutable create timestamp.
  const updateCols = ['team_name','rank','played','won','lost','wins_clear','wins_narrow','defeats_clear','defeats_narrow','sets_won','sets_lost','points_won','points_lost','points','updated_at','date_updated']

  const out = []
  out.push('-- Generated by backfill-rankings-history.mjs — historical Swiss Volley rankings')
  out.push(`-- seasons: ${[...seasonsTouched].join(', ')} | rows: ${rows.length}`)
  out.push('-- Idempotent upsert on (team_id, league, season); requires migration 121.')
  out.push('-- Non-destructive: pre-existing rows for these seasons (e.g. youth groups')
  out.push('-- not present in the historical games feed) are left untouched.')
  out.push('BEGIN;')
  for (const r of rows) {
    const vals = [
      sqlStr(r.team_id), sqlStr(r.team_name), sqlStr(r.league),
      sqlInt(r.rank), sqlInt(r.played), sqlInt(r.won), sqlInt(r.lost),
      sqlInt(r.wins_clear), sqlInt(r.wins_narrow), sqlInt(r.defeats_clear), sqlInt(r.defeats_narrow),
      sqlInt(r.sets_won), sqlInt(r.sets_lost), sqlInt(r.points_won), sqlInt(r.points_lost),
      sqlInt(r.points), sqlStr(r.season), sqlStr(nowIso), sqlStr(nowIso), sqlStr(nowIso),
    ]
    const setClause = updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')
    out.push(
      `INSERT INTO rankings (${cols.join(', ')}) VALUES (${vals.join(', ')}) ` +
      `ON CONFLICT (team_id, league, season) DO UPDATE SET ${setClause};`,
    )
  }
  out.push('COMMIT;')
  process.stdout.write(out.join('\n') + '\n')
}

main().catch(e => { console.error('[backfill] fatal:', e.message); process.exit(1) })
