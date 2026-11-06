/**
 * Moved home games: sends what trg_games_duty_recheck queues (migration 451), and the
 * follow-ups while nobody answers or a seat stays empty.
 *
 * Claiming is one UPDATE over a FOR UPDATE SKIP LOCKED pick, as in capacity-moves.js.
 *
 * Follow-ups, owner 06.11.2026:
 *   - no answer after 2 days: one reminder;
 *   - no answer 5 days before the game, or at once if less time is left: the game team's
 *     coaches and team responsibles are warned, and the person stays on the seat;
 *   - a refused seat still empty 72 and 24 hours before the game: those leaders again,
 *     and the 24-hour one copies the sport's TK.
 *
 * A bad feed could move a whole season at once and every one of those is a real person's
 * email, so past MAX_GAMES_AT_ONCE games in one go nothing goes out: the rows are held and
 * the admin is told. POST /kscw/admin/duty-recheck/release sends or drops them.
 */
import { FRONTEND_URL } from '../../kscw-endpoints/src/email-template.js'
import { sportTkEmails } from '../../kscw-endpoints/src/duty-late.js'
import { CLAIM_DEFS } from '../../kscw-endpoints/src/duty-seats.js'
import {
  notifyDuty, loadGame, gameVars, matchup, teamLeaderIds, memberName, whenLabel, dutyRecheckEmailContent,
} from '../../kscw-endpoints/src/duty-recheck-core.js'

export const MAX_GAMES_AT_ONCE = 20
const CLAIM_BATCH = 200
const REMIND_AFTER_DAYS = 2
const WARN_LEADERS_DAYS = 5

const ADMIN_EMAIL = process.env.DUTY_RECHECK_ADMIN_EMAIL || process.env.OWNER_EMAIL || 'admin@wiedisync.kscw.ch'

const DUE = `notified_at IS NULL AND send_after <= now() AND held_at IS NULL`

const CLAIMED_COLS = `m.id, m.game, m.role, m.member, m.duty_team, m.invited_by, m.kind, m.reason, m.home_team, m.away_team,
  to_char(m.old_date, 'DD.MM.YYYY') AS old_date_ch, to_char(m.old_time, 'HH24:MI') AS old_time_ch, m.old_hall,
  to_char(m.new_date, 'DD.MM.YYYY') AS new_date_ch, to_char(m.new_time, 'HH24:MI') AS new_time_ch, m.new_hall`

/** Too much at once? Then hold it all. True when nothing should go out now. */
export async function holdIfTooMany(ctx) {
  const { database: db, logger: log } = ctx
  const { rows } = await db.raw(`
    SELECT count(DISTINCT COALESCE(game::text, id::text)) FILTER (WHERE ${DUE} AND released_at IS NULL AND kind <> 'invite')::int AS games,
           count(*) FILTER (WHERE notified_at IS NULL AND held_at IS NOT NULL)::int AS held
      FROM duty_rechecks
     WHERE notified_at IS NULL`)
  const { games, held } = rows[0] ?? { games: 0, held: 0 }
  if (held === 0 && games <= MAX_GAMES_AT_ONCE) return false
  if (games > 0) await db.raw(`UPDATE duty_rechecks SET held_at = now() WHERE ${DUE} AND released_at IS NULL AND kind <> 'invite'`)
  if (held === 0) {
    log?.error?.({ msg: `[duty-recheck] ${games} games moved at once: held, nothing sent`, event: 'duty_recheck_held' })
    try {
      const mail = new ctx.services.MailService({ schema: await ctx.getSchema(), knex: db })
      await mail.send({
        to: ADMIN_EMAIL,
        subject: `WiediSync: ${games} moved home games held, nobody was asked`,
        text: `${games} home games changed date, time or hall at once, more than the ${MAX_GAMES_AT_ONCE} the duty questions send on their own. `
          + 'Nobody has been asked. Check the game feed, then POST /kscw/admin/duty-recheck/release with {"send": true} to send them, or {"send": false} to drop them.',
      })
    } catch (err) {
      log?.warn?.({ msg: `[duty-recheck] hold alert failed: ${err.message}`, event: 'duty_recheck_hold_alert' })
    }
  }
  return true
}

async function supersede(db, id) {
  await db('duty_rechecks').where('id', id).update({ status: 'superseded' })
}

async function sendAsk(ctx, row) {
  const game = row.game != null ? await loadGame(ctx.database, row.game) : null
  const def = CLAIM_DEFS[row.role]
  // Handed on or moved again meanwhile: this question is no longer theirs.
  if (!game || !game.live || game.started || !def || Number(game[def.member]) !== Number(row.member)) {
    await supersede(ctx.database, row.id)
    return
  }
  await notifyDuty(ctx, [row.member], 'ask', {
    ...gameVars(game), roleKey: row.role, was: whenLabel(row.old_date_ch, row.old_time_ch, row.old_hall),
  }, { gameId: game.id, email: true, tag: `duty-recheck-${game.id}-${row.role}` })
}

