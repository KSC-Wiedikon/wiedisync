/**
 * J+S (Jugend+Sport) NDS export.
 * GET /kscw/js-export/team/:teamId?season=YYYY/YY
 *
 * Builds the row data for the two Nationale-Datenbank-Sport import CSVs for ONE
 * team + season:
 *   - activities  → AKTIVITAETSTYP; DATUM; ZEIT; DAUER; ORT (+ FOKUS, client-added)
 *   - attendance  → PERSONENNUMMER; FUNKTION; DATUM; AKTIVITÄTSTYP; ZEIT; DAUER; ORT
 *
 * Why an endpoint (not client-side): the J+S Personennummer (`members.js_id`) is a
 * federal personal identifier and is deliberately NOT in any items-API member-read
 * grant. A coach also can't read a fellow LEADER's member row (the LEADER member
 * scope only covers players via `member_teams`). So the export reads everything
 * with the service-role knex handle and gates on coach/TR/admin of the team here.
 *
 * Reads only → no actor capture needed (repo audit rule).
 *
 * J+S field rules baked in (per the BASPO import spec, jugendundsport.ch/datenimport):
 *   - Training  carries DATUM + ZEIT + DAUER + ORT (ZEIT and ORT are MANDATORY).
 *   - Wettkampf carries DATUM only — ZEIT, DAUER and ORT are NOT allowed.
 *   - Trainingstag carries DATUM + DAUER (exactly 240 or 300) only.
 *   - Lagertag  carries DATUM only.
 *   - DAUER is a closed value set, not a measured length — see TRAINING_DAUER_MIN.
 *   - Cancelled activities are excluded.
 *   - Attendance = roster (players + leaders) MINUS anyone with a declined RSVP or a
 *     covering absence on that date (the positive-absence signal only).
 */

// DAUER is a closed value set fixed by the NDS import spec
// (Aktivitaeten-Import_230328_de, p.1), keyed on Nutzergruppe + Aktivitätstyp +
// Hauptsportart. KSCW runs NG 1 with a Hauptsportart per Art. 1 Abs. 1
// J+S-V-BASPO → Training 60|75|90, Trainingstag 240|300, Wettkampf "keine
// Angabe der Dauer". A measured block length (105, 120, …) is rejected on
// import, so every Training is reported as the full 90.
// ⚠ NG-dependent: under NG 2 a Wettkampf DOES carry a duration. If a course
// ever runs under another Nutzergruppe this has to become a per-course setting.
const TRAINING_DAUER_MIN = 90
const TRAININGSTAG_LONG_MIN = 300
const TRAININGSTAG_SHORT_MIN = 240
const JS_ACTIVITY_TYPES = new Set(['Training', 'Wettkampf', 'Trainingstag', 'Lagertag'])

// ── Pure helpers (unit-tested in __tests__/js-export.test.js) ──────────────────

/** 'YYYY-MM-DD' → 'DD.MM.YYYY' (Swiss dot format, as the NDS DE template expects). */
export function ymdToDots(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** 'HH:MM[:SS]' → 'HH:MM'. */
export function hhmm(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ''))
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

/** Accept a duration only when it is a sane positive minute count, else ''. */
export function sanitizeDauer(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 600) return ''
  return Math.round(n)
}

/** Apply the per-type J+S field-suppression rules to a raw {zeit,dauer,ort}. */
export function applyJsFieldRules(type, raw) {
  switch (type) {
    case 'Wettkampf':
      return { zeit: '', dauer: '', ort: '' }
    case 'Trainingstag': {
      // 240 or 300 — nothing else. A 4.5h event (270) or a 6h one (360) is out
      // of the permitted set and the import rejects the whole file.
      const d = sanitizeDauer(raw.dauer)
      return { zeit: '', dauer: d && d >= 270 ? TRAININGSTAG_LONG_MIN : TRAININGSTAG_SHORT_MIN, ort: '' }
    }
    case 'Lagertag':
      return { zeit: '', dauer: '', ort: '' }
    case 'Training':
    default:
      return { zeit: raw.zeit || '', dauer: TRAINING_DAUER_MIN, ort: raw.ort || '' }
  }
}

