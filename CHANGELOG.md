# Changelog

All notable changes to Wiedisync are documented in this file. Recent releases carry more detail; older entries are one-liners — see `git log` for the full text.

## v4.15.0 — 2026-05-30

- **Scorer duty — "All" / "Selected" toggle.** The Games view now has a toggle: **All** shows every duty you can see (your team's duties + your personal assignments), **Selected** narrows to the games you've personally signed up for. Mirrors the fines page's scope toggle.
- **Fines — spinner while loading.** The fines page no longer flashes an empty table before resolving. It now shows the Wiedisync spinner while loading, then either the table or the "No fines" empty state.

## v4.14.0 — 2026-05-30

New **Fines** service for tracking coach/TR-issued fines with per-team escalation rules.

- **Two new collections.** `fines` (the ledger: member, team, category, amount, status, optional activity link, audit snapshots) and `fine_rules` (per-team×category config: enabled, reset_window, tiers JSON, currency). Migration 069 ships both with idempotent `directus_collections` / `directus_fields` / `directus_relations` metadata so they appear in /admin. ON DELETE CASCADE on member/team FKs to follow the existing junction-cascade pattern (per `feedback_junction_cascade.md`).
- **Escalation engine.** Three new PL/pgSQL helpers — `kscw_current_season_start()` (mirrors `getCurrentSeason()` in `dateHelpers.ts`, Sep–Aug boundary), `kscw_fine_window_start(window, ts)` (dispatches the 5 reset_window enums), `kscw_compute_fine_amount(member, team, category)` (the engine: counts prior non-waived fines in the rule's window, looks up the matching tier by exact `offense`, then highest `offense_min ≤ N`, then last-tier fallback). Mirrored 1:1 in `src/hooks/useFines.ts` `computeFineAmount()` so the frontend pre-fill matches what the backend hook snapshots.
- **kscw-hooks `fines` block.** `filter('fines.items.create')` runs the engine, fills `amount` when null, snapshots `tier_offense` + `reset_window_at_issue`, resolves `issued_by` from accountability, forces `auto_issued = false`. `filter('fines.items.update')` blocks edits to `amount/category/reason/member/team/tier_offense/reset_window_at_issue` for non-admins — to correct a fine you waive + reissue (audit trail). `action('fines.items.create')` and `action('fines.items.update')` send push + in-app notifications to the recipient, localized through the existing 5-locale `push-i18n.js` bucket pattern. Daily 09:00 UTC `fines_reminder` cron rolls up open fines >14 days old into a single per-member push.
- **Permissions (setup-permissions.mjs).** MEMBER reads own fines + rules of teams they're on. COACH + TR get full CRUD scoped via `team.coach.members_id.user / team.team_responsible.members_id.user`. Vorstand gets read-all, Sport Admin gets full CRUD. Junction-walk pattern keeps the frontend safe from the M2M double-walk trap. PERMISSIONS.md updated in the same commit.
- **Frontend.** New `/fines` page with `<Table>` per the data-list rule (mobile compaction: status as colored badge, amount right-aligned tabular-nums, columns drop progressively at sm/md/lg). Member view shows the outstanding strip at the top. Leader view has a status + team filter and per-row actions (Mark as paid / Waive). `IssueFineModal` uses `useFineQuote()` to preview the engine's result inline ("2nd late sign-in this month → CHF 2"). `WaiveFineModal` requires a reason. `FinesSettings` accordion lives at the bottom of the team settings panel — per-category enable toggle, reset-window dropdown, tier editor with add/remove rows + "Nth and beyond" checkbox + live preview. ProfilePage strip links to `/fines` when the member has open fines. `FinesDashboardCard` adds a "Fines this month" tile to the coach dashboard with delta vs. last month.
- **Late-confirmation auto-prompt.** When a coach/TR confirms a member past `respond_by` on a single-team activity AND the team has `late_signin` enabled, `ParticipationRosterModal` pops `IssueFineModal` pre-filled with category=`late_signin` and the activity context. Skipped for multi-team events (ambiguous which team's rule applies) and for self-confirms.
- **i18n.** New `fines.ts` namespace × 5 locales with ~60 keys each. New `outstandingFines` + plural variants on `auth.ts`. New `fines` nav label.

## v4.13.1 — 2026-05-21

Hall plan slot editor polish — new "Free training slot" toggle plus three dropdown / conflict-detection bug fixes.

- **Free training slot toggle.** New Switch above the team picker in the slot editor. When enabled the slot saves with no team, and any team can grab it from the available-slots strip. Mirrors the existing "freed slot" path used for cancelled trainings and away games, just usable proactively.
- **Team dropdown scroll.** `CommandList` max-height was a fixed `300px` which Radix then clipped further when the popover was rendered inside the dialog viewport. Now `max-h-[min(60vh,var(--radix-popover-content-available-height,400px))]` so the list grows to fit and stays scrollable.
- **Missing i18n key.** `searchTeam` only existed in DE — non-German users saw the raw key as the search placeholder. Added `searchTeam` / `noTeamFound` / `freeSlot` / `freeSlotHint` to en/gsw/fr/it. Also dropped the hardcoded `'No team found.'` fallback in the editor.
- **Self-overlap warning.** Editing a slot showed "Overlap detected" against itself because the editor was given the merged slots list (real `hall_slots` + virtual training/game/event children). Virtual children have synthetic IDs (`training-${id}`, etc.) so `excludeId = slot.id` never matched and the slot's own auto-rendered training tripped the conflict check. `HallenplanPage` now passes `rawSlots` (real `hall_slots` rows only) to `SlotEditor`.

## v4.13.0 — 2026-05-20

Two new admin tools: a member-filter popover in the Data Explorer, and a Postgres SQL workspace for superusers.

- **Data Explorer — member filters.** The `/admin/explore` Members bucket gets a Filters popover with multi-select chips (sport / gender / positions / licences / roles / language / birthdate visibility / consent), tri-state (Any/Yes/No) toggles for every member boolean (`wiedisync_active`, `shell`, `coach_approved_team`, `is_spielplaner`, `licence_activated/validated`, `hide_phone/email`, the communications flags, `push_preview_content`), and 21 "has value" presence checks (email, phone, licence number, jersey number, photo, birthdate, address/plz/city/nationality, AHV, VM email, etc.). Filters apply client-side against the already-loaded cache. Detail navigations still resolve from the unfiltered cache, so a team page can still link to a filtered-out member.
- **SQL Workspace** (`/admin/sql`, superuser-only). Postgres console wired via a new Directus extension endpoint (`POST /kscw/admin/sql`, `GET /kscw/admin/sql/schema`). Read-only by default — DDL/DML keywords are rejected at the statement-keyword level AND the transaction is opened with `TRANSACTION READ ONLY`; flip "Write mode" in the header to allow writes (still wrapped in a transaction, still timed out). `statement_timeout = 15s`, unbounded `SELECT` auto-caps at 1000 rows with a `truncated` flag. Every call is audited to the JSONL error log as `event: sql_workspace` (user, mode, duration ms, row count, SQL preview ≤1.5KB).
- **SQL editor.** CodeMirror with PostgreSQL syntax, autocomplete keyed off the live schema (`information_schema`) — table names complete anywhere, column completions surface after `<table>.` and show the Postgres type (`text`, `uuid`, `bool`…). Sidebar lists every public table with column types; click `SELECT` to insert a starter query. `Ctrl/Cmd-Enter` runs.
- **Result export.** CSV download, Excel (`.xlsx`, dynamic-imported exceljs), and "Copy table" → clipboard write of both an HTML `<table>` and plain TSV via `ClipboardItem`. Paste into Gmail / Google Docs / Slack / Notion → renders as a table; paste into a terminal / editor / spreadsheet → TSV. Recent queries persist in `localStorage` (last 20) as a chip strip; in-progress draft auto-saves.

## v4.12.1 — 2026-05-18

Two bug fixes: a misleading "Coach present" badge and English-locale date formatting.

- **"Coach present" badge accuracy.** The badge on the training/game/event detail modals built `coachMemberIds` from `coach + captain + team_responsible`, while every card/list view uses the `teamCoachIds()` helper (coach-only, by explicit design). Because the captain is a core player who almost always RSVPs "Yes", the detail modals showed "Coach present" on virtually every session — even on teams with no coach assigned — contradicting the matching card. All three detail modals (`TrainingDetailModal`, `GameDetailModal`, `EventDetailModal`) now use `teamCoachIds()`. Genuine coaches who RSVP as staff are still counted via the separate `is_staff` path, so no real coaches are lost.
- **Date format for English users.** `formatDate()` in `dateHelpers.ts` defaulted to `currentLocale()`, which returns `en-GB` for English UI — rendering dates as `20/05/2026` (slashes), violating the app-wide Swiss `dd.mm.yyyy` convention. It now defaults to `de-CH` (consistent with `formatDateCompact` directly above it), so dates render as `20.05.2026` regardless of UI language. Weekday names remain localised.

## v4.12.0 — 2026-05-18

Training cancellations now reach the team, trial trainings can advertise recruiting positions, and the training detail modal layout is fixed.

- **Cancelled trainings notify the team.** When a coach or team-responsible cancels a training, every team member (players + coaches + TR) now receives an in-app notification and a web push. Previously cancelling was silent unless the coach manually used "Contact". Backend hook on `trainings.items.update` (future trainings only); new `trainingCancelled` push strings in all 5 locales (the in-app `training_cancelled` key already existed).
- **Detail modal layout.** The "Cancel training" / "Contact" actions moved out of the header — where they overlapped the title on the narrow modal — to a bottom action row.
- **Trial-training recruiting positions.** A trial training can now specify which positions the team is looking for ("Positions we are looking for"), surfaced to prospective players on the public team page. Migration 060 adds `trainings.recruiting_positions` and fix-forwards the migration-056 trial-transform trigger so the field survives the in-place transform.
- **Public barrage standings.** `/public/team/:id` now also surfaces the barrage (promotion/relegation playoff) standings a team appears in, not just its regular-league ranking.

## v4.11.0 — 2026-05-18

Email is now mandatory, and members can hide it from others.

- **Email required.** First name, last name and email are mandatory in profile editing — the email field can no longer be left empty (an empty email broke notifications, password reset and ClubDesk sync). Migration 059 adds a server-side trigger that refuses to blank an existing email through any write path.
- **Hide email.** New "Hide email address" privacy toggle (Profile → Privacy), mirroring "Hide phone number". When on, the email is nulled in the API for everyone except the member and admins, and hidden in every UI surface that shows contact details. Migration 058 adds `members.hide_email`.
- **Fix.** The admin ClubDesk-update email no longer shows a spurious empty "Phone — → —" row when an optional field was never set.

## v4.10.0 — 2026-05-18

Coaches and team-responsibles can cancel and reinstate trainings, events, and games.

- **Cancel / reinstate control.** A "Cancel" (and once cancelled, "Reinstate") action is available to coaches and team-responsibles on every training, event, and game — both on the card and inside the detail modal reachable from the Home agenda.
- **Team notification + visual state.** Cancelling sends the existing team notification; the cancelled activity is dimmed and its RSVP controls are hidden so nobody responds to a dead activity.
- **Hall slot freed.** Cancelling a training or a home game releases its hall slot, so other teams can claim the freed time.

## v4.9.5 — 2026-05-18

Bug fixes and polish.

- **Participations permission regression.** Members opening `/events` could hit "no permission to access fields session_id, waitlisted_at in collection participations". The fields exist and `setup-permissions.mjs:484` already granted them (in the prod branch since 2026-05-12) — prod permissions were just stale. Reconciled via `npm run db:setup-perms:prod` (357 permissions, 0 errors).
- **`[object Object]` Sentry noise.** Duplicate `toError` in `useMutation.ts` + `sentry.ts` both passed Error instances through unchanged and fell back to `String(err)`, so a failing trainings update surfaced as an unactionable `[object Object]` with no status/message. Extracted one shared `src/utils/toError.ts` that recovers the Directus `{errors}`/`{message}`/status message even when wrapped as a useless-message Error, summarizes non-serializable objects, and always attaches the original as `.cause`.

## v4.9.4 — 2026-05-14

Critical fix — future-dated absences were silently over-declining every activity from creation date through end_date.

- **Symptom.** Daniela Imhof (D4) added a 2-day "work" absence for Aug 27–28 and every D4 training from May 18 through July 9 instantly flipped to declined with note "work". Bug also hit 10 other members across 12 other absences (members 6, 19, 25, 33, 72, 93, 180, 313, 415, 467) — 50 orphan rows total on prod.
- **Cause.** `autoDeclineForAbsence()` in `directus/extensions/kscw-hooks/src/index.js` did `absence.start_date?.split?.('T')[0] || absence.start_date`. Knex returns Postgres `date` columns as JS `Date` objects, so `.split` short-circuited to undefined and the fallback handed back the Date itself. The subsequent `startDate > today` compared a Date to a `'YYYY-MM-DD'` string — coerced via `valueOf()` to a `number > NaN` which is always false. `effectiveStart` therefore clamped to today for every future absence, and the SQL window became today → end_date.
- **Fix.** Route both `absence.start_date` and `absence.end_date` through the existing `safeDateStr()` helper (line 52) before any comparison or SQL bind. Identical pattern to what other call sites already use.
- **Data cleanup.** Deleted all 50 bug-induced rows (`participations` with `auto_declined_by` pointing at an absence whose `start_date > activity_date`). Daniela's 11 D4 trainings that the team's auto-confirm flag had just confirmed at 22:10 right before the bug fired (424–427, 536–539, 616–617, 672–673) were re-inserted as `confirmed` to restore her actual state. Other affected members reset to "no RSVP" — neutral, they can re-RSVP normally.

Also bundled in v4.9.4:

- **Sentry user context now carries member display name.** `setSentryUser` passes `username = "First Last"` alongside the ID, so issue notifications show "Anna Müller" instead of `id:93`. Email is still withheld (PII).
- **`member_teams` duplicate-key noise silenced.** The migration-044 unique constraint on (member, team) was firing as a Sentry error every time a coach approved a member who was already on the roster (RLS-blinded pre-check or fast double-tap). Added `silentOnUnique` opt-in to `createRecord` / `useMutation.create` and wired the three insertion sites (`RosterEditor.handleAdd`, `TeamDetail.handleApprove`, `TeamDetail.handleApproveRequest`) to swallow the duplicate — the constraint stays as the hard backstop, but it's not an actionable error.

## v4.9.3 — 2026-05-13

Trial training now transforms the existing regular row in place instead of creating a cancelled-sibling pair.

- **Single-row model (migration 056).** Replaces 055's "two rows, cancel one" approach. Booking a trial on a date with an existing regular training flips `is_trial = true` on that row, merges any participations from the just-inserted trial (NOT EXISTS guard against duplicates), then deletes the trial sibling — all in a single AFTER INSERT trigger statement. Frontend `onSave()` refetch picks up the transformed row immediately. Symmetric: slot-cascade rolling top-up landing on a trial-occupied date discards the duplicate regular insert. Standalone trial (no matching regular for that date) still works as a fresh INSERT.
- **Why AFTER INSERT, not BEFORE.** BEFORE INSERT returning NULL would zero out `INSERT … RETURNING *`, breaking the admin UI's expectation of getting an inserted row back. AFTER INSERT lets the statement complete normally, then cleans up — Directus's response still carries the briefly-existing row, side-effects (action hooks, applyTrainingAutoRSVP) gracefully no-op on the deleted ID, and no frontend plumbing was needed.
- **Backfill.** The one legacy dual-row pair on prod (D2 + trial 697 on 2026-05-20) was collapsed: training 221 marked `is_trial=true`, marker cleared, trial 697 deleted, participations preserved.
- **Hallenplan rendering follow-up.** The "trial-replaced slot rendering as Available" UI patch from earlier today (defensive fix for legacy dual-row data) stays in place — harmless when no such pairs exist post-migration.

## v4.9.2 — 2026-05-13

Trial training (Probetraining) now overrides the regular team training on the same date.

- **Trial wins, automatically.** Booking a trial training for a team on a date that already has a regular training auto-cancels the regular row (`cancel_reason = 'Replaced by trial training'`, `auto_cancelled_by_trial` marker set). Works the other way around too: if the slot-cascade rolling top-up later inserts a regular training on a date that already holds a trial, the new row self-cancels. Deleting the trial reverses the cancellation. Manual user-driven cancel/uncancel detaches from the auto-origin (mirrors the closure-auto-cancel pattern from migration 028), so a later trial removal won't silently undo a user's intent.
- **Auto-labelled.** Trial trainings now render a "Probetraining" badge on the training card and detail modal (translated per locale: `Probetraining` DE/GSW/EN, `Essai` FR, `Prova` IT), so they're identifiable at a glance without opening the detail view.
- **Migration 055 — Postgres triggers, not JS.** Two AFTER triggers on `trainings` (INSERT enforces trial-wins, DELETE reverses) plus an extension of the existing `trg_trainings_clear_auto_cancel_marker` to cover the new marker. Done in the DB rather than a Directus hook because slot-cascade does raw knex inserts that bypass Directus action hooks — putting the rule in Postgres keeps the admin-UI path and the cascade path honest with one source of truth. Backfilled one prod row on apply (D2's 2026-05-20 regular training, where the admin had already booked a trial).

## v4.9.1 — 2026-05-13

Cascaded trainings now auto-RSVP (absence-decline + team-toggle auto-confirm), and slot deletion cascades to future trainings.

- **Auto-RSVP applies to cascaded trainings.** Slot cascade (initial generate / fill-on-edit / nightly indefinite top-up) does bulk `INSERT INTO trainings` directly via knex, bypassing the Directus `trainings.items.create` event — so the existing auto-decline (absence overlap) + auto-confirm (`training_auto_confirm` team toggle) passes never fired. Refactored: the cascade functions now return created training IDs; the wiring code in `kscw-hooks/index.js` invokes a shared `applyTrainingAutoRSVP(id)` for each. Backfilled in this release for the 209 already-generated trainings (112 absences → declined, 200 → confirmed on prod).
- **`hall_slots.items.delete` cascade.** Deleting a slot now wipes its future trainings + their participations in the same transaction (date ≥ today, Zurich tz). Historic trainings stay frozen as attendance records. Closes the orphan-FK gap that left 11 H3 Monday Manegg trainings dangling after slot 6 was deleted via admin UI.

## v4.9.0 — 2026-05-13

Slot-edit cascade moved server-side, indefinite slots get a real rolling horizon, push notifications no longer fan out for auto-generated trainings, and the roster export grows a Guest column.

- **Backend hall-slot cascade (`kscw-hooks/slot-cascade.js`).** The React Hallenplan editor used to be the only path that propagated slot edits to upcoming trainings; admin-UI / REST edits silently diverged. The cascade now lives in a Directus action hook on `hall_slots.items.update`, so every edit path produces the same result. Scope:
  - `start_time` / `end_time` / `hall` / `team` cascade in place on `date >= today`.
  - `day_of_week` change shifts each future training by `(new − old)` days, keeping the row in the same Mon–Sun calendar week so RSVPs / notes / attendance carry over instead of regenerating.
  - `valid_from` shrinks → drop trainings before the new start. `valid_until` shrinks → drop trainings after the new end (bounded slots only — indefinite never trims the tail). Window extension → generate missing dates inside the new window, skipping closures + existing rows.
  - Initial generation on slot create moved into the same hook (`hall_slots.items.create`) so rules match.
- **Indefinite = rolling 12-week horizon.** "Indefinite" used to mean "extends to season-end (May 31)", which meant every cascade silently truncated trainings past that point. Now `indefinite=true` slots have a soft rolling horizon (`INDEFINITE_HORIZON_WEEKS` constant). A new nightly cron at 02:00 UTC / 04:00 Zurich walks every indefinite training slot and tops up the next ~12 weeks of trainings (skip closures + existing dates). Cascade no longer deletes anything past the horizon on indefinite slots, so admin slot edits never lose far-future trainings. Current dev/prod max date is 2026-07-10 because Sommerferien (07-13 → 08-16) blocks everything within reach.
- **Push-notification silencer for bulk auto-generation (migration 054).** `trg_trainings_notify` previously fanned out a push to every team member on every INSERT/UPDATE/DELETE of a `trainings` row. With 54 indefinite slots × nightly top-up, that's overnight push spam. New transaction-scoped Postgres GUC `kscw.skip_trainings_notify` lets the cascade hook opt out: every bulk INSERT/UPDATE/DELETE in `slot-cascade.js` now runs inside a knex transaction that calls `set_config(..., true)`. Third-arg `true` = transaction-local, so the flag never leaks to other queries on the pooled connection. One-off CRUD via Directus admin / REST stays loud as before.
- **Slot extension to 2026-06-27.** All 54 training slots on dev + prod patched: `valid_until = 2026-06-27`, then flipped back to `indefinite = true` via direct SQL once trainings were generated. The new cron picks it up from there.
- **Roster export sorted by surname + Guest column.** Roster CSV/PNG/PDF previously sorted by first name. Admins clip these to a board where surname order is the convention, so the export now sorts by `last_name` then `first_name`. New "Guest" column (✓ in PNG/PDF, "Yes" in CSV) populated from `member_teams.guest_level` — distinct from the existing plus-ones column so a coach can spot guest players at a glance. Modal display order unchanged.
- **Bug fixed during this work: `pg-node` returns Postgres `date` columns as JS Date objects in the server-local TZ, not ISO strings.** First dev cascade run got `String(date).slice(0, 10)` → `"Wed Sep 01"` → `new Date(…)` → `Invalid Date` → cascade aborted at the trim step with `invalid input syntax for type date: "NaN-NaN-NaN"`. Slot rows were already committed (action hooks fire post-commit), so the fix was forward-only: `parseDate` now branches on `instanceof Date` and reads calendar fields directly. Documented in `INFRA.md → Troubleshooting & Gotchas`.

## v4.8.9 — 2026-05-12

Two participation-modal fixes.

- **Coaches without a `member_teams` row now appear in the staff section even before they RSVP.** Michelle Howald (member 11) is attached to H2 + H3 only through the `teams_coaches` junction. The modal's staff-resolution effect previously seeded staff member IDs only from existing `is_staff=true` participation rows — so a coach who had never RSVPed was invisible. Effect now also seeds from `leadershipRoles` (coach + TR member IDs derived from the team's `coach.members_id` / `team_responsible.members_id` expansion that the modal already fetches), filtered to exclude anyone in the regular roster. Staff appear immediately; their participation status is null until they reply.
- **Removed nested scroll inside the participation modal.** The member list had its own `max-h-[60vh] overflow-y-auto` wrapper inside the Vaul sheet on mobile — scrolling created a scroll-inside-a-scroll. Wrapper now just sets the border; the outer sheet handles scrolling.

## v4.8.7 — 2026-05-12

Web push on third-party absence edits + UX nudge for coaches.

- `push-i18n.js` gains 8 new translations: `absence.{,weekly.}{created,updated}.{title,body}` across `de / gsw / en / fr / it`.
- `kscw-hooks` `notifyAbsenceThirdParty` now dispatches a web push via `sendLocalizedPush` after the in-app insert. Body interpolates editor name and `dd.mm.yyyy` start date; opens `${FRONTEND_URL}/absences` on click; tagged `absence` so subsequent edits collapse the prior toast.
- `AbsenceForm` + `WeeklyUnavailabilityForm` show an amber hint under the note field — *"You're editing on behalf of another player — please leave a note explaining why. The note is visible to the player."* — when `memberId !== currentUser.id`. Placeholder swaps to a question prompt in the same case. The `reason_detail` / note field doubles as the audit trail and is shown to the affected member alongside the existing *"Edited by team staff on …"* attribution.

## v4.8.6 — 2026-05-12

### Coach RSVPs now visible in participation modal staff section

- Coaches/TRs not on their team's roster (Michelle: Vorstand coaching H2/H3) could click Yes/Maybe/No on their team's trainings and the row saved correctly to `participations` with `is_staff=true`, but the participation modal's STAFF section always rendered them as "Keine Antwort" regardless of what they clicked.
- Root cause: `useTeamParticipations` filters by `member IN <roster member ids>` at query time. A coach not in `member_teams` is excluded from that query's result, so the modal's main `participations` array never contained their `is_staff=true` row. The staff-status lookup (`getStaffMemberStatus`) read from that array and always returned null.
- Fix in `src/components/ParticipationRosterModal.tsx`:
  - New `staffParticipationRows` state keeps the dedicated `is_staff=true` fetch's rows around (previously only the resolved member objects were kept).
  - `staffParticipations` is now derived from that state instead of the roster-scoped `participations` array.
  - Switched the staff fetch from `fetchAllItems` + `useEffect` to `useCollection` so it auto-invalidates when any participation mutates (`useCreate`/`useUpdate` call `qc.invalidateQueries({ queryKey: keys.collection('participations') })`). A coach's click now updates the modal without a manual refresh.

## v4.8.4 — 2026-05-12

Coaches & team responsibles can manage their players' absences on behalf, with full attribution and member notification:

- LEADER policy gains `absences.create/update/delete` scoped to team members (v4.8.3 / migration 050 set up the perms; v4.8.4 adds the audit + notification layer on top).
- Migration 051 adds `last_edited_by uuid` + `last_edited_at timestamptz` on `absences` (mirror of migration 046 on `participations`).
- `kscw-hooks` filters `absences.items.{create,update}` stamp the writer from `accountability.user` (un-spoofable from the client). System writes (cron, hall-closure unwind) leave the columns null.
- New `notifyAbsenceThirdParty` action fires an in-app notification (`absence_third_party_edit`, title key one of `absence_{,weekly_}{created,updated}_for_you`) to the affected member when the writer's user differs from the member's linked user. Editor name + reason + start/end are interpolated from the JSON body. 5-locale i18n.
- `AbsenceCard` + `WeeklyUnavailabilityCard` render an italic *"Edited by team staff on dd.mm.yyyy HH:MM"* line under the reason when `last_edited_by` ≠ the member's `user`. Uses `formatDateTimeCompact` (Swiss / 24h).

## v4.8.3 — 2026-05-12

Deep security audit + remediation. Eight Fix-this-week findings closed:

- `POST /kscw/events/:id/notify` now requires auth + admin/sport-admin/event-creator/coach-or-TR-of-event-team. Was unauthenticated — mass push/email amplification vector.
- Audit-log endpoint gate switched from `directus_roles.name = 'Superuser'` (bypassable by renaming a role) to `req.accountability.admin === true`.
- `registration.bemerkungen` HTML-escaped before interpolation into admin notification email (`escHtml` from email-template.js, now exported).
- Team-join-request email body escapes member name + team name (5 locales).
- Push subscription endpoint URL validated at subscribe time: https only, allow-list of browser push provider hosts (FCM/APNs/Mozilla/WNS), private/loopback/link-local IPs rejected. Closes SSRF path through CF push Worker.
- OAuth callback TTL tightened from 5 min → 2 min; `state=<nonce>` embedded in redirect URL and verified on return if Directus preserves it.
- LEADER policy scope-tightening pass: `members.read` (`COACH_TEAM_MEMBERS` scope + field whitelist excluding `ahv_nummer`), `games.update`, `trainings.update`, `events.update`, `participations.read`, `participations.update`, `absences.read` all now use the coach/TR-of-the-target-team filter. `user_logs.read` removed from LEADER entirely — audit-log endpoint is the only sanctioned path.
- Migration 050: `trg_participations_guest_block` now scopes the `guest_level > 0` check to the game's own team (was checking any-team — over-blocked legit RSVPs for seniors guesting on youth teams).
- `smoke-test.mjs` gains optional Coach-token negative-assertion pass (env-gated via `DIRECTUS_*_USER_TOKEN_COACH`): cross-team `participations.read` returns empty, `user_logs` direct read 403s.

Documentation sync: SECURITY.md "2026-05-12" block, PERMISSIONS.md header bumped to migration 050.

## v4.8.2 — 2026-05-12

### Coaches see their team trainings & events again

- Michelle Howald (Vorstand member coaching H2 + H3 without being on either roster) saw zero trainings for her teams even after the v4.8.1 LEADER policy fix. Root cause: LEADER had `trainings.create`/`update` but **no `trainings.read`** — the Member fallback policy's `trainings.read` is scoped to `member_teams`, so a coach who isn't a player on their own team gets nothing.
- Same structural gap on events: LEADER had only `create`/`update` for `events`, no `read` or `delete`. Coaches couldn't see private team events or cancel them.
- Fix in `setup-permissions.mjs`:
  - **`trainings.read`** scoped via the coach/TR M2M traversal: `{ _or: [ { team: { coach: { members_id: { user: { _eq: $CURRENT_USER } } } } }, { team: { team_responsible: { members_id: { user: { _eq: $CURRENT_USER } } } } } ] }`.
  - **`trainings.delete`** with the same scope.
  - **`events.read`** with the union of the existing Member event filter (creator, club-wide, invited team via `member_teams`, invited member) plus the coach/TR traversal.
  - **`events.delete`** scoped to event creator or coach/TR of an attached team.
- Verified end-to-end on prod: temp-token query as Michelle (member 11) returns trainings of H2 + H3; querying a team she doesn't coach correctly returns empty.

### Auto-confirm RSVP — per-activity override + retroactive backfill

- **Per-activity override**: `TrainingForm` and `ManualGameModal` now render a tri-state "Auto-confirm RSVP" control — *Use team default* / *On* / *Off*. The hint label resolves the current team default so coaches see what *Use team default* will produce. Stored as nullable boolean in new `trainings.auto_confirm_rsvp` and `games.auto_confirm_rsvp` columns (migration 048).
- **Retroactive backfill on team toggle flip**: new `action('teams.items.update')` in `kscw-hooks` detects a change to `features_enabled.training_auto_confirm` / `game_auto_confirm` and runs the auto-confirm `INSERT … SELECT … NOT EXISTS` against every future training/game where `auto_confirm_rsvp IS NULL` (i.e. still inheriting). Trainings honour `excluded_guest_levels`; games include only `guest_level = 0` (`trg_participations_guest_block` still enforces).
- **Activity-level flip backfill**: `action('trainings.items.update')` and `action('games.items.update')` were extended to run the same auto-confirm pass when `auto_confirm_rsvp` is present in the payload — so a single training flipped to *On* fills its roster without waiting for cron or a save-twice loop. Date guard: `onlyIfFuture` skips past activities.
- **Effective resolution**: `effective = activity.auto_confirm_rsvp ?? team.features_enabled.<kind>_auto_confirm` — per-activity *Off* hard-overrides team *On*, letting coaches soft-opt-out specific sessions (optional scrimmages, "everyone show up if you can") without changing the whole team.
- **Safety**: every backfill uses `NOT EXISTS` against `participations` keyed on `(activity_type, activity_id, member)` so absence-declined rows, manual RSVPs, and earlier auto-confirms are never overwritten. Confirmed in dev: re-running a backfill after manual RSVP edits leaves the manual choices alone.
- i18n EN / DE / GSW / FR / IT for the tri-state labels and hint in both forms.

## v4.8.1 — 2026-05-12

### Coaches & team responsibles can update their teams again

- Three coaches/TRs were silently 403'd on every `PATCH /items/teams/<id>` after the v4.5.1 scope tightening — visible as a dashboard date-range input that wouldn't persist, a roster-page settings toggle that snapped back, or a "Coach can't see trainings" report (`CoachDashboard` auto-persist failing on mount).
- Root cause: the LEADER policy was attached only to the **Team Responsible** Directus role. Whether a coach got that role depended on the `kscw-hooks` role-sync hook firing on data-change events — coaches whose junction predated the hook (member 467), Vorstand+Coach users created before the priority rule existed (member 11), and users with custom non-managed roles like "Website Admin" (member 442) all ended up with a stale role and no LEADER policy.
- Fix: decouple LEADER policy attachment from role assignment. Attach the policy **per-user** via `directus_access.user` to every member present in `teams_coaches` or `teams_responsibles`. The policy's writes are already self-scoped via M2M filters (`coach.members_id.user = $CURRENT_USER`), so broadening the attachment cannot widen access — non-coaches still hit 403 on the filter.
  - One-time SQL backfill applied to prod (21 users).
  - `directus/scripts/setup-permissions.mjs` section 10 reproduces the same end-state on fresh installs, including stale-row cleanup.
  - `kscw-hooks` `ensureLeaderAccess()` / `revokeLeaderAccessIfOrphan()` mirror role-sync on `teams_coaches` and `teams_responsibles` create/delete, so new assignments don't need to wait for a setup script run.
- Lesson logged in `INFRA.md → Troubleshooting`: don't gate capabilities on Directus role assignment when the data already encodes the capability. Filters can read the source of truth at request time.

## v4.8.0 — 2026-05-12

### Auto-confirm RSVP — opt-out attendance (PlayerPlus-style)

- Two new team settings under Team Settings → Game Defaults / Training Defaults: **Auto-confirm trainings** and **Auto-confirm games**, both off by default. When enabled for a team, every newly created training/game starts with all eligible members already set to `confirmed` — members who can't attend must actively decline.
- Stored in the existing `teams.features_enabled` JSON (`training_auto_confirm`, `game_auto_confirm`) — no schema migration needed.
- Hook lives in `kscw-hooks` `action('trainings.items.create')` and `action('games.items.create')`, appended after the existing absence-auto-decline pass. The new `INSERT … SELECT … NOT EXISTS` writes `confirmed` for every remaining eligible member, so:
  - Members with an overlapping one-off or weekly absence stay `declined` (auto-decline ran first, the `NOT EXISTS` skip leaves them alone).
  - Manual coach overrides written before the hook fires (e.g. through `ItemsService` chains) survive.
  - Trainings honour `excluded_guest_levels` (skipped). Games only include `guest_level = 0` — guests remain blocked by `trg_participations_guest_block`.
  - Games already `completed` / `postponed` / `cancelled` at creation time are skipped.
- Translated in EN / DE / GSW / FR / IT (`featureAutoConfirmTraining{,Hint}`, `featureAutoConfirmGame{,Hint}`).
- Out of scope for v4.8.0: per-activity override (the toggle is team-wide for now), retroactive flip when the toggle is turned on, events (cross-team semantics need a separate design pass).

## v4.7.0 — 2026-05-10

### Coaches can edit notes, with per-field attribution

- Coaches and team responsibles can now edit a player's note from the roster modal alongside the existing status edit. Click the pencil → status dropdown + note input appear side-by-side. Status saves on change; note saves on blur or Enter. Click outside the panel to close.
- Every staff edit gets attributed under the row in italic gray: *"Edited to Confirmed by Luca Canepa on 10.05.2026 14:32"* + *"Note edited by Luca Canepa on 10.05.2026 14:35"* as independent lines. Editing the note doesn't reset the status attribution and vice versa. Self-edits and system writes (cron auto-decline, hall-closure unwind) leave the row clean.
- Same attribution lines render in PNG/PDF exports stacked under the player name; CSV gets a new `Edited by` column with both joined by `\n`.
- **Migration 046** added a single tracker; **migration 047** replaced it with per-field pairs (`last_status_edited_*`, `last_note_edited_*`) for cleaner semantics. Backend `kscw-hooks` `participations.items.{create,update}` filter stamps the matching tracker only when its field is in the write payload — system-context writes (null accountability) leave both trackers untouched, distinguishing them from staff edits.
- New i18n keys (EN + DE): `editedByOn`, `noteEditedByOn`, `addNotePlaceholder`, `editedByColumn`, `staffFallback`. FR/GSW/IT fall back to EN.

### Date & time format standardised: `dd.mm.yyyy` + 24-hour, app-wide

- Every date rendered to a user is now `dd.mm.yyyy` (`10.05.2026`), every time is 24-hour `HH:MM` (`14:32`). Previously English-locale users saw `5/10/26, 2:32 PM` while Germans saw `10.05.2026, 14:32` for the same instant.
- Central helpers in `src/utils/dateHelpers.ts` are now hardcoded to `de-CH` + `hour12: false`: `formatDateZurich`, `formatDateCompactZurich` (bumped from 2-digit to 4-digit year), `formatTimeZurich`, `formatDateTimeCompact`.
- Patched 7 inline `toLocaleString` / `toLocaleTimeString` / `toLocaleDateString` call sites that bypassed the helpers — `AuditLogPage`, `InfraHealthPage`, `DataHealthPage`, `ExplorePage`, `ResultsTable`, `OpponentFlowPage`, plus the new attribution code in `ParticipationRosterModal`. All now hardcode `'de-CH'` and pass `hour12: false`.
- Same standardisation in the **kscw-website** repo (separate commit): `formatDate` helper hardcoded to `de-CH`, 6 inline call sites in `index.astro` / `news/index.astro` / `calendar-grid.ts` patched. Public site no longer renders `30/03/2026` (en-CH slashes) for English visitors.
- Rule documented in `CLAUDE.md` (both repos) and `INFRA.md → Time & Date Formatting` with examples + common-mistake list.

### RSVP visual noise: dropped "Saved" / "Note saved" popovers

- The active RSVP button stays highlighted and the saved note value persists in the input — visual feedback for "your input was accepted" already exists. Removed the green floating popovers from `ParticipationButton` (home agenda RSVP), `TrainingDetailModal`, `TrainingCard`, `EventDetailModal`, `GameCard`, `GameDetailModal`. Enter on the note input still saves automatically.

## v4.6 (4.6.0 → 4.6.7) — 2026-05-10

A day's worth of roster + bottom-sheet polish, collapsed. Per-bump iteration detail
lives in `git log`.

### Mobile bottom sheets

- `MoreSheet` and `NotificationPanel` scroll properly on Android Chrome + iOS Safari now — both engines mishandle touch-scroll on a transformed compositor layer, and the slide-up animation + scroll container had been the same DOM node. Restructured to outer animated wrapper + inner `flex-1 overflow-y-auto overscroll-contain` body.
- Drag the sheet down from the top to dismiss (matches the Vaul-based detail modals). Drag in the middle of a long admin nav still scrolls normally.
- Top close strip is one full-width tap target with the visual handle bar inside; chevron-down button on mobile, X button in the desktop notifications header.

### Roster export — CSV / PNG / PDF

- Staff/admin Export dropdown in `ParticipationRosterModal` (gated by `canEditRoster`). Three formats; respects the active status filter; "All" appends waitlist + staff. Columns: name (with leadership suffix), jersey number, default positions, status (incl. absence-reason flavour), guests, note, RSVP timestamp.
- Header carries an uppercase activity-kind line above the title — `TRAINING` / `GAME` / `EVENT`. Game call sites override with `"<home> vs <away>"` so a game export reads e.g. `KSCW H1 VS PFADI`. Position-summary pill row above the table (`3 Setter`, `5 Outside hitter`, …); CSV gets a `Positions:` metadata line.
- PNG/PDF use a hidden printable view portalled to `document.body` (escapes the modal's transformed ancestor) inside a zero-size `overflow:hidden` wrapper (so the cloned root passed to `html-to-image` carries no `opacity:0` or off-screen offset that would empty the snapshot). Lazy-loaded `html-to-image` + `jspdf` — main bundle unchanged. PDF slices to multi-page A4 when content overflows.
- Filename pattern: `<title>_<filter>.<ext>` when title already contains the date; em/en/hyphen dashes collapse to a single underscore. Sanitised for cross-OS filename safety.
- Stale-bundle dynamic-import failures surface as a sonner toast asking the user to refresh (was a silent Sentry).
- New `?debugExport=1` URL flag dumps a per-stage console group (rect, computed style, intermediate `toSvg`, final `toPng` size) for future blank-export diagnostics.

### Roster modal correctness

- **Excluded guests** — Per-training `excluded_guest_levels` no longer leak into the staff-side modal; their members are dropped from `memberList`, the visible list, and the export. Games drop any `guest_level > 0` unconditionally.
- **Summary count vs visible list** — modal said "14 Confirmed" while the card-row preview correctly said 13. `playerParticipations` now mirrors `ParticipationSummary` exactly: dedupe by member with best-status priority (confirmed > tentative > waitlisted > declined), drop `is_staff` rows from the player tally, restrict to `memberIdSet`. `getMemberStatus` prefers the non-staff row so visible list, summary counts, and exports agree.
- **Coach Present badge** — driven by a Set of player-coach IDs walking the full participations list, not by `summaryParticipations` (which now excludes is_staff). A coach who only carries an is_staff confirmed marker still triggers the badge.
- **Explicit RSVP wins over absence overlay** — clicking "Yes" on an activity covered by a weekly unavailability now sticks. `getMemberStatus` had been checking the absence overlay before the participation row; logic flipped so a row whose `auto_declined_by` is null is treated as user-owned and its status is sacred. `Participation` type gains `auto_declined_by?: number | null`. Same fix applied to badge label and `statusLabelText` (used by the export). Backend `participations.items.create` filter skips when accountability is set so user-driven creates trust the explicit RSVP.

### `/status` page

- Real cron heartbeats. Migration 045 adds `sync_runs` (`source` PK, `last_run_at`, `status`, `rows_changed`, `duration_ms`, `error_message`). New `logCronRun(database, source, opts)` helper in `error-log.js` upserts on completion. `sv_sync` / `bp_sync` / `vm_sync` / `svrz_sync` record a heartbeat on every termination path. New `gcal_sync` cron at 04:00 UTC calls the existing `/admin/gcal-sync` endpoint nightly (was admin-trigger-only — `hall_events` never auto-refreshed). New `GET /kscw/admin/sync-status` endpoint reads the heartbeats; `useInfraHealth.ts` aggregates Swiss Volley as `sv_sync` ∪ `svrz_sync` (most recent wins) and distinguishes stale from errored.
- "Awaiting first run" label replaces the literal "20583 d ago" that the 1970-epoch seed produced before the first cron fires.

### Localhost dev server

- Localhost (`localhost`, `127.0.0.1`, `*.local`) now ALWAYS points at `directus-dev.kscw.ch`, regardless of `VITE_DIRECTUS_URL` in `.env*`. Prod CORS rejects localhost origins; an env override that pointed there silently broke every fetch.
- New `npm run dev:prod` script reverse-proxies all `/directus/*` (REST + WS) from the dev server to prod Directus, so localhost can render against live data when dev is too stale to be useful. Loud red console banner on every page load — every write hits live data.
## v4.5.4 — 2026-05-10

### Roster modal hides excluded guests

- Per-training `excluded_guest_levels` (commit `af71850`, v4.5.x) hid input buttons on the guest's own card and 403'd `participations.create` server-side, but never touched the staff-side roster view. Excluded guests sat in `ParticipationRosterModal` as zombie "Hasn't replied yet" rows — they couldn't reply and they inflated the "not responded" count.
- `ParticipationRosterModal` gained an `excludedGuestLevels` prop and now drops members whose `member_teams.guest_level` is in the excluded set before building `memberList`. Wired through from `TrainingDetailModal` and `TrainingsPage`.
- Games extension: same modal also drops any member with `guest_level > 0` whenever `activityType === 'game'` — matches the hard rule from `af71850` (games never allow guests). No call-site changes; `GameDetailModal` and `GamesPage` already pass `activityType="game"`.

## v4.5.3 — 2026-05-07

### Roster duplicate guard

- **DB constraint.** Migration 044 adds `UNIQUE (member, team)` on `member_teams`. Same member + same team is now strictly one row. Refetch races, double-clicks, and two coaches both hitting "approve" can no longer spawn twins. The migration sanity-checks for existing duplicates first and refuses to apply until `directus/scripts/dedupe-member-teams.mjs` cleans them up.
- **Data cleanup.** 5 duplicate rows removed from prod (`Hanna Baumgartner` D4, `Isis Hemprich` D1, `Maëlle Leiser` DU23-2, `Livia Schlegel` D4, `Daniela Duc (Fölmli)` D4) and 1 from dev (`Pawel Kalaga` H1) — all season=2025/26, guest_level=0. Surfaced when D4 admin saw Hanna listed twice on the roster.
- **Frontend defense-in-depth.** `RosterEditor.handleAdd`, `TeamDetail.handleApprove`, and `TeamDetail.handleApproveRequest` now look up `(member, team)` first and no-op (or update `guest_level` in the request flow) when a row already exists. The constraint catches genuine bugs rather than masking everyday UX races.

## v4.5.2 — 2026-05-06

### Closed: last Critical from the v4.5.1 audit

- **`sv_vm_check` cross-member dump.** New `GET /kscw/sv-licence/me` custom endpoint joins by `members.license_nr → sv_vm_check.association_id` with the original 11-field whitelist. Direct `sv_vm_check.read` for KSCW Member is now REVOKED — side-steps the Directus 11 `CASE WHEN 1` SQL-gen bug entirely. `ProfilePage` switched from `useCollection<VmCheck>` to `kscwApi('/sv-licence/me')`.

### Ops & dev experience

- `VAPID_PUBLIC_KEY` added to the dev container env (same gap as prod had pre-v4.5.1) and both containers recreated. Push working on both.
- New `/kscw/admin/migrations-status` admin endpoint + a "Migrations applied" card on `/admin/infra` — surfaces applied count, pending list, latest migration. Goes amber if dev/prod drift.
- `smoke-test.mjs`: token-only auth via `DIRECTUS_DEV_USER_TOKEN_MEMBER` / `DIRECTUS_PROD_USER_TOKEN_MEMBER` (from `.env.local`, URL-resolved); email/password fallback retired. Two new asserts: `sv_vm_check direct (must 403)` and `kscw/sv-licence/me`. 19/19 passing on dev.
- `setup-permissions.mjs` auto-loads `.env.local` and picks the right `DIRECTUS_DEV_TOKEN` / `DIRECTUS_PROD_TOKEN` by URL — no more inline env wrappers in npm scripts.
- New `npm run db:fresh-install:dev|prod`: `SCHEMA.sql | psql` → `db:migrate` → `db:setup-perms` → `db:smoke`. Single command for DR rebuild / fresh env.

## v4.5.1 — 2026-05-06

### Security

- **Deep audit + remediation across 6 surfaces.** ~58 findings; the high-impact items are listed below. Full audit log + open items in `SECURITY.md`; canonical permission map in `PERMISSIONS.md`.
- **Frontend.** Sentry Session Replay masks all text/inputs and denies network details for Directus (was capturing PII at 100% on error). OAuth callback rejects token URLs without a fresh `oauth_pending` sentinel from `loginWithOAuth` (closes the CSRF substitution path). Sponsor `website_url` and admin BugfixDashboard `pr_url` routed through `sanitizeUrl()`. `RichText` DOMPurify call gets explicit `ALLOWED_URI_REGEXP`. `public/sw.js` pins push-notification click URLs to our origin.
- **Push worker.** Bearer-secret comparison switched from `!==` to constant-time XOR-fold (`timingSafeEqualStr`) — closes the timing oracle on `AUTH_SECRET`.
- **Custom endpoints.** Newsletter Turnstile fails closed when `TURNSTILE_SECRET` is unset (was returning `true` → mailbomb relay). `/terminplanung/register` no longer returns the raw token in the response body. `/terminplanung/book-home` wrapped in a transaction with `SELECT … FOR UPDATE` and a cross-team check (`slot.kscw_team === opponent.kscw_team`) — closes both the TOCTOU race and cross-team slot sabotage. New shared `capPayload` (caps `/client-error` body to 500 chars) and `ipRateLimit` helpers; `team-invites/claim` rate-limited to 5/15min/IP. `web-push.js` removed hardcoded VAPID public-key fallback.
- **Custom hooks.** Announcement audience guard now blocks `audience_sport`-unset posts unless caller is full admin/superuser (a Sport Admin could omit the field and broadcast to the entire club). New filter on `members.items.update` strips the `role` field unless caller is admin/superuser (defense-in-depth on top of field-level perms — the role-sync hook escalates to Directus user role). Junction-delete pending Maps drained via try/finally + key snapshot. New `escapeEmailHtml`; admin-controlled `rejection_reason` and clubdesk-update `old_value`/`new_value` are now HTML-escaped before email interpolation.
- **Migration 043.** `tasks.read` scoped to own assignments. `feedback.read` scoped to own email. `teams.update` row-scoped for Coach + Team Responsible. `teams_sponsors.sponsors_id` FK with ON DELETE CASCADE (closes the deferred half of migration 037). `SET search_path = public` on all 8 messaging trigger functions. `bugfix_jobs` explicit REVOKE FROM anon, authenticated.

### Process

- **Permissions are now declarative.** `directus/scripts/setup-permissions.mjs` is the SINGLE source for Directus permissions, applied via `npm run db:setup-perms:<env>` on every deploy. Numbered SQL migrations are SCHEMA-ONLY going forward. The 4.4.4 / 042 incident class ("permission row never created on prod, surfaced four versions later") is now structurally impossible.
- **Migration tracker.** New `kscw_migrations(filename, sha256, applied_at, applied_by)` table + `apply-migrations.mjs` runner. Refuses to proceed if any applied migration's on-disk sha differs (tamper detection). Eliminates "was migration 009 ever applied to prod?" mysteries.
- **Smoke test.** `smoke-test.mjs` logs in as a non-admin Member, runs ~18 critical reads (`users/me`, `members/self`, `member_teams`, `teams`, `games`, `trainings`, `events`, `participations`, `absences`, `notifications`, `blocks`, `spielplaner_assignments`, `sv_vm_check`, `tasks`, `feedback`, `announcements`, `user_logs`, `web-push/vapid-public-key`), exits non-zero on any 4xx/5xx. Catches the silent Promise.all-failure pattern (4.4.4) on first deploy after the regression.
- **Single-command deploy.** `npm run db:deploy:dev|prod` runs migrate → setup-perms → smoke. Fresh-install path: `SCHEMA.sql` baseline (regenerated from prod via `npm run db:baseline:prod`) + `setup-permissions.mjs`.
- **Policy locked into CLAUDE.md, INFRA.md, SECURITY.md, PERMISSIONS.md.** Cross-referenced from every entry point. New `~/.claude/skills/kscw-security-audit/` skill encodes the 6-agent dispatch pattern for re-running the audit (with `SECURITY.md` as the dedup shield against re-flagging fixed items).

### Open

- `sv_vm_check.read` cross-member dump (Critical from the audit) remains open. Directus 11 emits invalid `CASE WHEN 1` SQL when a row filter is applied on this collection, which Postgres 12+ rejects. Fix path is a custom `/kscw/sv-licence/me` endpoint + revoke direct read. The 11-field whitelist (no email/birthday/name/phone) limits the surface; tracked in `SECURITY.md`.

## v4.5.0 — 2026-05-05

- Coach Dashboard expanded to /games (new tab, per-row drilldown, league-only toggle).
- Trainings + games dashboards: replaced season selector with persisted From/To range (defaults: 01.06 of current season → today, rolls forward annually).
- Bucket simplification: weekly + one-off absences now both count as "absent" (was: "excused"). Confirmed RSVP wins over a covering absence. Trend dots green/red.
- GameCard + EventCard feature parity with TrainingCard (always-visible note input, respond-by line, roster opener, edit/delete pencils — delete only for manually-created games).
- Migration 041 + setup-permissions update: three new team-row columns guarded by leaving them out of PUBLIC_TEAM_FIELDS; explicit Coach/TR read+update row added.

## [4.4.15] — 2026-05-05

### Fixed
- **Absence override leak: card-level + calendar RSVP buttons let users overwrite a covering absence.** v4.4.10's policy ("absence hard-overrides RSVP") was enforced in the three detail modals (`TrainingDetailModal`, `EventDetailModal`, `GameDetailModal` all early-return a passive "Excused" message when `hasAbsence`). It was NOT enforced on (a) inline card RSVP UIs `TrainingCard.TrainingParticipation`, `GameCard.GameCardParticipation`, `EventCard.EventCardParticipation` — these render Yes/Maybe/No pills directly on the list cards using prefetched participation data, never going through the detail modal — or (b) `CalendarEntryModal.tsx:143,163` which rendered `<ParticipationButton>` raw with no absence check. Concrete leak path: an auto-declined participation displays the red "No" pill (because `status='declined'`); the user clicks "Yes"; PATCH `participations/<id>` flips status to confirmed; migration 038's BEFORE UPDATE trigger `trg_participations_clear_auto_marker` is — by design — permissive on manual UPDATEs (clears `auto_declined_by` so the row detaches from the absence) so the override sticks. Fix is purely UI: new `useMyCoveringAbsence(activityType, activityDate)` hook (`src/hooks/useMyCoveringAbsence.ts`) wraps `useCollection<Absence>` filtered to the current user + the activity's date range, runs `absenceCoversActivity()` to apply the day-of-week + affects bitmap. The three card components and `HookedParticipationButton` now `if (hasAbsence) return <p>{t('absent')}</p>` mirroring the detail modals. Trigger and backend filter (`participations.items.create`) untouched — manual overrides via Directus admin or after deleting the absence still work.
- **PATCH `/items/trainings/{id}` returned 500 when editing the hall.** Postgres error `invalid input syntax for type integer: ""`. `TrainingForm.handleSubmit` (`src/modules/trainings/TrainingForm.tsx:284,291,293`) was sending `''` (empty string) for two nullable integer FKs — `hall_slot` (whenever the form was not in "auto" slot mode, regardless of whether you'd picked an actual hall) and `hall` (only when the "Other / custom name" radio was selected). Either path produced a write Postgres rejected. Both now resolve to `null`, which Directus accepts for nullable FK columns.

## [4.4.14] — 2026-05-03

### Fixed
- **"My next appointments" home agenda — Monday training rows still rendered green when the user was unavailable.** v4.4.12 only got half the way there. The fix correctly composite-keyed the input filter and the internal `partByKey` lookup in `useBulkParticipationStatuses`, but the *output* `Map<string, status>` still used `activity.id` as the key and the comment at lines 73-77 even rationalized that as safe ("callers do `statusMap.get(tr.id)`"). It is not safe — `HomePage`'s `NextAppointments` passes a mixed list of trainings + games + events to the hook, and the per-iteration `map.set(activity.id, …)` lets the last write win. Concrete repro on prod (member 8, H3): trainings id 1, 2, 3, 4 are the four upcoming Mondays — all `declined` (two manual, two auto-declined by weekly absence #51 covering Mon+Fri). Events id 1 (Generalversammlung), 2 (Trainingsweekend), 3 (Photoday), 4 (Photoday Day 2) are all `confirmed`. The hook iterated trainings first, set `map.set('1','declined')` … then iterated events and overwrote with `map.set('1','confirmed')`. The training row read `'1'`, got `'confirmed'`, painted green. Friday rows (training id 334, 335, 336) had no event collisions so they correctly rendered red. Wednesday rows (training id 15, 16, 17) genuinely were `confirmed` so they were correctly green for the right reason. Output map now keyed by composite `${type}:${id}`; a new `getStatus(type, id)` accessor is returned alongside the raw map; all seven `participationStatuses.get(…)` call sites in `HomePage.tsx` now go through it.
- **"Coach present" badge missing on most home-page trainings even when the coach was confirmed.** Same screenshot, secondary symptom. The badge appeared on Mon 04/05 and Wed 06/05 but not on Wed 13/05 / Wed 20/05 — yet member 8 (a coach for H3 via `teams_coaches`) was `confirmed` on all three Wednesdays. Root cause: the trainings fetch in `HomePage.tsx` used `fields: ['*', 'team.*', 'hall.*', 'coach.*']`. Directus's `team.*` only expands scalar fields and M2O foreign keys — `team.captain` (M2O int) was populated, but `team.coach` and `team.team_responsible` (both M2M) came back `undefined`. So `teamCoachIds(team)` returned only `[String(captain)]` and the player-coach detection in `ParticipationSummary` (`playerData.filter(p => p.status === 'confirmed' && coachMemberIds.includes(p.member))`) only ever matched the captain. On the two Wednesdays where the captain (member 19) wasn't confirmed, the badge silently disappeared even though a real coach was present. Added `team.coach.members_id`, `team.team_responsible.members_id` to the trainings fetch, and the equivalent `kscw_team.coach.members_id` / `kscw_team.team_responsible.members_id` to all four games fetches (next-all, next-mine, results-all, results-mine).

## [4.4.13] — 2026-05-03

### Fixed
- **SVRZ scheduling sync (`svrz_sync` cron) was failing daily at 04:30 UTC with "CSRF token extraction failed for /sportmanager.indoorvolleyball/playingscheduleresponsibleaddressviewer/index".** Misleading error message — the page was actually returning **403 Forbidden** and `csrfFromPage()` only checked for the regex match, not the HTTP status, so the 403 error template silently surfaced as a CSRF failure. Root cause: after `POST /sportmanager.security/authentication/authenticate` and a `GET /` dashboard hit, the Volleymanager session is authenticated but has **no sub-app scope** — the only indoor page reachable is `/sportmanager.indoorvolleyball/game/index`. Every other indoor page (writer, player, team, club, playing-schedule address-viewer) returns 403. The browser invisibly enters the volleyball sub-app via `/sportmanager.volleyball/main/dashboard` after login, which sets the server-side context that grants access to indoor sub-apps. Fix: add that fourth step to `vmLogin()`. Verified live against the production VPS: all previously-403 paths now return 200 with valid CSRF tokens. Same fix protects `vm-sync-check.mjs` (monthly cron, also touches `/indoorwriter/index` — would have crashed at the next monthly run on June 1). Also hardened `csrfFromPage()` to throw with the HTTP status when the response is non-OK, so future SVRZ drift surfaces as a one-line diagnostic instead of a CSRF red herring.

## [4.4.12] — 2026-05-03

### Fixed
- **Training row strip rendered "confirmed" green even when the user had a `declined` participation + covering absence.** Concrete repro on prod (member 8, training id 4 on 2026-05-25): `participations.status='declined'` plus a `weekly` absence covering Mondays — the roster modal correctly showed "Unavailable", but the personal training row's left strip was green. Root cause in `useBulkParticipationStatuses`: the in-memory `partByActivity` lookup was keyed on `activity_id` alone, with no `activity_type`. The same member had `training:4 declined` AND `event:4 confirmed` in `participations`; the query also did not filter by `activity_type`, so both rows came back, and the second `Map.set('4', …)` overwrote the first depending on Directus return order — when `event:4 confirmed` won, every training/game/event sharing the numeric id `4` rendered green. Fixed by keying both the Directus filter (`activity_type._in [...]`) and the JS `Map` on the composite `${type}:${id}` key.
- **Roster modal "last month" sub-label now sentence-cased.** `Intl.RelativeTimeFormat` emits lowercase ("last month", "vor einem monat"), which read awkwardly as a standalone label under a member's name. Capitalized in `RsvpTimestamp` via `String#charAt(0).toLocaleUpperCase()` (preserves locale-correct casing for non-ASCII).

## [4.4.11] — 2026-05-03

### Fixed
- **Email locale was DE/EN-only and broke on admin alias addresses.** Push got 5-locale support in 4.4.9 but emails still bucketed into just `de` and `en`, with members of `language=french/italian/swiss_german` silently routed to DE. Worse: alias addresses (`kontakt@kscw.ch`, `volleyball@kscw.ch`, `basketball@kscw.ch`, hardcoded `OWNER_EMAIL`) have no Directus user and no `members.email` row, so the bucketing helper defaulted them to DE — meaning forwarded copies arrived in German even when the underlying admin had `language=english`. Concrete repro: registering as `Livia Vuillemin (volleyball)` produced an English admin email to vb_admin Luca *and* a German copy via the OWNER_EMAIL CC, both reaching Luca's mailbox; he opened the German one. Same root cause for the `[KSCW] Datenanpassung` ClubDesk update email. Fix: `bucketEmailsByLocale` now returns `{de, gsw, en, fr, it}` and falls back to `members.email` when no `directus_users` row matches; `bucketMemberIdsByLocale` added for member-id callers; `EMAIL_LOCALES` exported. Translations added for the registration confirmation (volleyball / basketball / passive), admin notification, ClubDesk data-update mail, contact form, event invite, team-join request (in both `kscw-hooks` and `kscw-endpoints`), and `buildBroadcastEmail`. The `password-reset` email already had all five locales. Replaced the OWNER_EMAIL CC pattern in registration with a separate localized send (in the registering user's locale) so the alias receives a deterministic copy and never gets a duplicate German one of an English admin email. ClubDesk update mirrors the ADMIN_EMAIL into OWNER_EMAIL's resolved locale bucket for the same reason.

## [4.4.10] — 2026-05-03

### Fixed
- **Weekly unavailability did not override existing confirmed RSVPs.** If you had already RSVP'd ✓ to a Monday training and then created a weekly Monday unavailability, the participation row stayed `confirmed` — the personal training row's left strip rendered green via `useBulkParticipationStatuses` (which prefers an existing participation over an absence), while the roster modal labelled you "Declined (Absence)" via its absence overlay. Two views of the same data disagreed. Root cause: `autoDeclineForAbsence` in `kscw-hooks` did `INSERT … NOT EXISTS` (skipped any activity where a participation already existed) and there was no `participations.items.create` filter to catch the reverse case (RSVPing after the absence already existed). Policy decision: an absence hard-overrides the RSVP. Hook now UPDATE-then-INSERTs for trainings/games/events, and a new `filter('participations.items.create')` silently flips fresh RSVPs to `declined` + tags them with `auto_declined_by` when a covering absence exists. Migration 038 reshapes `trg_participations_clear_auto_marker` to mirror the trainings `auto_cancelled_by_closure` pattern (clear only when status changed AND marker unchanged) so the hook can write both fields in one UPDATE without losing the marker; manual-override semantics preserved (a user-driven status flip still detaches `auto_declined_by`). Backfilled 6 conflicting rows on prod.
- **Roster modal label and absence-coverage logic.** `ParticipationRosterModal.tsx` showed `Declined (Absence)` for any absence overlapping the activity date, regardless of `type`/`days_of_week`/`affects`. Switched the modal to use `absenceCoversActivity()` (already used by `useParticipation` and `useBulkParticipationStatuses`) so weekly absences only count on their declared days, and added `declinedUnavailable: 'Unavailable'` (en/de/fr/it/gsw) so weekly unavailabilities show "Unavailable" while one-off absences keep "Declined (Absence)".

## [4.4.9] — 2026-05-03

### Fixed
- **Push notifications were always sent in German regardless of `members.language`.** Every cron and event-driven push (`upcoming_activity`, `deadline_reminder`, team-join requests, scorer delegation accepted/declined, event invites, announcement fan-out, direct-message preview fallback) called `sendPushToMembers` once with a hardcoded German title + body. Web push payloads are baked at send time, so the recipient's in-app locale toggle could not localize them after delivery. New `directus/extensions/kscw-endpoints/src/push-i18n.js` provides `bucketMembersByLocale` (de / gsw / en / fr / it via `members.language`) and `tPush(locale, key, vars)` over an 11-key translation table. All eight call sites switched to `sendLocalizedPush`, dispatching one push per locale bucket. Announcement fan-out reuses its existing per-locale `translations` field (no new keys needed). Email templates were already DE/EN bucketed and were not changed.

## [4.4.8] — 2026-05-02

### Fixed
- **`user_logs` createRecord rejected with `Invalid query. Invalid numeric value.` for KSCW Members (WIEDISYNC-19, 36 users / 75 events).** The KSCW Member read policy on `user_logs` filtered `user._eq:$CURRENT_USER`, but `user_logs.user` is an integer FK to `members.id` while `$CURRENT_USER` resolves to the Directus user UUID. The INSERT succeeded; the post-insert SELECT through the RLS filter blew up parsing the UUID as integer. Patched permission filter on dev + prod to traverse the relation: `user.user._eq:$CURRENT_USER`.
- **`vm_sync` cron `spawnSync ETIMEDOUT`.** Monthly Volleymanager sync used `execSync` with a 120s timeout, blocking the Directus event loop the whole time and timing out on slower months. Converted to async `spawn` with a 10-min timeout, matching the SVRZ scheduling-sync pattern.
- **Sentry noise: `r.connection is undefined` from `@directus/sdk` (WIEDISYNC-3A).** SDK websocket re-auth race after the socket has already dropped. Realtime auto-reconnects; suppressed via `beforeSend` filter alongside the existing `No token for (re-)authenticating the websocket` suppressions.

## [4.4.7] — 2026-04-30

### Fixed
- **iOS Safari Invalid Date on bare `YYYY-MM-DD` columns.** All Zurich-zoned formatters in `src/utils/dateHelpers.ts` (`formatTime/Date/DateCompact/DateShort/Weekday/DateTimeCompact/RelativeTime`) used `input.replace(' ', 'T') + 'Z'` to coerce timestamps to UTC. For bare `date` columns (e.g. `trainings.date = '2026-05-07'`), the no-op replace + 'Z' produced `'2026-05-07Z'` — V8 silently parses it, JavaScriptCore (Safari/iOS) returns Invalid Date → formatters returned `""`. Symptom: weekday + date next to team chip on training cards rendered as "H3, " (just the comma). Replaced the inline parser with a shared `parseFlexible(input)` helper that anchors bare dates to `T00:00:00Z`.
- **Junction cascade pass 2 (migration 037).** Continuing migration 021. Five remaining M2M junctions had `ON DELETE SET NULL` on their integer FKs: `events_teams`, `events_members`, `hall_events_halls`, `hall_slots_teams`, `teams_sponsors`. Per the documented gotcha (`feedback_junction_cascade.md`), parent deletes leave orphan rows with NULL FKs that Directus serialises as the literal string `"null"` in `_in` filters → 400s on integer columns. Deleted existing orphans (5 in `events_teams`, 1 in `events_members`) and rebuilt the constraints as `CASCADE`. Applied dev + prod.

## [4.4.6] — 2026-04-30

### Fixed
- **Third-pass permission audit (migration 036).** KSCW Coach + Team Responsible `members.update` (fields=`position,number`) was NULL-filtered — coaches could edit number/position for any member via API. Scoped to members on a team I coach (Coach: `{member_teams:{team:{coach:{members_id:{user:{_eq:"$CURRENT_USER"}}}}}}`) / am responsible for (TR: `team_responsible` alias). KSCW Member reads on `event_sessions` + `events_members` scoped via parent event filter (mirrors `events.read` from 033). KSCW Coach reads + CUDs on `event_sessions` + `events_members` scoped via parent event = my-coached-team or my-created. Cleaned up duplicate `event_sessions`/`events_members`/`events_teams`/`hall_events_halls` permission rows left over from M2M re-creation. Out of scope: `member_teams`/`teams_coaches`/`teams_responsibles`/`teams_sponsors` — directory-level info legitimately readable across the club. Applied dev + prod.

## [4.4.5] — 2026-04-30

### Fixed
- **Second-pass permission audit (migration 035).** Removed public reads on `participations` / `events` / `events_teams` / `slot_claims` (the public website doesn't consume them; participations was a real privacy leak — every RSVP across the club was anonymously readable). KSCW Member reads on `polls` and `referee_expenses` scoped to teams I'm on (`{team:{members:{member:{user:{_eq:"$CURRENT_USER"}}}}}`). KSCW Coach reads on `participations` and `absences` scoped to teams I coach (mirrors the CUD scoping from migration 026). KSCW Coach polls CUD also scoped. Postgres-level: `REVOKE ALL ON event_signups FROM anon, authenticated` — defense in depth; PostgREST is stopped but the Supabase default grant was still in place. `tasks` left intentionally open: no `team` FK (only activity_type/activity_id strings), filter would need sub-query support that Directus doesn't have. Applied dev + prod.

## [4.4.4] — 2026-04-30

### Fixed
- **`spielplaner_assignments` had no member-side read perms.** Migration 031 created the collection but never inserted permission rows, so every non-admin user's `loadTeamContext` (`src/hooks/useAuth.tsx`) failed inside a `Promise.all`, leaving `memberTeamIds=[]`. Was masked by the wide-open reads in 4.4.1- — once 4.4.2/4.4.3 tightened reads to require team match, members started seeing no trainings/games/events and couldn't RSVP. Migration `034-spielplaner-assignments-read-perm.sql` grants self-scoped read (`{member:{user:{_eq:"$CURRENT_USER"}}}`) to every KSCW policy. Applied dev + prod.

## [4.4.3] — 2026-04-29

### Fixed
- **Member-scoped reads on absences, participations, events.** Continuing the audit in 4.4.2: `KSCW Member × {absences,participations,events} × read` all had `permissions = NULL`, so every member could read every other member's absence reasons, every RSVP across the club, and every event regardless of audience. Migration `033-member-read-team-scoping.sql` adds the `members.member_teams` o2m alias and scopes the rules: absences + participations to own + same-team-as-me; events to own + club-wide (`event_type ∈ {verein, tournament}`) + my-teams (via `events.teams`) + directly invited (via `events.invited_members`). Games left intentionally open (club-public schedule). Applied dev + prod.

## [4.4.2] — 2026-04-29

### Fixed
- **Trainings permission scoping.** `KSCW Member × trainings × read` had `permissions = NULL` (no row filter) — every member could fetch every team's trainings. Audit was triggered after Alex Leonhardt (member of H3 only) was seeing all 175 future trainings instead of his team's 11. Migration `032-trainings-team-scoping.sql` adds the `teams.members` o2m alias and scopes the rule to `{team:{members:{member:{user:{_eq:"$CURRENT_USER"}}}}}`. The `Public × trainings × read` row was also dropped — public never read trainings. Coach/Team Responsible/Sport Admin/Vorstand scopes preserved. Applied dev + prod.

## [4.4.1] — 2026-04-25

### Fixed
- **Set-score box alignment.** Per-set boxes in `GameCard` (games list) now use a fixed `inline-flex h-5 w-7` cell so single-digit scores ("8") render at the same width as double-digit ones ("25") — rows no longer jitter. `GameDetailModal`'s sets table also gets `table-layout: fixed` + `tabular-nums`. Same fix applied on kscw.ch (`global.css → .gm-sets`) for the public game modal.

## [4.4.0] — 2026-04-25

### Added
- **Tables convention.** New project-wide rule: any view of homogeneous data records uses shadcn `<Table>` (never card-stacks). Mobile compaction rules: names wrap to 2 lines, positions render as initials (S/O/M/D/L/G + BB equivalents), action toggles stack vertically on `<sm`, optional columns hide via `hidden sm:table-cell`. Reference impl: `RosterEditor`. Codified in `CLAUDE.md` + the `kscw-shadcn` skill, with explicit exceptions for event/activity cards (`GameCard`, `TrainingCard`, `EventCard`, `ScorerRow`), branded entity cards (`TeamCard`), and prose / release notes (`ChangelogPage`).
- **Absences page redesigned around two axes.** Two stacked button toggles (Absences | Unavailabilities × Mine | Team) replace the single 3-tab bar; new "Team Unavailabilities" view shows everyone's recurring weekly schedules in your team. Team scope is now visible to all team members (was coach/team-responsible only) — Directus permissions were already permissive, the gate was UI-only.

### Changed
- **9 list views converted to tables.** Roster editor, referee expenses, announcements, admin reports, audit log, registrations (Anmeldungen), absences (mine + team + weekly), Spielplanung list view, calendar unified list, news archive. Each gains proper column structure with mobile compaction; inline editing preserved everywhere it existed before.
- **Shared row components render `<TableRow>` directly.** `AbsenceCard` and `WeeklyUnavailabilityCard` now render single rows (not wrapping divs), so their parent pages wrap them in `<Table>` with consistent column layout. New `getPositionInitial()` helper in `memberPositions.ts`.

## [4.3.0] — 2026-04-24

### Added
- **Basketball Halle A+B combo booking.** New `games.additional_halls` JSON field (nullable, cast-json, tags interface) lets basketball home games block both KWI A and KWI B at once. The manual-game modal exposes a "KWI A + B (Basketball)" option at the top of the hall Select for basketball teams; the game detail drawer carries a one-click "Mark as KWI A + B" / "Back to single hall" toggle that patches the field in place (works on SVRZ-synced games too). Excel import recognises `A+B`, `KWI A+B`, `A + B` etc. for basketball rows.
- **Volleyball Saturday hall prefill.** When a Spielplaner creates a home game for a volleyball team on a Saturday, the hall field now prefills with a priority ladder: (1) the team's own Saturday training-slot hall, (2) KWI C, (3) KWI A, (4) KWI B — with a muted hint explaining why. The pick is only a prefill — admins can override freely.

### Changed
- **Conflict detection is now multi-hall-aware.** `hall_overlap` used to check exact-match halls only; it now checks any intersection between the candidate's hall set and each existing game's hall set. A basketball A+B game on Saturday 16:00 correctly blocks a volleyball-only game on KWI A or KWI B at the same time, and vice versa.
- **Hallenplan no longer hardcodes basketball → A+B by team sport.** The three internal helpers that used to infer the span from `team.sport === 'basketball'` now read `additional_halls`. A one-line backward-compat fallback keeps legacy basketball rows (no `additional_halls`) rendering the same span until they're re-saved — marked with a `TODO: remove after backfill` comment.

## [4.2.0] — 2026-04-23

### Added
- **Spielplanung sandbox mode.** Admins and Spielplaners can now create, edit, and delete manual games directly on the calendar. New `ManualGameModal` (shadcn Dialog) opens from the empty-day "+" affordance; edit/delete from the game detail drawer. Bulk Excel import for manual games with template download + per-row preview.
- **Scoped Spielplaner role.** New `spielplaner_assignments` collection lets admins grant per-team access without making someone a club-wide Spielplaner. Admin-only accordion on `/admin/spielplanung` to manage assignments.
- **Week view with drag-to-reschedule.** New Week option in the view toggle renders a 14:00–22:00 time rail with absolutely-positioned game blocks (2h 45min: 45min warm-up + 2h play). Manual games are draggable (`@dnd-kit` PointerSensor + TouchSensor); 15-min time snap; synchronous conflict guard against the loaded game set; toast on success / warning / error. SVRZ blocks are not draggable.
- **Conflict checking for manual games.** `same_team_same_day` and `hall_overlap` block creation/move with errors; same team within ±2 days surfaces as a soft warning.

### Changed
- **Richer month-view chips.** Time, home/away icon, opponent and colour-coded left border (emerald = home, blue = away). Manual games carry a dashed outline.
- **Unclamped month navigation + season dropdown.** Prev/next arrows cross season boundaries; a new season picker jumps between seasons directly.
- **Game detail drawer gained an edit mode** with SVRZ-field locking — official fields (date, time, hall, opponent, league, round, scores) are disabled against edit for SVRZ-synced games; only duty assignments stay editable. Manual games expose full edit + delete. A "Copy SVRZ details" button makes Volleymanager paste-back a one-click operation.
- **Route access.** Users with `is_spielplaner = true` or ≥1 row in `spielplaner_assignments` can access `/admin/spielplanung` (previously admin-only).

### Deferred
- SVRZ Volleymanager write-back (Phase 2, separate research spike). For now the drawer offers "Copy SVRZ details" for manual paste.

## [4.1.0] — 2026-04-23

- **SVRZ game-scheduling invites.** New admin-issued per-verein invite flow replaces self-service opponent onboarding on `/terminplanung`. Admin picks a KSCW team, clicks "Aus SVRZ importieren" → system proposes opponent clubs + Spielplanverantwortlicher contacts (primary source: per-game `getTeamContactInfosByGame`, fallback: club-level `svrz_spielplaner_contacts` feed). Admin edits/selects rows in a shadcn `Drawer`, clicks "Einladungen erstellen" → backend generates `crypto`-random tokens with 90-day TTL in `game_scheduling_opponents` (status `invited`), idempotent on `(kscw_team, season, email)`. One-click "Mail entwerfen" opens a pre-filled DE mailto via pure `buildInviteMailto`. Manual CSV paste (`parseInviteCsv`) handles opponents not in SVRZ. Full lifecycle: `invited` → `viewed` (first open transitions + sets `first_viewed_at`) → `booked` (after slot pick / away proposal), with reissue + revoke actions. Existing `/terminplanung/slots/:token` + `/book-home` + `/propose-away` now accept the new invite statuses.
- **Daily SVRZ sync.** Cron at 03:00 Zurich (`kscw-hooks/src/index.js`) + admin-triggered endpoint (`POST /kscw/admin/terminplanung/svrz-sync`) spawn `directus/scripts/svrz-scheduling-sync.mjs`, which pulls games + contacts from VolleyManager via paginated `/search` endpoints and upserts into two new Directus collections (`svrz_games`, `svrz_spielplaner_contacts`) by `svrz_persistence_id`. Shared auth extracted into `directus/scripts/vm-client.mjs`.
- **Schema.** `game_scheduling_opponents` extended with `season` (M2O → `game_scheduling_seasons`), `status` enum, `source` enum, `created_by_admin`, `first_viewed_at`, `expires_at`, `team_name`. `game_scheduling_seasons` gained `svrz_season_uuid`. KSCW Sport Admin policy has wildcard field perms, so new fields are auto-permitted.

## [4.0.6] — 2026-04-22

- **Delete individual notifications + clear-read bulk action.** Each row in the mobile `NotificationPanel` and desktop `SidebarNotifications` now has a trash icon that calls `deleteNotification(id)` (optimistic remove + rollback on 4xx). The header gained a "Gelesene löschen" / "Clear read" button next to "Alle gelesen" which only appears when there's at least one read notification — deletes all read ones in parallel via `clearAllRead()`. Unread are left alone so nothing urgent disappears. Member policy already had `delete` on own notifications (setup-permissions.mjs:411), so no Directus change needed. Strings added in all 5 locales.

## [4.0.5] — 2026-04-22

- **Report notification routing (desktop) + capitalised reason.** The desktop `SidebarNotifications.getNavigationPath` was missing the `new_report` / `activity_type === 'report'` case the mobile panel already had, so clicking "New report: spam" silently navigated to `/` instead of `/admin/reports`. Added the route + `member_join_request` → `/teams/:id` (also missing on desktop), plus Flag icon and `newReport` activity label in all 5 locales. Separately, the notification body's raw reason enum (`spam`, `harassment`, `inappropriate`, `other`) was interpolated verbatim into the message template; `renderMessage` now resolves each through `messaging:reportReason_*` before interpolation, so "Neue Meldung: spam" becomes "Neue Meldung: Spam". Applied in both `NotificationPanel` (mobile) and `SidebarNotifications` (desktop).

## [4.0.4] — 2026-04-20

- Mobile More sheet: `/inbox` moved to top of secondary list (was getting lost below `/events`).

## [4.0.3] — 2026-04-20

- **More sheet parity with desktop sidebar.** Added `/inbox` (messaging flag), `/news`, `/admin/announcements`, `/admin/reports`, `/admin/infra`, and `/options/messaging` in the Options accordion. Replaced hardcoded `v1.0.0` with imported `APP_VERSION`.
- **Full-row profile link in More sheet.** Whole picture + name + team-chips block is one `NavLink` to `/profile`; Logout stays as a separate button.
- **Desktop sidebar gained Status + What's New** so it matches mobile.
- **`/status` is now a health dashboard.** Green/amber/red banner + 4-row checklist (App server, Swiss Volley / Basketplan / GCal syncs) driven by `useInfraHealth()`. Recent fixes list preserved below.
- Changelog items use `text-justify hyphens-auto leading-relaxed`.

## [4.0.2] — 2026-04-20

- **Migration 030 — close 4 remaining `members.read` gaps.** Self-read row gains `is_spielplaner` (was hiding the Spielplaner menu for 7 members), `kscw_membership_active`, `beitragskategorie` (ProfileEditModal always showed "Passiv"). Cross-member row gains `kscw_membership_active` (fixes coach-only empty lists in scorer assignment + delegation), `shell`, `shell_expires` (shell badge in MemberRow). Applied dev + prod, both Directus containers restarted.

## [4.0.1] — 2026-04-20

- **Migration 029 — consent modal accept-loop.** The KSCW Member self-read permission on `members` never had `consent_decision`, `consent_prompted_at`, or the four `communications_*` / `push_preview_content` columns added when Plan 01 introduced them. `fetchMember()` fetches without `fields=`, so Directus stripped them → `user.consent_decision === undefined` → `resolveConsentState()` showed the modal forever. Same root cause silently broke the DM button, team-chat tab, and messaging settings toggles. Fix appends the six fields to the self-scoped row.

## [4.0.0] — 2026-04-20

- **Messaging live for all club members.** Staged-rollout gate (`VITE_FEATURE_MESSAGING_ALLOWLIST`) retired in favour of the global flag on CF Pages. Team chats, DMs, requests/blocks, reactions, edit/delete, polls, reports, nFADP export — all previously shipped in 3.11–3.12 behind the allowlist — are now available to everyone. Config flip + rebuild only; no code changes.
- 4.0 marks completion of the messaging milestone — the PocketBase → Directus rewrite's original scope is delivered.

## [3.17.1] — 2026-04-20

- "Coach da" badge now shows on game/training cards and home-appointment rows for player-coaches. `ParticipationSummary` needs `coachMemberIds` to detect coaches who RSVP as players; detail modals had it but list cards + homepage rows didn't. Added `teamCoachIds(team)` helper in `utils/relations.ts` (unions `team.coach` + `team.captain` + `team.team_responsible`) and wired it into `TrainingCard`, `GameCard`, and four home rows. Events kept `hideExtras` — multi-team events have ambiguous "coach present" semantics.

## [3.17.0] — 2026-04-20

- **Auto-cancel trainings on hall closure** — closure CUD hooks in `kscw-hooks` flip `trainings.cancelled=true` for matching future trainings; delete/shrink reverses the cancel. `auto_cancelled_by_closure` marker (auto-cleared by BEFORE UPDATE trigger on manual edits) prevents overwriting coach cancels.
- **Closure source priority** in `dedupeClosuresByPriority`: `school_holidays > admin > hauswart > gcal > auto`. Sportferien beats "Halle geschlossen" on the same hall + date.
- **Create-time auto-decline on events** (mirrors trainings/games). **Date-change re-eval** on trainings/games/events reverses stale auto-declines and inserts fresh ones for the new date. **Absence delete + shorten unwinds** its auto-declines; manual overrides preserved via `auto_declined_by` marker trigger.
- Migration 028 adds `participations.auto_declined_by` + `trainings.auto_cancelled_by_closure`.

## [3.16.7] — 2026-04-20

- Response-time on participation roster now shows for confirmed + maybe, not just declined. Directus `date_updated` is only written on UPDATE — first-time responses had `NULL`. Both player and staff rows fall back to `date_created`.

## [3.16.6] — 2026-04-20

- **Migration 026 — coach write scoping.** KSCW Coach had `{}` (fully open) row filters on CUD for trainings/games/events/event_sessions/slot_claims/task_templates/referee_expenses/scorer_delegations — a coach from team A could modify team B's data via raw `/items/*`. Scoped via the `teams.coach` M2M alias (20 rows updated).
- **Migration 027 — Sport Admin delete lock.** Dropped `members.delete` + `teams.delete` from Sport Admin (club-wide blast radius → full admins only); create + update preserved.
- **CSP `connect-src` tightened** — dropped `https://*.sentry.io` wildcards (events go through our tunnel worker).

## [3.16.5] — 2026-04-20

- **CRITICAL — Migration 023.** Empty-object row filters on KSCW Member for `messages`/`conversations`/`message_reactions`/`reports` let any authenticated member enumerate every DM + report via `/items/*`. Scoped via `conversation_members.member.user=$CURRENT_USER` (+ reporter/reported self-filter for reports).
- **Migration 024.** `email` + `phone` removed from cross-member `members.read`; self-read row keeps them.
- Rate limits: 5 reports/hour/member on POST `/kscw/messaging/reports`; broadcast per-sender global cap of 10/hour on top of the per-activity soft cap.
- Soft-delete now nulls `body` + `original_body`; moderation report snapshots pre-redaction.
- **Migration 025.** Dropped `status` from anonymous-create whitelist on `feedback`.
- Vite 8.0.2 → 8.0.9 + DOMPurify patched.

## [3.16.4] — 2026-04-20

- **Full i18n sweep.** `formatDate` / `formatDateCompact` / `formatTime` + Hallenplan month now follow `currentLocale()` (reads `i18n.language`). Admin pages (`ResultsTable`, `AuditLog`, `InfraHealth`, `DataHealth`, `ExplorePage`), profile + member birthdates, scorer helpers, `VolleyFeedbackPage` (now fully 5-locale). Stripped 48 German `defaultValue:` fallbacks; sorting uses `i18n.language` instead of hardcoded `'de'`.

## [3.16.3] — 2026-04-20

- Own RSVP now reflected on `/trainings` + `/games` cards — `useActivitiesWithParticipations` bypassed `stringifyIds`, so integer vs. string FK comparison failed; exported + applied the helper.
- "Show response time" toggle works again — `ParticipationRosterModal` read PocketBase's `participation.updated`, renamed to Directus's `date_updated`.

## [3.16.2] — 2026-04-20

- Weekday abbreviations on home appointments now follow app language (`formatWeekday` was hardcoded `de-CH`).

## [3.16.1] — 2026-04-20

- Consolidated ConversationPage loading — header + thread + composer now appear together behind a single spinner.
- Admin `new_report` notifications now route to `/admin/reports`.

## [3.16.0] — 2026-04-20

- Chat layout: other users on the right, own on the left (fixed numeric-vs-string sender comparison). "edited" tag is a clickable popover showing `messages.original_body` (migration 022). Reactions + ⋮ menu stay visible on mobile (`opacity-60` instead of hover-only). Realtime partial-field updates now merge instead of replace; edit action applies body/edited_at/original_body optimistically.

## [3.15.9] — 2026-04-20

- 2. Liga 2nd place now marked as barrage up (SVRZ Art. 102a.4). Talents/RTZ teams shift promotion/relegation markers to the next eligible non-talents team (Art. 102a.7).

## [3.15.8] — 2026-04-20

- Rankings side-banner colours aligned with SVRZ Art. 102a — every regional group gets 1st direct promotion, 2nd barrage up, 2nd-to-last barrage down, last direct relegation. Men's 4L is now the bottom league (men have no 5L).

## [3.15.7] — 2026-04-20

- Inbox race conditions — `fetchSeqRef` guards on `useConversation` / `useConversations` / `useConversationMembers`; `useConversation` clears on conv switch and merges realtime creates that arrived during the fetch. Sentry tunnel worker replaced bare `catch {}` with branch-specific logged reasons.

## [3.15.6] — 2026-04-20

- `/games` 400 `Invalid numeric value.` — orphan `teams_coaches` / `teams_responsibles` rows with `teams_id=NULL` leaked `"null"` strings into the `kscw_team: {_in: …}` filter. Fixed in `useAuth.tsx` + migration 021 deletes 13 orphans and rebuilds FKs as `ON DELETE CASCADE`.

## [3.15.5] — 2026-04-20

- ConversationPage crash — `<Button asChild><Link>…</Link></Button>` passed `[null, <Link/>]` to Radix Slot → `React.Children.only` threw; `button.tsx` now skips the icon/loading fragment when `asChild`. CSP `connect-src` allows `cloudflareinsights.com`; added standard `mobile-web-app-capable` meta.

## [3.15.4] — 2026-04-20

- Single-round-trip `/games` + `/trainings` via new `POST /kscw/activities/:type/with-participations` (kills the ~1s empty-card flash on mobile). New `useActivitiesWithParticipations` hook; RBAC preserved via `req.accountability`.
- Games page splits Kommende + Resultate into "Meisterschaft" + "Cup" sections.

## [3.15.3] — 2026-04-20

- Event / Training / Game detail modal decluttering: `ParticipationSummary` uses the `bars` variant everywhere; `BroadcastButton` moved to modal header via new `Modal.headerAction` prop; roster button reduced to 44×44 icon-only.

## [3.15.2] — 2026-04-20

- **Migration 020 — Coach policy parity.** Added 12 perms (`teams.update`, `member_teams.create/update`, `team_requests.update`, `hall_slots.create/update` + `hall_slots_teams` CUD, `polls.create/update/delete`) to close 403s on UI-exposed paths (RosterEditor, TeamDetail, SlotEditor, PollsSection). Soft-rejects pending signups: `TeamDetail.handleReject` flips `kscw_membership_active` + `wiedisync_active` to `false` and clears `requested_team` instead of hard-deleting.

## [3.15.1] — 2026-04-19

- **Coach-event 403 fix.** M2M writes use junction-object format (`[{teams_id:3}]`); **migration 019** adds `events_teams` / `events_members` / `event_sessions` CUD to Coach + Admin policies.

## [3.15.0] — 2026-04-19

- **Datetime convention: proper UTC everywhere.** Migrated from wall-clock-labelled-UTC to proper `timestamptz` rendered via `Intl.DateTimeFormat({ timeZone: 'Europe/Zurich' })`. 9 new Intl-Zurich helpers in `dateHelpers.ts` (legacy formatters one-line-delegate). Backend email + iCal paths migrated. One-shot DB migration on 6 datetime columns with DST-aware round-trip helpers.

## [3.14.0] — 2026-04-19

- **Broadcast Plan 02 — in-app chat channel (event-only).** `inApp` channel creates a persistent `activity_chat` conversation per event and posts the broadcast as a message there. Participants (confirmed/tentative) auto-join via Postgres trigger on `participations`; declining auto-archives. Migrations 015–017. Honors `communications_team_chat_enabled`; banned users excluded.

## [3.13.0] — 2026-04-19

- **Broadcast v1.** Coaches/TRs/admins contact event/game/training audience via email + push (in-app deferred to 3.14). RBAC via teams, rate limit (3/hr + 20 min spacing), audit table. Generic `event_signups` replaces `mixed_tournament_signups`.

## [3.12.0] — 2026-04-19

- **Messaging v1 to prod (silent, allowlist-gated).** 4 SQL migrations, 32 team convos + 661 memberships backfilled. Hardening: revoked Supabase anon/authenticated grants on all 43 public tables; stopped all Supabase API containers except the DB.

## [3.11.x] — 2026-04-17

- **Vereinsnews.** Admin `/admin/announcements` + homepage News card + archive. `isSafeAppLink` rejects `javascript:` / `data:` CTAs; audience_teams/roles dropped from member read; mass-email confirm dialog.

## [3.10.0] — 2026-04-17

- **Admin Daten-Explorer `/admin/explore`** — hierarchical read-only browser, batched cache, fuzzy search, URL deep-link, sport-admin scoping.

## [3.9.x] — 2026-04-14 / 04-17

- Coach/TR inline participation editing in roster modal (3.9.0). Team page load-flash fix, team join-request notification hook, case-insensitive email lookup, team season normalisation + auto-rolling cron (3.9.1–3.9.4).

## [3.8.0] — 2026-04-10

- **Interactive guided tours.** 10 React Joyride tours, welcome modal, `/guide` menu, per-page "?" button.

## [3.6.0] — 2026-04-05

- **SV licence card** from `sv_vm_check`. Expanded VM sync (16 columns) with `vm_email` claim flow. Junction table PK fix + rename resolved 10 Sentry issues.

## [3.5.0] — 2026-04-05

- Shell-member detection (`shell=true` + `shell_expires`) with roster badge. `vm_email` claim flow during registration.

## [3.4.0 / 3.3.0 / 3.2.0] — 2026-04-04

- Hetzner VPS rollout (Supabase + Directus), DNS cutover, Web push via CF Worker, Sentry de.sentry.io/kscw/wiedisync wiring, 30+ KSCW endpoints, 9 Postgres triggers.

## [3.1.0] — 2026-03-31

- Error-log annotations (solved / important / open).

## [3.0.0] — 2026-03-29

- **Directus RBAC: 7 roles, 322 permissions, role-sync hook** — Admin, Coach, Sport Admin, Team Responsible, Vorstand, Member, public. Auto-admin new members with roles on approval.

## [2.7.0 – 2.9.0] — 2026-03-28 / 03-29

- Directus migration complete. Security hardening, branded emails (SMTP), web push, SSO via Directus auth, 9 Postgres triggers (slot claim validation, shell invites, coach approval guard, game-sync skip-without-away-team, etc.).

## [2.1.0 – 2.6.x] — 2026-03-24 / 03-26

- OTP login, team settings accordion, RSVP improvements, team photo zoom, referee expenses module, coach visibility on roster, RSVP timestamps.

## [2.0.x] — 2026-03-23

- Scoreboard tab, W/L splits, Hallenplan free-slot improvements, scorer delegation flow, API rules schema (coach/player dual-role on team-scoped tables).

## [1.1.0] — 2026-03-22

- PocketBase migrated from systemd to Coolify on VPS. Dockerfile, env-var secrets, CI job for hook lint, URLs consolidated on `kscw.ch`, Uptime Kuma at `status.kscw.ch`, Telegram alerts.

## [1.0.x] — 2026-03-19 / 03-20

- **Core platform launch.** React 19 + TS + Vite + Tailwind + PocketBase; CF Pages + Infomaniak VPS (CF Tunnel); 4 UI languages + Swiss German. Email + Google OAuth login, role approval, privacy + GDPR deletion. Games + Scoreboard + Calendar + Trainings + Participation + Absences + Events + Teams + Roster Editor + QR-code invite system + Hallenplan + Admin Mode + Notifications + Navigation + Admin Tools + Legal pages + Location autocomplete + Feedback/bug reporting. Member field renamed `active` → `kscw_membership_active`.
