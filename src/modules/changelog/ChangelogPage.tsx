import { useTranslation } from 'react-i18next'
import { ScrollText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'

const APP_VERSION = '4.20.0'

interface ChangelogEntry {
  version: string
  date: string
  sections: { title: string; items: string[] }[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '4.20.0',
    date: '2026-06-03',
    sections: [
      {
        title: 'Team absence calendar: multiple teams and clearer day details',
        items: [
          'You can now select several teams at once in the team absence view, instead of one at a time — handy for coaches and admins who follow more than one team.',
          'When someone is both absent and unavailable on the same day, they now appear once, labelled "Absent / Unavailable", instead of showing up twice.',
          'New calendar filters: "Show weekly unavailabilities" (on by default) and "Show non-blocking absences" (off by default, so absences that don\'t block scheduling stay out of the way until you want them).',
        ],
      },
    ],
  },
  {
    version: '4.19.0',
    date: '2026-06-03',
    sections: [
      {
        title: 'Team names and leagues now come straight from Volleymanager',
        items: [
          'Each volleyball team\'s name and league are now read directly from Volleymanager, so they stay correct after a division change or when teams swap places between seasons — no more stale labels or manual edits.',
          'Referee licences are synced too: members who hold a volleyball referee licence are now flagged automatically.',
          'The club website follows the same live data, so its team pages and menus always show the up-to-date names and leagues.',
        ],
      },
      {
        title: 'Manual data-refresh buttons on the status page (admins)',
        items: [
          'Admins can now refresh each data source on demand from the status page — one "Run now" button each for Swiss Volley, Basketplan, Volleymanager, SVRZ scheduling and Google Calendar — instead of waiting for the scheduled sync.',
        ],
      },
    ],
  },
  {
    version: '4.18.0',
    date: '2026-06-02',
    sections: [
      {
        title: 'Auto sign-in for trainings, games and events',
        items: [
          'Your profile now has three "Auto sign-in" toggles — one each for trainings, games and events. Turn one on and you\'re automatically confirmed for new activities of that type as they appear, so you only need to act when you can\'t make it.',
          'Switching a toggle on also confirms you for all your existing upcoming activities of that type at once. Activities you\'ve already answered are never changed, and you can still decline any of them individually.',
          'Absences still win: if you\'re away, you won\'t be auto-confirmed for activities during that time.',
        ],
      },
    ],
  },
  {
    version: '4.17.0',
    date: '2026-06-01',
    sections: [
      {
        title: 'Mark absences as non-blocking for game scheduling',
        items: [
          'Absences now have a "Blocks game scheduling" toggle (on by default). When on, the absence makes its dates unavailable in the Spielplanung — home slots aren\'t offered and the opponent can\'t propose those dates.',
          'Turn it off for absences where the player won\'t play anyway (e.g. long-term injury or maternity leave). The absence is still recorded and the player still shows as not attending their own games and trainings, but it no longer blocks the rest of the team from being scheduled on those dates.',
        ],
      },
    ],
  },
  {
    version: '4.16.2',
    date: '2026-06-01',
    sections: [
      {
        title: 'Calendar shows team names again after the season rollover',
        items: [
          'After the June 1 rollover, hall-plan slots showed up grey with no team name, and the VB / BB sport filter hid everything. Slots now show their team and sport again, and the filters work.',
          'Cause: the rollover left every recurring slot pointing at last season\'s (archived) team alongside the new one. Cleaned up the data, fixed the rollover so it won\'t recur next season, and made the calendar resilient to it.',
        ],
      },
    ],
  },
  {
    version: '4.16.1',
    date: '2026-06-01',
    sections: [
      {
        title: 'Games & rankings show the right season again',
        items: [
          'After the June 1 season rollover, the Games, Rankings and Home views could show up empty until the new season\'s fixtures were published. They now automatically fall back to the most recent season that actually has data, and flip to the new season the moment its data lands.',
        ],
      },
    ],
  },
  {
    version: '4.16.0',
    date: '2026-05-30',
    sections: [
      {
        title: 'Install the app on your phone',
        items: [
          'You can now add Wiedisync to your phone home screen for faster, full-screen access. A reminder banner appears on mobile after login, and there\'s a new "Install the app" entry in the Guide section.',
          'On Android/Chrome it\'s a one-tap install. On iPhone (Safari) you get a step-by-step Share → Add to Home Screen guide. Dismiss the banner with "Remind me later" (this session) or "I understood" (remembered on that device).',
        ],
      },
    ],
  },
  {
    version: '4.15.0',
    date: '2026-05-30',
    sections: [
      {
        title: 'Scorer duty + fines polish',
        items: [
          'Scorer duty Games view now has an "All" / "Selected" toggle. "All" shows every duty you can see (your team\'s duties plus your personal assignments); "Selected" narrows to the games you\'ve personally signed up for.',
          'Fines page no longer flashes an empty table while loading — it shows the spinner first, then either your fines or the empty state.',
        ],
      },
    ],
  },
  {
    version: '4.14.0',
    date: '2026-05-30',
    sections: [
      {
        title: 'Fines (new)',
        items: [
          'Coaches and team responsibles can now issue fines to members from /fines. Each fine has a category (late sign-in, no-show, late payment, custom), an amount and a reason. Members see their own fines + total outstanding on /fines and as a strip on their profile.',
          'Per-team escalation rules with configurable tiers. Example for H3: 1 CHF first late sign-in, 2 CHF second, 3 CHF third, 5 CHF for the fourth and any further offence in the same calendar month. Reset window is configurable per category (calendar month, rolling 30 / 90 days, season Sep–Aug, or lifetime). Configure under Team settings → Fines.',
          'Late-confirmation prompt: when a coach/TR sets a member to "confirmed" past the activity\'s sign-up deadline and the team has a late-sign-in rule enabled, the issue-fine modal pops up pre-filled with the right amount from the escalation engine. Always leader-confirmed — there is no silent auto-issue.',
          'Waiving: leaders can waive any fine with a required reason. Amount, reason and category are immutable after issue — to correct a mistake, waive and reissue (so the audit trail stays clean).',
          'Notifications: push + in-app on issue, on mark-as-paid and on waive. Daily 09:00 UTC reminder cron pings members with fines that have been open for more than 14 days. All notifications localized in 5 languages (DE / GSW / EN / FR / IT).',
          'Coach dashboard gets a "Fines this month" card with the team total, count and delta vs. last month.',
          'Permissions are scoped per team — coaches only see fines for the teams they coach or are responsible for. Vorstand gets read-only club-wide for oversight. Sport Admin and Administrator have full access. Members can only read their own fines and the rules of the teams they\'re on.',
        ],
      },
    ],
  },
  {
    version: '4.13.1',
    date: '2026-05-21',
    sections: [
      {
        title: 'Hall plan — Free training slot',
        items: [
          'Slot editor gets a "Free training slot" toggle above the team picker. When enabled the slot is saved without a team assigned and any team can claim it from the available-slots strip — the same behaviour the system already used for cancelled trainings or away-game freed slots, now available for proactive admin creation.',
          'Team dropdown bugfixes: list now scrolls properly inside the modal (was capped at a fixed height and clipped by the dialog), and the "Search team…" placeholder is translated in all 5 locales (was showing the raw i18n key for non-German users).',
          'Editing a slot no longer warns about overlapping itself. Conflict detection was comparing against virtual training/game children rendered on top of the slot — those share the slot\'s hall + day + time and so always flagged as overlaps. Now it only compares against real persisted slots.',
        ],
      },
    ],
  },
  {
    version: '4.13.0',
    date: '2026-05-20',
    sections: [
      {
        title: 'Data Explorer — member filters',
        items: [
          'The /admin/explore page has a new "Filters" popover that narrows the Members list against the loaded cache. Multi-select chips for Sport, Gender, Positions, Licences, Roles, Language, Birthdate visibility and Consent decision. Tri-state (Any / Yes / No) toggles for every member boolean — wiedisync_active, shell, coach_approved_team, is_spielplaner, licence_activated/validated, hide_phone/email, communications flags, push preview — and for 21 "has value" presence checks (email, phone, licence number, jersey, photo, birthdate, address, AHV, VM email, etc.). An active filter count appears on the button and the list updates live.',
        ],
      },
      {
        title: 'SQL Workspace (superuser-only)',
        items: [
          'New /admin/sql page for superusers — a Postgres SQL console wired to the production database via a Directus extension endpoint. Read-only by default (DDL/DML keywords are rejected, transaction is opened with TRANSACTION READ ONLY); flip the "Write mode" switch in the header to allow writes. Every statement runs inside a 15s-timeout transaction; unbounded SELECTs auto-cap at 1000 rows. Every call is audited to the JSONL error log as event "sql_workspace" with user, mode, duration and SQL preview.',
          'The editor is CodeMirror with PostgreSQL syntax + autocomplete that knows your live schema — table names suggest anywhere, columns suggest after `<table>.`, each suggestion shows its Postgres type. Sidebar lists every public table with column types; click "SELECT" to drop a starter query. Ctrl/Cmd-Enter runs.',
          'Result exports: CSV download, Excel (.xlsx) download, and "Copy table" which writes both an HTML table and TSV to your clipboard — paste into Gmail / Docs / Slack to get a rendered table, or into a terminal / editor / spreadsheet to get TSV. Recent queries persist locally (last 20) as a chip strip; draft auto-saves so a refresh does not lose your in-progress query.',
        ],
      },
    ],
  },
  {
    version: '4.12.1',
    date: '2026-05-18',
    sections: [
      {
        title: '"Coach present" accuracy',
        items: [
          'The "Coach present" badge on training, game and event details now lights up only when an actual coach has confirmed — previously the team captain or a team-responsible RSVPing "Yes" was enough to show it, even on teams with no coach.',
        ],
      },
      {
        title: 'Date format',
        items: [
          'Dates in the app now always show in Swiss format (20.05.2026) regardless of UI language — English users were seeing 20/05/2026 with slashes.',
        ],
      },
    ],
  },
  {
    version: '4.12.0',
    date: '2026-05-18',
    sections: [
      {
        title: 'Cancelled trainings notify the team',
        items: [
          'When a coach or team-responsible cancels a training, everyone on the team now gets a notification and a push — previously the cancellation was silent.',
        ],
      },
      {
        title: 'Training detail layout fix',
        items: [
          'The "Cancel training" and "Contact" actions moved to a bottom row so they no longer overlap the title on small screens.',
        ],
      },
      {
        title: 'Trial trainings: recruiting positions',
        items: [
          'A trial training can now list the positions the team is looking for — shown to prospective players on the public team page.',
        ],
      },
      {
        title: 'Public team page',
        items: [
          'Team pages now also show barrage (promotion/relegation) standings, not just the regular-league ranking.',
        ],
      },
    ],
  },
  {
    version: '4.11.0',
    date: '2026-05-18',
    sections: [
      {
        title: 'Email is now required',
        items: [
          'First name, last name and email are mandatory when editing your profile — the email field can no longer be cleared.',
          'A server-side safeguard prevents an existing email from being wiped through any other path.',
        ],
      },
      {
        title: 'Hide email from other members',
        items: [
          'New "Hide email address" privacy toggle in Profile, mirroring "Hide phone number".',
          'When on, your email is hidden from other members wherever contact details appear — rosters, player profiles, scorer and game contact info.',
        ],
      },
    ],
  },
  {
    version: '4.10.0',
    date: '2026-05-18',
    sections: [
      {
        title: 'Cancel trainings, events & games',
        items: [
          'Coaches and team-responsibles can now cancel — or reinstate — a training, event or game directly from its card or detail view.',
          'Cancelling notifies the team; the cancelled activity is dimmed and its RSVP controls are hidden.',
          'A cancelled training or home game automatically frees its hall slot so other teams can claim it.',
        ],
      },
    ],
  },
  {
    version: '4.9.5',
    date: '2026-05-18',
    sections: [
      {
        title: 'Bug fixes and polish',
        items: [
          'Fixed a permissions regression where opening Events could fail to load participation data ("no permission to access session_id / waitlisted_at"). The fields were already correct in the codebase — production permissions just needed reconciling.',
          'Error reports for failed saves now carry the real cause instead of an opaque "[object Object]". Internal-only — improves how quickly we can diagnose and fix issues you hit.',
        ],
      },
    ],
  },
  {
    version: '4.9.4',
    date: '2026-05-14',
    sections: [
      {
        title: 'Absence auto-decline no longer over-reaches into pre-start dates',
        items: [
          'Future-dated absences were silently declining every activity from the day the absence was created through the end_date — completely ignoring the start_date. Daniela Imhof (D4) reported all her May/June/July trainings declined with reason "work" right after she added a 2-day absence in August. Cause: knex returns Postgres `date` columns as JS `Date` objects, so `absence.start_date?.split?.(\'T\')[0] || absence.start_date` short-circuited to the raw Date, and `Date > \'2026-05-13\'` coerced to a NaN comparison that always returned false. `effectiveStart` was therefore clamped to today for every future absence.',
          'Fix in `directus/extensions/kscw-hooks/src/index.js`: route both `absence.start_date` and `absence.end_date` through `safeDateStr()` before any comparison or SQL bind. Now `effectiveStart = max(absence.start_date, today)` as originally intended.',
          'Cleanup on prod: 50 bug-induced auto-decline rows removed across 13 absences and 11 members (members 6, 19, 25, 33, 72, 93, 180, 255, 313, 415, 467). Daniela\'s 11 D4 trainings that were auto-confirmed at 22:10 right before the bug fired (424–427, 536–539, 616–617, 672–673) have been restored to `confirmed`. Other affected members reset to "no RSVP" (neutral) — they can re-RSVP normally.',
        ],
      },
      {
        title: 'Sentry: member name in user context, member_teams duplicate noise silenced',
        items: [
          '`setSentryUser` now passes `username = "First Last"` alongside the member ID, so error emails and the issue UI show "Anna Müller" instead of just `id:93`. Email is still withheld (PII).',
          'The (member, team) unique constraint on `member_teams` (migration 044) was firing as a Sentry error every time a coach hit "approve" on a member who was already on the roster (RLS-blinded pre-check or fast double-tap). Added a `silentOnUnique` flag to `createRecord` / `useMutation.create` and wired the three `member_teams` insertion sites (`RosterEditor.handleAdd`, `TeamDetail.handleApprove`, `TeamDetail.handleApproveRequest`) to swallow the duplicate-key 400 — the constraint is a hard backstop, not an actionable error.',
        ],
      },
    ],
  },
  {
    version: '4.9.3',
    date: '2026-05-13',
    sections: [
      {
        title: 'Trial training transforms the regular row in place — no more duplicate sibling',
        items: [
          'Migration 055 created a second row when a trial replaced a regular training on the same date — the original was cancelled, the trial added alongside. That meant the slot rendered as "Available" (because of the cancelled row) while the trial sat hidden behind it, and any RSVPs/notes on the original were stranded. Migration 056 replaces this with single-row transform-in-place: booking a trial on a date with an existing regular training now flips `is_trial = true` on that row, merges any participations the new payload carried (skipping duplicates), and discards the just-inserted trial row. The mental model matches what users expect: the training stays, it just becomes the trial. RSVPs / notes / overrides are preserved.',
          'Implementation: AFTER INSERT trigger (not BEFORE) so Directus\'s `INSERT … RETURNING *` still gets a row back and the admin UI never sees a 0-rows error; the cleanup runs in the same statement so the briefly-existing row is gone before any side-effects can observe it. Frontend `onSave()` refetch immediately picks up the transformed regular row. Symmetric protection on the other side: when slot-cascade\'s rolling top-up later tries to insert a regular training on a date that already holds a trial, the duplicate is discarded.',
          'Manual one-offs still work: if you create a trial for a date when the team doesn\'t regularly train (no matching regular row exists), a fresh standalone trial row is inserted, same as before.',
          'Backfill on apply: the one existing legacy prod pair (D2 + trial 697 on 2026-05-20) was collapsed into a single row 221 marked `is_trial = true`, marker cleared.',
        ],
      },
    ],
  },
  {
    version: '4.9.2',
    date: '2026-05-13',
    sections: [
      {
        title: 'Trial training (Probetraining) overrides the regular team training on the same date',
        items: [
          'Booking a trial training for a team on a date that already has a regular training now auto-cancels the regular row (reason: "Replaced by trial training"). Works in reverse too — if the nightly indefinite-slot top-up later inserts a regular training on a date that already holds a trial, the new row self-cancels. Deleting the trial reverses the cancellation. Manual cancel/uncancel by an admin detaches the row from the auto-origin, so a later trial removal won\'t silently undo an admin\'s intent.',
          'Trial trainings now carry a "Probetraining" badge automatically on the training card and detail modal, so they\'re identifiable at a glance.',
          'Implemented as Postgres triggers (migration 055), not a Directus hook — because the slot-cascade does raw INSERTs that bypass Directus action hooks. Keeping the rule in the DB means the admin UI path and the cascade path both produce the same result. Backfill on apply caught one existing prod row (D2, 2026-05-20).',
          'Hallenplan rendering fix: a slot whose regular training was auto-cancelled in favour of a trial no longer renders as a green "Available" (freed) tile — the trial training takes the slot. `annotateFreedSlots` now checks for a non-cancelled replacement training on the same hall_slot+date before promoting the cancelled original to freed.',
        ],
      },
    ],
  },
  {
    version: '4.9.1',
    date: '2026-05-13',
    sections: [
      {
        title: 'Cascaded trainings now auto-RSVP, and deleting a slot cleans up its trainings',
        items: [
          'Trainings generated by the slot cascade (initial slot creation, slot edits that fill missing dates, the nightly indefinite-slot top-up) now apply the same auto-RSVP logic as manually-created trainings: members on an overlapping absence are auto-declined (linked back to the absence), and if the team has `training_auto_confirm` on, everyone else is auto-confirmed. Previously the cascade did bulk INSERTs directly on `trainings` and bypassed the Directus item-create event, so cascaded trainings stayed empty and members saw 18 future trainings with no status. Backfilled in this release.',
          'Deleting a hall-slot now cascades to its future trainings + their participations. Past trainings stay frozen as historical snapshots; future ones are pure generator output and were previously left dangling with a now-invalid `hall_slot` FK. (New filter on `hall_slots.items.delete` in `kscw-hooks`.)',
        ],
      },
    ],
  },
  {
    version: '4.9.0',
    date: '2026-05-13',
    sections: [
      {
        title: 'Hall-slot edits now cascade backend-wide, indefinite slots roll forward automatically',
        items: [
          'Editing a recurring hall-slot (time, hall, team, weekday, validity window) now propagates to every upcoming training of that slot — regardless of whether the edit came from the React Hallenplan editor, the Directus admin UI, or REST. Previously the cascade lived only in the React editor, so admin-UI / API edits silently diverged. Past trainings stay frozen as historical snapshots; weekday changes shift each future training to the same Mon–Sun week\'s new day, so RSVPs / notes / attendance carry over instead of being regenerated.',
          'Indefinite slots now have a real rolling 12-week horizon. A nightly cron at 04:00 Zurich keeps the next ~3 months of trainings always populated; cascade no longer trims the tail when indefinite is on, so editing slot time/hall never deletes existing future trainings. (`INDEFINITE_HORIZON_WEEKS` tunable in `slot-cascade.js`.) Closures and existing dates are skipped — current max date is 2026-07-10 because Sommerferien runs 07-13 → mid-August.',
          'Bulk auto-generated trainings (slot create, slot edit, nightly top-up) no longer push-spam team members. New Postgres GUC `kscw.skip_trainings_notify` set transaction-locally by the hook lets `trg_trainings_notify` short-circuit during routine fan-out, while one-off manual creates / updates via the admin still notify as before. (Migration 054.)',
          'Roster export (CSV / PNG / PDF) now sorts by surname instead of first name, and adds a Guest column (✓ in PNG/PDF, "Yes" in CSV) populated from `member_teams.guest_level` — distinct from the existing plus-ones column so a coach can spot guest players at a glance.',
        ],
      },
    ],
  },
  {
    version: '4.8.9',
    date: '2026-05-12',
    sections: [
      {
        title: 'Participation modal: coaches without a member row now visible + single scroll',
        items: [
          'Roster modal staff section was only showing coaches/team-responsibles who had already RSVPed — a coach attached only via the `teams_coaches` junction (no `member_teams` row, no participation row yet) was invisible to roster managers. The modal now seeds the staff member set from the team\'s coach + TR junctions on top of the participation-derived set, so leaders appear immediately and roster staff can add a note or RSVP on their behalf.',
          'Removed the nested `max-h-[60vh]` scroll inside the participation modal — the outer sheet handles scrolling, so the list no longer scrolls inside another scroll on mobile.',
        ],
      },
    ],
  },
  {
    version: '4.8.8',
    date: '2026-05-12',
    sections: [
      {
        title: 'Security audit follow-ups (Low tier + hygiene)',
        items: [
          'Audit-log retention: `user_logs` now has a 90-day purge cron (daily at 02:15 UTC) — matches the retention window already advertised in the audit-log UI. Plus per-collection field redaction: `members`, `directus_users`, `push_subscriptions` payloads have PII (`ahv_nummer`, `birthdate`, `email`, `phone`, push keys, …) replaced with `[REDACTED]` before being stored; `reports_filed`, `messages`, `message_requests` log only `{_redacted: true, _fields: [...]}` so the audit reviewer can see WHAT changed without the row content leaking.',
          'Announcement email body now allowlist-sanitized (`sanitize-html.js`): only inline-formatting tags + safe https-only links survive; `<script>`, `<style>`, `<iframe>`, `<img>` (tracking pixels), and all event handlers / inline styles are stripped before the email goes out. Closes a compromised-Sport-Admin → phishing-email vector.',
          'SQL string-interpolation hardening: every `EXTRACT(DOW FROM DATE \'…\')` site in the absence/auto-confirm hooks now parameterizes the date through the driver (`EXTRACT(DOW FROM ?::date)`). The `daysOfWeek` array used by the absence-overlap helper also gets coerced to integers in the 0–6 range before interpolation. Defense-in-depth even though regex validation + jsonb column type already protect in practice.',
          'Messaging DM auto-accept (migration 052): the trigger that flips pending message requests to `accepted` when two members land on the same team no longer requires the rows to share a `season` value. Cross-season teammates auto-accept the same way same-season teammates always did.',
          'Docs: `PERMISSIONS.md` header updated through migration 052. `SCHEMA.sql` baseline regenerated from prod so fresh-install diffs cleanly. `pgbouncer.get_auth()` `search_path` finding documented under "Open / accepted" — Supabase-managed function, patching it from our side risks rollback on the next Supabase image bump.',
        ],
      },
    ],
  },
  {
    version: '4.8.7',
    date: '2026-05-12',
    sections: [
      {
        title: 'Third-party absence edits now trigger a web push + UX nudge to leave a note',
        items: [
          'Push fanout for third-party absence edits: when a coach/TR/admin creates or updates an absence (or weekly unavailability) on behalf of a player, the player now gets a web push *in addition to* the in-app notification — same dispatch path as `upcoming_activity` / `deadline_reminder`, fully localized across 5 locales via `push-i18n.js` (`absence.{,weekly.}{created,updated}.{title,body}`).',
          '`AbsenceForm` and `WeeklyUnavailabilityForm` now surface an amber nudge under the note field when a coach/TR is editing on behalf of another member: *"You\'re editing on behalf of another player — please leave a note explaining why. The note is visible to the player."* The placeholder also switches to *"Why are you logging this on behalf of the player?"* so the cursor lands on the right prompt. The reason_detail / note column doubles as the audit trail and is shown to the affected member, paired with the existing italic *"Edited by team staff on …"* attribution line.',
        ],
      },
    ],
  },
  {
    version: '4.8.6',
    date: '2026-05-12',
    sections: [
      {
        title: 'Coach RSVPs now visible in the participation modal staff section',
        items: [
          'After v4.8.5, Michelle (Vorstand coaching H2/H3 without being on either roster) could click Ja/Vielleicht/Nein on her team\'s trainings and her response saved correctly — but the participation modal\'s STAFF section always showed her as "Keine Antwort" regardless of what she clicked.',
          'Root cause: `useTeamParticipations` filters by `member IN <roster ids>` at query time. A coach not in `member_teams` is excluded from that result, so the modal\'s main `participations` array never contained their `is_staff=true` row — even though the row existed in the DB. The staff-status lookup (`getStaffMemberStatus`) read from that empty-for-staff array and always returned null.',
          'Fix: the modal now keeps a separate `staffParticipationRows` state populated from the dedicated `is_staff=true` fetch (which already existed but only stored member objects). Switched that fetch from `fetchAllItems` + `useEffect` to `useCollection`, so it auto-invalidates when any participation mutates — meaning a coach\'s click instantly updates the modal without a manual refresh.',
        ],
      },
    ],
  },
  {
    version: '4.8.5',
    date: '2026-05-12',
    sections: [
      {
        title: 'Security follow-ups from the 2026-05-12 audit (High + Medium tier)',
        items: [
          'Member-tier reads on `participations` and `absences` no longer return the `last_*_edited_by` directus_users UUIDs — only the timestamps. Coaches/TRs still see them via LEADER for "who edited this" attribution. Closes an enumeration path where one Member could correlate Directus user UUIDs across teams.',
          'Messaging GDPR `/messaging/export` now filters `deleted_at IS NULL` and drops `reports_filed.message_snapshot` from the bundle — the snapshot is a moderation artefact of another member\'s pre-redaction message and doesn\'t belong in the reporter\'s personal export.',
          '`/messaging/conversations/:id/clear` now caps each call at 500 rows (returns `more: true` when there are more to clear), and refuses if the caller has `communications_banned = true`.',
          '`sanitizeUrl()` + `isSafeAppLink()` now reject `http:` for absolute URLs (HSTS downgrade protection); relative paths starting with `/` still pass. `FilePreview` (Anmeldungen) now wraps the assetUrl through `sanitizeUrl`.',
          'Admin explorer "Open in Directus" link constrains the type segment to a known bucket and url-encodes both path components — defends against any future API response that ships an unexpected `type`.',
          'Sentry Replay `networkDetailDenyUrls` now also denies `sentry-tunnel.kscw.ch` — breadcrumb URL metadata for tunnel traffic stays out of replays.',
          'Game-scheduling rate limiter prefers `CF-Connecting-IP` over `req.ip` over the first hop of `X-Forwarded-For`, closing the path where the limiter could collapse to a single tunnel IP and block all callers (or never block anyone, depending on `trust proxy` config).',
          'Tokenised away-game proposals validate `date` as `YYYY-MM-DD` and `start_time` as `HH:MM` before storing; location capped at 200 chars.',
          'Hook layer: the 3 `EXTRACT(DOW FROM DATE \'${dateStr}\')` interpolation sites in the absence-auto-decline pipeline now go through a `safeDateStr()` regex guard before reaching SQL text — eliminates the lingering string-interpolation risk even though the column type protected us in practice.',
          'Push worker VAPID `sub` claim moved from hardcoded source to `env.VAPID_SUB` worker secret with a `kontakt@kscw.ch` fallback (already shipped in v4.8.4 patch).',
        ],
      },
    ],
  },
  {
    version: '4.8.4',
    date: '2026-05-12',
    sections: [
      {
        title: 'Coaches & team responsibles can manage their players\' absences',
        items: [
          'Coaches and team responsibles can now create, edit and delete absences and weekly unavailabilities for any member of a team they coach or are TR for — useful when a player asks the coach to log an injury or vacation on their behalf rather than doing it themselves. Scope is enforced server-side: a coach can\'t touch a player who isn\'t on one of their teams.',
          'Every staff-issued absence write is attributed: the row now stores `last_edited_by` (the writer\'s user) + `last_edited_at` (wall-clock). When the writer differs from the affected member, the absence card shows an italic *"Edited by team staff on dd.mm.yyyy HH:MM"* line under the reason — so members always see when their record was touched by someone else and never silently.',
          'The affected member also receives an in-app notification when a third party (coach/TR/admin) adds or updates one of their absences or weekly unavailabilities, naming the editor. Self-edits and system writes (cron auto-decline, hall-closure unwind) are silent. Notification keys translated across all 5 locales.',
          'Backend: migration 051 adds the two attribution columns (mirrors migration 046 on `participations`); the kscw-hooks `filter(\'absences.items.{create,update}\')` stamps the writer from `accountability.user` so client-supplied values can\'t be spoofed; the `action` hook fires the notification.',
        ],
      },
    ],
  },
  {
    version: '4.8.3',
    date: '2026-05-12',
    sections: [
      {
        title: 'Deep security audit — eight Fix-this-week findings closed',
        items: [
          'Mass push/email amplification on `POST /kscw/events/:id/notify` closed: the route was unauthenticated. Now requires a logged-in user with admin, sport-admin, event-creator, or coach/TR-of-an-event-team standing.',
          'Audit-log access (`/admin/audit-log`) no longer bypassable by renaming any Directus role to "Superuser": gate switched from the mutable `directus_roles.name` string match to the stable `req.accountability.admin` flag.',
          'Registration form `bemerkungen` (Notes) field is now HTML-escaped before landing in the admin notification email. Public registrants can no longer inject HTML into mail clients.',
          'Push subscription `endpoint` URL is now validated at subscribe time: must be https, host must match a known browser-push-provider allow-list (FCM/APNs/Mozilla/WNS), private/loopback/link-local hosts rejected. Closes an SSRF path through the CF push Worker.',
          'OAuth callback freshness window tightened from 5 min → 2 min, plus a `state=<nonce>` query param is now embedded into the Directus redirect URL and verified on return if echoed back. Halves the session-fixation window on shared/kiosk devices.',
          'LEADER (Coach/TR) policy scope-tightening pass: `members.read`, `participations.read`, `participations.update`, `absences.read`, `games.update`, `trainings.update`, `events.update` were all unfiltered after the v4.8.1 per-user backfill — every coach could read/write across the entire club, including AHV numbers, addresses, and other teams\' game scores. All seven rows now use the coach/TR-of-the-target-team filter; `members.read` adds a field whitelist that excludes `ahv_nummer`. `user_logs.read` removed from LEADER entirely.',
          'Guest-participation block trigger (`trg_participations_guest_block`) now scopes the `guest_level > 0` check to the game\'s own team (migration 050). Seniors who occasionally guest-play for a youth team can again confirm their own primary team\'s games — the original check over-blocked.',
          'Smoke test gains an optional Coach-token negative-assertion pass (reads `DIRECTUS_*_USER_TOKEN_COACH` from `.env.local`): asserts cross-team participation reads return empty and direct `user_logs` read returns 403. Catches LEADER-scope regressions on every deploy.',
          'See SECURITY.md "2026-05-12" block for the full per-finding ledger and PERMISSIONS.md for the updated LEADER row pattern.',
        ],
      },
    ],
  },
  {
    version: '4.8.2',
    date: '2026-05-12',
    sections: [
      {
        title: 'Coaches see their team trainings & events again',
        items: [
          'Michelle Howald coaches H2 and H3 but isn\'t on either roster (Vorstand member, doesn\'t play). After v4.8.1 fixed the LEADER policy attachment, she still saw zero trainings for her teams — because the LEADER policy was missing `trainings.read` entirely, and the Member fallback policy scopes trainings.read to `member_teams` (i.e. you only see trainings of teams you play on, not teams you coach).',
          'Same gap for `events.read` and `events.delete` (LEADER had only create/update, no read or delete). Coaches couldn\'t see private team events or cancel them.',
          'Fix: LEADER now has `trainings.read` and `trainings.delete` scoped via the coach/TR M2M traversal (`team.coach.members_id.user = $CURRENT_USER` OR `team.team_responsible.members_id.user = $CURRENT_USER`), plus `events.read` (with the same coach/TR scope union\'d with the existing club-wide/invited filters) and `events.delete` (scoped to event creator or coach/TR of an attached team). Verified: Michelle can now read H2/H3 trainings; reading trainings of a team she doesn\'t coach correctly returns empty.',
        ],
      },
      {
        title: 'Auto-confirm RSVP — per-activity override + retroactive backfill',
        items: [
          'Per-activity override: training and manual-game forms now show a tri-state "Auto-confirm RSVP" control — *Use team default* / *On* / *Off*. The form hint shows the current team default so coaches see what *Use team default* resolves to. Stored as nullable boolean in new `trainings.auto_confirm_rsvp` and `games.auto_confirm_rsvp` columns (migration 048).',
          'Retroactive backfill: when a coach flips the team-level toggle from off to on (under Team Settings → Game Defaults / Training Defaults), the backend now fills `confirmed` RSVPs for every eligible member on every future training/game that still inherits the team default (`auto_confirm_rsvp IS NULL`). No more "I just turned this on, why isn\'t the next training auto-confirmed?". Same backfill runs when a single activity\'s override flips to *On*.',
          'Effective auto-confirm = `activity.auto_confirm_rsvp ?? team.features_enabled.<training|game>_auto_confirm`. Per-activity *Off* hard-overrides team *On*, so coaches can soft-opt-out specific sessions (informal scrimmages, optional extra trainings) without flipping the whole team.',
          'NOT EXISTS protection kept: absence-declined members and manual RSVPs are never overwritten — backfill only inserts where no row exists yet.',
        ],
      },
    ],
  },
  {
    version: '4.8.1',
    date: '2026-05-12',
    sections: [
      {
        title: 'Coaches & team responsibles can update their teams again',
        items: [
          'Three coaches/TRs lost the ability to edit team settings, dashboard date range, and team preferences after the v4.5.1 permission tightening. Symptom: silent 403 on every team save — visible to the user as a date-range input that wouldn\'t persist, a "Coach present" toggle that snapped back, or a stuck team-settings panel.',
          'Root cause: the LEADER policy was attached to the "Team Responsible" Directus role only. Whether a member got that role depended on the role-sync hook firing — coaches whose junction predated the hook, Vorstand+Coach users, and users with custom roles (e.g. "Website Admin") were stuck on a stale role with no LEADER policy.',
          'Fix: attach the LEADER policy directly to each coach/TR user (per `teams_coaches` / `teams_responsibles` membership), regardless of role. The policy\'s scope filters (`coach.members_id.user = $CURRENT_USER` etc.) already prevent updating teams you don\'t coach, so broadening the attachment is safe. New coach/TR assignments get the attachment in the same transaction as the junction insert; revoked coaches lose it automatically. Backfilled 21 existing coaches/TRs on prod.',
        ],
      },
    ],
  },
  {
    version: '4.8.0',
    date: '2026-05-12',
    sections: [
      {
        title: 'Auto-confirm RSVP — opt-out attendance (PlayerPlus-style)',
        items: [
          'Two new team settings: "Auto-confirm trainings" and "Auto-confirm games" (both off by default). When enabled, every newly created training/game starts with all eligible members already set to "Confirmed" — members who can\'t attend must actively decline.',
          'Trainings: every member of the team is auto-confirmed except those whose `guest_level` is in the training\'s excluded list. Games: only full members (`guest_level = 0`) — guests stay blocked from confirming game participation by the existing Postgres trigger.',
          'Plays cleanly with the absence system: members with an overlapping one-off or weekly absence are auto-declined first (existing behaviour), then the auto-confirm pass fills in the rest via `NOT EXISTS`, so absent members never get incorrectly auto-confirmed.',
          'Find both toggles under Team Settings → Game Defaults / Training Defaults. Translated EN / DE / GSW / FR / IT.',
        ],
      },
    ],
  },
  {
    version: '4.7.0',
    date: '2026-05-10',
    sections: [
      {
        title: 'Coaches can edit notes — with attribution',
        items: [
          'Coaches and team responsibles can now edit a player\'s note from the roster modal alongside the existing status edit. Click the pencil → status dropdown + note input appear side-by-side. Status saves on change; note saves on blur or Enter. Click outside the panel to close.',
          'Every staff edit gets attributed under the row in italic gray: *"Edited to Confirmed by Luca Canepa on 10.05.2026 14:32"* and *"Note edited by Luca Canepa on 10.05.2026 14:35"* — independent lines, so editing only the note doesn\'t reset the status attribution and vice versa. Self-edits and system writes (cron auto-decline, hall closure unwind) leave the row clean.',
          'Same lines appear in PNG/PDF exports under the player name; CSV gets a new "Edited by" column.',
          'Schema: migration 046 added a single tracker, migration 047 split it into per-field `last_status_edited_*` and `last_note_edited_*` (cleaner attribution semantics). Backend hook in kscw-hooks stamps the matching tracker only when the field is in the write payload — system-context writes have null accountability and don\'t pollute the trackers.',
        ],
      },
      {
        title: 'Date & time format: `dd.mm.yyyy` + 24-hour, app-wide',
        items: [
          'All dates render as `dd.mm.yyyy` (`10.05.2026`) regardless of browser language. Every time renders as 24-hour `HH:MM`. Previously English-locale users saw `5/10/26, 2:32 PM` while Germans saw `10.05.2026, 14:32` for the same instant — confusing and inconsistent. The central date/time helpers (`formatDateZurich`, `formatDateCompactZurich`, `formatTimeZurich`, `formatDateTimeCompact`) are now hardcoded to `de-CH` + `hour12: false`, and 7 inline `toLocaleString` call sites that bypassed the helpers were patched.',
          'Same standardisation in the kscw-website repo — `formatDate` helper hardcoded to `de-CH`, plus 6 inline call sites in `index.astro` / `news/index.astro` / `calendar-grid.ts` that previously rendered `30/03/2026` (en-CH slashes) for English visitors. Public site now reads dot-format everywhere.',
          'Rule documented in `CLAUDE.md` (both repos) and `INFRA.md → Time & Date Formatting`.',
        ],
      },
      {
        title: 'RSVP feedback: drop the "Saved" / "Note saved" popovers',
        items: [
          'The active RSVP button stays highlighted and the note input keeps its saved value — visual feedback already exists. Removed the green floating popovers from `ParticipationButton` (home agenda RSVP), `TrainingDetailModal`, `TrainingCard`, `EventDetailModal`, `GameCard`, `GameDetailModal`. Less visual noise on every interaction. Enter on the note input still saves automatically.',
        ],
      },
    ],
  },
  {
    version: '4.6 (4.6.0 → 4.6.7)',
    date: '2026-05-10',
    sections: [
      {
        title: 'Mobile bottom sheets',
        items: [
          '`MoreSheet` and `NotificationPanel` scroll properly on Android Chrome + iOS Safari — both engines mishandle touch-scroll on a transformed compositor layer, and the slide-up animation + scroll container had been the same DOM node. Outer animated wrapper + inner `flex-1 overflow-y-auto overscroll-contain` body.',
          'Drag the sheet down from the top to dismiss (matches Vaul-based detail modals). Drag in the middle of a long admin nav still scrolls normally.',
          'Top close strip is one full-width tap target with the visual handle bar inside; chevron-down button on mobile, X button in the desktop notifications header.',
        ],
      },
      {
        title: 'Roster export — CSV / PNG / PDF',
        items: [
          'Staff/admin Export dropdown in `ParticipationRosterModal` (gated by `canEditRoster`). Three formats; respects the active status filter; "All" appends waitlist + staff. Columns: name (with leadership suffix), jersey number, default positions, status (incl. absence-reason flavour), guests, note, RSVP timestamp.',
          'Header carries an uppercase activity-kind line above the title — `TRAINING` / `GAME` / `EVENT`. Game call sites override with `"<home> vs <away>"` so a game export reads e.g. `KSCW H1 VS PFADI`. Position-summary pill row above the table; CSV gets a `Positions:` metadata line.',
          'PNG/PDF use a hidden printable view portalled to `document.body` (escapes the modal\'s transformed ancestor) inside a zero-size `overflow:hidden` wrapper, so the cloned root passed to `html-to-image` carries no `opacity:0` or off-screen offset that would empty the snapshot. Lazy-loaded `html-to-image` + `jspdf` — main bundle unchanged. PDF slices to multi-page A4 when content overflows.',
          'Filename: `<title>_<filter>.<ext>` when title already contains the date; em/en/hyphen dashes collapse to a single underscore. Sanitised for cross-OS filename safety.',
          'Stale-bundle dynamic-import failures surface as a sonner toast asking the user to refresh (was a silent Sentry).',
          'New `?debugExport=1` URL flag dumps a per-stage console group (rect, computed style, intermediate `toSvg`, final `toPng` size) for future blank-export diagnostics.',
        ],
      },
      {
        title: 'Roster modal correctness',
        items: [
          'Excluded guests no longer leak into the staff-side modal — per-training `excluded_guest_levels` filters them from `memberList`, the visible list, and the export. Games drop any `guest_level > 0` unconditionally.',
          'Summary count vs visible list — modal said "14 Confirmed" while the card-row preview correctly said 13. `playerParticipations` now mirrors `ParticipationSummary` exactly: dedupe by member with best-status priority, drop `is_staff` rows from the player tally, restrict to `memberIdSet`. `getMemberStatus` prefers the non-staff row so visible list, summary counts, and exports agree.',
          '"Coach present" badge driven by a Set of player-coach IDs walking the full participations list — a coach who only carries an `is_staff` confirmed marker still triggers the badge.',
          'Explicit RSVP wins over absence overlay — clicking "Yes" on an activity covered by a weekly unavailability now sticks. A row whose `auto_declined_by` is null is treated as user-owned and its status is sacred. Same fix applied to badge label and `statusLabelText` (used by export). Backend `participations.items.create` filter skips when accountability is set so user-driven creates trust the explicit RSVP.',
        ],
      },
      {
        title: '/status page: real cron heartbeats',
        items: [
          'Migration 045 adds `sync_runs` (`source` PK, `last_run_at`, `status`, `rows_changed`, `duration_ms`, `error_message`). New `logCronRun()` helper upserts on completion. `sv_sync` / `bp_sync` / `vm_sync` / `svrz_sync` record a heartbeat on every termination path. New `gcal_sync` cron at 04:00 UTC calls the existing `/admin/gcal-sync` endpoint nightly (was admin-trigger-only — `hall_events` never auto-refreshed). New `GET /kscw/admin/sync-status` endpoint surfaces the heartbeats; `useInfraHealth.ts` aggregates Swiss Volley as `sv_sync` ∪ `svrz_sync` (most recent wins) and distinguishes stale from errored.',
          '"Awaiting first run" label replaces the literal "20583 d ago" the 1970-epoch seed produced before the first cron fires.',
        ],
      },
      {
        title: 'Localhost dev server',
        items: [
          'Localhost (`localhost`, `127.0.0.1`, `*.local`) ALWAYS points at `directus-dev.kscw.ch`, regardless of `VITE_DIRECTUS_URL` in `.env*` — prod CORS rejects localhost origins, so an env override that pointed there silently broke every fetch.',
          'New `npm run dev:prod` script reverse-proxies all `/directus/*` (REST + WS) from the dev server to prod Directus, so localhost can render against live data when dev is too stale. Loud red console banner on every page load — every write hits live data.',
        ],
      },
    ],
  },
  {
    version: '4.5.4',
    date: '2026-05-10',
    sections: [
      {
        title: 'Roster modal hides excluded guests',
        items: [
          'Trainings with `excluded_guest_levels` set (commit `af71850`, v4.5.x) hid Yes/Maybe/No buttons on the guest\'s own card and server-blocked their `participations.create`, but never touched the staff-side roster view. Excluded guests sat in `ParticipationRosterModal` as zombie "Hasn\'t replied yet" rows — they couldn\'t reply (UI hidden + server 403), and they inflated the "not responded" count.',
          '`ParticipationRosterModal` gained an `excludedGuestLevels` prop and now drops members whose `member_teams.guest_level` is in the excluded set before building `memberList`. Wired through from `TrainingDetailModal` and `TrainingsPage` (passes `training.excluded_guest_levels`).',
          'Games extension: same modal also drops any member with `guest_level > 0` whenever `activityType === \'game\'` — matches the hard rule from `af71850` (games never allow guests). No call-site changes needed; both `GameDetailModal` and `GamesPage` already pass `activityType="game"`.',
        ],
      },
    ],
  },
  {
    version: '4.5.3',
    date: '2026-05-07',
    sections: [
      {
        title: 'Roster duplicate guard — DB constraint + frontend pre-checks',
        items: [
          'Migration 044 adds `UNIQUE (member, team)` on `member_teams`. Same member + same team is now strictly one row; refetch races, double-clicks, or two coaches both hitting "approve" can no longer spawn twins. The migration sanity-checks for existing duplicates and refuses to apply until they are cleaned up by `directus/scripts/dedupe-member-teams.mjs`.',
          'Cleaned up 5 duplicate rows on prod (`Hanna Baumgartner` D4, `Isis Hemprich` D1, `Maëlle Leiser` DU23-2, `Livia Schlegel` D4, `Daniela Duc (Fölmli)` D4) and 1 on dev (`Pawel Kalaga` H1) — all season=2025/26, guest_level=0. Surfaced when D4 admin saw Hanna listed twice on the roster.',
          'Frontend defense-in-depth: `RosterEditor.handleAdd`, `TeamDetail.handleApprove`, and `TeamDetail.handleApproveRequest` now look up `(member, team)` first and no-op (or update `guest_level` for the request flow) if a row already exists, so the constraint catches genuine bugs rather than masking common UX races.',
        ],
      },
    ],
  },
  {
    version: '4.5.2',
    date: '2026-05-06',
    sections: [
      {
        title: 'Audit follow-ups: sv_vm_check Critical closed + ops tooling',
        items: [
          'Closes the last Critical from the 2026-05-06 audit. New `GET /kscw/sv-licence/me` custom endpoint returns the caller\'s own row (joined by `members.license_nr → sv_vm_check.association_id`) with the same 11-field whitelist as before — no PII surface beyond what members already see on their own member row. Direct `sv_vm_check.read` for KSCW Member is now REVOKED entirely, side-stepping the Directus 11 `CASE WHEN 1` SQL bug. `ProfilePage` switched from `useCollection<VmCheck>` to a `kscwApi(\'/sv-licence/me\')` call.',
          '`VAPID_PUBLIC_KEY` env var added to dev container (was the same gap as prod — the hardcoded fallback in `web-push.js` had been load-bearing). Both dev and prod containers recreated to load the env. Push notifications confirmed working on both (vapid endpoint 200).',
          'New `/kscw/admin/migrations-status` endpoint surfaces tracker state (applied count, pending list, latest filename + timestamp). Wired into `/admin/infra` as a new "Migrations applied" stat card — turns yellow with a "N pending" detail if dev/prod fall out of sync. Tracker auto-detects whether the table exists yet and returns a zero-state instead of 500.',
          '`smoke-test.mjs` retired the email/password fallback (`.env.test` was PocketBase-era and unreliable). Now token-only via `DIRECTUS_DEV_USER_TOKEN_MEMBER` / `DIRECTUS_PROD_USER_TOKEN_MEMBER` from `.env.local`, picked by URL. Two new asserts: `sv_vm_check direct (must 403)` and `kscw/sv-licence/me`. 19/19 passing on dev.',
          '`setup-permissions.mjs` auto-loads `.env.local` and resolves the token by URL (`DIRECTUS_DEV_TOKEN` or `DIRECTUS_PROD_TOKEN`), so `npm run db:setup-perms:dev|prod` no longer needs an inline env wrapper. Falls back to `ADMIN_EMAIL`/`ADMIN_PASSWORD` if no token found.',
          'New `npm run db:fresh-install:dev|prod` — single command for a brand-new Directus DB: pipes `SCHEMA.sql` into psql, then runs `db:migrate` + `db:setup-perms` + `db:smoke`. Useful for DR rebuild / fresh dev env / contributor onboarding.',
        ],
      },
    ],
  },
  {
    version: '4.5.1',
    date: '2026-05-06',
    sections: [
      {
        title: 'Deep security audit — 6 surfaces, ~58 findings remediated',
        items: [
          'Frontend hardening: Sentry Session Replay now masks all text/inputs and denies network details for Directus (was capturing PII at 100% on error). OAuth callback rejects token URLs without a fresh sentinel set by `loginWithOAuth` (closes the CSRF substitution path). Sponsor `website_url` and admin BugfixDashboard `pr_url` routed through `sanitizeUrl()`. `RichText` DOMPurify call gets explicit `ALLOWED_URI_REGEXP`. `public/sw.js` pins push-notification click URLs to our origin.',
          'Push worker (`workers/push/`): bearer-secret comparison switched from `!==` to constant-time XOR-fold (`timingSafeEqualStr`) — closes the timing oracle on `AUTH_SECRET`.',
          'Custom endpoints: newsletter Turnstile now fails closed when `TURNSTILE_SECRET` is unset (was returning `true`, opening unlimited mailbomb relay). `/terminplanung/register` no longer leaks the raw token in the response body — only emailed. `/terminplanung/book-home` wrapped in a transaction with `SELECT … FOR UPDATE` and a cross-team check (`slot.kscw_team === opponent.kscw_team`) — closes both the TOCTOU race and cross-team slot sabotage. New shared `capPayload` (caps `/client-error` body to 500 chars) and `ipRateLimit` helpers; `team-invites/claim` rate-limited to 5/15min/IP. `web-push.js` removed hardcoded VAPID public-key fallback (silent split-brain risk).',
          'Custom hooks: announcement audience guard now blocks `audience_sport`-unset posts unless caller is full admin/superuser (a Sport Admin could omit `audience_sport` and broadcast to the entire club). New `filter` on `members.items.update` strips the `role` field unless caller is admin (defense-in-depth on top of field-level perms — the role-sync hook escalates to Directus user role). Junction-delete pending Maps now drained via try/finally + key snapshot (race fix). New `escapeEmailHtml` helper; admin-controlled `rejection_reason` now escaped before email interpolation. `clubdesk-update` `buildChangesTable` HTML-escapes member-supplied `old_value`/`new_value`.',
          'Migration 043: `tasks.read` scoped to assigned/claimed-by self (was unfiltered for KSCW Member). `feedback.read` scoped to own submissions. `teams.update` row-scoped for Coach + Team Responsible (was unfiltered — coach on team A could PATCH team B). `teams_sponsors.sponsors_id` FK with ON DELETE CASCADE (closes the deferred half of migration 037). `SET search_path = public` added to all 8 messaging trigger functions. `bugfix_jobs` explicit REVOKE FROM anon, authenticated.',
          'Permission management redesigned to kill the audit-pass regression cycle. `setup-permissions.mjs` is now the single declarative source for Directus permissions; numbered SQL migrations are SCHEMA-ONLY going forward. New tooling: `apply-migrations.mjs` (with `kscw_migrations` tracker table + sha-tamper detection), `smoke-test.mjs` (logs in as a non-admin Member and asserts no 4xx on critical reads — catches the silent Promise.all-failure pattern from 4.4.4 the same minute it ships), and `regenerate-baseline.mjs` (pg_dumps current schema for fresh installs). Single-command deploy: `npm run db:deploy:dev|prod` runs migrate → setup-perms → smoke. Documented across CLAUDE.md, INFRA.md, SECURITY.md, PERMISSIONS.md.',
          'Open finding: `sv_vm_check.read` cross-member dump remains — Directus 11 emits invalid `CASE WHEN 1` SQL when a row filter is applied on this collection (PG 12+ rejects). Fix path is a custom `/kscw/sv-licence/me` endpoint + revoke direct read; tracked in SECURITY.md.',
        ],
      },
    ],
  },
  {
    version: '4.5.0',
    date: '2026-05-05',
    sections: [
      {
        title: 'Coach Dashboard expansion + game/event card parity',
        items: [
          'Coach Dashboard expanded to /games — new tab with per-row drilldown and a league-only toggle so cup games can be excluded from attendance stats at will.',
          'Trainings + games dashboards: replaced the season selector with a persisted From/To range. Defaults to 01.06 of the current season → today and rolls forward annually. The range is stored per-team on the team row, so each coach/TR sees their own settings persist across sessions.',
          'Bucket simplification across both dashboards: weekly and one-off absences now both count as "absent" (the old "excused" bucket is gone). A confirmed RSVP always wins over a covering absence so the count reflects reality, and trend dots are now green/red only.',
          'GameCard + EventCard feature parity with TrainingCard: always-visible note input, respond-by line, roster opener, and edit/delete pencils. Delete is only available for manually-created games (SVRZ-synced games are read-only as before).',
          'Migration 041 + setup-permissions update: three new team-row columns (`dashboard_range_from`, `dashboard_range_to`, `dashboard_league_only`) are guarded by leaving them out of `PUBLIC_TEAM_FIELDS`; an explicit Coach/TR read+update row is added so only authorized team members can change them.',
        ],
      },
    ],
  },
  {
    version: '4.4.15',
    date: '2026-05-05',
    sections: [
      {
        title: 'Absence-aware RSVP gates + training hall edit no longer 500s',
        items: [
          'Two fixes. (1) Inline RSVP buttons on training / game / event cards and on calendar entries did not check whether a covering absence existed — only the detail modals did. So an auto-declined row would render its red "No" pill but still let you click "Yes" or "Maybe" to flip it. The PATCH went through (migration 038\'s trigger detaches `auto_declined_by` on user-driven status changes, by design — it allows true manual overrides after an absence is removed), and the absence got silently overwritten. New `useMyCoveringAbsence(activityType, activityDate)` hook; `TrainingCard.TrainingParticipation`, `GameCard.GameCardParticipation`, `EventCard.EventCardParticipation` and the shared `HookedParticipationButton` (which the calendar entry modal uses) now early-return a passive "Excused" pill when an absence covers, mirroring the detail modals. The trigger semantics stay untouched, so deleting/narrowing the absence and then RSVPing still works exactly as before.',
          'Editing a training\'s hall returned **500 invalid input syntax for type integer: ""**. `TrainingForm.handleSubmit` was sending empty strings for two nullable integer FKs: `hall_slot` (when not in auto mode) and `hall` (when "Other / custom name" was selected). Postgres rejects `""` for an integer column. Both now send `null`. Affects every training edit that toggled hall mode or used a custom hall name.',
        ],
      },
    ],
  },
  {
    version: '4.4.14',
    date: '2026-05-03',
    sections: [
      {
        title: 'Home agenda — Mondays no longer green when you\'re unavailable, "Coach present" badge no longer hidden',
        items: [
          'Two related "My next appointments" bugs on the home page. (1) The strip on training rows could still render green ("confirmed") even with a `declined` participation and a covering weekly absence. v4.4.12 fixed the *internal* lookup in `useBulkParticipationStatuses` to use the composite `(activity_type, activity_id)` key, but missed the *output* map — that one still keyed by numeric `activity_id` alone. As soon as the home page passed a mixed list of trainings + games + events to the hook, an `event:1 confirmed` overwrote `training:1 declined` (last write wins), and every Monday training on row id=1..4 painted itself green even though the underlying participation was declined. Output map now keyed by composite, callers updated to pass `(type, id)` via a new `getParticipationStatus(type, id)` accessor. (2) "Coach present" badge was missing on most trainings the user was actually coaching. The home page fetched trainings with `team.*`, which only expands scalar fields + M2O FKs — so `team.coach` and `team.team_responsible` (both M2M) were `undefined`, and `teamCoachIds(team)` returned just the captain. Player-coaches (the user, in this case) were invisible to the badge logic. Added `team.coach.members_id`, `team.team_responsible.members_id` to the trainings fetch, and the equivalent `kscw_team.coach.members_id` / `kscw_team.team_responsible.members_id` to all four games fetches.',
        ],
      },
    ],
  },
  {
    version: '4.4.13',
    date: '2026-05-03',
    sections: [
      {
        title: 'SVRZ daily sync was crashing — now fixed',
        items: [
          'The Volleymanager scheduling sync (`svrz_sync` cron) had been failing every morning at 04:30 with what looked like a CSRF parsing error on the SVRZ "playing-schedule responsible addresses" page. Real cause was hidden behind a misleading error: after login the script needs to enter the volleyball sub-app context (a step the browser does invisibly), and without it every indoor page except the games list returns 403 Forbidden. `csrfFromPage()` only checked the regex, not the HTTP status, so a 403 error page surfaced as "CSRF token extraction failed". Added the missing context-enter step to the login flow — verified live against prod, all SVRZ pages reachable again. Same fix also future-proofs the monthly licence sync (vm-sync-check), which would have hit the same 403 on June 1. Hardened the CSRF helper to report HTTP status on failure so future SVRZ-side drift is diagnosed in one log line.',
        ],
      },
    ],
  },
  {
    version: '4.4.12',
    date: '2026-05-03',
    sections: [
      {
        title: 'Training row strip now matches your actual RSVP',
        items: [
          'A training row could render its left strip green ("confirmed") even when you had a `declined` participation and a covering weekly absence — the roster modal would correctly say "Unavailable" while the row insisted you were going. Root cause: `useBulkParticipationStatuses` keyed its internal lookup by `activity_id` alone, with no `activity_type`. If you had separate participations on different activity types that happened to share the same numeric id (e.g. `training:4 declined` + `event:4 confirmed`), the second one overwrote the first depending on Directus return order, so the wrong status would surface. The query also was not filtered by activity_type, which made the collision more likely. Both the filter and the JS map are now keyed on the composite `(activity_type, activity_id)`.',
          'Roster modal sub-label "last month" / "vor einem monat" / etc. now sentence-cased — `Intl.RelativeTimeFormat` emits lowercase, which read awkwardly as a standalone label.',
        ],
      },
    ],
  },
  {
    version: '4.4.11',
    date: '2026-05-03',
    sections: [
      {
        title: 'Emails now respect your language too',
        items: [
          'Push notifications were already locale-aware in 4.4.9, but emails still bucketed recipients into just DE or EN — and even worse, admin alias addresses (kontakt@kscw.ch, the volleyball@/basketball@ aliases, OWNER_EMAIL constants) had no member record, so they always fell into the German bucket. Anyone reading those forwarding aliases got a duplicate German copy of the same email a real admin had already received in their preferred language. Expanded `bucketEmailsByLocale` to all five locales (de / gsw / en / fr / it), added a `members.email` fallback so admin addresses without a Directus user still resolve, and translated the registration confirmation, ClubDesk update, contact form, event invite, team-join request, and broadcast emails into the full set. Replaced the OWNER_EMAIL CC pattern in registration with a separate localized send (matches the registering user\'s locale) so the alias never receives a German copy of an English admin email.',
        ],
      },
    ],
  },
  {
    version: '4.4.10',
    date: '2026-05-03',
    sections: [
      {
        title: 'Weekly unavailability now actually overrides existing RSVPs',
        items: [
          'Setting a weekly unavailability after you had already RSVP\'d ✓ to a covered training/game/event left your participation stuck on confirmed — the green strip on the row stayed green even though the roster modal showed "Declined (Absence)". The auto-decline hook only INSERTed new declines and skipped any activity where a participation row already existed; the new RSVP path also did not respect existing absences. Hook now UPDATEs existing confirmed/tentative/waitlisted rows on absence create/update and a new participation-create filter silently flips fresh RSVPs to declined when a covering absence exists. Migration 038 reshapes the `auto_declined_by` clear-marker trigger so the hook can set status + marker in one statement, and backfills currently-conflicting rows (6 rows on prod).',
          'Roster modal now distinguishes weekly unavailability ("Unavailable") from one-time absence ("Declined (Absence)"), and respects `days_of_week` + `affects` so a Mon-only weekly absence no longer marks you absent on Tuesdays.',
        ],
      },
    ],
  },
  {
    version: '4.4.9',
    date: '2026-05-03',
    sections: [
      {
        title: 'Push notifications now respect your language',
        items: [
          'The daily “you have an activity tomorrow” reminder, the RSVP deadline reminder, team-join requests, scorer delegation accepted/declined, event invites, club news fan-out, and direct messages all sent a hardcoded German string regardless of the recipient’s `members.language`. Push payloads are baked at send time, so toggling the in-app language could not localize them after delivery. Fix: a new push-i18n helper buckets recipients by locale (de / gsw / en / fr / it) and dispatches one push per bucket with translated strings. Announcements use their own per-locale translations field; emails were already locale-aware and unchanged.',
        ],
      },
    ],
  },
  {
    version: '4.4.8',
    date: '2026-05-02',
    sections: [
      {
        title: 'Activity log no longer fails for members',
        items: [
          'When a regular member edited a roster, slot, or RSVP, the silent activity-log write was being rejected by the API with "Invalid numeric value". The audit row was actually being created — the post-insert read was failing because the row-level filter compared an integer member id against the Directus user UUID. Fixed the filter to traverse through the member relation. Affected 36 members / 75 failed writes over the last month.',
        ],
      },
      {
        title: 'Volleymanager monthly sync no longer times out',
        items: [
          'The 1st-of-month VM licence sync was running with a 120s synchronous timeout that blocked the API event loop the whole time. Switched to an async spawn with a 10-minute budget, matching the SVRZ schedule sync.',
        ],
      },
    ],
  },
  {
    version: '4.4.7',
    date: '2026-04-30',
    sections: [
      {
        title: 'iOS Safari: training/event dates now render',
        items: [
          'Date columns coming back as bare "YYYY-MM-DD" were rendering empty on iPhone Safari (e.g. weekday next to the team chip on training cards). Root cause: the date formatter appended a `Z` to the bare date producing "2026-05-07Z", which V8 parses but JavaScriptCore rejects as Invalid Date — so the formatter returned `""`. Fixed by anchoring bare dates to `T00:00:00Z` before parsing. Affects every Zurich-zoned formatter (date, weekday, compact, datetime, relative, time).',
        ],
      },
      {
        title: 'M2M cascades on the remaining junctions',
        items: [
          'events_teams, events_members, hall_events_halls, hall_slots_teams, teams_sponsors had FKs declared `ON DELETE SET NULL` instead of CASCADE. When a parent (event/hall_event/hall_slot/team) was deleted, the junction row stayed behind with a NULL FK — Directus then serialised that NULL as the literal string "null" in `_in` filters, breaking integer columns with a 400 error. Migration 037 deletes existing orphans (5 events_teams, 1 events_members) and rebuilds the constraints as CASCADE. Continues the work of migration 021.',
        ],
      },
    ],
  },
  {
    version: '4.4.6',
    date: '2026-04-30',
    sections: [
      {
        title: 'Third-pass permission audit',
        items: [
          'Coaches and Team Responsibles can now only edit position/number for members on a team they actually coach / are responsible for (the API field-level update was open before; the UI was already gating it).',
          'Event sessions and event-member invitations are now visible only for events you can see — same scope as the events list itself.',
          'Cleaned up duplicate permission rows left over from past M2M re-creations (cosmetic, no behaviour change).',
        ],
      },
    ],
  },
  {
    version: '4.4.5',
    date: '2026-04-30',
    sections: [
      {
        title: 'Second-pass permission audit',
        items: [
          'Public (unauthenticated) access removed from participations, events, events_teams and slot_claims — these are internal data and were never consumed by the public site. The kept-public reads (games, members directory, halls, hall slots, rankings, sponsors) are unchanged.',
          'Polls and referee expenses are now scoped to your own teams on read — like trainings and absences in the previous releases.',
          'Coach reads on participations and absences are now scoped to teams the coach actually coaches (writes were already scoped; reads were left open).',
          'Postgres-level grant on `event_signups` revoked from anon/authenticated — defense in depth; PostgREST is stopped, but the grant was still hanging.',
        ],
      },
    ],
  },
  {
    version: '4.4.4',
    date: '2026-04-30',
    sections: [
      {
        title: 'RSVPs and team-context loads are working again',
        items: [
          'Yesterday\'s scoping fix surfaced an older bug: the `spielplaner_assignments` collection had no read permissions for any non-admin policy, so loading your team list silently failed for every member. Before the audit you couldn\'t tell because the wide-open backend just returned everything; once we tightened reads, the empty team list meant you saw nothing and couldn\'t RSVP.',
          'Granted self-scoped read access to the collection for all KSCW policies. Team context now loads correctly and RSVPs work again.',
        ],
      },
    ],
  },
  {
    version: '4.4.3',
    date: '2026-04-29',
    sections: [
      {
        title: 'Privacy: absences, RSVPs and events are scoped to your teams',
        items: [
          'You no longer see absences for members outside your own teams. Same goes for participation/RSVP rows on activities you have no access to.',
          'Events are scoped too — you see club-wide events (Vereinsanlässe, tournaments), events your teams are invited to, events you were personally invited to, and events you created. Other teams\' private events are no longer visible.',
          'Match schedules (games) intentionally remain visible across the club — same as before.',
          'Coaches, Team Responsibles, Sport Admins and Vorstand keep their wider read access.',
        ],
      },
    ],
  },
  {
    version: '4.4.2',
    date: '2026-04-29',
    sections: [
      {
        title: 'Trainings are scoped to your teams',
        items: [
          'Members now only see trainings for the teams they belong to — previously a permission gap meant every member could read every team\'s training records via the API.',
          'Public access to the trainings endpoint was also removed; nothing public consumed it.',
          'Coaches, Team Responsibles, Sport Admins and Vorstand are unaffected — their wider scope is preserved.',
        ],
      },
    ],
  },
  {
    version: '4.4.1',
    date: '2026-04-25',
    sections: [
      {
        title: 'Set-score boxes align cleanly',
        items: [
          'Per-set boxes in the games list and the game detail modal now share a fixed width — single-digit results (e.g. "8") no longer make the row jitter against double-digit results.',
          'Same fix applied on kscw.ch (public game modal).',
        ],
      },
    ],
  },
  {
    version: '4.4.0',
    date: '2026-04-25',
    sections: [
      {
        title: 'Tables everywhere data lives',
        items: [
          '9 list pages were converted to proper tables: roster editor, announcements, audit log, registrations, referee expenses, admin reports, absences (mine + team + weekly), Spielplanung list, calendar unified list, news archive.',
          'Each table compacts gracefully on mobile — names wrap to two lines instead of truncating, position labels collapse to initials (S/O/M/D/L/G), optional columns hide on small screens, and action buttons stack vertically so everything stays tappable.',
          'Cards are kept where they earn their keep — game/training/event cards (RSVP, scores, opponent logos), team cards (team photo + brand color), and the changelog itself are explicit exceptions to the new rule.',
        ],
      },
      {
        title: 'Absences page reorganised',
        items: [
          'New two-axis toggle: Absences | Unavailabilities × Mine | Team. The two button rows replace the previous single 3-tab bar — same visual style, four sections.',
          'New "Team Unavailabilities" view shows everyone\'s recurring weekly schedules in your team — useful for spotting clashes without messaging around.',
          'Team scope is now visible to every team member, not just coaches/team responsibles. The backend permission was already open; only the UI was gating it.',
        ],
      },
    ],
  },
  {
    version: '4.3.0',
    date: '2026-04-24',
    sections: [
      {
        title: 'Basketball Halle A+B combo booking',
        items: [
          'Basketball home games can now block both KWI A and KWI B at once. The manual-game modal shows a "KWI A + B (Basketball)" option at the top of the hall picker for basketball teams.',
          'Excel import recognises A+B / KWI A+B / A + B in the Hall column for basketball rows.',
          'Game detail drawer has a one-click "Mark as KWI A + B" / "Back to single hall" toggle — works on SVRZ-synced games too.',
          'Conflict detection is now multi-hall-aware: a basketball A+B game correctly blocks a volleyball-only game on either KWI A or KWI B at the same time.',
        ],
      },
      {
        title: 'Volleyball Saturday hall prefill',
        items: [
          'When creating a home game for a volleyball team on a Saturday, the hall field prefills with a priority ladder: (1) the team’s own Saturday training slot, (2) KWI C, (3) KWI A, (4) KWI B.',
          'A muted hint explains the choice. The pick is a prefill only — admins can override it freely.',
        ],
      },
      {
        title: 'Under the hood',
        items: [
          'New `games.additional_halls` JSON field (nullable, cast-json, tags interface) on the games collection.',
          'Hallenplan no longer infers basketball spans from `team.sport` — spans now come from `additional_halls`. A backward-compat fallback keeps legacy basketball rows rendering correctly until they’re re-saved.',
        ],
      },
    ],
  },
  {
    version: '4.2.0',
    date: '2026-04-23',
    sections: [
      {
        title: 'Spielplanung sandbox mode',
        items: [
          'Admins and Spielplaners can now create, edit, and delete manual games directly on the calendar. Empty-day "+" affordance opens a modal with the date prefilled; edit/delete happens from the game detail drawer.',
          'Bulk Excel import for manual games — download the template, fill in one game per row, upload to preview and import.',
          'New scoped Spielplaner role via a `spielplaner_assignments` collection. Admins can grant per-team access without making someone a club-wide Spielplaner (admin-only accordion on the page).',
        ],
      },
      {
        title: 'Week view with drag-to-reschedule',
        items: [
          'New "Week" option in the view toggle shows the 14:00–22:00 time rail with game blocks sized to the full 2h 45min window (45min warm-up + 2h play).',
          'Manual games are draggable — drop on a different day or time to reschedule. 15-minute time snap; conflicts (same team same day, hall overlap) block the move with an error toast; same-team within ±2 days shows a soft warning.',
          'Touch drag works on phone browsers. SVRZ-synced games are not draggable.',
          'Desktop only — mobile keeps the existing by-date / by-team list views.',
        ],
      },
      {
        title: 'Calendar refinements',
        items: [
          'Richer month-view chips show time, home/away icon, opponent, with a colour-coded left border (emerald = home, blue = away). Manual games carry a dashed outline.',
          'Month navigation no longer clamps to the current Swiss Volley season — prev/next arrows cross season boundaries freely, and a new season picker jumps between seasons directly.',
          'Game detail drawer gained edit mode with SVRZ-field locking — official fields are disabled against edit for SVRZ-synced games; only duty assignments stay editable. "Copy SVRZ details" makes Volleymanager paste-back a one-click operation.',
        ],
      },
    ],
  },
  {
    version: '4.1.0',
    date: '2026-04-23',
    sections: [
      {
        title: 'SVRZ game-scheduling invites',
        items: [
          'Spielplan admins can now issue tokenized links to specific opponent clubs instead of relying on self-registration — each link opens the slot picker directly without a captcha.',
          'New "Aus SVRZ importieren" button auto-populates the opponent list from the synced SVRZ game feed and pulls Spielplanverantwortlicher contacts via the per-game endpoint (with a club-level fallback feed for clubs without per-game entries).',
          'Manual CSV paste is available alongside SVRZ import for opponents not in the feed.',
          'One-click "Mail entwerfen" opens a pre-filled mailto with a DE invitation body, tokenized link, and expiry date.',
          'Full invite lifecycle: invited → viewed (on first open) → booked (after a slot pick), with reissue + revoke actions.',
          'Daily SVRZ sync keeps games and club contacts fresh; admins can also trigger a manual sync from the panel.',
        ],
      },
    ],
  },
  {
    version: '4.0.6',
    date: '2026-04-22',
    sections: [
      {
        title: 'Notifications',
        items: [
          'You can now delete individual notifications — a small trash icon appears on each row in both the mobile panel and the desktop sidebar.',
          'New "Clear read" button in the header wipes all already-read notifications in one click. Unread ones are left alone, so nothing urgent gets thrown away accidentally.',
          'Available in all five languages (DE / GSW / EN / FR / IT).',
        ],
      },
    ],
  },
  {
    version: '4.0.5',
    date: '2026-04-22',
    sections: [
      {
        title: 'Moderation notifications',
        items: [
          'Tapping a "New report" notification in the desktop sidebar now opens /admin/reports instead of silently routing to the homepage. The desktop panel was missing the route handler that the mobile panel already had.',
          'The reason label inside the notification ("Neue Meldung: spam") is now properly translated and capitalised ("Neue Meldung: Spam" / "Belästigung" / "Unangemessen" / "Sonstiges") in all five languages. Was rendering the raw enum value.',
          'Desktop sidebar also gained the correct activity label ("Meldung" instead of the generic "Aktivität" fallback) and a Flag icon for report notifications.',
        ],
      },
    ],
  },
  {
    version: '4.0.4',
    date: '2026-04-20',
    sections: [
      {
        title: 'Navigation',
        items: [
          'Inbox (Messaging) now sits at the top of the mobile More sheet secondary list, above Events. It was getting lost below the other entries.',
        ],
      },
    ],
  },
  {
    version: '4.0.3',
    date: '2026-04-20',
    sections: [
      {
        title: 'Navigation',
        items: [
          'Mobile More sheet now mirrors the desktop sidebar. Inbox, News, Announcements, Moderation Reports, Infra Health and the Messaging Settings row were missing — they are now all there. The "What\'s New" row finally shows the real version number instead of a hardcoded v1.0.0.',
          'Tapping anywhere on the user row in the More sheet now opens your profile. Only the red "Logout" button on the right still logs you out.',
          'Desktop sidebar gained the Status and What\'s New entries the mobile menu already had, so the two layouts now expose the same options.',
        ],
      },
      {
        title: 'Status page',
        items: [
          'The public /status page now opens with an at-a-glance health banner — green "Alle Systeme laufen" when everything is fine, amber/red when the API is slow, a sync is stale, or a service is down. The recent-fixes list is kept below so you can still see what changed this week.',
        ],
      },
      {
        title: 'Changelog',
        items: [
          'Changelog entries are now justified with automatic hyphenation — blocks of German text look much tidier on narrow screens.',
        ],
      },
    ],
  },
  {
    version: '4.0.2',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Follow-up to the 4.0.1 consent fix: audited every other field the frontend reads from member records and closed more silent gaps. The Spielplaner menu now appears for members flagged as Spielplaner (not only for admins). Coaches now see the full roster when assigning scorers or delegating games — previously the list rendered empty because the active-membership flag wasn\'t exposed. Your own profile now correctly shows "Aktiv" / "Passiv" and your Beitragskategorie. Shell-member badges (amber border) now render on team rosters for everyone.',
        ],
      },
    ],
  },
  {
    version: '4.0.1',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Critical fix for the messaging consent modal. Members could tap "Accept" but the dialog kept reappearing after every page reload, effectively blocking them from reaching the rest of the app. The backend was recording the decision correctly — the member record just didn\'t expose the consent fields to the owner, so the frontend never saw that consent had been granted. Now fixed for everyone.',
        ],
      },
    ],
  },
  {
    version: '4.0.0',
    date: '2026-04-20',
    sections: [
      {
        title: 'Added',
        items: [
          'Messaging is now available to everyone in the club. Team chats, direct messages, reactions, edits, polls and reports are no longer behind the test-group allowlist. Staged rollout is over — the platform now doubles as the club\'s primary communication channel.',
        ],
      },
    ],
  },
  {
    version: '3.17.1',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fixed',
        items: [
          'The "Coach da" indicator now appears on game and training cards and on the homepage appointment rows when a player-coach has confirmed — not only when someone explicitly responded as staff. Detail modals already worked; the list views have been brought in line.',
        ],
      },
    ],
  },
  {
    version: '3.17.0',
    date: '2026-04-20',
    sections: [
      {
        title: 'Added',
        items: [
          'Trainings are now automatically cancelled when a hall closure covers their date. Delete or shorten the closure and the trainings are restored — unless a coach manually re-cancelled them in the meantime, in which case the manual decision is preserved.',
          'Hallenplan now deduplicates overlapping closures: Sportferien beats "Halle geschlossen", and a Ferien closure hides any lower-priority closure covering the same date. No more doubled-up labels.',
          'New events now auto-decline for members already on absence (previously only trainings and games did this at create time; events waited for the nightly sweep).',
          'When a training, game, or event is rescheduled, participation is re-evaluated against existing absences: stale auto-declines for the old date are reversed, and new ones for the new date are added if the member is still absent.',
          'Deleting or shortening an absence now reverses the auto-declined participations it had created. Manual overrides (members who changed their own answer) are kept untouched.',
        ],
      },
      {
        title: 'Technical',
        items: [
          'Migration 028 adds two marker columns: `participations.auto_declined_by` (→ absences.id) and `trainings.auto_cancelled_by_closure` (→ hall_closures.id). BEFORE UPDATE triggers auto-clear the markers on manual edits so reversals never touch user-owned rows.',
        ],
      },
    ],
  },
  {
    version: '3.16.7',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Response-time on the participation roster now shows for confirmed and maybe responses too, not just declined. Previously it only appeared when someone had changed their answer at least once.',
        ],
      },
    ],
  },
  {
    version: '3.16.6',
    date: '2026-04-20',
    sections: [
      {
        title: 'Security',
        items: [
          'Coaches can now only modify data belonging to the teams they coach. Previously a coach could edit or delete trainings, games, events, hall slot claims, task templates, referee expenses and scorer delegations for any team in the club.',
          'Sport Admins can no longer delete member accounts or teams. They can still edit and create (intake workflows are preserved); only full KSC Wiedikon admins can delete.',
          'Tightened the Content-Security-Policy: removed wildcard Sentry subdomains from the allowlist since error reports go through our own tunnel worker. No user-facing change; reduces the blast radius of a hypothetical Sentry subdomain compromise.',
        ],
      },
    ],
  },
  {
    version: '3.16.5',
    date: '2026-04-20',
    sections: [
      {
        title: 'Security',
        items: [
          'Messages, conversations, and reports are now strictly scoped: only the people involved can read them. Previously, any logged-in member could call the raw data API and read every message and report in the system. Fixed server-side.',
          'Other members\' email and phone are no longer exposed through the raw data API. You still see your own contact details, and the app still fetches what it needs through the proper endpoints.',
          'Rate-limited message reports (max 5 per hour per member) to prevent spam flooding the moderation inbox.',
          'Deleted messages now clear their body on the server — not just hide it — so the content can\'t be retrieved through other data-API paths.',
          'Broadcast sends now have a per-sender global cap (max 10 broadcasts per sender per hour) on top of the existing per-activity limit.',
          'Anonymous feedback can no longer pre-set the "status" field when submitting (prevented suppression of complaints).',
          'Updated Vite and DOMPurify to patched versions (CVE fixes).',
        ],
      },
    ],
  },
  {
    version: '3.16.4',
    date: '2026-04-20',
    sections: [
      {
        title: 'Languages',
        items: [
          'Dates, times, birthdates and member-row timestamps now all follow your selected app language instead of always being German/Swiss. Profile, team rosters, public status page, admin audit log, data-health + infra-health dashboards, explore page, results table and Hallenplan month abbreviations are all localized.',
          'Volley-feedback admin dashboard was bilingual only (de / en). It is now fully translated into de, en, fr, it, and gsw.',
          'Cancel / Save / Delete / Create buttons and confirm dialogs across club news editor, delete-account, group chat menu, new-message dialog, block-member dialog and Spielsamstag editor no longer fall back to German labels for non-German users.',
          'Roster and scorer-assignment sorting now uses your language\'s alphabet rules (e.g. ö / è / ä sort correctly) instead of always German.',
        ],
      },
    ],
  },
  {
    version: '3.16.3',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Your own Yes / Maybe / No on the trainings and games lists is highlighted again. The buttons used to render in the default grey state and the colored left banner was missing, even when you had already responded.',
          'The "Show response time" toggle in team settings now actually shows when each member responded in the participation roster.',
        ],
      },
    ],
  },
  {
    version: '3.16.2',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Weekday abbreviations in the upcoming appointments list (Mo / Di / Mi …) now follow your selected app language instead of being locked to German. English, French, and Italian users will see the right abbreviations.',
        ],
      },
    ],
  },
  {
    version: '3.16.1',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Opening a chat no longer loads in stages — the header (peer name + avatar), the thread, and the composer now all appear together after a single spinner, instead of the header filling in after the messages.',
          'Admin notifications for new reports ("New report: spam", etc.) now open the admin report page when tapped. Previously they navigated to the home screen because the notification type was not routed.',
        ],
      },
    ],
  },
  {
    version: '3.16.0',
    date: '2026-04-20',
    sections: [
      {
        title: 'Chat',
        items: [
          'The other person\'s messages now appear on the right. Your own messages stay on the left.',
          'Tap the "edited" tag on any edited message to see the original version. Your message can still be edited any time.',
        ],
      },
      {
        title: 'Fix',
        items: [
          'Reaction button (SmilePlus) and message actions menu (⋮) are now visible on mobile — previously hover-only, so touch devices could not reach them.',
          'Editing a message now updates immediately instead of appearing to do nothing. Errors during save are now shown under the textarea instead of being swallowed.',
          'Own vs other-user detection now coerces IDs, so your messages are correctly distinguished even when the backend returns numeric IDs.',
        ],
      },
    ],
  },
  {
    version: '3.15.9',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          '2. Liga rankings now show the 2nd place with the blue barrage-up marker, completing the SVRZ regulation alignment started in 3.15.8.',
          'Talents (RTZ) teams no longer hide promotion or relegation markers from eligible teams. Since talents cannot promote or relegate, the green/red/orange/blue markers now fall on the next eligible team — e.g. if a talents team is in 1st place, the 2nd-placed team gets the green promotion marker instead.',
        ],
      },
    ],
  },
  {
    version: '3.15.8',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Rankings side-banner colours now match the SVRZ regulation. Every regional league shows the 2nd place (barrage up) in blue and the 2nd-to-last (barrage down) in orange — previously these were missing in 3. Liga and 4. Liga, so barrage teams looked safe.',
          'Men\'s 4. Liga is the bottom men\'s league and no longer shows a relegation marker on the last place (there is no 5. Liga for Herren).',
        ],
      },
    ],
  },
  {
    version: '3.15.7',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Inbox: switching between conversations no longer briefly shows the previous conversation\'s messages, and messages that arrive in the moment the thread opens are no longer dropped when the initial load finishes.',
          'Inbox list and member list behave the same way — the result of a stale fetch can no longer overwrite a newer one.',
          'Sentry error tunnel now reports a specific reason when it rejects an event (gzip decode, empty body, missing DSN, …) instead of a generic 400, so future tunnel regressions are diagnosable.',
        ],
      },
    ],
  },
  {
    version: '3.15.6',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Games page no longer fails to load. When a coach role was orphaned (team deleted, but the coach assignment left behind), the filter contained an invalid team reference and the server rejected the whole request. Now we skip orphaned assignments and cleaned up the leftover data.',
        ],
      },
    ],
  },
  {
    version: '3.15.5',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Conversation page no longer crashes when tapping the back button. The shadcn Button wrapper was injecting an extra (empty) slot child, which tripped a Radix assertion and blanked the page.',
          'Cloudflare analytics beacon now allowed by CSP (no more blocked-connection warnings in the console).',
          'Added the standards-compliant `mobile-web-app-capable` meta tag alongside the Apple-specific one (removes the browser deprecation warning).',
        ],
      },
    ],
  },
  {
    version: '3.15.4',
    date: '2026-04-20',
    sections: [
      {
        title: 'Performance',
        items: [
          'Games and trainings pages load in a single request. Previously the cards appeared empty for about a second on mobile while participations loaded separately — now everything arrives together.',
        ],
      },
      {
        title: 'Improved',
        items: [
          'Games page: upcoming and results now split into separate "Meisterschaft" and "Cup" sections, so cup games (Mobiliar Volley Cup, Züri Cup) no longer get mixed in with regular league games.',
        ],
      },
    ],
  },
  {
    version: '3.15.3',
    date: '2026-04-20',
    sections: [
      {
        title: 'Improved',
        items: [
          'Event, training, and game detail modals — cleaner mobile layout. The RSVP summary at the bottom now uses the same 3-bar visual as the cards, the broadcast (paper-plane) button moved to the top-right of the modal header, and the "Teilnahme" roster button is now a compact icon.',
        ],
      },
    ],
  },
  {
    version: '3.15.2',
    date: '2026-04-20',
    sections: [
      {
        title: 'Fix',
        items: [
          'Coaches now have all the permissions they need to manage their team: assign coach/team-responsible roles, change the team photo, accept or reject member requests, create polls, and edit their own Hallenplan slots. Previously some of these actions failed with a "No permission" error.',
          'Rejecting a pending member request no longer hard-deletes the account — it deactivates it instead (audit trail preserved).',
        ],
      },
    ],
  },
  {
    version: '3.15.1',
    date: '2026-04-19',
    sections: [
      {
        title: 'Fix',
        items: [
          'Coaches could not create events for their team — the save button threw a "No permission" error. Fixed: the event form now sends teams and invitees in the Directus junction format, and the role policies were missing create/update/delete permissions on the events_teams and events_members M2M tables.',
        ],
      },
    ],
  },
  {
    version: '3.15.0',
    date: '2026-04-19',
    sections: [
      {
        title: 'Under the hood',
        items: [
          'Internal datetime handling switched to proper UTC storage with Europe/Zurich rendering. Nothing changes in the times you see — but now the app, Directus admin, email notifications, and iCal calendar subscriptions all agree on the same Zurich-local hour, and DST transitions are handled precisely.',
        ],
      },
    ],
  },
  {
    version: '3.14.0',
    date: '2026-04-19',
    sections: [
      {
        title: 'New',
        items: [
          'Broadcast feature: additional "In-App Chat" channel for event broadcasts. When enabled, a persistent chat is created per event where coaches and admins can post and participants can reply directly. RSVPs automatically control chat membership: "Going"/"Maybe" adds you, "Declined" archives you.',
          'The broadcast success toast now shows an "Open chat" action that jumps straight to the event chat.',
          'Event chats follow the personal "Team chat" toggle: if you have globally disabled chat, event chats will not appear in your inbox (can be un-archived per chat).',
          'The in-app channel is available for events only — games and trainings remain on email + push.',
        ],
      },
    ],
  },
  {
    version: '3.13.0',
    date: '2026-04-19',
    sections: [
      {
        title: 'New',
        items: [
          'Broadcast feature: coaches, team responsibles, the board and admins can now write to all participants directly from the activity detail view (event, game, training) via email or push notification — with an audience filter (e.g. confirmed only) and a live recipient count.',
          'External signups (e.g. the Mixed-Tournament form on the website) are now bundled in a generic event_signups table — ready for future public signup forms. They can be included in event broadcasts.',
          'Broadcast audit trail: every send is logged with sender, recipient snapshot, channels, and delivery results (nFADP-compliant).',
          'Broadcast rate limit: max. 3 per activity per hour, minimum 20-minute gap — protects against accidental spam.',
        ],
      },
    ],
  },
  {
    version: '3.12.0',
    date: '2026-04-19',
    sections: [
      {
        title: 'New',
        items: [
          'Messaging feature is fully built and live on the server — team chats, direct messages, polls, reactions, reports, consent, data export, and push notifications. Activation for members happens in a next step (test group first, then everyone).',
          'Privacy policy: new "Messages" section at /datenschutz#nachrichten with details on stored data, retention periods (12 months / 30 days / 90 days), access, and rights.',
          'Test rollout mode: individual members can try the feature before the official release (admin-managed allowlist).',
        ],
      },
      {
        title: 'Security',
        items: [
          'Database access for the Supabase anon and authenticated roles has been revoked on all tables (defense-in-depth).',
          'Unused Supabase services (REST, Auth, Edge Functions, Studio, Storage, MinIO, etc.) have been shut down — smaller attack surface.',
          'Messaging: row-level permissions tightened — members only see their own blocks, message requests, and conversation memberships through the REST API.',
          'Admin hygiene: removed unused test accounts, reconciled drift between dev and prod, rotated a member\'s old static token.',
        ],
      },
    ],
  },
  {
    version: '3.11.3',
    date: '2026-04-17',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Volleyball home games: the referee-expenses section no longer fires a permission error for logged-out or pending-approval visitors — the fetch now waits until the account is approved.',
        ],
      },
    ],
  },
  {
    version: '3.11.2',
    date: '2026-04-17',
    sections: [
      {
        title: 'Security',
        items: [
          'Vereinsnews: CTA links are now strictly validated — only https:// and in-app links are allowed.',
          'Vereinsnews: sending to ALL active members now shows a confirmation dialog to prevent accidental mass mails.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'Admin Vereinsnews: the list page loads again without errors.',
          'Events page: rare crash fixed and no more error noise for logged-out visitors.',
          'Admin Daten-Explorer: the scorer-delegations table displays correctly again.',
        ],
      },
    ],
  },
  {
    version: '3.11.1',
    date: '2026-04-17',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Admin Daten-Explorer: teams now also show up for coaches, team responsibles and captains (new "Relationship" column). Sex, roles and participation status render localized.',
          'Admin Daten-Explorer: referee expenses load correctly again (amounts in CHF); removed events/trainings/games are clearly marked as "removed".',
        ],
      },
    ],
  },
  {
    version: '3.11.0',
    date: '2026-04-17',
    sections: [
      {
        title: 'New',
        items: [
          'Vereinsnews: admins can post club-wide announcements that appear in the homepage News card — with title, image, rich text (5 languages), optional link, pin-to-top, expiry, and audience targeting (all members or one sport).',
          'Optionally push and/or email the announcement to the audience — fired exactly once per post.',
          'Homepage News card merges announcements with notifications (pinned first, newest next). "Show all" opens a paginated archive.',
        ],
      },
    ],
  },
  {
    version: '3.10.0',
    date: '2026-04-17',
    sections: [
      {
        title: 'New (Admin)',
        items: [
          'Daten-Explorer: fast read-only browser across members, teams, events, trainings and games with global fuzzy search (⌘K / Ctrl+K).',
          'Click a team, event or member to see linked records (participations, absences, Schreibereinsätze, referee expenses) on demand.',
          'Deep-link and share any view via URL; breadcrumb and browser back/forward work naturally.',
          'Sport admins automatically see only their sport; club-wide events stay visible.',
        ],
      },
    ],
  },
  {
    version: '3.9.4',
    date: '2026-04-17',
    sections: [
      {
        title: 'Fixes',
        items: [
          'All teams now use the same season format. A yearly auto-rollover keeps the season picker in sync — the finished season disappears, a new future one is added.',
        ],
      },
    ],
  },
  {
    version: '3.9.3',
    date: '2026-04-17',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Coaches and team responsibles are now also notified (email, in-app, push) when a member requests to join their team — previously only new signups triggered notifications.',
        ],
      },
    ],
  },
  {
    version: '3.9.2',
    date: '2026-04-17',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Signing up with an existing email now redirects to the login page with a clear "account already exists" notice.',
          'Emails are now treated case-insensitively everywhere — signup, login and password reset work regardless of casing.',
        ],
      },
    ],
  },
  {
    version: '3.9.1',
    date: '2026-04-17',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Removed a brief flash of empty roster/absence/participation views when opening a team page.',
        ],
      },
    ],
  },
  {
    version: '3.9.0',
    date: '2026-04-14',
    sections: [
      {
        title: 'New',
        items: [
          'Coaches and team responsibles can now change other members\' participation directly in the roster (trainings and games) — pencil icon next to the status opens the selector.',
          'Members can override their own "auto-declined due to absence" status.',
        ],
      },
    ],
  },
  {
    version: '3.8.0',
    date: '2026-04-10',
    sections: [
      {
        title: 'Guided Tours',
        items: [
          '10 step-by-step tours for the main features: trainings, games, events, absences, scorer duty and Hallenplan.',
          'Welcome dialog for new members with an optional intro tour.',
          '"?" button on every page opens the matching tour.',
          'Role-based: players, coaches and admins only see tours relevant to them.',
          'Available in German, English, French, Italian and Swiss German.',
        ],
      },
    ],
  },
  {
    version: '3.6.0',
    date: '2026-04-05',
    sections: [
      {
        title: 'Profile',
        items: [
          'Swiss Volley licence card: category, number, LAS, foreigner badge, Federation of Origin, federation and activation status — loaded live from Volleymanager.',
          'Absence cards show type and detail at the top, date on a separate line below.',
        ],
      },
    ],
  },
  {
    version: '3.5.0',
    date: '2026-04-05',
    sections: [
      {
        title: 'Volleymanager Sync',
        items: [
          'Extended sync: nationality, LAS, foreigner status, federation and double-licence info.',
          'All players are now synced (not just active licences).',
          'Email matching: members automatically inherit their Volleymanager email on signup.',
        ],
      },
    ],
  },
  {
    version: '3.4.0',
    date: '2026-04-04',
    sections: [
      {
        title: 'Infrastructure',
        items: [
          'Server migration to new hosting — better performance, more storage, uptime monitoring with email alerts.',
        ],
      },
    ],
  },
  {
    version: '3.2.0',
    date: '2026-04-04',
    sections: [
      {
        title: 'Security',
        items: [
          'Major hardening pass: injection protection across signup and contact form, HTML escaping in emails, rate limiting for password reset.',
          'Coach emails are no longer publicly visible — the contact form still forwards server-side.',
        ],
      },
    ],
  },
  {
    version: '3.0.0',
    date: '2026-03-29',
    sections: [
      {
        title: 'Backend Upgrade',
        items: [
          'Full migration to a new backend stack — all data, files, users and passwords transferred. Faster responses and lower memory use.',
          'Google login now works through the official OAuth flow.',
          'Branded email templates for password reset, invitations, OTP codes and scorer reminders.',
          'Web push notifications on new infrastructure.',
          'Automatic daily game and ranking sync with Swiss Volley and Basketplan.',
        ],
      },
    ],
  },
  {
    version: '2.7.2',
    date: '2026-03-29',
    sections: [
      {
        title: 'New',
        items: [
          'Google login: you can now sign in with your Google account.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'Hallenplan crash when a slot had no team assigned.',
          'Games, sponsors and training data loading reliably again.',
          'Incomplete games (missing opponent, date or time) are no longer shown.',
        ],
      },
    ],
  },
  {
    version: '2.7.1',
    date: '2026-03-29',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Scorer-duty page loads cleanly again; sorting on recently created records across scorer, polls, feedback and scheduling fixed.',
          'Training and game filters now also include records with no status set.',
          'Login session extended from 15 minutes to 1 hour.',
        ],
      },
    ],
  },
  {
    version: '2.6.0',
    date: '2026-03-26',
    sections: [
      {
        title: 'New',
        items: [
          'Team settings redesigned: accordion with Features, Game Defaults and Training Defaults, iOS-style toggles.',
          'Color-coded RSVP confirmations: save toast matches the response color (green = yes, red = no, yellow = maybe).',
          '"Maybe" auto-decline: optionally convert tentative responses to "No" once the RSVP deadline passes (per team).',
          'Team defaults: coaches can set default min players, RSVP deadline, note requirement and auto-cancel per team — applied to new games and trainings.',
        ],
      },
    ],
  },
  {
    version: '2.5.0',
    date: '2026-03-26',
    sections: [
      {
        title: 'New',
        items: [
          'Team photo zoom: coaches can zoom in/out when cropping the team photo — KSCW brand bands appear on the sides when zoomed out.',
        ],
      },
    ],
  },
  {
    version: '2.4.1',
    date: '2026-03-26',
    sections: [
      {
        title: 'New',
        items: [
          'Referee expenses: coaches can record who paid the referees for volleyball home games directly in the game detail (payer, amount, notes).',
          'New admin page "Referee Expenses" with team/season filters and CSV export.',
        ],
      },
    ],
  },
  {
    version: '2.4.0',
    date: '2026-03-25',
    sections: [
      {
        title: 'New',
        items: [
          'Participation warnings: red/yellow triangles on game, training and event cards when participation is insufficient — click for details.',
          'Game roster check: RED warning below 6 field players (VB) or 5 players (BB) confirmed; YELLOW when no coach confirmed. Libero-aware for volleyball.',
          'Training auto-cancel: optional toggle that cancels at the RSVP deadline if not enough confirmations, freeing the hall slot.',
          'Pre-deadline alerts: email + in-app notification 1 day before the deadline if the roster or training minimum is not yet met.',
        ],
      },
    ],
  },
  {
    version: '2.3.1',
    date: '2026-03-24',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Coaches and team responsibles now see trainings, games, events and participation for the teams they manage — even if they are not players themselves.',
          'Team filter added to the Events page for members in multiple teams.',
          'Coaches can now also see pending members who requested to join their team.',
        ],
      },
    ],
  },
  {
    version: '2.3.0',
    date: '2026-03-24',
    sections: [
      {
        title: 'Admin Dashboard',
        items: [
          'New overview page with KPIs (members, teams, pending approvals, sync status) and collapsible sections.',
          'Query Workspace: SQL editor with saved queries, 10 pre-built templates with parameters, visual query builder and chart output (bar, line, pie).',
          'Dashboard visible to all admins; Query and Tables tabs restricted to superadmins.',
        ],
      },
    ],
  },
  {
    version: '2.2.0',
    date: '2026-03-24',
    sections: [
      {
        title: 'New',
        items: [
          'RSVP response timestamps in the Participation Roster: see when each team member responded ("2 hrs ago", "yesterday").',
          'Per-team toggle "Show response time" in team settings.',
        ],
      },
    ],
  },
  {
    version: '2.1.0',
    date: '2026-03-24',
    sections: [
      {
        title: 'OTP Authentication',
        items: [
          'All auth flows now use 8-digit email codes instead of token links.',
          'Signup: email is verified via OTP before registration.',
          'Activation of existing members (ClubDesk import) via OTP instead of the confusing "password reset" flow.',
          'Shell invite (QR join): set password inline after claiming the invite.',
          'Forgot password: inline OTP flow on the login page.',
        ],
      },
    ],
  },
  {
    version: '2.0.1',
    date: '2026-03-24',
    sections: [
      {
        title: 'Fixes',
        items: [
          'Feedback submissions are visible again under "My Submissions".',
          'Participation counts no longer flicker briefly when opening game/training details.',
        ],
      },
      {
        title: 'New',
        items: [
          'Attach up to 5 screenshots per feedback submission (was 1).',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-03-19',
    sections: [
      {
        title: 'Launch',
        items: [
          'Wiedisync goes live: real-time web app for KSC Wiedikon on Cloudflare hosting, available in German, English, French, Italian and Swiss German.',
        ],
      },
      {
        title: 'Authentication',
        items: [
          'Email login, signup and password reset; Google OAuth with onboarding; role approval; privacy settings and account deletion.',
        ],
      },
      {
        title: 'Games & Scoreboard',
        items: [
          'Game cards with set scores and KSCW-perspective coloring, scoreboard with Total / Per-Game toggle, embed page for external widgets.',
        ],
      },
      {
        title: 'Calendar & Hallenplan',
        items: [
          'Monthly calendar with home/away colored boxes, clickable absence bars, hall slot management with virtual slots and claiming.',
        ],
      },
      {
        title: 'Trainings & Participation',
        items: [
          'RSVP on all activities with realtime sync, participation notes, guest counter and recurring training selection.',
        ],
      },
      {
        title: 'Teams & Roster',
        items: [
          'Team overview with photo cards, position management, per-team guest levels (G1/G2/G3), external user invite via QR code, shell-account upgrade.',
        ],
      },
      {
        title: 'Admin',
        items: [
          'Admin/member mode separation, database browser, ClubDesk sync, game scheduling.',
        ],
      },
      {
        title: 'Other Features',
        items: [
          'Schreiberdienst (scorer duty) management and delegation, in-app notifications, events (including Trainingsweekend), location autocomplete, feedback & bug reporting.',
        ],
      },
    ],
  },
]

export { APP_VERSION }

export default function ChangelogPage() {
  const { t } = useTranslation('nav')

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <ScrollText className="h-6 w-6 text-brand-600 dark:text-gold-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('changelog')}</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Wiedisync v{APP_VERSION}</p>
      </div>

      <div className="space-y-8">
        {CHANGELOG.map((entry) => (
          <div key={entry.version}>
            <div className="mb-4 flex items-center gap-3">
              <Badge variant="default" className="font-mono">v{entry.version}</Badge>
              <span className="text-sm text-gray-500 dark:text-gray-400">{entry.date}</span>
            </div>

            <div className="space-y-4">
              {entry.sections.map((section) => (
                <div key={section.title}>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {section.title}
                  </h3>
                  <ul className="space-y-1">
                    {section.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500 dark:bg-gold-400" />
                        <span className="text-justify hyphens-auto">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
