// The written in-app guide — section CONTENT only. Metadata (icons, groups,
// audience, routes) lives in src/modules/guide/sections.ts; GuidePage loads
// this file lazily into the `guide` namespace. Generated from the 2026-09-15
// rewrite; edit by hand from here on (sentence case, **bold** = a UI label).
export default {
  "sections": {
    "welcome": {
      "title": "Welcome to Wiedisync",
      "summary": "What the app is for, who uses it, how the roles differ and how this guide is organised.",
      "body": [
        {
          "t": "p",
          "text": "Wiedisync is the KSC Wiedikon member app. It is the one place for your games, trainings and events, your attendance, your scorer duties, club finances and your personal profile — on your phone or in any browser."
        },
        {
          "t": "note",
          "text": "Free — and the club's official tool. Built and run by the club as a free replacement for paid team-management apps; you need it for your absences, game management and above all your scorer duties."
        },
        {
          "t": "h",
          "text": "Who uses it"
        },
        {
          "t": "p",
          "text": "Everyone uses the same app; what you see depends on your role. Roles show as badges next to names, such as **Player**, **Coach**, **Team resp.** or **Board**."
        },
        {
          "t": "ul",
          "items": [
            "Players: your activities, saying whether you are coming, absences, scorer duties, bills and your profile.",
            "Parents: one login for the whole family; a bar at the top shows whose account you are using and lets you switch (see the section Households and family accounts).",
            "Coaches and team responsibles: run the team — roster, trainings, events, games, forms, polls, fines and team finance. The group **Teams & coaching** is written for you.",
            "Captains: carry the **Captain** badge on the roster and can settle team bills under **Finances → Team finance**.",
            "Spielplaner: schedule the club's home games from the **Planning** entry in the menu (see the section Spielplanung).",
            "Board and finance: club finances — dues, invoices, payments and the books (see the section Club finances).",
            "Admins: registrations, halls, scorer assignment, club communication and the member database. **VB admin** and **BB admin** cover one sport each; **Superadmin** tools are for those who run the app. Admin powers only apply while **Admin mode** is on in **Options**."
          ]
        },
        {
          "t": "h",
          "text": "How this guide is organised"
        },
        {
          "t": "p",
          "text": "The guide follows what you do: **Basics** (installing, signing in, navigation, home, notifications), **Everyday** (calendar, activities, absences, scorer duty, teams, profile), **Money** (bills, expenses, fines), **Teams & coaching** and **Admin & scheduling**. You only see the sections your role can use."
        },
        {
          "t": "tip",
          "text": "Open the guide from **More → Options → Guide** on your phone or the graduation-cap icon next to **Options** on desktop; the ? button next to a page title opens that page's section."
        },
        {
          "t": "h",
          "text": "Where to get help"
        },
        {
          "t": "p",
          "text": "Something unclear or broken? **Options → Feedback** sends a bug report, a feature idea or general feedback, with screenshots (see the section Feedback, status and what's new). Your coach or the club admins help with team and membership questions."
        },
        {
          "t": "h",
          "text": "Wiedisync and kscw.ch"
        },
        {
          "t": "p",
          "text": "kscw.ch is the club's public website: it shows each team with its roster and is where new members sign up. Wiedisync is the members-only app behind it. They share the same data, so what visitors see about you — surname, year of birth, photo — follows the privacy settings on your profile (see the section Your profile)."
        }
      ]
    },
    "install": {
      "title": "Install the app",
      "summary": "Put Wiedisync on your phone's home screen and turn on push notifications, device by device.",
      "body": [
        {
          "t": "p",
          "text": "Wiedisync is a web app: nothing to download from an app store. On a phone you can add it to your home screen so it opens full screen like a normal app. The Home page shows the banner **Add Wiedisync to your home screen** until you install it. **Show me how** opens the steps for your device, **Remind me later** hides the banner until you next open the browser, and **I understood** hides it for good in this browser. The steps are also in the guide (**More → Options → Guide** on a phone, the **Guide** icon in the top bar on a computer) under **Install the app on your phone**."
        },
        {
          "t": "h",
          "text": "Android"
        },
        {
          "t": "ol",
          "items": [
            "Tap **Show me how** on the banner, or open the guide card. If your browser offers a direct install, tap **Install** and confirm.",
            "Otherwise open the browser menu (⋮ in the top-right).",
            "Tap **Install app** or **Add to Home screen**.",
            "Confirm by tapping **Install**."
          ]
        },
        {
          "t": "h",
          "text": "iPhone and iPad"
        },
        {
          "t": "ol",
          "items": [
            "Open the page in Safari. Other browsers on iOS cannot add to the home screen; the app shows a notice if you try.",
            "Tap the Share button at the bottom of Safari.",
            "Scroll down and tap **Add to Home Screen**.",
            "Tap **Add** in the top-right corner."
          ]
        },
        {
          "t": "p",
          "text": "Once installed, opening the steps again shows **Wiedisync is already installed on this device.** In the installed app, **Planning** opens in your normal browser. On a computer nothing needs installing; Chrome offers the same **Install** button in the guide card if you want a separate window."
        },
        {
          "t": "h",
          "text": "Push notifications"
        },
        {
          "t": "p",
          "text": "Push is switched on per device, so repeat this on every phone or computer you use. Open the bell (desktop) or **More → Notifications** (phone) and scroll to the bottom of the panel. Next to **Push notifications**, tap **Enable**; your browser asks for permission once. **Disable** in the same place switches it off again."
        },
        {
          "t": "p",
          "text": "Push covers what needs a quick reaction: games you are called up for, cancelled trainings, reminders for tomorrow's activities and RSVP deadlines, missed deadlines, club news, event invitations, new forms, fines, expense status updates, licence status changes, scorer duty delegations, absences someone entered for you, and messages a coach or team responsible sends with **Contact** when they tick push. Tapping a push notification opens the matching page. Other changes, such as a moved game, show in the bell only."
        },
        {
          "t": "note",
          "text": "If you tapped Block in the browser's permission prompt, the panel shows **Push notifications are blocked in your browser settings.** and the app cannot ask again. Allow notifications for the site in your browser or phone settings, then tap **Enable**."
        },
        {
          "t": "tip",
          "text": "No **Push notifications** row means your browser does not support push. Brave on Android blocks push, so the row is hidden there; use Chrome or Firefox."
        }
      ]
    },
    "account": {
      "title": "Your account",
      "summary": "Signing in, activating an invited account, passwords, approval, language, dark mode and deleting your account.",
      "body": [
        {
          "t": "p",
          "text": "Press **Sign in** and enter your **Email** and **Password**. There is no sign-in with Google or Apple. A shared link opened while signed out reopens after you sign in."
        },
        {
          "t": "h",
          "text": "Getting an account"
        },
        {
          "t": "p",
          "text": "Registration is invite-only; membership itself is arranged on kscw.ch. Your coach or team responsible then sends you a Wiedisync invite link by email, or shows it to you as a QR code in person. Open it, pick your **Language**, choose and confirm a password and press **Activate account**. You are then signed in."
        },
        {
          "t": "ul",
          "items": [
            "A link works once and expires after 30 days; an old one shows **Invite not valid** or **Invite already used**. Ask your coach for a new one.",
            "No invite? Press **Sign up**, enter the email the club has on file and press **Continue**. A member without a login receives an 8-digit code by email, then completes name, teams and password.",
            "An unknown email shows **Registration is invite-only**; press **Try a different email** or follow the link to kscw.ch.",
            "If you requested a team you are not yet on, you see **Pending approval** until its coach, team responsible or an admin approves you; press **Refresh status** once they have."
          ]
        },
        {
          "t": "note",
          "text": "Passwords need at least 8 characters with one letter and one number or special character. Very common passwords are refused."
        },
        {
          "t": "h",
          "text": "Forgot your password"
        },
        {
          "t": "ol",
          "items": [
            "On the sign-in page press **Forgot password?**.",
            "Enter your email and press **Send reset link**. The link is valid for one hour and opens the **New password** form; press **Save password**.",
            "Never had a password? Press **Never set a password yet? Use a code instead** and enter the 8-digit code you receive by email."
          ]
        },
        {
          "t": "note",
          "text": "A reset by email or code deletes your identity-document key; you would have to upload the document again. If you know your password, use **Change password** on **Edit profile** instead, which keeps the key (see the section Your profile)."
        },
        {
          "t": "h",
          "text": "Language and dark mode"
        },
        {
          "t": "p",
          "text": "Both sit in **Options** (gear icon top right on desktop; **More → Options** on a phone). **Dark mode** is remembered per device; the app starts dark. **Language** (Deutsch, English, Français, Italiano, CH-DE) follows your browser until you pick one while signed in, which saves it to your profile for all your devices. The rest of that menu is described in the section Finding your way around."
        },
        {
          "t": "h",
          "text": "Logging out and deleting your account"
        },
        {
          "t": "p",
          "text": "**Logout** sits in the avatar menu on desktop and next to your name in **More** on a phone; it also removes your identity-document key from that device. To delete your account, open **My profile**, scroll to **Danger zone**, press **Delete account**, type your email address exactly and press **Permanently delete account**. This cannot be undone. A parent acting for a child cannot do this from the child's account."
        }
      ]
    },
    "navigation": {
      "title": "Finding your way around",
      "summary": "Where every page lives on desktop and phone, and what the Options menu, sport toggle and ? buttons do.",
      "body": [
        {
          "t": "p",
          "text": "On a computer the pages sit in dropdowns in the top bar. On a phone the most-used pages are bottom tabs and the rest sits behind **More**. Pages you cannot use are not listed."
        },
        {
          "t": "h",
          "text": "On a computer: the top bar"
        },
        {
          "t": "ul",
          "items": [
            "**Home** (also via the logo).",
            "**Activities** → **Calendar**, **Games & results**, **Live scoreboard**, **Trainings**, **Events**.",
            "**Member tools** → **Team** (**Teams** when you are on several or in admin mode), **Absences**, **Scorer duty**, **News**, plus **Forms** and **J+S export** if you coach or lead a team.",
            "**Finances** → **Member finance**, **Team finance** and **Club finance**, by role.",
            "**Planning** (Spielplaner, coaches and team responsibles) opens the scheduling app; **Admin** (admins only) ends with **All admin tools**.",
            "Right-hand icons: bell (notifications), graduation cap (**Guide**), gear (**Options**), avatar (**My profile**, **Logout**)."
          ]
        },
        {
          "t": "h",
          "text": "On a phone: bottom tabs and More"
        },
        {
          "t": "p",
          "text": "The bottom bar shows **Home**, **Calendar**, **Games**, **Trainings** and **More**. **More** holds **Notifications**, **Events**, **Member tools**, **Finances**, **Planning**, **Admin**, your profile row, **Logout**, the **Options** section and the **Privacy** and **Imprint** links. A red dot on **More** means unread notifications; the **Notifications** row shows how many."
        },
        {
          "t": "h",
          "text": "The Options menu"
        },
        {
          "t": "ul",
          "items": [
            "**Dark mode** – dark is the default; remembered on this device.",
            "**Language** – Deutsch, English, Français, Italiano or CH-DE. Signed in, it is saved to your profile and follows you to other devices.",
            "**Admin mode** – admins and board members only, see below.",
            "**Feedback**, **Status** and **What's new** (with the current version). On the phone, **Guide** is here too."
          ]
        },
        {
          "t": "h",
          "text": "Sport toggle and ? buttons"
        },
        {
          "t": "p",
          "text": "If your teams span both volleyball and basketball, a sport toggle appears on **Home** (the ball icons beside the logo; the logo shows all sports) and on **Games & results** (Volleyball, Basketball, **All sports**, also in admin mode). Members of one sport see that sport and no toggle. The choice is remembered per member on this device."
        },
        {
          "t": "p",
          "text": "Next to the title of many pages a small **?** button opens this guide at the section for that page. The whole guide is under **Options → Guide** on the phone and behind the graduation-cap icon on a computer."
        },
        {
          "t": "h",
          "text": "If you are an admin or board member"
        },
        {
          "t": "p",
          "text": "**Admin mode** in **Options** widens what you see, not which pages are listed. While it is on, a gold **Admin mode** banner sits above every page except the scheduling app, lists show every team of the club and admin powers on team pages are active. Off, you see your own teams like any member. It is off by default and remembered per device; pages under **Admin** open in either mode. Board members without an admin role find the switch only on the phone, under **More → Options**; it gives them the same club-wide view, read-only."
        }
      ]
    },
    "home": {
      "title": "Home",
      "summary": "What each block on the home page shows and what you can do from it.",
      "body": [
        {
          "t": "p",
          "text": "**Home** is the first page after you sign in: top bar (desktop) or bottom tabs (phone). Cards appear only when they have content. If you play both volleyball and basketball, a sport toggle at the top filters games, results and trainings; the Games page follows it."
        },
        {
          "t": "h",
          "text": "The main blocks"
        },
        {
          "t": "ul",
          "items": [
            "**Next 7 days**: a strip of your teams' games, trainings, events, hall closures, your scoring duties and teammates' birthdays.",
            "**News**: the three latest items, pinned announcements first. Tapping a notification marks it read and opens the activity. An open invoice gets its own row above the news. **Show all** opens the News page.",
            "**Active polls**: vote on your teams' open polls.",
            "**Forms to fill**: forms waiting for you, with a **Closes** deadline. **Fill in** opens the form, **Edit** changes your answers.",
            "**Your dues** and **Open fines**: only while something is open; **View all** opens the full list.",
            "**Rankings** (desktop only): league tables for your teams' leagues, with a season dropdown; a row opens the rankings on the Games page. Until Swiss Volley publishes data it says **Data to be shared later by Swiss Volley**."
          ]
        },
        {
          "t": "h",
          "text": "My appointments or By category"
        },
        {
          "t": "p",
          "text": "**My appointments** is one date-sorted list of your games, trainings, events and scoring duties: 10 rows, **Show more** adds 10. **By category** splits them into **Next trainings**, **Events**, **Latest results** and **Next games**; the **My teams** chip switches results and games between your teams and the whole club. Tap a row to open and answer. The strip on the left is your RSVP: green yes, yellow maybe, red no, orange waitlisted, grey absent."
        },
        {
          "t": "note",
          "text": "Scoring duties always appear in your appointments and cannot be declined here; hand one over on the Scorer duty page (see the section Scorer duty)."
        },
        {
          "t": "h",
          "text": "Cards that need your attention"
        },
        {
          "t": "ul",
          "items": [
            "**Duty request** (above **News**): someone wants to hand you a scoring duty. **Accept** or **Decline**.",
            "**You are on … duty** (your role, such as Scorer): shown from 7 days before the game until 3 hours after the start; from 60 minutes before to 30 minutes after the start, **Emergency: Contact team leaders** reveals the playing team's coach and team responsible and alerts the club.",
            "**Add your IBAN** / **Confirm your IBAN**: shown until the club has an IBAN you have confirmed. **Add IBAN** or **Confirm in Finance** opens **Bills & reimbursements**; **Not now** hides the card on this device only."
          ]
        },
        {
          "t": "h",
          "text": "If you are a coach or team responsible"
        },
        {
          "t": "p",
          "text": "**Referee expenses not recorded** lists your teams' volleyball home games of the last 14 days with no record of who paid the referees. **Record now** opens the game's **Referee expenses** section; **Not now** hides that game on this device. Gone once recorded (see the section Team finance)."
        }
      ]
    },
    "notifications": {
      "title": "Notifications and news",
      "summary": "The bell, what each notification means, push versus email, the News feed, and how to switch emails off.",
      "body": [
        {
          "t": "p",
          "text": "The bell in the desktop top bar shows a red unread count; on a phone open **More** → **Notifications** (a red dot on **More** means something is unread). The panel lists your 30 most recent notifications and updates live. Tap one to mark it read and open the related page. Use **Mark all read**, **Clear read** (deletes the read ones) or the bin icon on a row."
        },
        {
          "t": "h",
          "text": "What the notifications mean"
        },
        {
          "t": "ul",
          "items": [
            "**Activity** — a game, training or event was created, moved, cancelled or put back on, or you were called up.",
            "**Upcoming** — a reminder the day before an activity. **Deadline** — a reminder the day before its RSVP deadline if you have not answered yet.",
            "**Deadline missed** — you did not answer in time and were marked as not coming, fined where your team's rules say so (see the section Fines).",
            "**Result** — a result was entered for your game.",
            "**Scorer duty** — a duty was offered to you, or your request was answered.",
            "**Expense** — your expense was paid or rejected. **Fine** — a fine for you or your team was issued, paid or waived.",
            "**Club news** opens News, **Event invitation** the event, **Licence** your profile. Forms open Forms; a **Join request** (coaches and team responsibles) opens the team page."
          ]
        },
        {
          "t": "note",
          "text": "Notifications are cleared automatically: those about a game, training or event the day after it took place, everything else after 30 days."
        },
        {
          "t": "h",
          "text": "Push versus email"
        },
        {
          "t": "p",
          "text": "Every notification appears in the bell; most are also pushed. Push is per device: in the panel, use **Push notifications** → **Enable** on each device (see the section Install the app). Only a few also arrive by email: club news and event invitations when the sender chose to email them, expense decisions, join requests (coaches and team responsibles) and new registrations (admins)."
        },
        {
          "t": "h",
          "text": "The News feed"
        },
        {
          "t": "p",
          "text": "Go to **Member tools** → **News** (on a phone **More** → **Member tools** → **News**). Pinned club news comes first, then club news and your notifications, newest first; **Load more** adds another 20. You only see posts aimed at you (all members, your sport, your teams or your roles); expired posts drop out."
        },
        {
          "t": "h",
          "text": "Email notification preferences"
        },
        {
          "t": "p",
          "text": "Open **My profile** and find **Email notifications**. Everyone has **Club news** and **Event invitations**; coaches and team responsibles also get **Team join requests** and **Form submissions**; admins get **New registrations**. All are on by default. Turning one off silences that email only — the bell still shows it. Forms send no email: **Form submissions** silences the push for public-form answers instead."
        },
        {
          "t": "tip",
          "text": "To unsubscribe from club emails, switch off **Club news** — this also covers group emails from the club mailbox. Password resets, invites, expense mails and a coach's **Contact** messages are always delivered."
        }
      ]
    },
    "calendar": {
      "title": "Calendar",
      "summary": "Your teams' games, trainings, events, duties and birthdays in one view, with filters and calendar export.",
      "body": [
        {
          "t": "p",
          "text": "The calendar gathers your teams' games, trainings, events, hall closures, absences, your scoring duties and birthdays. Open it via **Activities → Calendar** (desktop) or the **Calendar** tab (phone). Tap an entry for details; trainings and events take **Yes**, **Maybe** or **No** right there, and your own absence offers **Edit**. The toggle at the top switches views:"
        },
        {
          "t": "ul",
          "items": [
            "**Hall**: the weekly hall occupancy plan. Coaches and team responsibles claim free hall time here (see the section Hall plan and free hall time).",
            "**Calendar**: the month grid; on a phone a day list you tap to expand. Move with the arrows or **Today**. **Filter**, **Subscribe** and **Export iCal** appear in this view only (icons on a phone).",
            "**Schedule**: proposed and confirmed fixtures per team, shown only when one of your teams has a fixture schedule."
          ]
        },
        {
          "t": "h",
          "text": "Filter"
        },
        {
          "t": "p",
          "text": "**Filter** lists the **Categories**: **Games** (**Home games**, **Away games**, **My duties**), **Activities** (**Trainings**, **Events**), **Venue** (**Halle HW**, **Closures**) and **Other** (**Absences**, **Birthdays**). All are on by default. The **Team** picker offers your own teams only; admins and board members with admin mode on can pick any team and start with all teams. Weekly unavailabilities and non-blocking absences stay hidden unless you switch on **Show unavailabilities & non-blocking absences**; several absences on one day collapse into a **2 absent** chip. **My duties** always shows your own duties, whatever team is selected."
        },
        {
          "t": "h",
          "text": "What the colours mean"
        },
        {
          "t": "ul",
          "items": [
            "Dark blue: home games. Yellow: away games. Indigo: your scoring duties.",
            "Green: trainings. Purple: events. Cyan: hall bookings. Pink: birthdays. Black: absences.",
            "Red: hall closures; the whole day is tinted.",
            "Struck through: cancelled; a training dropped for a game day shows **Cancelled — game day** in its details."
          ]
        },
        {
          "t": "h",
          "text": "Birthdays"
        },
        {
          "t": "p",
          "text": "Birthdays are team-scoped: you see members of the selected teams only, never the whole club. A member appears only if they chose **Show full date** under **Birthdate visibility** in their profile; **Year only** and **Hide** keep them off. Tap a birthday to see **Turns** and the new age. A 29 February birthday shows on 28 February in non-leap years."
        },
        {
          "t": "h",
          "text": "Subscribe or export"
        },
        {
          "t": "ol",
          "items": [
            "Press **Subscribe**, tick **Trainings**, **Games** and/or **Events** and optionally set **Filter by team** (empty = all teams).",
            "Press **Generate subscription link**; the link is copied. **Copy** repeats that, or use **Or open directly in your calendar app**.",
            "Paste it into your calendar app (Google Calendar: Other calendars → From URL; Apple Calendar: File → New Calendar Subscription). It updates by itself and always includes your scoring duties.",
            "**Export iCal** instead downloads what is on screen as a file; it is greyed out while the view is empty."
          ]
        },
        {
          "t": "note",
          "text": "The subscription link is personal (it carries a token that adds your duties): keep it private. An exported file is a snapshot and never updates."
        }
      ]
    },
    "games": {
      "title": "Games & results",
      "summary": "Fixtures, results, rankings and the live scoreboard, and how to say whether you are playing.",
      "body": [
        {
          "t": "p",
          "text": "Open **Activities → Games & results** on desktop or the **Games** tab on your phone. Anyone can browse; answering needs a login. If you play both sports, switch with **Volleyball** / **Basketball** / **All sports**; the team chips filter by team."
        },
        {
          "t": "h",
          "text": "The tabs"
        },
        {
          "t": "ul",
          "items": [
            "**Upcoming**: your next games as cards, split into **League** and **Cup**, with **Meeting time** and answer bars (green yes, yellow maybe, red no).",
            "**Results**: finished games with set scores. Results and rankings arrive from the federations each morning.",
            "**Rankings**: pick a **Season**, tap a row to see that team's games and, for volleyball, tap the **W** or **L** cell for the 3:0/3:1 versus 3:2 breakdown. Until a season is published you see **Data to be shared later by Swiss Volley**.",
            "**Scoreboard**: club-wide team stats, **Absolute** or **Per game**."
          ]
        },
        {
          "t": "h",
          "text": "Saying whether you play"
        },
        {
          "t": "p",
          "text": "On a card, tap **Yes**, **Maybe** or **No** and optionally **Add a note…**; in the game detail the same buttons sit under **Attending?**."
        },
        {
          "t": "ul",
          "items": [
            "Your coach may set a **Respond by** deadline; if you have not answered, you get a reminder the day before the deadline. After it your answer is locked (**Deadline passed**). With a late sign-in fine rule, non-responders are marked as not coming and fined (see the section Fines).",
            "A recorded absence declines you automatically (**Absent**, or **Unavailable** for a weekly unavailability). Tapping an answer overrides it.",
            "Guest players cannot answer for their guest team's games. If a coach calls you up, you are notified, the game appears on Home and in your calendar, and you can answer.",
            "With **Auto sign-in** for games in your profile, new and unanswered games start as **Yes**; some teams pre-confirm all full members (**Auto-confirm games**)."
          ]
        },
        {
          "t": "tip",
          "text": "**View roster** lists who has answered; cards show **Coach present** once a coach confirmed and warn **WARNING: Incomplete team** below the minimum."
        },
        {
          "t": "h",
          "text": "Game detail, sharing and live scores"
        },
        {
          "t": "p",
          "text": "Tap a card to open the game: **Game info**, **Venue** with a map link, **Referees**, set scores once played, and **Scorer(s)** or **Officials** naming who is on duty (see the section Scorer duty). **Share link** copies a link or opens your phone's share sheet; recipients must sign in and see **This link is no longer available to you** if they may not view the game."
        },
        {
          "t": "p",
          "text": "During a match scored in the hall, a red **Watching live** banner tops the Games page; tap **Watch** to follow it point by point (on desktop also under **Activities → Live scoreboard**). No login needed."
        },
        {
          "t": "h",
          "text": "If you are a coach or team responsible"
        },
        {
          "t": "p",
          "text": "You also get the **Coach dashboard** tab and can edit answers, call up players, set deadline and meeting time, cancel a game, contact the team and record **Referee expenses** on volleyball home games — see the section Managing trainings, games and events."
        }
      ]
    },
    "trainings": {
      "title": "Trainings",
      "summary": "Your team's trainings: answering Yes, Maybe or No, deadlines, and what the app changes on its own.",
      "body": [
        {
          "t": "p",
          "text": "Open **Activities → Trainings** on desktop or the **Trainings** tab on your phone. Each card shows date, time, hall, coach and notes, plus badges: **Probetraining** (open to newcomers), **Shortened** (a home game follows in the same hall) and **Cancelled**. The team filter switches teams; **Show older trainings** reveals past dates."
        },
        {
          "t": "h",
          "text": "Answering"
        },
        {
          "t": "ul",
          "items": [
            "Tap **Yes**, **Maybe** or **No**. A note field appears once you have answered; Enter or the tick saves it.",
            "**Respond by** shows the deadline. Afterwards you see **Deadline passed** in red and your answer is locked.",
            "Some trainings require a reason for **Maybe** or **No**: opened from Home or a shared link, the training will not save your answer without one (**Please provide a reason**).",
            "Excluded guest tiers see **Your guest tier is excluded from this training** instead of buttons.",
            "The people icon opens **Participation**: who answered what."
          ]
        },
        {
          "t": "h",
          "text": "What happens on its own"
        },
        {
          "t": "ul",
          "items": [
            "**Auto sign-in**: tap your avatar → **My profile** (phone: **More** → your name) and switch on **Auto sign-in** for **Trainings**. New and unanswered trainings then start as **Yes**; answers you already gave are never changed.",
            "An absence declines you automatically; the card shows **Absent** (or **Unavailable** for a weekly unavailability). Tapping an answer overrides it. See the section Absences.",
            "You are reminded the day before the deadline if you have not answered, and again the day before the training.",
            "With a late sign-in fine rule on your team, missing the deadline marks you as not coming and may cost a fine. See the section Fines.",
            "With **Auto-decline \"Maybe\"** on for your team, **Maybe** becomes **No** after the deadline."
          ]
        },
        {
          "t": "h",
          "text": "Cancellations and games"
        },
        {
          "t": "ul",
          "items": [
            "A cancelled training stays listed, dimmed, with the reason in red; the team is notified.",
            "With **Auto-cancel** set, a training is cancelled once the deadline passes with fewer confirmed players than the minimum.",
            "On a day your team has a game, home or away, its training is cancelled automatically (**Cancelled — game day** in the calendar).",
            "If another team has a home game in your hall afterwards (from 45 minutes before the start), your training ends earlier (**Ends earlier — home game in this hall afterwards**) or is cancelled when the game covers it entirely.",
            "If you play in two teams and one has a game, you are set to **No** for the other team's training that day (note `Game <team>`); an answer you gave yourself is never overwritten.",
            "When the game moves or is cancelled, the training and automatic declines are restored."
          ]
        },
        {
          "t": "note",
          "text": "Game-day cancellations more than 14 days ahead happen silently; check the calendar before a game week."
        },
        {
          "t": "h",
          "text": "If you are a coach or team responsible"
        },
        {
          "t": "p",
          "text": "Creating, editing and cancelling trainings and the **Coach dashboard** attendance table are covered in the section Managing trainings, games and events."
        }
      ]
    },
    "events": {
      "title": "Events",
      "summary": "Club and team events: who is invited, answering per day, deadlines, guest players and people without an account.",
      "body": [
        {
          "t": "p",
          "text": "Events are everything that is not a game or a training: tournaments, social evenings, meetings, training weekends. Open **Activities → Events** on desktop or **More → Events** on your phone. **Past events** shows earlier ones; a team picker appears if you are in several teams."
        },
        {
          "t": "h",
          "text": "Who sees an event"
        },
        {
          "t": "ul",
          "items": [
            "Club-wide events have no team, role or named person attached and are visible to every member.",
            "Team events show the invited teams as chips; their players and staff see them.",
            "A **Targeted event** badge means specific roles or named people were invited.",
            "Your own scoring duties appear as amber **On duty** cards (see the section Scorer duty)."
          ]
        },
        {
          "t": "h",
          "text": "Answering"
        },
        {
          "t": "p",
          "text": "Tap **Yes**, **Maybe** or **No** on the card or in the event detail. The coloured strip on the left is your answer, the bars count replies, and the people icon (**View roster**) shows who answered. **Maybe** may be switched off for an event. After answering you can leave a comment under **Add a note…**; for some events a reason is required when you decline or answer **Maybe**."
        },
        {
          "t": "ul",
          "items": [
            "**Respond by** shows the deadline. Once it passes your answer is locked and **Deadline passed** appears in red.",
            "An absence covering the event declines you automatically and shows **Absent**; tap an answer to override it.",
            "**Auto sign-in** → **Events** under **My profile** makes new events start as confirmed for you.",
            "For team events you get a reminder notification the day before the event.",
            "Some events ask for three **Position preferences** in the event detail when you confirm; all three are required."
          ]
        },
        {
          "t": "h",
          "text": "Events over several days"
        },
        {
          "t": "p",
          "text": "For a multi-day event, **Yes**, **Maybe** or **No** on the card answers every day at once. **Per day** on the card, or **Participation per time slot** in the event detail, lets you tick or cross each day on its own. Mixed answers show as a count such as 2/3 confirmed."
        },
        {
          "t": "h",
          "text": "Guest players and people without an account"
        },
        {
          "t": "ul",
          "items": [
            "If only the core roster was invited, guest players (G1–G3) see the event but cannot answer; the card says **Guest players are not invited to this event**. A personal invitation overrides this.",
            "If the event has a form for outsiders, the event detail shows **Signup link for guests** (**Copy** / **Open**). Those signups are not on the roster; admins see them under **All signups**.",
            "If you open a public signup link while signed in, press **Open the event** and answer in the app, so you count on the roster."
          ]
        },
        {
          "t": "h",
          "text": "If you are a coach or team responsible"
        },
        {
          "t": "p",
          "text": "Creating, editing and cancelling events and the public signup link: see the section Managing trainings, games and events. In the roster you can change your players' answers; in the event detail the **Guests** counter next to your own answer adds extra people you are bringing."
        }
      ]
    },
    "absences": {
      "title": "Absences",
      "summary": "Tell the club when you are away so activities and game scheduling take it into account.",
      "body": [
        {
          "t": "p",
          "text": "Open **Member tools → Absences** (desktop) or **More → Member tools → Absences** (phone). The page has two views, **Absences** and **Unavailabilities**, plus a **Mine** / **Team** switch when you belong to a team. **Team** shows your teammates' absences; for the coach tools there, see the section Team absences and blocks."
        },
        {
          "t": "h",
          "text": "Adding an absence"
        },
        {
          "t": "ol",
          "items": [
            "Tap **New absence**.",
            "Set **From** and **To**, or tick **Indefinite** if there is no end date yet.",
            "Choose a **Reason** (**Injury**, **Vacation**, **Work**, **Personal** or **Other**) and add **Details (optional)**.",
            "Under **Affects**, keep **All** or pick only **Trainings**, **Games** or **Events**.",
            "Leave **Blocks game scheduling** on unless you would not play anyway (see below), then **Save**."
          ]
        },
        {
          "t": "p",
          "text": "Use **Edit** and **Delete** on a row to change or remove it. Past absences sit behind **Show older absences**. To enter many at once, tap **Import**: **Download template**, fill in dates (dd.mm.yyyy), reason and what each absence affects, upload the file, check the **Preview** and confirm with **Import**. Imported absences block game scheduling."
        },
        {
          "t": "h",
          "text": "Weekly unavailability"
        },
        {
          "t": "p",
          "text": "For a recurring clash, switch to **Unavailabilities** and tap **New weekly**. Pick the **Days of week**, what it **Affects**, a **From** date, optionally a **To** date (it is **Indefinite** by default) and a **Note (optional)**. Weekly unavailabilities never influence game scheduling."
        },
        {
          "t": "h",
          "text": "What happens automatically"
        },
        {
          "t": "ul",
          "items": [
            "Your answer on every upcoming training, game or event the absence covers is set to declined, with your reason as the note, and the activity shows **Absent** (or **Unavailable** for a weekly). Past activities are not touched.",
            "You can still change your answer on a covered activity. A manual answer sticks even if the absence is edited or deleted later.",
            "If you delete an absence, the declines it created disappear and answers it overrode go back to confirmed.",
            "Activities covered by an absence count as excused in your attendance statistics.",
            "Your teammates, coach and team responsible can see your absences, including reason and details. On the calendar they appear under the **Absences** filter (see the section Calendar)."
          ]
        },
        {
          "t": "h",
          "text": "Absences and game scheduling"
        },
        {
          "t": "p",
          "text": "With **Blocks game scheduling** on, the Spielplaner sees your dates as unavailable when placing your team's games: dates with anyone away are avoided, and a date with three or more players away is never used. Only one-off absences that affect **Games** or **All** count; weekly unavailabilities and the absences of guest players do not. Turn it off for a long-term injury or maternity leave, or your team cannot be scheduled for months."
        },
        {
          "t": "note",
          "text": "If a coach, team responsible or admin adds or changes an absence for you, you receive a notification and the row shows who edited it and when. Any note they left is visible to you."
        }
      ]
    },
    "scorer": {
      "title": "Scorer duty",
      "summary": "Your scorer, scoreboard and referee duties at home games: signing up, delegating, reminders and emergencies.",
      "body": [
        {
          "t": "p",
          "text": "Every home game needs officials: a **Scorer**, a **Scoreboard** operator (or one combined **Scorer/Scoreboard**) and sometimes a **Referee**; in basketball **Scorer (OTR1)**, **Timekeeper (OTR1)** and **24\" official (OTR2)**. Open **Member tools → Scorer duty** (desktop) or **More → Member tools → Scorer duty** (phone)."
        },
        {
          "t": "h",
          "text": "What you see"
        },
        {
          "t": "ul",
          "items": [
            "**Games** lists upcoming home games where your team holds a duty or you are assigned.",
            "A game is **Confirmed** once every duty has a person; until then it is **Open**. Within a day, open games come first.",
            "**All** shows the games of your teams, **Selected** only those you are assigned to. **Filters** narrows by **Date**, **Playing team**, **Duty team**, **Duty type** or **Unassigned duty**; **Show older games** adds this season's past games.",
            "**Overview** counts duties and open spots **By duty team** or **By game**."
          ]
        },
        {
          "t": "h",
          "text": "Taking a duty"
        },
        {
          "t": "ol",
          "items": [
            "Tap **Sign me up** on an open duty of your team. It appears only if you hold the required licence: a scorer licence for a volleyball **Scorer**, OTR1 for basketball duties (OTR2 or OTN for **24\" official (OTR2)**); **Scorer/Scoreboard**, **Scoreboard** and **Referee** need none.",
            "Check role, game, date and arrival rule in **Confirm assignment**, then tap **Confirm**. An absence on that date shows a warning but does not stop you."
          ]
        },
        {
          "t": "note",
          "text": "A duty you take is final: you cannot drop it, only delegate it. Be in the hall 30 minutes early as scorer, scorer/scoreboard or referee, 15 minutes as scoreboard operator or for any basketball duty. Late arrival or a no-show costs a CHF 50.00 fine."
        },
        {
          "t": "h",
          "text": "Delegating a duty"
        },
        {
          "t": "p",
          "text": "Tap **Delegate** next to your name, pick a member from **Your team** or **Other members** and confirm with **Delegate**. Nothing changes until they tap **Accept** in the **Duty request** banner on their Scorer duty page; you see the request as pending and are notified of their answer. The recipient needs the duty's licence. Requests for games already played expire automatically."
        },
        {
          "t": "h",
          "text": "Reminders and emergencies"
        },
        {
          "t": "ul",
          "items": [
            "From one week before the game, the home page shows a yellow banner with your duty.",
            "From 60 minutes before the start, **Emergency: Contact team leaders** reveals the playing team's coach and team responsible and alerts the club.",
            "**Add to calendar** on a game card downloads the duty; a personal **Subscribe** link from the Calendar page always includes your duties (see the section Calendar).",
            "As the assigned scorer you can open **Roster** from 40 minutes before the game to see the home team's list."
          ]
        },
        {
          "t": "h",
          "text": "If you are an admin"
        },
        {
          "t": "p",
          "text": "As admin of the sport with admin mode on, you see every home game and set **Select team** and **Select person** on each duty until the game starts. Season planning happens under **Admin → Game operations → Scorer assignment** (see the section Assigning scorer duties)."
        }
      ]
    },
    "teams": {
      "title": "Teams",
      "summary": "Your team cards, the roster and player profiles, and how to join or leave a team.",
      "body": [
        {
          "t": "p",
          "text": "Open **Member tools → Team** on desktop (**Teams** once you are on more than one roster) or **More → Member tools → Teams** on a phone. The page **Teams & Members** shows the current season (**Season 2026/27**); seasons switch on 1 June."
        },
        {
          "t": "h",
          "text": "Team cards"
        },
        {
          "t": "ul",
          "items": [
            "One card per team you play on, coach or are responsible for, grouped by sport.",
            "A card shows league, season, player and guest counts, over the team photo.",
            "Tap a card to open the team."
          ]
        },
        {
          "t": "h",
          "text": "The team page"
        },
        {
          "t": "ul",
          "items": [
            "**Staff** lists the coaches and team responsibles.",
            "**Current roster** is a table with **#**, **Position** and **Role** (Coach, Captain, Team resp.). Tap a column header to sort.",
            "**Guests** lists players with guest level G1 to G3; level 1 has the highest priority when trainings are full, level 3 the lowest.",
            "Below the roster: the team calendar (games, trainings, events, hall closures), game dates still being negotiated, polls if enabled for the team, and **Sponsors**."
          ]
        },
        {
          "t": "h",
          "text": "Player profile"
        },
        {
          "t": "p",
          "text": "Tap a name in a roster to open the player's profile: photo, roles, positions, teams, **Statistics** for the current season (**Trainings**, **Games**, **Training rate**) and **Current absences**. Attendance counts confirmed replies from 1 June to today, leaving out activities covered by an absence. Email, phone and age appear only to coaches and team responsibles of the player's teams (or a sport admin in admin mode), and only if not hidden in the profile (see the section Your profile)."
        },
        {
          "t": "h",
          "text": "Joining and leaving a team"
        },
        {
          "t": "ol",
          "items": [
            "On the Teams page tap **Manage teams** (a plus button on phones) or **Add team** on your profile. With no team yet, the button reads **Join new team**.",
            "Under **Join a team**, pick the sport if asked, choose a team and tap **Send request**. Teams you are already on or have requested, and teams of the other gender, are not offered.",
            "Every coach and team responsible of that team is notified (in-app and by email) and can approve or reject. Until then your profile lists the request as **Pending approval**; the X next to it withdraws it.",
            "To leave, tap **Leave team** in the same dialog (or the X on the team chip on your profile) and confirm."
          ]
        },
        {
          "t": "note",
          "text": "Leaving removes you from the roster at once. To rejoin you need a coach's approval again."
        },
        {
          "t": "h",
          "text": "If you are a coach or team responsible"
        },
        {
          "t": "p",
          "text": "On a wide screen your team page also shows the **Email**, **Phone** and **Birthdate** columns (privacy settings still apply). An amber **2 pending request(s)** box offers **Approve** and **Reject**; for a join request pick **Join as:** **Player** or **Guest** L1–L3 first. **Edit team** opens the roster editor. Rejecting a new account's request deactivates that person's membership and app access. The rest is in the section Roster editor."
        }
      ]
    },
    "profile": {
      "title": "Your profile",
      "summary": "Your contact data, photo, privacy switches, auto sign-in, email preferences, IBAN, documents and licence status.",
      "body": [
        {
          "t": "p",
          "text": "Open **My profile** from your avatar (desktop) or via **More** → your name (phone). It shows your teams, contact data, licences, absences and fines; **Edit profile** opens the form."
        },
        {
          "t": "h",
          "text": "Editing your data"
        },
        {
          "t": "ul",
          "items": [
            "**Change photo** (JPEG, PNG, WebP or GIF; photos are shrunk automatically, max 5 MB). **Website visibility** next to it shows the photo on the kscw.ch roster.",
            "**Nickname** replaces your first name across the app.",
            "**Number** (0–99) must be free on your active teams.",
            "**Personal data (ClubDesk)** holds address, nationality, **Coaching qualification**, **AHV number** and **IBAN**. Enter your IBAN for reimbursements; it also clears the home-page reminder.",
            "**Managed by admin** fields and the licence number can only be changed by the club.",
            "**Change password** keeps your identity-document key; **Send reset link** loses it (see the section Identity documents)."
          ]
        },
        {
          "t": "note",
          "text": "Name, language, phone, birthdate, address, postal code, city and nationality are required; **Welcome to KSC Wiedikon** blocks the app until they are filled. Changes to name, email, phone, birthdate, address or nationality go to the club register (**Data update sent to admin**)."
        },
        {
          "t": "h",
          "text": "Privacy"
        },
        {
          "t": "ul",
          "items": [
            "**Hide phone number** / **Hide email address**: other members never see them; these switches hide them from your coaches and team responsibles too (club admins still see them).",
            "**Birthdate visibility**: **Show full date**, **Year only** or **Hide**. Only **Show full date** puts your birthday in the calendar.",
            "**Show only first name on the website**: on kscw.ch your surname becomes an initial (Anna M.) and your birth year is hidden."
          ]
        },
        {
          "t": "h",
          "text": "Auto sign-in and email notifications"
        },
        {
          "t": "p",
          "text": "The **Auto sign-in** switches (**Trainings**, **Games**, **Events**) confirm you automatically on every new and upcoming activity of that type. Answers you already gave and absence days are never changed; you can still decline individually. Under **Email notifications**, **Club news** and **Event invitations** are on for everyone; turning one off stops the email only, the bell still shows it. Coaches, team responsibles and admins see extra rows for their duties."
        },
        {
          "t": "h",
          "text": "Documents and licence status"
        },
        {
          "t": "p",
          "text": "**My documents** lists the files you uploaded when registering; tap one to preview it. It only appears if you uploaded any. **Licence status** runs **No licence** → **To be ordered** → **Ordered** → **Finalized** → **Licenced**. The club sets the first four; **Licenced** is confirmed automatically from the federation. You are notified when the club changes it or it becomes **Licenced**; on 1 June it silently resets to **No licence**."
        },
        {
          "t": "h",
          "text": "The annual profile check"
        },
        {
          "t": "p",
          "text": "Before next season's licences are ordered, the club may ask you to check your data. **Please check your data** then opens with your full profile and cannot be closed. Check every field named in the banner, correct what is wrong and press **Everything is correct**. Under-16s should do this with a parent. It does not return until the next check."
        }
      ]
    },
    "household": {
      "title": "Households and family accounts",
      "summary": "One parent login for several children: switching member, acting for a child, and what stays blocked.",
      "body": [
        {
          "t": "p",
          "text": "A household lets one adult login act for several members — typically a parent doing RSVPs, absences and forms for their children. Each child keeps their own member record, roster place, fees and licence; only the login is shared. Households are set up by the club's admins, and only ordinary members can be managed — not coaches, team responsibles, Spielplaner or anyone with an admin role."
        },
        {
          "t": "h",
          "text": "Switching member"
        },
        {
          "t": "ol",
          "items": [
            "Tap the coloured bar at the top of the app; it shows the name of the person you are acting as. The bar only appears for logins that manage at least one other member.",
            "In **Who are you doing this for?** choose **Me** or one of your children. Each child is listed with their first name, their teams, and their photo or a coloured initial.",
            "The whole app now works as that child: their activities, profile, absences and forms, and everything you save is saved for them. Tap the bar again and choose **Me** to switch back."
          ]
        },
        {
          "t": "p",
          "text": "While you act for a child, the bar takes that child's own colour, and the answer buttons on trainings, games and events carry the child's name — for a child called Mila they read **Mila is coming**, **Mila can't** and **Maybe, Mila** — so you always see who you are answering for."
        },
        {
          "t": "note",
          "text": "Acting is real, not a preview: what you enter counts for the child and is recorded under their name, and the club's audit record notes that you did it. All open tabs follow the switch, and each time you open the app you start as yourself — the last child you used is never restored automatically."
        },
        {
          "t": "h",
          "text": "What is blocked while acting"
        },
        {
          "t": "p",
          "text": "These belong to a real login or to the person alone and are refused while you use a child's account:"
        },
        {
          "t": "ul",
          "items": [
            "Changing or setting a password, and deleting the account",
            "Voting in polls (see the section Polls)",
            "Delegating a scorer duty (see the section Scorer duty)",
            "Creating or renewing a calendar subscription link — **Subscribe** on the calendar page",
            "Opening identity documents: a managed member has never signed in, so no key exists for them"
          ]
        },
        {
          "t": "tip",
          "text": "If the app ever loses track of who you are acting as, it shows **Something went out of sync — reloading to be safe** and reloads itself."
        },
        {
          "t": "h",
          "text": "How a child gets their own login"
        },
        {
          "t": "p",
          "text": "A managed child has no password and cannot sign in, but still receives club emails. A member who already has their own login cannot be added as a managed member. When a child is ready for their own account, ask an admin: the child needs an email address of their own, because each account needs its own email address. Once the invite arrives, the child chooses a password (see the section Your account)."
        }
      ]
    },
    "forms": {
      "title": "Filling in forms",
      "summary": "Where forms appear, how to answer them before the deadline, and when you can change an answer.",
      "body": [
        {
          "t": "p",
          "text": "Coaches, team responsibles and the board use forms to collect answers from members, such as a kit order or a survey. When a form is opened for you, it appears on your home page and you get a notification. Creating one is covered in the section Building forms."
        },
        {
          "t": "h",
          "text": "Where forms appear"
        },
        {
          "t": "ul",
          "items": [
            "On the home page, in the blue **Forms to fill** card, shown only while a form is open for you.",
            "On the **Forms** page under **Open for you**. Players have no menu entry for it; the bell entry **New form:** with the form title, or the push titled **New form**, takes you there.",
            "Coaches, team responsibles, the board and admins find it under **Member tools → Forms** (desktop) or **More → Member tools → Forms** (phone)."
          ]
        },
        {
          "t": "p",
          "text": "A form is open for you when it is club-wide or aimed at a team you play on. If you only coach a team, you get its notifications but the form is not listed for you. Each entry shows the title and, if there is a deadline, **Closes** followed by the date and time (30.09.2026 23:59). You are notified once per form when it opens, in the bell and, with push enabled, on your phone. No email is sent."
        },
        {
          "t": "h",
          "text": "Answering a form"
        },
        {
          "t": "ol",
          "items": [
            "Tap **Fill in**. Questions marked with * are required.",
            "Answer the questions. For a file question tap **Choose a file**; the red cross next to the file name removes it so you can pick another.",
            "Press **Submit**. You see the author's thank-you text or **Thanks — your response has been recorded.**, then press **Done**."
          ]
        },
        {
          "t": "note",
          "text": "The deadline is strict. After the time next to **Closes**, or once the author closes the form, submitting fails with **This form is closed.** An empty required question shows **Please answer:** and its name."
        },
        {
          "t": "h",
          "text": "Changing an answer"
        },
        {
          "t": "p",
          "text": "On a normal form you answer once. Afterwards the button reads **Edit** instead of **Fill in**: change what you need and press **Save**. You see **Your response has been updated.** or the thank-you text. This works until the form closes."
        },
        {
          "t": "ul",
          "items": [
            "Anonymous forms show **This form is anonymous — your answers are not linked to your name.** Nobody can tell which answer is yours, so it cannot be edited, and the form keeps showing **Fill in** after you answer. Do not fill it in twice.",
            "If the author allows several answers per person, the form stays listed with **Fill in** and the thank-you screen offers **Submit another**. Earlier answers cannot be changed."
          ]
        },
        {
          "t": "h",
          "text": "Reminders"
        },
        {
          "t": "p",
          "text": "If you have not answered, the author can send a reminder: **Reminder — please fill in:** plus the form title in the bell, and a push titled **Reminder**. Both open the **Forms** page. Once you have answered, no further reminders reach you."
        }
      ]
    },
    "polls": {
      "title": "Polls",
      "summary": "Vote in team polls, and — as a coach or team responsible — create, close and read them.",
      "body": [
        {
          "t": "p",
          "text": "Polls are short team surveys: one question, a few options. You find them on your team page under **Polls** — **Member tools → Teams** on desktop (**Team** if you are in only one), **More → Member tools → Teams** on a phone, then pick your team. Open polls of your teams also appear on the home page as **Active polls**. The section only shows for teams with polls switched on."
        },
        {
          "t": "h",
          "text": "Voting"
        },
        {
          "t": "ol",
          "items": [
            "Tap an option. A **Single choice** poll takes one pick, a **Multiple choice** poll several.",
            "Press **Vote**. Your answer is marked **Voted**.",
            "To revise it, press **Change vote**, adjust your picks and press **Change vote** again — or **Cancel** to keep the old answer."
          ]
        },
        {
          "t": "note",
          "text": "A poll may carry a **Deadline** (dd.mm.yyyy). You can vote during the whole of that day. From the next day it reads **Voting closed**, drops off the home card and accepts no more votes, although its badge stays **Open** on the team page until a manager closes it."
        },
        {
          "t": "h",
          "text": "What you see"
        },
        {
          "t": "ul",
          "items": [
            "With **Results visible to everyone**, the result bars appear once you have voted, or once the poll is closed or past its deadline.",
            "Without it you see, after voting, only your own marked answer and the hint **Results are only visible to team managers**.",
            "With **Anonymous voting**, nobody — not even your coach — can see who chose what; only totals exist.",
            "Closed polls sit in the collapsible **Closed polls** list at the bottom of the section."
          ]
        },
        {
          "t": "h",
          "text": "If you are a coach or team responsible"
        },
        {
          "t": "p",
          "text": "You (or an admin in admin mode) manage your team's polls. On the team page press **Create poll** and fill in:"
        },
        {
          "t": "ul",
          "items": [
            "**Question** and at least two **Options** (**Add option**, **Remove**). The **Create poll** button stays greyed out until both are there.",
            "**Voting mode**: **Single choice** or **Multiple choice**.",
            "**Deadline**, or leave it empty for **No deadline**.",
            "**Anonymous voting** (off by default) hides who voted — from you too.",
            "**Results visible to everyone** (on by default); switch it off to keep the totals to managers."
          ]
        },
        {
          "t": "p",
          "text": "You always see the live tally, even before you have voted. On non-anonymous polls each option lists its voters under **Voted by**. The lock icon (**Close poll**) stops voting and moves the poll to **Closed polls**; the bin icon (**Delete poll**) removes it with every vote. Both work on the team page and the home card."
        },
        {
          "t": "note",
          "text": "Closing and deleting are final: there is no reopen, and deleted votes are gone. The app asks you to confirm both; if you need more answers later, create a new poll."
        },
        {
          "t": "tip",
          "text": "Polls are switched on per team in the roster editor under **Team Settings → Features → Polls (team voting & decisions)** — see the section Roster editor."
        }
      ]
    },
    "feedback": {
      "title": "Feedback, status and what's new",
      "summary": "Reporting bugs and ideas, checking the app's health, reading release notes, and the legal and coffee pages.",
      "body": [
        {
          "t": "p",
          "text": "Everything here lives under **Options**: the gear icon at the top right on desktop, or **More → Options** on a phone. On a phone the coffee link sits in the **More** sheet next to your profile, and the legal pages are at its very bottom."
        },
        {
          "t": "h",
          "text": "Feedback and bug reports"
        },
        {
          "t": "p",
          "text": "**Options → Feedback** opens **Feedback & bugs**. Tap **New feedback**, pick **Bug**, **Feature** or **Feedback**, add a short **Title** and a **Description** of what happened and what you expected, and attach up to five screenshots under **Screenshot** (PNG, JPG or WebP, max 5 MB each). Then **Submit**."
        },
        {
          "t": "ul",
          "items": [
            "**Bug** and **Feature** reports automatically open a GitHub issue; plain **Feedback** does not.",
            "**Issue tracker** below the form lists the **Open** issues, with **Resolved** ones folded away underneath, so you can check whether a problem is already known.",
            "When you are logged in, **My submissions** at the bottom lists what you sent with its status: **New**, **GitHub issue** or **Closed**.",
            "A screenshot of the exact screen plus the date and team concerned is usually enough to get a bug fixed fast."
          ]
        },
        {
          "t": "h",
          "text": "Status page"
        },
        {
          "t": "p",
          "text": "**Options → Status** (login required) shows whether the app and its data feeds are running: **App server**, **Swiss Volley sync**, **Basketplan sync** and **Hall schedule sync**, each with how long ago it last ran. The banner reads **All systems operational**, **A sync is lagging** or **A service is offline**; **Recent fixes** lists problems resolved lately. Look here first if results or the Hallenplan seem outdated."
        },
        {
          "t": "h",
          "text": "What's new"
        },
        {
          "t": "p",
          "text": "**Options → What's new** opens the **Changelog**. The version you are running (for example `v2.12.0`) is shown at the top and next to the menu entry. Each release is dated and split into short headed sections with the changes listed underneath. Release notes are always in English, whatever language the app is set to."
        },
        {
          "t": "h",
          "text": "Privacy, imprint and the coffee link"
        },
        {
          "t": "p",
          "text": "**Privacy** and **Imprint** at the bottom of the **More** sheet open the **Privacy policy** (what data the club stores, why, and who can see it) and the **Legal notice** with the club's address and contact email. The privacy policy is the one you accepted when creating your account."
        },
        {
          "t": "p",
          "text": "**Buy me a coffee** (avatar menu on desktop, **More** sheet on a phone, and at the bottom of **What's new**) opens **Buy the developer a coffee**: a personal thank-you to the person who builds Wiedisync, paid with TWINT. Tap **Copy number** and paste it into the TWINT app."
        },
        {
          "t": "note",
          "text": "This is not a club donation: it is not tax-deductible and has no effect on your membership fee. Nothing is paid inside the app. The link only appears for members aged 18 or over with a birthdate on their profile."
        }
      ]
    },
    "dues": {
      "title": "Bills & reimbursements",
      "summary": "Your club bills, how to pay them by QR-bill, and where reimbursements and referee fees land.",
      "body": [
        {
          "t": "p",
          "text": "Open **Finances → Member finance → Bills & reimbursements** on desktop, or **More → Finances → Member finance → Bills & reimbursements** on a phone. The **Your dues** card on Home links here while a bill is payable. Bills addressed to a team you lead are in the section Team finance; fines in the section Fines."
        },
        {
          "t": "h",
          "text": "Your bills"
        },
        {
          "t": "p",
          "text": "The **Open balance** tile is what you still owe. Each invoice shows **Subject**, **Date**, **Due**, **Amount**, **Open** and **Status**: **Open**, **Partially paid**, **Pending confirmation**, **Paid** or **Cancelled**; bills mirrored from ClubDesk keep their German status text. A free membership either shows **Nothing to pay — your membership is free of charge.** or a CHF 0.00 invoice that lists why."
        },
        {
          "t": "p",
          "text": "The amount follows the **Fee category** under **Managed by admin** in **My profile**; ask the treasurer to change it. The rate includes your federation licence; the invoice itemises that share without adding to the total. Members who owe scorer duty but hold no scorer licence pay CHF 100.00 extra, members who are only a guest player (core on no team) pay CHF 110.00 less, and honorary members, board members and coaches of an active team are billed CHF 0.00. Team responsibles pay the normal rate."
        },
        {
          "t": "h",
          "text": "Paying a bill"
        },
        {
          "t": "ol",
          "items": [
            "Tap an open invoice to expand it. A Swiss QR-bill appears with the open amount pre-filled.",
            "Scan it with TWINT or your banking app and pay.",
            "Tap **Set as paid**. The invoice switches to **Pending confirmation** and leaves your open balance."
          ]
        },
        {
          "t": "note",
          "text": "**Set as paid** is your report, not the payment. The club sets **Paid** once the money arrives; the button works only while the bill is still **Open**."
        },
        {
          "t": "h",
          "text": "Payout IBAN"
        },
        {
          "t": "p",
          "text": "The **Payout IBAN** card holds the account the club reimburses you on. Tap **Add IBAN** (or **Edit**) and **Save**; invalid IBANs are refused. If the club already has your IBAN from ClubDesk, answer **Yes, it's correct** or **Change it**. Only finance and admins can see it. Until then Home shows **Add your IBAN** or **Confirm your IBAN**; **Not now** hides that card."
        },
        {
          "t": "tip",
          "text": "Payouts need a Swiss or Liechtenstein IBAN plus your postal code and city on your profile — otherwise the payout is skipped and finance is told why."
        },
        {
          "t": "h",
          "text": "Reimbursements and referee fees"
        },
        {
          "t": "ul",
          "items": [
            "**Reimbursements to you** lists payouts the club is sending you. **Announced** means not yet transferred, **Paid** means transferred; **Download PDF** saves the document. Expense reimbursements appear here once finance marks them paid (see the section Expense reimbursement).",
            "**Referee fees you paid** lists fees you paid out of pocket at volleyball home games, recorded by your team staff under **Referee expenses** in the game details. **Season end** means it awaits the season-end run, **Reimbursed** with a date means paid; **To be reimbursed** totals this season."
          ]
        }
      ]
    },
    "expenses": {
      "title": "Expense reimbursement",
      "summary": "Upload a receipt for something you paid for the club and follow it until finance pays you back.",
      "body": [
        {
          "t": "p",
          "text": "Paid for balls, a tournament fee or anything else for the club yourself? Upload the receipt and finance reimburses you. The page is **Upload invoice**, under **Finances → Member finance → Upload invoice** (desktop) or **More → Finances → Member finance → Upload invoice** (phone)."
        },
        {
          "t": "h",
          "text": "Uploading a receipt"
        },
        {
          "t": "ol",
          "items": [
            "Pass the security check next to the upload area; the upload stays disabled until then.",
            "Tap **Choose a file or drop it here** and pick the receipt: PDF, JPG or PNG, at most 8 MB.",
            "Wait while the app scans the document. Under **Check the details** it pre-fills **Amount**, **Currency**, **Date**, **Vendor**, **Description** and **Reference**. Correct anything that is off; if the scan fails, fill the fields in yourself. **Use a different file** starts over.",
            "Check **Reimburse on this account**, add a **Note for finance** if useful, and tick **Already paid?** if you already paid the bill yourself, out of pocket.",
            "Tap **Send to finance**. Finance gets an email with your receipt attached and you get a copy."
          ]
        },
        {
          "t": "note",
          "text": "**Amount** and a valid IBAN are required to send. You can scan at most 5 receipts and send at most 5 claims per hour. Sending the same file twice does not create a second claim."
        },
        {
          "t": "h",
          "text": "Your IBAN"
        },
        {
          "t": "p",
          "text": "**Reimburse on this account** is pre-filled with the IBAN from your profile; you can change it for this one expense. To update it for all future payouts, use the **Payout IBAN** card described in the section Bills & reimbursements, which also lists what a payout needs."
        },
        {
          "t": "h",
          "text": "My submissions"
        },
        {
          "t": "ul",
          "items": [
            "**Pending**: sent, not yet decided by finance.",
            "**Paid**: finance has transferred the money. The claim also appears under **Reimbursements to you** on **Bills & reimbursements**, where you can download the payout document as a PDF.",
            "**Rejected**: finance declined the claim."
          ]
        },
        {
          "t": "p",
          "text": "The table **My submissions** at the bottom of the page lists every claim with date, amount, vendor and **Status**; any note from finance appears under the status. **Receipt** opens the file you uploaded. When a claim is set to **Paid** or **Rejected** you get an in-app notification, a push message and an email in your language, including the note from finance."
        },
        {
          "t": "h",
          "text": "Who confirms your expense"
        },
        {
          "t": "p",
          "text": "Your claim is routed to the TK of your section, the VB admin or BB admin. The TK confirms that the expense is budgeted and tells finance if the section has already reimbursed you. This does not change what you see: only finance moves a claim from **Pending** to **Paid** or **Rejected**. The queue is under **Finances → Club finance → Confirm expenses** (see the section Club finances)."
        }
      ]
    },
    "fines": {
      "title": "Fines",
      "summary": "Your fines, how they arise automatically, paying and waiving, and the team fines view.",
      "body": [
        {
          "t": "p",
          "text": "Fines are the small penalties a team charges for late sign-ins, no-shows and similar. Yours are listed under **Finances → Member finance → My fines** (on a phone, open **More** first). The home page's **Open fines** card also takes you there."
        },
        {
          "t": "h",
          "text": "Your fines"
        },
        {
          "t": "ul",
          "items": [
            "**My fines** lists each fine with **Team**, **Category**, **Amount**, **Status**, **Issued** and **Reason** (the last two only on wider screens).",
            "The list starts on **Open**; pick **Paid**, **Waived** or **All** to see the history.",
            "**Outstanding** at the top adds up only your personal open fines."
          ]
        },
        {
          "t": "h",
          "text": "How a fine arises"
        },
        {
          "t": "ul",
          "items": [
            "**Late sign-in** — you had not answered by the deadline, or a coach had to confirm you after it.",
            "**No-show** — you were signed in but did not turn up.",
            "**Late payment** and **Custom** — issued by hand for anything else.",
            "Each team sets its own ladder: the amount rises with every repeat in the same category (for example CHF 10.00, then CHF 20.00) and resets after a window from **Calendar month** to **Lifetime**."
          ]
        },
        {
          "t": "note",
          "text": "If your team has switched on late sign-in fines, anyone who has not answered a training or game by the deadline is marked as not coming and fined automatically the next morning. Answer before the deadline, even with a no. If a coach confirms you after the deadline, they are asked whether to fine you."
        },
        {
          "t": "h",
          "text": "Paying, waivers and notifications"
        },
        {
          "t": "ul",
          "items": [
            "The app does not collect money. Settle the fine with your coach or team responsible; they press **Mark as paid**.",
            "A coach can **Waive** an open fine, always with a reason. Amount, category and reason cannot be edited afterwards — a wrong fine is waived and reissued.",
            "A bell entry and a push tell you when a fine is issued (**New fine**), paid (**Fine paid**) or waived (**Fine waived**); an automatic late sign-in fine comes as one **Training: deadline missed** or **Game: deadline missed** push. After 14 days you get one **Open fine(s)** reminder push a day."
          ]
        },
        {
          "t": "h",
          "text": "Whole-team fines"
        },
        {
          "t": "p",
          "text": "A coach can also fine the whole team. It shows **Whole team** instead of a name, is owed by the Teamkasse and never counts towards your **Outstanding**. Find it on the **Team** tab (**Finances → Team finance → Team fines**) and on the home card."
        },
        {
          "t": "h",
          "text": "If you are a coach or team responsible"
        },
        {
          "t": "p",
          "text": "**Team fines** shows every fine of your teams. **Issue fine** first asks **Who is being fined?** (**A member** or **The whole team**), then the team and the member; the amount fills in from your ladder (editable). A team fine needs a manual amount and notifies everyone on the team. Ladders and the automatic sweep: see the section Fine rules. The **Open Teamkasse fines** tile: see the section Team finance."
        }
      ]
    },
    "roster": {
      "title": "Roster editor",
      "summary": "Managing your team's roster: players, numbers, positions, guest levels, invites and join requests.",
      "body": [
        {
          "t": "p",
          "text": "Open **Member tools → Teams** (**Team** if you are on one team; phone: **More → Member tools → Teams**), pick your team and tap **Edit team**. At the top of **Edit roster** you set the **Team picture** with **Upload picture** or **Remove picture** (JPG or PNG, max 10 MB). On the team page, tap the picture, choose **Adjust crop**, then **Save**."
        },
        {
          "t": "h",
          "text": "Players on the roster"
        },
        {
          "t": "ul",
          "items": [
            "**Add player**: type at least two letters in **Search by name...** and tap the member. Only active club members are offered.",
            "Remove: tap the red X, then **Remove** in the **Remove player** dialog.",
            "Number: tap the **#** value, type the number and press Enter.",
            "**Position**: tick one or more positions. **Staff only** is for a coach or team responsible who does not play; they get no number.",
            "**K** marks the captain; tapping **K** on the current captain clears it.",
            "**G** cycles the guest level: **G** → **G1** → **G2** → **G3** → back. It saves immediately."
          ]
        },
        {
          "t": "note",
          "text": "Guest levels 1–3 set priority when trainings are full: level 1 highest, level 3 lowest. Guests are listed under **Guests** on the team page and are left out when games auto-confirm."
        },
        {
          "t": "h",
          "text": "Getting people into the app"
        },
        {
          "t": "ul",
          "items": [
            "An envelope icon (**Send WiediSync invite**) appears next to players with an email but no login. Tap it: the invite is emailed and a QR code with **Copy link** opens; it works once, for 30 days.",
            "**Add External User** is for someone not yet in the club. Choose **Join as:** **Player** or **Guest** L1–L3, tap **Generate QR Code** and show the code or **Copy Link**. The link works once and expires after 7 days; at most 20 open invites per team.",
            "The person enters name and email, confirms the emailed code and sets a password. They join the roster at once, marked **Temporary**; if the login is not activated within 30 days the entry disappears by itself (a reminder email goes out 10 days before)."
          ]
        },
        {
          "t": "h",
          "text": "Join requests"
        },
        {
          "t": "p",
          "text": "When a member asks to join your team, every coach and team responsible gets a **Join request** notification and an email. An amber box on the team page lists it: pick **Join as:** **Player** or **Guest** L1–L3, then **Approve** or **Reject**. Sign-up requests from new members who chose your team appear in the same box with only **Approve** and **Reject**."
        },
        {
          "t": "note",
          "text": "**Reject** on a sign-up request ends the person's club membership and app access, with no confirmation step. Rejecting an existing member's join request only closes that request."
        },
        {
          "t": "h",
          "text": "If you are an admin"
        },
        {
          "t": "p",
          "text": "Only admins in admin mode change the staff list: **Manage staff** next to **Staff** on the team page adds or removes members under **Coaches** and **Team responsibles**, which also grants or revokes their leader access in the app."
        }
      ]
    },
    "coaching": {
      "title": "Managing trainings, games and events",
      "summary": "How coaches and team responsibles create, edit and cancel activities, call up players and read attendance.",
      "body": [
        {
          "t": "p",
          "text": "You manage activities on the same pages your players use (see the sections Trainings, Games & results and Events). Extra controls show only for teams you lead."
        },
        {
          "t": "h",
          "text": "Trainings"
        },
        {
          "t": "ul",
          "items": [
            "**New training** → **Single training**: **Auto hall slot** takes time and hall from the team's slot; **Manual** lets you set them. Team defaults pre-fill **Min. participants**, **Auto-cancel**, **Require note if not joining** and **Respond by**.",
            "**New training** → **Recurring trainings**: pick a hall slot or a manual weekday, a date range or **Indefinitely**, then **Preview dates** and **Generate**. Past, closed and already taken dates are skipped.",
            "Editing a training tied to a hall slot asks for the scope: **This training only**, **All trainings on the same weekday** or **All recurring trainings**. Changes copy to the slot's future trainings; dates do not.",
            "**Cancel training** notifies the team and frees the hall slot; **Reinstate** takes it back."
          ]
        },
        {
          "t": "note",
          "text": "The app also shortens or cancels another team's training when a home game needs the hall, and cancels a team's own training on its game day. A training you reinstate by hand is left alone."
        },
        {
          "t": "h",
          "text": "Events"
        },
        {
          "t": "ul",
          "items": [
            "**New event**: title, type, dates or **All day**, **Meeting time**, location and the RSVP options (**Respond by**, **Allow \"Maybe\" replies**, **Max participants**).",
            "Leave **Teams** empty for a club-wide event; switch off **Invite guest players** to leave guest players out.",
            "Multi-day events: **Participation mode** → **Per day** or **Per time slot** lets people answer per day or slot.",
            "**Public signup link**, for people without an account, appears if you created the event or have **Admin mode** on: **Create link**, **Replace link** (the old link stops working) or **Turn off** (signups are kept). Only admins see **All signups**."
          ]
        },
        {
          "t": "h",
          "text": "Games"
        },
        {
          "t": "ul",
          "items": [
            "Results arrive overnight from the federations, not from you.",
            "**Set deadline** sets the RSVP deadline. **Meeting time** is stored as minutes before the start, so it survives a reschedule.",
            "**Called-up players**: **Call up players** from another team of the same sport, **Open to a whole team** or individually. They are notified and can answer; **Has a game that day** flags a clash.",
            "**Referee expenses** (volleyball home games): record who paid the referees and how much; the home page shows **Record now** for 14 days (see the section Team finance)."
          ]
        },
        {
          "t": "h",
          "text": "Attendance and capacity"
        },
        {
          "t": "p",
          "text": "The **Coach dashboard** tab on Trainings and Games & results shows per player **Present**, **Absent**, **Rate** (green from 80 %, amber from 50 %) and **Trend** for a **From**/**To** range. Confirmed is present; declined, an absence or no answer on a past activity is absent (unlike **Statistics** on a player profile, which leaves absence-covered activities out). **League only** drops cup games."
        },
        {
          "t": "tip",
          "text": "In **View roster** you can change any player's answer or **Clear** it. For an event with **Max participants**, the roster shows the spots left or **Full**."
        }
      ]
    },
    "matchsheet": {
      "title": "Match sheet",
      "summary": "Numbers, captain and libero per game, emergency changes to the list, and showing IDs at the table.",
      "body": [
        {
          "t": "p",
          "text": "The match sheet is laid out like the paper one: **Born**, **No.** and **Name**, the captain's number circled, liberos repeated under **Libero**, coaches under **Officials**. Open an upcoming game from **Activities → Games & results** (desktop) or the **Games** tab (phone) and tap **Match sheet**. It opens edge to edge and pinch-zooms for the scorer."
        },
        {
          "t": "p",
          "text": "The button appears for the coach or team responsible of the playing team, home and away, from six hours before the start until three hours after. The assigned scorer (scorer duties only, not scoreboard) sees a read-only version from 40 minutes before a home game. Outside the window you only see **The match sheet opens shortly before the game and closes 3 hours after it.**"
        },
        {
          "t": "h",
          "text": "Where the players come from"
        },
        {
          "t": "ul",
          "items": [
            "**From the Einsatzliste filed in Volleymanager.** This list decides who plays. The **✓** column checks each player against their reply: green tick confirmed, amber mark maybe or no answer, red cross declined.",
            "**From the confirmed RSVPs — no Einsatzliste available.** The fallback for basketball and unfiled lists (no **✓** column).",
            "A warning sign means Volleymanager flags that player as not eligible."
          ]
        },
        {
          "t": "h",
          "text": "Editing the sheet"
        },
        {
          "t": "ol",
          "items": [
            "Tap **Edit**.",
            "Type the jersey number (1–99) in the **No.** column.",
            "Tap **C** to mark the captain (one per sheet) and **L** to mark a libero.",
            "Tap **Save**; the caption then shows **Adjusted by** and your name. **Done** leaves edit mode without saving."
          ]
        },
        {
          "t": "note",
          "text": "Saved for this game only: the team roster, the team captain and Volleymanager are not touched. The sheet is always sorted by number, unnumbered players last."
        },
        {
          "t": "p",
          "text": "Emergency changes: while editing, **Add from team · emergency only** lists the rest of the squad. **+** adds a player, **✕** strikes one off (crossed out) and **↺** puts them back. Any add or removal raises the red banner **Player list differs from the Einsatzliste**: the app does not push it, so you must enter the same change manually in Volleymanager. **Reset to the Einsatzliste** (shown once you have saved) removes every adjustment for this game, numbers included."
        },
        {
          "t": "h",
          "text": "Show IDs"
        },
        {
          "t": "p",
          "text": "Coaches and team responsibles (not admins) also get **Show IDs**: the players' identity documents, decrypted on your device with your own key (see the section Identity documents). Tap **Unlock** once per device, then **Download for offline** while you have signal. It works from 45 minutes before the start until the start: step through the players in sheet order; PDF scans open in a viewer; each is watermarked. At the start the documents are removed from the phone, and every opening is logged."
        },
        {
          "t": "h",
          "text": "If you are the captain"
        },
        {
          "t": "p",
          "text": "Your number is the circled one; the coach sets the **C** per game. You cannot open the sheet yourself: ask the coach, team responsible or scorer."
        }
      ]
    },
    "broadcast": {
      "title": "Contact: reach everyone on an activity",
      "summary": "Send an email or push to the people of a game, training or event, filtered by their RSVP status.",
      "body": [
        {
          "t": "p",
          "text": "**Contact** sends one message to everyone attached to a single activity. Open a game, training or event from **Home**, the **Calendar** or **Activities → Games & results**, **Trainings** or **Events** (on a phone: the bottom tabs, or **More → Events**). The **Contact** button sits next to **Share link** in the detail window. On games it appears only while the game is still scheduled."
        },
        {
          "t": "h",
          "text": "Who can send"
        },
        {
          "t": "ul",
          "items": [
            "Coaches and team responsibles: the games and trainings of their own team only, not events.",
            "Volleyball and basketball admins: the games and trainings of their sport.",
            "Admins: every activity. Board members: events; for games and trainings they need one of the roles above.",
            "Captains and players never see the button."
          ]
        },
        {
          "t": "h",
          "text": "Sending a message"
        },
        {
          "t": "ol",
          "items": [
            "Under **Channel**, tick **Email** (on by default) and/or **Push** (off by default). At least one is needed.",
            "Under **Recipients**, tick the RSVP statuses you want: **Confirmed**, **Maybe**, **Declined**, **Waitlist** and **No reply**. **Confirmed** and **Maybe** are pre-ticked.",
            "On an event, tick **Include external sign-ups** to also email people who signed up through the public link.",
            "Check the preview (**Recipients: 12 (10 members · 2 external)** and a few example names). If it says **Nobody matches these filters.**, change the ticks: the message would go to nobody.",
            "Write a **Subject** (shown only when **Email** is on, 3 to 200 characters) and a **Message** (up to 2000 characters).",
            "Press **Send**, then confirm **Send broadcast?**. A confirmation **Broadcast sent: 12 recipients** appears."
          ]
        },
        {
          "t": "h",
          "text": "Who receives it"
        },
        {
          "t": "ul",
          "items": [
            "**No reply** means everyone on the eligible roster who has not answered at all: for games the core roster without guest players, for trainings the roster after the training's guest rules, for events the invited teams and members.",
            "Deactivated members are never contacted. Emails go to every selected member with an email address; pushes only to members who enabled push notifications on a device. External sign-ups get email only.",
            "Each person gets their own email in their own language, with your name, the activity details, your message and an **Open in Wiedisync** button. Nobody sees the other addresses.",
            "A push shows your subject as its title and the first 200 characters of your message. Tapping it opens the activity."
          ]
        },
        {
          "t": "note",
          "text": "Broadcast emails are always sent: they do not follow the **Email notifications** switches on a member's profile. Sending cannot be undone, so read the preview before you confirm."
        },
        {
          "t": "note",
          "text": "Limits: at most 3 messages per activity per hour, at least 20 minutes between two messages on the same activity (whoever sends them), and at most 10 messages per sender per hour. Beyond that you see a message such as **Please wait 14 minute(s) and try again.**"
        },
        {
          "t": "tip",
          "text": "If you only tick **Push**, there is no **Subject** field; the push uses the activity title instead."
        }
      ]
    },
    "teamfinance": {
      "title": "Team finance",
      "summary": "Team bills, Teamkasse entries and referee fees for your team, and how the season-end payout works.",
      "body": [
        {
          "t": "p",
          "text": "Open **Finances → Team finance → Team finance** on desktop; on a phone the same entries sit under **More → Finances**. The entry appears once you are on an active team as a player, coach, team responsible or captain. Pick the **Team** and the **Season** (this season or the previous one)."
        },
        {
          "t": "h",
          "text": "What the page shows"
        },
        {
          "t": "ul",
          "items": [
            "**Net**: **Income** minus **Expenses** of the Teamkasse entries.",
            "**Open team bills**: what the team still owes on bills addressed to it.",
            "**Referee fees this season**: fees paid at volleyball home games. Shown for the record, never part of the net.",
            "**Open Teamkasse fines**: open fines issued to the whole team. **Show team fines** opens the team fines view (see the section Fines)."
          ]
        },
        {
          "t": "h",
          "text": "Team bills"
        },
        {
          "t": "p",
          "text": "Finance can address an invoice to the team instead of a person, for example a federation fine. It appears under **Team bills** and, if you lead the team, as **Team bills open: CHF 120.00** on the **Your dues** card on Home. As coach, team responsible or captain you tap the open bill to expand its QR-bill, pay with TWINT or your banking app, then tap **Set as paid**. The bill switches to **Pending confirmation** and only finance marks it **Paid** once the money arrives. Roster members see team bills read-only."
        },
        {
          "t": "h",
          "text": "Entries and referee fees"
        },
        {
          "t": "p",
          "text": "**Entries** lists the season's Teamkasse movements. **Sponsoring**, **Other income** and **Expense** rows are recorded by finance; you cannot add them here. **Referee fee** rows come from games: after a volleyball home game, a coach or team responsible opens the game in **Activities → Games & results** (the **Games** tab on a phone) and fills in **Referee expenses** with **Paid by** (a roster member or **Other person** with a name), **Amount (CHF)** and **Notes**, then **Save**. Captains cannot record fees. Each row shows who paid and a status."
        },
        {
          "t": "h",
          "text": "Season-end payout"
        },
        {
          "t": "p",
          "text": "The club reimburses referee fees once a season, in one payout per member, run by finance. Until then a fee shows **Season end**; **Recorded** means it was entered with CHF 0.00; **Announced** means the payout exists but the money has not been sent; **Reimbursed 15.06.2026** means it is settled. After the run the game's entry is locked: **Reimbursed by the club — no longer editable.** The person who paid sees the same fees under **Referee fees you paid** in **Bills & reimbursements**."
        },
        {
          "t": "tip",
          "text": "A payout is skipped when the payer has no Swiss or Liechtenstein IBAN, or no postal code and city, on their profile. Ask whoever paid to check their profile before the season ends."
        },
        {
          "t": "note",
          "text": "If the page shows **No fiscal year exists for this season yet — entries and bills appear once finance opens it.** nothing is lost: finance has not opened the season's books yet."
        }
      ]
    },
    "finerules": {
      "title": "Fine rules",
      "summary": "Set your team's fine ladders and reset windows, automatic late sign-in fines, waiving, and the PDF summary.",
      "body": [
        {
          "t": "p",
          "text": "Open **Member tools → Teams** (shown as **Team** unless you are on several teams; phone: **More → Member tools → Teams**), open your team, tap **Edit team** and find **Fines** at the end of **Team Settings**. Only the team's coaches and team responsibles (or admins in admin mode) see it."
        },
        {
          "t": "h",
          "text": "Categories and ladders"
        },
        {
          "t": "p",
          "text": "Each category (**Late sign-in**, **No-show**, **Late payment**, **Custom**) has an **Enabled** switch, a **Reset window** and **Escalation tiers**."
        },
        {
          "t": "ul",
          "items": [
            "**Add tier**, set **Offense #** and **Amount**. Switch on **And all higher** on the last tier to cover every later offence. Amounts save when you leave the field; **Preview** shows the ladder.",
            "**Reset window** decides when counting restarts: **Calendar month**, **Rolling 30 days**, **Rolling 90 days**, **Season (Sep–Aug)** or **Lifetime**.",
            "The offence number counts the member's earlier fines in that category and team inside the window; waived fines never count."
          ]
        },
        {
          "t": "note",
          "text": "**Season (Sep–Aug)** actually resets on 1 June, when the app switches to the new season."
        },
        {
          "t": "p",
          "text": "For **Late sign-in** and **No-show**, switch on **Per activity type**: **Trainings**, **Games** and **Events** each get their own **Enabled** switch, window and tiers, and each counts its own offences. The ladders start as copies of the general one; a type switched off is not fined. Turning **Per activity type** off deletes the per-type tiers after a confirmation."
        },
        {
          "t": "h",
          "text": "Automatic late sign-in fines"
        },
        {
          "t": "note",
          "text": "Enabling a **Late sign-in** rule (general, or the **Trainings** or **Games** override) arms a nightly sweep: every morning, any player who has not answered by a passed deadline is marked as not coming, fined from your ladder and notified. Events are never swept."
        },
        {
          "t": "ul",
          "items": [
            "Only upcoming trainings and games with a deadline in the last three days are checked.",
            "Staff, called-up players from other teams and anyone who could not answer are never fined; trainings cancelled for lack of participants are skipped.",
            "A rule without tiers marks the player as not coming but issues no fine.",
            "If you confirm a player in the roster after the deadline, the **Issue fine** dialog opens pre-filled with **Late sign-in**; **Cancel** skips the fine, the RSVP stays saved."
          ]
        },
        {
          "t": "h",
          "text": "Waiving and correcting"
        },
        {
          "t": "p",
          "text": "An issued fine's amount, category and reason cannot be changed. To correct one, open **Finances → Team finance → Team fines**, click **Waive** and give a **Reason for waiving** (required). The member is notified, the fine no longer counts on the ladder, and you can issue a new one. Whole-team fines skip the ladder, so you enter the amount yourself."
        },
        {
          "t": "tip",
          "text": "**Download summary (PDF)** in the **Fines** panel builds a sheet for the team: totals per member (open, paid, waived), every fine in date order, and the rules that priced them. It is always in English. The members' view is described in the section Fines."
        }
      ]
    },
    "formsauthoring": {
      "title": "Building forms",
      "summary": "Create forms for your team or the club, publish them, chase missing answers and read the responses.",
      "body": [
        {
          "t": "p",
          "text": "Forms live under **Member tools → Forms** on desktop and **More → Member tools → Forms** on a phone; only coaches, team responsibles, board members and admins see the entry. Press **New form** in the **Manage forms** table to start."
        },
        {
          "t": "h",
          "text": "Building a form"
        },
        {
          "t": "ol",
          "items": [
            "Enter a **Title** and optionally a **Description**.",
            "Press **Add field** for each question, choose a type (**Short text**, **Single choice**, **Rating (1–5)**, **File upload** and more) and tick **Required** if it must be answered. Choice options go one per line.",
            "Reorder with **Move up** / **Move down**; **Translate** adds per-language labels.",
            "Under **Teams**, pick the teams you lead; only their members see the form. Board members and admins in **Admin mode** choose an **Audience** first (**Club-wide** or **Specific teams**).",
            "Set **Closes** for a deadline: after that date and time, submissions are blocked.",
            "Optional: **Anonymous** (answers are not linked to a member), **Allow multiple submissions**, **Thank-you message**.",
            "Use **Preview** to see the form as members will, then **Save**."
          ]
        },
        {
          "t": "h",
          "text": "Publishing and closing"
        },
        {
          "t": "p",
          "text": "A new form is a **Draft**, invisible to members. Set **Status** to **Open** (or press the lock icon, **Open**, in **Manage forms**) to publish it: players, coaches and team responsibles of the selected teams get a bell and push notification **New form**, once. Later edits do not notify again. **Close** stops submissions early; the close date does this automatically."
        },
        {
          "t": "note",
          "text": "Deleting a form (bin icon) also deletes all of its responses and cannot be undone. Close it instead to stop new answers."
        },
        {
          "t": "h",
          "text": "Responses and reminders"
        },
        {
          "t": "p",
          "text": "The bar-chart icon opens **Responses**: one row per submission, one column per question, plus CSV, Excel, JSON and PDF export. Unless the form is anonymous or public you also see how many targeted members have responded, who is still missing, and **Remind non-responders**, which sends a bell and push reminder (no email; at most once per form every 10 minutes). Each new answer notifies you with **New response**."
        },
        {
          "t": "h",
          "text": "Club-wide and public forms"
        },
        {
          "t": "p",
          "text": "The **Club-wide** audience and the **Public form** switch need **Admin mode** (board members and admins). A public form gets a **Web address** and a **Public link** that anyone can fill in without logging in. Public and anonymous forms have no progress tracking and no reminders."
        },
        {
          "t": "h",
          "text": "Event signup forms"
        },
        {
          "t": "p",
          "text": "Members RSVP to events in the app, not through a form (see the section Events). For people without an account, use the event's **Public signup link** (see the section Managing trainings, games and events). In **Admin mode**, guest signups appear under **All signups** with **Export CSV**, and you can attach a **Public signup form** when editing an event."
        }
      ]
    },
    "hallbooking": {
      "title": "Hall plan and free hall time",
      "summary": "Reading the hall grid, slot types and closures, and how to claim or release free hall time for your team.",
      "body": [
        {
          "t": "p",
          "text": "Open **Activities → Calendar** (desktop) or the **Calendar** tab (phone) and switch the view to **Hall**. Desktop shows the week, the phone one day; **Today** jumps back. Filter by sport (**VB** is preselected, **BB** or **All**) or by hall (chips below the grid). On the phone, **Summary** shows the whole week at a glance."
        },
        {
          "t": "h",
          "text": "Reading the grid"
        },
        {
          "t": "ul",
          "items": [
            "Blocks carry their type: **Training**, **Game** or **Event**. A home game blocks the hall from 45 minutes before the start; a cancelled training is struck through.",
            "A green **Available** block is free hall time: a team's training slot on a day it plays away, a cancelled training, a slot admins released for any team, or a weekly slot with no training scheduled that week (up to 12 weeks ahead).",
            "A **Claimed** block (dotted border) is an available slot a team has taken; tap it to see **Claimed by** and **Claimed on**.",
            "A hatched **Closed** overlay names the reason: the hall's slots vanish, its trainings are cancelled and no home game can be booked there (see the section Hallenplan administration)."
          ]
        },
        {
          "t": "h",
          "text": "Claiming free hall time"
        },
        {
          "t": "ol",
          "items": [
            "Tap a green **Available** block, or the green **slot(s) available** button and pick a time from the **Available slots** list.",
            "**Claim hall time** shows hall, date, times, the **Reason** (**Training cancelled**, **Away game** or **Available**) and, under **Originally**, the team that normally has the slot.",
            "Pick your team under **For team**, add optional **Notes** and tap **Claim**. The block turns to **Claimed** for the whole club."
          ]
        },
        {
          "t": "note",
          "text": "Past dates cannot be claimed (**Past slots cannot be claimed.**) and each slot takes one claim per date: if someone was faster you see **This slot has already been claimed.** If the original team reinstates its cancelled training, your claim is released automatically. Every claim and release is logged with your name."
        },
        {
          "t": "tip",
          "text": "When you create a training on that date, the training form offers the time as **Claimed slot** (see the section Managing trainings, games and events)."
        },
        {
          "t": "h",
          "text": "Releasing a claim"
        },
        {
          "t": "p",
          "text": "Tap the **Claimed** block, then **Release** in **Claim details** and confirm. The block is **Available** again. Only a coach or team responsible of the claiming team (or an admin of that sport in admin mode) can release it."
        },
        {
          "t": "h",
          "text": "Finding a free city hall"
        },
        {
          "t": "p",
          "text": "The **Hall finder** lists City of Zürich sport halls with a free recurring slot across the winter season, refreshed nightly from the city booking tool. Filter by **Weekday**, **From**, **Min. duration**, **District**, **Hall type** and **Free every week (excl. school holidays)**. **Calendar** opens the city's occupancy plan, **Request** its reservation page, **Export Excel** downloads the list."
        },
        {
          "t": "tip",
          "text": "Coaches, team responsibles and board members have no menu entry: open `/admin/hallenfinder` directly. Admins find it under **Admin → Planning & halls → Hall finder**."
        }
      ]
    },
    "teamabsences": {
      "title": "Team absences and blocks",
      "summary": "See who on your team is away, log absences for players, and block dates so no game gets scheduled.",
      "body": [
        {
          "t": "p",
          "text": "As a coach or team responsible you see your team's absences in one place. Open **Member tools → Absences** (desktop) or **More → Member tools → Absences** (phone) and switch the lower toggle from **Mine** to **Team**. The upper toggle picks **Absences** (one-off) or **Unavailabilities** (weekly patterns)."
        },
        {
          "t": "h",
          "text": "The team view"
        },
        {
          "t": "ul",
          "items": [
            "Set the period with **From** and **To**, narrow the team filter, and use **Filter by member** to hide individual players.",
            "Switch between the list and the month calendar with the two icons on the right.",
            "**Hide unavailabilities** hides weekly patterns. **Hide non-blocking absences** hides absences whose **Blocks game scheduling** switch is off; they carry a **Non-blocking** badge.",
            "In the calendar, days covered by a team block are shaded red, like days when the hall is closed."
          ]
        },
        {
          "t": "h",
          "text": "Logging an absence for a player"
        },
        {
          "t": "ol",
          "items": [
            "In **Team** scope click **New absence for member**, or **New weekly for member** in the **Unavailabilities** view.",
            "Pick the **Member** (members of the teams shown in the team filter), the dates, the **Reason**, what it **Affects** and whether it **Blocks game scheduling**.",
            "Write why you are logging it in **Details (optional)**; the player can read the note."
          ]
        },
        {
          "t": "p",
          "text": "The player receives a notification, and the row is marked as edited by the coach or team responsible, with your name and the date. As with any absence, the player's RSVPs for the covered activities are declined automatically; see the section Absences."
        },
        {
          "t": "h",
          "text": "Team blocks"
        },
        {
          "t": "p",
          "text": "A team block is a hard blackout for game scheduling: no game is placed for the team on those dates, home or away, even if only a few players are away. In **Team** scope, in the **Absences** view, the **Team blocks** panel lists current and upcoming blocks. Click **Add team block**, choose the **Team**, **From** and **To**, add a **Reason (optional)** and save. To remove one, click the bin icon (**Delete**) next to it and confirm; past blocks drop off the list by themselves."
        },
        {
          "t": "note",
          "text": "You can only block teams you coach or are responsible for. Club-wide Spielplaner and admins in admin mode can block other teams too. A club-wide blackout is a separate setting; see the section Spielplanung."
        },
        {
          "t": "h",
          "text": "How absences reach the Spielplanung"
        },
        {
          "t": "ul",
          "items": [
            "Only one-off absences with **Blocks game scheduling** on that affect **Games** or **All** count. Weekly unavailabilities and absences of guest players are ignored.",
            "The first two date proposals sent to an opponent must have no absent player. The third proposal tolerates one or two absences and is refused at three or more.",
            "A team block rules a date out completely, whatever the number of absences."
          ]
        },
        {
          "t": "tip",
          "text": "Injured or long-term absent players should switch off **Blocks game scheduling** on their absence, or you do it for them, so the rest of the team can still be scheduled."
        }
      ]
    },
    "jsexport": {
      "title": "J+S export",
      "summary": "Download the Jugend+Sport activity and attendance CSV files for your team, ready for the NDS.",
      "body": [
        {
          "t": "p",
          "text": "**J+S export** builds the two CSV files Jugend+Sport needs, activities and attendance, for one team and season, ready to import into the Nationale Datenbank Sport (NDS). Open it via **Member tools → J+S export** on desktop or **More → Member tools → J+S export** on the phone. Coaches, team responsibles, board members and admins see it; it lists the teams you lead (every active team when admin mode is on)."
        },
        {
          "t": "h",
          "text": "What the two files contain"
        },
        {
          "t": "ul",
          "items": [
            "**Activities**: every non-cancelled training (as Training), every non-cancelled game with an opponent and a start time (as Wettkampf), and every non-cancelled team event with **In scope for J+S** switched on, using the **J+S activity type** chosen in the event form (Training, Wettkampf, Trainingstag or Lagertag).",
            "**Attendance**: one row per activity and person. Roster players count as Teilnehmer/in, coaches and team responsibles as Leiter/in; guest players are not included. Anyone who declined an activity, or has an absence covering its date, is left out."
          ]
        },
        {
          "t": "h",
          "text": "Season and date range"
        },
        {
          "t": "ul",
          "items": [
            "**Season** runs from 1 September to 31 August, the J+S year. It defaults to the season containing today, so in the summer break that is the one you have just finished.",
            "**From** and **To** default to the whole season. Narrow them to control which activities and events are included; the roster stays that of the selected season."
          ]
        },
        {
          "t": "h",
          "text": "Downloading"
        },
        {
          "t": "ol",
          "items": [
            "Pick the **Season** and, if needed, **From** and **To**.",
            "In the team's row, click **Activities** to download the activities file.",
            "Click **Attendance** to download the attendance file."
          ]
        },
        {
          "t": "note",
          "text": "In the NDS, import the activities file first, then the attendance file. Importing activities replaces all activities and attendance already in that course."
        },
        {
          "t": "h",
          "text": "Warnings after a download"
        },
        {
          "t": "ul",
          "items": [
            "**Some people have no J+S number and were skipped**: the names are listed under **Leaders** and **Players**. They stay out of the attendance file until their J+S Personennummer is on record.",
            "**Some trainings have no location or time — J+S requires both and rejects the file without them**: the dates are listed under **No location** and **No time**. Add the hall and start time (see the section Managing trainings, games and events), then download again.",
            "**No participants for this season — the export contains leaders only. Check the selected season.**: the team's roster for that season is empty. The file still downloads, so check the season before importing."
          ]
        },
        {
          "t": "p",
          "text": "Files are semicolon-separated, UTF-8, with dates as dd.mm.yyyy and times as HH:MM. J+S rules apply automatically: games carry no time, duration or location, every training is reported as 90 minutes (J+S accepts only 60, 75 or 90), a Trainingstag as 240 or 300."
        },
        {
          "t": "tip",
          "text": "J+S numbers are kept by the club. If someone is skipped, ask an admin to record their J+S Personennummer, then download both files again."
        }
      ]
    },
    "documents": {
      "title": "Identity documents",
      "summary": "Encrypted ID photos for game day: how players upload them, who can open them, and how to restore access.",
      "body": [
        {
          "t": "p",
          "text": "A player can put a photo of their ID or passport on file so that their coach can show it to a referee before a game. It is encrypted on the player's device before upload; only the player and their teams' current coaches and team responsibles can open it — not the club, not the admins, not the server. Manage yours under **My profile** → **Edit profile** → **Identity document** (phone: **More**, then your profile row)."
        },
        {
          "t": "h",
          "text": "Your encryption key"
        },
        {
          "t": "p",
          "text": "Your key is created silently at sign-in. A device that has never held it asks for your password once (**Create key** or **Unlock**) and keeps the key until you log out or press **Forget my key on this device**. Logging out also wipes documents downloaded for a game."
        },
        {
          "t": "note",
          "text": "Use **Change password** under **Edit profile** — it keeps your key. A reset link or code loses it: documents shared with you stop opening, and your own must be uploaded again."
        },
        {
          "t": "h",
          "text": "Uploading a document"
        },
        {
          "t": "ol",
          "items": [
            "Unlock your key, press **Upload document** and pick a photo or PDF (max 8 MB).",
            "For a photo, move, zoom and rotate it in **Adjust your document**, then press **Use this photo**.",
            "The section then shows the upload date with **Show document**, **Replace** and **Delete**."
          ]
        },
        {
          "t": "h",
          "text": "Who can open a document"
        },
        {
          "t": "p",
          "text": "Access is fixed at upload time to the readers who already have a key; anyone who creates a key later holds nothing until access is restored. Under **Member tools** → **Teams**, open the team: the **ID** column shows who has a document, and since when. **Document access**, next to **Current roster**, opens **Who can open these documents** — one state per staff member and document:"
        },
        {
          "t": "ul",
          "items": [
            "**Can open** — nothing to do.",
            "**Will not open** — their key changed after the upload.",
            "**No key yet** — never granted; fixable from the team page.",
            "**No identity key set up** — they must create a key first; nobody can fix this for them.",
            "**Former staff, still has access** — keeps the key until the player replaces or deletes the document."
          ]
        },
        {
          "t": "h",
          "text": "Restoring access"
        },
        {
          "t": "p",
          "text": "A banner above the roster names colleagues who cannot open documents. Press **Restore access**: your device passes the key on for every document you can open yourself. Nothing is re-uploaded; nobody outside the players' current staff gains access. Your own key must be unlocked on this device; otherwise the banner reads **Unlock your identity key on your profile to restore access**. Players can also close the gap themselves with **Grant access** on their profile."
        },
        {
          "t": "tip",
          "text": "On game day, open the game and use **Show IDs** (from 45 minutes before the start; see the section Match sheet). Check **Document access** the day before, not at the hall."
        }
      ]
    },
    "spielplanung": {
      "title": "Spielplanung",
      "summary": "Scheduling the season's games with opponent clubs: slots, invites, confirmations, Volleymanager and the mailbox.",
      "body": [
        {
          "t": "p",
          "text": "Game scheduling is a separate app: **Admin → Planning & halls → Planning** on desktop (non-admin Spielplaner see a **Planning** button) or **More → Planning** on a phone; your Wiedisync login carries over. Volleyball admins and club-wide Spielplaner get **Dashboard**, **Mailbox**, **Settings** and **Manual game calendar**; per-team Spielplaner, coaches and team responsibles land on **Manual game calendar** (read-only for coaches and team responsibles)."
        },
        {
          "t": "h",
          "text": "Setting up a season"
        },
        {
          "t": "ol",
          "items": [
            "In **Settings**, **Create New Season**, link the SVRZ season and set the **Feed takeover date**.",
            "Define **Game Saturdays**, pick each team's slot sources under **Team Configuration**, then **Generate Game Slots** (regenerating only replaces unbooked slots).",
            "Set **Game spacing (days)** and **Team links** (volleyball admins only) for teams sharing players or coaches, then **Open for Booking**.",
            "**Close Booking** stops new opponents; bookings stay. **Archive season** is reversible with **Restore season**; expired invites stay expired."
          ]
        },
        {
          "t": "h",
          "text": "Inviting opponents"
        },
        {
          "t": "p",
          "text": "Under **Manage invites**, **Import from SVRZ** fetches opponents and contacts; **Email invites** shows every email before sending. Links expire on 30 June of the season's end year. The opponent picks up to three home slots and proposes up to three away dates. Only the first choice is held; the others stay open to other clubs."
        },
        {
          "t": "h",
          "text": "Confirming games"
        },
        {
          "t": "p",
          "text": "On the **Dashboard**, expand a team and open an opponent's **Home Bookings** or **Away Proposals**. Each proposal is re-checked live and shows why it no longer fits. **Confirm Proposal** books the slot, emails the opponent, runs the Saturday hall optimisation and pushes the home game to Volleymanager. **Enter an agreed game manually** records a phone agreement without an email. **Notify coaches** emails the schedule; it asks first if matchups are still open."
        },
        {
          "t": "note",
          "text": "**Delete game** frees the slot but leaves the game in Volleymanager; remove it there by hand. Games differing from Volleymanager are flagged after the nightly sync; use **Re-push to VM** or **Sync with VM**."
        },
        {
          "t": "p",
          "text": "**Mailbox** is the shared inbox spielplanung@volleyball.kscw.ch: **Check mail** syncs it, emails match opponents automatically, **Belongs to** pins a chain by hand, and every confirmation is copied here."
        },
        {
          "t": "h",
          "text": "Basketball (ProBasket)"
        },
        {
          "t": "p",
          "text": "Under the **Basketball** pill, the **Planner** prepares the ProBasket Spielplansitzung: **Put game here** in a free KWI slot or **Add away game**, then **Export selected team** or **Export automatic teams** (Lions D1 and Herren 1); placements stay provisional until then. In **Settings**, offer home games under **Games offered to opponents** and send each club one link under **Opponent clubs**; ticked dates are availabilities, not reservations."
        },
        {
          "t": "note",
          "text": "Dates are blocked by **Blocked dates (whole club)** in **Settings** (superadmin only), team blocks under **Team absences** (see the section Team absences and blocks) and hall closures. In the **Manual game calendar**, a club-blocked day (home games), the same team twice on one day or a hall overlap refuses the save; the same team within two days only warns."
        }
      ]
    },
    "hallenplanadmin": {
      "title": "Hallenplan administration",
      "summary": "Halls, weekly hall slots, closures, the hall administration calendar sync, and how slots become trainings.",
      "body": [
        {
          "t": "p",
          "text": "Admins maintain the hall grid members see in the calendar. Open **Admin → Planning & halls → Hall slots** (desktop) or **More → Admin → Planning & halls → Hall slots** (phone) and switch **Admin mode** on: the toolbar buttons **Closures** and **Halls**, and editing any team's slots, need it."
        },
        {
          "t": "h",
          "text": "Halls"
        },
        {
          "t": "p",
          "text": "**Manage halls** lists the venues every slot, training and home game points at; a hall must exist here before a team can get a slot in it. **Add hall** asks for **Name**, **Address**, **Courts**, a **Maps link** and **Homologated** (approved for league games). Deleting a hall previews what goes with it and cannot be undone."
        },
        {
          "t": "h",
          "text": "Slots and the trainings they generate"
        },
        {
          "t": "ol",
          "items": [
            "Click an empty grid cell for **New slot** or an existing slot for **Edit slot**.",
            "Pick the **Hall** (**KWI A+B** creates a slot in each of the two halls), **Team**, **Day of week**, **Type**, **Start time** and **End time**.",
            "A **Recurring** slot repeats weekly between **Valid from** and **Valid to**, or **Indefinitely**.",
            "Tick **Free training slot** to leave the slot without a team so any coach can claim it. **Overlap detected:** warns about other slots in the same hall."
          ]
        },
        {
          "t": "note",
          "text": "A slot of type **Training** is a template. Saving it creates the real trainings: up to **Valid to** for a dated slot, about 12 weeks ahead for an indefinite one, topped up every night. Editing the slot moves or trims its future trainings; deleting it deletes them with their sign-ups. Past trainings are never touched."
        },
        {
          "t": "h",
          "text": "Closures"
        },
        {
          "t": "p",
          "text": "**Manage hall closures** lists the days a hall is shut. A closure hides the hall in the hall grid, appears in the calendar and iCal feed, blocks home games there and cancels trainings on those days; delete it and the trainings come back. **Add new closure** takes one or more **Halls** (presets **KWI** and **All halls**), **From** and **To** dates, a **Reason** and a **Source**."
        },
        {
          "t": "note",
          "text": "Use **Admin** or **Caretaker** as source for a closure you enter yourself. **Google Calendar** and **School holidays** belong to automatic syncs, which delete hand-made rows under those sources on their next run."
        },
        {
          "t": "h",
          "text": "Google Calendar and hall events"
        },
        {
          "t": "p",
          "text": "Every night the app syncs with the KWI hall administration's Google calendar. Each of their entries becomes a closure of the KWI halls (source **Google Calendar**) and shows on the hall grid as a hall event; our KWI home games are written to their calendar. Under **Hall administration calendar**, mark an entry that is not really a closure as **Not a closure** and the trainings it cancelled come back; **Close the halls** confirms a real one. **Publish** sends your own closure to their calendar as a KSCW booking; **They have it** means they already cover it."
        },
        {
          "t": "tip",
          "text": "City of Zürich school holidays are imported automatically as closures of every hall."
        }
      ]
    },
    "scorerassign": {
      "title": "Assigning scorer duties",
      "summary": "Auto-assign duty teams to home games, correct them by hand, and track who has signed up.",
      "body": [
        {
          "t": "p",
          "text": "Open **Admin → Game operations → Scorer assignment** (desktop) or **More → Admin → Game operations → Scorer assignment** (phone). You need volleyball or basketball admin access. The page covers the current **Season**. **Assignment** is where you plan; **Overview** shows what is saved on the games."
        },
        {
          "t": "h",
          "text": "Running the automatic assignment"
        },
        {
          "t": "ol",
          "items": [
            "Tap **Run algorithm**. A draft appears with one row per home game and a **Notes** column flagging clashes and open spots.",
            "Correct rows with **Select team** and **Select person** per duty. Red rows have no team; cup games are **On call** and get nobody unless you pick someone.",
            "Tap **Roll out** to write the duty teams and picked persons onto the games. Only then are they official and visible on **Scorer duty**."
          ]
        },
        {
          "t": "ul",
          "items": [
            "Volleyball duties depend on the playing team's level (combined Scorer/Scoreboard, separate scorer with licence plus scoreboard, or referee only for HU20); basketball uses one duty team per game.",
            "Hard rules exclude a team (own game at the same time, a duty the same day, no member with the needed licence); soft rules score the rest from 100 points. Expand **Algorithm rules** for the values.",
            "Games already assigned show **Existing assignment kept** and stay untouched unless edited."
          ]
        },
        {
          "t": "note",
          "text": "The draft lives only in your browser (**Draft saved**); nobody else sees it until you roll out. **Recompute** rebuilds it from the saved games and discards unsaved edits. Rolling out a new duty team clears a signed-up person who is not in it."
        },
        {
          "t": "h",
          "text": "Team summary and credits"
        },
        {
          "t": "p",
          "text": "**Team summary** shows each team's **Games**, duties per role and **Total**. **Referees** counts referee licences as duties already done (capped at 2). Enter a **Credit** to excuse a team from duties; it saves at once, but run the algorithm again to apply it."
        },
        {
          "t": "tip",
          "text": "**Download Excel** exports the draft and team summary. Edit the team columns and **Upload corrected** applies them back, matched by **Game no.**."
        },
        {
          "t": "h",
          "text": "After roll-out: checking and manual changes"
        },
        {
          "t": "p",
          "text": "The **Overview** tab lists every saved duty spot with **Signed up** and **Status**; filter with **Only show empty spots** or **Include past games**. To change one duty later, open **Member tools → Scorer duty** with **Admin mode** on: each home game card offers **Select team** and **Select person**, and **Confirmed by** shows who took it and when. Only eligible active members are listed, and editing locks once the game starts."
        },
        {
          "t": "h",
          "text": "The scorer's roster and the Einsatzliste"
        },
        {
          "t": "p",
          "text": "Shortly before the start the assigned scorer gets a **Roster** button: the coach's saved match sheet, otherwise the Einsatzliste filed in Volleymanager, otherwise the confirmed players. Volleyball teams can file it automatically about an hour before the start: **Auto-file Einsatzliste** under **Game Defaults** in the roster editor, overridable per game with **Auto Einsatzliste**. See the sections Match sheet and Roster editor."
        }
      ]
    },
    "registrations": {
      "title": "Registrations",
      "summary": "Reviewing new club registrations: data checks, documents, approval, invites and the ClubDesk link.",
      "body": [
        {
          "t": "p",
          "text": "New registrations arrive from the kscw.ch website form. Open **Admin → Members & communication → Registrations** (phone: **More → Admin → Members & communication → Registrations**). You also get an email per new registration; switch it off with **New registrations** under **Email notifications** on your profile. The list is grouped into **Volleyball**, **Basketball** and **Passive**; the status filter shows **Pending** by default, or **Approved**, **Rejected** and **All statuses**. Sport admins see only their sport, global admins everything."
        },
        {
          "t": "h",
          "text": "Reviewing a registration"
        },
        {
          "t": "ol",
          "items": [
            "Tap **Show details**, correct what is wrong, then **Save**.",
            "Look at the duplicate badge: **Already a member**, **Returning member** or **Possible duplicate**. **Review & merge** compares the two records field by field; **Merge N field(s)** links the registration to that member without approving it.",
            "Check **Team**: on approval the applicant joins the roster of every active team named there (a matching team shows as a chip). A coach or team responsible function is never granted automatically — use the roster editor afterwards.",
            "**Approve** or **Reject**. Rejecting needs a **Reason**, which the applicant receives by email."
          ]
        },
        {
          "t": "note",
          "text": "Approving a flagged row without merging first creates a second member record. Merge, then approve or reject."
        },
        {
          "t": "h",
          "text": "What approval does"
        },
        {
          "t": "p",
          "text": "Approval creates or links the member record, emails the applicant a single-use link to create their account (the team's coaches and team responsibles in copy) and notifies the sport admins. The ClubDesk contact is created at the next **Sync up** — do not create it by hand. **Resend invite** on an approved row sends a fresh invite."
        },
        {
          "t": "h",
          "text": "Basketball documents"
        },
        {
          "t": "p",
          "text": "Basketball registrations must carry their documents before **Approve** goes through: always **ID front**, **ID back** and **Licence application**; depending on **Licence situation**, nationality and age also **Release letter (Freibrief)**, **Self declaration**, **National team decl.** and **Parental consent (U18)**. **School certificate (optional)** is never required. Volleyball and passive registrations have no document gate."
        },
        {
          "t": "ul",
          "items": [
            "**Upload** or **Replace** a file yourself: JPG, PNG, WebP or PDF, max 10 MB.",
            "**Request documents** emails the applicant a re-upload link (also on approved rows; the status never changes). Tick several rows and use the **Request documents** button in the selection bar for a bulk send. Edit the wording under **Admin → Club email → Email templates**; its **Sent** tab archives every email sent from a template.",
            "**Approve anyway**: give a reason, then **Waive and approve**. The waiver is stamped with your name and shown as **Documents waived**."
          ]
        },
        {
          "t": "h",
          "text": "After approval"
        },
        {
          "t": "ul",
          "items": [
            "**Licence status**: set **No licence**, **To be ordered**, **Ordered**, **Finalized** or **Licenced**; the member is notified. **Licenced** is normally set by the Swiss Volley / Basketplan sync.",
            "**ClubDesk sync** (global admins only): **In ClubDesk**, **Found in ClubDesk but not linked yet** (use **Link**) or **Not in ClubDesk** (use **Sync to ClubDesk**).",
            "**CSV for ClubDesk** downloads the ticked rows in ClubDesk's column layout."
          ]
        }
      ]
    },
    "announcements": {
      "title": "Club communication",
      "summary": "Publishing club news, emailing groups of members with merge fields, and the shared club mailbox.",
      "body": [
        {
          "t": "p",
          "text": "Club news reaches members in the app (News card, bell) and optionally by push or email. **Email a group** sends personalised mass mail from the shared club mailbox."
        },
        {
          "t": "h",
          "text": "Club news"
        },
        {
          "t": "p",
          "text": "Open **Admin → Members & communication → Announcements** (phone: **More → Admin → Members & communication → Announcements**), then **New post**."
        },
        {
          "t": "ul",
          "items": [
            "Write a **Title** and text per language tab. German is required; members read their app language, falling back to German.",
            "Add a **Hero image** (PNG, JPEG or WebP, max 5 MB) and a **Link (optional)** starting with https:// or /.",
            "**Audience**: **All members** (every active app member), **A sport**, **Specific teams** (players, coaches, team responsibles, captains) or **Roles and functions**. Sport admins can only target their own sport or its teams.",
            "**Pin to top of News card** keeps the post first; after the **Expiry date (optional)** it leaves the feed.",
            "Tick **Publish (visible immediately)** to go live. Only then can you tick **Send push notification** and **Send email**; for email pick the **Email layout** (**Standard** or **Newsletter**) and a **Reply-to** (empty means no-reply)."
          ]
        },
        {
          "t": "note",
          "text": "Publishing sends once: every recipient gets a bell entry, push and email only if ticked. Edits never re-send; deleting cannot be undone. Email skips members who turned off **Club news** under **Email notifications** on their profile, plus bounced addresses."
        },
        {
          "t": "h",
          "text": "Club mailbox"
        },
        {
          "t": "p",
          "text": "**Admin → Club email → Club mailbox** is the shared inbox, for the admin and superuser roles only. Read **Inbox** and **Sent**, press **Check mail**, and use **New email**, **Reply**, **Reply all** or **Forward**. The club **Signature** is added automatically. A plain email (**To** plus **Cc**) is one shared copy of at most 50 addresses; larger lists need **Email a group**."
        },
        {
          "t": "h",
          "text": "Email a group"
        },
        {
          "t": "ol",
          "items": [
            "Press **Email a group** and pick groups under **Membership**, **Sections**, **Players**, **Roles & functions**, **Teams** or **Former members**, optionally narrowed by **Season**. **Show people individually** unfolds a group so you can remove single people; **Paste a list of addresses** adds them.",
            "The preview shows how many members receive the email and how many are skipped (no email address, opted out, shared address, bounced).",
            "Write the subject and message. `{{vorname}}` and `{{nachname}}` (or `{{first_name}}`, `{{last_name}}`) become each recipient's name; `{{name}}`, `{{email}}`, `{{beitragskategorie}}`, `{{mitgliederbeitrag}}` and `{{team}}` also work. Unknown fields are struck through and sent as written.",
            "Press **Preview message** to see it as three real recipients would, then **Send to** and confirm."
          ]
        },
        {
          "t": "note",
          "text": "Each recipient gets their own copy, nobody sees the other addresses, and the send cannot be undone. **Cc** and **Bcc** get one shared copy (at most 50 addresses). **Members** means everyone in the club register, not only app users. Members opt out with the **Club news** switch on their profile; group emails also carry an unsubscribe header, and such requests are handled by hand."
        }
      ]
    },
    "clubfinance": {
      "title": "Club finances",
      "summary": "Dues runs, invoices, reminders, books, budget, members, expenses and payouts for finance and board.",
      "body": [
        {
          "t": "p",
          "text": "**Club finances**, under **Finances → Club finance** (**More** first on a phone), is for the finance role and the board. Pick the **Fiscal year** first; most tabs read it."
        },
        {
          "t": "h",
          "text": "Billing"
        },
        {
          "t": "ul",
          "items": [
            "**Dues run**: set **Dues rates** per category, tick categories, choose a **Due date**, **Preview**, then **Issue … invoices**. Each member gets a QR-bill; coaches, board and honorary members get a CHF 0.00 invoice showing the waiver. Past runs offer **Download bills**, **Email** and **Cancel run**.",
            "**Invoices**: the season's invoices, native and ClubDesk-mirrored. **New invoice** bills a member, a team or an outside contact. Per row: **Confirm** a payment, **Payments** (partial payments, credit notes, refunds, write-offs), **Cancel**, or **Link to member**. **Bank reconciliation (camt)** confirms invoices from a bank export.",
            "**Reminders**: overdue Wiedisync invoices. Send reminders 1 to 3 in order, optionally with a **Reminder fee (CHF)** and an email; **Never remind** excludes a member. Nothing is automatic."
          ]
        },
        {
          "t": "note",
          "text": "Issuing never emails anyone — use **Email** on the run. Sending starts in test mode: every message goes to the test recipient until you click **Turn off (go live)** and type the member count. **Cancel run** voids still-open invoices; paid ones stay."
        },
        {
          "t": "h",
          "text": "Books and reports"
        },
        {
          "t": "ul",
          "items": [
            "**Overview**, **Income statement**, **Balance sheet** and **Accounts** mirror the ClubDesk books, refreshed nightly at 04:00 or via **Sync now**. **Export** on the income statement and balance sheet gives PDF, Excel or PowerPoint.",
            "**Budget**: budget versus actual per account; a typed budget saves by itself.",
            "**Ledger**: Wiedisync's own double-entry book — **Journal**, **Accounts**, **Trial balance**, **Year-end close**, **Auto-posting**. Map the control accounts, then switch on **Post journal entries automatically**."
          ]
        },
        {
          "t": "h",
          "text": "Records"
        },
        {
          "t": "ul",
          "items": [
            "**Members**: IBAN, category, contacts and invoices per member; **Bill a different contact** for minors or companies, **Attach PDF**, or **Show pay-out QR** then **Save & download** to reimburse by hand. Only the finance role (or an admin in admin mode) edits here.",
            "**Teams**: sponsoring, income and expenses per team via **Add entry**, plus the season-end **Referee reimbursement**: **Preview**, then **Create payouts**, one per member. No Swiss or Liechtenstein IBAN, or no postal code and city: skipped and listed.",
            "**Expenses**: receipts uploaded by members. Set **Paid** or **Rejected** — the member is notified in-app, by push and by email with your **Note to the member**; **Paid** also creates the payout. The **Internal note** stays hidden."
          ]
        },
        {
          "t": "p",
          "text": "**Confirm expenses** (**Finances → Club finance**) lets sport admins and finance confirm a reimbursement is budgeted and tick **Section already reimbursed the member**; it never changes the member's status. **Referee expenses** (**Admin → Game operations**) lists recorded referee fees by volleyball team and season, with **CSV export**."
        },
        {
          "t": "note",
          "text": "A closed fiscal year refuses every change (confirmations, cancellations, team entries, the referee run); correct in an open year. Every change is logged under your name. Members' side: see the sections Bills & reimbursements and Team finance."
        }
      ]
    },
    "explorer": {
      "title": "Database and SQL workspace",
      "summary": "Browse, filter and edit member data in the Database, and run queries in the SQL workspace.",
      "body": [
        {
          "t": "p",
          "text": "The **Database** page is the admin view of every member, team, event, training and game. Open it via **Admin → Data & insights → Database** (desktop) or **More → Admin → Data & insights → Database** (phone). Sport admins see their own sport; club admins see everything."
        },
        {
          "t": "h",
          "text": "Finding people"
        },
        {
          "t": "ul",
          "items": [
            "**Search all…** searches every bucket at once.",
            "**Filters** narrows members by sport, gender, positions, licences, roles, membership status, dues paid and more. By default only members with **KSCW membership active** are shown; change that filter to see former or passive members.",
            "**Datapoint** picks one or more fields: the detail shows only those, the grid adds them as columns. **Show all fields** clears it.",
            "Switch between **Tree** and **Grid** in the **View** toggle. The grid offers **Columns**, **Group by** and **Export** as **Excel (.xlsx)** or **PDF**, always with English headers."
          ]
        },
        {
          "t": "h",
          "text": "Editing members"
        },
        {
          "t": "p",
          "text": "Open a member from the tree or with **Open details** in the grid. **All fields** lists every column by topic; empty and technical columns stay hidden until you press **Show empty fields** or **Show technical fields**. Press **Edit**, change what you need and **Save**. Every save writes only the changed fields and is audit-logged. Roles and Spielplaner rights can only be changed by a club admin. A field marked **Overwritten by sync** is editable, but the next sync replaces your value."
        },
        {
          "t": "p",
          "text": "For many members, tick rows in the grid and choose **Bulk edit**. Add datapoints with **Set value**, **Clear**, **Add** or **Remove** and apply them to all selected members; members who already hold the value are skipped. **Mark as departed** ends the membership of everyone selected with one status and exit date."
        },
        {
          "t": "note",
          "text": "Bulk changes cannot be undone. Read the preview of how many members will change before you apply."
        },
        {
          "t": "h",
          "text": "Danger zone"
        },
        {
          "t": "p",
          "text": "At the bottom of a member detail, **Danger zone** switches **Club membership** and **App access** immediately. When someone leaves, use **Member left**: it sets the register status and exit date, switches off membership and app access, and removes this season's rosters. **Delete permanently** shows every dependent record first and asks you to type DELETE. The ClubDesk contact is never deleted."
        },
        {
          "t": "note",
          "text": "Switching **Club membership** off is not a departure: no exit date is set and nothing reaches ClubDesk. Use **Member left** instead."
        },
        {
          "t": "h",
          "text": "SQL workspace (superadmins)"
        },
        {
          "t": "p",
          "text": "**Admin → Superadmin → SQL workspace** runs read-only queries; press **Run** or Ctrl/Cmd-Enter. Results are capped at 1000 rows and export as **CSV** or **Excel**. Your last 20 queries stay under **Recent** (this browser only). **Ask AI** turns a plain-language request into SQL and keeps recent questions in **Memory**, so a follow-up refines the same query. Turn on **Write mode** only to change data. Every run is logged with the SQL and your name."
        }
      ]
    },
    "admintools": {
      "title": "Admin tools",
      "summary": "Where every admin page lives, what each one is for, and how admin mode changes what you see.",
      "body": [
        {
          "t": "p",
          "text": "Admin pages sit under **Admin** in the desktop top bar, or **More → Admin** on a phone. **All admin tools** opens a searchable table of every page you may open, with **Section** and **Access** (**Admin**, **Club admin** or **Superadmin**)."
        },
        {
          "t": "h",
          "text": "Admin mode"
        },
        {
          "t": "p",
          "text": "**Admin mode** under **Options** changes data scope, not the menu: on, every team appears in calendar, games, trainings, events and absences, and sport admins get coach powers on team pages; off, you see what a member sees. Admin pages open in either mode. The switch, the gold banner and the board-member variant are described in the section Finding your way around."
        },
        {
          "t": "h",
          "text": "The admin pages"
        },
        {
          "t": "ul",
          "items": [
            "**Planning & halls**: **Planning** (see the section Spielplanung), **Hall slots** with halls and closures (see the section Hallenplan administration) and **Hall finder** (free city halls).",
            "**Game operations**: **Scorer assignment** (see the section Assigning scorer duties); **Volley referees** maps referees to the teams they cover (the weekly sync re-adds licensed ones); **Referee expenses** (read-only).",
            "**Members & communication**: **Registrations** and **Announcements** (see the sections Registrations and Club communication); **Transfers** for international transfers (**Check VIS now** asks FIVB); **Volley feedback**, survey results.",
            "**Club email**: **Club mailbox** (club admins only), **Email templates**, **Emails garage** with every club mailbox and password.",
            "**Data & insights**: **Database** (see the section Database and SQL workspace) and **Club stats** (rosters, licences, scorer coverage)."
          ]
        },
        {
          "t": "h",
          "text": "Superadmin tools"
        },
        {
          "t": "ul",
          "items": [
            "**Infrastructure**: health of services, syncs and cron jobs; **Run now** starts any sync early, but Volleymanager and SVRZ never run at once.",
            "**Data health**: the **ClubDesk sync** tab walks the guided path (**1. Sync down** to **5. Fix groups**) with **Do the next step**; each difference waits for your decision (**ClubDesk** or **Wiedisync** wins). **Club-wide** scans games, members, fees and scorer licences, with **Fix all**.",
            "**Households** (see the section Households and family accounts).",
            "**Audit log**: data changes, logins and system events, 90 days back.",
            "**Error logs**: live app and website errors, with **Archive**, **Important** and **Mute all like this** for triage.",
            "**SQL workspace** (see the section Database and SQL workspace) and **Bugfixes**: **Fix** starts an automated fix, **Deploy to dev** and **Deploy to prod** ship it; shipped fixes appear under **Options → Status**."
          ]
        },
        {
          "t": "h",
          "text": "Roles, licences and teams"
        },
        {
          "t": "p",
          "text": "Roles and the club-wide Spielplaner flag are set on the member in **Database** under **Roles & access**, by club admins only. Licence status (**No licence** to **Licenced**) is edited there too; **Licenced** normally comes from the Swiss Volley / Basketplan sync, which never demotes. Teams are not created in the app; staff are attached with **Manage staff** on the team page in admin mode (see the section Roster editor)."
        },
        {
          "t": "note",
          "text": "Danger-zone actions, password reveals and **View as this member** land in the **Audit log** under your name; SQL runs are recorded too. Bulk edits, **Member left** and deletions cannot be undone."
        }
      ]
    }
  }
}
