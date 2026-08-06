# Changelog

All notable changes to Wiedisync, the KSC Wiedikon members' platform. This file is the curated, user-facing release record (English, semver), mirrored in the in-app "What's New" (`src/modules/changelog/ChangelogPage.tsx`). For commit-level detail see `git log`; for the operator/deploy history see `docs/DEVLOG.md`.

## v1.70.0 — 2026-08-06

### Club mailbox: paste a list of addresses
- **Recipients are now chips.** Paste a whole column of addresses into To, Cc or Bcc and each one becomes its own removable chip — one per line, per comma or per semicolon, so a list copied out of a spreadsheet or another mail client no longer has to be tidied up by hand first.
- **Addresses that carry a name are read correctly.** `Anna Muster <anna@example.ch>` was previously discarded without a word: the send only ever accepted a bare address, so a recipient pasted in that form silently never received the mail. The name is now stripped off and the address kept.
- **An address that cannot be read is shown in red and blocks the send** instead of being dropped on the way out. Duplicates are merged, so the same person pasted twice gets one copy.
- Enter, Tab, comma and semicolon finish the address you are typing; Backspace on an empty field takes the last chip back for editing.
- **The group send takes a pasted list too.** "Email a group" could only reach an audience the app already knows — a team, a role, a season. A hand-curated list out of a spreadsheet is none of those, and the only way to mail one was to expand a large audience and delete everyone else. You can now paste the addresses straight in: each is matched to the person behind it, and the send treats them exactly like any other audience — one message each rather than one message with everyone's address in the header, with names filled in and anyone who has unsubscribed left out. It tells you before you send how many were recognised and names the ones that were not.

### Email wording is now yours to change
- **The text of the emails the club sends to people who register can be edited in the app**, under Email templates. Until now every word lived in the code and changing one meant a deployment, so the wording was effectively frozen and out of reach of the people who actually write to parents.
- **Each language is edited separately**, and a preview shows the message exactly as the recipient will see it — including changes you have not saved yet.
- **Emptying a box puts the original wording back** rather than sending an email with a gap in it, and the message cannot be saved without the part that lists the missing documents. A mistake in an email that goes to families should not be possible to save, let alone send.
- **A new Sent tab keeps every email the club has sent from a template**, exactly as it was received. Because the wording can now change, reading today's template would no longer tell you what someone was actually told in August.
- **Replies now reach the club.** The emails are sent from a no-reply address while the text invited people to reply, so an answer went nowhere; replies are now directed to kontakt@kscw.ch.

## v1.69.0 — 2026-08-06

### Registrations: asking for documents we lost
- **An approved registration can now be asked for its missing documents.** Two upload faults in July destroyed or never stored the Swiss Basketball paperwork for seven registrations, and the families had no way of knowing — the registration looked approved and finished from their side.
- **The request does not reopen the registration.** The person stays a member, keeps their team and their ClubDesk entry; only the documents are asked for. Reopening would have re-run the whole approval — a second welcome email, a second ClubDesk contact — for something that was never their mistake.
- **The email lists only what is actually missing**, in the language the person registered in, and the link it carries already knows who they are. A Swiss junior is asked for three documents, a foreign one for five, and someone who only lacks the two declarations is asked for two.
- **Documents already on file cannot be overwritten** by the upload page, so a re-send can never quietly replace something that was already checked.

## v1.68.0 — 2026-08-05

### Basketball scheduling
- **Spielplaner can now open the basketball scheduling pages.** The volleyball routes have always let a Spielplaner in; the basketball ones only ever accepted a basketball admin, so anyone given the Spielplaner role found the link simply did not work — and it then sent them to the volleyball planner instead of saying why. It now says why.
- **A team's available dates now cover its own season.** Every team was being offered the junior schedule, which ends on 13.12.2026 — so the two teams that play into May were declaring barely a third of the weekends the association asks about. The autumn and spring closures, Sport and Easter holidays included, are in as well.
- **Dates where the halls are taken no longer show up blank.** A Saturday with volleyball in all three halls rendered as an empty box with no explanation; it now names the reason — volleyball, a hall closure, a holiday or a club blackout.
- **A volleyball match in the afternoon no longer blocks the whole day.** Occupancy is worked out by the hour, so an evening basketball game in the same hall is offered normally, with the changeover time between the two respected.
- **The calendar is on the planning page itself**, since away games can be placed almost anywhere and the two are read together.
- **Each team can carry its own rules** — preferred start time, which days, which hall, who it must not clash with and who it should play alongside — and the planner proposes dates from them, showing why each one ranks where it does.
- **Opponent clubs can be sent their own link**, one per club, where they see our available dates and reply. The same idea as the volleyball opponent links, adapted to how basketball is scheduled.

