# Changelog

All notable changes to Wiedisync, the KSC Wiedikon members' platform. This file is the curated, user-facing release record (English, semver), mirrored in the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`). For commit-level detail see `git log`; for the operator/deploy history see `docs/DEVLOG.md`.

## v1.16.0 — 2026-06-28

### Polls: managers can see who voted
- **Team managers (coaches & team responsibles) now see per-member answers** on a poll — who picked each option — beneath each result, not just the totals.
- This respects the poll's **Anonymous** setting (chosen when creating the poll): an anonymous poll stays totals-only, even for managers.

## v1.15.0 — 2026-06-28

### Surveys are easier to find — and managers see live replies
- **Active surveys now appear on the home screen**, right under the news — open polls for your teams show up there so you can vote without digging into a team page.
- **Team managers (coaches & team responsibles) can now see a poll's replies live**: the running tally is visible at any time, not only after the deadline. Everyone else still sees results once they've voted or the deadline has passed.

## v1.14.0 — 2026-06-28

### Scheduling: block dates from the settings
- New **"Blocked dates (whole club)"** setting (Scheduling → Settings) — block days where no team plays home games (club holidays, tournaments, hall-wide events). Editable only by a superadmin; coaches' own per-team blocks still apply on top.
- The **closed dates** (hall closures) — automatic ones from school holidays and the calendar sync, plus manual closures — are now managed right there in Settings too.

## v1.13.0 — 2026-06-28

### Keep member data in sync with ClubDesk (admins)
- A new **"Sync down from ClubDesk"** button (Registrations page) pulls the latest member data from ClubDesk on demand, instead of waiting for the weekly sync.
- A new **"Sync up to ClubDesk"** opens a **review modal** that previews exactly which members are new or changed, lets you choose which to push, then writes them into ClubDesk — **updating existing contacts** (matched by email) rather than creating duplicates — and shows the result.
- Both are admin-only, and the sync-up always shows a preview to confirm before anything is written to ClubDesk.

## v1.12.0 — 2026-06-26

### Choose which emails you receive
- Your profile has a new **Email notifications** section: switch off the alerts you don't want — new registrations, team join requests, form submissions, club news, and event invitations.
- Each toggle only appears if you can actually receive that alert (join-request alerts show for coaches and team responsibles, for example). Turning one off silences the email — or, for form submissions, the push notification — while the in-app bell still shows it.
- Everything stays on by default, so nothing changes until you opt out.