/** 0=Mon..6=Sun for a 'YYYY-MM-DD' string (matches Absence.days_of_week). */
export function weekdayMon0(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return -1
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** Does an absence (date-range, weekly-aware) cover a given day? */
export function absenceCoversDate(a, ymd, weekday) {
  if (!(a.start_ymd <= ymd && ymd <= a.end_ymd)) return false
  if (a.type === 'weekly') {
    const dow = Array.isArray(a.days_of_week) ? a.days_of_week.map(Number) : []
    if (dow.length && !dow.includes(weekday)) return false
  }
  return true
}

/** Season string "YYYY/YY" → { season, start, end } (Sep 1 → Aug 31). Null if malformed. */
export function seasonWindow(season) {
  const m = /^(\d{4})\/(\d{2})$/.exec(String(season || ''))
  if (!m) return null
  const startYear = Number(m[1])
  return { season, start: `${startYear}-09-01`, end: `${startYear + 1}-08-31` }
}

/** Validate a real calendar 'YYYY-MM-DD' date; returns it or null (rejects 2026-13-40). */
export function parseYmd(v) {
  const s = String(v ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

function normalizeRole(role) {
  if (Array.isArray(role)) return role
  if (typeof role === 'string') { try { const p = JSON.parse(role); return Array.isArray(p) ? p : [] } catch { return [] } }
  return []
}

function fullName(r) {
  return [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
}

// ── Route ─────────────────────────────────────────────────────────────────────

export function registerJsExport(router, { database, logger }) {
  const log = logger.child({ endpoint: 'js-export' })

  router.get('/js-export/team/:teamId', async (req, res) => {
    try {
      const isDirectusAdmin = req.accountability?.admin === true
      const userId = req.accountability?.user
      if (!userId && !isDirectusAdmin) {
        return res.status(401).json({ error: 'Authentication required' })
      }

      const teamId = req.params.teamId
      const win = seasonWindow(req.query.season)
      if (!win) {
        return res.status(400).json({ error: 'Invalid or missing season (expected YYYY/YY)', code: 'bad_season' })
      }
      const { season } = win
      let startYMD = win.start
      let endYMD = win.end
      // Optional explicit date-window override (the coach sets a from/to to scope
      // which activities + events fall in range). The roster stays season-tagged;
      // only the activity window moves.
      if (req.query.start != null || req.query.end != null) {
        const s = parseYmd(req.query.start)
        const e = parseYmd(req.query.end)
        if (!s || !e) {
          return res.status(400).json({ error: 'Invalid start/end (expected YYYY-MM-DD)', code: 'bad_range' })
        }
        if (s > e) {
          return res.status(400).json({ error: 'start must be on or before end', code: 'bad_range' })
        }
        startYMD = s
        endYMD = e
      }

      const team = await database('teams')
        .where('id', teamId)
        .first('id', 'name', 'sport', 'season', 'team_id', 'active')
      if (!team) return res.status(404).json({ error: 'Team not found', code: 'no_team' })

      // Gate: caller must be an app-admin OR a coach/TR of this team.
      const member = userId ? await database('members').where('user', userId).first('id', 'role') : null
      const roleArr = normalizeRole(member?.role)
      const isAppAdmin = isDirectusAdmin || ['admin', 'superuser', 'vb_admin', 'bb_admin', 'vorstand'].some((r) => roleArr.includes(r))
      if (!isAppAdmin) {
        if (!member) return res.status(403).json({ error: 'No member profile', code: 'no_member' })
        const coach = await database('teams_coaches').where({ teams_id: teamId, members_id: member.id }).first('teams_id')
        const tr = coach ? null : await database('teams_responsibles').where({ teams_id: teamId, members_id: member.id }).first('teams_id')
        if (!coach && !tr) {
          return res.status(403).json({ error: 'You do not lead this team', code: 'not_leader' })
        }
      }

      // ── Resolve the team LINEAGE ────────────────────────────────────────────
      // A team exists once per season: the rollover clones it to a NEW id and
      // archives the old row, keyed on `team_id` (falling back to the name) —
      // see the `seen` set in game-scheduling.js rollover-season. The picker
      // only ever offers ACTIVE teams, so exporting any season but the current
      // one has to hop to the sibling row. Two separate needs:
      //
      //   rosterTeamId  — the row for the REQUESTED season. member_teams hangs
      //                   off a season-specific team id, so this alone pins the
      //                   roster; `mt.season` must NOT also be filtered (it is a
      //                   create-time stamp, and every row on an active team
      //                   carries the CURRENT season — which is why asking for
      //                   last season returned zero participants and the CSV
      //                   shipped leaders only, with no warning).
      //   lineageIds    — EVERY season's row. Activities are split across them
      //                   and not consistently: migration 107 re-pointed
      //                   orphaned games onto the active team while past
      //                   trainings stayed on the archived one (prod D1,
      //                   last season: 16 trainings archived, 15 of 18 games
      //                   active). The date window is what actually scopes the
      //                   season here, so union the lineage and let it filter.
      const lineage = await database('teams')
        .where((qb) => {
          if (team.team_id) qb.where('team_id', team.team_id)
          else qb.where('name', team.name).where('sport', team.sport)
        })
        .select('id', 'season')
      const lineageIds = [...new Set([String(team.id), ...lineage.map((t) => String(t.id))])]
      const seasonRow = lineage.find((t) => t.season === season)
      const rosterTeamId = seasonRow ? String(seasonRow.id) : (team.season === season ? String(team.id) : null)
      if (!rosterTeamId) {
        return res.status(404).json({
          error: `This team has no roster for season ${season} (it exists for: ${
            [...new Set(lineage.map((t) => t.season).filter(Boolean))].sort().join(', ') || 'no season'
          })`,
          code: 'no_team_for_season',
        })
      }

      // ── Activities ──────────────────────────────────────────────────────────
      const trainings = await database('trainings as t')
        .leftJoin('halls as h', 'h.id', 't.hall')
        .whereIn('t.team', lineageIds)
        .where('t.date', '>=', startYMD).where('t.date', '<=', endYMD)
        .where('t.cancelled', false)
        .select(
          't.id as id',
          database.raw("to_char(t.date,'YYYY-MM-DD') as date_ymd"),
          't.start_time as start_time',
          database.raw('COALESCE(h.name, t.hall_name) as ort'),
        )

      const games = await database('games as g')
        .whereIn('g.kscw_team', lineageIds)
        .where('g.date', '>=', startYMD).where('g.date', '<=', endYMD)
        .whereNot('g.status', 'cancelled')
        .whereNotNull('g.away_team').whereNotNull('g.time')
        .select('g.id as id', database.raw("to_char(g.date,'YYYY-MM-DD') as date_ymd"))

      const evLinks = await database('events_teams').whereIn('teams_id', lineageIds).select('events_id')
      const linkedEventIds = [...new Set(evLinks.map((r) => r.events_id).filter((x) => x != null))]
      let events = []
      if (linkedEventIds.length) {
        events = await database('events as e')
          .whereIn('e.id', linkedEventIds)
          .where('e.js_relevant', true)
          .where('e.cancelled', false)
          .whereRaw("to_char(e.start_date AT TIME ZONE 'Europe/Zurich','YYYY-MM-DD') >= ?", [startYMD])
          .whereRaw("to_char(e.start_date AT TIME ZONE 'Europe/Zurich','YYYY-MM-DD') <= ?", [endYMD])
          .select(
            'e.id as id', 'e.js_activity_type as js_activity_type', 'e.all_day as all_day', 'e.location as location',
            database.raw("to_char(e.start_date AT TIME ZONE 'Europe/Zurich','YYYY-MM-DD') as date_ymd"),
            database.raw("to_char(e.start_date AT TIME ZONE 'Europe/Zurich','HH24:MI') as start_hm"),
            database.raw('EXTRACT(EPOCH FROM (e.end_date - e.start_date))/60 as dauer_min'),
          )
      }

      // Normalise every activity to a common shape (+ apply J+S field rules).
      const activities = []
      for (const t of trainings) {
        activities.push({
          type: 'Training', dateYMD: t.date_ymd, datum: ymdToDots(t.date_ymd),
          zeit: hhmm(t.start_time), dauer: TRAINING_DAUER_MIN, ort: (t.ort || '').trim(),
          partType: 'training', activityId: String(t.id),
        })
      }
      for (const g of games) {
        activities.push({
          type: 'Wettkampf', dateYMD: g.date_ymd, datum: ymdToDots(g.date_ymd),
          zeit: '', dauer: '', ort: '',
          partType: 'game', activityId: String(g.id),
        })
      }
      for (const e of events) {
        const type = JS_ACTIVITY_TYPES.has(e.js_activity_type) ? e.js_activity_type : 'Training'
        const cells = applyJsFieldRules(type, {
          zeit: e.all_day ? '' : hhmm(e.start_hm), dauer: e.dauer_min, ort: (e.location || '').trim(),
        })
        activities.push({
          type, dateYMD: e.date_ymd, datum: ymdToDots(e.date_ymd),
          zeit: cells.zeit, dauer: cells.dauer, ort: cells.ort,
          partType: 'event', activityId: String(e.id),
        })
      }
      activities.sort((a, b) => a.dateYMD.localeCompare(b.dateYMD) || a.type.localeCompare(b.type))

      // ── Roster (players) + leaders ──────────────────────────────────────────
      // ⚠ No `mt.season` filter — `rosterTeamId` already pins the season (see
      // the lineage block above). Adding it back reintroduces the zero-
      // participant export.
      const playerRows = await database('member_teams as mt')
        .join('members as m', 'm.id', 'mt.member')
        .where('mt.team', rosterTeamId)
        .andWhere((qb) => qb.whereNull('mt.guest_level').orWhere('mt.guest_level', 0))
        .select('m.id as id', 'm.first_name as first_name', 'm.last_name as last_name', 'm.js_id as js_id')

      const coachRows = await database('teams_coaches').where('teams_id', rosterTeamId).select('members_id')
      const trRows = await database('teams_responsibles').where('teams_id', rosterTeamId).select('members_id')
      const leaderIds = [...new Set([...coachRows, ...trRows].map((r) => r.members_id).filter((x) => x != null))]
      let leaderRows = []
      if (leaderIds.length) {
        leaderRows = await database('members').whereIn('id', leaderIds)
          .select('id', 'first_name', 'last_name', 'js_id')
      }

      // persons: leaders (Leiter/in) win over players (Teilnehmer/in).
      const persons = new Map() // memberId → { js_id, funktion, name }
      const participantsMissingJsId = new Set()
      const leadersMissingJsId = new Set()
      const leaderIdSet = new Set(leaderRows.map((l) => String(l.id)))
      for (const l of leaderRows) {
        const js = l.js_id ? String(l.js_id).trim() : ''
        if (!js) { leadersMissingJsId.add(fullName(l)); continue }
        persons.set(String(l.id), { js_id: js, funktion: 'Leiter/in', name: fullName(l) })
      }
      for (const p of playerRows) {
        const pid = String(p.id)
        if (leaderIdSet.has(pid)) continue // already handled as a leader
        const js = p.js_id ? String(p.js_id).trim() : ''
        if (!js) { participantsMissingJsId.add(fullName(p)); continue }
        persons.set(pid, { js_id: js, funktion: 'Teilnehmer/in', name: fullName(p) })
      }

      // ── Exclusion signals: declined RSVPs + covering absences ───────────────
      const trainingIds = trainings.map((t) => String(t.id))
      const gameIds = games.map((g) => String(g.id))
      const eventIds = events.map((e) => String(e.id))
      const declineSet = new Set()
      if (trainingIds.length || gameIds.length || eventIds.length) {
        const groups = [['training', trainingIds], ['game', gameIds], ['event', eventIds]].filter(([, ids]) => ids.length)
        const declined = await database('participations')
          .where('status', 'declined')
          .where((builder) => {
            groups.forEach(([type, ids], i) => {
              builder[i === 0 ? 'where' : 'orWhere']((b) => b.where('activity_type', type).whereIn('activity_id', ids))
            })
          })
          .select('activity_type', 'activity_id', 'member')
        for (const d of declined) declineSet.add(`${d.activity_type}|${d.activity_id}|${d.member}`)
      }

      const allPersonIds = [...persons.keys()]
      const absencesByMember = new Map()
      if (allPersonIds.length) {
        const absenceRows = await database('absences')
          .whereIn('member', allPersonIds)
          .where('end_date', '>=', startYMD).where('start_date', '<=', endYMD)
          .select(
            'member',
            database.raw("to_char(start_date,'YYYY-MM-DD') as start_ymd"),
            database.raw("to_char(end_date,'YYYY-MM-DD') as end_ymd"),
            'type', 'days_of_week',
          )
        for (const a of absenceRows) {
          const key = String(a.member)
          const dow = Array.isArray(a.days_of_week) ? a.days_of_week
            : (typeof a.days_of_week === 'string' ? (() => { try { return JSON.parse(a.days_of_week) } catch { return [] } })() : [])
          const arr = absencesByMember.get(key) || []
          arr.push({ start_ymd: a.start_ymd, end_ymd: a.end_ymd, type: a.type, days_of_week: dow })
          absencesByMember.set(key, arr)
        }
      }

      const isAbsent = (memberId, ymd) => {
        const list = absencesByMember.get(memberId)
        if (!list || !list.length) return false
        const wd = weekdayMon0(ymd)
        return list.some((a) => absenceCoversDate(a, ymd, wd))
      }

      // ── Attendance rows: one per (activity, present person) ──────────────────
      const attendance = []
      for (const a of activities) {
        for (const [memberId, person] of persons) {
          if (declineSet.has(`${a.partType}|${a.activityId}|${memberId}`)) continue
          if (isAbsent(memberId, a.dateYMD)) continue
          attendance.push({
            personennummer: person.js_id, funktion: person.funktion, datum: a.datum,
            type: a.type, zeit: a.zeit, dauer: a.dauer, ort: a.ort,
          })
        }
      }

      // A leaders-only roster is never a legitimate J+S export — it is the
      // signature of a season/team mismatch, and it shipped silently for months
      // because every "missing J+S id" array derives from playerRows too, so an
      // empty roster produced an export with no warnings at all.
      const emptyRoster = playerRows.length === 0 && leaderRows.length > 0
      if (emptyRoster) {
        log.warn({
          msg: 'js-export: roster resolved to zero participants',
          teamId, rosterTeamId, season, teamSeason: team.season, lineageIds,
        })
      }

      res.json({
        data: {
          team: { id: team.id, name: team.name, sport: team.sport, rosterTeamId },
          season, seasonStart: startYMD, seasonEnd: endYMD,
          activities: activities.map((a) => ({ type: a.type, datum: a.datum, zeit: a.zeit, dauer: a.dauer, ort: a.ort })),
          attendance,
          counts: {
            trainings: trainings.length, games: games.length, events: events.length,
            players: playerRows.length, leaders: leaderRows.length, activities: activities.length,
          },
          warnings: {
            participantsMissingJsId: [...participantsMissingJsId].sort(),
            leadersMissingJsId: [...leadersMissingJsId].sort(),
            emptyRoster,
          },
        },
      })
    } catch (err) {
      log.error({
        msg: `js-export/team/:teamId: ${err.message}`,
        endpoint: 'js-export/team/:teamId',
        userId: req.accountability?.user || null,
        method: req.method, stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })
}
