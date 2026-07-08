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
 *   - Training  carries DATUM + ZEIT + DAUER + ORT.
 *   - Wettkampf carries DATUM + DAUER only — ZEIT and ORT are NOT allowed.
 *   - Trainingstag carries DATUM + DAUER (240/300) only.
 *   - Lagertag  carries DATUM only.
 *   - Games have no end-time → fixed DAUER per sport (Volleyball 120, Basketball 90).
 *   - Cancelled activities are excluded.
 *   - Attendance = roster (players + leaders) MINUS anyone with a declined RSVP or a
 *     covering absence on that date (the positive-absence signal only).
 */

const GAME_DURATION_MIN = { volleyball: 120, basketball: 90 }
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

function toMinutes(hm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Accept a duration only when it is a sane positive minute count, else ''. */
export function sanitizeDauer(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 600) return ''
  return Math.round(n)
}

/** Training block length in minutes; honours the migration-191 game auto-shorten
 *  (report the ORIGINAL end when the block was trimmed for a game warm-up). */
export function computeTrainingMinutes(t) {
  const start = toMinutes(hhmm(t.start_time))
  const rawEnd = t.auto_shortened_by_game && t.original_end_time ? t.original_end_time : t.end_time
  const end = toMinutes(hhmm(rawEnd))
  if (start == null || end == null || end <= start) return ''
  return end - start
}

/** Apply the per-type J+S field-suppression rules to a raw {zeit,dauer,ort}. */
export function applyJsFieldRules(type, raw, opts = {}) {
  const gameMin = opts.gameMin ?? 90
  switch (type) {
    case 'Wettkampf':
      return { zeit: '', dauer: gameMin, ort: '' }
    case 'Trainingstag': {
      const d = sanitizeDauer(raw.dauer)
      return { zeit: '', dauer: d && d >= 240 ? d : 240, ort: '' }
    }
    case 'Lagertag':
      return { zeit: '', dauer: '', ort: '' }
    case 'Training':
    default:
      return { zeit: raw.zeit || '', dauer: sanitizeDauer(raw.dauer), ort: raw.ort || '' }
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
      const { season, start: startYMD, end: endYMD } = win

      const team = await database('teams').where('id', teamId).first('id', 'name', 'sport')
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

      const gameMin = GAME_DURATION_MIN[team.sport] ?? 90

      // ── Activities ──────────────────────────────────────────────────────────
      const trainings = await database('trainings as t')
        .leftJoin('halls as h', 'h.id', 't.hall')
        .where('t.team', teamId)
        .where('t.date', '>=', startYMD).where('t.date', '<=', endYMD)
        .where('t.cancelled', false)
        .select(
          't.id as id',
          database.raw("to_char(t.date,'YYYY-MM-DD') as date_ymd"),
          't.start_time as start_time', 't.end_time as end_time',
          't.original_end_time as original_end_time', 't.auto_shortened_by_game as auto_shortened_by_game',
          database.raw('COALESCE(h.name, t.hall_name) as ort'),
        )

      const games = await database('games as g')
        .where('g.kscw_team', teamId)
        .where('g.date', '>=', startYMD).where('g.date', '<=', endYMD)
        .whereNot('g.status', 'cancelled')
        .whereNotNull('g.away_team').whereNotNull('g.time')
        .select('g.id as id', database.raw("to_char(g.date,'YYYY-MM-DD') as date_ymd"))

      const evLinks = await database('events_teams').where('teams_id', teamId).select('events_id')
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
          zeit: hhmm(t.start_time), dauer: computeTrainingMinutes(t), ort: (t.ort || '').trim(),
          partType: 'training', activityId: String(t.id),
        })
      }
      for (const g of games) {
        activities.push({
          type: 'Wettkampf', dateYMD: g.date_ymd, datum: ymdToDots(g.date_ymd),
          zeit: '', dauer: gameMin, ort: '',
          partType: 'game', activityId: String(g.id),
        })
      }
      for (const e of events) {
        const type = JS_ACTIVITY_TYPES.has(e.js_activity_type) ? e.js_activity_type : 'Training'
        const cells = applyJsFieldRules(type, {
          zeit: e.all_day ? '' : hhmm(e.start_hm), dauer: e.dauer_min, ort: (e.location || '').trim(),
        }, { gameMin })
        activities.push({
          type, dateYMD: e.date_ymd, datum: ymdToDots(e.date_ymd),
          zeit: cells.zeit, dauer: cells.dauer, ort: cells.ort,
          partType: 'event', activityId: String(e.id),
        })
      }
      activities.sort((a, b) => a.dateYMD.localeCompare(b.dateYMD) || a.type.localeCompare(b.type))

      // ── Roster (players) + leaders ──────────────────────────────────────────
      const playerRows = await database('member_teams as mt')
        .join('members as m', 'm.id', 'mt.member')
        .where('mt.team', teamId).where('mt.season', season)
        .andWhere((qb) => qb.whereNull('mt.guest_level').orWhere('mt.guest_level', 0))
        .select('m.id as id', 'm.first_name as first_name', 'm.last_name as last_name', 'm.js_id as js_id')

      const coachRows = await database('teams_coaches').where('teams_id', teamId).select('members_id')
      const trRows = await database('teams_responsibles').where('teams_id', teamId).select('members_id')
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

      res.json({
        data: {
          team: { id: team.id, name: team.name, sport: team.sport },
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