### Finance: the Ledger shows your real books, and stays current
- The Ledger's **Journal** and **Trial balance** now include your imported **ClubDesk bookings** (marked "ClubDesk", read-only), so the book of record reflects your actual accounting — the native entries you post in wiedisync layer on top.
- **ClubDesk finance now syncs automatically every night**, and a **"Sync now"** button (Finance → Sync) refreshes it on demand instead of waiting for the nightly run.
- **Export reports** — the income statement, balance sheet, budget and trial balance each get an **Export** button producing a polished **PDF**, **Excel** workbook (real numeric cells) or **PowerPoint** deck.
- **One fiscal-year selector** for the whole Finance area (the Ledger's duplicate dropdown is gone), and changing the year — or any filter — no longer blanks and reloads the page.

## v1.11.0 — 2026-06-26

### Club accounting, built in: your own double-entry ledger
- Finance gains a new **Ledger** tab — a full **double-entry book of record** inside wiedisync, so the club can keep its own accounts (Buchhaltung) rather than depend on an external tool.
- **It runs itself.** Once enabled, the ledger **auto-posts** from the club's own activity: every invoice issued, payment, reminder fee, credit note, refund, write-off and per-team sponsoring becomes the correct journal entry, with the receivables (Debitoren) control account kept reconciled (overpayments go to a prepayment account, not negative A/R; cancellations and amount changes self-correct).
- **Your ClubDesk chart is shared with the ledger** — the journal posts to your existing Kontenplan directly; just map the bank/receivables/income control accounts and switch auto-posting on.
- **Per-category dues income** — map each membership category (Passivmitglieder, Aktivmitglieder, J+S …) to its own income account, so dues book to the same split as ClubDesk; the default income account covers anything unmapped.
- Everything a set of books needs: a **journal** (post + reverse entries), a **trial balance** (Saldenbilanz), and a guided **year-end close** (Jahresabschluss) that books the result into equity and carries balances into the next year. A **"Reconcile now"** button backfills/realigns the ledger with the rest of finance.
- **Closed years are locked** at the database level — posted entries can no longer be edited or deleted, only corrected with a reversal, as proper accounting requires.
- Built with three independent adversarial reviews of the money-critical paths (settlement, year-end close, auto-posting); all findings fixed and verified.

## v1.10.0 — 2026-06-25

### Scheduling mailbox: its own tab, with a Volleyball/Basketball switch
- The embedded scheduling mailbox moved out of the Terminplanung dashboard into its **own "Mailbox" tab**, alongside Dashboard and Settings.
- A **Volleyball/Basketball toggle** at the top switches between the two Migadu accounts (`volleyball@` / `basketball@spielplanung.kscw.ch`). You only see the sports you can access (volleyball admins/Spielplaner; basketball admins). Basketball is a plain mailbox — it has no opponent scheduling.
- Now a **full mail client**: separate **Inbox** and **Sent** folders, plus **Reply**, **Reply all**, **Forward** (carries the original's attachments along), and **New email**.
- On the volleyball side the per-opponent grouping stays — the dashboard's "N emails" button deep-links into the new tab and opens that opponent's thread.

## v1.9.1 — 2026-06-25

### Game scheduling: hand schedules over to the Swiss Volley feed on a set date
- Set a **"Feed takeover date"** per season in the scheduling settings. Until that date, the dates, times and venues you arranged in the tool are **protected** from the official Swiss Volley feed — which can still show a placeholder until opponents enter your away games in Volleymanager.
- **On and after that date**, the official feed becomes authoritative for date, time and venue automatically — by then every opponent has had time to enter their away games. Scores and results always sync regardless.
- Leave the date **empty** to keep protecting scheduled games until they are played (the previous behaviour).

## v1.9.0 — 2026-06-25

### Finances: bill membership dues in one run
- Set the membership fee per **category** (and per section) for a season, then bill every active member in those categories **in one run** — each member gets a payable QR-bill in the app.
- **Preview before billing**: see exactly who will be charged, how much, and who is missing a rate or already billed, before anything is issued.
- **Safe to re-run** — members who already have a dues invoice for the season are skipped, so nobody is billed twice.
- **Cancel a whole run** to void its still-open invoices; paid ones are kept.
- **Download all bills** for a run as one PDF — a Swiss QR-bill per member to print and post, or attach yourself.

## v1.8.0 — 2026-06-24

### Finances: per-member explorer + a dedicated Finance role
- New **Finance** role for the treasurer / finance team — the club-finance dashboard and the new per-member view on top of normal member access, without full board permissions.
- **Members tab** in Club finances: search a member to see their contact details, IBAN, membership category and full invoice history with payment status, all in one place.
- Record a **separate billing contact** per member (e.g. a minor's parent/guardian, or a paying company), used when addressing invoices.
- **Attach the invoice PDF** to any invoice and open it later — private to finance and the board, and the attachment stays linked to its ClubDesk invoice across nightly syncs.

## v1.7.0 — 2026-06-24

### Finances
- Invoices you pay through the app now reconcile automatically with the club's accounting — the payment carries the invoice number in the standard format, so there's no manual matching.

## v1.6.1 — 2026-06-24

### Game scheduling: accurate dashboard counters
- The Spielplanung dashboard's home/away game counters now count every leg of a pairing, so junior teams that play an opponent two or three times are tallied correctly — the totals no longer show more games confirmed than the season actually has.

## v1.6.0 — 2026-06-23

### Finances: invoices you can pay in the app
- The Fines page now lives in one **Finances** menu, alongside My finances, Upload invoice and Club finances (for the board).
- The board can create an invoice for a member or a whole team — for example a Swiss Volley fine — right in Club finances.
- You pay invoices in the app: open one under My finances, scan the QR-bill with TWINT or your banking app, then tap "I've paid". It shows as pending until the treasurer confirms the money arrived.
- Team invoices appear for the team's coach, captain and responsible.
- The board can link ClubDesk invoices that weren't matched to the right member (e.g. billed to a parent's email), and the link sticks across syncs.

## v1.5.0 — 2026-06-22

### Smarter junior game slots
- Junior (U-) teams can now choose Friday-evening slots as their 1st and 2nd home-game options once Saturdays and the Tuesday Döltschi slots are used up — previously Fridays were only ever a 3rd choice, which could leave a team unable to propose a full home game.
- Sundays now work the same way, and the U-teams are steered to play together: once one U-team takes a Sunday, that Sunday becomes a strong option for the others.
- New "Show cross-team conflicts" toggle on the planning calendar — pick a team and the calendar marks the days another team that shares its players already plays, i.e. the exact days that block a home game.

## v1.4.0 — 2026-06-22

### Smoother game planning
- Adding a manual game now picks up the calendar filters you already set — the sport, team and home/away carry straight into the dialog.
- A new sport picker in the dialog narrows the team list to volleyball or basketball.
- The "KWI A + B" double-hall booking is now available for every team, not just basketball — and it warns you if either half is already taken.
- The "Show absences" toggle works again: calendar days show a badge with how many players are unavailable for games that day. Hover or tap it to see who.

## v1.3.0 — 2026-06-22

### Game planning, one tap away
- The game-planning tools are now a single "Planning" entry in the menu — the separate "Manual game calendar" and "Match scheduling" tabs are gone.
- Installed Wiedisync to your home screen? Opening Planning now launches it in your browser instead of getting stuck inside the app window.

## v1.2.0 — 2026-06-20

### League standings by season
- Rankings now have a season picker — see the current tables, look back at last season's final standings, and browse the archive.
- Earlier seasons are kept instead of being overwritten when a new season starts, so the history stays put. Last season (2024/25) has been added back in.
- For a season Swiss Volley hasn't published yet, the rankings show a short "Data to be shared later by Swiss Volley" note instead of an empty table.

## v1.1.0 — 2026-06-19

### Loading & polish
- Pages now wait for all their data before showing — no more tables and cards popping in a moment after the screen appears.
- A refreshed loading screen with the spinning club logo, a gold progress bar with a percentage, and a few playful messages while you wait.

## v1.0.0 — 2026-06-19

First official release of Wiedisync — a fast, real-time web app for KSC Wiedikon, available in German, English, French, Italian and Swiss German. The sections below describe what the platform does at 1.0.

### Teams & rosters
- Team cards with photos, club colours and per-team guest levels; manage positions, captain, coaches and team responsibles.
- Coaches have their own section on the team page, separate from the players.
- Export a roster as CSV, PNG or PDF with an activity header and a position summary.
- Join or leave a team straight from the Teams page, and invite external players with a QR code.

### Trainings, games & RSVP
- RSVP Yes / Maybe / No in real time, add a note, count guests and pick recurring trainings.
- Auto sign-in (opt-out attendance): you're confirmed automatically for new trainings, games or events — you only act when you can't make it, and absences always win. Set it per team, override it per activity, or switch it on for yourself.
- Coaches can edit participation inline and log an absence on a player's behalf, always shown with who changed it and when.
- Cancel a training, event or game from the calendar — the team is notified, RSVPs freeze and a cancelled training frees its hall slot.

### Calendar & Hallenplan
- Monthly calendar with home / away colours, clickable absence bars, game-Saturdays in gold and hall closures highlighted.
- Hall slots that coaches can claim; editing a slot cascades to every future session while keeping RSVPs and notes, and open-ended slots keep a rolling calendar.

### Absences & availability
- Track absences and weekly unavailabilities; a weekly unavailability overrides an existing "confirmed".
- Mark an absence non-blocking so the player shows as away for their own games, but the date stays open for scheduling the rest of the team.
- A team absence calendar with multi-team select.

### Games & scoreboard
- Upcoming games and results with set scores, total or per-game standings, and an embeddable scoreboard.
- Daily automatic sync with Swiss Volley and Basketplan keeps scores and standings fresh.

### Game scheduling (Spielplanung)
- Plan a whole season against opponents: send a club a tokenized invite, they propose home and away slots, and you confirm — with the tool enforcing availability, absences, hall closures, game spacing and intra-club derby rules automatically.
- Confirmed home games push straight into VolleyManager, and confirmed games appear on the app calendars right away.
- An in-app mailbox brings opponent email replies into the dashboard; leave remarks both ways, see per-team availability, export to Excel / PDF and search across all teams.
- Scheduling lives on its own address (spielplanung.wiedisync.kscw.ch) with single sign-on.

### Scorer duty
- Sign up for scorer duty with delegation, and an auto-assignment planner that builds a fair duty plan for both volleyball and basketball home games.

### Messaging
- Team conversations, direct messages, polls, reactions and reports, with a personal inbox for your message notifications.

### Forms
- Build custom forms (short / long text, single or multiple choice, number, date, yes/no, file upload) for the whole club or specific teams.
- See responses in a table and export to Excel, CSV, JSON or PDF; remind non-responders; let members edit their answer; or make a form public with its own shareable link.

### Fines
- Issue fines with per-team escalation tiers (late sign-in, no-show, late payment or custom), see your outstanding fines on your profile, and waive one with a reason.

### Finance
- Board finance dashboard with income statement, balance sheet and an accounts drill-down, mirrored from ClubDesk.
- Pay your dues from the app by scanning a per-invoice Swiss QR code with TWINT or any banking app.
- Submit an expense for reimbursement: upload the receipt, let it read the amount, date and vendor automatically, and confirm your IBAN.

### News, broadcasts & notifications
- Club-wide announcements on the home news card, and targeted broadcasts by email and push with spam protection.
- In-app and web-push notifications for new activities, RSVP changes and broadcasts.

### Admin & data tools
- A Data Explorer to browse teams, members, events and games with instant fuzzy search and member filters.
- A superuser SQL workspace, a public status page with live sync heartbeats, and an audit log of who did what.

### Accounts, languages & platform
- Log in with email and password; seven clear roles, each with their own view; privacy settings and GDPR account deletion.
- Five languages (German, English, French, Italian, Swiss German), dark mode, Swiss dd.mm.yyyy dates throughout, install-to-home-screen (PWA) and step-by-step guided tours.
- Your Swiss Volley licence card on your profile, kept live from Volleymanager.
