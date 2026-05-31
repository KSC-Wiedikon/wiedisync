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
- `.env.test` (line 28 — local-only test creds; passwords share value `thamykscw_1972`. Rotate if leaked.)
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

### 2026-05-31 — Multi-agent security audit + remediation (branch `security-fixes`)

Full-repo automated audit (security + permissions + code-quality) across `wiedisync` and `kscw-website`, with adversarial verification of every critical/high finding. Reports: `SECURITY_AUDIT.md` (both repos). 0 critical confirmed; 3 high, 11 medium, 11 low (wiedisync) + 2 high, 2 medium, 1 low (kscw-website). All code-fixable items below remediated on branch `security-fixes`.

**Backend deployed + verified on DEV 2026-05-31:** migrations 070–073 applied (psql-verified: 0 leftover anon/auth RLS read policies, `search_path` pinned on the 5 functions, `security_invoker=true` restored on the PII/stats views, `password_reset_tokens` table created); permissions reconciled (383, 0 errors); extensions deployed; `db:smoke:dev` 19/19; backend security regression suite green (9/9 runnable — password-reset/​set-password hardening, public/team field strip, no-PII-leak public read, and the member-impersonation guard which **caught a real bug**, see High note below). **Prod still pending** — run `db:deploy:prod` + `ext:deploy:prod` + the CF Pages deploys + the operational steps in "Open / accepted". Frontend fixes (app OAuth-token strip, kscw-website XSS) are verified by `tsc`/code review only and ship on the next CF Pages build of the branch.

**High**
- **Website-Admin IDOR over members + participations** (`wadmin.js`): `mixed_turnier` section listed `members`/`participations`, which the generic `/wadmin/:section/items/:collection` routes serve with `accountability:{admin:true}` (RLS-bypass). Removed both — section now scoped to `mixed_tournament_signups` only. Test updated (`__tests__/wadmin.test.js`) to lock in the secure contract.
- **Password-reset minted a static API token** (`password-reset.js`, `index.js` `/set-password`, migration **073**): the flow wrote a value into `directus_users.token` (Directus's full-privilege static API credential) and mailed it. Replaced with a dedicated **backend-only** `password_reset_tokens` table storing only a SHA-256 hash of a 256-bit secret, 1-hour TTL, single-use. The `/set-password` Mode-2 consumer now validates against it (hash lookup → expiry → delete-before-use). The emailed link is no longer an API credential.
- **Unfiltered Member create permissions** (`setup-permissions.mjs` + `kscw-hooks/index.js`): `participations`/`absences`/`poll_votes`/`push_subscriptions`/`scorer_delegations`/`carpools`/`carpool_passengers`/`team_requests` `create` were unfiltered → impersonation (fake absences triggered migration-038's RSVP-decline cascade for the victim). **Important — verified on dev 2026-05-31:** Directus enforces NEITHER the `permissions` row-filter NOR a relational `validation` filter on CREATE (no existing row to match; a `member.user == $CURRENT_USER` validation can't be resolved against the payload and rejects *all* creates). The first-pass fix (self-scope filter in the create `permissions`) was therefore a no-op — an impersonating create still returned 200. **Enforcement now lives in a `kscw-hooks` `*.items.create` ownership guard** (`assertCreateOwnership`): pass-through for system writes (crons) + admins; self for everyone; coach/TR of the member's team may also write for participations/absences (roster editing); strictly-personal collections are self-only. Re-tested on dev: impersonation now blocked, legitimate own-creates + smoke still pass. (Blocked impersonations surface as 500 via the project's `kscwScopeError` plain-Error pattern, same as the other hook guards — only fires on an actual impersonation attempt, never the normal self-RSVP UI path.)

