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

### 2026-08-12 (fifth pass) — four policy filters walked `member_teams` with no season boundary

**14 — "my team" meant "any team I was ever on, in any season", in four row filters.** `member_teams` rows are never deleted on rollover: the roster is **cloned** onto the new team id and the old row is left pointing at the archived team (`game-scheduling.js:4693-4709`). Four filters walked that junction with no `active` gate, so their scope grew by one season every year and never shed one. Prod at the time of the fix: 648 junction rows on archived teams across 407 distinct members, 161 stale (member, archived-team) pairs, 39 members holding rows on **no** active team at all.

- `SAME_TEAM_AS_ME` (Member policy, `participations` + `absences` read) — **407 members** retained read of former teammates' *current-season* absences, including the free-text `reason` / `reason_detail` carried by `MEMBER_ABSENCE_FIELDS`, and their RSVPs. Widest radius of the four.
- `COACH_TEAM_MEMBERS` (LEADER, `members` read + update) — 48 policy-holders retained read of live `email`, `phone` and `adresse` for every player they ever coached, plus PATCH of `position` / `number` / `coach_approved_team`. Birthdate was *not* exposed: the members read-privacy hook nulls it after the policy grants it. The update grant also contradicted this file's own convention — every other LEADER write (`teams.update`, `COACH_OR_TR_OF_ACTIVE_TEAM`) was already `active`-gated.
- `COACH_OR_TR_OF_PARTICIPATION` (LEADER, `participations` read + update + **delete**) — keys on the *member*, so a lingering archived-team row reached that member's **current-season** RSVPs. Read, edit and delete, unbounded in time.
- The longhand `absences` read filter + `COACH_TEAM_ABSENCE_SCOPE` (LEADER, read + update + delete) — same walk over the most sensitive of the three collections.

All four now gate the intermediate team on `active: { _eq: true }`. **Gate on `teams.active`, never on `member_teams.season`** — `season` is a create-time stamp with no default and no restamp trigger, while `getCurrentSeason()` flips on a calendar date (Jun 1) and the rollover that writes the new rows is a manually-clicked admin endpoint with no cron; the two are uncoupled and in 2026 diverged for ~34 hours. `teams.active` is flipped in the same transaction that clones the roster, so it cannot disagree. Unlike `teams` / `trainings`, where reads deliberately stay unscoped so a coach can browse an archived team's *history*, these reads are gated too: an ex-player's current phone number and this season's absences are their live record, not history. Same commit fixed the read that feeds the whole app — `AuthProvider.loadTeamContext` filtered `member_teams.season` and did not intersect `memberTeamIds` with the active-team map (the only one of its five lists that didn't, while its own comment claimed it did).

### 2026-08-10 (fourth pass) — chat-poll content, and forms gated only in the browser

**8 — DM and group-chat poll questions were readable club-wide.** Member policy read `polls` unfiltered. The in-code justification ("team-scoped by app navigation") predated chat polls and was never true of them: `POST /kscw/messaging/polls` creates rows with `team: null, conversation: <uuid>`, so navigation scoped nothing and the unfiltered realtime subscription *pushed* every poll created anywhere in the club to every connected member. `GET /items/polls?filter[conversation][_nnull]=true` returned the question, options, deadline and author of every DM poll. This defeated the boundary built for `messages` / `message_reactions` 300 lines later — the poll *message* was scoped and field-limited while the poll *content* it points at was not. Voter identity was never exposed (`poll_votes` is `OWN_MEMBER`, `/poll-results` checks membership); only the question text. Now a two-parent scope reusing `MY_ACTIVE_MEMBERSHIP`, so a chat poll follows the same archived-aware rule as its message.

