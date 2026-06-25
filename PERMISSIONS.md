# Permissions reference — KSCW Directus

Canonical role × collection × action map. Reflects the live state through migration 149 (2026-06-25). Updated by reviewers as part of every permission change. (Schema-only migrations 104–149 carry no permission rows; the per-collection posture for the finance-batch collections — 138–147 — is in the dated history below.)

> Migrations 104–111 (2026-06-10..06-15) are all schema-only — they carry no permission rows and add no plpgsql functions needing `search_path`, so this doc's role tables are unchanged by them; only the version anchor moved. The Forms permission surface (migrations 086–089) is documented in the role tables below.

> **2026-06-10 — Deep-audit remediation (Public `events` row-scope + doc-drift corrections).** Public `events` read was field-restricted but **NOT row-restricted** (filter `null`), so anon could read every event's title via `/items/events` — including team-internal events. Scoped to club-wide types `{ event_type: { _in: ['verein', 'tournament'] } }`, mirroring the Member `EVENTS_VISIBLE` club-wide branch (the `/kscw/public/events` endpoint still additionally excludes any team-/member-scoped event). Also corrected several rows where this doc had drifted from the authoritative `setup-permissions.mjs` (the script is canonical; the doc lied): `sv_vm_check` Member direct read is **REVOKED** (access via `/kscw/sv-licence/me`, not `OWN_MEMBER`); public `directus_files` read is `folder _null` (the `PUBLIC_FILES_FOLDER` env approach was dropped, no env/fallback); `member_teams` Member read returns `*` incl. `guest_level` (not the claimed `id, member, team, season`); `event_sessions` Member read is unfiltered cross-club (in `MEMBER_READ_ALL`, not `EVENTS_VISIBLE`-scoped); LEADER `absences` read is the coach/TR-team scope (not "none"); LEADER `user_logs` read is **REVOKED** (not granted). Three schema-only migrations shipped alongside (no perm rows): **100** pins `search_path = public` on `members_prevent_email_blanking` / `trg_form_submissions_guard` / `trg_form_submissions_update_guard` (regressed the 071 hardening); **101** guards the implicit `varchar→int` cast in `trg_participations_guest_block` (a non-numeric `activity_id` silently skipped the guest block); **102** un-confirms a derby (`game_scheduling_derbies`) whose host team is deleted (the FK's `ON DELETE SET NULL` would otherwise leave `confirmed=true` with a null host, breaking Art. 27 clamping). See SECURITY.md "2026-06-10" block.