**Medium**
- **Mass-notify abuse** (`event-notify.js`): added per-(user,event) rate limit (1/10min); leader-only coach/TR callers are now scoped to the team(s) they actually lead (no club-wide `invited_roles`/`invited_members` expansion); `send_email:true` gated to admin/sport-admin/creator. **Behaviour change** — coaches/TRs can no longer send the event email blast or fan out beyond their own teams.
- **Privacy projection bypass** (`kscw-hooks/index.js`): the `members.items.read` redaction now sources `hide_email`/`hide_phone`/`birthdate_visibility`/`user` from the DB per row and redacts unconditionally on the caller's field projection (was bypassable by requesting a narrow `fields=`). Fails closed.
- **Public members read ignored `website_visible`** (`setup-permissions.mjs`): public read scoped to `{ website_visible: { _eq: true } }`.
- **Wide-open `USING(true)` RLS** (migration **070**): dropped all `anon_read_*`/`auth_read_*` PostgREST-era SELECT policies (Directus connects as `supabase_admin`, so no live caller affected; defense-in-depth on top of the migration-011 GRANT revoke).
- **`/set-password` OTP accepted any verified row** (`index.js`): Mode-3 now requires the verification to be fresh (`expires_at > now()`, the original 10-min OTP window) in addition to `verified=true`; single-use delete retained.
- **Event-invite email unescaped** (`event-notify.js`): `event.description` now `escHtml()`-escaped before HTML interpolation.
- **OAuth tokens in URL** (`OAuthCallbackPage.tsx`): tokens scrubbed from the address bar via `history.replaceState` immediately after read; `state` nonce check tightened to strict equality (absent/mismatched rejected).
- **Google Maps key client-exposure** (`useGooglePlacesSearch.ts`): documented as inherently client-side; operational lockdown required (see below).
- **Push worker fail-open** (`workers/push/src/index.ts`): explicit fail-closed guard if `AUTH_SECRET` is unset/short; subscription-list cap + shape/host allowlist validation; per-IP rate limit.

**Low / Info**
- Public `directus_files` read scoped to `PUBLIC_FILES_FOLDER` (env; warns + falls back if unset) — `setup-permissions.mjs`.
- `GET /public/team/:id` no longer leaks `features_enabled`/`dashboard_*`/`bb_source_id`/`captain` — `index.js`.
- Function `search_path` re-pinned via `ALTER FUNCTION` on `trg_trainings_notify`, `fn_messaging_dm_autoaccept`, and the migration-069 fines helpers (migration **071**, body-preserving).
- `security_invoker=true` restored on `members_with_photo` + `stats_*` views (migration **072**).
- CSP hardened (`public/_headers`): `object-src 'none'`, `base-uri 'self'`, report-uri added (`style-src 'unsafe-inline'` retained — Tailwind).
- `exceljs` transitive vulns (`tmp`, `uuid`) pinned via `package.json` `overrides` (needs `npm install`).
- TweetCard `dangerouslySetInnerHTML` wrapped in `DOMPurify.sanitize` (`tweet-card.tsx`).
- **kscw-website**: homepage event description rendered as plain text (`de|en/index.astro`); calendar JSON island `<`/`>`/`&` escaped against `</script>` breakout (`de|en/weiteres/kalender.astro`); client-side regex sanitiser replaced with `textContent` (`calendar-grid.ts`); RSS slug `encodeURIComponent` + XML-escaped (`feed.xml.ts`); CSP tightened (`public/_headers`).

### 2026-05-12 — Deep audit Low-tier + hygiene (v4.8.8)

Closes the remaining open items from the 2026-05-12 audit beyond what v4.8.3 and v4.8.5 already shipped.

