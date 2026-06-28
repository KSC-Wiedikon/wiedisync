import { useTranslation } from 'react-i18next'
import { ScrollText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'

const APP_VERSION = '1.14.0'

interface ChangelogEntry {
  version: string
  date: string
  sections: { title: string; items: string[] }[]
}

const CHANGELOG: ChangelogEntry[] = [
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
