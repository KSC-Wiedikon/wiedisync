# Permissions reference — KSCW Directus

Canonical role × collection × action map. Reflects the live state through migration 165 (2026-07-02). Updated by reviewers as part of every permission change. (Schema-only migrations 104–165 carry no permission rows; the per-collection posture for the finance-batch collections — 138–147 — is in the dated history below.)

> **2026-08-13 — Staged FIVB player index (migration 313): one new collection, four grant rows.** New `vis_players` collection — the VIS player index for the ~28 federations our members claim as federation of origin, mirrored so the transfer worklist's matching is answerable after the fact instead of only re-runnable. **Four permission rows change** (create/read/update/delete): `vis_players` joins `KSCW Sport Admin`'s **full-CRUD** list beside `vis_transfers` / `vis_federations` (same tier, same reason — `/admin/transfers` is gated to `admin | superuser | vb_admin | bb_admin`, the first two bypass policies and the sport admins do not, so without the grant the page degrades for exactly the people it is built for). **No Member, Leader, Vorstand or Terminplanung grant**, and none is defensible: these are names of people who are not our members, carried solely to resolve our own players against a federation register. ⚠ It is a read-only mirror *in practice* — written by the `vis_player_check` cron and its on-demand endpoint, never by the UI — but the grant is **CRUD, not read**, because it rides the same Sport Admin list as its two siblings (which carry the same shape for the same reason: `sv_vm_check` already does). Least privilege would argue for a read-only row; consistency won, and the blast radius is genuinely small because every run **fully replaces** the table, so a stray hand-edit survives at most until the next sync and a federation nobody claims any more cannot linger. The footprint is deliberately the minimum the upstream request already returns: VIS player number + first/last name + which federation listed them. **No birthdate, no club, no contact detail** — the `GetPlayerList` call asks for `Properties="No"` plus `FirstName LastName`, and the table cannot hold more than that. This changes RETENTION, not exposure: every one of these rows was already downloaded on every run and discarded. `setup-permissions.mjs` §9 Sport Admin.
>
> **2026-08-13 — Kantonsschule is member-writable and own-readable (migration 315).** `members` gains `kantonsschule` — which Zurich Mittelschule the member attends; `'Nein'` is the stored "asked, and not at one", `NULL` is "never asked". **One permission row changes**: it joins `MEMBER_EDITABLE_FIELDS`, which folds it into `MEMBER_OWN_READABLE`, so a member sets and sees their own answer on Options → Profile. That is the opposite call from `licence_status` and the register triple above, and for the opposite reason: those record a club judgement ABOUT a member, whereas this is a plain fact the member is the only reliable source for — and ~681 of ~711 members are blank because they joined before the signup form asked, so self-service is the only realistic way to fill it in. ⚠ Without the own-READ half the field would render permanently empty on the member's own profile — Directus strips a column that is writable but not readable, and the member would overwrite their own saved answer with a blank on the next save. ⚠ Deliberately **NOT** in `MEMBER_VISIBLE_FIELDS` and **not** unioned into `LEADER_TEAM_MEMBER_FIELDS`: which school somebody attends is neither published to all ~700 members nor a sporting credential a coach needs, and it sits in the same PII tier as `adresse`. Admin write needs no new grant — `/admin/explore` is **AdminRoute**-gated and **KSCW Sport Admin already holds `members` read + update with fields = `*`** (§9); **Vorstand** reads `members` unfiltered and still carries no `members.update` row, the same asymmetry as every entry above. ⚠ Unlike its neighbours in the profile's ClubDesk block, this column is **not a ClubDesk field at all** (the register has no cell for it), so there is no push contract and no sync-down overwrite to reason about — wiedisync owns it outright, and it must never enter the `/clubdesk-update` diff. `setup-permissions.mjs` §Member field lists.

