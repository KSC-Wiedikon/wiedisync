export default {
  menu: {
    title: 'Guide',
    subtitle: 'Learn WiediSync',
    resetAll: 'Reset all',
    completed: 'Completed',
    steps: '{{count}} steps',
    restart: 'Replay tour?',
  },
  welcome: {
    title: 'Welcome to WiediSync!',
    body: 'Would you like a quick introduction to the main features?',
    start: "Yes, let's go",
    skip: 'Skip',
  },
  offer: {
    coachTools: 'You have coach tools here. Quick tour?',
    adminTools: 'Here are your admin tools. Quick tour?',
    start: 'Show me',
    skip: 'Not now',
  },
  tooltip: {
    skip: 'Skip',
    back: 'Back',
    next: 'Next',
    finish: 'Done',
    stepOf: 'of',
  },
  sections: {
    basics: 'Basics',
    member: 'Member features',
    coach: 'Coach features',
    admin: 'Admin features',
  },
  tours: {
    gettingStarted: {
      title: 'Getting started',
      description: 'Learn the basics of WiediSync',
      steps: {
        nav: {
          title: 'Navigation',
          body: 'Here you find all areas of the app. On mobile the navigation is at the bottom.',
        },
        home: {
          title: 'Home',
          body: 'Your personal dashboard: upcoming games, trainings, open surveys, and forms to fill at a glance.',
        },
        profile: {
          title: 'My profile',
          body: 'View and edit your personal information, contact details, and notification settings.',
        },
        language: {
          title: 'Language',
          body: 'You can switch the app language at any time in the settings menu.',
        },
        notifications: {
          title: 'Notifications',
          body: 'Stay up to date — manage push notifications and in-app alerts here.',
        },
      },
    },
    trainingPlayer: {
      title: 'Trainings — Player',
      description: 'How to manage your training attendance',
      steps: {
        list: {
          title: 'Training list',
          body: 'All upcoming trainings for your team are listed here with date, time, and location.',
        },
        rsvpButtons: {
          title: 'RSVP',
          body: 'Tap Yes, Maybe, or No. Depending on your team settings you may already be auto-confirmed — then just tap No when you cannot make it. Your coach sees the attendance statistics.',
        },
        absence: {
          title: 'Absence note',
          body: 'If you cannot attend, you can add a short note explaining your absence.',
        },
        stats: {
          title: 'Attendance stats',
          body: 'Track your own attendance rate over the season.',
        },
      },
    },
    trainingCoach: {
      title: 'Trainings — Coach',
      description: 'How to manage trainings as a coach',
      steps: {
        overview: {
          title: 'Team overview',
          body: 'See at a glance who is attending, who is absent, and who has not responded yet.',
        },
        create: {
          title: 'Create training',
          body: 'Add a new training session with date, time, location, and optional notes.',
        },
        attendance: {
          title: 'Attendance list',
          body: 'View the full attendance list for each training and export it if needed.',
        },
        cancel: {
          title: 'Cancel a training',
          body: 'Use the cancel icon on a training card to cancel it with an optional reason — players are notified and RSVPs freeze. The same spot reinstates a cancelled session.',
        },
      },
    },
    gamesPlayer: {
      title: 'Games — Player',
      description: 'How to track your games and results',
      steps: {
        list: {
          title: 'Game list',
          body: 'All your upcoming and past games with date, opponent, and result.',
        },
        rsvp: {
          title: 'Game RSVP',
          body: 'Confirm whether you will be attending the game. With auto-confirm you are marked attending automatically — only act when you cannot come. Your coach sees these responses.',
        },
        result: {
          title: 'Results',
          body: 'Match results and set scores are updated automatically from the league system. Use the season picker on the rankings to browse past seasons.',
        },
        details: {
          title: 'Game details',
          body: 'Tap a game to see the full details: venue, meeting time, line-up, and scoring.',
        },
      },
    },
    gamesCoach: {
      title: 'Games — Coach',
      description: 'Coach tools on the games page',
      steps: {
        dashboard: {
          title: 'Attendance dashboard',
          body: 'Open the Dashboard tab for attendance statistics of your team over a date range.',
        },
        stats: {
          title: 'Per-player stats',
          body: 'Games played, present, absent, and attendance rate per player — tap a row for the per-game drill-down.',
        },
        manage: {
          title: 'Manage a game',
          body: 'Open a game for details and coach actions — cancelling or reinstating a game notifies your team. Match scheduling itself lives in the Spielplanung app.',
        },
      },
    },
    events: {
      title: 'Events',
      description: 'Club events and team activities',
      steps: {
        list: {
          title: 'Event list',
          body: 'Club-wide events and team activities are shown here.',
        },
        rsvp: {
          title: 'Event RSVP',
          body: 'Register your attendance for events, tournaments, and social activities.',
        },
        details: {
          title: 'Event details',
          body: 'Location, time, description, and the list of registered participants.',
        },
      },
    },
    absences: {
      title: 'Absences',
      description: 'Manage your planned absences',
      steps: {
        list: {
          title: 'Absence list',
          body: 'All your planned absences in one place — visible to your coaches.',
        },
        create: {
          title: 'Add absence',
          body: 'Tap the plus button to add an absence period with start date, end date, and reason.',
        },
        coachView: {
          title: 'Coach view',
          body: 'Coaches see all team member absences overlaid on the calendar to plan ahead.',
        },
      },
    },
    scorerPlayer: {
      title: 'Scorer duty — Player',
      description: 'Your scorer assignments',
      steps: {
        duty: {
          title: 'Scorer duty',
          body: 'If you are assigned as scorer for a game, you will see it here and receive a notification.',
        },
        filters: {
          title: 'Filters',
          body: 'Narrow your duties by date, team, or duty type, or search for a specific game.',
        },
        delegate: {
          title: 'Delegate',
          body: 'Cannot make it? Tap Delegate next to your name to suggest a teammate — they receive a request they can accept or decline.',
        },
      },
    },
    scorerAdmin: {
      title: 'Scorer — Admin',
      description: 'Assign scorer duties automatically',
      steps: {
        overview: {
          title: 'Season overview',
          body: 'All home games of the current season that need a scorer or Täfeler duty team are loaded here.',
        },
        run: {
          title: 'Auto-assign',
          body: 'Run the assignment algorithm to distribute duties fairly across teams. Open the algorithm rules panel to see how it decides.',
        },
        summary: {
          title: 'Team summary',
          body: 'How many duties each team received in this run — check the balance before saving.',
        },
        assign: {
          title: 'Review and adjust',
          body: 'Change the duty team of any game via its dropdown, then save all assignments.',
        },
      },
    },
    hallenplanCoach: {
      title: 'Hall plan — Coach',
      description: 'Manage hall time slots',
      steps: {
        overview: {
          title: 'Hall plan',
          body: 'All hall time slots for your teams are shown here — trainings, games, and free slots.',
        },
        claim: {
          title: 'Claim a freed slot',
          body: 'When a team frees a slot, a pill appears here — tap it to see and claim available slots for your team.',
        },
        release: {
          title: 'Slot colors',
          body: 'Colors encode the slot type: trainings, games, freed slots, and closures. Tap one of your team slots to manage or release it.',
        },
        virtual: {
          title: 'Automatic entries',
          body: 'Games, trainings, and calendar events appear automatically as entries with an "Auto" badge — they are projected live, not booked.',
        },
      },
    },
    profile: {
      title: 'Profile & settings',
      description: 'Tune your account',
      steps: {
        contact: {
          title: 'Your details',
          body: 'Keep your contact details up to date — your coaches rely on them. Change them via the Edit profile button.',
        },
        attendance: {
          title: 'Auto sign-in',
          body: 'Choose whether you are automatically confirmed for new trainings, games, and events. Absences always win over auto-confirmation.',
        },
        emails: {
          title: 'Email notifications',
          body: 'Switch off individual email alerts — the in-app notification bell always shows everything.',
        },
        privacy: {
          title: 'Privacy',
          body: 'A "Hidden" badge means teammates cannot see your email. Change this and more under Edit profile.',
        },
      },
    },
    teams: {
      title: 'Teams',
      description: 'Your teams — and how to join more',
      steps: {
        list: {
          title: 'Your teams',
          body: 'All your teams at a glance. Tap a team for the roster, staff, and games.',
        },
        join: {
          title: 'Join another team',
          body: 'Request to join another team — pick the sport and team, and a coach approves your request. Leaving a team works from the same place.',
        },
      },
    },
    forms: {
      title: 'Forms',
      description: 'Fill in club and team forms',
      steps: {
        list: {
          title: 'Open forms',
          body: 'Forms your club or team asks you to fill are listed here — open forms also appear on your home page.',
        },
        fill: {
          title: 'Fill a form',
          body: 'Tap Fill to answer. You can edit your response as long as the form stays open.',
        },
        create: {
          title: 'Create forms',
          body: 'Coaches, team responsibles, and the board can create forms, see responses, and export them.',
        },
      },
    },
    financeDues: {
      title: 'My finances',
      description: 'Pay dues and invoices in the app',
      steps: {
        iban: {
          title: 'Payout IBAN',
          body: 'Reimbursements from the club are paid to this account — add or update your IBAN here.',
        },
        list: {
          title: 'Your invoices',
          body: 'Membership dues and club invoices with their amounts and payment status.',
        },
        pay: {
          title: 'Pay an invoice',
          body: 'Tap an open invoice to expand it, then scan the Swiss QR-bill with TWINT or your banking app and tap "I have paid".',
        },
        status: {
          title: 'Payment status',
          body: 'After reporting a payment the invoice shows "Pending confirmation" until the treasurer confirms it.',
        },
      },
    },
    expenses: {
      title: 'Expenses',
      description: 'Get club expenses reimbursed',
      steps: {
        upload: {
          title: 'Upload a receipt',
          body: 'Pick a photo or PDF of your receipt — amount, date, and vendor are read automatically.',
        },
        iban: {
          title: 'Check the IBAN',
          body: 'Before submitting, check the pay-to IBAN — that is your own account the club reimburses to.',
        },
        submissions: {
          title: 'My submissions',
          body: 'Track your submissions here: pending, paid, or rejected. You are notified as soon as the treasurer decides.',
        },
      },
    },
  },
} as const