**Custom hooks (`directus/extensions/kscw-hooks/src/`)**
- New `sanitize-html.js` — allowlist HTML sanitizer (pure JS, no deps). Strips `<script>`, `<style>`, `<iframe>`, `<img>`, `<form>`, `<svg>`, every event handler, every inline style, and every attribute except `href` on `<a>` (https-only or same-origin). Applied to the announcement email body before fanout (`notifyAnnouncementPublished`). Closes audit finding #14 — a compromised Sport Admin can no longer ship phishing redirects, tracking pixels, or `<a href="javascript:…">` payloads to the whole sport's mailbox.
- `index.js` absence-auto-decline + auto-confirm paths — every `EXTRACT(DOW FROM DATE '${dateStr}')` template-string now parameterizes the date through the driver as `EXTRACT(DOW FROM ?::date)`. `autoDeclineForAbsence` additionally coerces the `daysOfWeek` jsonb array to integers in the 0..6 range before interpolating into the `IN (…)` list. Defense-in-depth — the `safeDateStr()` regex and `jsonb` column already protect in practice, but the new shape removes the string-concatenation pattern entirely. Closes audit finding #9.

**Audit log (`directus/extensions/kscw-hooks/src/audit.js`)**
- Per-collection `REDACTED_FIELDS` map: payload values for `members.ahv_nummer`, `birthdate`, `email`, `phone`, `license_nr`, postal address, `directus_users` credentials, and `push_subscriptions` keys are replaced with `[REDACTED]` before being written to `user_logs.data`. `reports_filed`, `messages`, `message_requests` payloads collapse to `{_redacted: true, _fields: [...]}` so an audit reviewer can see WHICH columns moved without exfiltrating the row content. Field names — and hence the "what changed" signal — survive.
- New 90-day purge cron (daily at 02:15 UTC) deletes `user_logs` rows older than 90 days. The audit-log UI advertises a 90-day window via `ARCHIVE_DAYS`; until now the rows accumulated indefinitely. Closes audit finding #11.

**SQL — migration 052**
- `fn_messaging_dm_autoaccept` drops the `other_mt.season = NEW.season` predicate. Cross-season teammates now auto-accept pending DM requests the same way same-season teammates do. Was producing a confusing "we're on the same team but my request is still pending" state at season boundaries. Closes audit finding #25.

