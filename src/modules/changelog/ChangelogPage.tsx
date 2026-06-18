import { useTranslation } from 'react-i18next'
import { ScrollText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'

const APP_VERSION = '5.0.0'

interface ChangelogEntry {
  version: string
  date: string
  sections: { title: string; items: string[] }[]
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '5.0.0',
    date: '18.06.2026',
    sections: [
      {
        title: 'Club finances',
        items: [
          'New Finances section: board members get a club finance dashboard — liquidity, income vs expenses, result, outstanding invoices and recent bookings. Every member can see their own dues under "Your dues".',
          'The figures are a read-only mirror of ClubDesk — synced in, not edited here.',
        ],
      },
    ],
  },
  {
    version: '4.29.0',
    date: '12.06.2026',
    sections: [
      {
        title: 'Scheduled games on your calendar',
        items: [
          'Games booked through the scheduling tool now appear on the app calendars right away — no more waiting for the official Swiss Volley feed.',
        ],
      },
      {
        title: 'Scheduling dashboard',
        items: [
          'New "Available slots" view per team: every still-offerable home date with its booking conditions, plus the dates the team cannot play away — copy it as text for an opponent email or download it as CSV.',
          'The games list per opponent now shows each fixture\'s official SVRZ game number and no longer squeezes long names into one line.',
          'New search box: find an opponent card by team, club, contact or any booked/proposed date across all teams.',
        ],
      },
    ],
  },
  {
    version: '4.28.0',
    date: '10.06.2026',
    sections: [
      {
        title: 'Confirmed home games sync to VolleyManager',
        items: [
          'When you confirm a home game, its date, time and hall are now written straight into VolleyManager — no more editing each game by hand there.',
          'Each confirmed home game shows its VolleyManager status (in VM / sending / failed) with a "Push to VM" button to retry.',
          'When two home games match the same opponent, you choose which VolleyManager fixture to update.',
        ],
      },
      {
        title: 'Scheduling mailbox',
        items: [
          'Opponent replies to scheduling emails now appear right inside the Terminplanung dashboard — the club mailbox syncs in automatically, so you can read and answer without leaving the app.',
        ],
      },
      {
        title: 'Fixes & polish',
        items: [
          'Broadcasts now reach the right people — the "waitlisted" and "not yet replied" audiences were quietly matching nobody.',
          'Game dates no longer show as "Invalid Date" on iPhone in the scorer view.',
          '"Coach present" now appears correctly on the trainings, games and calendar pages.',
          'Dates always display in Swiss format (dd.mm.yyyy), whatever your phone\'s language.',
          'A broad security and reliability hardening pass across scheduling, permissions and notifications.',
        ],
      },
    ],
  },
  {
    version: '4.27.0',
    date: '09.06.2026',
    sections: [
      {
        title: 'Scheduling remarks',
        items: [
          'You can now leave a note for an opponent that shows on their scheduling page — and opponents can write a remark back to you. Both appear in the scheduling dashboard.',
        ],
      },
    ],
  },
  {
    version: '4.26.0',
    date: '08.06.2026',
    sections: [
      {
        title: 'Game scheduling improvements',
        items: [
          'When an opponent’s proposed home slots are no longer available — taken by another game, a hall closure, or too close to another match — the scheduling dashboard now flags them, and lets you email the opponent to pick three new slots in one click.',
          'The season overview calendar now shows game-Saturdays in gold and hall closures with a red background.',
        ],
      },
    ],
  },
  {
    version: '4.25.0',
    date: '08.06.2026',
    sections: [
      {
        title: 'Intra-club derby dates (game scheduling)',
        items: [
          'When two KSC Wiedikon teams play in the same league group (e.g. H1 and H3 in 2L), league rules require their two head-to-head games to be the first game of the Vorrunde and of the Rückrunde — otherwise the home team forfeits.',
          'The scheduling setup now detects these pairs automatically and lets you fix the two derby dates. Once confirmed, opponents can only book home slots and away dates after them, so the derby always stays first.',
        ],
      },
    ],
  },
  {
    version: '4.24.1',
    date: '08.06.2026',
    sections: [
      {
        title: 'Coaches on the team page',
        items: [
          'Coaches now have their own section on the team page, separate from the players. A coach who does not also play is no longer listed among the players.',
          'Team chat now only appears on team pages you are actually part of — it no longer shows up (or gets stuck on "Loading messages") for teams you do not belong to.',
        ],
      },
    ],
  },
  {
    version: '4.23.3',
    date: '08.06.2026',
    sections: [
      {
        title: 'Match scheduling fixes',
        items: [
          'Opening a scheduling invite link no longer occasionally showed "Invalid link" on the first try — it now opens reliably the first time.',
          'In the scheduling dashboard, the "also proposed by another club" note now counts only other clubs that proposed the very same home slot, instead of mistakenly including the same club\'s own away date.',
          'Scheduling emails now use the branded KSC Wiedikon layout and show Swiss dates (dd.mm.yyyy) instead of raw timestamps.',
        ],
      },
    ],
  },
  {
    version: '4.23.2',
    date: '08.06.2026',
    sections: [
      {
        title: 'Tidier player tags',
        items: [
          'Player tags (captain, guest, coach) now line up in their own column in the attendance list and the team guests table, instead of trailing each name at uneven spots.',
        ],
      },
    ],
  },
  {
    version: '4.23.1',
    date: '07.06.2026',
    sections: [
      {
        title: 'Picture uploads fixed',
        items: [
          'Uploading a team picture, a profile photo or a sponsor logo now actually saves — it used to show "Saved" without storing anything.',
          'Your new picture appears straight away, without reloading the page.',
        ],
      },
    ],
  },
  {
    version: '4.23',
    date: '07.06.2026',
    sections: [
      {
        title: 'Leave a team, clearer settings',
        items: [
          'You can now leave a team straight from the Teams page — the new "Manage teams" button lets you both request to join a team and step out of one you\'re already on.',
          'Fixed an error that broke the team roster editor and the home page when loading fine rules.',
        ],
      },
    ],
  },
  {
    version: '4.22',
    date: '05.06.2026',
    sections: [
      {
        title: 'Forms — responses, reminders, files & public forms',
        items: [
          'You now get a notification (and a push) the moment someone responds to a form you manage — no more re-opening the responses view to check.',
          'Open the responses to see how many of the targeted members have answered, and send a one-tap reminder to everyone who hasn\'t yet.',
          'Members can edit their own response while a form is still open, and you can show a custom thank-you message after submitting.',
          'New "File upload" field type so people can attach a document or photo, plus per-language field labels so a club-wide form reads natively in everyone\'s language.',
          'Mark a form "public" and it gets its own shareable link automatically — anyone can fill it in with no login (great for trial-training sign-ups or public registrations). Spam-protected, copy-link ready.',
        ],
      },
    ],
  },
  {
    version: '4.21',
    date: '05.06.2026',
    sections: [
      {
        title: 'Forms — build and share custom forms',
        items: [
          'New "Forms" section: build a form with your own fields (short text, long text, single or multiple choice, number, date, yes/no), then open it to the whole club or to specific teams.',
          'Members fill open forms from the Forms page. You can allow anonymous responses (great for honest surveys) or limit it to one response per person.',
          'See every response in a table and export it to Excel, CSV, JSON or PDF.',
          'When you open a form, the right people get a notification and a push so they know to fill it in.',
        ],
      },
    ],
  },
  {
    version: '4.17 – 4.20',
    date: '01.06.2026 – 03.06.2026',
    sections: [
      {
        title: 'Absences, auto sign-in & live team data',
        items: [
          'Mark an absence as non-blocking — the player still shows as away for their own games and trainings, but those dates stay open for scheduling the rest of the team (handy for a long-term injury or maternity leave).',
          'The team absence calendar now lets you pick several teams at once, and shows someone who\'s both absent and unavailable on a day as a single "Absent / Unavailable" row instead of twice.',
          'New "Auto sign-in" toggles in your profile (trainings, games, events) confirm you automatically for new activities of that type — you only act when you can\'t make it, and absences still win.',
          'Team names and leagues now sync live from Volleymanager, so they stay correct after a division change or season swap — no more stale labels. Referee licences sync too.',
          'Admins get a "Run now" button per data source on the status page, and the June season rollover no longer leaves games, rankings or the hall plan looking empty.',
        ],
      },
    ],
  },
  {
    version: '4.14 – 4.16',
    date: '30.05.2026 – 01.06.2026',
    sections: [
      {
        title: 'Fines, and install the app on your phone',
        items: [
          'Fines (new): coaches and team responsibles can issue fines with per-team escalation tiers (late sign-in, no-show, late payment or custom). You see your outstanding fines on the fines page and your profile; leaders can waive one with a reason.',
          'Late-confirmation prompt: confirming a member past the sign-up deadline pops up a fine pre-filled from the team\'s escalation rules — always leader-confirmed, never silent.',
          'Install Wiedisync on your phone home screen for full-screen access — one tap on Android, a guided "Share → Add to Home Screen" on iPhone.',
          'Scorer duty Games view gets an "All" / "Selected" toggle to switch between every duty you can see and just the ones you signed up for.',
          'Fixes & polish: the fines page no longer flashes an empty table while loading, and excluded guests no longer clutter the roster view.',
        ],
      },
    ],
  },
  {
    version: '4.9 – 4.13',
    date: '13.05.2026 – 21.05.2026',
    sections: [
      {
        title: 'Auto-confirm RSVP everywhere, a smarter hall plan, new admin tools',
        items: [
          'Auto-confirm RSVP now works across the board: trainings start from the team\'s default, leaders can override it per activity, and turning it on backfills all future activities. You only act when you can\'t attend.',
          'Hall-plan slot edits cascade everywhere — change a training\'s time and every future session updates in place, keeping RSVPs and notes. Open-ended slots keep a rolling calendar instead of stopping abruptly, and deleting a slot tidies up its trainings.',
          'Cancel a training, event or game straight from the calendar: the team is notified, the activity dims, RSVPs freeze, and a cancelled training frees its hall slot for others to claim.',
          'Coaches can log a player\'s absence on their behalf, shown with who added it; the player is notified and always sees the reason.',
          'Two new admin tools: filter members in the Data Explorer (sport, position, licence, contact, consent), and a superuser-only SQL workspace with live schema autocomplete and CSV / Excel export.',
          'Fixes & polish: trial trainings no longer create duplicates, an email address is now required, and dates render consistently as dd.mm.yyyy.',
        ],
      },
    ],
  },
  {
    version: '4.8',
    date: '12.05.2026',
    sections: [
      {
        title: 'Auto-confirm attendance + a deep security pass',
        items: [
          'Auto-confirm RSVP arrives (opt-out attendance, PlayerPlus-style): switch it on in team settings and new trainings or games start with everyone confirmed — you only act if you can\'t make it. Absences still block confirmation.',
          'Coaches and team responsibles can see and manage their team\'s trainings and events even when they\'re not on the roster, and can edit team settings again.',
          'A coach\'s own RSVP now shows in the participation modal\'s staff section, and staff appear there before they reply.',
          'Security: a deep audit closed a batch of findings — notification and audit-log access tightened, inputs escaped, push targets validated and login hardened.',
          'Fixes & polish: clearer error messages, and a future-dated absence no longer declines activities before it starts.',
        ],
      },
    ],
  },
  {
    version: '4.4 – 4.7',
    date: '25.04.2026 – 10.05.2026',
    sections: [
      {
        title: 'Tables everywhere, coach dashboard, roster export, Swiss date format',
        items: [
          'Data lists across the app — rosters, announcements, audit logs, registrations, referee expenses, absences — are now proper tables that compact cleanly on mobile.',
          'The coach dashboard expands: per-team date ranges, a unified absence view, and full editing and roster access on trainings, games and events alike.',
          'Export a roster as CSV, PNG or PDF, with an activity header, a position summary and the columns you choose.',
          'Your stated availability stays in sync: a weekly unavailability now overrides an existing "confirmed", and absence overlaps are respected in every view, not just the roster modal.',
          'Coaches can edit a player\'s note from the roster modal, shown with who edited it and when.',
          'Dates now read dd.mm.yyyy and times 24-hour HH:MM everywhere, regardless of your browser language.',
        ],
      },
    ],
  },
  {
    version: '4.0 – 4.3',
    date: '20.04.2026 – 24.04.2026',
    sections: [
      {
        title: 'Messaging goes live + game scheduling',
        items: [
          'Messaging is now on for everyone — team chats, direct messages, reactions, polls and reports become the club\'s main way to stay in touch.',
          'Spielplanung sandbox: admins and Spielplaner can create, edit and delete manual games right on the calendar, including bulk Excel import and per-team Spielplaner roles.',
          'The game calendar gains a week view with drag-to-reschedule (15-minute snaps, live conflict checks, touch-drag on mobile); SVRZ games stay read-only.',
          'SVRZ scheduling invites: admins send an opponent a tokenized link — with contacts pulled from the SVRZ feed or pasted from CSV — and track it from invited to viewed to booked.',
          'Basketball home games can book Halle A and B together with conflict detection across both, and Saturday volleyball games prefill their hall.',
          'Notifications: delete individual ones or clear all read in a single click, with proper localization.',
        ],
      },
    ],
  },
  {
    version: '3.12 – 3.17',
    date: '19.04.2026 – 20.04.2026',
    sections: [
      {
        title: 'Messaging foundation, club news & data explorer',
        items: [
          'The messaging system arrives: team conversations, direct messages, polls, reactions and reports, plus a personal inbox for your message notifications.',
          'Admins post club-wide announcements to the home news card and can broadcast targeted messages (email + push) to confirmed participants, with spam protection.',
          'Everyone can browse the club\'s data — teams, members, events and games — with instant fuzzy search in the Data Explorer.',
          'Chat polish: your messages sit on the right and others on the left, tap an edited message to see the original, and reaction and action buttons now work on mobile.',
          'Fixes & polish: coaches can manage their teams without permission errors, join requests notify the right people, and the team page no longer flashes empty.',
        ],
      },
    ],
  },
  {
    version: '3.5 – 3.11',
    date: '05.04.2026 – 17.04.2026',
    sections: [
      {
        title: 'Guided tours, Swiss Volley licence card, coach editing',
        items: [
          'Step-by-step guided tours for the main features (trainings, games, events, absences, scorer duty, Hallenplan) in all five languages, with a "?" button on every page.',
          'Your Swiss Volley licence — category, number, LAS badge, foreigner status and federation — now shows on your profile, live from Volleymanager.',
          'Coaches can change participation status inline in the roster, without opening a dialog.',
          'Team defaults get a tidy accordion: minimum players, RSVP deadline, note requirement and auto-cancel, applied to new activities.',
          'A searchable admin overview on the home page with key numbers, plus a public status page.',
        ],
      },
    ],
  },
  {
    version: '2.7 – 3.4',
    date: '26.03.2026 – 04.04.2026',
    sections: [
      {
        title: 'Moved to Directus: roles, branded emails, push & live sync',
        items: [
          'Seven clear roles (Admin, Sport Admin, Coach, Team Responsible, Vorstand, Member, Public), each with its own view and capabilities, and new members are auto-approved into the right one.',
          'Password-reset, invitation and one-time-code emails now carry KSCW branding, and you can sign in with Google.',
          'Web push notifications land on your device for new activities, RSVP changes and admin broadcasts — not just in-app.',
          'Daily automatic sync with Swiss Volley and Basketplan keeps your scoreboard and standings fresh.',
          'Behind the scenes: a faster, more reliable backend with uptime monitoring and security hardening.',
        ],
      },
    ],
  },
  {
    version: '1.0 – 2.6',
    date: '19.03.2026 – 26.03.2026',
    sections: [
      {
        title: 'Wiedisync launches',
        items: [
          'The first release of Wiedisync — a fast, real-time web app for KSC Wiedikon, available in German, English, French, Italian and Swiss German.',
          'Games and scoreboard: upcoming games and results with set scores, total or per-game standings, and an embeddable scoreboard.',
          'Calendar and Hallenplan: a monthly calendar with home / away colours and clickable absence bars, plus hall slots that coaches can claim.',
          'Trainings and participation: RSVP Yes / Maybe / No in real time, add notes, count guests and pick recurring trainings.',
          'Teams and roster: team cards with photos, position management, per-team guest levels and a QR-code invite for external sign-ups.',
          'Plus scorer duty with delegation, event planning, absence tracking and the first admin tools.',
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
