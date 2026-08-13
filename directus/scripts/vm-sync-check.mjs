/**
 * Volleymanager Sync Check
 *
 * Fetches teams, players, writers, and team assignments from
 * volleymanager.volleyball.ch and upserts into Directus `sv_vm_check`.
 *
 * Run: node vm-sync-check.mjs
 * Env: VM_USERNAME, VM_PASSWORD, DIRECTUS_URL, DIRECTUS_TOKEN (or ADMIN_EMAIL+ADMIN_PASSWORD)
 */

import { vmLogin, csrfFromPage, VM_BASE, UA } from './vm-client.mjs';
import { resolveVmHall, hallIdsOf } from './vm-halls.mjs';

// ─── Config ──────────────────────────────────────────────────────────
const VM_USERNAME = process.env.VM_USERNAME;
const VM_PASSWORD = process.env.VM_PASSWORD;
if (!VM_USERNAME || !VM_PASSWORD) {
  console.error('Missing VM_USERNAME or VM_PASSWORD environment variables');
  process.exit(1);
}
// ClubDesk's volleyball-referee group. Must match the name used by
// import-clubdesk-csv.mjs's referee_vb rule exactly — the two read the same
// [Gruppen] column and a drift between them silently un-guards referee_vb.
const CD_REFEREE_GROUP_VB = 'VB Schiedsrichter*innen';

const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus-dev.kscw.ch';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
const DIRECTUS_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch';
const DIRECTUS_PASSWORD = process.env.ADMIN_PASSWORD;
if (!DIRECTUS_TOKEN && !DIRECTUS_PASSWORD) {
  console.error('Set DIRECTUS_TOKEN or ADMIN_PASSWORD environment variable');
  process.exit(1);
}