> **2026-08-10 — The register triple is own-readable, never member-written (migration 302); `otn_bb` retired (migration 303).** `members` gains `register_status` (ClubDesk's 7-value picklist verbatim, CHECK-enforced), `eintritt` and `austritt`. **Two permission rows change.** All three join `MEMBER_DERIVED_READ_FIELDS` — folded into `MEMBER_OWN_READABLE`, so a member can see whether the club still counts them as a member and since when — and **none** joins `MEMBER_EDITABLE_FIELDS`: same subject-not-author split as `licence_status` above and the `transfer_*` columns, and here it is the sharper one, because a member who could set their own `register_status` could re-admit themselves to the club. `FINANCE_MEMBER_FIELDS` gains all three (read only, not in `FINANCE_MEMBER_BILLING_FIELDS`): whether somebody is a member, and for how much of the season, is the first input to whether they owe a Mitgliederbeitrag at all. ⚠ Deliberately **NOT** in `MEMBER_VISIBLE_FIELDS` — that list is what every member reads about every other member, and club-wide it would publish who is an Ehrenmitglied and who resigned when, to all ~700. The write surface needs no new grant: `/admin/explore` is **AdminRoute**-gated and **KSCW Sport Admin already holds `members` read + update with fields = `*`** (§9); **Vorstand** reads `members` unfiltered and still carries no `members.update` row, the same asymmetry as the two entries above. ⚠ These are the first columns whose wiedisync value can OVERWRITE ClubDesk's own authoritative cells on a sync-up push — the narrowing that keeps that safe is not a permission but a push rule (a cell rides only when the member's `clubdesk_push_changes` names that exact field), documented in `clubdesk-update.js → CD_REGISTER_FIELDS`. Separately, **`otn_bb` was dropped** and removed from `MEMBER_VISIBLE_FIELDS` + `MEMBER_EDITABLE_FIELDS`; prod-verified redundant first (all 8 holders carry `otn2_bb`, no stored audience referenced it). `setup-permissions.mjs` §Member field lists + §Finance.
>
> **2026-08-10 — Licence status is staff-written and own-readable (migration 301).** `members` gains `licence_status` (`none | to_be_ordered | ordered | finalized | licenced`, NOT NULL DEFAULT `'none'`, CHECK-enforced), `licence_status_season` (`"2026/27"`), `licence_status_updated_at` and `licence_status_by_name`. **One permission row changes**: all four join a new `MEMBER_LICENCE_STATUS_READ_FIELDS` list that is folded into `MEMBER_OWN_READABLE`, so a member reads where their own licence stands on their profile — and **nothing** joins `MEMBER_EDITABLE_FIELDS`. That asymmetry is the design: the member is the *subject* of the fact, not its author, and a member who could set their own status to `licenced` would be self-asserting the one thing the club exists to verify, with a coach fielding them on the strength of it. Same split as the `transfer_*` columns above, and enforced the same way — a startup guard in `setup-permissions.mjs` throws if any of the four ever appears in `MEMBER_EDITABLE_FIELDS` or `MEMBER_VISIBLE_FIELDS`. The three write surfaces need no new grant: `/admin/explore` and `/admin/anmeldungen` are both **AdminRoute**-gated (`admin | superuser | vb_admin | bb_admin`) and **KSCW Sport Admin already holds `members` read + update with fields = `*`** (§9); the sweep (`POST /kscw/admin/licence-status/sync`, daily 05:45 UTC) runs in system context. ⚠ Deliberately **NOT** in `MEMBER_VISIBLE_FIELDS` and **not** unioned into `LEADER_TEAM_MEMBER_FIELDS`: club-wide, every member reading every other member's ordering state is workflow chatter rather than a sporting credential like `scorer_vb`. Coaches and team responsibles are a defensible fourth audience — a coach picking a squad has a real need to know who is not licensed yet, and they already read `licence_activated` / `licence_validated` club-wide — but that widening was not requested and is left as a one-line change (union the list into `LEADER_TEAM_MEMBER_FIELDS`). **Vorstand** reads `members` unfiltered so a board member sees all four in the Data Explorer, and still carries no `members.update` row — same asymmetry as the transfer columns, harmless because the board is not on either page's gate. `setup-permissions.mjs` §Member field lists.

> **2026-08-08 — Sport Admin: the hook layer now agrees with the policy layer (roster/staff scope), + basketball settings grants.** Two halves of one bug, found in the error log. **(1) Grants.** `KSCW Sport Admin` gains **`basketball_team_rules`** (full CRUD, into `SPORT_ADMIN_FULL_CRUD`) and **`basketplan_clubs`** (read + update, no create/delete — the registry is scraped, only its contact block is hand-maintained). Both shipped with migrations 278/279 into the **KSCW Terminplanung** policy only, and that policy rides on `is_spielplaner`, which a bb_admin does not hold — so `/admin/terminplanung/basketball/settings`, a page gated to basketball admins, 403'd on load for exactly the people it was built for. Same tier as `basketball_slot_plan` / `basketball_hall_availability` / `team_links` beside them; `basketplan_clubs` update matches the shape Sport Admin already holds on `game_scheduling_opponents`, the other third-party contact table. **(2) No policy change, but read this before auditing the LEADER guards.** `member_teams`, `teams_coaches`, `teams_responsibles`, `fines`, `scheduling_blocks`, `participations` and `absences` are all club-wide CRUD for Sport Admin **at the policy layer**, and always were — but the `kscw-hooks` scope filters that back them (`actorLeadsTeam`, the `member_teams.items.delete` guard, `assertFineTeamScope`, `assertCreateOwnership`, the `scheduling_blocks.items.create` guard) recognised only *coach / TR of that team* or `accountability.admin`. A sport admin is neither, so every such write died in the hook even though the policy allowed it and the UI offered it (`hasAdminAccessToTeam`). The guards now treat **a sport admin as leading every team of their OWN sport** — `actorIsSportAdminForTeam`, sport-matched against `teams.sport`, so a bb_admin still gets no volleyball roster and a team with no sport matches nobody. `allowLeader: false` collections (`poll_votes`, `push_subscriptions`, `team_requests`, `scorer_delegations`) stay strictly self-only. ⚠ The reason this went unnoticed for so long is worth keeping: `kscwScopeError` did not set `name = 'DirectusError'`, so Directus answered every scope denial with a blanket 500 "An unexpected error occurred." — **except for callers with `accountability.admin`, who saw the real message**. Every guard therefore read correctly in admin testing and was unexplained in the field. Fixed in the same change, which makes all ~25 scope messages reach the user with their intended 403. `setup-permissions.mjs` §9 Sport Admin; `kscw-hooks/src/index.js`.

> **2026-08-06 — Member hard delete: NO policy change.** The Data Explorer's danger zone (`/admin/explore` → member detail, bottom block) can permanently delete a member, and `KSCW Sport Admin` still holds **no `members.delete` and no `teams.delete`** (migration 027 posture unchanged). A bare `DELETE /items/members/:id` therefore answers 403 for every sport admin, which is the point: the whole gate lives in **`POST /kscw/admin/delete-member`** and there must be no items-API detour around it. That endpoint checks, in order — **(1) role** (`admin | superuser | vb_admin | bb_admin`, the `stats.js` gate); **(2) sport scope**, so a pure `vb_admin` deleting a member who resolves to basketball gets `403 scope` (teams via `member_teams` ∪ `teams_coaches` ∪ `teams_responsibles` → `teams.sport`, then `sektion`, then the `VB `/`BB ` fee-category prefix; club-level/unknown resolves to *both* and is allowed); **(3) rank**, so nobody deletes their own member row (`403 self`) and only a full admin may delete a target holding `admin`/`superuser`/`vorstand`/`vb_admin`/`bb_admin`/`finance` (`403 privileged`) — deleting the row takes that person's login with it, so a sport admin doing it to a board member is an account takedown of someone who outranks them. Only then does it delete, via `ItemsService` built with the **caller's identity and escalated permissions** (`{ ...req.accountability, admin: true }`) — the escalation is what lets the grant stay withheld, and `accountability.user` is preserved so Directus files its own activity/revision trail against the real actor on top of the endpoint's `writeUserLog` entry. The **same sport check guards the read-only preview** `GET /kscw/admin/delete-impact/:collection/:id`, which names the target's linked `directus_users` login. In the UI the button is unreachable without the preview: it counts every dependent row across the ~70 inbound foreign keys plus the polymorphic `participations` / `notifications` / activity-chat rows, splits them into CASCADE / SET NULL / RESTRICT, stays **disabled** while the preview is loading, failed or reports a blocker, and then requires a case-sensitive typed `DELETE`. The `system@kscw.ch` messaging sentinel (member 470) stays undeletable — `trg_messaging_protect_sentinel` is invisible to an FK scan, so the preview reports it as an explicit blocker. Events / trainings / games delete through the ordinary items API (Sport Admin already holds full CRUD on all three) behind the same preview + typed gate. Verification query 3 below asserts the truth: **members and teams both have create/read/update and no delete row**.

> **2026-08-05 — Role→policy reconcile (§3b) + basketball prep opened to Spielplaner.** Two changes in `setup-permissions.mjs`, no migration. **(1) `attachPolicyToRole` only ever ADDED**, so nothing pruned a grant made by hand in the Directus admin UI — prod (and its dev clone) carried a **`Sport Admin → KSCW Admin` row (`admin_access = true`, created 2026-03-29)** that silently made every vb_admin / bb_admin a full Directus **superadmin**, plus ~49 duplicate rows per (role, policy) accreted by pre-2026-06 runs. Section 3 is now declarative in both directions: `DECLARED_ROLE_POLICIES` is the whole truth for ROLE-level `directus_access`, and the new **§3b reconcile** revokes anything else and dedups repeats to one row. Rails: user-level rows are never touched (that is §10/§12/§13/§14's job); the **public** row is skipped by pinning `role _nnull` *and* `user _null` (a bare `user IS NULL` filter would delete the public policy attachment and kill every anonymous read); the **Administrator** role is hard-protected (`PROTECTED_ROLES`) because Directus owns its built-in policy; roles the script does not model (custom "Website Admin") are reported, never pruned; undeclared revocations are capped at `RECONCILE_MAX_DELETES` (25); `--reconcile-dry-run` reports and deletes nothing. First live run revokes 6 rows — the Sport Admin escalation, plus 5 redundant Superuser attachments (`KSCW Member` / `Team Responsible` / `Vorstand` / `Sport Admin` / `Website_admin`, all no-ops under `admin_access`) — and dedups ~432. **(2)** `basketball_slot_plan`, `basketball_hall_availability` and `team_links` were **Sport-Admin-only**, but the basketball scheduling routes now gate on `is_spielplaner` like the volleyball ones — a Spielplaner opening `/basketball/prep` loaded an empty grid and 403'd on every write. They are granted to **KSCW Terminplanung** (the policy `is_spielplaner` already attaches, so the gate and the grant are the same people by construction), scoped to what the pages actually do — see the new "KSCW Terminplanung" section below. `setup-permissions.mjs` §3/§3b + §9b; see SECURITY.md "2026-08-05".

> **2026-08-01 — Game guest invitations (migration 271).** Two new collections let a coach open one fixture to another team (`game_guest_teams`) or to named individuals, materialized per-person into `game_guests` by trigger. **Member** gets READ only, scoped to the three parties with a stake in the invitation — the invitee (`member.user = $CURRENT_USER`), the game's own roster (`game.kscw_team.members.member.user`), and the other guests (`game.guests.member.user`, since they land in one merged roster and must resolve each other). **LEADER** gets read + create/update/delete scoped to `game.kscw_team.{coach,team_responsible}` — the game's OWN team, deliberately not the invited team's coach, so `game_guests.invited_by_*` stays an answerable record of who called a player up. CREATE is necessarily unfiltered (Directus cannot resolve a relational validation against a create payload); the real scope gate is the BLOCKING `game_guests.items.create` / `game_guest_teams.items.create` guard in kscw-hooks, the same arrangement `member_teams` already uses. Sport Admin gets club-wide CRUD; Vorstand read-all.
>
> ⚠ **The `participations` read rules changed on BOTH sides, and this is the part to review.** A guest shares no `member_teams` row with the team whose game they play, so the existing `SAME_TEAM_AS_ME` rule left the roster half-blind in both directions: the home team could not read the guest's RSVP, and the guest could not read the home team's. Member read gains two `_or` branches (`SAME_GAME_AS_ME`) and LEADER's `COACH_OR_TR_OF_PARTICIPATION` gains one. **Every new branch is `_and`-ed with `activity_type = 'game'`** — being lent a player for one Saturday must not open their trainings and events to the borrowing team. Breadth is otherwise the same shape as `SAME_TEAM_AS_ME` itself (all of that person's game RSVPs, not row-correlated per fixture), because a Directus filter cannot join `participations.activity_id` — a varchar, not an FK — back to `games`. `absences` deliberately stays on the narrow rule: the roster needs the guest's answer, not their reason. Three metadata-only o2m aliases (`games.guests`, `members.game_guests`, `teams.games`, migration 271 §7) exist solely to make these filters expressible — same device as migrations 032/033. `setup-permissions.mjs` §Member team-scoped reads + §7 Leader + §8 Vorstand + §9 Sport Admin.

> **2026-07-25 — International-transfer workflow columns are STAFF-ONLY (migrations 234/235).** `members` gains `transfer_status` (`NULL | 'pending' | 'done'`), `transfer_done_at`, `transfer_done_by_name` and `transfer_note`, written from the new `/admin/transfers` page. **No permission row changed** and that is the point: these four columns are deliberately absent from `MEMBER_VISIBLE_FIELDS` *and* `MEMBER_EDITABLE_FIELDS`. They hold a staff judgement **about** a member rather than the member's own data — an own-profile write would let a member mark their own international transfer done, which is exactly the fact the club must be able to trust, and it is a record of what an administrator did rather than a property of the member. Because `MEMBER_OWN_READABLE` and `LEADER_TEAM_MEMBER_FIELDS` are both DERIVED from those two lists, staying out of them also keeps the columns away from own-read and from coaches / team responsibles. The page's audience needs nothing new: `/admin/transfers` is **AdminRoute**-gated (`admin | superuser | vb_admin | bb_admin`) and **KSCW Sport Admin already holds `members` read + update with fields = `*`** (§9), while full admins bypass policies — the gate and the grant line up exactly, so nobody can reach a page whose toggles would 403. ⚠ **Vorstand is the asymmetry worth knowing**: it reads `members` unfiltered (a board member can SEE these columns via the Data Explorer) but carries **no `members.update` row at all** — the same gap that already makes billing edit read-only for a pure board member (see the Finance section). The board is not on this page's gate, so nothing is broken today; if `/admin/transfers` is ever widened to `VorstandRoute`, a `members.update` grant field-scoped to the four `transfer_*` columns must ship in the same change or every toggle 403s. The new `MEMBER_STAFF_ONLY_FIELDS` list in `setup-permissions.mjs` exists purely to ENFORCE the exclusion — a startup guard throws if any of the four ever appears in the member-visible / member-editable / member-derived lists, so the rule is checked on every deploy instead of remembered. `sv_vm_check` (the licence-validation cross-check the page reads for volleyball) needs no change either: Member read is REVOKED and Sport Admin+ already hold full CRUD. Permission-doc change only — no permission rows, no `directus_permissions` diff; `setup-permissions.mjs` §Member field lists + §9 Sport Admin comment.
>
> **2026-07-25 — Coded nationality + federation of origin (migrations 223/224); `members.nationalitaet` becomes read-only.** Nationality is now stored as `members.nationalitaet_codes` — an ordered, comma-separated ISO 3166-1 alpha-2 list (`"CH,IT"`, first code primary) — alongside the new `members.federation_of_origin` (alpha-2, the literal `'NONE'` for "never licensed elsewhere", or `NULL` for "not answered" — the distinction is what lets us skip a transfer-certificate chase). Both joined `MEMBER_EDITABLE_FIELDS` (own-profile write), so they are automatically own-readable via `MEMBER_OWN_READABLE` and team-readable via `LEADER_TEAM_MEMBER_FIELDS`, which both derive from that list. The legacy free-text `nationalitaet` was **removed** from `MEMBER_EDITABLE_FIELDS`: migration 223's `members_sync_nationality_trg` now derives it from the first code (the German name ClubDesk's picklist matches on), so a member write would be silently overwritten and drift the two apart in the meantime. ⚠ Removing a column from `MEMBER_EDITABLE_FIELDS` also removes it from own-read and leader-read, so `nationalitaet` moved into a new `MEMBER_DERIVED_READ_FIELDS` list that is folded into both — **not** into `MEMBER_VISIBLE_FIELDS`. That list is what EVERY member reads about EVERY other member, and nationality sits in the same PII tier as `adresse` / `birthdate`, which migration 024 deliberately excludes from it; it was never club-wide readable and must not become so as a side effect of losing its write grant. `FINANCE_MEMBER_FIELDS` gains both new columns for parity with the `nationalitaet` it already read. New PII, so all three columns were added to the `REDACTED_FIELDS.members` value-redaction set in `kscw-hooks/src/audit.js`. Use `MEMBER_DERIVED_READ_FIELDS` for any future column the DB owns but the member must still see. Permission-only change on top of migrations 223/224 — `setup-permissions.mjs` §Member + §Leader + §Finance.
>
> **2026-07-15 — Basketball hall availability (migration 214).** New `basketball_hall_availability` collection (per basketball team, per candidate home date: `unavailable` + `windows` jsonb) backing the ProBasket "Basketball prep" view. Granted **Sport Admin full CRUD only** — added to `SPORT_ADMIN_FULL_CRUD` in `setup-permissions.mjs`, which covers both vb & bb admins at the items layer; the page is UI-scoped to basketball admins via `hasAdminAccessToSport('basketball')` (the established "club-wide CRUD + UI-scoped" pattern, cf. `vb_referee_duty`). No Member / Vorstand / Spielplaner grant — basketball scheduling is admin-only, and unlike volleyball there is no opponent/token/booking flow (ProBasket owns the schedule). Writes go through the Directus items API (auto actor-log), no custom endpoint. Permission-only change — no migration rows; `setup-permissions.mjs` §9 Sport Admin. ⚠ **Superseded 2026-08-05** for the Spielplaner half: the basketball routes now gate on `is_spielplaner` like the volleyball ones, so `basketball_hall_availability` + `basketball_slot_plan` + `team_links` are also granted to **KSCW Terminplanung** (see the 2026-08-05 note at the top and the KSCW Terminplanung section). Still no Member / Vorstand grant.
>
> **2026-07-13 — Volleymanager auto-nomination: coach opt-in writable, push journal read-only (migration 206).** Migration 206 adds six columns to `games`: the per-game opt-in `auto_nomination_list` (nullable — null = inherit `teams.features_enabled.auto_nomination_list`, same idiom as `auto_confirm_rsvp`) plus the five-column push journal `vm_nomination_status` / `_list_id` / `_count` / `_pushed_at` / `_error`, written **only** by the backend Einsatzliste cron. **READ** of all six needed no new grant — Member already reads `games` club-wide with fields `*`, and every tier stacks the Member policy — so no frontend filter/sort on these can trip the "filter on an unreadable field 403s the whole query" trap (cf. the `wiedisync_active` incident below). **WRITE** did: the LEADER (`games.update`) and Spielplaner (`games.create`/`update`) grants both took the `fields = ['*']` default, which would have made the journal coach-writable — and since the cron only re-attempts games whose status is not `closed`/`skipped`, a coach PATCHing `vm_nomination_status = 'closed'` could silently suppress their own team's VM push (a forged `vm_nomination_error` would likewise fake a failure in the game modal). Both grants are now field-scoped to the new `GAME_WRITE_FIELDS` = every `games` column **except** those five, so coaches keep every write they had (scores, duties, `auto_confirm_rsvp`) and gain the `auto_nomination_list` toggle, while the journal is read-only outside the cron (which runs with admin credentials and bypasses policies). Spielplaner had to be scoped too, not just LEADER: Directus **unions** the permission rows of every policy a user holds for the same collection+action, so a `['*']` left on Spielplaner would hand the journal straight back to any coach who is also a spielplaner. Behaviour-neutral for existing flows — `GAME_WRITE_FIELDS` is a strict superset of what `GameDetailModal` / `GameDetailDrawer` / `ScorerAssignPage` / `buildManualGamePayload` / the import panels write (all flat real columns, no relational aliases). Public `games` read is unchanged: the ops columns stay out of `PUBLIC_GAME_FIELDS`, exactly as `auto_confirm_rsvp` already did. ⚠ A new `games` column a coach must write MUST be added to `GAME_WRITE_FIELDS` or their PATCH 403s; a new backend-owned column must stay out. Permission-only change — no migration rows, `setup-permissions.mjs` §7 + §9d.

> **2026-07-04 — Registration-document folder locked down + upload endpoint (no migration).** Member `directus_files` read `_nin` now also excludes the private registration folder (`a0000167-…`, migration 169) — it holds government-ID scans + Swiss Basketball licence/declaration docs, and any logged-in member could previously enumerate + download them via `/assets` (2026-07-04 review of the doc-enforcement diff). Reviewers keep access: **Sport Admin** via its unfiltered `directus_files` CRUD, **Vorstand** via a new folder-scoped read (same pattern as the finance folder). The public form no longer uses the anon core `POST /files` for documents — the new public `POST /kscw/registration/upload` streams the file server-side into the private folder (MIME/size-checked, per-IP-limited), so registration docs are born private; a nightly kscw-hooks sweep deletes week-old unreferenced orphans in that folder. See SECURITY.md "2026-07-04".

> **2026-07-03 — KSCW Spielplaner policy (manual-game writes, no migration).** New orthogonal per-user `KSCW Spielplaner` policy granting `games` create / update / delete, every grant scoped to `source = 'manual'` (fields `*`): update/delete via a `permissions` row filter, create via a scalar `validation` on the payload (the only CREATE-enforceable form) — so VM-synced league games stay Sport-Admin-only even via the raw items API. Fixes the planner 403: `ManualGameModal` / `SpielplanungPage` write `games` via the items API, but the only `games` create/delete rows lived on KSCW Sport Admin — so the real (non-admin) spielplaners couldn't create manual games the UI offers. Attached per-user via `directus_access` to members with `is_spielplaner = true` OR ≥1 `spielplaner_assignments` row, reconciled on every deploy by `setup-permissions.mjs §14` (attach + stale revoke, same pattern as Terminplanung §12). Per-TEAM scope is deliberately NOT at the policy layer (unenforceable on CREATE, and a `kscw_team` filter would lock out club-wide spielplaners) — it's enforced by the kscw-hooks Spielplaner scope guard on `games.items.create/update/delete`. See the "KSCW Spielplaner" section below.

> **2026-07-02 — Deep-review remediation (poll anonymity + scorer-delegation lockdown).** (1) Member `scorer_delegations.update` narrowed from all-fields to `fields:['status']` — the recipient's accept is the only legitimate item-API mutation; the identity columns (`from_member`/`to_member`/`game`/`role`/`to_team`) are now DB-immutable on UPDATE (migration 163). Closes a duty-hijack that bypassed the LEADER-only `games.update`. (2) `poll_votes` identity reads for **LEADER**, **Vorstand**, and **Sport Admin** are now scoped to `poll.anonymous = false` — anonymity was previously UI-only. Managers get anonymous-poll results as identity-free counts via `GET /kscw/polls/:id/results` (manager-gated endpoint). Sport Admin keeps create/update/delete on `poll_votes` for oversight. Full Directus admins still bypass all filters by design. See SECURITY.md "2026-07-02".

> Migrations 104–111 (2026-06-10..06-15) are all schema-only — they carry no permission rows and add no plpgsql functions needing `search_path`, so this doc's role tables are unchanged by them; only the version anchor moved. The Forms permission surface (migrations 086–089) is documented in the role tables below.

> **2026-07-13 — `members.wiedisync_active` added to `MEMBER_VISIBLE_FIELDS` (fixes the empty event-invite picker).** `wiedisync_active` was readable ONLY by the finance policy. `MemberMultiSelect` — the invite picker inside `EventForm` — queries `members` **unfiltered** with `filter: { wiedisync_active: { _eq: true } }`, and Directus rejects a *filter* on a field the caller cannot read. Because that query is club-wide it resolves against `MEMBER_POLICY` (i.e. `MEMBER_VISIBLE_FIELDS`), **not** the team-scoped LEADER read — so every coach/TR who opened the event form got a 403 and a silently **empty** invite list (they never saw an error; the list was just blank). Note `useAuth` folds team-responsible teams into `coachTeamIds`, so TRs hit this too. The field is a plain activation boolean, no PII, so it joins the club-wide visible list. Symptom trail: prod `errors-*.jsonl`, `page: /events`, `"You don't have permission to access field \"wiedisync_active\""`, first seen 2026-07-12 (when the field entered wider frontend use). Permission-only change — no migration, no code change.

> **2026-06-10 — Deep-audit remediation (Public `events` row-scope + doc-drift corrections).** Public `events` read was field-restricted but **NOT row-restricted** (filter `null`), so anon could read every event's title via `/items/events` — including team-internal events. Scoped to club-wide types `{ event_type: { _in: ['verein', 'tournament'] } }`, mirroring the Member `EVENTS_VISIBLE` club-wide branch (the `/kscw/public/events` endpoint still additionally excludes any team-/member-scoped event). Also corrected several rows where this doc had drifted from the authoritative `setup-permissions.mjs` (the script is canonical; the doc lied): `sv_vm_check` Member direct read is **REVOKED** (access via `/kscw/sv-licence/me`, not `OWN_MEMBER`); public `directus_files` read is `folder _null` (the `PUBLIC_FILES_FOLDER` env approach was dropped, no env/fallback); `member_teams` Member read returns `*` incl. `guest_level` (not the claimed `id, member, team, season`); `event_sessions` Member read is unfiltered cross-club (in `MEMBER_READ_ALL`, not `EVENTS_VISIBLE`-scoped); LEADER `absences` read is the coach/TR-team scope (not "none"); LEADER `user_logs` read is **REVOKED** (not granted). Three schema-only migrations shipped alongside (no perm rows): **100** pins `search_path = public` on `members_prevent_email_blanking` / `trg_form_submissions_guard` / `trg_form_submissions_update_guard` (regressed the 071 hardening); **101** guards the implicit `varchar→int` cast in `trg_participations_guest_block` (a non-numeric `activity_id` silently skipped the guest block); **102** un-confirms a derby (`game_scheduling_derbies`) whose host team is deleted (the FK's `ON DELETE SET NULL` would otherwise leave `confirmed=true` with a null host, breaking Art. 27 clamping). See SECURITY.md "2026-06-10" block.

