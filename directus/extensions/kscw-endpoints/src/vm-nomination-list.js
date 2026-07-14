/**
 * Volleymanager "Einsatzliste" (nomination list) reader — HOME side only.
 *
 * VM keeps, per game and per team, the nomination list the club files before the
 * match: the players it may field, with their licence category and eligibility.
 * Teams must have it closed by ~40 min before kickoff, which is exactly when the
 * scorer's match sheet opens — so at match time it is normally there and closed.
 *
 * Two hard limits, both established by probing the live API:
 *   - Only our OWN side is returned. The endpoint is scoped to the "active party"
 *     (our club), so for a KSCW home game `nominationListTeamHome` is populated and
 *     `nominationListTeamAway` is always null. The opponent's list is not readable.
 *   - The list carries NO jersey number and NO captain flag — those live only in
 *     our own DB. Callers must merge them in (join on members.license_nr, which is
 *     VM's person.associationId).
 *
 * Read-only: we call getNominationListOrTeamForActivePartyByGame and nothing else.
 * POST/PUT on `api\nominationlist` CREATE a list — never call those from here.
 */

// Absolute container path: `directus/scripts/` is a separate bind-mount, deployed
// via `npm run scripts:deploy:*`, not by `ext:deploy`. Same import as game-scheduling.js.
const VM_CLIENT = '/directus/scripts/vm-client.mjs'

// A VM login is 4 HTTP hops; reuse the session across scorers instead of
// re-logging-in per request. Well under VM's own session lifetime.
const SESSION_TTL_MS = 15 * 60 * 1000

// The scorer is at the table waiting. Fail fast to the RSVP fallback rather than
// hang the modal on a slow or unreachable VM.
const VM_TIMEOUT_MS = 8000

let session = null

async function openSession(log, force) {
  if (!force && session && Date.now() - session.at < SESSION_TTL_MS) return session
  if (!process.env.VM_USERNAME || !process.env.VM_PASSWORD) {
    log.warn('[vm-nomination] VM_USERNAME/VM_PASSWORD not set — skipping Einsatzliste')
    return null
  }
  const vm = await import(VM_CLIENT)
  const jar = await vm.vmLogin({ username: process.env.VM_USERNAME, password: process.env.VM_PASSWORD })
  const ctx = await vm.csrfFromPage(jar, '/sportmanager.indoorvolleyball/game/index')
  session = { jar, ctx, base: vm.VM_BASE, ua: vm.UA, at: Date.now() }
  return session
}

async function callVm(s, gameUuid) {
  const res = await fetch(
    `${s.base}/api/sportmanager.indoorvolleyball/api%5cgame/getNominationListOrTeamForActivePartyByGame`,
    {
      method: 'POST',
      headers: {
        'User-Agent': s.ua,
        'Content-Type': 'text/plain;charset=UTF-8',
        Accept: '*/*',
        Cookie: s.jar.header(),
        Origin: s.base,
        Referer: `${s.base}/sportmanager.indoorvolleyball/game/index`,
        ...(s.ctx.wuid ? { 'Window-Unique-Id': s.ctx.wuid } : {}),
      },
      body: `game=${encodeURIComponent(gameUuid)}&__csrfToken=${encodeURIComponent(s.ctx.csrf)}`,
      signal: AbortSignal.timeout(VM_TIMEOUT_MS),
    },
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const initial = (name) => {
  const s = String(name ?? '').trim()
  return s ? `${s.charAt(0).toUpperCase()}.` : ''
}

// VM's `person.birthday` is an instant at Zurich midnight ("1988-10-06T23:00:00Z"),
// so slicing it yields the PREVIOUS day. `formattedAndTimezoneIndependentBirthday`
// is the plain calendar date — always prefer it.
const personDob = (p) => p?.formattedAndTimezoneIndependentBirthday || null

const mapPerson = (p) => (p ? {
  last_name: p.lastName || '',
  first_initial: initial(p.firstName),
  birthdate: personDob(p),
} : null)

/**
 * Fetch the home team's Einsatzliste for a VM game.
 *
 * @param {string} gameUuid  svrz_games.svrz_persistence_id (VM game __identity)
 * @returns {Promise<null | {
 *   players: Array<{ license_nr: string|null, last_name: string, first_initial: string,
 *                    birthdate: string|null, licence: string|null, eligible: boolean }>,
 *   coaches: Array<{ last_name: string, first_initial: string, birthdate: string|null,
 *                    role: 'coach'|'assistant_coach_1'|'assistant_coach_2' }>,
 *   closed_at: string|null,
 * }>}  null when VM is unusable or has no list — caller falls back to RSVP.
 */
export async function fetchHomeNominationList(gameUuid, log) {
  let body
  try {
    const s = await openSession(log, false)
    if (!s) return null
    try {
      body = await callVm(s, gameUuid)
    } catch (err) {
      // Most likely an expired session (VM answers with the login page). One retry
      // on a fresh login; if that fails too, the caller falls back to RSVP.
      log.warn(`[vm-nomination] ${gameUuid}: ${err.message} — retrying with fresh login`)
      const fresh = await openSession(log, true)
      if (!fresh) return null
      body = await callVm(fresh, gameUuid)
    }
  } catch (err) {
    session = null
    log.warn(`[vm-nomination] ${gameUuid}: giving up (${err.message})`)
    return null
  }

  const list = (body?.items ?? body)?.nominationListTeamHome
  const noms = Array.isArray(list?.indoorPlayerNominations) ? list.indoorPlayerNominations : []
  if (!noms.length) return null

  // Persons nominated without a licence record. Never seen populated in practice;
  // surface it in the logs rather than guess at a shape we have not observed.
  const notFound = list.notFoundButNominatedPersons
  if (Array.isArray(notFound) && notFound.length) {
    log.warn(`[vm-nomination] ${gameUuid}: ${notFound.length} notFoundButNominatedPersons ignored`)
  }

  const players = noms.map((n) => {
    const p = n.indoorPlayer?.person ?? {}
    return {
      // VM's associationId is the Swiss Volley licence number — the exact key our
      // members.license_nr holds, so the caller can attach jersey number + captain.
      license_nr: p.associationId != null ? String(p.associationId) : null,
      last_name: p.lastName || '',
      first_initial: initial(p.firstName),
      birthdate: personDob(p),
      licence: n.indoorPlayerLicenseCategory?.shortName || null,
      eligible: n.isEligible !== false,
    }
  })

  // VM holds three distinct official slots and the match sheet distinguishes them, so
  // keep the slot as a role instead of flattening all three into one anonymous list.
  // (Our own teams_coaches junction has no role column, which is exactly why the VM
  // list is the better source when it exists.)
  const coaches = [
    { person: list.coachPerson, role: 'coach' },
    { person: list.firstAssistantCoachPerson, role: 'assistant_coach_1' },
    { person: list.secondAssistantCoachPerson, role: 'assistant_coach_2' },
  ]
    .map(({ person, role }) => {
      const p = mapPerson(person)
      return p ? { ...p, role } : null
    })
    .filter(Boolean)

  return { players, coaches, closed_at: list.closedAt || null }
}