// ─── Retry helper ────────────────────────────────────────────────────
// ⚠ A role denial carries "HTTP 403" in its text and is the one 403 that is
// NOT a bad window: VolleyManager has told us this account may not hold the
// role, so every retry, every deferral and the weekly re-run all reproduce it
// identically. Matched FIRST, everywhere a 403 is classified — otherwise it
// files as transient, defers, records `status='ok'`, and nobody is told
// (2026-08-13; see vm-client.mjs → vmLogin).
const ROLE_DENIED = /VM_ROLE_DENIED/;
// Volleymanager intermittently returns 403/429/5xx (observed 2026-06-08: the
// 04:00 cron + a manual re-run both 403'd on /indoorwriter/index, while the
// account has full access and the page returned 200 minutes later). Retry
// transient failures so one flaky window doesn't fail the whole nightly sync.
async function retry(label, fn, { attempts = 4, baseDelayMs = 2500 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e?.message || '';
      const transient = !ROLE_DENIED.test(msg)
        && /HTTP (403|408|425|429|5\d\d)|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network|timed out|timeout|aborted/i.test(msg);
      if (i === attempts || !transient) throw e;
      const delay = baseDelayMs * i;
      console.warn(`  ⚠ ${label}: attempt ${i}/${attempts} failed (${msg.slice(0, 90)}); retry in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// Bound any VM call so a stalled connection (Node `fetch` has no default
// timeout) can't hang the whole sync until the cron's 600s SIGKILL — it becomes
// a fast, retryable error instead. Belt-and-suspenders with vmSearch's
// per-request AbortSignal: this wrapper also covers the login/csrf follows in
// vm-client (which we don't modify here) and any future call path.
const FETCH_TIMEOUT_MS = 90_000;
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Volleymanager's whole indoor data API flaps together with transient 403s (and
// connection stalls) for minutes at a time — observed across player, writer AND
// referee endpoints in one bad window (2026-06-18). A transient VM failure
// during a READ isn't actionable, so defer that group to the next run as a soft
// WARNING (no alert, no watchdog storm). Only a non-transient error (unexpected
// response shape, or our own Directus write failing) is a real failure.
function isTransientVm(message = '') {
  if (ROLE_DENIED.test(message)) return false;
  return /HTTP (403|408|425|429|5\d\d)|timed out|timeout|aborted|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(message);
}
function classifyGroupFailure(label, e, failures, warnings) {
  if (isTransientVm(e?.message)) warnings.push(`${label} deferred — VM temporarily unavailable (${e.message})`);
  else failures.push(`${label}: ${e.message}`);
}

// ─── Generic paginated search ────────────────────────────────────────
async function vmSearch(jar, csrf, wuid, resourcePath, properties, {
  batchSize = 200,
  referer = '/sportmanager.indoorvolleyball/indoorwriter/index',
  propertyFilters = [],
} = {}) {
  const base = `${VM_BASE}${resourcePath}/search`;
  const headers = {
    'User-Agent': UA,
    'Content-Type': 'text/plain;charset=UTF-8',
    Accept: '*/*',
    Origin: VM_BASE,
    Referer: `${VM_BASE}${referer}`,
    Cookie: jar.header(),
  };
  if (wuid) headers['Window-Unique-Id'] = wuid;

  const allItems = [];
  let total = Infinity;
  let offset = 0;

  while (offset < total) {
    const params = new URLSearchParams();
    // Property filters (e.g. deceased=false, isAnonymized=false)
    propertyFilters.forEach((f, i) => {
      params.set(`searchConfiguration[propertyFilters][${i}][propertyName]`, f.propertyName);
      if (f.boolean !== undefined) params.set(`searchConfiguration[propertyFilters][${i}][boolean]`, String(f.boolean));
      if (f.value !== undefined) params.set(`searchConfiguration[propertyFilters][${i}][value]`, String(f.value));
    });
    params.set('searchConfiguration[customFilters]', '');
    params.set('searchConfiguration[propertyOrderings]', '');
    params.set('searchConfiguration[offset]', String(offset));
    params.set('searchConfiguration[limit]', String(batchSize));
    params.set('searchConfiguration[textSearchOperator]', 'AND');
    properties.forEach((p, i) => params.set(`propertyRenderConfiguration[${i}]`, p));
    params.set('__csrfToken', csrf);

    const json = await retry(`${resourcePath} (offset ${offset})`, async () => {
      const r = await fetch(base, { method: 'POST', headers, body: params.toString(), signal: AbortSignal.timeout(45_000) });
      if (!r.ok) {
        const text = await r.text();
        const msg = text.match(/In path ([^:]+):/)?.[0] || `HTTP ${r.status}`;
        throw new Error(`${resourcePath}: ${msg}`);
      }
      return r.json();
    });
    total = json.totalItemsCount ?? 0;
    const items = json.items ?? [];
    allItems.push(...items);
    if (items.length === 0) break;
    offset += items.length;
  }
  return allItems;
}

// ─── Fetch functions ─────────────────────────────────────────────────

async function fetchTeams(jar, csrf, wuid) {
  console.log('[1/4] Fetching teams...');
  const items = await vmSearch(jar, csrf, wuid,
    '/api/sportmanager.indoorvolleyball/api%5cteam',
    [
      'club.identifier',
      'club.name',
      'season.name',
      'season.displayName',
      'leagueCategory.name',
      'leagueCategory.managingAssociation.shortName',
    ],
    { referer: '/sportmanager.indoorvolleyball/team/index' },
  );
  console.log(`  → ${items.length} teams`);
  return items.map(t => ({
    team_id: t.staticTeamIdentifier,
    team_uuid: t.__identity,
    team_name: t.translations?.de?.name || t.name,
    gender: t.gender,
    active: t.active,
    season: t.season?.displayName || t.season?.name || null,
    league_category: t.leagueCategory?.name || null,
    managing_assoc: t.leagueCategory?.managingAssociation?.shortName || null,
  }));
}

async function fetchPlayers(jar, csrf, wuid) {
  console.log('[2/4] Fetching indoor players...');
  const items = await vmSearch(jar, csrf, wuid,
    '/api/sportmanager.indoorvolleyball/api%5cindoorplayer',
    [
      'person.associationId',
      'person.lastName',
      'person.firstName',
      'person.birthday',
      'person.gender',
      'person.nationality.countryName',
      'nationality.iocCodeOrIsoAlpha3',
      'isClassifiedAsLocallyEducated',
      'isForeignerRegardingGamePlay',
      'person.correspondenceLanguage',
      'person.primaryEmailAddress.emailAddress',
      'person.primaryPhoneNumber.normalizedLocalNumber',
      'currentLicense.licenseCategory.shortName',
      'currentLicense.licenseCategory.name',
      'currentLicense.club.identifier',
      'currentLicense.club.name',
      'currentLicense.club.regionalAssociation.shortName',
      'currentLicense.doubleLicenseClub.identifier',
      'currentLicense.doubleLicenseClub.name',
      'currentLicense.doubleLicenseClub.regionalAssociation.shortName',
      'currentLicense.doubleLicenseTeam.staticTeamIdentifier',
      'currentLicense.doubleLicenseTeam.name',
      'currentLicense.activatedInCurrentSeason',
      'currentLicense.activationDate',
      'currentLicense.validatedInCurrentSeason',
      'currentLicense.validationDate',
      'licenses',
    ],
    {
      // No validated-only filter — fetch ALL players (including inactive licences)
      // Only exclude deceased and anonymized persons
      propertyFilters: [
        { propertyName: 'person.deceased', boolean: false },
        { propertyName: 'person.isAnonymized', boolean: false },
      ],
    },
  );
  console.log(`  → ${items.length} players`);
  return items;
}

async function fetchWriters(jar, csrf, wuid) {
  console.log('[3/4] Fetching indoor writers...');
  const items = await vmSearch(jar, csrf, wuid,
    '/api/sportmanager.indoorvolleyball/api%5cindoorwriter',
    [
      'person.associationId',
      'person.lastName',
      'person.firstName',
      'person.gender',
      'person.primaryEmailAddress.emailAddress',
      'currentLicense.regionalAssociation.shortName',
    ],
    { referer: '/sportmanager.indoorvolleyball/indoorwriter/index' },
  );
  console.log(`  → ${items.length} writers`);
  return items;
}

async function fetchReferees(jar, csrf, wuid) {
  console.log('[3b/5] Fetching club referees...');
  const items = await vmSearch(jar, csrf, wuid,
    '/api/sportmanager.indoorvolleyball/api%5cclubreferee',
    [
      'indoorAssociationReferee.indoorReferee.person.associationId',
      'indoorAssociationReferee.indoorReferee.person.firstName',
      'indoorAssociationReferee.indoorReferee.person.lastName',
      'indoorAssociationReferee.indoorReferee.person.primaryEmailAddress.emailAddress',
      'indoorAssociationReferee.managingAssociation.shortName',
    ],
    { referer: '/sportmanager.indoorvolleyball/clubreferee/index' },
  );
  console.log(`  → ${items.length} referee rows`);
  // clubreferee/index is club-scoped (returns KSC Wiedikon's referees). One
  // person appears once per managing association (e.g. SVRZ + SVRNO), so
  // collapse to associationId → { person fields, Set of association shortNames }.
  // VM exposes no referee *grade* — the association is the only licence detail.
  const byAssocId = new Map();
  for (const r of items) {
    const ref = r.indoorAssociationReferee || {};
    const person = ref.indoorReferee?.person || {};
    const id = person.associationId;
    if (!id) continue;
    if (!byAssocId.has(id)) {
      byAssocId.set(id, {
        firstName: person.firstName || null,
        lastName: person.lastName || null,
        email: person.primaryEmailAddress?.emailAddress || null,
        assocs: new Set(),
      });
    }
    const assoc = ref.managingAssociation?.shortName;
    if (assoc) byAssocId.get(id).assocs.add(assoc);
  }
  console.log(`  → ${byAssocId.size} unique referees`);
  return byAssocId;
}

async function fetchTeamMembers(jar, csrf, wuid) {
  console.log('[4/4] Fetching team-player assignments...');
  const items = await vmSearch(jar, csrf, wuid,
    '/api/sportmanager.indoorvolleyball/api%5cteamaddressorganisationmember',
    [
      'person.associationId',
      'person.lastName',
      'person.firstName',
      'team.staticTeamIdentifier',
      'team.name',
      'team.active',
      'team.gender',
      'addressOrganisationMemberFunction.title',
    ],
    { referer: '/sportmanager.indoorvolleyball/team/index' },
  );
  console.log(`  → ${items.length} team-member assignments`);
  return items;
}

// ─── Merge into flat check table ─────────────────────────────────────

function buildCheckTable(players, writers, referees, teamMembers, teams) {
  // Index writers by associationId → Set
  const writerIds = new Set();
  for (const w of writers) {
    const id = w.person?.associationId;
    if (id) writerIds.add(id);
  }

  // referees: Map<associationId, { firstName, lastName, email, assocs:Set }>
  const refereeAssoc = (id) => {
    const r = referees.get(id);
    return r && r.assocs.size ? [...r.assocs].sort().join(', ') : null;
  };

  // Index team members: associationId → array of { team_id, team_name, function }
  const memberTeams = new Map();
  for (const tm of teamMembers) {
    const id = tm.person?.associationId;
    const teamId = tm.team?.staticTeamIdentifier;
    if (!id) continue;
    if (!memberTeams.has(id)) memberTeams.set(id, []);
    memberTeams.get(id).push({
      team_id: teamId,
      team_name: tm.team?.name || null,
      team_active: tm.team?.active ?? null,
      function: tm.addressOrganisationMemberFunction?.title || null,
    });
  }

  // Index teams by staticTeamIdentifier (current season only)
  const teamMap = new Map();
  for (const t of teams) {
    if (!teamMap.has(t.team_id)) teamMap.set(t.team_id, t);
  }

  // Build flat rows from players
  const rows = [];
  for (const p of players) {
    const person = p.person || {};
    const license = p.currentLicense || {};
    const assocId = person.associationId;

    // Get team assignments for this person
    const assignments = memberTeams.get(assocId) || [];
    // Pick active team assignments, prefer ones with team_active=true
    const activeAssignments = assignments.filter(a => a.team_active !== false);
    const teamNames = activeAssignments.map(a => a.team_name).filter(Boolean);
    const teamIds = activeAssignments.map(a => a.team_id).filter(Boolean);

    // Get primary email
    const email = person.primaryEmailAddress?.emailAddress
      || person.emailAddresses?.find(e => e.isPrimary)?.emailAddress
      || person.emailAddresses?.[0]?.emailAddress
      || null;

    // Double licence info
    const dlClub = license.doubleLicenseClub || {};
    const dlTeam = license.doubleLicenseTeam || {};

    rows.push({
      association_id: assocId,
      first_name: person.firstName || null,
      last_name: person.lastName || null,
      birthday: person.birthday || null,
      gender: person.gender || null,
      nationality: person.nationality?.countryName || null,
      nationality_code: p.nationality?.iocCodeOrIsoAlpha3 || null,
      is_locally_educated: p.isClassifiedAsLocallyEducated ?? null,
      is_foreigner: p.isForeignerRegardingGamePlay ?? null,
      email,
      federation: license.club?.regionalAssociation?.shortName || null,
      licence_category: license.licenseCategory?.shortName || license.licenseCategory?.name || null,
      licence_club_id: license.club?.identifier || null,
      licence_club_name: license.club?.name || null,
      licence_club_assoc: license.club?.regionalAssociation?.shortName || null,
      double_licence_club_id: dlClub.identifier || null,
      double_licence_club_name: dlClub.name || null,
      double_licence_club_assoc: dlClub.regionalAssociation?.shortName || null,
      double_licence_team_id: dlTeam.staticTeamIdentifier || null,
      double_licence_team_name: dlTeam.name || null,
      licence_activated: license.activatedInCurrentSeason ?? null,
      licence_activation_date: license.activationDate || null,
      licence_validated: license.validatedInCurrentSeason ?? null,
      licence_validation_date: license.validationDate || null,
      is_writer: writerIds.has(assocId),
      is_referee: referees.has(assocId),
      referee_assoc: refereeAssoc(assocId),
      team_names: teamNames.length > 0 ? teamNames.join(', ') : null,
      team_ids: teamIds.length > 0 ? teamIds.join(', ') : null,
      synced_at: new Date().toISOString(),
    });
  }

  // Referee-only rows: KSCW referees who aren't in the indoor-player list still
  // need a row so members.referee_vb can sync (a referee need not be a player).
  const seen = new Set(rows.map(r => r.association_id));
  for (const [assocId, ref] of referees) {
    if (seen.has(assocId)) continue;
    rows.push({
      association_id: assocId,
      first_name: ref.firstName,
      last_name: ref.lastName,
      email: ref.email,
      is_writer: writerIds.has(assocId),
      is_referee: true,
      referee_assoc: refereeAssoc(assocId),
      synced_at: new Date().toISOString(),
    });
  }

  return rows;
}

// ─── Directus upsert ─────────────────────────────────────────────────

async function getDirectusToken() {
  if (DIRECTUS_TOKEN) return DIRECTUS_TOKEN;
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DIRECTUS_EMAIL, password: DIRECTUS_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Directus auth failed: ${res.status}`);
  const { data } = await res.json();
  return data.access_token;
}

async function upsertToDirectus(rows) {
  console.log(`\nUpserting ${rows.length} rows to Directus sv_vm_check...`);
  const token = await getDirectusToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Fetch existing records keyed by association_id
  const existing = new Map();
  let page = 1;
  while (true) {
    const res = await fetch(
      `${DIRECTUS_URL}/items/sv_vm_check?fields=id,association_id&limit=250&page=${page}`,
      { headers },
    );
    if (!res.ok) throw new Error(`Directus list failed: ${res.status}`);
    const { data } = await res.json();
    if (!data || data.length === 0) break;
    for (const r of data) existing.set(r.association_id, r.id);
    page++;
  }
  console.log(`  Existing records: ${existing.size}`);

  let created = 0, updated = 0, errors = 0;

  // Process in batches of 50
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);

    const toCreate = [];
    const toUpdate = [];
    for (const row of batch) {
      const directusId = existing.get(row.association_id);
      if (directusId) {
        toUpdate.push({ ...row, id: directusId });
      } else {
        toCreate.push(row);
      }
    }

    // Batch create
    if (toCreate.length > 0) {
      const res = await fetch(`${DIRECTUS_URL}/items/sv_vm_check`, {
        method: 'POST',
        headers,
        body: JSON.stringify(toCreate),
      });
      if (res.ok) {
        created += toCreate.length;
      } else {
        const text = await res.text();
        console.error(`  Create batch error: ${res.status} ${text.slice(0, 200)}`);
        errors += toCreate.length;
      }
    }

    // Batch update
    if (toUpdate.length > 0) {
      const res = await fetch(`${DIRECTUS_URL}/items/sv_vm_check`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(toUpdate),
      });
      if (res.ok) {
        updated += toUpdate.length;
      } else {
        const text = await res.text();
        console.error(`  Update batch error: ${res.status} ${text.slice(0, 200)}`);
        errors += toUpdate.length;
      }
    }
  }

  // Delete records that no longer exist in VM
  const currentIds = new Set(rows.map(r => r.association_id));
  const toDelete = [...existing.entries()]
    .filter(([assocId]) => !currentIds.has(assocId))
    .map(([, directusId]) => directusId);

  // Safety net: never let an empty/degenerate fetch wipe the whole table. If we
  // somehow got zero rows (e.g. a 200-but-empty VM response that slipped past
  // the per-call guards), skip the stale-delete entirely.
  if (rows.length === 0 && existing.size > 0) {
    console.warn(`  ⚠ 0 rows fetched but ${existing.size} exist — skipping stale-delete to avoid wiping sv_vm_check`);
  } else if (toDelete.length > 0) {
    const res = await fetch(`${DIRECTUS_URL}/items/sv_vm_check`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify(toDelete),
    });
    if (res.ok) {
      console.log(`  Deleted ${toDelete.length} stale records`);
    } else {
      console.error(`  Delete error: ${res.status}`);
    }
  }

  console.log(`  Created: ${created}, Updated: ${updated}, Errors: ${errors}`);
}

