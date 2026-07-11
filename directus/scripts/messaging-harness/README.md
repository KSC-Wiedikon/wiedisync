# Messaging Integration Test Harness

Run against `directus-dev` to verify schema, triggers, and endpoint skeleton across Plans 01–06 of the messaging system.

## Requirements

- `DIRECTUS_DEV_TOKEN` — a Superuser static token for `directus-dev.kscw.ch`. Find it on your own user row:
  ```bash
  ssh hetzner "sudo docker exec -i kscw-postgres psql -U supabase_admin -d directus_kscw_dev -t -c \"SELECT token FROM directus_users WHERE email = 'luca.canepa@gmail.com';\"" | tr -d ' \n'
  ```
  The `DIRECTUS_ADMIN_TOKEN` in the container `.env` does NOT work for the `/items/*` API — use a real user's token.
- `DIRECTUS_DEV_DB_URL` — Postgres connection string for the Supabase-hosted dev DB:
  ```
  postgres://supabase_admin:<DB_PASSWORD>@<host>:5432/directus_kscw_dev
  ```
  Reach the DB directly via:
  ```bash
  ssh hetzner "sudo docker exec -i kscw-postgres psql -U supabase_admin -d directus_kscw_dev"
  ```
- `MESSAGING_SYSTEM_MEMBER_ID` — set once Plan 01 Task 11 (sentinel) completes.

## Usage

```bash
cd directus/scripts/messaging-harness
npm install   # first time only — installs pg locally
cd ../../..
DIRECTUS_DEV_TOKEN=xxx \
DIRECTUS_DEV_DB_URL=postgres://... \
MESSAGING_SYSTEM_MEMBER_ID=<uuid> \
node directus/scripts/messaging-harness/messaging-int.mjs
```

Exit 0 = all assertions passed. Exit 1 = one or more failed.

## What it asserts

### Plan 01 block
- All 7 new collections exist (`conversations`, `conversation_members`, `messages`, `message_reactions`, `blocks`, `message_requests`, `reports`).
- All 7 new fields on `members` (see spec §3).
- All 5 Postgres triggers exist (spec §3 Triggers 1, 2, 3/4 merged, 6, + sentinel-protect). Spec Trigger 5 is enforced via FK `ON DELETE` rules, not a trigger.
- Sentinel system-user member exists at `MESSAGING_SYSTEM_MEMBER_ID`.
- All endpoint skeleton routes return `501` (Plan 01) or the correct status code (later plans).

### Plan 02 block

The Plan 02 block runs the seed automatically (`seed-plan02.mjs` via `child_process.execSync`) then uses `DIRECTUS_DEV_USER_TOKEN_A` to make user-scoped requests. It asserts:

1. `GET /kscw/messaging/conversations` → 200, test conv appears with `type='team'`.
2. `POST /kscw/messaging/messages` → 200, DB row has correct body + sender.
3. `POST /kscw/messaging/conversations/:id/read` → 200, `last_read_at` bumped within 10 s.
4. `POST /kscw/messaging/conversations/:id/mute` → toggles `muted` true → false.
5. `GET /kscw/messaging/conversations` (again) → `unread_count = 0` after mark-read.
6. `POST /kscw/messaging/messages` with a non-member conversation → 403 `messaging/not_a_member`.
7. `POST /kscw/messaging/messages` with empty body → 400 `messaging/invalid_body`.
8. With `communications_team_chat_enabled=false` → 403 `messaging/comms_disabled` (flag restored in `finally`).

#### Additional env vars required for Plan 02

- `DIRECTUS_DEV_USER_TOKEN_A` — a **user-scoped** static token for the test member
  `plan02-a@kscw.test` (the `members` row is created by `seed-plan02.mjs`; the linked
  `directus_users` row must be created and connected manually by Luca). Mint it in Directus admin:
  **Users → find `plan02-a@kscw.test` → Static Token tab → Generate → copy.**
  Without this token the Plan 02 block reports 1 failure (`plan02 user token`) and skips
  assertions 1–8.

#### Running the seed standalone (debugging)

```bash
cd /path/to/wiedisync
set -a && source .env.local && set +a
node directus/scripts/messaging-harness/seed-plan02.mjs
# Prints: {"teamId":...,"convId":"...","memberA":...,"memberB":...}
```