**10 — club-wide and public form creation was enforced only in `FormBuilder.tsx`.** LEADER holds an unfiltered `forms.create`, and `setup-permissions.mjs` documents that Directus filters are no-ops on CREATE so self-scoping "is enforced in the kscw-hooks `*.items.create` filter guard" — **that guard did not exist**; only an action hook did, which runs too late to refuse anything. A coach could `POST {audience:'club_wide', is_public:true, created_by:<own id>}`, which (a) fanned a notification + web push to **every active member**, repeatable per form since the limiter is keyed per-form, and (b) published an anonymously readable and submittable page at `/kscw/public/forms/:slug` on the club's own domain, whose harvested rows they read back via `FORMS_LEADER_SCOPE`. `created_by` was client-supplied, so `authorizeManage`'s creator branch authorised on an attacker-chosen column. Added the create/update guards modelled on the `announcements` ones that already did exactly this: non-managers are held to `audience: 'teams'`, refused `is_public`, restricted to teams they lead, and `created_by` is stamped server-side and unassignable on update (the update path merges over the stored row rather than judging a partial payload). `authorizeManage`'s creator branch is now scoped to team forms. Manager tiers keep club-wide and public forms — `forms` is in `SPORT_ADMIN_FULL_CRUD` and the FormsPage is sport-scoped by design; this constrains the LEADER tier, which is where the escalation was.

### 2026-08-10 (third pass) — the disk-fill vector and its rate-limit amplifier