async function sendInvite(ctx, row) {
  const game = row.game != null ? await loadGame(ctx.database, row.game) : null
  const def = CLAIM_DEFS[row.role]
  if (!game || !game.live || game.started || !def || game[def.member] != null) {
    await supersede(ctx.database, row.id)
    return
  }
  await notifyDuty(ctx, [row.member], 'invite', {
    ...gameVars(game), roleKey: row.role, by: await memberName(ctx.database, row.invited_by),
  }, { gameId: game.id, email: true, tag: `duty-recheck-invite-${game.id}-${row.role}` })
}

async function sendNotice(ctx, row) {
  const vars = {
    game: matchup(row.home_team, row.away_team),
    roleKey: row.role,
    date: row.old_date_ch || row.new_date_ch || '',
    time: row.new_time_ch || row.old_time_ch || '',
    when: [row.new_date_ch, row.new_time_ch].filter(Boolean).join(', '),
    hall: row.new_hall || row.old_hall || '',
    now: whenLabel(row.new_date_ch, row.new_time_ch, row.new_hall),
  }
  if (row.reason === 'became_away' && row.game != null) {
    // An away game's table is the opponent's. Only if this person still holds it.
    const def = CLAIM_DEFS[row.role]
    if (def) {
      await ctx.database('games').where('id', row.game).where(def.member, row.member)
        .update({ [def.member]: null, [def.name]: null, [def.at]: null })
    }
  }
  if (row.reason === 'hall_same_site') {
    await notifyDuty(ctx, [row.member], 'hall', vars, { gameId: row.game, tag: `duty-recheck-hall-${row.game}-${row.role}` })
  } else if (row.reason === 'postponed') {
    await notifyDuty(ctx, [row.member], 'postponed', { ...vars, now: undefined }, { gameId: row.game, email: true, tag: `duty-recheck-postponed-${row.game}-${row.role}` })
  } else {
    await notifyDuty(ctx, [row.member], 'released', { ...vars, now: undefined }, { gameId: row.game, email: true, tag: `duty-recheck-off-${row.game}-${row.role}` })
  }
}

async function sendTeamNotice(ctx, row) {
  const game = row.game != null ? await loadGame(ctx.database, row.game) : null
  if (!game || !game.live || game.started) return
  const leaders = await teamLeaderIds(ctx.database, [row.duty_team])
  await notifyDuty(ctx, leaders, 'teamNotice', gameVars(game), { gameId: game.id, tag: `duty-recheck-team-${game.id}` })
}

/** Send what is due. Runs every minute. */
export async function drainDutyRechecks(ctx) {
  if (await holdIfTooMany(ctx)) return { claimed: 0, held: true }
  const { rows } = await ctx.database.raw(`
    UPDATE duty_rechecks m SET notified_at = now()
     WHERE m.id IN (
       SELECT id FROM duty_rechecks
        WHERE ${DUE}
        ORDER BY id
        LIMIT ?
        FOR UPDATE SKIP LOCKED)
    RETURNING ${CLAIMED_COLS}`, [CLAIM_BATCH])
  for (const row of rows.sort((a, b) => Number(a.id) - Number(b.id))) {
    try {
      if (row.kind === 'ask') await sendAsk(ctx, row)
      else if (row.kind === 'invite') await sendInvite(ctx, row)
      else if (row.kind === 'notice') await sendNotice(ctx, row)
      else if (row.kind === 'team_notice') await sendTeamNotice(ctx, row)
    } catch (err) {
      ctx.logger?.error?.({ msg: `[duty-recheck] row ${row.id} (${row.kind}): ${err.message}`, event: 'duty_recheck_send', stack: err.stack })
    }
  }
  return { claimed: rows.length, held: false }
}

/** Email the sport's TK one copy of the last call, in German like the other TK alarms. */
async function copyTk(ctx, game, role, vars) {
  try {
    if ((process.env.PUBLIC_URL || '').includes('directus-dev') && process.env.DUTY_RECHECK_FORCE_EMAIL !== '1') return
    const to = await sportTkEmails(ctx.database, game.team_sport)
    if (!to.length) return
    const content = dutyRecheckEmailContent({ locale: 'de', kind: 'leaderOpen', vars: { ...vars, roleKey: role }, url: `${FRONTEND_URL || ''}/scorer` })
    const mail = new ctx.services.MailService({ schema: await ctx.getSchema(), knex: ctx.database })
    await mail.send({ to, subject: content.subject, html: content.html, text: content.text })
  } catch (err) {
    ctx.logger?.warn?.({ msg: `[duty-recheck] TK copy for game ${game.id} failed: ${err.message}`, event: 'duty_recheck_tk' })
  }
}