The seed is idempotent — safe to re-run. It also clears leftover messages from prior harness runs.

### Plan 03 additions

- `DIRECTUS_DEV_USER_TOKEN_B` — a user-scoped static token for `plan02-b` (the member's
  directus_users row has email `plan02-b@kscw.ch`; the linked `members` row has email
  `plan02-b@kscw.test`). Mint it in Directus admin the same way as TOKEN_A:
  Users → find the user → Static Token tab → Generate → Save → copy.
- `DIRECTUS_DEV_USER_TOKEN_C` — **optional**. Static token for the plan03-c member.
  Without it the harness skips the decline + cooldown assertions — the other Plan 03
  assertions still run.

The seed (`seed-plan03.mjs`) is idempotent and also resets any DM/request/block state
between plan02-a, plan02-b, and plan03-c so tests start from a clean slate every run.

### Plan 04 additions

Plan 04 reuses `DIRECTUS_DEV_TOKEN` (admin) for the reports queue assertions.
No new seed or token env vars. The seed-plan02 + seed-plan03 scripts cover all
Plan 04 scenarios — member A sends messages, A edits / self-deletes, B files
reports, admin resolves.

All Plan 04 assertions restore member A's state in `finally` blocks so the
harness is safe to re-run indefinitely.

### Plan 05 additions

Plan 05 reuses `DIRECTUS_DEV_USER_TOKEN_A` for 6 assertions: 3 consent variants,
clear conversation, export JSON bundle, and the 1/day rate limit.

The harness mutates `members.consent_decision` + flags + `last_export_at` and
restores them at the end of the block. Safe to re-run.

After Plan 05 completes, `EXPECTED_ENDPOINTS` is empty — all messaging endpoints
are live.

## Broadcast harness (Plan 01 / Phase B / Task B7)

Separate, standalone runner for the broadcast (contact-all) endpoints. Lives
in this directory but is independent of the messaging assertions — run it
directly:

```bash
cd /path/to/wiedisync
set -a && source .env.local && set +a
node directus/scripts/messaging-harness/broadcast-int.mjs
```

Asserts 13 scenarios against `https://directus-dev.kscw.ch/kscw/activities/*`
covering happy-path send, preview, audience expansion, externals, RBAC,
rate-limit, payload validation, audit-row, 404 handling, and empty audience.

### Required env vars

- `DIRECTUS_DEV_DB_URL` — same as the messaging harness.
- `DIRECTUS_DEV_USER_TOKEN_LUCA` — static token for `luca.canepa@gmail.com`
  (member 8). Member's `role` includes `'admin'`, so RBAC short-circuits for
  any activity. Acts as the **COACH_TOKEN_X** in the spec.
- `DIRECTUS_DEV_USER_TOKEN_MEMBER` — static token for
  `federico.felician@gmail.com` (member 9, role=`['user']`, no team junction
  on the test team). Acts as **MEMBER_TOKEN_X** for the 403 assertions.

Both tokens already exist in dev — mint a fresh one if either gets revoked
via Directus admin: **Users → find user → Token → Generate → Save → copy.**

### Seed (`seed-broadcast.mjs`)

Idempotent. Provisions:
- Test team `__broadcast_test_team__` (volleyball, 2025/26)
- Test event `__broadcast_test_event__` linked to the team
- Test training (`notes='__broadcast_test_training__'`) for assertions 1-6, 8-12
- Rate-limit training (`notes='__broadcast_ratelimit_training__'`) used by
  assertion 7 (3 fake audit rows pre-seeded by the harness) and assertion 13
  (empty-audience send)
- 5 test members on the team with `.kscw.test` (RFC 2606 reserved) emails:
  `broadcast-test-{a,b,c,d,e}@kscw.test` — 3 confirmed (A, D, E), 1 tentative
  (B), 1 declined (C). The fake TLD ensures fan-outs never reach a real inbox
  even though SMTP submission succeeds.
- 1 external signup on the test event (`broadcast-ext@example.com`,
  `form_slug='broadcast-test'`, `is_member=false`).

Wipes `broadcasts` audit rows for the three test activities on every run so
the rate-limit gate starts from a clean slate.

### Real-email impact per run

3 emails attempted to `.kscw.test` addresses (assertion 1 happy path). The
SMTP relay accepts submission and the addresses bounce silently downstream
— **no real human inbox is hit**.