// ─── Sync team metadata to `teams` ───────────────────────────────────

// VM season displayName "2026/2027" → app format "2026/27".
function normalizeSeason(display) {
  if (!display) return null;
  const m = String(display).match(/^(\d{4})\/\d{2}(\d{2})$/); // 2026/2027 → 2026/27
  if (m) return `${m[1]}/${m[2]}`;
  const m2 = String(display).match(/^\d{4}\/\d{2}$/);          // already 2026/27
  if (m2) return display;
  return null;
}

// Current season in app format. June (month index 5) rollover — mirrors the
// SVRZ cron's logic. Overridable via SYNC_SEASON for manual backfills.
function currentSeason() {
  if (process.env.SYNC_SEASON) return process.env.SYNC_SEASON;
  const now = new Date();
  const startYear = now.getUTCMonth() >= 5 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `${startYear}/${String(startYear + 1).slice(2)}`;
}

// "KSC Wiedikon D1" → "D1". null if nothing meaningful remains (junk/tournament
// registrations whose VM name is the bare club name).
function shortTeamName(vmName) {
  if (!vmName) return null;
  const stripped = vmName.replace(/^KSC\s+Wiedikon\s*/i, '').trim();
  return stripped || null;
}

async function syncToTeams(teams) {
  const season = currentSeason();
  console.log(`\nSyncing teams → \`teams\` (season ${season})...`);
  const token = await getDirectusToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // VM teams for the current season only (one row per staticTeamIdentifier).
  const vmCurrent = teams.filter(t => normalizeSeason(t.season) === season);
  console.log(`  VM teams this season: ${vmCurrent.length}`);

  // Existing teams (small table). Match on team_id + season — team_id repeats
  // across seasons, so both are needed to hit the right row.
  const existing = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${DIRECTUS_URL}/items/teams?fields=id,name,full_name,team_id,sport,league,season&limit=200&page=${page}`, { headers });
    if (!res.ok) throw new Error(`teams list failed: ${res.status}`);
    const { data } = await res.json();
    if (!data || data.length === 0) break;
    existing.push(...data);
    page++;
  }
  const byKey = new Map();
  for (const t of existing) byKey.set(`${t.team_id}|${t.season}`, t);

  let updated = 0, unchanged = 0, unmatched = 0, errors = 0;
  for (const vt of vmCurrent) {
    if (vt.team_id == null) { unmatched++; continue; }
    const teamId = `vb_${vt.team_id}`;              // staticTeamIdentifier → app team_id
    const dbTeam = byKey.get(`${teamId}|${season}`);
    if (!dbTeam) { unmatched++; continue; }         // update-only: never create

    const fullName = vt.team_name || null;           // "KSC Wiedikon D1"
    const shortName = shortTeamName(fullName);        // "D1"

    const payload = {};
    // VM owns name + full_name (they're the same datum, prefix aside). Guard
    // against blanking when VM name is the bare club name — keep existing then.
    if (fullName && shortName) {
      if (fullName !== dbTeam.full_name) payload.full_name = fullName;
      if (shortName !== dbTeam.name) payload.name = shortName;
    }
    // VM owns league (terse code, e.g. "2L"). This fixes stale cloned league
    // text after a division change. The Swiss Volley API's richer
    // "Frauen 3. Liga Gruppe A" form can override later once it has this season.
    if (vt.league_category && vt.league_category !== dbTeam.league) {
      payload.league = vt.league_category;
    }

    if (Object.keys(payload).length === 0) { unchanged++; continue; }
    const res = await fetch(`${DIRECTUS_URL}/items/teams/${dbTeam.id}`, {
      method: 'PATCH', headers, body: JSON.stringify(payload),
    });
    if (res.ok) {
      updated++;
      console.log(`  ✓ ${dbTeam.name} (${teamId}) ${JSON.stringify(payload)}`);
    } else {
      const text = await res.text();
      console.error(`  team ${dbTeam.id} update error: ${res.status} ${text.slice(0, 200)}`);
      errors++;
    }
  }
  console.log(`  Teams: updated=${updated}, unchanged=${unchanged}, no-match=${unmatched}, errors=${errors}`);
  return { updated, unchanged, unmatched, errors };
}

// ─── Sync to members ────────────────────────────────────────────────

async function syncToMembers(rows) {
  console.log('\nSyncing VM data to members...');
  const token = await getDirectusToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const norm = (s) => (s == null ? '' : String(s).trim().toLowerCase());
  const nameKey = (fn, ln) => `${norm(fn)}|${norm(ln)}`;
  const nameDobKey = (fn, ln, dob) => `${norm(fn)}|${norm(ln)}|${dob || ''}`;

  // Build lookups from VM rows. For name-only matches, drop colliding keys
  // so we never bind a member to the wrong VM person.
  const rowByAssocId = new Map();
  const rowByEmail = new Map();
  const rowByNameDob = new Map();
  const rowByName = new Map();
  const nameCollisions = new Set();
  for (const row of rows) {
    if (row.association_id) rowByAssocId.set(String(row.association_id), row);
    if (row.email) {
      const k = norm(row.email);
      if (k) rowByEmail.set(k, row);
    }
    if (row.first_name && row.last_name && row.birthday) {
      rowByNameDob.set(nameDobKey(row.first_name, row.last_name, row.birthday), row);
    }
    if (row.first_name && row.last_name) {
      const k = nameKey(row.first_name, row.last_name);
      if (rowByName.has(k)) nameCollisions.add(k);
      else rowByName.set(k, row);
    }
  }
  for (const k of nameCollisions) rowByName.delete(k);

  // ClubDesk is the register this sync must not overrule — see the scorer_vb /
  // referee_vb blocks below. Two sets, one pass:
  //   cdScorerIds  — `Offiziellen Lizenz` = VB SC (the Schreiber licence)
  //   cdRefereeIds — membership of the `VB Schiedsrichter*innen` group, which
  //                  import-clubdesk-csv.mjs calls "the source of truth for is a
  //                  referee for Wiedikon" and only ever sets true.
  // Paginated; `clubdesk_id` is unique in clubdesk_export (verified on prod
  // 2026-07-17), so plain Sets are safe.
  const cdScorerIds = new Set();
  const cdRefereeIds = new Set();
  {
    let cdPage = 1;
    while (true) {
      const url = `${DIRECTUS_URL}/items/clubdesk_export?fields=clubdesk_id,offiziellen_lizenz,gruppen_bracketed&limit=250&page=${cdPage}`;
      const res = await fetch(url, { headers });
      // Fail loud, don't degrade. An empty/failed read here would look exactly
      // like "nobody holds VB SC / nobody is in the referee group" and re-arm the
      // very wipes these guards prevent — silently, on 45 + 2 members. Better to
      // abort the member sync than to clear.
      if (!res.ok) throw new Error(`Directus clubdesk_export list failed: ${res.status}`);
      const { data } = await res.json();
      if (!data || data.length === 0) break;
      for (const r of data) {
        const id = (r.clubdesk_id ?? '').toString().trim();
        if (!id) continue;
        if ((r.offiziellen_lizenz ?? '').toString().trim().toUpperCase() === 'VB SC') {
          cdScorerIds.add(id);
        }
        // `gruppen_bracketed` is the comma-joined [Gruppen] list. Split rather
        // than substring-match: a bare `includes` would also fire on a future
        // group whose name merely contains this one.
        const groups = (r.gruppen_bracketed ?? '').toString()
          .split(',').map((g) => g.trim().toLowerCase());
        if (groups.includes(CD_REFEREE_GROUP_VB.toLowerCase())) cdRefereeIds.add(id);
      }
      cdPage++;
    }
    console.log(`  ClubDesk VB SC holders: ${cdScorerIds.size}, VB referee group: ${cdRefereeIds.size}`);
  }

  // Fetch all members (paginated) — we want to backfill members without license_nr too.
  const members = [];
  let page = 1;
  while (true) {
    const url = `${DIRECTUS_URL}/items/members?fields=id,license_nr,sex,scorer_vb,referee_vb,clubdesk_id,vm_email,email,first_name,last_name,birthdate,birthdate_visibility,licence_category,licence_activated,licence_validated&limit=250&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Directus members list failed: ${res.status}`);
    const { data } = await res.json();
    if (!data || data.length === 0) break;
    members.push(...data);
    page++;
  }
  console.log(`  Members fetched: ${members.length}`);

  // Build update payloads
  const GENDER_MAP = { male: 'm', female: 'f', m: 'm', f: 'f' };
  const updates = [];
  let matched = 0;
  let matchedByLicense = 0, matchedByEmail = 0, matchedByNameDob = 0, matchedByName = 0;
  let backfilledLicense = 0, backfilledBirthdate = 0;
  // Flags kept despite VM not listing the person. Printed so each guard's reach is
  // visible per run — a silent guard is indistinguishable from a broken one.
  let keptScorer = 0;
  let keptReferee = 0;

  for (const member of members) {
    let row = null;
    if (member.license_nr) {
      row = rowByAssocId.get(String(member.license_nr));
      if (row) matchedByLicense++;
    }
    if (!row && member.email) {
      row = rowByEmail.get(norm(member.email));
      if (row) matchedByEmail++;
    }
    if (!row && member.vm_email) {
      row = rowByEmail.get(norm(member.vm_email));
      if (row) matchedByEmail++;
    }
    if (!row && member.first_name && member.last_name && member.birthdate) {
      row = rowByNameDob.get(nameDobKey(member.first_name, member.last_name, member.birthdate));
      if (row) matchedByNameDob++;
    }
    if (!row && member.first_name && member.last_name) {
      row = rowByName.get(nameKey(member.first_name, member.last_name));
      if (row) matchedByName++;
    }
    if (!row) continue;
    matched++;

    const payload = { id: member.id };
    let changed = false;

    // Gender
    const normalizedGender = GENDER_MAP[row.gender];
    if (normalizedGender && normalizedGender !== member.sex) {
      payload.sex = normalizedGender;
      changed = true;
    }

    // Backfill license_nr (additive — never overwrite existing).
    if (!member.license_nr && row.association_id) {
      payload.license_nr = String(row.association_id);
      backfilledLicense++;
      changed = true;
    }

    // Backfill birthdate (additive). Default visibility to 'hidden' unless the
    // member already opted into a different visibility.
    if (!member.birthdate && row.birthday) {
      payload.birthdate = row.birthday;
      if (!member.birthdate_visibility) payload.birthdate_visibility = 'hidden';
      backfilledBirthdate++;
      changed = true;
    }

    // Licence fields — mirror to members so the field labels in the admin UI
    // ("synced from Volleymanager") aren't misleading. sv_vm_check remains the
    // source of truth; this is a denormalised cache for fast read.
    if (row.licence_category != null && row.licence_category !== member.licence_category) {
      payload.licence_category = row.licence_category;
      changed = true;
    }
    if (row.licence_activated != null && row.licence_activated !== member.licence_activated) {
      payload.licence_activated = row.licence_activated;
      changed = true;
    }
    if (row.licence_validated != null && row.licence_validated !== member.licence_validated) {
      payload.licence_validated = row.licence_validated;
      changed = true;
    }

    // VM email — store the email from Volleymanager
    if (row.email && row.email !== member.vm_email) {
      payload.vm_email = row.email;
      changed = true;
    }

    // Licences are per-flag booleans (migration 067; legacy `licences` json
    // dropped in migration 119). sv_vm_check stays the source of truth.
    //
    // ⚠ SET-TRUE-ONLY for anyone another register calls a Schreiber. VM's
    // indoorwriter list is NOT the whole truth: measured on prod 2026-07-17 its
    // 109 writers were a strict SUBSET of ClubDesk's 154 `VB SC` holders — zero
    // VM writers lacked `VB SC`, so VM never *contradicts* ClubDesk, it just
    // holds less. Clearing on `!is_writer` therefore deleted good data rather
    // than resolving a disagreement, and fought `import-clubdesk-csv.mjs`
    // (Sat 22:00, set-true from `VB SC` — migration 207) which set it straight
    // back: the flag oscillated weekly for 28 members, and scorer assignment saw
    // a different eligible pool depending on the day. Confirmed in prod
    // revisions: member 180 true 2026-07-11 13:29 → cleared here 2026-07-13 04:00.
    //
    // Absence from VM is absence of evidence, not evidence of absence. So VM may
    // still GRANT the flag, but only a register that actually knows a licence was
    // revoked may remove it. Detector: GET /kscw/admin/scorer-vm-check.
    const hasScorer = member.scorer_vb === true;
    const cdId = (member.clubdesk_id ?? '').toString().trim();
    // Effective post-sync referee state: VM's list OR the ClubDesk group (which
    // the referee block below now honours). ClubDesk auto-grants scorer_vb to
    // every VB referee ("every VB referee is automatically a scorer",
    // import-clubdesk-csv.mjs), so clearing a referee's scorer_vb here would
    // oscillate identically.
    const clubSaysReferee = cdId !== '' && cdRefereeIds.has(cdId);
    const effectiveReferee = row.is_referee === true || clubSaysReferee;
    const clubSaysScorer = (cdId !== '' && cdScorerIds.has(cdId)) || effectiveReferee;
    if (row.is_writer && !hasScorer) {
      payload.scorer_vb = true;
      changed = true;
    } else if (!row.is_writer && hasScorer && !clubSaysScorer) {
      payload.scorer_vb = false;
      changed = true;
    } else if (!row.is_writer && hasScorer) {
      keptScorer++;
    }

    // Referee licence (vb). Boolean column only. Never touch referee_bb.
    //
    // ⚠ Same set-true-only rule as scorer_vb, for the same reason. VM's
    // `clubreferee` (11 people) is a strict SUBSET of ClubDesk's
    // `VB Schiedsrichter*innen` group (13) — zero VM referees sit outside it —
    // and import-clubdesk-csv.mjs calls that group "the source of truth for is a
    // referee for Wiedikon" and only ever sets true. Clearing on `!is_referee`
    // therefore fought it: this sync cleared members 5 + 61 on 2026-07-13
    // 04:00, a raw-SQL ClubDesk run put them back (no revision row), and the
    // next run would have cleared them again — a live weekly flip.
    //
    // The two registers answer DIFFERENT questions: VM = holds a current SVRZ
    // referee licence; the ClubDesk group = the club's referee roster.
    // referee_vb means the latter (it drives the read-only "Referee for
    // Wiedikon" profile badge), so the club's roster wins and VM may only add.
    //
    // ⚠ CONSEQUENCE: nothing clears referee_vb automatically any more — ClubDesk's
    // own rule is set-true-only too ("dropped from the group keeps the flag until
    // manually cleared"). Revoking a referee now means removing them from the
    // ClubDesk group AND clearing the flag by hand. That is the accepted trade
    // (2026-07-17): a stale badge beats a value that changes every week.
    const hasReferee = member.referee_vb === true;
    if (row.is_referee && !hasReferee) {
      payload.referee_vb = true;
      changed = true;
    } else if (!row.is_referee && hasReferee && !clubSaysReferee) {
      payload.referee_vb = false;
      changed = true;
    } else if (!row.is_referee && hasReferee) {
      keptReferee++;
    }

    if (changed) updates.push(payload);
  }

  console.log(`  Matched: ${matched} (license=${matchedByLicense}, email=${matchedByEmail}, name+dob=${matchedByNameDob}, name=${matchedByName}), To update: ${updates.length}`);
  console.log(`  Backfill: license_nr=${backfilledLicense}, birthdate=${backfilledBirthdate}`);
  console.log(`  Kept scorer_vb (ClubDesk VB SC / VB referee, not a VM writer): ${keptScorer}`);
  console.log(`  Kept referee_vb (in ClubDesk ${CD_REFEREE_GROUP_VB}, not a VM referee): ${keptReferee}`);

  // Per-item PATCH (NOT the batch-array form). The batch-array PATCH
  // (PATCH /items/members with an array body) silently drops the scorer_vb /
  // referee_vb boolean flags on PROD — licences and other fields apply but the
  // booleans don't, leaving scorer_vb stale (confirmed 2026-05-30: batch works
  // on dev, fails on prod, a Directus batch-upsert interaction with the
  // multi-policy cron-service admin). Single-item PATCH applies every field
  // reliably on both envs. ~218 serial PATCHes/run — well within budget.
  let updated = 0, errors = 0;
  for (const payload of updates) {
    const { id, ...fields } = payload;
    const res = await fetch(`${DIRECTUS_URL}/items/members/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(fields),
    });
    if (res.ok) {
      updated++;
    } else {
      const text = await res.text();
      console.error(`  Member ${id} update error: ${res.status} ${text.slice(0, 200)}`);
      errors++;
    }
  }

  console.log(`  Updated: ${updated}, Errors: ${errors}`);
  return { matched, updated, errors };
}