## v1.67.0 — 2026-08-05

### Hall finder: export to Excel
- **A search result can now be taken away as a spreadsheet.** The table shows four of nineteen fields on a phone — the address, postcode, district, quarter, school district and caretaker contact are all hidden, and those are exactly what you need to actually chase a hall. The export carries every field, one row per hall.
- **Hall dimensions come through as numbers**, not just as the city's "45,00 x 27,00 x 7,00 m" text, so you can sort or filter by length and find the halls that fit a full court.
- **The search itself travels with the file** — the weekdays, time, minimum duration and district you searched for, the season, and the date the availability data is from. A list of "free halls" with no filter and no date is one nobody can act on a fortnight later.

### International transfers: checking the FIVB index when you need it
- **"Check VIS now" asks FIVB there and then.** The check used to run once a month, so for thirty days out of thirty-one the page showed a fixed answer and the Refresh button could only reload it — which read as though Refresh were broken. It now also runs automatically every week rather than monthly.
- **The page says how old the VIS numbers are**, and the two buttons now explain which one re-reads our own data and which one goes and asks FIVB.
- **A player already in the index is no longer reported as missing because of her name.** Where a middle name or a compound surname sat on the other side of the first-name/surname split, the match failed and the player looked absent from a register she was in all along.

## v1.66.0 — 2026-08-05

### Coaching qualifications and officials' licences
- **Basketball coaches can now record their qualification.** The profile only offered the volleyball ladder (Trainer C / B / A), so a Trainer 1 or Trainer 2 had nothing to select and the club's register kept the answer to itself. The list now shows the rungs for your own sport, with J+S available to everyone.
- **Three referees were missing their licence in Wiedisync.** Their names are spelled slightly differently in Basketplan, so the nightly import had never matched them and they were absent from the officials list despite holding a current licence. Their licence numbers are now on file, which is what stops it happening again.

## v1.65.0 — 2026-08-05

### Fixed: setting a new password
- **Choosing a new password works again.** The form accepted any password of 8 characters or more, but the server also requires a number or a symbol — so a password made only of letters was rejected *after* you pressed save, and the app blamed the reset link instead of the password. At least one member spent a quarter of an hour requesting fresh links to fix a link that was never broken.
- **The rules are now written under the password field**, and if a password is turned down the app says which rule it missed, in your language.
- **The "Set password" link in the reset email now opens the password form.** Until now it landed you back at the code-by-email screen, so the mail was effectively a dead end.
- **A clearer answer when the address is not on file.** If we cannot find an account for the address you typed, the app now suggests trying the address the club has on file for you. Members whose personal address differs from their club one were told no account existed and pointed at signing up, which would have created a duplicate.

## v1.64.0 — 2026-08-04

### Club emails: picking who gets them
- **Picking two teams now means both of them.** Choosing D1 and D2 used to ask for the people who are on *both* rosters — almost nobody — so a mail meant for 39 players would have reached a handful. Anything picked from the same row is now added together, while picking across rows still narrows: **Volleyball** plus **Coaches** is still the volleyball coaches.
- **Every option shows what it would make the audience, live.** Choose Volleyball and the Coaches count drops from 30 to 15 in front of you, so you can see what a filter costs before committing to it.
- **Write to members by type** — active, passive, honorary, gap year — **or to guest players**, alongside the existing "all members".
- **Scorers, referees and officials now mean the people who actually do the job for the club**, taken from the ClubDesk groups, rather than everyone who happens to hold the licence. The basketball officials list alone was 31 people too broad.
- **The composer opens on the current season**, and the season sits next to the options it applies to.

## v1.63.3 — 2026-08-04

### Fixed: seeing who has answered a game
- **Coaches, team responsibles and admins can reach a game's attendance list again.** For them the roster button opened the match sheet and nothing else, so the people most likely to ask who has replied had no way to see it from the game. There are now two buttons — **Match sheet** and **View roster** — and the first one finally says what it does. Everyone else still has the single button, unchanged.

