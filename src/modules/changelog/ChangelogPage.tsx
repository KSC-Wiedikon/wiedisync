import { useTranslation } from 'react-i18next'
import { ScrollText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'

const APP_VERSION = '1.3.0'

interface ChangelogEntry {
  version: string
  date: string
  sections: { title: string; items: string[] }[]
}

const CHANGELOG: ChangelogEntry[] = [
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
