# Security baseline — KSCW (`wiedisync`)

Living doc for the security posture of the KSCW platform. Audited findings, fixes, gotchas, and rules. Update on every audit pass.

> **Reporting:** mail `kontakt@kscw.ch`. Do NOT open a public issue with exploit details. Production lives at `wiedisync.kscw.ch` + `directus.kscw.ch` (Hetzner via Cloudflare Tunnel).

---

## Trust boundaries

| Surface | Origin | Auth | Notes |
|---|---|---|---|
| `wiedisync.kscw.ch` (React) | CF Pages, prod branch | Directus access token (localStorage / sessionStorage based on remember-me) | Talks only to `directus.kscw.ch`. CF Pages env vars carry only `VITE_*` (public). |
| `wiedisync.pages.dev` (React dev) | CF Pages, dev branch | Same | Talks to `directus-dev.kscw.ch`. |
| `directus.kscw.ch` (Directus) | Hetzner VPS via CF Tunnel | Built-in Directus auth (cookies + bearer). Custom endpoints inherit `req.accountability`. | All custom routes under `/kscw/*`. |
| `kscw-push.lucanepa.workers.dev` (CF Worker) | Cloudflare Workers | Shared bearer secret from Directus → worker (constant-time compared since 2026-05-06). | VAPID keys in worker secret store; Directus side reads `VAPID_PUBLIC_KEY` env. |
| `kscw.ch` (ClubDesk) | External | Out of our scope | Don't change DNS until explicitly confirmed. |

Direct VPS exposure (Hetzner ports 8055/8056) is **not** publicly reachable — only via CF Tunnel. If that ever changes, `X-Forwarded-For`-based rate limiters collapse simultaneously (every limiter in `kscw-endpoints` uses it as fallback).

---

## What's gitignored vs. tracked