> **2026-07-27 — Features retired (migration 257).** `tasks`/`task_templates`, `carpools`/`carpool_passengers` and `query_templates` were dropped after a full season of zero use (DB-review finding deadweight-03; product decision). All their grants were removed from `setup-permissions.mjs`; rows referencing them below are gone. Kept deliberately: `fines`/`fine_rules`, `slot_claims`, `referee_expenses`, `broadcasts`.

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

**The role → policy attachments above are the complete declared set** (`DECLARED_ROLE_POLICIES`, `setup-permissions.mjs` §3). Since 2026-08-05 the **§3b reconcile** deletes every role-level `directus_access` row that is not in that list and dedups repeats to one row per pair, so the table is enforced rather than merely documented. Adding a line grants a tier; **removing a line revokes it on the next `db:setup-perms` run.** Note in particular that `Sport Admin` must NEVER hold `KSCW Admin` — that exact row existed on prod and made every sport admin a Directus superadmin. Never touched by the reconcile: user-level rows (the orthogonal policies below), the Public row, the `Administrator` role, and roles this script does not model. Run with `--reconcile-dry-run` to see what it would delete without deleting it.

**Orthogonal policies** — attached per-user via `directus_access` (NOT base roles), layered on top of whatever base role the user holds:
- `KSCW Terminplanung` — members with `is_spielplaner = true` (game-scheduling + basketball prep; see its own section below).
- `KSCW Spielplaner` — members with `is_spielplaner = true` OR at least one `spielplaner_assignments` row (per-team spielplaners). Manual-game create/update/delete in the Spielplanung planner, scoped to `source = 'manual'` at the policy layer; team scope is hook-enforced (kscw-hooks games guard). Reconciled by `setup-permissions.mjs §14` on every deploy.
- `KSCW Finance` — members with the `finance` app-role (treasurer / finance team). Reconciled by the role-sync hook on `members.role` change + `setup-permissions.mjs §13` on every deploy.

