/**
 * Push local schema snapshot to a remote Directus instance (2-step: diff then apply).
 * Usage: node directus/scripts/schema-push.mjs
 *
 * Env vars:
 *   DIRECTUS_URL   — Target Directus URL (REQUIRED — no default, to prevent accidental pushes)
 *   DIRECTUS_TOKEN — Admin token
 *   DIRECTUS_EMAIL / DIRECTUS_PASSWORD — Alternative: login credentials
 *   SCHEMA_DRY_RUN — Set to "true" to only show the diff without applying
 *   SCHEMA_ALLOW_DELETE — Set to "true" to permit a diff that DROPS collections/
 *                         fields/relations. Without it, any deletion aborts.
 *   SCHEMA_FORCE  — Set to "true" to send ?force=true (bypasses Directus's
 *                   version + database-vendor checks). Off by default.
 *
 * ⚠ THE MIGRATION JOURNAL IS THE REAL PATH. Every collection this platform has
 * gained since 2026-04 was created by a numbered migration in this directory,
 * NOT by schema:push — and `sync/snapshot.json` has not kept up. Pushing a
 * stale snapshot is how you drop a live module. Prefer `db:migrate:*`; use this
 * only with a snapshot you pulled from the SAME environment minutes earlier.
 *
 * The guards below exist because all three of these were true at once
 * (audit 2026-08-08, finding 4): `force=true` was hardcoded, the diff defaulted
 * to a deletion-inclusive mirror, and the "Collections: +0 ~0 -0" summary was
 * dead code reading the wrong object — so the committed snapshot would have
 * dropped ≥46 live collections while printing an all-clear.
 */

const DIRECTUS_URL = (process.env.DIRECTUS_URL || '').replace(/\/$/, '');
if (!DIRECTUS_URL) {
  console.error('DIRECTUS_URL is required. Set it to the target Directus instance URL.');
  console.error('Example: DIRECTUS_URL=https://directus.kscw.ch npm run schema:push');
  process.exit(1);
}

const SYNC_DIR = new URL('../sync/', import.meta.url).pathname;
const DRY_RUN = process.env.SCHEMA_DRY_RUN === 'true';
const ALLOW_DELETE = process.env.SCHEMA_ALLOW_DELETE === 'true';
const FORCE = process.env.SCHEMA_FORCE === 'true';

/** Count entries whose first diff op is `kind`, for one section of the diff. */
function countKind(section, kind) {
  return (section || []).filter((e) => e.diff?.[0]?.kind === kind).length;
}

/** Names of the entries in a section that would be DROPPED. */
function deletionNames(section, nameKey) {
  return (section || [])
    .filter((e) => e.diff?.[0]?.kind === 'D')
    .map((e) => e[nameKey] || e.collection || '(unnamed)');
}

async function getToken() {
  if (process.env.DIRECTUS_TOKEN) return process.env.DIRECTUS_TOKEN;

  const email = process.env.DIRECTUS_EMAIL || 'admin@kscw.ch';
  const password = process.env.DIRECTUS_PASSWORD;
  if (!password) {
    console.error('Set DIRECTUS_TOKEN or DIRECTUS_PASSWORD');
    process.exit(1);
  }

  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    console.error('Login failed:', res.status, await res.text());
    process.exit(1);
  }
  const { data } = await res.json();
  return data.access_token;
}

async function main() {
  const fs = await import('node:fs');
  const path = await import('node:path');

  const snapshotPath = path.join(SYNC_DIR, 'snapshot.json');
  if (!fs.existsSync(snapshotPath)) {
    console.error('No local snapshot found. Run schema:pull first.');
    process.exit(1);
  }

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  const token = await getToken();

  // Step 1: Get diff
  console.log(`Diffing local snapshot against ${DIRECTUS_URL} ...`);
  // `force` bypasses the version + vendor guard. That guard is the thing that
  // stops an 11.x snapshot being applied to a 12.x instance, so it is opt-in.
  const diffRes = await fetch(`${DIRECTUS_URL}/schema/diff${FORCE ? '?force=true' : ''}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(snapshot),
  });

  if (diffRes.status === 204) {
    console.log('No differences — schemas are already identical. Nothing to apply.');
    return;
  }

  if (!diffRes.ok) {
    console.error('Schema diff failed:', diffRes.status, await diffRes.text());
    process.exit(1);
  }

  // `/schema/diff` answers { data: { hash, diff: { collections, fields, relations } } }.
  // This used to destructure `{ data: diff }` and then read `diff.collections`,
  // which is always undefined — so the summary printed "+0 ~0 -0" for every diff,
  // including one that dropped the whole finance module. `payload` is what
  // /schema/apply wants; `diff` is what the counters need.
  const { data: payload } = await diffRes.json();
  const diff = payload?.diff || {};

  const collectionsToCreate = countKind(diff.collections, 'N');
  const collectionsToUpdate = countKind(diff.collections, 'E');
  const collectionsToDelete = countKind(diff.collections, 'D');
  const fieldsToDelete = countKind(diff.fields, 'D');
  const relationsToDelete = countKind(diff.relations, 'D');
  const fieldsChanged = diff.fields?.length || 0;
  const relationsChanged = diff.relations?.length || 0;

  console.log(`\nDiff summary:`);
  console.log(`  Collections: +${collectionsToCreate} ~${collectionsToUpdate} -${collectionsToDelete}`);
  console.log(`  Fields changed: ${fieldsChanged} (${fieldsToDelete} dropped)`);
  console.log(`  Relations changed: ${relationsChanged} (${relationsToDelete} dropped)`);

  const totalDeletes = collectionsToDelete + fieldsToDelete + relationsToDelete;
  if (totalDeletes > 0) {
    const dropped = deletionNames(diff.collections, 'collection');
    console.warn(`\n⚠ This diff DROPS ${totalDeletes} schema object(s).`);
    if (dropped.length) {
      console.warn(`  Collections to be dropped (${dropped.length}):`);
      for (const name of dropped) console.warn(`    - ${name}`);
    }
  }

  // A dry run applies nothing, so it must always be allowed to REPORT the
  // deletions — aborting here would hide exactly what the operator ran the dry
  // run to see. The abort belongs on the apply path only.
  if (DRY_RUN) {
    console.log('\nDry run — full diff:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\nDry run complete. Set SCHEMA_DRY_RUN=false or remove it to apply.');
    return;
  }

  if (totalDeletes > 0) {
    if (!ALLOW_DELETE) {
      console.error('\nRefusing to apply. A deletion almost always means the local snapshot is');
      console.error('STALE, not that the remote has extra collections — this platform creates');
      console.error('collections through numbered migrations, which never touch sync/snapshot.json.');
      console.error('Re-pull the snapshot from this same environment and diff again.');
      console.error('If the deletions are genuinely intended: SCHEMA_ALLOW_DELETE=true');
      process.exit(1);
    }
    console.warn('  SCHEMA_ALLOW_DELETE=true — proceeding with deletions.\n');
  }

  // Step 2: Apply diff
  console.log(`\nApplying schema changes to ${DIRECTUS_URL} ...`);
  const applyRes = await fetch(`${DIRECTUS_URL}/schema/apply`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (applyRes.status === 204) {
    console.log('Schema applied successfully.');
    return;
  }

  if (!applyRes.ok) {
    console.error('Schema apply failed:', applyRes.status, await applyRes.text());
    process.exit(1);
  }

  console.log('Schema applied successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
