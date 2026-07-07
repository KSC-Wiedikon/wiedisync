# `directus/scripts/` inventory

This directory holds the Directus database tooling for KSCW: the migration journal, the deploy chain (migrations, permissions, smoke test, baseline), schema sync helpers, the ClubDesk and VolleyManager / SVRZ integrations, and a set of historical one-off scripts kept for reference. This README maps every non-migration script to what it does and how it is invoked, so the old one-offs are no longer mysterious.

> **Numbered migrations are not listed here.** `NNN-*.sql` and `NNN-*.mjs` (e.g. `001-postgres-triggers.sql`, `005-add-announcements.mjs`, `009-messaging-permissions.mjs`) are the migration journal. `apply-migrations.mjs` discovers both `.sql` and `.mjs` via `/^\d{3}-.+\.(sql|mjs)$/`, and applies `_migrations-tracker.sql` first as the idempotent bootstrap that creates the `kscw_migrations` tracking table. **Never run a numbered migration (or the tracker) by hand** — use `npm run db:migrate:dev` / `npm run db:migrate:prod`. See `CLAUDE.md → Migration & Permission Policy`.

## Active tooling

| Script | What it does | How it is invoked |
| --- | --- | --- |
| `apply-migrations.mjs` | Migration runner. Reads the `kscw_migrations` tracker, lists numbered `NNN-*.sql` + `NNN-*.mjs` on disk, applies pending in numeric order, enforces apply-once via sha256 (errors if an applied file's content changed). | `npm run db:migrate:dev` / `db:migrate:prod` and `db:migrate:status:dev` / `db:migrate:status:prod`; part of the `db:deploy:dev` / `db:deploy:prod` chain. |
| `setup-permissions.mjs` | Single declarative, idempotent source of truth for all Directus permission rows: clears then recreates per policy. Re-runs are safe and required after every deploy. | `npm run db:setup-perms:dev` / `db:setup-perms:prod`; part of the `db:deploy` chain. |
| `smoke-test.mjs` | Logs in as a non-admin Member and exercises every collection that `loadTeamContext` + the home page touch; catches the silent `Promise.all` permission-failure pattern. | `npm run db:smoke:dev` / `db:smoke:prod`; part of the `db:deploy` chain. |
| `regenerate-baseline.mjs` | Pulls the current Postgres DDL (schema-only) from the target DB and writes `directus/scripts/SCHEMA.sql`, the fresh-install snapshot. Run after any schema migration. | `npm run db:baseline:dev` / `db:baseline:prod`. |
| `schema-pull.mjs` | Pulls a Directus schema snapshot into `directus/sync/`. | `npm run schema:pull`. |
| `schema-diff.mjs` | Compares the local schema snapshot in `directus/sync/` against a remote Directus instance. | `npm run schema:diff`. |
| `schema-push.mjs` | Pushes the local schema snapshot to a remote Directus instance (diff then apply). No default URL, to prevent accidental pushes. | `npm run schema:push`. |
| `refresh-dev-from-prod.sh` | On-demand prod → dev DB clone with PII scrub + token re-pin (there is no automatic prod → dev sync). | `npm run db:refresh-dev`. |
| `clubdesk-scrape-export.mjs` | Headless-browser (Playwright) scraper that logs into ClubDesk and exports the member CSV (no ClubDesk API exists). | `npm run db:clubdesk:export`, and inside `db:clubdesk:sync:dev` / `:prod`. Deployed to the VPS at `/opt/clubdesk-sync/` and run by the weekly host cron (Sat 22:00 UTC) — see `INFRA.md → ClubDesk`. |
| `import-clubdesk-csv.mjs` | Transforms the ClubDesk CSV into SQL (`--emit-sql`): loads the `clubdesk_export` staging table, enriches existing `members` (birthdate/contact/linker/sex/identity/referee passes), **creates** `members` rows for current ClubDesk members missing from Directus (same-person guards + `clubdesk_contact_suspected_duplicate` report), and refreshes `public_stats.member_count`. | `npm run db:clubdesk:import:dev` / `:prod`, and inside `db:clubdesk:sync:dev` / `:prod`. Also deployed to `/opt/clubdesk-sync/`. Covered by `__tests__/import-clubdesk-csv.test.mjs`. |
| `clubdesk-sync.sh` | Orchestrator run on the VPS host cron: scrape (Playwright container) → transform SQL → pipe into the pg container. | Not in `package.json`; root crontab on the VPS calls `/opt/clubdesk-sync/clubdesk-sync.sh` (weekly Sat 22:00 UTC). See `INFRA.md → ClubDesk`. |
| `clubdesk-diff-queries.sql` | Cross-check SQL run against the DB to reconcile the `clubdesk_export` staging table vs `members` after a sync. | `npm run db:clubdesk:diff:dev` / `:prod` (piped into `psql` over ssh). |
| `vm-sync-check.mjs` | VolleyManager scraper — source of truth for team names / leagues + referee licences; upserts `sv_vm_check` and updates `members` / `teams`. | Runtime-spawned by the `kscw-hooks` weekly cron (`0 4 * * 1`) and by the `kscw-endpoints` admin endpoint `POST /admin/vm-sync`. See `INFRA.md → Volleymanager Sync`. |
| `svrz-scheduling-sync.mjs` | Walks the SVRZ JSON API, upserts `svrz_games` + `svrz_spielplaner_contacts` (with per-team-responsibles keying). | Runtime-spawned by the `kscw-hooks` nightly cron, by the admin endpoint `POST /admin/svrz-sync`, and from `kscw-endpoints/src/game-scheduling.js`. Unit-tested (see Tests). |
| `vm-push-game.mjs` | Pushes one confirmed home-game date / time / hall into VolleyManager via the writable indoor-game API (validate then update; **never finalizes**). | Runtime-spawned fire-and-forget by the Terminplanung confirm-home / manual-booking / vm-push flow in `kscw-endpoints/src/game-scheduling.js`. See `CHANGELOG.md` v4.28.0 + the `vm-write-api` memory. |
| `vm-client.mjs` | Shared VolleyManager HTTP client (CookieJar, login, CSRF, redirect-follow). Pure module — reads no env vars; callers pass credentials explicitly. | Imported by `vm-push-game.mjs`, `vm-sync-check.mjs`, `svrz-scheduling-sync.mjs`, and dynamically by `kscw-endpoints/src/game-scheduling.js`. Unit-tested (see Tests). |
| `backfill-roles.mjs` | Backfills the correct Directus role for all existing members (members.role array + coach / team-responsible junction membership), paired with the role-sync hook. Re-runnable operational backfill. | Not in `package.json`; run by hand as documented in `INFRA.md → Scripts` (`node directus/scripts/backfill-roles.mjs`). |
| `setup-schema.mjs` | Creates all collections + fields via the Directus API; the original full-schema bootstrap. **API-side fresh-install companion to `SCHEMA.sql`** — kept current alongside it (e.g. updated for the migration-058 `hide_email` and migration-093 `text()` changes), but `SCHEMA.sql` is now the primary fresh-install snapshot per `CLAUDE.md` rule 6. | **No `package.json` caller**; run by hand for an API-driven fresh install (`node scripts/setup-schema.mjs` against a running Directus). |

> Runtime-spawned scripts (`vm-sync-check`, `svrz-scheduling-sync`, `vm-push-game`, `vm-client`) live bind-mounted inside the Directus container at `/directus/scripts/`. `ext:deploy` does **not** sync this folder — push it separately with `npm run scripts:deploy:dev` / `scripts:deploy:prod`.

## Tests

Unit tests in `directus/scripts/__tests__/*.test.mjs` use the built-in `node:test` runner (**not vitest** — vitest's include glob only matches `directus/extensions/**`). Run them with:

```
npm run test:scripts      # node --test directus/scripts/__tests__/*.test.mjs
```

- `__tests__/svrz-scheduling-sync.test.mjs` — tests `svrz-scheduling-sync.mjs` (`filterSchedulableGames`, `gameToSvrzRow`, `buildSearchBody`, contact / team-responsible keying) against JSON fixtures.
- `__tests__/vm-client.test.mjs` — tests the `vm-client.mjs` CookieJar (store / serialize, update from `Set-Cookie`).
- `__tests__/fixtures/games-sample.json`, `__tests__/fixtures/contacts-sample.json` — fixtures loaded by the SVRZ test.

The `messaging-harness/` subdirectory (`messaging-int.mjs`, `broadcast-int.mjs`, `seed-broadcast.mjs`, `seed-plan02.mjs`, `seed-plan03.mjs`) is the **manual-run, env-gated integration harness** for the messaging system (Plans 01-06; messaging shipped in v4.0.0). It is not wired into any automated runner — see `messaging-harness/README.md` for how to run it against `directus-dev` with `DIRECTUS_DEV_TOKEN` / DB URL env vars.

## Historical / one-off (kept for reference, not run in normal operation)

These ran once for a specific migration or data-repair and are now superseded or captured in the schema baseline. They are kept for reference; do not run them as part of normal operation.

- `dedupe-member-teams.mjs` — Found and removed duplicate `(member, team)` rows in `member_teams` (dry-run by default, `--apply` deletes, keeping the lowest id). Run before migration 044, which added the `UNIQUE (member, team)` constraint that now prevents new duplicates. Historical: the constraint is the backstop now, but the script stays as a safe, idempotent repair utility (`docs/DEVLOG.md` v4.5.3).
- `backfill-member-gender.mjs` — One-off backfill of `members.sex` from `sv_vm_check.gender` (license / email / name matching, `--dry-run` supported). Historical: `vm-sync-check.mjs` now keeps gender in sync on an ongoing basis.
- `create-scorer-courses.mjs` — One-off (self-declared): created the `scorer_courses` collection + fields and seeded the initial row (idempotent). Historical: the collection now lives in `SCHEMA.sql` / `directus/sync/`, so its job is done.
- `fix-schema-gaps.mjs` — One-off from the early Directus build-out: added three specific schema gaps (`members.requested_team` M2O, `hall_events.hall` M2M, `hall_slots.teams` M2M). Historical: all three are long since in the live schema / baseline.
- `create-users.mjs` — PocketBase → Directus migration-era helper: created `directus_users` from migrated members and linked them via a `user` M2O on `members`. Historical: ongoing role provisioning is now handled by the role-sync hook + `backfill-roles.mjs`.
- `migrate-passwords.mjs` — PocketBase → Directus migration-era helper: wrote PB bcrypt password hashes directly into Postgres (Directus accepts `$2a$` natively). Historical: the PB migration is complete; auth-touching, so kept for reference rather than deleted.
- `test-migration.mjs` — PocketBase → Directus migration validation harness: counts and asserts data integrity after the one-time migration (`node scripts/test-migration.mjs`). Historical: the migration is long complete; not wired into any CI / `package.json` runner.

> **Removed in this cleanup (recorded for history):** `vm-fetch-writers-referees.mjs` (a standalone ad-hoc VM fetch of writers & referees with zero callers; inlined its own CookieJar instead of `vm-client.mjs`; superseded by `vm-sync-check.mjs`) and `id-map.json` (the PocketBase → Directus polymorphic ID-remap output from the one-time migration; no code read it — only `hall_slots` was ever populated). Both were dead migration artifacts. If you need them, recover from git history.