/** Reminders, warnings and the last calls. Runs every quarter of an hour in the daytime. */
export async function sweepDutyRecheckFollowUps(ctx) {
  const { database: db } = ctx
  const counts = { closed: 0, reminded: 0, warned: 0, open72: 0, open24: 0 }

  const open = (await db.raw(`
    SELECT r.id, r.kind, r.game, r.role, r.member, r.reminded_at, r.leaders_warned_at,
           to_char(r.old_date, 'DD.MM.YYYY') AS old_date_ch, to_char(r.old_time, 'HH24:MI') AS old_time_ch, r.old_hall,
           r.notified_at <= now() - make_interval(days => ?) AS remind_due,
           ((g.date + g.time) AT TIME ZONE 'Europe/Zurich') <= now() + make_interval(days => ?) AS warn_due
      FROM duty_rechecks r JOIN games g ON g.id = r.game
     WHERE r.kind IN ('ask', 'invite') AND r.status = 'pending' AND r.notified_at IS NOT NULL`,
  [REMIND_AFTER_DAYS, WARN_LEADERS_DAYS])).rows

  for (const row of open) {
    const game = await loadGame(db, row.game)
    const def = CLAIM_DEFS[row.role]
    // Over, called off, or the seat changed hands: the delegate took it on the new date.
    const seatGone = !def || (row.kind === 'ask'
      ? Number(game?.[def.member]) !== Number(row.member)
      : game?.[def.member] != null)
    if (!game || !game.live || game.started || seatGone) {
      await supersede(db, row.id)
      counts.closed++
      continue
    }
    if (row.kind !== 'ask') continue
    const vars = { ...gameVars(game), roleKey: row.role, was: whenLabel(row.old_date_ch, row.old_time_ch, row.old_hall) }
    if (row.remind_due && !row.reminded_at) {
      await db('duty_rechecks').where('id', row.id).whereNull('reminded_at').update({ reminded_at: new Date() })
      await notifyDuty(ctx, [row.member], 'remind', vars, { gameId: game.id, email: true, tag: `duty-recheck-${game.id}-${row.role}` })
      counts.reminded++
    }
    if (row.warn_due && !row.leaders_warned_at) {
      await db('duty_rechecks').where('id', row.id).whereNull('leaders_warned_at').update({ leaders_warned_at: new Date() })
      const leaders = await teamLeaderIds(db, [game.kscw_team])
      await notifyDuty(ctx, leaders.filter((id) => id !== Number(row.member)), 'leaderSilent', {
        ...vars, name: await memberName(db, row.member),
      }, { gameId: game.id, email: true, tag: `duty-recheck-silent-${game.id}-${row.role}` })
      counts.warned++
    }
  }

  // A refused seat still empty. The latest refusal of the seat carries the stamps; a
  // refusal already inside a window has just told the leaders, so that window is skipped.
  const seats = (await db.raw(`
    SELECT DISTINCT ON (r.game, r.role) r.id, r.game, r.role, r.open_reminded_72h_at, r.open_reminded_24h_at,
           ((g.date + g.time) AT TIME ZONE 'Europe/Zurich') - interval '72 hours' AS due_72h,
           ((g.date + g.time) AT TIME ZONE 'Europe/Zurich') - interval '24 hours' AS due_24h,
           r.answered_at
      FROM duty_rechecks r JOIN games g ON g.id = r.game
     WHERE r.kind = 'ask' AND r.status = 'refused'
       AND ((g.date + g.time) AT TIME ZONE 'Europe/Zurich') > now()
       AND ((g.date + g.time) AT TIME ZONE 'Europe/Zurich') <= now() + interval '72 hours'
     ORDER BY r.game, r.role, r.id DESC`)).rows

  const now = Date.now()
  for (const seat of seats) {
    const game = await loadGame(db, seat.game)
    const def = CLAIM_DEFS[seat.role]
    if (!game || !game.live || game.started || !def || game[def.member] != null) continue
    const answered = new Date(seat.answered_at).getTime()
    const due24 = new Date(seat.due_24h).getTime()
    const due72 = new Date(seat.due_72h).getTime()
    const call = (!seat.open_reminded_24h_at && now >= due24 && answered < due24) ? '24h'
      : (!seat.open_reminded_72h_at && now >= due72 && now < due24 && answered < due72) ? '72h'
        : null
    if (!call) continue
    await db('duty_rechecks').where('id', seat.id).update(
      call === '24h' ? { open_reminded_24h_at: new Date(), open_reminded_72h_at: new Date() } : { open_reminded_72h_at: new Date() },
    )
    const vars = { ...gameVars(game), roleKey: seat.role }
    const leaders = await teamLeaderIds(db, [game.kscw_team])
    await notifyDuty(ctx, leaders, 'leaderOpen', vars, { gameId: game.id, email: true, tag: `duty-recheck-open-${game.id}-${seat.role}` })
    if (call === '24h') await copyTk(ctx, game, seat.role, vars)
    counts[call === '24h' ? 'open24' : 'open72']++
  }
  return counts
}