---

## Filter shorthand

Used throughout — repeated literally rather than via subqueries because Directus stores filters as inline JSON.

| Name | Filter | Usage |
|---|---|---|
| `OWN_USER` | `{ user: { _eq: '$CURRENT_USER' } }` | members directly |
| `OWN_MEMBER` | `{ member: { user: { _eq: '$CURRENT_USER' } } }` | rows with `member` FK |
| `OWN_DU` | `{ user: { user: { _eq: '$CURRENT_USER' } } }` | `user_logs` (int FK to members) |
| `MY_TEAMS` | `{ team: { active: true, members: { member: { user: ... } } } }` | trainings, anything team-scoped |
| `EVENTS_VISIBLE` | `_or` of own / club-wide / my-**active**-teams / invited-members | events, event_sessions, events_members |
| `SAME_TEAM_AS_ME` | `_or` of own member + member-on-same-**active**-team | participations, absences |
| `OWN_DELEGATION` | `{ _or: [{ from_member.user }, { to_member.user }] }` | scorer_delegations |

---

## Public (unauthenticated)

| Collection | Action | Filter | Notes |
|---|---|---|---|
| teams | read | `active = true` | Limited fields (`PUBLIC_TEAM_FIELDS`). 2026-07-03: added `waitlist_url` + `waitlist_label` (non-PII public Google-Form link + button label) so the website contact form + basketball youth page detect "full" teams and route to the waiting list instead of emailing the coach/youth coordinator. |
| games | read | none | Limited fields (`PUBLIC_GAME_FIELDS`). Internal ops columns stay out: duty assignments, `auto_confirm_rsvp`, and (migration 206) `auto_nomination_list` + the `vm_nomination_*` journal |
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
| hall_events | read | none | (the `hall_events_halls` junction was dropped in migration 252 — never populated) |
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
| members | none | `MEMBER_VISIBLE_FIELDS` (no `email`/`phone`; incl. `wiedisync_active` since 2026-07-13 — see note below) | 024 |
| members | `OWN_USER` | `MEMBER_OWN_READABLE` (incl. PII + 029 messaging fields + 030 + 042 + read-only `is_spielplaner` so the frontend nav can gate the Spielplanung/Terminplanung links on it) | 029, 030, 042 |
| trainings | `MY_TEAMS` | `*` | 032 |
| events | `EVENTS_VISIBLE` | `*` | 033 |
| event_sessions | none (unfiltered, cross-club) | `*` | 036 — in `MEMBER_READ_ALL`, NOT `EVENTS_VISIBLE`-scoped (drift fixed in doc 2026-06-10). Session rows carry no PII; the parent `events` read IS `EVENTS_VISIBLE`-scoped |
| events_members | events `EVENTS_VISIBLE` | `*` | 036 |
| participations | `SAME_TEAM_AS_ME` | `MEMBER_PARTICIPATION_FIELDS` (all except the `last_*_edited_by` directus_users UUIDs — 2026-05-12 audit #12; incl. `auto_declined_by_game` since migration 261) | 033 |
| absences | `SAME_TEAM_AS_ME` | `*` | 033 |
| sv_vm_check | **REVOKED** (no direct Member read) | — | Direct read removed (closes the 2026-05-06 Critical). Members get their own licence via `GET /kscw/sv-licence/me` (joins by `license_nr`, returns 11 safe fields). The absence is intentional — a row filter would trip Directus 11's `CASE WHEN 1` SQL bug. Sport Admin+ retain full CRUD |
| feedback | `email = $CURRENT_USER.email` | `*` | **043** |
| member_teams | none (read); `OWN_MEMBER` (delete) | `*` (incl. `guest_level`) | **043**; delete added 2026-05-26 (self-service leave-team). Doc drift fixed 2026-06-10 — the live script grants an unfiltered, all-fields read (`setPermRead(MEMBER_POLICY, 'member_teams')`), NOT the restricted `id, member, team, season` set; `guest_level` IS returned (the whole-club roster relies on it) |
| blocks | `blocker.user = $CURRENT_USER` | `*` | 042 |
| messages | `conversation.members.{member.user = $CURRENT_USER, archived = false}` | `id, conversation, sender, type, body, poll, created_at, edited_at, deleted_at` — **`original_body` withheld** (pre-edit text, moderation only) | Added 2026-07-13. **Read-only, and it exists solely so realtime can deliver.** Directus does not push the mutation row to subscribers: it RE-READS the row with the *subscriber's* accountability (`websocket/utils/items.ts → getItemsPayload`), so with no read grant the socket subscribes and stays permanently silent — live chat is impossible without this row. Filter is migration 023's, plus `archived = false` to MIRROR the endpoint (`loadConversationMembership`, messaging-helpers.js:78, 403s on an archived membership) — without it the items API would be *more* permissive than the endpoint it mirrors, and 1336/1439 prod membership rows are archived. Grants no data `/kscw/messaging/*` doesn't already return; writes stay endpoint-only. ⚠ Never add a frontend items-API filter that also walks `conversation.members` — Directus cannot AND two filters through the same M2M junction and silently returns `[]` for non-admins |
| message_reactions | `message.conversation.members.{member.user = $CURRENT_USER, archived = false}` | `id, message, member, emoji, created_at` | Added 2026-07-13, same rationale as `messages` (useReactions subscribes to it) |
| conversations | **REVOKED** (no direct Member read) | — | Deliberate, see SECURITY.md:143 — the inbox uses `GET /kscw/messaging/conversations`, which the smoke test probes. Conversation-list updates piggyback on the `messages` subscription; granting `messages` did NOT require granting this |
| spielplaner_assignments | `OWN_MEMBER` | `*` | 034, 042 |
| user_logs | `OWN_DU` (note traversal!) | `*` | 4.4.8 fix |
| notifications | `OWN_MEMBER` | `*` | |
| push_subscriptions | `OWN_MEMBER` | `*` | |
| announcements | published + non-expired + **addressed to me** | excludes `audience_teams` / `audience_roles` | 3.11, **219** |
| announcement_recipients | `OWN_MEMBER` | `id, announcement, member` only | **219** |
| polls | `MY_TEAMS` (via team)| `*` | 035 |
| referee_expenses | `MY_TEAMS` (via team) | `*` | 035 |
| fines | `member.user = $CURRENT_USER` | `*` | **069** |
| fine_rules | `team.member_teams.member.user = $CURRENT_USER` | `*` | **069** |
| forms | `FORMS_VISIBLE` — `status _in {open, closed}` AND (`audience = club_wide` OR an attached team I'm a member of). Frontend resolves visibility via the two-step junction fetch (`useUserVisibleFormIds`); the policy walk of `forms.teams` is why the frontend must NOT also deep-filter it (M2M-deep-filter + policy-walk silent-`[]` landmine) | `*` | **086 / 087** |
| forms_teams | none | `*` — junction read for the forms M2M | **086 / 087** |
| form_submissions | `member.user = $CURRENT_USER` (own only) | `*` | **086 / 087** |
| finance_invoices | `member.user = $CURRENT_USER` (own dues only) | `MEMBER_INVOICE_FIELDS` (16 dues cols + `member`; no `source`/`import_batch`/`cd_*`/`recipient_*` mirror plumbing) | **114** |
| finance_expenses | `OWN_MEMBER` (own submissions only) | `*` | **177** — read-only; submit via `POST /kscw/expenses/submit`, status/detail writes via finance-gated `PATCH /kscw/expenses/:id` |

### Reads (intentionally cross-club)

`teams`, `games`, `rankings`, `sponsors`, `event_sessions` (read filtered above), `hall_slots`, `hall_closures`, `hall_events`, `halls`, `hall_slots_teams`, `slot_claims`, `news`, `app_settings`, `teams_coaches`, `teams_responsibles`, `teams_sponsors`, `events_teams`, `events_members`, `directus_files`.

⚠ **`polls` was on this list until 2026-08-10 and is no longer cross-club.** The old in-code justification — "team-scoped by app navigation" — predated chat polls and was never true of them: `POST /kscw/messaging/polls` creates rows with `team: null, conversation: <uuid>` (the DB codifies both parents in `chk_polls_team_or_conversation`), so navigation scoped nothing, and the unfiltered realtime subscription *pushed* every poll created anywhere in the club to every connected member. Any member could `GET /items/polls?filter[conversation][_nnull]=true` and read the question, options, deadline and author of every DM and group-chat poll. That defeated the boundary built for `messages` / `message_reactions` 300 lines later — the poll *message* was scoped and field-limited, while the poll *content* it points at was not. Voter identity was never exposed (`poll_votes` is `OWN_MEMBER`-scoped, `/kscw/polls/:id/results` checks membership); only the question text leaked. Now a two-parent scope reusing `MY_ACTIVE_MEMBERSHIP`, so a chat poll follows exactly the same archived-aware rule as the message carrying it:

```js
{ _or: [
  { team: { members: { member: { user: { _eq: '$CURRENT_USER' } } } } },
  { conversation: { members: MY_ACTIVE_MEMBERSHIP } },
]}
```

**`forms` create/update are hook-guarded, not filter-guarded** (2026-08-10). Directus filters are no-ops on CREATE, so LEADER's `forms.create` is necessarily unfiltered — the same arrangement `member_teams` uses. The compensating `filter('forms.items.create'/'update')` guard in `kscw-hooks` **did not exist** until this date even though `setup-permissions.mjs` documented it as the enforcement point, so a coach could create a `club_wide` + `is_public` form: a notification and web push to every active member (repeatable per form), plus an anonymously submittable page at `/kscw/public/forms/:slug` whose harvested rows they read back via `FORMS_LEADER_SCOPE`. The guard now holds non-managers to `audience: 'teams'`, refuses `is_public`, requires every linked team to be one they lead, and stamps `created_by` server-side (it was client-supplied, and `authorizeManage`'s creator branch authorised on it). Manager tiers — admin/superuser (which bypass filter hooks entirely), vorstand, vb_admin, bb_admin — keep club-wide and public forms.

⚠ **`directus_files` is cross-club but NOT unfiltered — it is a DENY-list**, and that distinction has now cost two findings. The filter is `_or[ folder _null, folder _nin PRIVATE_FOLDERS ]`, where `PRIVATE_FOLDERS` (`setup-permissions.mjs`) is:

| Folder | Holds |
|---|---|
| `f1a0d0c5-…` | finance invoice PDFs |
| `feedbac0-…` | feedback screenshots (can capture an authenticated screen) |
| `a0000167-…` | registration documents — government-ID scans, U18 parent docs |
| `d0c00001-…` | E2EE identity documents |
| `d0c00002-…` | **scorer-exam sheets — added 2026-08-10** |

Because it is a deny-list, **a private folder that nobody remembers to name here is readable by all ~499 members by default.** That is precisely what happened to the scorer-exam folder (`scorer-exam.js` defined it, warned in its own comment that folder-less is publicly readable, and never added it here), leaving 8 candidate-named match sheets and graded corrections member-readable for the folder's whole life — while the parent `scorer_course_attendance` collection was correctly not member-readable. `setup-permissions.mjs` now **fails the deploy** (`assertAllPrivateFoldersDenied`) if a folder constant known to the endpoint code is missing from `PRIVATE_FOLDERS`, so the next one cannot ship silently. When you add a private folder in `kscw-endpoints`, add it to both lists in the same commit.

### Writes

| Collection | Action | Filter |
|---|---|---|
| members | update | `OWN_USER`, fields = `MEMBER_EDITABLE_FIELDS` (excludes `role`, role stripped by hook filter; excludes the trigger-derived `nationalitaet` since 2026-07-25 — see note) |
| participations | create / update | `OWN_MEMBER` (create self-scoped 2026-05-31 audit) |
| absences | create / update / delete | `OWN_MEMBER` (create self-scoped 2026-05-31 audit) |
| notifications | update / delete | own |
| push_subscriptions | create / update / delete | `OWN_MEMBER` (create self-scoped 2026-05-31 audit) |
| scorer_delegations | create / update | create = `from_member = $CURRENT_USER`; update = own (from/to), **fields `['status']` only** (2026-07-02 audit — identity cols DB-immutable via migration 163) |
| user_logs | create | none |
| feedback | create | none |
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
| members | read | scoped to my-team members (`COACH_TEAM_MEMBERS` — coach/TR of the member's **active** team), fields = `LEADER_TEAM_MEMBER_FIELDS` (all visible+editable+derived-read fields **except** `ahv_nummer` and `iban`) | 036, scoped 2026-05-12, `active` gate 2026-08-12 |
| members | update | scoped to my-team members (`COACH_TEAM_MEMBERS`), fields = `position, number, coach_approved_team` | 036, `coach_approved_team` 2026-05-19, `active` gate 2026-08-12 |
| members | update | scoped to my-team signups (`COACH_REQUESTED_TEAM` — coach/TR of the requested team), fields = `kscw_membership_active, wiedisync_active, requested_team` | reject-signup path (`TeamDetail.handleReject`) |
| teams | read | none | |
| teams | read | none | also `LEADER_TEAM_DASHBOARD_FIELDS` |
| teams | update | scoped: `coach.members_id.user = $CURRENT_USER` OR `team_responsible.members_id.user = $CURRENT_USER` | **043** |
| games | update | scoped via teams.coach (mig 026), fields = `GAME_WRITE_FIELDS` (every `games` column **except** the `vm_nomination_*` push journal — read-only, cron-owned; the per-game opt-in `auto_nomination_list` and its sibling `auto_confirm_rsvp` ARE writable) | 026, field-scoped **206** (2026-07-13) |
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
| polls | create / update / delete | scoped via teams.coach | 026 |
| poll_votes | read | votes on **non-anonymous** polls for teams I coach/TR (`poll.anonymous = false` AND `poll.team.coach/team_responsible.members_id.user = $CURRENT_USER`) — per-member answers before the deadline; unions on the member's own-vote read. Anonymous-poll results come from `GET /kscw/polls/:id/results` (counts only). `anonymous = false` scope added 2026-07-02 audit (#5/#14) | **2026-06-28 / 2026-07-02** |
| team_requests | read / update | none | |
| absences | read | own + members on teams I coach/TR | Doc drift fixed 2026-06-10 — read is NOT unfiltered. Scoped to the coach/TR-of-the-target-team filter (`member.member_teams.team.{coach,team_responsible}.members_id.user = $CURRENT_USER`, plus own), same scope as the CUD rows (2026-05-12 audit closed the full-club absence-notes dump) |
| notifications | create | none | |
| announcements | read | published + non-expired + addressed to me (no draft access) | F6 audit, **219** |
| announcement_recipients | read | `OWN_MEMBER`, fields `id, announcement, member` | **219** — the row the announcements read filter walks; without it a targeted post is invisible to its own audience |
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

`members, member_teams, participations, absences, notifications, scorer_delegations, team_invites, user_logs, feedback, poll_votes, team_requests, push_subscriptions, game_scheduling_seasons, game_scheduling_slots, game_scheduling_opponents, game_scheduling_bookings, announcements, announcement_recipients, fines, fine_rules, scheduling_blocks, finance_accounts, finance_fiscal_years, finance_budget_lines, finance_transactions, finance_invoices, finance_payments, finance_imports, finance_invoice_member_overrides`.

**Announcement targeting (migration 219)** — `announcements.audience_type` now supports `teams` and `roles` alongside `all` / `sport`. Members and coaches still cannot read `audience_teams` / `audience_roles` (exposing them would reveal targeting intent), so the read filter cannot match a targeted post client-side. Instead the publish fanout materializes one `announcement_recipients` row per resolved member, and the Member/Leader read filter gates `teams`/`roles` posts on that row (`all` / `sport` keep matching on the announcement itself). `announcement_recipients` is **read-only in every policy** — the fanout writes it in system context, so write access would only allow forging a delivery record. Sport Admin and Vorstand read it unfiltered for delivery oversight (`email_at` / `email_error` answer "who didn't get it").

**Finance (migration 114)** — the `finance_*` collections are the full board finance dashboard (ClubDesk Finanz read-only mirror, Scope A). Vorstand reads all; Members read only their own `finance_invoices` (above). No policy-layer writes.

**Native invoices + member-link overrides (migrations 128/129)** — still **read-only at the policy layer**. Native-invoice writes (create / report-paid / confirm / cancel) and the `finance_invoice_member_overrides` link tool all go through the `/kscw/finance/*` endpoints on the system connection, Vorstand-gated **in code** (so the board can never edit ClubDesk-mirror rows via the items API). Members never get item-API write — their "I've paid" self-report is an endpoint call. `finance_invoice_member_overrides` is Vorstand read-only here for admin visibility/audit.

**Plus full CRUD on Forms** — `forms`, `forms_teams`, `form_submissions` (decision 2026-06-05: create/edit/delete any form club-wide + read all submissions, exactly like a global admin). This is the one exception to the otherwise read-only board role.

**Narrow ClubDesk register read (2026-07-12)** — field-scoped `clubdesk_export` read (`id, clubdesk_id, gruppen_bracketed, offiziellen_lizenz`) so the board's read-only Data Explorer grid shows the passive / honorary / former and officials-licence columns. Same scope as Sport Admin; the rest of the register stays full-admin-only.

Read-only on everything else by design (no CRU writes outside the Forms grant above).

---

## KSCW Finance (orthogonal — `finance` app-role)

Per-user policy (migrations 132/133), attached to members with `finance` in their role array — NOT a base Directus role. Layered on the member's base policy (so a `['finance']` member is a Directus *Member* + this policy). Gives the treasurer / finance team the full club-finance picture without the rest of board-wide access.

| Collection | Action | Filter | Notes |
|---|---|---|---|
| members | read | none (club-wide) | `FINANCE_MEMBER_FIELDS` — contact + `adresse/plz/ort` + `nationalitaet` + `nationalitaet_codes` + `federation_of_origin` + `iban` + `ahv_nummer` + `beitragskategorie` + membership + billing_* + the fee overrides (migrations 299/300). UNION-ed with the member policy's `MEMBER_VISIBLE_FIELDS`, so this only widens finance's view |
| members | update | none (club-wide) | `FINANCE_MEMBER_BILLING_FIELDS` only — the alternate billing contact (migration 133) plus `fee_base_override` / `fee_surcharge_override` / `fee_discount` / `fee_discount_pct` / `fee_discount_reason` (migrations 299/300). Those five decide what a member is invoiced, so they are writable by finance and by nobody below admin — not by a coach, not by a sport admin. No other member field is writable here |
| member_teams | read | none | Team context |
| finance_accounts, finance_fiscal_years, finance_budget_lines, finance_transactions, finance_invoices, finance_payments, finance_imports, finance_invoice_member_overrides, finance_payouts, finance_expenses | read | none | Full club finance read (same set as Vorstand; `finance_payouts` migration 137, `finance_expenses` migration 177 — expense writes only via `PATCH /kscw/expenses/:id`) |
| finance_dues_rates, finance_dues_runs | read | none | Dues-rate table + dues-run history (migration 138). Vorstand + Finance only |
| finance_invoice_documents | create/read/update/delete | none | Invoice PDF attachment links (migration 134). Vorstand gets read |
| directus_files | create | none | Upload invoice PDFs (frontend sets `folder` = the private finance folder) |
| directus_files | read | `folder = <finance folder>` | View the private invoice PDFs via /assets. Folder-less files come via the member policy; members are excluded from THIS folder (read narrowed to `_or[null, ≠finance]`) |

**Writes** — native-invoice create/report-paid/confirm/cancel/link + camt import are NOT item-API; they go through `/kscw/finance/*`, gated in code by `canManageFinance` (admin OR role ∈ {vorstand, admin, superuser, **finance**}). So a finance-role user is a full treasurer at the endpoint layer while staying read-only on the items API (except the billing-field write above).

**Frontend** — `canAccessFinance = isVorstand || isFinance` gates the `/admin/finance` tab (`FinanceRoute`) + the per-member explorer (`FinancePage` → Members tab). Billing edit is shown editable only when `isFinance` (a pure board member sees it read-only — they lack the members-update grant).

---

## KSCW Terminplanung (orthogonal — `is_spielplaner` members)

Per-user policy (no migration — permission rows only, `setup-permissions.mjs` §9b), attached via `directus_access` to the directus user of every member with `is_spielplaner = true` — NOT a base Directus role. Attached/revoked live by the kscw-hooks `members.items.update` action hook the moment the flag flips, and reconciled on every deploy by **§12** (attach missing + revoke stale). **No row-level filter anywhere in this policy: holding it IS the gate.**

| Collection | Action | Filter | Notes |
|---|---|---|---|
| game_scheduling_seasons | create / read / update | none | Open/close + config. Structural ops (archive / rollover / restore) stay admin-only at the endpoint layer. No delete |
| game_scheduling_slots | read | none | Writes go through the `/admin/terminplanung/*` endpoints (system connection, separately gated) |
| game_scheduling_opponents | read | none | Same |
| game_scheduling_bookings | read | none | Same |
| game_scheduling_club_portals | read | none | Migration 213; dormant until `use_club_portals = true` |
| scheduling_blocks | create / read / update / delete | none | Club-wide Spielplaner manages any team's blackouts (migration 085); the create hook stamps `created_by` |
| basketball_slot_plan | create / read / update / delete | none | **2026-08-05.** `useBasketballPlan.placeGame` upserts on the (date, time, hall) key → needs create **and** update; `removeGame` → delete |
| basketball_hall_availability | create / read / update | none | **2026-08-05.** `setDateUnavailable` upserts only — "available again" flips `unavailable` back to `false` rather than deleting the row, so **no delete grant** |
| team_links | create / read / update / delete | none | **2026-08-05.** `TeamLinksEditor` add / update / remove (migration 218, sport-agnostic). Read duplicates the club-wide Member grant on purpose, so this policy stands alone if that one is ever narrowed — zero added exposure |

**Not re-granted here, on purpose** — the basketball prep + settings pages also read `teams`, `halls` and `hall_closures`, all of which every authenticated member already reads unfiltered with fields `*` via `MEMBER_READ_ALL`. Club-wide blocked dates come from `GET /terminplanung/admin/club-blocked-dates`, an endpoint gated in `kscw-endpoints`, not an items-API read.

⚠ **Same-people-by-construction invariant.** The basketball scheduling routes gate on `is_spielplaner` (or sport admin), and `is_spielplaner` is exactly what attaches this policy — so the frontend gate and these grants cover the identical set of users. If the route gate is ever widened (e.g. to per-team `spielplaner_assignments`, which attaches **KSCW Spielplaner** and *not* this policy), the grants must move or be duplicated in the same change, or the widened audience gets an empty grid and 403s — the exact failure this section fixed.

---

## KSCW Spielplaner (orthogonal — spielplaner members)

Per-user policy (no migration — permission rows only, `setup-permissions.mjs §9d`), attached via `directus_access` to the directus user of every member with `is_spielplaner = true` (club-wide spielplaners) **or** at least one `spielplaner_assignments` row (per-team spielplaners; `assignment.member → members.user`) — NOT a base Directus role. Reconciled on every deploy by `§14` (attach missing + revoke stale, idempotent). Exists so non-admin spielplaners can create/delete manual games in the Spielplanung planner (`ManualGameModal` / `SpielplanungPage` write `games` via the items API) — previously only KSCW Sport Admin carried `games` create/delete.

| Collection | Action | Filter | Notes |
|---|---|---|---|
| games | create | `source = 'manual'` — as `validation` on the payload (+ same `permissions` filter) | Fields `GAME_WRITE_FIELDS` (2026-07-13). Directus doesn't enforce `permissions` on CREATE (no row exists yet); the scalar `validation` against the payload is the enforced gate — only `source: 'manual'` payloads pass |
| games | update | `source = 'manual'` | Fields `GAME_WRITE_FIELDS` (2026-07-13) — the `vm_nomination_*` journal is excluded here too, because Directus **unions** field lists across a user's policies: leaving `*` would restore journal write access to any coach who is also a spielplaner. VM-synced league games (`source != 'manual'`) stay Sport-Admin-only |
| games | delete | `source = 'manual'` | VM-synced league games stay Sport-Admin-only |

**Source scoping is policy-enforced; team scoping is hook-enforced.** All three grants are limited to manual games at the policy layer (`source` is a plain scalar column, so Directus can filter/validate on it for every holder alike). The per-team row/team scope is the kscw-hooks Spielplaner scope guard on `games.items.create/update/delete` (`directus/extensions/kscw-hooks/src/index.js`): manual games require `kscw_team` ∈ the caller's `spielplaner_assignments`; club-wide (`is_spielplaner = true`) members and admins bypass the team check. A `kscw_team` row filter at the policy layer would both be unenforceable on CREATE and lock out club-wide spielplaners — hence hook-enforced.

`games` READ is not granted here — it's already club-wide via the Member policy.

---

## KSCW Sport Admin

Inherits Team Responsible (and via that, Member). Adds full CRUD on operational collections except:

- `teams` — create / read / update only. **No delete** (migration 027 — a team carries seasons of roster / training / game history behind cascading junctions, so its blast radius stays admin-only).
- `members` — create / read / update, **no delete**. ⚠ This line claimed "and delete since 2026-08-06" until 2026-08-10, contradicting the banner note at the top of this file, verification queries 3 and 3b, and the script itself — `setup-permissions.mjs` structurally cannot emit a delete row (it clears the policy, then loops create/read/update), and carries an explicit "⚠ Do not 'fix' this by adding `setPerm(SPORT_ADMIN_POLICY, 'members', 'delete')`" comment at the exact edit site. The Data Explorer's hard delete runs through `POST /kscw/admin/delete-member`, which builds an `ItemsService` with `{...req.accountability, admin: true}` precisely so the items-API grant can stay withheld — see verification query 3 (audit 2026-08-08, finding 31).
- `clubdesk_export` — **field-scoped read only** (`id, clubdesk_id, gruppen_bracketed, offiziellen_lizenz`) for the Data Explorer grid's derived member columns (passive / honorary / former membership from the ClubDesk groups + officials licence). The rest of the register (IBAN, AHV, Bemerkungen, …) stays full-admin-only. Added 2026-07-12.
- `email_templates` — **full CRUD** (migration 287, added 2026-08-06). The staff-editable copy of the transactional emails sent to a sport's own registrants, one row per (`template_key`, `locale`). Write access is safe to hand to a sport admin because the failure modes are closed structurally, not by trust: the compiled-in copy in `kscw-endpoints` stays the **per-field fallback**, so a cleared box or a missing locale sends the built-in wording rather than a hole; the `email_templates.items.create/update` filter hook in `kscw-hooks` rejects unknown `{{placeholders}}`, rejects a `body_html` without the required `{{documents}}`, sanitizes script/style/`on*`/`javascript:` out of the stored HTML, and stamps `updated_by_name` / `updated_by_email` / `date_updated` so every wording change has an author.
- `email_sends` — **read only** (migration 287, added 2026-08-06). The archive of what was actually sent: rendered subject + body at send time, written by the endpoint in the send path, never by the UI. Deliberately *not* in the full-CRUD list — it is the evidence of what a family was told, and the same `kscw-hooks` filter refuses `update` / `delete` outright as belt-and-braces. ⚠ Rows embed the recipient's name and address inside `body_html`, so this must **never** reach `KSCW Member`.
- `email_verifications` — **no grant at all** (audit 2026-08-08). Held unfiltered create/read/update/delete until that pass, which was a privilege-escalation path to full Directus root, not an oversight convenience. The table is the credential store behind the **unauthenticated** `POST /kscw/set-password` Mode 3: that route treats any row with `verified = true` and a live `expires_at` as proof the caller owns the address. With CRU on the table a vb_admin/bb_admin could verify an address they control, `PATCH` the row's `email` to a superuser's, and claim the account. Every legitimate consumer (`/request-otp`, `/verify-email`, `/set-password`, `/register`, the delete-member cleanup) writes it with raw knex on the system connection and needs no policy row. If a staff-facing read is ever wanted, field-scope it to `id, email, date_created` — never `code`, `verified` or `expires_at`.
- `user_logs` — **create + read only** (audit 2026-08-08; was full CRUD). This is the audit trail `/admin/audit-log` reads; `update`/`delete` let the tier under audit rewrite or erase its own entries. Matching blocking `user_logs.items.update` / `.delete` filters in `kscw-hooks` back it up. (LEADER still has **no** `user_logs.read` at all — 2026-05-12.)

`games` stays **unfiltered CRUD with fields `*`** here — including the `vm_nomination_*` push journal. The 2026-07-13 field scope applies to the *Team Responsible* and *Spielplaner* policies only; because Directus unions the rows of every policy a user holds, Sport Admin's own unrestricted `games` row wins for its holders. So "inherits Team Responsible" does **not** mean a sport admin lost journal write.

---

## Website Admin

A base Directus role (`Website Admin` → policies `Website_admin` + `KSCW Member`), held by 4 members who maintain kscw.ch imagery. Declared here and in `setup-permissions.mjs` since **2026-08-10**; before that it was the one role created by hand in the admin UI and never modelled, so §3b deliberately left its rows alone and they stayed as whatever was last clicked.

| Collection | Actions | Scope |
|---|---|---|
| `directus_files` | create | unfiltered — uploads land folder-less (public) or are moved into a private folder by the quarantine hooks |
| `directus_files` | read, update | **`{ folder: { _null: true } }`** — the public image library only |
| `teams` | read | unfiltered (public information; the website renders it) |
| `directus_users` | read | **`{ id: { _eq: '$CURRENT_USER' } }`** — self only |

⚠ **Why the `folder _null` scope is load-bearing, on UPDATE especially.** Directus UNIONs permission rows per collection+action, so the previous *filterless* `directus_files` read **overrode the Member deny-list** below — these four accounts (all `members.role = ["user"]`, none with TFA) could list and download the registration folder's government-ID scans. And because update was equally unfiltered with `fields '*'`, a single `PATCH /items/directus_files/<id> {"folder": null}` moved a minor's passport scan into the folder the **Public** policy reads. The quarantine hooks in `kscw-hooks` only inspect files on CREATE, so nothing caught it. A row filter is evaluated against the **existing** row, so scoping update to `folder _null` means a file inside a private folder cannot be selected for update at all — it cannot be pulled out. `directus_roles` read is deliberately **not** re-granted (admin-UI incidental, nothing in the workflow reads it); if the app shell turns out to need it, add it to §5c rather than in the UI, or the next deploy deletes it again.

---

## Administrator / Superuser

`admin_access = true`. Bypasses all permission checks. Use sparingly.

**`Administrator` membership is audited, not reconciled (§3c, added 2026-08-08).** The only writer of `directus_users.role` in the tree is `syncMemberRole` → `resolveDirectusRole` (`kscw-hooks/src/index.js`), which returns at most `Superuser | Sport Admin | Vorstand | Team Responsible | Member` — **`Administrator` is unreachable by code**, so every holder was set by hand in the admin UI. §3b closed the role→*policy* blind spot; this is the adjacent role→*user* one, and prod carried an ordinary member (`members.role = ["user"]`) on the Administrator role for months as a result. §3c prints every holder on each `db:setup-perms` run and marks it EXPECTED (a known service account, or a linked member whose `members.role` carries `superuser`/`admin`) or **UNDECLARED**, loudly.

It deliberately **never demotes**: unlike a policy row, an Administrator demotion can lock out the last root and cannot be undone by re-running this script. The correct remedy for an undeclared holder is to set their `members.role` so `resolveDirectusRole` grants `Superuser` **declaratively** — then the grant is visible to this script, to `syncMemberRole`, and to every future audit — and only then drop the hand-set `Administrator`.

---

## Operational checklist for permission changes

When you touch any permission row:

- [ ] Edit `directus/scripts/setup-permissions.mjs` only. **Do NOT write a numbered SQL migration for a permission change.**
- [ ] Granting a whole POLICY to a base role? Add it to `DECLARED_ROLE_POLICIES` (§3) — a row created by hand in the Directus admin UI is now **deleted** by the §3b reconcile on the next deploy. Conversely, never "fix" a 403 by attaching a policy in the UI.
- [ ] Changing `DECLARED_ROLE_POLICIES` or running against an environment for the first time: `node directus/scripts/setup-permissions.mjs --reconcile-dry-run` first and read the revoke list.
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

-- 3. Sport Admin: no delete on members or teams.
--    Expect exactly: members → create, read, update   (no delete row)
--                    teams   → create, read, update   (no delete row)
--    A `members` delete row means someone widened the policy: the Data Explorer
--    hard delete runs through POST /kscw/admin/delete-member, which is the only
--    place the sport / rank / self checks exist.
SELECT pol.name, p.collection, p.action
FROM directus_permissions p
JOIN directus_policies pol ON pol.id = p.policy
WHERE pol.name = 'KSCW Sport Admin' AND p.collection IN ('members','teams')
ORDER BY p.collection, p.action;

-- 3b. Same assertion, as a pass/fail row.
SELECT
  bool_or(p.collection = 'members' AND p.action = 'delete') AS members_delete_granted,  -- expect false
  bool_or(p.collection = 'teams'   AND p.action = 'delete') AS teams_delete_granted     -- expect false
FROM directus_permissions p
JOIN directus_policies pol ON pol.id = p.policy
WHERE pol.name = 'KSCW Sport Admin' AND p.collection IN ('members','teams');

-- 4. teams_sponsors FK present + cascade
SELECT conname, confdeltype FROM pg_constraint
WHERE conrelid = 'teams_sponsors'::regclass AND contype = 'f';

-- 5. Messaging functions have search_path
SELECT proname, proconfig FROM pg_proc
WHERE proname LIKE 'fn_messaging%' OR proname = 'messaging_protect_sentinel'
ORDER BY proname;

-- 6b. Role-level policy attachments match DECLARED_ROLE_POLICIES (§3b reconcile).
--     Expected AFTER a reconcile run: exactly one row per declared pair, plus the
--     Administrator rows and the public (role IS NULL) row. Anything else — above
--     all a `Sport Admin → KSCW Admin` row — is an escalation the next
--     `db:setup-perms` will revoke.
SELECT r.name AS role_name, p.name AS policy_name, p.admin_access, count(*) AS rows
FROM directus_access a
LEFT JOIN directus_roles r ON r.id = a.role
LEFT JOIN directus_policies p ON p.id = a.policy
WHERE a."user" IS NULL
GROUP BY 1,2,3
ORDER BY 1,2;

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

The older dated reconciliation notes (2026-05-12 → 2026-07-06) are archived in [`PERMISSIONS-archive.md`](PERMISSIONS-archive.md). The full audit ledger lives in `SECURITY.md` + `SECURITY-archive.md` + git.
