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

// ─── Config ──────────────────────────────────────────────────────────
const VM_USERNAME = process.env.VM_USERNAME;
const VM_PASSWORD = process.env.VM_PASSWORD;
if (!VM_USERNAME || !VM_PASSWORD) {
  console.error('Missing VM_USERNAME or VM_PASSWORD environment variables');
  process.exit(1);
}
const DIRECTUS_URL = process.env.DIRECTUS_URL || 'https://directus-dev.kscw.ch';
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || process.env.DIRECTUS_ADMIN_TOKEN;
const DIRECTUS_EMAIL = process.env.ADMIN_EMAIL || 'admin@kscw.ch';
const DIRECTUS_PASSWORD = process.env.ADMIN_PASSWORD;
if (!DIRECTUS_TOKEN && !DIRECTUS_PASSWORD) {
  console.error('Set DIRECTUS_TOKEN or ADMIN_PASSWORD environment variable');
  process.exit(1);
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

    const r = await fetch(base, { method: 'POST', headers, body: params.toString() });
    if (!r.ok) {
      const text = await r.text();
      const msg = text.match(/In path ([^:]+):/)?.[0] || `HTTP ${r.status}`;
      throw new Error(`${resourcePath}: ${msg}`);
    }
    const json = await r.json();
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

function buildCheckTable(players, writers, teamMembers, teams) {
  // Index writers by associationId → Set
  const writerIds = new Set();
  for (const w of writers) {
    const id = w.person?.associationId;
    if (id) writerIds.add(id);
  }

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
      team_names: teamNames.length > 0 ? teamNames.join(', ') : null,
      team_ids: teamIds.length > 0 ? teamIds.join(', ') : null,
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

  if (toDelete.length > 0) {
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

  // Fetch all members (paginated) — we want to backfill members without license_nr too.
  const members = [];
  let page = 1;
  while (true) {
    const url = `${DIRECTUS_URL}/items/members?fields=id,license_nr,sex,licences,scorer_vb,vm_email,email,first_name,last_name,birthdate,birthdate_visibility,licence_category,licence_activated,licence_validated&limit=250&page=${page}`;
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

    // Migration 067: licences is split into per-flag booleans. Dual-write
    // (boolean + legacy JSON) through the cutover window — migration 069
    // drops the JSON column and the `payload.licences = …` branches.
    const hasScorer = member.scorer_vb === true;
    if (row.is_writer && !hasScorer) {
      payload.scorer_vb = true;
      const currentLicences = Array.isArray(member.licences) ? [...member.licences] : [];
      if (!currentLicences.includes('scorer_vb')) {
        currentLicences.push('scorer_vb');
        payload.licences = currentLicences;
      }
      changed = true;
    } else if (!row.is_writer && hasScorer) {
      payload.scorer_vb = false;
      const currentLicences = Array.isArray(member.licences) ? [...member.licences] : [];
      payload.licences = currentLicences.filter(l => l !== 'scorer_vb');
      changed = true;
    }

    if (changed) updates.push(payload);
  }

  console.log(`  Matched: ${matched} (license=${matchedByLicense}, email=${matchedByEmail}, name+dob=${matchedByNameDob}, name=${matchedByName}), To update: ${updates.length}`);
  console.log(`  Backfill: license_nr=${backfilledLicense}, birthdate=${backfilledBirthdate}`);

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

async function main() {
  const t0 = Date.now();

  const jar = await vmLogin({ username: VM_USERNAME, password: VM_PASSWORD });
  const { csrf, wuid } = await csrfFromPage(jar, '/sportmanager.indoorvolleyball/indoorwriter/index');
  console.log('✓ Logged in to Volleymanager\n');

  // Fetch all 4 datasets
  const teams = await fetchTeams(jar, csrf, wuid);
  const players = await fetchPlayers(jar, csrf, wuid);
  const writers = await fetchWriters(jar, csrf, wuid);
  const teamMembers = await fetchTeamMembers(jar, csrf, wuid);

  // Build merged table
  console.log('\nMerging...');
  const rows = buildCheckTable(players, writers, teamMembers, teams);

  // Upsert to Directus
  await upsertToDirectus(rows);

  // Sync VM data to members
  const memberSync = await syncToMembers(rows);

  // Summary
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n========== SUMMARY (${elapsed}s) ==========`);
  console.log(`Teams:          ${teams.length}`);
  console.log(`Players:        ${rows.length}`);
  console.log(`  ├ Writers:    ${rows.filter(r => r.is_writer).length}`);
  console.log(`  └ With team:  ${rows.filter(r => r.team_names).length}`);
  console.log(`Team members:   ${teamMembers.length} assignments`);
  console.log(`Members synced: ${memberSync.matched} matched, ${memberSync.updated} updated, ${memberSync.errors} errors`);
}

main().catch(e => { console.error('✗ Fatal:', e.message); process.exit(1); });
