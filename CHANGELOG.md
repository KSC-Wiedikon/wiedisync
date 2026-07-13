# Changelog

All notable changes to Wiedisync, the KSC Wiedikon members' platform. This file is the curated, user-facing release record (English, semver), mirrored in the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`). For commit-level detail see `git log`; for the operator/deploy history see `docs/DEVLOG.md`.

## v1.41.0 — 2026-07-13

### Fixed: the member list was empty when inviting people to an event
- **If you are a coach or a team responsible, creating an event now shows the full member list again.** The invite picker was coming up empty — not because nobody matched, but because the app was not allowed to read one of the fields it was searching on, so the request was rejected and the list silently came back blank. No error was ever shown, which is why it looked like "no members found". Fixed for every coach and team responsible.

### For admins: ClubDesk consistency check
- The ClubDesk sync page now has a **Consistency check** that lists everything which has drifted between ClubDesk and Wiedisync, with an Excel worklist to work through: members in **no ClubDesk group**, members **missing** their team's group, **coaches** missing their coach group, people **in a ClubDesk group but not on the roster**, and members **paying a playing fee while on no roster**.
- Each team's ClubDesk group is now stored on the team itself, so a new team can no longer be silently skipped by these checks.

## v1.40.0 — 2026-07-13

### Data explorer: ClubDesk sync + registration files
- **New "ClubDesk sync" column** — see at a glance whether each member matches the club register: *In sync*, *Drift* (a field differs), *Pending push*, *Not linked*, *Stale link* or *Departed*. Groupable, so you can pull up everyone who is out of step.
- **New "Reg. files" column** — the documents a member uploaded when they registered are kept after approval, and can now be opened straight from the grid.
- **The column header row and the name column stay put while you scroll**, so you always know which column you are looking at.
- **More inline editing**: sex and preferred language are now dropdowns, and scorer (VB) / Wiedisync active toggle with a click. Yes/no columns show a checkmark only when true, so the ones that are set stand out.

### Your registration documents
- **Profile now has a "My documents" card.** The ID and licence documents you uploaded when you registered are kept, and you can open them again any time. It only appears if you have documents.

## v1.39.0 — 2026-07-12

### Data explorer: team view
- **The grid now has a Members | Teams toggle.** The team view lists every team with its full roster, coach and team responsible as editable chips — add or remove people with a searchable picker, and edit team name, full name, league and season in place.
- **Nine more member columns**: sport, scorer (VB), referee (VB/BB), officials licence, Wiedisync active, last online, and passive / honorary / former membership (from the club register).
- Export, sorting, search and the column chooser work in both views.

## v1.38.0 — 2026-07-12

### Club news in your notifications
- **Published announcements now appear in the notification bell** for everyone in the announcement's audience, with a megaphone icon — tapping one opens the news page. Works regardless of email/push preferences, like all in-app notifications.

## v1.37.0 — 2026-07-12

