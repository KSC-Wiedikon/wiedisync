export default {
  menu: {
    title: 'Anleitung',
    subtitle: 'Lerne WiediSync kennen',
    resetAll: 'Alle zurücksetzen',
    completed: 'Abgeschlossen',
    steps: '{{count}} Schritte',
    restart: 'Tour wiederholen?',
  },
  welcome: {
    title: 'Willkommen bei WiediSync!',
    body: 'Möchtest du eine kurze Einführung in die wichtigsten Funktionen?',
    start: "Ja, los geht's",
    skip: 'Überspringen',
  },
  offer: {
    coachTools: 'Du hast hier Coach-Tools. Kurze Tour?',
    adminTools: 'Hier sind deine Admin-Tools. Kurze Tour?',
    start: 'Zeig mir',
    skip: 'Jetzt nicht',
  },
  tooltip: {
    skip: 'Überspringen',
    back: 'Zurück',
    next: 'Weiter',
    finish: 'Fertig',
    stepOf: 'von',
  },
  sections: {
    basics: 'Grundlagen',
    member: 'Mitglied-Funktionen',
    coach: 'Coach-Funktionen',
    admin: 'Admin-Funktionen',
  },
  tours: {
    gettingStarted: {
      title: 'Erste Schritte',
      description: 'Lerne die Grundlagen von WiediSync',
      steps: {
        nav: {
          title: 'Navigation',
          body: 'Hier findest du alle Bereiche der App. Auf dem Handy ist die Navigation unten.',
        },
        home: {
          title: 'Startseite',
          body: 'Dein persönliches Dashboard: bevorstehende Spiele, Trainings, offene Umfragen und auszufüllende Formulare auf einen Blick.',
        },
        profile: {
          title: 'Mein Profil',
          body: 'Persönliche Informationen, Kontaktdaten und Benachrichtigungseinstellungen ansehen und bearbeiten.',
        },
        language: {
          title: 'Sprache',
          body: 'Die App-Sprache kann jederzeit im Einstellungsmenü gewechselt werden.',
        },
        notifications: {
          title: 'Benachrichtigungen',
          body: 'Bleib auf dem Laufenden – verwalte Push-Benachrichtigungen und In-App-Meldungen hier.',
        },
      },
    },
    trainingPlayer: {
      title: 'Training – Spieler',
      description: 'Wie du deine Trainingsteilnahme verwaltest',
      steps: {
        list: {
          title: 'Trainingsliste',
          body: 'Alle bevorstehenden Trainings deines Teams sind hier mit Datum, Uhrzeit und Ort aufgelistet.',
        },
        rsvpButtons: {
          title: 'RSVP',
          body: 'Tippe auf Ja, Vielleicht oder Nein. Je nach Team-Einstellung bist du bereits automatisch zugesagt – tippe dann einfach auf Nein, wenn du nicht kommen kannst. Dein Coach sieht die Teilnahme-Statistiken.',
        },
        absence: {
          title: 'Abwesenheitsnotiz',
          body: 'Falls du nicht teilnehmen kannst, kannst du eine kurze Begründung hinterlassen.',
        },
        stats: {
          title: 'Anwesenheitsstatistik',
          body: 'Verfolge deine eigene Anwesenheitsquote über die ganze Saison.',
        },
      },
    },
    trainingCoach: {
      title: 'Training – Coach',
      description: 'Wie du Trainings als Coach verwaltest',
      steps: {
        overview: {
          title: 'Team-Übersicht',
          body: 'Sieh auf einen Blick, wer dabei ist, wer fehlt und wer noch nicht geantwortet hat.',
        },
        create: {
          title: 'Training erstellen',
          body: 'Füge eine neue Trainingseinheit mit Datum, Uhrzeit, Ort und optionalen Notizen hinzu.',
        },
        attendance: {
          title: 'Anwesenheitsliste',
          body: 'Zeige die vollständige Anwesenheitsliste für jedes Training an und exportiere sie bei Bedarf.',
        },
        cancel: {
          title: 'Training absagen',
          body: 'Nutze das Absage-Symbol auf einer Trainingskarte, um das Training mit optionaler Begründung abzusagen – die Spieler werden benachrichtigt und die RSVPs eingefroren. An derselben Stelle stellst du ein abgesagtes Training wieder her.',
        },
      },
    },
    gamesPlayer: {
      title: 'Spiele – Spieler',
      description: 'Wie du deine Spiele und Resultate verfolgst',
      steps: {
        list: {
          title: 'Spielliste',
          body: 'Alle bevorstehenden und vergangenen Spiele mit Datum, Gegner und Resultat.',
        },
        rsvp: {
          title: 'Spiel-RSVP',
          body: 'Bestätige, ob du am Spiel teilnehmen wirst. Mit automatischer Zusage bist du automatisch als teilnehmend markiert – reagiere nur, wenn du nicht kommen kannst. Dein Coach sieht diese Antworten.',
        },
        result: {
          title: 'Resultate',
          body: 'Spielresultate und Satzstände werden automatisch aus dem Liga-System aktualisiert. Mit der Saisonauswahl bei den Ranglisten kannst du vergangene Saisons durchstöbern.',
        },
        details: {
          title: 'Spieldetails',
          body: 'Tippe auf ein Spiel, um die vollständigen Details zu sehen: Ort, Treffpunkt, Aufstellung und Schreiber.',
        },
      },
    },
    gamesCoach: {
      title: 'Spiele – Coach',
      description: 'Coach-Tools auf der Spiele-Seite',
      steps: {
        dashboard: {
          title: 'Anwesenheits-Dashboard',
          body: 'Öffne den Dashboard-Tab für Anwesenheitsstatistiken deines Teams über einen wählbaren Zeitraum.',
        },
        stats: {
          title: 'Statistik pro Spieler',
          body: 'Gespielte Spiele, anwesend, abwesend und Anwesenheitsquote pro Spieler – tippe auf eine Zeile für die Detailansicht pro Spiel.',
        },
        manage: {
          title: 'Ein Spiel verwalten',
          body: 'Öffne ein Spiel für Details und Coach-Aktionen – beim Absagen oder Wiederherstellen eines Spiels wird dein Team benachrichtigt. Die Terminplanung der Spiele selbst findet in der Spielplanung-App statt.',
        },
      },
    },
    events: {
      title: 'Veranstaltungen',
      description: 'Vereinsanlässe und Teamaktivitäten',
      steps: {
        list: {
          title: 'Veranstaltungsliste',
          body: 'Vereinsweite Anlässe und Teamaktivitäten werden hier angezeigt.',
        },
        rsvp: {
          title: 'Event-Anmeldung',
          body: 'Melde dich für Veranstaltungen, Turniere und gesellschaftliche Aktivitäten an.',
        },
        details: {
          title: 'Veranstaltungsdetails',
          body: 'Ort, Uhrzeit, Beschreibung und die Liste der angemeldeten Teilnehmer.',
        },
      },
    },
    absences: {
      title: 'Abwesenheiten',
      description: 'Verwalte deine geplanten Abwesenheiten',
      steps: {
        list: {
          title: 'Abwesenheitsliste',
          body: 'Alle deine geplanten Abwesenheiten an einem Ort – für deine Coaches sichtbar.',
        },
        create: {
          title: 'Abwesenheit hinzufügen',
          body: 'Tippe auf das Plus-Symbol, um eine Abwesenheitsperiode mit Start-, Enddatum und Grund hinzuzufügen.',
        },
        coachView: {
          title: 'Coach-Ansicht',
          body: 'Coaches sehen alle Team-Abwesenheiten im Kalender überlagert, um vorausplanen zu können.',
        },
      },
    },
    scorerPlayer: {
      title: 'Schreibereinsatz – Spieler',
      description: 'Deine Schreiber-Zuteilungen',
      steps: {
        duty: {
          title: 'Schreibereinsatz',
          body: 'Wenn du als Schreiber für ein Spiel eingeteilt bist, siehst du es hier und erhältst eine Benachrichtigung.',
        },
        filters: {
          title: 'Filter',
          body: 'Grenze deine Einsätze nach Datum, Team oder Einsatzart ein oder suche nach einem bestimmten Spiel.',
        },
        delegate: {
          title: 'Delegieren',
          body: 'Kannst du nicht? Tippe auf Delegieren neben deinem Namen, um ein Teammitglied vorzuschlagen – es erhält eine Anfrage, die es annehmen oder ablehnen kann.',
        },
      },
    },
    scorerAdmin: {
      title: 'Schreiber – Admin',
      description: 'Schreibereinsätze automatisch zuteilen',
      steps: {
        overview: {
          title: 'Saison-Übersicht',
          body: 'Alle Heimspiele der aktuellen Saison, die ein Team für den Schreiber- oder Täfeler-Einsatz benötigen, werden hier geladen.',
        },
        run: {
          title: 'Automatisch zuteilen',
          body: 'Starte den Zuteilungsalgorithmus, um die Einsätze fair auf die Teams zu verteilen. Öffne das Panel mit den Algorithmus-Regeln, um zu sehen, wie er entscheidet.',
        },
        summary: {
          title: 'Team-Zusammenfassung',
          body: 'Wie viele Einsätze jedes Team in diesem Durchlauf erhalten hat – prüfe die Verteilung vor dem Speichern.',
        },
        assign: {
          title: 'Prüfen und anpassen',
          body: 'Ändere das Einsatz-Team jedes Spiels über sein Dropdown und speichere dann alle Zuteilungen.',
        },
      },
    },
    hallenplanCoach: {
      title: 'Hallenplan – Coach',
      description: 'Hallenzeitslots verwalten',
      steps: {
        overview: {
          title: 'Hallenplan',
          body: 'Alle Hallenzeitslots für deine Teams werden hier angezeigt – Trainings, Spiele und freie Slots.',
        },
        claim: {
          title: 'Freigegebenen Slot übernehmen',
          body: 'Wenn ein Team einen Slot freigibt, erscheint hier ein Hinweis – tippe darauf, um verfügbare Slots zu sehen und für dein Team zu übernehmen.',
        },
        release: {
          title: 'Slot-Farben',
          body: 'Die Farben zeigen den Slot-Typ: Trainings, Spiele, freigegebene Slots und Schliessungen. Tippe auf einen Slot deines Teams, um ihn zu verwalten oder freizugeben.',
        },
        virtual: {
          title: 'Automatische Einträge',
          body: 'Spiele, Trainings und Kalendereinträge erscheinen automatisch als Einträge mit einem "Auto"-Badge – sie werden live eingeblendet, nicht gebucht.',
        },
      },
    },
    profile: {
      title: 'Profil & Einstellungen',
      description: 'Passe dein Konto an',
      steps: {
        contact: {
          title: 'Deine Angaben',
          body: 'Halte deine Kontaktdaten aktuell – deine Coaches verlassen sich darauf. Ändere sie über den Button "Profil bearbeiten".',
        },
        attendance: {
          title: 'Automatische Zusage',
          body: 'Wähle, ob du für neue Trainings, Spiele und Veranstaltungen automatisch zugesagt bist. Abwesenheiten haben immer Vorrang vor der automatischen Zusage.',
        },
        emails: {
          title: 'E-Mail-Benachrichtigungen',
          body: 'Schalte einzelne E-Mail-Benachrichtigungen aus – die Benachrichtigungsglocke in der App zeigt immer alles an.',
        },
        privacy: {
          title: 'Privatsphäre',
          body: 'Ein "Versteckt"-Badge bedeutet, dass Teammitglieder deine E-Mail nicht sehen können. Ändere dies und mehr unter "Profil bearbeiten".',
        },
      },
    },
    teams: {
      title: 'Teams',
      description: 'Deine Teams – und wie du weiteren beitrittst',
      steps: {
        list: {
          title: 'Deine Teams',
          body: 'Alle deine Teams auf einen Blick. Tippe auf ein Team für Kader, Staff und Spiele.',
        },
        join: {
          title: 'Einem weiteren Team beitreten',
          body: 'Stelle eine Beitrittsanfrage für ein weiteres Team – wähle Sportart und Team, und ein Coach genehmigt deine Anfrage. Ein Team verlassen funktioniert an derselben Stelle.',
        },
      },
    },
    forms: {
      title: 'Formulare',
      description: 'Vereins- und Teamformulare ausfüllen',
      steps: {
        list: {
          title: 'Offene Formulare',
          body: 'Formulare, die dein Verein oder Team von dir ausgefüllt haben möchte, sind hier aufgelistet – offene Formulare erscheinen auch auf deiner Startseite.',
        },
        fill: {
          title: 'Ein Formular ausfüllen',
          body: 'Tippe auf Ausfüllen, um zu antworten. Du kannst deine Antwort bearbeiten, solange das Formular offen ist.',
        },
        create: {
          title: 'Formulare erstellen',
          body: 'Coaches, Teamverantwortliche und der Vorstand können Formulare erstellen, Antworten einsehen und exportieren.',
        },
      },
    },
    financeDues: {
      title: 'Meine Finanzen',
      description: 'Beiträge und Rechnungen in der App bezahlen',
      steps: {
        iban: {
          title: 'Auszahlungs-IBAN',
          body: 'Rückerstattungen des Vereins werden auf dieses Konto ausbezahlt – hinterlege oder aktualisiere deine IBAN hier.',
        },
        list: {
          title: 'Deine Rechnungen',
          body: 'Mitgliederbeiträge und Vereinsrechnungen mit Beträgen und Zahlungsstatus.',
        },
        pay: {
          title: 'Eine Rechnung bezahlen',
          body: 'Tippe auf eine offene Rechnung, um sie aufzuklappen, scanne dann die QR-Rechnung mit TWINT oder deiner Banking-App und tippe auf "Ich habe bezahlt".',
        },
        status: {
          title: 'Zahlungsstatus',
          body: 'Nach dem Melden einer Zahlung zeigt die Rechnung "Bestätigung ausstehend", bis der Kassier sie bestätigt.',
        },
      },
    },
    expenses: {
      title: 'Spesen',
      description: 'Lass dir Vereinsspesen zurückerstatten',
      steps: {
        upload: {
          title: 'Beleg hochladen',
          body: 'Wähle ein Foto oder PDF deines Belegs – Betrag, Datum und Anbieter werden automatisch ausgelesen.',
        },
        iban: {
          title: 'IBAN prüfen',
          body: 'Prüfe vor dem Einreichen die Auszahlungs-IBAN – das ist dein eigenes Konto, auf das der Verein zurückerstattet.',
        },
        submissions: {
          title: 'Meine Einreichungen',
          body: 'Verfolge deine Einreichungen hier: ausstehend, bezahlt oder abgelehnt. Du wirst benachrichtigt, sobald der Kassier entscheidet.',
        },
      },
    },
  },
} as const
