/**
 * Swiss Volley Game Center client — KSC Wiedikon's games and the standings of
 * their groups, from the public Game Center the regional sites show
 * (https://www.svrz.ch/game-center).
 *
 * Why: the official API (api.volleyball.ch) runs on the same server as
 * VolleyManager (185.195.199.53), which refuses kscw-server since 25.11.2026.
 * svrz.ch is a separate host and serves the same Swiss Volley data — the game
 * objects carry the very field names sv-sync already read from the API
 * (gameId, playDate, teams.*.teamId, resultSummary, setResults, referees, hall,
 * league, group, phase), and the standings rows those of /indoor/ranking.
 *
 * How the page reads it (found 27.11.2026): Next.js server actions, POSTed to
 * /game-center with a `Next-Action: <id>` header and a JSON array body; the
 * answer is React flight text whose line `1:` is the value. The ids are build
 * hashes that change when svrz.ch redeploys — when a cached id stops answering
 * in the expected shape, the page's scripts are read and every server
 * reference in them tried, keeping the one whose answer passes the check.
 *
 * Ported from svrz_rc server/svrzGameCenter.ts (live there since 27.11.2026).
 */

export const GAME_CENTER_BASE = process.env.SV_GAME_CENTER_BASE || 'https://www.svrz.ch'
const TIMEOUT_MS = Number(process.env.SV_GAME_CENTER_TIMEOUT_MS || 60_000)
const HEADERS = { 'User-Agent': 'kscw-gamecenter/1.0', 'Accept-Language': 'de-CH,de;q=0.9' }

const ACTIONS = {
  // ["?clubId=…&includeCup=1&dateStart=YYYY-MM-DD&dateEnd=YYYY-MM-DD"] → [game]
  games: {
    id: process.env.SV_GC_GAMES_ACTION || '4f4a04331e8b7f7726ca7b74caf8b2e1358570d4',
    ok: (v) => Array.isArray(v) && v.every((g) => g && typeof g === 'object' && 'gameId' in g),
    probeOk: (v) => Array.isArray(v) && v.length > 0 && 'gameId' in v[0],
  },
  // [groupId] → [{ rank, teamId, teamCaption, games, points, wins, …, clubId }].
  // A cup group answers an empty table, which is a valid answer.
  standings: {
    id: process.env.SV_GC_STANDINGS_ACTION || '20ff53f8a207f3e1c3b116d33848242a02070dea',
    ok: (v) => Array.isArray(v) && v.every((r) => r && typeof r === 'object' && 'rank' in r),
    probeOk: (v) => Array.isArray(v) && v.length > 0 && 'rank' in v[0] && 'teamId' in v[0],
  },
}

/** The value on line `1:` of a flight answer, or undefined. */
export function flightValue(text) {
  const line = String(text).split('\n').find((l) => l.startsWith('1:'))
  if (!line) return undefined
  try { return JSON.parse(line.slice(2)) } catch { return undefined }
}

async function post(id, arg, fetchImpl) {
  const res = await fetchImpl(`${GAME_CENTER_BASE}/game-center`, {
    method: 'POST',
    headers: { ...HEADERS, 'Next-Action': id, Accept: 'text/x-component', 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify([arg]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return undefined
  // UTF-8 explicitly: the answer names no charset, and "Rämi" must not become "RÃ¤mi".
  return flightValue(Buffer.from(await res.arrayBuffer()).toString('utf8'))
}

async function discover(kind, probeArg, fetchImpl) {
  const page = await (await fetchImpl(`${GAME_CENTER_BASE}/game-center`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })).text()
  const scripts = [...new Set(page.match(/\/_next\/static\/chunks\/[^"'\s]+\.js/g) ?? [])]
  const ids = new Set()
  for (const src of scripts) {
    const js = await (await fetchImpl(`${GAME_CENTER_BASE}${src}`, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })).text()
    for (const m of js.matchAll(/\.\$\)\("([0-9a-f]{40})"\)/g)) ids.add(m[1])
  }
  for (const id of ids) {
    const v = await post(id, probeArg, fetchImpl).catch(() => undefined)
    if (ACTIONS[kind].probeOk(v)) return id
  }
  throw new Error(`Game Center: none of ${ids.size} server actions answers like "${kind}" — has svrz.ch changed?`)
}

/** One call of `kind`, re-finding the action once if the cached id fails.
 *  `probeArg` must surely have data; it is used only to find the action. */
async function act(kind, arg, probeArg, fetchImpl) {
  let v = await post(ACTIONS[kind].id, arg, fetchImpl)
  if (!ACTIONS[kind].ok(v)) {
    ACTIONS[kind].id = await discover(kind, probeArg, fetchImpl)
    v = await post(ACTIONS[kind].id, arg, fetchImpl)
  }
  if (!ACTIONS[kind].ok(v)) throw new Error(`Game Center "${kind}" did not answer for ${JSON.stringify(arg)}`)
  return v
}

/** The season [start, end) around `now`: 1 August to 1 August. The official
 *  API's /indoor/games answered the club's current season the same way. */
export function seasonWindow(now = new Date()) {
  const y = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return [`${y}-08-01`, `${y + 1}-08-01`]
}

/** Every game of one club in the current season, cups included — one call.
 *  Throws on failure, so a failed read is never taken for an empty season. */
export async function fetchClubSeasonGames(clubId, { now = new Date(), fetchImpl = fetch } = {}) {
  const [start, end] = seasonWindow(now)
  const query = `?clubId=${clubId}&includeCup=1&dateStart=${start}&dateEnd=${end}`
  return act('games', query, query, fetchImpl)
}

/** The standings of one group (a game's `group.groupId`); [] for a cup group.
 *  `probeGroupId` is a group known to have a table, used only if the action has
 *  to be found again. */
export async function fetchStandings(groupId, probeGroupId = groupId, { fetchImpl = fetch } = {}) {
  return act('standings', Number(groupId), Number(probeGroupId), fetchImpl)
}

/** Test seam. */
export function __setActionId(kind, id) { ACTIONS[kind].id = id }
