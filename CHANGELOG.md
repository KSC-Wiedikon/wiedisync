# Changelog

All notable changes to Wiedisync, consolidated into release eras (newest first). Each era summarises a range of point releases; for the full per-version detail see `git log` and the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`).

## v4.25 — 2026-06-08

- **v4.25.0 — Intra-club derby anchoring (Art. 27 SVRZ)**: when two KSCW teams share a league group (e.g. H1 & H3 in 2L), SVRZ Art. 27 Abs. 6 requires their two head-to-head games to be the first game of the Vor- and Rückrunde (home team forfeits otherwise — and the Spielplanraster's order is overridden). New `game_scheduling_derbies` table (migration 090) + admin **DerbyPanel** in the scheduling setup: detects pairs from the all-KSCW fixtures in the synced SVRZ feed, surfaces the round the feed currently files them under (e.g. "Runde 7"), and lets the spielplaner fix the two dates (one Vorrunde leg, one Rückrunde leg; confirming requires one per half). Once confirmed, `game-scheduling.js` clamps the opponent flow for BOTH teams — home-slot offers, the away-date calendar, and the away-proposal server check — to dates after the relevant derby date per half, and feeds the derby dates into the game-spacing gap. Vor-/Rückrunde boundary derived as 01.01 of the season's second year (no config). The derby table is endpoint-gated (knex, admin/spielplaner) — no item permissions; inert until a derby is confirmed. New `gameScheduling` i18n ×5 + `away_before_derby` opponent message. Deployed to dev + prod (migration 090 + ext deploy on both).

## v4.24 — 2026-06-08

- **v4.24.1 — Coaches section on the team page + team-chat hidden for non-participants**: non-playing coaches are pulled out of the player roster into a dedicated **Coaches** table on `TeamDetail` (mirrors the Guests table). Split rule: a member in `team.coach` with no real playing position (only `other`/empty) is treated as non-playing staff and excluded from `rosterMembers`/`guestMembers`; a **player-coach** (coach who also has a playing position) stays in the roster with their coach badge. The section also fetches coaches attached only via `teams_coaches` (no `member_teams` row) so it's complete on any team. The **team-chat section now hides entirely for non-participants**: `TeamMessagesSection` owns the `useConversations` lookup and returns `null` when team chat is enabled but, after the conversation list loads, the caller has no conversation for this team (e.g. an admin/coach viewing a team they're not on) — previously this sat on "Loading messages…" forever. Members who turned team chat off still see the section so the "enable team chat" banner can prompt them. `TeamMessagesTab` refactored to receive `conv`/`isLoading`/handlers as props (no duplicate subscription). New i18n: `teams.coaches` + `messaging.notTeamMember` ×5 locales. Frontend-only; no migration/perms.

## v4.23 — 2026-06-07

- **v4.23.3 — Terminplanung first-load + contention fixes**: (1) the public opponent flow (`useAvailableSlots`, `PublicTerminplanungPage`) called the token endpoints through `kscwApi`, which attaches a logged-in member's Bearer; a stale access token then made Directus reject with 401 *before* the public endpoint ran, surfacing as "Invalid link" on first load (a reload masked it by refreshing the token). New `kscwApi` `anonymous` option sends no `Authorization` + skips the 401-refresh retry; all `/terminplanung/*` calls now use it. Real opponents (no token) were never affected — only logged-in members opening links. (2) Dashboard "also proposed by N other clubs" (`AdminDashboardPage` → `HomeProposalReview`) counted other *bookings* in a ±2-day window, but each opponent has two bookings (home + away), so an opponent's own away leg counted as a club and away dates leaked across teams. Replaced with an exact home-slot → distinct-other-opponents index; the away warning was removed (away games are in each club's own hall, so "another club also proposed this" can't apply). (3) Scheduling emails (`game-scheduling.js` / `terminplanung-emails.js`) now use the branded `buildEmailLayout` template + Swiss `fmtDateMail` dates (was leaking raw `Date.toString()`), From normalised to `volleyball@spielplanung.kscw.ch`. Frontend + backend-extension; no migration/perms. Verified on dev: 10-team slot/absence assertion pass + a 5-team propose→confirm email cycle, plus a live dashboard check of the contention count.
- **v4.23.2 — Aligned characteristic column + settings collapsed**: player characteristic badges (captain `C` / coach / TR / guest) moved out of the trailing-after-name position into their own fixed-width, aligned column — in the participation roster modal (`ParticipationRosterModal`, new `w-14` slot + `min-w-[120px]` right-aligned status so the column lines up) and in the team-detail **Guests** table (new dedicated `GUEST` column via `MemberRow` `showGuestColumn` prop + `guestCol` header ×5 locales; the regular roster table is unchanged). Team-settings accordion reverted to **collapsed by default** — `SettingsGroup` `defaultOpen=false`, explicit `defaultOpen` removed from Website/Features, `FinesSettings` `useState(false)` — reversing the v4.23.0 open-by-default flip. Frontend-only; no migration/perms.
- **v4.23.1 — Upload fix (all `FormData` call sites)**: file uploads were silent no-ops — they passed a `FormData` body to `create/updateRecord()`, but the Directus SDK's `createItem`/`updateItem` does `JSON.stringify(body)` and `JSON.stringify(FormData) === '{}'`, so an empty request "succeeded" and the toast said "Saved" while nothing persisted. Fixed in **all four** affected spots — team picture (`RosterEditor`), member photo (`ProfileEditModal`), sponsor logos (`TeamSponsorsEditor`), and the admin Daten-Explorer file fields (`RecordEditModal`) — each now uploads via `uploadFile()` (`POST /files`, real multipart) then sets the FK with a plain-JSON update. Sponsor create additionally switched to the M2M junction-object format (`teams: [{ teams_id }]`) instead of the old flat append. (`AnnouncementsPage`/`FeedbackPage` already used raw `fetch(/files)` — untouched.) New `useAuth().refreshUser()` re-fetches the member after a profile save so the new photo shows without a reload. Leave-team handlers (ProfilePage + TeamRequestModal) no longer swallow delete errors silently — they surface a `leaveTeamError` toast (×5 locales). Frontend-only; no migration/perms. **Note:** coaches/TRs reach the sponsor editor (via `isCoachOf`) but currently only hold `sponsors` **read**, not write (write is Sport Admin + full Admin) — so sponsor management works for admins; granting coach/TR sponsor write is a separate, deliberate permission decision.
- **Leave a team from the Teams page**: `TeamRequestModal` is now a combined "Manage teams" modal (join-request + per-team leave with inline confirm); Teams-page button relabelled `manageTeams`. New `useAuth().refreshTeamContext()` re-derives team context after a leave so cards/counts update without a reload (also wired into ProfilePage's existing inline leave). i18n `manageTeams`/`manageTeamsTitle` ×5. ProfilePage's modal stays join-only (`showLeave={false}`) since it already exposes inline per-team leave.
- **Settings default open**: the team-settings accordion `SettingsGroup` default flipped to open (Game Defaults + Training Defaults were collapsed; Website + Features already open) and `FinesSettings` starts open. Non-settings collapsibles (scorer info, referee-expense, admin explorer, Spielplanung import) left untouched.
- **`fine_rules` permission fix** (`setup-permissions.mjs`): the Member read filter walked `teams.member_teams`, which is not a relational field → `Invalid query` that broke `fine_rules` reads on the home page + roster editor for **everyone** (surfaced via repeated DU23-1 roster-editor errors). Corrected to the `teams.members` o2m alias. Applied via `db:setup-perms:dev` + `db:setup-perms:prod`.

## v4.22 — 2026-06-05

Forms v2 — submission UX, roster-aware tracking, file/multi-language fields, and public forms.

- **Submission UX** (migration **088** `forms.success_message` + `form_submissions` BEFORE UPDATE guard): owner-on-submission notification (`kscw-hooks` `action('form_submissions.items.create')` → new `notifyFormSubmission` → in-app `form_submission` + per-locale push `formSubmission.*`; notifies `created_by` ∪ coaches/TRs of the form's teams, minus the submitter); editable submissions (Member `form_submissions.update` on own rows, fields `['answers']`; the new UPDATE guard re-checks open + `closes_at`, no dedup); custom `success_message` + "Submit another"; server-side required-field validation via `filter('form_submissions.items.create')`. `FormFillModal` gains an `existing` prop (prefill + update) and a success view; `useFillableForms` now returns `{ form, submission }` so Home/Forms show **Edit** for answered, still-editable forms.
- **Roster-aware tracking** (new `kscw-endpoints/forms.js`): `GET /kscw/forms/:id/stats` (targeted ∪ responded ∪ non-responders) + `POST /kscw/forms/:id/remind` (author-scoped, per-(user,form) rate-limited, push + in-app `form_reminder`). Surfaced in `FormResponsesModal` as an "X / Y responded" bar + "Remind non-responders". Refused for anonymous/public forms.
- **File upload + multi-language** (no schema): new `file` field type (`FieldDef.type='file'`, uploads via `api.uploadFile` → `directus_files`, stored as `{id,name}` in `answers`, rendered as a download link + exported as asset URL); optional per-locale `label_i18n` on each field (`resolveFieldLabel` in `modules/forms/labels.ts`, builder "Translate" panel ×5 locales).
- **Public forms** (migration **089** `forms.is_public` + unique `slug`; `kscw-endpoints/public-forms.js`): `GET /kscw/public/forms/:slug` + Turnstile-protected `POST /kscw/public/form-submit` (anonymous, knex-context insert, member NULL — no public Directus policy, mirroring `registration.js`/`public-events.js`; INSERT guard still enforces open/deadline; owner-notify replicated). Builder gains a full-manager-only "Public form" toggle + auto-generated slug (shows the live address); manage table shows a "Public" badge + copy-link. The form is served **in-app** at a public, no-login route `/f/:slug` (`PublicFormPage`, reuses `FormFieldRenderer` + `@marsidev/react-turnstile` with the same site key as SignUp) — so a public form has a working shareable address automatically, no separate website page.
- **i18n** — `forms` namespace (en + de) expanded; `form_submission` + `form_reminder` notification messages ×5; `formSubmission.*` + `formReminder.*` push ×5.
- Deployed to **dev**: 088/089 applied, `setup-permissions` reconciled, kscw-hooks/kscw-endpoints rsynced + dev restarted. Frontend `tsc` clean. **Prod pending** (088/089 via `db:migrate:prod`, `db:setup-perms:prod`, `ext:deploy:prod`, merge `dev`→`prod`; kscw-website public-form pages stay dev/preview until released).

## v4.21 — 2026-06-05

- **Forms** (migrations **086** `forms` + `form_submissions` + submission-guard trigger, **087** `forms_teams` M2M): native internal form builder — the build-vs-buy alternative to OpnForm (which can't export PDF, only scopes per workspace not per team, and is a second system). `forms.fields` JSONB field definitions (short_text/long_text/single_choice/multi_choice/number/date/yes_no); `form_submissions.answers` keyed by field id; `BEFORE INSERT` guard enforces open-only + `closes_at` + per-member dedup. The `forms_teams` M2M was built via **reproducible SQL replicating `events_teams`** (verified resolving via `/relations` + an `/items` expansion), NOT the admin UI — so it reproduces to prod with `db:migrate:prod`.
- **Permissions** (`setup-permissions.mjs`): Member reads non-draft forms scoped club-wide ∪ own-team + creates/reads own submissions (anonymous forms allow `member` NULL via an `_or` self-scope); Coach/TR authors forms for teams they coach/TR (+ `forms_teams` junction CRUD) and reads their forms' submissions; Vorstand read-all; Sport Admin full CRUD.
- **Frontend** `src/modules/forms/` — FormsPage (manage table + "open for you"), FormBuilder (minimal field-list editor + live preview, no drag-drop), FormFieldRenderer (shared by builder/fill), FormFillModal, FormResponsesModal (responses `<Table>` + CSV/Excel/JSON/PDF export reusing `exportResults` `toCSV/toJSON/toXlsx` + `html-to-image`/`jspdf`). New `useUserVisibleFormIds` two-step junction hook avoids the M2M deep-filter + policy-walk silent-`[]` trap. Route `/forms` + nav entry (desktop + More sheet).
- **Notifications** — `kscw-hooks` `forms.items.create/update` → `notifyFormPublished` fires once when a form goes `open` (deduped on an existing `form_published` notification), inserting one in-app notification (`type:'form_published'`, `activity_type:'form'`) + per-locale web push (`formPublished.*` in `push-i18n.js`) to the scoped audience (club-wide = all active; teams = `member_teams ∪ teams_coaches ∪ teams_responsibles`).
- **i18n** — new `forms` namespace (en + de; fr/it/gsw fall back per i18next), `form_published` notification message ×5, `nav.forms` ×2.
- Deployed to **dev**: 086/087 applied, `setup-permissions` reconciled (431 perms, 0 errors), `SCHEMA.sql` baseline regenerated, kscw-hooks/kscw-endpoints rsynced + dev restarted (healthy). Frontend `tsc` clean. **Prod pending** (apply 086/087 via `db:migrate:prod`, `db:setup-perms:prod`, `ext:deploy:prod`, merge `dev`→`prod`).

## v4.17 – 4.20 — 2026-06-01 → 2026-06-03

- **Absences `blocking` flag** (migration **076**, `NOT NULL DEFAULT true`): independent "Blocks game scheduling" toggle; `game-scheduling.js` ANDs `a.blocking IS NOT FALSE` into the home-slot and away-proposal queries. The per-player RSVP auto-decline cascade is deliberately untouched — `blocking` governs only team-level scheduling.
- **Per-member auto sign-in** (migration **077**: `members.auto_confirm_{trainings,games,events}`): OR-ed with the team-level `training_auto_confirm` / `game_auto_confirm` in `kscw-hooks`; backfill on flag flip-on; new idempotent `game-auto-confirm-sweep` covers raw-knex synced games (SVRZ/Basketplan) that bypass `games.items.create`.
- **Volleymanager = source of truth** (migration **081**, sync moved monthly → weekly Mon 04:00 UTC): `vm-sync-check.mjs` writes `teams.{name,full_name,league}` **update-only** (matched on `vb_<staticTeamIdentifier>`); referee licences → `members.referee_vb` + `sv_vm_check.referee_assoc`; kscw-website keys team defs by the live name (season/swap-robust).
- **Team absence calendar**: `TeamFilter` → `TeamMultiSelect` (multi-team), same-day absence/unavailability collapsed to one "Absent / Unavailable" row, distinct-member count, "Show weekly unavailabilities" (on) + "Show non-blocking absences" (off) toggles.
- **Season fallback**: `useEffectiveSeason` moved client-side over a `groupBy: ['season']` aggregate (`fetchSeasons`) — Directus rejects `_lte` on a string field. **Migration 075** strips archived-team `hall_slots_teams` links left by the rollover; the rollover now re-points junctions instead of duplicating.
- **Status page**: per-source "Run now" buttons (`POST /kscw/admin/vm-sync` + `/svrz-sync`, fire-and-forget, recorded via `sync_runs` heartbeat).

## v4.14 – 4.16 — 2026-05-30 → 2026-06-01

- **Fines service** (migration **069**+): `fines` + `fine_rules` collections with a PL/pgSQL escalation engine (`kscw_current_season_start`, `kscw_fine_window_start`, `kscw_compute_fine_amount`); per-team scope via junction walk; push + in-app on issue/paid/waive; daily 09:00 UTC reminder cron for fines open >14 days; 5-locale i18n; coach-dashboard "Fines this month" card; late-confirmation prompt pre-fills from the escalation engine (leader-confirmed, never silent).
- **PWA install** (frontend-only): mobile login banner (per-device dismissal) + "Install the app" Guide entry; native install on Android/Chrome, illustrated Share → Add to Home Screen on iOS Safari.
- **Scorer duty** All/Selected toggle (team duties vs personal sign-ups); fines page spinner-while-loading.
- **Roster modal**: per-training `excluded_guest_levels` drop from the staff view; games unconditionally exclude `guest_level > 0`.

## v4.9 – 4.13 — 2026-05-13 → 2026-05-21

- **Hall-slot cascade**: backend `action('hall_slots.items.update')` cascade + nightly cron keeping a rolling ~12-week horizon for indefinite slots; slot delete cascades to future trainings + participations; `kscw.skip_trainings_notify` transaction GUC suppresses bulk push during cascade/cron (manual creates still notify).
- **Trial trainings** (migrations **055–056**): reflexive AFTER-INSERT trigger on `trainings` collapses trial/regular pairs in place (no duplicate sibling).
- **Auto-confirm**: per-activity override `auto_confirm_rsvp` nullable boolean (migration **048**); retroactive backfill on team toggle with `NOT EXISTS` guard; cascaded trainings auto-RSVP.
- **Third-party absence edits** (migration **051**: `last_edited_by`/`last_edited_at`): attribution line in UI, in-app + web push (8 i18n keys ×5); coaches manage their roster members' absences server-side-scoped.
- **Admin tools**: Data Explorer member-filter popover (chips + tri-state toggles: sport/position/licence/contact/consent); `/admin/sql` superuser-only CodeMirror workspace (live schema autocomplete, 15s timeout, 1000-row cap, audit trail).
- **Other**: email now required (+ blanking trigger); public team page + recruiting positions; cancelled-training team notifications; `dd.mm.yyyy` normalization; hide-email privacy flag.

## v4.8.x — 2026-05-12

- **Auto-confirm RSVP** (opt-out attendance, PlayerPlus-style): `training_auto_confirm` / `game_auto_confirm` in `teams.features_enabled`; `INSERT … SELECT … NOT EXISTS` pass in the create hooks (respects guest exclusions, never overwrites a manual RSVP).
- **LEADER policy decoupled from the Directus role** → attached per-user via `directus_access` from `teams_coaches` / `teams_responsibles` membership; `trainings`/`events` read+delete scoped via coach/TR M2M traversal; coach team-settings writes restored after the permissions refactor.
- **Security audit** (eight Fix-this-week findings): `/events/:id/notify` gated; audit-log gate → `req.accountability.admin`; `trg_participations_guest_block` scoped to the game's own team (migration **050**); HTML-escape email/form inputs; push URL https + provider allow-list; OAuth state nonce + 2-min TTL; `safeDateStr()` on date interpolation.
- **Participation modal**: staff seeded from team junctions (coaches without a `member_teams` row now visible); coach RSVPs visible via `useCollection` auto-invalidation; single-scroll layout fix.

## v4.4 – 4.7 — 2026-04-25 → 2026-05-10

- **Tables everywhere**: rosters, announcements, audit logs, registrations, referee expenses, absences → `<Table>` with mobile compaction rules.
- **Edit attribution** (migrations **046–047**): per-field `last_status_edited_*` / `last_note_edited_*` on participations; BEFORE-UPDATE triggers clear markers only on manual edits; coaches edit player notes from the roster modal.
- **Coach dashboard** (migration **041**): per-team `dashboard_range_from/to` + `dashboard_league_only`, Coach/TR read+update scoped, persisted per team.
- **Availability**: weekly unavailability hard-overrides an existing confirmed RSVP (migration **038**); `absenceCoversActivity()` respected in every view.
- **Roster export** CSV/PNG/PDF (activity header + position summary); mobile bottom-sheet scroll refactor + drag-to-dismiss.
- **`/status`** real cron heartbeats (`sync_runs`, `logCronRun()`, new `gcal_sync` cron 04:00 UTC); **`dd.mm.yyyy` + 24-hour** app-wide (hardcoded `de-CH`); i18n emails + push (5 locales); localhost forces dev Directus + `npm run dev:prod` reverse-proxy for live data.

## v4.0 – 4.3 — 2026-04-20 → 2026-04-24

- **Messaging live for all members** (flag flip; `VITE_FEATURE_MESSAGING_ALLOWLIST` retired in favour of a global CF Pages flag).
- **Spielplanung sandbox**: manual game CRUD on the calendar + bulk Excel import, scoped `spielplaner_assignments`; week view with drag-to-reschedule (15-min snap, conflict guard); SVRZ field locking.
- **SVRZ scheduling invites**: admin-issued tokenized per-verein links, 3-tier contact match, CSV paste fallback, invited → viewed → booked lifecycle; daily SVRZ sync cron.
- **`games.additional_halls`** JSON field (basketball Halle A+B combo booking with cross-hall conflict detection); Saturday volleyball hall prefill.
- **Permission audit passes** (migrations **032–036**): member/coach-scoped reads + CUD, Sport Admin delete lock, `spielplaner_assignments` self-read.
- **Notifications**: delete individual + bulk-clear read in one click; moderation-report routing + localization.

## v3.12 – 3.17 — 2026-04-19 → 2026-04-20

- **Messaging system**: team conversations, DMs, polls, reactions, reports; consent tracking + 12-month retention; RLS member visibility.
- **Vereinsnews + Broadcast v1/v2**: email/push (rate-limit 3/hr, 20-min spacing, nFADP audit logging, `event_signups`); in-app event chat with RSVP-driven membership.
- **Daten-Explorer**: read-only hierarchical browser with fuzzy search, deep-linking, sport-admin scoping.
- **Coach permissions** (migration **020**): `trainings.read/delete`, `teams.update`, `member_teams` CUD, `hall_slots` CRUD; Supabase anon/authenticated revoked across 43 tables.

## v3.5 – 3.11 — 2026-04-05 → 2026-04-17

- **React Joyride guided tours** (10 tours, per-role filtering, i18n ×5; "?" launcher on every page).
- **Volleymanager sync extended** (16 columns: nationality, LAS, foreigner status, federation, `vm_email` claim flow) → SV licence card on the profile.
- **Shell-member lifecycle** (migrations **017–018**) + roster badge.
- **Infra**: server move to Hetzner VPS (Directus + Supabase), DNS cutover, 30+ KSCW custom endpoints, 9 Postgres triggers, Sentry, web push via CF Worker.
- **Coach inline participation editing**; team-defaults accordion (min players / RSVP deadline / note requirement / auto-cancel); public `/status`.

## v2.7 – 3.4 — 2026-03-26 → 2026-04-04

- **Directus RBAC**: 7 roles, 322 permissions, role-sync hook on member/team changes, per-role policy scoping; auto-approve into the right role on signup.
- **Branded SMTP** templates (password reset, invitations, OTP, scorer reminders); **Google OAuth** login.
- **Web push** notifications via Directus extensions + CF Worker.
- **Daily sync** with Swiss Volley + Basketplan (scoreboard + standings).
- **9 Postgres triggers** (slot-claim validation, shell invite, coach approval, game-sync skip-without-`away_team`, dedup, absence overlap, participation auto-decline, trial-training transform, notify suppression); Sentry (`de.sentry.io`, org `kscw`); injection/HTML-escape/rate-limit hardening.

## v1.0 – 2.6 — 2026-03-19 → 2026-03-26

- **Initial platform** on PocketBase (React 19 + TypeScript + Vite + Tailwind + CF Pages).
- Email + Google OAuth login with role approval, privacy settings, GDPR account deletion.
- Realtime RSVP (Yes / Maybe / No), participation notes, guest counter, recurring-training selection.
- Teams/members, Schreibereinsätze (scorer duty) with delegation, Hallenplan with virtual slots + claiming, sport-scoped roles, team settings, referee expenses.
- Scoreboard (Total / Per-Game toggle) + public embed page; location autocomplete; feedback/bug reporting; multi-language navigation.
- Deploy: PocketBase migrated systemd → Coolify VPS; CF Tunnel + Infomaniak VPS; Uptime Kuma status page; Telegram alerts.