> **2026-05-31 — Security audit hardening (self-scoped Member creates + public read scoping).** Member `create` on `participations`, `absences`, `poll_votes`, `scorer_delegations`, `push_subscriptions`, `team_requests`, `carpools`, `carpool_passengers` was unfiltered — any member could write a row attributed to another member (mark a teammate absent, vote/RSVP as them, file a join request for them; an absence write even cascaded all the victim's confirmed RSVPs to declined via migration 038). All now carry the same self-scope filter their `update` already used (`OWN_MEMBER` / `OWN_DRIVER` / `OWN_PASSENGER` / `from_member = $CURRENT_USER` for delegations). Public `members` read scoped to `website_visible = true` (was ignoring the privacy opt-out and exposing the whole roster). Public `directus_files` read scoped to the public-assets folder via `PUBLIC_FILES_FOLDER` env (feedback screenshots / profile photos no longer anonymously enumerable); falls back to the legacy blanket read with a warning if the env is unset. See SECURITY.md "2026-05-31" block. **Untested in this branch — `npm run db:setup-perms:dev` + `db:smoke:dev` MUST pass before prod, and `PUBLIC_FILES_FOLDER` MUST be set on dev + prod for the files fix to take effect.**

> **Source of truth (post-2026-05-06):** `directus/scripts/setup-permissions.mjs` is the SINGLE source for Directus permissions. It is declarative, idempotent (clears + recreates on every run), and applied via `npm run db:setup-perms:<env>` on every deploy. Numbered SQL migrations are SCHEMA-ONLY going forward — they no longer carry permission rows. This doc is the human-readable index of the script — keep both in sync.

> **Permissions migrations 019/020/023/024/025/026/027/029/030/032/033/034/035/036/042/043** in `0NN-*.sql` form the historical journal of how we got to the current state. Do not write new ones. Update the script instead and let `db:setup-perms` reconcile.

---

## Roles & policies

| Role | Policy | `admin_access` | `app_access` | Description |
|---|---|---|---|---|
| Administrator | (built-in) | true | true | Directus root |
| Superuser | KSCW Admin | true | true | Full system access (superuser + admin members) |
| Sport Admin | KSCW Sport Admin | false | true | vb_admin / bb_admin — sport-scoped club ops |
| Vorstand | KSCW Vorstand | false | true | Board members — read-all access |
| Team Responsible | KSCW Team Responsible | false | true | Coach or team responsible (LEADER tier) |
| Member | KSCW Member | false | true | Default authenticated member |
| Public | (built-in `$t:public_label`) | false | true | Unauthenticated visitors |

Inheritance (additive): `Sport Admin` → `Team Responsible` → `Member`. `Vorstand` → `Member`. Every member of a higher tier carries the lower tier's permissions on top of their own row.

**Orthogonal policies** — attached per-user via `directus_access` (NOT base roles), layered on top of whatever base role the user holds:
- `KSCW Terminplanung` — members with `is_spielplaner = true` (game-scheduling).
- `KSCW Finance` — members with the `finance` app-role (treasurer / finance team). Reconciled by the role-sync hook on `members.role` change + `setup-permissions.mjs §13` on every deploy.

---

## Filter shorthand

Used throughout — repeated literally rather than via subqueries because Directus stores filters as inline JSON.

| Name | Filter | Usage |
|---|---|---|
| `OWN_USER` | `{ user: { _eq: '$CURRENT_USER' } }` | members directly |
| `OWN_MEMBER` | `{ member: { user: { _eq: '$CURRENT_USER' } } }` | rows with `member` FK |
| `OWN_DU` | `{ user: { user: { _eq: '$CURRENT_USER' } } }` | `user_logs` (int FK to members) |
| `MY_TEAMS` | `{ team: { members: { member: { user: ... } } } }` | trainings, anything team-scoped |
| `EVENTS_VISIBLE` | `_or` of own / club-wide / my-teams / invited-members | events, event_sessions, events_members |
| `SAME_TEAM_AS_ME` | `_or` of own member + member-on-same-team | participations, absences |
| `OWN_DELEGATION` | `{ _or: [{ from_member.user }, { to_member.user }] }` | scorer_delegations |

---

## Public (unauthenticated)

| Collection | Action | Filter | Notes |
|---|---|---|---|
| teams | read | `active = true` | Limited fields (`PUBLIC_TEAM_FIELDS`) |
| games | read | none | Limited fields (`PUBLIC_GAME_FIELDS`) |
| rankings | read | none | |
| sponsors | read | `active = true` | |
| scorer_courses | read | `active = true` | Scorer-course sign-up sessions (kscw-website) |
| events | read | `event_type _in {verein, tournament}` | Limited fields (`PUBLIC_EVENT_FIELDS`) — kscw-website homepage + calendar. Row-scoped to club-wide event types (2026-06-10 audit — was unscoped, leaking team-internal event titles to anon); mirrors Member `EVENTS_VISIBLE` club-wide branch. Event record only; RSVP junctions stay private. The `/kscw/public/events` endpoint additionally excludes any team-/member-scoped event |
| news | read | `published_at` set & `≤ $NOW` | Limited fields (`PUBLIC_NEWS_FIELDS`) — published posts only; kscw-website homepage + /news |
| teams_sponsors | read | none | Junction for kscw-website |
| teams_coaches | read | none | Junction for kscw-website |
| members | read | `website_visible = true` | Fields: `id, first_name, last_name, photo` only — opt-in only (2026-05-31 audit) |
| hall_slots / hall_slots_teams | read | none | Calendar embed |
| hall_closures | read | none | |
| hall_events / hall_events_halls | read | none | |
| halls | read | none | |
| feedback | create | none | Fields whitelisted; Turnstile + filter hook gate |
| mixed_tournament_signups | create | none | Same |
| directus_files | read | `folder _null` (folder-less only) | Root/folder-less public assets only; sensitive uploads (feedback screenshots) live in a private folder and are excluded (2026-05-31 audit). NB: the earlier `PUBLIC_FILES_FOLDER` env approach was **dropped** — the live script uses `{ folder: { _null: true } }`, no env, no fallback |
| directus_files | create | none | Public uploads (feedback screenshots, website) — land in a NON-public folder |

**Explicit non-public (don't re-grant!):** `trainings` (032), `slot_claims` / `events_teams` / `participations` (035), `event_signups` (anon/authenticated revoked at PG level — 035). Note: the `events` *record* is public (field-scoped, granted above for the kscw-website calendar) — only its RSVP junctions (`events_teams` / `participations`) stay private.

---

## KSCW Member — most-touched rows

### Reads (with row scope)

| Collection | Filter | Fields | Source migration |
|---|---|---|---|
| members | none | `MEMBER_VISIBLE_FIELDS` (no `email`/`phone`) | 024 |
| members | `OWN_USER` | `MEMBER_OWN_READABLE` (incl. PII + 029 messaging fields + 030 + 042 + read-only `is_spielplaner` so the frontend nav can gate the Spielplanung/Terminplanung links on it) | 029, 030, 042 |
| trainings | `MY_TEAMS` | `*` | 032 |
| events | `EVENTS_VISIBLE` | `*` | 033 |
| event_sessions | none (unfiltered, cross-club) | `*` | 036 — in `MEMBER_READ_ALL`, NOT `EVENTS_VISIBLE`-scoped (drift fixed in doc 2026-06-10). Session rows carry no PII; the parent `events` read IS `EVENTS_VISIBLE`-scoped |
| events_members | events `EVENTS_VISIBLE` | `*` | 036 |
| participations | `SAME_TEAM_AS_ME` | `*` | 033 |
| absences | `SAME_TEAM_AS_ME` | `*` | 033 |
| sv_vm_check | **REVOKED** (no direct Member read) | — | Direct read removed (closes the 2026-05-06 Critical). Members get their own licence via `GET /kscw/sv-licence/me` (joins by `license_nr`, returns 11 safe fields). The absence is intentional — a row filter would trip Directus 11's `CASE WHEN 1` SQL bug. Sport Admin+ retain full CRUD |
| tasks | own `assigned_to` / `claimed_by` | `*` | **043** |
| feedback | `email = $CURRENT_USER.email` | `*` | **043** |
| member_teams | none (read); `OWN_MEMBER` (delete) | `*` (incl. `guest_level`) | **043**; delete added 2026-05-26 (self-service leave-team). Doc drift fixed 2026-06-10 — the live script grants an unfiltered, all-fields read (`setPermRead(MEMBER_POLICY, 'member_teams')`), NOT the restricted `id, member, team, season` set; `guest_level` IS returned (the whole-club roster relies on it) |
| blocks | `blocker.user = $CURRENT_USER` | `*` | 042 |
| spielplaner_assignments | `OWN_MEMBER` | `*` | 034, 042 |
| user_logs | `OWN_DU` (note traversal!) | `*` | 4.4.8 fix |
| notifications | `OWN_MEMBER` | `*` | |
| push_subscriptions | `OWN_MEMBER` | `*` | |
| announcements | published + non-expired only | excludes `audience_teams` / `audience_roles` | 3.11 |
| polls | `MY_TEAMS` (via team)| `*` | 035 |
| referee_expenses | `MY_TEAMS` (via team) | `*` | 035 |
| fines | `member.user = $CURRENT_USER` | `*` | **069** |
| fine_rules | `team.member_teams.member.user = $CURRENT_USER` | `*` | **069** |
| forms | `FORMS_VISIBLE` — `status _in {open, closed}` AND (`audience = club_wide` OR an attached team I'm a member of). Frontend resolves visibility via the two-step junction fetch (`useUserVisibleFormIds`); the policy walk of `forms.teams` is why the frontend must NOT also deep-filter it (M2M-deep-filter + policy-walk silent-`[]` landmine) | `*` | **086 / 087** |
| forms_teams | none | `*` — junction read for the forms M2M | **086 / 087** |
| form_submissions | `member.user = $CURRENT_USER` (own only) | `*` | **086 / 087** |
| finance_invoices | `member.user = $CURRENT_USER` (own dues only) | `MEMBER_INVOICE_FIELDS` (16 dues cols + `member`; no `source`/`import_batch`/`cd_*`/`recipient_*` mirror plumbing) | **114** |

### Reads (intentionally cross-club)

`teams`, `games`, `rankings`, `sponsors`, `event_sessions` (read filtered above), `hall_slots`, `hall_closures`, `hall_events`, `hall_events_halls`, `halls`, `hall_slots_teams`, `slot_claims`, `news`, `app_settings`, `carpools`, `carpool_passengers`, `teams_coaches`, `teams_responsibles`, `teams_sponsors`, `events_teams`, `events_members`, `directus_files`.

### Writes

| Collection | Action | Filter |
|---|---|---|
| members | update | `OWN_USER`, fields = `MEMBER_EDITABLE_FIELDS` (excludes `role`, role stripped by hook filter) |
| participations | create / update | `OWN_MEMBER` (create self-scoped 2026-05-31 audit) |
| absences | create / update / delete | `OWN_MEMBER` (create self-scoped 2026-05-31 audit) |
| notifications | update / delete | own |
| push_subscriptions | create / update / delete | `OWN_MEMBER` (create self-scoped 2026-05-31 audit) |
| scorer_delegations | create / update | create = `from_member = $CURRENT_USER`; update = own (from/to) (create self-scoped 2026-05-31 audit) |
| user_logs | create | none |
| feedback | create | none |
| tasks | update | own (assigned/claimed) |
| carpools | create / update | own driver (`OWN_DRIVER`; create self-scoped 2026-05-31 audit) |
| carpool_passengers | create / update | own (`OWN_PASSENGER`; create self-scoped 2026-05-31 audit) |
| poll_votes | create / update | `OWN_MEMBER` (create self-scoped 2026-05-31 audit) |
| team_requests | create | `member.user = $CURRENT_USER` (self-scoped 2026-05-31 audit) |
| form_submissions | create | `member _null` (anonymous) OR `member.user = $CURRENT_USER` — self-scoped, blocks submitting as another member while still allowing anonymous forms |
| form_submissions | update | `member.user = $CURRENT_USER`, fields = `answers` only (migration 088 — revise own answers while the form is open; BEFORE UPDATE guard blocks edits once closed / past deadline, and the field restriction stops reassigning the submission to another member/form) |
| directus_files | create | none |

**Explicit non-write for Member:** `members.role` field — stripped by `filter('members.items.update')` in `kscw-hooks` for non-admin callers (defense-in-depth on top of field-level perm).

---

## KSCW Team Responsible (Coach + TR — LEADER tier)

Inherits everything from Member. Adds:

| Collection | Action | Filter | Source migration |
|---|---|---|---|
| members | read | scoped to my-team members (`COACH_TEAM_MEMBERS` — coach/TR of the member's team), fields = `LEADER_TEAM_MEMBER_FIELDS` (all visible+editable fields **except** `ahv_nummer`) | 036, scoped 2026-05-12 |
| members | update | scoped to my-team members (`COACH_TEAM_MEMBERS`), fields = `position, number, coach_approved_team` | 036, `coach_approved_team` 2026-05-19 |
| members | update | scoped to my-team signups (`COACH_REQUESTED_TEAM` — coach/TR of the requested team), fields = `kscw_membership_active, wiedisync_active, requested_team` | reject-signup path (`TeamDetail.handleReject`) |
| teams | read | none | |
| teams | read | none | also `LEADER_TEAM_DASHBOARD_FIELDS` |
| teams | update | scoped: `coach.members_id.user = $CURRENT_USER` OR `team_responsible.members_id.user = $CURRENT_USER` | **043** |
| games | update | scoped via teams.coach (mig 026) | 026 |
| trainings | create / update | scoped via teams.coach | 026 |
| events | create / update | scoped via teams.coach | 026 |
| event_sessions | create / update | scoped via parent event | 026, 036 |
| events_teams | create / update / delete | scoped via teams.coach | 019, 026 |
| participations | update | scoped via teams.coach | 026 |
| member_teams | create / update / delete | scoped via teams.coach | 020 |
| hall_slots | create / update | scoped via teams.coach | 026 |
| hall_slots_teams | CRUD | scoped via teams.coach | 020 |
| slot_claims | update | scoped via teams.coach | 026 |
| team_invites | full CRUD | scoped via teams.coach | |
| scorer_delegations | read | none | |
| referee_expenses | create / update | scoped via teams.coach | 026 |
| tasks | create / update / delete | scoped via teams.coach | 026 |
| task_templates | read / create / update | scoped via teams.coach | 026 |
| polls | create / update / delete | scoped via teams.coach | 026 |
| team_requests | read / update | none | |
| absences | read | own + members on teams I coach/TR | Doc drift fixed 2026-06-10 — read is NOT unfiltered. Scoped to the coach/TR-of-the-target-team filter (`member.member_teams.team.{coach,team_responsible}.members_id.user = $CURRENT_USER`, plus own), same scope as the CUD rows (2026-05-12 audit closed the full-club absence-notes dump) |
| notifications | create | none | |
| announcements | read | published + non-expired only (no draft access) | F6 audit |
| user_logs | read | **REVOKED** (removed from LEADER 2026-05-12) | Audit access goes through `/kscw/admin/audit` (admin-only). Doc drift fixed 2026-06-10 — LEADER has NO `user_logs.read`; the smoke test asserts a coach token 403s here |
| game_scheduling_* | read | none | |
| fines | CRUD | scoped via teams.coach / team_responsible | **069** |
| fine_rules | CRUD | scoped via teams.coach / team_responsible | **069** |
| forms | read | `audience = club_wide` OR `FORMS_LEADER_SCOPE` (creator OR coach/TR of an attached team) | **086 / 087** |
| forms | create | none (UI attaches the team; CREATE can't be relationally filtered) | **086 / 087** |
| forms | update / delete | `FORMS_LEADER_SCOPE` — `created_by` is me, OR coach/TR of an attached team | **086 / 087** |
| forms_teams | CRUD | none (junction for the forms M2M write) | **086 / 087** |
| form_submissions | read | `form` matches `FORMS_LEADER_SCOPE` (submissions of forms in their scope) | **086 / 087** |
| sponsors | create | none (UI attaches the team; CREATE can't be relationally filtered) | **2026-06-08** |
| sponsors | update / delete | scoped via `teams_sponsors → teams.coach / team_responsible` (`SPONSORS_LEADER_SCOPE`); read stays inherited-unfiltered to avoid the M2M-deep-filter gotcha vs the editor's `teams.teams_id` fetch | **2026-06-08** |
| teams_sponsors | CRUD | none (junction for the sponsor M2M write) | **2026-06-08** |
| directus_files | create | none | |

---

## KSCW Vorstand

Inherits Member. Adds read-all on operational collections — board oversight role:

`members, member_teams, participations, absences, notifications, scorer_delegations, team_invites, user_logs, feedback, tasks, task_templates, poll_votes, team_requests, push_subscriptions, game_scheduling_seasons, game_scheduling_slots, game_scheduling_opponents, game_scheduling_bookings, announcements, fines, fine_rules, scheduling_blocks, finance_accounts, finance_fiscal_years, finance_budget_lines, finance_transactions, finance_invoices, finance_payments, finance_imports, finance_invoice_member_overrides`.

**Finance (migration 114)** — the `finance_*` collections are the full board finance dashboard (ClubDesk Finanz read-only mirror, Scope A). Vorstand reads all; Members read only their own `finance_invoices` (above). No policy-layer writes.

**Native invoices + member-link overrides (migrations 128/129)** — still **read-only at the policy layer**. Native-invoice writes (create / report-paid / confirm / cancel) and the `finance_invoice_member_overrides` link tool all go through the `/kscw/finance/*` endpoints on the system connection, Vorstand-gated **in code** (so the board can never edit ClubDesk-mirror rows via the items API). Members never get item-API write — their "I've paid" self-report is an endpoint call. `finance_invoice_member_overrides` is Vorstand read-only here for admin visibility/audit.

**Plus full CRUD on Forms** — `forms`, `forms_teams`, `form_submissions` (decision 2026-06-05: create/edit/delete any form club-wide + read all submissions, exactly like a global admin). This is the one exception to the otherwise read-only board role.

Read-only on everything else by design (no CRU writes outside the Forms grant above).

---

## KSCW Finance (orthogonal — `finance` app-role)

Per-user policy (migrations 132/133), attached to members with `finance` in their role array — NOT a base Directus role. Layered on the member's base policy (so a `['finance']` member is a Directus *Member* + this policy). Gives the treasurer / finance team the full club-finance picture without the rest of board-wide access.

| Collection | Action | Filter | Notes |
|---|---|---|---|
| members | read | none (club-wide) | `FINANCE_MEMBER_FIELDS` — contact + `adresse/plz/ort` + `iban` + `ahv_nummer` + `beitragskategorie` + membership + billing_*. UNION-ed with the member policy's `MEMBER_VISIBLE_FIELDS`, so this only widens finance's view |
| members | update | none (club-wide) | `FINANCE_MEMBER_BILLING_FIELDS` only — the alternate billing contact (migration 133). No other member field is writable here |
| member_teams | read | none | Team context |
| finance_accounts, finance_fiscal_years, finance_budget_lines, finance_transactions, finance_invoices, finance_payments, finance_imports, finance_invoice_member_overrides, finance_payouts | read | none | Full club finance read (same set as Vorstand; `finance_payouts` migration 137) |
| finance_dues_rates, finance_dues_runs | read | none | Dues-rate table + dues-run history (migration 138). Vorstand + Finance only |
| finance_invoice_documents | create/read/update/delete | none | Invoice PDF attachment links (migration 134). Vorstand gets read |
| directus_files | create | none | Upload invoice PDFs (frontend sets `folder` = the private finance folder) |
| directus_files | read | `folder = <finance folder>` | View the private invoice PDFs via /assets. Folder-less files come via the member policy; members are excluded from THIS folder (read narrowed to `_or[null, ≠finance]`) |

**Writes** — native-invoice create/report-paid/confirm/cancel/link + camt import are NOT item-API; they go through `/kscw/finance/*`, gated in code by `canManageFinance` (admin OR role ∈ {vorstand, admin, superuser, **finance**}). So a finance-role user is a full treasurer at the endpoint layer while staying read-only on the items API (except the billing-field write above).

**Frontend** — `canAccessFinance = isVorstand || isFinance` gates the `/admin/finance` tab (`FinanceRoute`) + the per-member explorer (`FinancePage` → Members tab). Billing edit is shown editable only when `isFinance` (a pure board member sees it read-only — they lack the members-update grant).

---

## KSCW Sport Admin

Inherits Team Responsible (and via that, Member). Adds full CRUD on operational collections except:

- `members` and `teams` — create / read / update only. **No delete** (migration 027 — club-wide blast radius is admin-only).

---

## Administrator / Superuser

`admin_access = true`. Bypasses all permission checks. Use sparingly.

---

## Operational checklist for permission changes

When you touch any permission row:

- [ ] Edit `directus/scripts/setup-permissions.mjs` only. **Do NOT write a numbered SQL migration for a permission change.**
- [ ] Update this `PERMISSIONS.md` row in the same commit.
- [ ] Add a one-liner to `SECURITY.md` audit log (`### YYYY-MM-DD — …`).
- [ ] Test: `npm run db:deploy:dev` — runs migrate → setup-perms → smoke. Confirm green before merging.
- [ ] Ship: merge to prod and `npm run db:deploy:prod`.

The reviewer should diff `setup-permissions.mjs` against this doc to confirm parity. The smoke test is the safety net — if it fails for a Member role on any collection, the deploy halts before reaching users.

---

## Verification queries

Current parity checks — run these any time to confirm the live DB matches `setup-permissions.mjs`:

```sql
-- 1. Critical reads scoped
SELECT pol.name, p.collection, p.action, p.permissions, p.fields
FROM directus_permissions p
JOIN directus_policies pol ON pol.id = p.policy
WHERE p.collection IN ('sv_vm_check','tasks','feedback','member_teams')
  AND pol.name = 'KSCW Member'
ORDER BY p.collection;

-- 2. teams.update is row-scoped for both leader sub-policies
SELECT pol.name, p.collection, p.action, p.permissions
FROM directus_permissions p
JOIN directus_policies pol ON pol.id = p.policy
WHERE p.collection = 'teams' AND p.action = 'update';

-- 3. Sport Admin: no delete on members or teams
SELECT pol.name, p.collection, p.action
FROM directus_permissions p
JOIN directus_policies pol ON pol.id = p.policy
WHERE pol.name = 'KSCW Sport Admin' AND p.collection IN ('members','teams')
ORDER BY p.collection, p.action;

-- 4. teams_sponsors FK present + cascade
SELECT conname, confdeltype FROM pg_constraint
WHERE conrelid = 'teams_sponsors'::regclass AND contype = 'f';

-- 5. Messaging functions have search_path
SELECT proname, proconfig FROM pg_proc
WHERE proname LIKE 'fn_messaging%' OR proname = 'messaging_protect_sentinel'
ORDER BY proname;

-- 6. anon / authenticated have NO SELECT on operational tables
SELECT grantee, table_name
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated')
  AND privilege_type = 'SELECT'
ORDER BY table_name;
-- Expected: empty (or only the explicitly-public set).
```

---

## History

<details>
<summary>Older reconciliation notes (archival — the full audit ledger lives in SECURITY.md + git).</summary>

> **2026-06-24 — Finance role + per-member explorer (migrations 132/133).** New orthogonal `finance` app-role (treasurer / finance team) = member permissions + a new `KSCW Finance` policy attached per-user (like `is_spielplaner`/Terminplanung), reconciled by the role-sync hook + `setup-permissions.mjs §13`. The policy grants club-wide finance reads (same `finance_*` set as Vorstand), a field-scoped `members` read (contact + IBAN + membership + billing), and a `members` UPDATE scoped to the new billing-contact fields only (migration 133 — alternate billing for minors/guardians/company-paid). Finance writes (native invoices + camt) widened from Vorstand-only to `canManageFinance` (adds `finance`). Migration 132 adds `finance` to the `members.role` CHECK; 133 adds `billing_*` columns + a one-time backfill from the latest differing invoice recipient (0 rows flipped on prod — all member-linked invoices are email-matched to the member's own address; guardian cases live in the unlinked orphans, set manually). No change to any existing role. **Applied dev + prod 2026-06-24.**

> **2026-06-24 — Invoice PDF attachments (migration 134).** Finance/board can attach invoice PDFs. New `finance_invoice_documents` link table (keyed by `match_clubdesk_id` for ClubDesk-mirror invoices — sync-safe, 1-1 — or the `invoice` FK for native) + a private Directus folder (`f1a0d0c5-…`) the PDFs upload into. **Member `directus_files` read narrowed** from unfiltered to `{ _or: [{ folder: _null }, { folder: { _neq: <finance folder> } }] }` — i.e. everything EXCEPT the finance folder (surgical: all existing member file access — folder-less photos, feedback screenshots — is unchanged; only the new private folder is excluded). Finance gets `directus_files` create + a folder-scoped read + `finance_invoice_documents` CRUD; Vorstand gets the folder-scoped read + `finance_invoice_documents` read. PDFs are served via `/assets` (which honours the policy) — no streaming endpoint. Applied dev + prod 2026-06-24. See SECURITY.md.

> **2026-06-23 — Native invoices + member-link overrides (migrations 128/129).** Added native-invoice write columns to `finance_invoices` and a new `finance_invoice_member_overrides` table. No new item-API write perms: all native-invoice writes (create / report-paid / confirm / cancel) and the orphan member-link tool run through the `/kscw/finance/*` endpoints (system connection, Vorstand-gated in code; member self-report endpoint-gated to the recipient). Vorstand gains read-only on `finance_invoice_member_overrides` for admin visibility. Members still read-only on own `finance_invoices`. Applied dev; prod pending.

> **2026-06-18 — Finance module (Scope A, migration 114).** Added 7 `finance_*` collections — a read-only mirror of ClubDesk Finanz, schema built so a future native finance (Scope C) just adds write paths. Member gets read-only `finance_invoices` scoped to own dues (`member.user = $CURRENT_USER`, `MEMBER_INVOICE_FIELDS` whitelist — AHV/IBAN/address deliberately not mirrored); Vorstand gets read-all on all 7. No write perms — the ClubDesk scraper/import writes via the system connection, not the items API. Applied + verified on dev via the `directus_permissions` query (smoke skipped — dev member token dead); prod pending.

> **2026-05-23 — Restored public `events` + `news` for kscw-website.** Migration 035 dropped Public read on `events` on the mistaken assumption the website didn't consume it, silently emptying the homepage events + `/weiteres/kalender`; `news` had never been granted (homepage News showed "no news"). Re-added both to Public as field-scoped reads (`PUBLIC_EVENT_FIELDS` / `PUBLIC_NEWS_FIELDS`, non-PII); `news` limited to published, non-future posts. RSVP junctions (`events_teams` / `participations`) stay private — 035's privacy fix is intact. Applied dev→prod via `db:setup-perms`; smoke green.

> **2026-05-12 — Deep-audit LEADER tightening.** Removed unfiltered LEADER reads on `members`, `participations`, `absences`, `user_logs`, and unfiltered LEADER updates on `games`, `trainings`, `events`. All now use the coach/TR-of-the-target-team filter pattern; `members.read` adds a `LEADER_TEAM_MEMBER_FIELDS` whitelist that excludes `ahv_nummer`. LEADER lost `user_logs.read` entirely — audit access goes through `/kscw/admin/audit` (admin-only). See SECURITY.md "2026-05-12" block for the full per-finding ledger.

> **2026-06-25 — Finance batch collections (migrations 138–147) — deny-by-default + endpoint-only writes (DEV; prod pending).** All WRITES go exclusively through `canManageFinance`-gated `/kscw/finance/*` endpoints (raw-knex system connection) — **no items-API write grant for any role** (load-bearing). READ scope per collection: `finance_dues_rates` + `finance_dues_runs` → **Vorstand + Finance** (intentional, dashboard). `finance_email_settings`, `finance_email_jobs`, `finance_team_entries`, `finance_dunning_notices`, `finance_billing_contacts` → **none / admin-only** (deny-by-default — they hold sponsor emails/IBANs, the treasurer test inbox, dunning state). New cols `finance_invoices.dunning_level`/`email_sent_at`/`contact`/`dues_run`, `finance_payments.entry_type`, `members.never_dun` are in **no** scoped field-whitelist → endpoint-only. Caveat: `members.never_dun` rides the pre-existing **Sport Admin `members.*` wildcard** (which already exposes `iban`/`ahv_nummer`) — accepted/open, see SECURITY.md 2026-06-25. Recommend a `db:smoke` 403 assertion on `/items/finance_billing_contacts` + `/items/finance_email_settings` so an accidental future grant turns the deploy red.

</details>
