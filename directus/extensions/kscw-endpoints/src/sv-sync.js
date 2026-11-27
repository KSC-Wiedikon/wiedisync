/**
 * Swiss Volley Sync — ported from sv_sync_lib.js
 *
 * Fetches games and rankings from the Swiss Volley API
 * and upserts into Directus via knex.
 */

import { sweepGameAutoConfirm } from './game-auto-confirm-sweep.js'
import { HALL_OVERRIDE_READ, hallSourceView, overrideAwareWrite, isHallOverridden } from './hall-override.js'

import { fetchClubSeasonGames, fetchStandings } from './game-center.js'

// Since 27.11.2026 the feed is the public Swiss Volley Game Center (svrz.ch),
// not the official API: api.volleyball.ch runs on VolleyManager's server, which
// refuses kscw-server. Same data, same field names — see game-center.js. No key
// needed any more (SV_API_KEY may stay set; nothing reads it here).
export const KSCW_CLUB_ID = 912530

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

/**
 * The season label stamped onto `games.season`.
 * ⚠ SEP 1, NOT the club's Jun-1 cutover (season.js) — deliberate, and the same
 * exception bp-sync.js documents: this matches SWISS VOLLEY's season convention
 * against their own fixture dates. It is their calendar, not ours.
 * ⚠⚠ Precisely because the two boundaries differ, never join `games.season`
 * against `member_teams.season` — that collision silently emptied every summer
 * fixture's squad in vm-push-nomination.mjs. Join on the team FK instead.
 */
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

// Wide net, same as the frontend's isCupGame() / detectCupMatch() — the feed
// labels the national cup "Mobiliar Volley Cup" and the regional one "Züri Cup".
const CUP_RE = /cup|pokal|coupe|coppa/i

// League label for a feed fixture. A league game carries its full name on
// `group` ("Frauen 2. Liga"), with `league` holding only a short code ("2L") —
// hence group-first. A CUP fixture inverts that: `league` names the competition
// ("Züri Cup") while `group` holds just the pairing ("Runde 3, Spiel 2"), so the
// group-only label would store a string with no "Cup" in it. Everything
// downstream classifies cups by this very string — isCupGame() (scorer duty is
// the playing team's own for cup home games), detectCupMatch() (Spielplanung
// chips), the GamesPage cup section, the "league only" attendance stats — so
// prefix the competition, reproducing the "Züri Cup — Runde 1, Spiel 12" shape
// the pre-Directus rows already use. Exported for tests.
export function deriveLeagueLabel(g) {
  const competition = g?.league?.caption || ''
  const base = g?.group?.caption || g?.phase?.caption || competition || ''
  if (competition && CUP_RE.test(competition) && !CUP_RE.test(base)) {
    return base ? `${competition} — ${base}` : competition
  }
  return base
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

// Change-detection normalizer: values must be normalized before comparing feed
// data against a pg row — pg returns json columns PARSED (String([]) is '' —
// never equal to the '[]' we write), date columns as JS Date objects, and time
// columns as HH:MM:SS while the feed parse gives HH:MM — naive String()
// coercion flags every unprotected game as changed on every run. Mirrored in
// bp-sync.js — keep the two in sync. Exported for tests.
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
  // local cancel and keeps serving the fixture as 'scheduled', which used to
  // silently resurrect a game the team was already told is gone (the reverse
  // flip doesn't even notify — trg_games_notify mutes it as cosmetic). Only
  // an actual result (completed) overrides the cancel. 'cancelled' can only
  // come from the app — this sync writes scheduled/completed exclusively.
  // Same for a local 'postponed' (this feed never emits it either) — the
  // sibling of the resurrect class; bp-sync deliberately does NOT mirror this
  // one, because Basketplan's own withdrawal mapping owns 'postponed' there.
  if ((existing.status === 'cancelled' || existing.status === 'postponed') && data.status !== 'completed') {
    data.status = existing.status
  }
  // Never downgrade kscw_team to NULL: the team lookup is active-only, so a
  // team archived without a successor resolves to nothing — and NULLing here
  // detached that team's whole completed season from every team-scoped
  // surface (calendars, iCal, stats views; DU23-2's 2025/26, 2026-06-30).
  // The season-rollover re-point (see COMPARE_FIELDS) still applies whenever
  // the lookup DOES resolve; only the resolved-to-nothing case keeps the old
  // pointer.
  if (data.kscw_team == null && existing.kscw_team != null) {
    data.kscw_team = existing.kscw_team
  }
}

// Team names from Romandie and Ticino in their own language (owner 2026-11-22:
// Ticino Italian, Romandie French, German-speaking Switzerland German). The
// public feed gives one caption per team; svrz_games (VolleyManager, written by
// scripts/svrz-scheduling-sync.mjs) keeps each team's name in its club's region
// language. A club number's first three digits are its regional association;
// these are the French, Italian and bilingual ones — twin of
// scripts/vm-team-language.mjs, which also decides the German-speaking clubs of
// the bilingual associations. German-region names stay the feed's caption, so
// existing rows are not renamed.
export const NON_GERMAN_ASSOCIATIONS = new Set(['901', '902', '903', '904', '905', '906', '915'])

