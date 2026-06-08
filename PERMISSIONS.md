# Permissions reference — KSCW Directus

Canonical role × collection × action map. Reflects the live state through migration 069 (2026-05-31). Updated by reviewers as part of every permission change.

> **2026-05-31 — Security audit hardening (self-scoped Member creates + public read scoping).** Member `create` on `participations`, `absences`, `poll_votes`, `scorer_delegations`, `push_subscriptions`, `team_requests`, `carpools`, `carpool_passengers` was unfiltered — any member could write a row attributed to another member (mark a teammate absent, vote/RSVP as them, file a join request for them; an absence write even cascaded all the victim's confirmed RSVPs to declined via migration 038). All now carry the same self-scope filter their `update` already used (`OWN_MEMBER` / `OWN_DRIVER` / `OWN_PASSENGER` / `from_member = $CURRENT_USER` for delegations). Public `members` read scoped to `website_visible = true` (was ignoring the privacy opt-out and exposing the whole roster). Public `directus_files` read scoped to the public-assets folder via `PUBLIC_FILES_FOLDER` env (feedback screenshots / profile photos no longer anonymously enumerable); falls back to the legacy blanket read with a warning if the env is unset. See SECURITY.md "2026-05-31" block. **Untested in this branch — `npm run db:setup-perms:dev` + `db:smoke:dev` MUST pass before prod, and `PUBLIC_FILES_FOLDER` MUST be set on dev + prod for the files fix to take effect.**

> **2026-05-23 — Restored public `events` + `news` for kscw-website.** Migration 035 dropped Public read on `events` on the mistaken assumption the website didn't consume it, silently emptying the homepage events + `/weiteres/kalender`; `news` had never been granted (homepage News showed "no news"). Re-added both to Public as field-scoped reads (`PUBLIC_EVENT_FIELDS` / `PUBLIC_NEWS_FIELDS`, non-PII); `news` limited to published, non-future posts. RSVP junctions (`events_teams` / `participations`) stay private — 035's privacy fix is intact. Applied dev→prod via `db:setup-perms`; smoke green.

> **2026-05-12 — Deep-audit LEADER tightening.** Removed unfiltered LEADER reads on `members`, `participations`, `absences`, `user_logs`, and unfiltered LEADER updates on `games`, `trainings`, `events`. All now use the coach/TR-of-the-target-team filter pattern; `members.read` adds a `LEADER_TEAM_MEMBER_FIELDS` whitelist that excludes `ahv_nummer`. LEADER lost `user_logs.read` entirely — audit access goes through `/kscw/admin/audit` (admin-only). See SECURITY.md "2026-05-12" block for the full per-finding ledger.

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
| events | read | none | Limited fields (`PUBLIC_EVENT_FIELDS`) — kscw-website homepage + calendar. Event record only; RSVP junctions stay private |
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
| directus_files | read | `folder = PUBLIC_FILES_FOLDER` (env) | Public-assets folder only; feedback screenshots / profile photos excluded (2026-05-31 audit). Falls back to unscoped read + warning if env unset |
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
| event_sessions | events `EVENTS_VISIBLE` | `*` | 036 |
| events_members | events `EVENTS_VISIBLE` | `*` | 036 |
| participations | `SAME_TEAM_AS_ME` | `*` | 033 |
| absences | `SAME_TEAM_AS_ME` | `*` | 033 |
| sv_vm_check | `OWN_MEMBER` | `VM_CHECK_FIELDS` (11 fields, no PII) | **043** |
| tasks | own `assigned_to` / `claimed_by` | `*` | **043** |
| feedback | `email = $CURRENT_USER.email` | `*` | **043** |
| member_teams | none (read); `OWN_MEMBER` (delete) | `id, member, team, season` (no `guest_level`) | **043**; delete added 2026-05-26 (self-service leave-team) |
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
| absences | read | none (team-wide visibility for coaches) | |
| notifications | create | none | |
| announcements | read | published + non-expired only (no draft access) | F6 audit |
| user_logs | read | none | |
| game_scheduling_* | read | none | |
| fines | CRUD | scoped via teams.coach / team_responsible | **069** |
| fine_rules | CRUD | scoped via teams.coach / team_responsible | **069** |
| sponsors | create | none (UI attaches the team; CREATE can't be relationally filtered) | **2026-06-08** |
| sponsors | update / delete | scoped via `teams_sponsors → teams.coach / team_responsible` (`SPONSORS_LEADER_SCOPE`); read stays inherited-unfiltered to avoid the M2M-deep-filter gotcha vs the editor's `teams.teams_id` fetch | **2026-06-08** |
| teams_sponsors | CRUD | none (junction for the sponsor M2M write) | **2026-06-08** |
| directus_files | create | none | |

---

## KSCW Vorstand

Inherits Member. Adds read-all on operational collections — board oversight role:

`members, member_teams, participations, absences, notifications, scorer_delegations, team_invites, user_logs, feedback, tasks, task_templates, poll_votes, team_requests, push_subscriptions, game_scheduling_*, announcements, fines, fine_rules`.

No CRU writes — Vorstand is read-only by design.

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

Run these after migration 043 to confirm parity:

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