Already in `.gitignore` (don't commit):

- `.env`, `.env.*` (`.env.example` is the only tracked env file)
- `.env.test` — local-only test creds; the test accounts share a single password (structural value, not reproduced here — see Vaultwarden `services/kscw-test-accounts`). Rotate if leaked.
- `INFRA.md` — contains VPS IPs / SMTP creds / token formats
- `CONTINGENCY.md`
- `directus/.env`, `directus/uploads/`, `directus/node_modules/`
- `.planning/` and `docs/superpowers/{plans,specs}/` (plan/spec docs leak credentials in practice)
- `playwright-report/`, `test-results/`, `e2e/.auth/`

Tracked (must stay clean of secrets):

- `directus/extensions/**` — only `process.env.X` reads, no fallback values to live keys.
- `workers/push/src/**` — same. VAPID + AUTH secrets via `wrangler secret`.
- `src/**` — only `VITE_*` env variables (public by design).

> **Rule:** if you find yourself adding a `|| 'fallback-value'` to a secret env read, push it back. Web push regressed on this once (`VAPID_PUBLIC_KEY` had a hardcoded fallback) — fixed 2026-05-06.

---

## Hardening completed (audit log)

Treat this as a deduplication shield: if a future audit finds something on this list, it's either a regression or a misunderstanding — verify before re-flagging.

The full dated ledger of completed hardening (2026-05-06 → 2026-07-05) is archived in [`SECURITY-archive.md`](SECURITY-archive.md) to keep this doc lean. Append new post-audit `### YYYY-MM-DD` remediation blocks there; move newly-open items into the "Open / accepted" table below.

### 2026-07-13 — deliberate permission WIDENING (not a hardening): `members.wiedisync_active` is now club-wide readable

Recorded here because it **loosens** a read permission, so a future audit sees it was intentional and reviewed rather than a regression.

- **What**: `wiedisync_active` added to `MEMBER_VISIBLE_FIELDS` — every authenticated member can now read this column on **every** member (previously the **finance policy only**).
- **Why**: `MemberMultiSelect` (the event-invite picker) queries `members` club-wide with `filter: { wiedisync_active: { _eq: true } }`. Directus rejects a **filter** on a field the caller cannot read, so every coach/TR opening the event form got a 403 and a silently **empty** invite list. A club-wide query resolves against `MEMBER_POLICY`, not the team-scoped leader read — so the field had to join the club-wide list.
- **Exposure assessment**: the field is a **plain activation boolean** ("has this person activated their Wiedisync account") — **no PII, no credential, no financial data**. It is strictly less sensitive than fields already club-wide readable (`kscw_membership_active`, `license_nr`, `sex`, licence flags). **Public/anon is unchanged** — the null-role policy still does NOT grant it (verified in `directus_permissions` on prod). Accepted risk: a logged-in member can enumerate which other members have activated the app. Judged negligible.
- **Alternative rejected**: narrowing `MemberMultiSelect`'s filter to `kscw_membership_active` (already readable) would have avoided the widening, but silently changes the picker's semantics from "has activated the app" to "is a club member" — a behaviour change, not a fix.
- **Applied**: `db:setup-perms` dev + prod, 521 permissions / 0 errors each. See `PERMISSIONS.md` (2026-07-13 note) and INFRA "Filtering on a field the caller can't read 403s the whole query".

---

## Open / accepted / out-of-scope

| Item | Status | Why |
|---|---|---|
| Cross-member `members.user` UUID readable (PERM-3, 2026-06-25) | Accepted | The directus_users UUID is load-bearing: `ParticipationRosterModal` maps other members' `user` → display name to attribute `last_*_edited_by`. UUIDs are not credentials; removing it breaks roster edit-attribution for a low-tier enumeration finding. |
| LEADER reads `game_scheduling_opponents`/`bookings` club-wide (PERM-4, 2026-06-25) | Accepted | Third-party opponent scheduler contacts (not KSCW-member PII); scoping to the caller's teams would break the cross-team scheduling overlay coaches rely on. Internal-planning data, low sensitivity. |
| `/terminplanung/team-calendar/:teamId` + `/cross-team-conflicts` readable by any Member (EP-SCH-1, 2026-06-25) | Accepted | The team pages are member-facing by design; both endpoints deliberately exclude all opponent contact PII and return only slot dates/halls. Gating would break member-facing team calendars. |
| kscw-website `script-src 'unsafe-inline'` (WEB-SEC-2 / WEB-ADM-4, 2026-06-25) | Deferred | Same item as the existing `unsafe-inline` row below — removing it needs a per-build nonce/hash step on a static CF Pages site with many `is:inline` blocks. The actual stored-XSS sinks that would exploit it are now all closed at source (WEB-ADM-3 / WEB-SEC-3 / WEB-SEC-7) + DOMPurify is local, so this is the safe mitigation. Revisit with Astro experimental CSP. |
| Broadcast TOCTOU on `sent_at` rate-check | Accepted soft-limit | Code comment in `broadcast-helpers.js:364` explicitly accepts the race; the audit table catches abuse. Re-evaluate if abuse is observed. |
| `iCal` feeds (`/kscw/ical/*`) public | Accepted | Designed for calendar embedding. No member PII. |
| In-memory `X-Forwarded-For` rate limiters | Accepted | Only safe behind CF Tunnel — documented in this file. If VPS ports ever go public, all limiters collapse simultaneously and need replacing with a Postgres / Redis store. |
| `Math.max(rs)`-style PKCS8 key wrapping in `workers/push/src/index.ts` | Accepted | Documented inline; used to handle WebCrypto's lack of raw P-256 import. Audited 2026-04-04. |
| Notification triggers fan out without re-checking caller identity | Accepted | Triggers run after Directus RBAC has already gated the parent INSERT/UPDATE. If we ever grant `games`/`trainings`/`events` direct DML to a non-admin role at the PG level, this assumption breaks. |
| `tasks` schema lacks `team` FK | Accepted (43 fixed read-side) | Migration 035 noted the design gap. Read scope now uses assignee FKs which is the right substitute; create a migration that adds `team` if cross-team queries are ever needed. |
| `pgbouncer.get_auth()` lacks `SET search_path = ''` on live prod | Accepted (Supabase-managed) | Audit 2026-05-12 finding #23. Verified `proconfig IS NULL` on live. Patching it from our side risks rollback the next time Supabase bumps the database image, and the function is only callable by the local `pgbouncer` user — not reachable from external traffic. Re-audit if Supabase ever moves the function to a user-modifiable schema. |
| Public `directus_files` /assets PII leak (2026-05-31) | **Resolved** | Anon could fetch any file via `/assets/:id` (incl. feedback screenshots — verified 200 on prod). Fixed with NO env var: public read scoped to folder-less files; feedback screenshots relocated to a private folder (migration 074) + a quarantine hook keeps future ones there. Deployed + verified on dev + prod (anon `/assets/<feedback>` 200 → 403; public photos still 200). Note: anon `/items/directus_files` *listing* is denied regardless (system-collection listing not granted to Public) — `/assets` was the actual leak path. |
| Google Places key referrer lockdown (2026-05-31) | **Operational — required** | `VITE_GOOGLE_MAPS_API_KEY` ships in the client bundle (unavoidable for Places Autocomplete). Lock it down in Google Cloud Console: HTTP-referrer restriction to the app domains, restricted to the Places API only, daily quota cap, no billing/other-API scope. Stronger fix (deferred): proxy Places through an authenticated Directus endpoint. |
| Push-worker `AUTH_SECRET` (2026-05-31) | **Operational — required** | `workers/push` now fails closed if `AUTH_SECRET` is unset/short. Ensure a ≥32-char secret is set via `wrangler secret put AUTH_SECRET` on every worker/env, or `/push` returns 500 by design. |
| `package.json` overrides + SCHEMA.sql baseline (2026-05-31) | **Operational — required** | Run `npm install` to apply the `tmp`/`uuid` overrides into the lockfile, then `npm audit --omit=dev`. After migrations 070–073, run `npm run db:baseline:dev`/`:prod` to regenerate `SCHEMA.sql` (else fresh installs re-introduce the regressions and miss `password_reset_tokens`). |
| PocketBase JWT in git history (2026-05-31, Low) | **Closed — dead credential** | A `.claude/settings.json` committed in 3 historical commits held a PocketBase auth JWT. PocketBase is **decommissioned** (the Directus migration is complete — there is no PocketBase instance to authenticate against), so the token is inert: nothing to rotate. Current tree is clean (`.claude/settings.json` is gitignored and absent; no tracked file contains it). Optional hygiene only — physically purging it from history needs `git filter-repo` + a force-push to `prod` (disruptive; not warranted for a dead credential). |
| Member-create self-scope negative smoke test (2026-05-31) | **Recommended** | `db:smoke` currently exercises only legitimate (own-member) creates. Add a NEGATIVE assertion — Member attempts `participations`/`absences` create with `member` = another member → expect 403 — so the self-scope `permissions` filter is confirmed to actually block impersonation, not just pass legit creates. |
| Access/refresh tokens in localStorage (2026-05-31, Medium) | Accepted (mitigated) | Deliberate for standalone-PWA persistence (iOS clears sessionStorage). Compensating control: strict CSP (no `script-src 'unsafe-inline'`) + DOMPurify on all HTML sinks; tokens are never logged. Deferred follow-up documented in `api.ts`: migrate to Directus cookie session mode (httpOnly) — needs backend CORS-credentials + CSRF work. |
| `style-src 'unsafe-inline'` (both repos) + `script-src 'unsafe-inline'` (kscw-website) | Accepted | wiedisync: Tailwind/React emit runtime inline `style=`; no nonce pipeline. kscw-website: 83 `is:inline` script blocks on a static CF Pages site with no per-build nonce. The two stored-XSS sinks that would have exploited this are closed at source. Removing `unsafe-inline` needs a nonce/hash build step (deferred). |
| Backend CORS / Directus session mode (not in repo) | Verify | Confirm on the VPS that Directus `CORS_ORIGIN` is an exact allowlist (no `*`) and session/auth mode matches the token-in-header model. Document the values in `INFRA.md`. |
| Public-forms member-directory Flow `531dc3c2-…` (#18, 2026-07-02) | **Open — server-side required** | The kscw-website autocomplete hits an unauthenticated Directus Flow that returns the full roster (bypassing the `website_visible`+adults public scope). Client hardened, but the Flow itself must be scoped to the public policy (no internal `id`, opted-out/minors excluded). Flows live in Directus, not the repo — fix in the admin UI. |
| `nodemailer` nested in `imapflow`/`mailparser` (#38, 2026-07-02) | Accepted (not reachable) | Direct send path bumped to 9.0.3. The transitive copy inside imapflow/mailparser is IMAP read/parse, not the vulnerable `sendMail` raw vector; forcing it onto nodemailer 9 via an override risks the LIVE mailbox. Revisit when those packages publish nodemailer-9 support. |
| ClubDesk sync-up commit on prod (#1/#2, 2026-07-02) | Operational — gated | Up-sync now dry-runs first; `CLUBDESK_UP_COMMIT=1` must NOT be set on prod until the ClubDesk import-wizard's blank-overwrite + new-contact-duplicate behavior is validated against a throwaway contact (memory-tracked spike). |
| `never_dun` backfill on shared/family emails (#20, 2026-07-02) | Open — manual review | Migration 146 email-matched the `never_dun` backfill, which may have flagged the wrong member where two share an email. Already applied; needs a manual DB review to re-decide affected rows (auto-reverting risks clearing legitimate opt-outs). |
| Migration 149 not self-wrapped (#39, 2026-07-02, Info) | Accepted (applied) | 149 has two DO blocks with no BEGIN/COMMIT under a runner that doesn't wrap files; already applied (sha-locked, can't edit). New migrations (163–165) self-wrap; fix-forward only if 149 is ever revisited. |
| ~~LEADER participations cross-team read leak~~ (raised 2026-07-05) | **Resolved 2026-07-06 — NOT a leak (false positive)** | Deep re-investigation found the original diagnosis was WRONG. TR 155 coaches 6/81 but is ALSO a rostered **player** on teams 11/82; members 27/467 are on 11/82, so they are genuine SAME-TEAM teammates, legitimately visible via the correctly-enforced MEMBER `SAME_TEAM_AS_ME` walk. Verified on prod: every member a coach can see falls within their FULL scope (played ∪ coached ∪ TR), zero rows outside it — Directus enforces all the walks correctly. The two long-standing `db:smoke` coach-token "failures" were the SAME false positive: the test computed the coach's scope from COACHED teams only (ignoring player/TR teams) and expected `user_logs` to 403 when the MEMBER policy correctly grants an OWN-scoped read. **`smoke-test.mjs` fixed** (full-scope union + user_logs own-scope assertion) → 27/27 both envs. No code/permission change was needed; a scoping read-hook prototyped during the investigation was reverted (unnecessary, and it would have wrongly hidden legitimate guest RSVPs on a coach's own team activities). **Lesson: a coach is usually also a player — never scope-check attendance visibility against coached teams alone.** |

---

## Recurring gotchas

These have bitten before and will bite again:

1. **`setup-permissions.mjs` vs. SQL migrations.** See `CLAUDE.md → "Migration & Permission Policy"` for the authoritative contract (permissions live ONLY in the script; migrations are schema-only). Security-relevant gotcha to keep in mind: fresh installs run only the script, so a permission row that was hand-applied to prod but never folded into the script silently rolls back on the next fresh build (see `feedback_prod_is_canonical.md` memory).

2. **M2M junction permissions.** Flat-id payloads trigger junction-PK lookup (403 for non-admin); use `[{ teams_id: 3 }]` shape. Grant junction CRUD AND base CRUD as a pair. Without both, frontend operations hit 403 silently because `Promise.all` in `loadTeamContext` swallows individual failures.

3. **`$CURRENT_USER` is a UUID; Directus FKs to `members` are integers.** Naive `{ user: { _eq: '$CURRENT_USER' } }` filters on int FKs throw "Invalid numeric value". Always traverse through `members.user` (see `OWN_DU` in `setup-permissions.mjs`).

4. **`_neq` excludes NULLs in Directus.** Use `_or` with `_null: true` if you want NULL rows to match.

5. **Junction tables with `ON DELETE SET NULL`.** Directus serialises the resulting `null` integer as the literal string `"null"` in `_in` filters → 400 errors. All junctions should be `ON DELETE CASCADE`. Migrations 021 + 037 + 043 cover the known set.

6. **Hooks running as admin on user-controlled payloads.** Action hooks that use `database` or `services` with `accountability: null` bypass Directus RBAC entirely. Always re-verify the caller identity before privileged side effects (role-sync, broadcast fanout, dateStr-in-raw-SQL).

7. **Email/HTML interpolation.** Any human-controlled string ending up in an `html:` mail body needs HTML escaping. Helpers: `escapeEmailHtml` in `kscw-hooks/src/index.js`, `escHtml` in `clubdesk-update.js`. Don't add new email templates without one.

8. **Tokenized public flows.** Standard pattern: 16+ bytes of `crypto.randomBytes`, single-use enforced atomically (transaction + `FOR UPDATE`), expiry, revoke endpoint, audit log on issuance. Cross-resource ownership check on every consume.

9. **CSP `style-src 'unsafe-inline'`.** Required by Tailwind v4. Documented gap. Rules out CSS-based exfil mitigations from CSP — be vigilant about user-controlled style attributes.

10. **Sentry replay capture rate is 100% on error.** Always set `maskAllText: true` + `maskAllInputs: true` if any new replay integration is added.

11. **Push notifications need both ends to share VAPID public key.** Worker reads it from `wrangler secret` and Directus reads from `process.env.VAPID_PUBLIC_KEY`. A split-brain (e.g. via the formerly-hardcoded fallback) makes every push silently fail.

---

## Audit cadence

Run the deep audit after any of:

- A milestone bump in `package.json` (`*.0.0` or `*.X.0`).
- A new role / policy addition.
- Any custom endpoint going from auth-required to public (or vice versa).
- A new third-party integration.

The audit pattern is captured as a Claude Code skill — invoke `/kscw-security-audit` (lives in `~/.claude/skills/`). The skill dispatches 6 parallel agents over the same surfaces this doc covers.

After each audit, append a `### YYYY-MM-DD — Deep audit + remediation` block above and check off / move items between "Hardening completed" and "Open / accepted".

---

## Continuous verification (process — not findings)

The deep audit catches drift; an always-on guard rail stops new drift from reaching prod. The declarative-permissions / schema-only-migrations / apply-once-tracker / fresh-install contract is authoritative in **`CLAUDE.md → "Migration & Permission Policy"`** (rules 1–6) — don't restate it here. The runbook is `INFRA.md → "Database Deploy Workflow"`.

Security-relevant note that earns its place in this file: `npm run db:deploy:<env>` runs `db:migrate → db:setup-perms → db:smoke`, and the **smoke test is the safety net for the silent-`Promise.all`-empty class** (the 4.4.4 / 2026-06-07 `fine_rules` incidents). `smoke-test.mjs` logs in as a non-admin Member and probes the read-rows whose loss silently empties `loadTeamContext` / HomePage — `teams_coaches`, `teams_responsibles`, `member_teams`, `fine_rules`, `rankings`, `forms` — plus the `/kscw/messaging/conversations` endpoint (there is deliberately no Member direct `/items/conversations` read grant). A re-granted-then-lost permission row turns the next deploy red the same minute it ships.