// `vmSide`: { clubId, name } of the same side in svrz_games, or undefined.
// Exported for tests.
export function regionalTeamName(caption, vmSide) {
  const clubId = String(vmSide?.clubId ?? '').trim()
  const name = typeof vmSide?.name === 'string' ? vmSide.name : ''
  if (name.trim() !== '' && NON_GERMAN_ASSOCIATIONS.has(clubId.slice(0, 3))) return name
  return caption
}

// game number -> { home: { clubId, name }, away: { clubId, name } } from svrz_games.
// Exported for tests.
export async function loadVmTeamNames(db, gameIds, log) {
  const map = new Map()
  const nums = [...new Set(gameIds.map(Number).filter(Number.isInteger))]
  if (nums.length === 0) return map
  try {
    const rows = await db('svrz_games').whereIn('svrz_number', nums)
      .select('svrz_number', 'home_club_id', 'home_team_name', 'away_club_id', 'away_team_name')
    for (const r of rows) {
      map.set(String(r.svrz_number), {
        home: { clubId: r.home_club_id, name: r.home_team_name },
        away: { clubId: r.away_club_id, name: r.away_team_name },
      })
    }
  } catch (err) {
    // Names only: the sync goes on with the feed's captions.
    log?.warn?.(`[SV Sync] svrz_games team names unavailable, keeping the feed's: ${err.message}`)
  }
  return map
}

// Who owns an existing home game's `hall`: the app before the season starts,
// the feed (VolleyManager) after. Replaces the blanket FREEZE_HALLS of
// 2026-07-09, which pinned every hall forever — so when VM moved HU23-1's
// 22.11.2026 game (#406697) from KWI A to KWI C, kscw.ch kept showing KWI A.
// Before the season the halls are still being negotiated and hand-corrected
// (Terminplanung slots, Saturday rebalance), which the feed used to clobber;
// once the first game of the season has a result, VM is the source of truth.
// Even then the existing hall is kept when:
//  • the feed gives no hall, or one no `halls` row maps (never NULL a set hall);
//  • the row is a combo (`additional_halls`, the A+B derbies): VM carries those
//    as one combo gym, which no hall row maps by design (migration 220), and
//    this sync never writes `additional_halls`, so moving only the primary
//    would leave a court set no VM gym matches;
//  • both halls are the same VM gym (Döltschi 1/2 share one): the feed cannot
//    tell them apart, so a hand-picked Döltschi 1 must not flip to Döltschi 2.
// Exported for tests.
export function resolveHomeHall({ existing, feedHall, seasonStarted, vmGymByHall }) {
  if (!seasonStarted) return existing.hall
  if (feedHall == null) return existing.hall
  if (existing.hall == null) return feedHall
  if (String(feedHall) === String(existing.hall)) return existing.hall
  let extra = existing.additional_halls
  if (typeof extra === 'string') { try { extra = JSON.parse(extra) } catch { extra = null } }
  if (Array.isArray(extra) && extra.length > 0) return existing.hall
  const gymOld = vmGymByHall?.get(String(existing.hall))
  const gymNew = vmGymByHall?.get(String(feedHall))
  if (gymOld && gymOld === gymNew) return existing.hall
  return feedHall
}

/** The club's season from the Game Center, cups included. Throws on a failed
 *  read: a read that "returned nothing" used to log, answer 200 and write
 *  sync_runs ok, so a 403 looked fresh everywhere (26.11.2026). */
export async function fetchKscwFeed() {
  // ⚠ includeCup is NOT optional: without it the Züri Cup and the Mobiliar
  // Volley Cup vanish from the feed (verified 2026-08-01 on the official API,
  // which the Game Center mirrors).
  return fetchClubSeasonGames(KSCW_CLUB_ID)
}