### Newsletter emails
- **Announcements can now go out as a real newsletter.** A new email layout option in the announcements composer sends a wide masthead design — club logo and wordmark, the announcement image as a hero, a large headline and a clear call-to-action button — instead of the compact notification card.
- **Replies reach a real person.** Each emailed announcement can carry a reply-to address (prefilled with the sending admin's email). Leave it empty to keep no-reply.

## v1.36.0 — 2026-07-12

### Data explorer grid view
- **A spreadsheet view of all members.** The Data explorer now has a grid mode (toggle in the header, ClubDesk-style): a team rail on the left with member counts, and a dense sortable table on the right. Shows first / last name by default — add any of 19 columns (contact data, birthdate, licence, fee category, teams, …) via the column chooser.
- **Edit in place.** Sport admins and above click any cell to edit it — changes save field-by-field and are audit-logged. The Teams column adds or removes team memberships directly (guest memberships marked with a dashed "G" chip).
- **Group, search, export.** Group rows by team, city, nationality, birth year and more; the header search matches every column; export the current view to Excel or PDF.

### Tidier admin menu
- The Admin dropdown is now organized into sections — Planning & halls, Game operations, Members & communication, Data & insights — on desktop and in the mobile menu.

## v1.35.0 — 2026-07-11

### Your duties, everywhere
- **Your assigned duties now surface across the app.** The games you're the scorer / scoreboard / referee / BB official for show as a yellow reminder on the home page (from a week before until the game ends), as an entry in **My next appointments**, and on the **Events** page — no filter hides them.
- **Duties are automatically added to your calendar subscription.** Whatever you subscribe to (games, trainings, events, a single team), your own duties now ride along automatically — the separate "duties" link is gone. Also adds referee duties, which the feed was missing.
- **Pending duty hand-offs show on the home page.** When someone delegates a duty to you, you can accept or decline it right from the home page instead of opening the scorer page.

### Emergency help at the hall
- **"Emergency: contact team leaders" button.** In the hour before kick-off, an on-duty official can reveal the playing team's coach / team-responsible phone and email and alert the club (admin + sport TK) in one tap.
- **The coach's "report late" button now appears only once the official is actually late** — 29 minutes before the start for the scorer / referee, 14 for the scoreboard.

### Automatic no-show fines
- **No-show fines are issued automatically.** When a coach flags a scorer / official as late or absent via the emergency button, the CHF 50 duty fine now lands on that person automatically, using the team's fine rules (tiers) when configured.

## v1.34.1 — 2026-07-09

### Participation export polish
- **Multi-day events now export per-day participation.** The PNG / PDF / CSV roster export of a per-day / per-session event used to collapse each person to one status; it now shows their answer for **each day** (matching the modal's day tabs). Exporting a single day's tab labels the day in the header.
- **Position summary no longer warps.** Multi-word position labels ("Outside hitter", "Middle blocker") stopped wrapping mid-word in the export's summary pills.
- **No more duplicate coach in the staff list.** A playing coach who already appears in the roster with a "(Coach)" badge is no longer also listed as a "(Staff) — No response" row in the export (and the modal's staff section).

## v1.34.0 — 2026-07-09

### ClubDesk group checks in Data Health
- **Data Health now cross-checks Wiedisync team rosters against ClubDesk groups** and flags three kinds of drift: players who are missing their team’s ClubDesk group, people sitting in a ClubDesk group without being a current player of that team (annotated active / official / coach so “remove vs add” is obvious), and ClubDesk groups with no matching Wiedisync team. ClubDesk group membership can only be set by hand in ClubDesk, so these are surfaced for manual review — never auto-fixed.

## v1.33.0 — 2026-07-09

### “Staff only” position
- **New “Staff only” position** replaces “Other” in the volleyball and basketball position pickers — a clearer way to mark a non-playing coach / team responsible. “Other” stays valid for legacy / position-less members but is no longer offered. Existing non-playing staff (coach/TR whose only position was “Other” or empty) were converted to “Staff only”.

## v1.32.0 — 2026-07-09

### Volley referees admin page
- **New `/admin/vb-referees` page** (admin + VB admin): a standing referee → team duty map. Assign each `referee_vb` member to the team(s) whose referee obligation they cover (many-to-many), or flag “External” (+ optional club/pool) for duty outside Wiedikon. Doubles as a coverage check (teams with no referee / referees with no duty). New `vb_referee_duty` collection (migration 200). Not yet wired into scorer assignment (phase 2).

## v1.31.0 — 2026-07-09

### Multi-day events: respond per day (+ per-day fixes, guest filter)
- **Per-day RSVP on the card**: for events in per-day / per-time-slot mode, the card no longer writes a single session-less whole-event row (which left the roster's day tabs empty while the overall view showed N/2). It now shows quick Yes / Maybe / No that apply to **every** day at once, plus a **Per day** button opening the day-by-day responder.
- **Editing keeps sessions in step**: changing a per-day event's start/end dates now regenerates its day rows to match — they used to stay stranded on the original days (e.g. a Sat–Sun weekend whose sessions still read Fri–Sat) — and saving no longer 500s on empty session times.
- **Guest filter**: the multi-team participation modal can be narrowed to just guest players, with each guest's level shown next to their name.
- One-time data repair of the existing Trainingsweekend: whole-event answers mapped onto both days, stale session dates corrected, orphaned rows removed.

## v1.30.0 — 2026-07-09

### Filter a multi-team event roster by team
- **Team filter on the participation modal**: for events with 2+ invited teams, a new multi-select team dropdown sits alongside the status filter. Selecting one or more teams (default "All teams") narrows the **entire** modal — summary counts, member list, waitlist, coaching-staff section and all three exports (CSV / PNG / PDF) — to just those teams. Shared players (on two invited teams) show under either. Hidden for single-team activities (games/trainings) and club-wide events. Counts recompute from already-loaded data (no refetch). Frontend-only; extended `useMultiTeamMembers` with a member→teams map so the dedupe doesn't drop the team association.

## v1.29.0 — 2026-07-08

### Issue a fine directly + branded confirmation dialogs
- **Standalone "Issue fine"** on the Fines page (`/fines`): coaches / team responsibles (their teams) and admins/Vorstand (any active team) can pick a team + member and issue a fine directly — the amount pre-fills from that team's fine catalog (escalation engine), overridable. Previously the only entry point was the roster's automatic late-sign-in prompt. Frontend-only; reuses the existing `IssueFineModal` + `fine_rules` engine.
- **No more native browser pop-ups**: every `window.confirm` / `alert` in Club finances (expense paid/rejected, ledger + team-entry delete, invoice cancel, dues-email live switch, export error) now uses the app's branded, dark-mode-aware modal (`useConfirm`) or a toast. The rest of the app already used these. New convention documented in `CLAUDE.md`: native browser dialogs are banned.

## v1.28.0 — 2026-07-08

### Shared internal note on expenses
- **Back-office note between finance, TK and admin**: each expense reimbursement gains an `internal_note` (migration 193) that finance/admin edit on the Expenses tab and the section TK edits on the Confirm-expenses page. All three roles see the same text; it is **never shown to the member** (separate from the member-facing "note to the member" and the TK's own note to the treasurer). Written through the existing `PATCH /kscw/expenses/:id` and `POST /kscw/expenses/:id/tk-confirm` endpoints (raw knex + audit log).

## v1.27.0 — 2026-07-07

### Home "next 7 days" ticker + team birthdays
- **Upcoming ticker on the home page**: a full-width auto-scrolling banner surfaces everything in the next 7 days for the user's team(s) — games, trainings, events, hall closures/holidays, the member's own scoring duties, and 🎂 birthdays — in one place. Scoped to the user's teams; **admins see all teams** (global admins everything, VB/BB admins their sport). Pauses on hover, honours reduced-motion, and hides itself when nothing's coming up. Reuses the calendar's data engine (team-scoped, authed).
- **Birthdays in the team calendar**: a new `birthday` entry type (cake icon) shows team members' birthdays, **visible only to that team — never public**. On by default for logged-in users, toggleable under Filter → "Birthdays"; the detail popup shows the age. Sourced through the `member_teams` junction so a user only ever sees their own teams' birthdays.
- **Privacy**: only members whose `birthdate_visibility` is "full" appear in any birthday surface — "year only" (day/month hidden) and "hidden" members are never shown a birthday marker. Frontend-only change; no schema migration.

## v1.26.0 — 2026-07-07

### Standardized contact data + smarter signup form
- **One canonical format everywhere**: phone (`+41 79 123 45 67` / compact E.164 for foreign), IBAN (compact uppercase, mod-97 verified), AHV (`756.1234.5678.97`, EAN-13 check digit verified), email (lowercase). Enforced at every write path — registration, profile edit, ClubDesk sync both directions — with a one-time backfill of existing data (migration 186, ~290 phones repaired). Rule documented in `INFRA.md → Contact-data normalization rule`; parity-tested mirrors in backend/frontend/SQL/website.
- **Signup form (kscw.ch)**: validates AHV check digit, phone and email before submitting, and gains an **optional IBAN field** — collected only for paying money back (expense reimbursements), never for fee collection. Server-side guards mirror the client (localized errors), including the AHV-required rule (VB under 23 / BB under 25). Approved registrations carry the IBAN into the member profile as confirmed.
- **Wiedisync ID becomes a UUID** (migration 184, `members.uuid`): the ClubDesk round-trip key is now globally unique and visually distinct from ClubDesk's own numeric IDs. Legacy numeric stamps stay valid — the sync linker accepts both formats.

## v1.25.0 — 2026-07-07

### Scorer duty: HU20 referee + no-licence assignment
- **HU20 home games** are now staffed **scorer + referee** instead of scorer + Täfeler (scoreboard). The referee is a duty *team* like the scorer (no licence required); a member of the assigned team claims it on the Scorer page. (Backend: migration 182 adds the referee duty columns; migration 183 makes the "missing duty" report HU20-aware.)
- **Scorer and Täfeler no longer require a licence** — the auto-assignment can use any available team, and **MiniVB and DU20** are excluded as duty providers. The Legends and HU20 scoring preferences are kept.

## v1.24.0 — 2026-07-07

### Club stats: pick a season
- Club statistics now has a **season selector** (next to the sport toggle) defaulting to the current season. The **Schreiber coverage** and **win/loss results** sections previously aggregated across *all* seasons, so at a season start they were dominated by the finished season's data — they now follow the selected season, with past seasons still available to look back. Roster, member, participation and missing-duty sections stay current-state as before. (Backend: migration 181 adds a `season` dimension to the `stats_schreiber_coverage` view.)

## v1.23.0 — 2026-07-07

### Scorer assignment tool for admins
- New **Scorer assignment** admin page (Admin menu): auto-assigns scorer and Täfeler (scoreboard) duty *teams* to home games for both volleyball and basketball, using licence data (`members.scorer_vb` for VB, OTR licences for BB) and a scoring engine (fair rotation, sequential-game bonus, training/venue rules). The page was already built but unlinked — it becomes usable now that scorer licences are populated from the ClubDesk sync.
- Per-team summary at the top (own games + scorer / Täfeler / combined / total duties), editable per-game team assignments before saving, and a collapsible panel documenting the algorithm's hard and soft rules — split by sport, since volleyball and basketball use different engines. It assigns duty *teams*; the individual official is still chosen afterwards (self-claim / admin / delegation) on the Scorer page.

## v1.22.0 — 2026-07-06

### Expense reimbursements: status tracking
- The `/finance/expense` upload flow now persists every submission (`finance_expenses`, migration 177) instead of only emailing finance. Members see their submissions with status (pending / paid / rejected) + any finance note under "My submissions", and can re-open their receipt.
- Members are notified (in-app + email + push, in their language) when finance marks an expense paid or rejected.
- New **Expenses** tab in Club finances for the finance role/board: full queue of submissions with status changes, a note to the member, detail corrections and receipt access. Marking paid auto-creates the linked payout record (QR-bill snapshot) on the member's My finances page.

## v1.21.2 — 2026-07-06

### Calendar: hall closures show every affected hall
- A closure covering several halls (one `hall_closures` row per hall, same reason + dates) collapsed to a single hall in the calendar — "Halle geschlossen · KWI A" even when KWI A, B and C were all closed. The per-hall rows now merge into one entry listing every hall ("KWI A, B, C"), matching the public website's calendar.

## v1.21.1 — 2026-07-06

### Dates follow your language
- Weekday and month **names** (game detail dates, calendar weekday headers, hallenplan day navigation, scorer rows, event badges/forms, participation sheets, scheduling dialogs, date pickers) now render in the active UI language — Italian/French/English users no longer see German day and month names. Numeric dates keep the Swiss `dd.mm.yyyy` format app-wide per the existing convention; only named parts localize.

## v1.21.0 — 2026-07-04

### Data health: ClubDesk drift detection
- New **"Out of sync with ClubDesk"** check (superadmin): members whose wiedisync contact data (name, email, phone, address, birthdate, sex) no longer matches ClubDesk — with the exact field differences shown. One click marks them for the next sync-up; the push still goes through the usual preview.
- New **"ClubDesk missing data"** check: fields wiedisync has but ClubDesk lacks are grouped into a single bulk row per field (e.g. 100+ members whose sex is only recorded in wiedisync) — one click marks them all.
- This catches every edit path that previously bypassed the sync-up flag (admin edits, Data Explorer, approval backfills), so wiedisync and ClubDesk stay matched.

## v1.20.0 — 2026-07-04

### Registration documents are now enforced
- Basketball registrations can no longer be created without their required documents. The website form uploads each document **the moment it is picked** (with visible per-file status), and the registration is only submitted once every required document is uploaded — a failed upload is caught before anything is saved, instead of stranding a document-less registration.
- **Approval is blocked** while required documents are missing (ID front/back + licence application; non-Swiss players additionally the two FIBA declarations) — with a clear message on the Anmeldungen page.
- New **"Dokumente nachreichen"** page on the website: families can submit missing documents later using the reference number + email from their confirmation — no re-registration needed.

---

Older releases (v1.19.0 → v1.0.0) live in [CHANGELOG-archive.md](CHANGELOG-archive.md).