## v1.63.2 — 2026-08-04

### Fixed: saying whether you are coming to a game
- **Players called up from another team can now answer.** Opening a game to another team put the fixture on all their calendars but gave them no Yes / Maybe / No buttons, so nobody could actually say whether they were coming. Their replies now count towards the game's tally like everyone else's.
- **The Yes / Maybe / No buttons are back on the games list.** Since 10.06 they only appeared once you opened a game, so answering straight from the list was impossible. The same fault also meant a coach's reply was counted as a player's instead of being filed under staff, and that players who may not play league games were not held back.
- **Attendance counts appear together with the rest of a game**, instead of a moment later, and no longer nudge everything below them as they arrive.

## v1.63.1 — 2026-08-04

### Fixed: uploading your ID from a phone
- **Uploading an identity document works again.** Tapping "Upload document" opened the camera or photo library but then bounced you back to your profile, and the photo you took was silently discarded — nothing was saved and no error was shown. Every attempt since 28.07 failed this way.
- **You can now crop and rotate the photo before it is saved.** A phone shot of an ID is usually sideways, or a small card on a big table; you can straighten it, zoom in and trim away the background, with presets for an ID card, landscape or portrait. As before, the picture is encrypted on your own device — the club still cannot read it, and now only the part you kept is stored at all.

## v1.63.0 — 2026-08-03

### Improved: choosing who a club email goes to
- **Audiences are clickable chips** showing how many people each one reaches, instead of a dropdown you had to open to see what existed.
- **You can combine them** — pick "All coaches" and two teams and it goes out once to everyone, with nobody receiving it twice.
- **Sections and teams are separate choices.** "Volleyball section" reaches everyone in the section including coaches and staff; "Volleyball players" reaches only those on a team right now.
- **Former members can be reached** too, for the rare club-wide announcement that warrants it.
- **Bounced addresses and spam complaints are remembered and skipped automatically**, which protects delivery of everything else the club sends — including password reset emails.

## v1.62.0 — 2026-08-03

### New: the club can email a whole group at once
- **The club mailbox can now write to a whole group** — a team, all coaches, all scorers, all referees, the board, or every member — instead of pasting addresses together by hand.
- **You see who it reaches before you send.** The recipient count is resolved up front, along with why anyone is left out (no address on file, unsubscribed, or sharing an address with someone already on the list).
- **Everyone gets their own copy**, so nobody sees anyone else's address, and replies come back to the club mailbox where the whole board can follow them. Attachments are supported, and `{{vorname}}` greets each person by name.
- **Group emails now reach members who have never signed in.** Previously a message to "all scorers" quietly went to only about two thirds of them, and to "all basketball referees" to barely a quarter.

## v1.61.0 — 2026-08-03