export async function syncSvGames(db, log, feed) {
  log.info('[SV Sync] Fetching games...')
  const allGames = feed ?? await fetchKscwFeed()

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
  const allHallRows = await db('halls').select('id', 'sv_hall_id', 'vm_hall_id')
  const hallLookup = Object.fromEntries(allHallRows.filter(h => h.sv_hall_id).map(h => [h.sv_hall_id, h.id]))
  const vmGymByHall = new Map(allHallRows.filter(h => h.vm_hall_id).map(h => [String(h.id), h.vm_hall_id]))

  // Batch-fetch all existing SV games, grouped by game_id (1 query instead of
  // N). Grouped — not one-per-id — because an intra-club fixture (e.g. the
  // H1↔H3 derby) legitimately keeps TWO rows, one per KSCW team; a
  // one-row-per-id map made the sync rewrite the away team's row into a
  // duplicate of the home team's (2026-07-04), so the game vanished from every
  // surface scoped to the away team.
  // Romandie / Ticino teams' names in their own language (see regionalTeamName)
  const vmTeamNames = await loadVmTeamNames(db, kscwGames.map(g => g.gameId), log)

  const existingRows = await db('games').where('source', 'swiss_volley')
    .select('id', 'game_id', 'date', 'time', 'status', 'home_score', 'away_score',
      'home_team', 'away_team', 'hall', 'away_hall_json', 'league', 'round',
      'sets_json', 'referees_json', 'respond_by', 'kscw_team', 'type', 'additional_halls',
      ...HALL_OVERRIDE_READ)
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
  // until completed (the pre-139 behaviour). bookings.season is the season's id.
  const bookedRows = await db('game_scheduling_bookings as b')
    .join('svrz_games as s', 's.svrz_persistence_id', 'b.svrz_game_id')
    .leftJoin('game_scheduling_seasons as ssn', 'ssn.id', 'b.season')
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

  // A season has started once any KSCW fixture of it carries a result. From
  // then on the feed owns home halls (resolveHomeHall). Keyed on a result, not
  // the earliest date, because an unscheduled fixture can sit at a placeholder
  // date that would lift the guard too early.
  const startedSeasons = new Set()
  for (const g of kscwGames) {
    if (g.resultSummary?.winner && g.playDate) startedSeasons.add(deriveSeason(g.playDate))
  }

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
        home_team: regionalTeamName(home.caption, vmTeamNames.get(gameId)?.home) || '',
        away_team: regionalTeamName(away.caption, vmTeamNames.get(gameId)?.away) || '',
        date: parsed.date,
        time: parsed.time,
        league: deriveLeagueLabel(g),
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
          // With the hall switch on "Overwrite" (migration 455) everything below
          // runs against the OFFICIAL hall (synced_hall), and the write records it
          // there — the effective hall the club chose stays. Off: the row as is.
          const row = hallSourceView(existing)
          // Home hall: the app's before the season starts, VM's after (see
          // resolveHomeHall). Away rows carry no hall (away_hall_json instead).
          data.hall = resolveHomeHall({
            existing: row,
            feedHall: data.hall,
            seasonStarted: startedSeasons.has(base.season),
            vmGymByHall,
          })
          if (String(data.hall ?? '') !== String(row.hall ?? '')) {
            log.info(`[SV Sync] vb_${gameId}: hall ${row.hall ?? '–'} → ${data.hall ?? '–'} (from the feed)`
              + (isHallOverridden(existing) ? ` — recorded as the synced hall, the overwritten hall ${existing.hall ?? '–'} stays` : ''))
          }
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
            data.hall = row.hall
            data.away_hall_json = existing.away_hall_json
          }
          // Fields the app owns (local cancel, archived-team pointer) — must
          // run before the change comparison below.
          applyLocalGuards(data, row)
          // Skip if nothing meaningful changed — avoids trigger-based
          // notification spam (values normalized via cmpVal — see its comment).
          const changed = COMPARE_FIELDS.some(f => cmpVal(f, data[f]) !== cmpVal(f, row[f]))
          if (!changed) { skipped++; continue }
          // Adjust respond_by if date changed (data.date, not the raw feed date, so a
          // protected tool game whose date we kept doesn't shift its respond_by).
          if (existing.respond_by && existing.date && cmpVal('date', existing.date) !== cmpVal('date', data.date)) {
            const offset = new Date(existing.date).getTime() - new Date(existing.respond_by).getTime()
            const newRb = new Date(new Date(data.date).getTime() - offset)
            data.respond_by = newRb.toISOString().split('T')[0]
          }
          await db('games').where('id', existing.id).update(overrideAwareWrite({ ...data, date_updated: new Date() }, existing))
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

/** The groups to read standings for: every group a KSCW team plays in, minus
 *  the cup rounds (a cup group has no table — the Game Center answers []).
 *  Each with its phase and league, the shape /indoor/ranking used to return. */
export function standingsGroups(games) {
  const out = new Map()
  for (const g of games || []) {
    const id = g.group?.groupId
    if (!id || out.has(id)) continue
    if (!(isKscwTeamId(g.teams?.home?.teamId) || isKscwTeamId(g.teams?.away?.teamId))) continue
    if (/cup/i.test(g.league?.caption || '')) continue
    out.set(id, { groupId: id, phaseId: g.phase?.phaseId, leagueId: g.league?.leagueId })
  }
  return [...out.values()]
}

export async function syncSvRankings(db, log, feed) {
  log.info('[SV Sync] Fetching rankings...')

  const gamesData = feed ?? await fetchKscwFeed()
  const wanted = standingsGroups(gamesData)
  // A group known to have a table, to find the action again if svrz.ch redeployed.
  const probe = wanted[0]?.groupId
  const allGroups = []
  for (const grp of wanted) {
    allGroups.push({ ...grp, ranking: await fetchStandings(grp.groupId, probe) })
  }

  // Caption and season lookups, from the same feed (they used to cost a second
  // /indoor/games call whose silent failure filed rankings under "Group <id>").
  const captions = { groups: {}, leagues: {}, phases: {} }
  // Season-year lookups (league.season is the start year as an int, e.g. 2025 = 2025/26).
  // Used to label each ranking group with ITS OWN season rather than a single
  // current-date guess — so a new season's rankings file under the right season
  // string and never overwrite the prior season's archived rows.
  const seasonYearByGroup = {}
  const seasonYearByLeague = {}
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
