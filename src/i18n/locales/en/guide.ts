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
          body: 'Your personal dashboard: upcoming games, trainings, and tasks at a glance.',
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
          body: 'Tap Yes, Maybe, or No. Your coach can see the attendance statistics.',
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
        notify: {
          title: 'Notify players',
          body: 'Send a push notification to all players who have not yet responded.',
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
          body: 'Confirm whether you will be attending the game. Your coach sees these responses.',
        },
        result: {
          title: 'Results',
          body: 'Match results and set scores are updated automatically from the league system.',
        },
        details: {
          title: 'Game details',
          body: 'Tap a game to see the full details: venue, meeting time, line-up, and scoring.',
        },
      },
    },
    gamesCoach: {
      title: 'Games — Coach',
      description: 'How to manage games as a coach',
      steps: {
        overview: {
          title: 'Game overview',
          body: 'Your full game schedule with RSVP counts and result status for each match.',
        },
        lineup: {
          title: 'Line-up',
          body: 'Define the player line-up for each game and share it with your team.',
        },
        scorer: {
          title: 'Scorer assignment',
          body: 'Assign a scorer for home games. The scorer receives a notification automatically.',
        },
        notes: {
          title: 'Coach notes',
          body: 'Add private notes to a game — only visible to coaches.',
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
        confirm: {
          title: 'Confirm',
          body: 'Confirm or decline your scorer assignment. Declining notifies your coach.',
        },
        delegate: {
          title: 'Delegate',
          body: 'If you cannot score, you can suggest another team member as replacement.',
        },
      },
    },
    scorerAdmin: {
      title: 'Scorer — Admin',
      description: 'Manage scorer assignments',
      steps: {
        overview: {
          title: 'Scorer overview',
          body: 'See all games that require a scorer and their current assignment status.',
        },
        assign: {
          title: 'Assign scorer',
          body: 'Select a player for each game. They are automatically notified.',
        },
        history: {
          title: 'History',
          body: 'Track who has scored how many games — useful for fair rotation.',
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
          title: 'Claim a slot',
          body: 'Tap a free slot to claim it for your team. The slot is reserved immediately.',
        },
        release: {
          title: 'Release a slot',
          body: 'If you no longer need a slot, release it so other teams can use it.',
        },
        conflict: {
          title: 'Conflicts',
          body: 'Overlapping slots are highlighted. Contact the admin to resolve conflicts.',
        },
      },
    },
  },
} as const