### Improved: the live scoreboard page
- **The hall scoreboard now actually feeds the page.** The board publishes every score change itself, so Live shows a real match without anyone doing anything — for volleyball, beach volleyball and basketball alike.
- **A final screen when the match ends**, naming the winner and the result, above the full board.
- **Recent matches on the scoreboard** are listed underneath, so the page is still worth opening once a match has finished.
- **A "live now" link on the games page** while a match is being scored, so you don't have to go looking for it.
- Small touch: the score gives a brief bump when a point lands (skipped if you've asked your device to reduce motion).

## v1.60.0 — 2026-08-03

### New: follow a match live from the scoreboard
- **The hall's scoreboard now feeds a live page in the app.** Open **Live** and you see the same score the LED board in the hall is showing, updating on its own every few seconds — no refreshing, and no need to be logged in, so you can share the link with family and friends.
- **It works for volleyball, beach volleyball and basketball.** Volleyball shows the points in the current set, sets won, timeouts, substitutions, who is serving and the scores of the sets already played; beach shows both players of a pair; basketball shows the running score, the quarter, team fouls with the bonus and the possession arrow.
- **The page tells you what it is doing** — whether it is live, finished, or waiting for a match to start.

## v1.59.0 — 2026-08-01

### New: call up players from another team for a single game
- **A coach can now open one game to another team, or to individual players.** A cup game filed under H1 can be opened to H3; a junior can be pulled up for one Saturday. The called-up players see the fixture on their home page, in their calendar and in their subscribed calendar file, and they answer yes/no/maybe there like any other game.
- **They appear in the participation list with everyone else**, marked with the team they were called up from, so the coach picks a squad from one list instead of two. Their jersey number for that game is set on the match sheet as usual, and they are carried onto the Volleymanager nomination list.
- **Nothing about their team membership changes.** The call-up is scoped to that one fixture: their trainings, absences, attendance figures and ClubDesk group are untouched, and it disappears when the game does.
- **They get a notification** when they are called up, and their reminders — the answer deadline and the "game tomorrow" nudge — work exactly as for the home team. If they mark themselves absent that day, their answer is withdrawn automatically.
- **The coach is warned about clashes**, not blocked: anyone already playing a game that day is flagged in the picker and in the summary, and the two coaches decide.
- Only the coach or team responsible **of the game's own team** can call players up, and closing a team call-up releases the players it brought while keeping anyone invited by name.

## v1.58.0 — 2026-08-01

### Fixed: cancelled trainings and games looked like they were still on
- **A cancelled training now shows as cancelled on the calendar** — struck through and dimmed, instead of looking exactly like one that is still happening. This was most confusing on a game day: the club automatically cancels a team's training when that team plays that evening, so the training was correctly called off in the system but the calendar still advertised it right next to the fixture. Opening it explains why ("Cancelled — game day"). The same applies to cancelled games and events, in every calendar view and in the "Next 7 days" strip on the home page.
- **Exported calendar files (.ics) mark cancelled entries too**, so they are also clear in Apple Calendar, Google Calendar and Outlook. The subscription link already did this.
- **The home page no longer jumps while it loads.** The "Next 7 days" strip appeared a moment after everything else and pushed the rest of the page down as it arrived; it now holds its place from the start.

## v1.57.0 — 2026-08-01

### New: hall sizes and photos in the hall finder
- **Every hall in the hall finder now shows its size** — length, width and ceiling height, exactly as the city publishes it. All 104 halls have one, so it is finally possible to tell a full-size sport hall from a small gymnastics room without opening the city website for each.
- **A photo of the hall** where the city has one on file (about half of them). Tap it to see it full size.

## v1.56.2 — 2026-07-30

### Improved: participation exports (PDF, image and CSV)
- **Staff and waitlisted players no longer vanish from a filtered export.** Exporting with a status filter on (e.g. "Confirmed") dropped every coach, team responsible and waitlisted player from the sheet, even though they were still listed on screen. The export now matches what the participation list shows; the filter narrows the roster only.
- **The export header names the activity again.** Opening the participation list from the events or trainings list produced a sheet headed "Participation" with nothing identifying it; it now carries the event or team name and date, in the header and in the file name.
- **One guest column instead of two.** "Guest" (is this a guest player) sat next to "Guests" (plus-ones) and read as a duplicate. A guest player is now marked in the name — like the coach, captain and team-responsible markers — and the remaining column is only about plus-ones.
- **A Team column when the list covers several teams**, with the rows grouped by team. Single-team lists are unchanged.

## v1.56.0 — 2026-07-30

### Fixed: coaches' answers on a multi-day event went missing
- **A coach or team responsible who is not on the team's player list could answer a multi-day event** (the Trainingsweekend), **and their answer was filed as a player's.** The participation list showed them as "Not responded" while the count on the card treated them as one more player coming. Their answers now appear where they belong, and the "Coach present" figure counts people rather than days — a coach who said yes to both weekend days counted twice.
- **On an event that invites several teams, only the first team was considered** when deciding whether you answer as staff or as a player. A coach of the second team was filed as a player.

### New: answer for the staff too
- **Coaches and team responsibles now have the same edit controls as everyone else in the participation list** — including the "all days at once" answer on a multi-day event's Overall tab, per-day answers, and notes.

### Fixed: rows cut in half in the PDF export
- **Exporting a participation list longer than one page split the last row of every page across the page break** — the name on one page, the answer on the next. Pages now end between rows.

## v1.55.0 — 2026-07-29

### New: answer for every day at once on a multi-day event
- **The "Overall" tab of a multi-day event's participation list is now editable.** Setting a member to Yes / Maybe / No there applies it to **every day at once**, instead of opening each day's tab and repeating the same answer. Days that already disagree are brought in line; a member whose days genuinely differ starts from a blank dropdown rather than a guess, and their per-day notes are left alone unless you actually type one.

## v1.54.2 — 2026-07-29

### Fixed: day-by-day answers on a multi-day event didn't stick
- **Setting a member's answer for a single day of a multi-day event** (the Trainingsweekend and anything else with per-day responses) **saved to nowhere** — the roster kept showing "Not responded", and a second attempt failed with an error mentioning that a value "has to be unique". Answers now save to the day you picked.

## v1.54.1 — 2026-07-29

### Fixed: saving an edit failed with a "has to be unique" error
- **Editing an existing event, form, hall slot or team's staff could fail to save**, with an error mentioning that a value "has to be unique" — even when you had only changed something ordinary like a response deadline and hadn't touched the teams at all. Everything saves again.

## v1.54.0 — 2026-07-28

### New: identity documents are watermarked when shown
- **Every identity document displayed before a game now carries a visible stamp burned into the image itself** — club, purpose ("Spielkontrolle / match check"), who opened it and when. A screenshot or photo of the screen keeps the stamp, so the document cannot pass as a clean copy anywhere else, and any leaked image is traceable to the (already audit-logged) viewing.

### Improved: showing IDs before a game
- **One tap instead of two**: "Show IDs" now downloads the documents by itself if you haven't pre-downloaded them. The separate "Download for offline" button remains for preparing before you travel — halls often have no signal.
- **The dialog comes alive on time**: if you open it before the 45-minute window, the Show button now unlocks itself the moment the window opens (and closes itself at kickoff) — no more closing and reopening.

### Changed: your identity document is managed in Edit profile
- The encrypted identity-document section moved from the profile view to **Edit profile**, next to the other things you can change — and it now loads in one piece instead of flickering through loading states.

## v1.53.0 — 2026-07-28

### New: complete your profile to use the app
- **The app now asks for your core contact details before you can continue**: phone number, birthdate, address and nationality. The club is required to keep these in the member register, and until now coaches and staff were never asked for them at all. If your profile already has them (most members), you won't notice anything.
- **Coaches and staff without a playing role are now recorded in the "Gratis" fee category automatically**, so they appear correctly in the club register instead of with no category at all.

## v1.52.0 — 2026-07-28

### Improved: game days no longer show a training your team can't attend
- **Trainings on game days are cancelled automatically.** When your team has a game — home or away — that day's training is taken off the calendar instead of sitting there contradicting the game. If the game moves or is called off, the training comes back by itself. A coach can still reinstate a training ("we practice before the game"), and that decision sticks.
- **Players in two teams are excused automatically.** If your other team has a game that day, you are signed out of the training with a note naming the game (e.g. "Game H2"). Your own answers always win: if you explicitly said you'll attend the training, or you declined the game, nothing is changed — and any manual change you make afterwards is never overridden.

## v1.51.0 — 2026-07-27

### Improved: the app now speaks French and Italian throughout
- **Nearly a thousand interface texts per language were still English for French and Italian users** — the whole finance area, most of the member admin, the forms feature, the hall finder, the game-scheduling tools and many smaller corners. All of them are now properly translated, using the same club vocabulary as the existing translations (marqueur/segnapunti, cotisation/quota, créneau/fascia …).
- **Swiss terms where they belong**: J+S becomes Jeunesse+Sport with its official Moniteurs/Monitori, city districts render as arrondissements/distretti, and accounting screens use proper Swiss bookkeeping vocabulary in both languages.

## v1.50.0 — 2026-07-27

### Removed: three unused features
- **Per-activity task checklists, game carpools and the admin saved-queries strip have been removed.** None of them saw a single use across a full season, and each carried real maintenance weight. The fines page, hall-slot claims and referee expenses stay — they are expected to earn their keep when the 2026/27 season starts.

## v1.49.0 — 2026-07-27

### Fixed: club-wide events were missing from the website and calendar feeds
- **Club-wide events — those open to everyone rather than tied to a team — had disappeared** from kscw.ch and from subscribed calendars. They are back, and the underlying data problem can no longer recur.
- **Cancelled events now disappear properly**: the website no longer lists them, and subscribed calendars receive a cancellation so they vanish there too.

### Fixed: a cancelled game stayed cancelled
- A game cancelled in the app was **silently put back on the calendar by the nightly league sync**. A cancellation now sticks unless the league reports the game as played — and if a game genuinely is back on, everyone on the team gets a **"Game back on"** notification instead of it quietly reappearing.

### Fixed: attendance counts and absence sign-out
- Duplicate RSVPs could double-count members in attendance tallies, and RSVPs left over from deleted trainings inflated per-member statistics. Both are cleaned up and can no longer recur.
- **An absence now also signs you out of club-wide events and events you were personally invited to** — previously you could even be auto-signed-*in* while absent. Multi-day events are declined per day, matching how you sign up for them.

### Improved: member admin and data integrity
- The member admin form is now organized into **collapsible sections** (identity, address, licences, preferences, billing, …) instead of one flat 100-field list.
- The admin **"Last online"** column now actually shows when a member last logged in.
- A broad round of database hardening: proper cross-references throughout games, trainings, rosters and finance data, duplicate records merged, and faster admin audit pages.

## v1.48.0 — 2026-07-25

### New: Hall finder — free city sport halls for the season
- **A new admin tool (Options → Hall finder)** shows which City of Zürich sport halls have a free recurring training slot for the whole winter season, so you no longer have to check the city booking site hall by hall.
- **Filter by weekday, earliest start, minimum duration, city district and hall type.** By default it lists only halls that are free every week excluding school holidays; switch that off to also see halls that are free most weeks.
- **Each result links straight to the city occupancy calendar and to a pre-filled reservation request.** Availability is refreshed automatically every night.

## v1.47.0 — 2026-07-25

### New: nationality is now a proper list, with flags
- **Pick every nationality you hold, not just one.** The profile nationality field is a searchable list with flags — start typing a country or its two-letter code. Dual nationals can select both; the first one you pick is treated as your main one and is what the club register receives.
- **It reads in your language.** Previously the field held a German country name whatever language you used the app in.

### New: federation of origin
- **A new profile field asks which national federation licensed you at age 14** — the definition Swiss Volley and the FIVB use, and the one that decides whether an international transfer is needed to play here. It is not necessarily where you first played.
- **"None" is a real answer.** If no national federation licensed you at 14 — for example if you only ever played recreational leagues such as Italy's CSI, UISP or PGS, which are not FIVB or FIBA members — choose it. That tells the club there is nothing to request, which a blank field cannot.
- The membership sign-up form asks the same two questions, so new members arrive with the answer already recorded.

### New: Transfers page (club staff)
- **A per-sport view of international transfers**, grouped by federation of origin, with a note field and a done marker. It also lists members whose nationality suggests the question has never been put to them.
- **For volleyball it cross-checks Swiss Volley's licence data and flags two situations**: someone marked done whose licence is not validated — meaning they are not yet eligible to play — and someone still marked pending whose licence has been validated, which usually means the certificate has already arrived.
- **One prepared email per federation.** A transfer cannot be requested until the player exists in the FIVB VIS index, so each federation group carries a single ready-to-send request listing everyone of theirs still missing from it, with name, date of birth and email. Copy it, or open it straight in your mail programme. It is always written in English — the working language of the FIVB — whatever language you read the app in.
- **The federation's own contact address is on file** for every country our members come from, taken from VIS, and shown once per group.
- **Only members who are actually on a team appear.** Anyone on no team is counted in the page header instead of filling the lists; add them to a team and they return.

### Improved: officials licences distinguish OTN 1 and OTN 2
- **The basketball table-official licence now records the level**, matching Swiss Basketball's own register, which has always kept the two apart.

## v1.46.1 — 2026-07-25

### Fix: open-ended absences now sign you out reliably
- **An absence with no end date now signs you out of every training and game across its whole span** — including sessions added to the calendar later — just like a dated absence does. Some open-ended absences (typically the long-term ones entered on a member's behalf) were being missed, so the person still showed as attending. This is independent of the "blocks game scheduling" switch, which only affects planning and never changes your own attendance.

## v1.46.0 — 2026-07-16

### New: send club news to specific teams or roles
- **Club news can now be addressed to particular teams, or to people by what they do.** Alongside "all members" and "one sport", you can pick specific teams — which reaches their players, coaches, team responsibles and captain — or target roles and functions: the board, coaches, captains, scorers, referees, finance, and so on. The email, the push and the in-app post all go to exactly that group, and nobody else sees the post.
- **Every news email now asks you to confirm before it sends**, and tells you who it is about to reach. Previously only the "all members" blast asked.

## v1.45.0 — 2026-07-15

### New: guided tours for more of the app
- **The in-app guide now covers more areas.** News, Fines, and the Calendar each have a short, tap-through walkthrough that points out the buttons and lists right on the page. Open Guide from the menu and pick a tour — a green tick marks the ones you have finished.

## v1.44.0 — 2026-07-15

### New: go by the name you actually use
- **You can set a preferred display name in your profile.** If people call you something other than your legal first name — Honza instead of Jan, Thamy instead of Thamalayant — set it once and the whole app shows it: rosters, RSVP lists, chat, absences, scheduling. Leave it empty to keep your first name.
- **Official documents are unaffected.** Match sheets, Volleymanager, ClubDesk, invoices and the public website always use your legal name — only the in-app display changes.

### New: basketball scheduling prep (for coordinators)
- **The scheduling app now has a Volleyball / Basketball toggle.** Basketball follows a completely different process from volleyball — the association (ProBasket) builds the schedule at a central planning meeting — so its section is a preparation view: for each team it shows which home dates (Fri/Sat/Sun) the KWI hall is free, with volleyball's hall use, closures and blocked dates overlaid, and lets you record availability to bring to the meeting or the 17 August hall-availability form.

## v1.43.0 — 2026-07-14

### New: the match sheet, on your phone
- **Coaches and team responsibles can now open the match sheet from a game**, in the hours around kickoff, and hand the phone to the scorer. It is laid out the way the sheet is actually filled in: birthdate, number, then surname and first initial. The captain's number is circled, liberos appear again in their own block, and the officials are listed at the bottom.
- **You can adjust it for that one game.** Change a number, move the captain's circle, flag a libero, or — in an emergency — add a player who turned up unnominated or strike out one who did not. None of this touches the player's normal shirt number, position, or the team's captain: it applies to that match only.
- **Adding or removing a player is the only change that can disagree with Volleymanager**, and it is the only one that raises a warning. Numbers, captain and libero do not exist on the Einsatzliste at all, so changing them cannot contradict it. If you do add or drop someone, Wiedisync tells you, in red, that the same change must also be made by hand in Volleymanager — it does not send it for you.

### New: your ID, encrypted so that nobody here can read it
- **You can upload a photo of your ID in your profile, and your coaches can show it to a referee before a game.** It is encrypted on your own device before it leaves it. The club cannot read it — not the committee, not the admins, not the server. Only you and the coaches and team responsibles of your teams hold a key to it.
- **Coaches see them from 45 minutes before kickoff.** They can download them beforehand, because halls usually have no signal, and the documents are removed from the phone again once the game starts. Every time someone opens an ID, it is recorded.
- **This is real encryption, and it has a real consequence.** There is no master key and no way for anyone at the club to recover your document. If you reset a forgotten password, your key is lost with it and you simply upload your ID again. Changing your password from inside the app is safe — it keeps your key.
- Only members who have logged in can have a document, because the key is made from your password. There is no way around that without the club being able to read your ID, which is the one thing this is for.

### Fixed: away games were showing the wrong list
- **The Einsatzliste for away games was never being read.** Wiedisync only ever looked at the home team's list, so for away games it quietly fell back to the RSVPs — which meant a nominated player who had not RSVP'd was simply missing from the sheet, in the away hall, which is exactly where a referee is most likely to ask for it. Away games now show the real Einsatzliste, the same as home games.
- Officials are now listed with their role (coach, assistant coach 1, assistant coach 2) instead of as one anonymous list. Volleymanager knew this all along; Wiedisync was throwing it away.

## v1.42.0 — 2026-07-13

### New: the Einsatzliste can file itself
- **Volleymanager's Einsatzliste can now be filled in automatically from the RSVPs.** About an hour before a game, Wiedisync takes everyone who confirmed, matches them to their Swiss Volley licence, enters them into the Einsatzliste in Volleymanager, and closes it. This works for away games too, not just home games.
- **It is off by default, and you turn it on per team** (Team settings → Game defaults), or per game if you want to override the team's setting for one match.
- **It will not close a list that Volleymanager is unhappy with.** If Volleymanager warns that the list is too short or has no coach — the kind of thing the club can be fined for — Wiedisync enters the players but leaves the list open and tells you to check it. It never files a list you could be fined for without a human looking at it.
- Only players who hold a licence can be nominated, so anyone who confirmed but has no licence number on file is reported rather than quietly dropped.

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