**Docs**
- `PERMISSIONS.md` header bumped to migration 052.
- `SCHEMA.sql` baseline regenerated from prod (was 7 migrations behind; closes audit finding #24).

### 2026-05-12 — Deep audit + remediation (v4.8.3)

Deep audit run post-v4.8.1 (LEADER-per-user backfill) and v4.8.2 (LEADER read scope for trainings/events). Six parallel research agents over the same six surfaces. Eight Fix-this-week findings closed.

**Custom endpoints (`directus/extensions/kscw-endpoints/src/`)**
- `event-notify.js` `POST /kscw/events/:id/notify` — previously unauthenticated. Now requires `req.accountability.user` AND callers must be Directus admin, KSCW sport-admin role, the event creator, or a coach/TR of one of the event's teams. Closes a mass push/email amplification vector exploitable by any anonymous HTTP client.
- `audit.js` `requireSuperuser()` — replaced the `directus_roles.name = 'Superuser'` string match (bypassable by renaming any role) with `req.accountability.admin === true`. The stable policy-derived admin flag is the right gate; the role name is mutable.
- `registration.js` admin notification email — `reg.bemerkungen` now routed through `escHtml()` from `email-template.js`. Public registrants can no longer inject HTML/script into the email body delivered to admin clients. `escHtml` exported from `email-template.js` so other endpoints can reuse it.
- `web-push.js` `/subscribe` — new `validatePushEndpoint()` rejects non-https, malformed URLs, private/loopback/link-local hosts (IPv4 + IPv6), and any host outside an allow-list of known browser push providers (FCM, APNs, Mozilla autopush, WNS). Closes the SSRF path where an authenticated member could coerce the CF push Worker to issue outbound requests to attacker-chosen hosts.

**Custom hooks (`directus/extensions/kscw-hooks/src/index.js`)**
- Team-join-request email body (5 locales) — `member.first_name`, `member.last_name`, and `teamName` are now routed through `escapeEmailHtml()` before interpolation into the `intro` HTML. Closes a stored-HTML injection path via member registration names.

**Frontend (`src/`)**
- `OAuthCallbackPage.tsx` + `useAuth.tsx loginWithOAuth` — `oauth_pending` sentinel TTL tightened from 5 min → 2 min, and a `state=<nonce>` query param is now embedded into the redirect URL handed to Directus. If Directus preserves our query string when appending `?access_token=…` (which most OAuth provider integrations do), the callback verifies the round-tripped state against the stored nonce — full CSRF binding. If Directus strips it, the shorter TTL still narrows the residual window (documented as a known residual gap below).

**Permissions (`directus/scripts/setup-permissions.mjs`) — LEADER policy scope tightening**
- `members.read` — was unfiltered full-row read across the entire club. Replaced with a `COACH_TEAM_MEMBERS`-scoped row + a new `LEADER_TEAM_MEMBER_FIELDS` field whitelist (all of `MEMBER_OWN_READABLE` minus `ahv_nummer`). Coaches see contact info (email/phone/address/birthdate) only for members on teams they coach or TR. Out-of-team members continue to be readable via the MEMBER policy's existing `MEMBER_VISIBLE_FIELDS` whitelist (no PII).
- `games.update` — was unfiltered. Now scoped to coach/TR of the game's `kscw_team` via the standard M2M filter pattern.
- `trainings.update` — was unfiltered. Now uses the same `COACH_OR_TR_OF_TEAM` filter already applied to `trainings.read`/`delete`.
- `events.update` — was unfiltered. Now mirrors the existing `events.delete` filter (creator OR coach/TR of an invited team).
- `participations.read` + `participations.update` — was unfiltered full-club RSVP dump. Now scoped via `participation.member.member_teams.team.{coach|team_responsible}`.
- `absences.read` — was unfiltered full-club absence dump. Same scope as participations.
- `user_logs.read` — REMOVED entirely from LEADER. The audit log endpoint at `/kscw/admin/audit` is the only sanctioned access path and is admin-only.

**SQL — migration 050**
- `trg_participations_guest_block` — was checking `guest_level > 0` across the member's ANY team. Now joins to `games.kscw_team` and checks only the row for the game's team. Closes a correctness defect that silently 400'd legit RSVPs for any senior who guest-played for a youth team.

**Smoke test (`directus/scripts/smoke-test.mjs`)**
- New optional Coach-token pass: reads `DIRECTUS_DEV_USER_TOKEN_COACH` / `DIRECTUS_PROD_USER_TOKEN_COACH` from `.env.local`. Asserts `participations.read` returns only rows whose member is reachable via the coach's teams, and `user_logs` direct read 403s. Skipped silently if no coach token is present, so existing deploys don't break.

**Residual gaps documented**
- OAuth nonce round-trip depends on Directus preserving our `state` query param through the OAuth provider redirect. If Directus strips it the TTL (now 2 min) is the only defence. Full backend support for `state` belongs in a separate enhancement.

### 2026-05-06 (continued) — v4.5.2 closes the last Critical

**Custom endpoints (`directus/extensions/kscw-endpoints/src/`)**
- New `sv-licence.js` — `GET /kscw/sv-licence/me` joins by `members.license_nr → sv_vm_check.association_id` and returns the 11-field whitelist for the caller's own row only. Replaces direct collection access.
- New `migrations-status.js` — admin-only `GET /kscw/admin/migrations-status` exposes `{applied, pending, latest, latest_applied_at}` for the InfraHealth dashboard. Drift detection without giving up the admin token.

**Frontend (`src/`)**
- `ProfilePage.tsx` switched to `kscwApi('/sv-licence/me')`. No remaining direct `sv_vm_check` reads from non-admin code paths.
- `InfraHealthPage.tsx` shows the migration tracker card.

**Permissions (`directus/scripts/setup-permissions.mjs`)**
- KSCW Member's `sv_vm_check.read` row removed entirely. Direct `GET /items/sv_vm_check` returns 403 for Members. Sport Admin retains CRUD.
- Auto-loads `.env.local` and resolves `DIRECTUS_DEV_TOKEN` / `DIRECTUS_PROD_TOKEN` by URL — no env-wrapper noise on `npm run db:setup-perms:*`.

**Smoke test (`directus/scripts/smoke-test.mjs`)**
- Token-only auth. New asserts: `sv_vm_check direct (must 403)` + `kscw/sv-licence/me`. Re-granting Member read on the collection now turns the next deploy red.

**Ops**
- Web push `VAPID_PUBLIC_KEY` set on **both** dev + prod containers; missing-on-dev gap closed (`docker run` recreate, since `docker restart` doesn't reload env-file).
- Live admin password reconciled against `/opt/directus-kscw{,-dev}/.env` on both VPS instances. No more "fresh container start could divert the bootstrap user" risk.
- `npm run db:fresh-install:dev|prod` script added (`SCHEMA.sql → migrate → setup-perms → smoke`). Single command for clean-DB rebuild.
- `.playwright-mcp/` added to `.gitignore` (browser-snapshot scratch dumps, not for the repo).

### 2026-05-06 — Deep audit + remediation

**Frontend (`src/`)**
- Sentry Session Replay now masks all text + inputs and denies network details for `directus.kscw.ch` (`src/lib/sentry.ts`).
- OAuth callback rejects token params unless an `oauth_pending` sentinel was set by `loginWithOAuth` within the last 5 min (`src/modules/auth/OAuthCallbackPage.tsx`, `src/hooks/useAuth.tsx`).
- Sponsor `website_url` and BugfixDashboard `pr_url` routed through `sanitizeUrl()` (`src/utils/sanitizeUrl.ts`).
- `RichText` DOMPurify call has explicit `ALLOWED_URI_REGEXP` for http(s) + same-origin only.
- `public/sw.js` pins notification-click URLs to our origin.

**Push worker (`workers/push/`)**
- Bearer-secret comparison switched from `!==` to constant-time XOR-fold (`timingSafeEqualStr` helper).

**Custom endpoints (`directus/extensions/kscw-endpoints/src/`)**
- `newsletter.js` `verifyTurnstile` now fails closed when `TURNSTILE_SECRET` is unset (was returning `true`).
- `game-scheduling.js` no longer returns the raw token in the `/register` response body — only emailed.
- `game-scheduling.js` `book-home` wrapped in a transaction with `SELECT … FOR UPDATE` and a cross-team check (`slot.kscw_team === opponent.kscw_team`). Closes both the TOCTOU race and the cross-team sabotage path.
- `index.js` exposes shared helpers `capPayload(payload, max=500)` and `ipRateLimit(map, req, n, ms)`.
- `index.js` `client-error` payload is now capped via `capPayload` (was uncapped → disk fill via 30 req/min).
- `index.js` `team-invites/claim` rate-limited to 5 attempts / 15 min / IP.
- `web-push.js` — removed hardcoded `VAPID_PUBLIC_KEY` fallback; endpoint returns 503 if env unset.

**Custom hooks (`directus/extensions/kscw-hooks/src/index.js`)**
- Announcement audience guard now also blocks `audience_sport`-unset posts unless caller is full admin / superuser. Sport-scoped admins can no longer bypass scope by omitting the field.
- Filter on `members.items.update` strips the `role` field unless caller is admin / superuser. Defense in depth on top of Directus field-level perms.
- Junction-delete pending Maps drained via try/finally + key snapshot — error in `syncMemberRole` no longer leaks orphaned entries.
- `escapeEmailHtml` helper introduced; admin-controlled `rejection_reason` now escaped before email interpolation.
- `clubdesk-update.js` `buildChangesTable` HTML-escapes member-supplied `old_value` / `new_value` before interpolating into the admin email.

**SQL — migration 043**
- `sv_vm_check.read` row-scoped to own member (was unfiltered → cross-member SV licence dump).
- `tasks.read` scoped to assigned/claimed-by self.
- `feedback.read` scoped to own submissions.
- `teams.update` row-scoped for KSCW Coach + KSCW Team Responsible.
- `teams_sponsors.sponsors_id` FK with ON DELETE CASCADE (closes the deferred half of migration 037).
- `member_teams.read` field set narrowed to `id, member, team, season` (drops `guest_level` from cross-team reads).
- `SET search_path = public` added to all 8 messaging trigger functions (`fn_messaging_*`, `messaging_protect_sentinel`).
- `bugfix_jobs` explicit `REVOKE ALL FROM anon, authenticated`.

**Consolidation**
- `directus/scripts/setup-permissions.mjs` rebuilt to match the post-043 live state. Header banner documents the dual-source (script + migrations) policy.

---

## Open / accepted / out-of-scope

| Item | Status | Why |
|---|---|---|
| Broadcast TOCTOU on `sent_at` rate-check | Accepted soft-limit | Code comment in `broadcast-helpers.js:364` explicitly accepts the race; the audit table catches abuse. Re-evaluate if abuse is observed. |
| `iCal` feeds (`/kscw/ical/*`) public | Accepted | Designed for calendar embedding. No member PII. |
| In-memory `X-Forwarded-For` rate limiters | Accepted | Only safe behind CF Tunnel — documented in this file. If VPS ports ever go public, all limiters collapse simultaneously and need replacing with a Postgres / Redis store. |
| `Math.max(rs)`-style PKCS8 key wrapping in `workers/push/src/index.ts` | Accepted | Documented inline; used to handle WebCrypto's lack of raw P-256 import. Audited 2026-04-04. |
| Notification triggers fan out without re-checking caller identity | Accepted | Triggers run after Directus RBAC has already gated the parent INSERT/UPDATE. If we ever grant `games`/`trainings`/`events` direct DML to a non-admin role at the PG level, this assumption breaks. |
| `tasks` schema lacks `team` FK | Accepted (43 fixed read-side) | Migration 035 noted the design gap. Read scope now uses assignee FKs which is the right substitute; create a migration that adds `team` if cross-team queries are ever needed. |
| `pgbouncer.get_auth()` lacks `SET search_path = ''` on live prod | Accepted (Supabase-managed) | Audit 2026-05-12 finding #23. Verified `proconfig IS NULL` on live. Patching it from our side risks rollback the next time Supabase bumps the database image, and the function is only callable by the local `pgbouncer` user — not reachable from external traffic. Re-audit if Supabase ever moves the function to a user-modifiable schema. |
| `PUBLIC_FILES_FOLDER` env not yet set (2026-05-31) | **Operational — required** | The public `directus_files` read fix only applies when `PUBLIC_FILES_FOLDER` is set to the public-assets folder UUID on dev + prod; until then `setup-permissions.mjs` falls back to the legacy unscoped read and prints a warning. Also route feedback-screenshot / profile-photo uploads into a NON-public folder. |
| Google Places key referrer lockdown (2026-05-31) | **Operational — required** | `VITE_GOOGLE_MAPS_API_KEY` ships in the client bundle (unavoidable for Places Autocomplete). Lock it down in Google Cloud Console: HTTP-referrer restriction to the app domains, restricted to the Places API only, daily quota cap, no billing/other-API scope. Stronger fix (deferred): proxy Places through an authenticated Directus endpoint. |
| Push-worker `AUTH_SECRET` (2026-05-31) | **Operational — required** | `workers/push` now fails closed if `AUTH_SECRET` is unset/short. Ensure a ≥32-char secret is set via `wrangler secret put AUTH_SECRET` on every worker/env, or `/push` returns 500 by design. |
| `package.json` overrides + SCHEMA.sql baseline (2026-05-31) | **Operational — required** | Run `npm install` to apply the `tmp`/`uuid` overrides into the lockfile, then `npm audit --omit=dev`. After migrations 070–073, run `npm run db:baseline:dev`/`:prod` to regenerate `SCHEMA.sql` (else fresh installs re-introduce the regressions and miss `password_reset_tokens`). |
| PocketBase JWT in git history (2026-05-31, Low) | **Closed — dead credential** | A `.claude/settings.json` committed in 3 historical commits held a PocketBase auth JWT. PocketBase is **decommissioned** (the Directus migration is complete — there is no PocketBase instance to authenticate against), so the token is inert: nothing to rotate. Current tree is clean (`.claude/settings.json` is gitignored and absent; no tracked file contains it). Optional hygiene only — physically purging it from history needs `git filter-repo` + a force-push to `prod` (disruptive; not warranted for a dead credential). |
| Member-create self-scope negative smoke test (2026-05-31) | **Recommended** | `db:smoke` currently exercises only legitimate (own-member) creates. Add a NEGATIVE assertion — Member attempts `participations`/`absences` create with `member` = another member → expect 403 — so the self-scope `permissions` filter is confirmed to actually block impersonation, not just pass legit creates. |
| Access/refresh tokens in localStorage (2026-05-31, Medium) | Accepted (mitigated) | Deliberate for standalone-PWA persistence (iOS clears sessionStorage). Compensating control: strict CSP (no `script-src 'unsafe-inline'`) + DOMPurify on all HTML sinks; tokens are never logged. Deferred follow-up documented in `api.ts`: migrate to Directus cookie session mode (httpOnly) — needs backend CORS-credentials + CSRF work. |
| `style-src 'unsafe-inline'` (both repos) + `script-src 'unsafe-inline'` (kscw-website) | Accepted | wiedisync: Tailwind/React emit runtime inline `style=`; no nonce pipeline. kscw-website: 83 `is:inline` script blocks on a static CF Pages site with no per-build nonce. The two stored-XSS sinks that would have exploited this are closed at source. Removing `unsafe-inline` needs a nonce/hash build step (deferred). |
| Backend CORS / Directus session mode (not in repo) | Verify | Confirm on the VPS that Directus `CORS_ORIGIN` is an exact allowlist (no `*`) and session/auth mode matches the token-in-header model. Document the values in `INFRA.md`. |

---

## Recurring gotchas

These have bitten before and will bite again:

1. **`setup-permissions.mjs` vs. SQL migrations.** Bidirectional contract: every permission change goes into both. The script is the snapshot, migrations are the journal. Fresh installs run only the script, so silent rollbacks are real (see `feedback_prod_is_canonical.md` memory).

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

The deep audit catches drift; these always-on guards stop new drift from reaching prod:

1. **Permissions are declarative.** `directus/scripts/setup-permissions.mjs` is the only place where role × collection × action rows live. Numbered SQL migrations are SCHEMA ONLY (DDL, triggers, RLS, FKs, grants, data backfills). The 4.4.4 / 042 incidents were both "permission row never created on prod" — that class of bug is structurally impossible when the script runs on every deploy.

2. **`npm run db:deploy:<env>` is the canonical deploy.** It runs three phases:
   - `db:migrate:<env>` — applies pending numbered migrations (tracker-aware, sha-verified, idempotent).
   - `db:setup-perms:<env>` — reconciles Directus permission rows from the script.
   - `db:smoke:<env>` — logs in as a non-admin Member, exercises every collection touched by `loadTeamContext` + the home page, exits non-zero on any 4xx/5xx. Catches the silent-Promise.all-failure pattern (the 4.4.4 incident) on first deploy after the regression.

3. **Migration tracker = the apply-once contract.** `kscw_migrations(filename, sha256, applied_at, applied_by)` records every applied migration. The runner refuses to proceed if any row's stored sha differs from the on-disk file. This kills "was migration 009 ever applied to prod?" mysteries (which is exactly what migration 042 was guessing about).

4. **Fresh-install path is one file + one script.** `directus/scripts/SCHEMA.sql` (regenerated from prod via `npm run db:baseline:prod`) + `setup-permissions.mjs`. Numbered migrations stay as the historical journal but aren't part of the bootstrap.

See `CLAUDE.md → "Migration & Permission Policy"` for the rules and `INFRA.md → "Database Deploy Workflow"` for the runbook.