**11 — `/kscw/client-error` wrote eleven uncapped attacker-controlled fields.** The route is deliberately unauthenticated (kscw.ch's error logger posts anonymously). `capPayload` was added on 2026-05-06 for precisely this reason but covered `payload` and `responseBody` only; `project, event, operation, collection, recordId, endpoint, method, status, action, page, userAgent` were copied raw into a JSONL file with no line ceiling, on a bind mount sharing the 160 GB disk with Postgres. One request with a 1 MB `userAgent` appended 1 MB. Below disk exhaustion it still bricked incident response: `/kscw/admin/error-logs` `readFileSync`s whole day-files and the dates route reads *every* file, so one oversized file throws `ERR_STRING_TOO_LONG` for every date. All eleven are now type-coerced and length-bounded (a non-string → `null`, not `"[object Object]"`; a non-numeric `status` → `null`), and `writeErrorLog` enforces a **16 KB line** and **64 MB per-day-file** ceiling as a backstop. An oversized line is **truncated and kept, never dropped** — dropping would let a caller erase their own trace by padding a field. Verified on dev: a 1 MB `userAgent` now stores 300 chars in a 641-byte line.

**12 — five rate limiters keyed on a spoofable IP.** Prod runs `IP_TRUST_PROXY=true`, so `req.ip` resolves to the **left-most** `X-Forwarded-For` entry, and Cloudflare **appends** rather than replaces — that entry is whatever the client sent. Five sites in `index.js` still used `req.ip || req.headers['x-forwarded-for']`, so any forged header bought a fresh bucket. (The 2026-07-02 audit migrated nine files to `cf-connecting-ip` and missed these — which is why this is now **one exported `clientIp()`** rather than a tenth copy.) This also makes `/kscw/verify-email`'s existing 10/hour per-IP cap actually bind.

⚠ **Still open — `/kscw/verify-email` has no captcha.** It is the only public mail-sending route without one, and its other bound is a per-*target-address* cap that does nothing to limit the number of *distinct* addresses mailed from the club's DKIM-aligned SES identity. It was **not** fixed here because the route is called from `SignUpPage`, `JoinPage` and `SetPasswordPage` and only the first has a Turnstile widget — adding the gate without the frontend change would break signup and password-set on prod. Needs a paired frontend change; the IP fix above is the interim mitigation. Update the "In-memory X-Forwarded-For rate limiters — Accepted" row in the table below when that lands.

### 2026-08-10 — the two file-layer leaks, and a tool that would have dropped 109 collections

Second remediation pass on the 2026-08-08 audit (findings 3, 9, 4).

**3 — the undeclared `Website Admin` role.** The one role created by hand in the admin UI and never modelled in `setup-permissions.mjs`, so §3b deliberately left it alone and its rows stayed as whatever was last clicked: unfiltered read **and update** on `directus_files`, plus unfiltered `directus_users` + `directus_roles` read, held by 4 ordinary members (`members.role = ["user"]`, none with TFA). Directus UNIONs permission rows per collection+action, so the filterless read **overrode the Member deny-list** — those four could list and download the registration folder's government-ID scans. The update leg was worse: `fields '*'` with no row filter meant a single `PATCH /items/directus_files/<id> {"folder": null}` moved a minor's passport scan into the folder the **Public** policy reads, and the `kscw-hooks` quarantine hooks only inspect files on CREATE. Now declared (§5c + `DECLARED_ROLE_POLICIES`) and scoped to the public image library: `directus_files` read/update filtered to `folder _null`, `directus_users` read to `$CURRENT_USER`, `directus_roles` read dropped. Scoping **update** is the load-bearing half — a row filter is evaluated against the *existing* row, so a file inside a private folder can no longer be selected for update at all, and therefore cannot be pulled out of one.

**9 — the scorer-exam folder was never in the deny-list.** Member `directus_files` read is a DENY-list, so any private folder nobody named is readable by all ~499 members by default. `scorer-exam.js` defined `SCORER_EXAM_FOLDER` — and warned in its own comment that folder-less files are publicly readable — but the UUID never reached `setup-permissions.mjs`, leaving 8 candidate-named match sheets and graded corrections member-readable via `GET /items/directus_files?filter[folder][_eq]=…` + `/assets`, while the parent `scorer_course_attendance` collection was correctly not member-readable. Added; the five folders are now one `PRIVATE_FOLDERS` constant, and `assertAllPrivateFoldersDenied()` **fails the deploy** if an endpoint-side folder constant is missing from it. The IDENTITY_DOCS comment predicted this exact failure in writing — a warning in a comment is not a control.

**4 — `schema:push` would have dropped 109 live collections while printing an all-clear.** Not attacker-reachable; recorded here because the blast radius is total. Three defects compounded: `?force=true` was hardcoded (bypassing Directus's own guard — the thing that refuses an 11.17.2 snapshot against a 12.2.0 instance), the diff therefore included deletions, and the summary was dead code (destructured `{ data: diff }` then read `diff.collections`, but the endpoint answers `{ data: { hash, diff } }`, so every counter printed `0`). Verified dry run against dev with the committed snapshot: **+6 ~0 -109**, dropping `absences`, `announcements`, `events`, `conversations`, `email_verifications` and the whole basketball module. `force` is now opt-in (`SCHEMA_FORCE`), counters read the right object and name every collection they would drop, and any deletion aborts the apply unless `SCHEMA_ALLOW_DELETE=true` — placed *after* the dry-run branch so a dry run can still report what it found. The migration journal remains the real path; consider retiring `schema:push` outright.

Prod after this pass: **570 permissions, 0 errors.**

### 2026-08-08 — account takeover via the OTP store closed; `Administrator` role membership is now audited

Two findings from the 2026-08-08 multi-surface audit (wiedisync + kscw-website + Directus; 43 findings after adversarial verification, full report in `.planning/audit-2026-08-08.md`, gitignored). Both are privilege-escalation paths that the declarative permission model could not see.

**1 — `Sport Admin` could take over any Directus login, including a Superuser's.** `SPORT_ADMIN_FULL_CRUD` granted unfiltered create/read/update/delete on **`email_verifications`** — not operational data, but the credential store backing the **unauthenticated** `POST /kscw/set-password` Mode 3, which accepts any row with `verified = true` and a live `expires_at` as proof the caller owns that address. A vb_admin/bb_admin could run the public OTP flow for an address they control, `PATCH` the row's `email` to a superuser's, then call `/kscw/set-password` **with no `Authorization` header** so Mode 3 runs; the endpoint resolved the target member, took `member.user`, and overwrote that password via `adminUsersService.updateOne` under `accountability: { admin: true }` → full Directus root. Fixed in three layers:

- **Load-bearing:** Mode 3 now refuses to overwrite an **existing** password on any of its three adoption paths (`orphanUser`, `member.user`, `sameEmailUser`). It is the *initial*-password flow; anyone who already has one must use the Mode 2 reset token, which proves control of `directus_users.email`. This holds even if the OTP store is compromised some other way, and it also closes the orphan-branch route to the member-row-less `admin@kscw.ch` / `cron-service@kscw.ch`. Fresh `createOne` accounts are unaffected.
- `email_verifications` is removed from the Sport Admin grant entirely — every consumer writes it with raw knex on the system connection.
- `user_logs` drops from full CRUD to **create + read**, plus blocking `user_logs.items.update` / `.delete` filters in `kscw-hooks` (mirroring `email_sends`): the tier under audit must not be able to erase its own trail.

Checked and **not** a further leg: `members.email` does not propagate to `directus_users.email`, and `password-reset.js` mails `user.email` from `directus_users` — so the unfiltered `members` update Sport Admin holds cannot redirect a reset link. `email` therefore does not need adding to `PRIVILEGE_FLAGS`.

**2 — an undeclared Directus `Administrator`.** `resolveDirectusRole` (the only writer of `directus_users.role`) can return at most `Superuser | Sport Admin | Vorstand | Team Responsible | Member`; `Administrator` is unreachable by code, so every holder was hand-set in the admin UI and nothing — not `db:deploy`, not `db:smoke`, not §3b, not any PERMISSIONS.md query — ever looked at that column. Prod carried member 62 (`members.role = ["user"]`, ~13.5k admin actions since April) on it. This is the same class as the 2026-08-05 `directus_access` blind spot, one table over. New **§3c `auditAdministratorRole`** prints every holder on each `db:setup-perms` run, marked EXPECTED (known service account, or linked member carrying `superuser`/`admin`) or **UNDECLARED**. It is **report-only by design** — an Administrator demotion can lock out the last root and, unlike a policy row, cannot be restored by re-running the script. Member 62 is a club vice-president and was legitimized at the app layer instead, so the grant is now declarative.

### 2026-08-05 — privilege escalation removed: `Sport Admin → KSCW Admin` (every sport admin was a full Directus superadmin)

- **What**: `directus_access` carried a role-level row attaching the **`KSCW Admin` policy (`admin_access = true`) to the Directus role `Sport Admin`**, created 2026-03-29 by hand in the admin UI (not by any script or migration). `admin_access` **bypasses every permission check in Directus** — collection filters, field allow-lists, the lot.
- **Who held it**: the two users on that Directus role — **member 226 Anne Grimshaw** (`role: ["user","bb_admin"]`) and **member 263 Anja Jimenez** (`role: ["user","vorstand","bb_admin"]`). Both are basketball admins; neither is a superuser.
- **What it allowed**: everything a Directus root can do, i.e. far past the intended Sport Admin ceiling (§9 of `setup-permissions.mjs`): `members` / `teams` **delete** (deliberately withheld since migration 027 — club-wide blast radius), every PII column on every member regardless of `MEMBER_VISIBLE_FIELDS` (`iban`, `ahv_nummer`, `adresse`, the E2EE document metadata, the `transfer_*` staff columns), the whole `finance_*` ledger, `clubdesk_export` in full (IBAN / AHV / Bemerkungen — deliberately field-scoped to 4 columns for this tier), `directus_users` incl. password/token writes, **schema and permission editing** (so the escalation was self-perpetuating: a holder could grant it to anyone), and Flows/webhooks. It also silently defeated every row filter this document reasons about — an audit reading `directus_permissions` alone would never have seen it, because the row lived in `directus_access`.
- **Why it survived**: `attachPolicyToRole` in `setup-permissions.mjs` only ever **added** rows. Nothing in the declarative-permissions contract ever pruned role→policy attachments, so a grant made once in the admin UI was permanent and invisible to `db:setup-perms`, `db:smoke` and every previous audit pass. (The same blind spot let ~49 duplicate rows accrete per (role, policy) — see below.)
- **Fixed**: section 3 of `setup-permissions.mjs` is now declarative in both directions. `DECLARED_ROLE_POLICIES` is the complete role-level truth (and `Sport Admin → KSCW Admin` is explicitly commented as never-allowed), and the new **§3b reconcile** deletes every role-level `directus_access` row not in that list, logging each revoke by role name + policy name. It therefore removes the escalation **and keeps it removed** — a future hand-grant in the admin UI is undone by the next `db:setup-perms` run, which is part of `db:deploy:*`. Rails so the pruning cannot itself cause an outage: user-level rows are never touched (the orthogonal Terminplanung / Finance / Spielplaner / LEADER policies are reconciled by §10/§12/§13/§14); the **public** policy row is skipped by requiring `role _nnull` *as well as* `user _null` (a bare `user IS NULL` filter would delete it and kill every anonymous read); the **Administrator** role is hard-protected (`PROTECTED_ROLES`) since Directus owns its built-in policy and deleting it is an unrecoverable lockout; roles the script does not model (the custom "Website Admin") are reported, never pruned; undeclared revocations are capped at `RECONCILE_MAX_DELETES` (25) and reported-not-applied above it; `--reconcile-dry-run` reports and deletes nothing.
- **Duplicate-row dedup (same pass)**: pre-2026-06 runs of the script POSTed a fresh `directus_access` row on every execution — `directus_access` has no unique `(role, policy)` constraint — leaving **~49 identical rows for each of the 9 declared pairs** on both prod and dev (~432 redundant rows). Harmless to authorization (Directus unions policies), but they made the table unreadable, buried the single anomalous row above in the noise, and grew every deploy. §3b now collapses each pair to one row (lowest id kept) and logs the pair + count. `attachPolicyToRole` already stopped creating new ones.
- **Also revoked by the first run** (5 rows, no effective change): `Superuser → KSCW Member / Team Responsible / Vorstand / Sport Admin / Website_admin`. A Superuser holds `KSCW Admin` (`admin_access = true`) and already bypasses every check, so the lower tiers granted nothing; they are removed as noise rather than as a fix.
- **Status**: script + docs only in this change — **not yet applied**. It lands on the next `npm run db:setup-perms:dev` / `:prod` (part of `db:deploy:*`). Verify afterwards with PERMISSIONS.md verification query 6b: `Sport Admin` must hold exactly `KSCW Sport Admin` + `KSCW Team Responsible` + `KSCW Member`, one row each. Recommended: run `--reconcile-dry-run` once per environment first and read the revoke list.

### 2026-08-05 — deliberate permission WIDENING (not a hardening): basketball prep collections for `is_spielplaner`

Recorded here for the same reason as the 2026-07-13 entry below: it **loosens** permissions, so a future audit sees it was intentional.

- **What**: `basketball_slot_plan` (CRUD), `basketball_hall_availability` (create/read/update — no delete) and `team_links` (CRUD) granted to the **`KSCW Terminplanung`** policy. They were Sport-Admin-only.
- **Why**: the basketball scheduling routes now gate on `is_spielplaner` OR sport admin, matching volleyball. `is_spielplaner` is precisely what attaches this policy (kscw-hooks action hook + §12), so the route gate and the grant cover the identical users — without the grant those users loaded an empty grid and 403'd on every write.
- **Exposure assessment**: internal season-planning data — candidate home dates, hall placements and team↔team coach/player-sharing links. **No member PII, no financial data.** `team_links` read was already club-wide for every member. Public/anon unchanged (no Public grant). Delete on `basketball_hall_availability` deliberately withheld: the UI never deletes those rows, it flips `unavailable` back to `false`.
- **⚠ Invariant to preserve**: if the route gate is widened to per-team `spielplaner_assignments`, those users hold **`KSCW Spielplaner`**, not `KSCW Terminplanung` — the grants must move or be duplicated in the same change.

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

12. **An upload stream that errors with no `'error'` listener kills the whole worker.** In Node an unhandled stream `'error'` is an *uncaught exception* — it does not reject your `await`, it exits the process, PM2 restarts Directus and every in-flight request across the API 502s. On a **public** upload route that is an unauthenticated remote kill switch. The trap is the async gap: `req.pipe(capped)` starts data flowing immediately, so any `await` between the pipe and the consumer (`FilesService.uploadOne`) is a window in which an early error has nobody listening. Caught on dev in `scorer-exam.js`, whose validator rejects on the *first* chunk (bad magic bytes) and so hit that window every time — reproducible: `Error: unsupported_type` → `App [directus:0] exited` → restart. Rules: do every `await` **before** piping, and attach an `'error'` listener to the Transform the moment you create it (capture it and re-throw after `uploadOne`, so the real 413/415 still reaches the client). ⚠ `identity-document.js` has the same shape — latent only because its Transform errors past 10 MB, by which point the consumer is attached. Also note `sniffType`-style state is **null at `uploadOne(...)` call time** (no bytes have flowed yet), so a type/filename derived from it must be patched onto `directus_files` afterwards.

13. **A permission audit that only reads `directus_permissions` is blind to `directus_access`.** Authorization in Directus 11 is *role → policy → permission*, and the middle link lives in its own table. A policy with `admin_access = true` attached to a role there bypasses every permission row you are reading, and shows up in none of them — that is exactly how `Sport Admin → KSCW Admin` survived multiple audits (2026-08-05 block above). Always start a permission review with the `directus_access` roll-up (PERMISSIONS.md verification query 6b), not with `directus_permissions`. Same trap for **user-level** rows: `user IS NOT NULL` rows are the orthogonal policies (Terminplanung / Finance / Spielplaner / LEADER) and are reconciled per-policy, so a stray one there is invisible to the role-level view.

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