// ─── Main ────────────────────────────────────────────────────────────

// ─── Group C: hall audit (read-only) ─────────────────────────────────
// Nobody pushes halls to VM (svrz_push_status is null on all 80 2026/27 home
// fixtures — the league places them and it has always happened to match us), so
// nothing detects drift. The 2026-07-16 audit only ran because someone thought
// to ask, and it surfaced a gym that had appeared without us noticing (4144
// A+B). This makes the check part of the weekly run.
//
// Compares our hall SET to VM's gym via resolveVmHall — NOT `games.hall` to
// `hall.name`. A naive name compare reports the H1/H3 derbies as mismatches
// forever: we store them as KWI A + additional_halls [KWI B], VM stores gym 4144.
// Both say "A+B"; only the set comparison knows that.
const VM_AUDIT_CLUB_UUID = process.env.VM_CLUB_UUID || '956158d5-806f-4af9-8378-e7a9e19adeff';

async function fetchHomeFixtures(jar, csrf, wuid) {
  const RENDER = ['number', 'status', 'startingDateTime', 'hall.name',
    'encounter.teamHomeName', 'encounter.teamAwayName'];
  const PAGE = 500;
  const all = [];
  for (let offset = 0; offset <= 20000; offset += PAGE) {
    const p = new URLSearchParams();
    p.set('searchConfiguration[propertyFilters][0][propertyName]', 'encounter.teamHome.club.Persistence_Object_Identifier');
    p.set('searchConfiguration[propertyFilters][0][values][0]', VM_AUDIT_CLUB_UUID);
    p.set('searchConfiguration[customFilters]', '');
    p.set('searchConfiguration[propertyOrderings]', '');
    p.set('searchConfiguration[offset]', String(offset));
    p.set('searchConfiguration[limit]', String(PAGE));
    p.set('searchConfiguration[textSearchOperator]', 'AND');
    RENDER.forEach((pr, i) => p.set(`propertyRenderConfiguration[${i}]`, pr));
    p.set('__csrfToken', csrf);
    const r = await fetch(`${VM_BASE}/api/sportmanager.indoorvolleyball/api%5cgame/search`, {
      method: 'POST',
      headers: {
        'User-Agent': UA, 'Content-Type': 'text/plain;charset=UTF-8', Accept: '*/*',
        Origin: VM_BASE, Referer: `${VM_BASE}/sportmanager.indoorvolleyball/game/index`,
        Cookie: jar.header(), ...(wuid ? { 'Window-Unique-Id': wuid } : {}),
      },
      body: p.toString(),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) throw new Error(`game search HTTP ${r.status}`);
    const items = (await r.json()).items || [];
    all.push(...items);
    if (items.length < PAGE) break;
  }
  return all;
}

async function auditHalls(jar, csrf, wuid) {
  const season = currentSeason();                       // e.g. "2026/27"
  const startYear = Number(season.slice(0, 4));
  const from = `${startYear}-07-01`, to = `${startYear + 1}-07-01`;

  const fixtures = (await fetchHomeFixtures(jar, csrf, wuid)).filter((g) => {
    const d = String(g.startingDateTime || '');
    return d >= from && d < to;
  });

  const token = await getDirectusToken();
  const headers = { Authorization: `Bearer ${token}` };
  // Throw, never default to []. An audit whose reads silently returned nothing
  // would compare zero fixtures and report a clean ✓ — a false all-clear is the
  // one outcome worse than no audit at all (observed: a 401 did exactly this).
  const dg = async (p) => {
    const r = await fetch(`${DIRECTUS_URL}${p}`, { headers });
    if (!r.ok) throw new Error(`hall-audit read ${p.split('?')[0]} → HTTP ${r.status}`);
    const rows = (await r.json())?.data;
    if (!Array.isArray(rows)) throw new Error(`hall-audit read ${p.split('?')[0]} → unexpected shape`);
    return rows;
  };

  const halls = await dg('/items/halls?fields=id,name,vm_hall_id&limit=-1');
  const byId = new Map(halls.map((h) => [String(h.id), h]));
  const games = await dg(
    `/items/games?filter[game_id][_starts_with]=vb_&filter[type][_eq]=home` +
    `&filter[date][_gte]=${from}&filter[date][_lt]=${to}` +
    `&fields=game_id,date,hall,additional_halls,away_team&limit=-1`,
  );
  const ourByNumber = new Map(games.map((g) => [String(g.game_id).replace(/^vb_/, ''), g]));

  const mismatches = [];
  const skipped = { unscheduled: 0, noHall: 0, notApproved: 0, unmapped: 0 };
  let checked = 0;
  for (const f of fixtures) {
    const ours = ourByNumber.get(String(f.number));
    if (!ours) { skipped.unscheduled++; continue; }     // not scheduled our side yet
    const rows = hallIdsOf(ours).map((id) => byId.get(id)).filter(Boolean);
    if (rows.length === 0) { skipped.noHall++; continue; }
    // Only flag once VM considers the fixture settled. While a fixture is `open`
    // the schedule is still being negotiated and divergence is expected — flagging
    // it would cry wolf every week of the scheduling window.
    if (f.status !== 'approved') { skipped.notApproved++; continue; }
    const want = resolveVmHall(rows);
    const vmGym = f.hall?.__identity || f.hall?.persistenceObjectIdentifier || null;
    if (!want.vmHallId || !vmGym) { skipped.unmapped++; continue; }
    // Count only what actually reached the comparison — an inflated `checked`
    // would mask a wholly-skipped audit behind a reassuring number.
    checked++;
    if (want.vmHallId !== vmGym) {
      // Show the gym uuids, not just the names. Our hall name and VM's gym name
      // are usually near-identical ("KWI C" vs "Kantonsschule Wiedikon C"), so a
      // name-only message reads as if the two sides AGREE — the drift lives in
      // the uuid the push would actually send.
      const short = (u) => String(u || '(none)').slice(0, 8);
      mismatches.push(`#${f.number} ${String(f.startingDateTime).slice(0, 10)} `
        + `${f.encounter?.teamHomeName} vs ${f.encounter?.teamAwayName}: `
        + `we say ${want.label || '?'} → gym ${short(want.vmHallId)}, `
        + `VM has ${f.hall?.name || '(unset)'} → gym ${short(vmGym)}`);
    }
  }
  return { season, fixtures: fixtures.length, checked, mismatches, skipped };
}

async function main() {
  const t0 = Date.now();
  const failures = [];
  const warnings = [];

  // Login + CSRF bootstrap — retried. Volleymanager intermittently 403s; a fresh
  // session per attempt clears it. Bootstrap the CSRF token from the STABLE
  // /game/index page (svrz_sync hits it daily and it never 403s) rather than
  // /indoorwriter/index — the club-admin pages (writer/referee) flap with 403s
  // (observed 2026-06-08 and again ~2026-06-13) and must NOT gate the whole sync.
  // The Neos CSRF token + window-unique-id are session-wide, so this single token
  // drives every resource search below (verified live against writer, referee,
  // player and team). If login itself can't succeed there's nothing to sync, so
  // this stays fatal.
  const { jar, csrf, wuid } = await retry('login+csrf', () => withTimeout((async () => {
    const jar = await vmLogin({ username: VM_USERNAME, password: VM_PASSWORD });
    const { csrf, wuid } = await csrfFromPage(jar, '/sportmanager.indoorvolleyball/game/index');
    return { jar, csrf, wuid };
  })(), FETCH_TIMEOUT_MS, 'login+csrf'));
  console.log('✓ Logged in to Volleymanager\n');

  // AUDIT_ONLY — run just the read-only hall audit and stop. Nothing here writes
  // (VM search + two Directus GETs), so it is safe to point at prod on demand:
  //   AUDIT_ONLY=1 DIRECTUS_URL=… DIRECTUS_TOKEN=… node vm-sync-check.mjs
  // Exists because "do the halls still match?" is the question this file answers
  // that someone actually asks out-of-band; the weekly run below reports it too.
  if (process.env.AUDIT_ONLY) {
    const audit = await auditHalls(jar, csrf, wuid);
    console.log(`Season ${audit.season}: ${audit.fixtures} VM home fixtures, ${audit.checked} compared, ${audit.mismatches.length} mismatch(es)`);
    console.log(`Skipped: unscheduled ${audit.skipped.unscheduled}, no hall ${audit.skipped.noHall}, not yet approved ${audit.skipped.notApproved}, unmapped ${audit.skipped.unmapped}`);
    for (const m of audit.mismatches) console.warn(`  ⚠ ${m}`);
    if (audit.checked === 0) console.warn('  ⚠ INCONCLUSIVE — compared nothing; this is not an all-clear.');
    return { deferred: false };
  }

  // ── Group A: team metadata → `teams` (independent + non-destructive) ──
  // Detached from person data so a person-data hiccup never blocks the
  // source-of-truth team name/league sync (update-only, no deletes). A transient
  // VM 403/timeout defers it (warn); a write/unexpected error fails hard.
  let teamSync = null, teamCount = 0;
  try {
    const teams = await withTimeout(fetchTeams(jar, csrf, wuid), FETCH_TIMEOUT_MS, 'teams');
    teamCount = teams.length;
    teamSync = await syncToTeams(teams);
  } catch (e) {
    classifyGroupFailure('teams', e, failures, warnings);
    console.error(`✗ Team metadata sync skipped: ${e.message}`);
  }

  // ── Group B: person data → `sv_vm_check` + members (all-or-nothing) ──
  // sv_vm_check rows are a MERGE of players+writers+referees+teamMembers, and
  // upsertToDirectus deletes stale rows + overwrites flags — a partial merge
  // would corrupt/delete, so all four READS must succeed before any write.
  // Volleymanager's indoor data API flaps as a whole (player + writer + referee
  // all 403 in the same bad window — seen 2026-06-18), so don't single out the
  // club-admin endpoints: ANY transient read failure defers the whole group as a
  // soft WARNING (exit 0, no alert/watchdog storm; refreshes next run). The reads
  // are kept separate from the WRITE so a Directus write failure stays a hard
  // failure that alerts.
  let rows = null, memberSync = null, vmReadOk = true;
  let players, writers, referees, teamMembers;
  try {
    players = await withTimeout(fetchPlayers(jar, csrf, wuid), FETCH_TIMEOUT_MS, 'players');
    teamMembers = await withTimeout(fetchTeamMembers(jar, csrf, wuid), FETCH_TIMEOUT_MS, 'team-members');
    writers = await withTimeout(fetchWriters(jar, csrf, wuid), FETCH_TIMEOUT_MS, 'writers');
    referees = await withTimeout(fetchReferees(jar, csrf, wuid), FETCH_TIMEOUT_MS, 'referees');
  } catch (e) {
    vmReadOk = false;
    classifyGroupFailure('person-data', e, failures, warnings);
    console.warn(`⚠ Person-data read skipped (${e.message}) — nothing written or deleted, will refresh next run.`);
  }
  if (vmReadOk) {
    try {
      console.log('\nMerging...');
      rows = buildCheckTable(players, writers, referees, teamMembers, []);
      await upsertToDirectus(rows);
      memberSync = await syncToMembers(rows);
    } catch (e) {
      // Failure writing to OUR Directus — a real problem → alert + retry.
      failures.push(`person-data write: ${e.message}`);
      console.error(`✗ Person-data write to Directus failed: ${e.message}`);
    }
  }

  // Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n========== SUMMARY (${elapsed}s) ==========`);
  if (teamSync) {
    console.log(`Teams (VM):     ${teamCount}`);
    console.log(`  └ Synced:     updated=${teamSync.updated}, unchanged=${teamSync.unchanged}, no-match=${teamSync.unmatched}, errors=${teamSync.errors}`);
  } else {
    console.log('Teams (VM):     SKIPPED (fetch failed)');
  }
  if (rows && memberSync) {
    console.log(`Check rows:     ${rows.length}`);
    console.log(`  ├ Writers:    ${rows.filter(r => r.is_writer).length}`);
    console.log(`  ├ Referees:   ${rows.filter(r => r.is_referee).length}`);
    console.log(`  └ With team:  ${rows.filter(r => r.team_names).length}`);
    console.log(`Members synced: ${memberSync.matched} matched, ${memberSync.updated} updated, ${memberSync.errors} errors`);
  } else {
    console.log('Person data:    SKIPPED (fetch failed)');
  }

  // ── Group C: hall audit (read-only, never fatal) ──────────────────
  // Reports only. A hall mismatch is a real finding needing a human, but it is
  // NOT a sync error: nothing here writes, so failing the run would alert + make
  // the watchdog retry something a retry cannot fix, and would falsely mark the
  // person/team syncs (which DID apply) as failed. A transient VM 403 during the
  // audit is likewise just skipped — the next weekly run re-checks.
  try {
    const audit = await withTimeout(auditHalls(jar, csrf, wuid), FETCH_TIMEOUT_MS, 'hall-audit');
    if (audit.checked === 0) {
      // Never print a ✓ for a comparison that never happened.
      console.warn(`\n⚠ Hall audit INCONCLUSIVE — 0 of ${audit.fixtures} ${audit.season} VM fixtures could be compared. Expect a games row per fixture; this means our side is unscheduled or unreadable, NOT that the halls agree.`);
    } else if (audit.mismatches.length) {
      console.warn(`\n⚠ HALL MISMATCH — VM disagrees with wiedisync on ${audit.mismatches.length} of ${audit.checked} approved ${audit.season} home fixture(s):`);
      for (const m of audit.mismatches) console.warn(`    ${m}`);
      console.warn('  Nobody pushes halls to VM — these were placed by the league and have drifted from us.');
      console.warn('  Fix the wrong side by hand; a combo gym (KWI A+B) is expected for the H1/H3 derbies.');
    } else {
      console.log(`\n✓ Hall audit: ${audit.checked} of ${audit.fixtures} ${audit.season} home fixtures match VM`
        + ` (skipped — unscheduled ${audit.skipped.unscheduled}, no hall ${audit.skipped.noHall},`
        + ` not yet approved ${audit.skipped.notApproved}, unmapped ${audit.skipped.unmapped})`);
    }
  } catch (e) {
    console.error(`\n✗ Hall audit skipped (non-fatal): ${e.message}`);
  }

  // Hard failures → throw so the cron records `error`, alerts, and the 30-min
  // watchdog retries — while the group(s) that DID succeed stay applied. A
  // writer/referee-only 403 is a soft WARNING: the run still exits 0 (cron logs
  // OK), so a flaky upstream club-admin endpoint can't fail the whole sync or
  // spam alerts. The warning text is captured in the cron's stdout log.
  if (failures.length) {
    throw new Error(failures.join(' | '));
  }
  if (warnings.length) {
    // Signal a soft DEFER to the caller (exit 75 below). The cron records this
    // as `deferred` (not `error`) — no alert — and the watchdog retries a few
    // times to catch a healthy VM window before backing off to the weekly run.
    console.warn(`\n⚠ Completed with warnings — deferred: ${warnings.join(' | ')}`);
    return { deferred: true };
  }
  return { deferred: false };
}

// Exit explicitly. A timed-out stage leaves its retry loop running in the
// background (withTimeout stops waiting but can't cancel it), whose pending
// timers + in-flight fetches keep the event loop alive — without an explicit
// exit the process would linger long after the sync logically finished. On
// success/warnings exit 0; a thrown (hard) failure exits 1 → cron alerts/retries.
main()
  .then((r) => process.exit(r && r.deferred ? 75 : 0))   // 0 = full sync, 75 = soft defer (transient VM), 1 = hard failure
  .catch(e => { console.error('✗ Fatal:', e.message); process.exit(1); });
