import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Coffee, ScrollText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { useDonateVisible } from '../support/donateConfig'

const APP_VERSION = '1.70.0'

interface ChangelogEntry {
  version: string
  date: string
  sections: { title: string; items: string[] }[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.70.0',
    date: '06.08.2026',
    sections: [
      {
        title: 'Club mailbox: paste a list of addresses',
        items: [
          'Recipients are now chips. Paste a whole column of addresses into To, Cc or Bcc and each one becomes its own removable chip — one per line, per comma or per semicolon, so a list copied out of a spreadsheet or another mail client no longer has to be tidied up by hand first.',
          'Addresses that carry a name are read correctly. “Anna Muster <anna@example.ch>” was previously discarded without a word: the send only ever accepted a bare address, so a recipient pasted in that form silently never received the mail. The name is now stripped off and the address kept.',
          'An address that cannot be read is shown in red and blocks the send instead of being dropped on the way out. Duplicates are merged, so the same person pasted twice gets one copy.',
          'Enter, Tab, comma and semicolon finish the address you are typing; Backspace on an empty field takes the last chip back for editing.',
          'The group send takes a pasted list too. “Email a group” could only reach an audience the app already knows — a team, a role, a season. A hand-curated list out of a spreadsheet is none of those, and the only way to mail one was to expand a large audience and delete everyone else. You can now paste the addresses straight in: each is matched to the person behind it, and the send treats them exactly like any other audience — one message each rather than one message with everyone’s address in the header, with names filled in and anyone who has unsubscribed left out. It tells you before you send how many were recognised and names the ones that were not.',
        ],
      },
      {
        title: 'Email wording is now yours to change',
        items: [
          'The text of the emails the club sends to people who register can be edited in the app, under Email templates. Until now every word lived in the code and changing one meant a deployment, so the wording was effectively frozen and out of reach of the people who actually write to parents.',
          'Each language is edited separately, and a preview shows the message exactly as the recipient will see it — including changes you have not saved yet.',
          'Emptying a box puts the original wording back rather than sending an email with a gap in it, and the message cannot be saved without the part that lists the missing documents. A mistake in an email that goes to families should not be possible to save, let alone send.',
          'A new Sent tab keeps every email the club has sent from a template, exactly as it was received. Because the wording can now change, reading today’s template would no longer tell you what someone was actually told in August.',
          'Replies now reach the club. The emails are sent from a no-reply address while the text invited people to reply, so an answer went nowhere; replies are now directed to kontakt@kscw.ch.',
        ],
      },
    ],
  },
  {
    version: '1.69.0',
    date: '06.08.2026',
    sections: [
      {
        title: 'Registrations: asking for documents we lost',
        items: [
          'An approved registration can now be asked for its missing documents. Two upload faults in July destroyed or never stored the Swiss Basketball paperwork for seven registrations, and the families had no way of knowing — the registration looked approved and finished from their side.',
          'The request does not reopen the registration. The person stays a member, keeps their team and their ClubDesk entry; only the documents are asked for. Reopening would have re-run the whole approval — a second welcome email, a second ClubDesk contact — for something that was never their mistake.',
          'The email lists only what is actually missing, in the language the person registered in, and the link it carries already knows who they are. A Swiss junior is asked for three documents, a foreign one for five, and someone who only lacks the two declarations is asked for two.',
          'Documents already on file cannot be overwritten by the upload page, so a re-send can never quietly replace something that was already checked.',
        ],
      },
    ],
  },
  {
    version: '1.68.0',
    date: '05.08.2026',
    sections: [
      {
        title: 'Basketball scheduling',
        items: [
          'Spielplaner can now open the basketball scheduling pages. The volleyball routes have always let a Spielplaner in; the basketball ones only ever accepted a basketball admin, so anyone given the Spielplaner role found the link simply did not work — and it then sent them to the volleyball planner instead of saying why. It now says why.',
          'A team’s available dates now cover its own season. Every team was being offered the junior schedule, which ends on 13.12.2026 — so the two teams that play into May were declaring barely a third of the weekends the association asks about. The autumn and spring closures, Sport and Easter holidays included, are in as well.',
          'Dates where the halls are taken no longer show up blank. A Saturday with volleyball in all three halls rendered as an empty box with no explanation; it now names the reason — volleyball, a hall closure, a holiday or a club blackout.',
          'A volleyball match in the afternoon no longer blocks the whole day. Occupancy is worked out by the hour, so an evening basketball game in the same hall is offered normally, with the changeover time between the two respected.',
          'The calendar is on the planning page itself, since away games can be placed almost anywhere and the two are read together.',
          'Each team can carry its own rules — preferred start time, which days, which hall, who it must not clash with and who it should play alongside — and the planner proposes dates from them, showing why each one ranks where it does.',
          'Opponent clubs can be sent their own link, one per club, where they see our available dates and reply. The same idea as the volleyball opponent links, adapted to how basketball is scheduled.',
        ],
      },
    ],
  },
  {
    version: '1.67.0',
    date: '05.08.2026',
    sections: [
      {
        title: 'Hall finder: export to Excel',
        items: [
          'A search result can now be taken away as a spreadsheet. The table shows four of nineteen fields on a phone — the address, postcode, district, quarter, school district and caretaker contact are all hidden, and those are exactly what you need to actually chase a hall. The export carries every field, one row per hall.',
          'Hall dimensions come through as numbers, not just as the city’s “45,00 x 27,00 x 7,00 m” text, so you can sort or filter by length and find the halls that fit a full court.',
          'The search itself travels with the file — the weekdays, time, minimum duration and district you searched for, the season, and the date the availability data is from. A list of “free halls” with no filter and no date is one nobody can act on a fortnight later.',
        ],
      },
      {
        title: 'International transfers: checking the FIVB index when you need it',
        items: [
          '“Check VIS now” asks FIVB there and then. The check used to run once a month, so for thirty days out of thirty-one the page showed a fixed answer and the Refresh button could only reload it — which read as though Refresh were broken. It now also runs automatically every week rather than monthly.',
          'The page says how old the VIS numbers are, and the two buttons now explain which one re-reads our own data and which one goes and asks FIVB.',
          'A player already in the index is no longer reported as missing because of her name. Where a middle name or a compound surname sat on the other side of the first-name/surname split, the match failed and the player looked absent from a register she was in all along.',
        ],
      },
    ],
  },
  {
    version: '1.66.0',
    date: '05.08.2026',
    sections: [
      {
        title: 'Coaching qualifications and officials’ licences',
        items: [
          'Basketball coaches can now record their qualification. The profile only offered the volleyball ladder (Trainer C / B / A), so a Trainer 1 or Trainer 2 had nothing to select and the club’s register kept the answer to itself. The list now shows the rungs for your own sport, with J+S available to everyone.',
          'Three referees were missing their licence in Wiedisync. Their names are spelled slightly differently in Basketplan, so the nightly import had never matched them and they were absent from the officials list despite holding a current licence. Their licence numbers are now on file, which is what stops it happening again.',
        ],
      },
    ],
  },
  {
    version: '1.65.0',
    date: '05.08.2026',
    sections: [
      {
        title: 'Fixed: setting a new password',
        items: [
          'Choosing a new password works again. The form accepted any password of 8 characters or more, but the server also requires a number or a symbol — so a password made only of letters was rejected after you pressed save, and the app blamed the reset link instead of the password. At least one member spent a quarter of an hour requesting fresh links to fix a link that was never broken.',
          'The rules are now written under the password field, and if a password is turned down the app says which rule it missed, in your language.',
          'The "Set password" link in the reset email now opens the password form. Until now it landed you back at the code-by-email screen, so the mail was effectively a dead end.',
          'If we cannot find an account for the address you typed, the app now suggests trying the address the club has on file for you. Members whose personal address differs from their club one were told no account existed and pointed at signing up, which would have created a duplicate.',
        ],
      },
    ],
  },
  {
    version: '1.64.0',
    date: '04.08.2026',
    sections: [
      {
        title: 'Club emails: picking who gets them',
        items: [
          'Picking two teams now means both of them. Choosing D1 and D2 used to ask for the people who are on both rosters — almost nobody — so a mail meant for 39 players would have reached a handful. Anything picked from the same row is now added together, while picking across rows still narrows: Volleyball plus Coaches is still the volleyball coaches.',
          'Every option shows what it would make the audience, live. Choose Volleyball and the Coaches count drops from 30 to 15 in front of you, so you can see what a filter costs before committing to it.',
          'You can now write to members by type — active, passive, honorary, gap year — or to guest players, alongside the existing “all members”.',
          'Scorers, referees and officials now mean the people who actually do the job for the club, taken from the ClubDesk groups, rather than everyone who happens to hold the licence. The basketball officials list alone was 31 people too broad.',
          'The composer opens on the current season, and the season sits next to the options it applies to.',
        ],
      },
    ],
  },
  {
    version: '1.63.3',
    date: '04.08.2026',
    sections: [
      {
        title: 'Fixed: seeing who has answered a game',
        items: [
          'Coaches, team responsibles and admins can reach a game’s attendance list again. For them the roster button opened the match sheet and nothing else, so the people most likely to ask who has replied had no way to see it from the game. There are now two buttons — “Match sheet” and “View roster” — and the first one finally says what it does. Everyone else still has the single button, unchanged.',
        ],
      },
    ],
  },
  {
    version: '1.63.2',
    date: '04.08.2026',
    sections: [
      {
        title: 'Fixed: saying whether you are coming to a game',
        items: [
          'Players called up from another team can now answer. Opening a game to another team put the fixture on all their calendars but gave them no Yes / Maybe / No buttons, so nobody could actually say whether they were coming. Their replies now count towards the game’s tally like everyone else’s.',
          'The Yes / Maybe / No buttons are back on the games list. Since 10.06 they only appeared once you opened a game, so answering straight from the list was impossible. The same fault also meant a coach’s reply was counted as a player’s instead of being filed under staff, and that players who may not play league games were not held back.',
          'Attendance counts appear together with the rest of a game, instead of a moment later, and no longer nudge everything below them as they arrive.',
        ],
      },
    ],
  },
  {
    version: '1.63.1',
    date: '04.08.2026',
    sections: [
      {
        title: 'Fixed: uploading your ID from a phone',
        items: [
          'Uploading an identity document works again. Tapping "Upload document" opened the camera or photo library but then bounced you back to your profile, and the photo you took was silently discarded — nothing was saved and no error was shown. Every attempt since 28.07 failed this way.',
          'You can now crop and rotate the photo before it is saved. A phone shot of an ID is usually sideways, or a small card on a big table; you can straighten it, zoom in and trim away the background, with presets for an ID card, landscape or portrait.',
          'As before, the picture is encrypted on your own device — the club still cannot read it, and now only the part you kept is stored at all.',
        ],
      },
    ],
  },
  {
    version: '1.63.0',
    date: '03.08.2026',
    sections: [
      {
        title: 'Improved: choosing who a club email goes to',
        items: [
          'Audiences are now clickable chips showing how many people each one reaches, instead of a dropdown you had to open to see what existed.',
          'You can combine them \u2014 pick "All coaches" and two teams and it goes out once to everyone, with nobody receiving it twice.',
          'Sections and teams are now separate choices. "Volleyball section" reaches everyone in the section including coaches and staff; "Volleyball players" reaches only those on a team right now.',
          'Former members can be reached too, for the rare club-wide announcement that warrants it.',
          'Addresses that bounce, or where someone marks the email as spam, are now remembered and skipped automatically \u2014 which protects delivery of everything else the club sends, including password reset emails.',
        ],
      },
    ],
  },
  {
    version: '1.62.0',
    date: '03.08.2026',
    sections: [
      {
        title: 'New: the club can email a whole group at once',
        items: [
          'The club mailbox can now write to a whole group \u2014 a team, all coaches, all scorers, all referees, the board, or every member \u2014 instead of pasting addresses together by hand.',
          'Before anything is sent you see exactly how many people will receive it, and why anyone is left out (no address on file, unsubscribed, or sharing an address with someone else already on the list).',
          'Everyone gets their own copy, so nobody sees anyone else\u2019s address, and replies come back to the club mailbox where the whole board can follow them. You can attach files, and write {{vorname}} to greet each person by name.',
          'Group emails now reach members who have never signed in to Wiedisync. Previously a message to "all scorers" quietly went to only about two thirds of them, and to "all basketball referees" to barely a quarter.',
        ],
      },
    ],
  },
  {
    version: '1.61.0',
    date: '03.08.2026',
    sections: [
      {
        title: 'Improved: the live scoreboard page',
        items: [
          'The hall scoreboard now actually feeds the page. The board publishes every score change itself, so Live shows a real match without anyone doing anything \u2014 for volleyball, beach volleyball and basketball alike.',
          'A final screen when the match ends, naming the winner and the result, above the full board.',
          'Recent matches on the scoreboard are listed underneath, so the page is still worth opening once a match has finished.',
          'A "live now" link on the games page while a match is being scored, so you don\u2019t have to go looking for it.',
          "Small touch: the score gives a brief bump when a point lands (skipped if you've asked your device to reduce motion).",
        ],
      },
    ],
  },
  {
    version: '1.60.0',
    date: '03.08.2026',
    sections: [
      {
        title: 'New: follow a match live from the scoreboard',
        items: [
          "The hall's scoreboard now feeds a live page in the app. Open Live and you see the same score the LED board in the hall is showing, updating on its own every few seconds \u2014 no refreshing, and no need to be logged in, so you can share the link with family and friends.",
          'It works for volleyball, beach volleyball and basketball. Volleyball shows the points in the current set, sets won, timeouts, substitutions, who is serving and the scores of the sets already played; beach shows both players of a pair; basketball shows the running score, the quarter, team fouls with the bonus and the possession arrow.',
          'The page tells you what it is doing \u2014 whether it is live, finished, or waiting for a match to start.',
        ],
      },
    ],
  },
  {
    version: '1.59.0',
    date: '01.08.2026',
    sections: [
      {
        title: 'New: call up players from another team for a single game',
        items: [
          'A coach can now open one game to another team, or to individual players. A cup game filed under H1 can be opened to H3; a junior can be pulled up for one Saturday. The called-up players see the fixture on their home page, in their calendar and in their subscribed calendar file, and they answer yes/no/maybe there like any other game.',
          'They appear in the participation list with everyone else, marked with the team they were called up from, so the coach picks a squad from one list instead of two. Their jersey number for that game is set on the match sheet as usual, and they are carried onto the Volleymanager nomination list.',
          'Nothing about their team membership changes. The call-up is scoped to that one fixture: their trainings, absences, attendance figures and ClubDesk group are untouched, and it disappears when the game does.',
          'They get a notification when they are called up, and their reminders \u2014 the answer deadline and the "game tomorrow" nudge \u2014 work exactly as for the home team. If they mark themselves absent that day, their answer is withdrawn automatically.',
          'The coach is warned about clashes, not blocked: anyone already playing a game that day is flagged in the picker and in the summary, and the two coaches decide.',
          "Only the coach or team responsible of the game's own team can call players up, and closing a team call-up releases the players it brought while keeping anyone invited by name.",
        ],
      },
    ],
  },
  {
    version: '1.58.0',
    date: '01.08.2026',
    sections: [
      {
        title: 'Fixed: cancelled trainings and games looked like they were still on',
        items: [
          'A cancelled training now shows as cancelled on the calendar — struck through and dimmed, instead of looking exactly like one that is still happening. This was most confusing on a game day: the club automatically cancels a team\u2019s training when that team plays that evening, so the training was correctly called off in the system but the calendar still advertised it right next to the fixture. Opening it explains why ("Cancelled \u2014 game day"). The same applies to cancelled games and events, in every calendar view and in the "Next 7 days" strip on the home page.',
          'Exported calendar files (.ics) mark cancelled entries too, so they are also clear in Apple Calendar, Google Calendar and Outlook. The subscription link already did this.',
          'The home page no longer jumps while it loads. The "Next 7 days" strip appeared a moment after everything else and pushed the rest of the page down as it arrived; it now holds its place from the start.',
        ],
      },
    ],
  },
  {
    version: '1.57.0',
    date: '01.08.2026',
    sections: [
      {
        title: 'New: hall sizes and photos in the hall finder',
        items: [
          'Every hall in the hall finder now shows its size — length, width and ceiling height, exactly as the city publishes it. All 104 halls have one, so it is finally possible to tell a full-size sport hall from a small gymnastics room without opening the city website for each.',
          'A photo of the hall where the city has one on file (about half of them). Tap it to see it full size.',
        ],
      },
    ],
  },
  {
    version: '1.56.2',
    date: '30.07.2026',
    sections: [
      {
        title: 'Improved: participation exports (PDF, image and CSV)',
        items: [
          'Staff and waitlisted players no longer vanish from a filtered export. Exporting with a status filter on (e.g. "Confirmed") dropped every coach, team responsible and waitlisted player from the sheet, even though they were still listed on screen. The export now matches what the participation list shows; the filter narrows the roster only.',
          'The export header names the activity again. Opening the participation list from the events or trainings list produced a sheet headed "Participation" with nothing identifying it; it now carries the event or team name and date, in the header and in the file name.',
          'One guest column instead of two. "Guest" (is this a guest player) sat next to "Guests" (plus-ones) and read as a duplicate. A guest player is now marked in the name — like the coach, captain and team-responsible markers — and the remaining column is only about plus-ones.',
          'A Team column when the list covers several teams, with the rows grouped by team. Single-team lists are unchanged.',
        ],
      },
    ],
  },
  {
    version: '1.56.0',
    date: '30.07.2026',
    sections: [
      {
        title: 'Fixed: coaches\' answers on a multi-day event went missing',
        items: [
          'A coach or team responsible who is not on the team\'s player list could answer a multi-day event (the Trainingsweekend), and their answer was filed as a player\'s. The participation list showed them as "Not responded" while the count on the card treated them as one more player coming. Their answers now appear where they belong, and the "Coach present" figure counts people rather than days — a coach who said yes to both weekend days counted twice.',
          'On an event that invites several teams, only the first team was considered when deciding whether you answer as staff or as a player. A coach of the second team was filed as a player.',
        ],
      },
      {
        title: 'New: answer for the staff too',
        items: [
          'Coaches and team responsibles now have the same edit controls as everyone else in the participation list — including the "all days at once" answer on a multi-day event\'s Overall tab, per-day answers, and notes.',
        ],
      },
      {
        title: 'Fixed: rows cut in half in the PDF export',
        items: [
          'Exporting a participation list longer than one page split the last row of every page across the page break — the name on one page, the answer on the next. Pages now end between rows.',
        ],
      },
    ],
  },
  {
    version: '1.55.0',
    date: '29.07.2026',
    sections: [
      {
        title: 'New: answer for every day at once on a multi-day event',
        items: [
          'The "Overall" tab of a multi-day event\'s participation list is now editable. Setting a member to Yes / Maybe / No there applies it to every day at once, instead of opening each day\'s tab and repeating the same answer. Days that already disagree are brought in line; a member whose days genuinely differ starts from a blank dropdown rather than a guess, and their per-day notes are left alone unless you actually type one.',
        ],
      },
    ],
  },
  {
    version: '1.54.2',
    date: '29.07.2026',
    sections: [
      {
        title: 'Fixed: day-by-day answers on a multi-day event didn\'t stick',
        items: [
          'Setting a member\'s answer for a single day of a multi-day event (the Trainingsweekend and anything else with per-day responses) saved to nowhere — the roster kept showing "Not responded", and a second attempt failed with an error mentioning that a value "has to be unique". Answers now save to the day you picked.',
        ],
      },
    ],
  },
  {
    version: '1.54.1',
    date: '29.07.2026',
    sections: [
      {
        title: 'Fixed: saving an edit failed with a "has to be unique" error',
        items: [
          'Editing an existing event, form, hall slot or team\'s staff could fail to save, with an error mentioning that a value "has to be unique" — even when you had only changed something ordinary like a response deadline and hadn\'t touched the teams at all. Everything saves again.',
        ],
      },
    ],
  },
  {
    version: '1.54.0',
    date: '28.07.2026',
    sections: [
      {
        title: 'New: identity documents are watermarked when shown',
        items: [
          'Every identity document displayed before a game now carries a visible stamp burned into the image itself — club, purpose ("Spielkontrolle / match check"), who opened it and when. A screenshot keeps the stamp, so the document cannot pass as a clean copy anywhere else, and any leaked image is traceable to the audit-logged viewing.',
        ],
      },
      {
        title: 'Improved: showing IDs before a game',
        items: [
          '"Show IDs" now downloads the documents by itself if you haven\'t pre-downloaded them. The separate "Download for offline" button remains for preparing before you travel — halls often have no signal.',
          'If you open the dialog before the 45-minute window, the Show button now unlocks itself the moment the window opens (and closes itself at kickoff) — no more closing and reopening.',
        ],
      },
      {
        title: 'Changed: your identity document is managed in Edit profile',
        items: [
          'The encrypted identity-document section moved from the profile view to Edit profile, next to the other things you can change — and it now loads in one piece instead of flickering through loading states.',
        ],
      },
    ],
  },
  {
    version: '1.53.0',
    date: '28.07.2026',
    sections: [
      {
        title: 'New: complete your profile to use the app',
        items: [
          "The app now asks for your core contact details before you can continue: phone number, birthdate, address and nationality. The club is required to keep these in the member register, and until now coaches and staff were never asked for them at all. If your profile already has them (most members), you won't notice anything.",
          'Coaches and staff without a playing role are now recorded in the "Gratis" fee category automatically, so they appear correctly in the club register.',
        ],
      },
    ],
  },
  {
    version: '1.52.0',
    date: '28.07.2026',
    sections: [
      {
        title: "Improved: game days no longer show a training your team can't attend",
        items: [
          "Trainings on game days are cancelled automatically. When your team has a game — home or away — that day's training is taken off the calendar. If the game moves or is called off, the training comes back by itself; a coach can still reinstate a training and that decision sticks.",
          'Players in two teams are excused automatically: if your other team has a game that day, you are signed out of the training with a note naming the game (e.g. "Game H2"). Your own answers always win — explicit RSVPs are never overridden.',
        ],
      },
    ],
  },
  {
    version: '1.51.0',
    date: '27.07.2026',
    sections: [
      {
        title: 'Improved: the app now speaks French and Italian throughout',
        items: [
          'Nearly a thousand interface texts per language were still English for French and Italian users — the whole finance area, most of the member admin, the forms feature, the hall finder, the game-scheduling tools and many smaller corners. All of them are now properly translated, using the same club vocabulary as the existing translations.',
        ],
      },
    ],
  },
  {
    version: '1.50.0',
    date: '27.07.2026',
    sections: [
      {
        title: 'Removed: three unused features',
        items: [
          'Per-activity task checklists, game carpools and the admin saved-queries strip have been removed. None of them saw a single use across a full season. The fines page, hall-slot claims and referee expenses stay — they are expected to earn their keep when the 2026/27 season starts.',
        ],
      },
    ],
  },
  {
    version: '1.49.0',
    date: '27.07.2026',
    sections: [
      {
        title: 'Fixed: club-wide events were missing from the website and calendar feeds',
        items: [
          'Club-wide events — those open to everyone rather than tied to a team — had disappeared from kscw.ch and from subscribed calendars. They are back, and the underlying data problem can no longer recur.',
          'Cancelled events now disappear properly: the website no longer lists them, and subscribed calendars receive a cancellation so they vanish there too.',
        ],
      },
      {
        title: 'Fixed: a cancelled game stayed cancelled',
        items: [
          'A game cancelled in the app was silently put back on the calendar by the nightly league sync. A cancellation now sticks unless the league reports the game as played — and if a game genuinely is back on, everyone on the team gets a "Game back on" notification instead of it quietly reappearing.',
        ],
      },
      {
        title: 'Fixed: attendance counts and absence sign-out',
        items: [
          'Duplicate RSVPs could double-count members in attendance tallies, and RSVPs left over from deleted trainings inflated per-member statistics. Both are cleaned up and can no longer recur.',
          'An absence now also signs you out of club-wide events and events you were personally invited to — previously you could even be auto-signed-in while absent. Multi-day events are declined per day, matching how you sign up for them.',
        ],
      },
      {
        title: 'Improved: member admin and data integrity',
        items: [
          'The member admin form is now organized into collapsible sections (identity, address, licences, preferences, billing, …) instead of one flat 100-field list.',
          'The admin "Last online" column now actually shows when a member last logged in.',
          'A broad round of database hardening: proper cross-references throughout games, trainings, rosters and finance data, duplicate records merged, and faster admin audit pages.',
        ],
      },
    ],
  },
  {
    version: '1.48.0',
    date: '25.07.2026',
    sections: [
      {
        title: 'New: Hall finder — free city sport halls for the season',
        items: [
          'A new admin tool (Options → Hall finder) shows which City of Zürich sport halls have a free recurring training slot for the whole winter season, so you no longer have to check the city booking site hall by hall.',
          'Filter by weekday, earliest start, minimum duration, city district and hall type. By default it lists only halls that are free every week excluding school holidays; switch that off to also see halls that are free most weeks.',
          'Each result links straight to the city occupancy calendar and to a pre-filled reservation request. Availability is refreshed automatically every night.',
        ],
      },
    ],
  },
  {
    version: '1.47.0',
    date: '25.07.2026',
    sections: [
      {
        title: 'New: nationality is now a proper list, with flags',
        items: [
          'Pick every nationality you hold, not just one. The profile nationality field is a searchable list with flags — start typing a country or its two-letter code. Dual nationals can select both; the first one you pick is treated as your main one and is what the club register receives.',
          'It reads in your language. Previously the field held a German country name whatever language you used the app in.',
        ],
      },
      {
        title: 'New: federation of origin',
        items: [
          'A new profile field asks which national federation licensed you at age 14 — the definition Swiss Volley and the FIVB use, and the one that decides whether an international transfer is needed to play here. It is not necessarily where you first played.',
          '"None" is a real answer. If no national federation licensed you at 14 — for example if you only ever played recreational leagues such as Italy\'s CSI, UISP or PGS, which are not FIVB or FIBA members — choose it. That tells the club there is nothing to request, which a blank field cannot.',
          'The membership sign-up form asks the same two questions, so new members arrive with the answer already recorded.',
        ],
      },
      {
        title: 'New: Transfers page (club staff)',
        items: [
          'A per-sport view of international transfers, grouped by federation of origin, with a note field and a done marker. It also lists members whose nationality suggests the question has never been put to them.',
          'For volleyball it cross-checks Swiss Volley\'s licence data and flags two situations: someone marked done whose licence is not validated — meaning they are not yet eligible to play — and someone still marked pending whose licence has been validated, which usually means the certificate has already arrived.',
          'One prepared email per federation. A transfer cannot be requested until the player exists in the FIVB VIS index, so each federation group carries a single ready-to-send request listing everyone of theirs still missing from it, with name, date of birth and email. Copy it, or open it straight in your mail programme. It is always written in English — the working language of the FIVB — whatever language you read the app in.',
          'The federation\'s own contact address is on file for every country our members come from, taken from VIS, and shown once per group.',
          'Only members who are actually on a team appear. Anyone on no team is counted in the page header instead of filling the lists; add them to a team and they return.',
        ],
      },
      {
        title: 'Improved: officials licences distinguish OTN 1 and OTN 2',
        items: [
          'The basketball table-official licence now records the level, matching Swiss Basketball\'s own register, which has always kept the two apart.',
        ],
      },
    ],
  },
  {
    version: '1.46.1',
    date: '25.07.2026',
    sections: [
      {
        title: 'Fix: open-ended absences now sign you out reliably',
        items: [
          'An absence with no end date now signs you out of every training and game across its whole span — including sessions added to the calendar later — just like a dated absence does. Some open-ended absences (typically the long-term ones entered on a member\'s behalf) were being missed, so the person still showed as attending. This is independent of the "blocks game scheduling" switch, which only affects planning and never changes your own attendance.',
        ],
      },
    ],
  },
  {
    version: '1.46.0',
    date: '16.07.2026',
    sections: [
      {
        title: 'New: send club news to specific teams or roles',
        items: [
          'Club news can now be addressed to particular teams, or to people by what they do. Alongside "all members" and "one sport", you can pick specific teams — which reaches their players, coaches, team responsibles and captain — or target roles and functions: the board, coaches, captains, scorers, referees, finance, and so on. The email, the push and the in-app post all go to exactly that group, and nobody else sees the post.',
          'Every news email now asks you to confirm before it sends, and tells you who it is about to reach. Previously only the "all members" blast asked.',
        ],
      },
    ],
  },
  {
    version: '1.45.0',
    date: '15.07.2026',
    sections: [
      {
        title: 'New: guided tours for more of the app',
        items: [
          'The in-app guide now covers more areas. News, Fines, and the Calendar each have a short, tap-through walkthrough that points out the buttons and lists right on the page. Open Guide from the menu and pick a tour — a green tick marks the ones you have finished.',
        ],
      },
    ],
  },
  {
    version: '1.44.0',
    date: '15.07.2026',
    sections: [
      {
        title: 'New: go by the name you actually use',
        items: [
          'You can set a preferred display name in your profile. If people call you something other than your legal first name — Honza instead of Jan — set it once and the whole app shows it: rosters, RSVP lists, chat, absences, scheduling. Leave it empty to keep your first name.',
          'Official documents are unaffected. Match sheets, Volleymanager, ClubDesk, invoices and the public website always use your legal name — only the in-app display changes.',
        ],
      },
      {
        title: 'New: basketball scheduling prep',
        items: [
          'The scheduling app now has a Volleyball / Basketball toggle. Basketball is scheduled centrally by the association (ProBasket), so its section is a preparation view: for each team it shows which home dates (Fri/Sat/Sun) the KWI hall is free — with volleyball’s hall use, closures and blocked dates overlaid — and lets you record availability to bring to the planning meeting or the hall-availability form.',
        ],
      },
    ],
  },
  {
    version: '1.43.0',
    date: '14.07.2026',
    sections: [
      {
        title: 'New: the match sheet, on your phone',
        items: [
          'Coaches and team responsibles can now open the match sheet from a game, in the hours around kickoff, and hand the phone to the scorer. It is laid out the way the sheet is actually filled in: birthdate, number, then surname and first initial. The captain\u2019s number is circled, liberos appear again in their own block, and the officials are listed at the bottom.',
          'You can adjust it for that one game \u2014 change a number, move the captain\u2019s circle, flag a libero, or, in an emergency, add a player who turned up unnominated or strike out one who did not. None of this touches the player\u2019s normal shirt number, position, or the team\u2019s captain: it applies to that match only.',
          'Adding or removing a player is the only change that can disagree with Volleymanager, and it is the only one that raises a warning. Numbers, captain and libero do not exist on the Einsatzliste at all, so changing them cannot contradict it. If you do add or drop someone, Wiedisync tells you, in red, that the same change must also be made by hand in Volleymanager \u2014 it does not send it for you.',
        ],
      },
      {
        title: 'New: your ID, encrypted so that nobody here can read it',
        items: [
          'You can upload a photo of your ID in your profile, and your coaches can show it to a referee before a game. It is encrypted on your own device before it leaves it. The club cannot read it \u2014 not the committee, not the admins, not the server. Only you and the coaches and team responsibles of your teams hold a key to it.',
          'Coaches see them from 45 minutes before kickoff. They can download them beforehand, because halls usually have no signal, and the documents are removed from the phone again once the game starts. Every time someone opens an ID, it is recorded.',
          'This is real encryption, and it has a real consequence. There is no master key and no way for anyone at the club to recover your document. If you reset a forgotten password, your key is lost with it and you simply upload your ID again. Changing your password from inside the app is safe \u2014 it keeps your key.',
          'Only members who have logged in can have a document, because the key is made from your password. There is no way around that without the club being able to read your ID, which is the one thing this is for.',
        ],
      },
      {
        title: 'Fixed: away games were showing the wrong list',
        items: [
          'The Einsatzliste for away games was never being read. Wiedisync only ever looked at the home team\u2019s list, so for away games it quietly fell back to the RSVPs \u2014 which meant a nominated player who had not RSVP\u2019d was simply missing from the sheet, in the away hall, which is exactly where a referee is most likely to ask for it. Away games now show the real Einsatzliste, the same as home games.',
          'Officials are now listed with their role (coach, assistant coach 1, assistant coach 2) instead of as one anonymous list. Volleymanager knew this all along; Wiedisync was throwing it away.',
        ],
      },
    ],
  },
  {
    version: '1.42.0',
    date: '13.07.2026',
    sections: [
      {
        title: 'New: the Einsatzliste can file itself',
        items: [
          'Volleymanager’s Einsatzliste can now be filled in automatically from the RSVPs. About an hour before a game, Wiedisync takes everyone who confirmed, matches them to their Swiss Volley licence, enters them into the Einsatzliste in Volleymanager, and closes it. This works for away games too, not just home games.',
          'It is off by default, and you turn it on per team (Team settings → Game defaults), or per game if you want to override the team’s setting for one match.',
          'It will not close a list that Volleymanager is unhappy with. If Volleymanager warns that the list is too short or has no coach — the kind of thing the club can be fined for — Wiedisync enters the players but leaves the list open and tells you to check it. It never files a list you could be fined for without a human looking at it.',
          'Only players who hold a licence can be nominated, so anyone who confirmed but has no licence number on file is reported rather than quietly dropped.',
        ],
      },
    ],
  },
  {
    version: '1.41.0',
    date: '13.07.2026',
    sections: [
      {
        title: 'Fixed: the member list was empty when inviting people to an event',
        items: [
          'If you are a coach or a team responsible, creating an event now shows the full member list again. The invite picker was coming up empty — not because nobody matched, but because the app was not allowed to read one of the fields it was searching on, so the request was rejected and the list silently came back blank. No error was ever shown, which is why it looked like "no members found".',
        ],
      },
      {
        title: 'For admins: ClubDesk consistency check',
        items: [
          'The ClubDesk sync page now lists everything that has drifted between ClubDesk and Wiedisync, with an Excel worklist: members in no ClubDesk group, members missing their team’s group, coaches missing their coach group, people in a ClubDesk group but not on the roster, and members paying a playing fee while on no roster.',
          'Each team’s ClubDesk group is now stored on the team itself, so a new team can no longer be silently skipped by these checks.',
        ],
      },
    ],
  },
  {
    version: '1.40.0',
    date: '13.07.2026',
    sections: [
      {
        title: 'Data explorer: ClubDesk sync + registration files',
        items: [
          'New "ClubDesk sync" column — see at a glance whether each member matches the club register: In sync, Drift (a field differs), Pending push, Not linked, Stale link or Departed. Groupable, so you can pull up everyone who is out of step.',
          'New "Reg. files" column — the documents a member uploaded when they registered are kept after approval, and can now be opened straight from the grid.',
          'The column header row and the name column stay put while you scroll, so you always know which column you are looking at.',
          'More inline editing: sex and preferred language are now dropdowns, and scorer (VB) / Wiedisync active toggle with a click. Yes/no columns show a checkmark only when true, so the ones that are set stand out.',
        ],
      },
      {
        title: 'Your registration documents',
        items: [
          'Profile now has a "My documents" card. The ID and licence documents you uploaded when you registered are kept, and you can open them again any time. It only appears if you have documents.',
        ],
      },
    ],
  },
  {
    version: '1.39.0',
    date: '12.07.2026',
    sections: [
      {
        title: 'Data explorer: team view',
        items: [
          'The grid has a Members | Teams toggle — the team view lists every team with its roster, coach and team responsible as editable chips, plus in-place editing of team name, league and season.',
          'Nine more member columns: sport, scorer (VB), referee (VB/BB), officials licence, Wiedisync active, last online, and passive / honorary / former membership.',
          'Export, sorting, search and the column chooser work in both views.',
        ],
      },
    ],
  },
  {
    version: '1.38.0',
    date: '12.07.2026',
    sections: [
      {
        title: 'Club news in your notifications',
        items: [
          'Published announcements now appear in the notification bell for everyone in the announcement’s audience — tapping one opens the news page.',
        ],
      },
    ],
  },
  {
    version: '1.37.0',
    date: '12.07.2026',
    sections: [
      {
        title: 'Newsletter emails',
        items: [
          'Announcements can now be emailed in a newsletter layout — club masthead, the announcement image as a hero, a large headline and a call-to-action button.',
          'Emailed announcements can carry a reply-to address, so members’ replies reach a real mailbox instead of no-reply.',
        ],
      },
    ],
  },
  {
    version: '1.36.0',
    date: '12.07.2026',
    sections: [
      {
        title: 'Data explorer grid view',
        items: [
          'The Data explorer now has a spreadsheet mode (toggle in the header): a team rail with member counts next to a dense, sortable member table. Shows first / last name by default — add any of 19 columns via the column chooser.',
          'Sport admins and above edit cells in place — changes save field-by-field, and the Teams column adds or removes team memberships directly.',
          'Group rows by team, city, nationality, birth year and more; search across every column; export the current view to Excel or PDF.',
        ],
      },
      {
        title: 'Tidier admin menu',
        items: [
          'The Admin dropdown is organized into sections (Planning & halls, Game operations, Members & communication, Data & insights) on desktop and mobile.',
        ],
      },
    ],
  },
  {
    version: '1.35.0',
    date: '11.07.2026',
    sections: [
      {
        title: 'Your duties, everywhere',
        items: [
          'Your assigned scorer / scoreboard / referee duties now appear as a yellow reminder on the home page (from one week before until the game ends), as an entry in “My next appointments”, and on the Events page.',
          'Your duties are now automatically included in your calendar subscription — whatever you subscribe to, they ride along, no separate link needed.',
          'Pending duty hand-offs now show on the home page too, so you can accept or decline a delegated duty without opening the scorer page.',
        ],
      },
      {
        title: 'Emergency help at the hall',
        items: [
          'Within an hour of kick-off, an on-duty official can tap “Emergency: contact team leaders” to see the playing team’s coach / responsible phone and email and alert the club at once.',
          'The coach’s “report late” button now appears once an official is actually late — 29 minutes before the start for the scorer / referee, 14 for the scoreboard.',
        ],
      },
      {
        title: 'Automatic no-show fines',
        items: [
          'When a coach flags a scorer / official as late or absent via the emergency button, the CHF 50 duty fine is now issued to them automatically (using the team’s fine rules when configured).',
        ],
      },
    ],
  },
  {
    version: '1.34.1',
    date: '09.07.2026',
    sections: [
      {
        title: 'Participation export polish',
        items: [
          'Exporting a multi-day event roster (PNG / PDF / CSV) now shows each person’s answer per day instead of collapsing it to a single status. A single-day export is also labelled with the day.',
          'Fixed the position summary (“Outside hitter”, “Middle blocker”) wrapping mid-word in the export.',
          'A playing coach no longer appears a second time in the export’s staff list — they already show in the roster with a “(Coach)” badge.',
        ],
      },
    ],
  },
  {
    version: '1.34.0',
    date: '09.07.2026',
    sections: [
      {
        title: 'ClubDesk group checks in Data Health',
        items: [
          'Data Health now flags when Wiedisync team rosters and ClubDesk groups disagree: players missing their team’s ClubDesk group, people sitting in a ClubDesk group without being a current player, and ClubDesk groups with no matching team. ClubDesk groups can only be changed by hand, so these are surfaced for review — not auto-fixed.',
        ],
      },
    ],
  },
  {
    version: '1.33.0',
    date: '09.07.2026',
    sections: [
      {
        title: '“Staff only” position',
        items: [
          'Members who are staff and don’t play can now be marked “Staff only” instead of “Other” when choosing positions. Existing non-playing coaches and team responsibles were updated automatically.',
        ],
      },
    ],
  },
  {
    version: '1.32.0',
    date: '09.07.2026',
    sections: [
      {
        title: 'Volley referees admin page',
        items: [
          'Admins can now assign each volleyball referee to the team(s) they cover — or mark them “External” — from a new “Volley referees” page, with a coverage check that flags any team or referee still unassigned.',
        ],
      },
    ],
  },
  {
    version: '1.31.0',
    date: '09.07.2026',
    sections: [
      {
        title: 'Multi-day events: respond per day',
        items: [
          'Per-day events (like a training weekend) now let you answer each day separately, or use the quick Yes / No on the card to accept or decline every day at once. The “Per day” button opens a day-by-day view. Before, the card only offered a single Yes/No that didn’t belong to any day, so the per-day breakdown always showed nobody attending.',
          'Editing a per-day event now works: changing the event’s dates moves its days to match, and saving no longer fails.',
        ],
      },
      {
        title: 'Filter a roster by guests',
        items: [
          'The multi-team participation list can now be narrowed to just guest players, and each guest shows their level.',
        ],
      },
    ],
  },
  {
    version: '1.30.0',
    date: '09.07.2026',
    sections: [
      {
        title: 'Filter a multi-team event roster by team',
        items: [
          'When an event involves more than one team, the participation list now has a team filter. Pick one or more teams (or leave it on “All teams”) and the whole view narrows to just those teams — the Confirmed / Maybe / Declined / No response counts, the member list, the coaching staff and the CSV / PDF / image exports all update together. Games and trainings, which only ever involve one team, are unchanged.',
        ],
      },
    ],
  },
  {
    version: '1.29.0',
    date: '08.07.2026',
    sections: [
      {
        title: 'Issue a fine directly, branded confirmations',
        items: [
          'Coaches, team responsibles and admins can now issue a fine directly from the Fines page — pick a team and member, and the amount fills in from that team’s fine catalog. Previously a fine could only be started from the roster’s late-sign-in prompt.',
          'Confirmation pop-ups across Club finances (mark an expense paid/rejected, delete a ledger or team entry, cancel an invoice, switch dues emails to live) are now proper in-app dialogs — themed and dark-mode aware — instead of the plain browser pop-up.',
        ],
      },
    ],
  },
  {
    version: '1.28.0',
    date: '08.07.2026',
    sections: [
      {
        title: 'Shared internal note on expenses',
        items: [
          'Expense reimbursements now have a shared internal note that finance, the section TK and admins can all read and edit — a place to leave each other notes while a reimbursement is being processed. It is never shown to the member.',
        ],
      },
    ],
  },
  {
    version: '1.27.0',
    date: '07.07.2026',
    sections: [
      {
        title: 'Home “next 7 days” ticker + team birthdays',
        items: [
          'The home page now has a scrolling banner showing everything coming up in the next 7 days for your team(s) — games, trainings, events, hall closures and birthdays — all in one glance. Admins see it across every team.',
          'Team birthdays now appear in the calendar too, visible only to that team (never public). Toggle them under Filter → “Birthdays”. Only members whose birthday visibility is set to “full” are shown, so anyone who kept theirs private stays private.',
        ],
      },
    ],
  },
  {
    version: '1.26.0',
    date: '07.07.2026',
    sections: [
      {
        title: 'Standardized contact data + smarter signup form',
        items: [
          'Phone numbers, IBAN, AHV numbers and emails are now stored in one standard format everywhere (e.g. +41 79 123 45 67), and existing entries were cleaned up automatically. The ClubDesk sync repairs values in both directions.',
          'The signup form on kscw.ch now checks the AHV number (check digit), phone number and email before submitting, and offers an optional IBAN field — used only to pay money back to you (e.g. expense reimbursements), never to collect payments.',
          'Editing your profile validates the phone and AHV number the same way.',
        ],
      },
    ],
  },
  {
    version: '1.25.0',
    date: '07.07.2026',
    sections: [
      {
        title: 'Scorer duty: HU20 referee + simpler assignment',
        items: [
          'HU20 home games are now staffed with a scorer and a referee instead of a scoreboard operator. The referee is assigned to a team like the scorer, and any member of that team can take it — no licence needed.',
          'Scorer and scoreboard duties no longer require a licence either, so the auto-assignment can draw on any team. MiniVB and DU20 are no longer assigned scorer duties.',
        ],
      },
    ],
  },
  {
    version: '1.24.0',
    date: '07.07.2026',
    sections: [
      {
        title: 'Club stats: pick a season',
        items: [
          'Club statistics now has a season selector next to the sport toggle, defaulting to the current season. Schreiber coverage and win/loss results follow the selected season instead of mixing in last season\'s data; the rest of the page stays current.',
        ],
      },
    ],
  },
  {
    version: '1.23.0',
    date: '07.07.2026',
    sections: [
      {
        title: 'Scorer assignment tool for admins',
        items: [
          'Admins have a new "Scorer assignment" page in the Admin menu that automatically assigns scorer and scoreboard (Täfeler) duty teams to home games — for both volleyball and basketball.',
          'A per-team overview at the top shows how many duties each team received; every game can be reviewed and changed before saving, and a built-in rules panel explains how the algorithm decides.',
        ],
      },
    ],
  },
  {
    version: '1.22.0',
    date: '06.07.2026',
    sections: [
      {
        title: 'Expense reimbursements: status tracking',
        items: [
          'Uploaded expenses now appear under "My submissions" on the upload page with their status — pending, paid or rejected — including any note from finance, and you can re-open your receipt.',
          'You get a notification (in-app, email and push) the moment finance marks your expense as paid or rejected.',
          'Finance manages all submissions in a new Expenses tab in Club finances: change the status, leave a note for the member, correct details and open the receipt. Marking as paid also creates the linked payout with its QR-bill.',
        ],
      },
    ],
  },
  {
    version: '1.21.2',
    date: '06.07.2026',
    sections: [
      {
        title: 'Calendar: hall closures show every affected hall',
        items: [
          'A closure covering several halls showed only the first hall (e.g. "KWI A" when A, B and C were closed). The calendar now lists all affected halls in one entry — "KWI A, B, C".',
        ],
      },
    ],
  },
  {
    version: '1.21.1',
    date: '06.07.2026',
    sections: [
      {
        title: 'Dates follow your language',
        items: [
          'Weekday and month names (game details, calendar headers, scorer rows, event badges, date pickers) now render in your selected language — Italian, French and English users no longer see German day/month names. Numeric dates keep the Swiss dd.mm.yyyy format everywhere.',
        ],
      },
    ],
  },
  {
    version: '1.21.0',
    date: '04.07.2026',
    sections: [
      {
        title: 'Data health: ClubDesk drift detection',
        items: [
          'Members whose wiedisync contact data no longer matches ClubDesk now surface in Data health with the exact field differences — one click marks them for the next sync-up.',
          'Fields wiedisync has but ClubDesk lacks are grouped into one bulk row per field, so they can all be marked at once.',
        ],
      },
    ],
  },
  {
    version: '1.20.0',
    date: '04.07.2026',
    sections: [
      {
        title: 'Registration documents are now enforced',
        items: [
          'Basketball registrations can no longer be created without their required documents: the website form uploads each file the moment it is picked, and the registration is only submitted once everything required is in.',
          'Approval is blocked while required documents are missing, with a clear message on the Anmeldungen page.',
          'New "Dokumente nachreichen" page on the website: missing documents can be submitted later with the reference number and email from the confirmation.',
        ],
      },
    ],
  },
  {
    version: '1.19.0',
    date: '04.07.2026',
    sections: [
      {
        title: 'ClubDesk status on every approved registration',
        items: [
          'Each approved registration (Anmeldungen) now shows a ClubDesk sync zone: whether the person already exists in ClubDesk, is found there but not linked yet, or is missing entirely.',
          'One-click actions per person: link an existing ClubDesk contact, or push just this person to ClubDesk — no need to run a full sync for a single new member.',
        ],
      },
      {
        title: 'Polls: results visible to members',
        items: [
          'Polls have a new "results visible to everyone" option (on by default for new polls): members can see the vote counts after voting, not just managers. Who voted for what stays visible to managers only.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'The Data health page no longer fails to load when the "Missing sex" check runs.',
        ],
      },
    ],
  },
  {
    version: '1.18.0',
    date: '03.07.2026',
    sections: [
      {
        title: 'Account signup by personal invite',
        items: [
          'New WiediSync accounts are now created through a personal, single-use invite link — sent automatically when your club registration is approved, or by your coach, team responsible or the club board. This prevents duplicate member records.',
          'Existing members without an account can still activate it the usual way with their registered email address.',
          'Coaches and team responsibles can send an account invite to roster members who have no login yet — with a QR code to scan in person, plus the link by email. Every invite and approval email now includes a short step-by-step guide.',
        ],
      },
      {
        title: 'Game planning opens to coaches',
        items: [
          'Coaches and team responsibles can now open the game-planning calendar for their own team (view only) — see planned and confirmed match dates without asking the Spielplaner.',
        ],
      },
      {
        title: 'Fixes',
        items: [
          'Guest invite links (QR) from the team page work again.',
          'Fixed an issue where an account created via the claim flow ended up without permissions.',
        ],
      },
    ],
  },
  {
    version: '1.17.0',
    date: '29.06.2026',
    sections: [
      {
        title: 'Scheduling: lone Saturday games move to the small hall',
        items: [
          'A Saturday home game that is the only one at its time is now placed automatically in KWI C (the single hall) — freeing the double hall (KWI A+B) for basketball. Two games at the same time take KWI A+B, three fill A+B+C.',
          'This runs by itself whenever a game is booked, moved or cancelled, and VolleyManager is kept in sync. A new "Optimize now" button (Scheduling → Settings) applies it on demand.',
        ],
      },
    ],
  },
  {
    version: '1.16.0',
    date: '28.06.2026',
    sections: [
      {
        title: 'Polls: managers can see who voted',
        items: [
          'Team managers (coaches & team responsibles) now see per-member answers on a poll — who picked each option — beneath each result, not just the totals.',
          'This respects the poll\'s Anonymous setting (chosen when creating the poll): an anonymous poll stays totals-only, even for managers.',
        ],
      },
    ],
  },
  {
    version: '1.15.0',
    date: '28.06.2026',
    sections: [
      {
        title: 'Surveys are easier to find — and managers see live replies',
        items: [
          'Active surveys now appear on the home screen, right under the news — open polls for your teams show up there so you can vote without digging into a team page.',
          'Team managers (coaches & team responsibles) can now see a poll\'s replies live: the running tally is visible at any time, not only after the deadline. Everyone else still sees results once they\'ve voted or the deadline has passed.',
        ],
      },
    ],
  },
  {
    version: '1.14.0',
    date: '28.06.2026',
    sections: [
      {
        title: 'Scheduling: block dates from the settings',
        items: [
          'New "Blocked dates (whole club)" setting (Scheduling → Settings) — block days where no team plays home games (club holidays, tournaments, hall-wide events). Editable only by a superadmin; coaches\' own per-team blocks still apply on top.',
          'The closed dates (hall closures) — automatic ones from school holidays and the calendar sync, plus manual closures — are now managed right there in Settings too.',
        ],
      },
    ],
  },
  {
    version: '1.13.0',
    date: '28.06.2026',
    sections: [
      {
        title: 'Keep member data in sync with ClubDesk (admins)',
        items: [
          'A new "Sync down from ClubDesk" button (Registrations page) pulls the latest member data from ClubDesk on demand, instead of waiting for the weekly sync.',
          'A new "Sync up to ClubDesk" opens a review modal that previews exactly which members are new or changed, lets you choose which to push, then writes them into ClubDesk — updating existing contacts (matched by email) rather than creating duplicates — and shows the result.',
          'Both are admin-only, and the sync-up always shows a preview for you to confirm before anything is written to ClubDesk.',
        ],
      },
    ],
  },
  {
    version: '1.12.0',
    date: '26.06.2026',
    sections: [
      {
        title: 'Choose which emails you receive',
        items: [
          'Your profile has a new "Email notifications" section: switch off the alerts you don\'t want — new registrations, team join requests, form submissions, club news, and event invitations.',
          'Each toggle only appears if you can actually receive that alert (join-request alerts show for coaches and team responsibles, for example). Turning one off silences the email — or, for form submissions, the push notification — while the in-app bell still shows it.',
          'Everything stays on by default, so nothing changes until you opt out.',
        ],
      },
      {
        title: 'Finance: the Ledger shows your real books, and stays current',
        items: [
          'The Ledger\'s Journal and Trial balance now show your imported ClubDesk bookings (marked "ClubDesk"), so the book of record reflects your actual accounting — native entries you post in wiedisync layer on top.',
          'Finances now sync automatically from ClubDesk every night, and a "Sync now" button (Finance → Sync) refreshes them on demand.',
          'Export the income statement, balance sheet, budget and trial balance as a polished PDF, Excel workbook or PowerPoint deck — an "Export" button on each report.',
          'One fiscal-year selector for the whole Finance area, and changing the year (or any filter) no longer blanks and reloads the page.',
        ],
      },
    ],
  },
  {
    version: '1.11.0',
    date: '26.06.2026',
    sections: [
      {
        title: 'Club accounting, built in: your own double-entry ledger',
        items: [
          'Finance has a new "Ledger" tab — a full double-entry book of record inside wiedisync, so the club can keep its own accounts instead of relying on an external tool.',
          'It runs itself: once turned on, the ledger posts automatically from the club\'s activity — every invoice, payment, reminder fee, credit note, refund, write-off and per-team sponsoring becomes the right journal entry, with receivables kept in balance.',
          'Your existing ClubDesk chart of accounts is shared with the ledger — just map the bank, receivables and income accounts and switch auto-posting on.',
          'Dues income can be booked per membership category — map each category (Passivmitglieder, Aktivmitglieder, J+S …) to its own income account to mirror ClubDesk\'s breakdown.',
          'Everything a set of books needs: a journal you can post and reverse entries in, a trial balance, and a guided year-end close (Jahresabschluss) that moves the result into equity and carries balances into the next year. A "Reconcile now" button keeps the ledger in step with the rest of finance.',
          'Closed years are locked — entries can no longer be changed, only corrected with a reversal, the way proper accounting requires.',
        ],
      },
    ],
  },
  {
    version: '1.10.0',
    date: '25.06.2026',
    sections: [
      {
        title: 'Scheduling mailbox: its own tab, with a Volleyball/Basketball switch',
        items: [
          'The scheduling mailbox moved out of the dashboard into its own "Mailbox" tab, next to Dashboard and Settings.',
          'Switch between the Volleyball and Basketball mailboxes with a toggle at the top — each is its own account (volleyball@ / basketball@spielplanung.kscw.ch). You only see the sports you have access to.',
          'A proper mail client: separate Inbox and Sent, plus reply, reply all, forward (keeps the original attachments) and new email.',
          'On the volleyball side, emails still group by opponent — the dashboard "N emails" button opens that opponent’s thread in the new tab.',
        ],
      },
    ],
  },
  {
    version: '1.9.1',
    date: '25.06.2026',
    sections: [
      {
        title: 'Game scheduling: hand schedules over to the Swiss Volley feed on a set date',
        items: [
          'Set a "Feed takeover date" per season in the scheduling settings. Until that date, the dates, times and venues you arranged in the tool are protected from the official Swiss Volley feed — which can still show a placeholder until your opponents enter your away games in Volleymanager.',
          'On and after that date, the official feed takes over date, time and venue automatically, since by then every opponent has had time to enter their away games. Scores and results always sync regardless.',
          'Leave the date empty to keep protecting scheduled games until they are played, as before.',
        ],
      },
    ],
  },
  {
    version: '1.9.0',
    date: '25.06.2026',
    sections: [
      {
        title: 'Finances: bill membership dues in one run',
        items: [
          'Set the membership fee per category (and per section) for a season, then bill every active member in those categories in one go — each gets a payable QR-bill in the app.',
          'Preview before you bill: see exactly who will be charged, how much, and who is missing a rate or already billed.',
          'Re-running is safe — members who already have a dues invoice for the season are skipped, so nobody is billed twice.',
          'Cancel a whole run to void its still-open invoices; paid ones are kept.',
          'Download all of a run\'s bills as one PDF — a Swiss QR-bill per member to print and post, or attach yourself.',
        ],
      },
    ],
  },
  {
    version: '1.8.0',
    date: '24.06.2026',
    sections: [
      {
        title: 'Finances: per-member explorer + a dedicated Finance role',
        items: [
          'New "Finance" role for the treasurer and finance team — the club-finance dashboard and the new per-member view, on top of normal member access, without full board permissions.',
          'A Members tab in Club finances: search any member to see their contact details, IBAN, membership category and full invoice history with payment status, all in one place.',
          'Record a separate billing contact per member — for a minor billed to a parent/guardian, or a company that pays — used when addressing invoices.',
          'Attach the invoice PDF to any invoice and open it later. Documents are private to finance and the board, and stay correctly linked to their ClubDesk invoice across nightly syncs.',
        ],
      },
    ],
  },
  {
    version: '1.7.0',
    date: '24.06.2026',
    sections: [
      {
        title: 'Finances',
        items: [
          'Invoices you pay through the app now reconcile automatically with club accounting — the payment carries the invoice number in the standard format, so no manual matching is needed.',
        ],
      },
    ],
  },
  {
    version: '1.6.1',
    date: '24.06.2026',
    sections: [
      {
        title: 'Game scheduling: accurate dashboard counters',
        items: [
          'The Spielplanung dashboard\'s home/away game counters now count every leg of a pairing, so junior teams that play an opponent two or three times are tallied correctly — no more "more games confirmed than the season has".',
        ],
      },
    ],
  },
  {
    version: '1.6.0',
    date: '23.06.2026',
    sections: [
      {
        title: 'Finances: invoices you can pay in the app',
        items: [
          'The Fines page now lives in one Finances menu, alongside My finances, Upload invoice and Club finances (for the board).',
          'The board can create an invoice for a member or a whole team — for example a Swiss Volley fine — right in Club finances.',
          'You pay invoices in the app: open one under My finances, scan the QR-bill with TWINT or your banking app, then tap "I\'ve paid". It shows as pending until the treasurer confirms the money arrived.',
          'Team invoices appear for the team\'s coach, captain and responsible.',
          'The board can link ClubDesk invoices that weren\'t matched to the right member (e.g. billed to a parent\'s email), and the link sticks across syncs.',
        ],
      },
    ],
  },
  {
    version: '1.5.0',
    date: '22.06.2026',
    sections: [
      {
        title: 'Smarter junior game slots',
        items: [
          'Junior (U-) teams can now choose Friday-evening slots as their 1st and 2nd home-game options once Saturdays and the Tuesday Döltschi slots are used up — previously Fridays were only ever a 3rd choice.',
          'Sundays now work the same way, and the U-teams are steered to play together: once one U-team takes a Sunday, that Sunday becomes a strong option for the others.',
          'New "Show cross-team conflicts" toggle on the planning calendar — pick a team and the calendar marks the days another team that shares its players already plays, i.e. the days that block a home game.',
        ],
      },
    ],
  },
  {
    version: '1.4.0',
    date: '22.06.2026',
    sections: [
      {
        title: 'Smoother game planning',
        items: [
          'Adding a manual game now picks up the calendar filters you already set — the sport, team and home/away carry straight into the dialog.',
          'A new sport picker in the dialog narrows the team list to volleyball or basketball.',
          'The "KWI A + B" double-hall booking is now available for every team, not just basketball — and it warns you if either half is already taken.',
          'The "Show absences" toggle works again: calendar days show a badge with how many players are unavailable for games that day. Hover or tap it to see who.',
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    date: '22.06.2026',
    sections: [
      {
        title: 'Game planning, one tap away',
        items: [
          'The game-planning tools are now a single "Planning" entry in the menu — the separate "Manual game calendar" and "Match scheduling" tabs are gone.',
          'Installed Wiedisync to your home screen? Opening Planning now launches it in your browser instead of getting stuck inside the app window.',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    date: '20.06.2026',
    sections: [
      {
        title: 'League standings by season',
        items: [
          'Rankings now have a season picker — see the current tables, look back at last season\'s final standings, and browse the archive.',
          'Earlier seasons are kept instead of being overwritten when a new season starts, so the history stays put. Last season (2024/25) has been added back in.',
          'For a season Swiss Volley hasn\'t published yet, the rankings show a short "Data to be shared later by Swiss Volley" note instead of an empty table.',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    date: '19.06.2026',
    sections: [
      {
        title: 'Loading & polish',
        items: [
          'Pages now wait for all their data before showing — no more tables and cards popping in a moment after the screen appears.',
          'A refreshed loading screen with the spinning club logo, a gold progress bar with a percentage, and a few playful messages while you wait.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '19.06.2026',
    sections: [
      {
        title: 'Teams & rosters',
        items: [
          'Team cards with photos, club colours and per-team guest levels; manage positions, captain, coaches and team responsibles.',
          'Coaches have their own section on the team page, separate from the players.',
          'Export a roster as CSV, PNG or PDF with an activity header and a position summary.',
          'Join or leave a team straight from the Teams page, and invite external players with a QR code.',
        ],
      },
      {
        title: 'Trainings, games & RSVP',
        items: [
          'RSVP Yes / Maybe / No in real time, add a note, count guests and pick recurring trainings.',
          'Auto sign-in (opt-out attendance): you\'re confirmed automatically for new trainings, games or events — you only act when you can\'t make it, and absences always win. Set it per team, override it per activity, or switch it on for yourself.',
          'Coaches can edit participation inline and log an absence on a player\'s behalf, always shown with who changed it and when.',
          'Cancel a training, event or game from the calendar — the team is notified, RSVPs freeze and a cancelled training frees its hall slot.',
        ],
      },
      {
        title: 'Calendar & Hallenplan',
        items: [
          'Monthly calendar with home / away colours, clickable absence bars, game-Saturdays in gold and hall closures highlighted.',
          'Hall slots that coaches can claim; editing a slot cascades to every future session while keeping RSVPs and notes, and open-ended slots keep a rolling calendar.',
        ],
      },
      {
        title: 'Absences & availability',
        items: [
          'Track absences and weekly unavailabilities; a weekly unavailability overrides an existing "confirmed".',
          'Mark an absence non-blocking so the player shows as away for their own games, but the date stays open for scheduling the rest of the team.',
          'A team absence calendar with multi-team select.',
        ],
      },
      {
        title: 'Games & scoreboard',
        items: [
          'Upcoming games and results with set scores, total or per-game standings, and an embeddable scoreboard.',
          'Daily automatic sync with Swiss Volley and Basketplan keeps scores and standings fresh.',
        ],
      },
      {
        title: 'Game scheduling (Spielplanung)',
        items: [
          'Plan a whole season against opponents: send a club a tokenized invite, they propose home and away slots, and you confirm — with the tool enforcing availability, absences, hall closures, game spacing and intra-club derby rules automatically.',
          'Confirmed home games push straight into VolleyManager, and confirmed games appear on the app calendars right away.',
          'An in-app mailbox brings opponent email replies into the dashboard; leave remarks both ways, see per-team availability, export to Excel / PDF and search across all teams.',
          'Scheduling lives on its own address (spielplanung.wiedisync.kscw.ch) with single sign-on.',
        ],
      },
      {
        title: 'Scorer duty',
        items: [
          'Sign up for scorer duty with delegation, and an auto-assignment planner that builds a fair duty plan for both volleyball and basketball home games.',
        ],
      },
      {
        title: 'Messaging',
        items: [
          'Team conversations, direct messages, polls, reactions and reports, with a personal inbox for your message notifications.',
        ],
      },
      {
        title: 'Forms',
        items: [
          'Build custom forms (short / long text, single or multiple choice, number, date, yes/no, file upload) for the whole club or specific teams.',
          'See responses in a table and export to Excel, CSV, JSON or PDF; remind non-responders; let members edit their answer; or make a form public with its own shareable link.',
        ],
      },
      {
        title: 'Fines',
        items: [
          'Issue fines with per-team escalation tiers (late sign-in, no-show, late payment or custom), see your outstanding fines on your profile, and waive one with a reason.',
        ],
      },
      {
        title: 'Finance',
        items: [
          'Board finance dashboard with income statement, balance sheet and an accounts drill-down, mirrored from ClubDesk.',
          'Pay your dues from the app by scanning a per-invoice Swiss QR code with TWINT or any banking app.',
          'Submit an expense for reimbursement: upload the receipt, let it read the amount, date and vendor automatically, and confirm your IBAN.',
        ],
      },
      {
        title: 'News, broadcasts & notifications',
        items: [
          'Club-wide announcements on the home news card, and targeted broadcasts by email and push with spam protection.',
          'In-app and web-push notifications for new activities, RSVP changes and broadcasts.',
        ],
      },
      {
        title: 'Admin & data tools',
        items: [
          'A Data Explorer to browse teams, members, events and games with instant fuzzy search and member filters.',
          'A superuser SQL workspace, a public status page with live sync heartbeats, and an audit log of who did what.',
        ],
      },
      {
        title: 'Accounts, languages & platform',
        items: [
          'Log in with email and password; seven clear roles, each with their own view; privacy settings and GDPR account deletion.',
          'Five languages (German, English, French, Italian, Swiss German), dark mode, Swiss dd.mm.yyyy dates throughout, install-to-home-screen (PWA) and step-by-step guided tours.',
          'Your Swiss Volley licence card on your profile, kept live from Volleymanager.',
        ],
      },
    ],
  },
]

export { APP_VERSION }

export default function ChangelogPage() {
  const { t } = useTranslation('nav')
  const { t: tSupport } = useTranslation('support')
  const donateVisible = useDonateVisible()

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

      {/* Someone who just read what shipped is the warmest moment to ask —
          and the only other place this is offered is the options menu. */}
      {donateVisible && (
        <Link
          to="/support"
          className="mt-8 flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-3 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <Coffee className="h-4 w-4" />
          {tSupport('menuLabel')}
        </Link>
      )}
    </div>
  )
}
