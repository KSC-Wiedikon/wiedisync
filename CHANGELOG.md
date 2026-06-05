# Changelog

All notable changes to Wiedisync, consolidated into release eras (newest first). Each era summarises a range of point releases; for the full per-version detail see `git log` and the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`).

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
